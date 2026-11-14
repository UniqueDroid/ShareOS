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
	let j = jparse(trim(r.out) || 'null');
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

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
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
	}
});
