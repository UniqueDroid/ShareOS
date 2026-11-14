/* ---------- web interface: language, logo, HTTPS ---------- */

const CERT = '/usr/sbin/shareos-cert';
// a Let's Encrypt request is running: its flag file; one older than 15
// minutes was left by a run that was killed (a request takes a few minutes)
function acme_running() {
	let st = stat('/tmp/shareos-acme.running');
	return !!st && time() - st.mtime < 900;
}

const THEMES = { dark: 1, light: 1, system: 1 };
// accent colours – also in www-apps/_shareos/app.js (accepted list) and
// www/app.js (ACCENT_NAMES, LOGO_FILTER), palettes in shareos.css and theme.css
const ACCENTS = { blue: 1, green: 1, red: 1, white: 1, grey: 1, violet: 1, orange: 1, teal: 1 };

// modules: system apps with "module" (see shareos-apps) that switch on an
// area of the firmware – tab, "My ShareOS" part, background work. The code
// stays here; the area exists only while the system app is installed.
const DESK_DIR = '/etc/shareos/desktop', DESK_MAX = 16384;   // desktop layouts (module desktop)
const MODULES = [ 'paperless', 'cloud', 'dnsfilter', 'desktop' ];
function module_on(id) {
	let a = null;
	try { a = json(readfile('/opt/shareos/sysapps/' + id + '/app.json') ?? 'null'); } catch (e) { }
	return type(a) == 'object' && a.module == id;
}

// areas that can be switched off under System -> Appearance (tab hidden,
// background work stopped): apps (apps web server, app tasks); a module's
// area (paperless, cloud, dnsfilter, desktop) is on while it is installed
const AREAS = [ 'apps' ];
function area_on(a) {
	if (index(MODULES, a) >= 0) return module_on(a);
	return cursor().get('shareos', 'ui', 'area_' + a) != '0';
}

