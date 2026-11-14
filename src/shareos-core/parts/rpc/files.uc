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

/* ---------- long file operations in the background ---------- */

// Copying, moving between drives and deleting can take minutes. rpcd answers
// one call at a time, so such a command runs in the background: the call
// waits 3 s for it – most are done by then and answer as before – and
// otherwise returns { ok, running, job }; "job" (files / appfs) tells later
// how it ended. Jobs live in FJOBS (in RAM): <id>/user, pid, out, rc.
const FJOBS = '/tmp/shareos-filejobs';
function files_job(u, id) {
	let d = FJOBS + '/' + id;
	if (type(id) != 'string' || !match(id, /^[0-9a-f]{16}$/) || read_trim(d + '/user') != u) return { error: 'unknown job' };
	let rc = read_trim(d + '/rc');
	if (rc == null) {
		let pid = +(read_trim(d + '/pid') ?? 0);
		if (pid > 1 && stat('/proc/' + pid)) return { ok: true, running: true, job: id };
		// the shell is gone without a result: killed
		system('rm -rf ' + shq(d));
		return { error: 'the operation was interrupted' };
	}
	let r = { rc: +rc, out: readfile(d + '/out') ?? '' };
	system('rm -rf ' + shq(d));
	return r.rc == 0 ? { ok: true } : { error: files_err(r) };
}
function files_bg(u, cmd, shared) {
	let id = substr(new_token(), 0, 16), d = FJOBS + '/' + id;
	// results nobody asked for (a closed tab) are dropped after a day
	for (let old in lsdir(FJOBS) ?? [])
		if (match(old, /^[0-9a-f]{16}$/) && time() - (stat(FJOBS + '/' + old)?.mtime ?? 0) > 86400) system('rm -rf ' + shq(FJOBS + '/' + old));
	system(sprintf('mkdir -p %s && chmod 700 %s && mkdir %s', FJOBS, FJOBS, shq(d)));
	writefile(d + '/user', u);
	let full = acc_role(u) == 'admin' ? 'umask 002; ' + cmd
		: sprintf('su -s /bin/sh %s -c %s', shq(u), shq((shared ? 'umask 002; ' : 'umask 077; ') + cmd));
	system(sprintf('start-stop-daemon -S -q -b -m -p %s/pid -x /bin/sh -- -c %s',
		shq(d), shq(sprintf('( %s ) >%s/out 2>&1; echo $? >%s/rc', full, shq(d), shq(d)))));
	for (let i = 0; i < 30 && !stat(d + '/rc'); i++) sleep(100);
	return files_job(u, id);
}

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.files': {
		roots: {
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return { roots: map(files_roots(u), (r) => ({ name: r.name, home: r.home, ro: !!r.ro })), trash: trash_conf() };
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
			// names from one folder into another folder (dest_root: of another
			// root, e.g. from a share into the personal folder); copy: keep the originals
			args: { root: '', path: '', names: [], dest: '', dest_root: '', copy: false },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (type(a.names) != 'array' || !length(a.names)) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let droot = a.dest_root ? a.dest_root : a.root;
				let p = a.copy ? files_path(u, a.root, a.path, 'dir') : files_wpath(u, a.root, a.path, 'dir'), d = files_wpath(u, droot, a.dest, 'dir');
				if (p.error) return p;
				if (d.error) return d;
				for (let n in a.names) {
					let src = p.abs + '/' + n;
					if (d.abs == src || index(d.abs + '/', src + '/') == 0) return { error: 'a folder cannot be moved into itself' };
					if (lstat(d.abs + '/' + n)) return { error: 'already exists: ' + n };
				}
				return files_bg(u, sprintf('%s -- %s %s', a.copy ? 'cp -a' : 'mv', join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), shq(d.abs + '/')), d.root.share);
			}
		},

		delete: {
			// into the trash when it is on (permanent: for good)
			args: { root: '', path: '', names: [], permanent: false },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (type(a.names) != 'array' || !length(a.names)) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let p = files_wpath(u, a.root, a.path, 'dir');
				if (p.error) return p;
				if (a.permanent !== true && trash_conf().enabled && !in_trash(p.rel) && !(p.rel == '' && index(a.names, TRASH) >= 0)) {
					let r = trash_move(u, p, a.names);
					trash_purge(u, files_wpath(u, a.root, '', 'dir'));
					return r;
				}
				return files_bg(u, 'rm -rf -- ' + join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), p.root.share);
			}
		},

		// how a copy, move or delete that went on in the background ended
		job: {
			args: { id: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return files_job(u, req.args.id);
			}
		},

		// the trash of a root (personal folder, share, drive)
		trash_list: {
			args: { root: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				let p = files_path(u, req.args.root, '', 'dir');
				if (p.error) return p;
				if (!p.root.ro) trash_purge(u, p);
				return { ...trash_conf(), items: trash_items(p), ro: !!p.root.ro };
			}
		},

		trash_restore: {
			args: { root: '', ids: [] },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!trash_ids_ok(a.ids)) return { error: 'nothing selected' };
				let p = files_wpath(u, a.root, '', 'dir');
				if (p.error) return p;
				let items = trash_items(p), t = trash_dir(p), done = [];
				for (let id in a.ids) {
					let it = filter(items, (x) => x.id == id)[0];
					if (!it) return { error: 'not in the trash' };
					// back into its folder; when that is gone, to the top
					let d = files_wpath(u, a.root, it.path, 'dir');
					if (d.error) d = p;
					let dot = rindex(it.name, '.'), base = dot > 0 ? substr(it.name, 0, dot) : it.name, ext = dot > 0 ? substr(it.name, dot) : '', n = it.name;
					for (let i = 2; lstat(d.abs + '/' + n); i++) n = base + ' (' + i + ')' + ext;
					let r = files_sh(u, sprintf('mv -- %s %s', shq(t + '/' + id), shq(d.abs + '/' + n)), p.root.share);
					if (r.rc != 0) return { error: files_err(r) };
					unlink(t + '/' + id + '.json');
					push(done, { name: n, path: d.rel });
				}
				return { ok: true, restored: done };
			}
		},

		// delete for good: the given entries, or all (ids empty)
		trash_empty: {
			args: { root: '', ids: [] },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				let p = files_wpath(u, a.root, '', 'dir');
				if (p.error) return p;
				let t = trash_dir(p);
				let ids = (type(a.ids) == 'array' && length(a.ids)) ? a.ids : map(trash_items(p), (x) => x.id);
				if (!length(ids)) return { ok: true, removed: 0 };
				if (!trash_ids_ok(ids)) return { error: 'invalid entry' };
				let r = files_bg(u, 'rm -rf -- ' + join(' ', map(ids, (i) => shq(t + '/' + i) + ' ' + shq(t + '/' + i + '.json'))), p.root.share);
				return r.error ? r : { ...r, removed: length(ids) };
			}
		},

		// admins: trash on/off and how many days it keeps things (0 = until emptied)
		trash_config: {
			args: { enabled: true, days: 30 },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || acc_role(u) != 'admin') return { error: 'not allowed' };
				let d = +a.days;
				if (!(d >= 0 && d <= 365) || type(a.enabled) != 'bool') return { error: 'invalid value' };
				let c = cursor();
				if (c.get('shareos', 'files') != 'files') c.set('shareos', 'files', 'files');
				c.set('shareos', 'files', 'trash', a.enabled ? '1' : '0');
				c.set('shareos', 'files', 'trash_days', '' + d);
				c.save('shareos'); c.commit('shareos');
				return trash_conf();
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
				if (!u || !(files_allowed(u) || app_private_allowed(u))) return { error: 'not allowed' };
				let app = filter(apps_for(u), (x) => x.id == req.args.app)[0];
				if (!app) return { error: 'app not available' };
				if (!app_has_files(app)) return { error: 'the app has no access to files' };
				return { grant: app_grant_new(u, app) };
			}
		}
	},

	// called only by /_shareos/cgi/fs on the apps web server (as root, over the
	// local ubus socket); no web session has this object in its ACL
	'shareos.appfs': {
		// ShareOS.openApp: an app with "files" opens another app for the same
		// account (e.g. BeatBox -> WinWeb Player). The other app gets its own
		// grant, but only if it asks for nothing more than the opening app has
		// (apps share one origin, so the opener could use that grant itself).
		grant_app: {
			args: { grant: '', app: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				let app = filter(apps_for(g.u), (x) => x.id == req.args.app)[0];
				if (!app) return { error: 'app not available' };
				if (!app_has_files(app)) return { error: 'the app has no access to files' };
				let mine = g.app.permissions ?? [];
				for (let p in app.permissions ?? [])
					if (p != 'embed' && p != 'cron' && index(mine, p) < 0) return { error: 'the app needs more permissions than the opening app' };
				return { grant: app_grant_new(g.u, app) };
			}
		},

		roots: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				return { roots: map(files_roots(g), (r) => ({ name: r.name, home: r.home, usb: !!r.usb, ro: !!r.ro, private: !!r.private, personal: !!r.personal, share: !!r.share })), user: g.u };
			}
		},

		list: {
			args: { grant: '', root: '', path: '', hidden: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				return files_list(g, req.args.root, req.args.path, req.args.hidden === true);
			}
		},

		mkdir: {
			args: { grant: '', root: '', path: '', name: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = files_wpath(g, a.root, a.path, 'dir');
				if (p.error) return p;
				let r = files_sh(g.u, 'mkdir -- ' + shq(p.abs + '/' + a.name), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		rename: {
			args: { grant: '', root: '', path: '', name: '', to: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name) || !name_ok(a.to)) return { error: 'invalid name' };
				let p = files_wpath(g, a.root, a.path, 'dir');
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
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (type(a.names) != 'array' || !length(a.names) || length(a.names) > 1000) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let droot = a.dest_root || a.root;
				let p = a.copy ? files_path(g, a.root, a.path, 'dir') : files_wpath(g, a.root, a.path, 'dir'), d = files_wpath(g, droot, a.dest, 'dir');
				if (p.error) return p;
				if (d.error) return d;
				for (let n in a.names) {
					if (!lstat(p.abs + '/' + n)) return { error: 'not found: ' + n };
					let src = (p.rel != '' ? p.rel + '/' : '') + n;
					if (droot == a.root && (d.rel == src || index(d.rel + '/', src + '/') == 0)) return { error: 'a folder cannot be moved into itself' };
					if (lstat(d.abs + '/' + n)) return { error: 'already exists: ' + n };
				}
				return files_bg(g.u, sprintf('%s -- %s %s', a.copy ? 'cp -a' : 'mv', join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), shq(d.abs + '/')), d.root.share);
			}
		},

		delete: {
			args: { grant: '', root: '', path: '', names: [] },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (type(a.names) != 'array' || !length(a.names) || length(a.names) > 1000) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let p = files_wpath(g, a.root, a.path, 'dir');
				if (p.error) return p;
				return files_bg(g.u, 'rm -rf -- ' + join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), p.root.share);
			}
		},

		// how a copy, move or delete that went on in the background ended
		job: {
			args: { grant: '', id: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				return files_job(g.u, req.args.id);
			}
		},

		// a file ticket for /_shareos/cgi/file: read, or write (create: also a new file)
		open: {
			args: { grant: '', root: '', path: '', name: '', write: false, create: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = a.write ? files_wpath(g, a.root, a.path, 'dir') : files_path(g, a.root, a.path, 'dir');
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
	}
});
