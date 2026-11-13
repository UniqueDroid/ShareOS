/*
 * ShareOS desktop view (module "desktop")
 *
 * Loaded by app.js (deskStart) when the module is installed and "Desktop" was
 * chosen on the login page. Uses the helpers of app.js ($, html, raw, svg, I,
 * rpc, S, store, toast …): classic scripts of one page share their names.
 *
 * - bar: start menu, open windows, CPU/RAM/network, messages, search, account
 * - icons: one per area (and installed web apps), freely placed on a grid
 * - windows: an area of the interface is drawn into its window directly – the
 *   view functions of app.js with the window as their place (VIEW, withView,
 *   pageChanged in app.js); the window in front is "the page", the others
 *   keep what they showed. Areas with several parts (storage, services …)
 *   show them as a bar in the window. The terminal and the web apps are
 *   windows of their own kind (ttyd / the app in its sandboxed frame).
 *   Move, resize, snap to a half or maximise, minimise to the bar.
 * - control panel: categories that open the settings in their windows
 * - layout per account on the box (shareos.me desk_get / desk_set): window
 *   places, open windows, icon places, wallpaper (an image on the box)
 */
'use strict';

const DK_TOP = 56;           // height of the bar
const DK_CELL = [108, 104];  // icon grid
const DK_MIN = [360, 240];   // smallest window
const DK_IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const DK_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };

const DK_I = {
	start: '<circle cx="5" cy="5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="5" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><circle cx="19" cy="19" r="1.6"/>',
	files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	storage: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
	shares: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
	services: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>',
	panel: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
	store: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 13v8M13 17h8"/>',
	task: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
	logs: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/>',
	term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
	cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>',
	paperless: '<path d="M7 3h7l4 4v14H7z"/><path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5"/>',
	dnsfilter: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
	me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
	notes: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
	min: '<path d="M5 12h14"/>',
	max: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
	unmax: '<rect x="8" y="4" width="12" height="12" rx="1"/><path d="M16 20H5a1 1 0 0 1-1-1V8"/>',
	close: '<path d="M6 6l12 12M18 6 6 18"/>',
	reload: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"/>',
	users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .8 3.2 2.5 3.5 5.2"/>',
	group: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c.6-3 2.8-5 6-5s5.4 2 6 5M14 15.2c.6-.1 1.3-.2 2-.2 3.2 0 5.4 2 6 5"/>',
	general: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
	net: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
	time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
	look: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
	image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
	firmware: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
	autostart: '<path d="M5 4v16M5 12h9l-3-3M14 12l-3 3"/><path d="M19 4v16"/>',
	media: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M10 9l4 2-4 2z"/><path d="M8 21h8"/>',
	printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
	ups: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M12.5 7 10 12h4l-2.5 5"/>',
	torrent: '<path d="M12 3v11M8 10l4 4 4-4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
	health: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>',
	snap: '<circle cx="12" cy="13" r="4"/><path d="M4 8h3l2-3h6l2 3h3v11H4z"/>',
	app: '<rect x="4" y="4" width="16" height="16" rx="4"/>'
};
const dkIco = (k) => svg(DK_I[k] || DK_I.app);

const D = {
	wins: [],        // open windows: { id, kind, title, ico, app, view, x, y, w, h, max, snap, min, z, el }
	                 // kind: view (an area: view = { el, route, utab, uapp }), app, term, panel
	z: 20,
	geo: {},         // last normal place of a window per id
	icons: {},       // icon places per id: [column, row]
	wall: null,      // { root, path, name, fit } – an image on the box
	wallUrl: null,
	timers: [],
	ac: null,        // AbortController of the listeners
	saveT: null,
	drag: null,
	loaded: false
};

/* ---------- what the desktop offers --------------------------------------------- */

// The areas of the interface as windows. An area with several parts is one
// window (its parts are a bar in it), except the ones that are tools of their
// own: files, logs, terminal. id -> the page it starts with.
const DK_AREA = { files: ['shares', 'files'], storage: ['storage', 'volumes'], shares: ['shares', 'shares'], services: ['services', 'status'],
	store: ['apps', 'store'], task: ['overview', ''], logs: ['system', 'logs'], system: ['system', 'general'],
	cloud: ['cloud', ''], paperless: ['paperless', ''], dnsfilter: ['dnsfilter', ''] };
const DK_TITLE = { files: ['Files', 'files'], storage: ['Storage', 'storage'], shares: ['Shares', 'shares'], services: ['Services', 'services'],
	store: ['App store', 'store'], task: ['Task manager', 'task'], logs: ['Logs', 'logs'], system: ['Settings', 'settings'], term: ['Terminal', 'term'],
	panel: ['Control panel', 'panel'], cloud: ['Cloud', 'cloud'], paperless: ['Paperless', 'paperless'], dnsfilter: ['DNS filter', 'dnsfilter'],
	me: ['My ShareOS', 'me'], settings: ['Settings', 'settings'] };
// the window of a page (admins)
function dkAreaOf(r) {
	if (r.tab === 'shares' && r.sub === 'files') return 'files';
	if (r.tab === 'system') return r.sub === 'logs' ? 'logs' : r.sub === 'terminal' ? 'term' : 'system';
	if (r.tab === 'apps') return 'store';
	if (r.tab === 'overview') return 'task';
	return r.tab;
}

// desktop icons (and start menu entries): id, title, icon
function dkItems() {
	const L = [];
	const add = (id, extra = {}) => L.push({ id, title: DK_TITLE[id][0], ico: DK_TITLE[id][1], ...extra });
	if (isUser()) {
		add('me');
		if (S.me?.files) add('files');
		for (const a of S.me?.apps || []) if (a.type !== 'system') L.push({ id: 'app:' + a.id, title: a.name, ico: 'app', app: a });
		add('settings');
		return L;
	}
	add('files'); add('storage'); add('shares'); add('services'); add('panel');
	if (tabOn('apps')) add('store');
	add('task'); add('logs'); add('term');
	for (const m of ['cloud', 'paperless', 'dnsfilter']) if (S.areas?.[m]) add(m);
	for (const a of S.apps?.installed?.apps || []) if (a.type !== 'system') L.push({ id: 'app:' + a.id, title: a.name, ico: 'app', app: a });
	return L;
}

