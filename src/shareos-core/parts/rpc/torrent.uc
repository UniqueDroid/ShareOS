/* ---------- remote access for Transmission programs (S52tremote) ----------
 * /transmission/rpc on its own port (shareos.tremote: enabled, port,
 * https_port) for programs like Transmission Remote GUI or Transmissionic:
 * basic auth with the account name and a remote password the box makes
 * (Transmission app, shareos.apptorrent remote_set), only from the home
 * network (private addresses, also VPN/Tailscale), only while the account
 * may still use its torrents. 5 wrong passwords in 10 minutes lock the
 * address and the account name for 10 minutes. */
const TREMOTE_KEYS = '/etc/shareos/tremote';   // <account>: crypt hash of its remote password (root only)
const TREMOTE_RUN = '/tmp/shareos-tremote';    // failed logins, tickets for the CGI
const TREMOTE_FAILS = 5, TREMOTE_LOCK = 600, TREMOTE_TICKET = 600;
// account -> { pass, hash, until }: a right password stays known for 5 minutes,
// so not every request of a program polling every few seconds runs mkpasswd
let tremote_ok = {};

function tremote_conf() {
	let c = cursor();
	return { enabled: c.get('shareos', 'tremote', 'enabled') == '1', port: +(c.get('shareos', 'tremote', 'port') ?? 9091),
		https_port: +(c.get('shareos', 'tremote', 'https_port') ?? 9092), https: c.get('shareos', 'web', 'https') != '0' };
}

// home network: private IPv4 (also 100.64/10: Tailscale, carrier-grade NAT),
// loopback, link-local, IPv6 ULA (fc00::/7, Tailscale too) and link-local
function ip_local(ip) {
	if (type(ip) != 'string') return false;
	ip = lc(ip);
	let m = match(ip, /^(::ffff:)?([0-9]{1,3})\.([0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}$/);
	if (m) {
		let a = +m[2], b = +m[3];
		return a == 10 || a == 127 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && b >= 64 && b <= 127);
	}
	return ip == '::1' || !!match(ip, /^f[cd][0-9a-f]{0,2}:/) || !!match(ip, /^fe[89ab][0-9a-f]:/);
}

// failed logins of an address or account name: times within the lock window
function tremote_fails(k) {
	let now = time();
	return filter(map(split(readfile(TREMOTE_RUN + '/fail-' + k) ?? '', '\n'), (t) => +t), (t) => t > now - TREMOTE_LOCK);
}
function tremote_fail_key(s) { return replace(s, /[^A-Za-z0-9_.-]/g, '_'); }

// the account may still use its own Transmission: "Dateien" and an app with
// "torrent" it can see
function torrent_allowed(u) {
	return files_allowed(u) && length(filter(apps_for(u), (a) => app_has_files(a) && index(a.permissions ?? [], 'torrent') >= 0)) > 0;
}

function tremote_hash(u) { return trim(readfile(TREMOTE_KEYS + '/' + u) ?? ''); }

// a ticket for the CGI's further calls (path, watch, port) of this request
function tremote_ticket(u) {
	let f = TREMOTE_RUN + '/ticket-' + u, l = split(readfile(f) ?? '', '\n');
	if (length(l) >= 2 && match(l[0], /^[0-9a-f]{32}$/) && +l[1] > time() + 60) return l[0];
	let t = new_token();
	writefile(f, t + '\n' + (time() + TREMOTE_TICKET) + '\n');
	return t;
}

// grant (apps) or ticket (remote access) -> account with "torrent"
function torrent_user(args) {
	if (args.ticket != null) {
		let t = args.ticket;
		if (type(t) != 'string' || !match(t, /^[0-9a-f]{32}$/)) return null;
		for (let f in glob(TREMOTE_RUN + '/ticket-*')) {
			let l = split(readfile(f) ?? '', '\n');
			if (length(l) >= 2 && same_token(l[0], t) && +l[1] > time()) {
				let u = substr(f, length(TREMOTE_RUN) + 8);
				return (u == 'root' || acc_name_ok(u)) && tremote_conf().enabled && torrent_allowed(u) ? { u } : null;
			}
		}
		return null;
	}
	let g = app_grant_user(args.grant);
	return g && index(g.app.permissions ?? [], 'torrent') >= 0 ? g : null;
}

// the account's daemon, started when needed: what the CGI needs
function torrent_session(u) {
	let st = jparse(sh('/usr/sbin/shareos-transmission status ' + shq(u)).out ?? '') ?? {};
	if (!st.running) {
		let r = sh('/usr/sbin/shareos-transmission start ' + shq(u));
		st = jparse(r.out ?? '') ?? { error: trim(r.out) || 'cannot start' };
		if (st.error) return { error: st.error, installed: st.installed };
	}
	return { user: u, socket: st.socket, watch: st.watch, watch_autobrr: !!st.watch_autobrr, peer_port: st.peer_port,
		roots: map(files_roots(u), (r) => ({ name: r.name, path: realpath(r.path) ?? r.path, home: !!r.home })) };
}

