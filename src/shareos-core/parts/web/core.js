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

/* ---------- tables the parts fill ---------------------------------------------- */

// clicks: data-act="name" on an element calls ACTIONS.name(element)
const ACTIONS = {};
// after a tab of the main menu is drawn (listeners, loading): VIEWS_AFTER.tab()
const VIEWS_AFTER = {};
// the sub pages of System: SYS.page() returns the page
const SYS = {};
// after a sub page of System is drawn; a page can have several of these
const SYS_AFTER = {};
function afterSystemPage(page, fn) { (SYS_AFTER[page] ||= []).push(fn); }
