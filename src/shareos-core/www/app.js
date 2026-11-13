/*
 * ShareOS web interface
 *
 * Plain JavaScript, no framework (fits 256 MB RAM and a 5 MB system image).
 * Talks only to the rpcd JSON-RPC endpoint /ubus (sessions + ACLs from rpcd);
 * the look comes from shareos.css (derived from the Skynet intranet).
 */
'use strict';

/* ---------- language ---------------------------------------------------------- */

// language and logo are system-wide settings (UCI shareos.ui, readable before
// login via shareos.ui get); the last known values are cached per browser so
// the first paint already matches
let LANG = (() => { try { return localStorage.getItem('shareos.lang') || 'en'; } catch (e) { return 'en'; } })();
let LOC = 'en-GB';
const LOCALES = { de: 'de-DE', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-BR', ru: 'ru-RU', zh: 'zh-CN', hi: 'hi-IN', bn: 'bn-BD', ar: 'ar-EG' };
// languages written right to left
const RTL = { ar: 1, he: 1, fa: 1, ur: 1 };

/* ---------- helpers --------------------------------------------------------- */

// VIEW: the window of the desktop view an area is drawn into or acts in
// ({ el, route }, see desktop.js). The classic view has one page and no VIEW.
let VIEW = null;
const viewNow = () => VIEW || (typeof deskView === 'function' ? deskView() : null);
// several areas can be on the page at once (desktop): look in the current one first
const $ = (sel, el) => {
	if (el) return el.querySelector(sel);
	const v = viewNow();
	return (v && v.el.querySelector(sel)) || document.querySelector(sel);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v));
function html(strings, ...vals) {
	let out = '';
	strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); });
	return raw(out);
}

const fmtBytes = (b, d = 1) => {
	if (b == null) return '–';
	const u = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
	return b.toLocaleString(LOC, { maximumFractionDigits: i ? d : 0 }) + ' ' + u[i];
};
const fmtRate = (b) => (b == null ? '–' : fmtBytes(b, 1) + '/s');
const fmtUptime = (s) => {
	s = Math.floor(s || 0);
	const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
	return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(LOC) : '–');
const pct = (a, b) => (b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

const store = {
	get(k) { try { return localStorage.getItem('shareos.' + k) ?? sessionStorage.getItem('shareos.' + k); } catch (e) { return null; } },
	set(k, v, persist = true) {
		try {
			(persist ? localStorage : sessionStorage).setItem('shareos.' + k, v);
			(persist ? sessionStorage : localStorage).removeItem('shareos.' + k);
		} catch (e) { }
	},
	del(k) { try { localStorage.removeItem('shareos.' + k); sessionStorage.removeItem('shareos.' + k); } catch (e) { } }
};

// desktop view (module "desktop", desktop.js): its windows show the areas of
// this interface directly – an area is drawn into the window (VIEW) instead
// of #main, see withView, mainEl and the accessors of S.route below.
const deskOn = () => !!S.areas?.desktop;
function withView(v, fn) {
	const old = VIEW;
	VIEW = v;
	try { return fn(); } finally { VIEW = old; }
}
// where the page is drawn: the window of the desktop view or #main
const mainEl = () => { const v = viewNow(); return v ? v.el : S.desk ? null : document.querySelector('#main'); };

/* ---------- icons ----------------------------------------------------------- */

const svg = (d, cls = '') => raw(`<svg ${cls ? `class="${cls}" ` : ''}viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const I = {
	moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
	desk: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 7h18"/><rect x="9" y="10" width="9" height="7" rx="1"/><path d="M5.5 11h1M5.5 14h1"/>',
	classic: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h10M7 16h6"/>',
	star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
	power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
	disk: '<rect x="3" y="13" width="18" height="8" rx="2"/><path d="M5 13 7.5 4h9L19 13"/><path d="M7 17h.01M11 17h6"/>',
	usb: '<path d="M7 3h10v6H7z"/><path d="M5 9h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M10 6h.01M14 6h.01"/>',
	chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
	term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
	globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
	bus: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
	fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7s2 4-2 7M14 12c4 0 7 1 7 4s-4 2-7-2M12 14c0 4-1 7-4 7s-2-4 2-7M10 12c-4 0-7-1-7-4s4-2 7 2"/>',
	dl: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
	warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
	ok: '<path d="m5 12 5 5 9-10"/>',
	x: '<path d="M6 6l12 12M18 6 6 18"/>',
	reboot: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
	folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	ul: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
	up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
	trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
	pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	move: '<path d="M5 12h14M13 6l6 6-6 6"/>',
	copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
	cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A3.75 3.75 0 0 1 17.5 18z"/>',
	doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
	box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
	table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
	grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
	key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
	lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	net: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>'
};
const SVC_ICON = { dropbear: I.term, uhttpd: I.globe, ntpd: I.clock, crond: I.clock, rpcd: I.bus, ubus: I.bus, syslogd: I.list, board: I.fan };

/* ---------- RPC ------------------------------------------------------------- */

const ZERO_SID = '00000000000000000000000000000000';
let rpcId = 0;

class RpcError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

async function rpc(obj, method, args = {}, sid = S.sid) {
	let res;
	try {
		res = await fetch('/ubus', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'call', params: [sid || ZERO_SID, obj, method, args] })
		});
	} catch (e) {
		throw new RpcError('Box not reachable', 'offline');
	}
	if (!res.ok) throw new RpcError('HTTP ' + res.status, res.status);
	const j = await res.json();
	if (j.error) {
		if (j.error.code === -32002) { sessionExpired(); throw new RpcError('Session expired – please log in again.', 'auth'); }
		throw new RpcError(j.error.message, j.error.code);
	}
	const [code, data] = j.result;
	if (code === 6) { sessionExpired(); throw new RpcError('No permission', 'auth'); }
	if (code !== 0) throw new RpcError('ubus error ' + code, code);
	if (data && data.error) throw new RpcError(data.error, 'app');
	return data ?? {};
}

/* ---------- state ----------------------------------------------------------- */

const S = {
	sid: store.get('sid'),
	user: store.get('user') || 'root',
	route: { tab: 'overview', sub: '' },
	info: null, prev: null,
	cpu: null, rxRate: null, txRate: null,
	rxHist: [], txHist: [],
	services: null,
	upd: null, check: null, checking: false,
	timer: null, updTimer: null,
	// theme and accent are system-wide (UCI shareos.ui), cached here for the first paint
	theme: store.get('theme') || 'dark',      // dark | light | system
	accent: store.get('accent') || 'blue',
	scan: store.get('scan') !== '0',          // only this browser
	views: (() => { try { return JSON.parse(store.get('views') || '{}'); } catch (e) { return {}; } })(),
	logo: store.get('logo') !== '0'   // global setting (UCI shareos.ui.logo), cached for the login page
};

// The page shown. In the desktop view every window has its own (VIEW, or the
// window in front); the classic view has exactly one.
{
	const own = { route: S.route, utab: S.utab, uapp: S.uapp };
	const NONE = { route: { tab: 'desktop', sub: '' }, utab: null, uapp: null };
	for (const k of ['route', 'utab', 'uapp']) Object.defineProperty(S, k, {
		enumerable: true,
		get() { const v = viewNow(); return v ? v[k] : S.desk ? NONE[k] : own[k]; },
		set(x) { const v = viewNow(); if (v) v[k] = x; else if (!S.desk) own[k] = x; }
	});
}

const TABS = [
	['overview', 'OVERVIEW'], ['storage', 'STORAGE'], ['shares', 'SHARES'], ['services', 'SERVICES'],
	['apps', 'APPS'], ['cloud', 'CLOUD'], ['paperless', 'PAPERLESS'], ['dnsfilter', 'DNS FILTER'], ['system', 'SYSTEM']
];
const SYS_SUBS = [['general', 'GENERAL'], ['appearance', 'APPEARANCE'], ['network', 'NETWORK'], ['notifications', 'MESSAGES'], ['logs', 'LOGS'], ['terminal', 'TERMINAL'], ['time', 'TIME'], ['power', 'POWER & RESET'], ['firmware', 'FIRMWARE']];
const SVC_SUBS = [['status', 'STATUS'], ['autostart', 'AUTOSTART'], ['dlna', 'MEDIA SERVER'], ['printer', 'PRINTERS'], ['ups', 'UPS'], ['torrent', 'TORRENTS']];
const SHR_SUBS = [['shares', 'SHARES'], ['files', 'FILES'], ['users', 'USER'], ['groups', 'GROUPS']];
const STO_SUBS = [['volumes', 'DRIVES'], ['health', 'HEALTH'], ['snapshots', 'SNAPSHOTS']];
const ROLE_TXT = { admin: 'Administrator', user: 'User', share: 'Shares only' };
// pages that moved: old link -> new place
const SUB_MOVED = { hardware: 'power', https: 'network', about: 'general' };
// German page names of versions before 0.1.0-beta.8 (bookmarks, installed app shortcuts)
const OLD_ROUTE = { uebersicht: 'overview', speicher: 'storage', freigaben: 'shares', dienste: 'services', allgemein: 'general',
	zeit: 'time', netzwerk: 'network', energie: 'power', protokolle: 'logs', darstellung: 'appearance', ueber: 'about',
	dateien: 'files', benutzer: 'users', gruppen: 'groups', installiert: 'installed', quellen: 'sources', mein: 'me' };
function routeParts(hash) {
	const parts = (hash ?? location.hash).replace(/^#\/?/, '').split('/');
	if (hash != null) return parts.map((p) => OLD_ROUTE[p] || p);
	if (parts.some((p) => OLD_ROUTE[p])) {
		const now = parts.map((p) => OLD_ROUTE[p] || p);
		history.replaceState(null, '', '#/' + now.join('/'));
		return now;
	}
	return parts;
}

// the logo is drawn in blue; these filters turn it into the other accent colours
const LOGO_FILTER = {
	blue: '', green: 'hue-rotate(-78deg) saturate(1.15)', red: 'hue-rotate(148deg) saturate(1.25)',
	white: 'grayscale(1) brightness(1.25)', 'white-light': 'grayscale(1) brightness(.55)',
	grey: 'grayscale(.88) brightness(1.02)', 'grey-light': 'grayscale(.88) brightness(.72)',
	violet: 'hue-rotate(52deg) saturate(1.05)', orange: 'hue-rotate(178deg) saturate(1.35) brightness(1.08)', teal: 'hue-rotate(-30deg) saturate(.95)'
};
const logoFilter = () => LOGO_FILTER[effTheme() === 'light' && LOGO_FILTER[S.accent + '-light'] != null ? S.accent + '-light' : S.accent] || '';
// the accent colours to choose from (order of the swatches)
const ACCENT_NAMES = { blue: 'Blue', teal: 'Teal', green: 'Green', orange: 'Orange', red: 'Red', violet: 'Violet', grey: 'Grey', white: 'White' };

const MQ_DARK = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function effTheme() { return S.theme === 'system' ? (MQ_DARK && !MQ_DARK.matches ? 'light' : 'dark') : S.theme; }
MQ_DARK?.addEventListener?.('change', () => { if (S.theme === 'system') { applyTheme(); renderHeader(); } });

function applyTheme() {
	const app = $('#app');
	app.className = 'sos acc-' + S.accent + (effTheme() === 'light' ? ' light' : '') + (S.desk ? ' desk' : '');
	$('.scan', app).hidden = !S.scan;
	const bg = getComputedStyle(app).getPropertyValue('--bg').trim();
	document.body.style.background = bg;
	$('meta[name=theme-color]')?.setAttribute('content', bg || '#1b2433');
	tintFavicon();
	if (typeof themeToApps === 'function') themeToApps();
	if (S.desk && typeof deskLook === 'function') deskLook();
}

// favicon = the logo symbol in the accent colour
let faviconImg = null;
function tintFavicon() {
	const link = $('link[rel=icon]');
	if (!link) return;
	const draw = () => {
		const c = document.createElement('canvas');
		c.width = c.height = 64;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		ctx.filter = logoFilter() || 'none';
		ctx.drawImage(faviconImg, 0, 0, 64, 64);
		try { link.href = c.toDataURL('image/png'); } catch (e) { }
	};
	if (faviconImg?.complete && faviconImg.naturalWidth) { draw(); return; }
	faviconImg = new Image();
	faviconImg.onload = draw;
	faviconImg.src = 'favicon.png';
}

async function saveLook(v) {
	store.set('theme', S.theme); store.set('accent', S.accent);
	try {
		if (isUser()) S.me.ui = await rpc('shareos.me', 'ui_set', v);
		else { await rpc('shareos.ui', 'set', v); S.sysLook = { theme: S.theme, accent: S.accent }; }
	} catch (e) { toast('Appearance: ' + e.message, true); }
}

/* --- tiles or table per section (icon at the right of the section heading) --- */

const isTable = (id) => S.views[id] === 'table';
function secHead(id, title, sub = '') {
	const t = isTable(id);
	return html`<h2 class="gh">${title}${sub ? html` <span>${sub}</span>` : ''}<button class="vt" type="button" data-act="view" data-id="${id}" aria-pressed="${t}" title="${t ? 'Tile view' : 'Table view'}" aria-label="${t ? 'Tile view' : 'Table view'}">${svg(t ? I.grid : I.table)}</button></h2>`;
}

/* ---------- UI primitives --------------------------------------------------- */

function toast(msg, bad = false) {
	const el = document.createElement('div');
	if (bad) el.className = 'bad';
	el.textContent = msg;
	$('#toast').append(el);
	setTimeout(() => el.remove(), bad ? 7000 : 4000);
}

function confirmDlg(title, text, okLabel, danger = false) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<h3>${title}</h3><p>${text}</p><div class="acts">
			<button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn ${danger ? 'danger' : 'primary'}" type="button" value="yes">${okLabel}</button></div>`.s;
		$('#app').append(d);
		d.addEventListener('click', (e) => {
			const v = e.target.closest('button')?.value;
			if (v) { d.close(); resolve(v === 'yes'); }
		});
		d.addEventListener('cancel', () => resolve(false));
		d.addEventListener('close', () => d.remove());
		d.showModal();
		$('button[value=no]', d).focus();
	});
}

async function shareGlobal(v) {
	try { S.shares = await rpc('shareos.shares', 'global', v); toast('Saved.'); renderMain(); } catch (e) { toast(e.message, true); }
}

function promptDlg(title, text, value, okLabel, type = 'text', max = 0) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<form method="dialog"><h3>${title}</h3><p>${text}</p>
			<label class="f" style="margin-bottom:16px"><input name="v" value="${value}" type="${type}" maxlength="${max || (type === 'password' ? 128 : 32)}"${type === 'password' ? raw(' minlength="6" autocomplete="new-password"') : ''} required></label>
			<div class="acts"><button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn primary" type="submit" value="yes">${okLabel}</button></div></form>`.s;
		$('#app').append(d);
		let result = null;
		$('button[value=no]', d).addEventListener('click', () => d.close());
		$('form', d).addEventListener('submit', () => { result = type === 'password' ? $('input', d).value : $('input', d).value.trim(); });
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		d.showModal();
		$('input', d).select();
	});
}

// unlocking a vault: password again and how long; resolves {password, minutes} or null
const VAULT_TTLS = [5, 15, 30, 60, 120, 240, 480];
const vaultMin = (m) => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);
function vaultDlg(share, ttl) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<form method="dialog"><h3>Unlock vault “${share}”</h3><p>Your password again, for safety. The vault is then reachable in the network for you only and locks itself again.</p>
			<label class="f" style="margin-bottom:12px"><span>PASSWORD</span><input name="pw" type="password" autocomplete="current-password" maxlength="128" required></label>
			<label class="f" style="margin-bottom:16px"><span>OPEN FOR</span><select name="min">${VAULT_TTLS.map((m) => html`<option value="${m}"${m === ttl ? raw(' selected') : ''}>${vaultMin(m)}</option>`)}</select></label>
			<div class="acts"><button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn primary" type="submit" value="yes">Unlock</button></div></form>`.s;
		$('#app').append(d);
		let result = null;
		$('button[value=no]', d).addEventListener('click', () => d.close());
		$('form', d).addEventListener('submit', () => { result = { password: $('input', d).value, minutes: +$('select', d).value }; });
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		d.showModal();
		$('input', d).focus();
	});
}

// Folder browser on the box (shareos.files list/mkdir): places = [{ name,
// root (files root: a volume for admins, a share or "home" for users),
// base (folder inside the root) }]. With several places the first level
// lists them. Resolves { place, path } (path relative to the place) or null.
function folderDlg(title, places, start = {}) {
	const join = (...p) => p.filter(Boolean).join('/');
	let place = places.length === 1 ? places[0] : places.find((x) => x.name === start.place) || null;
	let cur = place ? (start.path || '').replace(/^\/+|\/+$/g, '') : '';
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.style.width = d.style.maxWidth = 'min(560px, calc(100vw - 32px))';
		let result = null, first = true;
		const draw = async () => {
			let body;
			if (!place) {
				body = html`<div class="fb-list" data-i18n-skip>${places.map((x, i) => html`<button class="btn ghost fb-item" type="button" data-place="${i}">${svg(I.folder)}<span>${x.name}</span></button>`)}</div>`;
			} else {
				let r;
				try { r = await rpc('shareos.files', 'list', { root: place.root, path: join(place.base, cur) }); }
				catch (e) {
					if (first && cur) { cur = ''; first = false; return draw(); }
					body = html`<p class="note">${e.message === 'not allowed' ? 'The folder browser needs the “Files” permission – please type the folder.' : e.message}</p>`;
				}
				if (r) {
					const dirs = r.entries.filter((x) => x.type === 'dir' || x.type === 'dirlink');
					body = dirs.length ? html`<div class="fb-list" data-i18n-skip>${dirs.map((x) => html`<button class="btn ghost fb-item" type="button" data-dir="${x.name}">${svg(I.folder)}<span>${x.name}</span></button>`)}</div>`
						: html`<p class="mut" style="margin:10px 0">No subfolders.</p>`;
				}
			}
			first = false;
			const where = place ? '/' + join(places.length > 1 ? place.name : '', cur) : '';
			d.innerHTML = html`<h3>${title}</h3>
				<div class="fb-path"><button class="btn sm" type="button" value="up"${place && (cur || places.length > 1) ? '' : raw(' disabled')}>Up</button>
					<code data-i18n-skip>${place ? (places.length > 1 ? '' : place.name) + where : '/'}</code></div>
				${body}
				<div class="acts" style="margin-top:14px">${place ? html`<button class="btn" type="button" value="mkdir">New folder</button>` : ''}
					<button class="btn ghost ml" type="button" value="no">Cancel</button>
					<button class="btn primary" type="button" value="ok"${place ? '' : raw(' disabled')}>Choose this folder</button></div>`.s;
		};
		d.addEventListener('click', async (e) => {
			const b = e.target.closest('button');
			if (!b) return;
			if (b.dataset.place != null) { place = places[+b.dataset.place]; cur = ''; return draw(); }
			if (b.dataset.dir != null) { cur = join(cur, b.dataset.dir); return draw(); }
			if (b.value === 'up') {
				if (cur) cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '';
				else place = null;
				return draw();
			}
			if (b.value === 'mkdir') {
				const n = await promptDlg('New folder', 'Name of the new folder:', '', 'Create', 'text', 255);
				if (!n) return;
				try { await rpc('shareos.files', 'mkdir', { root: place.root, path: join(place.base, cur), name: n }); cur = join(cur, n); }
				catch (err) { toast(err.message, true); }
				return draw();
			}
			if (b.value === 'ok') { result = { place: place.name, path: cur }; d.close(); }
			if (b.value === 'no') d.close();
		});
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		$('#app').append(d);
		d.innerHTML = html`<h3>${title}</h3><div class="spin" style="margin:12px 0"></div>`.s;
		d.showModal();
		draw();
	});
}

let coverEl = null;
function cover(title, text) {
	uncover();
	coverEl = document.createElement('div');
	coverEl.className = 'cover';
	coverEl.innerHTML = html`<div class="panel"><div class="spin"></div><b class="name">${title}</b><span class="mut"><span id="cover-text">${text}</span> <span id="cover-sec"></span></span></div>`.s;
	$('#app').append(coverEl);
}
function uncover() { coverEl?.remove(); coverEl = null; }

// after reboot / restart: wait until the box answers again, then reload
async function waitForBox(title, text, minDown = true) {
	cover(title, text);
	let wasDown = !minDown;
	const t0 = Date.now();
	for (;;) {
		await new Promise((r) => setTimeout(r, 3000));
		try {
			const r = await fetch('/ubus', { method: 'POST', body: '{"jsonrpc":"2.0","id":0,"method":"list","params":["session"]}' });
			if (r.ok && wasDown) { location.reload(); return; }
		} catch (e) { wasDown = true; }
		if (!wasDown && Date.now() - t0 > 90000) wasDown = true;  // reboot faster than our polling
		const s = Math.round((Date.now() - t0) / 1000);
		// the seconds apart from the text: the text stays translatable
		const el = $('#cover-sec');
		if (el) el.textContent = `(${s} s)`;
	}
}

/* ---------- session --------------------------------------------------------- */

function sessionExpired() {
	if (!S.sid) return;
	S.sid = null;
	store.del('sid');
	stopPolling();
	if (S.desk && typeof deskStop === 'function') deskStop();
	renderLogin('Session expired – please log in again.');
}

async function login(user, pass, keep) {
	const r = await rpc('session', 'login', { username: user, password: pass, timeout: keep ? 7 * 86400 : 3600 }, ZERO_SID);
	S.sid = r.ubus_rpc_session;
	S.user = user;
	store.set('sid', S.sid, keep);
	store.set('user', user, true);
	// tell the box which account this session belongs to (role, own area)
	// If the box cannot say which role the account has, only root is taken
	// for an admin; anybody else gets the error instead of the admin pages.
	try { S.me = await rpc('shareos.me', 'bind', { username: user, password: pass }); }
	catch (e) {
		if (user !== 'root') throw e;
		S.me = { name: user, role: 'admin' };
	}
}

// admins get the full interface, everybody else "My ShareOS"
const isUser = () => !!(S.me && S.me.role !== 'admin');

// plain users may have their own look; otherwise the look for everyone
function applyOwnLook() {
	const sys = S.sysLook || { theme: S.theme, accent: S.accent }, own = isUser() ? S.me.ui || {} : {};
	S.theme = own.theme || sys.theme; S.accent = own.accent || sys.accent;
	applyTheme();
}

function enter() {
	applyOwnLook();
	if (location.hash === '#/shared') history.replaceState(null, '', isUser() ? '#/me' : '#/overview');
	if (deskOn() && store.get('view') === 'desktop') { deskStart(); shareInbox(); return; }
	if (isUser()) renderUserShell();
	else renderShell();
	shareInbox();
}

// the desktop view lives in desktop.js and desktop.css, loaded only when used
function deskStart() {
	if (typeof deskRun === 'function') { deskRun(); return; }
	$('#root').innerHTML = html`<div class="login"><div class="spin"></div></div>`.s;
	const css = document.createElement('link');
	css.rel = 'stylesheet'; css.href = 'desktop.css';
	document.head.append(css);
	const js = document.createElement('script');
	js.src = 'desktop.js';
	js.onload = () => deskRun();
	js.onerror = () => { store.set('view', 'classic'); enter(); };
	document.head.append(js);
}
// switch between the views (the page starts again with the session it has)
function setView(v) { store.set('view', v); location.reload(); }

/* ---------- share target ("share with" on the phone, see sw.js) ----------------
 * what was shared with the installed app waits in IndexedDB until someone is
 * logged in; then it goes into the folder for shared files in the personal
 * folder of that account, named in the language of the box */

function shareDb() {
	return new Promise((resolve, reject) => {
		const r = indexedDB.open('shareos', 1);
		r.onupgradeneeded = () => r.result.createObjectStore('share', { keyPath: 'id', autoIncrement: true });
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

function shareTx(db, mode, fn) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction('share', mode), req = fn(tx.objectStore('share'));
		tx.oncomplete = () => resolve(req?.result); tx.onerror = () => reject(tx.error);
	});
}

// file name for the box: no slashes or control characters, no leading dot
const shareName = (n, i) => (String(n || '').replace(/[/\\\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 200) || `File ${i + 1}`);

async function shareInbox() {
	if (!('indexedDB' in window)) return;
	let db, items;
	try { db = await shareDb(); items = await shareTx(db, 'readonly', (st) => st.getAll()); } catch (e) { return; }
	if (!items?.length) { db.close(); return; }
	let ok = 0, bad = [], folder = '';
	for (const it of items) {
		const list = (it.files || []).map((f, i) => ({ name: shareName(f.name, i), blob: f }));
		// only text or a link: kept as a small text file
		if (!list.length) {
			const d = new Date(it.time || Date.now()), z = (x) => String(x).padStart(2, '0');
			const stamp = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
			const body = [it.title, it.text, it.url].filter((x) => x && x.trim()).join('\n') + '\n';
			list.push({ name: `${it.url ? 'Link' : 'Note'} ${stamp}.txt`, blob: new Blob([body], { type: 'text/plain' }) });
		}
		for (const x of list) {
			try {
				const t = await rpc('shareos.me', 'share_ticket', { name: x.name });
				await fbSend(t.url, x.blob, () => { });
				ok++; folder = t.folder;
			} catch (e) { bad.push(`${x.name}: ${e.message}`); }
		}
		// done either way – a file that cannot be stored would otherwise come back at every login
		try { await shareTx(db, 'readwrite', (st) => st.delete(it.id)); } catch (e) { }
	}
	db.close();
	if (bad.length) toast(`Share: ${bad.length} file(s) not saved – ${bad[0]}`, true);
	if (ok) {
		toast(`${ok} file(s) saved to “${folder}” in your personal folder.`);
		// show them in the file browser when there is one
		if (!isUser() || S.me?.files) {
			S.fb = null; fbInit(); S.fb.root = 'home'; S.fb.path = folder;
			location.hash = isUser() ? '#/files' : '#/shares/files';
		}
	}
}

async function logout() {
	try { await rpc('session', 'destroy', { ubus_rpc_session: S.sid }); } catch (e) { }
	S.sid = null;
	store.del('sid');
	stopPolling();
	S.me = null; S.fb = null; S.fbApps = null; S.appPage = null;
	applyOwnLook();
	renderLogin();
}

/* ---------- polling --------------------------------------------------------- */

// a hidden tab or an app in the background asks the box nothing: the regular
// calls skip while document.hidden and catch up when it is shown again
const away = () => document.hidden;
document.addEventListener('visibilitychange', () => {
	if (away() || !S.sid || !S.me) return;
	if (!isUser()) { tick(); loadNotes(); if (S.route.tab === 'storage' && S.stActive) loadStorage(); }
	loadChips();
});

// A tick that fails – the box does not answer, answers with an HTTP error or
// not within 15 s (rpcd hangs) – shows OFFLINE and dims the live values; the
// next good tick clears it.
const TICK_TIMEOUT = 15000;
async function tick() {
	if (away() || S.ticking) return;
	S.ticking = true;
	let timer;
	try {
		const info = await Promise.race([rpc('shareos.system', 'info'),
			new Promise((_, rej) => { timer = setTimeout(() => rej(new RpcError('Box not reachable', 'offline')), TICK_TIMEOUT); })]);
		const prev = S.info;
		if (prev?.cpu && info.cpu) {
			const dt = info.cpu.total - prev.cpu.total, di = info.cpu.idle - prev.cpu.idle;
			S.cpu = dt > 0 ? pct(dt - di, dt) : S.cpu;
		}
		const n = info.network?.eth0, p = prev?.network?.eth0;
		const dts = prev ? info.uptime - prev.uptime : 0;
		if (n && p && dts > 0) {
			S.rxRate = Math.max(0, (n.rx_bytes - p.rx_bytes) / dts);
			S.txRate = Math.max(0, (n.tx_bytes - p.tx_bytes) / dts);
			S.rxHist.push(S.rxRate); S.txHist.push(S.txRate);
			if (S.rxHist.length > 120) { S.rxHist.shift(); S.txHist.shift(); }
		}
		S.info = info;
		S.infoAt = Date.now();
		setOffline(false);
		renderHeader();
		const fn = $('#fan-now');
		if (fn) fn.textContent = fanNow();
		if ((S.route.tab === 'overview' || S.route.tab === 'services') && Date.now() - (S.svcAt || 0) > 30000) loadServices();
		if (S.route.tab === 'overview' && !S.fr) renderMain();
	} catch (e) {
		if (e.code !== 'auth') { setOffline(true); renderHeader(); }
	} finally {
		clearTimeout(timer);
		S.ticking = false;
	}
}
// the clock of the box: its last answer plus the time gone by since then
// (null before the first answer) – not the clock of the browser
function boxNow() {
	return S.info?.time ? new Date(S.info.time * 1000 + (Date.now() - (S.infoAt || Date.now()))) : null;
}
function setOffline(on) {
	S.offline = on;
	$('#app')?.classList.toggle('stale', on);
}

function startPolling() {
	stopPolling();
	tick();
	S.timer = setInterval(tick, 5000);
	refreshUpdateStatus();
	loadNotes();
	S.noteTimer = setInterval(loadNotes, 60000);
	startChips();
}
function stopPolling() {
	clearInterval(S.timer); S.timer = null;
	clearInterval(S.noteTimer); S.noteTimer = null;
	clearTimeout(S.updTimer); S.updTimer = null;
}

/* ---------- layout ---------------------------------------------------------- */

function brand() {
	if (!S.logo) return html`<h1 class="brand">SHAREOS</h1>`;
	return html`<h1 style="margin:0"><img class="brandlogo" src="${effTheme() === 'light' ? 'logo-light.png' : 'logo-dark.png'}" alt="" style="filter:${logoFilter()}"><span class="sr">ShareOS</span></h1>`;
}

async function loadUiSettings() {
	try {
		const r = await rpc('shareos.ui', 'get', {}, ZERO_SID);
		if (r.logo !== S.logo) { S.logo = r.logo; store.set('logo', r.logo ? '1' : '0'); }
		if (r.areas) S.areas = r.areas;
		S.defaultPw = !!r.default_password;
		if (r.theme) { S.theme = r.theme; store.set('theme', r.theme); }
		if (r.accent) { S.accent = r.accent; store.set('accent', r.accent); }
		S.sysLook = { theme: r.theme || S.theme, accent: r.accent || S.accent };
		if (r.lang && r.lang !== LANG) { try { localStorage.setItem('shareos.lang', r.lang); } catch (e) { } return r.lang; }
	} catch (e) { }
	return LANG;
}

function renderLogin(msg = '') {
	// with the desktop module: classic or desktop view (the last choice, else desktop)
	let view = store.get('view') === 'classic' ? 'classic' : 'desktop';
	$('#root').innerHTML = html`
	<div class="login">
		<form class="panel" id="login-form" autocomplete="on">
			${brand()}
			<p class="prompt">Administration – please log in.</p>
			<p class="prompt"><b>user@shareos</b>:~$ login<span class="cursor"></span></p>
			<label class="f"><span>USER</span><input name="user" type="text" value="${S.user}" autocomplete="username" required></label>
			<label class="f"><span>PASSWORD</span><input name="pass" type="password" autocomplete="current-password" required autofocus></label>
			<label class="chk"><input name="keep" type="checkbox">Stay logged in (7 days)</label>
			<p class="err" id="login-err">${msg}</p>
			${deskOn() ? html`<div class="viewpick" role="radiogroup" aria-label="View">
				<button class="vbtn${view === 'classic' ? ' on' : ''}" type="button" role="radio" aria-checked="${view === 'classic'}" data-view="classic">${svg(I.classic)}<span>Classic</span></button>
				<button class="vbtn${view === 'desktop' ? ' on' : ''}" type="button" role="radio" aria-checked="${view === 'desktop'}" data-view="desktop">${svg(I.desk)}<span>Desktop</span></button>
			</div>` : ''}
			<button class="btn primary" type="submit" style="min-height:44px">Log in</button>
			<p class="note" id="login-hint"${S.defaultPw ? '' : raw(' hidden')}>First sign-in: user root, password shareos – then set your own password.</p>
		</form>
	</div>`.s;
	// the hint only while root still has the factory password
	rpc('shareos.ui', 'get', {}, ZERO_SID).then((r) => {
		S.defaultPw = !!r.default_password;
		const h = $('#login-hint');
		if (h) h.hidden = !S.defaultPw;
	}).catch(() => { });
	$('#login-form').addEventListener('click', (e) => {
		const b = e.target.closest('[data-view]');
		if (!b) return;
		view = b.dataset.view;
		$('#login-form').querySelectorAll('[data-view]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
	});
	$('#login-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target;
		if (deskOn()) store.set('view', view);
		const btn = $('button[type=submit]', f);
		btn.disabled = true;
		$('#login-err').textContent = '';
		try {
			await login(f.user.value.trim(), f.pass.value, f.keep.checked);
			enter();
		} catch (err) {
			$('#login-err').textContent = err.code === 'offline' ? 'Box not reachable.' : err.code === 'auth' ? 'Wrong user or password.' : 'Login failed: ' + err.message;
			btn.disabled = false;
			f.pass.select();
		}
	});
	setTimeout(() => $('#login-form input[name=pass]')?.focus(), 0);
	// a new box has no password: claim it with the USB button first
	rpc('shareos.setup', 'claim_state', {}, ZERO_SID).then((r) => { if (r.unclaimed) renderClaim(); }).catch(() => { });
}

// first access to a new box: USB button, then the first password for root
function renderClaim() {
	$('#root').innerHTML = html`
	<div class="login">
		<form class="panel" id="claim-form" autocomplete="off">
			${brand()}
			<p class="prompt">This box is not set up yet. Press the USB button on the front of the box briefly, then choose a password for root.</p>
			<p class="note" id="claim-wait">Waiting for the USB button …</p>
			<label class="f"><span>NEW PASSWORD (MIN. 8 CHARACTERS)</span><input name="p1" type="password" autocomplete="new-password" minlength="8" required></label>
			<label class="f"><span>REPEAT PASSWORD</span><input name="p2" type="password" autocomplete="new-password" minlength="8" required></label>
			<p class="err" id="claim-err"></p>
			<button class="btn primary" type="submit" style="min-height:44px" disabled>Set password</button>
		</form>
	</div>`.s;
	const f = $('#claim-form'), btn = $('button[type=submit]', f);
	let timer = null;
	const poll = async () => {
		if (!f.isConnected) return;
		try {
			const r = await rpc('shareos.setup', 'claim_state', {}, ZERO_SID);
			if (!r.unclaimed) { renderLogin(); return; }
			$('#claim-wait').textContent = r.window ? 'Button detected – choose a password now (you have 2 minutes).' : 'Waiting for the USB button …';
			btn.disabled = !r.window;
		} catch (e) { }
		timer = setTimeout(poll, 2000);
	};
	poll();
	f.addEventListener('submit', async (e) => {
		e.preventDefault();
		$('#claim-err').textContent = '';
		if (f.p1.value !== f.p2.value) { $('#claim-err').textContent = 'The passwords do not match.'; return; }
		btn.disabled = true;
		try {
			await rpc('shareos.setup', 'claim', { password: f.p1.value }, ZERO_SID);
			clearTimeout(timer);
			await login('root', f.p1.value, false);
			enter();
		} catch (err) {
			$('#claim-err').textContent = err.message;
			btn.disabled = false;
		}
	});
}

function renderShell() {
	$('#root').innerHTML = html`
		<header class="hd" id="hd"></header>
		<nav class="tabs" id="tabs" aria-label="Main menu"></nav>
		<main id="main"></main>
		<footer class="ft" id="ft"></footer>`.s;
	parseRoute();
	renderHeader();
	renderTabs();
	startPolling();
	startMain();
	netAutoConfirm();
}

// After the login: recovery mode, the first-run wizard or the page. Both
// states are asked first, so a new box opens the wizard right away instead of
// showing the overview for a few seconds; the wizard shows "Loading …" while it
// collects time zones and the Alt-F settings (the disks are searched).
async function startMain() {
	let shown = false;
	const show = () => { if (!shown) { shown = true; renderMain(); } };
	const slow = setTimeout(show, 3000);   // the box answers slowly: the page first
	const [rec, st] = await Promise.all([checkRecovery(), rpc('shareos.setup', 'status').catch(() => null)]);
	clearTimeout(slow);
	if (rec) return;
	if (st && !st.done && !S.fr) {
		S.fr = { loading: true, step: 0, st };
		shown = true;
		renderMain();
		checkFirstRun(false, st);
		return;
	}
	show();
}

/* ---------- status chips of services and apps (header) --------------------------- */

const chipHidden = () => { try { return JSON.parse(store.get('chips.hidden') || '[]'); } catch (e) { return []; } };
async function loadChips() {
	if (away()) return;
	try { S.chips = (await rpc('shareos.status', 'chips')).chips || []; } catch (e) { return; }
	if (S.me && S.me.role !== 'admin') renderUserHeader(); else renderHeader();
}
function startChips() {
	if (S.chipTimer) return;
	loadChips();
	S.chipTimer = setInterval(loadChips, 15000);
}
function chipsHtml() {
	const hidden = chipHidden();
	return (S.chips || []).filter((c) => !hidden.includes(c.id)).map((c) => {
		const cls = c.state === 'warn' ? ' warn' : c.state === 'err' ? ' err' : c.state === 'info' ? ' info' : '';
		const inner = c.id.startsWith('app:')
			? html`<i></i>${(c.name || c.app || '').toUpperCase()} <small>${c.label}</small>`
			: html`<i></i>${c.label}${c.detail ? html` <small>${c.detail}</small>` : ''}`;
		return c.href ? html`<a class="chip${cls}" href="${c.href}">${inner}</a>`
			: c.app ? html`<a class="chip${cls}" href="#" data-act="chip-open" data-app="${c.app}">${inner}</a>`
			: html`<span class="chip${cls}">${inner}</span>`;
	});
}

// which chips this browser shows (Appearance)
function chipsPanel() {
	const hidden = chipHidden(), list = S.chips || [];
	return html`<div class="panel" style="max-width:560px;margin-top:16px">
		<div class="ph"><span class="pt">HEADER INDICATORS</span><span class="tag ml">this browser only</span></div>
		${list.length || hidden.length ? html`<div style="display:grid;gap:6px">${[...list.map((c) => [c.id, c.id.startsWith('app:') ? (c.name || c.app) : c.label]),
			...hidden.filter((h) => !list.some((c) => c.id === h)).map((h) => [h, h.replace(/^(app|svc):/, '')])].map(([id, t]) =>
			html`<label class="chk"><input type="checkbox" class="chip-show" data-id="${id}"${hidden.includes(id) ? '' : raw(' checked')}>${t}</label>`)}</div>`
			: html`<p class="mut" style="margin:0;font-size:13px">No service and no app shows anything right now.</p>`}
		<p class="note">Services (VPN, torrents, media server) and apps with the permission “Header indicator” show their state here; a click opens the app.</p>
	</div>`;
}

function renderHeader() {
	const hd = $('#hd');
	if (!hd) return;
	if (S.me && S.me.role !== 'admin') { renderUserHeader(); return; }
	const i = S.info || {}, r = i.release || {}, ip = i.network?.eth0?.ipv4?.address;
	const now = boxNow();
	const upd = S.check?.update_available ? S.check.latest : null;
	// unread messages; the update one is left out while the UPDATE chip shows it anyway
	const nu = (S.notes?.items || []).filter((x) => !x.read && !x.resolved && !(upd && x.source === 'update'));
	hd.innerHTML = html`
		<div>
			${brand()}
			<div class="sub"><b>${i.hostname || '…'}</b>${[(i.model || '').replace(/ NAS$/, ''), 'ShareOS ' + (r.version || '…'), ip].filter(Boolean).map((x) => ' · ' + x).join('')}</div>
		</div>
		<div class="side">
			<div class="row">
				${nu.length ? html`<a class="chip ${nu.some((x) => x.level === 'error') ? 'err' : 'warn'}" href="#/system/notifications"><i></i>${nu.length === 1 ? '1 MESSAGE' : nu.length + ' MESSAGES'}</a>` : ''}
				${upd ? html`<a class="chip warn" href="#/system/firmware"><i></i>UPDATE ${upd.replace(/^v/, '')} <small>available</small></a>` : ''}
				${chipsHtml()}
				<button class="chip more" type="button" data-act="chips-more" hidden></button>
				${S.offline ? html`<span class="chip warn keep"><i></i>OFFLINE</span>`
					: html`<span class="chip keep"><i></i>ONLINE <small>for ${fmtUptime(i.uptime)}</small></span>`}
				${deskOn() ? html`<button class="ib" type="button" data-act="desk-view" aria-label="Desktop view" title="Desktop view">${svg(I.desk)}</button>` : ''}
				<button class="ib" type="button" data-act="theme" aria-label="Toggle light/dark" title="Toggle light/dark">${svg(I.moon)}</button>
				<button class="ib" type="button" data-act="logout" aria-label="Log out">${svg(I.power)}</button>
			</div>
			<div class="clock" title="Time of the box">${now ? now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) : '–'}</div>
			<div class="meta">${now ? now.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}</div>
		</div>`.s;
	fitChips();
	const ft = $('#ft');
	if (ft) ft.innerHTML = html`<span><b>ShareOS</b> ${r.version || ''} · Linux ${i.kernel || ''} · GPLv2</span>
		<span>Load ${(i.load || []).map((x) => x.toFixed(2)).join(' ')} · <a href="https://github.com/UniqueDroid/ShareOS" target="_blank" rel="noopener">github.com/UniqueDroid/ShareOS</a></span>`.s;
}

// header chips stay on one line: the ones that do not fit go behind "+N"
// (from the end, so messages and the update stay visible); "+N" shows all of them
function fitChips() {
	const row = $('#hd .side .row'), more = row?.querySelector('.more');
	if (!row || !more) return;
	row.parentElement.querySelector('.chippop')?.remove();
	const chips = [...row.querySelectorAll('.chip:not(.keep):not(.more)')];
	chips.forEach((c) => { c.hidden = false; });
	more.hidden = true;
	// with justify-content:flex-end an overflow goes left and scrollWidth does not see it
	const need = () => { const v = [...row.children].filter((x) => !x.hidden); return v.reduce((a, x) => a + x.offsetWidth, 0) + 10 * (v.length - 1); };
	const room = row.parentElement.clientWidth;
	let n = 0;
	while (need() > room && n < chips.length) {
		chips[chips.length - 1 - n].hidden = true;
		n++;
		more.hidden = false; more.textContent = '+' + n;
	}
	more.title = more.ariaLabel = 'Show all notices';
	more.classList.toggle('warn', chips.slice(chips.length - n).some((c) => c.matches('.warn, .err')));
	more.setAttribute('aria-expanded', String(!!S.chipsAll && n > 0));
	if (!S.chipsAll || !n) { S.chipsAll = false; return; }
	// the hidden ones open as a list under the row; the header keeps its height
	const pop = document.createElement('div');
	pop.className = 'chippop';
	chips.slice(chips.length - n).forEach((c) => { const x = c.cloneNode(true); x.hidden = false; pop.append(x); });
	row.after(pop);
}
addEventListener('resize', () => fitChips());
document.addEventListener('click', (e) => {
	if (S.chipsAll && !e.target.closest?.('.chip.more')) { S.chipsAll = false; fitChips(); }
});

// areas switched off under System -> Appearance are not shown
const tabOn = (id) => !S.areas || S.areas[id] !== false;
function renderTabs() {
	if (S.desk) return;
	$('#tabs').innerHTML = TABS.filter(([id]) => tabOn(id)).map(([id, label, isNew]) =>
		html`<a class="tab${S.route.tab === id ? ' on' : ''}" href="#/${id}"${S.route.tab === id ? raw(' aria-current="page"') : ''}><span class="tl">${label}</span>${isNew ? html` <span class="nb">NEW</span>` : ''}</a>`.s).join('');
}

// the page of an address (#/tab/sub); hash: an address other than the current one
function routeOf(hash) {
	const [tab, sub, id] = routeParts(hash);
	const r = { tab: TABS.some((t) => t[0] === tab) && tabOn(tab) ? tab : 'overview', sub: SUB_MOVED[sub] || sub || '' };
	if (r.tab === 'system' && !SYS_SUBS.some((x) => x[0] === r.sub)) r.sub = 'general';
	if (r.tab === 'services' && !SVC_SUBS.some((x) => x[0] === r.sub)) r.sub = 'status';
	if (r.tab === 'shares' && !SHR_SUBS.some((x) => x[0] === r.sub)) r.sub = 'shares';
	if (r.tab === 'storage' && !STO_SUBS.some((x) => x[0] === r.sub)) r.sub = 'volumes';
	if (r.tab === 'apps' && r.sub === 'run') r.app = id || '';
	else if (r.tab === 'apps' && !APP_SUBS.some((x) => x[0] === r.sub)) r.sub = 'installed';
	return r;
}
function parseRoute() {
	S.route = routeOf();
	if (!(S.route.tab === 'apps' && S.route.sub === 'run')) S.appPage = null;
}

// Pages are rendered as a whole (innerHTML), also by the background timers
// (overview every 5 s, firmware, storage, …). On the same page a new render
// keeps what the user is doing: typed or changed form fields (as long as the
// box did not change the same field), focus and cursor, scroll positions and
// open <details>, and file fields with a chosen file (the element itself is
// moved into the new page – a file cannot be set again by script). While a
// file dialog is open, a render of the same page waits until it closes.
const uiKey = (el) => (el.closest('form')?.id || '') + '|' + (el.id || el.name || el.dataset.target || '');

// a form that was just sent (submit or its primary button) is not restored:
// after saving, the page shows what the box has – and forms that add
// something (a user, a share …) start empty again
const uiSent = {};
const markSent = (f) => { if (f) uiSent[f.id || '|'] = Date.now(); };
document.addEventListener('submit', (e) => markSent(e.target), true);
document.addEventListener('click', (e) => { const b = e.target.closest?.('button[type=submit], .btn.primary'); if (b) markSent(b.closest('form')); }, true);
const uiWasSent = (el) => Date.now() - (uiSent[el.closest('form')?.id || '|'] || 0) < 60000;

function uiDirty(el) {
	if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
	if (el.tagName === 'SELECT') return [...el.options].some((o) => o.selected !== o.defaultSelected);
	return el.value !== el.defaultValue;
}

function uiDefault(el) {
	if (el.type === 'checkbox' || el.type === 'radio') return el.defaultChecked;
	if (el.tagName === 'SELECT') return [...el.options].map((o) => o.defaultSelected).join();
	return el.defaultValue;
}

function uiCapture(main) {
	const count = {}, fields = {}, scroll = [], open = [];
	main.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea, select').forEach((el) => {
		const k = uiKey(el);
		if (k === '|') return;
		const n = count[k] = (count[k] || 0) + 1;
		if (uiDirty(el)) fields[k + '#' + n] = { def: uiDefault(el), value: el.value, checked: el.checked,
			sel: el.tagName === 'SELECT' ? [...el.selectedOptions].map((o) => o.value) : null };
	});
	main.querySelectorAll('*').forEach((el, i) => { if (el.scrollTop > 0 || el.scrollLeft > 0) scroll.push([el.tagName + '.' + el.className, i, el.scrollTop, el.scrollLeft]); });
	main.querySelectorAll('details').forEach((el, i) => open.push(el.open));
	const files = {}, fcount = {};
	main.querySelectorAll('input[type=file]').forEach((el) => {
		const k = uiKey(el), n = fcount[k] = (fcount[k] || 0) + 1;
		if (k !== '|' && el.files?.length) files[k + '#' + n] = el;
	});
	const a = document.activeElement;
	const focus = a && main.contains(a) && (a.id || a.name) ? { key: uiKey(a), start: a.selectionStart, end: a.selectionEnd } : null;
	return { fields, files, scroll, open, focus, page: [window.scrollX, window.scrollY, main.scrollTop] };
}

function uiRestore(main, ui) {
	const count = {};
	main.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea, select').forEach((el) => {
		const k = uiKey(el);
		if (k === '|') return;
		const n = count[k] = (count[k] || 0) + 1, f = ui.fields[k + '#' + n];
		// only where the box still sends the same value: a changed value from the box wins
		if (!f || uiDefault(el) !== f.def || uiWasSent(el)) return;
		if (el.type === 'checkbox' || el.type === 'radio') el.checked = f.checked;
		else if (f.sel) [...el.options].forEach((o) => { o.selected = f.sel.includes(o.value); });
		else el.value = f.value;
	});
	const fcount = {};
	main.querySelectorAll('input[type=file]').forEach((el) => {
		const k = uiKey(el), n = fcount[k] = (fcount[k] || 0) + 1, old = ui.files[k + '#' + n];
		// also while it is being sent (an upload is running); handlers reset the form when done
		if (old) el.replaceWith(old);
	});
	const all = main.querySelectorAll('*');
	ui.scroll.forEach(([sig, i, top, left]) => {
		const el = all[i];
		if (el && el.tagName + '.' + el.className === sig) { el.scrollTop = top; el.scrollLeft = left; }
	});
	const det = main.querySelectorAll('details');
	if (det.length === ui.open.length) det.forEach((el, i) => { el.open = ui.open[i]; });
	main.scrollTop = ui.page[2];
	window.scrollTo(ui.page[0], ui.page[1]);
	if (ui.focus) {
		const el = [...main.querySelectorAll('input, textarea, select, button')].find((x) => (x.id || x.name) && uiKey(x) === ui.focus.key);
		if (el) {
			el.focus({ preventScroll: true });
			try { if (ui.focus.start != null) el.setSelectionRange(ui.focus.start, ui.focus.end); } catch (e) { /* not a text field */ }
		}
	}
}

// a file dialog is open (click on a file field until change/cancel/focus back)
let fileDialog = 0;
document.addEventListener('click', (e) => { if (e.target.matches?.('input[type=file]')) fileDialog = Date.now(); }, true);
const fileDialogDone = () => {
	if (!fileDialog) return;
	fileDialog = 0;
	if (S.renderPending) setTimeout(() => { if (S.renderPending) renderMain(); }, 0);
};
document.addEventListener('change', (e) => { if (e.target.matches?.('input[type=file]')) fileDialogDone(); }, true);
document.addEventListener('cancel', (e) => { if (e.target.matches?.('input[type=file]')) fileDialogDone(); }, true);
window.addEventListener('focus', () => setTimeout(fileDialogDone, 500));

function renderMain() {
	const main = mainEl();
	if (!main) return;
	if (S.desk && isUser()) { renderUserMain(); return; }
	const page = (S.desk ? S.route.tab + '/' + S.route.sub : location.hash) + (S.rec ? '|rec' : S.fr ? '|fr' : '');
	const same = main.dataset.page === page;
	// same page while a file dialog is open: render when it closes
	if (same && fileDialog && Date.now() - fileDialog < 120000) {
		S.renderPending = true;
		return;
	}
	S.renderPending = false;
	const ui = same ? uiCapture(main) : null;
	main.dataset.page = page;
	if (!same && S.desk) main.scrollTop = 0;   // desktop view: the window scrolls, not the page
	if (S.rec) main.innerHTML = recoveryView().s;
	else if (S.fr) { main.innerHTML = firstRunView().s; firstRunAfter(); }
	else {
		// an app shown in the page keeps running: no new render of the same app
		if (S.route.tab === 'apps' && S.route.sub === 'run' && $('#appframe')?.dataset.id === S.route.app) return;
		const v = VIEWS[S.route.tab] || VIEWS.overview;
		// a page that fails must not leave the previous page standing (it looked
		// as if the tab did not react): show the error instead
		try {
			main.innerHTML = v().s;
			VIEWS_AFTER[S.route.tab]?.();
		} catch (e) {
			console.error('render %s', location.hash, e);
			main.innerHTML = renderError(e).s;
		}
	}
	if (ui) uiRestore(main, ui);
	if (!S.rec && !S.fr) appFrameLoad();
}

function renderError(e) {
	return html`<div class="panel"><div class="empty">${svg(I.info)}<span>This page could not be shown: ${e?.message || String(e)}</span>
		<button class="btn" type="button" data-act="page-reload">Reload</button></div></div>`;
}

/* ---------- views ----------------------------------------------------------- */

function mrow(label, p, value, cls = '') {
	return html`<div class="mrow"><span class="kk">${label}</span><div class="bar"><i class="${cls}" style="width:${p.toFixed(0)}%"></i></div><span class="vv">${value}</span></div>`;
}

function spark() {
	const n = 120, rx = S.rxHist, tx = S.txHist;
	if (rx.length < 2) return html`<div class="spark" style="display:grid;place-items:center;font-size:12px;color:var(--muted)">collecting samples …</div>`;
	const max = Math.max(1024, ...rx, ...tx);
	const pts = (arr) => arr.map((v, k) => `${((k + n - arr.length) / (n - 1) * 300).toFixed(1)},${(68 - (v / max) * 62).toFixed(1)}`).join(' ');
	const first = ((n - rx.length) / (n - 1) * 300).toFixed(1);
	return raw(`<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Network traffic of the last 10 minutes">
		<polyline style="fill:rgba(var(--rgb),.12);stroke:none" points="${first},70 ${pts(rx)} 300,70"></polyline>
		<polyline style="fill:none;stroke:var(--accent);stroke-width:1.5" points="${pts(rx)}"></polyline>
		<polyline style="fill:none;stroke:var(--amber);stroke-width:1.5" points="${pts(tx)}"></polyline></svg>`);
}

function statusTiles(rows, table) {
	if (table) return html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>METRIC</th><th>VALUE</th><th>NOTE</th></tr></thead>
		<tbody>${rows.map(([k, v, n]) => html`<tr><td>${k}</td><td><b>${v}</b></td><td class="mut">${n}</td></tr>`)}</tbody></table></div>`;
	return html`<div class="tiles">${rows.map(([k, v, n]) => html`<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${n}</div></div>`)}</div>`;
}

// internal disks in standby (hdparm -C, read at most once a minute by the box,
// #154): dimmed dot and ASLEEP; USB disks have no sleep state here
const usbDisk = (d) => d.usb || d.removable;
const asleep = (d) => html`${d.standby ? html` <span class="tag" title="Checked once a minute">ASLEEP</span>` : ''}${d.smart && d.smart !== 'good' ? html` <span class="tag ${SMART_RATING[d.smart][0]}">${SMART_RATING[d.smart][1]}</span>` : ''}`;
// dot of a disk: red/amber by the SMART values read last, green only with
// good values and awake; dimmed when asleep or when nothing is known (no
// SMART values yet, USB disk, sleep state not readable)
const diskDot = (d) => (d.smart === 'bad' ? ' down' : d.smart === 'warn' ? ' warn' : d.smart === 'good' && d.standby === false ? ' up' : '');
function diskCards(i, table = false) {
	const disks = i.disks || [];
	if (!disks.length)
		return html`<div class="panel"><div class="empty">${svg(I.info)}<span>No hard disk or USB storage detected. ShareOS runs entirely from the internal flash – drives appear here as soon as they are attached.</span></div></div>`;
	if (table) return html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>DRIVE</th><th>TYPE</th><th>MODEL</th><th>SIZE</th></tr></thead>
		<tbody>${disks.map((d) => html`<tr><td><b>${d.name}</b> <span class="mut">/dev/${d.name}</span>${asleep(d)}</td><td>${usbDisk(d) ? 'USB' : 'Disk'}</td><td>${d.model || 'unknown model'}</td><td>${fmtBytes(d.size)}</td></tr>`)}</tbody></table></div>`;
	return html`<div class="grid">${disks.map((d) => html`
		<div class="card">
			<div class="icon">${svg(usbDisk(d) ? I.usb : I.disk)}<span class="dot${diskDot(d)}"></span></div>
			<div class="info"><div class="name">${usbDisk(d) ? 'USB' : 'Disk'} · ${d.name}${asleep(d)}</div>
				<div class="desc">${d.model || 'unknown model'} · ${fmtBytes(d.size)}</div>
				<div class="ip">/dev/${d.name}</div></div>
		</div>`)}</div>`;
}

// The fan has no speed sensor: what is shown is the setting the box asked for
// (pwm1: 0 = off, 1–127 = half, 128–255 = full, as dns320l-daemon and gpio-fan
// apply it).
const fanTxt = (pwm) => (pwm == null ? '–' : pwm === 0 ? 'off' : pwm < 128 ? 'half' : 'full');
// warn colour of the temperature bar: the default limit of the messages (temp_max)
const TEMP_WARN = 55;
// is the fan control at work? (rpcd board_control: shareos-board and, on boxes
// with an MCU, dns320l-daemon run and a fresh temperature is there)
function boardTag(bc) {
	if (!bc || !bc.control) return html`<span class="tag ml">no board control</span>`;
	return bc.running && bc.sensor ? html`<span class="tag ml ok">board control active</span>`
		: html`<span class="tag ml err" title="${bc.running ? 'No temperature reading – the fan runs at full speed.' : 'The fan control of the box is not running.'}">board control not running</span>`;
}

const fsLabel = { '/overlay': 'Settings & packages', '/rom': 'System (read-only)', '/tmp': 'RAM (tmp)' };

const VIEWS = {
	overview() {
		const i = S.info;
		if (!i) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading system data …</span></div></div>`;
		const m = i.memory || {}, used = (m.memtotal || 0) - (m.memavailable || 0);
		const t = i.temperature != null ? i.temperature / 1000 : null;
		const ov = (i.filesystems || []).find((f) => f.mount === '/overlay');
		const e = i.network?.eth0 || {};
		const bootTxt = { flash: 'Flash (UBI)', netroot: 'Network (RAM)', ram: 'RAM' }[i.boot] || i.boot;
		const svcUp = S.services ? S.services.filter((x) => x.running).length : null;
		return html`
		<section class="sec" data-part="load">
			<h2 class="gh">SYSTEM <span>live · every 5 s</span></h2>
			<div class="g2">
				<div class="panel">
					<div class="ph"><span class="pt">LOAD</span>${boardTag(i.board_control)}</div>
					<div class="mbars">
						${mrow('CPU', S.cpu ?? 0, S.cpu == null ? '…' : S.cpu.toFixed(0) + ' %')}
						${mrow('RAM', pct(used, m.memtotal), fmtBytes(used, 0))}
						${mrow('TEMP', t == null ? 0 : pct(t, 65), t == null ? '–' : t.toFixed(0) + ' °C', t >= TEMP_WARN ? 'warn' : '')}
						${mrow('FAN', i.fan_pwm == null ? 0 : pct(i.fan_pwm, 255), fanTxt(i.fan_pwm))}
						${ov ? mrow('FLASH', pct(ov.used, ov.size), fmtBytes(ov.used, 0)) : ''}
					</div>
					<p class="note">${i.model ? i.model + ' · ' : ''}Linux ${i.kernel} · Load ${(i.load || []).map((x) => x.toFixed(2)).join(' ')}</p>
				</div>
				<div class="panel">
					<div class="ph"><span class="pt">NETWORK · eth0</span><span class="tag ml">${e.speed ? e.speed + ' Mbit/s' : 'no link'}</span></div>
					${spark()}
					<div class="rates"><span class="rx">↓ <b>${fmtRate(S.rxRate)}</b> rx</span><span class="mut">last 10 min</span><span class="tx">↑ <b>${fmtRate(S.txRate)}</b> tx</span></div>
					<dl class="kv" style="margin-top:14px">
						<dt>IPv4</dt><dd>${e.ipv4 ? `${e.ipv4.address} / ${e.ipv4.prefix}` : '–'}</dd>
						<dt>Gateway · DNS</dt><dd>${e.gateway || '–'} · ${(e.dns || []).join(', ') || '–'}</dd>
						<dt>MAC</dt><dd>${e.mac || '–'}</dd>
					</dl>
				</div>
			</div>
		</section>
		${favBar(S.apps?.installed?.apps || [])}
		<section class="sec" data-part="status">
			${secHead('status', 'STATUS')}
			${statusTiles([
				['Firmware', i.release?.version || '–', S.check?.update_available ? 'Update ' + S.check.latest + ' available' : S.check?.channel ? 'Channel ' + S.check.channel : 'not checked yet'],
				['Booted from', bootTxt, i.boot === 'flash' ? 'Settings are kept' : 'Changes are lost on reboot'],
				['Uptime', fmtUptime(i.uptime), 'since the last boot'],
				['Services', svcUp == null ? '…' : `${svcUp} / ${S.services.length}`, 'running'],
				['Flash free', ov ? fmtBytes(ov.avail, 0) : '–', 'for settings & packages'],
				['Drives', String((i.disks || []).length), (i.disks || []).length ? 'detected' : 'none attached']
			], isTable('status'))}
		</section>
		<section class="sec" data-part="disks">
			${secHead('disks', 'DRIVES', `${(i.disks || []).length} detected`)}
			${diskCards(i, isTable('disks'))}
		</section>
		<section class="sec" data-part="services">
			${secHead('services', 'SERVICES', html`<a href="#/services">manage all</a>`)}
			${serviceCards(false, isTable('services'))}
		</section>`;
	},

	storage() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Storage">${STO_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/storage/${id}">${label}</a>`)}</nav>
		${sub === 'snapshots' ? snapshotsView() : sub === 'health' ? healthView() : storageView()}`;
	},

	shares() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Shares">${SHR_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/shares/${id}">${label}</a>`)}</nav>
		${sub === 'files' ? html`${filesView()}<div id="fb-trashset">${trashSettings()}</div>` : !S.shares || !S.acc || !S.vols ? html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`
			: sub === 'users' ? usersView() : sub === 'groups' ? groupsView() : sharesView()}`;
	},
	apps: () => appsView(),
	cloud: () => cloudSection('admin'),
	paperless: () => paperlessView(),
	dnsfilter: () => dnsfilterView(),

	services() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Services">${SVC_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/services/${id}">${label}</a>`)}</nav>
		${sub === 'dlna' ? dlnaView() : sub === 'printer' ? printerView() : sub === 'ups' ? upsView() : sub === 'torrent' ? tremoteView() : sub === 'autostart' ? autostartView()
			: html`<section class="sec">${secHead('services', 'SERVICES', 'start, stop, restart')}${serviceCards(true, isTable('services'))}</section>`}`;
	},

	system() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="System">${SYS_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/system/${id}">${label}</a>`)}</nav>
		${(SYS[sub] || SYS.general)()}`;
	}
};

function svcActions(s) {
	return s.running ? html`<button class="btn sm" type="button" data-act="svc" data-name="${s.name}" data-op="restart">${svg(I.reboot)}Restart</button>
		${s.essential ? '' : html`<button class="btn sm danger" type="button" data-act="svc" data-name="${s.name}" data-op="stop">Stop</button>`}`
		: html`<button class="btn sm" type="button" data-act="svc" data-name="${s.name}" data-op="start">Start</button>`;
}

function serviceCards(withActions, table = false) {
	if (!S.services) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading services …</span></div></div>`;
	if (table) return html`<div class="tw"><table class="t" style="min-width:${withActions ? 720 : 520}px"><thead><tr><th>SERVICE</th><th>DESCRIPTION</th><th>STATUS</th><th>AT BOOT</th>${withActions ? html`<th></th>` : ''}</tr></thead>
		<tbody>${S.services.map((s) => html`<tr>
			<td><b>${s.label}</b><div class="mut" style="font-size:12px">${s.name}</div></td><td class="mut">${s.desc}</td>
			<td><span class="tag ${s.running ? 'ok' : 'err'}">${s.running ? 'running' : 'stopped'}</span></td>
			<td class="mut">${s.essential ? 'always' : s.autostart === false ? 'off' : 'on'}</td>
			${withActions ? html`<td><div class="acts">${svcActions(s)}</div></td>` : ''}</tr>`)}</tbody></table></div>`;
	return html`<div class="grid">${S.services.map((s) => html`
		<div class="card${s.running ? '' : ' off'}">
			<div class="icon">${svg(SVC_ICON[s.name] || I.chip)}<span class="dot ${s.running ? 'up' : 'down'}"></span></div>
			<div class="info"><div class="name">${s.label}</div><div class="desc">${s.desc}</div>
				<div class="ip">${s.name} · ${s.running ? 'running' : 'stopped'}</div>
				${withActions ? html`<div class="acts" style="margin-top:12px">${svcActions(s)}</div>` : ''}
			</div>
		</div>`)}</div>`;
}

function autostartView() {
	if (!S.services) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading services …</span></div></div>`;
	return html`<section class="sec">
		<h2 class="gh">AUTOSTART <span>which services start when the box is switched on</span></h2>
		<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>SERVICE</th><th>DESCRIPTION</th><th>AT BOOT</th><th>NOW</th></tr></thead>
			<tbody>${S.services.map((s) => html`<tr>
				<td><b>${s.label}</b><div class="mut" style="font-size:12px">${s.name}</div></td><td class="mut">${s.desc}</td>
				<td>${s.essential ? html`<span class="tag" title="Without this service the box cannot be operated">always</span>`
					: html`<label class="chk"><input type="checkbox" class="as-toggle" data-name="${s.name}"${s.autostart !== false ? raw(' checked') : ''}>start</label>`}</td>
				<td><span class="tag ${s.running ? 'ok' : 'err'}">${s.running ? 'running' : 'stopped'}</span></td></tr>`)}</tbody></table></div>
		<p class="note">Applies from the next start. Running services are started and stopped under “Status”. Device control, system bus, API and web interface always start, otherwise the box could no longer be operated.</p>
	</section>`;
}

// the list is loaded when a page that shows it opens (not again within 5 s:
// renderMain runs this hook after every draw) and every 30 s by tick()
function loadServicesFresh() {
	if (S.services && Date.now() - (S.svcAt || 0) < 5000) return;
	loadServices();
}
async function loadServices() {
	S.svcAt = Date.now();
	try {
		S.services = (await rpc('shareos.service', 'list')).services;
		if (S.route.tab === 'services' || S.route.tab === 'overview') renderMain();
	} catch (e) { if (e.code !== 'auth') toast('Services: ' + e.message, true); }
}



/* ---------- shares, users, groups (Freigaben) -------------------------------- */

const ACCESS_TXT = { rw: 'read & write', ro: 'read only', '': 'no access' };
const fmtMB = (mb) => (mb ? fmtBytes(mb * 1e6, 0) : 'unlimited');

async function loadShareData() {
	try {
		const [sh, acc, st] = await Promise.all([rpc('shareos.shares', 'list'), rpc('shareos.accounts', 'list'), rpc('shareos.storage', 'status')]);
		S.shares = sh; S.acc = acc; S.vols = st.volumes || [];
	} catch (e) { if (e.code !== 'auth') toast('Shares: ' + e.message, true); }
	if (S.route.tab === 'shares' && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

function accessOf(sh, tag) { return sh.rw.includes(tag) ? 'rw' : sh.ro.includes(tag) ? 'ro' : ''; }
// the logged-in admin account's own access to a share (directly or by a group)
function accessOfUser(sh) {
	const u = S.acc?.users.find((x) => x.name === S.me?.name);
	return u ? [u.name, ...u.groups.map((g) => '@' + g)].map((t) => accessOf(sh, t)).find(Boolean) || '' : '';
}

function shareAccessSummary(sh) {
	const parts = [...sh.rw.map((x) => x + ' (rw)'), ...sh.ro.map((x) => x + ' (r)')];
	if (sh.guest) parts.unshift('Guests (r)');
	return parts.join(', ') || 'nobody yet';
}

function sharesView() {
	const d = S.shares, host = S.info?.hostname || location.hostname, ip = S.info?.network?.eth0?.ipv4?.address || location.hostname;
	const e = S.shEdit;
	const list = d.shares;
	return html`
	${e ? shareEditor(e) : ''}
	<section class="sec">
		${secHead('shares', 'SHARES', list.length ? list.length + ' set up' : 'none yet')}
		${!S.vols.length ? html`<div class="panel"><div class="empty">${svg(I.info)}<span>Shares need a drive – first set one up under <a href="#/storage">Storage</a> .</span></div></div>`
			: !list.length ? html`<div class="panel"><div class="empty">${svg(I.folder)}<div><span>No share yet. A share makes a folder on a drive reachable on the network – from Windows, macOS and Linux.</span>
				<div class="acts" style="margin-top:12px">${e ? '' : html`<button class="btn primary" type="button" data-act="sh-new">Create a share</button>`}</div></div></div></div>`
			: isTable('shares') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>SHARE</th><th>FOLDER</th><th>LOGS</th><th>ACCESS</th><th></th></tr></thead>
				<tbody>${list.map((x) => html`<tr>
					<td><b>${x.name}</b>${x.comment ? html`<div class="mut" style="font-size:12px">${x.comment}</div>` : ''}</td>
					<td><code>${x.fullpath || x.volume + '/' + x.path}</code>${x.mounted ? '' : html` <span class="tag err">drive missing</span>`}</td>
					<td>${shareTags(x)}</td><td class="mut" style="font-size:12px">${shareAccessSummary(x)}</td>
					<td><div class="acts">${shareActions(x)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${list.map((x) => html`<div class="card${x.mounted ? '' : ' off'}">
				<div class="icon">${svg(I.folder)}<span class="dot ${x.mounted ? 'up' : 'down'}"></span></div>
				<div class="info"><div class="name">${x.name}</div>
					<div class="desc">${x.comment || (x.fullpath || x.volume + '/' + x.path)}</div>
					<div class="desc" style="margin-top:8px">${shareTags(x)}</div>
					<div class="desc" style="margin-top:6px">${shareAccessSummary(x)}</div>
					<div class="ip">${x.smb ? '\\\\' + host + '\\' + x.name : x.fullpath || ''}</div>
					<div class="acts" style="margin-top:12px">${shareActions(x)}</div></div></div>`)}</div>`}
		${list.length && !e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="sh-new">New share</button></div>` : ''}
	</section>
	<section class="sec">
		<h2 class="gh">SERVICES</h2>
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SMB (WINDOWS, MACOS, LINUX)</span><span class="tag ml ${d.smb_running ? 'ok' : ''}">${d.smb_running ? 'running' : 'off'}</span></div>
				<label class="chk"><input type="checkbox" id="opt-smb"${d.smb_enabled ? raw(' checked') : ''}>Offer SMB shares</label>
				<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>WORKGROUP</span><input id="opt-wg" value="${d.workgroup}" maxlength="15"></label></div>
				<label class="chk" style="margin-top:12px"><input type="checkbox" id="opt-smbcompat"${d.smb_compat ? raw(' checked') : ''}>Compatibility mode (SMB 2.1 at most)</label>
				<p class="note">Only for devices that have trouble with SMB 3. The signature Windows 11 requires on every connection is computed by the crypto engine of the box with SMB 3 (measured about 19–23 MB/s when writing, about 35 without signing); SMB 2.1 computes it on the processor (about 9–14 MB/s) and has no encryption and no multichannel. Open connections are dropped when this is changed.</p>
				<dl class="kv" style="margin-top:12px">
					<dt>Windows</dt><dd><code>\\\\${host}\\&lt;share&gt;</code></dd>
					<dt>macOS / Linux</dt><dd><code>smb://${ip}/&lt;share&gt;</code></dd>
				</dl>
				<p class="note">The SMB service starts automatically as soon as there is a share. Personal folders appear as <code>\\\\${host}\\&lt;user&gt;</code>.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NFS (LINUX, PROXMOX)</span><span class="tag ml ${d.nfs_running ? 'ok' : ''}">${d.nfs_running ? 'running' : 'off'}</span></div>
				<label class="chk"><input type="checkbox" id="opt-nfs"${d.nfs_enabled ? raw(' checked') : ''}>Offer NFS shares</label>
				<p class="note">NFS has no user accounts: the listed computers or networks get access. Files are stored as <code>nobody:users</code> . Mount e.g. with <code>mount ${ip}:/mnt/&lt;drive&gt;/&lt;folder&gt; /target</code>.</p>
			</div>
		</div>
	</section>`;
}

// vault share: who unlocked it until when
const vaultTime = (t) => new Date(t * 1000).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
function vaultTag(x) {
	if (!x.vault) return '';
	const open = x.vault_open || [];
	return html`<span class="tag warn">VAULT</span> ${open.length ? open.map((o) => html`<span class="tag ok">${o.user}: open until ${vaultTime(o.until)}</span> `) : html`<span class="tag">locked</span> `}`;
}
function shareTags(x) {
	return html`${vaultTag(x)}${x.smb ? html`<span class="tag">SMB</span> ` : ''}${x.nfs ? html`<span class="tag">NFS${x.nfs_rw ? '' : ' (r)'}</span> ` : ''}${x.guest ? html`<span class="tag warn">GUEST</span>` : ''}${!x.smb && !x.nfs ? html`<span class="tag err">no protocol</span>` : ''}`;
}
function shareActions(x) {
	const me = S.me?.name, mine = (x.vault_open || []).some((o) => o.user === me);
	return html`${x.vault && me && me !== 'root' && !mine && accessOfUser(x) ? html`<button class="btn sm" type="button" data-act="vault-unlock" data-share="${x.name}" data-ttl="${x.vault_ttl}">${svg(I.key)}Unlock</button> ` : ''}
		${x.vault && (x.vault_open || []).length ? html`<button class="btn sm" type="button" data-act="sh-vlock" data-name="${x.name}">${svg(I.lock)}Lock now</button> ` : ''}
		<button class="btn sm" type="button" data-act="sh-edit" data-name="${x.name}">Edit</button>
		<button class="btn sm ghost" type="button" data-act="sh-del" data-name="${x.name}">Remove</button>`;
}

function shareEditor(e) {
	const x = e.data, accs = S.acc;
	const rows = [...accs.users.map((u) => [u.name, u.fullname ? `${u.name} – ${u.fullname}` : u.name, I.user]),
		...accs.groups.map((g) => ['@' + g.name, `Group ${g.name}`, I.users])];
	return html`<section class="sec"><form class="panel" id="f-share" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${e.mode === 'new' ? 'NEW SHARE' : 'SHARE ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="sh-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="16" pattern="[a-z0-9][a-z0-9_-]{0,15}" required${e.mode === 'edit' ? raw(' readonly') : ''}></label>
			<label class="f"><span>DRIVE</span><select name="volume">${S.vols.map((v) => html`<option value="${v.name}"${x.volume === v.name ? raw(' selected') : ''}>${v.name} (${LAYOUT_TXT[v.layout] || v.layout})</option>`)}</select></label>
			<label class="f"><span>FOLDER ON THE DRIVE</span><div class="fb-row"><input name="path" value="${x.path}" placeholder="same as the name"><button class="btn sm" type="button" data-act="sh-browse">Browse …</button></div></label>
			<label class="f"><span>DESCRIPTION</span><input name="comment" value="${x.comment}" maxlength="64"></label>
		</div>
		<div class="pt" style="margin:18px 0 8px">ACCESS VIA SMB</div>
		<div style="display:grid;gap:6px">
			<label class="chk"><input type="checkbox" name="smb"${x.smb ? raw(' checked') : ''}>Share via SMB (Windows, macOS, Linux)</label>
			<label class="chk"><input type="checkbox" name="guest"${x.guest ? raw(' checked') : ''}>Guests may read without a password</label>
		</div>
		${rows.length ? html`<div class="tw" style="margin-top:12px"><table class="t" style="min-width:420px"><thead><tr><th>USER / GROUP</th><th style="width:220px">PERMISSION</th></tr></thead>
			<tbody>${rows.map(([tag, label, icon]) => html`<tr><td><span style="display:inline-flex;gap:8px;align-items:center">${svg(icon)}${label}</span></td>
				<td><select class="acl" data-tag="${tag}" aria-label="Permission for ${label}">${['', 'ro', 'rw'].map((v) => html`<option value="${v}"${accessOf(x, tag) === v ? raw(' selected') : ''}>${ACCESS_TXT[v]}</option>`)}</select></td></tr>`)}</tbody></table></div>`
			: html`<p class="note">No users yet – create them under <a href="#/shares/users">User</a> , or allow guest access.</p>`}
		<div class="pt" style="margin:18px 0 8px">VAULT</div>
		<label class="chk"><input type="checkbox" name="vault"${x.vault ? raw(' checked') : ''}>As a vault: share only on request, for some minutes</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:10px"><label class="f"><span>DEFAULT TIME WHEN UNLOCKING</span><select name="vault_ttl">${VAULT_TTLS.map((m) => html`<option value="${m}"${(x.vault_ttl || 15) === m ? raw(' selected') : ''}>${vaultMin(m)}</option>`)}</select></label></div>
		<p class="note">A vault is not visible in the network. A user with rights on it unlocks it under “My ShareOS” (or in an app) with their password – then, for the chosen time, it is reachable for them only as <code>\\box\${x.name || 'name'}</code> and locks itself afterwards. While locked, nobody gets at the files, not through open connections or apps either. A vault is shared over SMB only, without guests and NFS.</p>
		<div class="pt" style="margin:18px 0 8px">ACCESS VIA NFS</div>
		<div style="display:grid;gap:6px">
			<label class="chk"><input type="checkbox" name="nfs"${x.nfs ? raw(' checked') : ''}>Share via NFS</label>
			<label class="chk"><input type="checkbox" name="nfs_rw"${x.nfs_rw ? raw(' checked') : ''}>NFS clients may write</label>
		</div>
		<div class="fields" style="grid-template-columns:1fr;margin-top:10px"><label class="f"><span>NFS CLIENTS (IP OR NETWORK, COMMA-SEPARATED)</span><input name="nfs_hosts" value="${x.nfs_hosts.join(', ')}" placeholder="192.168.1.0/24"></label></div>
		<p class="note">The folder is created if it is missing. Removing a share keeps the folder and its files.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function usageLine(u) {
	if (!u.usage?.length) return u.quota ? html`Limit ${fmtMB(u.quota)} per drive` : html`<span class="mut">no limit</span>`;
	return html`${u.usage.map((x) => { const p = x.limit ? pct(x.used, x.limit) : 0; return html`<div style="margin-top:4px"><span class="mut">${x.volume}:</span> ${fmtBytes(x.used)}${x.limit ? html` of ${fmtBytes(x.limit)}` : ''}
		${x.limit ? html`<div class="bar" style="margin-top:4px"><i class="${p > 95 ? 'crit' : p > 85 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}</div>`; })}`;
}

function usersView() {
	const a = S.acc, e = S.uEdit;
	return html`
	${e ? userEditor(e) : ''}
	<section class="sec">
		${secHead('users', 'USER', a.users.length ? a.users.length + ' created' : 'none yet')}
		${!a.users.length ? html`<div class="panel"><div class="empty">${svg(I.user)}<div><span>No users yet. One account works everywhere: for shares, the web interface and later for apps and cloud sync.</span>
			<div class="acts" style="margin-top:12px">${e ? '' : html`<button class="btn primary" type="button" data-act="u-new">Create a user</button>`}
			<button class="btn ghost" type="button" data-act="u-altf">Import from Alt-F</button></div></div></div></div>`
		: isTable('users') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>USER</th><th>ROLE</th><th>GROUPS</th><th>PERSONAL FOLDER</th><th>STORAGE</th><th></th></tr></thead>
			<tbody>${a.users.map((u) => html`<tr>
				<td><b>${u.name}</b>${u.fullname ? html`<div class="mut" style="font-size:12px">${u.fullname}</div>` : ''}</td>
				<td>${roleTag(u)}</td><td class="mut">${u.groups.join(', ') || '–'}</td>
				<td class="mut">${u.home ? '/mnt/' + u.home + '/home/' + u.name : '–'}</td>
				<td style="font-size:12px;min-width:160px">${usageLine(u)}</td>
				<td><div class="acts">${userActions(u)}</div></td></tr>`)}</tbody></table></div>`
		: html`<div class="grid">${a.users.map((u) => html`<div class="card">
			<div class="icon">${svg(I.user)}</div>
			<div class="info"><div class="name">${u.name} ${roleTag(u)}</div>
				<div class="desc">${u.fullname || ''}${u.groups.length ? (u.fullname ? ' · ' : '') + u.groups.join(', ') : ''}</div>
				<div class="desc" style="margin-top:8px;font-size:12px">${usageLine(u)}</div>
				<div class="ip">${u.home ? '/mnt/' + u.home + '/home/' + u.name : 'no personal folder'}</div>
				<div class="acts" style="margin-top:12px">${userActions(u)}</div></div></div>`)}</div>`}
		${a.users.length && !e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="u-new">New user</button>
			<button class="btn ghost" type="button" data-act="u-altf">Import from Alt-F</button></div>` : ''}
		<p class="note">Roles: <b>Administrator</b> – everything, including SSH. <b>User</b> – own area “My ShareOS” in the web interface. <b>Shares only</b> – access to shares, no web login. The account <code>root</code> is always an administrator.</p>
	</section>`;
}

function roleTag(u) {
	return html`<span class="tag ${u.role === 'admin' ? 'warn' : ''}">${ROLE_TXT[u.role] || u.role}${u.role === 'user' && !u.web ? ' · no web' : ''}</span>`;
}
function userActions(u) {
	return html`<button class="btn sm" type="button" data-act="u-edit" data-name="${u.name}">Edit</button>
		<button class="btn sm" type="button" data-act="u-pass" data-name="${u.name}">${svg(I.key)}Password</button>
		<button class="btn sm ghost" type="button" data-act="u-del" data-name="${u.name}">Delete</button>`;
}

function userEditor(e) {
	const u = e.data, isNew = e.mode === 'new';
	return html`<section class="sec"><form class="panel" id="f-user" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${isNew ? 'NEW USER' : 'USER ' + u.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="u-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>USER NAME</span><input name="name" value="${u.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required autocomplete="off"${isNew ? '' : raw(' readonly')}></label>
			<label class="f"><span>FULL NAME</span><input name="fullname" value="${u.fullname}" maxlength="64"></label>
			<label class="f"><span>ROLE</span><select name="role">${Object.entries(ROLE_TXT).map(([k, t]) => html`<option value="${k}"${u.role === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>PERSONAL FOLDER</span><select name="home"><option value="">none</option>${S.vols.filter(linuxFs).map((v) => html`<option value="${v.name}"${u.home === v.name ? raw(' selected') : ''}>on ${v.name}</option>`)}</select></label>
			<label class="f"><span>STORAGE LIMIT (GB)</span><input name="quota" type="number" min="0" step="1" value="${Math.round((u.quota || 0) / 1000)}"></label>
			${isNew ? html`<label class="f"><span>PASSWORD</span><input name="p1" type="password" minlength="6" autocomplete="new-password" required></label>
				<label class="f"><span>REPEAT</span><input name="p2" type="password" minlength="6" autocomplete="new-password" required></label>` : ''}
		</div>
		<label class="chk" style="margin-top:12px" id="u-web-row"${u.role === 'user' ? '' : raw(' hidden')}><input type="checkbox" name="web"${u.web ? raw(' checked') : ''}>May log in to the web interface (“My ShareOS”)</label>
		<label class="chk" style="margin-top:6px"><input type="checkbox" name="cloud"${u.cloud ? raw(' checked') : ''}>May create own cloud sync jobs (needs a personal folder)</label>
		<label class="chk" style="margin-top:6px"><input type="checkbox" name="files"${u.files ? raw(' checked') : ''}>Files: personal folder and shares (by permissions) in the file browser and in apps</label>
		${S.acc.groups.length ? html`<div class="pt" style="margin:16px 0 8px">GROUPS</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${S.acc.groups.map((g) => html`
			<label class="chk"><input type="checkbox" class="u-group" value="${g.name}"${u.groups.includes(g.name) ? raw(' checked') : ''}>${g.name}</label>`)}</div>` : ''}
		<p class="note">User name: lower-case letters, digits and _, starting with a letter. The storage limit applies per drive, 0 = unlimited. The password is used for shares and – depending on the role – for the web interface.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">${isNew ? 'Create' : 'Save'}</button></div>
	</form></section>`;
}

function groupsView() {
	const a = S.acc;
	return html`<section class="sec">
		<h2 class="gh">GROUPS <span>${a.groups.length ? a.groups.length + ' created' : 'none yet'}</span></h2>
		${a.groups.length ? html`<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>GROUP</th><th>DESCRIPTION</th><th>MEMBERS</th><th></th></tr></thead>
			<tbody>${a.groups.map((g) => html`<tr><td><b>${g.name}</b></td><td class="mut">${g.desc || '–'}</td><td>${g.members.join(', ') || html`<span class="mut">none</span>`}</td>
				<td><button class="btn sm ghost" type="button" data-act="g-del" data-name="${g.name}">Delete</button></td></tr>`)}</tbody></table></div>`
			: html`<div class="panel"><div class="empty">${svg(I.users)}<span>Groups bring users together, e.g. “family” or “media”. Share permissions can then be given to the whole group.</span></div></div>`}
		<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="g-new">New group</button></div>
		<p class="note">Members are set on the user (Users → Edit).</p>
	</section>`;
}



/* ---------- DNS filter (module "dnsfilter", AdGuard Home) ------------------------ */

async function loadDnsfilter() {
	clearTimeout(S.dfTimer);
	try {
		const d = await rpc('shareos.dnsfilter', 'status');
		d.filters = d.ready ? (await rpc('shareos.dnsfilter', 'filters')).filters : [];
		d.rewrites = d.ready ? (await rpc('shareos.dnsfilter', 'rewrites')).rewrites : [];
		S.df = d;
		if (!d.start_error && (d.starting || (d.enabled && !d.running && S.dfStarting))) S.dfTimer = setTimeout(loadDnsfilter, 3000);
		else S.dfStarting = false;
	} catch (e) { if (e.code !== 'auth') toast('DNS filter: ' + e.message, true); }
	if (S.route.tab === 'dnsfilter' && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

function dnsfilterView() {
	const d = S.df;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const host = location.hostname, num = (n) => (n ?? 0).toLocaleString(LOC);
	const starting = !d.ready && !d.start_error && (d.starting || S.dfStarting);
	const state = d.ready ? html`<span class="tag ok ml">running</span>` : starting ? html`<span class="tag warn ml">starting …</span>`
		: d.start_error ? html`<span class="tag err ml">Error</span>` : html`<span class="tag ml">off</span>`;
	return html`
	<section class="sec">
		<h2 class="gh">DNS FILTER <span>AdGuard Home${d.version ? ' ' + d.version : ''}</span></h2>
		${!d.drive ? html`<div class="panel" style="margin-bottom:12px"><div class="empty">${svg(I.warn)}<span>The DNS filter needs the apps drive (Storage → Drives).</span></div></div>` : ''}
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">STATUS</span>${state}${d.ready && d.protection === false ? html`<span class="tag warn">filtering paused</span>` : ''}</div>
				${d.ready ? html`<div class="tiles" style="margin:0">
					<div class="tile"><div class="k">QUERIES</div><div class="v">${num(d.queries)}</div></div>
					<div class="tile"><div class="k">BLOCKED</div><div class="v">${num(d.blocked)}</div></div>
					<div class="tile"><div class="k">RULES</div><div class="v">${num(d.rules)}</div></div>
					<div class="tile"><div class="k">RAM</div><div class="v">${d.rss_mb != null ? Math.round(d.rss_mb) + ' MB' : '–'}</div></div></div>
					<p class="note"><span>Estimated need with these lists:</span> ~${d.estimate_mb} MB</p>
					${d.warn ? html`<p class="note" style="color:var(--amber)">Many rules: large lists cost a lot of memory. With the 256 MB of the box, better stay with the default list.</p>` : ''}`
				: starting ? html`<div class="empty" style="padding:8px 0"><div class="spin" style="margin:0"></div><span>AdGuard Home is starting and loading the block lists – this takes about a minute.</span></div>`
				: d.start_error ? html`<p class="mut" style="margin:0;font-size:13px"><span>Start failed:</span> <code data-i18n-skip>${d.start_error}</code></p>`
				: html`<p class="mut" style="margin:0;font-size:13px">Switch it on below.</p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">HOW TO USE IT</span></div>
				<ol class="plan" style="padding-left:20px">
					<li><span>Enter the address of the box as DNS server in the router – or only on single devices:</span> <code>${S.info?.network?.eth0?.ipv4?.address || host}</code></li>
					<li>Do not enter a second DNS server, otherwise devices ask past the box. While the box is off or restarting, the devices have no DNS.</li>
					<li>Fine settings, query log and statistics in the interface of AdGuard Home.</li>
				</ol>
				<div class="acts">${d.ready ? html`<a class="btn" href="${d.https ? `https://${host}:${d.https_port}/` : `http://${host}:${d.web_port}/`}" target="_blank" rel="noopener">Open AdGuard Home ↗</a>` : ''}
					<button class="btn" type="button" data-act="df-pass">Show login</button></div>
				${d.ready ? html`<p class="note">${d.https_forced ? 'Encrypted (HTTPS) with the box\'s certificate; HTTP requests are redirected.'
					: d.https ? html`<span>Encrypted (HTTPS) with the box's self-signed certificate – the browser warns as with the interface. HTTP is only redirected once the box has a trusted certificate (own CA or Let's Encrypt under</span> <a href="#/system/network">System → Network</a>).`
					: 'Without a certificate of the box only unencrypted (HTTP).'}</p>` : ''}
				${d.ready && d.local?.names?.length ? html`<dl class="kv" style="margin-top:12px"><dt>Local names</dt><dd><code>${d.local.names.join(', ')}</code> → <code>${d.local.ip}</code></dd>
					${(d.local.domains || []).map((x) => html`<dt>Local domain</dt><dd><code>${x}</code> → <span>DNS server of the network</span></dd>`)}</dl>` : ''}
				${S.dfPass ? html`<dl class="kv" style="margin-top:12px"><dt>User</dt><dd><code>${S.dfPass.user}</code></dd><dt>Password</dt><dd><code>${S.dfPass.password}</code></dd></dl>` : ''}
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-df" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Switch on the DNS filter (also starts after a restart)</label>
		${d.ready ? html`<label class="chk" style="margin-top:8px;display:flex"><input type="checkbox" name="protection"${d.protection !== false ? raw(' checked') : ''}>Filtering on (off = only forward)</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px">
			<label class="f"><span>UPSTREAM SERVERS (ONE PER LINE)</span><textarea name="upstream" rows="3">${(d.upstream || []).join('\n')}</textarea></label>
		</div>` : ''}
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>PORT OF THE ADGUARD INTERFACE</span><input name="web_port" type="number" min="1024" max="65535" value="${d.web_port}"></label>
			<label class="f"><span>HTTPS PORT OF THE ADGUARD INTERFACE</span><input name="https_port" type="number" min="1024" max="65535" value="${d.https_port || d.web_port + 1}"></label>
		</div>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit"${starting ? raw(' disabled') : ''}>Save</button>
			${starting ? html`<span class="mut" style="font-size:12px">You can save again once it is running.</span>` : ''}</div>
	</form></section>
	${d.ready ? html`<section class="sec">
		<h2 class="gh">LOCAL ENTRIES <span>${d.rewrites.length}</span></h2>
		${d.rewrites.length ? html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>NAME</th><th>ADDRESS</th><th></th></tr></thead>
			<tbody>${d.rewrites.map((w) => html`<tr><td><code>${w.domain}</code></td><td><code>${w.answer}</code></td>
				<td><button class="btn sm ghost" type="button" data-act="df-rwdel" data-domain="${w.domain}" data-answer="${w.answer}">Remove</button></td></tr>`)}</tbody></table></div>` : ''}
		<form class="panel" id="f-dfrw" style="margin-top:12px;max-width:820px">
			<div class="fields"><label class="f"><span>NAME</span><input name="domain" maxlength="253" placeholder="printer.${d.local?.domains?.[0] || 'home.lan'}" autocapitalize="off" spellcheck="false"></label>
				<label class="f"><span>IP ADDRESS</span><input name="answer" maxlength="253" placeholder="192.168.1.50" autocapitalize="off" spellcheck="false"></label></div>
			<div class="acts" style="margin-top:12px"><button class="btn" type="submit">Add entry</button></div>
			<p class="note"><span>For devices with a fixed IP address that the router does not know.</span> <code>*.name</code> <span>applies to all names below it. ShareOS sets the box's own names itself.</span></p>
		</form>
	</section>
	<section class="sec">
		<h2 class="gh">BLOCK LISTS <span>${d.filters.length}</span></h2>
		<div class="tw"><table class="t" style="min-width:640px"><thead><tr><th>LIST</th><th>RULES</th><th>ACTIVE</th><th></th></tr></thead>
			<tbody>${d.filters.map((f) => html`<tr><td><b>${f.name}</b><div class="mut" style="font-size:12px;word-break:break-all">${f.url}</div></td>
				<td>${num(f.rules)}</td>
				<td><input type="checkbox" class="df-en" data-url="${f.url}"${f.enabled ? raw(' checked') : ''}></td>
				<td><button class="btn sm ghost" type="button" data-act="df-del" data-url="${f.url}">Remove</button></td></tr>`)}</tbody></table></div>
		<form class="panel" id="f-dfadd" style="margin-top:12px;max-width:820px">
			<div class="fields"><label class="f"><span>NAME</span><input name="name" maxlength="64"></label>
				<label class="f"><span>ADDRESS OF THE LIST</span><input name="url" inputmode="url" placeholder="https://…"></label></div>
			<div class="acts" style="margin-top:12px"><button class="btn" type="submit">Add list</button>
				<button class="btn" type="button" data-act="df-refresh">Update lists</button></div>
			<p class="note">Every rule costs memory (about 0.1 KB). From 300,000 rules on, ShareOS warns.</p>
		</form>
	</section>` : ''}`;
}

/* ---------- Paperless ----------------------------------------------------------- */

const PL_STATE = { SUCCESS: ['ok', 'accepted'], PENDING: ['', 'processing'], FAILURE: ['err', 'Error'], UNKNOWN: ['warn', 'unknown'] };
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString(LOC, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

async function loadPaperless() {
	try {
		const [pl, acc, sh] = await Promise.all([rpc('shareos.paperless', 'get'), rpc('shareos.accounts', 'list'), rpc('shareos.shares', 'list')]);
		S.pl = pl; S.acc = acc; S.shares = sh;
	} catch (e) { if (e.code !== 'auth') toast('Paperless: ' + e.message, true); }
	if (S.route.tab === 'paperless' && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

function plStateTag(e) { const [c, t] = PL_STATE[e.state] || ['', e.state]; return html`<span class="tag ${c}" title="${e.message}">${t}</span>`; }

function inboxWhere(ib) {
	const host = S.info?.hostname || location.hostname;
	if (ib.owner) return `\\\\${host}\\${ib.owner}\\Paperless`;
	return ib.share ? `\\\\${host}\\${ib.share}` : ib.path || '–';
}

function paperlessView() {
	const d = S.pl;
	if (!d || !S.acc || !S.shares) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const e = S.plEdit;
	return html`
	<section class="sec">
		<h2 class="gh">PAPERLESS-NGX <span>${d.url ? d.url : 'not connected yet'}</span></h2>
		<div class="g2">
			<form class="panel" id="f-pl">
				<div class="ph"><span class="pt">CONNECTION</span>${d.last ? html`<span class="tag ml">last ${fmtTime(d.last)}</span>` : ''}</div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>PAPERLESS ADDRESS</span><input name="url" value="${d.url}" placeholder="http://paperless.local:8000" inputmode="url"></label>
				</div>
				<div class="fields" style="margin-top:12px">
					<label class="f"><span>CHECK EVERY</span><select name="interval">${[1, 2, 5, 10, 15, 30, 60].map((m) => html`<option value="${m}"${d.interval === m ? raw(' selected') : ''}>${m} min</option>`)}</select></label>
					<label class="f"><span>AFTER UPLOAD</span><select name="after"><option value="delete"${d.after === 'delete' ? raw(' selected') : ''}>Delete file</option><option value="keep"${d.after === 'keep' ? raw(' selected') : ''}>keep (.paperless/done)</option></select></label>
				</div>
				<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Send inbox folders automatically</label>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button>
					<button class="btn" type="button" data-act="pl-run" ${d.url && d.inboxes.length ? '' : 'disabled'}>Send now</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">HOW IT WORKS</span></div>
				<ol class="plan" style="padding-left:20px">
					<li>Create an API token in Paperless for each inbox (Profile → API token). The documents then belong to that Paperless user.</li>
					<li>Put files (PDF, images, Office) into the inbox folder – from a PC or straight from the scanner.</li>
					<li>ShareOS uploads them through the Paperless API and shows whether Paperless accepted them.</li>
				</ol>
				<p class="note">Personal inboxes live in the personal folder (<code>Paperless</code>); users can also enter their token themselves under “My ShareOS”. Shared inboxes use a share, e.g. for a scanner.</p>
			</div>
		</div>
	</section>
	${e ? inboxEditor(e) : ''}
	<section class="sec">
		${secHead('inboxes', 'INBOXES', d.inboxes.length ? d.inboxes.length + ' set up' : 'none yet')}
		${!d.inboxes.length ? html`<div class="panel"><div class="empty">${svg(I.doc)}<span>${d.url ? 'No inbox yet.' : 'No inbox yet. First enter the address of Paperless above.'}</span></div></div>`
			: isTable('inboxes') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>INBOX</th><th>FOLDER</th><th>WAITING</th><th>LOAD</th><th></th></tr></thead>
				<tbody>${d.inboxes.map((ib) => html`<tr>
					<td><b>${ib.name}</b><div class="mut" style="font-size:12px">${ib.owner ? 'personal: ' + ib.owner : 'shared'}${ib.enabled ? '' : ' · off'}</div></td>
					<td><code>${inboxWhere(ib)}</code></td><td>${ib.waiting}</td>
					<td>${ib.recent[0] ? html`${plStateTag(ib.recent[0])} <span class="mut" style="font-size:12px">${ib.recent[0].file}</span>` : html`<span class="mut">–</span>`}</td>
					<td><div class="acts">${inboxActions(ib)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.inboxes.map((ib) => html`<div class="card${ib.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.doc)}<span class="dot ${!(ib.enabled && ib.token_set) ? 'down' : ib.recent[0]?.state === 'FAILURE' ? 'warn' : 'up'}"></span></div>
				<div class="info"><div class="name">${ib.name}</div>
					<div class="desc">${ib.owner ? `personal inbox of ${ib.owner} · ` : 'shared inbox · '}${ib.token_hint ? 'token ' + ib.token_hint : 'no token'}</div>
					<div class="desc" style="margin-top:6px">${ib.waiting ? ib.waiting + ' file(s) waiting' : 'nothing waiting'}</div>
					${ib.recent.slice(0, 3).map((x) => html`<div class="desc" style="margin-top:4px;font-size:12px">${plStateTag(x)} ${x.file} <span class="mut">${fmtTime(x.time)}</span></div>`)}
					<div class="ip">${inboxWhere(ib)}</div>
					<div class="acts" style="margin-top:12px">${inboxActions(ib)}</div></div></div>`)}</div>`}
		${!e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="pl-new" ${d.url ? '' : 'disabled'}>New inbox</button></div>` : ''}
	</section>
	${S.plLog ? html`<section class="sec"><div class="panel">
		<div class="ph"><span class="pt">LOG · ${S.plLog.name}</span><button class="btn sm ghost ml" type="button" data-act="pl-log-close">Close</button></div>
		${S.plLog.entries.length ? html`<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>TIME</th><th>FILE</th><th>STATUS</th><th>MESSAGE</th></tr></thead>
			<tbody>${S.plLog.entries.map((x) => html`<tr><td class="mut">${fmtTime(x.time)}</td><td>${x.file}</td><td>${plStateTag(x)}</td><td class="mut" style="font-size:12px">${x.message}</td></tr>`)}</tbody></table></div>`
			: html`<p class="mut" style="margin:0">Nothing transferred yet.</p>`}
	</div></section>` : ''}`;
}

function inboxActions(ib) {
	return html`<button class="btn sm" type="button" data-act="pl-edit" data-name="${ib.name}">Edit</button>
		<button class="btn sm" type="button" data-act="pl-log" data-name="${ib.name}">Log</button>
		<button class="btn sm ghost" type="button" data-act="pl-del" data-name="${ib.name}">Remove</button>`;
}

function inboxEditor(e) {
	const x = e.data, users = S.acc.users.filter((u) => u.home), isNew = e.mode === 'new';
	return html`<section class="sec"><form class="panel" id="f-inbox" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${isNew ? 'NEW INBOX' : 'INBOX ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="pl-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>TYPE</span><select name="kind"${isNew ? '' : raw(' disabled')}><option value="user"${x.owner || isNew ? raw(' selected') : ''}>personal (folder “Paperless” in the personal folder)</option><option value="share"${!x.owner && !isNew ? raw(' selected') : ''}>shared (folder of a share)</option></select></label>
			<label class="f" id="ib-owner"><span>USER</span><select name="owner"${isNew ? '' : raw(' disabled')}>${users.map((u) => html`<option value="${u.name}"${x.owner === u.name ? raw(' selected') : ''}>${u.name}${u.fullname ? ' – ' + u.fullname : ''}</option>`)}</select></label>
			<label class="f" id="ib-share" hidden><span>SHARE</span><select name="share"${isNew ? '' : raw(' disabled')}>${S.shares.shares.map((sh) => html`<option value="${sh.name}"${x.share === sh.name ? raw(' selected') : ''}>${sh.name}</option>`)}</select></label>
			<label class="f"><span>API TOKEN${isNew ? '' : ' (EMPTY = KEEP)'}</span><input name="token" type="password" autocomplete="off" placeholder="${x.token_hint || 'from Paperless: Profile → API token'}"${isNew ? raw(' required') : ''}></label>
		</div>
		${!isNew && e.tags ? html`<div class="pt" style="margin:16px 0 8px">TAGS FOR NEW DOCUMENTS</div>
			<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${e.tags.length ? e.tags.map((t) => html`<label class="chk"><input type="checkbox" class="ib-tag" value="${t.id}"${x.tags.includes(String(t.id)) ? raw(' checked') : ''}>${t.name}</label>`) : html`<span class="mut">no tags found</span>`}</div>` : ''}
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>active</label>
		${!users.length && isNew ? html`<p class="note">Personal inboxes need a user with a personal folder.</p>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="pl-test">Test connection</button></div>
	</form></section>`;
}

/* ---------- cloud (rclone), for the admin and for users ------------------------- */

const CLOUD_MODES = {
	upload: 'Upload – copy to the cloud, nothing is deleted',
	download: 'Download – copy to the NAS, nothing is deleted',
	mirror_up: 'Mirror to the cloud – deletes in the cloud what is missing here',
	mirror_down: 'Mirror from the cloud – deletes here what is missing in the cloud'
};
const CLOUD_SCHED = [['', 'manual only'], ['17 * * * *', 'hourly'], ['30 2 * * *', 'daily at 2:30'], ['0 3 * * 0', 'Sundays at 3:00'], ['custom', 'custom time (cron)']];
const REMOTE_TYPES = { gdrive: 'Google Drive', gphotos: 'Google Photos', onedrive: 'Microsoft OneDrive', dropbox: 'Dropbox', webdav: 'Nextcloud / ownCloud / WebDAV',
	s3: 'S3 (AWS, MinIO, Wasabi …)', b2: 'Backblaze B2', mega: 'MEGA', pcloud: 'pCloud', box: 'Box', koofr: 'Koofr', yandex: 'Yandex Disk',
	sftp: 'SFTP (SSH server)', ftp: 'FTP', smb: 'Windows share (SMB)', raw: 'other – paste rclone configuration' };
// services where you sign in in the browser (OAuth): no password is stored, only a token
const REMOTE_OAUTH = { gdrive: 1, gphotos: 1, onedrive: 1, dropbox: 1, pcloud: 1, box: 1, yandex: 1 };
const REMOTE_FIELDS = {
	ftp: [['host', 'SERVER'], ['port', 'PORT', '21'], ['user', 'USER'], ['pass', 'PASSWORD', 'password']],
	smb: [['host', 'SERVER'], ['user', 'USER'], ['domain', 'DOMAIN (OPTIONAL)', 'WORKGROUP'], ['pass', 'PASSWORD', 'password']],
	mega: [['user', 'E-MAIL'], ['pass', 'PASSWORD', 'password']],
	b2: [['account', 'KEY-ID (ACCOUNT)'], ['key', 'APPLICATION KEY', 'password']],
	koofr: [['provider', 'PROVIDER', ['koofr', 'digistorage', 'other']], ['user', 'E-MAIL'], ['password', 'APP PASSWORD', 'password']],
	webdav: [['url', 'ADDRESS (WEBDAV URL)', 'https://cloud.example.com/remote.php/dav/files/NAME/'], ['vendor', 'PROVIDER', ['nextcloud', 'owncloud', 'other']], ['user', 'USER'], ['pass', 'PASSWORD / APP PASSWORD', 'password']],
	s3: [['provider', 'PROVIDER', ['AWS', 'Minio', 'Wasabi', 'Other']], ['endpoint', 'ENDPOINT (EMPTY FOR AWS)'], ['region', 'REGION'], ['access_key_id', 'ACCESS KEY'], ['secret_access_key', 'SECRET KEY', 'password']],
	sftp: [['host', 'SERVER'], ['port', 'PORT', '22'], ['user', 'USER'], ['pass', 'PASSWORD', 'password']]
};

const CLOUD_API = {
	admin: {
		async load() {
			const [st, r, j, sh] = await Promise.all([rpc('shareos.cloud', 'status'), rpc('shareos.cloud', 'remotes'), rpc('shareos.cloud', 'jobs'), rpc('shareos.shares', 'list')]);
			return { status: st, remotes: r.remotes, jobs: j.jobs, locals: sh.shares.map((x) => ['share:' + x.name, 'Share ' + x.name]),
				places: Object.fromEntries(sh.shares.filter((x) => x.volume).map((x) => ['share:' + x.name, { name: x.name, root: x.volume, base: x.path }])) };
		},
		addRemote: (a) => rpc('shareos.cloud', 'remote_add', a), delRemote: (n) => rpc('shareos.cloud', 'remote_del', { name: n }),
		testRemote: (n) => rpc('shareos.cloud', 'remote_test', { name: n }), saveJob: (a) => rpc('shareos.cloud', 'job_set', a),
		delJob: (n) => rpc('shareos.cloud', 'job_del', { name: n }), runJob: (n) => rpc('shareos.cloud', 'job_run', { name: n }),
		stopJob: (n) => rpc('shareos.cloud', 'job_stop', { name: n }), log: (n) => rpc('shareos.cloud', 'job_log', { name: n })
	},
	me: {
		async load() {
			const c = await rpc('shareos.me', 'cloud');
			return { status: { installed: c.installed }, remotes: c.remotes || [], jobs: c.jobs || [], allowed: c.allowed,
				locals: [['home', 'Personal folder'], ...(c.shares || []).map((x) => ['share:' + x, 'Share ' + x])],
				places: Object.fromEntries([['home', { name: 'home', root: 'home', base: '' }], ...(c.shares || []).map((x) => ['share:' + x, { name: x, root: x, base: '' }])]) };
		},
		addRemote: (a) => rpc('shareos.me', 'cloud_remote_add', a), delRemote: (n) => rpc('shareos.me', 'cloud_remote_del', { name: n }),
		testRemote: null, saveJob: (a) => rpc('shareos.me', 'cloud_job_set', a), delJob: (n) => rpc('shareos.me', 'cloud_job_del', { name: n }),
		runJob: (n) => rpc('shareos.me', 'cloud_job_run', { name: n }), stopJob: null, log: null
	}
};

async function loadCloud(scope) {
	clearTimeout(S.cloudTimer);
	try { S.cloud = { ...(S.cloud?.scope === scope ? S.cloud : {}), scope, data: await CLOUD_API[scope].load() }; }
	catch (e) { if (e.code !== 'auth') toast('Cloud: ' + e.message, true); return; }
	const busy = S.cloud.data.status.installing || S.cloud.data.jobs.some((j) => j.state === 'running');
	const here = scope === 'admin' ? S.route.tab === 'cloud' : S.me && S.me.role !== 'admin';
	if (here && !document.activeElement?.matches('input,select,textarea')) { if (scope === 'admin') renderMain(); else renderUserMain(); }
	if (busy && here) S.cloudTimer = setTimeout(() => loadCloud(scope), 4000);
}

function jobState(j) {
	if (j.state === 'running') return html`<span class="tag warn">running since ${fmtTime(j.started)}</span>`;
	if (j.state === 'ok') return html`<span class="tag ok" title="${j.summary}">ok · ${fmtTime(j.ended)}</span>`;
	if (j.state === 'error') return html`<span class="tag err" title="${j.error}">Error · ${fmtTime(j.ended)}</span>`;
	return html`<span class="tag">not run yet</span>`;
}
const schedTxt = (s) => (CLOUD_SCHED.find(([v]) => v === s) || [s, s ? 'cron: ' + s : 'manual only'])[1];
// job.local: "home", "home:<sub>", "share:<name>" or "share:<name>/<sub>" -> [base, sub]
function localSplit(l) {
	const m = /^(home):(.+)$/.exec(l || '') || /^(share:[^/]+)\/(.+)$/.exec(l || '');
	return m ? [m[1], m[2]] : [l || '', ''];
}
const localTxt = (d, l) => { const [b, sub] = localSplit(l); return (d.locals.find(([v]) => v === b) || [b, b])[1] + (sub ? ' / ' + sub : ''); };

function cloudSection(scope) {
	const c = S.cloud?.scope === scope ? S.cloud : null, d = c?.data;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const api = CLOUD_API[scope], st = d.status;
	const head = scope === 'admin' ? html`<h2 class="gh">CLOUD-SYNC <span>${st.installed ? 'rclone ' + (st.version || '') : 'rclone not installed'}</span></h2>` : html`<h2 class="gh">MY CLOUD <span>own accounts and jobs</span></h2>`;
	if (!st.installed) {
		return html`<section class="sec">${head}<div class="panel"><div class="empty">${svg(I.cloud)}<div>
			${scope === 'admin' ? html`<span>Cloud sync uses <b>rclone</b> (Nextcloud, WebDAV, S3, SFTP, Google Drive, OneDrive, Dropbox and more). The program (about 20 MB) goes into the apps area on the disk${st.apps ? ` (${st.apps})` : ''}.</span>
				${st.installing ? html`<div style="margin-top:12px;display:flex;gap:10px;align-items:center"><div class="spin" style="margin:0;width:18px;height:18px"></div><span>downloading and checking …</span></div>`
				: html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="cl-install" ${st.apps ? '' : 'disabled'}>Install rclone</button></div>`}
				${st.install_error ? html`<p class="note" style="color:var(--red)">Error: ${st.install_error}</p>` : ''}
				${st.apps ? '' : html`<p class="note">First, under <a href="#/storage">Storage</a> set up a drive.</p>`}`
			: html`<span>Cloud sync is not set up on this box yet – please ask the administrator.</span>`}
		</div></div></div></section>`;
	}
	const re = c.remoteEdit, je = c.jobEdit;
	return html`<section class="sec">${head}
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">ACCOUNTS</span><span class="tag ml">${d.remotes.length}</span></div>
				${d.remotes.length ? html`<div class="tw"><table class="t"><thead><tr><th>NAME</th><th>TYPE</th><th></th></tr></thead>
					<tbody>${d.remotes.map((r) => html`<tr><td><b>${r.name}</b></td><td class="mut">${r.type}</td>
						<td><div class="acts">${api.testRemote ? html`<button class="btn sm" type="button" data-act="cl-rtest" data-scope="${scope}" data-name="${r.name}">Test</button>` : ''}
							<button class="btn sm ghost" type="button" data-act="cl-rdel" data-scope="${scope}" data-name="${r.name}">Remove</button></div></td></tr>`)}</tbody></table></div>`
					: html`<p class="mut" style="margin:0;font-size:13px">No cloud account yet.</p>`}
				${re ? '' : html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="cl-rnew" data-scope="${scope}">Add account</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Credentials stay on the box, readable for root only (passwords obscured by rclone, not encrypted).</span> <span>For Google Drive, OneDrive, Dropbox and similar services you sign in in the browser; for other services paste the finished section from “rclone config”.</span> <span>Jobs run with little memory (2 transfers at a time); a bandwidth limit like</span> <code>2M</code> <span>keeps the network free.</span>${scope === 'me' ? html` <span>Your credentials are kept in your personal folder; what you download counts towards your storage limit.</span>` : ''}</p>
			</div>
		</div>
		${re ? remoteEditor(scope, re) : ''}
	</section>
	${je ? jobEditor(scope, d, je) : ''}
	<section class="sec">
		${secHead('cloudjobs-' + scope, 'JOBS', d.jobs.length ? d.jobs.length + ' set up' : 'none yet')}
		${!d.jobs.length ? html`<div class="panel"><div class="empty">${svg(I.cloud)}<span>No job yet. A job copies or mirrors a folder with a cloud account – by hand or on a schedule.</span></div></div>`
			: isTable('cloudjobs-' + scope) ? html`<div class="tw"><table class="t" style="min-width:860px"><thead><tr><th>JOB</th><th>FROM → TO</th><th>SCHEDULE</th><th>LOAD</th><th></th></tr></thead>
				<tbody>${d.jobs.map((j) => html`<tr><td><b>${j.name}</b><div class="mut" style="font-size:12px">${scope === 'admin' ? (j.owner ? 'owner: ' + j.owner : 'System') : ''}</div></td>
					<td style="font-size:12px">${jobRoute(d, j)}</td><td class="mut">${schedTxt(j.schedule)}${j.enabled ? '' : ' · off'}</td><td>${jobState(j)}</td>
					<td><div class="acts">${jobActions(scope, j)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.jobs.map((j) => html`<div class="card${j.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.cloud)}<span class="dot ${j.state === 'error' ? 'down' : j.state === 'running' ? 'warn' : j.state === 'ok' && j.enabled ? 'up' : ''}"></span></div>
				<div class="info"><div class="name">${j.name}</div>
					<div class="desc" style="font-size:12px">${jobRoute(d, j)}</div>
					<div class="desc" style="margin-top:6px">${schedTxt(j.schedule)}${scope === 'admin' && j.owner ? html` · <span>${'owner: ' + j.owner}</span>` : ''}</div>
					<div class="desc" style="margin-top:6px">${jobState(j)}</div>
					${j.state === 'error' && j.error ? html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--red)">${j.error}</div>` : j.summary ? html`<div class="desc mut" style="margin-top:4px;font-size:12px">${j.summary}</div>` : ''}
					<div class="acts" style="margin-top:12px">${jobActions(scope, j)}</div></div></div>`)}</div>`}
		${!je && d.remotes.length ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="cl-jnew" data-scope="${scope}">New job</button></div>` : ''}
	</section>
	${c.log ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">LOG · ${c.log.name}</span><button class="btn sm ghost ml" type="button" data-act="cl-logclose" data-scope="${scope}">Close</button></div>
		<pre class="logbox">${c.log.lines.join('\n') || '(empty)'}</pre></div></section>` : ''}`;
}

function jobRoute(d, j) {
	const local = localTxt(d, j.local), remote = `${j.remote}:${j.remote_path || '/'}`;
	return j.mode === 'download' || j.mode === 'mirror_down' ? html`${remote} → ${local}` : html`${local} → ${remote}`;
}

function jobActions(scope, j) {
	const api = CLOUD_API[scope];
	return html`${j.state === 'running' ? (api.stopJob ? html`<button class="btn sm danger" type="button" data-act="cl-jstop" data-scope="${scope}" data-name="${j.name}">Stop</button>` : '')
		: html`<button class="btn sm" type="button" data-act="cl-jrun" data-scope="${scope}" data-name="${j.name}">Start now</button>`}
		<button class="btn sm" type="button" data-act="cl-jedit" data-scope="${scope}" data-name="${j.name}">Edit</button>
		${api.log ? html`<button class="btn sm" type="button" data-act="cl-jlog" data-scope="${scope}" data-name="${j.name}">Log</button>` : ''}
		<button class="btn sm ghost" type="button" data-act="cl-jdel" data-scope="${scope}" data-name="${j.name}">Remove</button>`;
}

function remoteEditor(scope, re) {
	const fields = REMOTE_FIELDS[re.type] || [];
	return html`<form class="panel" id="f-remote" data-scope="${scope}" style="margin-top:16px;border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">NEW CLOUD ACCOUNT</span><button class="btn sm ghost ml" type="button" data-act="cl-rcancel" data-scope="${scope}">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${re.name || ''}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required placeholder="nextcloud"></label>
			<label class="f"><span>TYPE</span><select name="type" id="remote-type">${Object.entries(REMOTE_TYPES).map(([k, t]) => html`<option value="${k}"${re.type === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			${fields.map(([k, label, extra]) => html`<label class="f"><span>${label}</span>${Array.isArray(extra)
				? html`<select name="p_${k}">${extra.map((o) => html`<option>${o}</option>`)}</select>`
				: html`<input name="p_${k}" type="${extra === 'password' ? 'password' : 'text'}" autocomplete="off"${extra && extra !== 'password' ? raw(` placeholder="${esc(extra)}"`) : ''}>`}</label>`)}
		</div>
		${REMOTE_OAUTH[re.type] ? html`<div style="margin-top:12px">
			<p class="note" style="margin-top:0">For ${REMOTE_TYPES[re.type]} you sign in in the browser; the box only stores an access token, no password.</p>
			<div class="acts"><button class="btn" type="button" data-act="cl-auth" data-scope="${scope}">1. Sign in at ${REMOTE_TYPES[re.type]} ↗</button>${re.authed ? html`<span class="tag ok">signed in ✓</span>` : ''}</div>
			${re.authUrl && !re.authed ? html`<p class="note">After signing in, the browser shows “page not reachable” with an address like <code>http://127.0.0.1:53682/?state=…&amp;code=…</code>. Copy this whole address from the address bar and paste it here:</p>
			<div class="fields" style="grid-template-columns:1fr auto;align-items:end"><label class="f"><span>2. ADDRESS AFTER SIGNING IN</span><input name="auth_url" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:53682/?state=…"></label>
			<button class="btn" type="button" data-act="cl-authfin" data-scope="${scope}">Apply</button></div>` : ''}
		</div>` : ''}
		${re.type === 'raw' ? html`<label class="f" style="margin-top:12px"><span>SECTION FROM RCLONE.CONF (STARTS WITH [NAME])</span>
			<textarea name="raw" rows="8" spellcheck="false" data-i18n-skip style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" placeholder="[gdrive]&#10;type = drive&#10;token = {...}"></textarea></label>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Add</button></div>
	</form>`;
}

function jobEditor(scope, d, je) {
	const x = je.data, custom = x.schedule && !CLOUD_SCHED.some(([v]) => v === x.schedule);
	return html`<section class="sec"><form class="panel" id="f-job" data-scope="${scope}" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${je.mode === 'new' ? 'NEW JOB' : 'JOB ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="cl-jcancel" data-scope="${scope}">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required${je.mode === 'new' ? '' : raw(' readonly')}></label>
			<label class="f"><span>FOLDER ON THE NAS</span><select name="local">${d.locals.map(([v, t]) => html`<option value="${v}"${localSplit(x.local)[0] === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>SUBFOLDER (OPTIONAL)</span><div class="fb-row"><input name="sub" value="${localSplit(x.local)[1]}" maxlength="200"><button class="btn sm" type="button" data-act="cl-browse" data-scope="${scope}">Browse …</button></div></label>
			<label class="f"><span>CLOUD ACCOUNT</span><select name="remote">${d.remotes.map((r) => html`<option value="${r.name}"${x.remote === r.name ? raw(' selected') : ''}>${r.name}</option>`)}</select></label>
			<label class="f"><span>FOLDER IN THE CLOUD</span><input name="remote_path" value="${x.remote_path}" placeholder="Backup/NAS"></label>
		</div>
		<div class="pt" style="margin:16px 0 8px">DIRECTION</div>
		<div style="display:grid;gap:6px">${Object.entries(CLOUD_MODES).map(([k, t]) => html`<label class="chk"><input type="radio" name="mode" value="${k}"${x.mode === k ? raw(' checked') : ''} style="accent-color:var(--accent)">${t}</label>`)}</div>
		<div class="fields" style="margin-top:14px">
			<label class="f"><span>SCHEDULE</span><select name="sched" id="job-sched">${CLOUD_SCHED.map(([v, t]) => html`<option value="${v}"${(custom ? 'custom' : x.schedule) === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f" id="job-cron"${custom ? '' : raw(' hidden')}><span>CRON TIME (MIN HOUR DAY MON WEEKDAY)</span><input name="cron" value="${custom ? x.schedule : ''}" placeholder="0 4 * * 1-5"></label>
			<label class="f"><span>BANDWIDTH (EMPTY = UNLIMITED)</span><input name="bwlimit" value="${x.bwlimit}" placeholder="2M"></label>
		</div>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>Schedule active</label>
		<p class="note">Mirroring deletes on the target side what is missing on the source side – for plain backups choose “Upload”.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function cloudAfter(scope) {
	$('#remote-type')?.addEventListener('change', (e) => {
		const f = $('#f-remote');
		S.cloud.remoteEdit = { name: f.name.value, type: e.target.value };
		scope === 'admin' ? renderMain() : renderUserMain();
	});
	$('#job-sched')?.addEventListener('change', (e) => { $('#job-cron').hidden = e.target.value !== 'custom'; });
	$('#f-remote')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, type = f.type.value, params = {};
		if (REMOTE_OAUTH[type] && !S.cloud.remoteEdit?.authed) { toast('Sign in first (step 1 and 2).', true); return; }
		(REMOTE_FIELDS[type] || []).forEach(([k]) => { const v = f['p_' + k]?.value.trim(); if (v) params[k] = v; });
		try {
			await CLOUD_API[scope].addRemote({ name: f.name.value.trim(), type, params, raw: type === 'raw' ? f.raw.value.trim() + '\n' : '' });
			S.cloud.remoteEdit = null; toast(`Account “${f.name.value.trim()}” added.`); loadCloud(scope);
		} catch (err) { toast('Account: ' + err.message, true); }
	});
	$('#f-job')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, sched = f.sched.value === 'custom' ? f.cron.value.trim() : f.sched.value;
		const sub = f.sub.value.trim().replace(/^\/+|\/+$/g, '');
		const local = !sub ? f.local.value : f.local.value === 'home' ? 'home:' + sub : f.local.value + '/' + sub;
		const args = { name: f.name.value.trim(), local, remote: f.remote.value, remote_path: f.remote_path.value.trim(),
			mode: $('input[name=mode]:checked', f)?.value || 'upload', schedule: sched, bwlimit: f.bwlimit.value.trim(), enabled: f.enabled.checked };
		if ((args.mode === 'mirror_down' || args.mode === 'mirror_up') && !await confirmDlg('Mirror?', args.mode === 'mirror_down'
			? 'Mirroring from the cloud deletes files on the NAS that are missing in the cloud.' : 'Mirroring to the cloud deletes files in the cloud that are missing on the NAS.', 'Understood', true)) return;
		try { await CLOUD_API[scope].saveJob(args); S.cloud.jobEdit = null; toast(`Job “${args.name}” saved.`); loadCloud(scope); }
		catch (err) { toast('Job: ' + err.message, true); }
	});
}

/* ---------- media server (Services -> Media server, MiniDLNA) ------------------- */

const DLNA_TYPES = [['', 'do not share'], ['-', 'music, videos and pictures'], ['A', 'music only'], ['V', 'videos only'], ['P', 'pictures only']];

async function loadDlna() {
	clearTimeout(S.dlnaTimer);
	try { S.dlna = await rpc('shareos.dlna', 'status'); } catch (e) { toast('Media server: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'dlna') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		if (S.dlna?.running) S.dlnaTimer = setTimeout(loadDlna, S.dlna.scanning ? 4000 : 15000);
	}
}

function dlnaView() {
	const d = S.dlna;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading media server …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>The media server (MiniDLNA) is a system app: TVs, receivers, game consoles and apps like VLC then find the box in the network and play music, videos and pictures from the shares.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Install from the store (MiniDLNA)</a></div></div></div></div></section>`;
	const media = {};
	d.media.forEach((m) => { if (!m.path) media[m.share] = m.type; });
	const subs = S.dlnaSubs || (S.dlnaSubs = d.media.filter((m) => m.path).map((m) => ({ ...m })));
	const host = location.hostname;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">MEDIA SERVER</span>${d.running ? html`<span class="tag ok ml">running</span>` : html`<span class="tag ml">off</span>`}${d.scanning ? html` <span class="tag">reading folders …</span>` : ''}</div>
				${d.running ? html`<div class="tiles" style="margin:0">
					<div class="tile"><div class="k">TRACKS</div><div class="v">${d.audio ?? '–'}</div></div>
					<div class="tile"><div class="k">VIDEOS</div><div class="v">${d.video ?? '–'}</div></div>
					<div class="tile"><div class="k">PICTURES</div><div class="v">${d.image ?? '–'}</div></div></div>
					<p class="note"><span>In the network as</span> <b>${d.name || d.hostname}</b> · <code>http://${host}:8200/</code></p>
					${d.clients.length ? html`<div class="pt" style="margin:12px 0 6px">DEVICES</div><div style="display:grid;gap:4px;font-size:13px">${d.clients.map((c) => html`<div>${c.type} <span class="mut">· ${c.ip}</span></div>`)}</div>` : ''}
					<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="dlna-rescan" ${d.scanning ? 'disabled' : ''}>Read everything again</button></div>`
				: html`<p class="mut" style="margin:0;font-size:13px">The media server is switched off. Choose folders below and switch it on.</p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Devices in the same network find the server by themselves (DLNA/UPnP AV), e.g. under “Media server” or “Sources” on the TV.</span> <span>New files show up by themselves after a short while; after big changes “Read everything again” helps.</span> <span>The server only reads – and shows everything in the chosen shares to every device in the network, without sign-in.</span> <span>Videos are not converted: the device must be able to play the format itself.</span></p>
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-dlna" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Media server switched on (also starts after a restart)</label>
		<div class="fields" style="margin-top:12px"><label class="f"><span>NAME IN THE NETWORK</span><input name="name" value="${d.name}" maxlength="48" placeholder="${d.hostname}"></label></div>
		<div class="pt" style="margin:16px 0 8px">SHARES</div>
		${d.shares.length ? html`<div class="tw"><table class="t"><thead><tr><th>SHARE</th><th>SHOW AS</th></tr></thead><tbody>
			${d.shares.map((n) => html`<tr><td><b>${n}</b></td><td><select class="dlna-type" data-share="${n}">${DLNA_TYPES.map(([v, t]) => html`<option value="${v}"${(media[n] || '') === v ? raw(' selected') : ''}>${t}</option>`)}</select></td></tr>`)}</tbody></table></div>`
			: html`<p class="note">No share yet – create one under <a href="#/shares/shares">Shares</a> .</p>`}
		${d.shares.length ? html`<div class="pt" style="margin:16px 0 8px">SUBFOLDERS</div>
		<p class="mut" style="margin:0 0 8px;font-size:13px">Single folders from a share – no extra share needed.</p>
		${subs.length ? html`<div class="tw"><table class="t"><thead><tr><th>FOLDER</th><th>SHOW AS</th><th></th></tr></thead><tbody>
			${subs.map((m, i) => html`<tr><td data-i18n-skip><b>${m.share}</b>/${m.path}</td><td><select class="dlna-sub-type" data-i="${i}">${DLNA_TYPES.filter(([v]) => v).map(([v, t]) => html`<option value="${v}"${m.type === v ? raw(' selected') : ''}>${t}</option>`)}</select></td>
				<td><button class="btn sm ghost" type="button" data-act="dlna-subdel" data-i="${i}">Remove</button></td></tr>`)}</tbody></table></div>` : ''}
		<div class="acts" style="margin-top:10px"><button class="btn" type="button" data-act="dlna-subadd">Add subfolder</button></div>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

/* ---------- snapshots (Storage -> Snapshots) ------------------------------------ */

const SNAP_EVERY = { hour: 'Hourly', '6h': 'Every 6 hours', day: 'Daily', week: 'Weekly (Sunday)' };
const SNAP_KEEP = [['keep_last', 'THE LAST'], ['keep_daily', 'DAYS (ONE EACH)'], ['keep_weekly', 'WEEKS (ONE EACH)'], ['keep_monthly', 'MONTHS (ONE EACH)']];

async function loadSnapshots() {
	clearTimeout(S.snapTimer);
	S.snap = S.snap || {};
	try { S.snap.data = await rpc('shareos.snapshots', 'status'); }
	catch (e) { toast('Snapshots: ' + e.message, true); }
	if (S.route.tab === 'storage' && S.route.sub === 'snapshots') {
		if (!document.activeElement?.matches('input,select,textarea')) renderMain();
		if (S.snap.data?.jobs?.some((j) => j.running)) S.snapTimer = setTimeout(loadSnapshots, 3000);
	}
}

function snapSourceTxt(d, id) {
	const x = (d.sources || []).find((s) => s.id === id);
	if (!x) return id || '–';
	return x.kind === 'share' ? `Share ${x.name}` : x.kind === 'homes' ? `Personal folders (${x.name})` : `Whole drive ${x.name}`;
}
const snapSrcVol = (d, id) => { const x = (d.sources || []).find((s) => s.id === id); return x ? (x.volume || x.name) : null; };
const snapEveryTxt = (j) => (SNAP_EVERY[j.every] || j.every) + (j.every === 'day' || j.every === 'week' ? ' ' + j.time : '');
function snapKeepTxt(j) {
	const p = [];
	if (j.keep_last) p.push(`the last ${j.keep_last}`);
	if (j.keep_daily) p.push(`${j.keep_daily} days`);
	if (j.keep_weekly) p.push(`${j.keep_weekly} weeks`);
	if (j.keep_monthly) p.push(`${j.keep_monthly} months`);
	// one span each: the translation sees the parts
	return p.map((x, i) => html`${i ? ' · ' : ''}<span>${x}</span>`);
}
function snapState(j) {
	const l = j.last;
	if (j.running) return html`<span class="tag">running</span>`;
	if (!l) return html`<span class="mut">never</span>`;
	if (l.state === 'ok') return html`<span class="tag ok">OK</span> <span class="mut">${fmtTime(l.ended)}</span>`;
	if (l.state === 'stopped') return html`<span class="tag warn">stopped</span> <span class="mut">${fmtTime(l.ended)}</span>`;
	return html`<span class="tag err">Error</span> <span class="mut">${fmtTime(l.ended)}</span>`;
}
function snapSummary(j) {
	const l = j.last;
	if (!l || j.running) return '';
	if (l.state === 'error') return html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--red)">${l.error || ''}</div>`;
	if (l.state !== 'ok') return '';
	return html`<div class="desc mut" style="margin-top:4px;font-size:12px"><span>${l.files} files</span> · <span>${l.changed} changed</span> (${fmtBytes(l.bytes)})${l.removed ? html` · <span>${l.removed} old ones removed</span>` : ''}</div>
		${l.warning ? html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--amber)">${l.warning}</div>` : ''}`;
}
function snapActions(j) {
	return html`${j.running ? html`<button class="btn sm danger" type="button" data-act="sn-stop" data-name="${j.name}">Stop</button>`
		: html`<button class="btn sm primary" type="button" data-act="sn-run" data-name="${j.name}">Back up now</button>`}
		<button class="btn sm" type="button" data-act="sn-list" data-name="${j.name}">Snapshots (${j.snapshots.length})</button>
		<button class="btn sm" type="button" data-act="sn-edit" data-name="${j.name}">Edit</button>
		<button class="btn sm" type="button" data-act="sn-log" data-name="${j.name}">Log</button>
		<button class="btn sm ghost" type="button" data-act="sn-del" data-name="${j.name}">Remove</button>`;
}

function snapshotsView() {
	const sn = S.snap || {}, d = sn.data;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading snapshots …</span></div></div>`;
	const ed = sn.edit, open = sn.open && d.jobs.find((j) => j.name === sn.open);
	const targets = d.volumes.filter((v) => v.links);
	return html`
	<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SNAPSHOTS</span><span class="tag ml">${d.jobs.length ? d.jobs.length + ' jobs' : 'none yet'}</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>A snapshot keeps the state of a folder – hourly, daily or weekly.</span> <span>Each state looks like a full copy, but unchanged files take no extra space.</span> <span>To get back a file deleted or overwritten yesterday or last week, copy it back from the snapshot in the file browser.</span></p>
				${!d.rsync ? html`<p class="note" style="color:var(--amber)">rsync is missing in this firmware.</p>` : ''}
				${!targets.length ? html`<p class="note" style="color:var(--amber)">No suitable target: snapshots need a drive with ext4 or Btrfs (FAT32/exFAT have no hard links). <a href="#/storage/volumes">Set up storage</a></p>` : ''}
				${ed || !targets.length || !d.sources.length ? '' : html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="sn-new">New snapshot job</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Best save to another drive (second disk or USB disk): then snapshots also protect against a failing disk.</span> <span>A mirror (RAID 1) does not replace snapshots – it mirrors every deletion at once.</span> <span>The snapshots are in the folder</span> <code>Snapshots</code> <span>of the target drive and are visible to administrators only.</span> <span>For an off-site copy, a cloud job can upload the snapshot folder.</span></p>
			</div>
		</div>
	</section>
	${ed ? snapEditor(d, ed) : ''}
	<section class="sec">
		${secHead('snapjobs', 'JOBS', d.jobs.length ? d.jobs.length + ' set up' : 'none yet')}
		${!d.jobs.length ? html`<div class="panel"><div class="empty">${svg(I.disk)}<span>No snapshot job yet. A job saves a share, the personal folders or a whole drive on a schedule.</span></div></div>`
			: isTable('snapjobs') ? html`<div class="tw"><table class="t" style="min-width:900px"><thead><tr><th>JOB</th><th>SOURCE → TARGET</th><th>SCHEDULE · KEEP</th><th>LOAD</th><th></th></tr></thead>
				<tbody>${d.jobs.map((j) => html`<tr><td><b>${j.name}</b><div class="mut" style="font-size:12px">${j.snapshots.length} Snapshots</div></td>
					<td style="font-size:12px">${snapSourceTxt(d, j.source)} → ${j.target}</td>
					<td style="font-size:12px">${snapEveryTxt(j)}${j.enabled ? '' : ' · off'}<div class="mut">${snapKeepTxt(j)}</div></td>
					<td>${snapState(j)}${snapSummary(j)}</td><td><div class="acts">${snapActions(j)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.jobs.map((j) => html`<div class="card${j.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.disk)}<span class="dot ${j.last?.state === 'error' ? 'down' : j.running || j.last?.warning ? 'warn' : j.last?.state === 'ok' && j.enabled ? 'up' : ''}"></span></div>
				<div class="info"><div class="name">${j.name}</div>
					<div class="desc" style="font-size:12px">${snapSourceTxt(d, j.source)} → ${j.target}</div>
					<div class="desc" style="margin-top:6px">${snapEveryTxt(j)}${j.enabled ? '' : html` · <span>off</span>`}</div>
					<div class="desc mut" style="font-size:12px">${snapKeepTxt(j)}</div>
					<div class="desc" style="margin-top:6px">${snapState(j)}</div>${snapSummary(j)}
					<div class="desc mut" style="margin-top:4px;font-size:12px"><span>${j.snapshots.length} Snapshots</span>${j.snapshots[0] ? html` · <span>newest</span> ${fmtTime(j.snapshots[0].time)}` : ''}</div>
					<div class="acts" style="margin-top:12px">${snapActions(j)}</div></div></div>`)}</div>`}
	</section>
	${open ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">SNAPSHOTS · ${open.name}</span><button class="btn sm ghost ml" type="button" data-act="sn-listclose">Close</button></div>
		${!open.mounted ? html`<p class="note" style="color:var(--amber)">The target drive ${open.target} is not mounted.</p>` : ''}
		${open.snapshots.length ? html`<div class="tw"><table class="t"><thead><tr><th>STATE</th><th>FOLDER</th><th></th></tr></thead><tbody>
			${open.snapshots.map((x) => html`<tr><td><b>${fmtTime(x.time)}</b></td><td class="mut" style="font-size:12px">${open.target}/Snapshots/${open.name}/${x.name}</td>
				<td><div class="acts"><button class="btn sm" type="button" data-act="sn-browse" data-name="${open.name}" data-snap="${x.name}">Open in the file browser</button>
				<button class="btn sm ghost" type="button" data-act="sn-rm" data-name="${open.name}" data-snap="${x.name}">Delete</button></div></td></tr>`)}</tbody></table></div>`
			: html`<p class="mut" style="margin:0;font-size:13px">No snapshot yet – “Back up now” takes the first one.</p>`}
		<p class="note">To restore, copy the file or folder from the snapshot back to its old place in the file browser. Do not change files inside a snapshot: unchanged files share their space with the other snapshots.</p>
	</div></section>` : ''}
	${sn.log ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">LOG · ${sn.log.name}</span><button class="btn sm ghost ml" type="button" data-act="sn-logclose">Close</button></div>
		<pre class="logbox" style="max-height:360px">${sn.log.text || '(empty)'}</pre></div></section>` : ''}`;
}

function snapEditor(d, ed) {
	const x = ed.data, srcVol = snapSrcVol(d, x.source);
	const label = (s) => s.kind === 'share' ? `Share ${s.name}` : s.kind === 'homes' ? `Personal folders (${s.name})` : `Whole drive ${s.name}`;
	return html`<section class="sec"><form class="panel" id="f-snap" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${ed.mode === 'new' ? 'NEW SNAPSHOT JOB' : 'JOB ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="sn-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required placeholder="photos"${ed.mode === 'new' ? '' : raw(' readonly')}></label>
			<label class="f"><span>WHAT TO SAVE</span><select name="source" id="snap-src">${d.sources.map((s) => html`<option value="${s.id}"${x.source === s.id ? raw(' selected') : ''}>${label(s)}</option>`)}</select></label>
			<label class="f"><span>TARGET DRIVE</span><select name="target" id="snap-tgt">${d.volumes.map((v) => html`<option value="${v.name}"${x.target === v.name ? raw(' selected') : ''}${v.links ? '' : raw(' disabled')}>${v.name} (${v.fstype})${v.links ? '' : ' – no hard links'}</option>`)}</select></label>
			<label class="f"><span>HOW OFTEN</span><select name="every" id="snap-every">${Object.entries(SNAP_EVERY).map(([k, t]) => html`<option value="${k}"${x.every === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>${x.every === 'hour' ? 'MINUTE (HH:MM, ONLY THE MINUTE COUNTS)' : x.every === '6h' ? 'FROM' : 'TIME'}</span><input name="time" type="time" value="${x.time}" required></label>
		</div>
		${srcVol && srcVol === x.target ? html`<p class="note" style="color:var(--amber)">Source and target are on the same drive: this protects against accidental deletion, not against a failing disk.</p>` : ''}
		<div class="pt" style="margin:16px 0 8px">KEEP</div>
		<div class="fields">${SNAP_KEEP.map(([k, t]) => html`<label class="f"><span>${t}</span><input name="${k}" type="number" min="0" max="999" value="${x[k]}"></label>`)}</div>
		<p class="note">The last N snapshots always stay (also those taken by hand); plus the newest of each day, week and month. Example daily: 7 days · 4 weeks · 6 months ≈ half a year back with 17 states.</p>
		<label class="f" style="margin-top:12px"><span>EXCLUSIONS (ONE PER LINE, E.G. *.tmp OR /Downloads/)</span>
			<textarea name="exclude" rows="3" spellcheck="false" data-i18n-skip style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px">${(x.exclude || []).join('\n')}</textarea></label>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>Schedule active</label>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function dlnaAfter() {
	if (!S.dlna) { loadDlna(); return; }
	document.querySelectorAll('.dlna-sub-type').forEach((x) => x.addEventListener('change', () => { S.dlnaSubs[+x.dataset.i].type = x.value; }));
	$('#f-dlna')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, media = [];
		document.querySelectorAll('.dlna-type').forEach((x) => { if (x.value) media.push({ share: x.dataset.share, type: x.value }); });
		(S.dlnaSubs || []).forEach((m) => media.push({ share: m.share, path: m.path, type: m.type }));
		if (f.enabled.checked && !media.length) { toast('Choose at least one share.', true); return; }
		const b = $('button[type=submit]', f); b.disabled = true;
		try { S.dlna = await rpc('shareos.dlna', 'set', { enabled: f.enabled.checked, name: f.name.value.trim(), media }); S.dlnaSubs = null; toast('Media server saved.'); }
		catch (err) { toast('Media server: ' + err.message, true); }
		loadDlna();
	});
}

/* ---------- printers (Services -> Printers, system app "printer") ------------------- */

async function loadPrinter() {
	clearTimeout(S.prnTimer);
	try { S.prn = await rpc('shareos.printer', 'status'); } catch (e) { toast('Printer: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'printer') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		// printers come and go: look again now and then
		S.prnTimer = setTimeout(loadPrinter, 10000);
	}
}

function printerView() {
	const d = S.prn;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading printers …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>Printers in the network are a system app: current printers and multifunction devices then print and scan without drivers (AirPrint, Mopria, Windows 10/11), older ones over port 9100 with the driver on the computer.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Install from the store (ipp-usb + p910nd)</a></div></div></div></div></section>`;
	const host = location.hostname;
	const card = (p) => html`<div class="panel">
		<div class="ph"><span class="pt">${(p.maker + ' ' + p.model).trim() || p.id}</span>${p.port ? html`<span class="tag ok ml">in the network</span>` : d.enabled ? html`<span class="tag warn ml">not reachable</span>` : html`<span class="tag ml">off</span>`}</div>
		<dl class="kv">
			<dt>Type</dt><dd>${p.via === 'ipp-usb' ? 'Without driver (IPP over USB)' : 'With the driver on the computer (port 9100)'}</dd>
			${p.via === 'ipp-usb' ? html`<dt>Scanning</dt><dd>${p.port ? 'over the network (eSCL), if the device has a scanner' : '–'}</dd>` : ''}
			<dt>Address</dt><dd>${p.port ? (p.via === 'ipp-usb' ? `ipp://${host}:${p.port}/ipp/print` : `${host}:${p.port}`) : '–'}</dd>
			${p.port && p.via === 'ipp-usb' ? html`<dt>Device page</dt><dd><a href="http://${host}:${p.port}/" target="_blank" rel="noopener">http://${host}:${p.port}/</a></dd>` : ''}
			<dt>USB</dt><dd>${p.id}${p.lp ? ' · ' + p.lp : ''}</dd>
		</dl>
		${p.port && p.via === 'ipp-usb' ? html`<p class="note">Windows 10/11, macOS, iPhone/iPad and Android find the printer by themselves (“Add printer”). By hand: enter the address above as an IPP printer.</p>`
		: p.port ? html`<p class="note">Windows: “Add printer” → “TCP/IP address” → <b>${host}</b>, port <b>${p.port}</b>, the maker's driver. macOS/Linux: “HP JetDirect – Socket” or AppSocket.</p>
			<div class="acts" style="margin-top:10px"><button class="btn" type="button" data-act="prn-test" data-id="${p.lp}">Test page</button></div>` : ''}
	</div>`;
	return html`<section class="sec">
		${d.printers.length ? html`<div class="g2">${d.printers.map(card)}</div>`
		: html`<div class="panel"><div class="empty">${svg(I.info)}<span>No USB printer connected. Plug one in – it shows up here after a few seconds.</span></div></div>`}
	</section>
	<section class="sec"><form class="panel" id="f-prn" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span>${d.enabled ? html`<span class="tag ok ml">on</span>` : html`<span class="tag ml">off</span>`}</div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Share printers in the network (also starts after a restart)</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>TYPE</span><select name="mode">
			<option value="auto"${d.mode === 'auto' ? raw(' selected') : ''}>Automatic – without driver where the printer can</option>
			<option value="raw"${d.mode === 'raw' ? raw(' selected') : ''}>Always port 9100 (driver on the computer)</option></select></label></div>
		<p class="note">Everyone in the network can print, without signing in. “Always port 9100” only if a printer does not print properly without a driver.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function printerAfter() {
	if (!S.prn) { loadPrinter(); return; }
	if (!S.prnTimer) S.prnTimer = setTimeout(loadPrinter, 10000);
	$('#f-prn')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, b = $('button[type=submit]', f); b.disabled = true;
		try { S.prn = await rpc('shareos.printer', 'set', { enabled: f.enabled.checked, mode: f.mode.value }); toast('Printers saved.'); }
		catch (err) { toast('Printer: ' + err.message, true); }
		loadPrinter();
	});
}

/* ---------- UPS (Services -> UPS, system app "nut") ------------------- */

const UPS_EVENTS = { ONBATT: 'Power failure – running on the UPS', ONLINE: 'Power is back', LOWBATT: 'Battery almost empty', FSD: 'Shutdown triggered', SHUTDOWN: 'Box shuts down', COMMBAD: 'Connection to the UPS lost', NOCOMM: 'No connection to the UPS', COMMOK: 'Connection to the UPS is back', REPLBATT: 'Replace the battery' };

async function loadUps() {
	clearTimeout(S.upsTimer);
	try { S.ups = await rpc('shareos.ups', 'status'); } catch (e) { toast('UPS: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'ups') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		S.upsTimer = setTimeout(loadUps, S.ups?.running ? 5000 : 15000);
	}
}

function upsView() {
	const d = S.ups;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading UPS …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>UPS support is a system app: the box then shows charge and runtime, reports a power failure and shuts down cleanly in time.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Install from the store (Network UPS Tools)</a></div></div></div></div></section>`;
	const st = (d.status || '').split(' ');
	const ob = st.includes('OB'), lb = st.includes('LB');
	const s = d.settings, mode = s.shutdown;
	const host = location.hostname;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">UPS</span>${!d.running ? html`<span class="tag ml">off</span>` : lb ? html`<span class="tag err ml">Battery almost empty</span>` : ob ? html`<span class="tag warn ml">on battery</span>` : st.includes('OL') ? html`<span class="tag ok ml">on mains</span>` : d.status ? html`<span class="tag warn ml" data-i18n-skip title="ups.status">${d.status}</span>` : html`<span class="tag warn ml">no data</span>`}</div>
				${d.running && d.status ? html`<div class="tiles" style="margin:0">
					<div class="tile"><div class="k">BATTERY</div><div class="v">${d.charge != null ? d.charge + ' %' : '–'}</div></div>
					<div class="tile"><div class="k">RUNTIME</div><div class="v">${d.runtime != null ? Math.round(d.runtime / 60) + ' min' : '–'}</div></div>
					<div class="tile"><div class="k">LOAD</div><div class="v">${d.load != null ? d.load + ' %' : '–'}</div></div></div>
					<dl class="kv" style="margin-top:12px">
						<dt>Device</dt><dd>${[d.mfr, d.model].filter(Boolean).join(' ') || '–'}</dd>
						${d.voltage != null ? html`<dt>Mains voltage</dt><dd>${d.voltage} V</dd>` : ''}
						${d.battery_date ? html`<dt>Battery since</dt><dd>${d.battery_date}</dd>` : ''}
						<dt>Driver</dt><dd>${d.driver || '–'}</dd>
					</dl>`
				: d.running ? html`<p class="mut" style="margin:0;font-size:13px">Connecting to the UPS …</p>`
				: html`<p class="mut" style="margin:0;font-size:13px">${d.detected ? html`<span>Detected:</span> <code>${d.detected}</code>. ` : ''}<span>Switch it on below.</span></p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">EVENTS</span></div>
				${d.events.length ? html`<div style="display:grid;gap:6px;font-size:13px">${d.events.map((e) => html`<div><span class="mut">${fmtTime(e.time)}</span> · ${UPS_EVENTS[e.type] || e.type}</div>`)}</div>`
				: html`<p class="mut" style="margin:0;font-size:13px">None yet – a power failure is shown here and as a message.</p>`}
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-ups" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Monitor the UPS (also starts after a restart)</label>
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>SHUT DOWN</span><select name="shutdown" id="ups-mode">
				<option value="low"${mode === 'low' ? raw(' selected') : ''}>When the UPS reports “battery low”</option>
				<option value="percent"${mode === 'percent' ? raw(' selected') : ''}>Below a battery charge</option>
				<option value="minutes"${mode === 'minutes' ? raw(' selected') : ''}>After some time on battery</option></select></label>
			<label class="f" id="ups-pct"${mode === 'percent' ? '' : raw(' hidden')}><span>BATTERY CHARGE (%)</span><input name="percent" type="number" min="10" max="90" value="${s.percent}"></label>
			<label class="f" id="ups-min"${mode === 'minutes' ? '' : raw(' hidden')}><span>MINUTES ON BATTERY</span><input name="minutes" type="number" min="1" max="120" value="${s.minutes}"></label>
			<label class="f"><span>DRIVER</span><select name="driver">${[['auto', 'Automatic'], ['usbhid-ups', 'usbhid-ups (APC, Eaton, CyberPower …)'], ['nutdrv_qx', 'nutdrv_qx (Megatec/Q1)'], ['blazer_usb', 'blazer_usb (older Megatec)']].map(([v, t]) => html`<option value="${v}"${s.driver === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
		</div>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="killpower"${s.killpower ? raw(' checked') : ''}>Then switch the UPS off – the box starts again when the power is back</label>
		<label class="chk" style="margin-top:8px"><input type="checkbox" name="server" id="ups-server"${s.server ? raw(' checked') : ''}>Other computers may read the UPS over the network (port 3493)</label>
		<div class="fields" id="ups-net"${s.server ? '' : raw(' hidden')} style="margin-top:10px">
			<label class="f"><span>PASSWORD FOR “MONITOR”</span>${s.password_set ? html`<input name="password" type="password" placeholder="saved – leave empty to keep it" autocomplete="new-password">` : html`<input name="password" type="password" autocomplete="new-password">`}</label>
		</div>
		${s.server ? html`<p class="note"><span>On the other computer (NUT, upsmon):</span> <code data-i18n-skip>MONITOR ups@${host} 1 monitor ••• secondary</code> <span>– it then shuts down before the box.</span></p>` : ''}
		<p class="note">The box only shuts down while it runs on battery. If the power comes back before, nothing happens.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function upsAfter() {
	if (!S.ups) { loadUps(); return; }
	if (!S.upsTimer) S.upsTimer = setTimeout(loadUps, 5000);
	$('#ups-mode')?.addEventListener('change', (e) => { $('#ups-pct').hidden = e.target.value !== 'percent'; $('#ups-min').hidden = e.target.value !== 'minutes'; });
	$('#ups-server')?.addEventListener('change', (e) => { $('#ups-net').hidden = !e.target.checked; });
	$('#f-ups')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, b = $('button[type=submit]', f); b.disabled = true;
		const v = { enabled: f.enabled.checked, shutdown: f.shutdown.value, driver: f.driver.value, killpower: f.killpower.checked, server: f.server.checked, password: f.password.value };
		if (v.shutdown === 'percent') v.percent = +f.percent.value;
		if (v.shutdown === 'minutes') v.minutes = +f.minutes.value;
		try { S.ups = await rpc('shareos.ups', 'set', v); toast('UPS saved.'); }
		catch (err) { toast('UPS: ' + err.message, true); }
		loadUps();
	});
}

/* ---------- remote access for Transmission programs (Services -> Torrents) ---------- */

async function loadTremote() {
	try { S.tremote = await rpc('shareos.tremote', 'get'); } catch (e) { toast('Torrent remote access: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'torrent' && !document.activeElement?.matches('input')) renderMain();
}

function tremoteView() {
	const d = S.tremote;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>Torrents run on the system app Transmission: every user has their own service and controls it with the Transmission app. Here you can also switch on access for programs such as Transmission Remote GUI or Transmissionic.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Install from the store (Transmission)</a></div></div></div></div></section>`;
	const host = d.host || location.hostname;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">REMOTE ACCESS FOR TORRENT PROGRAMS</span>${d.running ? html`<span class="tag ok ml">running</span>` : html`<span class="tag ml">off</span>`}</div>
				${d.enabled ? html`<dl class="kv">
					<dt>Address</dt><dd data-i18n-skip><code>http://${host}:${d.port}${d.path}</code></dd>
					${d.https ? html`<dt>HTTPS</dt><dd data-i18n-skip><code>https://${host}:${d.https_port}${d.path}</code></dd>` : ''}
				</dl>` : html`<p class="mut" style="margin:0;font-size:13px">Switched off – torrents can only be controlled with the Transmission app.</p>`}
				<div class="pt" style="margin:14px 0 6px">USERS WITH A REMOTE PASSWORD</div>
				${d.accounts.length ? html`<div class="tw"><table class="t"><tbody>${d.accounts.map((u) => html`<tr><td data-i18n-skip><b>${u}</b></td>
					<td><div class="acts"><button class="btn sm ghost" type="button" data-act="tr-revoke" data-user="${u}">Revoke password</button></div></td></tr>`)}</tbody></table></div>`
				: html`<p class="mut" style="margin:0;font-size:13px">None yet – each user creates their password in the Transmission app.</p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Programs such as Transmission Remote GUI, Transmissionic or Tremotesf use it to control a user’s own Transmission service.</span> <span>Sign in with the user name and a separate remote password the user creates in the Transmission app – not with the box password.</span> <span>Only from the home network, also over VPN or Tailscale; access from the internet is blocked.</span> <span>After 5 wrong passwords, sign-in is blocked for 10 minutes.</span> <span>There is no separate web interface: in the browser, use the Transmission app.</span></p>
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-tremote" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Switch on remote access for torrent programs (also starts after a restart)</label>
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>PORT (HTTP)</span><input name="port" type="number" min="1024" max="65535" value="${d.port}"></label>
			<label class="f"><span>PORT (HTTPS)</span><input name="https_port" type="number" min="1024" max="65535" value="${d.https_port}"></label>
		</div>
		<p class="note">HTTPS is available while the web interface uses HTTPS (System → Network); the same certificate applies. Many programs expect port 9091.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function tremoteAfter() {
	if (!S.tremote) { loadTremote(); return; }
	$('#f-tremote')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, b = $('button[type=submit]', f); b.disabled = true;
		try {
			S.tremote = await rpc('shareos.tremote', 'set', { enabled: f.enabled.checked, port: +f.port.value, https_port: +f.https_port.value });
			toast('Torrent remote access saved.');
		} catch (err) { toast('Torrent remote access: ' + err.message, true); }
		renderMain();
	});
}

function snapForm() {
	const f = $('#f-snap');
	const keep = {};
	SNAP_KEEP.forEach(([k]) => { keep[k] = +f[k].value || 0; });
	return { name: f.name.value.trim(), source: f.source.value, target: f.target.value, every: f.every.value, time: f.time.value || '03:15',
		...keep, exclude: f.exclude.value.split('\n').map((l) => l.trim()).filter(Boolean), enabled: f.enabled.checked };
}

function snapAfter() {
	if (!S.snap?.data) { loadSnapshots(); return; }
	// source, target, interval change the hints: keep what was typed
	['#snap-src', '#snap-tgt', '#snap-every'].forEach((id) => $(id)?.addEventListener('change', () => { S.snap.edit.data = { ...S.snap.edit.data, ...snapForm() }; renderMain(); }));
	$('#f-snap')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const a = { ...snapForm(), new: S.snap.edit.mode === 'new' };
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'job_set', a)).jobs; S.snap.edit = null; toast(`Job “${a.name}” saved.`); loadSnapshots(); }
		catch (err) { toast('Snapshots: ' + err.message, true); }
	});
}

/* ---------- "My ShareOS" for plain users ------------------------------------ */

function userTabs() {
	return [['me', 'MY SHAREOS'], ...(S.me?.files ? [['files', 'FILES']] : []), ...((S.me?.apps || []).length ? [['apps', 'APPS']] : []), ['settings', 'SETTINGS']];
}

function parseUserRoute() {
	let [t, id] = routeParts();
	if (t === 'appearance') { t = 'settings'; history.replaceState(null, '', '#/settings'); }   // old address (before 0.2.0-beta.11)
	S.utab = t === 'app' && id ? 'app' : userTabs().some((x) => x[0] === t) ? t : 'me';
	S.uapp = S.utab === 'app' ? id : null;
	if (S.utab !== 'app') S.appPage = null;
}

function renderUserTabs() {
	if (S.desk) return;
	$('#tabs').innerHTML = userTabs().map(([id, label]) =>
		html`<a class="tab${S.utab === id ? ' on' : ''}" href="#/${id}"${S.utab === id ? raw(' aria-current="page"') : ''}><span class="tl">${label}</span></a>`.s).join('');
}

function renderUserShell() {
	$('#root').innerHTML = html`
		<header class="hd" id="hd"></header>
		<nav class="tabs" id="tabs" aria-label="Main menu"></nav>
		<main id="main"></main>
		<footer class="ft" id="ft"></footer>`.s;
	parseUserRoute();
	renderUserHeader();
	renderUserTabs();
	renderUserMain();
	startChips();
}

function userLookView() {
	const names = ACCENT_NAMES;
	const own = S.me.ui || {}, sys = S.sysLook || {};
	const themeTxt = { dark: 'Dark', light: 'Light', system: 'Same as the operating system (automatic)' };
	return html`<section class="sec"><h2 class="gh">SETTINGS <span>${S.me.name}</span></h2><div class="g2"><div class="panel">
		<div class="ph"><span class="pt">APPEARANCE</span><span class="tag ml">just for you</span></div>
		<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>LIGHT OR DARK</span><select id="opt-utheme">
			<option value=""${!own.theme ? raw(' selected') : ''}>Same as for everyone (${themeTxt[sys.theme] || '–'})</option>
			${Object.entries(themeTxt).map(([v, t]) => html`<option value="${v}"${own.theme === v ? raw(' selected') : ''}>${t}</option>`)}
		</select></label></div>
		<div class="pt" style="margin:14px 0 8px">ACCENT COLOUR</div>
		<div class="row">${Object.keys(names).map((c) => html`<button class="sw c-${c}${S.accent === c ? ' on' : ''}" type="button" data-act="accent" data-c="${c}" aria-label="Accent colour ${names[c]}" aria-pressed="${S.accent === c}" title="${names[c]}"><i></i></button>`)}</div>
		<p class="note">Applies only to your login, on every device. Logo and browser icon take on the accent colour.</p>
		<div style="display:grid;gap:6px;margin-top:14px">
			<label class="chk"><input type="checkbox" id="opt-uscan"${S.scan ? raw(' checked') : ''}>Scanlines (this browser only)</label>
			${favBarOpt()}
		</div>
		${own.theme || own.accent ? html`<div class="acts" style="margin-top:14px"><button class="btn ghost" type="button" data-act="look-reset">Same as for everyone</button></div>` : ''}
	</div>
	<form class="panel" id="f-mypass" style="align-self:start">
		<div class="ph"><span class="pt">CHANGE PASSWORD</span></div>
		<div class="fields" style="grid-template-columns:1fr">
			<label class="f"><span>CURRENT PASSWORD</span><input name="old" type="password" autocomplete="current-password" required></label>
			<label class="f"><span>NEW PASSWORD</span><input name="p1" type="password" minlength="6" autocomplete="new-password" required></label>
			<label class="f"><span>REPEAT</span><input name="p2" type="password" minlength="6" autocomplete="new-password" required></label>
		</div>
		<p class="note">Used for the shares and this interface.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Change password</button></div>
	</form></div></section>`;
}

function renderUserHeader() {
	const m = S.me || {}, now = new Date();
	const hd = $('#hd');
	if (!hd) return;
	hd.innerHTML = html`
		<div>${brand()}<div class="sub"><b>${m.fullname || m.name}</b> · ${m.host || location.hostname}</div></div>
		<div class="side">
			<div class="row">
				${chipsHtml()}
				<button class="chip more" type="button" data-act="chips-more" hidden></button>
				${deskOn() ? html`<button class="ib" type="button" data-act="desk-view" aria-label="Desktop view" title="Desktop view">${svg(I.desk)}</button>` : ''}
				<button class="ib" type="button" data-act="theme" aria-label="Toggle light/dark" title="Toggle light/dark">${svg(I.moon)}</button>
				<button class="ib" type="button" data-act="logout" aria-label="Log out" title="Log out">${svg(I.power)}</button>
			</div>
			<div class="clock">${now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })}</div>
			<div class="meta">${now.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
		</div>`.s;
	fitChips();
	$('#ft').innerHTML = html`<span><b>ShareOS</b> · My ShareOS</span><span><a href="https://github.com/UniqueDroid/ShareOS" target="_blank" rel="noopener">github.com/UniqueDroid/ShareOS</a></span>`.s;
}

async function loadMyPaperless() {
	try { S.myPl = await rpc('shareos.me', 'paperless'); } catch (e) { S.myPl = { available: false }; }
	if (S.me && S.me.role !== 'admin' && !document.activeElement?.matches('input,select,textarea')) renderUserMain();
}

function myPaperless() {
	const p = S.myPl;
	if (!p) return html`<section class="sec"><div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div></section>`;
	if (!p.available) return '';
	const ib = p.inbox;
	return html`<section class="sec"><h2 class="gh">PAPERLESS <span>${p.url}</span></h2>
		<div class="g2">
			<form class="panel" id="f-mypl">
				<div class="ph"><span class="pt">MY INBOX</span>${ib ? html`<span class="tag ml ${ib.enabled ? 'ok' : ''}">${ib.enabled ? 'active' : 'off'}</span>` : ''}</div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>MY API TOKEN FROM PAPERLESS${ib ? ' (EMPTY = KEEP)' : ''}</span><input name="token" type="password" autocomplete="off" placeholder="${ib?.token_hint || 'Paperless → Profile → API token'}"></label></div>
				<label class="chk" style="margin-top:10px"><input type="checkbox" name="enabled"${!ib || ib.enabled ? raw(' checked') : ''}>Send files from my inbox</label>
				<dl class="kv" style="margin-top:12px"><dt>Inbox folder</dt><dd><code>${p.folder}</code></dd></dl>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit" value="save">Save</button><button class="btn" type="submit" value="test">Test connection</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">RECENTLY SENT</span>${ib?.waiting ? html`<span class="tag ml warn">${ib.waiting} waiting</span>` : ''}</div>
				${ib?.recent?.length ? html`<div style="display:grid;gap:6px">${ib.recent.map((x) => html`<div style="font-size:13px">${plStateTag(x)} ${x.file} <span class="mut" style="font-size:12px">${fmtTime(x.time)}</span></div>`)}</div>`
					: html`<p class="mut" style="margin:0;font-size:13px">Nothing sent yet. Put files into the inbox folder – they reach Paperless within a few minutes.</p>`}
			</div>
		</div></section>`;
}

function renderUserMain() {
	const main = mainEl();
	if (!main) return;
	if (S.utab === 'files' && S.me?.files) { main.innerHTML = filesView().s; return; }
	if (S.utab === 'app') {
		if ($('#appframe')?.dataset.id === S.uapp) return;
		main.innerHTML = appPageView(findApp(S.uapp), '#/me').s;
		appFrameLoad();
		return;
	}
	if (S.utab === 'apps') { main.innerHTML = userAppsView().s; return; }
	if (S.utab === 'settings') {
		main.innerHTML = userLookView().s;
		$('#f-mypass').addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			if (f.p1.value !== f.p2.value) { toast('The passwords do not match.', true); return; }
			try { await rpc('shareos.me', 'passwd', { old: f.old.value, password: f.p1.value }); f.reset(); toast('Password changed.'); }
			catch (err) { toast('Password: ' + err.message, true); }
		});
		$('#opt-utheme').addEventListener('change', (e) => {
			const v = e.target.value;
			S.me.ui = { ...S.me.ui, theme: v || null };
			S.theme = v || S.sysLook?.theme || 'dark'; applyTheme(); renderUserHeader(); renderUserMain();
			saveLook({ theme: v });
		});
		$('#opt-uscan').addEventListener('change', (e) => { S.scan = e.target.checked; store.set('scan', S.scan ? '1' : '0'); applyTheme(); });
		return;
	}
	renderUserHome();
}

// "STORAGE" of My ShareOS: one row per drive of the personal folder and the
// shares – what lies there, own use and limit (quota), free space of the drive
function myStorage(m, host, ip) {
	const vols = m.volumes || [], use = Object.fromEntries((m.usage || []).map((x) => [x.volume, x]));
	const on = (v) => [...(m.home?.volume === v ? ['Personal folder'] : []), ...(m.shares || []).filter((x) => x.volume === v).map((x) => x.name)];
	const paths = m.home ? html`<dl class="kv" style="margin-top:12px">
		<dt>Personal folder</dt><dd><code>\\\\${host}\\${m.name}</code></dd>
		<dt>macOS / Linux</dt><dd><code>smb://${ip}/${m.name}</code></dd></dl>` : html`<p class="note">No personal folder set up.</p>`;
	const head = html`<div class="ph"><span class="pt">STORAGE</span>${m.quota ? html`<span class="tag ml">Limit ${fmtMB(m.quota)} per drive</span>` : html`<span class="tag ml">no limit</span>`}</div>`;
	if (!vols.length) return html`<div class="panel">${head}<p class="mut" style="margin:0;font-size:13px">No drive mounted for you.</p>${paths}</div>`;
	return html`<div class="panel">${head}
		<div class="tw"><table class="t" style="min-width:680px"><thead><tr><th>DRIVE</th><th>CONTAINS</th><th class="r">MY USAGE</th><th class="r">LIMIT</th><th style="width:28%">USED</th><th class="r">FREE</th></tr></thead>
		<tbody>${vols.map((v) => {
			const u = use[v.name], lim = u?.limit || 0;
			const p = lim ? pct(u.used, lim) : pct(v.used, v.size);
			return html`<tr><td><b>${v.name}</b></td><td class="mut">${on(v.name).length ? on(v.name).map((x, i) => html`${i ? ', ' : ''}<span>${x}</span>`) : '–'}</td>
				<td class="r">${u ? fmtBytes(u.used) : '–'}</td><td class="r mut">${lim ? fmtBytes(lim) : '–'}</td>
				<td><div class="bar"><i class="${p > 95 ? 'crit' : p > 85 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>
					<div class="mut" style="font-size:11px;margin-top:3px">${lim ? html`${p.toFixed(0)} % of my limit` : html`Drive ${p.toFixed(0)} % used`}</div></td>
				<td class="r">${fmtBytes(v.avail)}</td></tr>`;
		})}</tbody></table></div>
		${paths}</div>`;
}

// "APPS" of My ShareOS: all apps of the user; the star puts one into "FAV APPS" on the start page
function userAppsView() {
	const m = S.me || {}, apps = m.apps || [];
	return html`<section class="sec">
		<h2 class="gh">MY APPS <span>${apps.length}</span></h2>
		<div class="grid">${apps.map((a) => html`<div class="favwrap"><a class="card applink" href="${appHref(a, m.apps_server)}" data-act="app-launch" data-id="${a.id}">
			<div class="icon">${appIcon(a, m.apps_server)}</div>
			<div class="info"><div class="name">${a.name}${appMode(a) === 'page' ? '' : ' ↗'}</div><div class="desc">${txtOf(a.description)}</div></div></a>${favStar(a)}</div>`)}</div>
		<p class="note">The star makes an app a favourite – favourites are shown at the top of “My ShareOS”.</p>
	</section>`;
}

function renderUserHome() {
	const m = S.me || {}, host = m.host || location.hostname, ip = location.hostname;
	mainEl().innerHTML = html`
	${favBar(m.apps || [], m.apps_server)}
	<section class="sec">
		<h2 class="gh">MY SHAREOS <span>${m.name}</span></h2>
		${myStorage(m, host, ip)}
	</section>
	<section class="sec">
		<h2 class="gh">MY SHARES <span>${(m.shares || []).length}</span></h2>
		${(m.shares || []).length ? html`<div class="grid">${m.shares.map((x) => html`<div class="card">
			<div class="icon">${svg(I.folder)}<span class="dot ${x.mounted === false ? 'down' : 'up'}"></span></div>
			<div class="info"><div class="name">${x.name}</div><div class="desc">${x.comment || ''}</div>
				<div class="desc" style="margin-top:6px"><span class="tag ${x.access === 'rw' ? 'ok' : ''}">${ACCESS_TXT[x.access]}</span>
					${x.vault ? html` <span class="tag warn">VAULT</span> ${x.vault_until ? html`<span class="tag ok">open until ${vaultTime(x.vault_until)}</span>` : html`<span class="tag">locked</span>`}` : ''}</div>
				${x.vault && !x.vault_until ? '' : html`<div class="ip">\\\\${host}\\${x.name}</div>`}
				${x.vault ? html`<div class="acts" style="margin-top:10px">${x.vault_until
					? html`<button class="btn sm" type="button" data-act="vault-lock" data-share="${x.name}">${svg(I.lock)}Lock</button>`
					: html`<button class="btn sm primary" type="button" data-act="vault-unlock" data-share="${x.name}" data-ttl="${x.vault_ttl}">${svg(I.key)}Unlock</button>`}</div>` : ''}</div></div>`)}</div>`
			: html`<div class="panel"><div class="empty">${svg(I.info)}<span>No share has been assigned to you yet.</span></div></div>`}
	</section>
	${m.paperless ? myPaperless() : ''}
	${m.cloud ? cloudSection('me') : ''}`.s;
	if (m.paperless && !S.myPl) loadMyPaperless();
	if (m.cloud && S.cloud?.scope !== 'me') loadCloud('me');
	if (m.cloud) cloudAfter('me');
	$('#f-mypl')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, test = e.submitter?.value === 'test';
		try {
			const r = await rpc('shareos.me', 'paperless_set', { token: f.token.value.trim(), test, enabled: f.enabled.checked });
			if (test) toast(`Connection OK – ${r.documents} documents in Paperless.`);
			else { toast('Paperless inbox saved.'); S.myPl = null; loadMyPaperless(); }
		} catch (err) { toast('Paperless: ' + err.message, true); }
	});
}

/* ---------- storage (Speicher) ---------------------------------------------- */

const LAYOUT_TXT = { mirror: 'Mirror (RAID 1)', stripe: 'RAID 0', span: 'JBOD', single: 'Single drive' };
// layouts with one volume over both disks
const pairLayout = (l) => l === 'mirror' || l === 'stripe' || l === 'span';
// file systems: label and what the choice means
const FS_DISK = [['ext4', 'ext4 – recommended', 'Everything: permissions per user, storage limit, personal folders, apps.'],
	['btrfs', 'Btrfs', 'Permissions per user, personal folders, apps; no storage limit per user. Needs more memory.'],
	['exfat', 'exFAT', 'Also readable on Windows and macOS. No permissions per user (whoever may write to a share may change everything in it), no storage limit, no personal folders, no apps.'],
	['ntfs', 'NTFS', 'Also readable on Windows. No permissions per user, no storage limit, no personal folders, no apps.'],
	['ext3', 'ext3', 'Older Linux file system (e.g. known from Alt-F): permissions per user, personal folders, apps; no storage limit.'],
	['ext2', 'ext2', 'No journal – long check after a power cut. Only if an old device needs it.'],
	['vfat', 'FAT32', 'For very old devices. Files up to 4 GB, no permissions per user, no storage limit, no personal folders, no apps.']];
const FS_USB = [['exfat', 'exFAT – recommended', 'Windows, macOS, Linux, TVs; files over 4 GB.'],
	['vfat', 'FAT32', 'For older devices (car radio, camera); files up to 4 GB.'],
	['ntfs', 'NTFS', 'For Windows computers.'],
	['ext4', 'ext4', 'For Linux and backups with permissions.']];
const FS_NAME = { ext4: 'ext4', ext3: 'ext3', ext2: 'ext2', btrfs: 'Btrfs', exfat: 'exFAT', ntfs: 'NTFS', ntfs3: 'NTFS', vfat: 'FAT32' };
const LINUX_FS = ['ext4', 'ext3', 'ext2', 'btrfs'];
const linuxFs = (v) => !v.fstype || LINUX_FS.includes(v.fstype);
const fsSelect = (list, val, cls = '') => html`<select class="${cls}">${list.map(([v, t]) => html`<option value="${v}"${val === v ? raw(' selected') : ''}>${t}</option>`)}</select>`;
const fsNote = (list, val) => html`<p class="note fs-note" style="margin:6px 0 0">${(list.find((x) => x[0] === val) || list[0])[2]}</p>`;

// form dialog: name + file system; resolves { name, fs } or null
function fsDlg(title, text, name, list, fs, okLabel, max = 16) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<form method="dialog"><h3>${title}</h3><p>${text}</p>
			<div class="fields" style="grid-template-columns:1fr;margin-bottom:6px">
				<label class="f"><span>NAME</span><input name="v" value="${name}" maxlength="${max}" required></label>
				<label class="f"><span>FILE SYSTEM</span>${fsSelect(list, fs, 'fs-sel')}</label></div>
			${fsNote(list, fs)}
			<div class="acts" style="margin-top:16px"><button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn primary" type="submit" value="yes">${okLabel}</button></div></form>`.s;
		$('#app').append(d);
		let result = null;
		$('.fs-sel', d).addEventListener('change', (e) => { $('.fs-note', d).textContent = list.find((x) => x[0] === e.target.value)[2]; });
		$('button[value=no]', d).addEventListener('click', () => d.close());
		$('form', d).addEventListener('submit', () => { result = { name: $('input', d).value.trim(), fs: $('.fs-sel', d).value }; });
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		d.showModal();
		$('input', d).select();
	});
}
const SPINDOWN = [[0, 'never'], [10, '10 minutes'], [20, '20 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']];

function arrayOf(st, dev) {
	const name = (dev || '').replace('/dev/', '');
	return st?.arrays?.[name] || null;
}

// worst SMART rating of the disks a volume lies on (null: no values read)
function volSmart(st, v) {
	const md = arrayOf(st, v.device);
	const base = (x) => String(x || '').replace('/dev/', '').replace(/[0-9]+$/, '');
	const devs = md ? (md.members || []).map(base) : [base(v.device)];
	let worst = null;
	for (const d of st.disks || []) {
		if (!devs.includes(d.name) || !d.smart || d.smart.standby || d.smart.error) continue;
		const r = smartRating(d.smart);
		if (r === 'bad' || !worst || (r === 'warn' && worst === 'good')) worst = r;
	}
	return worst;
}
const volSmartTag = (sm) => (sm && sm !== 'good' ? html`<span class="tag ${SMART_RATING[sm][0]}" title="SMART values of a disk of this volume">${SMART_RATING[sm][1]}</span>` : '');

function diskUse(st, d) {
	// what is on a disk: ShareOS volume / RAID member / foreign file system / empty
	const parts = d.children || [];
	if (!parts.length && !d.fstype) return { empty: true, txt: 'empty' };
	const txt = parts.map((p) => {
		if (p.fstype === 'linux_raid_member') {
			const md = (p.children || [])[0];
			return `RAID member${md ? ' of ' + md.name : ''}${p.label ? ' (' + p.label.replace(/^.*:/, '') + ')' : ''}`;
		}
		return [p.name, p.fstype || 'no file system', p.label, p.mountpoint ? '→ ' + p.mountpoint : ''].filter(Boolean).join(' · ');
	});
	return { empty: false, txt: txt.join(' | ') || d.fstype };
}

function smartLine(sm) {
	if (!sm) return html`<span class="mut">SMART not read yet</span>`;
	if (sm.standby) return html`<span class="mut">asleep (SMART on next wake-up)</span>`;
	if (sm.error) return html`<span class="mut">${sm.error}</span>`;
	const r = smartRating(sm);
	return html`<a class="tag ${SMART_RATING[r][0]}" href="#/storage/health" title="Health">SMART <span>${SMART_RATING[r][1]}</span></a>
		${sm.temperature != null ? html` · <span>${sm.temperature} °C</span>` : ''}
		${sm.power_on_hours != null ? html` · <span>${Math.round(sm.power_on_hours / 24)} days powered on</span>` : ''}
		${sm.life_left != null ? html` · <span>SSD ${sm.life_left} % left</span>` : ''}
		${sm.test_running ? html` · <span>self-test running</span>` : ''}`;
}

// small "x" that hides a message for good (the box forgets it)
const closeX = (act) => html`<button class="bx" type="button" data-act="${act}" title="Close" aria-label="Close">${svg(I.x)}</button>`;

// USB button: copy the USB drives into a folder on a drive (short press)
const USB_COPY_ERR = { 'no USB drive': 'No USB drive plugged in.', 'not enough space': 'Not enough space on the target – nothing copied.',
	'target drive not mounted': 'The target drive is not mounted.', 'no target set': 'No target set.' };
function usbCopyPanel(st) {
	const u = st.usb_copy || { enabled: false, volume: '', path: '' }, last = u.last;
	return html`<form class="panel" id="f-usbcopy">
		<div class="ph"><span class="pt">USB BUTTON</span>${u.enabled ? html`<span class="tag ml ok">copies</span>` : ''}</div>
		<label class="chk"><input type="checkbox" name="enabled"${u.enabled ? raw(' checked') : ''}>A short press copies the USB drives, holding 3 s ejects them</label>
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>TARGET DRIVE</span><select name="volume">
				<option value="">–</option>
				${(st.volumes || []).map((v) => html`<option value="${v.name}"${u.volume === v.name ? raw(' selected') : ''}>${v.name}</option>`)}
			</select></label>
			<label class="f"><span>FOLDER</span><input name="path" value="${u.path}" maxlength="200"></label>
		</div>
		<p class="note">A new folder with the date every time, e.g. <code>${u.volume || 'data'}/${u.path}/2026-10-25_1430-STICK</code> – nothing on the box is overwritten or deleted. The USB light blinks while copying; the result comes as a message. Without the tick the button only ejects, as before.</p>
		${last ? html`<p class="note">Last: ${last.state === 'running' ? html`<b>running …</b>` : last.state === 'done' ? html`<span class="tag ok">OK</span> ${fmtTime(last.time)} · ${last.files} files · ${fmtBytes(last.bytes || 0)}` : html`<span class="tag err">ERROR</span> ${USB_COPY_ERR[last.error] || last.error}`}</p>` : ''}
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button>
			<button class="btn" type="button" data-act="usb-copy" ${u.volume && (st.usb || []).length && last?.state !== 'running' ? '' : 'disabled'}>Copy now</button></div>
	</form>`;
}

function storageView() {
	const st = S.storage, i = S.info || {};
	if (!st) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading drives …</span></div></div>`;
	const job = st.job;
	const running = job?.state === 'running';
	return html`
	${running ? html`<div class="banner" style="border-color:var(--dim)"><div class="spin" style="margin:0;width:20px;height:20px"></div><span><b>Setup running</b> – ${job.step || ''}. Do not switch the box off.</span></div>` : ''}
	${job?.state === 'error' ? html`<div class="banner">${svg(I.warn)}<span style="flex:1"><b>Setup failed:</b> ${job.error}</span>${closeX('job-clear')}</div>` : ''}
	${S.wiz ? wizardView(st) : ''}
	<section class="sec">
		${secHead('volumes', 'VOLUMES', st.volumes.length ? st.volumes.length + ' set up' : 'none yet')}
		${st.volumes.length ? (isTable('volumes') ? volumeTable(st, running) : html`<div class="grid">${st.volumes.map((v) => volumeCard(st, v, running))}</div>`)
			: html`<div class="panel"><div class="empty">${svg(I.info)}<div><span>No storage set up yet. The wizard sets up the disks in a few steps – as a mirror (both disks hold the same data) or as separate drives.</span>
				<div class="acts" style="margin-top:12px">${S.wiz ? '' : html`<button class="btn primary" type="button" data-act="wiz-start" ${running || !st.disks.length ? 'disabled' : ''}>Set up storage</button>`}</div></div></div></div>`}
	</section>
	<section class="sec">
		${secHead('stdisks', 'DRIVES', `${st.disks.length} detected`)}
		${st.disks.length ? (isTable('stdisks') ? diskTable(st, running) : html`<div class="grid">${st.disks.map((d) => diskCard(st, d, running))}</div>`) : diskCards(i)}
	</section>
	<section class="sec">
		<h2 class="gh">SETTINGS</h2>
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SPINDOWN</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>SPIN DISKS DOWN AFTER</span><select id="spindown">
					${SPINDOWN.map(([m, t]) => html`<option value="${m}"${st.spindown === m ? raw(' selected') : ''}>${t}</option>`)}
					${SPINDOWN.some(([m]) => m === st.spindown) ? '' : html`<option value="${st.spindown}" selected>${st.spindown} minutes</option>`}
				</select></label></div>
				<p class="note">Saves power and wear. Disks spin up again on the next access (a few seconds).</p>
				<dl class="kv" style="margin-top:14px">
					<dt>Swap</dt><dd>${(st.swaps || []).length ? (st.swaps.map((x) => x.device.replace('/dev/', '')).join(', ') + ' · ' + fmtBytes(st.swaps.reduce((a, x) => a + x.used, 0)) + ' of ' + fmtBytes(st.swaps.reduce((a, x) => a + x.size, 0)) + ' used') : 'none active'}</dd>
					<dt>App area</dt><dd>${st.apps ? '/mnt/' + st.apps + '/.shareos' : 'none yet'}</dd>
				</dl>
			</div>
			${usbCopyPanel(st)}
			<div class="panel">
				<div class="ph"><span class="pt">SET UP AGAIN</span></div>
				<p class="mut" style="margin:0 0 12px;font-size:13px">The wizard erases the selected disks and sets them up again. Single disks can also be formatted directly at the disk under “Drives”. Disks with data (e.g. from Alt-F or the D-Link firmware) are added without erasing with “… take over” at the disk.</p>
				<button class="btn" type="button" data-act="wiz-start" ${running || !st.disks.length || S.wiz ? 'disabled' : ''}>Start wizard</button>
			</div>
		</div>
	</section>
	<section class="sec">
		<h2 class="gh">INTERNAL FLASH <span>NAND · UBI</span></h2>
		<div class="tw"><table class="t" style="min-width:560px">
			<thead><tr><th>AREA</th><th>MOUNTED</th><th>USED</th><th style="width:30%">LOAD</th></tr></thead>
			<tbody>${(i.filesystems || []).map((f) => html`<tr>
				<td><b>${fsLabel[f.mount] || f.mount}</b><div class="mut" style="font-size:12px">${f.source}</div></td>
				<td><code>${f.mount}</code></td>
				<td>${fmtBytes(f.used)} / ${fmtBytes(f.size)}</td>
				<td><div class="bar"><i class="${f.mount === '/rom' ? '' : pct(f.used, f.size) > 90 ? 'crit' : pct(f.used, f.size) > 75 ? 'warn' : ''}" style="width:${pct(f.used, f.size).toFixed(0)}%"></i></div></td></tr>`)}
			</tbody></table></div>
	</section>`;
}

// internal disks that could replace the missing disk of a mirror (not part of it, not USB)
function repairCandidates(st, md) {
	return (st.disks || []).filter((d) => !d.usb && !d.rm && d.tran !== 'usb'
		&& !(md.members || []).some((m) => m === d.name || m.startsWith(d.name)));
}

function volActions(v, running) {
	const st = S.storage, md = arrayOf(st, v.device);
	const repair = v.layout === 'mirror' && md?.health?.includes('_') && !md.sync && repairCandidates(st, md).length;
	return html`${repair ? html`<button class="btn sm primary" type="button" data-act="vol-repair" data-name="${v.name}" ${running ? 'disabled' : ''}>Repair mirror</button>` : ''}${v.mounted ? html`<button class="btn sm" type="button" data-act="vol" data-name="${v.name}" data-op="umount" ${running ? 'disabled' : ''}>Unmount</button>`
			: html`<button class="btn sm" type="button" data-act="vol" data-name="${v.name}" data-op="mount" ${running || !v.device ? 'disabled' : ''}>Mount</button>`}
		<button class="btn sm ghost" type="button" data-act="vol" data-name="${v.name}" data-op="forget" ${running ? 'disabled' : ''}>Remove</button>`;
}

function volumeTable(st, running) {
	return html`<div class="tw"><table class="t" style="min-width:760px"><thead><tr><th>NAME</th><th>LAYOUT</th><th>USED</th><th style="width:18%">LOAD</th><th>HEALTH</th><th></th></tr></thead>
		<tbody>${st.volumes.map((v) => {
			const md = arrayOf(st, v.device), degraded = md && md.health && md.health.includes('_'), p = pct(v.used, v.size), sm = volSmart(st, v);
			return html`<tr>
				<td><b>${v.name}</b>${S.storage?.apps === v.name ? html` <span class="tag">APPS</span>` : ''}<div class="mut" style="font-size:12px">${v.mountpoint}</div></td>
				<td>${LAYOUT_TXT[v.layout] || v.layout || ''} · ${FS_NAME[v.fstype] || v.fstype || '?'}${md ? html`<div class="mut" style="font-size:12px">${md.name} · ${md.health || '?'}</div>` : ''}</td>
				<td>${v.mounted ? html`${fmtBytes(v.used)} / ${fmtBytes(v.size)}` : '–'}</td>
				<td>${v.mounted ? html`<div class="bar"><i class="${p > 90 ? 'crit' : p > 80 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}</td>
				<td>${!v.mounted ? html`<span class="tag err">not mounted</span>` : degraded ? html`<span class="tag warn">a disk is missing</span>`
					: md?.sync ? html`<span class="tag warn">Sync ${md.sync.delayed ? 'waiting' : md.sync.percent.toFixed(1) + ' %'}</span>` : sm && sm !== 'good' ? '' : html`<span class="tag ok">OK</span>`} ${v.mounted ? volSmartTag(sm) : ''}</td>
				<td><div class="acts">${volActions(v, running)}</div></td></tr>`;
		})}</tbody></table></div>`;
}

/* --- disk health (SMART): rating, values, self-tests, all attributes --- */

const SMART_RATING = { good: ['ok', 'GOOD'], warn: ['warn', 'CAUTION'], bad: ['err', 'CRITICAL'] };
// reasons of the rating (rpcd smart_assess) as text
function smartReason(sm, r) {
	const m = /^attr_(now|past):(.+)$/.exec(r);
	if (m) return m[1] === 'now' ? `Value ${m[2]} below the manufacturer's threshold` : `Value ${m[2]} was below the threshold earlier`;
	return {
		failed: 'The disk itself reports: failure is imminent (SMART overall assessment FAILED).',
		test_failed: 'The last self-test failed.',
		reallocated: `${sm.reallocated} sectors have already been replaced (reallocated).`,
		pending: `${sm.pending} sectors are uncertain (pending) – they are checked on the next write.`,
		uncorrectable: `${sm.uncorrectable} sectors could not be read.`,
		crc: `${sm.crc_errors} transfer errors (CRC) – usually the connector or cable, not the disk itself.`,
		errors: `${sm.error_count} entries in the disk's error log.`,
		worn: `The SSD is almost worn out: ${sm.life_left} % life left.`,
		wearing: `The SSD is wearing: ${sm.life_left} % life left.`,
		hot: `Very warm: ${sm.temperature} °C.`,
		warm: `Warm: ${sm.temperature} °C.`
	}[r] || r;
}
// values without a rating (cached by an older firmware) get one here
function smartRating(sm) {
	if (sm.rating) return sm.rating;
	return sm.passed === false ? 'bad' : (sm.reallocated || sm.pending || sm.uncorrectable) ? 'warn' : 'good';
}
const fmtHours = (h) => (h >= 24 * 365 ? `${(h / 24 / 365).toLocaleString(LOC, { maximumFractionDigits: 1 })} years` : `${Math.round(h / 24)} days`);
const fmtTestMin = (m) => (m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`);

function healthCard(d) {
	const sm = d.smart, open = S.hOpen?.has(d.name), bay = !d.usb && d.tran !== 'usb';
	const head = html`<div class="ph"><span class="pt">${bay ? 'BAY' : 'USB'} · ${d.name}</span>
		${d.standby != null ? html`<span class="tag ml">${d.standby ? 'ASLEEP' : 'ACTIVE'}</span>` : ''}
		${sm && !sm.standby && !sm.error ? html`<span class="tag ${d.standby != null ? '' : 'ml'} ${SMART_RATING[smartRating(sm)][0]}">${SMART_RATING[smartRating(sm)][1]}</span>` : ''}</div>
		<div class="mut" style="font-size:13px;margin:-4px 0 12px"><span>${d.model || sm?.model || 'unknown model'}</span> · ${fmtBytes(d.size)}${sm?.ssd ? ' · SSD' : sm?.rpm ? html` · <span>${sm.rpm} rpm</span>` : ''}${(sm?.serial || d.serial) ? ' · ' + (sm?.serial || d.serial) : ''}${sm?.firmware ? ' · ' + sm.firmware : ''}</div>`;
	const read = html`<button class="btn sm" type="button" data-act="smart" data-disk="${d.name}">${sm ? 'Read again' : 'Read now'}</button>`;
	if (!sm || sm.standby || sm.error) return html`<div class="panel">${head}
		<p class="mut" style="margin:0 0 12px;font-size:13px">${!sm ? 'SMART not read yet. Reading wakes the disk up.' : sm.standby ? 'The disk is asleep – the values come when it next wakes up.' : bay ? 'This disk gives no SMART values.' : 'This USB adapter does not pass on SMART values.'}</p>
		<div class="acts">${read}</div></div>`;
	const rating = smartRating(sm), reasons = sm.reasons || [];
	const kv = [
		['Temperature', sm.temperature == null ? null : sm.temperature_max != null ? `${sm.temperature} °C (highest: ${sm.temperature_max} °C)` : `${sm.temperature} °C`],
		['Running time', sm.power_on_hours != null ? `${fmtHours(sm.power_on_hours)} (${sm.power_on_hours.toLocaleString(LOC)} h)` : null],
		['Power cycles', sm.power_cycles],
		['Motor start-ups', sm.ssd ? null : sm.start_stops],
		['Reallocated sectors', sm.reallocated],
		['Pending sectors', sm.pending],
		['Unreadable sectors', sm.uncorrectable],
		['Transfer errors (CRC)', sm.crc_errors],
		['Error log', sm.error_count != null ? `${sm.error_count} entries` : null],
		['Written', sm.written != null ? fmtBytes(sm.written) : null]
	].filter(([, v]) => v != null);
	const t = sm.test_running, last = sm.last_test, mins = sm.test_minutes || {};
	return html`<div class="panel">${head}
		${reasons.length ? html`<ul class="hreasons">${reasons.map((r) => html`<li>${smartReason(sm, r)}</li>`)}</ul>`
			: html`<p style="margin:0 0 12px;font-size:13px">Nothing unusual.</p>`}
		${sm.life_left != null ? html`<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between;font-size:13px"><span>SSD life</span><b>${sm.life_left} % left</b></div>
			<div class="bar" style="margin-top:4px"><i class="${sm.life_left <= 10 ? 'crit' : sm.life_left <= 20 ? 'warn' : ''}" style="width:${sm.life_left}%"></i></div></div>` : ''}
		<dl class="kv">${kv.map(([k, v]) => html`<dt>${k}</dt><dd>${typeof v === 'number' ? v.toLocaleString(LOC) : v}</dd>`)}</dl>
		<div class="pt" style="margin:16px 0 8px">SELF-TEST</div>
		${t ? html`<div style="font-size:13px">Running – ${t.remaining} % left<div class="bar busy" style="margin-top:4px"><i style="width:${100 - t.remaining}%"></i></div></div>`
			: last ? html`<div style="font-size:13px"><span class="tag ${last.passed === false ? 'err' : 'ok'}">${last.passed === false ? 'FAILED' : 'OK'}</span> <span>${({ 'Short offline': 'Short test', 'Extended offline': 'Long test', 'Short captive': 'Short test', 'Extended captive': 'Long test' })[last.type] || last.type}</span> · ${last.passed === false ? last.status : html`<span>without errors</span>`}${last.hours != null ? html` <span class="mut">(at ${last.hours.toLocaleString(LOC)} h)</span>` : ''}</div>`
			: html`<div class="mut" style="font-size:13px">No self-test has run yet.</div>`}
		<div class="acts" style="margin-top:12px">
			${read}
			${bay && !t ? html`<button class="btn sm" type="button" data-act="smart-test" data-disk="${d.name}" data-t="short"><span>Short test</span>${mins.short ? html` <span class="mut">${fmtTestMin(mins.short)}</span>` : ''}</button>
				<button class="btn sm" type="button" data-act="smart-test" data-disk="${d.name}" data-t="long"><span>Long test</span>${mins.long ? html` <span class="mut">${fmtTestMin(mins.long)}</span>` : ''}</button>` : ''}
			${bay && t ? html`<button class="btn sm danger" type="button" data-act="smart-test" data-disk="${d.name}" data-t="abort">Abort test</button>` : ''}
			${(sm.attributes || []).length ? html`<button class="btn sm ghost ml" type="button" data-act="smart-attrs" data-disk="${d.name}" aria-expanded="${!!open}">${open ? 'Hide values' : 'All values'}</button>` : ''}
		</div>
		${open ? html`<div class="tw" style="margin-top:12px"><table class="t" style="min-width:560px"><thead><tr><th class="r">ID</th><th>VALUE</th><th class="r">CURRENT</th><th class="r">WORST</th><th class="r">THRESHOLD</th><th>RAW VALUE</th></tr></thead>
			<tbody>${sm.attributes.map((a) => html`<tr${a.when_failed ? raw(' class="sel"') : ''}><td class="r mut">${a.id}</td><td>${a.name}${a.when_failed ? html` <span class="tag ${a.when_failed === 'now' ? 'err' : 'warn'}">${a.when_failed === 'now' ? 'NOW' : 'EARLIER'}</span>` : ''}</td>
				<td class="r">${a.value}</td><td class="r mut">${a.worst}</td><td class="r mut">${a.thresh}</td><td class="mut"><code>${a.raw}</code></td></tr>`)}</tbody></table></div>` : ''}
		${rating === 'bad' ? html`<p class="note" style="color:var(--red)">Back up the data and replace the disk soon.</p>` : ''}
		${sm.time ? html`<p class="note">Read ${fmtTime(sm.time)}.</p>` : ''}
	</div>`;
}

function healthView() {
	const st = S.storage;
	if (!st) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading drives …</span></div></div>`;
	const sched = st.smart_schedule || '';
	return html`<section class="sec">
		<h2 class="gh">HEALTH <span>SMART of the disks and SSDs</span></h2>
		${st.disks.length ? html`<div class="g2">${st.disks.map((d) => healthCard(d))}</div>` : html`<div class="panel"><div class="empty">${svg(I.info)}<span>No disk found.</span></div></div>`}
	</section>
	<section class="sec">
		<h2 class="gh">SETTINGS</h2>
		<div class="g2"><div class="panel">
			<div class="ph"><span class="pt">SCHEDULED SELF-TEST</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>ALL DISKS IN THE BAYS</span><select id="smart-sched">
				${[['', 'Off'], ['short_weekly', 'Short test every Sunday (3:30 am)'], ['long_monthly', 'Long test on the 1st of every month (3:30 am)']].map(([v, t]) => html`<option value="${v}"${sched === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<p class="note">The short test checks the electronics and part of the surface, the long test reads the whole disk (many hours for large disks; the disk stays awake meanwhile). The result shows here and as a message when something is wrong.</p>
		</div>
		<div class="panel">
			<div class="ph"><span class="pt">HOW IT IS RATED</span></div>
			<dl class="hrate"><dt><span class="tag err">CRITICAL</span></dt><dd>The disk itself reports a failure, a value is below the manufacturer's threshold, a self-test failed, more than 100 reallocated or more than 10 pending sectors, an SSD with 10 % life or less, 60 °C and above.</dd>
			<dt><span class="tag warn">CAUTION</span></dt><dd>A few reallocated, pending or unreadable sectors, transfer errors, entries in the error log, an SSD with 20 % life or less, from 55 °C.</dd></dl>
		</div></div>
	</section>`;
}

function diskTable(st, running) {
	return html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>DRIVE</th><th>MODEL</th><th>SIZE</th><th>SMART</th><th>CONTENTS</th><th></th></tr></thead>
		<tbody>${st.disks.map((d) => html`<tr>
			<td><b>${d.usb || d.tran === 'usb' ? 'USB' : 'Bay'} · ${d.name}</b></td>
			<td>${d.model || 'unknown model'}${d.serial ? html`<div class="mut" style="font-size:12px">${d.serial}</div>` : ''}</td>
			<td>${fmtBytes(d.size)}</td><td>${smartLine(d.smart)}</td><td class="mut" style="font-size:12px">${diskUse(st, d).txt}</td>
			<td><div class="acts">${diskActions(d, running)}</div></td></tr>`)}</tbody></table></div>`;
}

function volumeCard(st, v, running) {
	const md = arrayOf(st, v.device);
	const degraded = md && md.health && md.health.includes('_');
	const p = pct(v.used, v.size), sm = volSmart(st, v);
	return html`<div class="card${v.mounted ? '' : ' off'}">
		<div class="icon">${svg(I.disk)}<span class="dot ${!v.mounted || sm === 'bad' ? 'down' : degraded || sm === 'warn' ? 'warn' : 'up'}"></span></div>
		<div class="info">
			<div class="name">${v.name}${S.storage?.apps === v.name ? html` <span class="tag" title="Packages and app data live in .shareos">APPS</span>` : ''} ${volSmartTag(sm)}</div>
			<div class="desc">${LAYOUT_TXT[v.layout] || v.layout || ''} · ${FS_NAME[v.fstype] || v.fstype || '?'}${v.mounted ? html` · ${fmtBytes(v.avail)} free of ${fmtBytes(v.size)}` : ' · not mounted'}</div>
			${v.mounted ? html`<div class="bar" style="margin-top:10px"><i class="${p > 90 ? 'crit' : p > 80 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}
			${md ? html`<div class="desc" style="margin-top:8px">${md.name}: ${degraded ? html`<span style="color:var(--amber)">one disk missing (${md.health})</span>` : html`both disks active (${md.health || '?'})`}</div>` : ''}
			${degraded && !md.sync && v.layout === 'mirror' && !repairCandidates(st, md).length ? html`<div class="desc" style="margin-top:6px">Put a new disk into the free bay, then “Repair mirror”.</div>` : ''}
			${md?.sync ? html`<div class="desc" style="margin-top:6px">${md.sync.action === 'resync' ? 'Initial sync' : md.sync.action === 'recovery' ? 'Recovery' : 'Check'}: ${md.sync.delayed ? 'waiting' : md.sync.percent.toFixed(1) + ' %' + (md.sync.finish ? ' · ' + fmtMin(md.sync.finish) + ' left' : '')}</div>
				<div class="bar" style="margin-top:6px"><i class="warn" style="width:${md.sync.percent}%"></i></div>` : ''}
			<div class="ip">${v.mountpoint}${v.device ? ' · ' + v.device : ' · file system not found'}</div>
			<div class="acts" style="margin-top:12px">${volActions(v, running)}</div>
		</div></div>`;
}

function fmtMin(s) {
	const m = parseFloat(s);
	if (!(m >= 0)) return s;
	return m >= 90 ? `${(m / 60).toLocaleString(LOC, { maximumFractionDigits: 1 })} h` : `${Math.round(m)} min`;
}

// partitions (or RAID arrays) of a disk with a file system ShareOS does not
// know yet – a data disk of Alt-F or the D-Link firmware: they can be taken
// over as they are
const ADOPT_FS = ['ext4', 'ext3', 'ext2', 'btrfs', 'exfat', 'ntfs', 'vfat'];
function adoptable(st, d) {
	const known = new Set((st.volumes || []).map((v) => v.uuid));
	const out = [];
	for (const p of d.children || []) {
		const t = p.fstype === 'linux_raid_member' ? (p.children || [])[0] : p;
		if (t && ADOPT_FS.includes(t.fstype) && t.uuid && !known.has(t.uuid) && !t.mountpoint && !out.some((x) => x.name === t.name)) out.push(t);
	}
	return out;
}

function diskActions(d, running) {
	if (d.usb) return html`<button class="btn sm" type="button" data-act="usb-eject" data-disk="${d.name}" ${running ? 'disabled' : ''}>Safely remove</button>
		<button class="btn sm danger" type="button" data-act="usb-format" data-disk="${d.name}" ${running ? 'disabled' : ''}>Format</button>`;
	return html`${adoptable(S.storage, d).map((p) => html`<button class="btn sm primary" type="button" data-act="adopt" data-part="${p.name}" data-fs="${p.fstype}" data-size="${p.size}" ${running || S.wiz ? 'disabled' : ''}>Take over ${p.name}</button>`)}
		<button class="btn sm" type="button" data-act="smart" data-disk="${d.name}">Read SMART</button>
		<button class="btn sm danger" type="button" data-act="format" data-disk="${d.name}" ${running || S.wiz ? 'disabled' : ''}>Erase & format</button>`;
}

// mounted partitions of a USB drive
function usbLines(st, d) {
	const m = (st.usb || []).filter((x) => x.dev.replace('/dev/', '').replace(/p?\d+$/, '') === d.name);
	return m.length ? html`<div class="desc" style="margin-top:8px">${m.map((x) => html`<div>${FS_NAME[x.fs] || x.fs} · <code>${x.path}</code></div>`)}</div>`
		: html`<div class="desc" style="margin-top:8px;color:var(--muted)">not mounted</div>`;
}

function diskCard(st, d, running) {
	const use = diskUse(st, d);
	const sm = d.smart;
	return html`<div class="card">
		<div class="icon">${svg(d.rm || d.tran === 'usb' ? I.usb : I.disk)}<span class="dot${diskDot({ smart: sm && !sm.standby && !sm.error ? smartRating(sm) : null, standby: d.standby })}"></span></div>
		<div class="info">
			<div class="name">${d.usb || d.tran === 'usb' ? 'USB' : 'Bay'} · ${d.name}${d.standby ? html` <span class="tag">ASLEEP</span>` : ''}</div>
			<div class="desc">${d.model || 'unknown model'} · ${fmtBytes(d.size)}${d.serial ? ' · ' + d.serial : ''}</div>
			${d.usb ? usbLines(st, d) : html`<div class="desc" style="margin-top:8px">${smartLine(sm)}</div>`}
			<div class="ip">${use.txt}</div>
			<div class="acts" style="margin-top:12px">${diskActions(d, running)}</div>
		</div></div>`;
}

/* --- setup wizard --- */

function wizardView(st) {
	const w = S.wiz;
	const disks = st.disks.filter((d) => !d.usb && !d.rm && d.tran !== 'usb');
	const chosen = st.disks.filter((d) => w.disks.includes(d.name));
	const steps = ['Disks', 'Layout', 'Name', 'Confirm'];
	const smallest = Math.min(...chosen.map((d) => d.size));
	let body;
	if (w.step === 0) {
		body = html`<p class="mut" style="margin:0 0 12px;font-size:13px">Which disks should be set up? <b style="color:var(--amber)">Everything on these disks will be erased.</b></p>
			<div style="display:grid;gap:8px">${(disks.length ? disks : st.disks).map((d) => { const u = diskUse(st, d); return html`
				<label class="chk" style="align-items:flex-start"><input type="checkbox" class="wiz-disk" value="${d.name}"${w.disks.includes(d.name) ? raw(' checked') : ''}>
				<span><b>${d.name}</b> · ${d.model || ''} · ${fmtBytes(d.size)}<br><span class="mut" style="font-size:12px">${u.empty ? 'empty' : 'contains: ' + u.txt}</span></span></label>`; })}</div>`;
	} else if (w.step === 1) {
		const two = chosen.length === 2;
		const opts = two
			? [['mirror', 'Mirror (RAID 1) – recommended', `Both disks hold the same data. If one fails, nothing is lost. Usable: ${fmtBytes(smallest)}.`],
				['stripe', 'RAID 0 – fast', `Both disks become one volume, data spread across them: faster, space ${fmtBytes(2 * smallest)}. If one disk fails, everything is lost.`],
				['span', 'JBOD – full space', `Both disks become one volume one after the other with ${fmtBytes(chosen.reduce((a, d) => a + d.size, 0))} (also with disks of different sizes). If one disk fails, everything is lost.`],
				['single', 'Two separate drives', `Twice the space (${fmtBytes(chosen.reduce((a, d) => a + d.size, 0))}), but no redundancy – each disk is a drive of its own.`]]
			: [['single', 'Single drive', `The disk becomes a drive of ${fmtBytes(chosen[0]?.size)}. For redundancy, add a second disk as a mirror later.`]];
		if (!opts.some((o) => o[0] === w.layout)) w.layout = opts[0][0];
		body = html`<div style="display:grid;gap:10px">${opts.map(([id, t, d]) => html`
			<label class="panel" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;${w.layout === id ? 'border-color:var(--accent);box-shadow:var(--glow)' : ''}">
				<input type="radio" name="wiz-layout" value="${id}"${w.layout === id ? raw(' checked') : ''} style="margin-top:4px;accent-color:var(--accent)">
				<span><b class="name" style="font-size:14px">${t}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
			<div class="fields" style="margin-top:14px"><label class="f"><span>SWAP PER DISK</span><select id="wiz-swap">
				${[[1024, '1 GB – recommended'], [2048, '2 GB'], [512, '512 MB'], [0, 'none']].map(([v, t]) => html`<option value="${v}"${w.swap === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<p class="note">The box has only 256 MB of RAM. Swap on the disks absorbs load peaks (shares, cloud sync, package installs). It is a small partition at the start of each disk; the rest becomes the drive.</p>`;
	} else if (w.step === 2) {
		const fields = pairLayout(w.layout) ? [['__mirror', w.layout === 'mirror' ? 'NAME OF THE MIRROR' : 'NAME OF THE VOLUME']] : chosen.map((d) => [d.name, `NAME FOR ${d.name.toUpperCase()} (${fmtBytes(d.size)})`]);
		body = html`<div style="display:grid;gap:14px">${fields.map(([k, l]) => html`<div class="fields">
				<label class="f"><span>${l}</span><input class="wiz-name" data-k="${k}" value="${w.names[k] || ''}" maxlength="16" pattern="[a-z0-9][a-z0-9_-]{0,15}" required></label>
				<label class="f"><span>FILE SYSTEM</span><select class="wiz-fs" data-k="${k}">${FS_DISK.map(([v, t]) => html`<option value="${v}"${(w.fs[k] || 'ext4') === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
				<div style="grid-column:1/-1">${fsNote(FS_DISK, w.fs[k] || 'ext4')}</div></div>`)}</div>
			<p class="note">Lower-case letters, digits, - and _ (max. 16 characters). The drive appears as <code>/mnt/&lt;name&gt;</code>; you create shares on it later.</p>`;
	} else {
		const pairSize = w.layout === 'mirror' ? smallest : w.layout === 'stripe' ? 2 * smallest : chosen.reduce((a, d) => a + d.size, 0);
		const vols = pairLayout(w.layout) ? [[w.names.__mirror, chosen.map((d) => d.name).join(' + '), fmtBytes(pairSize), w.fs.__mirror || 'ext4']]
			: chosen.map((d) => [w.names[d.name], d.name, fmtBytes(d.size), w.fs[d.name] || 'ext4']);
		body = html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>DRIVE</th><th>DISKS</th><th>SIZE</th><th>LAYOUT</th><th>FILE SYSTEM</th></tr></thead>
			<tbody>${vols.map(([n, ds, sz, f]) => html`<tr><td><b>${n}</b></td><td>${ds}</td><td>${sz}</td><td>${LAYOUT_TXT[w.layout]}</td><td>${FS_NAME[f]}</td></tr>`)}</tbody></table></div>
			<p class="note">${(() => { const k = (pairLayout(w.layout) ? ['__mirror'] : w.disks).find((x) => LINUX_FS.includes(w.fs[x] || 'ext4')); const sw = w.swap ? `${fmtBytes(w.swap * 1048576)} swap per disk` : 'No swap'; return k ? `${sw}, app area on "${w.names[k]}" (unless one exists).` : `${sw}, no app area (packages and app data need ext4 or Btrfs).`; })()}</p>
			<p class="note" style="color:var(--amber)">Clicking "Set up" erases ${chosen.map((d) => d.name).join(' and ')} completely.${w.layout === 'mirror' ? ' The initial sync then runs in the background (several hours on large disks); the drive can be used right away.' : ''}</p>`;
	}
	return html`<section class="sec"><div class="panel" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">SET UP STORAGE · WIZARD</span><button class="btn sm ghost ml" type="button" data-act="wiz-cancel">Cancel</button></div>
		<div class="steps" style="margin-bottom:16px">${steps.map((n, k) => html`<div class="step ${k < w.step ? 'done' : k === w.step ? 'act' : ''}"><div class="n">${k + 1}${k < w.step ? ' ✓' : ''}</div>${n}</div>`)}</div>
		${body}
		<div class="acts" style="margin-top:16px;justify-content:space-between">
			<button class="btn ghost" type="button" data-act="wiz-back" ${w.step === 0 ? 'disabled' : ''}>Back</button>
			${w.step < 3 ? html`<button class="btn primary" type="button" data-act="wiz-next">Next</button>`
				: html`<button class="btn danger" type="button" data-act="wiz-run">Set up</button>`}
		</div></div></section>`;
}

function wizardCollect() {
	const w = S.wiz;
	if (!w) return;
	if (w.step === 0) w.disks = [...document.querySelectorAll('.wiz-disk:checked')].map((x) => x.value);
	if (w.step === 1) {
		w.layout = $('input[name=wiz-layout]:checked')?.value || w.layout;
		if ($('#wiz-swap')) w.swap = +$('#wiz-swap').value;
	}
	if (w.step === 2) {
		document.querySelectorAll('.wiz-name').forEach((x) => { w.names[x.dataset.k] = x.value.trim().toLowerCase(); });
		document.querySelectorAll('.wiz-fs').forEach((x) => { w.fs[x.dataset.k] = x.value; });
	}
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,15}$/;

function wizardCheck() {
	const w = S.wiz, st = S.storage;
	if (w.step === 0) {
		if (!w.disks.length) return 'Please select at least one disk.';
		if (w.disks.length > 2) return 'Two disks at most.';
	}
	if (w.step === 2) {
		const keys = pairLayout(w.layout) ? ['__mirror'] : w.disks;
		const names = keys.map((k) => w.names[k] || '');
		if (names.some((n) => !NAME_RE.test(n))) return 'Invalid name: only a–z, 0–9, - and _, max. 16 characters.';
		if (new Set(names).size !== names.length) return 'The names must be different.';
		const taken = st.volumes.filter((v) => !(v.device || '').match(new RegExp('/dev/(' + w.disks.join('|') + ')|/dev/md'))).map((v) => v.name);
		const clash = names.find((n) => taken.includes(n));
		if (clash) return `The name “${clash}” is already taken.`;
	}
	return null;
}

async function loadStorage() {
	clearTimeout(S.stTimer);
	S.stActive = true;
	if (away()) { S.stTimer = setTimeout(loadStorage, 15000); return; }
	try {
		// a running self-test: read its disk again (the status only has cached values)
		if (S.route.sub === 'health') for (const d of (S.storage?.disks || []).filter((x) => x.smart?.test_running))
			try { await rpc('shareos.storage', 'smart', { disk: d.name }); } catch (e) { }
		S.storage = await rpc('shareos.storage', 'status');
		if (S.wizAfterLoad) { S.wizAfterLoad = false; if (!S.storage.volumes.length && S.storage.disks.length) { ACTIONS['wiz-start'](); } }
		if (S.route.tab === 'storage' && !(S.wiz && S.wiz.step === 2) && !document.activeElement?.matches('select')) renderMain();
		const busy = S.storage.job?.state === 'running' || Object.values(S.storage.arrays || {}).some((a) => a.sync);
		const testing = S.route.sub === 'health' && S.storage.disks.some((d) => d.smart?.test_running);
		if (S.route.tab === 'storage') S.stTimer = setTimeout(loadStorage, busy ? 3000 : testing ? 60000 : 15000);
	} catch (e) {
		if (e.code !== 'auth') { toast('Storage: ' + e.message, true); S.stTimer = setTimeout(loadStorage, 15000); }
	}
}

/* ---------- system sub pages ------------------------------------------------ */

const STEP_NAMES = ['Download', 'Verify', 'Ready', 'Write', 'Restart'];
// flashing sub-steps reported by shareos-update -> [place of the bar, label].
// The updater reports the step it is in, not a measured share: the page says
// "step 3 of 8" and the bar only shows how far down the list that is.
const FLASH_STEPS = {
	'check bundle': [5, 'Checking the package again'],
	'stage rootfs': [20, 'Preparing the system for the restart'],
	'erase ramdisk': [45, 'Boot system: erasing flash'],
	'write ramdisk': [50, 'Writing the boot system'],
	'verify ramdisk': [58, 'Checking the boot system'],
	'erase uImage': [64, 'Kernel: erasing flash'],
	'write uImage': [72, 'Writing the kernel'],
	'verify uImage': [88, 'Checking the kernel']
};
function stepIndex(state) {
	return { downloading: 0, verifying: 1, ready: 2, flashing: 3, flashed: 4 }[state] ?? -1;
}

const SYS = {
	firmware() {
		const i = S.info || {}, u = S.upd || {}, c = S.check;
		const cur = i.release?.version || u.current || '–';
		const latest = c?.releases?.[0];
		const busy = ['downloading', 'verifying', 'flashing'].includes(u.state);
		const si = stepIndex(u.state);
		const prog = u.state === 'downloading' && u.progress?.total ? pct(u.progress.bytes, u.progress.total) : null;
		const bootOk = i.boot === 'flash';
		return html`
		${(u.pending_reboot || u.state === 'flashed') && !busy ? html`<div class="banner">${svg(I.reboot)}<span style="flex:1;min-width:240px"><b>Reboot needed</b> – the new system is installed on the next start (about 1 minute, do not switch off the box).</span><button class="btn primary" type="button" data-act="reboot">Reboot now</button></div>` : ''}
		${u.last_upgrade ? html`<div class="banner" style="${u.last_upgrade.startsWith('ok') ? 'border-color:var(--dim)' : ''}">${svg(u.last_upgrade.startsWith('ok') ? I.ok : I.warn)}<span style="flex:1">Last update: <b>${u.last_upgrade.startsWith('ok') ? 'installed successfully (' + u.last_upgrade.slice(3) + ')' : u.last_upgrade}</b></span>${closeX('upd-ack')}</div>` : ''}
		${!bootOk && i.boot ? html`<div class="banner">${svg(I.warn)}<span>The box is not running from the flash right now (<b>${i.boot}</b>). Updates on this page only work after a normal start from the flash.</span></div>` : ''}
		<div class="split">
			<section class="main">
				<div class="panel">
					<div class="ph"><span class="pt">FIRMWARE UPDATE</span><span class="tag ml">Source: GitHub releases · ${c?.repo || 'UniqueDroid/ShareOS'}</span></div>
					<div class="ver">
						<div class="tile"><div class="k">Installed</div><div class="v">${cur}</div><div class="s">Kernel, initramfs and system</div></div>
						<span class="arrow" aria-hidden="true">→</span>
						<div class="tile"${c?.update_available ? raw(' style="border-color:color-mix(in srgb,var(--amber) 45%,transparent)"') : ''}>
							<div class="k">Latest · ${c ? (c.channel === 'beta' ? 'Beta' : 'Stable') : '–'}</div>
							<div class="v ${c?.update_available ? 'warn' : ''}">${latest ? latest.version : c ? 'none' : '?'}</div>
							<div class="s">${c ? (c.update_available ? 'Update available' : latest ? 'up to date' : 'no release for this device yet') : 'not checked yet'}</div></div>
					</div>
					${si >= 0 ? html`
						<div class="pt" style="margin:18px 0 8px">PROGRESS · ${u.release?.version || ''}</div>
						<div class="steps">${STEP_NAMES.map((n, k) => html`<div class="step ${k < si || u.state === 'flashed' ? 'done' : k === si ? 'act' : ''}"><div class="n">${k + 1}${k < si || (u.state === 'flashed' && k <= si) ? ' ✓' : k === si ? ' · RUNNING' : ''}</div>${n}</div>`)}</div>
						${prog != null ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:${prog.toFixed(0)}%"></i></div><p class="note">${fmtBytes(u.progress.bytes)} of ${fmtBytes(u.progress.total)}</p>` : ''}
						${u.state === 'verifying' ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Checking the bundle …</b> SHA-256 and contents, takes about half a minute.</p>` : ''}
						${u.state === 'flashing' ? (() => { const [fp, fl] = FLASH_STEPS[u.step] || [2, 'Starting'], fn = Object.keys(FLASH_STEPS).indexOf(u.step) + 1; return html`<div class="bar big busy" style="margin-top:12px"><i style="width:${fp}%"></i></div><p class="note"><b>${fl} …</b> (step ${fn || 1} of ${Object.keys(FLASH_STEPS).length}) – <b>do not switch off</b>, this takes about 1–2 minutes.</p>`; })() : ''}
						${u.state === 'flashed' ? html`<div class="bar big" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Installation finished</b> (100 %) – restart now.</p>` : ''}
						${u.state === 'ready' ? html`<div class="acts" style="margin-top:14px"><button class="btn primary" type="button" data-act="apply" data-tag="${u.release.tag}" data-ver="${u.release.version}" ${bootOk ? '' : 'disabled'}>Install ${svg(I.dl)}${u.release.version}</button><button class="btn ghost" type="button" data-act="cancel">Discard</button></div>
							<p class="note">${u.release.local ? (u.release.sha_checked ? 'Uploaded file – verified: SHA-256 of the .sha256 file, checksums of all parts, made for this device.' : 'Uploaded file – verified: checksums of all parts, made for this device (without .sha256 file).') : 'Verified: SHA-256, checksums of all parts, made for this device.'} Settings and packages are kept.</p>` : ''}`
					: ''}
					${u.state === 'error' ? html`<div class="banner" style="margin:16px 0 0">${svg(I.warn)}<span><b>Error:</b> ${u.error}</span><button class="btn sm ghost" type="button" data-act="cancel">OK</button></div>` : ''}
					<div class="fields" style="margin-top:18px">
						<label class="f"><span>UPDATE CHANNEL</span><select id="channel">
							<option value="stable"${(c?.channel || 'stable') === 'stable' ? raw(' selected') : ''}>Stable (releases)</option>
							<option value="beta"${c?.channel === 'beta' ? raw(' selected') : ''}>Beta (also pre-releases)</option></select></label>
					</div>
					<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="check" ${S.checking || busy ? 'disabled' : ''}>${S.checking ? 'Checking …' : 'Check now'}</button></div>
				</div>
				${c?.releases?.length ? html`<div>
					<h2 class="gh">VERSIONS <span>from GitHub</span></h2>
					<div class="tw"><table class="t" style="min-width:600px">
						<thead><tr><th>VERSION</th><th>DATE</th><th>CHANNEL</th><th>SIZE</th><th></th></tr></thead>
						<tbody>${(S.relAll ? c.releases : c.releases.slice(0, 3)).map((r) => html`<tr>
							<td><b>${r.version}</b></td><td>${fmtDate(r.date)}</td>
							<td><span class="tag">${r.prerelease ? 'BETA' : 'STABLE'}</span></td><td class="mut">${fmtBytes(r.size)}</td>
							<td>${r.version === cur ? html`<span class="tag ok">installed</span>`
								: html`<button class="btn sm${r.tag === latest?.tag ? '' : ' ghost'}" type="button" data-act="download" data-tag="${r.tag}" ${busy || !bootOk ? 'disabled' : ''}>Download</button>`}
								<a class="btn sm ghost" href="${r.url}" target="_blank" rel="noopener">Notes ↗</a></td></tr>`)}
						</tbody></table></div>
					${c.releases.length > 3 ? html`<div class="acts" style="margin-top:8px"><button class="btn sm ghost" type="button" data-act="rel-all">${S.relAll ? 'Show fewer' : `Show all (${c.releases.length})`}</button></div>` : ''}</div>` : ''}
				${latest?.notes ? html`<div class="panel"><div class="ph"><span class="pt">CHANGES IN ${latest.version}</span></div><pre class="notes">${latest.notes}</pre></div>` : ''}
			</section>
			<aside class="aside">
				<div class="panel">
					<div class="ph"><span class="pt">HOW AN UPDATE WORKS</span></div>
					<ol class="plan" style="padding-left:20px">
						<li>Download the bundle from GitHub and check it (SHA-256, device, sizes)</li>
						<li>Write kernel and initramfs to flash and read them back</li>
						<li>Stage the new system</li>
						<li>Reboot: the initramfs installs the system, then ShareOS starts again</li>
					</ol>
					<p class="note">Settings and installed packages are kept. If interrupted, the installation is repeated on the next boot.</p>
				</div>
				<form class="panel" id="f-bin" style="margin-top:16px">
					<div class="ph"><span class="pt">INSTALL FIRMWARE FILE</span><span class="tag ml">.tar · .bin</span></div>
					<p class="note" style="margin:0 0 10px"><b>Update without internet:</b> upload the .sysupgrade.tar of a ShareOS release, preferably with its .sha256 file. It is checked like an update from GitHub.</p>
					<p class="note" style="margin:0 0 10px">A firmware in D-Link format, e.g. for the <b>switch back to Alt-F</b>. Kernel and boot system are written; the ShareOS system and settings stay in flash.</p>
					<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>FILE</span><input type="file" name="file" accept=".tar,.bin" required></label>
						<label class="f"><span>CHECKSUM (.SHA256, OPTIONAL)</span><input type="file" name="sha" accept=".sha256,.txt"></label></div>
					<div id="bin-info"></div>
					<div class="acts" style="margin-top:12px"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${svg(I.ul)}Upload & check</button></div>
				</form>
			</aside>
		</div>`;
	},

	general() {
		const i = S.info || {};
		return html`<div class="acts" style="margin-bottom:16px"><button class="btn ghost" type="button" data-act="fr-again">Run first-time setup again</button></div>
		<h2 class="gh" style="margin-top:22px">BACK UP & RESTORE SETTINGS</h2>
		<div class="g2">
			<form class="panel" id="f-backup">
				<div class="ph"><span class="pt">BACK UP</span><span class="tag ml">JSON file</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>PASSWORD FOR ENCRYPTION (OPTIONAL)</span><input name="pw" type="password" minlength="6" autocomplete="new-password" placeholder="empty = not encrypted"></label></div>
				<div id="backup-keys">${backupKeys()}</div>
				<p class="note">Contains the box (network, name, time, drives, root password), users and groups (passwords as hashes), shares, the settings of the services and the list of installed apps. Without a password the file is readable – keep it safe. With a password: AES-256, the password is needed to restore.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">${svg(I.dl)}Download backup</button></div>
			</form>
			<form class="panel" id="f-restore">
				<div class="ph"><span class="pt">RESTORE</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>BACKUP FILE</span><input name="file" type="file" accept=".json,application/json" required></label>
					<label class="f"><span>PASSWORD (IF ENCRYPTED)</span><input name="pw" type="password" autocomplete="off"></label>
				</div>
				<div id="restore-preview"></div>
				<div class="acts" style="margin-top:12px"><button class="btn" type="submit">Verify</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">APP & WIDGETS</h2>
		<div class="g2">${appPanel()}${widgetPanel()}</div>
		<h2 class="gh" style="margin-top:22px">DEVICE & ACCESS</h2>
		<div class="g2">
			<form class="panel" id="f-host">
				<div class="ph"><span class="pt">DEVICE NAME</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>HOSTNAME</span><input name="hostname" value="${i.hostname || ''}" pattern="[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?" required></label></div>
				<p class="note">Letters, digits and hyphens. Applies at once; the DHCP server sees it on the next lease renewal.</p>
				<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
			</form>
			<form class="panel" id="f-pass">
				<div class="ph"><span class="pt">ACCESS · ${S.user}</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>NEW PASSWORD</span><input name="p1" type="password" minlength="6" autocomplete="new-password" required></label>
					<label class="f"><span>REPEAT</span><input name="p2" type="password" minlength="6" autocomplete="new-password" required></label>
				</div>
				<p class="note">Applies to the web interface and SSH. At least 6 characters.</p>
				<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Change password</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">ABOUT</h2>
		${SYS.about()}`;
	},

	notifications() {
		const n = S.notes, c = S.noteCfg;
		if (!n || !c) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const de = LANG === 'de', when = (t) => fmtTime(t);
		const LV = { error: ['err', 'ERROR'], warn: ['warn', 'WARNING'], info: ['', 'INFO'] };
		const lvSel = (name, v) => html`<select name="${name}">${[['info', 'everything (info, warning, error)'], ['warn', 'warnings and errors'], ['error', 'errors only']].map(([k, t]) => html`<option value="${k}"${(v || 'warn') === k ? raw(' selected') : ''}>${t}</option>`)}</select>`;
		return html`<div class="split">
			<section class="main">
				<h2 class="gh">MESSAGES <span>${n.unread} unread</span></h2>
				${n.items.length ? html`<div class="acts" style="margin:0 0 12px"><button class="btn sm" type="button" data-act="note-read" data-id="all" ${n.unread ? '' : 'disabled'}>Mark all as read</button>
					<button class="btn sm ghost" type="button" data-act="note-del" data-id="all">Delete all</button></div>
				<div class="notelist">${n.items.map((x) => html`<div class="panel note-item${x.read || x.resolved ? ' read' : ''}">
					<div class="ph" style="gap:8px"><span class="tag ${x.resolved ? 'ok' : LV[x.level]?.[0] || ''}">${x.resolved ? 'RESOLVED' : LV[x.level]?.[1] || x.level}</span>
						<b class="name" style="font-size:14px">${de ? x.title_de : x.title_en}</b>${x.count > 1 ? html`<span class="tag">${x.count}×</span>` : ''}
						<span class="ml mut" style="font-size:12px">${when(x.last)}</span></div>
					${(de ? x.text_de : x.text_en) ? html`<p class="mut" style="margin:6px 0 0;font-size:13px">${de ? x.text_de : x.text_en}</p>` : ''}
					<div class="acts" style="margin-top:10px">${x.read || x.resolved ? '' : html`<button class="btn sm" type="button" data-act="note-read" data-id="${x.id}">Read</button>`}
						<button class="btn sm ghost" type="button" data-act="note-del" data-id="${x.id}">Delete</button></div></div>`)}</div>`
				: html`<div class="panel"><div class="empty">${svg(I.ok)}<span>No messages.</span></div></div>`}
				<p class="note">Every 10 minutes the box checks RAID, volumes (mounted, how full), temperature, SMART values (read again every 6 hours; a sleeping disk is not woken up) and updates; failed cloud jobs, app tasks and storage jobs report at once. Repeated messages are counted and sent again at most once a day.</p>
			</section>
			<aside class="aside">
				<form class="panel" id="f-notify">
					<div class="ph"><span class="pt">E-MAIL</span></div>
					<label class="chk"><input type="checkbox" name="email"${c.email ? raw(' checked') : ''}><span>Send messages by e-mail</span></label>
					<div class="fields" style="grid-template-columns:1fr;margin-top:10px">
						<label class="f"><span>MAIL SERVER (SMTP)</span><input name="smtp_host" value="${c.smtp_host}" placeholder="smtp.example.org" autocomplete="off"></label>
						<label class="f"><span>ENCRYPTION</span><select name="smtp_tls">${[['starttls', 'STARTTLS (port 587)'], ['ssl', 'SSL/TLS (port 465)'], ['none', 'none (port 25)']].map(([k, t]) => html`<option value="${k}"${(c.smtp_tls || 'starttls') === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
						<label class="f"><span>PORT (EMPTY = DEFAULT)</span><input name="smtp_port" value="${c.smtp_port}" inputmode="numeric"></label>
						<label class="f"><span>USER</span><input name="smtp_user" value="${c.smtp_user}" autocomplete="off"></label>
						<label class="f"><span>PASSWORD</span><input name="smtp_pass" type="password" autocomplete="new-password" placeholder="${c.has_pass ? '•••••• (saved)' : ''}"></label>
						<label class="f"><span>SENDER</span><input name="mail_from" value="${c.mail_from}" placeholder="nas@example.org"></label>
						<label class="f"><span>RECIPIENTS (SEPARATE WITH COMMAS)</span><input name="mail_to" value="${c.mail_to}" placeholder="ich@example.org"></label>
						<label class="f"><span>SEND</span>${lvSel('email_level', c.email_level)}</label>
					</div>
					<div class="ph" style="margin-top:18px"><span class="pt">PUSH</span></div>
					<label class="chk"><input type="checkbox" name="push"${c.push ? raw(' checked') : ''}><span>Send messages to the phone</span></label>
					<div class="fields" style="grid-template-columns:1fr;margin-top:10px">
						<label class="f"><span>SERVICE</span><select name="push_type">${[['ntfy', 'ntfy'], ['gotify', 'Gotify'], ['telegram', 'Telegram (bot)'], ['webhook', 'Webhook (JSON)']].map(([k, t]) => html`<option value="${k}"${(c.push_type || 'ntfy') === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
						<label class="f" data-push="url"${c.push_type === 'telegram' ? raw(' hidden') : ''}><span>ADDRESS</span><input name="push_url" value="${c.push_url}" placeholder="https://ntfy.sh/my-nas-topic"></label>
						<label class="f"><span data-push="url"${c.push_type === 'telegram' ? raw(' hidden') : ''}>ACCESS TOKEN (OPTIONAL)</span><span data-push="tg"${c.push_type === 'telegram' ? '' : raw(' hidden')}>BOT TOKEN (FROM @BOTFATHER)</span><input name="push_token" type="password" autocomplete="new-password" placeholder="${c.has_token ? '•••••• (saved)' : ''}"></label>
						<label class="f" data-push="tg"${c.push_type === 'telegram' ? '' : raw(' hidden')}><span>CHAT ID</span><span class="row" style="display:flex;gap:6px"><input name="push_chat" value="${c.push_chat || ''}" placeholder="123456789" style="flex:1"><button class="btn sm ghost" type="button" data-act="tg-chats">Find chat ID</button></span></label>
						<label class="f"><span>SEND</span>${lvSel('push_level', c.push_level)}</label>
					</div>
					<p class="note">ntfy: address with topic, e.g. <code>https://ntfy.sh/my-nas-7f3k</code> (an own ntfy server works too), subscribe to the same topic in the ntfy app. Gotify: server address and app token.</p>
					<p class="note">Telegram: create a bot with @BotFather in Telegram (/newbot), enter the token here and save. Then send your bot a message (or add it to a group) and click “Find chat ID”.</p>
					<div class="ph" style="margin-top:18px"><span class="pt">LIMITS</span></div>
					<div class="fields">
						<label class="f"><span>TEMPERATURE FROM (°C)</span><input name="temp_max" type="number" min="40" max="70" value="${c.temp_max}"></label>
						<label class="f"><span>VOLUME FULL FROM (%)</span><input name="disk_full" type="number" min="50" max="99" value="${c.disk_full}"></label>
					</div>
					<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="note-test">Test message</button></div>
				</form>
			</aside>
		</div>`;
	},

	time() {
		const t = S.time;
		if (!t) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const zones = S.zones || [t.timezone];
		const last = t.last_sync ? new Date(t.last_sync * 1000).toLocaleString(LOC, { timeZone: tzSafe(t.timezone), dateStyle: 'short', timeStyle: 'short' }) : null;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">TIME ON THE BOX</span><span class="tag ml">${t.timezone}</span></div>
				<div id="clock-now" class="name" style="font-size:30px;letter-spacing:.04em;margin:6px 0 2px">${boxTime(t)}</div>
				<div id="clock-date" class="mut" style="font-size:13px">${boxDate(t)}</div>
				<dl class="kv" style="margin-top:14px">
					<dt>Time sync</dt><dd>${t.ntp ? (t.ntp_running ? 'from the internet (NTP)' : html`<span style="color:var(--amber)">NTP switched on but not running</span>`) : 'by hand'}</dd>
					<dt>Last synced</dt><dd>${last || (t.ntp ? 'not yet' : '–')}</dd>
					${t.rtc ? html`<dt>Battery clock</dt><dd>${t.rtc_ok === false ? html`<span style="color:var(--amber)">could not be set at the last sync</span>` : 'is set after every sync'}</dd>` : ''}
				</dl>
				<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="time-sync">${svg(I.reboot)}Sync now</button></div>
			</div>
			<form class="panel" id="f-time">
				<div class="ph"><span class="pt">TIME ZONE & TIME SERVERS</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>TIME ZONE</span><select name="tz">${zones.map((z) => html`<option value="${z}"${z === t.timezone ? raw(' selected') : ''}>${z.replace(/_/g, ' ')}</option>`)}</select></label>
					<label class="chk"><input type="checkbox" name="ntp"${t.ntp ? raw(' checked') : ''}><span>Get the time from the internet automatically (NTP)</span></label>
					<label class="f"><span>TIME SERVERS (ONE PER LINE, AT MOST 5)</span><textarea name="servers" rows="4" spellcheck="false">${t.servers.join('\n')}</textarea></label>
				</div>
				<p class="note">In a home network the router can be the time server too, e.g. <code>fritz.box</code>. The time zone applies to logs, schedules and the display.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
			</form>
		</div>
		<form class="panel" id="f-clock" style="margin-top:16px">
			<div class="ph"><span class="pt">SET THE CLOCK BY HAND</span></div>
			<div class="fields">
				<label class="f"><span>DATE AND TIME (${t.timezone})</span><input name="dt" type="datetime-local" step="1" value="${localInput(t)}" required></label>
			</div>
			<p class="note">${t.ntp ? 'While NTP is on, the box sets the clock from the internet again at the next sync. For a box without internet, switch NTP off above.' : 'The clock keeps running from there; the box\'s battery clock is set too.'}</p>
			<div class="acts" style="margin-top:12px">
				<button class="btn ghost" type="button" data-act="time-browser">Take this device's time</button>
				<button class="btn primary" type="submit">Set time</button>
			</div>
		</form>`;
	},

	hardware() {
		const h = S.hw;
		if (!h) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const f = h.fan, l = h.led;
		// the temperatures of the presets come from the box (one list for the
		// fan control and this page)
		const pd = (id) => { const p = h.presets?.[id]; return !p ? '' : p.off_temp ? `Fan stops below ${p.off_temp} °C, full from ${p.full_temp} °C` : `Fan always on, full from ${p.full_temp} °C`; };
		const presets = [['quiet', 'Quiet', pd('quiet')], ['balanced', 'Balanced', pd('balanced')],
			['cool', 'Cool', pd('cool')], ['custom', 'Custom values', 'Set the temperatures yourself']];
		const sel = (id, cur, opts) => html`<select id="${id}">${opts.map(([v, t2]) => html`<option value="${v}"${cur === v ? raw(' selected') : ''}>${t2}</option>`)}</select>`;
		return html`<div class="g2">
			<form class="panel" id="f-fan">
				<div class="ph"><span class="pt">FAN</span><span class="tag ml" id="fan-now">${fanNow()}</span></div>
				<div style="display:grid;gap:8px">${presets.map(([id, name, d]) => html`
					<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px"><input type="radio" name="preset" value="${id}"${f.preset === id ? raw(' checked') : ''} style="accent-color:var(--accent);margin-top:3px">
						<span><b>${name}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
				<div class="fields" id="fan-custom" style="margin-top:14px"${f.preset === 'custom' ? '' : raw(' hidden')}>
					<label class="f"><span>OFF BELOW (°C, 0 = NEVER)</span><input name="off_temp" type="number" min="0" max="65" value="${f.off_temp}"></label>
					<label class="f"><span>FULL FROM (°C)</span><input name="full_temp" type="number" min="35" max="70" value="${f.full_temp}"></label>
					<label class="f"><span>BACK TO HALF BELOW (°C)</span><input name="half_temp" type="number" min="30" max="69" value="${f.half_temp}"></label>
				</div>
				<p class="note">The box runs the fan in three steps (off, half, full) according to the board temperature. Changes apply within seconds.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">LEDS</span><span class="tag ml">applies at once</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>STATUS LED (BLUE)</span>${sel('led-status', l.status, [['heartbeat', 'Heartbeat (ShareOS running)'], ['on', 'on'], ['off', 'off']])}</label>
					<label class="f"><span>POWER LED</span>${sel('led-power', l.power, [['on', 'on'], ['blink', 'blinking'], ['off', 'off']])}</label>
					<label class="f"><span>DISK LEDS (RED)</span>${sel('led-disks', l.disks, [['off', 'off'], ['activity', 'Show disk access']])}</label>
				</div>
				<p class="note">The orange USB LED shows rescue mode and updates during boot and cannot be changed.</p>
			</div>
		</div>`;
	},

	https() {
		const w = S.web;
		if (!w) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const c = w.cert || {};
		const name = w.host || w.cert_host || '';
		const host = name || location.hostname;
		const viaOther = name && location.protocol === "https:" && location.hostname !== name;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">CONNECTION</span><span class="tag ml ${location.protocol === 'https:' ? 'ok' : 'warn'}">${location.protocol === 'https:' ? 'this page: HTTPS' : 'this page: HTTP'}</span></div>
				<div style="display:grid;gap:6px">
					<label class="chk"><input type="checkbox" id="opt-https"${w.https ? raw(' checked') : ''}>HTTPS on port 443</label>
					<label class="chk"><input type="checkbox" id="opt-redirect"${w.redirect ? raw(' checked') : ''}${w.https ? '' : raw(' disabled')}>Redirect HTTP requests to HTTPS</label>
				</div>
				<dl class="kv" style="margin-top:14px">
					<dt>HTTPS</dt><dd><a href="https://${host}/">https://${host}/</a></dd>
					<dt>HTTP</dt><dd><a href="http://${host}/">http://${host}/</a></dd>
				</dl>
				${viaOther ? html`<p class="note">This page is opened via ${location.hostname}. Without a certificate warning: <a href="${location.protocol}//${name}/#/system/network">${location.protocol}//${name}/</a></p>` : ''}
				<form id="f-webhost" style="margin-top:14px">
					<label class="f"><span>BOX NAME FOR LINKS (E.G. TO THE APPS)</span>
						<input name="host" value="${w.host || ''}" placeholder="${w.cert_host || location.hostname}" autocomplete="off" spellcheck="false"></label>
					<p class="note">Leave empty: with your own certificate the name is taken from it, otherwise the address this page was opened with. The name must resolve in your network (DNS).</p>
					<div class="acts" style="margin-top:8px"><button class="btn" type="submit">Save name</button></div>
				</form>
				<p class="note">After a change the web server restarts; the page is unreachable for a moment.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">CERTIFICATE</span>${c.none ? '' : c.selfsigned ? html`<span class="tag warn ml">self-signed</span>` : w.source === 'ca' ? html`<span class="tag ok ml">own CA</span>` : w.source === 'acme' ? html`<span class="tag ok ml">Let's Encrypt</span>` : html`<span class="tag ok ml">own certificate</span>`}</div>
				${c.none ? html`<p class="mut" style="margin:0;font-size:13px">No certificate yet – one is created automatically when HTTPS is switched on.</p>` : html`
				<dl class="kv">
					<dt>Issued to</dt><dd>${c.subject || '–'}</dd>
					<dt>Issuer</dt><dd>${c.issuer || '–'}</dd>
					<dt>Valid from</dt><dd>${c.from || '–'}</dd>
					<dt>Valid until</dt><dd>${c.until || '–'}</dd>
					<dt>Names</dt><dd>${(c.san || []).map((x) => x.replace(/^(dNSName|iPAddress):/, '')).join(', ') || '–'}</dd>
				</dl>`}
				${c.selfsigned ? html`<p class="note">Browsers warn once about self-signed certificates. The connection is encrypted anyway; for a page without a warning, upload your own certificate (e.g. from your intranet CA or Let's Encrypt).</p>` : ''}
				<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="cert-self">New self-signed certificate</button></div>
			</div>
		</div>
		<form class="panel" id="f-cert" style="margin-top:16px">
			<div class="ph"><span class="pt">UPLOAD YOUR OWN CERTIFICATE</span></div>
			<div class="g2">
				<label class="f"><span>CERTIFICATE (PEM, INTERMEDIATES WELCOME)</span>
					<textarea name="cert" rows="8" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----" style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" data-i18n-skip></textarea>
					<input type="file" accept=".pem,.crt,.cer" data-target="cert" style="margin-top:6px"></label>
				<label class="f"><span>PRIVATE KEY (PEM, NO PASSWORD)</span>
					<textarea name="key" rows="8" spellcheck="false" placeholder="-----BEGIN PRIVATE KEY-----" style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" data-i18n-skip></textarea>
					<input type="file" accept=".pem,.key" data-target="key" style="margin-top:6px"></label>
			</div>
			<p class="note">Before it is used, the box checks that certificate and key belong together. The key never leaves the box.</p>
			<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Use certificate</button></div>
		</form>`;
	},

	power() {
		return html`<h2 class="gh">POWER & RESET</h2><div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">POWER</span></div>
				<div class="acts"><button class="btn" type="button" data-act="reboot">${svg(I.reboot)}Restart</button>
					<button class="btn danger" type="button" data-act="poweroff">${svg(I.power)}Power off</button></div>
				<p class="note">Powering off shuts ShareOS down and the board control cuts the power. Switch on with the power button.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">FACTORY RESET</span><span class="tag err ml">erases settings</span></div>
				<p class="mut" style="margin:0 0 12px;font-size:13px">Removes all settings and installed packages from flash and reboots. The system and firmware version stay. Afterwards the box has no password: press the USB button on its front, then choose a new one in the web interface.</p>
				<button class="btn danger" type="button" data-act="factory">Reset to factory settings</button>
			</div>
		</div>
		<h2 class="gh" style="margin-top:22px">SCHEDULE</h2>
		${powerSchedule()}
		<h2 class="gh" style="margin-top:22px">FAN & LEDS</h2>
		${SYS.hardware()}`;
	},

	network() {
		const n = S.net, i = S.info || {}, e = i.network?.eth0 || {};
		if (!n) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const st = n.proto === 'static';
		// prefill the static fields with what DHCP gave, so switching is easy
		const cur = e.ipv4 ? e.ipv4.address : '';
		const curMask = e.ipv4 ? prefixMask(e.ipv4.prefix) : '255.255.255.0';
		const v = (k, d) => (st ? n[k] : '') || d;
		return html`
		${n.pending ? html`<div class="banner">${svg(I.warn)}<span style="flex:1;min-width:240px"><b>New network settings are waiting for confirmation</b> – without confirmation the box returns to the old ones in ${n.pending.left} s.</span><button class="btn primary" type="button" data-act="net-confirm">Keep</button></div>` : ''}
		${n.result === 'rolledback' && !n.pending ? html`<div class="banner">${svg(I.warn)}<span style="flex:1">The last change was not confirmed; the previous network settings are active again.</span>${closeX('net-dismiss')}</div>` : ''}
		<h2 class="gh">NETWORK <span>eth0 · ${e.speed ? e.speed + ' Mbit/s' : 'no link'}</span></h2>
		<div class="g2">
			<form class="panel" id="f-net">
				<div class="ph"><span class="pt">IPV4</span><span class="tag ml">${st ? 'static' : 'DHCP'}</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>ADDRESS</span><select name="proto" id="net-proto">
					<option value="dhcp"${st ? '' : raw(' selected')}>Automatic (DHCP) – from the router</option>
					<option value="static"${st ? raw(' selected') : ''}>Static address</option></select></label></div>
				<div class="fields" id="net-static" style="margin-top:14px"${st ? '' : raw(' hidden')}>
					<label class="f"><span>IP ADDRESS</span><input name="ipaddr" value="${v('ipaddr', cur)}" inputmode="decimal" placeholder="192.168.1.20"></label>
					<label class="f"><span>SUBNET MASK</span><input name="netmask" value="${v('netmask', curMask)}" inputmode="decimal" placeholder="255.255.255.0"></label>
					<label class="f"><span>GATEWAY</span><input name="gateway" value="${v('gateway', e.gateway || '')}" inputmode="decimal" placeholder="192.168.1.1"></label>
					<label class="f"><span>DNS SERVERS (COMMA-SEPARATED)</span><input name="dns" value="${st ? (n.dns || []).join(', ') : (e.dns || []).join(', ')}" inputmode="decimal" placeholder="192.168.1.1"></label>
				</div>
				<p class="note">The change takes effect at once. The box then waits ${n.timeout || 120} seconds for a confirmation from the new address – if none comes, it restores the previous settings. So you cannot lock yourself out.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit" ${n.pending ? 'disabled' : ''}>Apply</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">CURRENT</span><span class="tag ml ${e.ipv4 ? 'ok' : 'warn'}">${e.ipv4 ? 'connected' : 'no address'}</span></div>
				<dl class="kv">
					<dt>IPv4</dt><dd>${e.ipv4 ? `${e.ipv4.address} / ${e.ipv4.prefix}` : '–'}</dd>
					<dt>Gateway</dt><dd>${e.gateway || '–'}</dd>
					<dt>DNS</dt><dd>${(e.dns || []).join(', ') || '–'}</dd>
					<dt>MAC</dt><dd>${e.mac || '–'}</dd>
					<dt>Connection</dt><dd>${e.speed ? e.speed + ' Mbit/s' : '–'}</dd>
					<dt>Device name</dt><dd>${i.hostname || '–'} <a href="#/system/general" style="font-size:12px">change</a></dd>
				</dl>
			</div>
		</div>
		<h2 class="gh" style="margin-top:22px">HTTPS & CERTIFICATE</h2>
		${SYS.https()}
		<h2 class="gh" style="margin-top:22px">DYNDNS</h2>
		${SYS.ddns()}
		<h2 class="gh" style="margin-top:22px">OWN CERTIFICATES</h2>
		${SYS.ca()}`;
	},

	// dynamic DNS: a name on the internet for the box (shareos-ddns)
	ddns() {
		const d = S.ddns;
		if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const p = S.ddnsProv ?? d.provider ?? '', l = d.last;
		const ok = d.enabled && l?.ok, err = d.enabled && l && !l.ok;
		const opt = (v, t) => html`<option value="${v}"${p === v ? raw(' selected') : ''}>${t}</option>`;
		const hostPh = { duckdns: 'meinebox.duckdns.org', dynv6: 'meinebox.dynv6.net', cloudflare: 'nas.example.org', noip: 'meinebox.ddns.net', custom: 'nas.example.org' }[p] || 'meinebox.duckdns.org';
		return html`<div class="g2">
			<form class="panel" id="f-ddns">
				<div class="ph"><span class="pt">PROVIDER</span><span class="tag ml ${d.enabled ? 'ok' : ''}">${d.enabled ? 'active' : 'off'}</span></div>
				<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Update dynamic DNS</label>
				<div class="fields" style="grid-template-columns:1fr;margin-top:12px">
					<label class="f"><span>PROVIDER</span><select name="provider" id="ddns-prov">
						${opt('', '– choose –')}${opt('duckdns', 'DuckDNS')}${opt('dynv6', 'dynv6')}${opt('cloudflare', 'Cloudflare')}${opt('noip', 'No-IP')}${opt('custom', 'Own URL (dyndns2)')}</select></label>
					<label class="f"><span>NAME</span><input name="host" value="${d.host || ''}" placeholder="${hostPh}" autocomplete="off" spellcheck="false"></label>
					<label class="f"${p === 'noip' || p === 'custom' ? '' : raw(' hidden')}><span>USER</span><input name="user" value="${d.user || ''}" autocomplete="off" spellcheck="false"></label>
					<label class="f"><span>${p === 'cloudflare' ? 'API TOKEN (ZONE:READ, DNS:EDIT)' : p === 'noip' || p === 'custom' ? 'PASSWORD' : 'TOKEN'}</span>${d.token_set ? html`<input name="token" type="password" placeholder="saved – leave empty to keep it" autocomplete="new-password">` : html`<input name="token" type="password" autocomplete="new-password">`}</label>
					<label class="f"${p === 'custom' ? '' : raw(' hidden')}><span>UPDATE URL ({host} {ip} {ip6})</span><input name="url" value="${d.url || ''}" placeholder="https://dyndns.example.net/nic/update?hostname={host}&amp;myip={ip}" autocomplete="off" spellcheck="false"></label>
				</div>
				<div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
					<label class="chk"><input type="checkbox" name="ipv4"${d.ipv4 !== false ? raw(' checked') : ''}>IPv4</label>
					<label class="chk"><input type="checkbox" name="ipv6"${d.ipv6 ? raw(' checked') : ''}>IPv6</label>
				</div>
				<p class="note">The box reports its public address every 5 minutes when it has changed. Many connections (DS-Lite, fibre, mobile) have no IPv4 address of their own – then use IPv6. For access from outside, the router has to forward the port (or open it for IPv6).</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button>
					${d.enabled ? html`<button class="btn" type="button" data-act="ddns-now">Refresh now</button>` : ''}</div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">HEALTH</span>${ok ? html`<span class="tag ok ml">up to date</span>` : err ? html`<span class="tag err ml">Error</span>` : ''}</div>
				${d.enabled && l ? html`<dl class="kv">
					<dt>Name</dt><dd>${l.host || d.host || '–'}</dd>
					<dt>IPv4</dt><dd>${l.ip4 || '–'}</dd>
					<dt>IPv6</dt><dd style="word-break:break-all">${l.ip6 || '–'}</dd>
					<dt>Last reported</dt><dd>${fmtTime(l.sent)}</dd>
					<dt>Last checked</dt><dd>${fmtTime(l.checked)}</dd>
				</dl>
				${err ? html`<p class="note" style="color:var(--red)">${l.error}</p>` : ''}`
				: html`<p class="mut" style="margin:0;font-size:13px">${d.enabled ? 'Not reported yet – coming shortly.' : 'Dynamic DNS is off.'}</p>`}
			</div>
		</div>`;
	},

	// own certificate authority and Let's Encrypt
	ca() {
		const c = S.ca, a = S.acme || {}, d = S.ddns || {};
		if (!c) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const leOk = d.enabled && (d.provider === 'duckdns' || d.provider === 'cloudflare') && d.host;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">CERTIFICATE AUTHORITY (CA)</span>${c.web ? html`<span class="tag ok ml">this box uses it</span>` : ''}</div>
				${c.exists ? html`<dl class="kv">
					<dt>Name</dt><dd>${c.subject || '–'}</dd>
					<dt>Valid until</dt><dd>${c.until || '–'}</dd>
					<dt>Fingerprint</dt><dd style="word-break:break-all;font-size:11px">${c.fingerprint || '–'}</dd>
				</dl>
				<div class="acts" style="margin-top:14px">
					<button class="btn" type="button" data-act="ca-root">${svg(I.dl)}Root certificate</button>
					<button class="btn${c.web ? '' : ' primary'}" type="button" data-act="ca-web">${c.web ? 'Reissue the box certificate' : 'Use for this box'}</button>
				</div>
				<p class="note">Install the root certificate once on PC and phone as trusted (Windows: double-click → “Trusted Root Certification Authorities”, Android/iOS: Settings → Security). After that all certificates of this CA work without a warning – for the box and other devices in the home network.</p>`
				: html`<p class="mut" style="margin:0 0 12px;font-size:13px">An own certificate authority issues certificates for the box and other devices in the home network (e.g. <code>*.home.lan</code>). Its root certificate is installed once on the devices – after that there are no more certificate warnings.</p>
				<div class="acts"><button class="btn primary" type="button" data-act="ca-init">Create certificate authority</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">LET'S ENCRYPT</span>${a.active ? html`<span class="tag ok ml">active${a.staging ? ' (Test)' : ''}</span>` : ''}</div>
				${a.running ? html`<div class="empty" style="padding:8px 0"><div class="spin" style="margin:0"></div><span>Getting the certificate – this takes up to 3 minutes …</span></div>`
				: a.active ? html`<dl class="kv"><dt>Name</dt><dd>${a.name || '–'}</dd><dt>Valid until</dt><dd>${a.until || '–'}</dd></dl>
					<p class="note">Checked daily and renewed 30 days before it expires.</p>
					<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="acme-off">Switch off</button></div>`
				: leOk ? html`<form id="f-acme">
					<p class="mut" style="margin:0 0 12px;font-size:13px">A certificate for <b>${d.provider === 'duckdns' && !/\.duckdns\.org$/.test(d.host) ? d.host + '.duckdns.org' : d.host}</b>, trusted by all browsers. The check runs through a DNS record at the dynamic DNS provider – no port has to be open.</p>
					<label class="f"><span>E-MAIL (OPTIONAL, FOR NOTICES FROM LET'S ENCRYPT)</span><input name="email" type="email" value="${a.email || ''}" autocomplete="off"></label>
					<label class="chk" style="margin-top:10px"><input type="checkbox" name="staging">Test mode (test CA, browsers warn)</label>
					<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Get certificate</button></div>
				</form>`
				: html`<p class="mut" style="margin:0;font-size:13px">Needs dynamic DNS with DuckDNS or Cloudflare (above).</p>`}
				${a.error && !a.running ? html`<p class="note" style="color:var(--red)">${a.error}</p>` : ''}
			</div>
		</div>
		${c.exists ? html`<form class="panel" id="f-ca-issue" style="margin-top:16px">
			<div class="ph"><span class="pt">CERTIFICATE FOR ANOTHER DEVICE</span></div>
			<div class="fields">
				<label class="f"><span>NAME</span><input name="name" placeholder="router" autocomplete="off" spellcheck="false" maxlength="63"></label>
				<label class="f"><span>HOST NAMES AND IP ADDRESSES (COMMA-SEPARATED)</span><input name="hosts" placeholder="router.home.lan, 192.168.1.1" autocomplete="off" spellcheck="false"></label>
			</div>
			<p class="note">Valid for 825 days. Wildcards such as <code>*.home.lan</code> are possible too. Download certificate and key and enter them in the device.</p>
			<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Issue</button></div>
			${c.certs?.length ? html`<div class="tw" style="margin-top:16px"><table class="t" style="min-width:560px"><thead><tr><th>NAME</th><th>HOST NAMES</th><th>VALID UNTIL</th><th></th></tr></thead><tbody>
				${c.certs.map((x) => html`<tr><td>${x.name}</td><td style="word-break:break-all">${x.hosts.join(', ')}</td><td>${x.until}</td>
					<td style="white-space:nowrap"><button class="btn sm ghost" type="button" data-act="ca-dl" data-id="${x.name}" data-kind="crt">Certificate</button><button class="btn sm ghost" type="button" data-act="ca-dl" data-id="${x.name}" data-kind="key">Key</button><button class="btn sm ghost" type="button" data-act="ca-del" data-id="${x.name}">Delete</button></td></tr>`)}
			</tbody></table></div>` : ''}
		</form>` : ''}`;
	},

	terminal() {
		const t = S.term;
		if (!S.sysapps) { S.sysapps = []; rpc('shareos.apps', 'installed', {}).then((r) => { S.sysapps = (r.apps || []).filter((a) => a.type === 'system'); if (S.sysapps.length && !S.term) renderMain(); }).catch(() => {}); }
		return html`<div class="panel">
			<div class="ph"><span class="pt">TERMINAL</span><span class="tag warn ml">root</span>
				${t ? html`<button class="btn sm ghost" type="button" data-act="term-window">In its own window ↗</button><button class="btn sm ghost" type="button" data-act="term-close">End</button>` : ''}</div>
			${t?.window ? html`<p class="mut" style="margin:0 0 12px">The terminal runs in its own window.</p>
				<div class="acts"><button class="btn" type="button" data-act="term-open">Show here</button></div>`
			: t ? html`<iframe class="termframe" src="${termUrl(t)}" title="Terminal" allow="clipboard-read; clipboard-write"></iframe>`
				: html`<p class="mut" style="margin:0 0 12px">A shell as <b>root</b> right on the box – for diagnosis and manual work (BusyBox, uci, logread, mdadm, smartctl …).</p>
				${sysApps().length ? html`<p class="mut" style="margin:0 0 12px"><span>From system apps:</span> ${sysApps().map((a, i) => html`${i ? ' · ' : ''}${sysCmds(a)}`)}</p>` : ''}
				<div class="acts"><button class="btn primary" type="button" data-act="term-open">Open terminal</button><button class="btn" type="button" data-act="term-window">In its own window ↗</button></div>`}
			<p class="note">The session is for one window and ends when it is closed – a window of its own gets a new session. Careful: commands as root take effect at once and without a trash.</p>
		</div>`;
	},

	logs() {
		return html`<div class="panel">
			<div class="ph"><span class="pt">LOG</span>
				<div class="acts ml"><select id="log-src" class="btn sm ghost" aria-label="Source">${[['system', 'System (syslog)'], ['kernel', 'Kernel (dmesg)'], ...(S.bootlogs || []).map((l) => ['boot:' + l.name, 'Start log ' + bootlogTime(l.name)])].map(([v, t]) => html`<option value="${v}"${S.logSrc === v ? raw(' selected') : ''}>${t}</option>`)}</select>
				<button class="btn sm" type="button" data-act="log">Refresh</button></div></div>
			<pre class="logbox" id="logbox">loading …</pre>
		</div>`;
	},

	appearance() {
		const names = ACCENT_NAMES;
		return html`<div class="lookcols"><div class="panel" style="max-width:560px">
			<div class="ph"><span class="pt">APPEARANCE</span><span class="tag ml">applies to everyone</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>LIGHT OR DARK</span><select id="opt-theme">
				${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Same as the operating system (automatic)']].map(([v, t]) => html`<option value="${v}"${S.theme === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<div class="pt" style="margin:14px 0 8px">ACCENT COLOUR</div>
			<div class="row">${Object.keys(names).map((c) => html`<button class="sw c-${c}${S.accent === c ? ' on' : ''}" type="button" data-act="accent" data-c="${c}" aria-label="Accent colour ${names[c]}" aria-pressed="${S.accent === c}" title="${names[c]}"><i></i></button>`)}</div>
			<p class="note">The logo and the browser icon take on the accent colour. The setting applies to everyone, including the login page.</p>
			<div style="display:grid;gap:6px;margin-top:14px">
				<label class="chk"><input type="checkbox" id="opt-scan"${S.scan ? raw(' checked') : ''}>Scanlines (this browser only)</label>
			</div>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">FAV APPS</span><span class="tag ml">just for you</span></div>
			<div style="display:grid;gap:6px">${favBarOpt()}</div>
			<p class="note">The star on an app tile makes it a favourite. The bar sits above “Status” in the overview and above the installed apps.</p>
		</div>
		${chipsPanel()}
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">LANGUAGE</span><span class="tag ml">applies to everyone</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>INTERFACE LANGUAGE</span><select id="opt-lang" data-i18n-skip>
				${(S.languages || [{ code: LANG, name: LANG }]).map((l) => html`<option value="${l.code}"${l.code === LANG ? raw(' selected') : ''}>${l.name}</option>`)}
			</select></label></div>
			<p class="note">More languages: one file in <code>/www/i18n/</code> – see docs/TRANSLATING.md.</p>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">AREAS</span><span class="tag ml">applies to everyone</span></div>
			<div style="display:grid;gap:6px">
				${[['apps', 'Apps (app store, web apps, app tasks)']].map(([k, t]) =>
					html`<label class="chk"><input type="checkbox" class="opt-area" data-area="${k}"${tabOn(k) ? raw(' checked') : ''}>${t}</label>`)}
			</div>
			<p class="note">Switched off: the tab disappears, also for users in “My ShareOS”, and the background work rests (apps web server and app tasks). Settings and data stay; switching on brings everything back.</p>
			<p class="note">Paperless, Cloud and the DNS filter are modules: their tab appears when they are installed under APPS and disappears when removed – settings and data stay.</p>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">LOGO</span><span class="tag ml">applies to everyone</span></div>
			<label class="chk"><input type="checkbox" id="opt-logo"${S.logo ? raw(' checked') : ''}>Show the ShareOS logo (off: text only)</label>
			<div style="margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--bg)">${brand()}</div>
		</div></div>`;
	},

	about() {
		const i = S.info || {}, r = i.release || {};
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SHAREOS</span></div>
				<dl class="kv">
					<dt>Version</dt><dd>${r.version || '–'}</dd>
					<dt>Stage</dt><dd>${r.stage || '–'}</dd>
					<dt>Device</dt><dd>${i.board?.name || i.model || '–'}${i.board?.id && i.board.id !== 'unknown' && !i.board.tested ? html` <span class="tag warn" title="ShareOS has not been tested on real hardware of this model yet.">not tested yet</span>` : ''}</dd>
					<dt>Firmware name</dt><dd>${i.board?.fwname || r.fwname || '–'}</dd>
					<dt>Kernel</dt><dd>Linux ${i.kernel || '–'}</dd>
					<dt>Booted from</dt><dd>${i.boot || '–'}</dd>
				</dl>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">PROJECT</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6">ShareOS is free firmware for D-Link NAS boxes, derived from Alt-F. Based on buildroot, Linux and BusyBox; operating model after OpenWrt (UCI, ubus, rpcd, ucode). Licence GPLv2.</p>
				<p class="note"><a href="https://github.com/UniqueDroid/ShareOS" target="_blank" rel="noopener">github.com/UniqueDroid/ShareOS ↗</a></p>
			</div>
		</div>`;
	}
};

/* ---------- per-view setup after render ------------------------------------- */

const VIEWS_AFTER = {
	apps() { appsAfter(); },
	system() {
		const sub = S.route.sub;
		if (sub === 'logs') {
			loadLog();
			$('#log-src')?.addEventListener('change', (e) => { S.logSrc = e.target.value; loadLog(); });
			// snapshots of the last starts (kept across a power cut)
			if (!S.bootlogs) rpc('shareos.system', 'bootlogs').then((r) => { S.bootlogs = r.logs || []; if (S.bootlogs.length && S.route.sub === 'logs') renderMain(); }).catch(() => { S.bootlogs = []; });
		}
		if (sub !== 'terminal') { if (S.term) S.term = null; S.sysapps = null; }
		if (sub === 'notifications') {
			if (!S.noteCfg) loadNoteCfg();
			if (!S.notes) loadNotes();
			$('#f-notify')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				const a = { email: f.email.checked, smtp_host: f.smtp_host.value.trim(), smtp_tls: f.smtp_tls.value, smtp_port: f.smtp_port.value.trim(),
					smtp_user: f.smtp_user.value.trim(), mail_from: f.mail_from.value.trim(), mail_to: f.mail_to.value.trim(), email_level: f.email_level.value,
					push: f.push.checked, push_type: f.push_type.value, push_url: f.push_url.value.trim(), push_chat: f.push_chat.value.trim(), push_level: f.push_level.value,
					temp_max: +f.temp_max.value, disk_full: +f.disk_full.value };
				if (f.smtp_pass.value) a.smtp_pass = f.smtp_pass.value;
				if (f.push_token.value) a.push_token = f.push_token.value;
				try { S.noteCfg = await rpc('shareos.notify', 'set', a); toast('Saved.'); renderMain(); }
				catch (err) { toast('Messages: ' + err.message, true); }
			});
			$('#f-notify select[name=push_type]')?.addEventListener('change', (e) => {
				const tg = e.target.value === 'telegram';
				document.querySelectorAll('#f-notify [data-push]').forEach((el) => { el.hidden = (el.dataset.push === 'tg') !== tg; });
			});
		}
		if (sub === 'time') {
			if (!S.time) loadTime();
			clearInterval(S.clockTimer);
			S.clockTimer = setInterval(() => {
				if (!$('#clock-now') || !S.time) { clearInterval(S.clockTimer); return; }
				const t = { ...S.time, now: Math.floor(Date.now() / 1000) + S.timeOffset };
				$('#clock-now').textContent = boxTime(t); $('#clock-date').textContent = boxDate(t);
			}, 1000);
			$('#f-time')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, servers = f.servers.value.split(/\s+/).map((x) => x.trim()).filter(Boolean);
				try { setTime(await rpc('shareos.time', 'set', { timezone: f.tz.value, ntp: f.ntp.checked, servers })); toast('Saved.'); renderMain(); }
				catch (err) { toast('Time: ' + err.message, true); }
			});
			$('#f-clock')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const sec = fromLocalInput(e.target.dt.value, S.time.timezone);
				if (sec == null) { toast('Invalid time.', true); return; }
				try { setTime(await rpc('shareos.time', 'set_clock', { time: sec })); toast('Time set.'); renderMain(); }
				catch (err) { toast('Time: ' + err.message, true); }
			});
		}
		if (sub === 'network') {
			if (!S.net) loadNet();
			$('#net-proto')?.addEventListener('change', (e) => { $('#net-static').hidden = e.target.value !== 'static'; });
			$('#f-net')?.addEventListener('submit', netSubmit);
		}
		if (sub === 'power') {
			if (!S.hw) loadHw();
			if (!S.pwr) rpc('shareos.system', 'power_schedule').then((r) => { S.pwr = r; if (S.route.sub === 'power') renderMain(); }).catch((e) => toast('Schedule: ' + e.message, true));
			$('#f-power')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, days = {};
				for (const [d] of PWR_DAYS) days[d] = { on: f['on_' + d]?.value || '', off: f['off_' + d].value || '' };
				try {
					S.pwr = await rpc('shareos.system', 'power_schedule_set', { enabled: f.enabled.checked, days });
					S.pwrEdit = false;
					if (S.pwr.arm_error) toast(`Schedule saved, but the wake-up alarm could not be set: ${S.pwr.arm_error}`, true);
					else toast(!S.pwr.enabled ? 'Schedule saved (switched off).' : S.pwr.next_on ? `Schedule saved – the box switches on on ${fmtPwr(S.pwr.next_on)}.` : 'Schedule saved – no switch-on planned.');
					renderMain();
				}
				catch (err) { toast('Schedule: ' + err.message, true); }
			});
			document.querySelectorAll('#f-fan input[name=preset]').forEach((r) => r.addEventListener('change', () => { $('#fan-custom').hidden = r.value !== 'custom'; }));
			$('#f-fan')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, preset = $('input[name=preset]:checked', f).value;
				try {
					const r = await rpc('shareos.hw', 'set_fan', { preset, off_temp: +f.off_temp.value, full_temp: +f.full_temp.value, half_temp: +f.half_temp.value });
					S.hw.fan = r.fan; toast('Fan saved.');
				} catch (err) { toast('Fan: ' + err.message, true); }
			});
			for (const k of ['status', 'power', 'disks'])
				$('#led-' + k)?.addEventListener('change', async (e) => {
					try { const r = await rpc('shareos.hw', 'set_led', { [k]: e.target.value }); S.hw.led = r.led; toast('LED saved.'); }
					catch (err) { toast('LED: ' + err.message, true); }
				});
		}
		if (sub === 'network') {
			if (!S.web) loadWeb();
			$('#ddns-prov')?.addEventListener('change', (e) => { S.ddnsProv = e.target.value; renderMain(); });
			$('#f-ddns')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				const v = { enabled: f.enabled.checked, provider: f.provider.value, host: f.host.value.trim(), token: f.token.value, user: f.user.value.trim(), url: f.url.value.trim(), ipv4: f.ipv4.checked, ipv6: f.ipv6.checked };
				if (v.enabled && (!v.provider || !v.host)) { toast('Please enter provider and name.', true); return; }
				try {
					const r = await rpc('shareos.web', 'ddns_set', v);
					S.ddnsProv = null;
					toast(r.pending ? 'Saved – the address is being reported.' : 'Saved.');
					await loadNetExtra(); renderMain();
					if (r.pending) setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 6000);
				} catch (err) { toast('DynDNS: ' + err.message, true); }
			});
			$('#f-ca-issue')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, hosts = f.hosts.value.split(/[\s,;]+/).filter(Boolean);
				if (!f.name.value.trim() || !hosts.length) { toast('Please enter name and host names.', true); return; }
				try { await rpc('shareos.web', 'ca_issue', { name: f.name.value.trim(), hosts }); toast('Certificate issued.'); await loadNetExtra(); renderMain(); }
				catch (err) { toast('Certificate: ' + err.message, true); }
			});
			$('#f-acme')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				try { await rpc('shareos.web', 'acme_issue', { email: f.email.value.trim(), staging: f.staging.checked }); await loadNetExtra(); renderMain(); }
				catch (err) { toast('Let\'s Encrypt: ' + err.message, true); }
			});
			$('#opt-https')?.addEventListener('change', (e) => webSet({ https: e.target.checked }));
			$('#opt-redirect')?.addEventListener('change', (e) => webSet({ redirect: e.target.checked }));
			$('#f-webhost')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const h = e.target.host.value.trim();
				try {
					await rpc('shareos.web', 'set', { host: h });
					S.web.host = h; if (S.apps) S.apps.installed = null;
					toast('Name saved.'); renderMain();
				} catch (err) { toast('Name: ' + err.message, true); }
			});
			document.querySelectorAll('#f-cert input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
				const f = inp.files[0];
				if (f) $(`#f-cert textarea[name=${inp.dataset.target}]`).value = await f.text();
			}));
			$('#f-cert')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, btn = $('button[type=submit]', f);
				btn.disabled = true;
				try {
					const r = await rpc('shareos.web', 'install', { cert: f.cert.value.trim() + '\n', key: f.key.value.trim() + '\n' });
					S.web.cert = r.cert;
					f.reset();
					toast('Certificate installed.');
					afterWebRestart();
				} catch (err) { toast('Certificate: ' + err.message, true); btn.disabled = false; }
			});
		}

		if (sub === 'firmware') {
			$('#f-bin')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, file = f.file.files[0], box = $('#bin-info'), btn = $('button[type=submit]', f);
				if (!file) return;
				btn.disabled = true;
				if (/\.tar$/i.test(file.name)) {
					try {
						const sha = f.sha.files[0] ? (await f.sha.files[0].text()).slice(0, 400) : '';
						const t = await rpc('shareos.update', 'local_ticket');
						await fbSend(t.url, file, () => {});
						await rpc('shareos.update', 'local', { sha256: sha });
						f.reset();
						toast('Uploaded – the bundle is being checked.');
						S.updPending = { state: 'verifying', until: Date.now() + 15000 };
						S.upd = { ...S.upd, state: 'verifying', release: { tag: 'local', version: '' } };
						renderMain();
						refreshUpdateStatus();
					} catch (err) { toast('Firmware file: ' + err.message, true); }
					btn.disabled = false;
					return;
				}
				try {
					const t = await rpc('shareos.update', 'bin_ticket');
					await fbSend(t.url, file, () => {});
					const i = await rpc('shareos.update', 'bin_info');
					const kind = { shareos: 'ShareOS', altf: 'Alt-F', other: 'other firmware' }[i.kind] || i.kind;
					box.innerHTML = html`<dl class="kv" style="margin-top:10px"><dt>Type</dt><dd><b>${kind}</b></dd><dt>Kernel</dt><dd>${i.kernel}</dd>
						<dt>Size</dt><dd>${fmtBytes(+i.kernel_size)} + ${fmtBytes(+i.initramfs_size)}</dd></dl>
						${i.kind === 'altf' || i.kind === 'other' ? html`<p class="note" style="color:var(--amber)">Afterwards ${kind} starts. Alt-F's extra packages are missing then – flash the same file once more in Alt-F's firmware page. Back to ShareOS: flash the ShareOS .bin in Alt-F, system and settings are still there.</p>` : ''}
						<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="bin-write">Install</button></div>`.s;
					$('#bin-write').addEventListener('click', async () => {
						if (!await confirmDlg(`Install ${kind}?`, 'Kernel and boot system are replaced and checked. Do not switch the box off while writing.', 'Install', true)) return;
						cover('Writing firmware', 'Kernel and boot system – please wait, do not switch off');
						try {
							await rpc('shareos.update', 'bin_write', { confirm: true });
							uncover();
							if (await confirmDlg('Written', `${kind} is in flash. Restart now?`, 'Reboot')) {
								try { await rpc('shareos.system', 'reboot'); } catch (err) { }
								stopPolling();
								if (i.kind === 'shareos') waitForBox('Rebooting', `${kind} is starting`);
								else cover('Rebooting', `${kind} is starting – its interface will be at ${location.hostname} shortly (port 80).`);
							}
						} catch (err) { uncover(); toast('Install: ' + err.message, true); }
					});
				} catch (err) { box.innerHTML = ''; toast('Firmware file: ' + err.message, true); }
				btn.disabled = false;
			});
		}
		if (sub === 'general') {
			if (!S.widget) loadWidget();
			$('#app-install')?.addEventListener('click', async () => {
				const ev = S.installEvt; if (!ev) return;
				ev.prompt();
				try { await ev.userChoice; } catch (e) { }
				S.installEvt = null; renderMain();
			});
			$('#opt-widget')?.addEventListener('change', (e) => widgetSet({ enabled: e.target.checked }));
			$('#widget-renew')?.addEventListener('click', async () => {
				if (await confirmDlg('Create a new key?', 'The old address stops working – widgets need the new one.', 'Create', true)) widgetSet({ renew: true });
			});
			$('#widget-copy')?.addEventListener('click', () => copyText($('#widget-url').value));
			$('#f-host').addEventListener('submit', async (e) => {
				e.preventDefault();
				try {
					const r = await rpc('shareos.system', 'set_hostname', { hostname: e.target.hostname.value.trim() });
					toast(r.cert_renewed ? 'Hostname saved. The HTTPS certificate was reissued for the new name – the browser will ask once more.' : 'Hostname saved.');
					tick();
				}
				catch (err) { toast('Hostname: ' + err.message, true); }
			});
			if (!S.backupOffer) rpc('shareos.backup', 'offer').then((o) => {
				S.backupOffer = o;
				const k = $('#backup-keys');
				if (k) { k.innerHTML = backupKeys().s; for (const c of k.querySelectorAll('input')) c.disabled = !$('#f-backup').pw.value; }
			}).catch(() => {});
			$('#f-backup').pw.addEventListener('input', (e) => { for (const c of e.target.form.querySelectorAll('#backup-keys input')) c.disabled = !e.target.value; });
			$('#f-backup').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, btn = $('button[type=submit]', f);
				btn.disabled = true;
				try {
					const r = await rpc('shareos.backup', 'export', { password: f.pw.value, certificate: !!f.cert?.checked && !!f.pw.value, ca: !!f.ca?.checked && !!f.pw.value });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(new Blob([r.content], { type: 'application/json' }));
					a.download = r.filename;
					document.body.append(a); a.click(); a.remove();
					setTimeout(() => URL.revokeObjectURL(a.href), 5000);
					f.reset();
					toast(r.encrypted ? 'Encrypted backup downloaded.' : 'Backup downloaded.');
				} catch (err) { toast('Backup: ' + err.message, true); }
				btn.disabled = false;
			});
			$('#f-restore').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, file = f.file.files[0];
				if (!file) return;
				const content = await file.text();
				const box = $('#restore-preview');
				try {
					const p = await rpc('shareos.backup', 'restore', { content, password: f.pw.value, apply: false });
					box.innerHTML = html`<dl class="kv" style="margin-top:12px">
						<dt>Device</dt><dd>${p.host || '–'}</dd>
						<dt>Created</dt><dd>${p.created ? new Date(p.created * 1000).toLocaleString(LOC) : '–'}</dd>
						<dt>ShareOS</dt><dd>${p.version || '–'}</dd>
						<dt>User accounts</dt><dd>${p.users.join(', ') || '–'}</dd>
						<dt>Groups</dt><dd>${(p.groups || []).join(', ') || '–'}</dd>
						<dt>Shares</dt><dd>${p.shares.join(', ') || '–'}</dd>
						<dt>Services</dt><dd>${(p.services || []).map((x) => REC_SERVICES[x] || x).join(', ') || '–'}</dd>
						<dt>Apps</dt><dd>${(p.apps || []).map((a) => a.name || a.id).join(', ') || '–'}</dd>
						<dt>Certificate</dt><dd>${p.certificate ? 'yes' : 'no'}</dd>
						<dt>Own CA</dt><dd>${p.ca ? 'yes' : 'no'}${p.ca && p.ca_certs?.length ? html` <span class="mut">(${p.ca_certs.length} issued certificates)</span>` : ''}</dd></dl>
						<p class="note" style="color:var(--amber)">Root password, network, device name, time zone, drives and the settings of the web interface are taken over right away. Then the box restarts and asks in recovery mode what else should come back. Data on the drives stays untouched.</p>
						<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="restore-apply">Restore</button></div>`.s;
					$('#restore-apply').addEventListener('click', async () => {
						if (!await confirmDlg('Restore settings?', 'Root password, network, name, time zone and drives come from the backup right away, then the box restarts. You choose the rest afterwards in recovery mode.', 'Restore and restart', true)) return;
						try {
							await rpc('shareos.backup', 'restore', { content, password: f.pw.value, apply: true });
							try { await rpc('shareos.system', 'reboot'); } catch (err) { }
							stopPolling();
							waitForBox('Rebooting', 'Then it continues in recovery mode');
						} catch (err) { toast('Restore: ' + err.message, true); }
					});
				} catch (err) {
					box.innerHTML = '';
					toast(err.message === 'password required' ? 'The backup is encrypted – please enter the password.' : 'Backup: ' + err.message, true);
				}
			});
			$('#f-pass').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				if (f.p1.value !== f.p2.value) { toast('The passwords do not match.', true); return; }
				try { await rpc('shareos.system', 'set_password', { password: f.p1.value }); f.reset(); toast('Password changed.'); }
				catch (err) { toast('Password: ' + err.message, true); }
			});
		}
		if (sub === 'appearance') {
			$('#opt-theme').addEventListener('change', (e) => { S.theme = e.target.value; applyTheme(); renderHeader(); renderMain(); saveLook({ theme: S.theme }); });
			$('#opt-lang').addEventListener('change', async (e) => {
				try {
					await rpc('shareos.ui', 'set', { lang: e.target.value });
					try { localStorage.setItem('shareos.lang', e.target.value); } catch (err) { }
					location.reload();
				} catch (err) { toast('Language: ' + err.message, true); }
			});
			$('#opt-logo').addEventListener('change', async (e) => {
				const on = e.target.checked;
				try {
					await rpc('shareos.ui', 'set', { logo: on });
					S.logo = on; store.set('logo', on ? '1' : '0'); renderHeader(); renderMain();
				} catch (err) { e.target.checked = !on; toast('Logo: ' + err.message, true); }
			});
			$('#opt-scan').addEventListener('change', (e) => { S.scan = e.target.checked; store.set('scan', S.scan ? '1' : '0'); applyTheme(); });
			document.querySelectorAll('.chip-show').forEach((c) => c.addEventListener('change', () => {
				const h = new Set(chipHidden());
				if (c.checked) h.delete(c.dataset.id); else h.add(c.dataset.id);
				store.set('chips.hidden', JSON.stringify([...h]));
				renderHeader();
			}));
			document.querySelectorAll('.opt-area').forEach((cb) => cb.addEventListener('change', async (e) => {
				const k = e.target.dataset.area, on = e.target.checked;
				try {
					const r = await rpc('shareos.ui', 'set', { areas: { [k]: on } });
					S.areas = r.areas; renderTabs(); if (S.desk && typeof deskAreas === 'function') deskAreas(); toast(on ? 'Area switched on.' : 'Area switched off.');
				} catch (err) { e.target.checked = !on; toast('Area: ' + err.message, true); }
			}));
		}
		if (sub === 'firmware') {
			$('#channel')?.addEventListener('change', async (e) => {
				try {
					await rpc('uci', 'set', { config: 'shareos', section: 'update', values: { channel: e.target.value } });
					await rpc('uci', 'commit', { config: 'shareos' });
					checkUpdates();
				} catch (err) { toast('Channel: ' + err.message, true); }
			});
		}
	},
	storage() {
		if (S.route.sub === 'snapshots') { snapAfter(); return; }
		if (!S.stActive) loadStorage();
		$('#smart-sched')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'smart_schedule', { mode: e.target.value }); S.storage.smart_schedule = e.target.value; toast('Schedule saved.'); }
			catch (err) { toast('Self-test: ' + err.message, true); }
		});
		$('#f-usbcopy')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { S.storage.usb_copy = await rpc('shareos.storage', 'usb_copy_config', { enabled: f.enabled.checked, volume: f.volume.value, path: f.path.value.trim() }); toast('USB button saved.'); renderMain(); }
			catch (err) { toast('USB button: ' + err.message, true); }
		});
		$('#spindown')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'spindown', { minutes: +e.target.value }); toast('Spindown saved.'); }
			catch (err) { toast('Standby: ' + err.message, true); }
		});
	},
	cloud() {
		if (S.cloud?.scope !== 'admin') { loadCloud('admin'); return; }
		cloudAfter('admin');
	},
	dnsfilter() {
		if (!S.df) { loadDnsfilter(); return; }
		$('#f-df')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, args = { enabled: f.enabled.checked, web_port: +f.web_port.value, https_port: +f.https_port.value };
			if (f.protection) args.protection = f.protection.checked;
			if (f.upstream) args.upstream = f.upstream.value.split('\n').map((x) => x.trim()).filter(Boolean);
			const b = $('button[type=submit]', f); b.disabled = true;
			try {
				const r = await rpc('shareos.dnsfilter', 'set', args);
				// switched on: show "starting …" at once, the status follows every 3 s
				if (args.enabled && !S.df.running) { S.dfStarting = true; S.df = { ...S.df, enabled: true, start_error: null }; renderMain(); }
				toast(r.ok && args.enabled && !S.df.running ? 'DNS filter is starting …' : 'Saved.'); loadDnsfilter();
			} catch (err) { b.disabled = false; toast('DNS filter: ' + err.message, true); }
		});
		$('#f-dfadd')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.dnsfilter', 'filter_add', { name: f.name.value.trim(), url: f.url.value.trim() }); toast('List added.'); loadDnsfilter(); }
			catch (err) { toast('List: ' + err.message, true); }
		});
		$('#f-dfrw')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.dnsfilter', 'rewrite_add', { domain: f.domain.value.trim(), answer: f.answer.value.trim() }); f.reset(); toast('Entry added.'); loadDnsfilter(); }
			catch (err) { toast('Entry: ' + err.message, true); }
		});
		document.querySelectorAll('.df-en').forEach((c) => c.addEventListener('change', async () => {
			try { await rpc('shareos.dnsfilter', 'filter_enable', { url: c.dataset.url, enabled: c.checked }); loadDnsfilter(); }
			catch (err) { toast('List: ' + err.message, true); }
		}));
	},
	paperless() {
		if (!S.pl || !S.acc || !S.shares) { loadPaperless(); return; }
		const kind = $('#f-inbox select[name=kind]');
		const syncKind = () => { if (!kind) return; $('#ib-owner').hidden = kind.value !== 'user'; $('#ib-share').hidden = kind.value !== 'share'; };
		kind?.addEventListener('change', syncKind); syncKind();
		$('#f-pl')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.paperless', 'set_global', { url: f.url.value.trim(), interval: +f.interval.value, after: f.after.value, enabled: f.enabled.checked }); toast('Saved.'); loadPaperless(); }
			catch (err) { toast('Paperless: ' + err.message, true); }
		});
		$('#f-inbox')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, ed = S.plEdit, x = ed.data, kindv = f.kind.value;
			const owner = ed.mode === 'new' ? (kindv === 'user' ? f.owner.value : '') : x.owner;
			const share = ed.mode === 'new' ? (kindv === 'share' ? f.share.value : '') : x.share;
			const name = ed.mode === 'new' ? (owner ? 'u_' + owner : share.replace(/-/g, '_')) : x.name;
			const args = { name, owner, share, token: f.token.value.trim(), enabled: f.enabled.checked };
			if (ed.tags) args.tags = [...document.querySelectorAll('#f-inbox .ib-tag:checked')].map((c) => +c.value);
			try { await rpc('shareos.paperless', 'inbox_set', args); S.plEdit = null; toast(`Inbox “${name}” saved.`); loadPaperless(); }
			catch (err) { toast('Inbox: ' + err.message, true); }
		});
	},
	shares() {
		if (S.route.sub === 'files') return;
		// Paperless loads shares and accounts too, but not the volumes
		if (!S.shares || !S.acc || !S.vols) { loadShareData(); return; }
		$('#opt-smb')?.addEventListener('change', (e) => shareGlobal({ smb: e.target.checked }));
		$('#opt-nfs')?.addEventListener('change', (e) => shareGlobal({ nfs: e.target.checked }));
		$('#opt-wg')?.addEventListener('change', (e) => shareGlobal({ workgroup: e.target.value.trim() }));
		$('#opt-smbcompat')?.addEventListener('change', (e) => shareGlobal({ smb_compat: e.target.checked }));
		$('#f-user select[name=role]')?.addEventListener('change', (e) => { $('#u-web-row').hidden = e.target.value !== 'user'; });
		// a vault: SMB only, no guests, no NFS
		const vaultSync = () => {
			const f = $('#f-share'); if (!f) return;
			const v = f.vault.checked;
			for (const n of ['guest', 'nfs', 'nfs_rw']) { if (v) f[n].checked = false; f[n].disabled = v; }
			if (v) f.smb.checked = true;
			f.smb.disabled = v; f.vault_ttl.disabled = !v;
		};
		$('#f-share input[name=vault]')?.addEventListener('change', vaultSync);
		vaultSync();
		$('#f-share')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, rw = [], ro = [];
			document.querySelectorAll('#f-share select.acl').forEach((s2) => { if (s2.value === 'rw') rw.push(s2.dataset.tag); if (s2.value === 'ro') ro.push(s2.dataset.tag); });
			const args = { name: f.name.value.trim().toLowerCase(), volume: f.volume.value, path: f.path.value.trim() || f.name.value.trim().toLowerCase(), comment: f.comment.value.trim(),
				smb: f.smb.checked, guest: f.guest.checked, nfs: f.nfs.checked, nfs_rw: f.nfs_rw.checked,
				nfs_hosts: f.nfs_hosts.value.split(/[\s,;]+/).filter(Boolean), rw, ro, vault: f.vault.checked, vault_ttl: +f.vault_ttl.value };
			if (args.vault) { args.guest = false; args.nfs = false; }
			if (args.nfs && !args.nfs_hosts.length) { toast('Enter at least one client (IP or network) for NFS.', true); return; }
			try { S.shares = await rpc('shareos.shares', 'set', args); S.shEdit = null; toast(`Share “${args.name}” saved.`); renderMain(); }
			catch (err) { toast('Share: ' + err.message, true); }
		});
		$('#f-user')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, isNew = S.uEdit.mode === 'new';
			const args = { name: f.name.value.trim().toLowerCase(), fullname: f.fullname.value.trim(), role: f.role.value, home: f.home.value,
				quota: Math.max(0, Math.round(+f.quota.value || 0)) * 1000, web: f.web.checked, cloud: f.cloud.checked, files: f.files.checked,
				groups: [...document.querySelectorAll('#f-user .u-group:checked')].map((x) => x.value) };
			if (isNew) {
				if (f.p1.value !== f.p2.value) { toast('The passwords do not match.', true); return; }
				args.password = f.p1.value;
			}
			try { S.acc = await rpc('shareos.accounts', isNew ? 'add' : 'set', args); S.uEdit = null; toast(isNew ? `User “${args.name}” created.` : `User “${args.name}” saved.`); renderMain(); }
			catch (err) { toast('User: ' + err.message, true); }
		});
	},
	services() {
		if (S.route.sub === 'dlna') { dlnaAfter(); return; }
		if (S.route.sub === 'printer') { printerAfter(); return; }
		if (S.route.sub === 'ups') { upsAfter(); return; }
		if (S.route.sub === 'torrent') { tremoteAfter(); return; }
		loadServicesFresh();
		document.querySelectorAll('.as-toggle').forEach((c) => c.addEventListener('change', async () => {
			c.disabled = true;
			try {
				const r = await rpc('shareos.service', 'autostart', { name: c.dataset.name, enabled: c.checked });
				const s = S.services.find((x) => x.name === r.name);
				if (s) s.autostart = r.autostart;
				toast(`${r.name}: ${r.autostart ? 'starts at power-on' : 'no longer starts at power-on'}`);
			} catch (err) { c.checked = !c.checked; toast(err.message, true); }
			c.disabled = false;
		}));
	},
	overview() {
		loadServicesFresh();
		// the FAV APPS bar needs the installed apps (asked once)
		if (tabOn('apps') && !S.apps?.installed && !S.apps?.tried) { S.apps = { ...S.apps, tried: true }; loadApps(['installed']); }
	}
};



// --- time page helpers: show the box's clock in the box's time zone ---
function tzSafe(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch (e) { return 'UTC'; } }
function boxTime(t) { return new Date(t.now * 1000).toLocaleTimeString(LOC, { timeZone: tzSafe(t.timezone), hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function boxDate(t) { return new Date(t.now * 1000).toLocaleDateString(LOC, { timeZone: tzSafe(t.timezone), weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
// "YYYY-MM-DDTHH:MM:SS" as the wall clock in time zone tz
function localInput(t) {
	const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tzSafe(t.timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
		.formatToParts(new Date(t.now * 1000)).map((x) => [x.type, x.value]));
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
// wall clock in tz -> seconds since 1970 (two rounds settle daylight saving)
function fromLocalInput(v, tz) {
	const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/.exec(v || '');
	if (!m) return null;
	const want = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
	let guess = want;
	for (let k = 0; k < 2; k++) {
		const shown = localInput({ now: guess, timezone: tz }).match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)$/);
		guess += want - Date.UTC(+shown[1], shown[2] - 1, +shown[3], +shown[4], +shown[5], +shown[6]) / 1000;
	}
	return Math.round(guess);
}
function setTime(t) { S.time = t; S.timeOffset = t.now - Math.floor(Date.now() / 1000); }
async function loadNotes() {
	if (away()) return;
	try {
		const n = await rpc('shareos.notify', 'list');
		const was = S.notes?.unread;
		S.notes = n;
		if (was !== n.unread) renderHeader();
		if (S.route.tab === 'system' && S.route.sub === 'notifications' && !$('#f-notify :focus')) renderMain();
	} catch (e) { }
}

async function loadNoteCfg() {
	try { S.noteCfg = await rpc('shareos.notify', 'get'); } catch (e) { toast('Messages: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'notifications') renderMain();
}

async function loadTime() {
	try {
		const [t, z] = await Promise.all([rpc('shareos.time', 'get'), S.zones ? null : rpc('shareos.setup', 'zones')]);
		setTime(t); if (z) S.zones = z.zones;
	} catch (e) { toast('Time: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'time') renderMain();
}

// "now: 41 °C · half" of the fan panel: the values of the last tick (every 5 s)
function fanNow() {
	const i = S.info || S.hw || {};
	return `now: ${i.temperature != null ? (i.temperature / 1000).toFixed(0) + ' °C' : '–'} · ${fanTxt(i.fan_pwm)}`;
}
async function loadHw() {
	try { S.hw = await rpc('shareos.hw', 'get'); } catch (e) { toast('Hardware: ' + e.message, true); }
	if (S.route.sub === 'power') renderMain();
}

/* ---------- network ------------------------------------------------------------- */

function prefixMask(p) {
	const n = p ? (0xffffffff << (32 - p)) >>> 0 : 0;
	return [24, 16, 8, 0].map((b) => (n >>> b) & 255).join('.');
}

async function loadNet() {
	try { S.net = await rpc('shareos.net', 'get'); } catch (e) { toast('Network: ' + e.message, true); }
	if (S.route.sub === 'network') renderMain();
	if (S.net?.pending) { clearTimeout(S.netTimer); S.netTimer = setTimeout(() => { S.net = null; loadNet(); }, 5000); }
}

// reaching the box after a network change is the confirmation
async function netAutoConfirm() {
	try {
		const n = await rpc('shareos.net', 'get');
		if (!n.pending) return;
		await rpc('shareos.net', 'confirm');
		toast('New network settings confirmed.');
		S.net = null;
	} catch (e) { }
}

async function netSubmit(e) {
	e.preventDefault();
	const f = e.target, proto = f.proto.value;
	const args = { proto, confirm: true };
	if (proto === 'static') {
		Object.assign(args, { ipaddr: f.ipaddr.value.trim(), netmask: f.netmask.value.trim(), gateway: f.gateway.value.trim(),
			dns: f.dns.value.split(/[\s,;]+/).filter(Boolean) });
	}
	const target = proto === 'static' ? args.ipaddr : null;
	const moves = target && target !== location.hostname;
	const t = S.net?.timeout || 120;
	const text = proto === 'dhcp'
		? `The box gets its address from the router. Afterwards it may be reachable under a different address (look it up in the router). If the change is not confirmed on the box within ${t} seconds, the previous settings apply again.`
		: moves ? `The box switches to ${target}. This page then opens the new address and confirms the change. If that does not work, the previous settings apply again after ${t} seconds.`
		: `The network settings are applied and confirmed by this page. If that does not work, the previous settings apply again after ${t} seconds.`;
	if (!await confirmDlg('Change the network?', text, 'Apply')) return;
	try { await rpc('shareos.net', 'set', args); } catch (err) { toast('Network: ' + err.message, true); return; }
	stopPolling();
	if (moves) {
		cover('Switching the network', `new address ${target}`);
		const url = `${location.protocol}//${target}${location.port ? ':' + location.port : ''}/#confirm=${S.sid}`;
		setTimeout(() => { location.href = url; }, 6000);
		return;
	}
	// same address (or DHCP): wait until this page reaches the box again, then confirm
	cover('Restarting the network', 'waiting for the box');
	const t0 = Date.now();
	await new Promise((r) => setTimeout(r, 5000));
	for (;;) {
		try {
			await rpc('shareos.net', 'confirm');
			uncover(); toast('New network settings confirmed.');
			S.net = null; startPolling(); renderMain();
			return;
		} catch (err) { }
		const sec = Math.round((Date.now() - t0) / 1000);
		const el = $('#cover-text');
		if (el) el.textContent = sec > t ? 'No connection – the box should have restored the old settings. Reload the page.'
			: `waiting for the box (${sec} s)${proto === 'dhcp' && sec > 20 ? ' – not reachable? Look up the new address in the router and sign in there.' : ''}`;
		await new Promise((r) => setTimeout(r, 3000));
	}
}

/* ---------- first-run wizard -------------------------------------------------- */

/* ---------- recovery mode (after restoring a settings backup) ---------- */

const REC_SERVICES = { dnsfilter: 'DNS filter (AdGuard Home)', paperless: 'Paperless connection', cloud: 'Cloud storage', snapshots: 'Snapshots', dlna: 'Media server (DLNA)',
	dockerhosts: 'Docker hosts', zabbix: 'Zabbix agent', printer: 'Printer', ups: 'UPS' };

// admin only: shareos.recovery is not granted to other accounts
async function checkRecovery() {
	try {
		const r = await rpc('shareos.recovery', 'status');
		S.recApps = { pending: r.pending_apps || [], running: !!r.apps_running };
		if (!r.active) {
			if (S.recApps.pending.length && S.route.tab === 'apps' && S.apps?.installed) renderMain();
			return false;
		}
		S.rec = { st: r, users: r.users.length > 0 || r.groups.length > 0, shares: r.shares.length > 0, services: new Set(r.services),
			apps: new Set(r.apps.map((a) => a.id)), certificate: r.certificate, ca: r.ca };
		renderMain();
		return true;
	} catch (e) { return false; }
}

function recoveryView() {
	const R = S.rec, st = R.st;
	const row = (key, on, title, detail) => html`<label class="chk" style="display:flex;align-items:flex-start;margin:8px 0"><input type="checkbox" data-rec="${key}"${on ? raw(' checked') : ''}>
		<span><b>${title}</b>${detail ? html`<br><span class="mut" style="font-size:12px">${detail}</span>` : ''}</span></label>`;
	const certNew = st.cert_source === 'ca' && st.ca ? 'Otherwise the own CA issues a new certificate if it is restored. Browser and desktop app then ask once again.'
		: 'Otherwise the box keeps its current certificate. Browser and desktop app then ask once again.';
	return html`<section class="sec"><div class="panel" style="border-color:var(--amber);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">RECOVERY MODE</span><span class="tag warn ml">Backup</span></div>
		<p style="margin:0 0 10px;font-size:13px"><span>The box was restored from a backup:</span> <b>${st.host || '–'}</b> · ${st.created ? fmtTime(st.created) : '–'} · ShareOS ${st.version || '–'}</p>
		<p class="note" style="margin-top:0">Already taken over: root password, network (IP address, subnet), device name, time zone, drives and the settings of the web interface. Choose what else should come back:</p>
		${st.users.length || st.groups.length ? row('users', R.users, 'Users and groups', html`${st.users.join(', ')}${st.groups.length ? html`<br><span>Groups: ${st.groups.join(', ')}</span>` : ''}`) : ''}
		${st.shares.length ? row('shares', R.shares, 'Shares', st.shares.join(', ')) : ''}
		${st.services.map((x) => row('svc:' + x, R.services.has(x), REC_SERVICES[x] || x, 'Settings'))}
		${st.apps.length ? html`<h3 class="gh" style="margin:16px 0 4px">APPS</h3><p class="note" style="margin:0">Installed from the store after the restart (internet needed). Whatever fails is offered again later on the apps page.</p>
			${st.apps.map((a) => row('app:' + a.id, R.apps.has(a.id), a.name || a.id, a.version ? 'Version ' + a.version : ''))}` : ''}
		<h3 class="gh" style="margin:16px 0 4px">CERTIFICATES</h3>
		${st.certificate ? row('certificate', R.certificate, 'Reuse the HTTPS certificate from the backup', certNew)
			: html`<p class="note" style="margin:6px 0">The backup holds no HTTPS certificate – the box keeps its current one.</p>`}
		${st.ca ? row('ca', R.ca, 'Restore the own CA',
			html`${st.ca_certs.length ? html`<span>Issued certificates: ${st.ca_certs.join(', ')}</span><br>` : ''}<span>Devices that trust the CA keep trusting the box only with the same CA. Without it you have to install the new CA there and issue certificates for other devices again.</span>`) : ''}
		<div class="acts" style="margin-top:18px;justify-content:space-between">
			<button class="btn ghost" type="button" data-act="rec-discard">Take over nothing else</button>
			<button class="btn primary" type="button" data-act="rec-apply">Apply and restart</button>
		</div></div></section>`;
}

// backup form: certificate and own CA (with their private keys) – only encrypted
function backupKeys() {
	const o = S.backupOffer;
	if (!o || (!o.certificate && !o.ca)) return html``;
	return html`${o.certificate ? html`<label class="chk"><input type="checkbox" name="cert" checked disabled>Include the HTTPS certificate (with key)</label>` : ''}
		${o.ca ? html`<label class="chk"><input type="checkbox" name="ca" checked disabled><span>Include the own CA</span>${o.ca_certs ? html` <span class="mut">(${o.ca_certs} issued certificates)</span>` : ''}</label>` : ''}
		<p class="note" style="margin-top:4px">Keys only go into an encrypted backup – enter a password first.</p>`;
}

async function recoveryEnd(args) {
	try {
		await rpc('shareos.recovery', args ? 'apply' : 'discard', args || {});
		S.rec = null;
		if (!args) { renderMain(); toast('Recovery mode ended.'); return; }
		try { await rpc('shareos.system', 'reboot'); } catch (err) { }
		stopPolling();
		waitForBox('Rebooting', 'Applying the settings');
	} catch (err) { toast('Recovery: ' + err.message, true); }
}

const FR_STEPS = ['Language', 'Alt-F', 'Password', 'Name & time', 'Updates', 'Done'];

async function checkFirstRun(force = false, known = null) {
	try {
		const st = known || await rpc('shareos.setup', 'status');
		if (st.done && !force) { if (S.fr?.loading) { S.fr = null; renderMain(); } return; }
		const [z, a] = await Promise.all([rpc('shareos.setup', 'zones'), rpc('shareos.setup', 'altf').catch(() => ({ found: false }))]);
		let step = 0;
		try { step = +(sessionStorage.getItem('shareos.frstep') || 0); } catch (e) { }
		S.fr = { step, st, zones: z.zones, altf: a, use_altf: !!a.found, hostname: a.found && a.hostname ? a.hostname : st.hostname,
			timezone: a.found && a.timezone && z.zones.includes(a.timezone) ? a.timezone : st.timezone, channel: st.channel, password: '' };
		renderMain();
	} catch (e) {
		// not fatal: the box works without the wizard
		if (S.fr?.loading) { S.fr = null; renderMain(); }
	}
}

// step 2 (password) only while root still has the factory password; a claimed
// box got its own password before the first login
function frStepVisible(k) { return (k !== 1 || S.fr.altf.found) && (k !== 2 || S.fr.st.default_password !== false); }

function firstRunView() {
	if (S.fr.loading) return html`<section class="sec"><div class="panel"><div class="spin" style="margin:24px auto"></div><p class="mut" style="text-align:center">Loading …</p></div></section>`;
	const f = S.fr, a = f.altf;
	const steps = FR_STEPS.map((n, k) => [n, k]).filter(([, k]) => frStepVisible(k));
	let body;
	if (f.step === 0) {
		body = html`<p style="margin:0 0 14px;font-size:14px">Welcome to ShareOS. The box is set up in a few steps; everything can be changed later under <b>System</b> .</p>
			<div class="fields" style="grid-template-columns:minmax(0,320px)"><label class="f"><span>INTERFACE LANGUAGE</span><select id="fr-lang" data-i18n-skip>
				${(S.languages || [{ code: LANG, name: LANG }]).map((l) => html`<option value="${l.code}"${l.code === LANG ? raw(' selected') : ''}>${l.name}</option>`)}</select></label></div>`;
	} else if (f.step === 1) {
		body = html`<p style="margin:0 0 12px;font-size:13px">This box has settings from <b>Alt-F</b> (${a.date || a.file}).</p>
			<dl class="kv" style="max-width:560px">
				${a.hostname ? html`<dt>Device name</dt><dd>${a.hostname}</dd>` : ''}
				${a.timezone ? html`<dt>Time zone</dt><dd>${a.timezone}</dd>` : ''}
				${a.fan_lo_temp ? html`<dt>Fan</dt><dd>full from ${a.fan_lo_temp} °C</dd>` : ''}
				${a.users.length ? html`<dt>User accounts</dt><dd>${a.users.map((u) => u.split(':')[0]).join(', ')}</dd>` : ''}
				${a.shares.length ? html`<dt>Shares</dt><dd>${a.shares.join(', ')}</dd>` : ''}
				${a.nfs.length ? html`<dt>NFS</dt><dd>${a.nfs.join(', ')}</dd>` : ''}
			</dl>
			<label class="chk" style="margin-top:14px"><input type="checkbox" id="fr-altf"${f.use_altf ? raw(' checked') : ''}>Take over device name, time zone and fan</label>
			<p class="note">Users and shares are kept and offered in the "Shares" area. The Alt-F data in flash stays untouched.</p>`;
	} else if (f.step === 2) {
		body = html`<p style="margin:0 0 12px;font-size:13px">Everyone knows the default password <code>shareos</code> – please set your own now. It applies to the web interface and SSH.</p>
			<div class="fields" style="max-width:560px">
				<label class="f"><span>NEW PASSWORD</span><input id="fr-p1" type="password" minlength="6" autocomplete="new-password" value="${f.password}"></label>
				<label class="f"><span>REPEAT</span><input id="fr-p2" type="password" minlength="6" autocomplete="new-password" value="${f.password}"></label>
			</div>
			<p class="note">Leave empty to change the password later.</p>`;
	} else if (f.step === 3) {
		body = html`<div class="fields" style="max-width:640px">
				<label class="f"><span>DEVICE NAME</span><input id="fr-host" value="${f.hostname}" pattern="[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?"></label>
				<label class="f"><span>TIME ZONE</span><select id="fr-tz" data-i18n-skip>${f.zones.map((z) => html`<option${z === f.timezone ? raw(' selected') : ''}>${z}</option>`)}</select></label>
			</div>
			<p class="note">The box appears under this name on the network. The clock sets itself via NTP.</p>`;
	} else if (f.step === 4) {
		body = html`<div style="display:grid;gap:10px;max-width:640px">${[['stable', 'Stable', 'Finished versions only – recommended.'], ['beta', 'Beta', 'Test versions too, with new features earlier.']].map(([id, t, d]) => html`
			<label class="panel" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;${f.channel === id ? 'border-color:var(--accent);box-shadow:var(--glow)' : ''}">
				<input type="radio" name="fr-channel" value="${id}"${f.channel === id ? raw(' checked') : ''} style="margin-top:4px;accent-color:var(--accent)">
				<span><b class="name" style="font-size:14px">${t}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
			<p class="note">Updates come from GitHub and are installed under System → Firmware.</p>`;
	} else {
		body = html`<dl class="kv" style="max-width:560px">
				${a.found ? html`<dt>Take over Alt-F</dt><dd>${f.use_altf ? 'yes' : 'no'}</dd>` : ''}
				<dt>Password</dt><dd>${f.password ? 'will be changed' : 'stays (change later)'}</dd>
				<dt>Device name</dt><dd>${f.hostname}</dd>
				<dt>Time zone</dt><dd>${f.timezone}</dd>
				<dt>Update channel</dt><dd>${f.channel === 'beta' ? 'Beta' : 'Stable'}</dd>
			</dl>
			<p class="note">Next, you can set up the hard disks right away.</p>`;
	}
	const last = f.step === 5;
	return html`<section class="sec"><div class="panel" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">FIRST-TIME SETUP</span><button class="btn sm ghost ml" type="button" data-act="fr-skip">Skip</button></div>
		<div class="steps" style="margin-bottom:18px">${steps.map(([n, k], i) => html`<div class="step ${k < f.step ? 'done' : k === f.step ? 'act' : ''}"><div class="n">${i + 1}${k < f.step ? ' ✓' : ''}</div>${n}</div>`)}</div>
		${body}
		<div class="acts" style="margin-top:18px;justify-content:space-between">
			<button class="btn ghost" type="button" data-act="fr-back" ${f.step === 0 ? 'disabled' : ''}>Back</button>
			${last ? html`<div class="acts"><button class="btn" type="button" data-act="fr-finish" data-next="overview">Done</button><button class="btn primary" type="button" data-act="fr-finish" data-next="storage">Done & set up storage</button></div>`
				: html`<button class="btn primary" type="button" data-act="fr-next">Next</button>`}
		</div></div></section>`;
}

function firstRunAfter() {
	if (S.fr.loading) return;
	$('#fr-lang')?.addEventListener('change', async (e) => {
		try {
			await rpc('shareos.ui', 'set', { lang: e.target.value });
			try { localStorage.setItem('shareos.lang', e.target.value); sessionStorage.setItem('shareos.frstep', '0'); } catch (err) { }
			location.reload();
		} catch (err) { toast(err.message, true); }
	});
	document.querySelectorAll('input[name=fr-channel]').forEach((r) => r.addEventListener('change', () => { S.fr.channel = r.value; renderMain(); }));
}

function frCollect() {
	const f = S.fr;
	if (f.step === 1 && $('#fr-altf')) f.use_altf = $('#fr-altf').checked;
	if (f.step === 3) { f.hostname = $('#fr-host').value.trim(); f.timezone = $('#fr-tz').value; }
	if (f.step === 2) {
		const p1 = $('#fr-p1').value, p2 = $('#fr-p2').value;
		if (p1 || p2) {
			if (p1 !== p2) return 'The passwords do not match.';
			if (p1.length < 6) return 'The password needs at least 6 characters.';
		}
		f.password = p1;
	}
	if (f.step === 3 && !/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(f.hostname)) return 'Invalid device name.';
	if (f.step === 1 && f.use_altf && S.fr.altf.hostname) f.hostname = S.fr.altf.hostname;
	return null;
}

function frGo(d) {
	const f = S.fr;
	do { f.step += d; } while (f.step > 0 && f.step < 5 && !frStepVisible(f.step));
	try { sessionStorage.setItem('shareos.frstep', String(f.step)); } catch (e) { }
	renderMain();
	window.scrollTo(0, 0);
}

function frEnd(next) {
	S.fr = null;
	try { sessionStorage.removeItem('shareos.frstep'); } catch (e) { }
	S.info = null; tick();
	if (next === 'storage') { S.wizAfterLoad = true; location.hash = '#/storage'; }
	else { location.hash = '#/overview'; renderMain(); }
}

/* ---------- app (PWA) & widget status ---------- */

// Chrome/Edge offer the install only over HTTPS with a trusted certificate
window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	S.installEvt = e;
	if (S.route?.tab === 'system' && S.route.sub === 'general') renderMain();
});
window.addEventListener('appinstalled', () => { S.installEvt = null; toast('ShareOS is installed as an app.'); });

function appPanel() {
	const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
	let state, note;
	if (standalone) { state = html`<span class="tag ok ml">running as an app</span>`; note = 'This interface is running as an installed app.'; }
	else if (S.installEvt) { state = html`<span class="tag ok ml">ready</span>`; note = 'The browser can install ShareOS as an app with its own icon.'; }
	else if (!window.isSecureContext) { state = html`<span class="tag ml">HTTPS only</span>`; note = html`Browsers install web apps only over <b>HTTPS with a trusted certificate</b> (e.g. Let's Encrypt, install it under SYSTEM → NETWORK). Over http:// Chrome's menu only offers <b>“Add to home screen”</b> – that creates a bookmark icon.`; }
	else { state = html`<span class="tag ml">via the browser menu</span>`; note = html`In the browser menu choose <b>“Install app”</b> or <b>“Add to home screen”</b> . With a self-signed certificate browsers do not offer the real installation.`; }
	return html`<div class="panel">
		<div class="ph"><span class="pt">INSTALL AS AN APP</span>${state}</div>
		<p class="note" style="margin-top:0">${note}</p>
		<p class="note">On Android: long-press the app icon to open the shortcuts <b>Overview, Storage, Shares, Firmware</b>. Chrome offers no real home-screen widgets for web apps – use the status for widget apps on the right instead.</p>
		${S.installEvt ? html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" id="app-install">${svg(I.dl)}Install as an app</button></div>` : ''}
	</div>`;
}

function widgetUrl() {
	return S.widget?.token ? location.origin + '/cgi-bin/status?token=' + S.widget.token : '';
}

function widgetPanel() {
	const w = S.widget;
	if (!w) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	return html`<div class="panel">
		<div class="ph"><span class="pt">STATUS FOR WIDGETS</span><span class="tag ml${w.enabled ? ' ok' : ''}">${w.enabled ? 'on' : 'off'}</span></div>
		<label class="chk"><input type="checkbox" id="opt-widget"${w.enabled ? raw(' checked') : ''}>Enable the status address</label>
		${w.enabled && w.token ? html`<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>ADDRESS (KEEP IT SECRET)</span><input id="widget-url" readonly value="${widgetUrl()}" style="font-family:var(--mono);font-size:12px"></label></div>
			<div class="acts" style="margin-top:10px"><button class="btn sm" type="button" id="widget-copy">Copy</button><button class="btn sm ghost" type="button" id="widget-renew">New key</button><a class="btn sm ghost" href="${widgetUrl()}" target="_blank" rel="noopener">Open ↗</a></div>` : ''}
		<p class="note">Returns a short JSON answer without login: name, version, uptime, load, temperature, drive usage, RAID state and warnings (<code>ok</code>, <code>alerts</code>). Meant for widget apps such as <b>KWGT</b> (Android), Home Assistant or your own scripts. Anyone who knows the address sees these values – nobody can change anything with it.</p>
	</div>`;
}

async function loadWidget() {
	try { S.widget = await rpc('shareos.widget', 'get'); } catch (e) { S.widget = { enabled: false, token: '' }; }
	if (S.route.tab === 'system' && S.route.sub === 'general') renderMain();
}

async function widgetSet(a) {
	try { S.widget = await rpc('shareos.widget', 'set', a); toast(a.renew ? 'New key created.' : a.enabled ? 'Status address enabled.' : 'Status address disabled.'); }
	catch (e) { toast('Widgets: ' + e.message, true); }
	renderMain();
}

async function copyText(t) {
	try { await navigator.clipboard.writeText(t); toast('Copied.'); }
	catch (e) {
		const i = $('#widget-url'); i?.select();
		try { document.execCommand('copy'); toast('Copied.'); } catch (e2) { toast('Please select and copy the address yourself.', true); }
	}
}

async function loadWeb() {
	try { S.web = await rpc('shareos.web', 'get'); } catch (e) { toast('HTTPS: ' + e.message, true); }
	await loadNetExtra();
	if (S.route.sub === 'network') renderMain();
}

// DynDNS, own CA, Let's Encrypt (System -> Netzwerk)
async function loadNetExtra() {
	const [d, c, a] = await Promise.all([rpc('shareos.web', 'ddns_get').catch(() => null), rpc('shareos.web', 'ca_get').catch(() => null), rpc('shareos.web', 'acme_get').catch(() => null)]);
	if (d) S.ddns = d;
	if (c) S.ca = c;
	if (a) S.acme = a;
	// Let's Encrypt runs in the background: look again until it is done
	clearTimeout(S.acmeTimer);
	if (S.acme?.running) S.acmeTimer = setTimeout(async () => { if (S.route.sub !== 'network') return; const was = S.acme.running; await loadNetExtra(); if (was && !S.acme.running) { toast(S.acme.active ? 'Let\'s Encrypt certificate active – the page reconnects.' : (S.acme.error ? 'Let\'s Encrypt: ' + S.acme.error : 'The Let\'s Encrypt certificate could not be fetched.'), !S.acme.active); if (S.acme.active) afterWebRestart(); } renderMain(); }, 5000);
}

function pemDownload(pem, name) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([pem], { type: 'application/x-pem-file' }));
	a.download = name;
	document.body.append(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// the web server restarts after HTTPS changes: wait for it, keep the page
function afterWebRestart() {
	setTimeout(async () => {
		for (let i = 0; i < 20; i++) {
			try { await fetch('/', { cache: 'no-store' }); break; } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
		}
		loadWeb();
	}, 2500);
}

async function webSet(v) {
	try {
		await rpc('shareos.web', 'set', v);
		Object.assign(S.web, v);
		toast('Saved – the web server is restarting.');
		if (location.protocol === 'https:' && v.https === false) { setTimeout(() => { location.href = 'http://' + location.host + '/'; }, 2500); return; }
		afterWebRestart();
	} catch (e) { toast('HTTPS: ' + e.message, true); }
}

// 20261027-071400 -> local date and time of the snapshot (taken 5 min after the start)
const bootlogTime = (n) => { const m = n.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).toLocaleString(LOC, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : n; };
// power schedule (shareos-power): switch-off by cron, switch-on by the MCU's wake-up alarm
const PWR_DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const fmtPwr = (t) => (t ? new Date(t.replace(' ', 'T')).toLocaleString(LOC, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
// any time entered in the schedule?
const pwrHasTimes = (p) => Object.values(p?.days || {}).some((d) => d.on || d.off);
function powerSchedule() {
	const p = S.pwr;
	if (!p) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	if (p.error) return html`<div class="panel"><p class="mut">${p.error}</p></div>`;
	const head = html`<div class="ph"><span class="pt">SWITCH OFF AND ON BY SCHEDULE</span>
			${p.enabled ? html`<span class="tag ok ml">active</span>` : html`<span class="tag ml">off</span>`}</div>`;
	// first a short overview; the table only after "Set up"/"Edit"
	if (!S.pwrEdit) {
		const set = PWR_DAYS.filter(([d]) => p.days?.[d]?.on || p.days?.[d]?.off);
		return html`<div class="panel">${head}
			${!set.length ? html`<p class="mut" style="margin:0">No times set up.</p>`
				: html`<dl class="kv">${set.map(([d, n]) => html`<dt>${n}</dt><dd>${p.days[d].on ? html`on ${p.days[d].on}` : ''}${p.days[d].on && p.days[d].off ? ' · ' : ''}${p.days[d].off ? html`off ${p.days[d].off}` : ''}</dd>`)}</dl>`}
			${p.enabled && set.length ? html`<p style="margin:10px 0 0">${p.supported ? html`Next switch-on: <b>${fmtPwr(p.next_on)}</b> · ` : ''}Next switch-off: <b>${fmtPwr(p.next_off)}</b></p>`
				: !p.enabled && set.length ? html`<div class="banner" style="margin-top:10px">${svg(I.warn)}<span>The schedule is off – the times entered only apply with the tick at “Switch the schedule on”.</span></div>` : ''}
			<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="pwr-edit">${set.length ? 'Edit' : 'Set up'}</button></div>
		</div>`;
	}
	return html`<form class="panel" id="f-power">
		<div class="ph"><span class="pt">SWITCH OFF AND ON BY SCHEDULE</span>
			${p.enabled ? html`<span class="tag ok ml">active</span>` : html`<span class="tag ml">off</span>`}</div>
		<label class="chk"><input type="checkbox" name="enabled"${p.enabled ? raw(' checked') : ''}> Switch the schedule on</label>
		<div class="tw"><table class="t" style="min-width:360px"><thead><tr><th>DAY</th>${p.supported ? html`<th>SWITCH ON</th>` : ''}<th>SWITCH OFF</th></tr></thead>
			<tbody>${PWR_DAYS.map(([d, n]) => html`<tr><td>${n}</td>
				${p.supported ? html`<td><input type="time" name="on_${d}" value="${p.days?.[d]?.on || ''}" aria-label="${n} switch on"></td>` : ''}
				<td><input type="time" name="off_${d}" value="${p.days?.[d]?.off || ''}" aria-label="${n} switch off"></td></tr>`)}</tbody></table></div>
		${p.enabled ? html`<p style="margin:10px 0 0">${p.supported ? html`Next switch-on: <b>${fmtPwr(p.next_on)}</b> · ` : ''}Next switch-off: <b>${fmtPwr(p.next_off)}</b></p>`
			: pwrHasTimes(p) ? html`<div class="banner" style="margin-top:10px">${svg(I.warn)}<span>The schedule is off – the times entered only apply with the tick at “Switch the schedule on”.</span></div>` : ''}
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="pwr-cancel">Cancel</button></div>
		<p class="note">${p.supported ? 'Empty fields: nothing on that day. The box shuts down cleanly (as with the button); while a storage job runs (e.g. a RAID rebuild) it stays on. To switch on, ShareOS sets the wake-up time of the device controller – do not unplug it.'
			: 'This box cannot switch itself on (no wake-up function) – only switching off by schedule works. Switch it on with the power button.'}</p>
	</form>`;
}

async function loadLog() {
	const box = $('#logbox');
	if (!box) return;
	try {
		const r = await rpc('shareos.system', 'log', { lines: 300, source: $('#log-src')?.value || 'system' });
		box.textContent = (r.lines || []).join('\n') || '(empty)';
		box.scrollTop = box.scrollHeight;
	} catch (e) { box.textContent = 'Error: ' + e.message; }
}

/* ---------- update flow ----------------------------------------------------- */

async function checkUpdates(quiet = false) {
	S.checking = true;
	if (S.route.sub === 'firmware') renderMain();
	try {
		S.check = await rpc('shareos.update', 'check');
		if (!quiet) toast(S.check.update_available ? `Update ${S.check.latest} available.` : 'ShareOS is up to date.');
	} catch (e) {
		if (!quiet && e.code !== 'auth') toast('Check failed: ' + e.message, true);
	}
	S.checking = false;
	renderHeader();
	if (S.route.tab === 'system' && S.route.sub === 'firmware') renderMain();
}

async function refreshUpdateStatus() {
	clearTimeout(S.updTimer);
	try {
		const prev = S.upd?.state;
		S.upd = await rpc('shareos.update', 'status');
		// the updater runs as its own process: right after a click its status can
		// still say 'ready'/'idle' for a moment – keep showing what was started
		const pend = S.updPending;
		if (pend && Date.now() < pend.until && ['ready', 'idle'].includes(S.upd.state)) S.upd = { ...S.upd, state: pend.state, step: '' };
		else S.updPending = null;
		// the box checks GitHub every 6 hours by itself; show what it found
		const had = S.check?.update_available ? S.check.latest : null;
		if (S.upd.check && (!S.check || S.upd.check.time >= (S.check.time || 0))) S.check = { ...S.upd.check, current: S.upd.current };
		if ((S.check?.update_available ? S.check.latest : null) !== had) renderHeader();
		// no result yet (fresh start) or an old one: ask now (GitHub allows 60 anonymous API calls per hour)
		if (!S.checking && !S.autoChecked && (!S.upd.check || Date.now() / 1000 - S.upd.check.time > 6 * 3600)) { S.autoChecked = true; checkUpdates(true); }
		// keep the page while a .bin is being checked/written below
		if (S.route.tab === 'system' && S.route.sub === 'firmware' && !document.activeElement?.matches('select') && !$('#bin-info:not(:empty)') && !$('#f-bin input')?.files?.length) renderMain();
		if (prev && prev !== S.upd.state && S.upd.state === 'ready') toast('Update downloaded and verified.');
		if (prev && prev !== S.upd.state && S.upd.state === 'flashed') toast('Update written – please reboot.');
		const busy = ['downloading', 'verifying', 'flashing'].includes(S.upd.state);
		S.updTimer = setTimeout(refreshUpdateStatus, busy || S.updPending ? 1000 : 30000);
	} catch (e) {
		if (e.code !== 'auth') S.updTimer = setTimeout(refreshUpdateStatus, 10000);
	}
}

/* ---------- actions (delegated clicks) -------------------------------------- */

const ACTIONS = {
	async 'df-pass'() { try { S.dfPass = S.dfPass ? null : await rpc('shareos.dnsfilter', 'password'); renderMain(); } catch (e) { toast(e.message, true); } },
	async 'df-refresh'() { try { await rpc('shareos.dnsfilter', 'refresh'); toast('Lists updated.'); loadDnsfilter(); } catch (e) { toast(e.message, true); } },
	async 'df-rwdel'(el) {
		if (!await confirmDlg('Remove entry?', el.dataset.domain + ' → ' + el.dataset.answer, 'Remove', true)) return;
		try { await rpc('shareos.dnsfilter', 'rewrite_remove', { domain: el.dataset.domain, answer: el.dataset.answer }); toast('Entry removed.'); loadDnsfilter(); } catch (e) { toast(e.message, true); }
	},
	async 'df-del'(el) {
		if (!await confirmDlg('Remove list?', el.dataset.url, 'Remove', true)) return;
		try { await rpc('shareos.dnsfilter', 'filter_remove', { url: el.dataset.url }); toast('List removed.'); loadDnsfilter(); } catch (e) { toast(e.message, true); }
	},
	async 'rec-apply'() {
		const on = (k) => !!$(`input[data-rec="${k}"]`)?.checked;
		const pick = (p) => [...document.querySelectorAll(`input[data-rec^="${p}:"]`)].filter((x) => x.checked).map((x) => x.dataset.rec.slice(p.length + 1));
		const args = { users: on('users'), shares: on('shares'), services: pick('svc'), apps: pick('app'), certificate: on('certificate'), ca: on('ca') };
		if (!await confirmDlg('Apply the selection?', 'The box applies the chosen settings and restarts.', 'Apply and restart')) return;
		recoveryEnd(args);
	},
	async 'rec-discard'() {
		if (!await confirmDlg('Take over nothing else?', 'The box stays as it is now: only password, network, name, time zone and drives come from the backup. The backup can be restored again later.', 'End recovery', true)) return;
		recoveryEnd(null);
	},
	async 'rec-apps-install'() {
		try { await rpc('shareos.recovery', 'apps_install'); S.recApps.running = true; toast('The apps are being installed in the background.'); renderMain(); }
		catch (err) { toast('Apps: ' + err.message, true); }
	},
	async 'rec-apps-dismiss'() {
		try { await rpc('shareos.recovery', 'apps_dismiss'); S.recApps = { pending: [], running: false }; renderMain(); }
		catch (err) { toast('Apps: ' + err.message, true); }
	},
	// the GitHub versions on the update page: the newest 3, or all of them
	'rel-all'() { S.relAll = !S.relAll; renderMain(); },
	'chips-more'() { S.chipsAll = !S.chipsAll; fitChips(); },
	'page-reload': () => location.reload(),
	'desk-view': () => setView('desktop'),
	theme() {
		S.theme = effTheme() === 'light' ? 'dark' : 'light';
		if (isUser()) S.me.ui = { ...S.me.ui, theme: S.theme };
		applyTheme(); renderHeader();
		if (isUser()) { renderUserHeader(); if (S.utab === 'settings') renderUserMain(); }
		else if (S.route.sub === 'appearance') renderMain();
		// plain users change it only for themselves (the look for everyone is an admin setting)
		saveLook({ theme: S.theme });
	},
	logout,
	accent(el) {
		S.accent = el.dataset.c; applyTheme();
		if (isUser()) { S.me.ui = { ...S.me.ui, accent: S.accent }; renderUserHeader(); renderUserMain(); } else { renderHeader(); renderMain(); }
		saveLook({ accent: S.accent });
	},
	async 'look-reset'() {
		try {
			S.me.ui = await rpc('shareos.me', 'ui_set', { theme: '', accent: '' });
			applyOwnLook(); store.set('theme', S.theme); store.set('accent', S.accent);
			renderUserHeader(); renderUserMain(); toast('Look reset to the one for everyone.');
		} catch (e) { toast('Appearance: ' + e.message, true); }
	},
	async 'pl-run'() { try { await rpc('shareos.paperless', 'run'); toast('Transfer started.'); setTimeout(loadPaperless, 5000); } catch (e) { toast(e.message, true); } },
	'pl-new'() { S.plEdit = { mode: 'new', data: { name: '', owner: '', share: '', tags: [], enabled: true } }; renderMain(); },
	async 'pl-edit'(el) {
		const ib = S.pl.inboxes.find((x) => x.name === el.dataset.name);
		S.plEdit = { mode: 'edit', data: structuredClone(ib), tags: null };
		renderMain();
		try { S.plEdit.tags = (await rpc('shareos.paperless', 'tags', { inbox: ib.name })).tags; renderMain(); } catch (e) { }
	},
	'pl-cancel'() { S.plEdit = null; renderMain(); },
	async 'pl-test'() {
		const f = $('#f-inbox'), ed = S.plEdit;
		try {
			const r = await rpc('shareos.paperless', 'test', { url: S.pl.url, token: f.token.value.trim(), inbox: ed.mode === 'edit' ? ed.data.name : '' });
			toast(`Connection OK – ${r.documents} documents in Paperless.`);
		} catch (e) { toast('Paperless: ' + e.message, true); }
	},
	async 'pl-log'(el) { try { S.plLog = { name: el.dataset.name, entries: (await rpc('shareos.paperless', 'log', { inbox: el.dataset.name })).entries }; renderMain(); } catch (e) { toast(e.message, true); } },
	'pl-log-close'() { S.plLog = null; renderMain(); },
	async 'pl-del'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove inbox “${n}”?`, 'Nothing will be sent any more. The folder and the files in it are kept.', 'Remove')) return;
		try { await rpc('shareos.paperless', 'inbox_del', { name: n }); toast(`Inbox “${n}” removed.`); loadPaperless(); } catch (e) { toast(e.message, true); }
	},

	async 'cl-install'() {
		try { await rpc('shareos.cloud', 'install'); S.cloud.data.status.installing = true; renderMain(); setTimeout(() => loadCloud('admin'), 3000); }
		catch (e) { toast('rclone: ' + e.message, true); }
	},
	'cl-rnew'(el) { S.cloud.remoteEdit = { type: 'webdav' }; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-auth'(el) {
		const scope = el.dataset.scope, re = S.cloud.remoteEdit, f = $('#f-remote');
		re.name = f.name.value;
		const w = window.open('about:blank', '_blank');
		el.disabled = true;
		try {
			const r = scope === 'admin' ? await rpc('shareos.cloud', 'auth_start', { type: re.type }) : await rpc('shareos.me', 'cloud_auth_start', { type: re.type });
			if (w) w.location.href = r.url; else window.open(r.url, '_blank');
			re.authUrl = r.url; re.authed = false;
		} catch (e) { w?.close(); toast('Sign in: ' + e.message, true); }
		scope === 'admin' ? renderMain() : renderUserMain();
	},
	async 'cl-authfin'(el) {
		const scope = el.dataset.scope, re = S.cloud.remoteEdit, f = $('#f-remote');
		re.name = f.name.value;
		el.disabled = true;
		try {
			const url = f.auth_url.value.trim();
			if (scope === 'admin') await rpc('shareos.cloud', 'auth_finish', { url }); else await rpc('shareos.me', 'cloud_auth_finish', { url });
			re.authed = true; toast('Signed in – now “Add”.');
		} catch (e) { toast('Sign in: ' + e.message, true); }
		scope === 'admin' ? renderMain() : renderUserMain();
	},
	'cl-rcancel'(el) { S.cloud.remoteEdit = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-rtest'(el) {
		el.disabled = true;
		try { const r = await CLOUD_API[el.dataset.scope].testRemote(el.dataset.name); toast(`${el.dataset.name}: connection OK (${r.folders} folders).`); }
		catch (e) { toast(`${el.dataset.name}: ${e.message}`, true); }
		el.disabled = false;
	},
	async 'cl-rdel'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove account “${n}”?`, 'The credentials are deleted. Jobs using this account stop working. Nothing is deleted in the cloud.', 'Remove')) return;
		try { await CLOUD_API[el.dataset.scope].delRemote(n); toast(`Account “${n}” removed.`); loadCloud(el.dataset.scope); } catch (e) { toast(e.message, true); }
	},
	'cl-jnew'(el) {
		const d = S.cloud.data;
		S.cloud.jobEdit = { mode: 'new', data: { name: '', local: d.locals[0]?.[0] || '', remote: d.remotes[0]?.name || '', remote_path: '', mode: 'upload', schedule: '30 2 * * *', bwlimit: '', enabled: true } };
		el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); window.scrollTo(0, 0);
	},
	'cl-jedit'(el) {
		S.cloud.jobEdit = { mode: 'edit', data: structuredClone(S.cloud.data.jobs.find((j) => j.name === el.dataset.name)) };
		el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); window.scrollTo(0, 0);
	},
	'cl-jcancel'(el) { S.cloud.jobEdit = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-jrun'(el) {
		el.disabled = true;
		try { await CLOUD_API[el.dataset.scope].runJob(el.dataset.name); toast(`Job “${el.dataset.name}” started.`); setTimeout(() => loadCloud(el.dataset.scope), 1500); }
		catch (e) { toast(e.message, true); el.disabled = false; }
	},
	async 'cl-jstop'(el) { try { await CLOUD_API[el.dataset.scope].stopJob(el.dataset.name); toast('Stopped.'); setTimeout(() => loadCloud(el.dataset.scope), 1500); } catch (e) { toast(e.message, true); } },
	async 'cl-jlog'(el) {
		try { S.cloud.log = { name: el.dataset.name, lines: (await CLOUD_API[el.dataset.scope].log(el.dataset.name)).lines }; renderMain(); } catch (e) { toast(e.message, true); }
	},
	'cl-logclose'(el) { S.cloud.log = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-jdel'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove job “${n}”?`, 'The job will not run any more. Files on the NAS and in the cloud stay as they are.', 'Remove')) return;
		try { await CLOUD_API[el.dataset.scope].delJob(n); toast(`Job “${n}” removed.`); loadCloud(el.dataset.scope); } catch (e) { toast(e.message, true); }
	},
	async 'tr-revoke'(el) {
		const u = el.dataset.user;
		if (!await confirmDlg(`Revoke the remote password of “${u}”?`, 'Programs using this password lose access. The user can create a new one in the Transmission app.', 'Revoke', true)) return;
		try { S.tremote = await rpc('shareos.tremote', 'revoke', { user: u }); toast(`Remote password of “${u}” revoked.`); } catch (e) { toast(e.message, true); }
		renderMain();
	},
	async 'dlna-rescan'(el) {
		el.disabled = true;
		try { S.dlna = await rpc('shareos.dlna', 'rescan'); toast('Media server reads all folders again.'); } catch (e) { toast(e.message, true); }
		loadDlna();
	},
	'sn-new'() {
		const d = S.snap.data, t = d.volumes.find((v) => v.links), src = d.sources.find((x) => x.kind === 'share') || d.sources[0];
		S.snap.edit = { mode: 'new', data: { name: '', source: src?.id || '', target: (d.volumes.find((v) => v.links && v.name !== (src?.volume || src?.name)) || t)?.name || '',
			every: 'day', time: '03:15', keep_last: 3, keep_daily: 7, keep_weekly: 4, keep_monthly: 6, exclude: [], enabled: true } };
		renderMain(); window.scrollTo(0, 0);
	},
	'sn-edit'(el) { S.snap.edit = { mode: 'edit', data: structuredClone(S.snap.data.jobs.find((j) => j.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'sn-cancel'() { S.snap.edit = null; renderMain(); },
	async 'sn-run'(el) {
		el.disabled = true;
		try { await rpc('shareos.snapshots', 'run', { name: el.dataset.name }); toast(`Snapshot “${el.dataset.name}” is running.`); } catch (e) { toast(e.message, true); }
		loadSnapshots();
	},
	async 'sn-stop'(el) {
		el.disabled = true;
		try { await rpc('shareos.snapshots', 'stop', { name: el.dataset.name }); } catch (e) { toast(e.message, true); }
		setTimeout(loadSnapshots, 1500);
	},
	'sn-list'(el) { S.snap.open = S.snap.open === el.dataset.name ? null : el.dataset.name; renderMain(); },
	'sn-listclose'() { S.snap.open = null; renderMain(); },
	async 'sn-log'(el) {
		try { S.snap.log = { name: el.dataset.name, text: (await rpc('shareos.snapshots', 'log', { name: el.dataset.name })).log }; renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sn-logclose'() { S.snap.log = null; renderMain(); },
	async 'sn-rm'(el) {
		const n = el.dataset.name, x = el.dataset.snap, j = S.snap.data.jobs.find((y) => y.name === n), sn = j?.snapshots.find((y) => y.name === x);
		if (!await confirmDlg('Delete snapshot?', `Delete the state of ${fmtTime(sn?.time)}? The other snapshots stay complete.`, 'Delete', true)) return;
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'remove', { name: n, snapshot: x })).jobs; toast('Snapshot deleted.'); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sn-browse'(el) {
		const j = S.snap.data.jobs.find((y) => y.name === el.dataset.name);
		const f = fbInit();
		f.root = j.target; f.path = `Snapshots/${j.name}/${el.dataset.snap}`; f.data = null; f.sel = new Set();
		location.hash = '#/shares/files';
	},
	async 'sn-del'(el) {
		const n = el.dataset.name, j = S.snap.data.jobs.find((y) => y.name === n);
		if (!await confirmDlg(`Remove job “${n}”?`, 'No new snapshots will be taken.', 'Remove')) return;
		const data = j.snapshots.length > 0 && await confirmDlg('Delete the snapshots too?', `Also delete the ${j.snapshots.length} snapshots in ${j.target}/Snapshots/${n}? Otherwise they stay there.`, 'Delete snapshots', true);
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'job_del', { name: n, data })).jobs; toast(`Job “${n}” removed.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sh-new'() {
		S.shEdit = { mode: 'new', data: { name: '', volume: S.vols[0]?.name || '', path: '', comment: '', smb: true, guest: false, nfs: false, nfs_rw: false, nfs_hosts: [], rw: [], ro: [] } };
		renderMain(); window.scrollTo(0, 0);
	},
	'sh-edit'(el) { S.shEdit = { mode: 'edit', data: structuredClone(S.shares.shares.find((x) => x.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'sh-cancel'() { S.shEdit = null; renderMain(); },
	async 'cl-browse'(el) {
		const f = $('#f-job'), p = S.cloud?.data?.places?.[f.local.value];
		if (!p) return;
		const r = await folderDlg('Choose folder', [p], { path: f.sub.value.trim() });
		if (r) f.sub.value = r.path;
	},
	async 'dlna-subadd'() {
		const places = (S.dlna?.share_dirs || []).map((x) => ({ name: x.name, root: x.volume, base: x.path }));
		const r = await folderDlg('Choose folder', places);
		if (!r) return;
		if (!r.path) { toast('Choose whole shares in the list above.', true); return; }
		if (!S.dlnaSubs.some((m) => m.share === r.place && m.path === r.path)) S.dlnaSubs.push({ share: r.place, path: r.path, type: 'V' });
		renderMain();
	},
	'dlna-subdel'(el) { S.dlnaSubs.splice(+el.dataset.i, 1); renderMain(); },
	async 'sh-browse'() {
		const f = $('#f-share'), v = f.volume.value;
		const r = await folderDlg('Choose folder', [{ name: v, root: v, base: '' }], { path: f.path.value.trim() || f.name.value.trim() });
		if (r) f.path.value = r.path;
	},
	async 'vault-unlock'(el) {
		const r0 = await vaultDlg(el.dataset.share, +el.dataset.ttl || 15);
		if (!r0) return;
		try {
			const r = await rpc('shareos.me', 'vault_unlock', { share: el.dataset.share, minutes: r0.minutes, password: r0.password });
			toast(`Vault “${el.dataset.share}” is open until ${vaultTime(r.until)}.`);
			if (isUser()) { S.me = { ...S.me, ...r }; renderUserMain(); } else loadShareData();
		} catch (e) { toast('Vault: ' + e.message, true); }
	},
	async 'vault-lock'(el) {
		try { S.me = { ...S.me, ...await rpc('shareos.me', 'vault_lock', { share: el.dataset.share }) }; toast(`Vault “${el.dataset.share}” locked.`); renderUserMain(); }
		catch (e) { toast('Vault: ' + e.message, true); }
	},
	async 'sh-vlock'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Lock vault “${n}” now?`, 'The vault disappears from the network for everyone who unlocked it. Open connections lose access.', 'Lock')) return;
		try { S.shares = await rpc('shareos.shares', 'vault_lock', { name: n }); toast(`Vault “${n}” locked.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	async 'sh-del'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove share “${n}”?`, 'The share disappears from the network. The folder and all files in it stay on the drive.', 'Remove')) return;
		try { S.shares = await rpc('shareos.shares', 'del', { name: n }); toast(`Share “${n}” removed.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'u-new'() {
		S.uEdit = { mode: 'new', data: { name: '', fullname: '', role: 'share', home: S.vols.filter(linuxFs)[0]?.name || '', quota: 0, web: true, groups: [] } };
		renderMain(); window.scrollTo(0, 0);
	},
	'u-edit'(el) { S.uEdit = { mode: 'edit', data: structuredClone(S.acc.users.find((x) => x.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'u-cancel'() { S.uEdit = null; renderMain(); },
	async 'u-pass'(el) {
		const n = el.dataset.name;
		const p = await promptDlg(`Password for ${n}`, 'New password (at least 6 characters). Used for shares and – depending on the role – for the web interface.', '', 'Set', 'password');
		if (p == null) return;
		try { await rpc('shareos.accounts', 'passwd', { name: n, password: p }); toast(`Password of ${n} changed.`); } catch (e) { toast(e.message, true); }
	},
	async 'u-del'(el) {
		const n = el.dataset.name, u = S.acc.users.find((x) => x.name === n);
		if (!await confirmDlg(`Delete user “${n}”?`, `The account is removed; rights on shares are dropped.${u?.home ? ' The personal folder is kept.' : ''}`, 'Delete', true)) return;
		try { S.acc = await rpc('shareos.accounts', 'del', { name: n }); toast(`User “${n}” deleted.`); loadShareData(); } catch (e) { toast(e.message, true); }
	},
	async 'u-altf'() {
		if (!await confirmDlg('Import users from Alt-F?', 'Users and groups from the kept Alt-F settings are created (role “Shares only”). Passwords are taken over where Alt-F stored them.', 'Apply')) return;
		try {
			const r = await rpc('shareos.accounts', 'import_altf');
			S.acc = r;
			toast(r.imported.length ? `Imported: ${r.imported.join(', ')}` : 'No new users found.');
			if (r.skipped.length) toast(`Skipped: ${r.skipped.join(', ')}`, true);
			renderMain();
		} catch (e) { toast('Alt-F: ' + e.message, true); }
	},
	async 'g-new'() {
		const g = ((await promptDlg('New group', 'Group name (a–z, 0–9 and _, starting with a letter):', '', 'Create')) || '').toLowerCase();
		if (!g) return;
		try { S.acc = await rpc('shareos.accounts', 'group_add', { name: g }); toast(`Group “${g}” created.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	async 'g-del'(el) {
		const g = el.dataset.name;
		if (!await confirmDlg(`Delete group “${g}”?`, 'The members stay, but lose the permissions given through this group.', 'Delete', true)) return;
		try { S.acc = await rpc('shareos.accounts', 'group_del', { name: g }); toast(`Group “${g}” deleted.`); loadShareData(); } catch (e) { toast(e.message, true); }
	},
	view(el) {
		const id = el.dataset.id;
		S.views[id] = isTable(id) ? 'tiles' : 'table';
		store.set('views', JSON.stringify(S.views));
		renderMain();
	},
	async 'net-confirm'() {
		try { await rpc('shareos.net', 'confirm'); toast('New network settings confirmed.'); } catch (e) { toast(e.message, true); }
		S.net = null; loadNet();
	},
	check() { checkUpdates(); },
	'fr-next'() { const e = frCollect(); if (e) { toast(e, true); return; } frGo(1); },
	'fr-back'() { frCollect(); frGo(-1); },
	async 'fr-skip'() {
		if (!await confirmDlg('Skip first-time setup?', S.fr?.st?.default_password !== false ? 'Everything can be set later under System. The password stays "shareos" until you change it.' : 'Everything can be set later under System.', 'Skip')) return;
		try { await rpc('shareos.setup', 'apply', {}); } catch (e) { }
		frEnd('overview');
	},
	async 'fr-finish'(el) {
		const f = S.fr;
		el.disabled = true;
		try {
			const tzChanged = f.timezone !== f.st.timezone;
			await rpc('shareos.setup', 'apply', { altf: f.altf.found && f.use_altf, password: f.password,
				hostname: f.hostname !== f.st.hostname ? f.hostname : '', timezone: tzChanged ? f.timezone : '', channel: f.channel });
			toast('First-time setup finished.');
			frEnd(el.dataset.next);
		} catch (e) { toast(e.message, true); el.disabled = false; }
	},
	async 'fr-again'() {
		try { await rpc('shareos.setup', 'reset'); try { sessionStorage.setItem('shareos.frstep', '0'); } catch (e) { } checkFirstRun(true); }
		catch (e) { toast(e.message, true); }
	},

	'wiz-start'() {
		const disks = (S.storage?.disks || []).filter((d) => !d.usb && !d.rm && d.tran !== 'usb').map((d) => d.name);
		S.wiz = { step: 0, disks: disks.slice(0, 2), layout: disks.length >= 2 ? 'mirror' : 'single', swap: 1024, names: { __mirror: 'data' }, fs: { __mirror: 'ext4' } };
		renderMain();
		window.scrollTo(0, 0);
	},
	'wiz-cancel'() { S.wiz = null; renderMain(); },
	'wiz-back'() { wizardCollect(); S.wiz.step--; renderMain(); },
	'wiz-next'() {
		wizardCollect();
		const err = wizardCheck();
		if (err) { toast(err, true); return; }
		const w = S.wiz;
		if (w.step === 1 && w.layout === 'single') w.disks.forEach((d, k) => { if (!w.names[d]) w.names[d] = k ? 'data' + (k + 1) : 'data'; });
		w.step++;
		renderMain();
	},
	async 'wiz-run'() {
		const w = S.wiz;
		if (!await confirmDlg('Erase and set up the disks?', `${w.disks.join(' and ')} will be erased completely. This cannot be undone.`, 'Erase & set up', true)) return;
		const args = pairLayout(w.layout)
			? { layout: w.layout, name: w.names.__mirror, disks: w.disks, swap: w.swap, fs: w.fs.__mirror || 'ext4', confirm: true }
			: { layout: 'single', volumes: w.disks.map((d) => ({ name: w.names[d], disk: d, fs: w.fs[d] || 'ext4' })), swap: w.swap, confirm: true };
		try { await rpc('shareos.storage', 'setup', args); S.wiz = null; toast('Setup started.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Setup: ' + e.message, true); }
	},
	async adopt(el) {
		const { part, fs, size } = el.dataset;
		const name = await promptDlg(`Take over ${part}`, `${part} (${FS_NAME[fs] || fs}, ${fmtBytes(+size)}) is added as a drive as it is – nothing is erased. Name of the drive (a–z, 0–9, - and _, at most 16 characters):`, 'data', 'Apply', 'text', 16);
		if (!name) return;
		if (!NAME_RE.test(name.toLowerCase())) { toast('Invalid name.', true); return; }
		el.disabled = true;
		try {
			await rpc('shareos.storage', 'adopt', { name: name.toLowerCase(), part });
			toast(`${part} is now the drive “${name.toLowerCase()}” – the data is kept. Create shares for existing folders under “Shares”.`);
		} catch (e) { toast(`Take over ${part}: ${e.message}`, true); el.disabled = false; }
		loadStorage();
	},
	async format(el) {
		const disk = el.dataset.disk;
		const d = S.storage.disks.find((x) => x.name === disk);
		const r = await fsDlg(`Format ${disk}`, 'Name of the new volume (a–z, 0–9, - and _, at most 16 characters) and file system:', 'data', FS_DISK, 'ext4', 'Next');
		if (!r) return;
		const name = r.name.toLowerCase();
		if (!NAME_RE.test(name)) { toast('Invalid name.', true); return; }
		if (!await confirmDlg(`Erase ${disk}?`, `${disk} (${d?.model || ''}, ${fmtBytes(d?.size)}) is erased completely and set up again as volume “${name}” (${FS_NAME[r.fs]}).`, 'Erase & format', true)) return;
		try { await rpc('shareos.storage', 'setup', { layout: 'single', volumes: [{ name, disk, fs: r.fs }], confirm: true }); toast('Formatting started.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Format: ' + e.message, true); }
	},
	async 'usb-eject'(el) {
		el.disabled = true;
		try {
			await rpc('shareos.storage', 'usb_eject', { disk: el.dataset.disk });
			toast(`${el.dataset.disk} can be unplugged now.`);
		} catch (e) { toast('Remove: ' + e.message, true); el.disabled = false; }
		setTimeout(loadStorage, 800);
	},
	async 'usb-format'(el) {
		const disk = el.dataset.disk, d = S.storage.disks.find((x) => x.name === disk);
		const r = await fsDlg(`Format ${disk}`, `${d?.model || 'USB drive'}, ${fmtBytes(d?.size)} – name (letters, digits, spaces, - and _) and file system:`, 'USB', FS_USB, 'exfat', 'Next');
		if (!r) return;
		if (!/^[A-Za-z0-9 _-]{1,16}$/.test(r.name)) { toast('Invalid name.', true); return; }
		if (!await confirmDlg(`Erase ${disk}?`, `Everything on ${disk} is erased. Afterwards it is a ${FS_NAME[r.fs]} drive “${r.name}”.`, 'Erase & format', true)) return;
		try { await rpc('shareos.storage', 'usb_format', { disk, fs: r.fs, name: r.name, confirm: true }); toast('Formatting started.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Format: ' + e.message, true); }
	},
	async 'usb-copy'(el) {
		el.disabled = true;
		try { await rpc('shareos.storage', 'usb_copy'); toast('USB copy started.'); }
		catch (e) { toast('USB copy: ' + (USB_COPY_ERR[e.message] || e.message), true); }
		setTimeout(loadStorage, 1500);
	},
	async smart(el) {
		el.disabled = true;
		try { await rpc('shareos.storage', 'smart', { disk: el.dataset.disk }); } catch (e) { toast('SMART: ' + e.message, true); }
		loadStorage();
	},
	async 'smart-test'(el) {
		const disk = el.dataset.disk, t = el.dataset.t;
		if (t === 'long' && !await confirmDlg('Start the long test?', `The long test reads the whole disk ${disk} – many hours for large disks. The box stays usable, the disk is a bit slower.`, 'Start')) return;
		el.disabled = true;
		try { await rpc('shareos.storage', 'smart_test', { disk, type: t }); toast(t === 'abort' ? 'Self-test aborted.' : 'Self-test started.'); }
		catch (e) { toast('Self-test: ' + e.message, true); }
		loadStorage();
	},
	'smart-attrs'(el) {
		S.hOpen = S.hOpen || new Set();
		const d = el.dataset.disk;
		if (S.hOpen.has(d)) S.hOpen.delete(d); else S.hOpen.add(d);
		renderMain();
	},
	async 'vol-repair'(el) {
		const name = el.dataset.name, st = S.storage, v = (st.volumes || []).find((x) => x.name === name);
		const md = arrayOf(st, v?.device), cand = md ? repairCandidates(st, md) : [];
		if (!cand.length) return;
		const d = cand[0];
		if (!await confirmDlg(`Repair mirror “${name}”?`, `${d.name} (${d.model || ''} · ${fmtBytes(d.size)}) is erased completely and added to the mirror as the second disk. The data is then copied in the background (several hours for large disks); the volume stays usable.`, 'Erase & repair', true)) return;
		try { await rpc('shareos.storage', 'repair', { name, disk: d.name, confirm: true }); toast('Repair started.'); }
		catch (e) { toast(`${name}: ${e.message}`, true); }
		loadStorage();
	},

	async vol(el) {
		const { name, op } = el.dataset;
		if (op === 'forget' && !await confirmDlg(`Remove "${name}"?`, 'The drive is unmounted and removed from the configuration. The data on the disk stays until it is set up again.', 'Remove')) return;
		try { await rpc('shareos.storage', 'volume', { name, action: op }); toast(`${name}: ${op === 'mount' ? 'mounted' : op === 'umount' ? 'unmounted' : 'removed'}`); }
		catch (e) { toast(`${name}: ${e.message}`, true); }
		loadStorage();
	},

	log() { loadLog(); },

	async svc(el) {
		const { name, op } = el.dataset;
		el.disabled = true;
		try {
			const r = await rpc('shareos.service', 'action', { name, action: op });
			if (r.delayed) { waitForBox('Service is restarting', 'waiting for the box', false); return; }
			// the box says what the service does now: success only when that fits
			const done = r.ok !== false && (op === 'stop' ? r.running !== true : r.running !== false);
			const why = String(r.output || '').trim().split('\n').pop();
			if (done) toast(`${name}: ${op === 'start' ? 'started' : op === 'stop' ? 'stopped' : 'restarted'}`);
			else toast(name + ': ' + (op === 'start' ? 'did not start' : op === 'stop' ? 'did not stop' : 'did not restart') + (why ? ' – ' + why : ''), true);
		} catch (e) { toast(`${name}: ${e.message}`, true); }
		loadServices();
	},

	async download(el) {
		el.disabled = true;
		S.updPending = { state: 'downloading', until: Date.now() + 15000 };
		S.upd = { ...S.upd, state: 'downloading', progress: null };
		renderMain();
		try { await rpc('shareos.update', 'download', { tag: el.dataset.tag }); refreshUpdateStatus(); }
		catch (e) { S.updPending = null; toast('Download: ' + e.message, true); refreshUpdateStatus(); }
	},

	async apply(el) {
		const tag = el.dataset.tag;
		el.disabled = true;
		if (!await confirmDlg('Install update?', `ShareOS ${(el.dataset.ver || tag).replace(/^v/, '')} will be written to flash. A reboot is needed afterwards, during which the new system is installed. Do not switch the box off while writing.`, 'Install')) { el.disabled = false; return; }
		S.updPending = { state: 'flashing', until: Date.now() + 15000 };
		S.upd = { ...S.upd, state: 'flashing', step: '' };
		renderMain();
		try { await rpc('shareos.update', 'apply', { tag, confirm: true }); refreshUpdateStatus(); }
		catch (e) { S.updPending = null; toast('Install: ' + e.message, true); refreshUpdateStatus(); }
	},

	async 'time-sync'(el) {
		el.disabled = true;
		try { setTime(await rpc('shareos.time', 'sync')); toast('Time synced.'); renderMain(); }
		catch (e) { toast('Sync: ' + e.message, true); el.disabled = false; }
	},
	'time-browser'() {
		const f = $('#f-clock');
		if (f && S.time) f.dt.value = localInput({ now: Math.floor(Date.now() / 1000), timezone: S.time.timezone });
	},

	async 'upd-ack'() {
		try { S.upd = await rpc('shareos.update', 'ack'); renderMain(); } catch (e) { toast(e.message, true); }
	},

	async 'job-clear'() {
		try { await rpc('shareos.storage', 'job_clear'); if (S.storage) S.storage.job = null; renderMain(); } catch (e) { toast(e.message, true); }
	},

	async 'net-dismiss'() {
		try { await rpc('shareos.net', 'dismiss'); if (S.net) S.net.result = null; renderMain(); } catch (e) { toast(e.message, true); }
	},

	async cancel() {
		try { S.upd = await rpc('shareos.update', 'cancel'); renderMain(); } catch (e) { toast(e.message, true); }
	},


	async 'prn-test'(el) {
		try { await rpc('shareos.printer', 'test', { lp: el.dataset.id }); toast('Test page sent.'); }
		catch (e) { toast('Test page: ' + e.message, true); }
	},

	async 'ddns-now'() {
		try { await rpc('shareos.web', 'ddns_update'); toast('Reporting …'); setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 5000); }
		catch (e) { toast('DynDNS: ' + e.message, true); }
	},

	async 'ca-init'() {
		try { await rpc('shareos.web', 'ca_init'); toast('Certificate authority created.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-root'() {
		try { const r = await rpc('shareos.web', 'ca_pem', { kind: 'root' }); pemDownload(r.pem, 'shareos-ca.crt'); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-web'() {
		if (!await confirmDlg('Use a certificate of the own CA?', 'The box gets a certificate of its own CA for the device name, the .local name and the IP address; it replaces the current one. Without the root certificate installed, the browser keeps warning.', 'Use')) return;
		try { await rpc('shareos.web', 'ca_web'); toast('Certificate installed – the page reconnects.'); afterWebRestart(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-dl'(el) {
		try { const r = await rpc('shareos.web', 'ca_pem', { name: el.dataset.id, kind: el.dataset.kind }); pemDownload(r.pem, el.dataset.id + (el.dataset.kind === 'key' ? '.key' : '.crt')); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},

	async 'ca-del'(el) {
		if (!await confirmDlg('Delete certificate?', `The certificate “${el.dataset.id}” and its key are deleted from the box. Devices that already use it keep their copy.`, 'Delete', true)) return;
		try { await rpc('shareos.web', 'ca_delete', { name: el.dataset.id }); toast('Deleted.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},

	async 'acme-off'() {
		if (!await confirmDlg('Switch off Let\'s Encrypt?', 'The box then uses a self-signed certificate again.', 'Switch off')) return;
		try { await rpc('shareos.web', 'acme_off'); toast('Switched off – the page reconnects.'); await loadNetExtra(); afterWebRestart(); }
		catch (e) { toast('Let\'s Encrypt: ' + e.message, true); }
	},

	async 'cert-self'() {
		if (!await confirmDlg('New self-signed certificate?', 'A new certificate for the current name and IP is created and replaces the old one. Browsers will show a warning once again.', 'Create')) return;
		try { const r = await rpc('shareos.web', 'selfsigned'); S.web.cert = r.cert; toast('Certificate created.'); afterWebRestart(); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},

	async reboot() {
		if (!await confirmDlg('Reboot?', 'The box reboots. This page reconnects on its own (about 1–2 minutes).', 'Reboot')) return;
		try { await rpc('shareos.system', 'reboot'); } catch (e) { }
		stopPolling();
		waitForBox('Rebooting', 'ShareOS is restarting');
	},

	'pwr-edit'() { S.pwrEdit = true; renderMain(); },
	'pwr-cancel'() { S.pwrEdit = false; renderMain(); },
	async poweroff() {
		// with a power schedule: when the box will come on again
		let p = null;
		try { p = await rpc('shareos.system', 'power_schedule'); } catch (e) { p = null; }
		const back = p?.supported && p.enabled && p.next_on ? `By schedule it switches on again on ${fmtPwr(p.next_on)}.` : 'Switching on afterwards only at the device.';
		if (!await confirmDlg('Power off?', `ShareOS shuts down and the box switches off. ${back}`, 'Power off', true)) return;
		try { await rpc('shareos.system', 'poweroff', { confirm: true }); } catch (e) { toast(e.message, true); return; }
		stopPolling();
		cover('Box is powering off', 'You can close this window.');
	},

	async factory() {
		if (!await confirmDlg('Factory reset?', 'All settings and installed packages are erased, then the box reboots. Afterwards it has no password: press the USB button on its front, then choose a new one.', 'Reset', true)) return;
		try { await rpc('shareos.system', 'factory_reset', { confirm: true }); } catch (e) { toast(e.message, true); return; }
		stopPolling();
		store.del('sid');
		waitForBox('Factory reset', 'ShareOS is restarting');
	}
};

document.addEventListener('click', (e) => {
	const el = e.target.closest('[data-act]');
	if (!el || el.disabled) return;
	const fn = ACTIONS[el.dataset.act];
	if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('change', (e) => {
	if (e.target.name === 'wiz-layout' && S.wiz) { wizardCollect(); renderMain(); }
	if (e.target.classList.contains('wiz-fs') && S.wiz) { wizardCollect(); renderMain(); }
});

// The page changed (classic: another address; desktop: another window came to
// the front): stop what only the page left behind needs, load what the new one
// shows. Edits in progress are dropped in the classic view only – in the
// desktop view the other window is still there (see pageClosed).
function pageChanged() {
	if (isUser()) {
		if (S.fb && S.utab === 'files') S.fb.roots = null;
		renderUserTabs(); renderUserMain();
		return;
	}
	const keep = !!S.desk;
	if (S.route.tab !== 'storage') { clearTimeout(S.stTimer); S.stTimer = null; S.stActive = false; }
	if (S.route.tab !== 'storage' || S.route.sub !== 'snapshots') { clearTimeout(S.snapTimer); if (S.snap && !keep) { S.snap.edit = null; S.snap.log = null; } }
	if (S.route.tab !== 'shares' && !keep) { S.shEdit = null; S.uEdit = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'dlna') clearTimeout(S.dlnaTimer);
	if (S.route.tab !== 'services' || S.route.sub !== 'printer') { clearTimeout(S.prnTimer); S.prnTimer = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'ups') { clearTimeout(S.upsTimer); S.upsTimer = null; }
	if (S.route.tab === 'services' && S.route.sub === 'torrent' && S.tremote) loadTremote();
	// the DNS filter may have been switched elsewhere (Services, another window): fresh state, not the form of the last visit
	if (S.route.tab === 'dnsfilter' && S.df) loadDnsfilter();
	if (S.fb && S.route.sub === 'files') S.fb.roots = null;   // volumes may have changed
	if (S.route.tab !== 'paperless') { if (!keep) { S.plEdit = null; S.plLog = null; } } else if (S.pl) loadPaperless();
	if (S.route.tab !== 'dnsfilter') { clearTimeout(S.dfTimer); if (!keep) S.dfPass = null; } else if (S.df) loadDnsfilter();
	if (S.route.tab !== 'cloud') { clearTimeout(S.cloudTimer); if (S.cloud?.scope === 'admin' && !keep) { S.cloud.remoteEdit = null; S.cloud.jobEdit = null; S.cloud.log = null; } }
	else if (S.cloud?.scope === 'admin') loadCloud('admin');
	else if (S.shares) loadShareData();
	renderTabs();
	renderMain();
}
// desktop view: the window of a page was closed – drop its edits in progress
function pageClosed(r) {
	if (r.tab === 'storage' && r.sub === 'snapshots' && S.snap) { S.snap.edit = null; S.snap.log = null; }
	if (r.tab === 'shares') { S.shEdit = null; S.uEdit = null; }
	if (r.tab === 'paperless') { S.plEdit = null; S.plLog = null; }
	if (r.tab === 'dnsfilter') S.dfPass = null;
	if (r.tab === 'cloud' && S.cloud?.scope === 'admin') { S.cloud.remoteEdit = null; S.cloud.jobEdit = null; S.cloud.log = null; }
}

window.addEventListener('hashchange', () => {
	if (!S.sid) return;
	// desktop view: an address opens (or brings forward) the window of that page
	if (S.desk) { if (typeof deskNav === 'function') deskNav(location.hash); return; }
	if (!mainEl()) return;
	if (isUser()) parseUserRoute(); else parseRoute();
	pageChanged();
	window.scrollTo(0, 0);
});

// clock in the header without waiting for the next poll: for admins the
// clock of the box (boxNow), for plain users – who get no box time – the
// browser's
setInterval(() => {
	const c = $('.clock');
	if (!c) return;
	const now = isUser() ? new Date() : boxNow();
	if (now) c.textContent = now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
}, 10000);

// "My ShareOS": storage use, shares and open vaults change without the user
// doing anything (uploads from a PC, a vault that closes) – the data is read
// again every minute while that page is shown and nobody types in it
setInterval(async () => {
	if (!isUser() || !S.sid || S.utab !== 'me' || S.desk || document.hidden) return;
	if (document.querySelector('dialog[open]') || document.activeElement?.matches?.('input, select, textarea')) return;
	try { S.me = { ...S.me, ...(await rpc('shareos.me', 'get')) }; renderUserMain(); } catch (e) { /* the next round tries again */ }
}, 60000);

/* ---------- file browser (admins: all volumes, users: personal folder + shares by rights) */

function fbInit() {
	if (!S.fb) S.fb = { roots: null, root: '', path: '', data: null, sel: new Set(), hidden: false, uploads: [], err: null };
	if (!S.fbApps) { S.fbApps = { apps: [] }; loadOpeners(); }
	return S.fb;
}

const fbRootLabel = (r) => (r.home ? 'Personal folder' : r.ro ? r.name + ' (read only)' : r.name);
const fbJoin = (a, b) => (a ? a + '/' + b : b);

async function fbLoad(path) {
	const f = fbInit();
	try {
		if (!f.roots) {
			const rr = await rpc('shareos.files', 'roots');
			f.roots = rr.roots || []; f.trashConf = rr.trash || { enabled: false, days: 0 };
			if (!f.roots.some((r) => r.name === f.root)) { f.root = f.roots[0]?.name || ''; f.path = ''; }
		}
		if (f.root) {
			const d = await rpc('shareos.files', 'list', { root: f.root, path: path ?? f.path, hidden: f.hidden });
			f.data = d; f.path = d.path; f.sel = new Set(); f.err = null;
		}
	} catch (e) {
		f.err = e.message;
		if (path != null && path !== f.path) { toast('Files: ' + e.message, true); f.err = null; }
	}
	fbRender();
}

function fbRender() {
	const box = $('#fb');
	if (box) box.innerHTML = fbInner().s;
	const ts = $('#fb-trashset');
	if (ts) ts.innerHTML = trashSettings().s ?? '';
}

function filesView() {
	const f = fbInit();
	if (!f.roots && !f.err) fbLoad();
	return html`<section class="sec"><div id="fb">${fbInner()}</div></section>`;
}

function fbInner() {
	const f = S.fb, d = f.data;
	if (f.err && !d) return html`<div class="panel"><div class="empty">${svg(I.warn)}<span>${f.err}</span></div></div>`;
	if (!f.roots) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	if (!f.roots.length) return html`<div class="panel"><div class="empty">${svg(I.info)}<span>${S.me?.role === 'admin' || !S.me ? 'No drive mounted – set one up under STORAGE first.' : 'Neither a personal folder nor a share for you.'}</span></div></div>`;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const root = f.roots.find((r) => r.name === f.root) || f.roots[0], ro = !!root.ro;
	if (f.trash) return fbTrashInner(root);
	const parts = f.path ? f.path.split('/') : [];
	const n = f.sel.size, all = d.entries.length && n === d.entries.length;
	const busy = f.uploads.some((u) => u.pct != null && u.pct < 100 && !u.err);
	return html`<div class="panel fb" id="fb-drop">
		<div class="fbbar">
			${f.roots.length > 1 ? html`<select id="fb-root" class="btn sm ghost" aria-label="Drive">${f.roots.map((r) => html`<option value="${r.name}"${r.name === f.root ? raw(' selected') : ''}>${fbRootLabel(r)}</option>`)}</select>` : ''}
			<nav class="crumbs" aria-label="Path">
				<button type="button" data-act="fb-crumb" data-p="">${svg(I.folder)}${fbRootLabel(root)}</button>${parts.map((p, i) => html`<span>/</span><button type="button" data-act="fb-crumb" data-p="${parts.slice(0, i + 1).join('/')}" data-i18n-skip>${p}</button>`)}
			</nav>
			${d.free != null ? html`<span class="tag ml">${fmtBytes(d.free)} free</span>` : ''}
		</div>
		<div class="acts fbtools">
			<button class="btn sm ghost" type="button" data-act="fb-up" ${parts.length ? '' : 'disabled'} title="Folder up" aria-label="Folder up">${svg(I.up)}</button>
			<button class="btn sm" type="button" data-act="fb-mkdir" ${ro ? 'disabled' : ''}>${svg(I.plus)}New folder</button>
			<label class="btn sm${busy || ro ? ' dis' : ''}">${svg(I.ul)}Upload<input type="file" id="fb-file" multiple hidden ${busy || ro ? 'disabled' : ''}></label>
			<span class="sep"></span>
			<button class="btn sm ghost" type="button" data-act="fb-rename" ${n === 1 && !ro ? '' : 'disabled'}>${svg(I.pen)}Rename</button>
			<button class="btn sm ghost" type="button" data-act="fb-cut" ${n && !ro ? '' : 'disabled'}>${svg(I.move)}Cut</button>
			<button class="btn sm ghost" type="button" data-act="fb-copy" ${n ? '' : 'disabled'}>${svg(I.copy)}Copy</button>
			${S.fbClip ? html`<button class="btn sm primary" type="button" data-act="fb-paste" ${ro ? 'disabled' : ''} title="${S.fbClip.names.join(', ')}">${svg(I.copy)}Paste (${S.fbClip.names.length})</button>
				<button class="btn sm ghost" type="button" data-act="fb-clip-clear" title="Clear clipboard" aria-label="Clear clipboard">×</button>` : ''}
			<button class="btn sm danger" type="button" data-act="fb-del" ${n && !ro ? '' : 'disabled'}>${svg(I.trash)}Delete</button>
			${f.trashConf?.enabled ? html`<button class="btn sm ghost" type="button" data-act="fb-trash">${svg(I.trash)}Trash</button>` : ''}
			<label class="chk ml"><input type="checkbox" id="fb-hidden"${f.hidden ? raw(' checked') : ''}>Hidden</label>
		</div>
		${f.uploads.length ? html`<div class="fbup">${f.uploads.map((u) => html`<div class="fbuprow"><span class="nm">${u.name}</span>
			${u.err ? html`<span class="tag err">${u.err}</span>` : u.pct >= 100 ? html`<span class="tag ok">done</span>` : html`<div class="bar busy"><i style="width:${u.pct || 0}%"></i></div><span class="vv">${u.pct || 0} %</span>`}</div>`)}</div>` : ''}
		${d.entries.length ? html`<div class="tw"><table class="t fbt">
			<thead><tr><th style="width:34px"><input type="checkbox" class="fb-all" aria-label="Select all"${all ? raw(' checked') : ''}></th><th>NAME</th><th class="r">SIZE</th><th>MODIFIED</th><th></th></tr></thead>
			<tbody>${d.entries.map((e) => {
				const dir = e.type === 'dir' || e.type === 'dirlink';
				return html`<tr class="${f.sel.has(e.name) ? 'sel' : ''}">
					<td><input type="checkbox" class="fb-sel" data-name="${e.name}" aria-label="select ${e.name}"${f.sel.has(e.name) ? raw(' checked') : ''}></td>
					<td class="nm">${dir ? html`<button type="button" class="lnk" data-act="fb-open" data-name="${e.name}">${svg(I.folder)}<span>${e.name}</span></button>`
						: e.type === 'file' ? (fbOpeners(e.name)[0]
							? html`<button type="button" class="lnk" data-act="fb-app" data-name="${e.name}" data-app="${fbOpeners(e.name)[0].id}" title="Open with ${fbOpeners(e.name)[0].name}">${svg(I.doc)}<span>${e.name}</span></button>`
							: html`<button type="button" class="lnk" data-act="fb-dl" data-name="${e.name}" title="Download">${svg(I.doc)}<span>${e.name}</span></button>`)
						: html`<span class="lnk mut">${svg(I.doc)}<span>${e.name}</span></span>`}</td>
					<td class="r mut">${dir ? '' : fmtBytes(e.size)}</td>
					<td class="mut">${fmtTime(e.mtime)}</td>
					<td class="r">${e.type === 'file' ? html`${fbOpeners(e.name).map((a) => html`<button class="btn sm ghost" type="button" data-act="fb-app" data-name="${e.name}" data-app="${a.id}" title="Open with ${a.name}">${a.name} ↗</button> `)}<button class="btn sm ghost" type="button" data-act="fb-dl" data-name="${e.name}" title="Download" aria-label="download ${e.name}">${svg(I.dl)}</button>` : ''}</td></tr>`;
			})}</tbody></table></div>`
			: html`<div class="empty">${svg(I.folder)}<span>This folder is empty.</span></div>`}
		${d.truncated ? html`<p class="note">Only the first 2000 entries are shown.</p>` : ''}
		<p class="note">You can also simply drag files here. ${n ? html`<b>${n} selected.</b>` : ''}</p>
	</div>`;
}

// admins: trash on/off and how long it keeps things (below the file browser)
function trashSettings() {
	const c = S.fb?.trashConf;
	if (!c) return '';
	return html`<section class="sec"><h2 class="gh">TRASH</h2><div class="g2"><div class="panel">
		<label class="chk"><input type="checkbox" id="trash-on"${c.enabled ? raw(' checked') : ''}>Put what is deleted in the file browser into the trash first</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>DELETE FOR GOOD AUTOMATICALLY AFTER</span><select id="trash-days" ${c.enabled ? '' : 'disabled'}>
			${[[7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days'], [0, 'never (empty by hand only)']].map(([v, t]) => html`<option value="${v}"${c.days === v ? raw(' selected') : ''}>${t}</option>`)}
		</select></label></div>
		<p class="note">Every folder has its own trash: the personal folder, each share, each drive. It lies on the same disk and counts towards the storage limit. It applies to the file browser of this interface – what is deleted over SMB from a PC or in apps is gone at once; for that there are the snapshots.</p>
	</div></div></section>`;
}

// the trash of the current root (personal folder, share, drive)
async function fbTrashLoad() {
	try { S.fb.tdata = await rpc('shareos.files', 'trash_list', { root: S.fb.root }); }
	catch (e) { S.fb.tdata = { items: [], error: e.message }; }
	fbRender();
}

function fbTrashInner(root) {
	const f = S.fb, d = f.tdata, items = d?.items || [], n = f.tsel?.size || 0, ro = !!d?.ro;
	return html`<div class="panel fb">
		<div class="fbbar">
			<nav class="crumbs" aria-label="Path"><button type="button" data-act="fb-trash-close">${svg(I.folder)}${fbRootLabel(root)}</button><span>/</span><b>Trash</b></nav>
			${d?.days ? html`<span class="tag ml">deletes after ${d.days} days</span>` : ''}
		</div>
		<div class="acts fbtools">
			<button class="btn sm ghost" type="button" data-act="fb-trash-close" title="Back" aria-label="Back">${svg(I.up)}</button>
			<button class="btn sm" type="button" data-act="fb-trash-restore" ${n && !ro ? '' : 'disabled'}>${svg(I.reboot)}Restore</button>
			<button class="btn sm danger" type="button" data-act="fb-trash-del" ${n && !ro ? '' : 'disabled'}>${svg(I.trash)}Delete for good</button>
			<span class="sep"></span>
			<button class="btn sm danger" type="button" data-act="fb-trash-del" data-all="1" ${items.length && !ro ? '' : 'disabled'}>Empty trash</button>
		</div>
		${!d ? html`<div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div>`
			: d.error ? html`<div class="empty">${svg(I.warn)}<span>${d.error}</span></div>`
			: items.length ? html`<div class="tw"><table class="t fbt">
				<thead><tr><th style="width:34px"></th><th>NAME</th><th>FROM</th><th class="r">SIZE</th><th>DELETED</th></tr></thead>
				<tbody>${items.map((x) => html`<tr class="${f.tsel.has(x.id) ? 'sel' : ''}">
					<td><input type="checkbox" class="fb-tsel" data-id="${x.id}" aria-label="select ${x.name}"${f.tsel.has(x.id) ? raw(' checked') : ''}></td>
					<td class="nm"><span class="lnk">${svg(x.type === 'dir' ? I.folder : I.doc)}<span>${x.name}</span></span></td>
					<td class="mut">${x.path ? '/' + x.path : '/'}</td>
					<td class="r mut">${x.size != null ? fmtBytes(x.size) : ''}</td>
					<td class="mut">${fmtTime(x.time)}${x.user && x.user !== S.me?.name ? html` · ${x.user}` : ''}</td></tr>`)}</tbody></table></div>`
			: html`<div class="empty">${svg(I.trash)}<span>The trash is empty.</span></div>`}
	</div>`;
}

async function fbDownload(name) {
	const f = S.fb;
	try {
		const r = await rpc('shareos.files', 'ticket', { root: f.root, path: f.path, name, mode: 'get' });
		const a = document.createElement('a');
		a.href = r.url; a.download = name;
		document.body.append(a); a.click(); a.remove();
	} catch (e) { toast('Download: ' + e.message, true); }
}

// apps that open this file (edit before view), from shareos.files openers
function fbOpeners(name) {
	const m = /(\.[a-z0-9]{1,10})$/.exec(name.toLowerCase());
	if (!m || !S.fbApps?.apps) return [];
	const hit = (a, mode) => (a.opens || []).some((o) => o.ext.includes(m[1]) && (!mode || o.mode === mode));
	return [...S.fbApps.apps.filter((a) => hit(a, 'edit')), ...S.fbApps.apps.filter((a) => !hit(a, 'edit') && hit(a))];
}
async function loadOpeners() {
	try { S.fbApps = await rpc('shareos.files', 'openers'); } catch (e) { S.fbApps = { apps: [] }; }
	if (S.fb?.data) fbRender();
}

// open a file in an app: the window must be opened right away (popup blockers),
// the address follows when the ticket is there
async function fbOpenIn(appId, name) {
	const a = (S.fbApps?.apps || []).find((x) => x.id === appId);
	if (!a) return;
	if (S.desk && typeof deskApp === 'function') {
		try {
			const r = await rpc('shareos.files', 'app_ticket', { root: S.fb.root, path: S.fb.path, name, app: appId });
			deskApp(a, `${appBase(r)}/${r.app}/${r.entry || 'index.html'}?${appParams({ file: r.ticket, name, ...(r.grant ? { fs: r.grant } : {}) })}`, name);
		} catch (e) { toast('Open: ' + e.message, true); }
		return;
	}
	const w = window.open('about:blank', a.window ? 'sosfile-' + Date.now() : '_blank', winFeatures(a));
	try {
		const r = await rpc('shareos.files', 'app_ticket', { root: S.fb.root, path: S.fb.path, name, app: appId });
		const url = `${appBase(r)}/${r.app}/${r.entry || 'index.html'}?${appParams({ file: r.ticket, name, ...(r.grant ? { fs: r.grant } : {}) })}`;
		if (w) { w.location.href = url; appWins.add(w); } else location.href = url;
	} catch (e) { w?.close(); toast('Open: ' + e.message, true); }
}

function fbSend(url, file, onpct) {
	return new Promise((resolve, reject) => {
		const x = new XMLHttpRequest();
		x.open('POST', url);
		x.upload.onprogress = (ev) => { if (ev.lengthComputable) onpct(Math.floor(ev.loaded * 100 / ev.total)); };
		x.onload = () => {
			let j = {};
			try { j = JSON.parse(x.responseText); } catch (e) { }
			x.status === 200 && j.ok ? resolve() : reject(new Error(j.error || 'HTTP ' + x.status));
		};
		x.onerror = () => reject(new Error('Connection lost'));
		x.send(file);
	});
}

async function fbUpload(files) {
	const f = S.fb;
	if (!files?.length || !f?.root) return;
	const root = f.root, path = f.path;
	const list = [...files].map((file) => ({ file, name: file.name, pct: 0, err: null }));
	f.uploads = list;
	fbRender();
	for (const u of list) {
		try {
			let t;
			try { t = await rpc('shareos.files', 'ticket', { root, path, name: u.name, mode: 'put' }); }
			catch (e) {
				if (e.message !== 'already exists') throw e;
				if (!await confirmDlg('Replace file?', `“${u.name}” already exists in this folder.`, 'Replace', true)) { u.err = 'skipped'; fbRender(); continue; }
				t = await rpc('shareos.files', 'ticket', { root, path, name: u.name, mode: 'put', overwrite: true });
			}
			let last = 0;
			await fbSend(t.url, u.file, (p) => { u.pct = p; if (p - last >= 3 || p === 100) { last = p; fbRender(); } });
			u.pct = 100;
		} catch (e) { u.err = e.message; }
		fbRender();
	}
	const bad = list.filter((u) => u.err && u.err !== 'skipped').length;
	toast(bad ? `${bad} file(s) not uploaded.` : `${list.length} file(s) uploaded.`, !!bad);
	if (S.fb && S.fb.root === root && S.fb.path === path) await fbLoad();
	setTimeout(() => { if (S.fb && S.fb.uploads === list && !list.some((u) => u.err)) { S.fb.uploads = []; fbRender(); } }, 4000);
}

// clipboard of the file browser: copy / cut takes the selection, "Paste"
// in another folder (also of another drive or share) copies or moves it there
function fbClip(cut) {
	const f = S.fb, names = [...f.sel];
	if (!names.length) return;
	S.fbClip = { root: f.root, path: f.path, names, cut };
	f.sel.clear();
	toast(`${names.length} item(s) on the clipboard – choose “Paste” in the target folder.`);
	fbRender();
}

async function fbPaste() {
	const f = S.fb, c = S.fbClip;
	if (!c) return;
	try {
		await rpc('shareos.files', 'move', { root: c.root, path: c.path, names: c.names, dest: f.path, dest_root: f.root, copy: !c.cut });
		toast(c.cut ? 'Moved.' : 'Copied.');
		if (c.cut) S.fbClip = null;   // moved: gone from the old place; a copy can be pasted again
		fbLoad();
	} catch (e) { toast((c.cut ? 'Move: ' : 'Copy: ') + e.message, true); }
}

Object.assign(ACTIONS, {
	'fb-open'(el) { fbLoad(fbJoin(S.fb.path, el.dataset.name)); },
	'fb-crumb'(el) { fbLoad(el.dataset.p); },
	'fb-up'() { const p = S.fb.path.split('/'); p.pop(); fbLoad(p.join('/')); },
	'fb-dl'(el) { fbDownload(el.dataset.name); },
	async 'note-read'(el) { try { await rpc('shareos.notify', 'read', { id: el.dataset.id }); } catch (e) { toast(e.message, true); } loadNotes(); },
	async 'note-del'(el) {
		if (el.dataset.id === 'all' && !await confirmDlg('Delete all messages?', 'The list is emptied. If a problem persists, the box reports it again at the next check.', 'Delete')) return;
		try { await rpc('shareos.notify', 'delete', { id: el.dataset.id }); } catch (e) { toast(e.message, true); }
		loadNotes();
	},
	async 'term-open'(el) {
		el.disabled = true;
		try { S.term = await termStart(); renderMain(); }
		catch (e) { toast('Terminal: ' + e.message, true); el.disabled = false; }
	},
	// the terminal takes one client and ends when it leaves: the window gets a
	// session of its own (the one shown in the page ends). The window is opened
	// right away – a pop-up opened after waiting for the box would be blocked.
	async 'term-window'(el) {
		const w = window.open('', 'shareos-terminal', 'popup,width=960,height=620');
		if (!w) { toast('Window blocked – allow pop-ups for this page.', true); return; }
		el.disabled = true;
		try {
			const t = await termStart();
			w.location.href = termUrl(t);
			S.term = { ...t, window: true };
			renderMain();
		} catch (e) { w.close(); toast('Terminal: ' + e.message, true); el.disabled = false; }
	},
	'term-close'() { S.term = null; renderMain(); },
	async 'tg-chats'(el) {
		el.disabled = true;
		try {
			const r = await rpc('shareos.notify', 'telegram_chats');
			if (!r.chats.length) { toast('No message to the bot yet – first save the token, then write to the bot in Telegram.', true); return; }
			const c = r.chats[r.chats.length - 1];
			$('#f-notify input[name=push_chat]').value = c.id;
			toast(`Chat found: ${c.name || c.username || c.id} – now save.`);
		} catch (e) { toast('Telegram: ' + e.message, true); }
		finally { el.disabled = false; }
	},
	async 'note-test'(el) {
		el.disabled = true;
		try { await rpc('shareos.notify', 'test'); toast('Test message sent.'); }
		catch (e) { toast('Test: ' + e.message, true); }
		el.disabled = false;
	},
	'fb-app'(el) { fbOpenIn(el.dataset.app, el.dataset.name); },
	'app-launch'(el) { const a = findApp(el.dataset.id); if (a) launchApp(a); },
	fav(el) {
		const id = el.dataset.id, ids = favIds();
		S.me.fav = { bar: favBarOn(), text: favTextOn(), ...S.me.fav, apps: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
		favSave({ apps: S.me.fav.apps });
	},
	async 'chip-open'(el) {
		if (!findApp(el.dataset.app) && !(S.me && S.me.role !== 'admin')) await loadApps(['installed']);
		const a = findApp(el.dataset.app);
		if (a) launchApp(a); else location.hash = S.me && S.me.role !== 'admin' ? '#/me' : '#/apps/installed';
	},
	// the app of the page in a window of its own: the page goes back to the list
	'app-window'(el) {
		const a = findApp(el.dataset.id);
		if (!a) return;
		openAppWindow(a);
		location.hash = isUser() ? '#/me' : '#/apps/installed';
	},
	async 'fb-mkdir'() {
		const name = await promptDlg('New folder', 'Name of the new folder:', '', 'Create', 'text', 255);
		if (!name) return;
		try { await rpc('shareos.files', 'mkdir', { root: S.fb.root, path: S.fb.path, name }); fbLoad(); }
		catch (e) { toast('Folder: ' + e.message, true); }
	},
	async 'fb-rename'() {
		const old = [...S.fb.sel][0];
		const to = await promptDlg('Rename', `New name for “${old}”:`, old, 'Rename', 'text', 255);
		if (!to || to === old) return;
		try { await rpc('shareos.files', 'rename', { root: S.fb.root, path: S.fb.path, name: old, to }); fbLoad(); }
		catch (e) { toast('Rename: ' + e.message, true); }
	},
	'fb-cut'() { fbClip(true); },
	'fb-copy'() { fbClip(false); },
	'fb-paste'() { fbPaste(); },
	'fb-clip-clear'() { S.fbClip = null; fbRender(); },
	async 'fb-del'() {
		const names = [...S.fb.sel], list = `${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''}`;
		const trash = S.fb.trashConf?.enabled && !(S.fb.path === '.shareos-trash' || S.fb.path.startsWith('.shareos-trash/'));
		if (trash) {
			if (!await confirmDlg(`Move ${names.length} item(s) to the trash?`, `${list} – can be restored from the trash.`, 'Move to trash')) return;
		} else if (!await confirmDlg(`Delete ${names.length} item(s)?`, `${list} – folders with their content. This cannot be undone.`, 'Delete', true)) return;
		try {
			const r = await rpc('shareos.files', 'delete', { root: S.fb.root, path: S.fb.path, names });
			toast(r.trash ? 'Moved to the trash.' : 'Deleted.'); fbLoad();
		} catch (e) { toast('Delete: ' + e.message, true); }
	},
	async 'fb-trash'() { S.fb.trash = true; S.fb.tsel = new Set(); S.fb.tdata = null; fbRender(); fbTrashLoad(); },
	'fb-trash-close'() { S.fb.trash = false; fbLoad(); },
	async 'fb-trash-restore'() {
		const ids = [...S.fb.tsel];
		try {
			const r = await rpc('shareos.files', 'trash_restore', { root: S.fb.root, ids });
			toast(`${r.restored.length} item(s) restored.`); S.fb.tsel = new Set(); fbTrashLoad();
		} catch (e) { toast('Restore: ' + e.message, true); }
	},
	async 'fb-trash-del'(el) {
		const all = el.dataset.all === '1', ids = all ? [] : [...S.fb.tsel];
		const n = all ? (S.fb.tdata?.items || []).length : ids.length;
		const title = `Delete ${n} item(s) for good?`;
		if (!await confirmDlg(all ? 'Empty the trash?' : title, 'This cannot be undone.', all ? 'Empty' : 'Delete for good', true)) return;
		try { await rpc('shareos.files', 'trash_empty', { root: S.fb.root, ids }); toast(all ? 'Trash emptied.' : 'Deleted for good.'); S.fb.tsel = new Set(); fbTrashLoad(); }
		catch (e) { toast('Delete: ' + e.message, true); }
	}
});

// how an app opens: in the page or in a window of its own (for everyone on this box)
document.addEventListener('change', (e) => {
	const k = { 'opt-favbar': 'bar', 'opt-favtext': 'text' }[e.target.id];
	if (!k || !S.me) return;
	S.me.fav = { apps: favIds(), bar: favBarOn(), text: favTextOn(), ...S.me.fav, [k]: e.target.checked };
	favSave({ [k]: e.target.checked });
});

document.addEventListener('change', async (e) => {
	const t = e.target;
	if (!t.classList?.contains('app-display')) return;
	try {
		await rpc('shareos.apps', 'set', { id: t.dataset.id, display: t.value });
		const a = findApp(t.dataset.id); if (a) a.display = t.value;
		toast(t.value === 'page' ? 'Now opens in the page.' : 'Now opens in its own window.');
		renderMain();
	} catch (err) { toast('Display: ' + err.message, true); }
});

// trash settings (admins, below the file browser)
document.addEventListener('change', async (e) => {
	if (e.target.id !== 'trash-on' && e.target.id !== 'trash-days') return;
	const c = S.fb?.trashConf;
	if (!c) return;
	const on = $('#trash-on').checked, days = +$('#trash-days').value;
	try { S.fb.trashConf = await rpc('shareos.files', 'trash_config', { enabled: on, days }); toast('Trash settings saved.'); }
	catch (err) { toast('Trash: ' + err.message, true); }
	if (!S.fb.trashConf.enabled) S.fb.trash = false;
	renderMain();
});

document.addEventListener('change', (e) => {
	const t = e.target, f = S.fb;
	if (!f || !t.closest?.('#fb')) return;
	if (t.id === 'fb-root') { f.root = t.value; f.path = ''; f.data = null; f.trash = false; fbRender(); fbLoad(''); }
	else if (t.id === 'fb-hidden') { f.hidden = t.checked; fbLoad(); }
	else if (t.id === 'fb-file') fbUpload(t.files);
	else if (t.classList.contains('fb-sel')) { t.checked ? f.sel.add(t.dataset.name) : f.sel.delete(t.dataset.name); fbRender(); }
	else if (t.classList.contains('fb-all')) { f.sel = t.checked ? new Set(f.data.entries.map((x) => x.name)) : new Set(); fbRender(); }
	else if (t.classList.contains('fb-tsel')) { t.checked ? f.tsel.add(t.dataset.id) : f.tsel.delete(t.dataset.id); fbRender(); }
});
for (const ev of ['dragover', 'dragleave', 'drop']) {
	document.addEventListener(ev, (e) => {
		const box = e.target.closest?.('#fb-drop');
		if (!box || !e.dataTransfer?.types?.includes('Files')) return;
		e.preventDefault();
		box.classList.toggle('drag', ev === 'dragover');
		if (ev === 'drop') fbUpload(e.dataTransfer.files);
	});
}

/* ---------- APPS: installed apps, store, sources ----------------------------- */

const APP_SUBS = [['installed', 'INSTALLED'], ['store', 'STORE'], ['sources', 'SOURCES']];
const APP_CAT = { tools: 'Tools', media: 'Media', office: 'Office', network: 'Network', system: 'System', download: 'Download', sync: 'Sync' };
const APP_CAT_ORDER = ['media', 'office', 'network', 'download', 'sync', 'tools', 'system', 'other'];
const txtOf = (d) => (d && typeof d === 'object' ? d[LANG] || d.de || d.en || '' : d || '');

// apps open under the box's name (set by hand, or the name of the installed
// certificate on HTTPS) – not under the IP address this page may have been opened with
function appBase(srv) {
	const s = srv || S.apps?.installed || {};
	const https = location.protocol === 'https:' && s.https;
	const host = s.host && (https || !s.host_auto) ? s.host : location.hostname;
	return `${https ? 'https' : 'http'}://${host}:${https ? s.https_port || 8444 : s.port || 8081}`;
}
const appUrl = (a, srv) => `${appBase(srv)}/${a.id}/${a.entry || 'index.html'}`;
function appIcon(a, srv) {
	const src = a.icon_data || a.icon_url || (a.icon ? `${appBase(srv)}/${a.id}/${a.icon}` : '');
	return src ? html`<img class="appicon" src="${src}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'appicon ph'}))">` : html`<span class="appicon ph"></span>`;
}

// favourite apps of the logged-in account ("FAV APPS" bar above the overview / the apps / My ShareOS)
const favIds = () => S.me?.fav?.apps || [];
const favBarOn = () => S.me?.fav?.bar !== false;
const favTextOn = () => S.me?.fav?.text !== false;
const appHref = (a, srv) => appMode(a) === 'page' ? (isUser() ? '#/app/' : '#/apps/run/') + a.id : appLaunchUrl(a, srv);
function favStar(a) {
	if (a.type === 'system') return '';
	const on = favIds().includes(a.id);
	const t = on ? 'Remove from favourites' : 'Mark as favourite';
	return html`<button class="favstar${on ? ' on' : ''}" type="button" data-act="fav" data-id="${a.id}" aria-pressed="${on}" aria-label="${t}: ${a.name}" title="${t}">${svg(I.star)}</button>`;
}
function favBar(apps, srv) {
	if (!favBarOn()) return '';
	const list = favIds().map((id) => apps.find((x) => x.id === id && x.type !== 'system')).filter(Boolean);
	if (!list.length) return '';
	return html`<section class="sec"><h2 class="gh">FAV APPS <span>${list.length}</span></h2>
		<div class="favbar${favTextOn() ? '' : ' icons'}">${list.map((a) => html`<a class="favapp" aria-label="${a.name}" href="${appHref(a, srv || appSrv())}" data-act="app-launch" data-id="${a.id}" title="${a.name}">
			${appIcon(a, srv || appSrv())}<span class="fn">${a.name}</span></a>`)}</div></section>`;
}
const favBarOpt = () => html`<label class="chk"><input type="checkbox" id="opt-favbar"${favBarOn() ? raw(' checked') : ''}>Show the “FAV APPS” app bar (just for you)</label>
	<label class="chk"><input type="checkbox" id="opt-favtext"${favTextOn() ? raw(' checked') : ''}${favBarOn() ? '' : raw(' disabled')}>Show names below the icons (off: icons only)</label>`;
async function favSave(args) {
	try { S.me.fav = await rpc('shareos.me', 'fav_set', args); }
	catch (e) { toast('Favourites: ' + e.message, true); }
	if (isUser()) renderUserMain(); else renderMain();
}

// apps get the look and the address of this interface (for messages) in the URL
function appParams(extra = {}) {
	// user: the app SDK keeps the browser storage of the accounts apart
	return new URLSearchParams({ theme: effTheme(), accent: S.accent, origin: location.origin, user: S.me?.name || S.user || '', lang: LANG, ...extra }).toString();
}
const appLaunchUrl = (a, srv, extra) => `${appUrl(a, srv)}?${appParams(extra)}`;
const appWins = new Set();
// every web app opens as a window of its own (not a tab): the size of its manifest or 1000 × 700
const winFeatures = (a) => `popup,width=${a.window?.width || 1000},height=${a.window?.height || 700}`;
// "page": shown in the ShareOS page (apps with the permission "embed", unless the admin chose
// "own window" for it); "window": a window of its own
// (in the desktop view every app is a window of the desktop)
const appMode = (a) => (S.desk || ((a?.permissions || []).includes('embed') && a.display !== 'window') ? 'page' : 'window');
const findApp = (id) => (S.apps?.installed?.apps || []).find((x) => x.id === id) || (S.me?.apps || []).find((x) => x.id === id)
	|| (S.fbApps?.apps || []).find((x) => x.id === id);
const appSrv = () => S.apps?.installed || S.me?.apps_server || S.fbApps;

const sysApps = () => (S.sysapps || []).filter((a) => (a.commands || []).length);

// web terminal (ttyd on its own port, secret path)
const termUrl = (t) => `${location.protocol}//${location.hostname}:${t.port}/${t.path}/`;
function termStart() {
	const css = getComputedStyle($('#app') || document.body), v = (k) => css.getPropertyValue(k).trim();
	return rpc('shareos.system', 'terminal', { tls: location.protocol === 'https:',
		theme: { background: v('--bg'), foreground: v('--text'), cursor: v('--accent'), selectionBackground: v('--dim') } });
}

// apps with the permission "files" get a grant for the user's folders (ShareOS.fs)
async function appGrant(a) {
	if (!(a.permissions || []).includes('files')) return null;
	try { return (await rpc('shareos.files', 'app_grant', { app: a.id })).grant; }
	catch (e) { if (e.message !== 'not allowed') toast('File access: ' + e.message, true); return null; }
}

// apps shown in the page get their own address in this interface, the others a window
function launchApp(a) {
	// desktop view: every app is a window of the desktop
	if (S.desk && typeof deskApp === 'function') { deskApp(a); return; }
	if (appMode(a) === 'page') { location.hash = isUser() ? '#/app/' + a.id : '#/apps/run/' + a.id; return; }
	openAppWindow(a);
}
function openAppWindow(a) {
	const name = 'sosapp-' + a.id;
	if (!(a.permissions || []).includes('files')) {
		const w = window.open(appLaunchUrl(a, appSrv()), name, winFeatures(a));
		if (w) appWins.add(w);
		return;
	}
	// the window must open right away (popup blockers), the address follows with the grant
	const w = window.open('about:blank', name, winFeatures(a));
	appGrant(a).then((g) => {
		const url = appLaunchUrl(a, appSrv(), g ? { fs: g } : {});
		if (w) { w.location.href = url; appWins.add(w); } else location.href = url;
	});
}

// an app in the page: its name instead of the section title, the app below it
function appPageView(a, back) {
	if (!a) return html`<section class="sec"><div class="panel"><div class="empty">${S.apps?.installed || S.me ? html`${svg(I.warn)}<span>This app does not exist (any more). <a href="${back}">Back</a></span>`
		: html`<div class="spin" style="margin:0"></div><span>Loading …</span>`}</div></div></section>`;
	return html`<section class="sec apppage-sec"><h2 class="gh apph">${appIcon(a, appSrv())}<span class="an">${a.name}</span>
		<button class="btn sm ghost" type="button" data-act="app-window" data-id="${a.id}">In its own window ↗</button>
		<a class="btn sm ghost" href="${back}" aria-label="Close">✕</a></h2>
		<div class="apppage"><iframe id="appframe" data-id="${a.id}" title="${a.name}" src="${S.appPage?.id === a.id ? S.appPage.url : 'about:blank'}"
			sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads allow-modals"
			allow="clipboard-read; clipboard-write; fullscreen; autoplay"></iframe></div></section>`;
}
// the address of the app in the page (with its grant for the user's folders)
async function appFrameLoad() {
	const f = $('#appframe');
	if (!f || (S.appPage?.id === f.dataset.id && f.getAttribute('src') !== 'about:blank')) return;
	const a = findApp(f.dataset.id);
	if (!a) return;
	const g = await appGrant(a);
	const url = appLaunchUrl(a, appSrv(), g ? { fs: g } : {});
	S.appPage = { id: a.id, url };
	const now = $('#appframe');
	if (now && now.dataset.id === a.id) now.src = url;
}

// tell open app windows and embedded apps about a new look
function themeToApps() {
	const msg = { sos: 'theme', theme: effTheme(), accent: S.accent }, origin = appBase(appSrv());
	for (const w of appWins) { if (w.closed) appWins.delete(w); else try { w.postMessage(msg, origin); } catch (e) { } }
	// the app shown in the page and the app windows of the desktop view
	for (const f of document.querySelectorAll('#appframe, iframe.dk-app')) try { f.contentWindow?.postMessage(msg, origin); } catch (e) { }
}

// messages from apps: a file was saved -> refresh the file list
window.addEventListener('message', (ev) => {
	if (!appSrv() || ev.origin !== appBase(appSrv())) return;
	const m = ev.data || {};
	if (m.sos === 'file-saved' && S.fb?.data) fbLoad();
});

async function loadApps(what = ['installed', 'catalog', 'store']) {
	S.apps = S.apps || {};
	try {
		const [inst, cat, st] = await Promise.all([
			what.includes('installed') ? rpc('shareos.apps', 'installed') : S.apps.installed,
			what.includes('catalog') ? rpc('shareos.apps', 'catalog', { refresh: false }) : S.apps.catalog,
			what.includes('store') ? rpc('shareos.apps', 'store_get') : S.apps.store]);
		Object.assign(S.apps, { installed: inst, catalog: cat, store: st });
		// apps of a restored settings backup that are still missing (admins)
		if (what.includes('installed')) rpc('shareos.recovery', 'status').then((r) => {
			const was = JSON.stringify(S.recApps || {});
			S.recApps = { pending: r.pending_apps || [], running: !!r.apps_running };
			if (was !== JSON.stringify(S.recApps) && S.route.tab === 'apps' && S.route.sub === 'installed') renderMain();
		}).catch(() => {});
		// first visit: ask the catalog sources once
		if (!S.apps.refreshed && !(cat?.time > 0)) { S.apps.refreshed = true; refreshCatalog(true); }
	} catch (e) { toast('Apps: ' + e.message, true); }
	if ((S.route.tab === 'apps' || S.route.tab === 'overview') && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

async function refreshCatalog(quiet = false) {
	S.apps.busy = true; if (S.route.tab === 'apps') renderMain();
	try {
		// the box asks the sources in the background; wait for the new result
		let c = await rpc('shareos.apps', 'catalog', { refresh: true });
		for (let i = 0; c.refreshing && i < 60; i++) {
			await new Promise((r) => setTimeout(r, 1500));
			c = await rpc('shareos.apps', 'catalog', { refresh: false });
		}
		S.apps.catalog = c;
		if (!quiet) toast(S.apps.catalog.errors?.length ? 'Store: ' + S.apps.catalog.errors[0].error : 'Store refreshed.', !!S.apps.catalog.errors?.length);
	} catch (e) { if (!quiet) toast('Store: ' + e.message, true); }
	S.apps.busy = false;
	if (S.route.tab === 'apps') renderMain();
}

// modules (system apps like "paperless") switch tabs on and off: read the areas again
function refreshAreas() {
	rpc('shareos.ui', 'get', {}, ZERO_SID).then((r) => {
		if (!r.areas) return;
		S.areas = r.areas; renderTabs();
		if (S.desk && typeof deskAreas === 'function') deskAreas();
	}).catch(() => {});
}

async function pollAppJob() {
	clearTimeout(S.appTimer);
	try {
		const j = await rpc('shareos.apps', 'status');
		S.apps.job = j;
		if (['downloading', 'verifying', 'installing'].includes(j.state)) { S.appTimer = setTimeout(pollAppJob, 1000); }
		else {
			if (j.state === 'done') toast((j.also || []).length ? `${j.id} ${j.version} installed, also: ${j.also.join(', ')}.` : `${j.id} ${j.version} installed.`);
			if (j.state === 'done' && j.warning) toast('Note: ' + j.warning, true);
			else if (j.state === 'error') toast('Install: ' + (j.error || 'failed'), true);
			S.apps.job = null;
			if (j.state === 'done') refreshAreas();
			await loadApps(['installed', 'catalog']);
			return;
		}
	} catch (e) { S.appTimer = setTimeout(pollAppJob, 2000); }
	if (S.route.tab === 'apps') renderMain();
}

const JOB_TXT = { downloading: 'downloading', verifying: 'checking', installing: 'installing' };

function appsView() {
	const sub = S.route.sub, A = S.apps;
	const nav = html`<nav class="subtabs" aria-label="Apps">${APP_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/apps/${id}">${label}</a>`)}</nav>`;
	if (!A?.installed) return html`${nav}<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const job = A.job && JOB_TXT[A.job.state] ? html`<div class="banner" style="border-color:var(--dim)"><div class="spin" style="margin:0;width:20px;height:20px"></div><span><b>${A.job.id}</b> ${JOB_TXT[A.job.state]} …</span></div>` : '';
	if (sub === 'run') return html`${nav}${appPageView(findApp(S.route.app), '#/apps/installed')}`;
	return html`${nav}${job}${sub === 'store' ? appStore() : sub === 'sources' ? appSources() : appInstalled()}`;
}

function appUsersTxt(a) {
	if (a.module) return 'administrators only';
	if (a.type === 'system') return 'Terminal (administrators)';
	if (a.users.includes('*')) return 'all users';
	if (!a.users.length) return 'administrators only';
	return a.users.join(', ');
}

function appInstalled() {
	const A = S.apps, list = A.installed.apps || [], cat = {};
	for (const c of A.catalog?.apps || []) cat[c.id] = c;
	if (A.edit) return appUsersEditor(A.edit);
	if (A.jobs) return appJobsEditor(A.jobs);
	const upd = (a) => cat[a.id]?.update_available ? cat[a.id] : null;
	const t = isTable('apps');
	const rp = (S.recApps?.pending || []).filter((id) => !list.some((a) => a.id === id));
	const rec = rp.length ? html`<div class="panel" style="margin-bottom:14px;border-color:var(--amber)"><div class="ph"><span class="pt">APPS FROM THE BACKUP</span></div>
		<p class="note" style="margin:0 0 10px"><span>${S.recApps.running ? 'Being installed …' : 'Not installed yet:'}</span> <span>${rp.join(', ')}</span></p>
		<div class="acts"><button class="btn primary sm" type="button" data-act="rec-apps-install" ${S.recApps.running ? 'disabled' : ''}>Install apps from the backup</button>
		<button class="btn ghost sm" type="button" data-act="rec-apps-dismiss">Discard</button></div></div>` : '';
	return html`${favBar(list)}${rec}<section class="sec">${secHead('apps', 'INSTALLED APPS', list.length ? `${list.length}` : '')}
		${!list.length ? html`<div class="panel"><div class="empty">${svg(I.box)}<span>No app installed yet. The <a href="#/apps/store">store</a> has apps to install – or upload your own package (.sapp).</span></div></div>`
		: t ? html`<div class="tw"><table class="t" style="min-width:720px"><thead><tr><th></th><th>APP</th><th>VERSION</th><th>PUBLISHER</th><th>VISIBLE TO</th><th></th></tr></thead><tbody>
			${list.map((a) => html`<tr><td style="width:44px">${appIcon(a)}</td><td><b>${a.name}</b> ${favStar(a)}${a.verified ? '' : html` <span class="tag warn">own</span>`}<div class="mut" style="font-size:12px">${txtOf(a.description)}</div></td>
				<td>${a.version}${upd(a) ? html` <span class="tag warn">→ ${upd(a).latest}</span>` : ''}</td><td class="mut">${a.publisher}</td><td class="mut">${appUsersTxt(a)}</td>
				<td style="white-space:nowrap">${appActions(a, upd(a))}</td></tr>`)}</tbody></table></div>`
		: html`<div class="grid">${list.map((a) => html`<div class="card">${favStar(a)}
			<div class="icon">${appIcon(a)}</div>
			<div class="info"><div class="name">${a.name} <span class="mut" style="font-size:12px">${a.version}</span></div>
				<div class="desc">${txtOf(a.description)}</div>
				<div class="desc" style="margin-top:6px"><span class="tag ${a.verified ? 'ok' : 'warn'}">${a.verified ? 'from the store' : 'own / not verified'}</span> ${upd(a) ? html`<span class="tag warn">Update ${upd(a).latest}</span>` : ''}</div>
				${permTags(appPerms(a))}
				<div class="ip">${a.publisher} · ${a.module ? html`<span>Module</span>` : a.type === 'system' ? html`<span>Command</span> ${sysCmds(a)}` : 'visible to ' + appUsersTxt(a)}</div>
				<div class="acts" style="margin-top:10px">${appActions(a, upd(a))}</div></div></div>`)}</div>`}
		<p class="note">Web apps run on their own port (${A.installed.port}${A.installed.https ? ' / ' + A.installed.https_port + ' for HTTPS' : ''}) – apart from this interface, so an app cannot use your login. Anyone who knows the address can open a web app on the network; “visible to” decides who sees it in “My ShareOS”.</p>
	</section>`;
}

// commands of a system app, e.g. "nano"
const sysCmds = (a) => (a.commands || []).map((c, i) => html`${i ? ', ' : ''}<code style="white-space:nowrap">${c}</code>`);

function appActions(a, upd) {
	const busy = !!(S.apps.job && JOB_TXT[S.apps.job.state]);
	const sys = a.type === 'system';
	return html`${a.module ? html`<a class="btn sm" href="#/${a.module}">Open</a>` : sys ? html`<a class="btn sm" href="#/system/terminal">${svg(I.term)}Terminal</a>`
		: html`<button class="btn sm" type="button" data-act="app-launch" data-id="${a.id}">${appMode(a) === 'page' ? 'Open' : 'Open ↗'}</button>`}
		${!sys && (a.permissions || []).includes('embed') ? html`<select class="btn sm ghost app-display" data-id="${a.id}" aria-label="Display of ${a.name}">
			<option value="page"${a.display !== 'window' ? raw(' selected') : ''}>In the page</option><option value="window"${a.display === 'window' ? raw(' selected') : ''}>Own window</option></select>` : ''}
		${upd ? html`<button class="btn sm primary" type="button" data-act="app-install" data-id="${a.id}" data-v="${upd.latest}" ${busy ? 'disabled' : ''}>${svg(I.dl)}Refresh</button>` : ''}
		${(a.jobs || []).length ? html`<button class="btn sm ghost" type="button" data-act="app-jobs" data-id="${a.id}">${svg(I.clock)}Tasks</button>` : ''}
		${sys ? '' : html`<button class="btn sm ghost" type="button" data-act="app-users" data-id="${a.id}">${svg(I.users)}User</button>`}
		<button class="btn sm ghost" type="button" data-act="app-remove" data-id="${a.id}">${svg(I.trash)}Remove</button>`;
}

// permissions an app can ask for (app.json "permissions")
const PERM_TAG = { cron: 'Scheduled tasks', embed: 'Shown in ShareOS', files: 'Access to files', torrent: 'Own torrents (Transmission)', syncthing: 'Sync folders (Syncthing)', media: 'Convert media (FFmpeg)', vpn: 'VPN of the box (OpenVPN)', tailscale: 'Remote access (Tailscale)', autobrr: 'Download automation (autobrr)', zabbix: 'Monitoring (Zabbix agent)', sysinfo: 'Box values', netcheck: 'Network checks', docker: 'Docker hosts', tuya: 'Smart home (Tuya)', vault: 'Vault shares', module: 'Module · own tab', notify: 'Send notifications', status: 'Header indicator', internet: 'Uses the internet', system: 'System app · terminal' };
// permissions plus "internet" (manifest field: the app loads data from the internet – not a restriction, shown for transparency)
// and "system" for system apps (programs for the terminal)
const appPerms = (x) => [...(x?.module ? ['module'] : x?.type === 'system' ? ['system'] : []), ...(x?.permissions || []), ...(x?.internet ? ['internet'] : [])];
const permTags = (perms) => (perms.length ? html`<div class="desc" style="margin-top:6px">${perms.map((p) => html`<span class="tag" title="${PERM_TXT[p] || p}">${PERM_TAG[p] || p}</span> `)}</div>` : '');
const PERM_TXT = { module: 'Switches on an area of ShareOS with its own tab. The code is part of the reviewed firmware – the package only brings the switch.', cron: 'May run scheduled tasks on the box – as its own restricted user, only in its data folder, with a time limit.',
	embed: 'May be shown as a page inside the ShareOS interface (instead of its own window).',
	files: 'May read, change and delete the files the signed-in user reaches in the file browser – with his rights, while the app is open.',
	torrent: 'May control the user\'s own Transmission service: add, pause and remove torrents. Every user has their own service; downloads go only into their folders.',
	syncthing: 'May control the user\'s own Syncthing service: pair devices and sync folders with them. Every user has their own service; only folders they have access to are synced.',
	media: 'May have the user\'s audio and video converted on the box (FFmpeg) – with their rights, only in their folders, from fixed choices (no arbitrary command).',
	vpn: 'May connect and disconnect the box as a VPN client and manage VPN profiles (OpenVPN) – this affects the network of the whole box, so administrators only.',
	tailscale: 'May connect the box with Tailscale, sign in and out and see the devices of the tailnet – this affects the network of the whole box, so admins only.',
	autobrr: 'May set up and control the box\'s autobrr (filters, indexers, IRC, releases) and choose whose Transmission gets the torrents it finds – one service for the whole box, so for administrators only.',
	zabbix: 'May set up the box\'s Zabbix agent (server, host name, PSK encryption, passive checks, SMART interval), restart it and read its log – the app never sees the key again. Admins only.',
	sysinfo: 'May read the box\'s values (CPU, memory, temperature, fan, drives, processes) and end processes ShareOS does not need – administrators only.',
	netcheck: 'May check from the box whether devices and services on the network are reachable (ping, port, HTTP/HTTPS) – administrators only.',
	docker: 'May manage the Docker hosts the administrator adds and there view, start, stop and restart containers and read their logs (Docker API) – administrators only.',
	tuya: 'May find Tuya devices on the home network from the box, read their state and switch them (locally, without the cloud) – administrators only.',
	vault: 'May unlock the user\'s vault shares (after the user enters their password) and lock them; for admins it can also choose which shares are vaults.',
	notify: 'May send messages through the box\'s notifications (web interface, e-mail, push) – at most 20 an hour, with the app\'s name in front; in the browser for administrators only.',
	status: 'May show a short state at the top of the ShareOS interface (e.g. “connected”) – only to the user who opened the app; it disappears by itself after at most 10 minutes.',
	internet: 'Loads data from the internet (e.g. online services, streams, maps). Without an internet connection these parts of the app do not work.',
	system: 'A program for the command line of the box (System → Terminal or SSH). It runs with the rights of whoever starts it – in the terminal as root.' };

function appJobsEditor(id) {
	const a = (S.apps.installed.apps || []).find((x) => x.id === id);
	if (!a) { S.apps.jobs = null; return ''; }
	const last = (j) => !j.last ? html`<span class="mut">never</span>`
		: html`${fmtTime(j.last.time)} · ${j.last.timeout ? html`<span class="tag warn">Time limit</span>` : j.last.rc === 0 ? html`<span class="tag ok">OK</span>` : html`<span class="tag err">Error ${j.last.rc}</span>`} · ${j.last.duration} s`;
	return html`<section class="sec"><form class="panel" id="f-appjobs" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${a.name.toUpperCase()} · TASKS</span><button class="btn sm ghost ml" type="button" data-act="app-jobs-cancel">Close</button></div>
		<div class="tw"><table class="t" style="min-width:760px"><thead><tr><th>TASK</th><th>SCHEDULE (CRON)</th><th>ACTIVE</th><th>LOAD</th><th></th></tr></thead><tbody>
			${a.jobs.map((j) => html`<tr data-job="${j.id}"><td><b>${j.name}</b><div class="mut" style="font-size:12px">${j.command} · max. ${j.timeout} s</div></td>
				<td><label class="f" style="margin:0;width:160px"><input class="job-sched" value="${j.schedule}" spellcheck="false" pattern="[0-9*/,\\-]+( [0-9*/,\\-]+){4}"></label>${j.schedule !== j.default_schedule ? html`<div class="mut" style="font-size:11px">Default: ${j.default_schedule}</div>` : ''}</td>
				<td><label class="chk"><input type="checkbox" class="job-on"${j.enabled ? raw(' checked') : ''}></label></td>
				<td style="font-size:12px">${j.running ? html`<span class="tag">running</span>` : last(j)}</td>
				<td style="white-space:nowrap"><button class="btn sm" type="button" data-act="app-job-run" data-id="${a.id}" data-job="${j.id}" ${j.running ? 'disabled' : ''}>Run now</button>
					<button class="btn sm ghost" type="button" data-act="app-job-log" data-id="${a.id}" data-job="${j.id}">Log</button></td></tr>`)}
		</tbody></table></div>
		${S.apps.jobLog ? html`<div class="pt" style="margin:14px 0 6px">LOG · ${S.apps.jobLog.job}</div><pre class="logbox" style="max-height:260px">${S.apps.jobLog.log || '(empty)'}</pre>` : ''}
		<p class="note"><span>${PERM_TXT.cron}</span> Schedule in cron format (minute hour day month weekday), at most every 5 minutes, e.g. <code>30 3 * * *</code> = daily at 3:30.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function appUsersEditor(id) {
	const a = (S.apps.installed.apps || []).find((x) => x.id === id);
	if (!a) { S.apps.edit = null; return ''; }
	const acc = S.acc || { users: [], groups: [] };
	const web = acc.users.filter((u) => u.role === 'user' && u.web);
	const all = a.users.includes('*');
	return html`<section class="sec"><form class="panel" id="f-appusers" style="border-color:var(--dim);box-shadow:var(--glow);max-width:720px">
		<div class="ph"><span class="pt">${a.name.toUpperCase()} · VISIBLE TO</span><button class="btn sm ghost ml" type="button" data-act="app-users-cancel">Cancel</button></div>
		<label class="chk"><input type="checkbox" name="all"${all ? raw(' checked') : ''}>All users with web access</label>
		<div id="app-users-list"${all ? raw(' hidden') : ''}>
			${acc.groups.length ? html`<div class="pt" style="margin:14px 0 6px">GROUPS</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${acc.groups.map((g) => html`<label class="chk"><input type="checkbox" class="app-u" value="@${g.name}"${a.users.includes('@' + g.name) ? raw(' checked') : ''}>${g.name}</label>`)}</div>` : ''}
			<div class="pt" style="margin:14px 0 6px">USER</div>
			${web.length ? html`<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${web.map((u) => html`<label class="chk"><input type="checkbox" class="app-u" value="${u.name}"${a.users.includes(u.name) ? raw(' checked') : ''}>${u.fullname || u.name}</label>`)}</div>`
				: html`<p class="note">No user with web access – set one up under Shares → Users.</p>`}
		</div>
		<p class="note">Administrators see all apps. The selection decides who sees the app in “My ShareOS”.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function appStore() {
	const A = S.apps, c = A.catalog || { apps: [] }, ch = A.store?.channel || 'stable';
	const busy = !!(A.job && JOB_TXT[A.job.state]);
	// sections (Rubriken): the categories of the catalog, a filter above the list
	const apps = c.apps || [], catOf = (a) => APP_CAT[a.category] ? a.category : 'other';
	const cats = APP_CAT_ORDER.filter((k) => apps.some((a) => catOf(a) === k));
	const cat = cats.includes(A.cat) ? A.cat : 'all';
	const rows = [];
	for (const k of cat === 'all' ? cats : [cat]) {
		const list = apps.filter((a) => catOf(a) === k);
		rows.push(html`<tr class="grp" data-cat="${k}"><td colspan="7">${APP_CAT[k] || 'Other'} <span class="mut">${list.length}</span></td></tr>`);
	for (const a of list) {
		const v = a.versions[0];
		rows.push(html`<tr data-cat="${k}" data-q="${(a.name + ' ' + a.id + ' ' + txtOf(a.description) + ' ' + (a.publisher || '')).toLowerCase()}"><td style="width:44px">${appIcon(a)}</td>
			<td><b>${a.name}</b>${a.category ? html` <span class="tag">${APP_CAT[a.category] || a.category}</span>` : ''}<div class="mut" style="font-size:12px;max-width:420px">${txtOf(a.description)}</div>${permTags(appPerms({ ...v, type: a.type, module: a.module }))}</td>
			<td><b>${v.version}</b>${v.prerelease ? html` <span class="tag">BETA</span>` : ''}</td>
			<td class="mut">${a.publisher}</td><td class="mut">${fmtDate(v.date)}</td><td class="mut">${fmtBytes(v.size)}</td>
			<td style="white-space:nowrap">${a.installed && !a.update_available ? html`<span class="tag ok">installed</span>`
				: !a.compatible ? html`<span class="tag warn">needs a newer ShareOS</span>`
				: html`<button class="btn sm${a.installed ? ' primary' : ''}" type="button" data-act="app-install" data-id="${a.id}" data-v="${v.version}" ${busy ? 'disabled' : ''}>${svg(I.dl)}${a.installed ? 'Refresh' : 'Install'}</button>`}
				${v.notes_url ? html`<a class="btn sm ghost" href="${v.notes_url}" target="_blank" rel="noopener">Notes ↗</a>` : ''}</td></tr>`);
	}
	}
	const catBtn = (k, label, n) => html`<button class="btn sm${cat === k ? ' primary' : ' ghost'}" type="button" data-act="app-cat" data-cat="${k}">${label} <span class="${cat === k ? '' : 'mut'}">${n}</span></button>`;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">APP STORE</span><span class="tag ml">${c.time ? 'as of ' + fmtTime(c.time) : 'not loaded yet'}</span></div>
				<div class="fields"><label class="f"><span>CHANNEL</span><select id="app-channel">
					<option value="stable"${ch === 'stable' ? raw(' selected') : ''}>Stable (releases)</option>
					<option value="beta"${ch === 'beta' ? raw(' selected') : ''}>Beta (also pre-releases)</option></select></label></div>
				${(c.errors || []).map((e) => html`<p class="note" style="color:var(--amber)">${e.source}: ${e.error}</p>`)}
				<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="app-refresh" ${A.busy ? 'disabled' : ''}>${A.busy ? 'Loading …' : 'Refresh now'}</button></div>
			</div>
			<form class="panel" id="f-appupload">
				<div class="ph"><span class="pt">INSTALL PACKAGE</span><span class="tag ml">.sapp</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>PACKAGE FILE</span><input type="file" name="file" accept=".sapp,application/gzip" required></label></div>
				<p class="note">For your own apps (built with <code>tools/build.py</code> from the app repository). Uploaded packages count as “own / not verified”.</p>
				<div class="acts" style="margin-top:12px"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${svg(I.ul)}Upload & install</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">AVAILABLE APPS <span>${apps.length}</span></h2>
		${apps.length ? html`<div class="acts store-cats" style="margin-bottom:12px">${catBtn('all', 'All', apps.length)}${cats.map((k) => catBtn(k, APP_CAT[k] || 'Other', apps.filter((a) => catOf(a) === k).length))}
			<input id="app-search" type="search" placeholder="Search …" autocomplete="off" spellcheck="false" value="${A.q || ''}" style="margin-left:auto;min-height:32px;min-width:180px;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:0 10px"></div>` : ''}
		${rows.length ? html`<div class="tw"><table class="t store" style="min-width:820px"><thead><tr><th></th><th>APP</th><th>VERSION</th><th>PUBLISHER</th><th>DATE</th><th>SIZE</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
			: html`<div class="panel"><div class="empty">${svg(I.cloud)}<span>${A.busy ? 'Loading the catalog …' : 'No apps found – check the internet connection and the sources.'}</span></div></div>`}
	</section>`;
}

function appSources() {
	const st = S.apps.store || { sources: [] };
	return html`<section class="sec"><form class="panel" id="f-appsrc" style="max-width:820px">
		<div class="ph"><span class="pt">APP SOURCES</span><span class="tag ml">${st.sources.length}</span></div>
		<div style="display:grid;gap:8px">${st.sources.map((u, i) => html`<div class="acts" style="flex-wrap:nowrap"><input class="src-url" value="${u}" style="flex:1;min-height:36px;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:0 10px"><button class="btn sm ghost" type="button" data-act="app-src-del" data-i="${i}">Remove</button></div>`)}</div>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>ANOTHER SOURCE (CATALOG ADDRESS)</span><input name="add" placeholder="https://github.com/<name>/<repo>/releases/download/catalog/index.json"></label></div>
		<p class="note">A source is an app catalog (<code>index.json</code>) in the format of the repository <a href="https://github.com/UniqueDroid/ShareOS-Apps" target="_blank" rel="noopener">ShareOS-Apps</a>. Own apps: use the repository as a template, its GitHub Action builds packages and catalog. Only add sources you trust.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function appsAfter() {
	if (!S.apps?.installed) { loadApps(); return; }
	if (S.route.sub === 'installed' && !S.acc) rpc('shareos.accounts', 'list').then((a) => { S.acc = a; }).catch(() => {});
	// search filters the rows in place (no new render: the field keeps the focus)
	const search = () => {
		const q = (S.apps.q || '').trim().toLowerCase(), shown = {};
		document.querySelectorAll('table.store tr[data-q]').forEach((tr) => {
			const on = !q || tr.dataset.q.includes(q);
			tr.hidden = !on; if (on) shown[tr.dataset.cat] = 1;
		});
		document.querySelectorAll('table.store tr.grp').forEach((tr) => { tr.hidden = !shown[tr.dataset.cat]; });
	};
	$('#app-search')?.addEventListener('input', (e) => { S.apps.q = e.target.value; search(); });
	search();
	$('#app-channel')?.addEventListener('change', async (e) => {
		try { await rpc('shareos.apps', 'store_set', { channel: e.target.value }); S.apps.store.channel = e.target.value; refreshCatalog(true); }
		catch (err) { toast('Store: ' + err.message, true); }
	});
	$('#f-appjobs')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const id = S.apps.jobs;
		try {
			for (const tr of e.target.querySelectorAll('tr[data-job]'))
				await rpc('shareos.apps', 'job_set', { id, job: tr.dataset.job, schedule: $('.job-sched', tr).value.trim(), enabled: $('.job-on', tr).checked });
			toast('Saved.'); loadApps(['installed']);
		} catch (err) { toast('Tasks: ' + err.message, true); }
	});
	$('#f-appusers input[name=all]')?.addEventListener('change', (e) => { $('#app-users-list').hidden = e.target.checked; });
	$('#f-appusers')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, users = f.all.checked ? ['*'] : [...f.querySelectorAll('.app-u:checked')].map((x) => x.value);
		try { await rpc('shareos.apps', 'set', { id: S.apps.edit, users }); S.apps.edit = null; toast('Saved.'); loadApps(['installed']); }
		catch (err) { toast('Apps: ' + err.message, true); }
	});
	$('#f-appsrc')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, sources = [...f.querySelectorAll('.src-url')].map((x) => x.value.trim()).filter(Boolean);
		if (f.add.value.trim()) sources.push(f.add.value.trim());
		try { await rpc('shareos.apps', 'store_set', { sources }); S.apps.store.sources = sources; toast('Saved.'); refreshCatalog(true); renderMain(); }
		catch (err) { toast('Sources: ' + err.message, true); }
	});
	$('#f-appupload')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const file = e.target.file.files[0];
		if (!file) return;
		const btn = $('button[type=submit]', e.target); btn.disabled = true;
		try {
			const t = await rpc('shareos.apps', 'upload_ticket');
			await fbSend(t.url, file, () => {});
			const r = await rpc('shareos.apps', 'install_upload');
			toast(`${r.id} ${r.version} installed (own app).`);
			e.target.reset();
			await loadApps(['installed', 'catalog']);
		} catch (err) { toast('Package: ' + err.message, true); btn.disabled = false; }
	});
}

Object.assign(ACTIONS, {
	'app-refresh'() { refreshCatalog(); },
	'app-cat'(el) { S.apps.cat = el.dataset.cat; renderMain(); },
	async 'app-install'(el) {
		const c = (S.apps.catalog?.apps || []).find((x) => x.id === el.dataset.id);
		const v = c?.versions.find((x) => x.version === el.dataset.v) || c?.versions[0];
		const perms = appPerms(v);
		// apps it needs and that are not installed yet come along from the store
		const have = new Set((S.apps.installed?.apps || []).map((x) => x.id));
		const need = (v?.requires || c?.requires || []).filter((r) => !have.has(r));
		// one text node per sentence, so each is translated
		const parts = [...perms.map((p) => PERM_TXT[p] || p), ...(need.length ? [`Also installed: ${need.join(', ')}.`] : [])];
		if (parts.length && !await confirmDlg(`${c.name}: permissions`, raw(html`${parts.map((t) => html`<span>${t}</span> `)}`.s), 'Allow & install')) return;
		try {
			await rpc('shareos.apps', 'install', { id: el.dataset.id, version: el.dataset.v });
			S.apps.job = { state: 'downloading', id: el.dataset.id };
			renderMain();
			setTimeout(pollAppJob, 800);
		} catch (e) { toast('Install: ' + e.message, true); }
	},
	async 'app-remove'(el) {
		const a = (S.apps.installed.apps || []).find((x) => x.id === el.dataset.id);
		const users = (S.apps.installed.apps || []).filter((x) => x.id !== el.dataset.id && (x.requires || []).includes(el.dataset.id)).map((x) => x.name);
		const parts = [(a?.jobs || []).length ? 'The app is deleted, with its tasks and its data on the box.' : 'The app is deleted. Data it stored in the browser stays there.',
			...(users.length ? [`Needed by: ${users.join(', ')} – these apps will no longer work.`] : [])];
		if (!await confirmDlg(`Remove ${a?.name || el.dataset.id}?`, raw(html`${parts.map((t) => html`<span>${t}</span> `)}`.s), 'Remove', true)) return;
		try { await rpc('shareos.apps', 'remove', { id: el.dataset.id, force: users.length > 0 }); toast('Removed.'); refreshAreas(); loadApps(['installed', 'catalog']); }
		catch (e) { toast('Remove: ' + e.message, true); }
	},
	'app-users'(el) { S.apps.edit = el.dataset.id; if (!S.acc) rpc('shareos.accounts', 'list').then((a) => { S.acc = a; renderMain(); }).catch(() => {}); renderMain(); window.scrollTo(0, 0); },
	'app-users-cancel'() { S.apps.edit = null; renderMain(); },
	'app-jobs'(el) { S.apps.jobs = el.dataset.id; S.apps.jobLog = null; renderMain(); window.scrollTo(0, 0); },
	'app-jobs-cancel'() { S.apps.jobs = null; S.apps.jobLog = null; renderMain(); },
	async 'app-job-run'(el) {
		el.disabled = true;
		try {
			await rpc('shareos.apps', 'job_run', { id: el.dataset.id, job: el.dataset.job });
			toast('Task started.');
			setTimeout(() => loadApps(['installed']), 1500);
		} catch (e) { toast('Task: ' + e.message, true); el.disabled = false; }
	},
	async 'app-job-log'(el) {
		try { const r = await rpc('shareos.apps', 'job_log', { id: el.dataset.id, job: el.dataset.job }); S.apps.jobLog = { job: el.dataset.job, log: r.log }; renderMain(); }
		catch (e) { toast('Log: ' + e.message, true); }
	},
	async 'app-src-del'(el) {
		const sources = S.apps.store.sources.filter((_, i) => i !== +el.dataset.i);
		if (!await confirmDlg('Remove source?', 'Apps from this source no longer show up in the store. Installed apps stay.', 'Remove', true)) return;
		try { await rpc('shareos.apps', 'store_set', { sources }); S.apps.store.sources = sources; refreshCatalog(true); renderMain(); }
		catch (e) { toast('Sources: ' + e.message, true); }
	}
});

/* ---------- start ----------------------------------------------------------- */

// installable as an app (PWA) – browsers allow this only over HTTPS with a
// trusted certificate (or on localhost); plain http just skips it
if ('serviceWorker' in navigator && window.isSecureContext)
	navigator.serviceWorker.register('sw.js').catch(() => {});

(async function start() {
	LANG = await loadUiSettings();
	LOC = LOCALES[LANG] || LANG;
	document.documentElement.lang = LANG;
	document.documentElement.dir = RTL[LANG] ? 'rtl' : 'ltr';
	if (await i18nLoad(LANG)) i18nStart($('#app'));
	i18nLanguages().then((l) => { S.languages = l; });
	applyTheme();
	const m = location.hash.match(/^#confirm=([0-9a-f]{32})$/);
	if (m) {
		S.sid = m[1];
		store.set('sid', S.sid, false);
		history.replaceState(null, '', '#/system/network');
	}
	if (S.sid) {
		try {
			await rpc('session', 'access', { scope: 'ubus', object: 'shareos.ui', function: 'get' });
			try { S.me = await rpc('shareos.me', 'get'); }
			catch (e) {
				// a session from before accounts existed: only root could log in then
				if (e.code !== 'app') throw e;
				S.me = { name: S.user, role: S.user === 'root' ? 'admin' : 'user', unbound: true };
				if (S.user !== 'root') throw e;
			}
			enter();
			return;
		} catch (e) { S.sid = null; store.del('sid'); }
	}
	renderLogin();
})();