// control panel: the settings by category (admins) – [title, icon, page, action]
function dkPanel() {
	return [
		['Access & connection', [['User', 'users', '#/shares/users'], ['Groups', 'group', '#/shares/groups'], ['Shares', 'shares', '#/shares/shares'], ['Terminal', 'term', '#/system/terminal']]],
		['General', [['General', 'general', '#/system/general'], ['Network', 'net', '#/system/network'], ['Time', 'time', '#/system/time'], ['Appearance', 'look', '#/system/appearance'],
			['Wallpaper', 'image', null, 'wall'], ['Messages', 'notes', '#/system/notifications'], ['Power & reset', 'power', '#/system/power']]],
		['Services', [['Status', 'services', '#/services/status'], ['Autostart', 'autostart', '#/services/autostart'], ['Media server', 'media', '#/services/dlna'], ['Printer', 'printer', '#/services/printer'], ['UPS', 'ups', '#/services/ups'], ['Torrent remote access', 'torrent', '#/services/torrent']]],
		['Storage', [['Drives', 'storage', '#/storage/volumes'], ['Health', 'health', '#/storage/health'], ['Snapshots', 'snap', '#/storage/snapshots']]],
		['System', [['Firmware', 'firmware', '#/system/firmware'], ['Logs', 'logs', '#/system/logs'],
			...(tabOn('apps') ? [['Installed apps', 'store', '#/apps/installed'], ['App sources', 'store', '#/apps/sources']] : [])]]
	];
}
const dkPanelFlat = () => dkPanel().flatMap(([, l]) => l.map(([t, ico, route, act]) => ({ id: route ? 'r:' + route : act, title: t, ico, route, act })));

/* ---------- start --------------------------------------------------------------- */

async function deskRun() {
	// first-run wizard and recovery need the classic page
	if (!isUser()) {
		const [st, rec] = await Promise.all([rpc('shareos.setup', 'status').catch(() => null), rpc('shareos.recovery', 'status').catch(() => null)]);
		if ((st && !st.done) || rec?.active) { renderShell(); return; }
	}
	S.desk = true;
	stopPolling();
	if (location.hash) history.replaceState(null, '', location.pathname + location.search);
	D.ac?.abort();
	D.ac = new AbortController();
	applyTheme();
	$('#root').innerHTML = html`<div class="dk" id="dk">
		<div class="dk-wall" id="dk-wall"></div>
		<header class="dk-bar">
			<button class="dk-tb dk-sb" type="button" data-dk="start" aria-label="Start menu" title="Start menu" aria-expanded="false">${dkIco('start')}</button>
			<div class="dk-brand">SHAREOS</div>
			<nav class="dk-task" id="dk-task" aria-label="Open windows"></nav>
			<div class="dk-stat" id="dk-stat"></div>
			<button class="dk-tb" type="button" data-dk="notes" id="dk-bell" aria-label="Messages" title="Messages" hidden>${dkIco('notes')}<span class="dk-badge" id="dk-badge" hidden></span></button>
			<button class="dk-tb" type="button" data-dk="search" aria-label="Search" title="Search">${dkIco('search')}</button>
			<button class="dk-av" type="button" data-dk="menu" aria-label="User menu" title="User menu" aria-expanded="false" id="dk-av"></button>
			<div class="dk-clock" id="dk-clock"></div>
		</header>
		<div class="dk-icons" id="dk-icons" role="list" aria-label="Desktop"></div>
		<div class="dk-snapv" id="dk-snapv" hidden></div>
		<div class="dk-wins" id="dk-wins"></div>
		<div class="dk-pop dk-start" id="dk-start" role="dialog" aria-label="Start menu" hidden></div>
		<div class="dk-pop dk-menu" id="dk-menu" role="dialog" aria-label="User menu" hidden></div>
	</div>`.s;
	const sig = { signal: D.ac.signal };
	const dk = $('#dk');
	dk.addEventListener('click', dkClick, sig);
	dk.addEventListener('pointerdown', dkDown, sig);
	dk.addEventListener('dblclick', (e) => { const t = e.target.closest('.dk-wt'); if (t && !e.target.closest('button')) dkMax(dkWin(t.closest('.dk-win').dataset.id)); }, sig);
	dk.addEventListener('input', (e) => { if (e.target.id === 'dk-q') dkStartList(); if (e.target.id === 'dk-pq') dkPanelDraw(); }, sig);
	dk.addEventListener('keydown', dkKey, sig);
	window.addEventListener('resize', () => { dkIcons(); D.wins.forEach(dkPlace); }, sig);
	window.addEventListener('message', dkMsg, sig);
	// the keyboard reaches a window without a click: it comes to the front as well
	dk.addEventListener('focusin', (e) => { const w = dkWin(e.target.closest?.('.dk-win')?.dataset.id); if (w && dkTop() !== w) dkFocus(w); }, sig);
	// a click into an app or the terminal (a frame) does not reach this page: the page loses the focus
	window.addEventListener('blur', () => setTimeout(() => {
		const f = document.activeElement;
		if (f?.tagName === 'IFRAME') { const w = dkWin(f.closest('.dk-win')?.dataset.id); if (w) dkFocus(w); dkPopsClose(); }
	}, 0), sig);
	dkAvatar();
	dkClock();
	D.timers.push(setInterval(dkClock, 15000));
	// the layout of this account, the apps for the icons
	const [desk] = await Promise.all([rpc('shareos.me', 'desk_get').then((r) => r.desk).catch(() => ({})), dkLoadApps()]);
	dkRestore(desk || {});
	D.loaded = true;
	dkTick();
	D.timers.push(setInterval(dkTick, 5000));
	D.timers.push(setInterval(dkBehind, 1500));
	if (!isUser()) { refreshUpdateStatus(); dkNotes(); D.timers.push(setInterval(dkNotes, 60000)); }
}

function deskStop() {
	D.ac?.abort();
	D.timers.forEach(clearInterval); D.timers = [];
	clearTimeout(D.saveT); clearTimeout(D.refT);
	if (D.wallUrl) URL.revokeObjectURL(D.wallUrl);
	D.wins = []; D.wallUrl = null; D.loaded = false;
	S.desk = false;
	applyTheme();
}

async function dkLoadApps() {
	if (isUser()) return;
	if (!tabOn('apps')) { if (S.apps) S.apps.installed = null; return; }
	try { S.apps = { ...(S.apps || {}), installed: await rpc('shareos.apps', 'installed') }; } catch (e) { }
}

