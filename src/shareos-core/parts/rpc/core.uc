// ShareOS rpcd plugin: ubus objects used by the web interface.
//
//   shareos.system   info | log | reboot | poweroff | factory_reset |
//                    set_password | set_hostname
//   shareos.service  list | action | autostart
//   shareos.net      get | set | confirm   (network with automatic rollback)
//   shareos.accounts list | add | set | passwd | del | group_add | group_del | import_altf
//   shareos.shares   list | set | del | global | vault_lock
//   shareos.me       bind | get | passwd | ui_set | fav_set | desk_get | desk_set   (the logged-in account, also for plain users)
//   shareos.backup   offer | export | restore   (settings as JSON, optionally encrypted)
//   shareos.recovery status | apply | discard | apps_install | apps_dismiss   (after a restore)
//   shareos.paperless get | set_global | test | inbox_set | inbox_del | run | tags | log
//   shareos.cloud    status | install | remotes | remote_add | remote_del | remote_test |
//                    jobs | job_set | job_del | job_run | job_stop | job_log
//   shareos.files    roots | list | mkdir | rename | move | delete | ticket |
//                    openers | app_ticket   (open a file in an app)
//                    (file browser: admins all volumes, users their personal folder)
//   shareos.apps     installed | catalog | install | status | upload_ticket | install_upload |
//                    remove | set | store_get | store_set   (web apps, own web server)
//   shareos.widget   get | set | status   (status page for widget apps, token protected)
//   shareos.update   check | status | download | apply | cancel
//   shareos.tremote  get | set | revoke   (remote access for Transmission programs)
//
// Long-running update steps run as a separate process (shareos-update) so
// rpcd's main loop is never blocked; the UI polls shareos.update.status.
'use strict';

import { readfile, writefile, open as fopen, popen, glob, stat, lstat, lsdir, realpath, readlink, symlink, unlink, rename } from 'fs';
import { cursor } from 'uci';

// JSON text -> value; null when the text is not JSON (never an exception:
// a damaged file or a tool that printed an error must not end the call)
function jparse(s) { try { return json(s); } catch (e) { return null; } }

const UPDATER = '/usr/sbin/shareos-update';
// Switching off or restarting while kernel, initramfs or the system are being
// written leaves a box that may not start any more: refused until the write
// has finished (shareos-update busy; also asked by shareos-power,
// shareos-buttons and shareos-board).
const FLASH_BUSY = 'firmware is being written – wait until it has finished';
function flash_busy() { return system(UPDATER + ' busy >/dev/null 2>&1') == 0; }
const NET = '/usr/sbin/shareos-net';
const NET_ST = '/tmp/shareos-net';
const NET_ROLLBACK = '/etc/shareos/network.rollback';
const NET_TIMEOUT = 120;     // s until unconfirmed network settings are rolled back

// services the UI may show and control: init script -> process name
const SERVICES = {
	dropbear: { proc: 'dropbear', label: 'SSH / SFTP', desc: 'Dropbear, port 22' },
	uhttpd:   { proc: 'uhttpd',   label: 'Web interface', desc: 'uhttpd, port 80' },
	ntpd:     { proc: 'ntpd',     label: 'Time (NTP)', desc: 'sets the clock, keeps the MCU clock in sync' },
	crond:    { proc: 'crond',    label: 'Scheduler', desc: 'cron' },
	rpcd:     { proc: 'rpcd',     label: 'API (rpcd)', desc: 'interface for this web UI' },
	ubus:     { proc: 'ubusd',    label: 'System bus (ubus)', desc: 'messages between the services' },
	syslogd:  { proc: 'syslogd',  label: 'System log', desc: 'syslogd, in RAM' },
	'avahi-daemon': { proc: 'avahi-daemon', label: 'Network name (mDNS)', desc: 'makes the box reachable as <name>.local' },
	board:    { proc: 'dns320l-daemon', label: 'Board control', desc: 'fan, temperature, buttons, MCU clock' }
};
// services of system apps ("service" in their app.json, see shareos-apps):
// listed while the app is installed, controlled by /usr/sbin/shareos-<control>
const SYS_SVC_TEXT = {
	dlna:         { label: 'Media server (DLNA)', desc: 'MiniDLNA, port 8200' },
	tailscale:    { label: 'Remote access (Tailscale)', desc: 'tailscaled, WireGuard mesh' },
	vpn:          { label: 'VPN (OpenVPN)', desc: 'Client and server, app NetTunnel' },
	transmission: { label: 'Torrents (Transmission)', desc: 'one service per account' },
	autobrr:      { label: 'Download automation (autobrr)', desc: 'autobrr, port 7474' },
	zabbix:       { label: 'Monitoring (Zabbix agent)', desc: 'zabbix_agentd, active mode' },
	// proc: the program to look for when the system app lists no command
	dnsfilter:    { proc: 'AdGuardHome' }
};
// services that must not be stopped from the UI (it would cut itself off)
const ESSENTIAL = { uhttpd: true, rpcd: true, ubus: true, board: true };

