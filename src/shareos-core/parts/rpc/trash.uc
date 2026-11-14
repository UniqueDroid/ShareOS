/* ---------- trash of the file browser ----------------------------------------
 * Deleting in the file browser moves into <root>/.shareos-trash (same drive,
 * so it is only a rename): the item as <id>, next to it <id>.json with the
 * name, the folder it came from, the time and the account. Restore moves it
 * back, "empty" deletes for good. What is older than shareos.files.trash_days
 * goes when the trash of that root is used next (deleting or looking into
 * it) – things only get there through the file browser, so no timer has to
 * wake the disks for it. SMB and apps delete directly. */
const TRASH = '.shareos-trash';

function trash_conf() {
	let c = cursor();
	let d = +(c.get('shareos', 'files', 'trash_days') ?? 30);
	return { enabled: c.get('shareos', 'files', 'trash') != '0', days: d >= 0 && d <= 365 ? d : 30 };
}

function trash_dir(p) { return p.root.path + '/' + TRASH; }
// a path inside the trash itself: deleting there is for good
function in_trash(rel) { return rel == TRASH || index(rel, TRASH + '/') == 0; }

// move names of folder p (files_wpath) into the trash, with the rights of u
function trash_move(u, p, names) {
	let t = trash_dir(p);
	let r = files_sh(u, 'mkdir -p -- ' + shq(t), p.root.share);
	if (r.rc != 0) return { error: files_err(r) };
	for (let n in names) {
		let id = sprintf('%d-%s', time(), substr(new_token(), 0, 8));
		let st = lstat(p.abs + '/' + n);
		if (!st) return { error: 'not found: ' + n };
		r = files_sh(u, sprintf('mv -- %s %s', shq(p.abs + '/' + n), shq(t + '/' + id)), p.root.share);
		if (r.rc != 0) return { error: files_err(r) };
		writefile(t + '/' + id + '.json', sprintf('%J', { name: n, path: p.rel, time: time(), user: u == 'root' ? 'root' : u,
			type: st.type == 'directory' ? 'dir' : 'file', size: st.type == 'file' ? st.size : null }));
		// the account owns its entry (it may empty its trash); in shares the group reads it
		system(sprintf('chown %s %s 2>/dev/null; chmod %s %s', shq(acc_role(u) == 'admin' ? 'root' : u), shq(t + '/' + id + '.json'), p.root.share ? '664' : '600', shq(t + '/' + id + '.json')));
	}
	return { ok: true, trash: true };
}

function trash_items(p) {
	let t = trash_dir(p), out = [];
	for (let f in lsdir(t) ?? []) {
		let m = match(f, /^([0-9]+-[0-9a-f]{8})\.json$/);
		if (!m || !lstat(t + '/' + m[1])) continue;
		let j = null;
		try { j = json(readfile(t + '/' + f)); } catch (e) { }
		if (type(j) != 'object' || !name_ok(j.name ?? '')) continue;
		push(out, { id: m[1], name: j.name, path: j.path ?? '', time: +j.time, user: j.user ?? '', type: j.type ?? 'file', size: j.size });
	}
	return sort(out, (a, b) => b.time - a.time);
}

// delete entries older than the configured days (0 = keep until emptied)
function trash_purge(u, p) {
	let days = trash_conf().days;
	if (!days) return;
	let old = filter(trash_items(p), (x) => x.time < time() - days * 86400);
	if (length(old))
		files_sh(u, 'rm -rf -- ' + join(' ', map(old, (x) => shq(trash_dir(p) + '/' + x.id) + ' ' + shq(trash_dir(p) + '/' + x.id + '.json'))), p.root.share);
}

function trash_ids_ok(ids) {
	if (type(ids) != 'array' || !length(ids)) return false;
	for (let i in ids) if (type(i) != 'string' || !match(i, /^[0-9]+-[0-9a-f]{8}$/)) return false;
	return true;
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

// accounts that may use apps but not the folders of the box ("Dateien" off)
function app_private_allowed(u) {
	let c = cursor();
	return acc_role(u) == 'user' && c.get('accounts', u, 'web') != '0' && !files_allowed(u);
}

// the private folder of an app for such an account, on the apps drive:
// /mnt/<apps>/.shareos/userdata/<account>/<app> – the account's, 0700; made
// when first needed; null without an apps drive
function app_private_dir(u, id) {
	let a = cursor().get('storage', 'global', 'apps');
	if (!a || !acc_name_ok(u) || !match(id ?? '', /^[a-z][a-z0-9-]{1,31}$/)) return null;
	let base = '/mnt/' + a + '/.shareos';
	if (stat(base)?.type != 'directory' || index(readfile('/proc/mounts') ?? '', ' /mnt/' + a + ' ') < 0) return null;
	let ud = base + '/userdata/' + u, d = ud + '/' + id;
	if (stat(d)?.type != 'directory')
		system(sprintf('chmod a+x %s && mkdir -p %s && chmod 711 %s && mkdir -p %s && chown %s %s %s && chmod 700 %s %s',
			shq(base), shq(base + '/userdata'), shq(base + '/userdata'), shq(d), shq(u), shq(ud), shq(d), shq(ud), shq(d)));
	return stat(d)?.type == 'directory' ? d : null;
}

// grant -> account, while the app is installed, has "files" and is visible to
// the account. private_ok: an account without "Dateien" gets the app's private
// folder as its only root (ShareOS.fs of that app); other permissions (torrent,
// media …) still need "Dateien".
function app_grant_user(g, private_ok) {
	if (type(g) != 'string' || !match(g, /^[0-9a-f]{32}$/)) return null;
	let l = split(readfile(APP_GRANTS + '/' + g) ?? '', '\n');
	if (length(l) < 3 || +l[2] < time()) return null;
	let u = l[0], id = l[1];
	if (!(u == 'root' || acc_name_ok(u))) return null;
	let full = files_allowed(u);
	if (!full && !(private_ok && app_private_allowed(u))) return null;
	let app = filter(apps_for(u), (x) => x.id == id)[0];
	if (!app || !app_has_files(app)) return null;
	if (full) return { u, app, roots: null };
	// the app's own folder stays first and "home", so the app keeps its data
	// there; after it the personal folder and the shares by rights, for the
	// file dialog (ShareOS.fs.pick) – "Dateien" only adds the file browser
	let d = app_private_dir(u, app.id);
	let more = map(user_roots(cursor(), u, readfile('/proc/mounts') ?? ''), (r) => r.home ? { ...r, home: false, personal: true } : r);
	return { u, app, roots: [ ...(d ? [ { name: 'app', path: d, home: true, private: true } ] : []), ...more ] };
}

// compares without stopping at the first wrong character
function same_token(a, b) {
	if (type(a) != 'string' || type(b) != 'string' || length(a) != length(b) || length(a) < 16) return false;
	let d = 0;
	for (let i = 0; i < length(a); i++) d |= ord(a, i) ^ ord(b, i);
	return d == 0;
}

