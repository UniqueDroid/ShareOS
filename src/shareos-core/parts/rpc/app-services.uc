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
		let j = jparse(trim(r.out) || 'null');
		return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
	}
	let j = jparse(trim(sh(cmd).out) || 'null');
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
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

// grant of an app with the permission p (and "files"); vpn, tailscale,
// autobrr, sysinfo, netcheck, docker, tuya, notify: admin accounts only
const ADMIN_PERMS = { vpn: 1, tailscale: 1, autobrr: 1, zabbix: 1, sysinfo: 1, netcheck: 1, docker: 1, tuya: 1, notify: 1 };
function app_grant_perm(grant, p) {
	let g = app_grant_user(grant);
	if (!g || index(g.app.permissions ?? [], p) < 0) return null;
	if (ADMIN_PERMS[p] && acc_role(g.u) != 'admin') return null;
	return g;
}

/* ---------- DNS filter (module "dnsfilter", AdGuard Home) ---------- */

function df_tool(args, input) {
	let cmd = '/usr/sbin/shareos-dnsfilter ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-df-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = null;
	try { j = json(trim(r.out) || 'null'); } catch (e) { }
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}
const DF_OFF = { error: 'the DNS filter is not installed (system app dnsfilter)' };

/* ---------- permission "zabbix": the box's Zabbix agent for apps (admins) ---------- */