function dkRestore(desk) {
	D.geo = desk.geo && typeof desk.geo === 'object' ? desk.geo : {};
	D.icons = desk.icons && typeof desk.icons === 'object' ? desk.icons : {};
	D.wall = desk.wall && desk.wall.name ? desk.wall : null;
	dkIcons();
	dkWall();
	const items = dkItems();
	for (const o of Array.isArray(desk.open) ? desk.open : []) {
		const it = items.find((x) => x.id === o.id) || (o.id === 'system' && !isUser() ? { id: 'system' } : null);
		if (!it) continue;
		const w = dkOpen(it, true, typeof o.sub === 'string' ? o.sub : null);
		if (w) { w.max = !!o.max; w.snap = o.snap === 'left' || o.snap === 'right' ? o.snap : null; w.min = !!o.min; dkPlace(w); }
	}
	dkTask();
	// every restored area is drawn once; the one in front like a page just opened
	for (const w of D.wins) if (w.view && !w.min && w !== dkTop()) withView(w.view, renderMain);
	dkShow();
}

/* ---------- saving the layout ----------------------------------------------------- */

function dkSave() {
	if (!D.loaded) return;
	clearTimeout(D.saveT);
	D.saveT = setTimeout(() => {
		// a file opened in an app is not opened again at the next login
		const open = D.wins.filter((w) => !w.id.includes('#')).sort((a, b) => a.z - b.z)
			.map((w) => ({ id: w.id, sub: w.view?.route?.sub || undefined, max: w.max || undefined, snap: w.snap || undefined, min: w.min || undefined }));
		// keep the places of the 40 windows used last
		const ids = Object.keys(D.geo);
		if (ids.length > 40) ids.slice(0, ids.length - 40).forEach((k) => delete D.geo[k]);
		rpc('shareos.me', 'desk_set', { desk: { v: 1, open, geo: D.geo, icons: D.icons, wall: D.wall } })
			.catch((e) => toast('Desktop: ' + e.message, true));
	}, 800);
}

/* ---------- bar --------------------------------------------------------------------- */

function dkClock() {
	const c = $('#dk-clock');
	if (c) c.textContent = new Date().toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
}

function dkAvatar() {
	const n = S.me?.fullname || S.me?.name || S.user || '?';
	const av = $('#dk-av');
	if (av) av.textContent = n.trim().charAt(0).toUpperCase();
}

const dkRing = (p, label) => {
	const c = 2 * Math.PI * 14, v = Math.max(0, Math.min(100, p || 0));
	return html`<div class="dk-ring" title="${label} ${Math.round(v)} %"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14" class="bg"/>
		<circle cx="18" cy="18" r="14" class="fg" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 18 18)"/></svg>
		<div><span>${label}</span><b>${Math.round(v)} %</b></div></div>`;
};

async function dkTick() {
	if (document.hidden || isUser()) return;
	await tick();
	// the window in front is drawn by tick() itself; a task manager behind it here
	for (const w of D.wins) if (w.id === 'task' && !w.min && w !== dkTop()) withView(w.view, renderMain);
	const st = $('#dk-stat');
	if (!st || !S.info) return;
	const m = S.info.memory || {};
	st.innerHTML = html`${dkRing(S.cpu, 'CPU')}${dkRing(pct((m.memtotal || 0) - (m.memavailable || 0), m.memtotal), 'RAM')}
		<div class="dk-net" title="eth0"><span>↑ ${fmtRate(S.txRate)}</span><span>↓ ${fmtRate(S.rxRate)}</span></div>`.s;
}

async function dkNotes() {
	if (document.hidden) return;
	await loadNotes();
	const n = (S.notes?.items || []).filter((x) => !x.read && !x.resolved).length;
	const bell = $('#dk-bell'), b = $('#dk-badge');
	if (!bell) return;
	bell.hidden = false;
	b.hidden = !n;
	b.textContent = n > 99 ? '99+' : String(n);
	b.classList.toggle('bad', (S.notes?.items || []).some((x) => !x.read && !x.resolved && x.level === 'error'));
}

function dkTask() {
	const t = $('#dk-task');
	if (!t) return;
	const top = dkTop();
	t.innerHTML = D.wins.map((w) => html`<button class="dk-tw${w === top && !w.min ? ' on' : ''}${w.min ? ' min' : ''}" type="button" data-task="${w.id}" title="${w.title}">
		${w.app ? appIcon(w.app, appSrv()) : dkIco(w.ico)}<span>${w.title}</span></button>`.s).join('');
}

/* ---------- icons on the desktop ------------------------------------------------------- */

function dkCells() {
	const rows = Math.max(1, Math.floor((innerHeight - DK_TOP - 24) / DK_CELL[1]));
	const cols = Math.max(1, Math.floor((innerWidth - 24) / DK_CELL[0]));
	return [cols, rows];
}

// places: saved ones first, the others fill the free cells column by column
function dkIconPlaces(items) {
	const [cols, rows] = dkCells(), used = {}, out = {};
	for (const it of items) {
		const p = D.icons[it.id];
		if (Array.isArray(p) && p[0] < cols && p[1] < rows && !used[p[0] + ':' + p[1]]) { out[it.id] = p; used[p[0] + ':' + p[1]] = 1; }
	}
	let c = 0, r = 0;
	for (const it of items) {
		if (out[it.id]) continue;
		while (used[c + ':' + r]) { r++; if (r >= rows) { r = 0; c++; } }
		out[it.id] = [c, r]; used[c + ':' + r] = 1;
	}
	return out;
}

function dkIcons() {
	const box = $('#dk-icons');
	if (!box) return;
	const items = dkItems(), pl = dkIconPlaces(items);
	box.innerHTML = items.map((it) => html`<button class="dk-ico" type="button" role="listitem" data-open="${it.id}" style="left:${8 + pl[it.id][0] * DK_CELL[0]}px;top:${DK_TOP + 14 + pl[it.id][1] * DK_CELL[1]}px">
		<span class="dk-tile">${it.app ? appIcon(it.app, appSrv()) : dkIco(it.ico)}</span><span class="dk-il">${it.title}</span></button>`.s).join('');
}

/* ---------- windows ---------------------------------------------------------------------- */

const dkWin = (id) => D.wins.find((w) => w.id === id);
const dkTop = () => D.wins.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0] || null;
const dkNarrow = () => innerWidth < 760;

