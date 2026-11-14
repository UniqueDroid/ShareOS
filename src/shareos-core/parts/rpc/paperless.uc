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
	// the end of the log is enough for the last entries
	let st = stat(path + '/.paperless/log'), txt = '';
	if (st) {
		let f = fopen(path + '/.paperless/log', 'r');
		if (f) { if (st.size > 16384) { f.seek(st.size - 16384); f.read('line'); } txt = f.read('all') ?? ''; f.close(); }
	}
	let lines = filter(split(txt, '\n'), (l) => l != '');
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