const ZB_SET = [ 'enabled', 'server', 'hostname', 'metadata', 'psk_identity', 'psk', 'passive', 'allow', 'port', 'disk_interval' ];
function zb_tool(args, input) {
	// SHAREOS_ZABBIX_RPCD: it must not call rpcd back while we wait for it
	let cmd = 'SHAREOS_ZABBIX_RPCD=1 /usr/sbin/shareos-zabbix ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-zb-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}
function ab_tool(args, input) {
	let cmd = AUTOBRR + ' ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-ab-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
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
	let j = jparse(r.body);
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
		push(chips, { id: 'svc:vpn', label: 'VPN', detail: ok ? (st.ip ?? 'connected') : 'connecting …', state: ok ? 'ok' : 'warn',
			app: ids.nettunnel ? 'nettunnel' : null });
	}
	if (admin && stat('/opt/shareos/bin/openvpn') && pid_alive('/tmp/shareos-vpn-server/pid', 'openvpn')) {
		let n = 0;
		for (let l in split(readfile('/tmp/shareos-vpn-server/status') ?? '', '\n')) if (substr(l, 0, 12) == 'CLIENT_LIST,') n++;
		push(chips, { id: 'svc:vpnserver', label: 'VPN-SERVER', detail: n == 1 ? '1 device' : n + ' devices', state: 'ok',
			app: ids.nettunnel ? 'nettunnel' : null });
	}
	if (admin && stat('/opt/shareos/bin/tailscaled') && pid_alive('/tmp/shareos-tailscale/pid', 'tailscaled')) {
		// cheap (every 15 s): the address of tailscale0 instead of asking the daemon
		let m = match(sh('ip -4 -o addr show dev tailscale0').out, /inet (100\.[0-9.]+)\//);
		push(chips, { id: 'svc:tailscale', label: 'TAILSCALE', detail: m ? m[1] : 'disconnected',
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
		push(chips, { id: 'svc:dlna', label: 'DLNA', detail: 'running', state: 'ok', href: '#/services/dlna' });
	let now = time();
	for (let f in lsdir(APPSTATUS + '/' + u) ?? []) {
		let m = match(f, /^([a-z][a-z0-9-]{1,31})\.json$/), a = m ? ids[m[1]] : null;
		if (!a || index(a.permissions ?? [], 'status') < 0) continue;
		let x = jparse(readfile(APPSTATUS + '/' + u + '/' + f) ?? 'null');
		if (type(x) != 'object' || +x.until < now) continue;
		push(chips, { id: 'app:' + a.id, label: x.text, state: x.state, app: a.id, name: a.name });
	}
	return chips;
}


function widget_status() {
	let up = split(read_trim('/proc/uptime') ?? '0', ' ');
	let load = split(read_trim('/proc/loadavg') ?? '', ' ');
	let m = meminfo();
	let t = box_temp();
	let alerts = [];
	// the same limits as the messages (System → Messages), not fixed ones
	let nc = cursor();
	let temp_max = +(nc.get('shareos', 'notify', 'temp_max') ?? 55), disk_full = +(nc.get('shareos', 'notify', 'disk_full') ?? 90);
	let vols = [];
	for (let v in volumes()) {
		let x = { name: v.name, mounted: v.mounted };
		if (v.size) {
			x.size = v.size; x.free = v.avail;
			x.used_pct = int(v.used * 100 / v.size + 0.5);
			if (x.used_pct >= disk_full) push(alerts, 'volume ' + v.name + ' ' + x.used_pct + '% full');
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
	if (t != null && t >= temp_max * 1000) push(alerts, 'temperature ' + int(t / 1000) + ' °C');
	// a box with fan control that gives no reading, and disks whose SMART
	// values are not good, are not "ok" either
	if (t == null && board_control().control) push(alerts, 'temperature cannot be read');
	for (let d in disks_state())
		if (d.smart == 'bad' || d.smart == 'warn') push(alerts, 'disk ' + d.name + ': SMART ' + (d.smart == 'bad' ? 'critical' : 'caution'));
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

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
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

	// called only by /_shareos/cgi/autobrr (as root, local ubus socket): autobrr
	// for apps with "files" + "autobrr", admin accounts only
	'shareos.appautobrr': {
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'log' ]) : { error: 'no access' }; } },
		start: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'start' ]) : { error: 'no access' }; } },
		set: {
			args: { grant: '', enabled: false, ui: false, account: '' },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'autobrr')) return { error: 'no access' };
				for (let k in [ 'enabled', 'ui', 'account' ]) if (a[k] != null) i[k] = a[k];
				return ab_tool([ 'set' ], i);
			}
		},
		password: {
			args: { grant: '', password: '' },
			call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'password' ], { password: req.args.password }) : { error: 'no access' }; }
		},
		api: {
			args: { grant: '', method: '', path: '', body: {} },
			call: function(req) {
				let a = req.args;
				if (!app_grant_perm(a.grant, 'autobrr')) return { error: 'no access' };
				return ab_tool([ 'api' ], { method: a.method ?? 'GET', path: a.path ?? '', body: a.body });
			}
		},
		// accounts whose Transmission can get autobrr's torrents
		accounts: {
			args: { grant: '' },
			call: function(req) {
				if (!app_grant_perm(req.args.grant, 'autobrr')) return { error: 'no access' };
				let l = [ { name: 'root', fullname: 'Administrator' } ], c = cursor();
				c.foreach('accounts', 'user', (x) => { if (x.role == 'user' || x.role == 'admin') push(l, { name: x['.name'], fullname: x.fullname ?? '' }); });
				return { accounts: l };
			}
		}
	},

	// called only by /_shareos/cgi/zabbix: the Zabbix agent of the box
	// (system app "zabbix-agent"), admin accounts only – shareos-zabbix checks
	// every value; the pre-shared key goes in, never out (status: psk true/false)
	'shareos.appzabbix': {
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'zabbix') ? zb_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'zabbix') ? zb_tool([ 'log' ]) : { error: 'no access' }; } },
		restart: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'zabbix') ? zb_tool([ 'restart' ]) : { error: 'no access' }; } },
		set: {
			args: { grant: '', enabled: false, server: '', hostname: '', metadata: '', psk_identity: '', psk: '', passive: false, allow: '', port: 0, disk_interval: 0 },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'zabbix')) return { error: 'no access' };
				for (let k in ZB_SET) if (a[k] != null) i[k] = a[k];
				return zb_tool([ 'set' ], i);
			}
		}
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

	// called only by /_shareos/cgi/syncthing on the apps web server (as root,
	// over the local ubus socket); no web session has this object in its ACL.
	// The account's own Syncthing, for apps with "files" + "syncthing".
	'shareos.appsyncthing': {
		session: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'syncthing') < 0) return { error: 'no access' };
				let st = jparse(sh('/usr/sbin/shareos-syncthing status ' + shq(g.u)).out ?? '') ?? {};
				if (!st.running) {
					let r = sh('/usr/sbin/shareos-syncthing start ' + shq(g.u));
					st = jparse(r.out ?? '') ?? { error: trim(r.out) || 'cannot start' };
					if (st.error) return { error: st.error, installed: st.installed };
				}
				return { user: g.u, socket: st.socket, key: trim(readfile('/tmp/shareos-syncthing/' + g.u + '/apikey') ?? ''),
					roots: map(files_roots(g.u), (r) => ({ name: r.name, path: realpath(r.path) ?? r.path, home: !!r.home })) };
			}
		},

		// a folder of the account (root + relative path) -> absolute path for Syncthing
		path: {
			args: { grant: '', root: '', path: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'syncthing') < 0) return { error: 'no access' };
				let p = files_wpath(g.u, req.args.root, req.args.path, 'dir');
				if (p.error) return p;
				return { path: realpath(p.abs) };
			}
		},

		// settings that only apply after a restart of Syncthing
		restart: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'syncthing') < 0) return { error: 'no access' };
				let r = sh('/usr/sbin/shareos-syncthing restart ' + shq(g.u));
				return jparse(r.out ?? '') ?? { error: trim(r.out) || 'failed' };
			}
		}
	},

	// DNS filter (module): AdGuard Home on port 53, admins
	'shareos.dnsfilter': {
		status: { call: function() { return module_on('dnsfilter') ? df_tool([ 'status' ]) : DF_OFF; } },
		filters: { call: function() { return module_on('dnsfilter') ? df_tool([ 'filters' ]) : DF_OFF; } },
		password: { call: function() { return module_on('dnsfilter') ? df_tool([ 'password' ]) : DF_OFF; } },
		log: { call: function() { return module_on('dnsfilter') ? df_tool([ 'log' ]) : DF_OFF; } },
		// switching on starts in the background (the first start sets AdGuard up)
		set: {
			args: { enabled: false, web_port: 0, https_port: 0, upstream: [], protection: false },
			call: function(req) {
				if (!module_on('dnsfilter')) return DF_OFF;
				let a = req.args, inp = {};
				if (a.enabled === true) {
					let st = df_tool([ 'status' ]);
					if (!st.running) return df_tool([ 'start-bg' ]);
				}
				for (let k in [ 'enabled', 'web_port', 'https_port', 'upstream', 'protection' ]) if (a[k] != null) inp[k] = a[k];
				return df_tool([ 'set' ], inp);
			}
		},
		filter_add: { args: { name: '', url: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'filter-add' ], { name: req.args.name ?? '', url: req.args.url ?? '' }) : DF_OFF; } },
		filter_remove: { args: { url: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'filter-remove' ], { url: req.args.url ?? '' }) : DF_OFF; } },
		filter_enable: { args: { url: '', enabled: false }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'filter-enable' ], { url: req.args.url ?? '', enabled: req.args.enabled === true }) : DF_OFF; } },
		refresh: { call: function() { return module_on('dnsfilter') ? df_tool([ 'refresh' ]) : DF_OFF; } },
		rewrites: { call: function() { return module_on('dnsfilter') ? df_tool([ 'rewrites' ]) : DF_OFF; } },
		rewrite_add: { args: { domain: '', answer: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'rewrite-add' ], { domain: req.args.domain ?? '', answer: req.args.answer ?? '' }) : DF_OFF; } },
		rewrite_remove: { args: { domain: '', answer: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'rewrite-remove' ], { domain: req.args.domain ?? '', answer: req.args.answer ?? '' }) : DF_OFF; } }
	}
});