function dkDefault(id, app) {
	const vw = innerWidth, vh = innerHeight - DK_TOP;
	// a web app: the size of its manifest (plus the title bar)
	const want = app ? [app.window?.width || 1000, (app.window?.height || 700) + 42] : id === 'panel' ? [820, 600] : id === 'term' ? [900, 560] : [980, 680];
	const w = Math.min(want[0], vw - 40), h = Math.min(want[1], vh - 30);
	const n = D.wins.length % 6;
	return { x: Math.max(0, Math.round((vw - w) / 2) - 100 + n * 36), y: DK_TOP + Math.max(8, Math.round((vh - h) / 2) - 60 + n * 30), w, h };
}

// app.js asks which area is "the page": the one of the window in front
function deskView() {
	if (!S.desk) return null;
	const w = dkTop();
	return w && w.view ? w.view : null;
}

// The window in front shows an area: load and draw it like a page that was
// just opened (pageChanged in app.js). later: after the click that brought
// the window forward – drawing at once would take its target away.
function dkShow(later = false) {
	clearTimeout(D.refT);
	const go = () => { if (S.desk && deskView()) pageChanged(); };
	if (later) D.refT = setTimeout(go, 120); else go();
}

// An area behind the window in front that still waits for its data: what it
// asked for arrives while another window is "the page" – draw it again until
// it shows its content (at most 20 times; in front it is drawn anyway).
function dkBehind() {
	if (document.hidden) return;
	const top = dkTop();
	for (const w of D.wins) {
		if (!w.view || w.min || w === top) { w.tries = 0; continue; }
		if (!$('.spin', w.view.el) || (w.tries = (w.tries || 0) + 1) > 20) continue;
		withView(w.view, renderMain);
	}
}

function dkWinEl(w) {
	const el = document.createElement('section');
	el.className = 'dk-win';
	el.dataset.id = w.id;
	el.dataset.kind = w.kind;
	el.setAttribute('aria-label', w.title);
	el.innerHTML = html`<div class="dk-wt">
			<span class="dk-wi">${w.app ? appIcon(w.app, appSrv()) : dkIco(w.ico)}</span><h2>${w.title}</h2>
			${w.kind !== 'panel' ? html`<button class="dk-wb" type="button" data-w="reload" aria-label="Reload" title="Reload">${dkIco('reload')}</button>` : ''}
			<button class="dk-wb" type="button" data-w="min" aria-label="Minimise" title="Minimise">${dkIco('min')}</button>
			<button class="dk-wb" type="button" data-w="max" aria-label="Maximise" title="Maximise">${dkIco('max')}</button>
			<button class="dk-wb x" type="button" data-w="close" aria-label="Close" title="Close">${dkIco('close')}</button>
		</div>
		<div class="dk-wc${w.kind === 'view' ? ' dk-view' : ''}"></div>
		<div class="dk-rs" data-rs="e"></div><div class="dk-rs" data-rs="w"></div><div class="dk-rs" data-rs="s"></div>
		<div class="dk-rs" data-rs="se"></div><div class="dk-rs" data-rs="sw"></div>`.s;
	return el;
}

// Open (or bring back) the window of an item. sub: the part of the area to
// show (storage -> health …); url/name: a file opened in a web app.
function dkOpen(it, quiet = false, sub = null) {
	dkPopsClose();
	if (it.act === 'wall') { dkWallDlg(); return null; }
	if (it.route) return dkOpenPage(routeOf(it.route), quiet);
	if (it.app) return deskApp(it.app, null, null, quiet);
	let w = dkWin(it.id);
	const user = isUser();
	if (w) {
		if (sub != null && w.view && !user && w.view.route.sub !== sub) w.view.route = { tab: w.view.route.tab, sub };
		w.min = false; dkFocus(w, true); dkPlace(w); dkTask();
		if (!quiet) { dkSave(); dkShow(); }
		return w;
	}
	const [title, ico] = DK_TITLE[it.id] || [it.title, it.ico];
	const kind = it.id === 'panel' || it.id === 'term' ? it.id : 'view';
	if (kind === 'view' && !user && !DK_AREA[it.id]) return null;
	const g = D.geo[it.id] || dkDefault(it.id);
	w = { id: it.id, kind, title, ico, app: null, view: null, x: g.x, y: g.y, w: g.w, h: g.h, max: false, snap: null, min: false, z: ++D.z };
	w.el = dkWinEl(w);
	if (kind === 'view') {
		const el = $('.dk-wc', w.el);
		w.view = user ? { el, route: { tab: 'desktop', sub: '' }, utab: it.id, uapp: null }
			: { el, route: { tab: DK_AREA[it.id][0], sub: sub ?? DK_AREA[it.id][1] }, utab: null, uapp: null };
		// the parts that are tools of their own are not offered in the bar of the area
		if (!user) w.view.route = routeOf('#/' + w.view.route.tab + '/' + w.view.route.sub);
	}
	D.wins.push(w);
	$('#dk-wins').append(w.el);
	if (kind === 'panel') dkPanelDraw();
	if (kind === 'term') dkTerm(w);
	dkPlace(w);
	dkFocus(w, true);
	dkTask();
	if (!quiet) { dkSave(); dkShow(); }
	return w;
}

// the window of a page of the interface (a link, the control panel, a message)
function dkOpenPage(r, quiet = false) {
	const id = dkAreaOf(r);
	return dkOpen({ id }, quiet, id === 'term' || id === 'panel' ? null : r.sub);
}

// app.js: an address was asked for (a link in a window, location.hash = …)
function deskNav(hash) {
	history.replaceState(null, '', location.pathname + location.search);
	if (!hash || hash === '#' || !S.desk) return;
	const [t, sub, id] = routeParts(hash);
	if (isUser()) {
		if (t === 'app') { const a = findApp(sub); if (a) deskApp(a); return; }
		const it = dkItems().find((x) => x.id === (t === 'appearance' ? 'settings' : t));
		if (it) dkOpen(it);
		return;
	}
	if (t === 'apps' && sub === 'run') { const a = findApp(id); if (a) deskApp(a); return; }
	dkOpenPage(routeOf(hash));
}

// modules or apps changed: icons, start menu, windows of areas that are gone
async function deskAreas() {
	if (!deskOn()) { setView('classic'); return; }
	await dkLoadApps();
	dkIcons();
	if (!$('#dk-start').hidden) dkStartList();
	for (const w of D.wins.slice()) if (w.view && !isUser() && !tabOn(w.view.route.tab)) dkClose(w);
}

