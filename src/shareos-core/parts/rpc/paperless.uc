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

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.paperless': {
		get: {
			call: function() {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor(), list = [];
				c.foreach('paperless', 'inbox', (x) => { push(list, inbox_info(c, x['.name'])); });
				return { ...paperless_global(c), inboxes: list };
			}
		},

		set_global: {
			args: { url: '', enabled: true, interval: 2, after: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
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
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor(), tok = req.args.token || (req.args.inbox ? c.get('paperless', req.args.inbox, 'token') : null);
				let url = req.args.url || c.get('paperless', 'global', 'url');
				if (!url || !tok) return { error: 'URL and token needed' };
				let r = sh_in(sprintf('%s test %s', PAPERLESS, shq(url)), tok + '\n');
				let m = match(r.out, /ok documents=([0-9?]+)/);
				return m ? { ok: true, documents: m[1] } : tool_result(r);
			}
		},

		// admin inboxes: one per user (owner) or a shared one on a share
		inbox_set: {
			args: { name: '', owner: '', share: '', token: '', tags: [], enabled: true },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
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
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor();
				if (c.get('paperless', req.args.name) != 'inbox') return { error: 'unknown inbox' };
				c.delete('paperless', req.args.name); c.commit('paperless');
				sh(CRON + ' sync');
				return { ok: true };   // the folder and its files stay
			}
		},

		run: {
			call: function() {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				system('start-stop-daemon -S -b -x ' + PAPERLESS + ' -- run');
				return { started: true };
			}
		},

		tags: {
			args: { inbox: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				if (!match(req.args.inbox ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid inbox' };
				let j = jparse(sh(PAPERLESS + ' tags ' + shq(req.args.inbox)).out);
				return { tags: map(j?.results ?? [], (t) => ({ id: t.id, name: t.name })) };
			}
		},

		log: {
			args: { inbox: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor();
				if (c.get('paperless', req.args.inbox) != 'inbox') return { error: 'unknown inbox' };
				return { entries: paperless_log(inbox_path(c, req.args.inbox), 100) };
			}
		}
	}
});
