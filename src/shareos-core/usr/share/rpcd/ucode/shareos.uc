// ShareOS rpcd plugin: ubus objects used by the web interface.
//
//   shareos.system   info | log | reboot | poweroff | factory_reset |
//                    set_password | set_hostname
//   shareos.service  list | action | autostart
//   shareos.net      get | set | confirm   (network with automatic rollback)
//   shareos.accounts list | add | set | passwd | del | group_add | group_del | import_altf
//   shareos.shares   list | set | del | global
//   shareos.me       bind | get | passwd | ui_set   (the logged-in account, also for plain users)
//   shareos.backup   export | restore      (settings as JSON, optionally encrypted)
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
//
// Long-running update steps run as a separate process (shareos-update) so
// rpcd's main loop is never blocked; the UI polls shareos.update.status.
'use strict';

import { readfile, writefile, popen, glob, stat, lstat, lsdir, realpath, readlink, symlink, unlink } from 'fs';
import { cursor } from 'uci';

const UPDATER = '/usr/sbin/shareos-update';
const NET = '/usr/sbin/shareos-net';
const NET_ST = '/tmp/shareos-net';
const NET_ROLLBACK = '/etc/shareos/network.rollback';
const NET_TIMEOUT = 120;     // s until unconfirmed network settings are rolled back

// services the UI may show and control: init script -> process name
const SERVICES = {
	dropbear: { proc: 'dropbear', label: 'SSH / SFTP', desc: 'Dropbear, Port 22' },
	uhttpd:   { proc: 'uhttpd',   label: 'Weboberfläche', desc: 'uhttpd, Port 80' },
	ntpd:     { proc: 'ntpd',     label: 'Zeit (NTP)', desc: 'stellt die Uhr, gleicht die MCU-Uhr ab' },
	crond:    { proc: 'crond',    label: 'Zeitplaner', desc: 'cron' },
	rpcd:     { proc: 'rpcd',     label: 'API (rpcd)', desc: 'Schnittstelle für diese Oberfläche' },
	ubus:     { proc: 'ubusd',    label: 'Systembus (ubus)', desc: 'Nachrichten zwischen den Diensten' },
	syslogd:  { proc: 'syslogd',  label: 'Systemprotokoll', desc: 'syslogd, im RAM' },
	'avahi-daemon': { proc: 'avahi-daemon', label: 'Netzwerkname (mDNS)', desc: 'macht die Box als <name>.local erreichbar' },
	board:    { proc: 'dns320l-daemon', label: 'Gerätesteuerung', desc: 'Lüfter, Temperatur, Taster, MCU-Uhr' }
};
// services of system apps ("service" in their app.json, see shareos-apps):
// listed while the app is installed, controlled by /usr/sbin/shareos-<control>
const SYS_SVC_TEXT = {
	dlna:         { label: 'Medienserver (DLNA)', desc: 'MiniDLNA, Port 8200' },
	tailscale:    { label: 'Fernzugriff (Tailscale)', desc: 'tailscaled, WireGuard-Mesh' },
	vpn:          { label: 'VPN (OpenVPN)', desc: 'Client und Server, App NetTunnel' },
	transmission: { label: 'Torrents (Transmission)', desc: 'ein Dienst pro Konto' }
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
// stamp of files: size and modification time (missing files count too)
function fstamp(...paths) {
	return join('|', map(paths, (p) => { let st = stat(p); return st ? st.size + ':' + st.mtime : '-'; }));
}

function sh(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p)
		return { rc: -1, out: '' };
	let out = p.read('all') ?? '';
	let rc = p.close();
	return { rc, out };
}

function read_trim(path) {
	let d = readfile(path);
	return d != null ? trim(replace(d, '\0', '')) : null;
}