/* ---------- web apps: every app is a window of the desktop -------------------------------- */

// url/name: a file opened with the app (its own window next to the app's)
function deskApp(a, url = null, name = null, quiet = false) {
	dkPopsClose();
	let id = 'app:' + a.id;
	let w = dkWin(id);
	if (w && !url) {
		w.min = false; dkFocus(w, true); dkPlace(w); dkTask();
		if (!quiet) dkSave();
		return w;
	}
	if (url) { let n = 2; while (dkWin(id + '#' + n)) n++; id += '#' + n; }
	const g = D.geo['app:' + a.id] || dkDefault(id, a);
	w = { id, kind: 'app', title: name ? `${name} – ${a.name}` : a.name, ico: 'app', app: a, view: null, url,
		x: g.x + (url ? 28 : 0), y: g.y + (url ? 24 : 0), w: g.w, h: g.h, max: false, snap: null, min: false, z: ++D.z };
	w.el = dkWinEl(w);
	D.wins.push(w);
	$('#dk-wins').append(w.el);
	dkAppLoad(w);
	dkPlace(w);
	dkFocus(w, true);
	dkTask();
	if (!quiet) dkSave();
	return w;
}

// the app in its frame: the same sandbox as an app shown in the classic page
async function dkAppLoad(w) {
	const body = $('.dk-wc', w.el);
	body.innerHTML = html`<iframe class="dk-app" data-id="${w.app.id}" title="${w.title}" src="about:blank"
		sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads allow-modals"
		allow="clipboard-read; clipboard-write; fullscreen; autoplay"></iframe>`.s;
	let url = w.url;
	if (!url) {
		const g = await appGrant(w.app);
		url = appLaunchUrl(w.app, appSrv(), g ? { fs: g } : {});
	}
	const f = $('iframe', body);
	if (f && D.wins.includes(w)) f.src = url;
}

/* ---------- terminal: the shell fills its window ----------------------------------------- */

// one session per window (ttyd takes one client and ends when it leaves)
async function dkTerm(w) {
	const body = $('.dk-wc', w.el);
	body.innerHTML = html`<div class="dk-wait"><div class="spin"></div></div>`.s;
	try {
		const t = await termStart();
		if (!D.wins.includes(w)) return;
		body.innerHTML = html`<iframe class="dk-term" title="Terminal" src="${termUrl(t)}" allow="clipboard-read; clipboard-write"></iframe>`.s;
	} catch (e) {
		if (!D.wins.includes(w)) return;
		body.innerHTML = html`<div class="dk-wait"><p class="mut">Terminal: ${e.message}</p><button class="btn" type="button" data-w="reload">Reload</button></div>`.s;
	}
}

// where a window is drawn: maximised, a half or its own place (kept on screen)
function dkRect(w) {
	const vw = innerWidth, vh = innerHeight;
	if (w.max || dkNarrow()) return { x: 0, y: DK_TOP, w: vw, h: vh - DK_TOP };
	if (w.snap) return { x: w.snap === 'right' ? Math.ceil(vw / 2) : 0, y: DK_TOP, w: Math.floor(vw / 2), h: vh - DK_TOP };
	const ww = Math.max(DK_MIN[0], Math.min(w.w, vw)), hh = Math.max(DK_MIN[1], Math.min(w.h, vh - DK_TOP));
	return { x: Math.max(80 - ww, Math.min(w.x, vw - 80)), y: Math.max(DK_TOP, Math.min(w.y, vh - 44)), w: ww, h: hh };
}

function dkPlace(w) {
	const r = dkRect(w), s = w.el.style;
	s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px';
	s.zIndex = w.z;
	w.el.hidden = w.min;
	w.el.classList.toggle('full', !!(w.max || w.snap || dkNarrow()));
	const mb = $('[data-w=max]', w.el);
	if (mb) {
		mb.innerHTML = dkIco(w.max ? 'unmax' : 'max').s;
		mb.title = mb.ariaLabel = w.max ? 'Restore' : 'Maximise';
	}
}

// quiet: the caller draws the area itself (a window that just opened)
function dkFocus(w, quiet = false, later = false) {
	if (!w) return;
	const was = dkTop();
	if (was !== w) w.z = ++D.z;
	D.wins.forEach((x) => { x.el.classList.toggle('on', x === w); x.el.style.zIndex = x.z; });
	dkTask();
	if (was !== w && !quiet) dkShow(later);
}

function dkMax(w) {
	if (!w) return;
	w.max = !w.max; w.snap = null;
	dkPlace(w); dkFocus(w); dkSave();
}

function dkMin(w) {
	w.min = true;
	dkPlace(w); dkTask(); dkSave();
	const t = dkTop();
	if (t) { dkFocus(t, true); dkShow(); }
}

function dkClose(w) {
	w.el.remove();
	D.wins = D.wins.filter((x) => x !== w);
	if (w.view && !isUser()) pageClosed(w.view.route);
	dkTask(); dkSave();
	const t = dkTop();
	if (t) { dkFocus(t, true); dkShow(); }
}

/* ---------- moving and resizing (pointer events, captured by the grip) ------------------- */

function dkDown(e) {
	if (e.button !== 0) return;
	const ico = e.target.closest('.dk-ico');
	if (ico) { dkIconDown(e, ico); return; }
	const sec = e.target.closest('.dk-win');
	if (!sec) return;
	const w = dkWin(sec.dataset.id);
	dkFocus(w, false, true);
	dkPopsClose();
	const rs = e.target.closest('[data-rs]'), bar = e.target.closest('.dk-wt');
	if ((!rs && !bar) || e.target.closest('button') || dkNarrow()) return;
	if (rs && (w.max || w.snap)) return;
	e.preventDefault();
	const grip = rs || bar;
	try { grip.setPointerCapture(e.pointerId); } catch (err) { }
	const r = dkRect(w);
	D.drag = { w, grip, mode: rs ? rs.dataset.rs : 'move', sx: e.clientX, sy: e.clientY, g: { x: r.x, y: r.y, w: r.w, h: r.h }, moved: false, snap: null };
	const sig = { signal: D.ac.signal };
	grip.addEventListener('pointermove', dkMove, sig);
	grip.addEventListener('pointerup', dkUp, sig);
	grip.addEventListener('pointercancel', dkUp, sig);
}

