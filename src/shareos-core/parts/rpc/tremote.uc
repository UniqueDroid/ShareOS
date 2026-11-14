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