function read_int(path) {
	let v = read_trim(path);
	return v != null && match(v, /^-?[0-9]+$/) ? +v : null;
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


/* ---------- storage ---------- */

const STORAGE = '/usr/sbin/shareos-storage';
const SMART_DIR = '/tmp/shareos-storage';
const SMART_MAX_AGE = 1800;     // s; SMART reads keep disks awake, so cache them

function valid_name(n) { return type(n) == 'string' && match(n, /^[a-z0-9][a-z0-9_-]{0,15}$/); }
function valid_disk(d) { return type(d) == 'string' && match(d, /^sd[a-z]$/) && stat('/sys/block/' + d); }
const USB = '/usr/sbin/shareos-usb';
const FS_DISK = { ext4: 1, ext3: 1, ext2: 1, btrfs: 1, exfat: 1, ntfs: 1, vfat: 1 };
const FS_USB = { exfat: 1, vfat: 1, ntfs: 1, ext4: 1 };
// USB sticks/disks hang below a USB host in sysfs; the bays are SATA
function is_usb(d) { return valid_disk(d) && index(realpath('/sys/block/' + d) ?? '', '/usb') >= 0; }
// mounted USB partitions: { dev, path, fs }
function usb_mounts() {
	let l = [];
	for (let line in split(sh(USB + ' list').out, '\n')) {
		let f = split(trim(line), ' ');
		if (length(f) == 3) push(l, { dev: f[0], path: f[1], fs: f[2] });
	}
	return l;
}

function ubiblock_major() {
	let m = match(readfile('/proc/devices') ?? '', /\n *([0-9]+) ubiblock\n/);
	return m ? m[1] : null;
}

function lsblk() {
	// -e: leave out mtdblock (31), ram (1) and ubiblock devices – only disks matter here
	let r = sh('lsblk -J -b -e 1,31,' + (ubiblock_major() ?? '31') + ' -o NAME,TYPE,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINT,MODEL,SERIAL,TRAN,RM,ROTA');
	let j = null;
	try { j = json(r.out); } catch (e) { }
	return j?.blockdevices ?? [];
}

function smart_read(disk, refresh) {
	let cache = SMART_DIR + '/smart-' + disk + '.json';
	let st = stat(cache);
	if (!refresh && st && time() - st.mtime < SMART_MAX_AGE) {
		let c = null;
		try { c = json(readfile(cache)); } catch (e) { }
		if (c) return c;
	}
	if (!refresh && !st)
		return null;
	// -n standby: do not wake a sleeping disk just for SMART
	let r = sh('smartctl -j -n standby -H -A -i /dev/' + disk);
	let j = null;
	try { j = json(r.out); } catch (e) { }
	if (!j)
		return { error: 'no SMART data' };
	if (j.smartctl?.exit_status == 2 && match(r.out, /standby|STANDBY|sleep/))
		return { standby: true };
	let attr = {};
	for (let a in j.ata_smart_attributes?.table ?? [])
		attr[a.id] = a.raw?.value;
	let res = {
		time: time(),
		passed: j.smart_status?.passed,
		temperature: j.temperature?.current,
		power_on_hours: j.power_on_time?.hours,
		power_cycles: j.power_cycle_count,
		reallocated: attr[5],
		pending: attr[197],
		uncorrectable: attr[198],
		model: j.model_name,
		serial: j.serial_number,
		firmware: j.firmware_version,
		rpm: j.rotation_rate
	};
	system('mkdir -p ' + SMART_DIR);
	writefile(cache, sprintf('%J', res));
	return res;
}

function mdstat() {
	let arrays = {};
	let cur = null;
	for (let line in split(readfile('/proc/mdstat') ?? '', '\n')) {
		let m = match(line, /^(md[0-9]+) : (\S+) (\S+) (.*)$/);
		if (m) {
			cur = { name: m[1], state: m[2], level: m[3], members: map(split(trim(m[4]), ' '), (x) => replace(x, /\[[0-9]+\](\(.\))?/, '')) };
			arrays[m[1]] = cur;
			continue;
		}
		if (!cur) continue;
		let h = match(line, /\[([0-9]+)\/([0-9]+)\] \[([U_]+)\]/);
		if (h) { cur.disks = +h[1]; cur.active = +h[2]; cur.health = h[3]; }
		let p = match(line, /(resync|recovery|check|reshape) *= *([0-9.]+)%.*finish=([0-9.]+min)/);
		if (p) { cur.sync = { action: p[1], percent: +p[2], finish: p[3] }; }
		let d = match(line, /(resync|recovery)=DELAYED/);
		if (d) cur.sync = { action: d[1], percent: 0, delayed: true };
	}
	return arrays;
}

function storage_job() {
	let j = {};
	for (let line in split(readfile(SMART_DIR + '/job') ?? '', '\n')) {
		let m = match(line, /^([a-z]+)=(.*)$/);
		if (m) j[m[1]] = m[2];
	}
	if (j.state == 'running' && !stat(SMART_DIR + '/lock')) {
		j.state = 'error';
		j.error = j.error ?? 'job ended unexpectedly';
	}
	return length(j) ? j : null;
}

function volumes() {
	let list = [];
	let c = cursor();
	let mounts = readfile('/proc/mounts') ?? '';
	c.foreach('storage', 'volume', function(s) {
		let name = s['.name'];
		let dev = s.uuid ? trim(sh('blkid -o device -t UUID=' + shq(s.uuid) + ' /dev/sd[a-z]* /dev/md[0-9]* /dev/loop[0-9]* 2>/dev/null | head -1').out) : null;
		let mp = '/mnt/' + name;
		let mounted = index(mounts, ' ' + mp + ' ') >= 0;
		let v = { name, uuid: s.uuid, fstype: s.fstype, layout: s.layout, enabled: s.enabled != '0',
			device: dev && length(dev) ? dev : null, mountpoint: mp, mounted };
		if (mounted) {
			let f = split(trim(split(sh('df -k ' + shq(mp)).out, '\n')[1] ?? ''), /\s+/);
			if (length(f) >= 4) { v.size = +f[1] * 1024; v.used = +f[2] * 1024; v.avail = +f[3] * 1024; }
		}
		push(list, v);
	});
	return list;
}

function spawn_storage(args) {
	system(sprintf('start-stop-daemon -S -b -x %s -- %s', STORAGE, join(' ', map(args, shq))));
	return { started: true };
}

/* ---------- web interface: language, logo, HTTPS ---------- */

const CERT = '/usr/sbin/shareos-cert';

const THEMES = { dark: 1, light: 1, system: 1 };
const ACCENTS = { blue: 1, green: 1, red: 1, white: 1 };

// areas that can be switched off under System -> Appearance (tab hidden,
// background work stopped): apps (apps web server, app tasks), cloud
// (scheduled jobs), paperless (inboxes)
const AREAS = [ 'apps', 'cloud', 'paperless' ];
function area_on(a) { return cursor().get('shareos', 'ui', 'area_' + a) != '0'; }

function ui_settings() {
	let c = cursor();
	let theme = c.get('shareos', 'ui', 'theme'), accent = c.get('shareos', 'ui', 'accent');
	let areas = {};
	for (let a in AREAS) areas[a] = c.get('shareos', 'ui', 'area_' + a) != '0';
	return {
		lang: c.get('shareos', 'ui', 'lang') ?? 'en',
		logo: (c.get('shareos', 'ui', 'logo') ?? '1') != '0',
		areas,
		theme: THEMES[theme] ? theme : 'dark',
		accent: ACCENTS[accent] ? accent : 'blue'
	};
}

/* ---------- network ---------- */

function ip4_ok(a) {
	let m = match(a ?? '', /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
	if (!m) return false;
	for (let i = 1; i <= 4; i++) if (+m[i] > 255) return false;
	return true;
}

function pow2(n) {
	let v = 1;
	for (let i = 0; i < n; i++) v *= 2;
	return v;
}

function ip4_num(a) {
	let p = split(a, '.');
	return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3];
}

// prefix length of a netmask, null if the mask is not contiguous
function mask_prefix(m) {
	if (!ip4_ok(m)) return null;
	let n = ip4_num(m), bits = 0;
	for (let i = 31; i >= 0; i--) {
		let b = int(n / (pow2(i))) % 2;
		if (b == 1 && bits == 31 - i) bits++;
		else if (b == 1) return null;
	}
	return bits;
}

function net_settings() {
	let c = cursor();
	let dns = c.get('network', 'lan', 'dns') ?? '';
	if (type(dns) == 'array') dns = join(' ', dns);
	return {
		proto: c.get('network', 'lan', 'proto') == 'static' ? 'static' : 'dhcp',
		ipaddr: c.get('network', 'lan', 'ipaddr') ?? '',
		netmask: c.get('network', 'lan', 'netmask') ?? '255.255.255.0',
		gateway: c.get('network', 'lan', 'gateway') ?? '',
		dns: filter(split(trim(dns), /[ ,]+/), (x) => x != '')
	};
}

function net_state() {
	let pending = read_int(NET_ST + '/pending');
	return {
		pending: pending != null ? { until: pending, left: (pending > time() ? pending - time() : 0) } : null,
		result: read_trim(NET_ST + '/result')
	};
}

function cert_info_read() {
	let r = sh(CERT + ' info');
	let i = { san: [] };
	for (let line in split(r.out, '\n')) {
		let m = match(line, /^([a-z]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'san') push(i.san, m[2]);
		else i[m[1]] = m[2];
	}
	i.selfsigned = !!(i.issuer && i.issuer == i.subject);
	return i;
}
function cert_info() {
	let c = cursor(), crt = c.get('shareos', 'web', 'cert') ?? '/etc/ssl/shareos/server.crt';
	return memo('cert', crt + '|' + fstamp(crt), 0, cert_info_read);
}

// both web servers (admin interface and apps) run under shareos-uhttpd,
// which starts them again and reads settings and certificate anew
function restart_uhttpd() {
	system('(sleep 1; killall uhttpd) >/dev/null 2>&1 &');
}

// our self-signed certificate names hostname and IP: renew it after a change
function cert_refresh() {
	if (cursor().get('shareos', 'web', 'https') == '0') return false;
	let r = sh(CERT + ' ensure'); forget('cert');
	if (!match(r.out, /renewed/)) return false;
	restart_uhttpd();
	return true;
}

/* ---------- hardware settings, first run, Alt-F ---------- */

const FAN_PRESETS = {
	quiet:    { off_temp: 40, full_temp: 55, half_temp: 50 },
	balanced: { off_temp: 0,  full_temp: 50, half_temp: 45 },
	cool:     { off_temp: 0,  full_temp: 45, half_temp: 42 }
};

function fan_settings() {
	let c = cursor();
	let preset = c.get('shareos', 'fan', 'preset') ?? 'balanced';
	let v = FAN_PRESETS[preset] ?? {
		off_temp: +(c.get('shareos', 'fan', 'off_temp') ?? 0),
		full_temp: +(c.get('shareos', 'fan', 'full_temp') ?? 50),
		half_temp: +(c.get('shareos', 'fan', 'half_temp') ?? 45)
	};
	return { preset, ...v };
}

function led_settings() {
	let c = cursor();
	return {
		status: c.get('shareos', 'led', 'status') ?? 'heartbeat',
		power: c.get('shareos', 'led', 'power') ?? 'on',
		disks: c.get('shareos', 'led', 'disks') ?? 'off'
	};
}

function timezone() {
	let t = trim(readfile('/etc/timezone') ?? '');
	if (t != '') return t;
	let l = readlink('/etc/localtime');
	return l ? replace(l, /^.*zoneinfo\//, '') : 'UTC';
}

function zones() {
	let list = [];
	for (let line in split(readfile('/usr/share/zoneinfo/zone1970.tab') ?? readfile('/usr/share/zoneinfo/zone.tab') ?? '', '\n')) {
		if (substr(line, 0, 1) == '#') continue;
		let f = split(line, '\t');
		if (length(f) >= 3) push(list, f[2]);
	}
	if (!length(list))
		for (let d in [ 'Africa', 'America', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Pacific' ])
			for (let z in glob('/usr/share/zoneinfo/' + d + '/*'))
				push(list, substr(z, 20));
	push(list, 'UTC');
	return sort(uniq(list));
}

function set_timezone(tz) {
	if (!match(tz ?? '', /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)*$/) || !stat('/usr/share/zoneinfo/' + tz))
		return false;
	let changed = tz != timezone();
	unlink('/etc/localtime');
	symlink('/usr/share/zoneinfo/' + tz, '/etc/localtime');
	writefile('/etc/timezone', tz + '\n');
	// running programs read the zone once: restart the ones that print times
	if (changed)
		system('(sleep 1; for s in /etc/init.d/S01syslogd /etc/init.d/S50crond; do [ -x $s ] && $s restart; done) >/dev/null 2>&1 &');
	return true;
}

/* ---------- time: NTP, manual clock ---------- */

const NTP_DEFAULT = [ '0.pool.ntp.org', '1.pool.ntp.org', '2.pool.ntp.org' ];
const RTC_TOOL = '/usr/sbin/dns320l-daemon';

// which box this is: S05board writes /tmp/sys/board.env (/usr/lib/shareos/board.sh)
function board_read() {
	let b = {};
	for (let line in split(readfile('/tmp/sys/board.env') ?? '', '\n')) {
		let m = match(line, /^BOARD_([A-Z0-9_]+)="(.*)"$/);
		if (m) b[lc(m[1])] = m[2];
	}
	return b;
}
function board() { return memo('board', fstamp('/tmp/sys/board.env'), 0, board_read); }
// the RTC: the MCU's battery clock (dns320l-daemon) or the kernel's /dev/rtc0
function rtc_kind() {
	let k = board().rtc ?? (stat(RTC_TOOL) ? 'mcu' : 'kernel');
	if (k == 'mcu') return stat(RTC_TOOL) ? 'mcu' : null;
	return stat('/dev/rtc0') ? 'kernel' : null;
}

function ntp_servers(c) {
	let l = c.get('shareos', 'time', 'server');
	if (type(l) == 'string') l = [ l ];
	return type(l) == 'array' && length(l) ? l : NTP_DEFAULT;
}

function time_info() {
	let c = cursor();
	let last = split(read_trim('/tmp/shareos-ntp/last') ?? '', ' ');
	return {
		now: time(),
		timezone: timezone(),
		ntp: c.get('shareos', 'time', 'ntp') != '0',
		servers: ntp_servers(c),
		last_sync: last[0] && match(last[0], /^[0-9]+$/) ? +last[0] : null,
		ntp_running: system('pidof ntpd >/dev/null 2>&1') == 0,
		rtc: !!rtc_kind()
	};
}

// clock -> the MCU's battery clock, so the time survives a power cut
function rtc_save() {
	let k = rtc_kind();
	if (k == 'mcu') system(RTC_TOOL + ' -x systohc >/dev/null 2>&1');
	else if (k == 'kernel') system('hwclock -w -u >/dev/null 2>&1');
}

function altf_scan() {
	let r = sh('/usr/sbin/shareos-altf scan');
	let a = { users: [], shares: [], nfs: [] };
	for (let line in split(r.out, '\n')) {
		let m = match(line, /^([a-z_]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'user') push(a.users, m[2]);
		else if (m[1] == 'share') push(a.shares, m[2]);
		else if (m[1] == 'nfs') push(a.nfs, m[2]);
		else a[m[1]] = m[2];
	}
	a.found = a.found == '1';
	return a;
}

function set_password(pw) {
	if (length(pw ?? '') < 6) return 'password too short (min. 6)';
	if (match(pw, /[\n\r:]/)) return 'password contains invalid characters';
	let p = popen('chpasswd -c sha512 >/dev/null 2>&1', 'w');
	if (!p) return 'chpasswd not available';
	p.write('root:' + pw + '\n');
	return p.close() == 0 ? null : 'chpasswd failed';
}

function set_hostname(h) {
	if (!match(h ?? '', /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
	writefile('/etc/hostname', h + '\n');
	sh('hostname ' + shq(h));
	return true;
}


/* ---------- accounts, shares, the logged-in user ---------- */

const USERS = '/usr/sbin/shareos-users';
const SHARES = '/usr/sbin/shareos-shares';
const QUOTA = '/usr/sbin/shareos-quota';
const SESS_DIR = '/tmp/shareos-sessions';
const ACC_RE = /^[a-z][a-z0-9_]{0,31}$/;

function acc_name_ok(n) { return type(n) == 'string' && match(n, ACC_RE); }

// run a tool with the password on stdin (never on the command line)
function sh_pass(cmd, pass) {
	return sh(sprintf("printf '%%s\\n' %s | %s", shq(pass ?? ''), cmd));
}
function tool_result(r) {
	if (r.rc == 0) return { ok: true, output: trim(r.out) };
	let m = match(r.out, /error: ([^\n]*)/);
	return { error: m ? m[1] : (trim(r.out) || 'failed') };
}

function opt_args(a) {
	let o = [];
	if (a.fullname != null) push(o, '--fullname=' + a.fullname);
	if (a.groups != null) push(o, '--groups=' + join(',', a.groups));
	if (a.home != null) push(o, '--home=' + a.home);
	if (a.quota != null) push(o, '--quota=' + int(+a.quota));
	if (a.web != null) push(o, '--web=' + (a.web ? '1' : '0'));
	if (a.role != null) push(o, '--role=' + a.role);
	if (a.cloud != null) push(o, '--cloud=' + (a.cloud ? '1' : '0'));
	if (a.files != null) push(o, '--files=' + (a.files ? '1' : '0'));
	return join(' ', map(o, shq));
}

function quota_read() {
	let u = {};
	for (let line in split(sh(QUOTA + ' report').out, '\n')) {
		let m = match(line, /^user=([^:]+):([^:]+):([0-9]+):([0-9]+)$/);
		if (!m) continue;
		u[m[1]] ??= [];
		push(u[m[1]], { volume: m[2], used: +m[3] * 1024, limit: +m[4] * 1024 });
	}
	return u;
}
function quota_usage() {   // user -> [{volume, used, limit}] in bytes
	// a new limit shows at once (accounts file), used space within 30 s
	return memo('quota', fstamp('/etc/config/accounts', '/etc/config/storage'), 30, quota_read);
}

function list_of(v) { return v == null ? [] : (type(v) == 'array' ? v : split(v, ' ')); }

function accounts() {
	let c = cursor(), users = [], groups = [];
	let usage = quota_usage();
	c.foreach('accounts', 'user', (x) => {
		push(users, {
			name: x['.name'], role: x.role ?? 'share', fullname: x.fullname ?? '', uid: +(x.uid ?? 0),
			groups: list_of(x.groups), home: x.home ?? '', quota: +(x.quota ?? 0), web: (x.web ?? '1') != '0', cloud: x.cloud == '1', files: x.files == '1',
			usage: usage[x['.name']] ?? []
		});
	});
	c.foreach('accounts', 'group', (x) => {
		push(groups, { name: x['.name'], desc: x.desc ?? '',
			members: map(filter(users, (u) => index(u.groups, x['.name']) >= 0), (u) => u.name) });
	});
	return { users: sort(users, (a, b) => a.name < b.name ? -1 : 1), groups: sort(groups, (a, b) => a.name < b.name ? -1 : 1) };
}

function share_list() {
	let c = cursor(), list = [];
	let st = {}, svc = sh(SHARES + ' status').out;
	for (let line in split(svc, '\n')) {
		let m = match(line, /^share=([^:]*):([^:]*):([01])$/);
		if (m) st[m[1]] = { path: m[2], mounted: m[3] == '1' };
	}
	c.foreach('shares', 'share', (x) => {
		let n = x['.name'];
		push(list, {
			name: n, volume: x.volume ?? '', path: x.path ?? n, comment: x.comment ?? '',
			smb: x.smb == '1', nfs: x.nfs == '1', guest: x.guest == '1',
			rw: list_of(x.rw), ro: list_of(x.ro), nfs_rw: x.nfs_rw == '1', nfs_hosts: list_of(x.nfs_hosts),
			fullpath: st[n]?.path ?? null, mounted: st[n]?.mounted ?? false
		});
	});
	return {
		shares: sort(list, (a, b) => a.name < b.name ? -1 : 1),
		workgroup: c.get('shares', 'global', 'workgroup') ?? 'WORKGROUP',
		smb_enabled: (c.get('shares', 'global', 'smb') ?? '1') != '0',
		nfs_enabled: (c.get('shares', 'global', 'nfs') ?? '1') != '0',
		smb_running: !!match(svc, /smb=1/), nfs_running: !!match(svc, /nfs=1/)
	};
}

// which account belongs to a web session: set by "bind" right after login
function session_user(req) {
	let sid = req.args?.ubus_rpc_session;
	if (type(sid) != 'string' || !match(sid, /^[0-9a-f]{32}$/)) return null;
	let u = read_trim(SESS_DIR + '/' + sid);
	return u && (u == 'root' || acc_name_ok(u)) ? u : null;
}

// check a password against /etc/shadow (crypt via busybox mkpasswd)
function password_ok(user, pass) {
	let line = filter(split(readfile('/etc/shadow') ?? '', '\n'), (l) => index(l, user + ':') == 0)[0];
	let hash = line ? split(line, ':')[1] : null;
	if (!hash || length(hash) < 13 || substr(hash, 0, 1) == '!' || substr(hash, 0, 1) == '*') return false;
	let m = match(hash, /^\$([156])\$([^$]+)\$/);
	let method = m ? { '1': 'md5', '5': 'sha256', '6': 'sha512' }[m[1]] : 'des';
	let salt = m ? m[2] : substr(hash, 0, 2);
	let r = sh(sprintf("printf '%%s' %s | mkpasswd -P 0 -m %s -S %s", shq(pass), method, shq(salt)));
	return trim(r.out) == hash;
}

// root still has the factory password "shareos" (public in the docs; the login
// page shows it then – anyone could simply try it). Checked again only when
// root's hash changes (the hash itself is the stamp: two changes within one
// second leave size and time of /etc/shadow alike).
function default_password() {
	let line = filter(split(readfile('/etc/shadow') ?? '', '\n'), (l) => index(l, 'root:') == 0)[0] ?? '';
	return memo('default_password', split(line, ':')[1] ?? '', 0, () => password_ok('root', 'shareos'));
}


/* ---------- settings backup ---------- */

const CRYPT = '/usr/sbin/shareos-crypt';
const BACKUP_CONFIGS = [ 'shareos', 'storage', 'network', 'accounts', 'shares', 'paperless', 'cloud', 'apps', 'snapshots', 'dlna' ];
const BACKUP_FILES = [ '/etc/ksmbd/ksmbdpwd.db', '/etc/ssl/shareos/server.crt', '/etc/ssl/shareos/server.key', '/etc/hostname', '/etc/timezone' ];

function lines_of(path) { return filter(split(readfile(path) ?? '', '\n'), (l) => l != ''); }
function field(l, i) { return split(l, ':')[i]; }

// run shareos-crypt: the password is the first line of its input
function crypt(mode, pass, data) {
	let tin = '/tmp/.sos-crypt-in', tout = '/tmp/.sos-crypt-out';
	system('umask 077; : > ' + tin);
	writefile(tin, pass + '\n' + data);
	let r = sh(sprintf('%s %s < %s > %s', CRYPT, mode, tin, tout));
	let out = readfile(tout);
	unlink(tin); unlink(tout);
	return r.rc == 0 ? { data: out } : { error: r.rc == 2 ? 'wrong password or damaged file' : 'encryption failed' };
}

function backup_build() {
	let b = { shareos_backup: 1, version: release().version, host: read_trim('/proc/sys/kernel/hostname'),
		created: time(), configs: {}, files: {}, accounts: {} };
	for (let c in BACKUP_CONFIGS) {
		let t = readfile('/etc/config/' + c);
		if (t != null) b.configs[c] = t;
	}
	for (let f in BACKUP_FILES) {
		let t = readfile(f);
		if (t != null) b.files[f] = t;
	}
	let tz = readlink('/etc/localtime');
	if (tz) b.files['/etc/localtime'] = { link: tz };
	// accounts: uid/gid >= 1000 plus the root password
	b.accounts.passwd = filter(lines_of('/etc/passwd'), (l) => +field(l, 2) >= 1000 && +field(l, 2) < 65534);
	let names = map(b.accounts.passwd, (l) => field(l, 0));
	b.accounts.shadow = filter(lines_of('/etc/shadow'), (l) => field(l, 0) == 'root' || index(names, field(l, 0)) >= 0);
	b.accounts.group = filter(lines_of('/etc/group'), (l) => +field(l, 2) >= 1000 && +field(l, 2) < 65534);
	return b;
}

function backup_summary(b) {
	let users = map(b.accounts?.passwd ?? [], (l) => field(l, 0));
	let shares = [];
	for (let l in split(b.configs?.shares ?? '', '\n')) {
		let m = match(l, /^config share '([^']+)'/);
		if (m) push(shares, m[1]);
	}
	return { version: b.version, host: b.host, created: b.created, users, shares,
		configs: keys(b.configs ?? {}), certificate: !!b.files?.['/etc/ssl/shareos/server.key'] };
}

function backup_restore(b) {
	let ACC = /^[a-z][a-z0-9_]{0,31}$/;
	for (let c in keys(b.configs ?? {})) {
		if (index(BACKUP_CONFIGS, c) < 0 || type(b.configs[c]) != 'string') continue;
		writefile('/etc/config/' + c, b.configs[c]);
	}
	for (let f in keys(b.files ?? {})) {
		let v = b.files[f];
		if (f == '/etc/localtime') {
			if (type(v) == 'object' && match(v.link ?? '', /^\/usr\/share\/zoneinfo\/[A-Za-z0-9_+\/-]+$/) && stat(v.link)) {
				unlink('/etc/localtime'); symlink(v.link, '/etc/localtime');
			}
			continue;
		}
		if (index(BACKUP_FILES, f) < 0 || type(v) != 'string') continue;
		system('mkdir -p ' + shq(replace(f, /\/[^\/]+$/, '')));
		writefile(f, v);
		if (match(f, /\.key$|ksmbdpwd/)) system('chmod 600 ' + shq(f));
	}
	if (b.files?.['/etc/hostname']) system('hostname ' + shq(trim(b.files['/etc/hostname'])));
	// accounts: replace everything with uid/gid >= 1000, keep system accounts
	let good = (l, n) => length(split(l, ':')) == n && match(field(l, 0), ACC);
	let pw = filter(b.accounts?.passwd ?? [], (l) => good(l, 7) && +field(l, 2) >= 1000);
	let names = map(pw, (l) => field(l, 0));
	let sh_new = filter(b.accounts?.shadow ?? [], (l) => length(split(l, ':')) >= 2 && (field(l, 0) == 'root' || index(names, field(l, 0)) >= 0));
	let grp = filter(b.accounts?.group ?? [], (l) => good(l, 4) && +field(l, 2) >= 1000);
	let keep = (path, test) => filter(lines_of(path), test);
	let passwd = [ ...keep('/etc/passwd', (l) => !(+field(l, 2) >= 1000 && +field(l, 2) < 65534)), ...pw ];
	let rootsh = filter(sh_new, (l) => field(l, 0) == 'root')[0];
	// system accounts keep their shadow line (root gets the backed-up password),
	// accounts from the backup bring theirs; all others are gone
	let sysnames = map(passwd, (l) => field(l, 0));
	let shadow = [ ...map(filter(lines_of('/etc/shadow'), (l) => index(sysnames, field(l, 0)) >= 0 && index(names, field(l, 0)) < 0),
			(l) => field(l, 0) == 'root' && rootsh ? rootsh : l),
		...filter(sh_new, (l) => field(l, 0) != 'root') ];
	let group = [ ...keep('/etc/group', (l) => !(+field(l, 2) >= 1000 && +field(l, 2) < 65534)), ...grp ];
	writefile('/etc/passwd', join('\n', passwd) + '\n');
	writefile('/etc/shadow', join('\n', shadow) + '\n');
	system('chmod 600 /etc/shadow');
	writefile('/etc/group', join('\n', group) + '\n');
	system(USERS + ' sync >/dev/null 2>&1');
	return { ok: true, reboot: true };
}

/* ---------- Paperless ---------- */

const PAPERLESS = '/usr/sbin/shareos-paperless';
const CRON = '/usr/sbin/shareos-cron';

function token_hint(t) { return t ? '••••' + substr(t, -4) : ''; }

function inbox_path(c, name) {
	let p = c.get('paperless', name, 'path');
	if (p) return p;
	let sh = c.get('paperless', name, 'share');
	if (sh && c.get('shares', sh) == 'share')
		return '/mnt/' + c.get('shares', sh, 'volume') + '/' + (c.get('shares', sh, 'path') ?? sh);
	let o = c.get('paperless', name, 'owner'), v = o ? c.get('accounts', o, 'home') : null;
	return v ? '/mnt/' + v + '/home/' + o + '/Paperless' : null;
}

function paperless_log(path, n) {
	let out = [];
	if (!path) return out;
	let lines = filter(split(readfile(path + '/.paperless/log') ?? '', '\n'), (l) => l != '');
	for (let l in slice(lines, -(n ?? 20))) {
		let f = split(l, '\t');
		push(out, { time: +f[0], file: f[1], task: f[2], state: f[3], message: f[4] ?? '' });
	}
	return reverse(out);
}

function waiting_files(path) {
	if (!path) return 0;
	let n = 0;
	for (let f in glob(path + '/*') ?? [])
		if (match(f, /\.(pdf|png|jpe?g|tiff?|webp|gif|txt|eml|docx?|odt|xlsx?|ods|pptx|odp)$/i)) n++;
	return n;
}

function inbox_info(c, name) {
	let path = inbox_path(c, name), tok = c.get('paperless', name, 'token');
	return { name, owner: c.get('paperless', name, 'owner') ?? '', share: c.get('paperless', name, 'share') ?? '',
		path, token_set: !!tok, token_hint: token_hint(tok), tags: list_of(c.get('paperless', name, 'tags')),
		enabled: c.get('paperless', name, 'enabled') != '0', waiting: waiting_files(path), recent: paperless_log(path, 10) };
}

function paperless_global(c) {
	return { url: c.get('paperless', 'global', 'url') ?? '', enabled: c.get('paperless', 'global', 'enabled') != '0',
		interval: +(c.get('paperless', 'global', 'interval') ?? 2), after: c.get('paperless', 'global', 'after') ?? 'delete',
		last: read_int('/tmp/shareos-paperless.last') };
}

function inbox_save(c, name, a) {
	c.set('paperless', name, 'inbox');
	if (a.owner != null) c.set('paperless', name, 'owner', a.owner);
	if (a.share != null) c.set('paperless', name, 'share', a.share);
	if (a.token) c.set('paperless', name, 'token', a.token);
	if (a.tags != null) {
		c.delete('paperless', name, 'tags');
		let t = filter(a.tags, (x) => match('' + x, /^[0-9]+$/));
		if (length(t)) c.set('paperless', name, 'tags', map(t, (x) => '' + x));
	}
	if (a.enabled != null) c.set('paperless', name, 'enabled', a.enabled ? '1' : '0');
	c.commit('paperless');
	sh(PAPERLESS + ' folders; ' + CRON + ' sync');
}

function token_ok(t) { return type(t) == 'string' && match(t, /^[A-Za-z0-9]{20,128}$/); }

/* ---------- cloud (rclone) ---------- */

const CLOUD = '/usr/sbin/shareos-cloud';
const CLOUD_ST = '/tmp/shareos-cloud';
const REMOTE_KEYS = {
	webdav: { plain: [ 'url', 'vendor', 'user' ], secret: [ 'pass' ] },
	s3: { plain: [ 'provider', 'endpoint', 'region', 'access_key_id' ], secret: [ 'secret_access_key' ] },
	sftp: { plain: [ 'host', 'port', 'user' ], secret: [ 'pass' ] },
	ftp: { plain: [ 'host', 'port', 'user' ], secret: [ 'pass' ] },
	smb: { plain: [ 'host', 'user', 'domain' ], secret: [ 'pass' ] },
	mega: { plain: [ 'user' ], secret: [ 'pass' ] },
	b2: { plain: [ 'account' ], secret: [ 'key' ] },
	koofr: { plain: [ 'provider', 'user' ], secret: [ 'password' ] },
	// signed in with OAuth first (shareos-cloud auth-start/auth-finish)
	gdrive: { plain: [], secret: [] }, gphotos: { plain: [], secret: [] }, onedrive: { plain: [], secret: [] },
	dropbox: { plain: [], secret: [] }, box: { plain: [], secret: [] }, pcloud: { plain: [], secret: [] }, yandex: { plain: [], secret: [] }
};
const OAUTH_TYPES = { gdrive: 1, gphotos: 1, onedrive: 1, dropbox: 1, box: 1, pcloud: 1, yandex: 1 };

function cloud_auth_start(owner, type) {
	if (!OAUTH_TYPES[type]) return { error: 'no sign-in for this type' };
	let r = tool_result(sh(sprintf('%s auth-start %s %s', CLOUD, shq(owner == '' ? '-' : owner), shq(type))));
	if (r.error) return r;
	let m = match(r.output, /url=(https?:\/\/[^ \t\n]+)/);
	return m ? { url: m[1] } : { error: 'no sign-in address' };
}
function cloud_auth_finish(owner, url) {
	if (type(url) != 'string' || length(url) > 4096) return { error: 'invalid address' };
	return tool_result(sh(sprintf('%s auth-finish %s %s', CLOUD, shq(owner == '' ? '-' : owner), shq(url))));
}
const CLOUD_MODES = { upload: 1, download: 1, mirror_up: 1, mirror_down: 1 };

function kv_file(path) {
	let o = {};
	for (let l in split(readfile(path) ?? '', '\n')) {
		let m = match(l, /^([a-z_]+)=(.*)$/);
		if (m) o[m[1]] = m[2];
	}
	return o;
}

function cloud_status() {
	let st = {};
	for (let l in split(sh(CLOUD + ' status').out, '\n')) {
		let m = match(l, /^([a-z_]+)=(.*)$/);
		if (m) st[m[1]] = m[2];
	}
	return { installed: !!st.rclone, version: st.version ?? null, apps: st.apps || null,
		installing: st.install_state == 'installing', install_error: st.install_state == 'error' ? st.install_error : null };
}

function cloud_remotes(owner) {
	let list = [];
	for (let l in split(sh(CLOUD + ' remotes ' + shq(owner ?? '-')).out, '\n')) {
		let m = match(l, /^([^:]+):(.+)$/);
		if (m) push(list, { name: m[1], type: m[2] });
	}
	return list;
}

function cloud_jobs(c, owner) {   // owner null = all
	let list = [];
	c.foreach('cloud', 'job', (x) => {
		let o = x.owner ?? '';
		if (owner != null && o != owner) return;
		let n = x['.name'];
		let st = kv_file(CLOUD_ST + '/' + n + '.state');
		if (!st.state) {
			let a = c.get('storage', 'global', 'apps');
			if (a) st = kv_file('/mnt/' + a + '/.shareos/cloud/logs/' + n + '.state');
		}
		push(list, { name: n, owner: o, remote: x.remote ?? '', remote_path: x.remote_path ?? '', local: x.local ?? '',
			mode: x.mode ?? 'upload', schedule: x.schedule ?? '', bwlimit: x.bwlimit ?? '', enabled: x.enabled != '0',
			state: st.state ?? null, started: +(st.started ?? 0), ended: +(st.ended ?? 0), summary: st.summary ?? '', error: st.error ?? '' });
	});
	return sort(list, (a, b) => a.name < b.name ? -1 : 1);
}

// may this owner use this local folder? ('home', 'home:<sub>' or 'share:<name>')
function cloud_local_ok(c, owner, local, mode) {
	if (local == 'home' || match(local ?? '', /^home:[A-Za-z0-9 ._\/-]+$/))
		return owner != '' && !!c.get('accounts', owner, 'home') && !match(local, /\.\./);
	let m = match(local ?? '', /^share:([a-z0-9][a-z0-9_-]{0,15})$/);
	if (!m || c.get('shares', m[1]) != 'share') return false;
	if (owner == '') return true;
	let tags = [ owner, ...map(list_of(c.get('accounts', owner, 'groups')), (g) => '@' + g) ];
	let rw = list_of(c.get('shares', m[1], 'rw')), ro = list_of(c.get('shares', m[1], 'ro'));
	let can_w = length(filter(tags, (t) => index(rw, t) >= 0)) > 0;
	let can_r = can_w || length(filter(tags, (t) => index(ro, t) >= 0)) > 0;
	return (mode == 'download' || mode == 'mirror_down') ? can_w : can_r;
}

function cloud_job_save(c, owner, a) {
	if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name (a-z, 0-9 and _)' };
	let existing = c.get('cloud', a.name);
	if (existing && existing != 'job') return { error: 'invalid name' };
	if (existing && (c.get('cloud', a.name, 'owner') ?? '') != owner) return { error: 'this name is taken' };
	if (!CLOUD_MODES[a.mode]) return { error: 'invalid mode' };
	if (index(map(cloud_remotes(owner == '' ? '-' : owner), (r) => r.name), a.remote) < 0) return { error: 'unknown connection' };
	if (match(a.remote_path ?? '', /[\n\r]|\.\./)) return { error: 'invalid remote folder' };
	if (!cloud_local_ok(c, owner, a.local, a.mode)) return { error: 'this folder is not allowed for this job' };
	if (a.schedule && !match(a.schedule, /^[0-9*\/,-]+( [0-9*\/,-]+){4}$/)) return { error: 'invalid schedule' };
	if (a.bwlimit && !match(a.bwlimit, /^[0-9]+(\.[0-9]+)?[KMG]?$/)) return { error: 'invalid bandwidth limit (e.g. 2M)' };
	c.set('cloud', a.name, 'job');
	c.set('cloud', a.name, 'owner', owner);
	for (let k in [ 'remote', 'remote_path', 'local', 'mode', 'schedule', 'bwlimit' ]) c.set('cloud', a.name, k, a[k] ?? '');
	c.set('cloud', a.name, 'enabled', a.enabled === false ? '0' : '1');
	c.commit('cloud');
	sh(CRON + ' sync');
	return { ok: true };
}

function cloud_remote_add(owner, a) {
	let o = owner == '' ? '-' : owner;
	if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name (a-z, 0-9 and _)' };
	if (a.type == 'raw') {
		if (!match(a.raw ?? '', /^\[[A-Za-z0-9_-]+\]\n/)) return { error: 'paste an rclone.conf section starting with [name]' };
		return tool_result(sh(sprintf("printf '%%s\\n' %s | %s remote-add %s %s raw", shq(a.raw), CLOUD, shq(o), shq(a.name))));
	}
	let keys = REMOTE_KEYS[a.type];
	if (!keys) return { error: 'unknown type' };
	let args = [], secrets = [];
	for (let k in keys.plain) if (a.params?.[k]) {
		if (match('' + a.params[k], /[\n\r]/)) return { error: 'invalid ' + k };
		push(args, shq(k + '=' + a.params[k]));
	}
	for (let k in keys.secret) if (a.params?.[k]) {
		if (match('' + a.params[k], /[\n\r]/)) return { error: 'invalid ' + k };
		push(secrets, k + '=' + a.params[k]);
	}
	return tool_result(sh(sprintf("printf '%%s\\n' %s | %s remote-add %s %s %s %s", shq(join('\n', secrets)), CLOUD, shq(o), shq(a.name), a.type, join(' ', args))));
}

function cloud_log(c, name, n) {
	let a = c.get('storage', 'global', 'apps');
	if (!a) return [];
	let lines = filter(split(readfile('/mnt/' + a + '/.shareos/cloud/logs/' + name + '.log') ?? '', '\n'), (l) => l != '');
	return slice(lines, -(n ?? 60));
}

function me_cloud_allowed(u) { return u != 'root' && cursor().get('accounts', u, 'cloud') == '1' && !!cursor().get('accounts', u, 'home'); }

/* ---------- media server (MiniDLNA, shareos-dlna) ---------- */

const DLNA = '/usr/sbin/shareos-dlna';
const DLNA_TYPES = { A: 1, V: 1, P: 1, '-': 1 };

function dlna_status() {
	let st = {}, clients = [];
	for (let l in split(sh(DLNA + ' status').out, '\n')) {
		let m = match(l, /^([a-z]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'client') { let f = split(m[2], '|'); push(clients, { type: f[0], ip: f[1] }); }
		else st[m[1]] = m[2];
	}
	let c = cursor(), media = [];
	for (let x in list_of(c.get('dlna', 'main', 'media'))) {
		let m = match(x, /^([AVP-]),share:([a-z0-9_-]+)$/);
		if (m) push(media, { type: m[1], share: m[2] });
	}
	return { installed: st.installed == '1', enabled: st.enabled == '1', running: st.running == '1', scanning: st.scanning == '1',
		audio: +(st.audio || 0), video: +(st.video || 0), image: +(st.image || 0), db: st.db ?? null, clients,
		name: c.get('dlna', 'main', 'name') ?? '', hostname: trim(readfile('/proc/sys/kernel/hostname') ?? ''), media,
		shares: map(filter(share_list().shares, (x) => x.volume), (x) => x.name) };
}

/* ---------- snapshots (rsync with hard links, shareos-snapshot) ---------- */

const SNAP = '/usr/sbin/shareos-snapshot';
const SNAP_ST = '/tmp/shareos-snapshots';
const SNAP_JOB_RE = /^[a-z][a-z0-9_]{0,31}$/;
const SNAP_KEEP = [ 'keep_last', 'keep_daily', 'keep_weekly', 'keep_monthly' ];

function snap_tool(args) {
	let r = sh(SNAP + ' ' + join(' ', map(args, shq)));
	let j = json(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

function snap_running(job) {
	let p = +trim(readfile(SNAP_ST + '/' + job + '.pid') ?? '0');
	return p > 1 && index(readfile('/proc/' + p + '/cmdline') ?? '', 'shareos-snapshot') >= 0;
}

function snap_jobs() {
	let list = [];
	cursor().foreach('snapshots', 'job', (x) => {
		let n = x['.name'];
		let st = json(readfile(SNAP_ST + '/' + n + '.state') ?? readfile('/mnt/' + (x.target ?? '-') + '/Snapshots/' + n + '/.state.json') ?? 'null');
		let l = snap_tool([ 'list', n ]);
		let job = { name: n, source: x.source ?? '', target: x.target ?? '', every: x.every ?? 'day', time: x.time ?? '03:15',
			exclude: type(x.exclude) == 'array' ? x.exclude : (x.exclude ? [ x.exclude ] : []), enabled: x.enabled != '0',
			running: snap_running(n), last: type(st) == 'object' ? st : null, snapshots: l.snapshots ?? [], path: l.path ?? null,
			mounted: l.mounted ?? false };
		for (let k in SNAP_KEEP) job[k] = +(x[k] ?? 0);
		if (job.last?.state == 'running' && !job.running) job.last.state = 'error';
		push(list, job);
	});
	return sort(list, (a, b) => a.name < b.name ? -1 : 1);
}

function snap_save(a) {
	if (!match(a.name ?? '', SNAP_JOB_RE)) return { error: 'invalid name' };
	let c = cursor(), exists = c.get('snapshots', a.name) == 'job';
	if (a.new && exists) return { error: 'name already in use' };
	if (!a.new && !exists) return { error: 'unknown job' };
	if (c.get('snapshots', a.name) && !exists) return { error: 'name already in use' };
	let src = snap_tool([ 'sources' ]);
	if (!filter(src.sources ?? [], (x) => x.id == a.source)[0]) return { error: 'unknown source' };
	let vol = filter(src.volumes ?? [], (x) => x.name == a.target)[0];
	if (!vol) return { error: 'unknown target drive' };
	if (!vol.links) return { error: 'the target drive (' + vol.fstype + ') has no hard links – use ext4 or Btrfs' };
	if (!(a.every in { hour: 1, '6h': 1, day: 1, week: 1 })) return { error: 'invalid interval' };
	if (!match(a.time ?? '', /^([01][0-9]|2[0-3]):[0-5][0-9]$/)) return { error: 'invalid time' };
	let keep = {}, total = 0;
	for (let k in SNAP_KEEP) {
		let v = int(+(a[k] ?? 0));
		if (!(v >= 0 && v <= 999)) return { error: 'invalid number to keep' };
		keep[k] = v; total += v;
	}
	if (total < 1) return { error: 'keep at least one snapshot' };
	let ex = filter(map(type(a.exclude) == 'array' ? a.exclude : [], (e) => trim('' + e)), (e) => e != '');
	if (length(ex) > 30 || length(filter(ex, (e) => length(e) > 200 || match(e, /[\n\r]/))) > 0) return { error: 'invalid exclusions' };
	if (!exists) c.set('snapshots', a.name, 'job');
	c.set('snapshots', a.name, 'source', a.source);
	c.set('snapshots', a.name, 'target', a.target);
	c.set('snapshots', a.name, 'every', a.every);
	c.set('snapshots', a.name, 'time', a.time);
	for (let k in SNAP_KEEP) c.set('snapshots', a.name, k, '' + keep[k]);
	c.delete('snapshots', a.name, 'exclude');
	if (length(ex)) c.set('snapshots', a.name, 'exclude', ex);
	c.set('snapshots', a.name, 'enabled', a.enabled === false ? '0' : '1');
	c.commit('snapshots');
	sh(CRON + ' sync');
	return { ok: true };
}

/* ---------- apps ---------- */

const APPS_TOOL = '/usr/sbin/shareos-apps';
const NOTIFY = '/usr/sbin/shareos-notify';
const NOTIFY_KEYS = [ 'email', 'smtp_host', 'smtp_tls', 'smtp_port', 'smtp_user', 'mail_from', 'mail_to', 'email_level',
	'push', 'push_type', 'push_url', 'push_chat', 'push_level', 'temp_max', 'disk_full' ];

function notify_run(args) {
	let r = sh(NOTIFY + ' ' + join(' ', map(args, shq)));
	let j = null;
	try { j = json(trim(r.out) || 'null'); } catch (e) { }
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}
// the list only when the messages changed; anything else changes them
function notify_json(args) {
	if (args[0] == 'list')
		return memo('notes', fstamp('/etc/shareos/notifications.json'), 60, () => notify_run(args));
	forget('notes');
	return notify_run(args);
}

// settings without the secrets (only whether they are set)
function notify_settings() {
	let n = cursor().get_all('shareos', 'notify') ?? {}, o = {};
	for (let k in NOTIFY_KEYS) o[k] = n[k] ?? '';
	o.email = n.email == '1'; o.push = n.push == '1';
	o.has_pass = !!length(n.smtp_pass ?? ''); o.has_token = !!length(n.push_token ?? '');
	o.temp_max = +(n.temp_max ?? 55); o.disk_full = +(n.disk_full ?? 90);
	return o;
}
const APPS_UPLOAD = '/tmp/shareos-apps/upload.sapp';

function apps_json(args) {
	let r = sh(APPS_TOOL + ' ' + join(' ', map(args, shq)));
	let j = json(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

// the installed apps (shareos-apps list): new when an app, its settings or
// the task states change
function apps_list() {
	let jobs = lsdir('/tmp/shareos-apps/jobs') ?? [];
	return memo('apps', fstamp('/www-apps', '/opt/shareos/sysapps', '/etc/config/apps', '/tmp/shareos-apps/jobs')
		+ '|' + join(',', sort(jobs)) + '|' + join(',', map(sort(jobs), (j) => fstamp('/tmp/shareos-apps/jobs/' + j))), 30,
		() => apps_json([ 'list' ]));
}

// the name under which the box is reached in links to apps: set by hand
// (shareos.web.host) or taken from an installed certificate – so an app opens
// under the name the certificate is valid for, also when this interface was
// opened by its IP address
function cert_host() {
	let i = cert_info();
	if (i.none || i.selfsigned) return null;
	let names = [];
	for (let s in i.san) { let m = match(s, /^dNSName:(.+)$/); if (m) push(names, lc(trim(m[1]))); }
	let cn = match(i.subject ?? '', /CN=([^,\/]+)/);
	if (cn) push(names, lc(trim(cn[1])));
	let h = lc(read_trim('/proc/sys/kernel/hostname') ?? '');
	for (let n in names) if (h && index(n, h + '.') == 0) return n;
	for (let n in names) { let m = match(n, /^\*\.([a-z0-9.-]+)$/); if (m && h) return h + '.' + m[1]; }
	for (let n in names) if (match(n, /^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+$/)) return n;
	return null;
}
function web_host() {
	let h = cursor().get('shareos', 'web', 'host');
	return h ? { host: h, auto: false } : { host: cert_host(), auto: true };
}

function apps_server() {
	let c = cursor(), wh = web_host();
	return { port: +(c.get('apps', 'store', 'port') ?? 8081), https_port: +(c.get('apps', 'store', 'https_port') ?? 8444),
		https: c.get('shareos', 'web', 'https') != '0', host: wh.host, host_auto: wh.auto };
}

// apps a user may see: users list contains '*', the name or one of its '@groups'
function apps_for(u) {
	if (!u) return [];
	let c = cursor(), groups = list_of(c.get('accounts', u, 'groups'));
	let admin = u == 'root' || c.get('accounts', u, 'role') == 'admin';
	// system apps are programs for the terminal, nothing to open in a browser
	return filter(apps_list().apps ?? [], (a) => a.type != 'system' && (admin || index(a.users, '*') >= 0 || index(a.users, u) >= 0
		|| length(filter(groups, (g) => index(a.users, '@' + g) >= 0)) > 0));
}

/* ---------- file browser ---------- */

const FILES_TICKETS = '/tmp/shareos-files';
const APP_TICKETS = '/tmp/shareos-appfiles';     // read by /www-apps/_shareos/cgi/file
const FILES_MAX = 2000;            // entries listed per folder

function acc_role(u) { return u == 'root' ? 'admin' : (cursor().get('accounts', u, 'role') ?? 'share'); }

// admins: every mounted volume; users: their personal folder and the shares
// they have rights to (read only where they may only read), if allowed
function files_allowed(u) {
	if (acc_role(u) == 'admin') return true;
	let c = cursor();
	return acc_role(u) == 'user' && c.get('accounts', u, 'files') == '1' && c.get('accounts', u, 'web') != '0';
}

// groups of an account: supplementary (/etc/group) and primary (/etc/passwd)
function acc_groups(u) {
	let gs = {}, gid = null;
	for (let l in split(readfile('/etc/passwd') ?? '', '\n')) { let f = split(l, ':'); if (f[0] == u) gid = f[3]; }
	for (let l in split(readfile('/etc/group') ?? '', '\n')) {
		let f = split(l, ':');
		if (length(f) < 4) continue;
		if (f[2] == gid || index(split(f[3], ','), u) >= 0) gs[f[0]] = true;
	}
	return gs;
}

// 'rw', 'ro' or null: what an account may do in a share (like ksmbd: write
// list, read list, guest = everyone may read)
function share_access(u, x, gs) {
	let has = (l) => { for (let e in list_of(l)) if (e == u || (substr(e, 0, 1) == '@' && gs[substr(e, 1)])) return true; return false; };
	if (has(x.rw)) return 'rw';
	if (has(x.ro) || x.guest == '1') return 'ro';
	return null;
}

function files_roots(u) {
	let c = cursor(), roots = [];
	if (!u || !files_allowed(u)) return roots;
	let mounts = readfile('/proc/mounts') ?? '';
	if (acc_role(u) == 'admin') {
		c.foreach('storage', 'volume', (x) => {
			let mp = '/mnt/' + x['.name'];
			if (index(mounts, ' ' + mp + ' ') >= 0) push(roots, { name: x['.name'], path: mp, home: false });
		});
		for (let m in usb_mounts()) push(roots, { name: substr(m.path, 5), path: m.path, home: false, usb: true });
	} else {
		let v = c.get('accounts', u, 'home'), p = '/mnt/' + v + '/home/' + u;
		if (v && index(mounts, ' /mnt/' + v + ' ') >= 0 && stat(p)?.type == 'directory') push(roots, { name: 'home', path: p, home: true });
		let gs = acc_groups(u), shares = [];
		c.foreach('shares', 'share', (x) => {
			let n = x['.name'], v = x.volume ?? '', rel = x.path ?? n, acc = share_access(u, x, gs);
			if (!acc || n == 'home' || !match(n, /^[A-Za-z0-9_-]+$/) || !v || substr(rel, 0, 1) == '/' || index(rel, '..') >= 0) return;
			if (match(rel, /^(home|\.shareos)(\/|$)/)) return;    // never other people's folders or the apps area
			if (c.get('storage', v) != 'volume' || index(mounts, ' /mnt/' + v + ' ') < 0) return;
			let sp = '/mnt/' + v + '/' + rel;
			if (stat(sp)?.type == 'directory') push(shares, { name: n, path: sp, home: false, share: true, ro: acc == 'ro' });
		});
		push(roots, ...sort(shares, (a, b) => a.name < b.name ? -1 : 1));
	}
	return roots;
}

function name_ok(n) {
	return type(n) == 'string' && length(n) >= 1 && length(n) <= 255 && n != '.' && n != '..' && !match(n, /[\/[:cntrl:]]/);
}

// root + relative path -> absolute path inside that root (no "..", no
// symlinks pointing outside); want: 'dir' | 'any' | 'parent' (may not exist)
function files_path(u, root, rel, want) {
	let r = filter(files_roots(u), (x) => x.name == root)[0];
	if (!r) return { error: 'unknown folder' };
	if (rel != null && type(rel) != 'string') return { error: 'invalid path' };
	let parts = filter(split(rel ?? '', '/'), (p) => p != '' && p != '.');
	for (let p in parts) if (!name_ok(p)) return { error: 'invalid path' };
	let abs = r.path + (length(parts) ? '/' + join('/', parts) : '');
	let base = realpath(r.path);
	let chk = want == 'parent' ? (length(parts) ? r.path + (length(parts) > 1 ? '/' + join('/', slice(parts, 0, -1)) : '') : null) : abs;
	if (want == 'parent' && !length(parts)) return { error: 'invalid path' };
	let rp = realpath(chk);
	if (!rp || !base || (rp != base && index(rp, base + '/') != 0)) return { error: 'not found' };
	if (want == 'dir' && stat(rp)?.type != 'directory') return { error: 'not a folder' };
	return { root: r, abs, rel: join('/', parts), admin: acc_role(u) == 'admin' };
}

// the same for writing: refused in a share the account may only read
function files_wpath(u, root, rel, want) {
	let p = files_path(u, root, rel, want);
	return !p.error && p.root.ro ? { error: 'read only' } : p;
}

// run a command with the rights of the account (admins: root); in shares the
// files stay readable for the group "users" (like SMB: create mask 0664)
function files_sh(u, cmd, shared) {
	if (acc_role(u) == 'admin') return sh('umask 002; ' + cmd);
	return sh(sprintf('su -s /bin/sh %s -c %s', shq(u), shq((shared ? 'umask 002; ' : 'umask 077; ') + cmd)));
}

function files_err(r) {
	let o = trim(r.out);
	o = replace(o, /^(mkdir|mv|rm|cp): (can't [a-z]+ )?/, '');
	if (match(o, /Permission denied/)) return 'permission denied';
	if (match(o, /File exists/)) return 'already exists';
	if (match(o, /No space left/)) return 'no space left on the drive';
	if (match(o, /Disk quota exceeded/)) return 'storage limit reached';
	return o || 'failed';
}

/* ---------- media jobs (ffmpeg system app, apps with "media") ---------- */

const MEDIA_DIR = '/tmp/shareos-media/jobs';
const FFPROBE = '/opt/shareos/bin/ffprobe';
const MEDIA_REMUX = { mp4: 'mp4', mkv: 'mkv', mov: 'mov', ts: 'ts', webm: 'webm' };
const MEDIA_AUDIO = { mp3: [ 'mp3', 'libmp3lame' ], m4a: [ 'm4a', 'aac' ], opus: [ 'opus', 'libopus' ], flac: [ 'flac', 'flac' ], wav: [ 'wav', 'pcm_s16le' ] };
const MEDIA_COPY_EXT = { aac: 'm4a', alac: 'm4a', mp3: 'mp3', mp2: 'mp2', opus: 'opus', vorbis: 'ogg', flac: 'flac', ac3: 'mka', eac3: 'mka' };
const MEDIA_BITRATES = { '64k': 1, '96k': 1, '128k': 1, '160k': 1, '192k': 1, '256k': 1, '320k': 1 };
const MEDIA_MAX_QUEUED = 10;

function media_time(v) {
	if (v == null || v == '') return null;
	v = '' + v;
	return match(v, /^([0-9]{1,2}:)?[0-9]{1,2}:[0-9]{2}(\.[0-9]{1,3})?$/) || match(v, /^[0-9]{1,6}(\.[0-9]{1,3})?$/) ? v : false;
}
function media_secs(v) {
	if (v == null) return null;
	let p = split(v, ':'), n = 0;
	for (let x in p) n = n * 60 + +x;
	return n;
}

// ffprobe with the account's rights; streams and format, nothing else
function media_probe(u, abs) {
	if (stat(FFPROBE)?.type != 'file') return { error: 'ffmpeg is not installed (system app "ffmpeg" in the store)' };
	let r = files_sh(u, sprintf('timeout 30 %s -v error -protocol_whitelist file -show_format -show_streams -of json -- %s', shq(FFPROBE), shq(abs)));
	let d = json(r.out ?? '');
	if (r.rc != 0 || type(d) != 'object') return { error: 'not a media file' + (trim(r.out) ? ': ' + substr(trim(r.out), 0, 200) : '') };
	let f = d.format ?? {};
	return {
		format: f.format_name ?? '', duration: +(f.duration ?? 0), size: +(f.size ?? 0), bit_rate: +(f.bit_rate ?? 0),
		title: f.tags?.title ?? null,
		streams: map(d.streams ?? [], (x) => ({ index: x.index, type: x.codec_type, codec: x.codec_name, channels: x.channels ?? null,
			sample_rate: +(x.sample_rate ?? 0) || null, bit_rate: +(x.bit_rate ?? 0) || null, width: x.width ?? null, height: x.height ?? null,
			language: x.tags?.language ?? null, title: x.tags?.title ?? null }))
	};
}

// root + path + name of the account -> absolute file (must exist)
function media_file(u, f) {
	if (type(f) != 'object' || !name_ok(f.name)) return { error: 'invalid file' };
	let p = files_path(u, f.root, f.path, 'dir');
	if (p.error) return p;
	let abs = realpath(p.abs) + '/' + f.name;
	if (lstat(abs)?.type != 'file') return { error: 'not a file' };
	return { abs };
}

function media_jobs(u) {
	let list = [];
	for (let f in lsdir(MEDIA_DIR) ?? []) {
		let m = match(f, /^([0-9a-f]{16})\.json$/);
		if (!m) continue;
		let j = json(readfile(MEDIA_DIR + '/' + f) ?? 'null');
		if (type(j) == 'object' && j.user == u)
			push(list, { id: j.id, state: j.state, action: j.action, format: j.format, input: j.input_box, output: j.output_box,
				progress: j.progress ?? 0, error: j.error ?? null, created: j.created, started: j.started ?? null,
				finished: j.finished ?? null, size: j.size ?? null, duration: j.duration ?? 0 });
	}
	return sort(list, (a, b) => b.created - a.created);
}

function files_list(u, root, rel, hidden) {
	let p = files_path(u, root, rel, 'dir');
	if (p.error) return p;
	let names = lsdir(p.abs) ?? [], out = [], n = 0;
	for (let name in sort(names)) {
		if (!hidden && substr(name, 0, 1) == '.') continue;
		if (++n > FILES_MAX) break;
		let st = lstat(p.abs + '/' + name);
		if (!st) continue;
		let t = st.type == 'directory' ? 'dir' : st.type == 'link' ? (stat(p.abs + '/' + name)?.type == 'directory' ? 'dirlink' : 'link') : st.type == 'file' ? 'file' : 'other';
		push(out, { name, type: t, size: st.size, mtime: st.mtime });
	}
	out = sort(out, (a, b) => ((a.type == 'dir') != (b.type == 'dir')) ? (a.type == 'dir' ? -1 : 1) : (lc(a.name) < lc(b.name) ? -1 : 1));
	let df = split(trim(split(sh('df -k ' + shq(p.root.path)).out, '\n')[1] ?? ''), /\s+/);
	return { root, path: p.rel, entries: out, truncated: n > FILES_MAX,
		free: length(df) >= 4 ? +df[3] * 1024 : null, size: length(df) >= 4 ? +df[1] * 1024 : null };
}

function pct_enc(s) {
	let o = '';
	for (let i = 0; i < length(s); i++) {
		let c = ord(s, i);
		o += (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || index('-._~', chr(c)) >= 0 ? chr(c) : sprintf('%%%02X', c);
	}
	return o;
}

function me_info(u) {
	let c = cursor();
	let role = u == 'root' ? 'admin' : (c.get('accounts', u, 'role') ?? 'share');
	let info = { name: u, role, fullname: u == 'root' ? 'Administrator' : (c.get('accounts', u, 'fullname') ?? ''),
		groups: list_of(c.get('accounts', u, 'groups')), quota: +(c.get('accounts', u, 'quota') ?? 0) };
	let home = c.get('accounts', u, 'home');
	info.home = home ? { volume: home, path: '/mnt/' + home + '/home/' + u, smb: u } : null;
	info.usage = quota_usage()[u] ?? [];
	// shares this account can reach and how
	let mine = [];
	let tags = [ u, ...map(info.groups, (g) => '@' + g) ];
	c.foreach('shares', 'share', (x) => {
		let rw = list_of(x.rw), ro = list_of(x.ro), access = null;
		for (let t in tags) { if (index(rw, t) >= 0) access = 'rw'; else if (!access && index(ro, t) >= 0) access = 'ro'; }
		if (!access && x.guest == '1') access = 'ro';
		if (access && x.smb == '1') push(mine, { name: x['.name'], access, comment: x.comment ?? '' });
	});
	info.shares = mine;
	info.host = read_trim('/proc/sys/kernel/hostname');
	info.cloud = area_on('cloud') && me_cloud_allowed(u);
	info.files = u != 'root' && role != 'admin' && files_allowed(u);
	info.apps = role == 'admin' || !area_on('apps') ? [] : map(apps_for(u), (a) => ({ id: a.id, name: a.name, entry: a.entry, icon: a.icon, icon_data: a.icon_data, description: a.description,
		permissions: a.permissions ?? [], window: a.window, display: a.display }));
	info.apps_server = apps_server();
	info.ui = u == 'root' ? null : { theme: c.get('accounts', u, 'theme') ?? null, accent: c.get('accounts', u, 'accent') ?? null };
	info.paperless = area_on('paperless') && !!c.get('paperless', 'global', 'url') && c.get('paperless', 'global', 'enabled') != '0' && !!home;
	return info;
}

/* ---------- status for widget apps ---------- */

function new_token() {
	let r = readfile('/dev/urandom', 16) ?? '';
	let t = '';
	for (let i = 0; i < length(r); i++) t += sprintf('%02x', ord(r, i));
	return t;
}

// apps with the permission "files": a grant for the apps web server
// (/_shareos/cgi/fs), bound to one app and one account, 8 hours; the app may
// then do in the account's folders what the account may do in the file browser
const APP_GRANTS = '/tmp/shareos-appgrants';

function app_has_files(app) { return index(app?.permissions ?? [], 'files') >= 0; }

function app_grant_new(u, app) {
	system('mkdir -p ' + APP_GRANTS + ' && chmod 700 ' + APP_GRANTS);
	system('find ' + APP_GRANTS + ' -type f -mmin +480 -delete 2>/dev/null');
	let t = new_token();
	writefile(APP_GRANTS + '/' + t, sprintf('%s\n%s\n%d\n', u, app.id, time() + 8 * 3600));
	return t;
}

// grant -> account, while the app is installed, has "files" and is visible to the account
function app_grant_user(g) {
	if (type(g) != 'string' || !match(g, /^[0-9a-f]{32}$/)) return null;
	let l = split(readfile(APP_GRANTS + '/' + g) ?? '', '\n');
	if (length(l) < 3 || +l[2] < time()) return null;
	let u = l[0], id = l[1];
	if (!(u == 'root' || acc_name_ok(u)) || !files_allowed(u)) return null;
	let app = filter(apps_for(u), (x) => x.id == id)[0];
	return app && app_has_files(app) ? { u, app } : null;
}

// compares without stopping at the first wrong character
function same_token(a, b) {
	if (type(a) != 'string' || type(b) != 'string' || length(a) != length(b) || length(a) < 16) return false;
	let d = 0;
	for (let i = 0; i < length(a); i++) d |= ord(a, i) ^ ord(b, i);
	return d == 0;
}

/* ---------- VPN client (OpenVPN system app, shareos-vpn) and status chips ---------- */

const VPN = '/usr/sbin/shareos-vpn';
const TAILSCALE = '/usr/sbin/shareos-tailscale';
const APPSTATUS = '/tmp/shareos-appstatus';
const CHIP_STATES = { ok: 1, warn: 1, err: 1, info: 1 };

function vpn_tool(args, input) {
	let cmd = VPN + ' ' + join(' ', map(args, shq));
	if (input != null) {
		let f = '/tmp/.shareos-vpn-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
		let r = sh(cmd);
		unlink(f);
		let j = json(trim(r.out) || 'null');
		return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
	}
	let j = json(trim(sh(cmd).out) || 'null');
	return type(j) == 'object' ? j : { error: 'failed' };
}

// shareos-tailscale <args> (JSON on stdin for up)
function ts_tool(args, input) {
	let cmd = TAILSCALE + ' ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-ts-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = json(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

// grant of an app with the permission p (and "files"); vpn, tailscale: admin accounts only
function app_grant_perm(grant, p) {
	let g = app_grant_user(grant);
	if (!g || index(g.app.permissions ?? [], p) < 0) return null;
	if ((p == 'vpn' || p == 'tailscale') && acc_role(g.u) != 'admin') return null;
	return g;
}

function pid_alive(file, name) {
	let p = +trim(readfile(file) ?? '0');
	return p > 1 && index(readfile('/proc/' + p + '/cmdline') ?? '', name) >= 0;
}

// what the account's Transmission daemon is doing: torrents downloading,
// torrents seeding that upload right now (over its Unix socket, like
// /_shareos/cgi/transmission; the CSRF token of Transmission is shared with it)
function torrent_activity(u) {
	let dir = '/tmp/shareos-transmission/' + u, tokf = dir + '/token';
	let body = '{"method":"torrent-get","arguments":{"fields":["status","rateUpload"]}}';
	let call = () => {
		let r = sh(sprintf("curl -s -m 3 -D - --unix-socket %s -H %s -H 'Content-Type: application/json' --data-binary %s http://localhost/transmission/rpc",
			shq(dir + '/rpc.sock'), shq('X-Transmission-Session-Id: ' + trim(readfile(tokf) ?? '')), shq(body)));
		let i = index(r.out, '\r\n\r\n');
		if (i < 0) return null;
		let head = substr(r.out, 0, i);
		return { code: +(match(head, /^HTTP\/[0-9.]+ ([0-9]{3})/)?.[1] ?? 0), token: match(head, /\nX-Transmission-Session-Id: *([^\r\n]+)/i)?.[1], body: substr(r.out, i + 4) };
	};
	let r = call();
	if (r && r.code == 409 && r.token) { writefile(tokf, r.token); r = call(); }
	if (!r || r.code != 200) return null;
	let j = json(r.body);
	let down = 0, up = 0;
	for (let x in j?.arguments?.torrents ?? []) {
		if (x.status == 4) down++;                              // downloading
		else if (x.status == 6 && x.rateUpload > 0) up++;      // seeding, and someone loads from it
	}
	return { down, up };
}

// the chips of an account: services of the firmware, then the apps
function status_chips(u) {
	let chips = [], admin = acc_role(u) == 'admin', apps = apps_for(u), ids = {};
	for (let a in apps) ids[a.id] = a;
	if (admin && stat('/opt/shareos/bin/openvpn') && pid_alive('/tmp/shareos-vpn/pid', 'openvpn')) {
		let st = vpn_tool([ 'status' ]);
		let ok = st.state == 'CONNECTED';
		push(chips, { id: 'svc:vpn', label: 'VPN', detail: ok ? (st.ip ?? 'verbunden') : 'verbindet …', state: ok ? 'ok' : 'warn',
			app: ids.nettunnel ? 'nettunnel' : null });
	}
	if (admin && stat('/opt/shareos/bin/openvpn') && pid_alive('/tmp/shareos-vpn-server/pid', 'openvpn')) {
		let n = 0;
		for (let l in split(readfile('/tmp/shareos-vpn-server/status') ?? '', '\n')) if (substr(l, 0, 12) == 'CLIENT_LIST,') n++;
		push(chips, { id: 'svc:vpnserver', label: 'VPN-SERVER', detail: n == 1 ? '1 Gerät' : n + ' Geräte', state: 'ok',
			app: ids.nettunnel ? 'nettunnel' : null });
	}
	if (admin && stat('/opt/shareos/bin/tailscaled') && pid_alive('/tmp/shareos-tailscale/pid', 'tailscaled')) {
		// cheap (every 15 s): the address of tailscale0 instead of asking the daemon
		let m = match(sh('ip -4 -o addr show dev tailscale0').out, /inet (100\.[0-9.]+)\//);
		push(chips, { id: 'svc:tailscale', label: 'TAILSCALE', detail: m ? m[1] : 'getrennt',
			state: m ? 'ok' : 'warn', app: ids.tailscale ? 'tailscale' : null });
	}
	if (stat('/tmp/shareos-transmission/' + u + '/pid') && pid_alive('/tmp/shareos-transmission/' + u + '/pid', 'transmission')) {
		// only while something really moves: torrents downloading, or seeding with upload
		let t = torrent_activity(u);
		if (t && (t.down || t.up))
			push(chips, { id: 'svc:torrent', label: 'TORRENT', detail: join(' ', [ ...(t.down ? [ '↓ ' + t.down ] : []), ...(t.up ? [ '↑ ' + t.up ] : []) ]),
				state: 'ok', app: ids.transmission ? 'transmission' : null });
	}
	if (admin && pid_alive('/tmp/shareos-dlna/minidlna.pid', 'minidlna'))
		push(chips, { id: 'svc:dlna', label: 'DLNA', detail: 'läuft', state: 'ok', href: '#/services/dlna' });
	let now = time();
	for (let f in lsdir(APPSTATUS + '/' + u) ?? []) {
		let m = match(f, /^([a-z][a-z0-9-]{1,31})\.json$/), a = m ? ids[m[1]] : null;
		if (!a || index(a.permissions ?? [], 'status') < 0) continue;
		let x = json(readfile(APPSTATUS + '/' + u + '/' + f) ?? 'null');
		if (type(x) != 'object' || +x.until < now) continue;
		push(chips, { id: 'app:' + a.id, label: x.text, state: x.state, app: a.id, name: a.name });
	}
	return chips;
}


function widget_status() {
	let up = split(read_trim('/proc/uptime') ?? '0', ' ');
	let load = split(read_trim('/proc/loadavg') ?? '', ' ');
	let m = meminfo();
	let t = read_int('/tmp/sys/temp1_input');
	let alerts = [];
	let vols = [];
	for (let v in volumes()) {
		let x = { name: v.name, mounted: v.mounted };
		if (v.size) {
			x.size = v.size; x.free = v.avail;
			x.used_pct = int(v.used * 100 / v.size + 0.5);
			if (x.used_pct >= 90) push(alerts, 'volume ' + v.name + ' ' + x.used_pct + '% full');
		}
		if (v.enabled && !v.mounted) push(alerts, 'volume ' + v.name + ' not mounted');
		push(vols, x);
	}
	let raid = [];
	for (let n, a in mdstat()) {
		let x = { name: n, level: a.level, health: a.health, sync: a.sync?.percent };
		if (a.health && index(a.health, '_') >= 0) push(alerts, n + ' degraded [' + a.health + ']');
		push(raid, x);
	}
	if (t != null && t >= 55000) push(alerts, 'temperature ' + int(t / 1000) + ' °C');
	let r = release();
	return {
		host: read_trim('/proc/sys/kernel/hostname'),
		version: r.version ?? '',
		time: time(),
		uptime: int(+up[0]),
		load: +load[0],
		temp_c: t != null ? int(t / 100) / 10 : null,
		fan_pwm: read_int('/tmp/sys/pwm1'),
		mem_used_pct: m.memtotal ? int((m.memtotal - (m.memavailable ?? m.memfree)) * 100 / m.memtotal + 0.5) : null,
		volumes: vols,
		raid,
		ok: !length(alerts),
		alerts
	};
}

return {
	'shareos.ui': {
		// public (also before login): language and logo for the login page
		get: {
			call: function() { return { ...ui_settings(), default_password: default_password() }; }
		},

		set: {
			args: { lang: '', logo: false, theme: '', accent: '', areas: {} },
			call: function(req) {
				let c = cursor();
				c.set('shareos', 'ui', 'ui');   // section may be missing in configs from older versions
				let changed = {};
				if (type(req.args.areas) == 'object')
					for (let a in AREAS) if (req.args.areas[a] != null) {
						let v = req.args.areas[a] ? '1' : '0';
						if ((c.get('shareos', 'ui', 'area_' + a) ?? '1') != v) changed[a] = v;
						c.set('shareos', 'ui', 'area_' + a, v);
					}
				if (req.args.lang != null && req.args.lang != '') {
					if (!match(req.args.lang, /^[a-z]{2}(-[A-Za-z]{2})?$/)) return { error: 'invalid language' };
					c.set('shareos', 'ui', 'lang', req.args.lang);
				}
				if (req.args.logo != null)
					c.set('shareos', 'ui', 'logo', req.args.logo ? '1' : '0');
				if (req.args.theme) {
					if (!THEMES[req.args.theme]) return { error: 'invalid theme' };
					c.set('shareos', 'ui', 'theme', req.args.theme);
				}
				if (req.args.accent) {
					if (!ACCENTS[req.args.accent]) return { error: 'invalid accent' };
					c.set('shareos', 'ui', 'accent', req.args.accent);
				}
				c.commit('shareos');
				if (length(changed)) {
					system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
					if (changed.apps) system('/etc/init.d/S51apps ' + (changed.apps == '1' ? 'start' : 'stop') + ' >/dev/null 2>&1');
				}
				return ui_settings();
			}
		}
	},

	'shareos.web': {
		get: {
			call: function() {
				let c = cursor();
				let wh = web_host();
				return { https: c.get('shareos', 'web', 'https') != '0', redirect: c.get('shareos', 'web', 'redirect') == '1', cert: cert_info(),
					host: c.get('shareos', 'web', 'host') ?? '', cert_host: cert_host() };
			}
		},

		set: {
			args: { https: true, redirect: false, host: '' },
			call: function(req) {
				let c = cursor();
				let h = req.args.host;
				if (h != null && h != '' && !match(h, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,250}[A-Za-z0-9])?$/)) return { error: 'invalid host name' };
				c.set('shareos', 'web', 'web');
				if (h != null) {
					if (h == '') c.delete('shareos', 'web', 'host'); else c.set('shareos', 'web', 'host', lc(h));
					if (req.args.https == null && req.args.redirect == null) { c.commit('shareos'); return { ok: true }; }
				}
				if (req.args.https != null) c.set('shareos', 'web', 'https', req.args.https ? '1' : '0');
				if (req.args.redirect != null) c.set('shareos', 'web', 'redirect', req.args.redirect ? '1' : '0');
				c.commit('shareos');
				restart_uhttpd();
				return { ok: true };
			}
		},

		selfsigned: {
			call: function() {
				let r = sh(CERT + ' selfsigned'); forget('cert');
				if (r.rc != 0) return { error: trim(r.out) };
				restart_uhttpd();
				return { ok: true, cert: cert_info() };
			}
		},

		install: {
			// PEM texts; the certificate may be followed by the chain
			args: { cert: '', key: '' },
			call: function(req) {
				let crt = req.args.cert ?? '', key = req.args.key ?? '';
				if (length(crt) > 65536 || length(key) > 16384) return { error: 'file too large' };
				let d = trim(sh('mktemp -d').out);
				writefile(d + '/crt', crt);
				writefile(d + '/key', key);
				let r = sh(CERT + ' install ' + shq(d + '/crt') + ' ' + shq(d + '/key')); forget('cert');
				system('rm -rf ' + shq(d));
				if (r.rc != 0) return { error: replace(trim(r.out), 'shareos-cert: ', '') };
				restart_uhttpd();
				return { ok: true, cert: cert_info() };
			}
		}
	},

	'shareos.system': {
		// a root shell in the browser (admins only): ttyd on its own port with
		// a secret path, for one client, ends when that client leaves
		terminal: {
			args: { tls: false, theme: {} },
			call: function(req) {
				let th = req.args.theme, t = {};
				if (type(th) == 'object')
					for (let k in [ 'background', 'foreground', 'cursor', 'selectionBackground' ])
						if (match(th[k] ?? '', /^#[0-9a-fA-F]{3,8}$/)) t[k] = th[k];
				let r = sh(sprintf('/usr/sbin/shareos-terminal start %s %s', req.args.tls ? 'tls' : 'plain', shq(length(t) ? sprintf('%J', t) : '')));
				let m = match(r.out, /port=([0-9]+) path=([0-9a-f]{32})/);
				if (!m) return { error: trim(replace(r.out, /^error: /, '')) || 'terminal did not start' };
				return { port: +m[1], path: m[2] };
			}
		},

		info: {
			call: function() {
				let up = split(read_trim('/proc/uptime') ?? '0', ' ');
				let load = split(read_trim('/proc/loadavg') ?? '', ' ');
				let net = '/sys/class/net/eth0/';
				return {
					model: read_trim('/proc/device-tree/model'),
					board: { id: board().id ?? null, name: board().name ?? null, fwname: board().fwname ?? null, tested: board().tested == '1' },
					release: release(),
					hostname: read_trim('/proc/sys/kernel/hostname'),
					kernel: read_trim('/proc/sys/kernel/osrelease'),
					boot: boot_mode(),
					time: time(),
					uptime: +up[0],
					load: [ +load[0], +load[1], +load[2] ],
					cpu: cpustat(),
					memory: meminfo(),
					temperature: read_int('/tmp/sys/temp1_input'),   // m°C, from dns320l-daemon
					fan_pwm: read_int('/tmp/sys/pwm1'),
					network: {
						eth0: {
							ipv4: memo('ipv4', fstamp('/etc/resolv.conf'), 30, () => ipv4('eth0')),
							gateway: memo('gw', fstamp('/etc/resolv.conf'), 30, gateway),
							dns: dns(),
							speed: read_int(net + 'speed'),
							mac: read_trim(net + 'address'),
							rx_bytes: read_int(net + 'statistics/rx_bytes'),
							tx_bytes: read_int(net + 'statistics/tx_bytes')
						}
					},
					filesystems: memo('df', '', 30, filesystems),
					disks: disks()
				};
			}
		},

		log: {
			args: { lines: 200, source: 'system' },
			call: function(req) {
				let n = +(req.args.lines ?? 200);
				if (n < 1 || n > 2000) n = 200;
				let r = req.args.source == 'kernel'
					? sh('dmesg | tail -n ' + n)
					: sh('tail -n ' + n + ' /var/log/messages');
				return { lines: split(rtrim(r.out), '\n') };
			}
		},

		reboot: {
			call: function() {
				system('(sleep 2; reboot) >/dev/null 2>&1 &');
				return { rebooting: true };
			}
		},

		poweroff: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true)
					return { error: 'confirm must be true' };
				system('(sleep 2; poweroff) >/dev/null 2>&1 &');
				return { poweroff: true };
			}
		},

		factory_reset: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true)
					return { error: 'confirm must be true' };
				let r = sh('/usr/sbin/shareos-factory-reset --yes --no-reboot');
				if (r.rc != 0)
					return { error: trim(r.out) };
				system('(sleep 2; reboot) >/dev/null 2>&1 &');
				return { rebooting: true };
			}
		},

		set_password: {
			args: { password: '' },
			call: function(req) {
				let pw = req.args.password ?? '';
				if (length(pw) < 6)
					return { error: 'password too short (min. 6)' };
				if (match(pw, /[\n\r:]/))
					return { error: 'password contains invalid characters' };
				let p = popen('chpasswd -c sha512 >/dev/null 2>&1', 'w');
				if (!p)
					return { error: 'chpasswd not available' };
				p.write('root:' + pw + '\n');
				return p.close() == 0 ? { ok: true } : { error: 'chpasswd failed' };
			}
		},

		set_hostname: {
			args: { hostname: '' },
			call: function(req) {
				let h = req.args.hostname ?? '';
				if (!match(h, /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/))
					return { error: 'invalid hostname' };
				writefile('/etc/hostname', h + '\n');
				sh('hostname ' + shq(h));
				// mDNS name (<hostname>.local) follows
				system('[ -x /etc/init.d/S50avahi-daemon ] && pidof avahi-daemon >/dev/null && /etc/init.d/S50avahi-daemon restart >/dev/null 2>&1 &');
				return { ok: true, hostname: h, cert_renewed: cert_refresh() };
			}
		}
	},

	'shareos.service': {
		list: {
			call: function() {
				let list = [], names = proc_names(), off = autostart_off();
				for (let name in sort(keys(SERVICES))) {
					let s = SERVICES[name];
					if (!init_script(name) || (s.needs && !stat(s.needs)))
						continue;
					// the board service is the MCU daemon only on boxes with that MCU
					let proc = name == 'board' && board().control && board().control != 'mcu' ? 'shareos-board' : s.proc;
					push(list, { name, label: s.label, desc: s.desc, running: running(proc, names), essential: !!ESSENTIAL[name],
						autostart: !(name in off) });
				}
				for (let s in sys_services()) {
					let t = SYS_SVC_TEXT[s.control];
					push(list, { name: s.control, label: t?.label ?? s.name, desc: t?.desc ?? s.id, running: running(s.proc, names),
						essential: false, autostart: !(s.control in off), sysapp: s.id });
				}
				return { services: list };
			}
		},

		action: {
			args: { name: '', action: '' },
			call: function(req) {
				let name = req.args.name, act = req.args.action;
				if (!(act in { start: 1, stop: 1, restart: 1 }))
					return { error: 'unknown action' };
				let script = SERVICES[name] ? init_script(name) : null;
				let svc = script ? null : sys_service(name);
				if (svc) {
					// start = what the boot does (the controller follows its settings)
					let ctl = '/usr/sbin/shareos-' + svc.control;
					let r = sh(act == 'start' ? ctl + ' boot' : act == 'stop' ? ctl + ' stop-all' : ctl + ' stop-all; ' + ctl + ' boot');
					return { ok: r.rc == 0, output: trim(r.out), running: running(svc.proc) };
				}
				if (!script)
					return { error: 'unknown service' };
				if (act == 'stop' && ESSENTIAL[name])
					return { error: 'this service cannot be stopped from the web interface' };
				if (act == 'restart' && ESSENTIAL[name]) {
					// answer first, the restart may cut this connection
					system(sprintf('(sleep 1; %s restart) >/dev/null 2>&1 &', shq(script)));
					return { ok: true, delayed: true };
				}
				let r = sh(shq(script) + ' ' + act);
				return { ok: r.rc == 0, output: trim(r.out), running: running(SERVICES[name].proc) };
			}
		},

		autostart: {
			args: { name: '', enabled: true },
			call: function(req) {
				let name = req.args.name;
				if (!(SERVICES[name] && init_script(name)) && !sys_service(name)) return { error: 'unknown service' };
				if (ESSENTIAL[name] && !req.args.enabled) return { error: 'this service is always started' };
				let off = autostart_off();
				if (req.args.enabled) delete off[name]; else off[name] = true;
				let c = cursor();
				c.set('shareos', 'autostart', 'autostart');
				c.delete('shareos', 'autostart', 'disabled');
				if (length(keys(off))) c.set('shareos', 'autostart', 'disabled', sort(keys(off)));
				c.commit('shareos');
				return { ok: true, name, autostart: !off[name] };
			}
		}
	},

	'shareos.net': {
		get: {
			call: function() {
				return { ...net_settings(), ...net_state(), timeout: NET_TIMEOUT };
			}
		},

		// takes effect at once; rolled back unless confirmed within NET_TIMEOUT
		set: {
			args: { proto: '', ipaddr: '', netmask: '', gateway: '', dns: [], confirm: false },
			call: function(req) {
				let a = req.args;
				if (!a.confirm) return { error: 'confirm required' };
				if (net_state().pending) return { error: 'a network change is still waiting for confirmation' };
				if (!(a.proto in { dhcp: 1, static: 1 })) return { error: 'invalid mode' };
				let dns = filter(a.dns ?? [], (x) => x != '');
				let gw = a.gateway ?? '';
				if (a.proto == 'static') {
					if (!ip4_ok(a.ipaddr)) return { error: 'invalid IP address' };
					let pfx = mask_prefix(a.netmask);
					if (pfx == null || pfx < 8 || pfx > 30) return { error: 'invalid subnet mask' };
					let net = (x) => int(ip4_num(x) / (pow2(32 - pfx)));
					let host = ip4_num(a.ipaddr) % (pow2(32 - pfx));
					if (host == 0 || host == pow2(32 - pfx) - 1) return { error: 'the IP address is the network or broadcast address' };
					if (gw != '') {
						if (!ip4_ok(gw)) return { error: 'invalid gateway' };
						if (net(gw) != net(a.ipaddr)) return { error: 'the gateway is not in the same network' };
						if (gw == a.ipaddr) return { error: 'gateway and IP address are the same' };
					}
					if (length(dns) > 3) return { error: 'at most 3 DNS servers' };
					for (let d in dns) if (!ip4_ok(d)) return { error: 'invalid DNS server ' + d };
				}
				system('mkdir -p /etc/shareos && cp /etc/config/network ' + NET_ROLLBACK);
				let c = cursor();
				c.set('network', 'lan', 'interface');
				c.set('network', 'lan', 'ifname', 'eth0');
				c.set('network', 'lan', 'proto', a.proto);
				if (a.proto == 'static') {
					c.set('network', 'lan', 'ipaddr', a.ipaddr);
					c.set('network', 'lan', 'netmask', a.netmask);
					c.set('network', 'lan', 'gateway', gw);
					c.set('network', 'lan', 'dns', join(' ', dns));
				}
				c.commit('network');
				system(sprintf('rm -f %s/result; start-stop-daemon -S -b -x %s -- apply %d', NET_ST, NET, NET_TIMEOUT));
				return { ok: true, timeout: NET_TIMEOUT, address: a.proto == 'static' ? a.ipaddr : null };
			}
		},

		confirm: {
			call: function() {
				if (!net_state().pending) return { ok: true, pending: false };
				system(NET + ' confirm');
				return { ok: true, cert_renewed: cert_refresh() };
			}
		},

		// hide the "rolled back" message
		dismiss: {
			call: function() {
				unlink(NET_ST + '/result');
				return { ok: true };
			}
		}
	},



	'shareos.hw': {
		get: {
			call: function() {
				return { fan: fan_settings(), led: led_settings(), presets: FAN_PRESETS,
					temperature: read_int('/tmp/sys/temp1_input'), fan_pwm: read_int('/tmp/sys/pwm1') };
			}
		},

		set_fan: {
			args: { preset: '', off_temp: 0, full_temp: 0, half_temp: 0 },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!(a.preset in { quiet: 1, balanced: 1, cool: 1, custom: 1 })) return { error: 'unknown preset' };
				c.set('shareos', 'fan', 'fan');
				c.set('shareos', 'fan', 'preset', a.preset);
				if (a.preset == 'custom') {
					let o = +a.off_temp, f = +a.full_temp, h = +a.half_temp;
					if (!(f >= 35 && f <= 70) || !(h >= 30 && h < f) || !(o == 0 || (o >= 25 && o < h)))
						return { error: 'invalid temperatures (0 or 25 <= off < half < full <= 70)' };
					c.set('shareos', 'fan', 'off_temp', '' + o);
					c.set('shareos', 'fan', 'full_temp', '' + f);
					c.set('shareos', 'fan', 'half_temp', '' + h);
				}
				c.commit('shareos');
				return { ok: true, fan: fan_settings() };
			}
		},

		set_led: {
			args: { status: '', power: '', disks: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				c.set('shareos', 'led', 'led');
				if (a.status) { if (!(a.status in { heartbeat: 1, on: 1, off: 1 })) return { error: 'invalid status LED mode' }; c.set('shareos', 'led', 'status', a.status); }
				if (a.power) { if (!(a.power in { on: 1, off: 1, blink: 1 })) return { error: 'invalid power LED mode' }; c.set('shareos', 'led', 'power', a.power); }
				if (a.disks) { if (!(a.disks in { off: 1, activity: 1 })) return { error: 'invalid disk LED mode' }; c.set('shareos', 'led', 'disks', a.disks); }
				c.commit('shareos');
				sh('/usr/sbin/shareos-leds');
				return { ok: true, led: led_settings() };
			}
		}
	},

	'shareos.time': {
		get: {
			call: function() { return time_info(); }
		},

		// timezone, ntp (on/off), servers (host names or IPs, at most 5)
		set: {
			args: { timezone: '', ntp: true, servers: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.timezone && !set_timezone(a.timezone)) return { error: 'unknown time zone' };
				if (a.servers != null) {
					if (type(a.servers) != 'array' || length(a.servers) > 5) return { error: 'at most 5 servers' };
					for (let x in a.servers)
						if (type(x) != 'string' || !match(x, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,252}[A-Za-z0-9])?$/) && !match(x, /^[0-9a-fA-F:]+$/))
							return { error: 'invalid server: ' + x };
				}
				c.set('shareos', 'time', 'time');
				if (a.ntp != null) c.set('shareos', 'time', 'ntp', a.ntp ? '1' : '0');
				if (a.servers != null) {
					c.delete('shareos', 'time', 'server');
					if (length(a.servers)) c.set('shareos', 'time', 'server', a.servers);
				}
				c.commit('shareos');
				system('/etc/init.d/S45ntpd restart >/dev/null 2>&1');
				return time_info();
			}
		},

		// ask the servers once now (takes a few seconds)
		sync: {
			call: function() {
				let args = join(' ', map(ntp_servers(cursor()), (x) => '-p ' + shq(x)));
				let r = sh('timeout 20 ntpd -q -n ' + args);
				if (r.rc != 0) return { error: 'no answer from the time servers' };
				rtc_save();
				writefile('/tmp/shareos-ntp/last', time() + ' manual\n');
				return time_info();
			}
		},

		// set the clock by hand: time = seconds since 1970 (UTC)
		set_clock: {
			args: { time: 0 },
			call: function(req) {
				let t = +req.args.time;
				if (!(t >= 1735689600 && t < 4102444800)) return { error: 'invalid time' };   // 2025 … 2099
				let g = gmtime(t);
				let r = sh(sprintf('date -u -s "%04d-%02d-%02d %02d:%02d:%02d"', g.year, g.mon, g.mday, g.hour, g.min, g.sec));
				if (r.rc != 0) return { error: 'setting the clock failed' };
				rtc_save();
				return time_info();
			}
		}
	},

	'shareos.setup': {
		status: {
			call: function() {
				let c = cursor();
				return { done: c.get('shareos', 'setup', 'done') == '1', hostname: read_trim('/proc/sys/kernel/hostname'),
					timezone: timezone(), lang: c.get('shareos', 'ui', 'lang') ?? 'en', channel: c.get('shareos', 'update', 'channel') ?? 'stable' };
			}
		},

		zones: {
			call: function() { return { zones: zones(), current: timezone() }; }
		},

		altf: {
			call: function() { return altf_scan(); }
		},

		// first-run wizard: everything optional except marking it done
		apply: {
			args: { password: '', hostname: '', timezone: '', channel: '', altf: false },
			call: function(req) {
				let a = req.args, c = cursor(), done = [];
				if (a.altf === true) {
					let r = sh('/usr/sbin/shareos-altf import');
					for (let line in split(r.out, '\n')) {
						let m = match(line, /^imported=(.*)$/);
						if (m) push(done, 'altf:' + m[1]);
					}
				}
				if (a.hostname) { if (!set_hostname(a.hostname)) return { error: 'invalid hostname' }; push(done, 'hostname'); }
				if (a.timezone) { if (!set_timezone(a.timezone)) return { error: 'unknown time zone' }; push(done, 'timezone'); }
				if (a.channel) {
					if (!(a.channel in { stable: 1, beta: 1 })) return { error: 'invalid channel' };
					c.set('shareos', 'update', 'channel', a.channel); push(done, 'channel');
				}
				if (a.password) { let e = set_password(a.password); if (e) return { error: e }; push(done, 'password'); }
				c.set('shareos', 'setup', 'setup');
				c.set('shareos', 'setup', 'done', '1');
				c.commit('shareos');
				return { ok: true, done };
			}
		},

		reset: {
			// show the wizard again on the next login
			call: function() {
				let c = cursor();
				c.set('shareos', 'setup', 'setup');
				c.set('shareos', 'setup', 'done', '0');
				c.commit('shareos');
				return { ok: true };
			}
		}
	},

	'shareos.storage': {
		status: {
			call: function() {
				let disks = [];
				for (let d in lsblk()) {
					if (d.type != 'disk' || !match(d.name, /^sd[a-z]$/)) continue;
					d.usb = is_usb(d.name);
					d.smart = d.usb ? null : smart_read(d.name, false);
					push(disks, d);
				}
				let c = cursor();
				let swaps = [];
				for (let line in slice(split(readfile('/proc/swaps') ?? '', '\n'), 1)) {
					let f = split(trim(line), /\s+/);
					if (length(f) >= 4) push(swaps, { device: f[0], size: +f[2] * 1024, used: +f[3] * 1024 });
				}
				return {
					disks,
					swaps,
					apps: c.get('storage', 'global', 'apps'),
					arrays: mdstat(),
					volumes: volumes(),
					spindown: +(c.get('storage', 'global', 'spindown') ?? 0),
					usb: usb_mounts(),
					job: storage_job()
				};
			}
		},

		smart: {
			args: { disk: '' },
			call: function(req) {
				if (!valid_disk(req.args.disk))
					return { error: 'unknown disk' };
				return smart_read(req.args.disk, true);
			}
		},

		setup: {
			// layout mirror (RAID 1) | stripe (RAID 0) | span (JBOD): name + disks[2];
			// layout single: volumes [{name, disk}]
			// fs: ext4 (default), ext3, ext2, btrfs, exfat, ntfs, vfat – volumes may carry their own
			args: { layout: '', name: '', disks: [], volumes: [], swap: 1024, fs: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true)
					return { error: 'confirm must be true' };
				let swap = a.swap == null ? 1024 : +a.swap;
				if (!(swap >= 0 && swap <= 8192))
					return { error: 'invalid swap size' };
				let sw = '--swap=' + int(swap);
				let fs = a.fs || 'ext4';
				if (!FS_DISK[fs]) return { error: 'invalid file system' };
				let j = storage_job();
				if (j?.state == 'running')
					return { error: 'a storage job is already running' };
				if (a.layout == 'mirror' || a.layout == 'stripe' || a.layout == 'span') {
					if (!valid_name(a.name)) return { error: 'invalid name' };
					if (type(a.disks) != 'array' || length(a.disks) != 2 || a.disks[0] == a.disks[1] ||
					    !valid_disk(a.disks[0]) || !valid_disk(a.disks[1]))
						return { error: 'two different disks are needed' };
					if (is_usb(a.disks[0]) || is_usb(a.disks[1]))
						return { error: 'USB drives are formatted with usb_format' };
					return spawn_storage([ 'setup', a.layout, a.name, a.disks[0], a.disks[1], sw, '--fs=' + fs, '--yes' ]);
				}
				if (a.layout == 'single') {
					if (type(a.volumes) != 'array' || !length(a.volumes))
						return { error: 'no disks given' };
					let args = [ 'setup', 'single' ], seen = {};
					for (let v in a.volumes) {
						if (!valid_name(v?.name) || !valid_disk(v?.disk) || seen[v.name] || seen[v.disk])
							return { error: 'invalid name or disk' };
						if (v.fs && !FS_DISK[v.fs]) return { error: 'invalid file system' };
						if (is_usb(v.disk)) return { error: 'USB drives are formatted with usb_format' };
						seen[v.name] = seen[v.disk] = true;
						push(args, v.name + '=' + v.disk + ':' + (v.fs || fs));
					}
					push(args, sw, '--yes');
					return spawn_storage(args);
				}
				return { error: 'unknown layout' };
			}
		},

		// a mirror with a missing disk: erase a disk and add it
		repair: {
			args: { name: '', disk: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true) return { error: 'confirm must be true' };
				if (!valid_name(a.name)) return { error: 'invalid name' };
				if (cursor().get('storage', a.name, 'layout') != 'mirror') return { error: 'not a mirror' };
				if (!valid_disk(a.disk)) return { error: 'invalid disk' };
				if (is_usb(a.disk)) return { error: 'USB drives cannot be part of a mirror' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is already running' };
				return spawn_storage([ 'repair', a.name, a.disk, '--yes' ]);
			}
		},

		volume: {
			args: { name: '', action: '' },
			call: function(req) {
				let n = req.args.name, act = req.args.action;
				if (!valid_name(n)) return { error: 'invalid name' };
				if (!(act in { mount: 1, umount: 1, forget: 1 })) return { error: 'unknown action' };
				let r = sh(STORAGE + ' ' + act + ' ' + shq(n));
				if (r.rc == 0) system(USERS + ' sync >/dev/null 2>&1');
				return r.rc == 0 ? { ok: true } : { error: trim(r.out) || act + ' failed' };
			}
		},

		// USB stick/disk: unmount and power down, then it can be pulled
		usb_eject: {
			args: { disk: '' },
			call: function(req) {
				if (!is_usb(req.args.disk)) return { error: 'not a USB drive' };
				let r = sh(USB + ' eject ' + req.args.disk);
				if (r.rc != 0) return { error: replace(trim(r.out), /^error: /, '') || 'eject failed' };
				return { ok: true };
			}
		},

		// erase a USB stick/disk: one partition, fs: exfat (default), vfat, ntfs, ext4
		usb_format: {
			args: { disk: '', fs: '', name: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true) return { error: 'confirm must be true' };
				if (!is_usb(a.disk)) return { error: 'not a USB drive' };
				let fs = a.fs || 'exfat';
				if (!FS_USB[fs]) return { error: 'invalid file system' };
				if (type(a.name) != 'string' || !match(a.name, /^[A-Za-z0-9 _-]{1,16}$/)) return { error: 'invalid name' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is already running' };
				system(sprintf('start-stop-daemon -S -b -x %s -- format %s %s %s --yes', USB, a.disk, fs, shq(a.name)));
				return { started: true };
			}
		},

		// hide the message of a finished or failed setup job
		job_clear: {
			call: function() {
				if (storage_job()?.state == 'running')
					return { error: 'a storage job is running' };
				unlink(SMART_DIR + '/job');
				return { ok: true };
			}
		},

		spindown: {
			args: { minutes: 0 },
			call: function(req) {
				let m = +req.args.minutes;
				if (m < 0 || m > 330) return { error: 'invalid value' };
				let r = sh(STORAGE + ' spindown ' + m);
				return r.rc == 0 ? { ok: true, minutes: m } : { error: trim(r.out) };
			}
		}
	},


	'shareos.accounts': {
		list: {
			call: function() { return accounts(); }
		},

		add: {
			args: { name: '', role: '', password: '', fullname: '', groups: [], home: '', quota: 0, web: true, cloud: false, files: false },
			call: function(req) {
				let a = req.args;
				if (!acc_name_ok(a.name)) return { error: 'invalid name (a-z, 0-9 and _, starting with a letter)' };
				if (!(a.role in { admin: 1, user: 1, share: 1 })) return { error: 'invalid role' };
				let o = { ...a }; delete o.role;
				let r = tool_result(sh_pass(sprintf('%s add %s %s %s', USERS, shq(a.name), a.role, opt_args(o)), a.password));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		set: {
			args: { name: '', role: '', fullname: '', groups: [], home: '', quota: 0, web: true, cloud: false, files: false },
			call: function(req) {
				let a = req.args;
				if (!acc_name_ok(a.name)) return { error: 'invalid name' };
				let r = tool_result(sh(sprintf('%s set %s %s', USERS, shq(a.name), opt_args(a))));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		passwd: {
			args: { name: '', password: '' },
			call: function(req) {
				let n = req.args.name;
				if (!(n == 'root' || acc_name_ok(n))) return { error: 'invalid name' };
				return tool_result(sh_pass(sprintf('%s passwd %s', USERS, shq(n)), req.args.password));
			}
		},

		del: {
			args: { name: '', remove_home: false },
			call: function(req) {
				let n = req.args.name;
				if (!acc_name_ok(n)) return { error: 'invalid name' };
				if (n == session_user(req)) return { error: 'you cannot delete your own account' };
				let r = tool_result(sh(sprintf('%s del %s%s', USERS, shq(n), req.args.remove_home ? ' --remove-home' : '')));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		group_add: {
			args: { name: '', desc: '' },
			call: function(req) {
				let g = req.args.name;
				if (!acc_name_ok(g)) return { error: 'invalid name' };
				let r = tool_result(sh(sprintf('%s group-add %s %s', USERS, shq(g), shq('--desc=' + (req.args.desc ?? '')))));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		group_del: {
			args: { name: '' },
			call: function(req) {
				let g = req.args.name;
				if (!acc_name_ok(g)) return { error: 'invalid name' };
				let r = tool_result(sh(sprintf('%s group-del %s', USERS, shq(g))));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		import_altf: {
			call: function() {
				let r = sh(USERS + ' import-altf');
				if (r.rc != 0) return tool_result(r);
				let im = match(r.out, /imported=([^\n]*)/), sk = match(r.out, /skipped=([^\n]*)/);
				return { ok: true, imported: im && im[1] != '' ? split(im[1], ' ') : [], skipped: sk && sk[1] != '' ? split(sk[1], ' ') : [], ...accounts() };
			}
		}
	},

	'shareos.shares': {
		list: {
			call: function() { return share_list(); }
		},

		// create or change a share
		set: {
			args: { name: '', volume: '', path: '', comment: '', smb: true, nfs: false, guest: false,
				rw: [], ro: [], nfs_rw: false, nfs_hosts: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!valid_name(a.name)) return { error: 'invalid name (a-z, 0-9, - and _, max. 16)' };
				if (a.name == 'homes' || a.name == 'global' || a.name == 'ipc') return { error: 'this name is reserved' };
				if (c.get('storage', a.volume) != 'volume') return { error: 'unknown volume' };
				let path = a.path ?? a.name;
				if (path == '' || !match(path, /^[A-Za-z0-9 ._-]+(\/[A-Za-z0-9 ._-]+)*$/) || match(path, /(^|\/)\.\.?(\/|$)/))
					return { error: 'invalid folder (letters, digits, space . _ - and /)' };
				if (match(a.comment ?? '', /[\n\r\[\]]/)) return { error: 'invalid description' };
				let accs = accounts(), known = {};
				for (let u in accs.users) known[u.name] = true;
				for (let g in accs.groups) known['@' + g.name] = true;
				for (let x in [ ...(a.rw ?? []), ...(a.ro ?? []) ]) if (!known[x]) return { error: 'unknown user or group ' + x };
				for (let h in a.nfs_hosts ?? [])
					if (!match(h, /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/[0-9]{1,2})?$|^\*$|^[A-Za-z0-9.-]+$/)) return { error: 'invalid NFS client ' + h };
				c.set('shares', 'global', 'global');
				c.set('shares', a.name, 'share');
				c.set('shares', a.name, 'volume', a.volume);
				c.set('shares', a.name, 'path', path);
				c.set('shares', a.name, 'comment', a.comment ?? '');
				for (let k in [ 'smb', 'nfs', 'guest', 'nfs_rw' ]) c.set('shares', a.name, k, a[k] ? '1' : '0');
				for (let k in [ 'rw', 'ro', 'nfs_hosts' ]) {
					c.delete('shares', a.name, k);
					if (length(a[k] ?? [])) c.set('shares', a.name, k, a[k]);
				}
				c.commit('shares');
				sh(SHARES + ' apply');
				return { ok: true, ...share_list() };
			}
		},

		del: {
			args: { name: '' },
			call: function(req) {
				let c = cursor();
				if (!valid_name(req.args.name) || c.get('shares', req.args.name) != 'share') return { error: 'unknown share' };
				c.delete('shares', req.args.name);
				c.commit('shares');
				sh(SHARES + ' apply');
				return { ok: true, ...share_list() };   // the folder and its files stay
			}
		},

		global: {
			args: { workgroup: '', smb: true, nfs: true },
			call: function(req) {
				let a = req.args, c = cursor();
				c.set('shares', 'global', 'global');
				if (a.workgroup) {
					if (!match(a.workgroup, /^[A-Za-z0-9_-]{1,15}$/)) return { error: 'invalid workgroup' };
					c.set('shares', 'global', 'workgroup', uc(a.workgroup));
				}
				if (a.smb != null) c.set('shares', 'global', 'smb', a.smb ? '1' : '0');
				if (a.nfs != null) c.set('shares', 'global', 'nfs', a.nfs ? '1' : '0');
				c.commit('shares');
				sh(SHARES + ' apply');
				return { ok: true, ...share_list() };
			}
		}
	},

	'shareos.me': {
		// link this web session to the account that logged in
		bind: {
			args: { username: '', password: '' },
			call: function(req) {
				let u = req.args.username, sid = req.args.ubus_rpc_session;
				if (type(sid) != 'string' || !match(sid, /^[0-9a-f]{32}$/)) return { error: 'no session' };
				if (!(u == 'root' || acc_name_ok(u)) || !password_ok(u, req.args.password)) return { error: 'login failed' };
				system('mkdir -p ' + SESS_DIR + ' && chmod 700 ' + SESS_DIR);
				// drop links of sessions older than a week
				system('find ' + SESS_DIR + ' -type f -mtime +7 -delete 2>/dev/null');
				writefile(SESS_DIR + '/' + sid, u + '\n');
				return me_info(u);
			}
		},

		get: {
			call: function(req) {
				let u = session_user(req);
				return u ? me_info(u) : { error: 'session not bound' };
			}
		},


		paperless: {
			call: function(req) {
				let u = session_user(req), c = cursor();
				if (!u || u == 'root') return { error: 'session not bound' };
				let g = paperless_global(c), name = 'u_' + u;
				return { url: g.url, available: g.url != '' && g.enabled && !!c.get('accounts', u, 'home'),
					inbox: c.get('paperless', name) == 'inbox' ? inbox_info(c, name) : null,
					folder: c.get('accounts', u, 'home') ? '\\\\' + read_trim('/proc/sys/kernel/hostname') + '\\' + u + '\\Paperless' : null };
			}
		},

		paperless_set: {
			args: { token: '', tags: [], enabled: true, test: false },
			call: function(req) {
				let u = session_user(req), c = cursor();
				if (!u || u == 'root') return { error: 'session not bound' };
				if (!c.get('accounts', u, 'home')) return { error: 'you have no personal folder' };
				if (!c.get('paperless', 'global', 'url')) return { error: 'Paperless is not set up on this box' };
				let a = req.args, name = 'u_' + u;
				if (a.token && !token_ok(a.token)) return { error: 'invalid token' };
				if (a.test) {
					let tok = a.token || c.get('paperless', name, 'token');
					if (!tok) return { error: 'token needed' };
					let r = sh(sprintf("printf '%%s\\n' %s | %s test %s", shq(tok), PAPERLESS, shq(c.get('paperless', 'global', 'url'))));
					let m = match(r.out, /ok documents=([0-9?]+)/);
					return m ? { ok: true, documents: m[1] } : tool_result(r);
				}
				if (!a.token && c.get('paperless', name) != 'inbox') return { error: 'token needed' };
				inbox_save(c, name, { owner: u, share: '', token: a.token, tags: a.tags, enabled: a.enabled });
				return { ok: true, inbox: inbox_info(c, name) };
			}
		},

		cloud: {
			call: function(req) {
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { allowed: false };
				let c = cursor(), st = cloud_status();
				let shares = [];
				c.foreach('shares', 'share', (x) => { if (cloud_local_ok(c, u, 'share:' + x['.name'], 'upload')) push(shares, x['.name']); });
				return { allowed: true, installed: st.installed, remotes: cloud_remotes(u), jobs: cloud_jobs(c, u), shares };
			}
		},

		cloud_remote_add: {
			args: { name: '', type: '', params: {}, raw: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				let r = cloud_remote_add(u, req.args);
				return r.error ? r : { ok: true, remotes: cloud_remotes(u) };
			}
		},

		cloud_auth_start: {
			args: { type: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				return cloud_auth_start(u, req.args.type);
			}
		},

		cloud_auth_finish: {
			args: { url: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				return cloud_auth_finish(u, req.args.url);
			}
		},

		cloud_remote_del: {
			args: { name: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (!match(req.args.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				let r = tool_result(sh(CLOUD + ' remote-del ' + shq(u) + ' ' + shq(req.args.name)));
				return r.error ? r : { ok: true, remotes: cloud_remotes(u) };
			}
		},

		cloud_job_set: {
			args: { name: '', remote: '', remote_path: '', local: '', mode: '', schedule: '', bwlimit: '', enabled: true },
			call: function(req) {
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				let r = cloud_job_save(c, u, req.args);
				return r.error ? r : { ok: true, jobs: cloud_jobs(cursor(), u) };
			}
		},

		cloud_job_del: {
			args: { name: '' },
			call: function(req) {
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (c.get('cloud', req.args.name) != 'job' || c.get('cloud', req.args.name, 'owner') != u) return { error: 'unknown job' };
				c.delete('cloud', req.args.name); c.commit('cloud');
				sh(CRON + ' sync');
				return { ok: true, jobs: cloud_jobs(cursor(), u) };
			}
		},

		cloud_job_run: {
			args: { name: '' },
			call: function(req) {
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (c.get('cloud', req.args.name) != 'job' || c.get('cloud', req.args.name, 'owner') != u) return { error: 'unknown job' };
				system(sprintf('mkdir -p %s; printf "state=running\\nstarted=%%s\\n" "$(date +%%s)" > %s/%s.state; start-stop-daemon -S -b -x %s -- run %s',
					CLOUD_ST, CLOUD_ST, req.args.name, CLOUD, req.args.name));
				return { started: true };
			}
		},

		ui_set: {
			// own look; null/'' = back to the look for everyone
			args: { theme: '', accent: '' },
			call: function(req) {
				let u = session_user(req), a = req.args, c = cursor();
				if (!u || u == 'root' || c.get('accounts', u) != 'user') return { error: 'session not bound' };
				if (a.theme && !(a.theme in { dark: 1, light: 1, system: 1 })) return { error: 'invalid theme' };
				if (a.accent && !(a.accent in { blue: 1, green: 1, red: 1, white: 1 })) return { error: 'invalid accent' };
				for (let k in [ 'theme', 'accent' ]) {
					if (!(k in a)) continue;
					if (a[k]) c.set('accounts', u, k, a[k]); else c.delete('accounts', u, k);
				}
				c.commit('accounts');
				return { theme: c.get('accounts', u, 'theme') ?? null, accent: c.get('accounts', u, 'accent') ?? null };
			}
		},

		passwd: {
			args: { old: '', password: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'session not bound' };
				if (!password_ok(u, req.args.old)) return { error: 'the current password is wrong' };
				return tool_result(sh_pass(sprintf('%s passwd %s', USERS, shq(u)), req.args.password));
			}
		}
	},

	'shareos.backup': {
		export: {
			args: { password: '' },
			call: function(req) {
				let b = backup_build();
				let text = sprintf('%J', b);
				let name = sprintf('shareos-%s-%s', b.host, replace(trim(sh('date +%Y%m%d-%H%M').out), /[^0-9-]/, ''));
				let pass = req.args.password ?? '';
				if (pass == '')
					return { filename: name + '.json', encrypted: false, content: text, ...backup_summary(b) };
				if (length(pass) < 6) return { error: 'the password needs at least 6 characters' };
				let r = crypt('enc', pass, text);
				if (r.error) return r;
				let wrap = { shareos_backup: 1, encrypted: true, cipher: 'AES-256-GCM, PBKDF2-SHA256', data: b64enc(r.data) };
				return { filename: name + '.json', encrypted: true, content: sprintf('%J', wrap), ...backup_summary(b) };
			}
		},

		// apply: false = only show what is inside
		restore: {
			args: { content: '', password: '', apply: false },
			call: function(req) {
				let j = json(req.args.content ?? '');
				if (type(j) != 'object' || j.shareos_backup != 1) return { error: 'not a ShareOS settings backup' };
				if (j.encrypted) {
					if (!req.args.password) return { error: 'password required', encrypted: true };
					let r = crypt('dec', req.args.password, b64dec(j.data ?? '') ?? '');
					if (r.error) return { ...r, encrypted: true };
					j = json(r.data);
					if (type(j) != 'object' || j.shareos_backup != 1) return { error: 'damaged backup' };
				}
				if (!req.args.apply) return { ok: true, preview: true, encrypted: !!req.args.password, ...backup_summary(j) };
				return backup_restore(j);
			}
		}
	},

	'shareos.paperless': {
		get: {
			call: function() {
				let c = cursor(), list = [];
				c.foreach('paperless', 'inbox', (x) => { push(list, inbox_info(c, x['.name'])); });
				return { ...paperless_global(c), inboxes: list };
			}
		},

		set_global: {
			args: { url: '', enabled: true, interval: 2, after: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.url != null && a.url != '' && !match(a.url, /^https?:\/\/[A-Za-z0-9.:\[\]_-]+(:[0-9]+)?(\/[^[:space:]]*)?$/)) return { error: 'invalid URL (http://… or https://…)' };
				if (a.interval != null && !(+a.interval >= 1 && +a.interval <= 60)) return { error: 'interval 1–60 minutes' };
				if (a.after && !(a.after in { delete: 1, keep: 1 })) return { error: 'invalid value' };
				c.set('paperless', 'global', 'global');
				if (a.url != null) c.set('paperless', 'global', 'url', replace(a.url, /\/+$/, ''));
				if (a.enabled != null) c.set('paperless', 'global', 'enabled', a.enabled ? '1' : '0');
				if (a.interval != null) c.set('paperless', 'global', 'interval', '' + int(+a.interval));
				if (a.after) c.set('paperless', 'global', 'after', a.after);
				c.commit('paperless');
				sh(CRON + ' sync');
				return paperless_global(c);
			}
		},

		test: {
			args: { url: '', token: '', inbox: '' },
			call: function(req) {
				let c = cursor(), tok = req.args.token || (req.args.inbox ? c.get('paperless', req.args.inbox, 'token') : null);
				let url = req.args.url || c.get('paperless', 'global', 'url');
				if (!url || !tok) return { error: 'URL and token needed' };
				let r = sh(sprintf("printf '%%s\\n' %s | %s test %s", shq(tok), PAPERLESS, shq(url)));
				let m = match(r.out, /ok documents=([0-9?]+)/);
				return m ? { ok: true, documents: m[1] } : tool_result(r);
			}
		},

		// admin inboxes: one per user (owner) or a shared one on a share
		inbox_set: {
			args: { name: '', owner: '', share: '', token: '', tags: [], enabled: true },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name (a-z, 0-9 and _)' };
				let exists = c.get('paperless', a.name) == 'inbox';
				if (a.owner) {
					if (c.get('accounts', a.owner) != 'user') return { error: 'unknown user' };
					if (!c.get('accounts', a.owner, 'home')) return { error: 'the user has no personal folder' };
					a.share = '';
				} else if (c.get('shares', a.share) != 'share') return { error: 'choose a share for a shared inbox' };
				if (a.token && !token_ok(a.token)) return { error: 'invalid token' };
				if (!a.token && !exists) return { error: 'token needed (Paperless → profile → API token)' };
				inbox_save(c, a.name, a);
				return { ok: true, inbox: inbox_info(c, a.name) };
			}
		},

		inbox_del: {
			args: { name: '' },
			call: function(req) {
				let c = cursor();
				if (c.get('paperless', req.args.name) != 'inbox') return { error: 'unknown inbox' };
				c.delete('paperless', req.args.name); c.commit('paperless');
				sh(CRON + ' sync');
				return { ok: true };   // the folder and its files stay
			}
		},

		run: {
			call: function() {
				system('start-stop-daemon -S -b -x ' + PAPERLESS + ' -- run');
				return { started: true };
			}
		},

		tags: {
			args: { inbox: '' },
			call: function(req) {
				if (!match(req.args.inbox ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid inbox' };
				let j = json(sh(PAPERLESS + ' tags ' + shq(req.args.inbox)).out);
				return { tags: map(j?.results ?? [], (t) => ({ id: t.id, name: t.name })) };
			}
		},

		log: {
			args: { inbox: '' },
			call: function(req) {
				let c = cursor();
				if (c.get('paperless', req.args.inbox) != 'inbox') return { error: 'unknown inbox' };
				return { entries: paperless_log(inbox_path(c, req.args.inbox), 100) };
			}
		}
	},

	'shareos.cloud': {
		status: { call: function() { return cloud_status(); } },

		install: {
			call: function() {
				let st = cloud_status();
				if (!st.apps) return { error: 'no apps area – set up a volume first (Storage)' };
				system('mkdir -p ' + CLOUD_ST + ' && echo state=installing > ' + CLOUD_ST + '/install');
				system('start-stop-daemon -S -b -x ' + CLOUD + ' -- install');
				return { started: true };
			}
		},

		remotes: { call: function() { return { remotes: cloud_remotes('-') }; } },

		remote_add: {
			args: { name: '', type: '', params: {}, raw: '' },
			call: function(req) { let r = cloud_remote_add('', req.args); return r.error ? r : { ok: true, remotes: cloud_remotes('-') }; }
		},

		auth_start: {
			args: { type: '' },
			call: function(req) { return cloud_auth_start('', req.args.type); }
		},

		auth_finish: {
			args: { url: '' },
			call: function(req) { return cloud_auth_finish('', req.args.url); }
		},

		remote_del: {
			args: { name: '' },
			call: function(req) {
				if (!match(req.args.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				let r = tool_result(sh(CLOUD + ' remote-del - ' + shq(req.args.name)));
				return r.error ? r : { ok: true, remotes: cloud_remotes('-') };
			}
		},

		remote_test: {
			args: { name: '' },
			call: function(req) {
				if (!match(req.args.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				let r = sh(CLOUD + ' remote-test - ' + shq(req.args.name));
				let m = match(r.out, /ok folders=([0-9]+)/);
				return m ? { ok: true, folders: +m[1] } : tool_result(r);
			}
		},

		jobs: { call: function() { return { jobs: cloud_jobs(cursor(), null) }; } },

		job_set: {
			args: { name: '', remote: '', remote_path: '', local: '', mode: '', schedule: '', bwlimit: '', enabled: true },
			call: function(req) {
				let c = cursor();
				// the admin edits system jobs here; a user's job keeps its owner
				let owner = c.get('cloud', req.args.name) == 'job' ? (c.get('cloud', req.args.name, 'owner') ?? '') : '';
				let r = cloud_job_save(c, owner, req.args);
				return r.error ? r : { ok: true, jobs: cloud_jobs(cursor(), null) };
			}
		},

		job_del: {
			args: { name: '' },
			call: function(req) {
				let c = cursor();
				if (c.get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				c.delete('cloud', req.args.name); c.commit('cloud');
				sh(CRON + ' sync');
				return { ok: true, jobs: cloud_jobs(cursor(), null) };
			}
		},

		job_run: {
			args: { name: '' },
			call: function(req) {
				if (cursor().get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				system(sprintf('mkdir -p %s; printf "state=running\\nstarted=%%s\\n" "$(date +%%s)" > %s/%s.state; start-stop-daemon -S -b -x %s -- run %s',
					CLOUD_ST, CLOUD_ST, req.args.name, CLOUD, req.args.name));
				return { started: true };
			}
		},

		job_stop: {
			args: { name: '' },
			call: function(req) {
				if (cursor().get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				return tool_result(sh(CLOUD + ' stop ' + shq(req.args.name)));
			}
		},

		job_log: {
			args: { name: '' },
			call: function(req) {
				let c = cursor();
				if (c.get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				return { lines: cloud_log(c, req.args.name, 80) };
			}
		}
	},

	// called only by /_shareos/cgi/vpn on the apps web server (as root, with
	// the grant of an app with the permission "vpn"; admin accounts only)
	// called only by /_shareos/cgi/tailscale on the apps web server (grant of an
	// app with the permission "tailscale"; admin accounts only)
	'shareos.apptailscale': {
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'log' ]) : { error: 'no access' }; } },
		up: {
			args: { grant: '', authkey: '' },
			call: function(req) {
				if (!app_grant_perm(req.args.grant, 'tailscale')) return { error: 'no access' };
				return ts_tool([ 'up' ], { authkey: req.args.authkey ?? '' });
			}
		},
		login: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'login' ]) : { error: 'no access' }; } },
		down: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'down' ]) : { error: 'no access' }; } },
		logout: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'logout' ]) : { error: 'no access' }; } },
		ping: { args: { grant: '', ip: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'ping', req.args.ip ?? '' ]) : { error: 'no access' }; } }
	},

	'shareos.appvpn': {
		list: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'list' ]) : { error: 'no access' }; } },
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'log' ]) : { error: 'no access' }; } },
		disconnect: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'disconnect' ]) : { error: 'no access' }; } },
		import: {
			args: { grant: '', name: '', text: '', user: '', pass: '', full: true },
			call: function(req) {
				let a = req.args;
				if (!app_grant_perm(a.grant, 'vpn')) return { error: 'no access' };
				return vpn_tool([ 'import', a.name ?? '' ], { text: a.text, user: a.user, pass: a.pass, full: a.full !== false });
			}
		},
		set: {
			args: { grant: '', name: '', autostart: false, full: true, user: '', pass: '' },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'vpn')) return { error: 'no access' };
				for (let k in [ 'autostart', 'full', 'user', 'pass' ]) if (a[k] != null) i[k] = a[k];
				return vpn_tool([ 'set', a.name ?? '' ], i);
			}
		},
		remove: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'remove', req.args.name ?? '' ]) : { error: 'no access' }; } },
		connect: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'connect', req.args.name ?? '' ]) : { error: 'no access' }; } },
		// server: devices connect to the box
		server_status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'server-status' ]) : { error: 'no access' }; } },
		server_log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'server-log' ]) : { error: 'no access' }; } },
		server_set: {
			args: { grant: '', enabled: false, port: 0, proto: '', net: '', host: '', lan: false },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'vpn')) return { error: 'no access' };
				for (let k in [ 'enabled', 'port', 'proto', 'net', 'host', 'lan' ]) if (a[k] != null) i[k] = a[k];
				return vpn_tool([ 'server-set' ], i);
			}
		},
		device_add: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'device-add', req.args.name ?? '' ]) : { error: 'no access' }; } },
		device_profile: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'device-profile', req.args.name ?? '' ]) : { error: 'no access' }; } },
		device_remove: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'device-remove', req.args.name ?? '' ]) : { error: 'no access' }; } }
	},

	// called only by /_shareos/cgi/status (apps with the permission "status")
	'shareos.appstatus': {
		set: {
			args: { grant: '', text: '', state: '', ttl: 0 },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'status'), a = req.args;
				if (!g) return { error: 'no access' };
				let text = trim('' + (a.text ?? ''));
				if (text == '' || length(text) > 24 || match(text, /[[:cntrl:]<>]/)) return { error: 'invalid text (1–24 characters)' };
				let st = a.state || 'info';
				if (!CHIP_STATES[st]) return { error: 'invalid state (ok, warn, err, info)' };
				let ttl = int(+(a.ttl || 300));
				if (!(ttl >= 10 && ttl <= 600)) return { error: 'invalid ttl (10–600 seconds)' };
				system('mkdir -p ' + APPSTATUS + ' && chmod 711 ' + APPSTATUS + ' && mkdir -p ' + shq(APPSTATUS + '/' + g.u));
				writefile(APPSTATUS + '/' + g.u + '/' + g.app.id + '.json', sprintf('%J\n', { text, state: st, until: time() + ttl }));
				return { ok: true, until: time() + ttl };
			}
		},
		clear: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'status');
				if (!g) return { error: 'no access' };
				unlink(APPSTATUS + '/' + g.u + '/' + g.app.id + '.json');
				return { ok: true };
			}
		}
	},

	'shareos.dlna': {
		status: { call: function() { return dlna_status(); } },

		// enabled, name, media: [{share, type: A|V|P|-}]
		set: {
			args: { enabled: false, name: '', media: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				let name = trim(a.name ?? '');
				if (length(name) > 48 || match(name, /[\n\r=]/)) return { error: 'invalid name' };
				let shares = map(share_list().shares, (x) => x.name), list = [], seen = {};
				for (let m in (type(a.media) == 'array' ? a.media : [])) {
					if (type(m) != 'object' || !(m.type in DLNA_TYPES) || index(shares, m.share) < 0) return { error: 'invalid folder' };
					if (seen[m.share]) continue;
					seen[m.share] = 1;
					push(list, m.type + ',share:' + m.share);
				}
				c.set('dlna', 'main', 'dlna');
				c.set('dlna', 'main', 'enabled', a.enabled === true ? '1' : '0');
				c.set('dlna', 'main', 'name', name);
				c.delete('dlna', 'main', 'media');
				if (length(list)) c.set('dlna', 'main', 'media', list);
				c.commit('dlna');
				let r = sh(DLNA + (a.enabled === true ? ' restart' : ' stop'));
				let m = match(r.out, /error: ([^\n]*)/);
				if (m || r.rc != 0) return { error: m ? m[1] : (trim(r.out) || 'failed') };
				return dlna_status();
			}
		},

		rescan: {
			call: function() {
				if (cursor().get('dlna', 'main', 'enabled') != '1') return { error: 'the media server is switched off' };
				let r = sh(DLNA + ' rescan');
				let m = match(r.out, /error: ([^\n]*)/);
				return m ? { error: m[1] } : dlna_status();
			}
		}
	},

	// chips in the header of the interface: services and apps of the account
	'shareos.status': {
		chips: {
			call: function(req) {
				let u = session_user(req);
				return u ? { chips: status_chips(u) } : { chips: [] };
			}
		}
	},

	'shareos.snapshots': {
		status: {
			call: function() {
				let src = snap_tool([ 'sources' ]);
				return { jobs: snap_jobs(), volumes: src.volumes ?? [], sources: src.sources ?? [], rsync: stat('/usr/bin/rsync') != null };
			}
		},

		job_set: {
			args: { name: '', new: false, source: '', target: '', every: '', time: '', keep_last: 0, keep_daily: 0, keep_weekly: 0,
				keep_monthly: 0, exclude: [], enabled: true },
			call: function(req) {
				let r = snap_save(req.args);
				return r.error ? r : { ok: true, jobs: snap_jobs() };
			}
		},

		// data: also remove the snapshots of the job (in the background)
		job_del: {
			args: { name: '', data: false },
			call: function(req) {
				let n = req.args.name, c = cursor();
				if (!match(n ?? '', SNAP_JOB_RE) || c.get('snapshots', n) != 'job') return { error: 'unknown job' };
				if (snap_running(n)) return { error: 'the snapshot is running – stop it first' };
				if (req.args.data === true) {
					let r = sh(SNAP + ' purge ' + shq(n));
					if (r.rc != 0) return { error: trim(r.out) || 'failed' };
				}
				c.delete('snapshots', n); c.commit('snapshots');
				sh(CRON + ' sync');
				return { ok: true, jobs: snap_jobs() };
			}
		},

		run: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name;
				if (!match(n ?? '', SNAP_JOB_RE) || cursor().get('snapshots', n) != 'job') return { error: 'unknown job' };
				if (snap_running(n)) return { error: 'already running' };
				system('start-stop-daemon -S -b -x ' + SNAP + ' -- run ' + shq(n));
				// the worker writes its pid at once; show "running" right away
				for (let i = 0; i < 20 && !snap_running(n); i++) system('sleep 0.1');
				return { started: true };
			}
		},

		stop: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name;
				if (!match(n ?? '', SNAP_JOB_RE) || cursor().get('snapshots', n) != 'job') return { error: 'unknown job' };
				return snap_tool([ 'stop', n ]);
			}
		},

		remove: {
			args: { name: '', snapshot: '' },
			call: function(req) {
				let n = req.args.name;
				if (!match(n ?? '', SNAP_JOB_RE) || cursor().get('snapshots', n) != 'job') return { error: 'unknown job' };
				let r = snap_tool([ 'delete', n, req.args.snapshot ?? '' ]);
				return r.error ? r : { ok: true, jobs: snap_jobs() };
			}
		},

		log: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name, c = cursor();
				if (!match(n ?? '', SNAP_JOB_RE) || c.get('snapshots', n) != 'job') return { error: 'unknown job' };
				let t = readfile('/mnt/' + (c.get('snapshots', n, 'target') ?? '-') + '/Snapshots/' + n + '/.log') ?? '';
				return { log: length(t) > 16384 ? substr(t, length(t) - 16384) : t };
			}
		}
	},

	'shareos.files': {
		roots: {
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return { roots: map(files_roots(u), (r) => ({ name: r.name, home: r.home, ro: !!r.ro })) };
			}
		},

		list: {
			args: { root: '', path: '', hidden: false },
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return files_list(u, req.args.root, req.args.path, req.args.hidden === true);
			}
		},

		mkdir: {
			args: { root: '', path: '', name: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = files_wpath(u, a.root, a.path, 'dir');
				if (p.error) return p;
				let r = files_sh(u, 'mkdir -- ' + shq(p.abs + '/' + a.name), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		rename: {
			args: { root: '', path: '', name: '', to: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name) || !name_ok(a.to)) return { error: 'invalid name' };
				let p = files_wpath(u, a.root, a.path, 'dir');
				if (p.error) return p;
				if (lstat(p.abs + '/' + a.to)) return { error: 'already exists' };
				let r = files_sh(u, sprintf('mv -- %s %s', shq(p.abs + '/' + a.name), shq(p.abs + '/' + a.to)), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		move: {
			// names from one folder into another folder of the same root; copy: keep the originals
			args: { root: '', path: '', names: [], dest: '', copy: false },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (type(a.names) != 'array' || !length(a.names)) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let p = a.copy ? files_path(u, a.root, a.path, 'dir') : files_wpath(u, a.root, a.path, 'dir'), d = files_wpath(u, a.root, a.dest, 'dir');
				if (p.error) return p;
				if (d.error) return d;
				for (let n in a.names) {
					let src = (p.rel != '' ? p.rel + '/' : '') + n;
					if (d.rel == src || index(d.rel + '/', src + '/') == 0) return { error: 'a folder cannot be moved into itself' };
					if (lstat(d.abs + '/' + n)) return { error: 'already exists: ' + n };
				}
				let r = files_sh(u, sprintf('%s -- %s %s', a.copy ? 'cp -a' : 'mv', join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), shq(d.abs + '/')), d.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		delete: {
			args: { root: '', path: '', names: [] },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (type(a.names) != 'array' || !length(a.names)) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let p = files_wpath(u, a.root, a.path, 'dir');
				if (p.error) return p;
				let r = files_sh(u, 'rm -rf -- ' + join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		ticket: {
			// one-time address for /cgi-bin/files: get = download a file,
			// put = upload into path/name (overwrite: replace an existing file)
			args: { root: '', path: '', name: '', mode: 'get', overwrite: false },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = a.mode == 'put' ? files_wpath(u, a.root, a.path, 'dir') : files_path(u, a.root, a.path, 'dir');
				if (p.error) return p;
				let target = p.abs + '/' + a.name, st = lstat(target);
				if (a.mode == 'get') { if (st?.type != 'file') return { error: 'not a file' }; }
				else if (a.mode == 'put') { if (st && (!a.overwrite || st.type != 'file')) return { error: 'already exists' }; }
				else return { error: 'invalid mode' };
				system('mkdir -p ' + FILES_TICKETS + ' && chmod 700 ' + FILES_TICKETS);
				system('find ' + FILES_TICKETS + ' -type f -mmin +5 -delete 2>/dev/null');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('%s\n%s\n%s\n%d\n%s\n', a.mode, acc_role(u) == 'admin' ? 'root' : u, target, time() + 120, pct_enc(a.name)));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		// apps that open files (manifest "opens") for this account
		openers: {
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return { ...apps_server(), apps: map(filter(apps_for(u), (a) => length(a.opens ?? []) > 0),
					(a) => ({ id: a.id, name: a.name, entry: a.entry, icon: a.icon, window: a.window, opens: a.opens })) };
			}
		},

		// open a file in an app: a ticket for the apps web server
		// (/_shareos/cgi/file), bound to this file, this app and this account
		app_ticket: {
			args: { root: '', path: '', name: '', app: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let app = filter(apps_for(u), (x) => x.id == a.app)[0];
				if (!app) return { error: 'app not available' };
				let m = match(lc(a.name), /(\.[a-z0-9]{1,10})$/), mode = null;
				for (let o in app.opens ?? [])
					if (m && index(o.ext, m[1]) >= 0 && mode != 'edit') mode = o.mode;
				if (!mode) return { error: 'the app does not open this file type' };
				let p = files_path(u, a.root, a.path, 'dir');
				if (p.error) return p;
				let target = p.abs + '/' + a.name;
				if (lstat(target)?.type != 'file') return { error: 'not a file' };
				if (p.root.ro) mode = 'view';
				system('mkdir -p ' + APP_TICKETS + ' && chmod 700 ' + APP_TICKETS);
				system('find ' + APP_TICKETS + ' -type f -mmin +480 -delete 2>/dev/null');
				let t = new_token();
				writefile(APP_TICKETS + '/' + t, sprintf('%s\n%s\n%s\n%d\n%s\n%s\n', mode, acc_role(u) == 'admin' ? 'root' : u, target, time() + 8 * 3600, app.id, pct_enc(a.name)));
				return { ticket: t, mode, app: app.id, entry: app.entry, window: app.window, ...apps_server(),
					grant: app_has_files(app) ? app_grant_new(u, app) : null };
			}
		},

		// an app with the permission "files" is opened: its grant for /_shareos/cgi/fs
		app_grant: {
			args: { app: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				let app = filter(apps_for(u), (x) => x.id == req.args.app)[0];
				if (!app) return { error: 'app not available' };
				if (!app_has_files(app)) return { error: 'the app has no access to files' };
				return { grant: app_grant_new(u, app) };
			}
		}
	},

	// called only by /_shareos/cgi/media on the apps web server (as root, over
	// the local ubus socket); no web session has this object in its ACL.
	// Media jobs of the account (ffmpeg), for apps with "files" + "media".
	'shareos.appmedia': {
		probe: {
			args: { grant: '', root: '', path: '', name: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				let f = media_file(g.u, req.args);
				return f.error ? f : media_probe(g.u, f.abs);
			}
		},

		// action "remux": other container (format mp4/mkv/mov/ts/webm), no re-encoding;
		// action "audio": one audio track (stream = number among the audio tracks) as
		// mp3/m4a/opus/flac/wav (bitrate for the lossy ones) or "copy" (as it is);
		// start/duration (HH:MM:SS or seconds) cut without re-encoding
		start: {
			args: { grant: '', input: {}, output: {}, action: '', format: '', bitrate: '', stream: 0, start: '', duration: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant), a = req.args;
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				if (length(filter(media_jobs(g.u), (j) => j.state == 'queued' || j.state == 'running' || j.state == 'stopping')) >= MEDIA_MAX_QUEUED)
					return { error: 'too many jobs waiting' };
				let inp = media_file(g.u, a.input);
				if (inp.error) return inp;
				let info = media_probe(g.u, inp.abs);
				if (info.error) return info;
				let ss = media_time(a.start), dur = media_time(a.duration);
				if (ss === false || dur === false) return { error: 'invalid time' };
				let seek = [ ...(ss ? [ '-ss', ss ] : []), ...(dur ? [ '-t', dur ] : []) ];
				let ext, args;
				if (a.action == 'remux') {
					ext = MEDIA_REMUX[a.format];
					if (!ext) return { error: 'invalid format' };
					args = [ ...seek, '-i', inp.abs, '-map', '0:v?', '-map', '0:a?', ...(ext == 'mkv' ? [ '-map', '0:s?' ] : []), '-c', 'copy',
						...(ext == 'mp4' || ext == 'mov' ? [ '-movflags', '+faststart' ] : []) ];
				} else if (a.action == 'audio') {
					let auds = filter(info.streams, (x) => x.type == 'audio');
					let n = +(a.stream ?? 0);
					if (!(n >= 0 && n < length(auds))) return { error: 'no such audio track' };
					let codec = auds[n].codec;
					let hint = codec == 'aac' ? [ '-c:a', 'aac_fixed' ] : codec == 'ac3' ? [ '-c:a', 'ac3_fixed' ] : [];
					if (a.format == 'copy') {
						ext = MEDIA_COPY_EXT[codec] ?? (match(codec ?? '', /^pcm_/) ? 'wav' : 'mka');
						args = [ ...seek, '-i', inp.abs, '-map', '0:a:' + n, '-vn', '-sn', '-c:a', 'copy' ];
					} else {
						let fm = MEDIA_AUDIO[a.format];
						if (!fm) return { error: 'invalid format' };
						ext = fm[0];
						let br = a.bitrate || '192k';
						if (ext != 'flac' && ext != 'wav' && !MEDIA_BITRATES[br]) return { error: 'invalid bitrate' };
						args = [ ...hint, ...seek, '-i', inp.abs, '-map', '0:a:' + n, '-vn', '-sn', '-c:a', fm[1],
							...(ext == 'flac' || ext == 'wav' ? [] : [ '-b:a', br ]) ];
					}
				} else return { error: 'invalid action' };
				// output: a folder of the account and a name; the extension follows the format
				let o = a.output ?? {};
				let base = replace(o.name ?? '', /\.[A-Za-z0-9]{1,5}$/, '');
				if (!name_ok(base + '.' + ext) || substr(base, 0, 1) == '.') return { error: 'invalid name' };
				let od = files_wpath(g.u, o.root, o.path, 'dir');
				if (od.error) return od;
				let dir = realpath(od.abs), name = base + '.' + ext;
				if (lstat(dir + '/' + name)) return { error: 'output file exists' };
				let id = substr(new_token(), 0, 16);
				let total = dur ? media_secs(dur) : (info.duration - (ss ? media_secs(ss) : 0));
				let job = { id, user: g.u, run_as: acc_role(g.u) == 'admin' ? 'root' : g.u, action: a.action, format: a.format,
					input: inp.abs, output: dir + '/' + name, tmp: dir + '/.' + base + '.' + id + '.' + ext,
					input_box: { root: a.input.root, path: a.input.path ?? '', name: a.input.name },
					output_box: { root: o.root, path: od.rel, name }, duration: total > 0 ? total : 0,
					args, state: 'queued', created: time() };
				push(job.args, job.tmp);
				system('mkdir -p ' + MEDIA_DIR + ' && chmod 700 /tmp/shareos-media ' + MEDIA_DIR);
				writefile(MEDIA_DIR + '/' + id + '.json', sprintf('%J\n', job));
				system('start-stop-daemon -S -b -x /usr/sbin/shareos-media -- run');
				return { id, output: job.output_box };
			}
		},

		jobs: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				return { jobs: media_jobs(g.u), installed: stat('/opt/shareos/bin/ffmpeg')?.type == 'file' };
			}
		},

		cancel: {
			args: { grant: '', id: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				if (!match(req.args.id ?? '', /^[0-9a-f]{16}$/)) return { error: 'invalid job' };
				let f = MEDIA_DIR + '/' + req.args.id + '.json', j = json(readfile(f) ?? 'null');
				if (type(j) != 'object' || j.user != g.u) return { error: 'unknown job' };
				if (j.state == 'queued' || j.state == 'running') {
					// the worker sees the stop file, ends ffmpeg and removes the half file;
					// the job is "stopping" until then
					writefile(MEDIA_DIR + '/' + j.id + '.stop', '');
					if (j.state == 'queued') { j.state = 'cancelled'; j.finished = time(); }
					else j.state = 'stopping';
					writefile(f, sprintf('%J\n', j));
					system("pkill -f '[/]bin/ffmpeg .*\\." + j.id + "\\.'");
				}
				return { ok: true };
			}
		},

		remove: {
			args: { grant: '', id: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				if (!match(req.args.id ?? '', /^[0-9a-f]{16}$/)) return { error: 'invalid job' };
				let j = json(readfile(MEDIA_DIR + '/' + req.args.id + '.json') ?? 'null');
				if (type(j) != 'object' || j.user != g.u) return { error: 'unknown job' };
				if (j.state == 'queued' || j.state == 'running' || j.state == 'stopping') return { error: 'job still running' };
				for (let x in [ '.json', '.log', '.stop' ]) unlink(MEDIA_DIR + '/' + j.id + x);
				return { ok: true };
			}
		}
	},

	// called only by /_shareos/cgi/transmission on the apps web server (as root,
	// over the local ubus socket); no web session has this object in its ACL.
	// The account's own Transmission daemon, for apps with "files" + "torrent".
	'shareos.apptorrent': {
		session: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'torrent') < 0) return { error: 'no access' };
				let st = json(sh('/usr/sbin/shareos-transmission status ' + shq(g.u)).out ?? '') ?? {};
				if (!st.running) {
					let r = sh('/usr/sbin/shareos-transmission start ' + shq(g.u));
					st = json(r.out ?? '') ?? { error: trim(r.out) || 'cannot start' };
					if (st.error) return { error: st.error, installed: st.installed };
				}
				return { user: g.u, socket: st.socket,
					roots: map(files_roots(g.u), (r) => ({ name: r.name, path: realpath(r.path) ?? r.path, home: !!r.home })) };
			}
		},

		// a folder of the account (root + relative path) -> absolute path for the daemon
		path: {
			args: { grant: '', root: '', path: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'torrent') < 0) return { error: 'no access' };
				let p = files_wpath(g.u, req.args.root, req.args.path, 'dir');
				if (p.error) return p;
				return { path: realpath(p.abs) };
			}
		}
	},

	// called only by /_shareos/cgi/fs on the apps web server (as root, over the
	// local ubus socket); no web session has this object in its ACL
	'shareos.appfs': {
		roots: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g) return { error: 'no access' };
				return { roots: map(files_roots(g.u), (r) => ({ name: r.name, home: r.home, usb: !!r.usb, ro: !!r.ro })), user: g.u };
			}
		},

		list: {
			args: { grant: '', root: '', path: '', hidden: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g) return { error: 'no access' };
				return files_list(g.u, req.args.root, req.args.path, req.args.hidden === true);
			}
		},

		mkdir: {
			args: { grant: '', root: '', path: '', name: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = files_wpath(g.u, a.root, a.path, 'dir');
				if (p.error) return p;
				let r = files_sh(g.u, 'mkdir -- ' + shq(p.abs + '/' + a.name), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		rename: {
			args: { grant: '', root: '', path: '', name: '', to: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name) || !name_ok(a.to)) return { error: 'invalid name' };
				let p = files_wpath(g.u, a.root, a.path, 'dir');
				if (p.error) return p;
				if (!lstat(p.abs + '/' + a.name)) return { error: 'not found' };
				if (lstat(p.abs + '/' + a.to)) return { error: 'already exists' };
				let r = files_sh(g.u, sprintf('mv -- %s %s', shq(p.abs + '/' + a.name), shq(p.abs + '/' + a.to)), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		// names from one folder into another (also of another root); copy keeps the originals
		move: {
			args: { grant: '', root: '', path: '', names: [], dest_root: '', dest: '', copy: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant), a = req.args;
				if (!g) return { error: 'no access' };
				if (type(a.names) != 'array' || !length(a.names) || length(a.names) > 1000) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let droot = a.dest_root || a.root;
				let p = a.copy ? files_path(g.u, a.root, a.path, 'dir') : files_wpath(g.u, a.root, a.path, 'dir'), d = files_wpath(g.u, droot, a.dest, 'dir');
				if (p.error) return p;
				if (d.error) return d;
				for (let n in a.names) {
					if (!lstat(p.abs + '/' + n)) return { error: 'not found: ' + n };
					let src = (p.rel != '' ? p.rel + '/' : '') + n;
					if (droot == a.root && (d.rel == src || index(d.rel + '/', src + '/') == 0)) return { error: 'a folder cannot be moved into itself' };
					if (lstat(d.abs + '/' + n)) return { error: 'already exists: ' + n };
				}
				let r = files_sh(g.u, sprintf('%s -- %s %s', a.copy ? 'cp -a' : 'mv', join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), shq(d.abs + '/')), d.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		delete: {
			args: { grant: '', root: '', path: '', names: [] },
			call: function(req) {
				let g = app_grant_user(req.args.grant), a = req.args;
				if (!g) return { error: 'no access' };
				if (type(a.names) != 'array' || !length(a.names) || length(a.names) > 1000) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let p = files_wpath(g.u, a.root, a.path, 'dir');
				if (p.error) return p;
				let r = files_sh(g.u, 'rm -rf -- ' + join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		// a file ticket for /_shareos/cgi/file: read, or write (create: also a new file)
		open: {
			args: { grant: '', root: '', path: '', name: '', write: false, create: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = a.write ? files_wpath(g.u, a.root, a.path, 'dir') : files_path(g.u, a.root, a.path, 'dir');
				if (p.error) return p;
				let target = p.abs + '/' + a.name, st = lstat(target);
				if (st ? st.type != 'file' : !(a.write && a.create)) return { error: st ? 'not a file' : 'not found' };
				system('mkdir -p ' + APP_TICKETS + ' && chmod 700 ' + APP_TICKETS);
				system('find ' + APP_TICKETS + ' -type f -mmin +480 -delete 2>/dev/null');
				let t = new_token(), mode = a.write ? 'edit' : 'view';
				writefile(APP_TICKETS + '/' + t, sprintf('%s\n%s\n%s\n%d\n%s\n%s\n', mode, acc_role(g.u) == 'admin' ? 'root' : g.u, target, time() + 8 * 3600, g.app.id, pct_enc(a.name)));
				return { ticket: t, mode, name: a.name, size: st ? st.size : 0, exists: !!st };
			}
		}
	},

	'shareos.apps': {
		installed: {
			call: function() { return { ...apps_server(), apps: apps_list().apps ?? [] }; }
		},

		catalog: {
			// refresh: ask the catalog sources (network) in the background – rpcd
			// answers one call at a time and a slow source would block the whole
			// interface. The answer is the last result; "refreshing" stays true
			// until the new one is there (the interface asks again).
			args: { refresh: false },
			call: function(req) {
				let lock = '/tmp/shareos-apps/catalog.lock', st = stat(lock);
				if (st && time() - st.mtime > 120) { unlink(lock); st = null; }     // left over
				if (req.args.refresh && !st) {
					system('mkdir -p /tmp/shareos-apps');
					writefile(lock, '' + time());
					system(sprintf('(%s catalog; rm -f %s) >/dev/null 2>&1 </dev/null &', APPS_TOOL, lock));
				}
				let A = '/tmp/shareos-apps/';
				let r = memo('catalog', fstamp(A + 'catalogs.json', A + 'catalog-time', A + 'catalog-errors.json', '/etc/config/apps', '/etc/shareos-release')
					+ '|' + fstamp('/www-apps', '/opt/shareos/sysapps'), 30, () => apps_json([ 'cached' ]));
				r = { ...r, refreshing: !!stat(lock) };
				return r;
			}
		},

		install: {
			args: { id: '', version: '' },
			call: function(req) {
				let a = req.args;
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/)) return { error: 'invalid app id' };
				if (a.version && !match(a.version, /^v?[0-9]+\.[0-9]+(\.[0-9]+)?(-[A-Za-z0-9.]+)?$/)) return { error: 'invalid version' };
				system('mkdir -p /tmp/shareos-apps && printf \'{"state":"downloading","id":"%s"}\' ' + shq(a.id) + ' > /tmp/shareos-apps/job.json');
				system('start-stop-daemon -S -b -x ' + APPS_TOOL + ' -- install ' + shq(a.id) + (a.version ? ' ' + shq(a.version) : ''));
				return { started: true };
			}
		},

		status: { call: function() { return apps_json([ 'status' ]); } },

		upload_ticket: {
			// one-time address: the browser sends the .sapp file there (cgi-bin/files)
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-apps && chmod 700 ' + FILES_TICKETS + '; rm -f ' + APPS_UPLOAD);
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n%s\n%d\nupload.sapp\n', APPS_UPLOAD, time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		install_upload: {
			call: function() {
				if (!stat(APPS_UPLOAD)) return { error: 'no uploaded package' };
				let r = apps_json([ 'install-file', APPS_UPLOAD ]);
				unlink(APPS_UPLOAD);
				return r;
			}
		},

		remove: {
			// force: also when another installed app needs it ("requires")
			args: { id: '', force: false },
			call: function(req) {
				if (!match(req.args.id ?? '', /^[a-z][a-z0-9-]{1,31}$/)) return { error: 'invalid app id' };
				return apps_json(req.args.force === true ? [ 'remove', req.args.id, '--force' ] : [ 'remove', req.args.id ]);
			}
		},

		set: {
			// users: '*' (everyone with web access), user names, '@group';
			// display: 'page' (in the ShareOS page, apps with "embed") or 'window'
			args: { id: '', users: [], display: '' },
			call: function(req) {
				let a = req.args, c = cursor(), s = 'app_' + replace(a.id ?? '', '-', '_');
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || c.get('apps', s) != 'app') return { error: 'unknown app' };
				if (a.display != null) {
					if (!(a.display in { page: 1, window: 1 })) return { error: 'invalid display' };
					c.set('apps', s, 'display', a.display);
				}
				if (a.users != null) {
					if (type(a.users) != 'array') return { error: 'invalid users' };
					for (let x in a.users) {
						if (x == '*') continue;
						if (substr(x, 0, 1) == '@' ? c.get('accounts', substr(x, 1)) != 'group' : c.get('accounts', x) != 'user') return { error: 'unknown user or group: ' + x };
					}
					c.delete('apps', s, 'users');
					if (length(a.users)) c.set('apps', s, 'users', a.users);
				}
				c.commit('apps');
				return { ok: true };
			}
		},

		// scheduled task of an app: schedule (cron time, at most every 5 min) and on/off
		job_set: {
			args: { id: '', job: '', schedule: '', enabled: true },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || !match(a.job ?? '', /^[a-z][a-z0-9-]{0,23}$/)) return { error: 'invalid app or job' };
				let s = 'job_' + replace(a.id, '-', '_') + '__' + replace(a.job, '-', '_');
				if (c.get('apps', s) != 'appjob') return { error: 'unknown job' };
				if (a.schedule != null && a.schedule != '') {
					let min = split(a.schedule, ' ')[0], m = match(min, /^\*\/([0-9]+)$/);
					if (!match(a.schedule, /^[0-9*\/,-]+( [0-9*\/,-]+){4}$/) || min == '*' || (m && +m[1] < 5))
						return { error: 'invalid schedule (cron time, at most every 5 minutes)' };
					if (a.schedule != c.get('apps', s, 'schedule')) { c.set('apps', s, 'schedule', a.schedule); c.set('apps', s, 'custom', '1'); }
				}
				if (a.enabled != null) c.set('apps', s, 'enabled', a.enabled ? '1' : '0');
				c.commit('apps');
				system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
				return { ok: true };
			}
		},

		// run a scheduled task now (in the background)
		job_run: {
			args: { id: '', job: '' },
			call: function(req) {
				let a = req.args;
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || !match(a.job ?? '', /^[a-z][a-z0-9-]{0,23}$/)) return { error: 'invalid app or job' };
				system('start-stop-daemon -S -b -x ' + APPS_TOOL + ' -- run-job ' + shq(a.id) + ' ' + shq(a.job));
				return { started: true };
			}
		},

		job_log: {
			args: { id: '', job: '' },
			call: function(req) {
				let a = req.args;
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || !match(a.job ?? '', /^[a-z][a-z0-9-]{0,23}$/)) return { error: 'invalid app or job' };
				return apps_json([ 'job-log', a.id, a.job ]);
			}
		},

		store_get: {
			call: function() {
				let c = cursor(), src = c.get('apps', 'store', 'source');
				return { channel: c.get('apps', 'store', 'channel') ?? 'stable', sources: type(src) == 'array' ? src : (src ? [ src ] : []), ...apps_server() };
			}
		},

		store_set: {
			args: { channel: '', sources: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.channel && !(a.channel in { stable: 1, beta: 1 })) return { error: 'invalid channel' };
				if (a.sources != null) {
					if (type(a.sources) != 'array' || length(a.sources) > 10) return { error: 'invalid sources' };
					for (let u in a.sources)
						if (!match(u, /^https:\/\/[A-Za-z0-9.:\[\]_-]+(\/[^[:space:]"'<>]*)?$/)) return { error: 'invalid source (https://… only): ' + u };
				}
				c.set('apps', 'store', 'store');
				if (a.channel) c.set('apps', 'store', 'channel', a.channel);
				if (a.sources != null) { c.delete('apps', 'store', 'source'); if (length(a.sources)) c.set('apps', 'store', 'source', a.sources); }
				c.commit('apps');
				return { ok: true };
			}
		}
	},

	'shareos.notify': {
		list: {
			call: function() { return notify_json([ 'list' ]); }
		},
		// id or "all"
		read: {
			args: { id: '' },
			call: function(req) {
				let id = req.args.id || 'all';
				if (id != 'all' && !match(id, /^[0-9a-f]{1,32}$/)) return { error: 'invalid id' };
				return notify_json([ 'read', id ]);
			}
		},
		delete: {
			args: { id: '' },
			call: function(req) {
				let id = req.args.id || 'all';
				if (id != 'all' && !match(id, /^[0-9a-f]{1,32}$/)) return { error: 'invalid id' };
				return notify_json([ 'delete', id ]);
			}
		},
		get: {
			call: function() { return notify_settings(); }
		},
		// smtp_pass / push_token: null = keep, '' = remove
		set: {
			args: { email: false, smtp_host: '', smtp_tls: '', smtp_port: '', smtp_user: '', smtp_pass: '', mail_from: '', mail_to: '', email_level: '',
				push: false, push_type: '', push_url: '', push_token: '', push_chat: '', push_level: '', temp_max: 55, disk_full: 90 },
			call: function(req) {
				let a = req.args, c = cursor();
				let mail = (x) => x == null || x == '' || match(x, /^[^@[:space:],;]+@[^@[:space:],;]+$/);
				if (a.smtp_host != null && a.smtp_host != '' && !match(a.smtp_host, /^[A-Za-z0-9.-]{1,253}$/)) return { error: 'invalid mail server' };
				if (a.smtp_tls != null && a.smtp_tls != '' && !(a.smtp_tls in { starttls: 1, ssl: 1, none: 1 })) return { error: 'invalid encryption' };
				if (a.smtp_port != null && a.smtp_port != '' && !(match('' + a.smtp_port, /^[0-9]+$/) && +a.smtp_port >= 1 && +a.smtp_port <= 65535)) return { error: 'invalid port' };
				if (!mail(a.mail_from)) return { error: 'invalid sender address' };
				for (let r in split(a.mail_to ?? '', /[ ,;]+/)) if (length(r) && !mail(r)) return { error: 'invalid recipient: ' + r };
				for (let k in [ 'email_level', 'push_level' ]) if (a[k] != null && a[k] != '' && !(a[k] in { info: 1, warn: 1, error: 1 })) return { error: 'invalid level' };
				if (a.push_type != null && a.push_type != '' && !(a.push_type in { ntfy: 1, gotify: 1, telegram: 1, webhook: 1 })) return { error: 'invalid push service' };
				if (a.push_chat != null && a.push_chat != '' && !match('' + a.push_chat, /^-?[0-9]{1,20}$|^@[A-Za-z0-9_]{5,32}$/)) return { error: 'invalid chat ID' };
				if (a.push_url != null && a.push_url != '' && !match(a.push_url, /^https?:\/\/[^[:space:]'"]{3,250}$/)) return { error: 'invalid push address' };
				if (a.temp_max != null && !(+a.temp_max >= 40 && +a.temp_max <= 70)) return { error: 'temperature limit: 40 … 70 °C' };
				if (a.disk_full != null && !(+a.disk_full >= 50 && +a.disk_full <= 99)) return { error: 'full limit: 50 … 99 %' };
				for (let k in [ 'smtp_user', 'smtp_pass', 'push_token' ]) if (a[k] != null && match(a[k], /[\n\r]/)) return { error: 'invalid characters' };
				if (c.get('shareos', 'notify') != 'notify') c.set('shareos', 'notify', 'notify');
				for (let k in [ 'smtp_host', 'smtp_tls', 'smtp_port', 'smtp_user', 'mail_from', 'mail_to', 'email_level', 'push_type', 'push_url', 'push_chat', 'push_level' ])
					if (a[k] != null) c.set('shareos', 'notify', k, '' + a[k]);
				for (let k in [ 'smtp_pass', 'push_token' ]) if (a[k] != null) c.set('shareos', 'notify', k, a[k]);
				if (a.email != null) c.set('shareos', 'notify', 'email', a.email ? '1' : '0');
				if (a.push != null) c.set('shareos', 'notify', 'push', a.push ? '1' : '0');
				if (a.temp_max != null) c.set('shareos', 'notify', 'temp_max', '' + int(a.temp_max));
				if (a.disk_full != null) c.set('shareos', 'notify', 'disk_full', '' + int(a.disk_full));
				c.commit('shareos');
				return notify_settings();
			}
		},
		test: {
			call: function() { return notify_json([ 'test' ]); }
		},
		telegram_chats: {
			call: function() { return notify_json([ 'telegram-chats' ]); }
		}
	},

	'shareos.widget': {
		get: {
			call: function() {
				let c = cursor();
				return { enabled: c.get('shareos', 'widget', 'enabled') == '1', token: c.get('shareos', 'widget', 'token') ?? '' };
			}
		},

		set: {
			// enabled: on/off; renew: new token (the old address stops working)
			args: { enabled: false, renew: false },
			call: function(req) {
				let c = cursor();
				c.set('shareos', 'widget', 'widget');
				if (req.args.enabled != null) c.set('shareos', 'widget', 'enabled', req.args.enabled ? '1' : '0');
				if (req.args.renew || !c.get('shareos', 'widget', 'token')) c.set('shareos', 'widget', 'token', new_token());
				c.commit('shareos');
				return { enabled: c.get('shareos', 'widget', 'enabled') == '1', token: c.get('shareos', 'widget', 'token') };
			}
		},

		status: {
			// called by /www/cgi-bin/status with the token from the address;
			// no web login has it in its ACL
			args: { token: '' },
			call: function(req) {
				let c = cursor();
				if (c.get('shareos', 'widget', 'enabled') != '1') return { error: 'disabled' };
				if (!same_token(req.args.token, c.get('shareos', 'widget', 'token'))) return { error: 'denied' };
				return widget_status();
			}
		}
	},

	'shareos.update': {
		check: {
			args: { channel: 'stable' },
			call: function(req) {
				let ch = req.args.channel;
				return run_updater(ch ? [ 'check', ch ] : [ 'check' ]);
			}
		},

		status: {
			// asked every few seconds by the interface: only when the update state changed
			call: function() {
				let d = '/tmp/shareos-update';
				return memo('update', fstamp(d + '/state.json', d + '/dl/fw.tar.part', d + '/dl/fw.tar',
					'/overlay/upgrade-result', '/overlay/upgrade/rootfs.squashfs', '/etc/shareos-release'), 60,
					() => run_updater([ 'status' ]));
			}
		},

		download: {
			args: { tag: '' },
			call: function(req) {
				if (!req.args.tag)
					return { error: 'tag missing' };
				let s = run_updater([ 'status' ]);
				if (s.state == 'downloading' || s.state == 'verifying' || s.state == 'flashing')
					return { error: 'busy: ' + s.state };
				return spawn_updater([ 'download', req.args.tag ]);
			}
		},

		apply: {
			// "confirm" must be true: flashing is the one step that cannot be undone
			args: { tag: '', confirm: false },
			call: function(req) {
				if (req.args.confirm !== true)
					return { error: 'confirm must be true' };
				let s = run_updater([ 'status' ]);
				if (s.state != 'ready' || s.release?.tag != req.args.tag)
					return { error: 'release not downloaded and verified' };
				return spawn_updater([ 'apply', req.args.tag ]);
			}
		},

		cancel: {
			call: function() {
				return run_updater([ 'cancel' ]);
			}
		},

		// hide the "last update" message
		ack: {
			call: function() {
				return run_updater([ 'ack' ]);
			}
		},

		// update without internet: upload the .sysupgrade.tar of a release
		local_ticket: {
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-fw && chmod 700 ' + FILES_TICKETS + ' /tmp/shareos-fw; rm -f /tmp/shareos-fw/upload.tar');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n/tmp/shareos-fw/upload.tar\n%d\nupload.tar\n', time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		local: {
			// sha256: content of the release's .sha256 file (optional)
			args: { sha256: '' },
			call: function(req) {
				let sha = req.args.sha256 ?? '';
				let m = match(sha, /[0-9a-f]{64}/);
				if (sha != '' && !m) return { error: 'checksum file is invalid' };
				if (!stat('/tmp/shareos-fw/upload.tar')) return { error: 'no uploaded file' };
				let s = run_updater([ 'status' ]);
				if (s.state == 'downloading' || s.state == 'verifying' || s.state == 'flashing')
					return { error: 'busy: ' + s.state };
				return spawn_updater(m ? [ 'local', '/tmp/shareos-fw/upload.tar', m[0] ] : [ 'local', '/tmp/shareos-fw/upload.tar' ]);
			}
		},

		// another firmware file in D-Link format (.bin), e.g. back to Alt-F
		bin_ticket: {
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-fw && chmod 700 ' + FILES_TICKETS + ' /tmp/shareos-fw; rm -f /tmp/shareos-fw/upload.bin');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n/tmp/shareos-fw/upload.bin\n%d\nupload.bin\n', time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		bin_info: {
			call: function() {
				if (!stat('/tmp/shareos-fw/upload.bin')) return { error: 'no uploaded file' };
				let r = sh('/usr/sbin/shareos-flash-bin info /tmp/shareos-fw/upload.bin'), o = {};
				if (r.rc != 0) { unlink('/tmp/shareos-fw/upload.bin'); return { error: replace(trim(r.out), /^error: /, '') }; }
				for (let l in split(r.out, '\n')) { let m = match(l, /^([a-z_]+)=(.*)$/); if (m) o[m[1]] = m[2]; }
				return o;
			}
		},

		bin_write: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true) return { error: 'confirm must be true' };
				if (!stat('/tmp/shareos-fw/upload.bin')) return { error: 'no uploaded file' };
				let r = sh('/usr/sbin/shareos-flash-bin write /tmp/shareos-fw/upload.bin --yes');
				unlink('/tmp/shareos-fw/upload.bin');
				if (r.rc != 0) return { error: replace(trim(r.out), /^error: /, '') };
				let m = match(r.out, /kind=([a-z]+)/);
				return { ok: true, kind: m ? m[1] : 'other' };
			}
		}
	}
};
