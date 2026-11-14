/* ---------- permission "sysinfo": the box's values for apps (read only) ---------- */

// mounted drives and the flash overlay with their use
function sys_volumes() {
	let mounts = readfile('/proc/mounts') ?? '', fst = {}, mps = [ '/overlay' ];
	for (let line in split(mounts, '\n')) {
		let f = split(line, ' ');
		if (length(f) > 2 && match(f[1], /^\/mnt\/[A-Za-z0-9._-]+$/) && !fst[f[1]]) { push(mps, f[1]); fst[f[1]] = f[2]; }
	}
	let list = [];
	for (let line in split(sh('df -k ' + join(' ', map(mps, shq))).out, '\n')) {
		let f = split(trim(line), /\s+/);
		if (length(f) < 6 || !match(f[1], /^[0-9]+$/)) continue;
		let mp = f[5];
		push(list, { name: mp == '/overlay' ? 'flash' : substr(mp, 5), mount: mp, fs: mp == '/overlay' ? 'ubifs' : (fst[mp] ?? ''),
			usb: index(mp, '/mnt/usb-') == 0, size: +f[1] * 1024, used: +f[2] * 1024, avail: +f[3] * 1024 });
	}
	return list;
}

function sys_info() {
	let up = split(read_trim('/proc/uptime') ?? '0', ' ');
	let load = split(read_trim('/proc/loadavg') ?? '', ' ');
	let net = '/sys/class/net/eth0/';
	return {
		model: read_trim('/proc/device-tree/model'), board: board().fwname ?? null, version: release().version ?? null,
		hostname: read_trim('/proc/sys/kernel/hostname'), kernel: read_trim('/proc/sys/kernel/osrelease'),
		time: time(), uptime: +up[0], load: [ +load[0], +load[1], +load[2] ], procs: load[3] ?? '',
		cpu: cpustat(), cores: length(filter(split(readfile('/proc/cpuinfo') ?? '', '\n'), (l) => match(l, /^processor\s*:/))) || 1,
		memory: meminfo(), temperature: box_temp(), fan_pwm: read_int('/tmp/sys/pwm1'), board_control: memo('boardctl', '', 10, board_control),
		network: { speed: read_int(net + 'speed'), rx_bytes: read_int(net + 'statistics/rx_bytes'), tx_bytes: read_int(net + 'statistics/tx_bytes') },
		volumes: memo('sysvol', '', 20, sys_volumes),
		disks: disks_state()
	};
}

// every process: pid, name, command line, user, state, memory, CPU ticks;
// the app computes the CPU share from two samples (ticks / cpu.total)
function sys_processes() {
	let users = {};
	for (let l in lines_of('/etc/passwd')) users[field(l, 2)] = field(l, 0);
	let list = [];
	for (let pid in lsdir('/proc') ?? []) {
		if (!match(pid, /^[0-9]+$/)) continue;
		let st = readfile('/proc/' + pid + '/stat');
		let m = st ? match(st, /^[0-9]+ \((.*)\) ([A-Za-z]) (.*)$/) : null;
		if (!m) continue;
		let f = split(trim(m[3]), ' ');
		let uid = match(readfile('/proc/' + pid + '/status') ?? '', /\nUid:\s+([0-9]+)/);
		let cmd = trim(join(' ', split(readfile('/proc/' + pid + '/cmdline') ?? '', chr(0))));
		push(list, { pid: +pid, ppid: +f[0], name: m[1], cmd: substr(cmd, 0, 240), kernel: cmd == '',
			user: uid ? (users[uid[1]] ?? uid[1]) : '', state: m[2], threads: +f[16], nice: +f[15],
			ticks: +f[10] + +f[11], start: +f[18], rss: +f[20] * 4096 });
	}
	return { cpu: cpustat(), hz: 100, uptime: +split(read_trim('/proc/uptime') ?? '0', ' ')[0], processes: list };
}

// processes an app may not end: init and what keeps ShareOS and its interface running
// (the kernel keeps 15 characters of a name: shareos-supervise, which restarts
// ubusd and rpcd – ending it ends them)
const SYS_KEEP = { init: 1, ubusd: 1, rpcd: 1, uhttpd: 1, 'dns320l-daemon': 1, syslogd: 1, klogd: 1, 'shareos-supervi': 1 };

/* ---------- permission "docker": Docker hosts the admin added (Docker Engine API) ---------- */

function docker_url_ok(u) {
	return type(u) == 'string' && length(u) <= 200 && !!match(u, /^https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?\/?$/);
}
function docker_hosts(c) {
	let l = [];
	c.foreach('dockerhosts', 'host', (x) => push(l, { name: x['.name'], label: x.label ?? x['.name'], url: x.url ?? '', insecure: x.insecure == '1' }));
	return l;
}