// services not started at boot (UCI shareos.autostart.disabled) as a set
function autostart_off() {
	let l = cursor().get('shareos', 'autostart', 'disabled') ?? [];
	if (type(l) != 'array') l = split(l, ' ');
	let o = {};
	for (let n in l) if (n != '') o[n] = true;
	return o;
}

function shq(s) {
	return "'" + replace(s, "'", "'\\''") + "'";
}

/* ---------- results kept between calls ----------
 * rpcd keeps this plugin loaded, so results of expensive steps (programs
 * started with sh(), other ucode tools) are kept here: valid while their
 * stamp (sizes and times of the files they depend on) is unchanged and,
 * with a ttl, for at most ttl seconds. rpcd answers one call at a time –
 * every program it does not start makes the interface faster.
 */
let MEMO = {};
function memo(key, stamp, ttl, fn) {
	let m = MEMO[key], now = time();
	if (m && m.stamp == stamp && (!ttl || now - m.at < ttl)) return m.val;
	let v = fn();
	MEMO[key] = { stamp, at: now, val: v };
	return v;
}
function forget(key) { delete MEMO[key]; }
// stamp of files: size and modification time (missing files count too).
// Modification times count in seconds: a file changed a moment ago can change
// again without its stamp changing, so such a stamp is made to match nothing.
function fstamp(...paths) {
	let now = time(), fresh = false;
	let s = join('|', map(paths, (p) => {
		let st = stat(p);
		if (st && st.mtime >= now - 1) fresh = true;
		return st ? st.size + ':' + st.mtime : '-';
	}));
	return fresh ? s + '|' + join('.', clock()) : s;
}

function sh(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p)
		return { rc: -1, out: '' };
	let out = p.read('all') ?? '';
	let rc = p.close();
	return { rc, out };
}

// like sh(), but without the error output: for tools whose answer is parsed
// (JSON) – a warning on stderr in the middle of it would make it unreadable
function sh_quiet(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p)
		return { rc: -1, out: '' };
	let out = p.read('all') ?? '';
	let rc = p.close();
	return { rc, out };
}

// run a command with secret text on its standard input. The text goes through
// a file only root can read (in RAM) and never onto a command line, where every
// local user could read it in the process list.
const SH_IN_DIR = '/tmp/.shareos-in';
function sh_in_file(input) {
	let rnd = readfile('/dev/urandom', 12) ?? '';
	let name = '';
	for (let i = 0; i < length(rnd); i++) name += sprintf('%02x', ord(rnd, i));
	let f = SH_IN_DIR + '/' + (name != '' ? name : '' + time());
	system(sprintf('mkdir -p %s && chmod 700 %s && umask 077 && : > %s', SH_IN_DIR, SH_IN_DIR, f));
	writefile(f, input ?? '');
	return f;
}
function sh_in(cmd, input) {
	let f = sh_in_file(input);
	let r = sh(sprintf('( %s ) < %s', cmd, f));
	unlink(f);
	return r;
}

function read_trim(path) {
	let d = readfile(path);
	return d != null ? trim(replace(d, '\0', '')) : null;
}

function read_int(path) {
	let v = read_trim(path);
	return v != null && match(v, /^-?[0-9]+$/) ? +v : null;
}

// names of folders the box creates on the disks, in the language of the box
// ("folders" of /www/i18n/<code>.json). Only used when a folder is created:
// an existing one keeps its name, also after the language changed.
const FOLDER_EN = { shared: 'Shared', usb: 'USB copies' };
function folder_names(lang) {
	if (!lang || lang == 'en' || !match(lang, /^[a-z]{2,3}$/)) return FOLDER_EN;
	let j = null;
	try { j = json(readfile('/www/i18n/' + lang + '.json') ?? 'null'); } catch (e) {}
	return { ...FOLDER_EN, ...(type(j?.folders) == 'object' ? j.folders : {}) };
}
function folder_name(id) { return folder_names(cursor().get('shareos', 'ui', 'lang'))[id]; }
// every name a folder has in any language (to find one made earlier)
function folder_all_names(id) {
	let out = [ FOLDER_EN[id] ];
	for (let f in glob('/www/i18n/*.json')) {
		let m = match(f, /\/([a-z]{2,3})\.json$/);
		let n = m ? folder_names(m[1])[id] : null;
		if (n && index(out, n) < 0) push(out, n);
	}
	return out;
}

function release() {
	let r = {};
	for (let line in split(readfile('/etc/shareos-release') ?? '', '\n')) {
		let m = match(line, /^([A-Z_]+)="?([^"]*)"?$/);
		if (m) r[lc(replace(m[1], 'SHAREOS_', ''))] = m[2];
	}
	return r;
}