function ui_settings() {
	let c = cursor();
	let theme = c.get('shareos', 'ui', 'theme'), accent = c.get('shareos', 'ui', 'accent');
	let areas = {};
	for (let a in AREAS) areas[a] = c.get('shareos', 'ui', 'area_' + a) != '0';
	for (let m in MODULES) areas[m] = module_on(m);
	return {
		lang: c.get('shareos', 'ui', 'lang') ?? 'en',
		logo: (c.get('shareos', 'ui', 'logo') ?? '1') != '0',
		areas,
		theme: THEMES[theme] ? theme : 'dark',
		accent: ACCENTS[accent] ? accent : 'blue'
	};
}

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.ui': {
		// public (also before login): language and logo for the login page
		get: {
			call: function() { return { ...ui_settings(), default_password: default_password() }; }
		},

		set: {
			args: { lang: '', logo: false, theme: '', accent: '', areas: {} },
			call: function(req) {
				let c = cursor();
				c.set('shareos', 'ui', 'ui');   // section may be missing in configs from older versions
				let changed = {};
				if (type(req.args.areas) == 'object')
					for (let a in AREAS) if (req.args.areas[a] != null) {
						let v = req.args.areas[a] ? '1' : '0';
						if ((c.get('shareos', 'ui', 'area_' + a) ?? '1') != v) changed[a] = v;
						c.set('shareos', 'ui', 'area_' + a, v);
					}
				if (req.args.lang != null && req.args.lang != '') {
					if (!match(req.args.lang, /^[a-z]{2}(-[A-Za-z]{2})?$/)) return { error: 'invalid language' };
					c.set('shareos', 'ui', 'lang', req.args.lang);
				}
				if (req.args.logo != null)
					c.set('shareos', 'ui', 'logo', req.args.logo ? '1' : '0');
				if (req.args.theme) {
					if (!THEMES[req.args.theme]) return { error: 'invalid theme' };
					c.set('shareos', 'ui', 'theme', req.args.theme);
				}
				if (req.args.accent) {
					if (!ACCENTS[req.args.accent]) return { error: 'invalid accent' };
					c.set('shareos', 'ui', 'accent', req.args.accent);
				}
				c.commit('shareos');
				if (length(changed)) {
					system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
					if (changed.apps) system('/etc/init.d/S51apps ' + (changed.apps == '1' ? 'start' : 'stop') + ' >/dev/null 2>&1');
				}
				return ui_settings();
			}
		}
	},

	'shareos.web': {
		get: {
			call: function() {
				let c = cursor();
				let wh = web_host();
				return { https: c.get('shareos', 'web', 'https') != '0', redirect: c.get('shareos', 'web', 'redirect') == '1', cert: cert_info(),
					host: c.get('shareos', 'web', 'host') ?? '', cert_host: cert_host(), source: c.get('shareos', 'web', 'source') ?? '' };
			}
		},

		set: {
			args: { https: true, redirect: false, host: '' },
			call: function(req) {
				let c = cursor();
				let h = req.args.host;
				if (h != null && h != '' && !match(h, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,250}[A-Za-z0-9])?$/)) return { error: 'invalid host name' };
				c.set('shareos', 'web', 'web');
				if (h != null) {
					if (h == '') c.delete('shareos', 'web', 'host'); else c.set('shareos', 'web', 'host', lc(h));
					if (req.args.https == null && req.args.redirect == null) { c.commit('shareos'); return { ok: true }; }
				}
				if (req.args.https != null) c.set('shareos', 'web', 'https', req.args.https ? '1' : '0');
				if (req.args.redirect != null) c.set('shareos', 'web', 'redirect', req.args.redirect ? '1' : '0');
				c.commit('shareos');
				restart_uhttpd();
				return { ok: true };
			}
		},

		selfsigned: {
			call: function() {
				let r = sh(CERT + ' selfsigned'); forget('cert');
				if (r.rc != 0) return { error: trim(r.out) };
				web_source('');
				restart_uhttpd();
				return { ok: true, cert: cert_info() };
			}
		},

		// dynamic DNS (shareos-ddns); the token is never sent back
		ddns_get: {
			call: function() { return jparse(trim(sh('/usr/sbin/shareos-ddns status').out) || 'null') ?? { error: 'shareos-ddns failed' }; }
		},

		ddns_set: {
			args: { enabled: false, provider: '', host: '', token: '', user: '', url: '', ipv4: true, ipv6: false },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.provider && !(a.provider in { duckdns: 1, dynv6: 1, cloudflare: 1, noip: 1, custom: 1 })) return { error: 'invalid provider' };
				if (a.host && !match(a.host, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/)) return { error: 'invalid host name' };
				if (a.url && !match(a.url, /^https?:\/\/[^ ]+$/)) return { error: 'invalid URL' };
				for (let k in [ 'token', 'user', 'url' ]) if (length(a[k] ?? '') > 512 || match(a[k] ?? '', /[\n\r]/)) return { error: 'invalid ' + k };
				c.set('shareos', 'ddns', 'ddns');
				c.set('shareos', 'ddns', 'enabled', a.enabled ? '1' : '0');
				for (let k in [ 'provider', 'host', 'user', 'url' ])
					if (a[k] != null) { if (a[k] == '') c.delete('shareos', 'ddns', k); else c.set('shareos', 'ddns', k, k == 'host' ? lc(a[k]) : a[k]); }
				// empty: keep the stored token
				if (a.token) c.set('shareos', 'ddns', 'token', a.token);
				if (a.ipv4 != null) c.set('shareos', 'ddns', 'ipv4', a.ipv4 ? '1' : '0');
				if (a.ipv6 != null) c.set('shareos', 'ddns', 'ipv6', a.ipv6 ? '1' : '0');
				c.commit('shareos');
				system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
				system('rm -f /tmp/shareos-ddns.json');
				if (a.enabled) system('(/usr/sbin/shareos-ddns update force) >/dev/null 2>&1 &');
				return { ok: true, pending: !!a.enabled };
			}
		},

		ddns_update: {
			call: function() {
				system('(/usr/sbin/shareos-ddns update force) >/dev/null 2>&1 &');
				return { ok: true, pending: true };
			}
		},

		// own certificate authority (shareos-ca)
		ca_get: {
			call: function() {
				let i = jparse(trim(sh('/usr/sbin/shareos-ca info').out) || 'null') ?? { exists: false };
				i.certs = i.exists ? (jparse(trim(sh('/usr/sbin/shareos-ca list').out) || '[]') ?? []) : [];
				i.web = cursor().get('shareos', 'web', 'source') == 'ca';
				return i;
			}
		},

		ca_init: {
			call: function() {
				let r = sh('/usr/sbin/shareos-ca init');
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		ca_issue: {
			args: { name: '', hosts: [] },
			call: function(req) {
				let n = req.args.name ?? '', h = req.args.hosts;
				if (!match(n, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/)) return { error: 'invalid name' };
				if (type(h) != 'array' || !length(h) || length(h) > 20) return { error: 'no host names' };
				for (let x in h) if (type(x) != 'string' || !match(x, /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/)) return { error: 'invalid host name: ' + x };
				let r = sh('/usr/sbin/shareos-ca issue ' + shq(n) + ' ' + join(' ', map(h, shq)));
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		// PEM: root (the CA), or crt/key of an issued certificate
		ca_pem: {
			args: { name: '', kind: '' },
			call: function(req) {
				let n = req.args.name ?? '', k = req.args.kind ?? '';
				let r = k == 'root' ? sh('/usr/sbin/shareos-ca root')
					: match(n, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/) && (k == 'crt' || k == 'key') ? sh('/usr/sbin/shareos-ca show ' + shq(n) + ' ' + k)
					: null;
				if (!r) return { error: 'invalid request' };
				return r.rc == 0 ? { pem: r.out } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		ca_delete: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name ?? '';
				if (!match(n, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/)) return { error: 'invalid name' };
				let r = sh('/usr/sbin/shareos-ca delete ' + shq(n));
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		// the web interface gets a certificate of the own CA
		ca_web: {
			call: function() {
				let r = sh('/usr/sbin/shareos-ca web'); forget('cert');
				if (r.rc != 0) return { error: replace(trim(r.out), 'shareos-ca: ', '') };
				system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
				restart_uhttpd();
				return { ok: true };
			}
		},

		// Let's Encrypt for the DynDNS name (shareos-acme, takes up to a few minutes)
		acme_get: {
			call: function() {
				let j = jparse(trim(sh('/usr/sbin/shareos-acme status').out) || 'null') ?? {};
				j.running = acme_running();
				return j;
			}
		},

		acme_issue: {
			args: { email: '', staging: false },
			call: function(req) {
				let m = req.args.email ?? '';
				if (m != '' && !match(m, /^[^@ ]+@[^@ ]+\.[^@ ]+$/)) return { error: 'invalid e-mail address' };
				if (acme_running()) return { error: 'already running' };
				let c = cursor();
				c.set('shareos', 'acme', 'acme');
				if (m == '') c.delete('shareos', 'acme', 'email'); else c.set('shareos', 'acme', 'email', m);
				c.commit('shareos');
				system('(touch /tmp/shareos-acme.running; /usr/sbin/shareos-acme issue ' + (req.args.staging ? 'staging' : '') +
					' >/tmp/shareos-acme.out 2>&1; rm -f /tmp/shareos-acme.running) >/dev/null 2>&1 &');
				forget('cert');
				return { ok: true, running: true };
			}
		},

		acme_off: {
			call: function() {
				let r = sh('/usr/sbin/shareos-acme off'); forget('cert');
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-acme: ', '') };
			}
		},

		install: {
			// PEM texts; the certificate may be followed by the chain
			args: { cert: '', key: '' },
			call: function(req) {
				let crt = req.args.cert ?? '', key = req.args.key ?? '';
				if (length(crt) > 65536 || length(key) > 16384) return { error: 'file too large' };
				let d = trim(sh_quiet('mktemp -d').out);
				if (!match(d, /^\/tmp\/[A-Za-z0-9._-]+$/)) return { error: 'no room for temporary files' };
				writefile(d + '/crt', crt);
				writefile(d + '/key', key);
				let r = sh(CERT + ' install ' + shq(d + '/crt') + ' ' + shq(d + '/key')); forget('cert');
				system('rm -rf ' + shq(d));
				if (r.rc != 0) return { error: replace(trim(r.out), 'shareos-cert: ', '') };
				web_source('');
				restart_uhttpd();
				return { ok: true, cert: cert_info() };
			}
		}
	}
});