// shareos-autobrr <args> (JSON on stdin for set, password, api)
const AUTOBRR = '/usr/sbin/shareos-autobrr';

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	// called only by /_shareos/cgi/sysinfo: the box's values, admin accounts only
	'shareos.appsys': {
		info: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'sysinfo') ? sys_info() : { error: 'no access' }; } },
		processes: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'sysinfo') ? sys_processes() : { error: 'no access' }; } },
		kill: {
			args: { grant: '', pid: 0, signal: '' },
			call: function(req) {
				let a = req.args;
				if (!app_grant_perm(a.grant, 'sysinfo')) return { error: 'no access' };
				let pid = +a.pid, sig = a.signal ?? 'TERM';
				if (!(sig in { TERM: 1, KILL: 1, HUP: 1 })) return { error: 'invalid signal' };
				if (!(pid > 1)) return { error: 'invalid process' };
				let name = trim(readfile('/proc/' + pid + '/comm') ?? '');
				if (name == '') return { error: 'no such process' };
				if (readfile('/proc/' + pid + '/cmdline') == '') return { error: 'kernel threads cannot be ended' };
				if (SYS_KEEP[name]) return { error: 'this process keeps ShareOS running' };
				let r = sh(sprintf('kill -%s %d', sig, pid));
				return r.rc == 0 ? { ok: true, pid, name, signal: sig } : { error: trim(r.out) || 'failed' };
			}
		}
	},

	// called only by /_shareos/cgi/netcheck: may this app check hosts from the box?
	'shareos.appnet': {
		allowed: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'netcheck') ? { ok: true } : { error: 'no access' }; } }
	},

	// called only by /_shareos/cgi/notify: messages of an app (permission
	// "notify", admins) – checked and sent by shareos-apps notify
	// called only by /_shareos/cgi/vault: vault shares of the account that
	// opened the app (permissions "files" + "vault"); set: admins only
	'shareos.appvault': {
		status: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'vault');
				if (!g) return { error: 'no access' };
				return { user: g.u, host: trim(readfile('/proc/sys/kernel/hostname') ?? ''), vaults: vault_list(g.u) };
			}
		},
		unlock: {
			args: { grant: '', share: '', minutes: 0, password: '' },
			call: function(req) {
				let a = req.args, g = app_grant_perm(a.grant, 'vault');
				if (!g) return { error: 'no access' };
				return vault_unlock(g.u, a.share, a.minutes || null, a.password);
			}
		},
		lock: {
			args: { grant: '', share: '' },
			call: function(req) {
				let a = req.args, g = app_grant_perm(a.grant, 'vault');
				if (!g) return { error: 'no access' };
				let admin = acc_role(g.u) == 'admin';
				if (!valid_name(a.share) || !(admin || vault_access(cursor(), a.share, g.u))) return { error: 'not a vault' };
				// users lock their own access, admins the whole vault
				return vault_lock(a.share, admin ? null : g.u);
			}
		},
		set: {
			args: { grant: '', share: '', vault: false, default_ttl: 0 },
			call: function(req) {
				let a = req.args, g = app_grant_perm(a.grant, 'vault');
				if (!g) return { error: 'no access' };
				if (acc_role(g.u) != 'admin') return { error: 'admins only' };
				return vault_set(a.share, a.vault, a.default_ttl || null);
			}
		}
	},

	'shareos.appnotify': {
		send: {
			args: { grant: '', level: '', key: '', title: '', text: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'notify'), a = req.args;
				if (!g) return { error: 'no access' };
				return app_notify_tool([ 'send', '' + (a.level || 'info'), '' + (a.key ?? ''), '' + (a.title ?? ''), '' + (a.text ?? '') ], g.app.id);
			}
		},
		clear: {
			args: { grant: '', key: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'notify');
				if (!g) return { error: 'no access' };
				return app_notify_tool([ 'clear', '' + (req.args.key ?? '') ], g.app.id);
			}
		}
	},

	// called only by /_shareos/cgi/docker: the Docker hosts (admin accounts only)
	'shareos.appdocker': {
		hosts: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'docker') ? { hosts: docker_hosts(cursor()) } : { error: 'no access' }; } },
		host_set: {
			args: { grant: '', name: '', label: '', url: '', insecure: false },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!app_grant_perm(a.grant, 'docker')) return { error: 'no access' };
				if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				if (!docker_url_ok(a.url)) return { error: 'invalid address (http://host:2375 or https://host:2376)' };
				if (c.get('dockerhosts', a.name) == null && length(docker_hosts(c)) >= 16) return { error: 'at most 16 hosts' };
				c.set('dockerhosts', a.name, 'host');
				c.set('dockerhosts', a.name, 'label', substr(trim(a.label ?? '') || a.name, 0, 40));
				c.set('dockerhosts', a.name, 'url', replace(a.url, /\/$/, ''));
				c.set('dockerhosts', a.name, 'insecure', a.insecure ? '1' : '0');
				c.commit('dockerhosts');
				return { hosts: docker_hosts(cursor()) };
			}
		},
		host_del: {
			args: { grant: '', name: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!app_grant_perm(a.grant, 'docker')) return { error: 'no access' };
				if (c.get('dockerhosts', a.name ?? '') != 'host') return { error: 'unknown host' };
				c.delete('dockerhosts', a.name); c.commit('dockerhosts');
				return { hosts: docker_hosts(cursor()) };
			}
		},
		// address of one host for the CGI, which talks to it
		target: {
			args: { grant: '', host: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!app_grant_perm(a.grant, 'docker')) return { error: 'no access' };
				let h = filter(docker_hosts(c), (x) => x.name == a.host)[0];
				return h && docker_url_ok(h.url) ? { url: h.url, insecure: h.insecure } : { error: 'unknown host' };
			}
		}
	},

	// called only by /_shareos/cgi/tuya: may this app talk to Tuya devices?
	'shareos.apptuya': {
		allowed: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tuya') ? { ok: true } : { error: 'no access' }; } }
	}
});