function meminfo() {
	let m = {};
	for (let line in split(readfile('/proc/meminfo') ?? '', '\n')) {
		let x = match(line, /^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):\s+([0-9]+) kB/);
		if (x) m[lc(x[1])] = +x[2] * 1024;
	}
	return m;
}

// jiffies of the first "cpu" line; the UI computes the load from two samples
function cpustat() {
	let l = match(readfile('/proc/stat') ?? '', /^cpu +([0-9 ]+)/);
	if (!l)
		return null;
	let v = map(split(trim(l[1]), / +/), (x) => +x);
	let idle = v[3] + (v[4] ?? 0);
	let total = 0;
	for (let x in v) total += x;
	return { total, idle };
}

function disks() {
	let list = [];
	for (let d in glob('/sys/block/sd*')) {
		let name = substr(d, 11);
		push(list, {
			name,
			model: read_trim(d + '/device/model'),
			size: (read_int(d + '/size') ?? 0) * 512,
			removable: read_int(d + '/removable') == 1
		});
	}
	return list;
}

// df for the mount points the UI shows
function filesystems() {
	let list = [];
	let r = sh('df -k /overlay /rom /tmp');
	for (let line in split(r.out, '\n')) {
		let f = split(trim(line), /\s+/);
		if (length(f) >= 6 && match(f[1], /^[0-9]+$/))
			push(list, { source: f[0], mount: f[5], size: +f[1] * 1024, used: +f[2] * 1024, avail: +f[3] * 1024 });
	}
	return list;
}

function ipv4(ifname) {
	let r = sh('ip -4 -o addr show dev ' + shq(ifname));
	let m = match(r.out, /inet ([0-9.]+)\/([0-9]+)/);
	return m ? { address: m[1], prefix: +m[2] } : null;
}

function gateway() {
	let m = match(sh('ip -4 route show default').out, /default via ([0-9.]+)/);
	return m?.[1];
}

function dns() {
	let list = [];
	for (let line in split(readfile('/etc/resolv.conf') ?? '', '\n')) {
		let m = match(line, /^nameserver\s+(\S+)/);
		if (m) push(list, m[1]);
	}
	return list;
}

function boot_mode() {
	let mounts = readfile('/proc/mounts') ?? '';
	if (match(mounts, / \/overlay ubifs /)) return 'flash';
	if (match(readfile('/proc/cmdline') ?? '', /shareos\.netroot=/)) return 'netroot';
	return 'ram';
}

function run_updater(args) {
	let p = popen(join(' ', [ UPDATER, ...map(args, shq) ]) + ' 2>/dev/null', 'r');
	let out = p ? (p.read('all') ?? '') : '';
	p?.close();
	let res = null;
	try { res = json(out); } catch (e) { }
	return type(res) == 'object' ? res : { state: 'error', error: 'updater returned no result' };
}

function spawn_updater(args) {
	// detached, so the ubus call returns at once
	system(sprintf('start-stop-daemon -S -b -x %s -- %s', UPDATER, join(' ', map(args, shq))));
	return { started: true };
}

// names of the running processes (one look at /proc instead of a pidof per name)
function proc_names() {
	let n = {};
	for (let pid in lsdir('/proc') ?? []) {
		if (!match(pid, /^[0-9]+$/)) continue;
		// a process that has ended but is not reaped yet (zombie) does not run
		if (match(readfile('/proc/' + pid + '/stat', 512) ?? '', /\) Z /)) continue;
		let c = trim(readfile('/proc/' + pid + '/comm') ?? '');
		if (c != '') n[c] = true;
		// comm is cut to 15 characters: the program name from the command line too
		let a = readfile('/proc/' + pid + '/cmdline', 256);
		if (a) { let a0 = split(a, '\x00')[0]; if (a0 != '') n[replace(a0, /^.*\//, '')] = true; }
	}
	return n;
}

function running(proc, names) {
	return !!(names ?? proc_names())[proc];
}

// Is the process running after an action? A service that was just stopped can
// take a moment to end, one just started a moment to appear: wait up to 2 s
// for the state the action should lead to, then say what is.
function settled(proc, want) {
	for (let i = 0; i < 10; i++) {
		if (running(proc) == want) return want;
		sleep(200);
	}
	return running(proc);
}

function sys_services() {
	let j = null;
	try { j = json(sh('/usr/sbin/shareos-apps services list').out); } catch (e) { }
	return filter(j?.services ?? [], (s) => s.boot && !SERVICES[s.control]);
}
function sys_service(name) {
	for (let s in sys_services()) if (s.control == name) return s;
	return null;
}
function init_script(name) {
	let s = glob('/etc/init.d/S[0-9][0-9]' + name);
	return length(s) == 1 ? s[0] : null;
}