// a new remote password: 4 groups of 4 from letters and digits that cannot be
// mixed up (about 80 bits), only its hash stays on the box
function tremote_new_pass() {
	const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
	let r = readfile('/dev/urandom', 16) ?? '', p = '';
	for (let i = 0; i < 16; i++) p += (i && i % 4 == 0 ? '-' : '') + substr(ABC, ord(r, i) % length(ABC), 1);
	return p;
}

// the admin page: settings, whether it runs, the accounts with a remote password
function tremote_status() {
	let st = jparse(sh('/usr/sbin/shareos-transmission status root').out ?? '') ?? {};
	return { ...tremote_conf(), installed: st.installed === true,
		running: system("pgrep -f 'uhttpd .*-h /www-tremote' >/dev/null") == 0,
		accounts: sort(filter(map(glob(TREMOTE_KEYS + '/*'), (f) => substr(f, length(TREMOTE_KEYS) + 1)), (u) => u == 'root' || acc_name_ok(u))),
		host: web_host().host, path: '/transmission/rpc' };
}

// permission "notify": shareos-apps checks the message and the rate
function app_notify_tool(args, id) {
	let r = sh('/usr/sbin/shareos-apps notify ' + shq(id) + ' ' + join(' ', map(args, shq)));
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: 'failed' };
}

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	// called only by /_shareos/cgi/transmission on the apps web server and by
	// /transmission/rpc of the remote access (as root, over the local ubus
	// socket); no web session has this object in its ACL. The account's own
	// Transmission daemon, for apps with "files" + "torrent" (grant) or for
	// remote programs (remote_session, then its ticket).
	'shareos.apptorrent': {
		session: {
			args: { grant: '' },
			call: function(req) {
				let g = torrent_user({ grant: req.args.grant });
				return g ? torrent_session(g.u) : { error: 'no access' };
			}
		},

		// remote access: account name + remote password from an address of the
		// home network -> like session, plus a ticket for path/watch/port
		remote_session: {
			args: { user: '', pass: '', ip: '' },
			call: function(req) {
				let u = req.args.user, pass = req.args.pass, ip = req.args.ip;
				if (!tremote_conf().enabled) return { error: 'off' };
				if (!ip_local(ip)) return { error: 'not local' };
				if (type(u) != 'string' || type(pass) != 'string') return { error: 'denied' };
				let ki = 'ip-' + tremote_fail_key(ip), ku = 'u-' + tremote_fail_key(substr(u, 0, 64));
				if (length(tremote_fails(ki)) >= TREMOTE_FAILS || length(tremote_fails(ku)) >= TREMOTE_FAILS) return { error: 'locked' };
				let ok = false, hash = (u == 'root' || acc_name_ok(u)) ? tremote_hash(u) : '';
				if (hash != '' && length(pass) <= 128) {
					let c = tremote_ok[u];
					if (c && c.hash == hash && c.until > time() && same_token(c.pass, pass)) ok = true;
					else {
						let m = match(hash, /^\$5\$([^$]+)\$/);
						let r = m ? sh_in(sprintf('mkpasswd -P 0 -m sha256 -S %s', shq(m[1])), pass) : null;
						ok = !!r && trim(r.out) == hash;
						if (ok) tremote_ok[u] = { pass, hash, until: time() + 300 };
					}
				}
				if (!ok || !torrent_allowed(u)) {
					system('mkdir -p ' + TREMOTE_RUN + ' && chmod 700 ' + TREMOTE_RUN);
					for (let k in [ ki, ku ])
						writefile(TREMOTE_RUN + '/fail-' + k, join('\n', [ ...tremote_fails(k), time() ]) + '\n');
					delete tremote_ok[u];
					return { error: 'denied' };
				}
				unlink(TREMOTE_RUN + '/fail-' + ki);
				unlink(TREMOTE_RUN + '/fail-' + ku);
				system('mkdir -p ' + TREMOTE_RUN + ' && chmod 700 ' + TREMOTE_RUN);
				let s = torrent_session(u);
				if (s.error) return s;
				s.ticket = tremote_ticket(u);
				return s;
			}
		},

		// the Transmission app: the account's remote access and how to reach it
		remote_get: {
			args: { grant: '' },
			call: function(req) {
				let g = torrent_user({ grant: req.args.grant });
				if (!g) return { error: 'no access' };
				let t = tremote_conf();
				return { user: g.u, on: tremote_hash(g.u) != '', box_enabled: t.enabled, port: t.port, https: t.https, https_port: t.https_port,
					host: web_host().host, path: '/transmission/rpc' };
			}
		},

		// on: false removes the password; on: true makes one when there is none
		// (regen: always a new one). The password is in the answer only then.
		remote_set: {
			args: { grant: '', on: false, regen: false },
			call: function(req) {
				let g = torrent_user({ grant: req.args.grant });
				if (!g) return { error: 'no access' };
				let f = TREMOTE_KEYS + '/' + g.u, out = {};
				delete tremote_ok[g.u];
				if (!req.args.on) unlink(f);
				else if (req.args.regen || tremote_hash(g.u) == '') {
					let p = tremote_new_pass();
					let r = sh_in('mkpasswd -P 0 -m sha256', p);
					let h = trim(r.out);
					if (!match(h, /^\$5\$/)) return { error: 'cannot make a password' };
					system(sprintf('mkdir -p %s && chmod 700 %s && umask 077 && : > %s', TREMOTE_KEYS, TREMOTE_KEYS, shq(f)));
					writefile(f, h + '\n');
					out.password = p;
				}
				let t = tremote_conf();
				return { ...out, user: g.u, on: tremote_hash(g.u) != '', box_enabled: t.enabled, port: t.port, https: t.https, https_port: t.https_port,
					host: web_host().host, path: '/transmission/rpc' };
			}
		},

		// a folder of the account (root + relative path) -> absolute path for the daemon
		path: {
			args: { grant: '', ticket: '', root: '', path: '' },
			call: function(req) {
				let g = torrent_user(req.args);
				if (!g) return { error: 'no access' };
				let p = files_wpath(g.u, req.args.root, req.args.path, 'dir');
				if (p.error) return p;
				return { path: realpath(p.abs) };
			}
		},

		// the account's own watch folder (root + relative path; root "" switches it off)
		watch: {
			args: { grant: '', ticket: '', root: '', path: '' },
			call: function(req) {
				let g = torrent_user(req.args);
				if (!g) return { error: 'no access' };
				let abs = '';
				if ((req.args.root ?? '') != '') {
					let p = files_wpath(g.u, req.args.root, req.args.path, 'dir');
					if (p.error) return p;
					abs = realpath(p.abs);
				}
				let r = sh('/usr/sbin/shareos-transmission watch ' + shq(g.u) + ' ' + shq(abs));
				return jparse(trim(r.out) || 'null') ?? { error: trim(r.out) || 'failed' };
			}
		},

		// the account's own peer port (0 = the default of the box); the
		// controller checks range, other accounts, the box's services, ports in use
		port: {
			args: { grant: '', ticket: '', port: 0 },
			call: function(req) {
				let g = torrent_user(req.args);
				if (!g) return { error: 'no access' };
				let p = req.args.port;
				if (type(p) != 'int' || p < 0 || p > 65535) return { error: 'the peer port must be a number' };
				let r = sh('/usr/sbin/shareos-transmission port ' + shq(g.u) + ' ' + shq(p == 0 ? '' : '' + p));
				return jparse(trim(r.out) || 'null') ?? { error: trim(r.out) || 'failed' };
			}
		}
	},

	// Services -> Torrents: remote access for Transmission programs (admins)
	'shareos.tremote': {
		get: { call: function() { return tremote_status(); } },

		set: {
			args: { enabled: false, port: 0, https_port: 0 },
			call: function(req) {
				let c = cursor(), t = tremote_conf(), a = req.args;
				let port = a.port || t.port, hp = a.https_port || t.https_port;
				for (let p in [ port, hp ])
					if (type(p) != 'int' || p < 1024 || p > 65535) return { error: 'the ports must be between 1024 and 65535' };
				if (port == hp) return { error: 'HTTP and HTTPS need two different ports' };
				let as = apps_server(), used = [ 80, 443, as.port, as.https_port, 8053, 8054, 8200, 8384, 10050 ];
				for (let p in [ port, hp ])
					if (index(used, p) >= 0) return { error: 'port ' + p + ' is used by a service of the box' };
				if (c.get('shareos', 'tremote') == null) c.set('shareos', 'tremote', 'tremote');
				c.set('shareos', 'tremote', 'enabled', a.enabled ? '1' : '0');
				c.set('shareos', 'tremote', 'port', '' + port);
				c.set('shareos', 'tremote', 'https_port', '' + hp);
				c.commit('shareos');
				sh('/etc/init.d/S52tremote restart');
				return tremote_status();
			}
		},

		// takes an account's remote password away (it can make a new one in the app)
		revoke: {
			args: { user: '' },
			call: function(req) {
				let u = req.args.user;
				if (!(u == 'root' || acc_name_ok(u))) return { error: 'invalid name' };
				unlink(TREMOTE_KEYS + '/' + u);
				delete tremote_ok[u];
				return tremote_status();
			}
		}
	}
});
