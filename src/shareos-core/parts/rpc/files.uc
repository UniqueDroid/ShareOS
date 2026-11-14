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

// who: an account name, or { u, roots } – an app grant with its own roots
// (accounts without "Dateien" get only the app's private folder)
function who_user(w) { return type(w) == 'object' ? w.u : w; }

// personal folder of an admin account: its own home, for root /mnt/<apps drive
// or first drive>/home/root (made on first use, root only)
function admin_home(c, u, mounts) {
	let v = c.get('accounts', u, 'home');
	if (u == 'root') {
		v = c.get('storage', 'global', 'apps');
		if (!v || c.get('storage', v) != 'volume' || index(mounts, ' /mnt/' + v + ' ') < 0) {
			v = null;
			c.foreach('storage', 'volume', (x) => { if (!v && index(mounts, ' /mnt/' + x['.name'] + ' ') >= 0) v = x['.name']; });
		}
	}
	if (!v || v == 'home' || c.get('storage', v) != 'volume' || index(mounts, ' /mnt/' + v + ' ') < 0) return null;
	let p = '/mnt/' + v + '/home/' + u;
	if (u == 'root' && stat(p)?.type != 'directory')
		system(sprintf('mkdir -p %s && chmod 700 %s', shq(p), shq(p)));
	return stat(p)?.type == 'directory' ? p : null;
}

// a plain user's folders: the personal folder ("home") and the shares by
// rights (ro = read only); also used for apps of accounts without "Dateien"
function user_roots(c, u, mounts) {
	let roots = [];
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
	return roots;
}

function files_roots(u) {
	if (type(u) == 'object') return u.roots ?? files_roots(u.u);
	let c = cursor(), roots = [];
	if (!u || !files_allowed(u)) return roots;
	let mounts = readfile('/proc/mounts') ?? '';
	if (acc_role(u) == 'admin') {
		// a personal folder first, so apps keep their files there and not at the
		// top of a drive: the account's home, for root home/root on the apps drive
		let h = admin_home(c, u, mounts);
		if (h) push(roots, { name: 'home', path: h, home: true });
		c.foreach('storage', 'volume', (x) => {
			let mp = '/mnt/' + x['.name'];
			if (index(mounts, ' ' + mp + ' ') >= 0) push(roots, { name: x['.name'], path: mp, home: false });
		});
		for (let m in usb_mounts()) push(roots, { name: substr(m.path, 5), path: m.path, home: false, usb: true });
	} else
		roots = user_roots(c, u, mounts);
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
	return { root: r, abs, rel: join('/', parts), admin: acc_role(who_user(u)) == 'admin' };
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