function dkMove(e) {
	const d = D.drag;
	if (!d) return;
	const dx = e.clientX - d.sx, dy = e.clientY - d.sy, w = d.w;
	if (!d.moved) {
		if (Math.abs(dx) + Math.abs(dy) < 4) return;
		d.moved = true;
		$('#dk').classList.add('dk-dragging');
		// a maximised or snapped window comes back in its own size, under the pointer
		if (d.mode === 'move' && (w.max || w.snap)) {
			const rel = (d.sx - d.g.x) / d.g.w;
			w.max = false; w.snap = null;
			d.g = { x: d.sx - rel * w.w, y: DK_TOP, w: w.w, h: w.h };
		}
	}
	const g = d.g;
	if (d.mode === 'move') {
		w.x = Math.round(g.x + dx); w.y = Math.round(g.y + dy);
		d.snap = e.clientX <= 3 ? 'left' : e.clientX >= innerWidth - 4 ? 'right' : e.clientY <= 3 ? 'max' : null;
		const v = $('#dk-snapv');
		v.hidden = !d.snap;
		if (d.snap) {
			const half = Math.floor(innerWidth / 2);
			Object.assign(v.style, { left: (d.snap === 'right' ? innerWidth - half : 0) + 'px', top: DK_TOP + 'px', width: (d.snap === 'max' ? innerWidth : half) + 'px', height: innerHeight - DK_TOP + 'px' });
		}
	} else {
		if (d.mode.includes('e')) w.w = Math.max(DK_MIN[0], Math.round(g.w + dx));
		if (d.mode.includes('s')) w.h = Math.max(DK_MIN[1], Math.round(g.h + dy));
		if (d.mode.includes('w')) { w.w = Math.max(DK_MIN[0], Math.round(g.w - dx)); w.x = g.x + g.w - w.w; }
	}
	dkPlace(w);
}

function dkUp() {
	const d = D.drag;
	D.drag = null;
	if (!d) return;
	['pointermove', 'pointerup', 'pointercancel'].forEach((t) => d.grip.removeEventListener(t, t === 'pointermove' ? dkMove : dkUp));
	$('#dk')?.classList.remove('dk-dragging');
	$('#dk-snapv').hidden = true;
	if (!d.moved) return;
	const w = d.w;
	if (d.snap === 'max') { w.max = true; w.x = d.g.x; w.y = d.g.y; }
	else if (d.snap) { w.snap = d.snap; w.x = d.g.x; w.y = d.g.y; }
	const r = dkRect(w);
	if (!w.max && !w.snap) { w.x = r.x; w.y = r.y; w.w = r.w; w.h = r.h; }
	D.geo[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h };
	dkPlace(w); dkSave();
}

// icons: a click opens, dragging moves the icon to another cell (swap when taken)
function dkIconDown(e, ico) {
	if (dkNarrow()) return;
	const sx = e.clientX, sy = e.clientY, x0 = ico.offsetLeft, y0 = ico.offsetTop;
	let moved = false;
	try { ico.setPointerCapture(e.pointerId); } catch (err) { }
	const move = (ev) => {
		const dx = ev.clientX - sx, dy = ev.clientY - sy;
		if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
		moved = true;
		ico.classList.add('drag');
		ico.style.left = x0 + dx + 'px'; ico.style.top = y0 + dy + 'px';
	};
	const up = (ev) => {
		ico.removeEventListener('pointermove', move); ico.removeEventListener('pointerup', up); ico.removeEventListener('pointercancel', up);
		if (!moved) return;
		ico.dataset.moved = '1';
		const [cols, rows] = dkCells();
		const c = Math.max(0, Math.min(cols - 1, Math.round((x0 + ev.clientX - sx - 8) / DK_CELL[0])));
		const r = Math.max(0, Math.min(rows - 1, Math.round((y0 + ev.clientY - sy - DK_TOP - 14) / DK_CELL[1])));
		const items = dkItems(), pl = dkIconPlaces(items), id = ico.dataset.open;
		const other = Object.keys(pl).find((k) => k !== id && pl[k][0] === c && pl[k][1] === r);
		items.forEach((it) => { D.icons[it.id] = pl[it.id]; });
		if (other) D.icons[other] = pl[id];
		D.icons[id] = [c, r];
		dkIcons(); dkSave();
	};
	ico.addEventListener('pointermove', move, { signal: D.ac.signal });
	ico.addEventListener('pointerup', up, { signal: D.ac.signal });
	ico.addEventListener('pointercancel', up, { signal: D.ac.signal });
}

/* ---------- clicks, keys, messages ---------------------------------------------------------- */

function dkFind(id) {
	return [...dkItems(), ...(isUser() ? [] : dkPanelFlat())].find((x) => x.id === id);
}


async function dkClick(e) {
	const b = e.target.closest('button, a');
	if (!b) { if (!e.target.closest('.dk-pop')) dkPopsClose(); return; }
	if (b.dataset.open) {
		if (b.dataset.moved) { delete b.dataset.moved; return; }
		const it = dkFind(b.dataset.open);
		if (it) dkOpen(it);
		return;
	}
	if (b.dataset.w) {
		const w = dkWin(b.closest('.dk-win').dataset.id);
		if (b.dataset.w === 'close') dkClose(w);
		else if (b.dataset.w === 'min') dkMin(w);
		else if (b.dataset.w === 'max') dkMax(w);
		else if (b.dataset.w === 'reload') { if (w.kind === 'app') dkAppLoad(w); else if (w.kind === 'term') dkTerm(w); else dkShow(); }
		return;
	}
	if (b.dataset.task) {
		const w = dkWin(b.dataset.task);
		if (w.min || dkTop() !== w) { w.min = false; dkPlace(w); dkFocus(w, true); dkShow(); } else dkMin(w);
		dkTask(); dkSave();
		return;
	}
	const k = b.dataset.dk;
	if (!k) return;
	if (k === 'start' || k === 'search') { dkStartToggle(k === 'search' ? true : null); return; }
	if (k === 'menu') { dkMenuToggle(); return; }
	if (k === 'notes') { dkOpenPage(routeOf('#/system/notifications')); return; }
	dkPopsClose();
	if (k === 'classic') setView('classic');
	else if (k === 'logout') { await logout(); deskStop(); location.reload(); }
	else if (k === 'wall') dkWallDlg();
	else if (k === 'look') { if (isUser()) dkOpen({ id: 'settings' }); else dkOpenPage(routeOf('#/system/appearance')); }
	else if (k === 'arrange') {
		if (!await confirmDlg('Reset the layout?', 'Icons and windows go back to their default places.', 'Reset')) return;
		D.icons = {}; D.geo = {};
		dkIcons(); dkSave();
	}
	else if (k === 'theme') ACTIONS.theme();
	else if (k === 'panel-open') { const it = dkPanelFlat().find((x) => x.id === b.dataset.id); if (it) dkOpen(it); }
}

