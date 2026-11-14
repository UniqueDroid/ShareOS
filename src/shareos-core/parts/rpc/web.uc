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