function dkKey(e) {
	if (e.key !== 'Escape') return;
	if (!$('#dk-start').hidden || !$('#dk-menu').hidden) { dkPopsClose(); e.preventDefault(); }
}

// messages of the web apps in the windows: an app that closes itself (it handed
// its file to a window of the same app that is already open) closes its window
function dkMsg(ev) {
	const m = ev.data || {};
	if (!appSrv() || ev.origin !== appBase(appSrv()) || m.sos !== 'close') return;
	const w = D.wins.find((x) => x.kind === 'app' && $('iframe', x.el)?.contentWindow === ev.source);
	if (!w) return;
	const other = D.wins.find((x) => x !== w && x.kind === 'app' && x.app.id === w.app.id);
	dkClose(w);
	if (other) { other.min = false; dkPlace(other); dkFocus(other); }
}

// app.js applyTheme: the areas shown take the new look with the page; the
// settings that show the look are drawn again
function deskLook() {
	for (const w of D.wins) {
		if (!w.view || w.min) continue;
		if (isUser() ? w.view.utab === 'settings' : w.view.route.tab === 'system' && w.view.route.sub === 'appearance') withView(w.view, renderMain);
	}
}

/* ---------- start menu and account menu --------------------------------------------------- */

function dkPopsClose() {
	const s = $('#dk-start'), m = $('#dk-menu');
	if (s) s.hidden = true;
	if (m) m.hidden = true;
	$('[data-dk=start]')?.setAttribute('aria-expanded', 'false');
	$('#dk-av')?.setAttribute('aria-expanded', 'false');
}

function dkStartToggle(search) {
	const s = $('#dk-start');
	const open = s.hidden || search;
	dkPopsClose();
	if (!open) return;
	s.innerHTML = html`<label class="dk-q">${dkIco('search')}<input id="dk-q" type="search" placeholder="Search apps and settings" aria-label="Search apps and settings" autocomplete="off"></label>
		<div id="dk-sl"></div>
		<div class="dk-sf"><span class="dk-av sm" aria-hidden="true">${$('#dk-av').textContent}</span>
			<div class="dk-who">${dkWho()}</div>
			<button class="btn sm ghost" type="button" data-dk="classic">Classic view</button>
			<button class="btn sm ghost" type="button" data-dk="logout">Log out</button></div>`.s;
	s.hidden = false;
	$('[data-dk=start]').setAttribute('aria-expanded', 'true');
	dkStartList();
	$('#dk-q').focus();
}

function dkStartList() {
	const q = ($('#dk-q')?.value || '').trim().toLowerCase(), box = $('#dk-sl');
	if (!box) return;
	const tile = (it) => html`<button class="dk-st" type="button" data-open="${it.id}">${it.app ? appIcon(it.app, appSrv()) : dkIco(it.ico)}<span>${it.title}</span></button>`;
	const items = dkItems();
	if (q) {
		// the visible (translated) names are searched as well as the German ones
		const all = [...items, ...(isUser() ? [] : dkPanelFlat().filter((p) => !items.some((x) => x.title === p.title)))];
		const hit = all.filter((it) => it.title.toLowerCase().includes(q) || (typeof i18nText === 'function' && i18nText(it.title).toLowerCase().includes(q)));
		box.innerHTML = hit.length ? html`<div class="dk-sg">${hit.map(tile)}</div>`.s : html`<p class="dk-none">Nothing found.</p>`.s;
		return;
	}
	const sys = items.filter((x) => !x.app && !['cloud', 'paperless', 'dnsfilter'].includes(x.id));
	const more = items.filter((x) => x.app || ['cloud', 'paperless', 'dnsfilter'].includes(x.id));
	box.innerHTML = html`<div class="dk-sh">SYSTEM</div><div class="dk-sg">${sys.map(tile)}</div>
		${more.length ? html`<div class="dk-sh">MODULES &amp; APPS</div><div class="dk-sg">${more.map(tile)}</div>` : ''}`.s;
}

// name of the account and its role (root: "Administrator" and "root")
function dkWho() {
	const n = S.me?.name || S.user, full = S.me?.fullname || n, role = ROLE_TXT[S.me?.role] || '';
	return html`<b>${full}</b><span>${role && role !== full ? role : n}</span>`;
}

function dkMenuToggle() {
	const m = $('#dk-menu');
	const open = m.hidden;
	dkPopsClose();
	if (!open) return;
	m.innerHTML = html`<div class="dk-mh">${dkWho()}</div>
		<button class="dk-mi" type="button" data-dk="theme">${svg(I.moon)}<span>Toggle light/dark</span></button>
		<button class="dk-mi" type="button" data-dk="look">${dkIco('look')}<span>Appearance</span></button>
		<button class="dk-mi" type="button" data-dk="wall">${dkIco('image')}<span>Wallpaper</span></button>
		<button class="dk-mi" type="button" data-dk="arrange">${dkIco('reload')}<span>Reset layout</span></button>
		<button class="dk-mi" type="button" data-dk="classic">${svg(I.classic)}<span>Classic view</span></button>
		<button class="dk-mi" type="button" data-dk="logout">${svg(I.power)}<span>Log out</span></button>`.s;
	m.hidden = false;
	$('#dk-av').setAttribute('aria-expanded', 'true');
	$('button', m).focus();
}

/* ---------- control panel ----------------------------------------------------------------- */

function dkPanelDraw() {
	const w = dkWin('panel');
	if (!w) return;
	const body = $('.dk-wc', w.el);
	const q = ($('#dk-pq')?.value || '').trim().toLowerCase();
	const hit = (t) => !q || t.toLowerCase().includes(q) || (typeof i18nText === 'function' && i18nText(t).toLowerCase().includes(q));
	const cats = dkPanel().map(([c, l]) => [c, l.filter(([t]) => hit(t))]).filter(([, l]) => l.length);
	const list = html`${cats.map(([c, l]) => html`<div class="dk-ch">${c}</div><div class="dk-cg">${l.map(([t, ico, route, act]) =>
		html`<button class="dk-cat" type="button" data-dk="panel-open" data-id="${route ? 'r:' + route : act}">${dkIco(ico)}<span>${t}</span></button>`)}</div>`)}
		${cats.length ? '' : html`<p class="dk-none">Nothing found.</p>`}`;
	if (!$('#dk-pq', body)) {
		body.innerHTML = html`<div class="dk-panel"><label class="dk-q">${dkIco('search')}<input id="dk-pq" type="search" placeholder="Search all settings" aria-label="Search all settings" autocomplete="off"></label>
			<div id="dk-pl">${list}</div></div>`.s;
	} else $('#dk-pl', body).innerHTML = list.s;
}

/* ---------- wallpaper: an image on the box -------------------------------------------------- */

async function dkWall() {
	const el = $('#dk-wall');
	if (!el) return;
	if (D.wallUrl) { URL.revokeObjectURL(D.wallUrl); D.wallUrl = null; }
	el.style.backgroundImage = '';
	el.className = 'dk-wall';
	if (!D.wall) return true;
	try {
		const t = await rpc('shareos.files', 'ticket', { root: D.wall.root, path: D.wall.path || '', name: D.wall.name, mode: 'get' });
		const r = await fetch(t.url, { cache: 'no-store' });
		if (!r.ok) throw new Error('HTTP ' + r.status);
		const b = await r.blob();
		const ext = (D.wall.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
		D.wallUrl = URL.createObjectURL(new Blob([b], { type: DK_TYPES[ext] || 'image/jpeg' }));
		el.style.backgroundImage = `url("${D.wallUrl}")`;
		el.className = 'dk-wall img fit-' + (D.wall.fit === 'contain' || D.wall.fit === 'tile' ? D.wall.fit : 'cover');
		return true;
	} catch (e) { toast('Wallpaper: ' + e.message, true); return false; }
}

// pick an image on the box: the places of the file browser, then folders and images
function dkWallDlg() {
	dkPopsClose();
	const d = document.createElement('dialog');
	d.className = 'dlg dk-wd';
	let places = null, place = null, cur = '', fit = D.wall?.fit || 'cover';
	const join = (...p) => p.filter(Boolean).join('/');
	const draw = async () => {
		let body;
		try {
			if (!places) places = (await rpc('shareos.files', 'roots')).roots || [];
			if (!place) {
				body = places.length ? html`<div class="fb-list" data-i18n-skip>${places.map((x, i) => html`<button class="btn ghost fb-item" type="button" data-place="${i}">${svg(I.folder)}<span>${x.name}</span></button>`)}</div>`
					: html`<p class="note">No drives or shares.</p>`;
			} else {
				const r = await rpc('shareos.files', 'list', { root: place.name, path: cur });
				const dirs = r.entries.filter((x) => x.type === 'dir' || x.type === 'dirlink'), imgs = r.entries.filter((x) => x.type === 'file' && DK_IMG.test(x.name));
				body = dirs.length || imgs.length ? html`<div class="fb-list" data-i18n-skip>${dirs.map((x) => html`<button class="btn ghost fb-item" type="button" data-dir="${x.name}">${svg(I.folder)}<span>${x.name}</span></button>`)}
					${imgs.map((x) => html`<button class="btn ghost fb-item" type="button" data-img="${x.name}">${dkIco('image')}<span>${x.name}</span></button>`)}</div>`
					: html`<p class="mut" style="margin:10px 0">No images in this folder.</p>`;
			}
		} catch (e) {
			body = html`<p class="note">${e.message === 'not allowed' ? 'A wallpaper from the box needs the “Files” permission for your account.' : e.message}</p>`;
		}
		d.innerHTML = html`<h3>Wallpaper</h3>
			<p class="note" style="margin:0 0 12px">An image (JPG, PNG, WebP, GIF) from the box – saved for you only.</p>
			<div class="fb-path"><button class="btn sm" type="button" value="up"${place ? '' : raw(' disabled')}>Up</button>
				<code data-i18n-skip>${place ? '/' + join(place.name, cur) : '/'}</code></div>
			${body}
			<label class="f" style="margin-top:14px"><span>IMAGE FIT</span><select id="dk-fit">
				${[['cover', 'Fill'], ['contain', 'Fit'], ['tile', 'Tile']].map(([v, t]) => html`<option value="${v}"${fit === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<div class="acts" style="margin-top:14px"><button class="btn" type="button" value="default"${D.wall ? '' : raw(' disabled')}>ShareOS (default)</button>
				<button class="btn ghost ml" type="button" value="no">Close</button></div>`.s;
	};
	d.addEventListener('change', (e) => {
		if (e.target.id !== 'dk-fit') return;
		fit = e.target.value;
		if (D.wall) { D.wall = { ...D.wall, fit }; dkWall(); dkSave(); }
	});
	d.addEventListener('click', async (e) => {
		const b = e.target.closest('button');
		if (!b) return;
		if (b.dataset.place != null) { place = places[+b.dataset.place]; cur = ''; return draw(); }
		if (b.dataset.dir != null) { cur = join(cur, b.dataset.dir); return draw(); }
		if (b.dataset.img != null) {
			// "saved" only for an image that could be loaded; otherwise the
			// wallpaper stays what it was
			const before = D.wall;
			D.wall = { root: place.name, path: cur, name: b.dataset.img, fit };
			if (await dkWall()) { dkSave(); toast('Wallpaper saved.'); }
			else { D.wall = before; dkWall(); }
			return draw();
		}
		if (b.value === 'up') { if (cur) cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''; else place = null; return draw(); }
		if (b.value === 'default') { D.wall = null; dkWall(); dkSave(); return draw(); }
		if (b.value === 'no') d.close();
	});
	d.addEventListener('close', () => d.remove());
	$('#app').append(d);
	d.innerHTML = html`<h3>Wallpaper</h3><div class="spin" style="margin:12px 0"></div>`.s;
	d.showModal();
	// start in the folder of the current image
	if (D.wall) { place = { name: D.wall.root }; cur = D.wall.path || ''; }
	draw();
}
