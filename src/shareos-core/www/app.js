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

const $ = (sel, el = document) => el.querySelector(sel);
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
	return d ? `${d} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
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

/* ---------- icons ----------------------------------------------------------- */

const svg = (d, cls = '') => raw(`<svg ${cls ? `class="${cls}" ` : ''}viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const I = {
	moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
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
		throw new RpcError('Box nicht erreichbar', 'offline');
	}
	if (!res.ok) throw new RpcError('HTTP ' + res.status, res.status);
	const j = await res.json();
	if (j.error) {
		if (j.error.code === -32002) { sessionExpired(); throw new RpcError('Sitzung abgelaufen', 'auth'); }
		throw new RpcError(j.error.message, j.error.code);
	}
	const [code, data] = j.result;
	if (code === 6) { sessionExpired(); throw new RpcError('Keine Berechtigung', 'auth'); }
	if (code !== 0) throw new RpcError('ubus-Fehler ' + code, code);
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

const TABS = [
	['overview', 'ÜBERSICHT'], ['storage', 'SPEICHER'], ['shares', 'FREIGABEN'], ['services', 'DIENSTE'],
	['apps', 'APPS'], ['cloud', 'CLOUD'], ['paperless', 'PAPERLESS'], ['system', 'SYSTEM']
];
const SYS_SUBS = [['general', 'ALLGEMEIN'], ['appearance', 'DARSTELLUNG'], ['network', 'NETZWERK'], ['notifications', 'MELDUNGEN'], ['logs', 'PROTOKOLLE'], ['terminal', 'TERMINAL'], ['time', 'ZEIT'], ['power', 'ENERGIE & RESET'], ['firmware', 'FIRMWARE']];
const SVC_SUBS = [['status', 'STATUS'], ['autostart', 'AUTOSTART'], ['dlna', 'MEDIENSERVER'], ['printer', 'DRUCKER'], ['ups', 'USV']];
const SHR_SUBS = [['shares', 'FREIGABEN'], ['files', 'DATEIEN'], ['users', 'BENUTZER'], ['groups', 'GRUPPEN']];
const STO_SUBS = [['volumes', 'LAUFWERKE'], ['health', 'GESUNDHEIT'], ['snapshots', 'SNAPSHOTS']];
const ROLE_TXT = { admin: 'Administrator', user: 'Benutzer', share: 'Nur Freigaben' };
// pages that moved: old link -> new place
const SUB_MOVED = { hardware: 'power', https: 'network', about: 'general' };
// German page names of versions before 0.1.0-beta.8 (bookmarks, installed app shortcuts)
const OLD_ROUTE = { uebersicht: 'overview', speicher: 'storage', freigaben: 'shares', dienste: 'services', allgemein: 'general',
	zeit: 'time', netzwerk: 'network', energie: 'power', protokolle: 'logs', darstellung: 'appearance', ueber: 'about',
	dateien: 'files', benutzer: 'users', gruppen: 'groups', installiert: 'installed', quellen: 'sources', mein: 'me' };
function routeParts() {
	const parts = location.hash.replace(/^#\/?/, '').split('/');
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
	white: 'grayscale(1) brightness(1.25)', 'white-light': 'grayscale(1) brightness(.55)'
};
const logoFilter = () => LOGO_FILTER[S.accent === 'white' && effTheme() === 'light' ? 'white-light' : S.accent] || '';

const MQ_DARK = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function effTheme() { return S.theme === 'system' ? (MQ_DARK && !MQ_DARK.matches ? 'light' : 'dark') : S.theme; }
MQ_DARK?.addEventListener?.('change', () => { if (S.theme === 'system') { applyTheme(); renderHeader(); } });

function applyTheme() {
	const app = $('#app');
	app.className = 'sos acc-' + S.accent + (effTheme() === 'light' ? ' light' : '');
	$('.scan', app).hidden = !S.scan;
	const bg = getComputedStyle(app).getPropertyValue('--bg').trim();
	document.body.style.background = bg;
	$('meta[name=theme-color]')?.setAttribute('content', bg || '#1b2433');
	tintFavicon();
	if (typeof themeToApps === 'function') themeToApps();
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
	} catch (e) { toast('Darstellung: ' + e.message, true); }
}

/* --- tiles or table per section (icon at the right of the section heading) --- */

const isTable = (id) => S.views[id] === 'table';
function secHead(id, title, sub = '') {
	const t = isTable(id);
	return html`<h2 class="gh">${title}${sub ? html` <span>${sub}</span>` : ''}<button class="vt" type="button" data-act="view" data-id="${id}" aria-pressed="${t}" title="${t ? 'Kachelansicht' : 'Tabellenansicht'}" aria-label="${t ? 'Kachelansicht' : 'Tabellenansicht'}">${svg(t ? I.grid : I.table)}</button></h2>`;
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
			<button class="btn ghost" type="button" value="no">Abbrechen</button>
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
	try { S.shares = await rpc('shareos.shares', 'global', v); toast('Gespeichert.'); renderMain(); } catch (e) { toast(e.message, true); }
}

function promptDlg(title, text, value, okLabel, type = 'text', max = 0) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<form method="dialog"><h3>${title}</h3><p>${text}</p>
			<label class="f" style="margin-bottom:16px"><input name="v" value="${value}" type="${type}" maxlength="${max || (type === 'password' ? 128 : 32)}"${type === 'password' ? raw(' minlength="6" autocomplete="new-password"') : ''} required></label>
			<div class="acts"><button class="btn ghost" type="button" value="no">Abbrechen</button>
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

let coverEl = null;
function cover(title, text) {
	uncover();
	coverEl = document.createElement('div');
	coverEl.className = 'cover';
	coverEl.innerHTML = html`<div class="panel"><div class="spin"></div><b class="name">${title}</b><span class="mut" id="cover-text">${text}</span></div>`.s;
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
		const el = $('#cover-text');
		if (el) el.textContent = `${text} (${s} s)`;
	}
}

/* ---------- session --------------------------------------------------------- */

function sessionExpired() {
	if (!S.sid) return;
	S.sid = null;
	store.del('sid');
	stopPolling();
	renderLogin('Sitzung abgelaufen – bitte neu anmelden.');
}

async function login(user, pass, keep) {
	const r = await rpc('session', 'login', { username: user, password: pass, timeout: keep ? 7 * 86400 : 3600 }, ZERO_SID);
	S.sid = r.ubus_rpc_session;
	S.user = user;
	store.set('sid', S.sid, keep);
	store.set('user', user, true);
	// tell the box which account this session belongs to (role, own area)
	try { S.me = await rpc('shareos.me', 'bind', { username: user, password: pass }); }
	catch (e) { S.me = { name: user, role: 'admin' }; }
}

// admins get the full interface, everybody else "Mein ShareOS"
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
	if (isUser()) renderUserShell();
	else renderShell();
	shareInbox();
}

/* ---------- share target ("share with" on the phone, see sw.js) ----------------
 * what was shared with the installed app waits in IndexedDB until someone is
 * logged in; then it goes into <personal folder>/Geteilt of that account */

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
const shareName = (n, i) => (String(n || '').replace(/[\/\\\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 200) || `Datei ${i + 1}`);

async function shareInbox() {
	if (!('indexedDB' in window)) return;
	let db, items;
	try { db = await shareDb(); items = await shareTx(db, 'readonly', (st) => st.getAll()); } catch (e) { return; }
	if (!items?.length) { db.close(); return; }
	let ok = 0, bad = [];
	for (const it of items) {
		const list = (it.files || []).map((f, i) => ({ name: shareName(f.name, i), blob: f }));
		// only text or a link: kept as a small text file
		if (!list.length) {
			const d = new Date(it.time || Date.now()), z = (x) => String(x).padStart(2, '0');
			const stamp = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
			const body = [it.title, it.text, it.url].filter((x) => x && x.trim()).join('\n') + '\n';
			list.push({ name: `${it.url ? 'Link' : 'Notiz'} ${stamp}.txt`, blob: new Blob([body], { type: 'text/plain' }) });
		}
		for (const x of list) {
			try {
				const t = await rpc('shareos.me', 'share_ticket', { name: x.name });
				await fbSend(t.url, x.blob, () => { });
				ok++;
			} catch (e) { bad.push(`${x.name}: ${e.message}`); }
		}
		// done either way – a file that cannot be stored would otherwise come back at every login
		try { await shareTx(db, 'readwrite', (st) => st.delete(it.id)); } catch (e) { }
	}
	db.close();
	if (bad.length) toast(`Teilen: ${bad.length} Datei(en) nicht gespeichert – ${bad[0]}`, true);
	if (ok) {
		toast(`${ok} Datei(en) in „Geteilt“ in deinem persönlichen Ordner gespeichert.`);
		// show them in the file browser when there is one
		if (!isUser() || S.me?.files) {
			S.fb = null; fbInit(); S.fb.root = 'home'; S.fb.path = 'Geteilt';
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

async function tick() {
	if (away()) return;
	try {
		const info = await rpc('shareos.system', 'info');
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
		renderHeader();
		if (S.route.tab === 'overview' && !S.fr) renderMain();
	} catch (e) {
		if (e.code === 'offline') renderHeader(true);
	}
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
	$('#root').innerHTML = html`
	<div class="login">
		<form class="panel" id="login-form" autocomplete="on">
			${brand()}
			<p class="prompt">Verwaltung – bitte anmelden.</p>
			<p class="prompt"><b>user@shareos</b>:~$ login<span class="cursor"></span></p>
			<label class="f"><span>BENUTZER</span><input name="user" type="text" value="${S.user}" autocomplete="username" required></label>
			<label class="f"><span>PASSWORT</span><input name="pass" type="password" autocomplete="current-password" required autofocus></label>
			<label class="chk"><input name="keep" type="checkbox">Angemeldet bleiben (7 Tage)</label>
			<p class="err" id="login-err">${msg}</p>
			<button class="btn primary" type="submit" style="min-height:44px">Anmelden</button>
			<p class="note" id="login-hint"${S.defaultPw ? '' : raw(' hidden')}>Erste Anmeldung: Benutzer root, Passwort shareos – danach ein eigenes Passwort setzen.</p>
		</form>
	</div>`.s;
	// the hint only while root still has the factory password
	rpc('shareos.ui', 'get', {}, ZERO_SID).then((r) => {
		S.defaultPw = !!r.default_password;
		const h = $('#login-hint');
		if (h) h.hidden = !S.defaultPw;
	}).catch(() => { });
	$('#login-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target;
		const btn = $('button[type=submit]', f);
		btn.disabled = true;
		$('#login-err').textContent = '';
		try {
			await login(f.user.value.trim(), f.pass.value, f.keep.checked);
			enter();
		} catch (err) {
			$('#login-err').textContent = err.code === 'offline' ? 'Box nicht erreichbar.' : 'Benutzer oder Passwort falsch.';
			btn.disabled = false;
			f.pass.select();
		}
	});
	setTimeout(() => $('#login-form input[name=pass]')?.focus(), 0);
}

function renderShell() {
	$('#root').innerHTML = html`
		<header class="hd" id="hd"></header>
		<nav class="tabs" id="tabs" aria-label="Hauptmenü"></nav>
		<main id="main"></main>
		<footer class="ft" id="ft"></footer>`.s;
	parseRoute();
	renderHeader();
	renderTabs();
	renderMain();
	startPolling();
	checkFirstRun();
	netAutoConfirm();
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
		<div class="ph"><span class="pt">ANZEIGEN IM KOPF</span><span class="tag ml">nur in diesem Browser</span></div>
		${list.length || hidden.length ? html`<div style="display:grid;gap:6px">${[...list.map((c) => [c.id, c.id.startsWith('app:') ? (c.name || c.app) : c.label]),
			...hidden.filter((h) => !list.some((c) => c.id === h)).map((h) => [h, h.replace(/^(app|svc):/, '')])].map(([id, t]) =>
			html`<label class="chk"><input type="checkbox" class="chip-show" data-id="${id}"${hidden.includes(id) ? '' : raw(' checked')}>${t}</label>`)}</div>`
			: html`<p class="mut" style="margin:0;font-size:13px">Gerade zeigt kein Dienst und keine App etwas an.</p>`}
		<p class="note">Dienste (VPN, Torrents, Medienserver) und Apps mit der Berechtigung „Anzeige im Kopf“ zeigen hier ihren Zustand; ein Klick öffnet die App.</p>
	</div>`;
}

function renderHeader(offline = false) {
	const hd = $('#hd');
	if (!hd) return;
	if (S.me && S.me.role !== 'admin') { renderUserHeader(); return; }
	const i = S.info || {}, r = i.release || {}, ip = i.network?.eth0?.ipv4?.address;
	const now = new Date();
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
				${nu.length ? html`<a class="chip ${nu.some((x) => x.level === 'error') ? 'err' : 'warn'}" href="#/system/notifications"><i></i>${nu.length === 1 ? '1 MELDUNG' : nu.length + ' MELDUNGEN'}</a>` : ''}
				${upd ? html`<a class="chip warn" href="#/system/firmware"><i></i>UPDATE ${upd.replace(/^v/, '')} <small>verfügbar</small></a>` : ''}
				${chipsHtml()}
				<button class="chip more" type="button" data-act="chips-more" hidden></button>
				${offline ? html`<span class="chip warn keep"><i></i>OFFLINE</span>`
					: html`<span class="chip keep"><i></i>ONLINE <small>seit ${fmtUptime(i.uptime)}</small></span>`}
				<button class="ib" type="button" data-act="theme" aria-label="Hell/Dunkel umschalten" title="Hell/Dunkel umschalten">${svg(I.moon)}</button>
				<button class="ib" type="button" data-act="logout" aria-label="Abmelden">${svg(I.power)}</button>
			</div>
			<div class="clock">${now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })}</div>
			<div class="meta">${now.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
		</div>`.s;
	fitChips();
	const ft = $('#ft');
	if (ft) ft.innerHTML = html`<span><b>ShareOS</b> ${r.version || ''} · Linux ${i.kernel || ''} · GPLv2</span>
		<span>Last ${(i.load || []).map((x) => x.toFixed(2)).join(' ')} · <a href="https://github.com/UniqueDroid/ShareOS" target="_blank" rel="noopener">github.com/UniqueDroid/ShareOS</a></span>`.s;
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
	more.title = more.ariaLabel = 'Alle Hinweise anzeigen';
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
	$('#tabs').innerHTML = TABS.filter(([id]) => tabOn(id)).map(([id, label, isNew]) =>
		html`<a class="tab${S.route.tab === id ? ' on' : ''}" href="#/${id}"${S.route.tab === id ? raw(' aria-current="page"') : ''}><span class="tl">${label}</span>${isNew ? html` <span class="nb">NEU</span>` : ''}</a>`.s).join('');
}

function parseRoute() {
	const [tab, sub] = routeParts();
	S.route = { tab: TABS.some((t) => t[0] === tab) && tabOn(tab) ? tab : 'overview', sub: SUB_MOVED[sub] || sub || '' };
	if (S.route.tab === 'system' && !SYS_SUBS.some((x) => x[0] === S.route.sub)) S.route.sub = 'general';
	if (S.route.tab === 'services' && !SVC_SUBS.some((x) => x[0] === S.route.sub)) S.route.sub = 'status';
	if (S.route.tab === 'shares' && !SHR_SUBS.some((x) => x[0] === S.route.sub)) S.route.sub = 'shares';
	if (S.route.tab === 'storage' && !STO_SUBS.some((x) => x[0] === S.route.sub)) S.route.sub = 'volumes';
	if (S.route.tab === 'apps' && S.route.sub === 'run') S.route.app = routeParts()[2] || '';
	else if (S.route.tab === 'apps' && !APP_SUBS.some((x) => x[0] === S.route.sub)) S.route.sub = 'installed';
	if (!(S.route.tab === 'apps' && S.route.sub === 'run')) S.appPage = null;
}

function renderMain() {
	const main = $('#main');
	if (!main) return;
	if (S.fr) { main.innerHTML = firstRunView().s; firstRunAfter(); return; }
	// an app shown in the page keeps running: no new render of the same app
	if (S.route.tab === 'apps' && S.route.sub === 'run' && $('#appframe')?.dataset.id === S.route.app) return;
	const v = VIEWS[S.route.tab] || VIEWS.overview;
	// a page that fails must not leave the previous page standing (it looked
	// as if the tab did not react): show the error instead
	try {
		main.innerHTML = v().s;
		VIEWS_AFTER[S.route.tab]?.();
	} catch (e) {
		console.error('render ' + location.hash, e);
		main.innerHTML = renderError(e).s;
	}
	appFrameLoad();
}

function renderError(e) {
	return html`<div class="panel"><div class="empty">${svg(I.info)}<span>Diese Seite konnte nicht angezeigt werden: ${e?.message || String(e)}</span>
		<button class="btn" type="button" data-act="page-reload">Neu laden</button></div></div>`;
}

/* ---------- views ----------------------------------------------------------- */

function mrow(label, p, value, cls = '') {
	return html`<div class="mrow"><span class="kk">${label}</span><div class="bar"><i class="${cls}" style="width:${p.toFixed(0)}%"></i></div><span class="vv">${value}</span></div>`;
}

function spark() {
	const n = 120, rx = S.rxHist, tx = S.txHist;
	if (rx.length < 2) return html`<div class="spark" style="display:grid;place-items:center;font-size:12px;color:var(--muted)">sammle Messwerte …</div>`;
	const max = Math.max(1024, ...rx, ...tx);
	const pts = (arr) => arr.map((v, k) => `${((k + n - arr.length) / (n - 1) * 300).toFixed(1)},${(68 - (v / max) * 62).toFixed(1)}`).join(' ');
	const first = ((n - rx.length) / (n - 1) * 300).toFixed(1);
	return raw(`<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Netzwerkverkehr der letzten 10 Minuten">
		<polyline style="fill:rgba(var(--rgb),.12);stroke:none" points="${first},70 ${pts(rx)} 300,70"></polyline>
		<polyline style="fill:none;stroke:var(--accent);stroke-width:1.5" points="${pts(rx)}"></polyline>
		<polyline style="fill:none;stroke:var(--amber);stroke-width:1.5" points="${pts(tx)}"></polyline></svg>`);
}

function statusTiles(rows, table) {
	if (table) return html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>KENNZAHL</th><th>WERT</th><th>HINWEIS</th></tr></thead>
		<tbody>${rows.map(([k, v, n]) => html`<tr><td>${k}</td><td><b>${v}</b></td><td class="mut">${n}</td></tr>`)}</tbody></table></div>`;
	return html`<div class="tiles">${rows.map(([k, v, n]) => html`<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${n}</div></div>`)}</div>`;
}

function diskCards(i, table = false) {
	const disks = i.disks || [];
	if (!disks.length)
		return html`<div class="panel"><div class="empty">${svg(I.info)}<span>Keine Festplatte und kein USB-Speicher erkannt. ShareOS läuft vollständig aus dem internen Flash – Laufwerke erscheinen hier, sobald sie eingesteckt sind.</span></div></div>`;
	if (table) return html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>LAUFWERK</th><th>ART</th><th>MODELL</th><th>GRÖSSE</th></tr></thead>
		<tbody>${disks.map((d) => html`<tr><td><b>${d.name}</b> <span class="mut">/dev/${d.name}</span></td><td>${d.removable ? 'USB' : 'Festplatte'}</td><td>${d.model || 'unbekanntes Modell'}</td><td>${fmtBytes(d.size)}</td></tr>`)}</tbody></table></div>`;
	return html`<div class="grid">${disks.map((d) => html`
		<div class="card">
			<div class="icon">${svg(d.removable ? I.usb : I.disk)}<span class="dot up"></span></div>
			<div class="info"><div class="name">${d.removable ? 'USB' : 'Festplatte'} · ${d.name}</div>
				<div class="desc">${d.model || 'unbekanntes Modell'} · ${fmtBytes(d.size)}</div>
				<div class="ip">/dev/${d.name}</div></div>
		</div>`)}</div>`;
}

const fsLabel = { '/overlay': 'Einstellungen & Pakete', '/rom': 'System (nur lesbar)', '/tmp': 'Arbeitsspeicher (tmp)' };

const VIEWS = {
	overview() {
		const i = S.info;
		if (!i) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Systemdaten …</span></div></div>`;
		const m = i.memory || {}, used = (m.memtotal || 0) - (m.memavailable || 0);
		const t = i.temperature != null ? i.temperature / 1000 : null;
		const ov = (i.filesystems || []).find((f) => f.mount === '/overlay');
		const e = i.network?.eth0 || {};
		const bootTxt = { flash: 'Flash (UBI)', netroot: 'Netzwerk (RAM)', ram: 'RAM' }[i.boot] || i.boot;
		const svcUp = S.services ? S.services.filter((x) => x.running).length : null;
		return html`
		<section class="sec">
			<h2 class="gh">SYSTEM <span>live · alle 5 s</span></h2>
			<div class="g2">
				<div class="panel">
					<div class="ph"><span class="pt">AUSLASTUNG</span><span class="tag ml ${i.fan_pwm != null ? 'ok' : ''}">${i.fan_pwm != null ? 'Gerätesteuerung aktiv' : 'keine MCU-Daten'}</span></div>
					<div class="mbars">
						${mrow('CPU', S.cpu ?? 0, S.cpu == null ? '…' : S.cpu.toFixed(0) + ' %')}
						${mrow('RAM', pct(used, m.memtotal), fmtBytes(used, 0))}
						${mrow('TEMP', t == null ? 0 : pct(t, 65), t == null ? '–' : t.toFixed(0) + ' °C', t >= 50 ? 'warn' : '')}
						${mrow('LÜFTER', i.fan_pwm == null ? 0 : pct(i.fan_pwm, 255), i.fan_pwm == null ? '–' : i.fan_pwm === 0 ? 'aus' : i.fan_pwm < 200 ? 'halb' : 'voll')}
						${ov ? mrow('FLASH', pct(ov.used, ov.size), fmtBytes(ov.used, 0)) : ''}
					</div>
					<p class="note">${i.model ? i.model + ' · ' : ''}Linux ${i.kernel} · Last ${(i.load || []).map((x) => x.toFixed(2)).join(' ')}</p>
				</div>
				<div class="panel">
					<div class="ph"><span class="pt">NETZWERK · eth0</span><span class="tag ml">${e.speed ? e.speed + ' Mbit/s' : 'kein Link'}</span></div>
					${spark()}
					<div class="rates"><span class="rx">↓ <b>${fmtRate(S.rxRate)}</b> rx</span><span class="mut">letzte 10 min</span><span class="tx">↑ <b>${fmtRate(S.txRate)}</b> tx</span></div>
					<dl class="kv" style="margin-top:14px">
						<dt>IPv4</dt><dd>${e.ipv4 ? `${e.ipv4.address} / ${e.ipv4.prefix}` : '–'}</dd>
						<dt>Gateway · DNS</dt><dd>${e.gateway || '–'} · ${(e.dns || []).join(', ') || '–'}</dd>
						<dt>MAC</dt><dd>${e.mac || '–'}</dd>
					</dl>
				</div>
			</div>
		</section>
		${favBar(S.apps?.installed?.apps || [])}
		<section class="sec">
			${secHead('status', 'STATUS')}
			${statusTiles([
				['Firmware', i.release?.version || '–', S.check?.update_available ? 'Update ' + S.check.latest + ' verfügbar' : 'Kanal ' + (S.check?.channel || 'stable')],
				['Start aus', bootTxt, i.boot === 'flash' ? 'Einstellungen bleiben erhalten' : 'Änderungen gehen beim Neustart verloren'],
				['Laufzeit', fmtUptime(i.uptime), 'seit dem letzten Start'],
				['Dienste', svcUp == null ? '…' : `${svcUp} / ${S.services.length}`, 'laufen'],
				['Flash frei', ov ? fmtBytes(ov.avail, 0) : '–', 'für Einstellungen & Pakete'],
				['Laufwerke', String((i.disks || []).length), (i.disks || []).length ? 'erkannt' : 'keine eingesteckt']
			], isTable('status'))}
		</section>
		<section class="sec">
			${secHead('disks', 'LAUFWERKE', `${(i.disks || []).length} erkannt`)}
			${diskCards(i, isTable('disks'))}
		</section>
		<section class="sec">
			${secHead('services', 'DIENSTE', html`<a href="#/services">alle verwalten</a>`)}
			${serviceCards(false, isTable('services'))}
		</section>`;
	},

	storage() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Speicher">${STO_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/storage/${id}">${label}</a>`)}</nav>
		${sub === 'snapshots' ? snapshotsView() : sub === 'health' ? healthView() : storageView()}`;
	},

	shares() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Freigaben">${SHR_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/shares/${id}">${label}</a>`)}</nav>
		${sub === 'files' ? html`${filesView()}<div id="fb-trashset">${trashSettings()}</div>` : !S.shares || !S.acc || !S.vols ? html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`
			: sub === 'users' ? usersView() : sub === 'groups' ? groupsView() : sharesView()}`;
	},
	apps: () => appsView(),
	cloud: () => cloudSection('admin'),
	paperless: () => paperlessView(),

	services() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Dienste">${SVC_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/services/${id}">${label}</a>`)}</nav>
		${sub === 'dlna' ? dlnaView() : sub === 'printer' ? printerView() : sub === 'ups' ? upsView() : sub === 'autostart' ? autostartView()
			: html`<section class="sec">${secHead('services', 'DIENSTE', 'Start, Stopp, Neustart')}${serviceCards(true, isTable('services'))}</section>`}`;
	},

	system() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="System">${SYS_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/system/${id}">${label}</a>`)}</nav>
		${(SYS[sub] || SYS.general)()}`;
	}
};

function planned(title, phase, items, icon = I.info) {
	return html`<section class="sec"><h2 class="gh">${title.toUpperCase()} <span>geplant · ${phase}</span></h2>
		<div class="panel"><div class="empty">${svg(icon)}<div><span>Dieser Bereich ist noch nicht gebaut. Geplant:</span>
		<ul class="plan">${items.map((x) => html`<li>${x}</li>`)}</ul></div></div></div></section>`;
}

function svcActions(s) {
	return s.running ? html`<button class="btn sm" type="button" data-act="svc" data-name="${s.name}" data-op="restart">${svg(I.reboot)}Neustart</button>
		${s.essential ? '' : html`<button class="btn sm danger" type="button" data-act="svc" data-name="${s.name}" data-op="stop">Stopp</button>`}`
		: html`<button class="btn sm" type="button" data-act="svc" data-name="${s.name}" data-op="start">Starten</button>`;
}

function serviceCards(withActions, table = false) {
	if (!S.services) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Dienste …</span></div></div>`;
	if (table) return html`<div class="tw"><table class="t" style="min-width:${withActions ? 720 : 520}px"><thead><tr><th>DIENST</th><th>BESCHREIBUNG</th><th>STATUS</th><th>BEIM START</th>${withActions ? html`<th></th>` : ''}</tr></thead>
		<tbody>${S.services.map((s) => html`<tr>
			<td><b>${s.label}</b><div class="mut" style="font-size:12px">${s.name}</div></td><td class="mut">${s.desc}</td>
			<td><span class="tag ${s.running ? 'ok' : 'err'}">${s.running ? 'läuft' : 'gestoppt'}</span></td>
			<td class="mut">${s.essential ? 'immer' : s.autostart === false ? 'aus' : 'an'}</td>
			${withActions ? html`<td><div class="acts">${svcActions(s)}</div></td>` : ''}</tr>`)}</tbody></table></div>`;
	return html`<div class="grid">${S.services.map((s) => html`
		<div class="card${s.running ? '' : ' off'}">
			<div class="icon">${svg(SVC_ICON[s.name] || I.chip)}<span class="dot ${s.running ? 'up' : 'down'}"></span></div>
			<div class="info"><div class="name">${s.label}</div><div class="desc">${s.desc}</div>
				<div class="ip">${s.name} · ${s.running ? 'läuft' : 'gestoppt'}</div>
				${withActions ? html`<div class="acts" style="margin-top:12px">${svcActions(s)}</div>` : ''}
			</div>
		</div>`)}</div>`;
}

function autostartView() {
	if (!S.services) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Dienste …</span></div></div>`;
	return html`<section class="sec">
		<h2 class="gh">AUTOSTART <span>welche Dienste beim Einschalten starten</span></h2>
		<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>DIENST</th><th>BESCHREIBUNG</th><th>BEIM START</th><th>JETZT</th></tr></thead>
			<tbody>${S.services.map((s) => html`<tr>
				<td><b>${s.label}</b><div class="mut" style="font-size:12px">${s.name}</div></td><td class="mut">${s.desc}</td>
				<td>${s.essential ? html`<span class="tag" title="Ohne diesen Dienst ist die Box nicht bedienbar">immer</span>`
					: html`<label class="chk"><input type="checkbox" class="as-toggle" data-name="${s.name}"${s.autostart !== false ? raw(' checked') : ''}>starten</label>`}</td>
				<td><span class="tag ${s.running ? 'ok' : 'err'}">${s.running ? 'läuft' : 'gestoppt'}</span></td></tr>`)}</tbody></table></div>
		<p class="note">Gilt ab dem nächsten Start. Laufende Dienste startest und stoppst du unter „Status“. Gerätesteuerung, Systembus, API und Weboberfläche starten immer, sonst wäre die Box nicht mehr bedienbar.</p>
	</section>`;
}

async function loadServices() {
	try {
		S.services = (await rpc('shareos.service', 'list')).services;
		if (S.route.tab === 'services' || S.route.tab === 'overview') renderMain();
	} catch (e) { if (e.code !== 'auth') toast('Dienste: ' + e.message, true); }
}



/* ---------- shares, users, groups (Freigaben) -------------------------------- */

const ACCESS_TXT = { rw: 'lesen & schreiben', ro: 'nur lesen', '': 'kein Zugriff' };
const fmtMB = (mb) => (mb ? fmtBytes(mb * 1e6, 0) : 'unbegrenzt');

async function loadShareData() {
	try {
		const [sh, acc, st] = await Promise.all([rpc('shareos.shares', 'list'), rpc('shareos.accounts', 'list'), rpc('shareos.storage', 'status')]);
		S.shares = sh; S.acc = acc; S.vols = st.volumes || [];
	} catch (e) { if (e.code !== 'auth') toast('Freigaben: ' + e.message, true); }
	if (S.route.tab === 'shares' && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

function accessOf(sh, tag) { return sh.rw.includes(tag) ? 'rw' : sh.ro.includes(tag) ? 'ro' : ''; }

function shareAccessSummary(sh) {
	const parts = [...sh.rw.map((x) => x + ' (rw)'), ...sh.ro.map((x) => x + ' (r)')];
	if (sh.guest) parts.unshift('Gäste (r)');
	return parts.join(', ') || 'noch niemand';
}

function sharesView() {
	const d = S.shares, host = S.info?.hostname || location.hostname, ip = S.info?.network?.eth0?.ipv4?.address || location.hostname;
	const e = S.shEdit;
	const list = d.shares;
	return html`
	${e ? shareEditor(e) : ''}
	<section class="sec">
		${secHead('shares', 'FREIGABEN', list.length ? list.length + ' eingerichtet' : 'noch keine')}
		${!S.vols.length ? html`<div class="panel"><div class="empty">${svg(I.info)}<span>Für Freigaben wird ein Laufwerk gebraucht – zuerst unter <a href="#/storage">Speicher</a> einrichten.</span></div></div>`
			: !list.length ? html`<div class="panel"><div class="empty">${svg(I.folder)}<div><span>Noch keine Freigabe. Eine Freigabe macht einen Ordner auf einem Laufwerk im Netzwerk erreichbar – unter Windows, macOS und Linux.</span>
				<div class="acts" style="margin-top:12px">${e ? '' : html`<button class="btn primary" type="button" data-act="sh-new">Freigabe anlegen</button>`}</div></div></div></div>`
			: isTable('shares') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>FREIGABE</th><th>ORDNER</th><th>PROTOKOLLE</th><th>ZUGRIFF</th><th></th></tr></thead>
				<tbody>${list.map((x) => html`<tr>
					<td><b>${x.name}</b>${x.comment ? html`<div class="mut" style="font-size:12px">${x.comment}</div>` : ''}</td>
					<td><code>${x.fullpath || x.volume + '/' + x.path}</code>${x.mounted ? '' : html` <span class="tag err">Laufwerk fehlt</span>`}</td>
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
		${list.length && !e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="sh-new">Neue Freigabe</button></div>` : ''}
	</section>
	<section class="sec">
		<h2 class="gh">DIENSTE</h2>
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SMB (WINDOWS, MACOS, LINUX)</span><span class="tag ml ${d.smb_running ? 'ok' : ''}">${d.smb_running ? 'läuft' : 'aus'}</span></div>
				<label class="chk"><input type="checkbox" id="opt-smb"${d.smb_enabled ? raw(' checked') : ''}>SMB-Freigaben anbieten</label>
				<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>ARBEITSGRUPPE</span><input id="opt-wg" value="${d.workgroup}" maxlength="15"></label></div>
				<label class="chk" style="margin-top:12px"><input type="checkbox" id="opt-smbcompat"${d.smb_compat ? raw(' checked') : ''}>Kompatibilitätsmodus (höchstens SMB 2.1)</label>
				<p class="note">Nur für Geräte, die mit SMB 3 nicht zurechtkommen. Die Signatur, die Windows 11 bei jeder Verbindung verlangt, rechnet bei SMB 3 die Krypto-Einheit der Box (gemessen etwa 19–23 MB/s beim Schreiben, ohne Signatur etwa 35); SMB 2.1 rechnet sie auf dem Prozessor (etwa 9–14 MB/s) und hat keine Verschlüsselung und kein Multichannel. Bestehende Verbindungen werden beim Umschalten getrennt.</p>
				<dl class="kv" style="margin-top:12px">
					<dt>Windows</dt><dd><code>\\\\${host}\\&lt;freigabe&gt;</code></dd>
					<dt>macOS / Linux</dt><dd><code>smb://${ip}/&lt;freigabe&gt;</code></dd>
				</dl>
				<p class="note">Der SMB-Dienst startet automatisch, sobald es eine Freigabe gibt. Persönliche Ordner erscheinen als <code>\\\\${host}\\&lt;benutzer&gt;</code>.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NFS (LINUX, PROXMOX)</span><span class="tag ml ${d.nfs_running ? 'ok' : ''}">${d.nfs_running ? 'läuft' : 'aus'}</span></div>
				<label class="chk"><input type="checkbox" id="opt-nfs"${d.nfs_enabled ? raw(' checked') : ''}>NFS-Freigaben anbieten</label>
				<p class="note">NFS kennt keine Benutzer: Zugriff bekommen die eingetragenen Rechner oder Netze. Dateien werden als <code>nobody:users</code> gespeichert. Einbinden z. B. mit <code>mount ${ip}:/mnt/&lt;laufwerk&gt;/&lt;ordner&gt; /ziel</code>.</p>
			</div>
		</div>
	</section>`;
}

function shareTags(x) {
	return html`${x.smb ? html`<span class="tag">SMB</span> ` : ''}${x.nfs ? html`<span class="tag">NFS${x.nfs_rw ? '' : ' (r)'}</span> ` : ''}${x.guest ? html`<span class="tag warn">GAST</span>` : ''}${!x.smb && !x.nfs ? html`<span class="tag err">kein Protokoll</span>` : ''}`;
}
function shareActions(x) {
	return html`<button class="btn sm" type="button" data-act="sh-edit" data-name="${x.name}">Bearbeiten</button>
		<button class="btn sm ghost" type="button" data-act="sh-del" data-name="${x.name}">Entfernen</button>`;
}

function shareEditor(e) {
	const x = e.data, accs = S.acc;
	const rows = [...accs.users.map((u) => [u.name, u.fullname ? `${u.name} – ${u.fullname}` : u.name, I.user]),
		...accs.groups.map((g) => ['@' + g.name, `Gruppe ${g.name}`, I.users])];
	return html`<section class="sec"><form class="panel" id="f-share" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${e.mode === 'new' ? 'NEUE FREIGABE' : 'FREIGABE ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="sh-cancel">Abbrechen</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="16" pattern="[a-z0-9][a-z0-9_-]{0,15}" required${e.mode === 'edit' ? raw(' readonly') : ''}></label>
			<label class="f"><span>LAUFWERK</span><select name="volume">${S.vols.map((v) => html`<option value="${v.name}"${x.volume === v.name ? raw(' selected') : ''}>${v.name} (${LAYOUT_TXT[v.layout] || v.layout})</option>`)}</select></label>
			<label class="f"><span>ORDNER AUF DEM LAUFWERK</span><input name="path" value="${x.path}" placeholder="wie der Name"></label>
			<label class="f"><span>BESCHREIBUNG</span><input name="comment" value="${x.comment}" maxlength="64"></label>
		</div>
		<div class="pt" style="margin:18px 0 8px">ZUGRIFF ÜBER SMB</div>
		<div style="display:grid;gap:6px">
			<label class="chk"><input type="checkbox" name="smb"${x.smb ? raw(' checked') : ''}>Über SMB freigeben (Windows, macOS, Linux)</label>
			<label class="chk"><input type="checkbox" name="guest"${x.guest ? raw(' checked') : ''}>Gäste dürfen ohne Passwort lesen</label>
		</div>
		${rows.length ? html`<div class="tw" style="margin-top:12px"><table class="t" style="min-width:420px"><thead><tr><th>BENUTZER / GRUPPE</th><th style="width:220px">RECHT</th></tr></thead>
			<tbody>${rows.map(([tag, label, icon]) => html`<tr><td><span style="display:inline-flex;gap:8px;align-items:center">${svg(icon)}${label}</span></td>
				<td><select class="acl" data-tag="${tag}" aria-label="Recht für ${label}">${['', 'ro', 'rw'].map((v) => html`<option value="${v}"${accessOf(x, tag) === v ? raw(' selected') : ''}>${ACCESS_TXT[v]}</option>`)}</select></td></tr>`)}</tbody></table></div>`
			: html`<p class="note">Noch keine Benutzer – unter <a href="#/shares/users">Benutzer</a> anlegen, oder Gastzugang erlauben.</p>`}
		<div class="pt" style="margin:18px 0 8px">ZUGRIFF ÜBER NFS</div>
		<div style="display:grid;gap:6px">
			<label class="chk"><input type="checkbox" name="nfs"${x.nfs ? raw(' checked') : ''}>Über NFS freigeben</label>
			<label class="chk"><input type="checkbox" name="nfs_rw"${x.nfs_rw ? raw(' checked') : ''}>NFS-Clients dürfen schreiben</label>
		</div>
		<div class="fields" style="grid-template-columns:1fr;margin-top:10px"><label class="f"><span>NFS-CLIENTS (IP ODER NETZ, KOMMA-GETRENNT)</span><input name="nfs_hosts" value="${x.nfs_hosts.join(', ')}" placeholder="192.168.1.0/24"></label></div>
		<p class="note">Der Ordner wird angelegt, falls er fehlt. Beim Entfernen einer Freigabe bleiben Ordner und Dateien erhalten.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button></div>
	</form></section>`;
}

function usageLine(u) {
	if (!u.usage?.length) return u.quota ? html`Limit ${fmtMB(u.quota)} je Laufwerk` : html`<span class="mut">kein Limit</span>`;
	return html`${u.usage.map((x) => { const p = x.limit ? pct(x.used, x.limit) : 0; return html`<div style="margin-top:4px"><span class="mut">${x.volume}:</span> ${fmtBytes(x.used)}${x.limit ? html` von ${fmtBytes(x.limit)}` : ''}
		${x.limit ? html`<div class="bar" style="margin-top:4px"><i class="${p > 95 ? 'crit' : p > 85 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}</div>`; })}`;
}

function usersView() {
	const a = S.acc, e = S.uEdit;
	return html`
	${e ? userEditor(e) : ''}
	<section class="sec">
		${secHead('users', 'BENUTZER', a.users.length ? a.users.length + ' angelegt' : 'noch keine')}
		${!a.users.length ? html`<div class="panel"><div class="empty">${svg(I.user)}<div><span>Noch keine Benutzer. Ein Konto gilt überall: für Freigaben, die Weboberfläche und später für Apps und Cloud-Sync.</span>
			<div class="acts" style="margin-top:12px">${e ? '' : html`<button class="btn primary" type="button" data-act="u-new">Benutzer anlegen</button>`}
			<button class="btn ghost" type="button" data-act="u-altf">Von Alt-F übernehmen</button></div></div></div></div>`
		: isTable('users') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>BENUTZER</th><th>ROLLE</th><th>GRUPPEN</th><th>PERSÖNLICHER ORDNER</th><th>SPEICHER</th><th></th></tr></thead>
			<tbody>${a.users.map((u) => html`<tr>
				<td><b>${u.name}</b>${u.fullname ? html`<div class="mut" style="font-size:12px">${u.fullname}</div>` : ''}</td>
				<td>${roleTag(u)}</td><td class="mut">${u.groups.join(', ') || '–'}</td>
				<td class="mut">${u.home ? '/mnt/' + u.home + '/home/' + u.name : '–'}</td>
				<td style="font-size:12px;min-width:160px">${usageLine(u)}</td>
				<td><div class="acts">${userActions(u)}</div></td></tr>`)}</tbody></table></div>`
		: html`<div class="grid">${a.users.map((u) => html`<div class="card">
			<div class="icon">${svg(I.user)}<span class="dot up"></span></div>
			<div class="info"><div class="name">${u.name} ${roleTag(u)}</div>
				<div class="desc">${u.fullname || ''}${u.groups.length ? (u.fullname ? ' · ' : '') + u.groups.join(', ') : ''}</div>
				<div class="desc" style="margin-top:8px;font-size:12px">${usageLine(u)}</div>
				<div class="ip">${u.home ? '/mnt/' + u.home + '/home/' + u.name : 'kein persönlicher Ordner'}</div>
				<div class="acts" style="margin-top:12px">${userActions(u)}</div></div></div>`)}</div>`}
		${a.users.length && !e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="u-new">Neuer Benutzer</button>
			<button class="btn ghost" type="button" data-act="u-altf">Von Alt-F übernehmen</button></div>` : ''}
		<p class="note">Rollen: <b>Administrator</b> – alles, auch SSH. <b>Benutzer</b> – eigener Bereich „Mein ShareOS“ in der Weboberfläche. <b>Nur Freigaben</b> – Zugriff auf Freigaben, keine Anmeldung an der Oberfläche. Das Konto <code>root</code> bleibt immer Administrator.</p>
	</section>`;
}

function roleTag(u) {
	return html`<span class="tag ${u.role === 'admin' ? 'warn' : ''}">${ROLE_TXT[u.role] || u.role}${u.role === 'user' && !u.web ? ' · ohne Web' : ''}</span>`;
}
function userActions(u) {
	return html`<button class="btn sm" type="button" data-act="u-edit" data-name="${u.name}">Bearbeiten</button>
		<button class="btn sm" type="button" data-act="u-pass" data-name="${u.name}">${svg(I.key)}Passwort</button>
		<button class="btn sm ghost" type="button" data-act="u-del" data-name="${u.name}">Löschen</button>`;
}

function userEditor(e) {
	const u = e.data, isNew = e.mode === 'new';
	return html`<section class="sec"><form class="panel" id="f-user" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${isNew ? 'NEUER BENUTZER' : 'BENUTZER ' + u.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="u-cancel">Abbrechen</button></div>
		<div class="fields">
			<label class="f"><span>BENUTZERNAME</span><input name="name" value="${u.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required autocomplete="off"${isNew ? '' : raw(' readonly')}></label>
			<label class="f"><span>VOLLER NAME</span><input name="fullname" value="${u.fullname}" maxlength="64"></label>
			<label class="f"><span>ROLLE</span><select name="role">${Object.entries(ROLE_TXT).map(([k, t]) => html`<option value="${k}"${u.role === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>PERSÖNLICHER ORDNER</span><select name="home"><option value="">keiner</option>${S.vols.filter(linuxFs).map((v) => html`<option value="${v.name}"${u.home === v.name ? raw(' selected') : ''}>auf ${v.name}</option>`)}</select></label>
			<label class="f"><span>SPEICHERLIMIT (GB)</span><input name="quota" type="number" min="0" step="1" value="${Math.round((u.quota || 0) / 1000)}"></label>
			${isNew ? html`<label class="f"><span>PASSWORT</span><input name="p1" type="password" minlength="6" autocomplete="new-password" required></label>
				<label class="f"><span>WIEDERHOLEN</span><input name="p2" type="password" minlength="6" autocomplete="new-password" required></label>` : ''}
		</div>
		<label class="chk" style="margin-top:12px" id="u-web-row"${u.role === 'user' ? '' : raw(' hidden')}><input type="checkbox" name="web"${u.web ? raw(' checked') : ''}>Darf sich an der Weboberfläche anmelden („Mein ShareOS“)</label>
		<label class="chk" style="margin-top:6px"><input type="checkbox" name="cloud"${u.cloud ? raw(' checked') : ''}>Darf eigene Cloud-Sync-Aufträge anlegen (braucht persönlichen Ordner)</label>
		<label class="chk" style="margin-top:6px"><input type="checkbox" name="files"${u.files ? raw(' checked') : ''}>Dateien: persönlicher Ordner und Freigaben (nach Rechten) im Dateibrowser und in Apps</label>
		${S.acc.groups.length ? html`<div class="pt" style="margin:16px 0 8px">GRUPPEN</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${S.acc.groups.map((g) => html`
			<label class="chk"><input type="checkbox" class="u-group" value="${g.name}"${u.groups.includes(g.name) ? raw(' checked') : ''}>${g.name}</label>`)}</div>` : ''}
		<p class="note">Benutzername: Kleinbuchstaben, Ziffern und _, beginnt mit einem Buchstaben. Das Speicherlimit gilt je Laufwerk, 0 = unbegrenzt. Das Passwort gilt für Freigaben und – je nach Rolle – für die Weboberfläche.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">${isNew ? 'Anlegen' : 'Speichern'}</button></div>
	</form></section>`;
}

function groupsView() {
	const a = S.acc;
	return html`<section class="sec">
		<h2 class="gh">GRUPPEN <span>${a.groups.length ? a.groups.length + ' angelegt' : 'noch keine'}</span></h2>
		${a.groups.length ? html`<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>GRUPPE</th><th>BESCHREIBUNG</th><th>MITGLIEDER</th><th></th></tr></thead>
			<tbody>${a.groups.map((g) => html`<tr><td><b>${g.name}</b></td><td class="mut">${g.desc || '–'}</td><td>${g.members.join(', ') || html`<span class="mut">keine</span>`}</td>
				<td><button class="btn sm ghost" type="button" data-act="g-del" data-name="${g.name}">Löschen</button></td></tr>`)}</tbody></table></div>`
			: html`<div class="panel"><div class="empty">${svg(I.users)}<span>Gruppen fassen Benutzer zusammen, z. B. „familie“ oder „medien“. Rechte an Freigaben lassen sich dann für die ganze Gruppe vergeben.</span></div></div>`}
		<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="g-new">Neue Gruppe</button></div>
		<p class="note">Mitglieder legst du beim Benutzer fest (Benutzer → Bearbeiten).</p>
	</section>`;
}


/* ---------- Paperless ----------------------------------------------------------- */

const PL_STATE = { SUCCESS: ['ok', 'übernommen'], PENDING: ['', 'wird verarbeitet'], FAILURE: ['err', 'Fehler'], UNKNOWN: ['warn', 'unbekannt'] };
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
	if (!d || !S.acc || !S.shares) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
	const e = S.plEdit;
	return html`
	<section class="sec">
		<h2 class="gh">PAPERLESS-NGX <span>${d.url ? d.url : 'noch nicht verbunden'}</span></h2>
		<div class="g2">
			<form class="panel" id="f-pl">
				<div class="ph"><span class="pt">VERBINDUNG</span>${d.last ? html`<span class="tag ml">zuletzt ${fmtTime(d.last)}</span>` : ''}</div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>ADRESSE VON PAPERLESS</span><input name="url" value="${d.url}" placeholder="http://paperless.local:8000" inputmode="url"></label>
				</div>
				<div class="fields" style="margin-top:12px">
					<label class="f"><span>PRÜFEN ALLE</span><select name="interval">${[1, 2, 5, 10, 15, 30, 60].map((m) => html`<option value="${m}"${d.interval === m ? raw(' selected') : ''}>${m} min</option>`)}</select></label>
					<label class="f"><span>NACH DEM HOCHLADEN</span><select name="after"><option value="delete"${d.after === 'delete' ? raw(' selected') : ''}>Datei löschen</option><option value="keep"${d.after === 'keep' ? raw(' selected') : ''}>aufheben (.paperless/done)</option></select></label>
				</div>
				<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Eingangsordner automatisch übertragen</label>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button>
					<button class="btn" type="button" data-act="pl-run" ${d.url && d.inboxes.length ? '' : 'disabled'}>Jetzt übertragen</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">SO FUNKTIONIERT ES</span></div>
				<ol class="plan" style="padding-left:20px">
					<li>Für jeden Eingang ein API-Token in Paperless anlegen (Profil → API-Token). Die Dokumente gehören dann diesem Paperless-Benutzer.</li>
					<li>Dateien (PDF, Bilder, Office) in den Eingangsordner legen – vom PC oder direkt vom Scanner.</li>
					<li>ShareOS lädt sie über die Paperless-API hoch und zeigt, ob Paperless sie übernommen hat.</li>
				</ol>
				<p class="note">Persönliche Eingänge liegen im persönlichen Ordner (<code>Paperless</code>); Benutzer können ihr Token auch selbst unter „Mein ShareOS“ eintragen. Gemeinsame Eingänge nutzen eine Freigabe, z. B. für einen Scanner.</p>
			</div>
		</div>
	</section>
	${e ? inboxEditor(e) : ''}
	<section class="sec">
		${secHead('inboxes', 'EINGÄNGE', d.inboxes.length ? d.inboxes.length + ' eingerichtet' : 'noch keine')}
		${!d.inboxes.length ? html`<div class="panel"><div class="empty">${svg(I.doc)}<span>Noch kein Eingangsordner. ${d.url ? '' : 'Zuerst oben die Adresse von Paperless eintragen.'}</span></div></div>`
			: isTable('inboxes') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>EINGANG</th><th>ORDNER</th><th>WARTEND</th><th>ZULETZT</th><th></th></tr></thead>
				<tbody>${d.inboxes.map((ib) => html`<tr>
					<td><b>${ib.name}</b><div class="mut" style="font-size:12px">${ib.owner ? 'persönlich: ' + ib.owner : 'gemeinsam'}${ib.enabled ? '' : ' · aus'}</div></td>
					<td><code>${inboxWhere(ib)}</code></td><td>${ib.waiting}</td>
					<td>${ib.recent[0] ? html`${plStateTag(ib.recent[0])} <span class="mut" style="font-size:12px">${ib.recent[0].file}</span>` : html`<span class="mut">–</span>`}</td>
					<td><div class="acts">${inboxActions(ib)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.inboxes.map((ib) => html`<div class="card${ib.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.doc)}<span class="dot ${ib.enabled && ib.token_set ? 'up' : 'down'}"></span></div>
				<div class="info"><div class="name">${ib.name}</div>
					<div class="desc">${ib.owner ? 'persönlicher Eingang von ' + ib.owner : 'gemeinsamer Eingang'} · Token ${ib.token_hint || 'fehlt'}</div>
					<div class="desc" style="margin-top:6px">${ib.waiting ? ib.waiting + ' Datei(en) warten' : 'nichts wartend'}</div>
					${ib.recent.slice(0, 3).map((x) => html`<div class="desc" style="margin-top:4px;font-size:12px">${plStateTag(x)} ${x.file} <span class="mut">${fmtTime(x.time)}</span></div>`)}
					<div class="ip">${inboxWhere(ib)}</div>
					<div class="acts" style="margin-top:12px">${inboxActions(ib)}</div></div></div>`)}</div>`}
		${!e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="pl-new" ${d.url ? '' : 'disabled'}>Neuer Eingang</button></div>` : ''}
	</section>
	${S.plLog ? html`<section class="sec"><div class="panel">
		<div class="ph"><span class="pt">PROTOKOLL · ${S.plLog.name}</span><button class="btn sm ghost ml" type="button" data-act="pl-log-close">Schließen</button></div>
		${S.plLog.entries.length ? html`<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>ZEIT</th><th>DATEI</th><th>STATUS</th><th>MELDUNG</th></tr></thead>
			<tbody>${S.plLog.entries.map((x) => html`<tr><td class="mut">${fmtTime(x.time)}</td><td>${x.file}</td><td>${plStateTag(x)}</td><td class="mut" style="font-size:12px">${x.message}</td></tr>`)}</tbody></table></div>`
			: html`<p class="mut" style="margin:0">Noch nichts übertragen.</p>`}
	</div></section>` : ''}`;
}

function inboxActions(ib) {
	return html`<button class="btn sm" type="button" data-act="pl-edit" data-name="${ib.name}">Bearbeiten</button>
		<button class="btn sm" type="button" data-act="pl-log" data-name="${ib.name}">Protokoll</button>
		<button class="btn sm ghost" type="button" data-act="pl-del" data-name="${ib.name}">Entfernen</button>`;
}

function inboxEditor(e) {
	const x = e.data, users = S.acc.users.filter((u) => u.home), isNew = e.mode === 'new';
	return html`<section class="sec"><form class="panel" id="f-inbox" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${isNew ? 'NEUER EINGANG' : 'EINGANG ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="pl-cancel">Abbrechen</button></div>
		<div class="fields">
			<label class="f"><span>ART</span><select name="kind"${isNew ? '' : raw(' disabled')}><option value="user"${x.owner || isNew ? raw(' selected') : ''}>persönlich (Ordner „Paperless“ im persönlichen Ordner)</option><option value="share"${!x.owner && !isNew ? raw(' selected') : ''}>gemeinsam (Ordner einer Freigabe)</option></select></label>
			<label class="f" id="ib-owner"><span>BENUTZER</span><select name="owner"${isNew ? '' : raw(' disabled')}>${users.map((u) => html`<option value="${u.name}"${x.owner === u.name ? raw(' selected') : ''}>${u.name}${u.fullname ? ' – ' + u.fullname : ''}</option>`)}</select></label>
			<label class="f" id="ib-share" hidden><span>FREIGABE</span><select name="share"${isNew ? '' : raw(' disabled')}>${S.shares.shares.map((sh) => html`<option value="${sh.name}"${x.share === sh.name ? raw(' selected') : ''}>${sh.name}</option>`)}</select></label>
			<label class="f"><span>API-TOKEN${isNew ? '' : ' (LEER = BEHALTEN)'}</span><input name="token" type="password" autocomplete="off" placeholder="${x.token_hint || 'aus Paperless: Profil → API-Token'}"${isNew ? raw(' required') : ''}></label>
		</div>
		${!isNew && e.tags ? html`<div class="pt" style="margin:16px 0 8px">TAGS FÜR NEUE DOKUMENTE</div>
			<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${e.tags.length ? e.tags.map((t) => html`<label class="chk"><input type="checkbox" class="ib-tag" value="${t.id}"${x.tags.includes(String(t.id)) ? raw(' checked') : ''}>${t.name}</label>`) : html`<span class="mut">keine Tags gefunden</span>`}</div>` : ''}
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>aktiv</label>
		${!users.length && isNew ? html`<p class="note">Persönliche Eingänge brauchen einen Benutzer mit persönlichem Ordner.</p>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button><button class="btn" type="button" data-act="pl-test">Verbindung prüfen</button></div>
	</form></section>`;
}

/* ---------- cloud (rclone), for the admin and for users ------------------------- */

const CLOUD_MODES = {
	upload: 'Hochladen – Kopie in die Cloud, nichts wird gelöscht',
	download: 'Herunterladen – Kopie aufs NAS, nichts wird gelöscht',
	mirror_up: 'Spiegeln zur Cloud – löscht in der Cloud, was hier fehlt',
	mirror_down: 'Spiegeln von der Cloud – löscht hier, was in der Cloud fehlt'
};
const CLOUD_SCHED = [['', 'nur von Hand'], ['17 * * * *', 'stündlich'], ['30 2 * * *', 'täglich um 2:30'], ['0 3 * * 0', 'sonntags um 3:00'], ['custom', 'eigene Zeit (cron)']];
const REMOTE_TYPES = { gdrive: 'Google Drive', gphotos: 'Google Fotos', onedrive: 'Microsoft OneDrive', dropbox: 'Dropbox', webdav: 'Nextcloud / ownCloud / WebDAV',
	s3: 'S3 (AWS, MinIO, Wasabi …)', b2: 'Backblaze B2', mega: 'MEGA', pcloud: 'pCloud', box: 'Box', koofr: 'Koofr', yandex: 'Yandex Disk',
	sftp: 'SFTP (SSH-Server)', ftp: 'FTP', smb: 'Windows-Freigabe (SMB)', raw: 'andere – rclone-Konfiguration einfügen' };
// services where you sign in in the browser (OAuth): no password is stored, only a token
const REMOTE_OAUTH = { gdrive: 1, gphotos: 1, onedrive: 1, dropbox: 1, pcloud: 1, box: 1, yandex: 1 };
const REMOTE_FIELDS = {
	ftp: [['host', 'SERVER'], ['port', 'PORT', '21'], ['user', 'BENUTZER'], ['pass', 'PASSWORT', 'password']],
	smb: [['host', 'SERVER'], ['user', 'BENUTZER'], ['domain', 'DOMÄNE (OPTIONAL)', 'WORKGROUP'], ['pass', 'PASSWORT', 'password']],
	mega: [['user', 'E-MAIL'], ['pass', 'PASSWORT', 'password']],
	b2: [['account', 'KEY-ID (ACCOUNT)'], ['key', 'APPLICATION KEY', 'password']],
	koofr: [['provider', 'ANBIETER', ['koofr', 'digistorage', 'other']], ['user', 'E-MAIL'], ['password', 'APP-PASSWORT', 'password']],
	webdav: [['url', 'ADRESSE (WEBDAV-URL)', 'https://cloud.example.com/remote.php/dav/files/NAME/'], ['vendor', 'ANBIETER', ['nextcloud', 'owncloud', 'other']], ['user', 'BENUTZER'], ['pass', 'PASSWORT / APP-PASSWORT', 'password']],
	s3: [['provider', 'ANBIETER', ['AWS', 'Minio', 'Wasabi', 'Other']], ['endpoint', 'ENDPUNKT (LEER BEI AWS)'], ['region', 'REGION'], ['access_key_id', 'ACCESS KEY'], ['secret_access_key', 'SECRET KEY', 'password']],
	sftp: [['host', 'SERVER'], ['port', 'PORT', '22'], ['user', 'BENUTZER'], ['pass', 'PASSWORT', 'password']]
};

const CLOUD_API = {
	admin: {
		async load() {
			const [st, r, j, sh] = await Promise.all([rpc('shareos.cloud', 'status'), rpc('shareos.cloud', 'remotes'), rpc('shareos.cloud', 'jobs'), rpc('shareos.shares', 'list')]);
			return { status: st, remotes: r.remotes, jobs: j.jobs, locals: sh.shares.map((x) => ['share:' + x.name, 'Freigabe ' + x.name]) };
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
				locals: [['home', 'Persönlicher Ordner'], ...(c.shares || []).map((x) => ['share:' + x, 'Freigabe ' + x])] };
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
	if (j.state === 'running') return html`<span class="tag warn">läuft seit ${fmtTime(j.started)}</span>`;
	if (j.state === 'ok') return html`<span class="tag ok" title="${j.summary}">ok · ${fmtTime(j.ended)}</span>`;
	if (j.state === 'error') return html`<span class="tag err" title="${j.error}">Fehler · ${fmtTime(j.ended)}</span>`;
	return html`<span class="tag">noch nicht gelaufen</span>`;
}
const schedTxt = (s) => (CLOUD_SCHED.find(([v]) => v === s) || [s, s ? 'cron: ' + s : 'nur von Hand'])[1];
const localTxt = (d, l) => (d.locals.find(([v]) => v === l) || [l, l])[1];

function cloudSection(scope) {
	const c = S.cloud?.scope === scope ? S.cloud : null, d = c?.data;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
	const api = CLOUD_API[scope], st = d.status;
	const head = scope === 'admin' ? html`<h2 class="gh">CLOUD-SYNC <span>${st.installed ? 'rclone ' + (st.version || '') : 'rclone nicht installiert'}</span></h2>` : html`<h2 class="gh">MEINE CLOUD <span>eigene Konten und Aufträge</span></h2>`;
	if (!st.installed) {
		return html`<section class="sec">${head}<div class="panel"><div class="empty">${svg(I.cloud)}<div>
			${scope === 'admin' ? html`<span>Cloud-Sync nutzt <b>rclone</b> (Nextcloud, WebDAV, S3, SFTP, Google Drive, OneDrive, Dropbox und mehr). Das Programm (rund 20 MB) kommt in den Apps-Bereich auf der Platte${st.apps ? ` (${st.apps})` : ''}.</span>
				${st.installing ? html`<div style="margin-top:12px;display:flex;gap:10px;align-items:center"><div class="spin" style="margin:0;width:18px;height:18px"></div><span>wird geladen und geprüft …</span></div>`
				: html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="cl-install" ${st.apps ? '' : 'disabled'}>rclone installieren</button></div>`}
				${st.install_error ? html`<p class="note" style="color:var(--red)">Fehler: ${st.install_error}</p>` : ''}
				${st.apps ? '' : html`<p class="note">Zuerst unter <a href="#/storage">Speicher</a> ein Laufwerk einrichten.</p>`}`
			: html`<span>Cloud-Sync ist auf dieser Box noch nicht eingerichtet – bitte den Administrator fragen.</span>`}
		</div></div></div></section>`;
	}
	const re = c.remoteEdit, je = c.jobEdit;
	return html`<section class="sec">${head}
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">KONTEN</span><span class="tag ml">${d.remotes.length}</span></div>
				${d.remotes.length ? html`<div class="tw"><table class="t"><thead><tr><th>NAME</th><th>ART</th><th></th></tr></thead>
					<tbody>${d.remotes.map((r) => html`<tr><td><b>${r.name}</b></td><td class="mut">${r.type}</td>
						<td><div class="acts">${api.testRemote ? html`<button class="btn sm" type="button" data-act="cl-rtest" data-scope="${scope}" data-name="${r.name}">Testen</button>` : ''}
							<button class="btn sm ghost" type="button" data-act="cl-rdel" data-scope="${scope}" data-name="${r.name}">Entfernen</button></div></td></tr>`)}</tbody></table></div>`
					: html`<p class="mut" style="margin:0;font-size:13px">Noch kein Cloud-Konto.</p>`}
				${re ? '' : html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="cl-rnew" data-scope="${scope}">Konto hinzufügen</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">HINWEISE</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Zugangsdaten bleiben verschlüsselt auf der Box.</span> <span>Bei Google Drive, OneDrive, Dropbox und ähnlichen Diensten meldest du dich im Browser an; für andere Dienste den fertigen Abschnitt aus „rclone config“ einfügen.</span> <span>Aufträge laufen mit wenig Speicher (2 Übertragungen gleichzeitig); eine Bandbreitengrenze wie</span> <code>2M</code> <span>hält das Netz frei.</span>${scope === 'me' ? html` <span>Deine Zugangsdaten liegen in deinem persönlichen Ordner; was du herunterlädst, zählt zu deinem Speicherlimit.</span>` : ''}</p>
			</div>
		</div>
		${re ? remoteEditor(scope, re) : ''}
	</section>
	${je ? jobEditor(scope, d, je) : ''}
	<section class="sec">
		${secHead('cloudjobs-' + scope, 'AUFTRÄGE', d.jobs.length ? d.jobs.length + ' eingerichtet' : 'noch keine')}
		${!d.jobs.length ? html`<div class="panel"><div class="empty">${svg(I.cloud)}<span>Noch kein Auftrag. Ein Auftrag kopiert oder spiegelt einen Ordner mit einem Cloud-Konto – von Hand oder nach Zeitplan.</span></div></div>`
			: isTable('cloudjobs-' + scope) ? html`<div class="tw"><table class="t" style="min-width:860px"><thead><tr><th>AUFTRAG</th><th>VON → NACH</th><th>ZEITPLAN</th><th>ZULETZT</th><th></th></tr></thead>
				<tbody>${d.jobs.map((j) => html`<tr><td><b>${j.name}</b><div class="mut" style="font-size:12px">${scope === 'admin' ? (j.owner ? 'von ' + j.owner : 'System') : ''}</div></td>
					<td style="font-size:12px">${jobRoute(d, j)}</td><td class="mut">${schedTxt(j.schedule)}${j.enabled ? '' : ' · aus'}</td><td>${jobState(j)}</td>
					<td><div class="acts">${jobActions(scope, j)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.jobs.map((j) => html`<div class="card${j.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.cloud)}<span class="dot ${j.state === 'error' ? 'down' : j.state === 'running' ? 'warn' : 'up'}"></span></div>
				<div class="info"><div class="name">${j.name}</div>
					<div class="desc" style="font-size:12px">${jobRoute(d, j)}</div>
					<div class="desc" style="margin-top:6px">${schedTxt(j.schedule)}${scope === 'admin' && j.owner ? html` · <span>${'von ' + j.owner}</span>` : ''}</div>
					<div class="desc" style="margin-top:6px">${jobState(j)}</div>
					${j.state === 'error' && j.error ? html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--red)">${j.error}</div>` : j.summary ? html`<div class="desc mut" style="margin-top:4px;font-size:12px">${j.summary}</div>` : ''}
					<div class="acts" style="margin-top:12px">${jobActions(scope, j)}</div></div></div>`)}</div>`}
		${!je && d.remotes.length ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="cl-jnew" data-scope="${scope}">Neuer Auftrag</button></div>` : ''}
	</section>
	${c.log ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">PROTOKOLL · ${c.log.name}</span><button class="btn sm ghost ml" type="button" data-act="cl-logclose" data-scope="${scope}">Schließen</button></div>
		<pre class="logbox">${c.log.lines.join('\n') || '(leer)'}</pre></div></section>` : ''}`;
}

function jobRoute(d, j) {
	const local = localTxt(d, j.local), remote = `${j.remote}:${j.remote_path || '/'}`;
	return j.mode === 'download' || j.mode === 'mirror_down' ? html`${remote} → ${local}` : html`${local} → ${remote}`;
}

function jobActions(scope, j) {
	const api = CLOUD_API[scope];
	return html`${j.state === 'running' ? (api.stopJob ? html`<button class="btn sm danger" type="button" data-act="cl-jstop" data-scope="${scope}" data-name="${j.name}">Stopp</button>` : '')
		: html`<button class="btn sm" type="button" data-act="cl-jrun" data-scope="${scope}" data-name="${j.name}">Jetzt starten</button>`}
		<button class="btn sm" type="button" data-act="cl-jedit" data-scope="${scope}" data-name="${j.name}">Bearbeiten</button>
		${api.log ? html`<button class="btn sm" type="button" data-act="cl-jlog" data-scope="${scope}" data-name="${j.name}">Protokoll</button>` : ''}
		<button class="btn sm ghost" type="button" data-act="cl-jdel" data-scope="${scope}" data-name="${j.name}">Entfernen</button>`;
}

function remoteEditor(scope, re) {
	const fields = REMOTE_FIELDS[re.type] || [];
	return html`<form class="panel" id="f-remote" data-scope="${scope}" style="margin-top:16px;border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">NEUES CLOUD-KONTO</span><button class="btn sm ghost ml" type="button" data-act="cl-rcancel" data-scope="${scope}">Abbrechen</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${re.name || ''}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required placeholder="nextcloud"></label>
			<label class="f"><span>ART</span><select name="type" id="remote-type">${Object.entries(REMOTE_TYPES).map(([k, t]) => html`<option value="${k}"${re.type === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			${fields.map(([k, label, extra]) => html`<label class="f"><span>${label}</span>${Array.isArray(extra)
				? html`<select name="p_${k}">${extra.map((o) => html`<option>${o}</option>`)}</select>`
				: html`<input name="p_${k}" type="${extra === 'password' ? 'password' : 'text'}" autocomplete="off"${extra && extra !== 'password' ? raw(` placeholder="${esc(extra)}"`) : ''}>`}</label>`)}
		</div>
		${REMOTE_OAUTH[re.type] ? html`<div style="margin-top:12px">
			<p class="note" style="margin-top:0">Bei ${REMOTE_TYPES[re.type]} meldest du dich im Browser an; auf der Box wird nur ein Zugangsschlüssel gespeichert, kein Passwort.</p>
			<div class="acts"><button class="btn" type="button" data-act="cl-auth" data-scope="${scope}">1. Bei ${REMOTE_TYPES[re.type]} anmelden ↗</button>${re.authed ? html`<span class="tag ok">angemeldet ✓</span>` : ''}</div>
			${re.authUrl && !re.authed ? html`<p class="note">Nach der Anmeldung zeigt der Browser „Seite nicht erreichbar“ mit einer Adresse wie <code>http://127.0.0.1:53682/?state=…&amp;code=…</code>. Diese komplette Adresse aus der Adresszeile kopieren und hier einfügen:</p>
			<div class="fields" style="grid-template-columns:1fr auto;align-items:end"><label class="f"><span>2. ADRESSE NACH DER ANMELDUNG</span><input name="auth_url" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:53682/?state=…"></label>
			<button class="btn" type="button" data-act="cl-authfin" data-scope="${scope}">Übernehmen</button></div>` : ''}
		</div>` : ''}
		${re.type === 'raw' ? html`<label class="f" style="margin-top:12px"><span>ABSCHNITT AUS RCLONE.CONF (BEGINNT MIT [NAME])</span>
			<textarea name="raw" rows="8" spellcheck="false" data-i18n-skip style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" placeholder="[gdrive]&#10;type = drive&#10;token = {...}"></textarea></label>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Hinzufügen</button></div>
	</form>`;
}

function jobEditor(scope, d, je) {
	const x = je.data, custom = x.schedule && !CLOUD_SCHED.some(([v]) => v === x.schedule);
	return html`<section class="sec"><form class="panel" id="f-job" data-scope="${scope}" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${je.mode === 'new' ? 'NEUER AUFTRAG' : 'AUFTRAG ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="cl-jcancel" data-scope="${scope}">Abbrechen</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required${je.mode === 'new' ? '' : raw(' readonly')}></label>
			<label class="f"><span>ORDNER AUF DEM NAS</span><select name="local">${d.locals.map(([v, t]) => html`<option value="${v}"${x.local === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>CLOUD-KONTO</span><select name="remote">${d.remotes.map((r) => html`<option value="${r.name}"${x.remote === r.name ? raw(' selected') : ''}>${r.name}</option>`)}</select></label>
			<label class="f"><span>ORDNER IN DER CLOUD</span><input name="remote_path" value="${x.remote_path}" placeholder="Backup/NAS"></label>
		</div>
		<div class="pt" style="margin:16px 0 8px">RICHTUNG</div>
		<div style="display:grid;gap:6px">${Object.entries(CLOUD_MODES).map(([k, t]) => html`<label class="chk"><input type="radio" name="mode" value="${k}"${x.mode === k ? raw(' checked') : ''} style="accent-color:var(--accent)">${t}</label>`)}</div>
		<div class="fields" style="margin-top:14px">
			<label class="f"><span>ZEITPLAN</span><select name="sched" id="job-sched">${CLOUD_SCHED.map(([v, t]) => html`<option value="${v}"${(custom ? 'custom' : x.schedule) === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f" id="job-cron"${custom ? '' : raw(' hidden')}><span>CRON-ZEIT (MIN STD TAG MON WOTAG)</span><input name="cron" value="${custom ? x.schedule : ''}" placeholder="0 4 * * 1-5"></label>
			<label class="f"><span>BANDBREITE (LEER = UNBEGRENZT)</span><input name="bwlimit" value="${x.bwlimit}" placeholder="2M"></label>
		</div>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>Zeitplan aktiv</label>
		<p class="note">Beim Spiegeln wird auf der Zielseite gelöscht, was auf der Quellseite fehlt – für reine Sicherungen „Hochladen“ wählen.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button></div>
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
		if (REMOTE_OAUTH[type] && !S.cloud.remoteEdit?.authed) { toast('Erst anmelden (Schritt 1 und 2).', true); return; }
		(REMOTE_FIELDS[type] || []).forEach(([k]) => { const v = f['p_' + k]?.value.trim(); if (v) params[k] = v; });
		try {
			await CLOUD_API[scope].addRemote({ name: f.name.value.trim(), type, params, raw: type === 'raw' ? f.raw.value.trim() + '\n' : '' });
			S.cloud.remoteEdit = null; toast(`Konto „${f.name.value.trim()}“ hinzugefügt.`); loadCloud(scope);
		} catch (err) { toast('Konto: ' + err.message, true); }
	});
	$('#f-job')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, sched = f.sched.value === 'custom' ? f.cron.value.trim() : f.sched.value;
		const args = { name: f.name.value.trim(), local: f.local.value, remote: f.remote.value, remote_path: f.remote_path.value.trim(),
			mode: $('input[name=mode]:checked', f)?.value || 'upload', schedule: sched, bwlimit: f.bwlimit.value.trim(), enabled: f.enabled.checked };
		if ((args.mode === 'mirror_down' || args.mode === 'mirror_up') && !await confirmDlg('Spiegeln?', args.mode === 'mirror_down'
			? 'Beim Spiegeln von der Cloud werden auf dem NAS Dateien gelöscht, die in der Cloud fehlen.' : 'Beim Spiegeln zur Cloud werden in der Cloud Dateien gelöscht, die auf dem NAS fehlen.', 'Verstanden', true)) return;
		try { await CLOUD_API[scope].saveJob(args); S.cloud.jobEdit = null; toast(`Auftrag „${args.name}“ gespeichert.`); loadCloud(scope); }
		catch (err) { toast('Auftrag: ' + err.message, true); }
	});
}

/* ---------- media server (Services -> Media server, MiniDLNA) ------------------- */

const DLNA_TYPES = [['', 'nicht freigeben'], ['-', 'Musik, Videos und Bilder'], ['A', 'nur Musik'], ['V', 'nur Videos'], ['P', 'nur Bilder']];

async function loadDlna() {
	clearTimeout(S.dlnaTimer);
	try { S.dlna = await rpc('shareos.dlna', 'status'); } catch (e) { toast('Medienserver: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'dlna') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		if (S.dlna?.running) S.dlnaTimer = setTimeout(loadDlna, S.dlna.scanning ? 4000 : 15000);
	}
}

function dlnaView() {
	const d = S.dlna;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Medienserver …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>Der Medienserver (MiniDLNA) ist eine System-App: Fernseher, Receiver, Spielkonsolen und Apps wie VLC finden die Box dann im Netzwerk und spielen Musik, Videos und Bilder aus den Freigaben ab.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Im Store installieren (MiniDLNA)</a></div></div></div></div></section>`;
	const media = {};
	d.media.forEach((m) => { media[m.share] = m.type; });
	const host = location.hostname;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">MEDIENSERVER</span>${d.running ? html`<span class="tag ok ml">läuft</span>` : html`<span class="tag ml">aus</span>`}${d.scanning ? html` <span class="tag">liest Ordner ein …</span>` : ''}</div>
				${d.running ? html`<div class="tiles" style="margin:0">
					<div class="tile"><div class="k">MUSIKSTÜCKE</div><div class="v">${d.audio}</div></div>
					<div class="tile"><div class="k">VIDEOS</div><div class="v">${d.video}</div></div>
					<div class="tile"><div class="k">BILDER</div><div class="v">${d.image}</div></div></div>
					<p class="note"><span>Im Netzwerk als</span> <b>${d.name || d.hostname}</b> · <code>http://${host}:8200/</code></p>
					${d.clients.length ? html`<div class="pt" style="margin:12px 0 6px">GERÄTE</div><div style="display:grid;gap:4px;font-size:13px">${d.clients.map((c) => html`<div>${c.type} <span class="mut">· ${c.ip}</span></div>`)}</div>` : ''}
					<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="dlna-rescan" ${d.scanning ? 'disabled' : ''}>Alles neu einlesen</button></div>`
				: html`<p class="mut" style="margin:0;font-size:13px">Der Medienserver ist ausgeschaltet. Unten Ordner wählen und einschalten.</p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">HINWEISE</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Geräte im selben Netzwerk finden den Server von selbst (DLNA/UPnP AV), z. B. unter „Medienserver“ oder „Quellen“ am Fernseher.</span> <span>Neue Dateien erscheinen nach kurzer Zeit von selbst; nach großen Änderungen hilft „Alles neu einlesen“.</span> <span>Der Server liest nur – und zeigt alles in den gewählten Freigaben jedem Gerät im Netzwerk, ohne Anmeldung.</span> <span>Videos werden nicht umgewandelt: das Gerät muss das Format selbst abspielen können.</span></p>
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-dlna" style="max-width:820px">
		<div class="ph"><span class="pt">EINSTELLUNGEN</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Medienserver eingeschaltet (startet auch nach einem Neustart)</label>
		<div class="fields" style="margin-top:12px"><label class="f"><span>NAME IM NETZWERK</span><input name="name" value="${d.name}" maxlength="48" placeholder="${d.hostname}"></label></div>
		<div class="pt" style="margin:16px 0 8px">FREIGABEN</div>
		${d.shares.length ? html`<div class="tw"><table class="t"><thead><tr><th>FREIGABE</th><th>ZEIGEN ALS</th></tr></thead><tbody>
			${d.shares.map((n) => html`<tr><td><b>${n}</b></td><td><select class="dlna-type" data-share="${n}">${DLNA_TYPES.map(([v, t]) => html`<option value="${v}"${(media[n] || '') === v ? raw(' selected') : ''}>${t}</option>`)}</select></td></tr>`)}</tbody></table></div>`
			: html`<p class="note">Noch keine Freigabe – unter <a href="#/shares/shares">Freigaben</a> anlegen.</p>`}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button></div>
	</form></section>`;
}

/* ---------- snapshots (Storage -> Snapshots) ------------------------------------ */

const SNAP_EVERY = { hour: 'Stündlich', '6h': 'Alle 6 Stunden', day: 'Täglich', week: 'Wöchentlich (Sonntag)' };
const SNAP_KEEP = [['keep_last', 'DIE LETZTEN'], ['keep_daily', 'TAGE (JE EINER)'], ['keep_weekly', 'WOCHEN (JE EINER)'], ['keep_monthly', 'MONATE (JE EINER)']];

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
	return x.kind === 'share' ? `Freigabe ${x.name}` : x.kind === 'homes' ? `Persönliche Ordner (${x.name})` : `Ganzes Laufwerk ${x.name}`;
}
const snapSrcVol = (d, id) => { const x = (d.sources || []).find((s) => s.id === id); return x ? (x.volume || x.name) : null; };
const snapEveryTxt = (j) => (SNAP_EVERY[j.every] || j.every) + (j.every === 'day' || j.every === 'week' ? ' ' + j.time : '');
function snapKeepTxt(j) {
	const p = [];
	if (j.keep_last) p.push(`die letzten ${j.keep_last}`);
	if (j.keep_daily) p.push(`${j.keep_daily} Tage`);
	if (j.keep_weekly) p.push(`${j.keep_weekly} Wochen`);
	if (j.keep_monthly) p.push(`${j.keep_monthly} Monate`);
	// one span each: the translation sees the parts
	return p.map((x, i) => html`${i ? ' · ' : ''}<span>${x}</span>`);
}
function snapState(j) {
	const l = j.last;
	if (j.running) return html`<span class="tag">läuft</span>`;
	if (!l) return html`<span class="mut">noch nie</span>`;
	if (l.state === 'ok') return html`<span class="tag ok">OK</span> <span class="mut">${fmtTime(l.ended)}</span>`;
	if (l.state === 'stopped') return html`<span class="tag warn">abgebrochen</span> <span class="mut">${fmtTime(l.ended)}</span>`;
	return html`<span class="tag err">Fehler</span> <span class="mut">${fmtTime(l.ended)}</span>`;
}
function snapSummary(j) {
	const l = j.last;
	if (!l || j.running) return '';
	if (l.state === 'error') return html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--red)">${l.error || ''}</div>`;
	if (l.state !== 'ok') return '';
	return html`<div class="desc mut" style="margin-top:4px;font-size:12px"><span>${l.files} Dateien</span> · <span>${l.changed} geändert</span> (${fmtBytes(l.bytes)})${l.removed ? html` · <span>${l.removed} alte entfernt</span>` : ''}</div>`;
}
function snapActions(j) {
	return html`${j.running ? html`<button class="btn sm danger" type="button" data-act="sn-stop" data-name="${j.name}">Stopp</button>`
		: html`<button class="btn sm primary" type="button" data-act="sn-run" data-name="${j.name}">Jetzt sichern</button>`}
		<button class="btn sm" type="button" data-act="sn-list" data-name="${j.name}">Snapshots (${j.snapshots.length})</button>
		<button class="btn sm" type="button" data-act="sn-edit" data-name="${j.name}">Bearbeiten</button>
		<button class="btn sm" type="button" data-act="sn-log" data-name="${j.name}">Protokoll</button>
		<button class="btn sm ghost" type="button" data-act="sn-del" data-name="${j.name}">Entfernen</button>`;
}

function snapshotsView() {
	const sn = S.snap || {}, d = sn.data;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Snapshots …</span></div></div>`;
	const ed = sn.edit, open = sn.open && d.jobs.find((j) => j.name === sn.open);
	const targets = d.volumes.filter((v) => v.links);
	return html`
	<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SNAPSHOTS</span><span class="tag ml">${d.jobs.length ? d.jobs.length + ' Aufträge' : 'noch keine'}</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Ein Snapshot hält den Stand eines Ordners fest – stündlich, täglich oder wöchentlich.</span> <span>Jeder Stand sieht aus wie eine vollständige Kopie; unveränderte Dateien belegen aber keinen zusätzlichen Platz.</span> <span>So holst du eine gelöschte oder überschriebene Datei von gestern oder letzter Woche zurück: im Dateibrowser aus dem Snapshot zurückkopieren.</span></p>
				${!d.rsync ? html`<p class="note" style="color:var(--amber)">rsync fehlt in dieser Firmware.</p>` : ''}
				${!targets.length ? html`<p class="note" style="color:var(--amber)">Kein geeignetes Ziel: Snapshots brauchen ein Laufwerk mit ext4 oder Btrfs (FAT32/exFAT kennen keine Hardlinks). <a href="#/storage/volumes">Speicher einrichten</a></p>` : ''}
				${ed || !targets.length || !d.sources.length ? '' : html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="sn-new">Neuer Snapshot-Auftrag</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">HINWEISE</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Am besten auf ein anderes Laufwerk sichern (zweite Platte oder USB-Festplatte): dann schützen Snapshots auch bei einem Plattendefekt.</span> <span>Ein Spiegel (RAID 1) ersetzt keine Snapshots – er spiegelt auch jedes Löschen sofort.</span> <span>Die Snapshots liegen im Ordner</span> <code>Snapshots</code> <span>des Ziel-Laufwerks und sind nur für Administratoren sichtbar.</span> <span>Für eine Kopie außer Haus kann ein Cloud-Auftrag den Snapshot-Ordner hochladen.</span></p>
			</div>
		</div>
	</section>
	${ed ? snapEditor(d, ed) : ''}
	<section class="sec">
		${secHead('snapjobs', 'AUFTRÄGE', d.jobs.length ? d.jobs.length + ' eingerichtet' : 'noch keine')}
		${!d.jobs.length ? html`<div class="panel"><div class="empty">${svg(I.disk)}<span>Noch kein Snapshot-Auftrag. Ein Auftrag sichert eine Freigabe, die persönlichen Ordner oder ein ganzes Laufwerk nach Zeitplan.</span></div></div>`
			: isTable('snapjobs') ? html`<div class="tw"><table class="t" style="min-width:900px"><thead><tr><th>AUFTRAG</th><th>QUELLE → ZIEL</th><th>ZEITPLAN · BEHALTEN</th><th>ZULETZT</th><th></th></tr></thead>
				<tbody>${d.jobs.map((j) => html`<tr><td><b>${j.name}</b><div class="mut" style="font-size:12px">${j.snapshots.length} Snapshots</div></td>
					<td style="font-size:12px">${snapSourceTxt(d, j.source)} → ${j.target}</td>
					<td style="font-size:12px">${snapEveryTxt(j)}${j.enabled ? '' : ' · aus'}<div class="mut">${snapKeepTxt(j)}</div></td>
					<td>${snapState(j)}${snapSummary(j)}</td><td><div class="acts">${snapActions(j)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.jobs.map((j) => html`<div class="card${j.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.disk)}<span class="dot ${j.last?.state === 'error' ? 'down' : j.running ? 'warn' : 'up'}"></span></div>
				<div class="info"><div class="name">${j.name}</div>
					<div class="desc" style="font-size:12px">${snapSourceTxt(d, j.source)} → ${j.target}</div>
					<div class="desc" style="margin-top:6px">${snapEveryTxt(j)}${j.enabled ? '' : html` · <span>aus</span>`}</div>
					<div class="desc mut" style="font-size:12px">${snapKeepTxt(j)}</div>
					<div class="desc" style="margin-top:6px">${snapState(j)}</div>${snapSummary(j)}
					<div class="desc mut" style="margin-top:4px;font-size:12px"><span>${j.snapshots.length} Snapshots</span>${j.snapshots[0] ? html` · <span>neuester</span> ${fmtTime(j.snapshots[0].time)}` : ''}</div>
					<div class="acts" style="margin-top:12px">${snapActions(j)}</div></div></div>`)}</div>`}
	</section>
	${open ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">SNAPSHOTS · ${open.name}</span><button class="btn sm ghost ml" type="button" data-act="sn-listclose">Schließen</button></div>
		${!open.mounted ? html`<p class="note" style="color:var(--amber)">Das Ziel-Laufwerk ${open.target} ist nicht eingebunden.</p>` : ''}
		${open.snapshots.length ? html`<div class="tw"><table class="t"><thead><tr><th>STAND</th><th>ORDNER</th><th></th></tr></thead><tbody>
			${open.snapshots.map((x) => html`<tr><td><b>${fmtTime(x.time)}</b></td><td class="mut" style="font-size:12px">${open.target}/Snapshots/${open.name}/${x.name}</td>
				<td><div class="acts"><button class="btn sm" type="button" data-act="sn-browse" data-name="${open.name}" data-snap="${x.name}">Im Dateibrowser öffnen</button>
				<button class="btn sm ghost" type="button" data-act="sn-rm" data-name="${open.name}" data-snap="${x.name}">Löschen</button></div></td></tr>`)}</tbody></table></div>`
			: html`<p class="mut" style="margin:0;font-size:13px">Noch kein Snapshot – „Jetzt sichern“ legt den ersten an.</p>`}
		<p class="note">Zum Wiederherstellen im Dateibrowser die Datei oder den Ordner aus dem Snapshot an den alten Platz kopieren. Dateien im Snapshot nicht ändern: unveränderte Dateien teilen sich den Platz mit den anderen Snapshots.</p>
	</div></section>` : ''}
	${sn.log ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">PROTOKOLL · ${sn.log.name}</span><button class="btn sm ghost ml" type="button" data-act="sn-logclose">Schließen</button></div>
		<pre class="logbox" style="max-height:360px">${sn.log.text || '(leer)'}</pre></div></section>` : ''}`;
}

function snapEditor(d, ed) {
	const x = ed.data, srcVol = snapSrcVol(d, x.source);
	const label = (s) => s.kind === 'share' ? `Freigabe ${s.name}` : s.kind === 'homes' ? `Persönliche Ordner (${s.name})` : `Ganzes Laufwerk ${s.name}`;
	return html`<section class="sec"><form class="panel" id="f-snap" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${ed.mode === 'new' ? 'NEUER SNAPSHOT-AUFTRAG' : 'AUFTRAG ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="sn-cancel">Abbrechen</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required placeholder="fotos"${ed.mode === 'new' ? '' : raw(' readonly')}></label>
			<label class="f"><span>WAS SICHERN</span><select name="source" id="snap-src">${d.sources.map((s) => html`<option value="${s.id}"${x.source === s.id ? raw(' selected') : ''}>${label(s)}</option>`)}</select></label>
			<label class="f"><span>ZIEL-LAUFWERK</span><select name="target" id="snap-tgt">${d.volumes.map((v) => html`<option value="${v.name}"${x.target === v.name ? raw(' selected') : ''}${v.links ? '' : raw(' disabled')}>${v.name} (${v.fstype})${v.links ? '' : ' – keine Hardlinks'}</option>`)}</select></label>
			<label class="f"><span>WIE OFT</span><select name="every" id="snap-every">${Object.entries(SNAP_EVERY).map(([k, t]) => html`<option value="${k}"${x.every === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>${x.every === 'hour' ? 'MINUTE (HH:MM, NUR DIE MINUTE ZÄHLT)' : x.every === '6h' ? 'AB UHRZEIT' : 'UHRZEIT'}</span><input name="time" type="time" value="${x.time}" required></label>
		</div>
		${srcVol && srcVol === x.target ? html`<p class="note" style="color:var(--amber)">Quelle und Ziel liegen auf demselben Laufwerk: das schützt vor versehentlichem Löschen, aber nicht vor einem Plattendefekt.</p>` : ''}
		<div class="pt" style="margin:16px 0 8px">BEHALTEN</div>
		<div class="fields">${SNAP_KEEP.map(([k, t]) => html`<label class="f"><span>${t}</span><input name="${k}" type="number" min="0" max="999" value="${x[k]}"></label>`)}</div>
		<p class="note">Die letzten N Snapshots bleiben immer (auch die von Hand); dazu je der neueste eines Tages, einer Woche, eines Monats. Beispiel täglich: 7 Tage · 4 Wochen · 6 Monate ≈ ein halbes Jahr zurück mit 17 Ständen.</p>
		<label class="f" style="margin-top:12px"><span>AUSNAHMEN (EINE PRO ZEILE, Z. B. *.tmp ODER /Downloads/)</span>
			<textarea name="exclude" rows="3" spellcheck="false" data-i18n-skip style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px">${(x.exclude || []).join('\n')}</textarea></label>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>Zeitplan aktiv</label>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button></div>
	</form></section>`;
}

function dlnaAfter() {
	if (!S.dlna) { loadDlna(); return; }
	$('#f-dlna')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, media = [];
		document.querySelectorAll('.dlna-type').forEach((x) => { if (x.value) media.push({ share: x.dataset.share, type: x.value }); });
		if (f.enabled.checked && !media.length) { toast('Mindestens eine Freigabe wählen.', true); return; }
		const b = $('button[type=submit]', f); b.disabled = true;
		try { S.dlna = await rpc('shareos.dlna', 'set', { enabled: f.enabled.checked, name: f.name.value.trim(), media }); toast('Medienserver gespeichert.'); }
		catch (err) { toast('Medienserver: ' + err.message, true); }
		loadDlna();
	});
}

/* ---------- printers (Services -> Printers, system app "printer") ------------------- */

async function loadPrinter() {
	clearTimeout(S.prnTimer);
	try { S.prn = await rpc('shareos.printer', 'status'); } catch (e) { toast('Drucker: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'printer') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		// printers come and go: look again now and then
		S.prnTimer = setTimeout(loadPrinter, 10000);
	}
}

function printerView() {
	const d = S.prn;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Drucker …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>Drucker im Netzwerk sind eine System-App: Aktuelle Drucker und Multifunktionsgeräte drucken und scannen dann ohne Treiber (AirPrint, Mopria, Windows 10/11), ältere über Port 9100 mit dem Treiber am Rechner.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Im Store installieren (ipp-usb + p910nd)</a></div></div></div></div></section>`;
	const host = location.hostname;
	const card = (p) => html`<div class="panel">
		<div class="ph"><span class="pt">${(p.maker + ' ' + p.model).trim() || p.id}</span>${p.port ? html`<span class="tag ok ml">im Netzwerk</span>` : d.enabled ? html`<span class="tag warn ml">nicht erreichbar</span>` : html`<span class="tag ml">aus</span>`}</div>
		<dl class="kv">
			<dt>Art</dt><dd>${p.via === 'ipp-usb' ? 'Ohne Treiber (IPP over USB)' : 'Mit Treiber am Rechner (Port 9100)'}</dd>
			${p.via === 'ipp-usb' ? html`<dt>Scannen</dt><dd>${p.port ? 'über das Netzwerk (eSCL), wenn das Gerät einen Scanner hat' : '–'}</dd>` : ''}
			<dt>Adresse</dt><dd>${p.port ? (p.via === 'ipp-usb' ? `ipp://${host}:${p.port}/ipp/print` : `${host}:${p.port}`) : '–'}</dd>
			${p.port && p.via === 'ipp-usb' ? html`<dt>Geräteseite</dt><dd><a href="http://${host}:${p.port}/" target="_blank" rel="noopener">http://${host}:${p.port}/</a></dd>` : ''}
			<dt>USB</dt><dd>${p.id}${p.lp ? ' · ' + p.lp : ''}</dd>
		</dl>
		${p.port && p.via === 'ipp-usb' ? html`<p class="note">Windows 10/11, macOS, iPhone/iPad und Android finden den Drucker von selbst („Drucker hinzufügen“). Von Hand: Adresse oben als IPP-Drucker eintragen.</p>`
		: p.port ? html`<p class="note">Windows: „Drucker hinzufügen“ → „TCP/IP-Adresse“ → <b>${host}</b>, Port <b>${p.port}</b>, Treiber des Herstellers. macOS/Linux: „HP JetDirect – Socket“ bzw. AppSocket.</p>
			<div class="acts" style="margin-top:10px"><button class="btn" type="button" data-act="prn-test" data-id="${p.lp}">Testseite</button></div>` : ''}
	</div>`;
	return html`<section class="sec">
		${d.printers.length ? html`<div class="g2">${d.printers.map(card)}</div>`
		: html`<div class="panel"><div class="empty">${svg(I.info)}<span>Kein USB-Drucker angeschlossen. Einstecken – er erscheint hier nach ein paar Sekunden.</span></div></div>`}
	</section>
	<section class="sec"><form class="panel" id="f-prn" style="max-width:820px">
		<div class="ph"><span class="pt">EINSTELLUNGEN</span>${d.enabled ? html`<span class="tag ok ml">an</span>` : html`<span class="tag ml">aus</span>`}</div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Drucker im Netzwerk freigeben (startet auch nach einem Neustart)</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>ART</span><select name="mode">
			<option value="auto"${d.mode === 'auto' ? raw(' selected') : ''}>Automatisch – ohne Treiber, wo der Drucker es kann</option>
			<option value="raw"${d.mode === 'raw' ? raw(' selected') : ''}>Immer Port 9100 (Treiber am Rechner)</option></select></label></div>
		<p class="note">Jeder im Netzwerk kann drucken, ohne Anmeldung. „Immer Port 9100“ nur, wenn ein Drucker ohne Treiber nicht richtig druckt.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button></div>
	</form></section>`;
}

function printerAfter() {
	if (!S.prn) { loadPrinter(); return; }
	if (!S.prnTimer) S.prnTimer = setTimeout(loadPrinter, 10000);
	$('#f-prn')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, b = $('button[type=submit]', f); b.disabled = true;
		try { S.prn = await rpc('shareos.printer', 'set', { enabled: f.enabled.checked, mode: f.mode.value }); toast('Drucker gespeichert.'); }
		catch (err) { toast('Drucker: ' + err.message, true); }
		loadPrinter();
	});
}

/* ---------- UPS (Services -> UPS, system app "nut") ------------------- */

const UPS_EVENTS = { ONBATT: 'Stromausfall – läuft über die USV', ONLINE: 'Strom wieder da', LOWBATT: 'Akku fast leer', FSD: 'Herunterfahren ausgelöst', SHUTDOWN: 'Box fährt herunter', COMMBAD: 'Verbindung zur USV verloren', NOCOMM: 'Keine Verbindung zur USV', COMMOK: 'Verbindung zur USV wieder da', REPLBATT: 'Akku tauschen' };

async function loadUps() {
	clearTimeout(S.upsTimer);
	try { S.ups = await rpc('shareos.ups', 'status'); } catch (e) { toast('USV: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'ups') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		S.upsTimer = setTimeout(loadUps, S.ups?.running ? 5000 : 15000);
	}
}

function upsView() {
	const d = S.ups;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade USV …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>Die USV-Unterstützung ist eine System-App: Die Box zeigt dann Akkustand und Restlaufzeit, meldet einen Stromausfall und fährt rechtzeitig sauber herunter.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Im Store installieren (Network UPS Tools)</a></div></div></div></div></section>`;
	const st = (d.status || '').split(' ');
	const ob = st.includes('OB'), lb = st.includes('LB');
	const s = d.settings, mode = s.shutdown;
	const host = location.hostname;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">USV</span>${!d.running ? html`<span class="tag ml">aus</span>` : lb ? html`<span class="tag err ml">Akku fast leer</span>` : ob ? html`<span class="tag warn ml">läuft über Akku</span>` : d.status ? html`<span class="tag ok ml">am Netz</span>` : html`<span class="tag warn ml">keine Daten</span>`}</div>
				${d.running && d.status ? html`<div class="tiles" style="margin:0">
					<div class="tile"><div class="k">AKKU</div><div class="v">${d.charge != null ? d.charge + ' %' : '–'}</div></div>
					<div class="tile"><div class="k">RESTLAUFZEIT</div><div class="v">${d.runtime != null ? Math.round(d.runtime / 60) + ' min' : '–'}</div></div>
					<div class="tile"><div class="k">LAST</div><div class="v">${d.load != null ? d.load + ' %' : '–'}</div></div></div>
					<dl class="kv" style="margin-top:12px">
						<dt>Gerät</dt><dd>${[d.mfr, d.model].filter(Boolean).join(' ') || '–'}</dd>
						${d.voltage != null ? html`<dt>Netzspannung</dt><dd>${d.voltage} V</dd>` : ''}
						${d.battery_date ? html`<dt>Akku seit</dt><dd>${d.battery_date}</dd>` : ''}
						<dt>Treiber</dt><dd>${d.driver || '–'}</dd>
					</dl>`
				: d.running ? html`<p class="mut" style="margin:0;font-size:13px">Verbinde mit der USV …</p>`
				: html`<p class="mut" style="margin:0;font-size:13px">${d.detected ? html`<span>Erkannt:</span> <code>${d.detected}</code>. ` : ''}<span>Unten einschalten.</span></p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">EREIGNISSE</span></div>
				${d.events.length ? html`<div style="display:grid;gap:6px;font-size:13px">${d.events.map((e) => html`<div><span class="mut">${fmtTime(e.time)}</span> · ${UPS_EVENTS[e.type] || e.type}</div>`)}</div>`
				: html`<p class="mut" style="margin:0;font-size:13px">Noch keine – ein Stromausfall wird hier und als Meldung angezeigt.</p>`}
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-ups" style="max-width:820px">
		<div class="ph"><span class="pt">EINSTELLUNGEN</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>USV überwachen (startet auch nach einem Neustart)</label>
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>HERUNTERFAHREN</span><select name="shutdown" id="ups-mode">
				<option value="low"${mode === 'low' ? raw(' selected') : ''}>Wenn die USV „Akku fast leer“ meldet</option>
				<option value="percent"${mode === 'percent' ? raw(' selected') : ''}>Unter einem Akkustand</option>
				<option value="minutes"${mode === 'minutes' ? raw(' selected') : ''}>Nach einer Zeit auf Akku</option></select></label>
			<label class="f" id="ups-pct"${mode === 'percent' ? '' : raw(' hidden')}><span>AKKUSTAND (%)</span><input name="percent" type="number" min="10" max="90" value="${s.percent}"></label>
			<label class="f" id="ups-min"${mode === 'minutes' ? '' : raw(' hidden')}><span>MINUTEN AUF AKKU</span><input name="minutes" type="number" min="1" max="120" value="${s.minutes}"></label>
			<label class="f"><span>TREIBER</span><select name="driver">${[['auto', 'Automatisch'], ['usbhid-ups', 'usbhid-ups (APC, Eaton, CyberPower …)'], ['nutdrv_qx', 'nutdrv_qx (Megatec/Q1)'], ['blazer_usb', 'blazer_usb (ältere Megatec)']].map(([v, t]) => html`<option value="${v}"${s.driver === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
		</div>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="killpower"${s.killpower ? raw(' checked') : ''}>Danach die USV ausschalten – die Box startet wieder, wenn der Strom zurück ist</label>
		<label class="chk" style="margin-top:8px"><input type="checkbox" name="server" id="ups-server"${s.server ? raw(' checked') : ''}>Andere Rechner dürfen die USV über das Netzwerk lesen (Port 3493)</label>
		<div class="fields" id="ups-net"${s.server ? '' : raw(' hidden')} style="margin-top:10px">
			<label class="f"><span>PASSWORT FÜR „MONITOR“</span>${s.password_set ? html`<input name="password" type="password" placeholder="gespeichert – leer lassen behält es" autocomplete="new-password">` : html`<input name="password" type="password" autocomplete="new-password">`}</label>
		</div>
		${s.server ? html`<p class="note"><span>Auf dem anderen Rechner (NUT, upsmon):</span> <code data-i18n-skip>MONITOR ups@${host} 1 monitor ••• secondary</code> <span>– er fährt dann vor der Box herunter.</span></p>` : ''}
		<p class="note">Die Box fährt nur herunter, solange sie über Akku läuft. Kommt der Strom vorher zurück, passiert nichts.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button></div>
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
		try { S.ups = await rpc('shareos.ups', 'set', v); toast('USV gespeichert.'); }
		catch (err) { toast('USV: ' + err.message, true); }
		loadUps();
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
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'job_set', a)).jobs; S.snap.edit = null; toast(`Auftrag „${a.name}“ gespeichert.`); loadSnapshots(); }
		catch (err) { toast('Snapshots: ' + err.message, true); }
	});
}

/* ---------- "Mein ShareOS" for plain users ------------------------------------ */

function userTabs() {
	return [['me', 'MEIN SHAREOS'], ...(S.me?.files ? [['files', 'DATEIEN']] : []), ...((S.me?.apps || []).length ? [['apps', 'APPS']] : []), ['settings', 'EINSTELLUNGEN']];
}

function parseUserRoute() {
	let [t, id] = routeParts();
	if (t === 'appearance') { t = 'settings'; history.replaceState(null, '', '#/settings'); }   // old address (before 0.2.0-beta.11)
	S.utab = t === 'app' && id ? 'app' : userTabs().some((x) => x[0] === t) ? t : 'me';
	S.uapp = S.utab === 'app' ? id : null;
	if (S.utab !== 'app') S.appPage = null;
}

function renderUserTabs() {
	$('#tabs').innerHTML = userTabs().map(([id, label]) =>
		html`<a class="tab${S.utab === id ? ' on' : ''}" href="#/${id}"${S.utab === id ? raw(' aria-current="page"') : ''}><span class="tl">${label}</span></a>`.s).join('');
}

function renderUserShell() {
	$('#root').innerHTML = html`
		<header class="hd" id="hd"></header>
		<nav class="tabs" id="tabs" aria-label="Hauptmenü"></nav>
		<main id="main"></main>
		<footer class="ft" id="ft"></footer>`.s;
	parseUserRoute();
	renderUserHeader();
	renderUserTabs();
	renderUserMain();
	startChips();
}

function userLookView() {
	const names = { green: 'Grün', red: 'Rot', blue: 'Blau', white: 'Weiß' };
	const own = S.me.ui || {}, sys = S.sysLook || {};
	const themeTxt = { dark: 'Dunkel', light: 'Hell', system: 'Wie das Betriebssystem (automatisch)' };
	return html`<section class="sec"><h2 class="gh">EINSTELLUNGEN <span>${S.me.name}</span></h2><div class="g2"><div class="panel">
		<div class="ph"><span class="pt">DARSTELLUNG</span><span class="tag ml">nur für dich</span></div>
		<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>HELL ODER DUNKEL</span><select id="opt-utheme">
			<option value=""${!own.theme ? raw(' selected') : ''}>Wie für alle (${themeTxt[sys.theme] || '–'})</option>
			${Object.entries(themeTxt).map(([v, t]) => html`<option value="${v}"${own.theme === v ? raw(' selected') : ''}>${t}</option>`)}
		</select></label></div>
		<div class="pt" style="margin:14px 0 8px">AKZENTFARBE</div>
		<div class="row">${Object.keys(names).map((c) => html`<button class="sw c-${c}${S.accent === c ? ' on' : ''}" type="button" data-act="accent" data-c="${c}" aria-label="Akzentfarbe ${names[c]}" aria-pressed="${S.accent === c}" title="${names[c]}"><i></i></button>`)}</div>
		<p class="note">Gilt nur für deine Anmeldung, auf jedem Gerät. Logo und Browser-Symbol nehmen die Akzentfarbe an.</p>
		<div style="display:grid;gap:6px;margin-top:14px">
			<label class="chk"><input type="checkbox" id="opt-uscan"${S.scan ? raw(' checked') : ''}>Scanlines (nur in diesem Browser)</label>
			${favBarOpt()}
		</div>
		${own.theme || own.accent ? html`<div class="acts" style="margin-top:14px"><button class="btn ghost" type="button" data-act="look-reset">Wie für alle</button></div>` : ''}
	</div>
	<form class="panel" id="f-mypass" style="align-self:start">
		<div class="ph"><span class="pt">PASSWORT ÄNDERN</span></div>
		<div class="fields" style="grid-template-columns:1fr">
			<label class="f"><span>AKTUELLES PASSWORT</span><input name="old" type="password" autocomplete="current-password" required></label>
			<label class="f"><span>NEUES PASSWORT</span><input name="p1" type="password" minlength="6" autocomplete="new-password" required></label>
			<label class="f"><span>WIEDERHOLEN</span><input name="p2" type="password" minlength="6" autocomplete="new-password" required></label>
		</div>
		<p class="note">Gilt für die Freigaben und diese Oberfläche.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Passwort ändern</button></div>
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
				<button class="ib" type="button" data-act="theme" aria-label="Hell/Dunkel umschalten" title="Hell/Dunkel umschalten">${svg(I.moon)}</button>
				<button class="ib" type="button" data-act="logout" aria-label="Abmelden" title="Abmelden">${svg(I.power)}</button>
			</div>
			<div class="clock">${now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })}</div>
			<div class="meta">${now.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
		</div>`.s;
	fitChips();
	$('#ft').innerHTML = html`<span><b>ShareOS</b> · Mein ShareOS</span><span><a href="https://github.com/UniqueDroid/ShareOS" target="_blank" rel="noopener">github.com/UniqueDroid/ShareOS</a></span>`.s;
}

async function loadMyPaperless() {
	try { S.myPl = await rpc('shareos.me', 'paperless'); } catch (e) { S.myPl = { available: false }; }
	if (S.me && S.me.role !== 'admin' && !document.activeElement?.matches('input,select,textarea')) renderUserMain();
}

function myPaperless() {
	const p = S.myPl;
	if (!p) return html`<section class="sec"><div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div></section>`;
	if (!p.available) return '';
	const ib = p.inbox;
	return html`<section class="sec"><h2 class="gh">PAPERLESS <span>${p.url}</span></h2>
		<div class="g2">
			<form class="panel" id="f-mypl">
				<div class="ph"><span class="pt">MEIN EINGANG</span>${ib ? html`<span class="tag ml ${ib.enabled ? 'ok' : ''}">${ib.enabled ? 'aktiv' : 'aus'}</span>` : ''}</div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>MEIN API-TOKEN AUS PAPERLESS${ib ? ' (LEER = BEHALTEN)' : ''}</span><input name="token" type="password" autocomplete="off" placeholder="${ib?.token_hint || 'Paperless → Profil → API-Token'}"></label></div>
				<label class="chk" style="margin-top:10px"><input type="checkbox" name="enabled"${!ib || ib.enabled ? raw(' checked') : ''}>Dateien aus meinem Eingang übertragen</label>
				<dl class="kv" style="margin-top:12px"><dt>Eingangsordner</dt><dd><code>${p.folder}</code></dd></dl>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit" value="save">Speichern</button><button class="btn" type="submit" value="test">Verbindung prüfen</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">ZULETZT ÜBERTRAGEN</span>${ib?.waiting ? html`<span class="tag ml warn">${ib.waiting} wartend</span>` : ''}</div>
				${ib?.recent?.length ? html`<div style="display:grid;gap:6px">${ib.recent.map((x) => html`<div style="font-size:13px">${plStateTag(x)} ${x.file} <span class="mut" style="font-size:12px">${fmtTime(x.time)}</span></div>`)}</div>`
					: html`<p class="mut" style="margin:0;font-size:13px">Noch nichts übertragen. Dateien in den Eingangsordner legen – sie landen nach wenigen Minuten in Paperless.</p>`}
			</div>
		</div></section>`;
}

function renderUserMain() {
	const main = $('#main');
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
			if (f.p1.value !== f.p2.value) { toast('Die Passwörter stimmen nicht überein.', true); return; }
			try { await rpc('shareos.me', 'passwd', { old: f.old.value, password: f.p1.value }); f.reset(); toast('Passwort geändert.'); }
			catch (err) { toast('Passwort: ' + err.message, true); }
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

// "SPEICHER" of Mein ShareOS: one row per drive of the personal folder and the
// shares – what lies there, own use and limit (quota), free space of the drive
function myStorage(m, host, ip) {
	const vols = m.volumes || [], use = Object.fromEntries((m.usage || []).map((x) => [x.volume, x]));
	const on = (v) => [...(m.home?.volume === v ? ['Persönlicher Ordner'] : []), ...(m.shares || []).filter((x) => x.volume === v).map((x) => x.name)];
	const paths = m.home ? html`<dl class="kv" style="margin-top:12px">
		<dt>Persönlicher Ordner</dt><dd><code>\\\\${host}\\${m.name}</code></dd>
		<dt>macOS / Linux</dt><dd><code>smb://${ip}/${m.name}</code></dd></dl>` : html`<p class="note">Kein persönlicher Ordner eingerichtet.</p>`;
	const head = html`<div class="ph"><span class="pt">SPEICHER</span>${m.quota ? html`<span class="tag ml">Limit ${fmtMB(m.quota)} je Laufwerk</span>` : html`<span class="tag ml">kein Limit</span>`}</div>`;
	if (!vols.length) return html`<div class="panel">${head}<p class="mut" style="margin:0;font-size:13px">Kein Laufwerk für dich eingehängt.</p>${paths}</div>`;
	return html`<div class="panel">${head}
		<div class="tw"><table class="t" style="min-width:680px"><thead><tr><th>LAUFWERK</th><th>ENTHÄLT</th><th class="r">MEIN VERBRAUCH</th><th class="r">LIMIT</th><th style="width:28%">BELEGUNG</th><th class="r">FREI</th></tr></thead>
		<tbody>${vols.map((v) => {
			const u = use[v.name], lim = u?.limit || 0;
			const p = lim ? pct(u.used, lim) : pct(v.used, v.size);
			return html`<tr><td><b>${v.name}</b></td><td class="mut">${on(v.name).length ? on(v.name).map((x, i) => html`${i ? ', ' : ''}<span>${x}</span>`) : '–'}</td>
				<td class="r">${u ? fmtBytes(u.used) : '–'}</td><td class="r mut">${lim ? fmtBytes(lim) : '–'}</td>
				<td><div class="bar"><i class="${p > 95 ? 'crit' : p > 85 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>
					<div class="mut" style="font-size:11px;margin-top:3px">${lim ? html`${p.toFixed(0)} % von meinem Limit` : html`Laufwerk ${p.toFixed(0)} % belegt`}</div></td>
				<td class="r">${fmtBytes(v.avail)}</td></tr>`;
		})}</tbody></table></div>
		${paths}</div>`;
}

// "APPS" of Mein ShareOS: all apps of the user; the star puts one into "FAV APPS" on the start page
function userAppsView() {
	const m = S.me || {}, apps = m.apps || [];
	return html`<section class="sec">
		<h2 class="gh">MEINE APPS <span>${apps.length}</span></h2>
		<div class="grid">${apps.map((a) => html`<div class="favwrap"><a class="card applink" href="${appHref(a, m.apps_server)}" data-act="app-launch" data-id="${a.id}">
			<div class="icon">${appIcon(a, m.apps_server)}</div>
			<div class="info"><div class="name">${a.name}${appMode(a) === 'page' ? '' : ' ↗'}</div><div class="desc">${txtOf(a.description)}</div></div></a>${favStar(a)}</div>`)}</div>
		<p class="note">Mit dem Stern wird eine App zum Favoriten – Favoriten stehen oben auf „Mein ShareOS“.</p>
	</section>`;
}

function renderUserHome() {
	const m = S.me || {}, host = m.host || location.hostname, ip = location.hostname;
	$('#main').innerHTML = html`
	${favBar(m.apps || [], m.apps_server)}
	<section class="sec">
		<h2 class="gh">MEIN SHAREOS <span>${m.name}</span></h2>
		${myStorage(m, host, ip)}
	</section>
	<section class="sec">
		<h2 class="gh">MEINE FREIGABEN <span>${(m.shares || []).length}</span></h2>
		${(m.shares || []).length ? html`<div class="grid">${m.shares.map((x) => html`<div class="card">
			<div class="icon">${svg(I.folder)}<span class="dot up"></span></div>
			<div class="info"><div class="name">${x.name}</div><div class="desc">${x.comment || ''}</div>
				<div class="desc" style="margin-top:6px"><span class="tag ${x.access === 'rw' ? 'ok' : ''}">${ACCESS_TXT[x.access]}</span></div>
				<div class="ip">\\\\${host}\\${x.name}</div></div></div>`)}</div>`
			: html`<div class="panel"><div class="empty">${svg(I.info)}<span>Dir wurde noch keine Freigabe zugewiesen.</span></div></div>`}
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
			if (test) toast(`Verbindung in Ordnung – ${r.documents} Dokumente in Paperless.`);
			else { toast('Paperless-Eingang gespeichert.'); S.myPl = null; loadMyPaperless(); }
		} catch (err) { toast('Paperless: ' + err.message, true); }
	});
}

/* ---------- storage (Speicher) ---------------------------------------------- */

const LAYOUT_TXT = { mirror: 'Spiegel (RAID 1)', stripe: 'RAID 0', span: 'JBOD', single: 'Einzelnes Laufwerk' };
// layouts with one volume over both disks
const pairLayout = (l) => l === 'mirror' || l === 'stripe' || l === 'span';
// file systems: label and what the choice means
const FS_DISK = [['ext4', 'ext4 – empfohlen', 'Alle Funktionen: Rechte je Benutzer, Speicherlimit, persönliche Ordner, Apps.'],
	['btrfs', 'Btrfs', 'Rechte je Benutzer, persönliche Ordner, Apps; kein Speicherlimit je Benutzer. Braucht mehr Arbeitsspeicher.'],
	['exfat', 'exFAT', 'Auch an Windows und macOS lesbar. Keine Rechte je Benutzer (wer eine Freigabe schreiben darf, darf alles darin), kein Speicherlimit, keine persönlichen Ordner, keine Apps.'],
	['ntfs', 'NTFS', 'Auch an Windows lesbar. Keine Rechte je Benutzer, kein Speicherlimit, keine persönlichen Ordner, keine Apps.'],
	['ext3', 'ext3', 'Älteres Linux-Dateisystem (z. B. von Alt-F gewohnt): Rechte je Benutzer, persönliche Ordner, Apps; kein Speicherlimit.'],
	['ext2', 'ext2', 'Ohne Journal – nach Stromausfall lange Prüfung. Nur wenn ein altes Gerät es braucht.'],
	['vfat', 'FAT32', 'Für sehr alte Geräte. Dateien höchstens 4 GB, keine Rechte je Benutzer, kein Speicherlimit, keine persönlichen Ordner, keine Apps.']];
const FS_USB = [['exfat', 'exFAT – empfohlen', 'Windows, macOS, Linux, Fernseher; Dateien über 4 GB.'],
	['vfat', 'FAT32', 'Für ältere Geräte (Autoradio, Kamera); Dateien höchstens 4 GB.'],
	['ntfs', 'NTFS', 'Für Windows-Rechner.'],
	['ext4', 'ext4', 'Für Linux und Sicherungen mit Rechten.']];
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
				<label class="f"><span>DATEISYSTEM</span>${fsSelect(list, fs, 'fs-sel')}</label></div>
			${fsNote(list, fs)}
			<div class="acts" style="margin-top:16px"><button class="btn ghost" type="button" value="no">Abbrechen</button>
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
const SPINDOWN = [[0, 'nie'], [10, '10 Minuten'], [20, '20 Minuten'], [30, '30 Minuten'], [60, '1 Stunde'], [120, '2 Stunden']];

function arrayOf(st, dev) {
	const name = (dev || '').replace('/dev/', '');
	return st?.arrays?.[name] || null;
}

function diskUse(st, d) {
	// what is on a disk: ShareOS volume / RAID member / foreign file system / empty
	const parts = d.children || [];
	if (!parts.length && !d.fstype) return { empty: true, txt: 'leer' };
	const txt = parts.map((p) => {
		if (p.fstype === 'linux_raid_member') {
			const md = (p.children || [])[0];
			return `RAID-Mitglied${md ? ' von ' + md.name : ''}${p.label ? ' (' + p.label.replace(/^.*:/, '') + ')' : ''}`;
		}
		return [p.name, p.fstype || 'ohne Dateisystem', p.label, p.mountpoint ? '→ ' + p.mountpoint : ''].filter(Boolean).join(' · ');
	});
	return { empty: false, txt: txt.join(' | ') || d.fstype };
}

function smartLine(sm) {
	if (!sm) return html`<span class="mut">SMART noch nicht gelesen</span>`;
	if (sm.standby) return html`<span class="mut">schläft (SMART beim nächsten Aufwachen)</span>`;
	if (sm.error) return html`<span class="mut">${sm.error}</span>`;
	const r = smartRating(sm);
	return html`<a class="tag ${SMART_RATING[r][0]}" href="#/storage/health" title="Gesundheit">SMART <span>${SMART_RATING[r][1]}</span></a>
		${sm.temperature != null ? html` · <span>${sm.temperature} °C</span>` : ''}
		${sm.power_on_hours != null ? html` · <span>${Math.round(sm.power_on_hours / 24)} Tage Laufzeit</span>` : ''}
		${sm.life_left != null ? html` · <span>SSD noch ${sm.life_left} %</span>` : ''}
		${sm.test_running ? html` · <span>Selbsttest läuft</span>` : ''}`;
}

// small "x" that hides a message for good (the box forgets it)
const closeX = (act) => html`<button class="bx" type="button" data-act="${act}" title="Schließen" aria-label="Schließen">${svg(I.x)}</button>`;

// USB button: copy the USB drives into a folder on a drive (short press)
const USB_COPY_ERR = { 'no USB drive': 'Kein USB-Laufwerk eingesteckt.', 'not enough space': 'Zu wenig Platz auf dem Ziel – nichts kopiert.',
	'target drive not mounted': 'Das Ziellaufwerk ist nicht eingehängt.', 'no target set': 'Kein Ziel eingestellt.' };
function usbCopyPanel(st) {
	const u = st.usb_copy || { enabled: false, volume: '', path: 'USB-Kopien' }, last = u.last;
	return html`<form class="panel" id="f-usbcopy">
		<div class="ph"><span class="pt">USB-TASTE</span>${u.enabled ? html`<span class="tag ml ok">kopiert</span>` : ''}</div>
		<label class="chk"><input type="checkbox" name="enabled"${u.enabled ? raw(' checked') : ''}>Kurz drücken kopiert die USB-Laufwerke, 3 s halten wirft sie aus</label>
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>ZIEL-LAUFWERK</span><select name="volume">
				<option value="">–</option>
				${(st.volumes || []).map((v) => html`<option value="${v.name}"${u.volume === v.name ? raw(' selected') : ''}>${v.name}</option>`)}
			</select></label>
			<label class="f"><span>ORDNER</span><input name="path" value="${u.path}" maxlength="200"></label>
		</div>
		<p class="note">Jedes Mal ein neuer Ordner mit Datum, z. B. <code>${u.volume || 'daten'}/${u.path}/2026-10-25_1430-STICK</code> – auf der Box wird nichts überschrieben oder gelöscht. Die USB-Lampe blinkt beim Kopieren; das Ergebnis kommt als Meldung. Ohne Häkchen wirft die Taste wie bisher nur aus.</p>
		${last ? html`<p class="note">Zuletzt: ${last.state === 'running' ? html`<b>läuft …</b>` : last.state === 'done' ? html`<span class="tag ok">OK</span> ${fmtTime(last.time)} · ${last.files} Dateien · ${fmtBytes(last.bytes || 0)}` : html`<span class="tag err">FEHLER</span> ${USB_COPY_ERR[last.error] || last.error}`}</p>` : ''}
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button>
			<button class="btn" type="button" data-act="usb-copy" ${u.volume && (st.usb || []).length && last?.state !== 'running' ? '' : 'disabled'}>Jetzt kopieren</button></div>
	</form>`;
}

function storageView() {
	const st = S.storage, i = S.info || {};
	if (!st) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Laufwerke …</span></div></div>`;
	const job = st.job;
	const running = job?.state === 'running';
	return html`
	${running ? html`<div class="banner" style="border-color:var(--dim)"><div class="spin" style="margin:0;width:20px;height:20px"></div><span><b>Einrichtung läuft</b> – ${job.step || ''}. Box nicht ausschalten.</span></div>` : ''}
	${job?.state === 'error' ? html`<div class="banner">${svg(I.warn)}<span style="flex:1"><b>Einrichtung fehlgeschlagen:</b> ${job.error}</span>${closeX('job-clear')}</div>` : ''}
	${S.wiz ? wizardView(st) : ''}
	<section class="sec">
		${secHead('volumes', 'VOLUMES', st.volumes.length ? st.volumes.length + ' eingerichtet' : 'noch keine')}
		${st.volumes.length ? (isTable('volumes') ? volumeTable(st, running) : html`<div class="grid">${st.volumes.map((v) => volumeCard(st, v, running))}</div>`)
			: html`<div class="panel"><div class="empty">${svg(I.info)}<div><span>Noch kein Speicher eingerichtet. Der Assistent richtet die Platten in wenigen Schritten ein – als Spiegel (beide Platten mit denselben Daten) oder als getrennte Laufwerke.</span>
				<div class="acts" style="margin-top:12px">${S.wiz ? '' : html`<button class="btn primary" type="button" data-act="wiz-start" ${running || !st.disks.length ? 'disabled' : ''}>Speicher einrichten</button>`}</div></div></div></div>`}
	</section>
	<section class="sec">
		${secHead('stdisks', 'LAUFWERKE', `${st.disks.length} erkannt`)}
		${st.disks.length ? (isTable('stdisks') ? diskTable(st, running) : html`<div class="grid">${st.disks.map((d) => diskCard(st, d, running))}</div>`) : diskCards(i)}
	</section>
	<section class="sec">
		<h2 class="gh">EINSTELLUNGEN</h2>
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">RUHEZUSTAND</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>PLATTEN ABSCHALTEN NACH</span><select id="spindown">
					${SPINDOWN.map(([m, t]) => html`<option value="${m}"${st.spindown === m ? raw(' selected') : ''}>${t}</option>`)}
					${SPINDOWN.some(([m]) => m === st.spindown) ? '' : html`<option value="${st.spindown}" selected>${st.spindown} Minuten</option>`}
				</select></label></div>
				<p class="note">Spart Strom und schont die Platten. Beim ersten Zugriff laufen sie wieder an (einige Sekunden).</p>
				<dl class="kv" style="margin-top:14px">
					<dt>Swap</dt><dd>${(st.swaps || []).length ? (st.swaps.map((x) => x.device.replace('/dev/', '')).join(', ') + ' · ' + fmtBytes(st.swaps.reduce((a, x) => a + x.used, 0)) + ' von ' + fmtBytes(st.swaps.reduce((a, x) => a + x.size, 0)) + ' belegt') : 'keiner aktiv'}</dd>
					<dt>Apps-Bereich</dt><dd>${st.apps ? '/mnt/' + st.apps + '/.shareos' : 'noch keiner'}</dd>
				</dl>
			</div>
			${usbCopyPanel(st)}
			<div class="panel">
				<div class="ph"><span class="pt">NEU EINRICHTEN</span></div>
				<p class="mut" style="margin:0 0 12px;font-size:13px">Der Assistent löscht die ausgewählten Platten und richtet sie neu ein. Einzelne Platten lassen sich auch direkt an der Platte unter „Laufwerke“ formatieren. Platten mit Daten (z. B. von Alt-F oder der D-Link-Firmware) bindet „… übernehmen“ an der Platte ohne Löschen ein.</p>
				<button class="btn" type="button" data-act="wiz-start" ${running || !st.disks.length || S.wiz ? 'disabled' : ''}>Assistent starten</button>
			</div>
		</div>
	</section>
	<section class="sec">
		<h2 class="gh">INTERNER FLASH <span>128 MB NAND · UBI</span></h2>
		<div class="tw"><table class="t" style="min-width:560px">
			<thead><tr><th>BEREICH</th><th>EINGEHÄNGT</th><th>BELEGT</th><th style="width:30%">AUSLASTUNG</th></tr></thead>
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
	return html`${repair ? html`<button class="btn sm primary" type="button" data-act="vol-repair" data-name="${v.name}" ${running ? 'disabled' : ''}>Spiegel reparieren</button>` : ''}${v.mounted ? html`<button class="btn sm" type="button" data-act="vol" data-name="${v.name}" data-op="umount" ${running ? 'disabled' : ''}>Aushängen</button>`
			: html`<button class="btn sm" type="button" data-act="vol" data-name="${v.name}" data-op="mount" ${running || !v.device ? 'disabled' : ''}>Einhängen</button>`}
		<button class="btn sm ghost" type="button" data-act="vol" data-name="${v.name}" data-op="forget" ${running ? 'disabled' : ''}>Entfernen</button>`;
}

function volumeTable(st, running) {
	return html`<div class="tw"><table class="t" style="min-width:760px"><thead><tr><th>NAME</th><th>AUFBAU</th><th>BELEGT</th><th style="width:18%">AUSLASTUNG</th><th>ZUSTAND</th><th></th></tr></thead>
		<tbody>${st.volumes.map((v) => {
			const md = arrayOf(st, v.device), degraded = md && md.health && md.health.includes('_'), p = pct(v.used, v.size);
			return html`<tr>
				<td><b>${v.name}</b>${S.storage?.apps === v.name ? html` <span class="tag">APPS</span>` : ''}<div class="mut" style="font-size:12px">${v.mountpoint}</div></td>
				<td>${LAYOUT_TXT[v.layout] || v.layout || ''} · ${FS_NAME[v.fstype] || v.fstype || 'ext4'}${md ? html`<div class="mut" style="font-size:12px">${md.name} · ${md.health || '?'}</div>` : ''}</td>
				<td>${v.mounted ? html`${fmtBytes(v.used)} / ${fmtBytes(v.size)}` : '–'}</td>
				<td>${v.mounted ? html`<div class="bar"><i class="${p > 90 ? 'crit' : p > 80 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}</td>
				<td>${!v.mounted ? html`<span class="tag err">nicht eingehängt</span>` : degraded ? html`<span class="tag warn">eine Platte fehlt</span>`
					: md?.sync ? html`<span class="tag warn">Sync ${md.sync.delayed ? 'wartet' : md.sync.percent.toFixed(1) + ' %'}</span>` : html`<span class="tag ok">in Ordnung</span>`}</td>
				<td><div class="acts">${volActions(v, running)}</div></td></tr>`;
		})}</tbody></table></div>`;
}

/* --- disk health (SMART): rating, values, self-tests, all attributes --- */

const SMART_RATING = { good: ['ok', 'GUT'], warn: ['warn', 'ACHTUNG'], bad: ['err', 'KRITISCH'] };
// reasons of the rating (rpcd smart_assess) as text
function smartReason(sm, r) {
	const m = /^attr_(now|past):(.+)$/.exec(r);
	if (m) return m[1] === 'now' ? `Wert ${m[2]} unter der Schwelle des Herstellers` : `Wert ${m[2]} war früher unter der Schwelle`;
	return {
		failed: 'Die Platte meldet selbst: Ausfall droht (SMART-Gesamtbewertung FEHLER).',
		test_failed: 'Der letzte Selbsttest ist fehlgeschlagen.',
		reallocated: `${sm.reallocated} Sektoren wurden schon ersetzt (umgelagert).`,
		pending: `${sm.pending} Sektoren sind unsicher (schwebend) – sie werden beim nächsten Schreiben geprüft.`,
		uncorrectable: `${sm.uncorrectable} Sektoren waren nicht lesbar.`,
		crc: `${sm.crc_errors} Übertragungsfehler (CRC) – meist Anschluss oder Kabel, nicht die Platte selbst.`,
		errors: `${sm.error_count} Einträge im Fehlerprotokoll der Platte.`,
		worn: `Die SSD ist fast verbraucht: noch ${sm.life_left} % Lebensdauer.`,
		wearing: `Die SSD nutzt sich ab: noch ${sm.life_left} % Lebensdauer.`,
		hot: `Sehr warm: ${sm.temperature} °C.`,
		warm: `Warm: ${sm.temperature} °C.`
	}[r] || r;
}
// values without a rating (cached by an older firmware) get one here
function smartRating(sm) {
	if (sm.rating) return sm.rating;
	return sm.passed === false ? 'bad' : (sm.reallocated || sm.pending || sm.uncorrectable) ? 'warn' : 'good';
}
const fmtHours = (h) => (h >= 24 * 365 ? `${(h / 24 / 365).toLocaleString(LOC, { maximumFractionDigits: 1 })} Jahre` : `${Math.round(h / 24)} Tage`);
const fmtTestMin = (m) => (m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`);

function healthCard(d) {
	const sm = d.smart, open = S.hOpen?.has(d.name), bay = !d.usb && d.tran !== 'usb';
	const head = html`<div class="ph"><span class="pt">${bay ? 'SCHACHT' : 'USB'} · ${d.name}</span>
		${d.standby != null ? html`<span class="tag ml">${d.standby ? 'SCHLÄFT' : 'AKTIV'}</span>` : ''}
		${sm && !sm.standby && !sm.error ? html`<span class="tag ${d.standby != null ? '' : 'ml'} ${SMART_RATING[smartRating(sm)][0]}">${SMART_RATING[smartRating(sm)][1]}</span>` : ''}</div>
		<div class="mut" style="font-size:13px;margin:-4px 0 12px"><span>${d.model || sm?.model || 'unbekanntes Modell'}</span> · ${fmtBytes(d.size)}${sm?.ssd ? ' · SSD' : sm?.rpm ? html` · <span>${sm.rpm} U/min</span>` : ''}${(sm?.serial || d.serial) ? ' · ' + (sm?.serial || d.serial) : ''}${sm?.firmware ? ' · ' + sm.firmware : ''}</div>`;
	const read = html`<button class="btn sm" type="button" data-act="smart" data-disk="${d.name}">${sm ? 'Neu lesen' : 'Jetzt lesen'}</button>`;
	if (!sm || sm.standby || sm.error) return html`<div class="panel">${head}
		<p class="mut" style="margin:0 0 12px;font-size:13px">${!sm ? 'SMART noch nicht gelesen. Beim Lesen wacht die Platte auf.' : sm.standby ? 'Die Platte schläft – die Werte kommen beim nächsten Aufwachen.' : bay ? 'Diese Platte liefert keine SMART-Werte.' : 'Dieser USB-Adapter reicht keine SMART-Werte weiter.'}</p>
		<div class="acts">${read}</div></div>`;
	const rating = smartRating(sm), reasons = sm.reasons || [];
	const kv = [
		['Temperatur', sm.temperature == null ? null : sm.temperature_max != null ? `${sm.temperature} °C (höchste: ${sm.temperature_max} °C)` : `${sm.temperature} °C`],
		['Betriebszeit', sm.power_on_hours != null ? `${fmtHours(sm.power_on_hours)} (${sm.power_on_hours.toLocaleString(LOC)} h)` : null],
		['Einschaltvorgänge', sm.power_cycles],
		['Anläufe des Motors', sm.ssd ? null : sm.start_stops],
		['Umgelagerte Sektoren', sm.reallocated],
		['Schwebende Sektoren', sm.pending],
		['Nicht lesbare Sektoren', sm.uncorrectable],
		['Übertragungsfehler (CRC)', sm.crc_errors],
		['Fehlerprotokoll', sm.error_count != null ? `${sm.error_count} Einträge` : null],
		['Geschrieben', sm.written != null ? fmtBytes(sm.written) : null]
	].filter(([, v]) => v != null);
	const t = sm.test_running, last = sm.last_test, mins = sm.test_minutes || {};
	return html`<div class="panel">${head}
		${reasons.length ? html`<ul class="hreasons">${reasons.map((r) => html`<li>${smartReason(sm, r)}</li>`)}</ul>`
			: html`<p style="margin:0 0 12px;font-size:13px">Keine Auffälligkeiten.</p>`}
		${sm.life_left != null ? html`<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between;font-size:13px"><span>Lebensdauer der SSD</span><b>noch ${sm.life_left} %</b></div>
			<div class="bar" style="margin-top:4px"><i class="${sm.life_left <= 10 ? 'crit' : sm.life_left <= 20 ? 'warn' : ''}" style="width:${sm.life_left}%"></i></div></div>` : ''}
		<dl class="kv">${kv.map(([k, v]) => html`<dt>${k}</dt><dd>${typeof v === 'number' ? v.toLocaleString(LOC) : v}</dd>`)}</dl>
		<div class="pt" style="margin:16px 0 8px">SELBSTTEST</div>
		${t ? html`<div style="font-size:13px">Läuft – noch ${t.remaining} %<div class="bar busy" style="margin-top:4px"><i style="width:${100 - t.remaining}%"></i></div></div>`
			: last ? html`<div style="font-size:13px"><span class="tag ${last.passed === false ? 'err' : 'ok'}">${last.passed === false ? 'FEHLGESCHLAGEN' : 'OK'}</span> <span>${({ 'Short offline': 'Kurztest', 'Extended offline': 'Langtest', 'Short captive': 'Kurztest', 'Extended captive': 'Langtest' })[last.type] || last.type}</span> · ${last.passed === false ? last.status : html`<span>ohne Fehler</span>`}${last.hours != null ? html` <span class="mut">(bei ${last.hours.toLocaleString(LOC)} h)</span>` : ''}</div>`
			: html`<div class="mut" style="font-size:13px">Noch kein Selbsttest gelaufen.</div>`}
		<div class="acts" style="margin-top:12px">
			${read}
			${bay && !t ? html`<button class="btn sm" type="button" data-act="smart-test" data-disk="${d.name}" data-t="short"><span>Kurztest</span>${mins.short ? html` <span class="mut">${fmtTestMin(mins.short)}</span>` : ''}</button>
				<button class="btn sm" type="button" data-act="smart-test" data-disk="${d.name}" data-t="long"><span>Langtest</span>${mins.long ? html` <span class="mut">${fmtTestMin(mins.long)}</span>` : ''}</button>` : ''}
			${bay && t ? html`<button class="btn sm danger" type="button" data-act="smart-test" data-disk="${d.name}" data-t="abort">Test abbrechen</button>` : ''}
			${(sm.attributes || []).length ? html`<button class="btn sm ghost ml" type="button" data-act="smart-attrs" data-disk="${d.name}" aria-expanded="${!!open}">${open ? 'Werte ausblenden' : 'Alle Werte'}</button>` : ''}
		</div>
		${open ? html`<div class="tw" style="margin-top:12px"><table class="t" style="min-width:560px"><thead><tr><th class="r">ID</th><th>WERT</th><th class="r">AKTUELL</th><th class="r">SCHLECHTESTER</th><th class="r">SCHWELLE</th><th>ROHWERT</th></tr></thead>
			<tbody>${sm.attributes.map((a) => html`<tr${a.when_failed ? raw(' class="sel"') : ''}><td class="r mut">${a.id}</td><td>${a.name}${a.when_failed ? html` <span class="tag ${a.when_failed === 'now' ? 'err' : 'warn'}">${a.when_failed === 'now' ? 'JETZT' : 'FRÜHER'}</span>` : ''}</td>
				<td class="r">${a.value}</td><td class="r mut">${a.worst}</td><td class="r mut">${a.thresh}</td><td class="mut"><code>${a.raw}</code></td></tr>`)}</tbody></table></div>` : ''}
		${rating === 'bad' ? html`<p class="note" style="color:var(--red)">Daten sichern und die Platte bald tauschen.</p>` : ''}
		${sm.time ? html`<p class="note">Gelesen ${fmtTime(sm.time)}.</p>` : ''}
	</div>`;
}

function healthView() {
	const st = S.storage;
	if (!st) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade Laufwerke …</span></div></div>`;
	const sched = st.smart_schedule || '';
	return html`<section class="sec">
		<h2 class="gh">GESUNDHEIT <span>SMART der Platten und SSDs</span></h2>
		${st.disks.length ? html`<div class="g2">${st.disks.map((d) => healthCard(d))}</div>` : html`<div class="panel"><div class="empty">${svg(I.info)}<span>Keine Platte erkannt.</span></div></div>`}
	</section>
	<section class="sec">
		<h2 class="gh">EINSTELLUNGEN</h2>
		<div class="g2"><div class="panel">
			<div class="ph"><span class="pt">SELBSTTEST NACH ZEITPLAN</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>ALLE PLATTEN IN DEN SCHÄCHTEN</span><select id="smart-sched">
				${[['', 'Aus'], ['short_weekly', 'Kurztest jeden Sonntag (3:30 Uhr)'], ['long_monthly', 'Langtest am 1. jedes Monats (3:30 Uhr)']].map(([v, t]) => html`<option value="${v}"${sched === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<p class="note">Der Kurztest prüft die Elektronik und einen Teil der Oberfläche, der Langtest liest die ganze Platte (bei großen Platten viele Stunden; die Platte bleibt dabei wach). Das Ergebnis erscheint hier und als Meldung, wenn etwas auffällt.</p>
		</div>
		<div class="panel">
			<div class="ph"><span class="pt">SO WIRD BEWERTET</span></div>
			<dl class="hrate"><dt><span class="tag err">KRITISCH</span></dt><dd>Die Platte meldet selbst einen Ausfall, ein Wert liegt unter der Schwelle des Herstellers, ein Selbsttest schlug fehl, über 100 umgelagerte oder über 10 schwebende Sektoren, SSD mit höchstens 10 % Lebensdauer, 60 °C und mehr.</dd>
			<dt><span class="tag warn">ACHTUNG</span></dt><dd>Einzelne umgelagerte, schwebende oder nicht lesbare Sektoren, Übertragungsfehler, Einträge im Fehlerprotokoll, SSD mit höchstens 20 % Lebensdauer, ab 55 °C.</dd></dl>
		</div></div>
	</section>`;
}

function diskTable(st, running) {
	return html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>LAUFWERK</th><th>MODELL</th><th>GRÖSSE</th><th>SMART</th><th>INHALT</th><th></th></tr></thead>
		<tbody>${st.disks.map((d) => html`<tr>
			<td><b>${d.usb || d.tran === 'usb' ? 'USB' : 'Schacht'} · ${d.name}</b></td>
			<td>${d.model || 'unbekanntes Modell'}${d.serial ? html`<div class="mut" style="font-size:12px">${d.serial}</div>` : ''}</td>
			<td>${fmtBytes(d.size)}</td><td>${smartLine(d.smart)}</td><td class="mut" style="font-size:12px">${diskUse(st, d).txt}</td>
			<td><div class="acts">${diskActions(d, running)}</div></td></tr>`)}</tbody></table></div>`;
}

function volumeCard(st, v, running) {
	const md = arrayOf(st, v.device);
	const degraded = md && md.health && md.health.includes('_');
	const p = pct(v.used, v.size);
	return html`<div class="card${v.mounted ? '' : ' off'}">
		<div class="icon">${svg(I.disk)}<span class="dot ${!v.mounted ? 'down' : degraded ? 'warn' : 'up'}"></span></div>
		<div class="info">
			<div class="name">${v.name}${S.storage?.apps === v.name ? html` <span class="tag" title="Pakete und App-Daten liegen in .shareos">APPS</span>` : ''}</div>
			<div class="desc">${LAYOUT_TXT[v.layout] || v.layout || ''} · ${FS_NAME[v.fstype] || v.fstype || 'ext4'}${v.mounted ? html` · ${fmtBytes(v.avail)} frei von ${fmtBytes(v.size)}` : ' · nicht eingehängt'}</div>
			${v.mounted ? html`<div class="bar" style="margin-top:10px"><i class="${p > 90 ? 'crit' : p > 80 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}
			${md ? html`<div class="desc" style="margin-top:8px">${md.name}: ${degraded ? html`<span style="color:var(--amber)">eine Platte fehlt (${md.health})</span>` : html`beide Platten aktiv (${md.health || '?'})`}</div>` : ''}
			${degraded && !md.sync && v.layout === 'mirror' && !repairCandidates(st, md).length ? html`<div class="desc" style="margin-top:6px">Neue Platte in den freien Schacht einsetzen, dann „Spiegel reparieren“.</div>` : ''}
			${md?.sync ? html`<div class="desc" style="margin-top:6px">${md.sync.action === 'resync' ? 'Erst-Synchronisierung' : md.sync.action === 'recovery' ? 'Wiederherstellung' : 'Prüfung'}: ${md.sync.delayed ? 'wartet' : md.sync.percent.toFixed(1) + ' %' + (md.sync.finish ? ' · noch ' + fmtMin(md.sync.finish) : '')}</div>
				<div class="bar" style="margin-top:6px"><i class="warn" style="width:${md.sync.percent}%"></i></div>` : ''}
			<div class="ip">${v.mountpoint}${v.device ? ' · ' + v.device : ' · Dateisystem nicht gefunden'}</div>
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
	if (d.usb) return html`<button class="btn sm" type="button" data-act="usb-eject" data-disk="${d.name}" ${running ? 'disabled' : ''}>Sicher entfernen</button>
		<button class="btn sm danger" type="button" data-act="usb-format" data-disk="${d.name}" ${running ? 'disabled' : ''}>Formatieren</button>`;
	return html`${adoptable(S.storage, d).map((p) => html`<button class="btn sm primary" type="button" data-act="adopt" data-part="${p.name}" data-fs="${p.fstype}" data-size="${p.size}" ${running || S.wiz ? 'disabled' : ''}>${p.name} übernehmen</button>`)}
		<button class="btn sm" type="button" data-act="smart" data-disk="${d.name}">SMART lesen</button>
		<button class="btn sm danger" type="button" data-act="format" data-disk="${d.name}" ${running || S.wiz ? 'disabled' : ''}>Löschen & formatieren</button>`;
}

// mounted partitions of a USB drive
function usbLines(st, d) {
	const m = (st.usb || []).filter((x) => x.dev.replace('/dev/', '').replace(/p?\d+$/, '') === d.name);
	return m.length ? html`<div class="desc" style="margin-top:8px">${m.map((x) => html`<div>${FS_NAME[x.fs] || x.fs} · <code>${x.path}</code></div>`)}</div>`
		: html`<div class="desc" style="margin-top:8px;color:var(--muted)">nicht eingehängt</div>`;
}

function diskCard(st, d, running) {
	const use = diskUse(st, d);
	const sm = d.smart;
	return html`<div class="card">
		<div class="icon">${svg(d.rm || d.tran === 'usb' ? I.usb : I.disk)}<span class="dot ${sm && !sm.standby && !sm.error && smartRating(sm) !== 'good' ? 'warn' : 'up'}"></span></div>
		<div class="info">
			<div class="name">${d.usb || d.tran === 'usb' ? 'USB' : 'Schacht'} · ${d.name}${d.standby ? html` <span class="tag">SCHLÄFT</span>` : ''}</div>
			<div class="desc">${d.model || 'unbekanntes Modell'} · ${fmtBytes(d.size)}${d.serial ? ' · ' + d.serial : ''}</div>
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
	const steps = ['Platten', 'Aufbau', 'Name', 'Bestätigen'];
	const smallest = Math.min(...chosen.map((d) => d.size));
	let body;
	if (w.step === 0) {
		body = html`<p class="mut" style="margin:0 0 12px;font-size:13px">Welche Platten sollen eingerichtet werden? <b style="color:var(--amber)">Alles auf diesen Platten wird gelöscht.</b></p>
			<div style="display:grid;gap:8px">${(disks.length ? disks : st.disks).map((d) => { const u = diskUse(st, d); return html`
				<label class="chk" style="align-items:flex-start"><input type="checkbox" class="wiz-disk" value="${d.name}"${w.disks.includes(d.name) ? raw(' checked') : ''}>
				<span><b>${d.name}</b> · ${d.model || ''} · ${fmtBytes(d.size)}<br><span class="mut" style="font-size:12px">${u.empty ? 'leer' : 'enthält: ' + u.txt}</span></span></label>`; })}</div>`;
	} else if (w.step === 1) {
		const two = chosen.length === 2;
		const opts = two
			? [['mirror', 'Spiegel (RAID 1) – empfohlen', `Beide Platten enthalten dieselben Daten. Fällt eine aus, ist nichts verloren. Nutzbar: ${fmtBytes(smallest)}.`],
				['stripe', 'RAID 0 – schnell', `Beide Platten werden ein Laufwerk, Daten abwechselnd verteilt: schneller, Platz ${fmtBytes(2 * smallest)}. Fällt eine Platte aus, ist alles verloren.`],
				['span', 'JBOD – voller Platz', `Beide Platten werden hintereinander ein Laufwerk mit ${fmtBytes(chosen.reduce((a, d) => a + d.size, 0))} (auch bei verschieden großen Platten). Fällt eine Platte aus, ist alles verloren.`],
				['single', 'Zwei getrennte Laufwerke', `Doppelter Platz (${fmtBytes(chosen.reduce((a, d) => a + d.size, 0))}), aber keine Ausfallsicherheit – jede Platte ist ein eigenes Laufwerk.`]]
			: [['single', 'Einzelnes Laufwerk', `Die Platte wird ein Laufwerk mit ${fmtBytes(chosen[0]?.size)}. Für Ausfallsicherheit später eine zweite Platte als Spiegel einrichten.`]];
		if (!opts.some((o) => o[0] === w.layout)) w.layout = opts[0][0];
		body = html`<div style="display:grid;gap:10px">${opts.map(([id, t, d]) => html`
			<label class="panel" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;${w.layout === id ? 'border-color:var(--accent);box-shadow:var(--glow)' : ''}">
				<input type="radio" name="wiz-layout" value="${id}"${w.layout === id ? raw(' checked') : ''} style="margin-top:4px;accent-color:var(--accent)">
				<span><b class="name" style="font-size:14px">${t}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
			<div class="fields" style="margin-top:14px"><label class="f"><span>AUSLAGERUNGSSPEICHER (SWAP) JE PLATTE</span><select id="wiz-swap">
				${[[1024, '1 GB – empfohlen'], [2048, '2 GB'], [512, '512 MB'], [0, 'keiner']].map(([v, t]) => html`<option value="${v}"${w.swap === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<p class="note">Die Box hat nur 256 MB RAM. Swap auf den Platten fängt Lastspitzen ab (Freigaben, Cloud-Sync, Paketinstallation). Er liegt als eigene kleine Partition vorne auf jeder Platte; der Rest wird das Laufwerk.</p>`;
	} else if (w.step === 2) {
		const fields = pairLayout(w.layout) ? [['__mirror', w.layout === 'mirror' ? 'NAME DES SPIEGELS' : 'NAME DES LAUFWERKS']] : chosen.map((d) => [d.name, `NAME FÜR ${d.name.toUpperCase()} (${fmtBytes(d.size)})`]);
		body = html`<div style="display:grid;gap:14px">${fields.map(([k, l]) => html`<div class="fields">
				<label class="f"><span>${l}</span><input class="wiz-name" data-k="${k}" value="${w.names[k] || ''}" maxlength="16" pattern="[a-z0-9][a-z0-9_-]{0,15}" required></label>
				<label class="f"><span>DATEISYSTEM</span><select class="wiz-fs" data-k="${k}">${FS_DISK.map(([v, t]) => html`<option value="${v}"${(w.fs[k] || 'ext4') === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
				<div style="grid-column:1/-1">${fsNote(FS_DISK, w.fs[k] || 'ext4')}</div></div>`)}</div>
			<p class="note">Kleinbuchstaben, Ziffern, - und _ (max. 16 Zeichen). Das Laufwerk erscheint als <code>/mnt/&lt;name&gt;</code>; Freigaben legst du später darauf an.</p>`;
	} else {
		const pairSize = w.layout === 'mirror' ? smallest : w.layout === 'stripe' ? 2 * smallest : chosen.reduce((a, d) => a + d.size, 0);
		const vols = pairLayout(w.layout) ? [[w.names.__mirror, chosen.map((d) => d.name).join(' + '), fmtBytes(pairSize), w.fs.__mirror || 'ext4']]
			: chosen.map((d) => [w.names[d.name], d.name, fmtBytes(d.size), w.fs[d.name] || 'ext4']);
		body = html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>LAUFWERK</th><th>PLATTEN</th><th>GRÖSSE</th><th>AUFBAU</th><th>DATEISYSTEM</th></tr></thead>
			<tbody>${vols.map(([n, ds, sz, f]) => html`<tr><td><b>${n}</b></td><td>${ds}</td><td>${sz}</td><td>${LAYOUT_TXT[w.layout]}</td><td>${FS_NAME[f]}</td></tr>`)}</tbody></table></div>
			<p class="note">${w.swap ? `Je Platte ${fmtBytes(w.swap * 1048576)} Swap, ` : 'Kein Swap, '}${(() => { const k = (pairLayout(w.layout) ? ['__mirror'] : w.disks).find((x) => LINUX_FS.includes(w.fs[x] || 'ext4')); return k ? `Apps-Bereich auf „${w.names[k]}“ (falls noch keiner besteht).` : 'kein Apps-Bereich (Pakete und App-Daten brauchen ext4 oder Btrfs).'; })()}</p>
			<p class="note" style="color:var(--amber)">Beim Klick auf „Einrichten“ werden ${chosen.map((d) => d.name).join(' und ')} vollständig gelöscht.${w.layout === 'mirror' ? ' Die Erst-Synchronisierung läuft danach im Hintergrund (bei großen Platten mehrere Stunden); das Laufwerk ist sofort nutzbar.' : ''}</p>`;
	}
	return html`<section class="sec"><div class="panel" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">SPEICHER EINRICHTEN · ASSISTENT</span><button class="btn sm ghost ml" type="button" data-act="wiz-cancel">Abbrechen</button></div>
		<div class="steps" style="margin-bottom:16px">${steps.map((n, k) => html`<div class="step ${k < w.step ? 'done' : k === w.step ? 'act' : ''}"><div class="n">${k + 1}${k < w.step ? ' ✓' : ''}</div>${n}</div>`)}</div>
		${body}
		<div class="acts" style="margin-top:16px;justify-content:space-between">
			<button class="btn ghost" type="button" data-act="wiz-back" ${w.step === 0 ? 'disabled' : ''}>Zurück</button>
			${w.step < 3 ? html`<button class="btn primary" type="button" data-act="wiz-next">Weiter</button>`
				: html`<button class="btn danger" type="button" data-act="wiz-run">Einrichten</button>`}
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
		if (!w.disks.length) return 'Bitte mindestens eine Platte auswählen.';
		if (w.disks.length > 2) return 'Höchstens zwei Platten.';
	}
	if (w.step === 2) {
		const keys = pairLayout(w.layout) ? ['__mirror'] : w.disks;
		const names = keys.map((k) => w.names[k] || '');
		if (names.some((n) => !NAME_RE.test(n))) return 'Ungültiger Name: nur a–z, 0–9, - und _, max. 16 Zeichen.';
		if (new Set(names).size !== names.length) return 'Die Namen müssen verschieden sein.';
		const taken = st.volumes.filter((v) => !(v.device || '').match(new RegExp('/dev/(' + w.disks.join('|') + ')|/dev/md'))).map((v) => v.name);
		const clash = names.find((n) => taken.includes(n));
		if (clash) return `Der Name „${clash}“ ist schon vergeben.`;
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
		if (e.code !== 'auth') { toast('Speicher: ' + e.message, true); S.stTimer = setTimeout(loadStorage, 15000); }
	}
}

/* ---------- system sub pages ------------------------------------------------ */

const STEP_NAMES = ['Herunterladen', 'Prüfen', 'Bereit', 'Schreiben', 'Neustart'];
// flashing sub-steps reported by shareos-update -> [progress %, label]
const FLASH_STEPS = {
	'check bundle': [5, 'Paket wird erneut geprüft'],
	'stage rootfs': [20, 'System wird für den Neustart bereitgelegt'],
	'erase ramdisk': [45, 'Startsystem: Flash wird gelöscht'],
	'write ramdisk': [50, 'Startsystem wird geschrieben'],
	'verify ramdisk': [58, 'Startsystem wird geprüft'],
	'erase uImage': [64, 'Kernel: Flash wird gelöscht'],
	'write uImage': [72, 'Kernel wird geschrieben'],
	'verify uImage': [88, 'Kernel wird geprüft']
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
		${(u.pending_reboot || u.state === 'flashed') && !busy ? html`<div class="banner">${svg(I.reboot)}<span style="flex:1;min-width:240px"><b>Neustart nötig</b> – das neue System wird beim nächsten Start installiert (ca. 1 Minute, Box nicht ausschalten).</span><button class="btn primary" type="button" data-act="reboot">Jetzt neu starten</button></div>` : ''}
		${u.last_upgrade ? html`<div class="banner" style="${u.last_upgrade.startsWith('ok') ? 'border-color:var(--dim)' : ''}">${svg(u.last_upgrade.startsWith('ok') ? I.ok : I.warn)}<span style="flex:1">Letztes Update: <b>${u.last_upgrade.startsWith('ok') ? 'erfolgreich installiert (' + u.last_upgrade.slice(3) + ')' : u.last_upgrade}</b></span>${closeX('upd-ack')}</div>` : ''}
		${!bootOk && i.boot ? html`<div class="banner">${svg(I.warn)}<span>Die Box läuft gerade nicht aus dem Flash (<b>${i.boot}</b>). Updates über diese Seite gehen nur beim normalen Start aus dem Flash.</span></div>` : ''}
		<div class="split">
			<section class="main">
				<div class="panel">
					<div class="ph"><span class="pt">FIRMWARE-UPDATE</span><span class="tag ml">Quelle: GitHub Releases · ${c?.repo || 'UniqueDroid/ShareOS'}</span></div>
					<div class="ver">
						<div class="tile"><div class="k">Installiert</div><div class="v">${cur}</div><div class="s">Kernel, Startsystem und System</div></div>
						<span class="arrow" aria-hidden="true">→</span>
						<div class="tile"${c?.update_available ? raw(' style="border-color:color-mix(in srgb,var(--amber) 45%,transparent)"') : ''}>
							<div class="k">Neueste · ${c ? (c.channel === 'beta' ? 'Beta' : 'Stabil') : '–'}</div>
							<div class="v ${c?.update_available ? 'warn' : ''}">${latest ? latest.version : c ? 'keine' : '?'}</div>
							<div class="s">${c ? (c.update_available ? 'Update verfügbar' : latest ? 'aktuell' : 'noch kein Release für dieses Gerät') : 'noch nicht geprüft'}</div></div>
					</div>
					${si >= 0 ? html`
						<div class="pt" style="margin:18px 0 8px">ABLAUF · ${u.release?.version || ''}</div>
						<div class="steps">${STEP_NAMES.map((n, k) => html`<div class="step ${k < si || u.state === 'flashed' ? 'done' : k === si ? 'act' : ''}"><div class="n">${k + 1}${k < si || (u.state === 'flashed' && k <= si) ? ' ✓' : k === si ? ' · LÄUFT' : ''}</div>${n}</div>`)}</div>
						${prog != null ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:${prog.toFixed(0)}%"></i></div><p class="note">${fmtBytes(u.progress.bytes)} von ${fmtBytes(u.progress.total)}</p>` : ''}
						${u.state === 'verifying' ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Paket wird geprüft …</b> SHA-256 und Inhalt, dauert etwa eine halbe Minute.</p>` : ''}
						${u.state === 'flashing' ? (() => { const [fp, fl] = FLASH_STEPS[u.step] || [2, 'Wird gestartet']; return html`<div class="bar big busy" style="margin-top:12px"><i style="width:${fp}%"></i></div><p class="note"><b>${fl} …</b> (${fp} %) – Box <b>nicht ausschalten</b>, das dauert etwa 1–2 Minuten.</p>`; })() : ''}
						${u.state === 'flashed' ? html`<div class="bar big" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Installation abgeschlossen</b> (100 %) – jetzt neu starten.</p>` : ''}
						${u.state === 'ready' ? html`<div class="acts" style="margin-top:14px"><button class="btn primary" type="button" data-act="apply" data-tag="${u.release.tag}" data-ver="${u.release.version}" ${bootOk ? '' : 'disabled'}>${svg(I.dl)}${u.release.version} installieren</button><button class="btn ghost" type="button" data-act="cancel">Verwerfen</button></div>
							<p class="note">${u.release.local ? (u.release.sha_checked ? 'Hochgeladene Datei – geprüft: SHA-256 laut .sha256-Datei, Prüfsummen aller Teile, passend für dieses Gerät.' : 'Hochgeladene Datei – geprüft: Prüfsummen aller Teile, passend für dieses Gerät (ohne .sha256-Datei).') : 'Geprüft: SHA-256, Prüfsummen aller Teile, passend für dieses Gerät.'} Einstellungen und Pakete bleiben erhalten.</p>` : ''}`
					: ''}
					${u.state === 'error' ? html`<div class="banner" style="margin:16px 0 0">${svg(I.warn)}<span><b>Fehler:</b> ${u.error}</span><button class="btn sm ghost" type="button" data-act="cancel">OK</button></div>` : ''}
					<div class="fields" style="margin-top:18px">
						<label class="f"><span>UPDATE-KANAL</span><select id="channel">
							<option value="stable"${(c?.channel || 'stable') === 'stable' ? raw(' selected') : ''}>Stabil (Releases)</option>
							<option value="beta"${c?.channel === 'beta' ? raw(' selected') : ''}>Beta (auch Pre-Releases)</option></select></label>
					</div>
					<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="check" ${S.checking || busy ? 'disabled' : ''}>${S.checking ? 'Prüfe …' : 'Jetzt prüfen'}</button></div>
				</div>
				${c?.releases?.length ? html`<div>
					<h2 class="gh">VERSIONEN <span>von GitHub</span></h2>
					<div class="tw"><table class="t" style="min-width:600px">
						<thead><tr><th>VERSION</th><th>DATUM</th><th>KANAL</th><th>GRÖSSE</th><th></th></tr></thead>
						<tbody>${c.releases.map((r) => html`<tr>
							<td><b>${r.version}</b></td><td>${fmtDate(r.date)}</td>
							<td><span class="tag">${r.prerelease ? 'BETA' : 'STABIL'}</span></td><td class="mut">${fmtBytes(r.size)}</td>
							<td>${r.version === cur ? html`<span class="tag ok">installiert</span>`
								: html`<button class="btn sm${r.tag === latest?.tag ? '' : ' ghost'}" type="button" data-act="download" data-tag="${r.tag}" ${busy || !bootOk ? 'disabled' : ''}>Laden</button>`}
								<a class="btn sm ghost" href="${r.url}" target="_blank" rel="noopener">Notes ↗</a></td></tr>`)}
						</tbody></table></div></div>` : ''}
				${latest?.notes ? html`<div class="panel"><div class="ph"><span class="pt">ÄNDERUNGEN IN ${latest.version}</span></div><pre class="notes">${latest.notes}</pre></div>` : ''}
			</section>
			<aside class="aside">
				<div class="panel">
					<div class="ph"><span class="pt">SO LÄUFT EIN UPDATE</span></div>
					<ol class="plan" style="padding-left:20px">
						<li>Paket von GitHub laden und prüfen (SHA-256, Gerät, Größen)</li>
						<li>Kernel und Startsystem in den Flash schreiben und zurücklesen</li>
						<li>Neues System bereitlegen</li>
						<li>Neustart: das Startsystem installiert das System, dann startet ShareOS neu</li>
					</ol>
					<p class="note">Einstellungen und installierte Pakete bleiben erhalten. Bei einem Abbruch wird die Installation beim nächsten Start wiederholt.</p>
				</div>
				<form class="panel" id="f-bin" style="margin-top:16px">
					<div class="ph"><span class="pt">FIRMWARE-DATEI EINSPIELEN</span><span class="tag ml">.tar · .bin</span></div>
					<p class="note" style="margin:0 0 10px"><b>Update ohne Internet:</b> eine .sysupgrade.tar eines ShareOS-Release hochladen, am besten mit der passenden .sha256-Datei. Geprüft wird wie beim Update von GitHub.</p>
					<p class="note" style="margin:0 0 10px">Eine Firmware im D-Link-Format, z. B. für den <b>Wechsel zurück zu Alt-F</b>. Geschrieben werden Kernel und Startsystem; System und Einstellungen von ShareOS bleiben im Flash.</p>
					<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>DATEI</span><input type="file" name="file" accept=".tar,.bin" required></label>
						<label class="f"><span>PRÜFSUMME (.SHA256, OPTIONAL)</span><input type="file" name="sha" accept=".sha256,.txt"></label></div>
					<div id="bin-info"></div>
					<div class="acts" style="margin-top:12px"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${svg(I.ul)}Hochladen & prüfen</button></div>
				</form>
			</aside>
		</div>`;
	},

	general() {
		const i = S.info || {};
		return html`<div class="acts" style="margin-bottom:16px"><button class="btn ghost" type="button" data-act="fr-again">Ersteinrichtung erneut starten</button></div>
		<h2 class="gh" style="margin-top:22px">EINSTELLUNGEN SICHERN & WIEDERHERSTELLEN</h2>
		<div class="g2">
			<form class="panel" id="f-backup">
				<div class="ph"><span class="pt">SICHERN</span><span class="tag ml">JSON-Datei</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>PASSWORT ZUM VERSCHLÜSSELN (OPTIONAL)</span><input name="pw" type="password" minlength="6" autocomplete="new-password" placeholder="leer = unverschlüsselt"></label></div>
				<p class="note">Enthält alle Einstellungen, Benutzer mit ihren Passwörtern (als Hash), Freigaben, Netzwerk und das HTTPS-Zertifikat samt Schlüssel. Ohne Passwort ist die Datei lesbar – dann sicher aufbewahren. Mit Passwort: AES-256, das Passwort wird zum Wiederherstellen gebraucht.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">${svg(I.dl)}Sicherung herunterladen</button></div>
			</form>
			<form class="panel" id="f-restore">
				<div class="ph"><span class="pt">WIEDERHERSTELLEN</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>SICHERUNGSDATEI</span><input name="file" type="file" accept=".json,application/json" required></label>
					<label class="f"><span>PASSWORT (FALLS VERSCHLÜSSELT)</span><input name="pw" type="password" autocomplete="off"></label>
				</div>
				<div id="restore-preview"></div>
				<div class="acts" style="margin-top:12px"><button class="btn" type="submit">Prüfen</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">APP & WIDGETS</h2>
		<div class="g2">${appPanel()}${widgetPanel()}</div>
		<h2 class="gh" style="margin-top:22px">GERÄT & ZUGANG</h2>
		<div class="g2">
			<form class="panel" id="f-host">
				<div class="ph"><span class="pt">GERÄTENAME</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>HOSTNAME</span><input name="hostname" value="${i.hostname || ''}" pattern="[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?" required></label></div>
				<p class="note">Buchstaben, Ziffern und Bindestrich. Gilt sofort, der DHCP-Server sieht ihn bei der nächsten Verlängerung.</p>
				<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button></div>
			</form>
			<form class="panel" id="f-pass">
				<div class="ph"><span class="pt">ZUGANG · ${S.user}</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>NEUES PASSWORT</span><input name="p1" type="password" minlength="6" autocomplete="new-password" required></label>
					<label class="f"><span>WIEDERHOLEN</span><input name="p2" type="password" minlength="6" autocomplete="new-password" required></label>
				</div>
				<p class="note">Gilt für die Weboberfläche und SSH. Mindestens 6 Zeichen.</p>
				<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Passwort ändern</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">ÜBER</h2>
		${SYS.about()}`;
	},

	notifications() {
		const n = S.notes, c = S.noteCfg;
		if (!n || !c) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
		const de = LANG === 'de', when = (t) => fmtTime(t);
		const LV = { error: ['err', 'FEHLER'], warn: ['warn', 'WARNUNG'], info: ['', 'INFO'] };
		const lvSel = (name, v) => html`<select name="${name}">${[['info', 'alles (Info, Warnung, Fehler)'], ['warn', 'Warnungen und Fehler'], ['error', 'nur Fehler']].map(([k, t]) => html`<option value="${k}"${(v || 'warn') === k ? raw(' selected') : ''}>${t}</option>`)}</select>`;
		return html`<div class="split">
			<section class="main">
				<h2 class="gh">MELDUNGEN <span>${n.unread} ungelesen</span></h2>
				${n.items.length ? html`<div class="acts" style="margin:0 0 12px"><button class="btn sm" type="button" data-act="note-read" data-id="all" ${n.unread ? '' : 'disabled'}>Alle als gelesen markieren</button>
					<button class="btn sm ghost" type="button" data-act="note-del" data-id="all">Alle löschen</button></div>
				<div class="notelist">${n.items.map((x) => html`<div class="panel note-item${x.read || x.resolved ? ' read' : ''}">
					<div class="ph" style="gap:8px"><span class="tag ${x.resolved ? 'ok' : LV[x.level]?.[0] || ''}">${x.resolved ? 'ERLEDIGT' : LV[x.level]?.[1] || x.level}</span>
						<b class="name" style="font-size:14px">${de ? x.title_de : x.title_en}</b>${x.count > 1 ? html`<span class="tag">${x.count}×</span>` : ''}
						<span class="ml mut" style="font-size:12px">${when(x.last)}</span></div>
					${(de ? x.text_de : x.text_en) ? html`<p class="mut" style="margin:6px 0 0;font-size:13px">${de ? x.text_de : x.text_en}</p>` : ''}
					<div class="acts" style="margin-top:10px">${x.read || x.resolved ? '' : html`<button class="btn sm" type="button" data-act="note-read" data-id="${x.id}">Gelesen</button>`}
						<button class="btn sm ghost" type="button" data-act="note-del" data-id="${x.id}">Löschen</button></div></div>`)}</div>`
				: html`<div class="panel"><div class="empty">${svg(I.ok)}<span>Keine Meldungen – alles in Ordnung.</span></div></div>`}
				<p class="note">Die Box prüft alle 10 Minuten RAID, Laufwerke (eingehängt, Füllstand), Temperatur, SMART-Werte und Updates; fehlgeschlagene Cloud-Aufträge, App-Aufgaben und Speicher-Aufträge melden sich sofort. Gleiche Meldungen werden gezählt und höchstens einmal am Tag erneut verschickt.</p>
			</section>
			<aside class="aside">
				<form class="panel" id="f-notify">
					<div class="ph"><span class="pt">E-MAIL</span></div>
					<label class="chk"><input type="checkbox" name="email"${c.email ? raw(' checked') : ''}><span>Meldungen per E-Mail schicken</span></label>
					<div class="fields" style="grid-template-columns:1fr;margin-top:10px">
						<label class="f"><span>MAILSERVER (SMTP)</span><input name="smtp_host" value="${c.smtp_host}" placeholder="smtp.example.org" autocomplete="off"></label>
						<label class="f"><span>VERSCHLÜSSELUNG</span><select name="smtp_tls">${[['starttls', 'STARTTLS (Port 587)'], ['ssl', 'SSL/TLS (Port 465)'], ['none', 'keine (Port 25)']].map(([k, t]) => html`<option value="${k}"${(c.smtp_tls || 'starttls') === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
						<label class="f"><span>PORT (LEER = STANDARD)</span><input name="smtp_port" value="${c.smtp_port}" inputmode="numeric"></label>
						<label class="f"><span>BENUTZER</span><input name="smtp_user" value="${c.smtp_user}" autocomplete="off"></label>
						<label class="f"><span>PASSWORT</span><input name="smtp_pass" type="password" autocomplete="new-password" placeholder="${c.has_pass ? '•••••• (gespeichert)' : ''}"></label>
						<label class="f"><span>ABSENDER</span><input name="mail_from" value="${c.mail_from}" placeholder="nas@example.org"></label>
						<label class="f"><span>EMPFÄNGER (MEHRERE MIT KOMMA)</span><input name="mail_to" value="${c.mail_to}" placeholder="ich@example.org"></label>
						<label class="f"><span>SCHICKEN</span>${lvSel('email_level', c.email_level)}</label>
					</div>
					<div class="ph" style="margin-top:18px"><span class="pt">PUSH</span></div>
					<label class="chk"><input type="checkbox" name="push"${c.push ? raw(' checked') : ''}><span>Meldungen aufs Handy schicken</span></label>
					<div class="fields" style="grid-template-columns:1fr;margin-top:10px">
						<label class="f"><span>DIENST</span><select name="push_type">${[['ntfy', 'ntfy'], ['gotify', 'Gotify'], ['telegram', 'Telegram (Bot)'], ['webhook', 'Webhook (JSON)']].map(([k, t]) => html`<option value="${k}"${(c.push_type || 'ntfy') === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
						<label class="f" data-push="url"${c.push_type === 'telegram' ? raw(' hidden') : ''}><span>ADRESSE</span><input name="push_url" value="${c.push_url}" placeholder="https://ntfy.sh/mein-nas-thema"></label>
						<label class="f"><span data-push="url"${c.push_type === 'telegram' ? raw(' hidden') : ''}>ZUGANGSSCHLÜSSEL (OPTIONAL)</span><span data-push="tg"${c.push_type === 'telegram' ? '' : raw(' hidden')}>BOT-TOKEN (VON @BOTFATHER)</span><input name="push_token" type="password" autocomplete="new-password" placeholder="${c.has_token ? '•••••• (gespeichert)' : ''}"></label>
						<label class="f" data-push="tg"${c.push_type === 'telegram' ? '' : raw(' hidden')}><span>CHAT-ID</span><span class="row" style="display:flex;gap:6px"><input name="push_chat" value="${c.push_chat || ''}" placeholder="123456789" style="flex:1"><button class="btn sm ghost" type="button" data-act="tg-chats">Chat-ID suchen</button></span></label>
						<label class="f"><span>SCHICKEN</span>${lvSel('push_level', c.push_level)}</label>
					</div>
					<p class="note">ntfy: Adresse mit Thema, z. B. <code>https://ntfy.sh/mein-nas-7f3k</code> (eigener ntfy-Server geht auch), in der ntfy-App dasselbe Thema abonnieren. Gotify: Serveradresse und App-Token.</p>
					<p class="note">Telegram: In Telegram mit @BotFather einen Bot anlegen (/newbot), den Token hier eintragen und speichern. Dann dem eigenen Bot eine Nachricht schreiben (oder ihn in eine Gruppe aufnehmen) und „Chat-ID suchen“ klicken.</p>
					<div class="ph" style="margin-top:18px"><span class="pt">GRENZEN</span></div>
					<div class="fields">
						<label class="f"><span>TEMPERATUR AB (°C)</span><input name="temp_max" type="number" min="40" max="70" value="${c.temp_max}"></label>
						<label class="f"><span>LAUFWERK VOLL AB (%)</span><input name="disk_full" type="number" min="50" max="99" value="${c.disk_full}"></label>
					</div>
					<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-act="note-test">Testnachricht</button></div>
				</form>
			</aside>
		</div>`;
	},

	time() {
		const t = S.time;
		if (!t) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
		const zones = S.zones || [t.timezone];
		const last = t.last_sync ? new Date(t.last_sync * 1000).toLocaleString(LOC, { timeZone: tzSafe(t.timezone), dateStyle: 'short', timeStyle: 'short' }) : null;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">UHRZEIT DER BOX</span><span class="tag ml">${t.timezone}</span></div>
				<div id="clock-now" class="name" style="font-size:30px;letter-spacing:.04em;margin:6px 0 2px">${boxTime(t)}</div>
				<div id="clock-date" class="mut" style="font-size:13px">${boxDate(t)}</div>
				<dl class="kv" style="margin-top:14px">
					<dt>Zeitabgleich</dt><dd>${t.ntp ? (t.ntp_running ? 'aus dem Internet (NTP)' : html`<span style="color:var(--amber)">NTP eingeschaltet, läuft aber nicht</span>`) : 'von Hand'}</dd>
					<dt>Zuletzt abgeglichen</dt><dd>${last || (t.ntp ? 'noch nicht' : '–')}</dd>
					${t.rtc ? html`<dt>Batterie-Uhr</dt><dd>wird nach jedem Abgleich gestellt</dd>` : ''}
				</dl>
				<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="time-sync">${svg(I.reboot)}Jetzt abgleichen</button></div>
			</div>
			<form class="panel" id="f-time">
				<div class="ph"><span class="pt">ZEITZONE & ZEITSERVER</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>ZEITZONE</span><select name="tz">${zones.map((z) => html`<option value="${z}"${z === t.timezone ? raw(' selected') : ''}>${z.replace(/_/g, ' ')}</option>`)}</select></label>
					<label class="chk"><input type="checkbox" name="ntp"${t.ntp ? raw(' checked') : ''}><span>Uhrzeit automatisch aus dem Internet holen (NTP)</span></label>
					<label class="f"><span>ZEITSERVER (EINER JE ZEILE, HÖCHSTENS 5)</span><textarea name="servers" rows="4" spellcheck="false">${t.servers.join('\n')}</textarea></label>
				</div>
				<p class="note">Im Heimnetz kann auch der Router Zeitserver sein, z. B. <code>fritz.box</code>. Die Zeitzone gilt für Protokolle, Zeitpläne und die Anzeige.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button></div>
			</form>
		</div>
		<form class="panel" id="f-clock" style="margin-top:16px">
			<div class="ph"><span class="pt">UHRZEIT VON HAND STELLEN</span></div>
			<div class="fields">
				<label class="f"><span>DATUM UND UHRZEIT (${t.timezone})</span><input name="dt" type="datetime-local" step="1" value="${localInput(t)}" required></label>
			</div>
			<p class="note">${t.ntp ? 'Solange NTP eingeschaltet ist, stellt die Box die Uhr beim nächsten Abgleich wieder nach dem Internet. Für eine Box ohne Internet NTP oben ausschalten.' : 'Die Uhr läuft danach weiter; die Batterie-Uhr der Box wird mitgestellt.'}</p>
			<div class="acts" style="margin-top:12px">
				<button class="btn ghost" type="button" data-act="time-browser">Uhrzeit dieses Geräts übernehmen</button>
				<button class="btn primary" type="submit">Uhrzeit setzen</button>
			</div>
		</form>`;
	},

	hardware() {
		const h = S.hw;
		if (!h) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
		const f = h.fan, l = h.led;
		const t = h.temperature != null ? (h.temperature / 1000).toFixed(0) + ' °C' : '–';
		const fs = h.fan_pwm == null ? '–' : h.fan_pwm === 0 ? 'aus' : h.fan_pwm < 128 ? 'halb' : 'voll';
		const presets = [['quiet', 'Leise', 'Lüfter steht unter 40 °C, voll ab 55 °C'], ['balanced', 'Ausgewogen', 'Lüfter läuft immer, voll ab 50 °C'],
			['cool', 'Kühl', 'Lüfter läuft immer, voll ab 45 °C'], ['custom', 'Eigene Werte', 'Temperaturen selbst festlegen']];
		const sel = (id, cur, opts) => html`<select id="${id}">${opts.map(([v, t2]) => html`<option value="${v}"${cur === v ? raw(' selected') : ''}>${t2}</option>`)}</select>`;
		return html`<div class="g2">
			<form class="panel" id="f-fan">
				<div class="ph"><span class="pt">LÜFTER</span><span class="tag ml">jetzt: ${t} · ${fs}</span></div>
				<div style="display:grid;gap:8px">${presets.map(([id, name, d]) => html`
					<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px"><input type="radio" name="preset" value="${id}"${f.preset === id ? raw(' checked') : ''} style="accent-color:var(--accent);margin-top:3px">
						<span><b>${name}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
				<div class="fields" id="fan-custom" style="margin-top:14px"${f.preset === 'custom' ? '' : raw(' hidden')}>
					<label class="f"><span>AUS UNTER (°C, 0 = NIE)</span><input name="off_temp" type="number" min="0" max="65" value="${f.off_temp}"></label>
					<label class="f"><span>VOLL AB (°C)</span><input name="full_temp" type="number" min="35" max="70" value="${f.full_temp}"></label>
					<label class="f"><span>ZURÜCK AUF HALB UNTER (°C)</span><input name="half_temp" type="number" min="30" max="69" value="${f.half_temp}"></label>
				</div>
				<p class="note">Die Box regelt den Lüfter in drei Stufen (aus, halb, voll) nach der Temperatur der Gerätesteuerung. Änderungen gelten nach wenigen Sekunden.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">LEDS</span><span class="tag ml">sofort aktiv</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>STATUS-LED (BLAU)</span>${sel('led-status', l.status, [['heartbeat', 'Herzschlag (ShareOS läuft)'], ['on', 'an'], ['off', 'aus']])}</label>
					<label class="f"><span>POWER-LED</span>${sel('led-power', l.power, [['on', 'an'], ['blink', 'blinkt'], ['off', 'aus']])}</label>
					<label class="f"><span>PLATTEN-LEDS (ROT)</span>${sel('led-disks', l.disks, [['off', 'aus'], ['activity', 'Plattenzugriffe anzeigen']])}</label>
				</div>
				<p class="note">Die orange USB-LED zeigt den Rettungsmodus und Updates beim Start an und ist nicht einstellbar.</p>
			</div>
		</div>`;
	},

	https() {
		const w = S.web;
		if (!w) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
		const c = w.cert || {};
		const name = w.host || w.cert_host || '';
		const host = name || location.hostname;
		const viaOther = name && location.protocol === "https:" && location.hostname !== name;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">VERBINDUNG</span><span class="tag ml ${location.protocol === 'https:' ? 'ok' : 'warn'}">${location.protocol === 'https:' ? 'diese Seite: HTTPS' : 'diese Seite: HTTP'}</span></div>
				<div style="display:grid;gap:6px">
					<label class="chk"><input type="checkbox" id="opt-https"${w.https ? raw(' checked') : ''}>HTTPS auf Port 443</label>
					<label class="chk"><input type="checkbox" id="opt-redirect"${w.redirect ? raw(' checked') : ''}${w.https ? '' : raw(' disabled')}>HTTP-Aufrufe auf HTTPS umleiten</label>
				</div>
				<dl class="kv" style="margin-top:14px">
					<dt>HTTPS</dt><dd><a href="https://${host}/">https://${host}/</a></dd>
					<dt>HTTP</dt><dd><a href="http://${host}/">http://${host}/</a></dd>
				</dl>
				${viaOther ? html`<p class="note">Diese Seite ist über ${location.hostname} geöffnet. Ohne Zertifikatswarnung: <a href="${location.protocol}//${name}/#/system/network">${location.protocol}//${name}/</a></p>` : ''}
				<form id="f-webhost" style="margin-top:14px">
					<label class="f"><span>NAME DER BOX FÜR LINKS (Z. B. ZU DEN APPS)</span>
						<input name="host" value="${w.host || ''}" placeholder="${w.cert_host || location.hostname}" autocomplete="off" spellcheck="false"></label>
					<p class="note">Leer lassen: Mit eigenem Zertifikat wird der Name daraus genommen, sonst die Adresse, unter der diese Seite geöffnet ist. Der Name muss im Netzwerk auflösbar sein (DNS).</p>
					<div class="acts" style="margin-top:8px"><button class="btn" type="submit">Name speichern</button></div>
				</form>
				<p class="note">Nach einer Änderung startet der Webserver neu; die Seite ist für einen Moment nicht erreichbar.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">ZERTIFIKAT</span>${c.none ? '' : c.selfsigned ? html`<span class="tag warn ml">selbstsigniert</span>` : w.source === 'ca' ? html`<span class="tag ok ml">eigene CA</span>` : w.source === 'acme' ? html`<span class="tag ok ml">Let's Encrypt</span>` : html`<span class="tag ok ml">eigenes Zertifikat</span>`}</div>
				${c.none ? html`<p class="mut" style="margin:0;font-size:13px">Noch kein Zertifikat – es wird beim Einschalten von HTTPS automatisch erstellt.</p>` : html`
				<dl class="kv">
					<dt>Ausgestellt für</dt><dd>${c.subject || '–'}</dd>
					<dt>Aussteller</dt><dd>${c.issuer || '–'}</dd>
					<dt>Gültig ab</dt><dd>${c.from || '–'}</dd>
					<dt>Gültig bis</dt><dd>${c.until || '–'}</dd>
					<dt>Namen</dt><dd>${(c.san || []).map((x) => x.replace(/^(dNSName|iPAddress):/, '')).join(', ') || '–'}</dd>
				</dl>`}
				${c.selfsigned ? html`<p class="note">Browser warnen bei selbstsignierten Zertifikaten einmalig. Die Verbindung ist trotzdem verschlüsselt; für eine Seite ohne Warnung ein eigenes Zertifikat hinterlegen (z. B. von der eigenen Intranet-CA oder Let's Encrypt).</p>` : ''}
				<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="cert-self">Neues selbstsigniertes Zertifikat</button></div>
			</div>
		</div>
		<form class="panel" id="f-cert" style="margin-top:16px">
			<div class="ph"><span class="pt">EIGENES ZERTIFIKAT HINTERLEGEN</span></div>
			<div class="g2">
				<label class="f"><span>ZERTIFIKAT (PEM, GERNE MIT ZWISCHENZERTIFIKATEN)</span>
					<textarea name="cert" rows="8" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----" style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" data-i18n-skip></textarea>
					<input type="file" accept=".pem,.crt,.cer" data-target="cert" style="margin-top:6px"></label>
				<label class="f"><span>PRIVATER SCHLÜSSEL (PEM, OHNE PASSWORT)</span>
					<textarea name="key" rows="8" spellcheck="false" placeholder="-----BEGIN PRIVATE KEY-----" style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" data-i18n-skip></textarea>
					<input type="file" accept=".pem,.key" data-target="key" style="margin-top:6px"></label>
			</div>
			<p class="note">Vor dem Übernehmen wird geprüft, ob Zertifikat und Schlüssel zusammenpassen. Der Schlüssel verlässt die Box nicht.</p>
			<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Zertifikat übernehmen</button></div>
		</form>`;
	},

	power() {
		return html`<h2 class="gh">ENERGIE & RESET</h2><div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">ENERGIE</span></div>
				<div class="acts"><button class="btn" type="button" data-act="reboot">${svg(I.reboot)}Neustart</button>
					<button class="btn danger" type="button" data-act="poweroff">${svg(I.power)}Ausschalten</button></div>
				<p class="note">Beim Ausschalten fährt ShareOS herunter und die Gerätesteuerung schaltet den Strom ab. Einschalten über den Power-Taster.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">WERKSEINSTELLUNGEN</span><span class="tag err ml">löscht Einstellungen</span></div>
				<p class="mut" style="margin:0 0 12px;font-size:13px">Entfernt alle Einstellungen und installierten Pakete aus dem Flash und startet neu. Das System selbst und die Firmware-Version bleiben. Danach gilt wieder das Passwort <code>shareos</code>.</p>
				<button class="btn danger" type="button" data-act="factory">Auf Werkseinstellungen zurücksetzen</button>
			</div>
		</div>
		<h2 class="gh" style="margin-top:22px">ZEITPLAN</h2>
		${powerSchedule()}
		<h2 class="gh" style="margin-top:22px">LÜFTER & LEDS</h2>
		${SYS.hardware()}`;
	},

	network() {
		const n = S.net, i = S.info || {}, e = i.network?.eth0 || {};
		if (!n) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
		const st = n.proto === 'static';
		// prefill the static fields with what DHCP gave, so switching is easy
		const cur = e.ipv4 ? e.ipv4.address : '';
		const curMask = e.ipv4 ? prefixMask(e.ipv4.prefix) : '255.255.255.0';
		const v = (k, d) => (st ? n[k] : '') || d;
		return html`
		${n.pending ? html`<div class="banner">${svg(I.warn)}<span style="flex:1;min-width:240px"><b>Neue Netzwerkeinstellungen warten auf Bestätigung</b> – ohne Bestätigung kehrt die Box in ${n.pending.left} s zu den alten zurück.</span><button class="btn primary" type="button" data-act="net-confirm">Behalten</button></div>` : ''}
		${n.result === 'rolledback' && !n.pending ? html`<div class="banner">${svg(I.warn)}<span style="flex:1">Die letzte Änderung wurde nicht bestätigt; die vorherigen Netzwerkeinstellungen sind wieder aktiv.</span>${closeX('net-dismiss')}</div>` : ''}
		<h2 class="gh">NETZWERK <span>eth0 · ${e.speed ? e.speed + ' Mbit/s' : 'kein Link'}</span></h2>
		<div class="g2">
			<form class="panel" id="f-net">
				<div class="ph"><span class="pt">IPV4</span><span class="tag ml">${st ? 'statisch' : 'DHCP'}</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>ADRESSE</span><select name="proto" id="net-proto">
					<option value="dhcp"${st ? '' : raw(' selected')}>Automatisch (DHCP) – vom Router</option>
					<option value="static"${st ? raw(' selected') : ''}>Feste Adresse</option></select></label></div>
				<div class="fields" id="net-static" style="margin-top:14px"${st ? '' : raw(' hidden')}>
					<label class="f"><span>IP-ADRESSE</span><input name="ipaddr" value="${v('ipaddr', cur)}" inputmode="decimal" placeholder="192.168.1.20"></label>
					<label class="f"><span>SUBNETZMASKE</span><input name="netmask" value="${v('netmask', curMask)}" inputmode="decimal" placeholder="255.255.255.0"></label>
					<label class="f"><span>GATEWAY</span><input name="gateway" value="${v('gateway', e.gateway || '')}" inputmode="decimal" placeholder="192.168.1.1"></label>
					<label class="f"><span>DNS-SERVER (KOMMA-GETRENNT)</span><input name="dns" value="${st ? (n.dns || []).join(', ') : (e.dns || []).join(', ')}" inputmode="decimal" placeholder="192.168.1.1"></label>
				</div>
				<p class="note">Die Änderung gilt sofort. Die Box wartet dann ${n.timeout || 120} Sekunden auf eine Bestätigung von der neuen Adresse – kommt keine, stellt sie die bisherigen Einstellungen wieder her. So sperrst du dich nicht aus.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit" ${n.pending ? 'disabled' : ''}>Übernehmen</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">AKTUELL</span><span class="tag ml ${e.ipv4 ? 'ok' : 'warn'}">${e.ipv4 ? 'verbunden' : 'keine Adresse'}</span></div>
				<dl class="kv">
					<dt>IPv4</dt><dd>${e.ipv4 ? `${e.ipv4.address} / ${e.ipv4.prefix}` : '–'}</dd>
					<dt>Gateway</dt><dd>${e.gateway || '–'}</dd>
					<dt>DNS</dt><dd>${(e.dns || []).join(', ') || '–'}</dd>
					<dt>MAC</dt><dd>${e.mac || '–'}</dd>
					<dt>Verbindung</dt><dd>${e.speed ? e.speed + ' Mbit/s' : '–'}</dd>
					<dt>Gerätename</dt><dd>${i.hostname || '–'} <a href="#/system/general" style="font-size:12px">ändern</a></dd>
				</dl>
			</div>
		</div>
		<h2 class="gh" style="margin-top:22px">HTTPS & ZERTIFIKAT</h2>
		${SYS.https()}
		<h2 class="gh" style="margin-top:22px">DYNDNS</h2>
		${SYS.ddns()}
		<h2 class="gh" style="margin-top:22px">EIGENE ZERTIFIKATE</h2>
		${SYS.ca()}`;
	},

	// dynamic DNS: a name on the internet for the box (shareos-ddns)
	ddns() {
		const d = S.ddns;
		if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
		const p = S.ddnsProv ?? d.provider ?? '', l = d.last;
		const ok = d.enabled && l?.ok, err = d.enabled && l && !l.ok;
		const opt = (v, t) => html`<option value="${v}"${p === v ? raw(' selected') : ''}>${t}</option>`;
		const hostPh = { duckdns: 'meinebox.duckdns.org', dynv6: 'meinebox.dynv6.net', cloudflare: 'nas.example.org', noip: 'meinebox.ddns.net', custom: 'nas.example.org' }[p] || 'meinebox.duckdns.org';
		return html`<div class="g2">
			<form class="panel" id="f-ddns">
				<div class="ph"><span class="pt">ANBIETER</span><span class="tag ml ${d.enabled ? 'ok' : ''}">${d.enabled ? 'aktiv' : 'aus'}</span></div>
				<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>DynDNS aktualisieren</label>
				<div class="fields" style="grid-template-columns:1fr;margin-top:12px">
					<label class="f"><span>ANBIETER</span><select name="provider" id="ddns-prov">
						${opt('', '– wählen –')}${opt('duckdns', 'DuckDNS')}${opt('dynv6', 'dynv6')}${opt('cloudflare', 'Cloudflare')}${opt('noip', 'No-IP')}${opt('custom', 'Eigene Adresse (dyndns2)')}</select></label>
					<label class="f"><span>NAME</span><input name="host" value="${d.host || ''}" placeholder="${hostPh}" autocomplete="off" spellcheck="false"></label>
					<label class="f"${p === 'noip' || p === 'custom' ? '' : raw(' hidden')}><span>BENUTZER</span><input name="user" value="${d.user || ''}" autocomplete="off" spellcheck="false"></label>
					<label class="f"><span>${p === 'cloudflare' ? 'API-TOKEN (ZONE:LESEN, DNS:BEARBEITEN)' : p === 'noip' || p === 'custom' ? 'PASSWORT' : 'TOKEN'}</span>${d.token_set ? html`<input name="token" type="password" placeholder="gespeichert – leer lassen behält ihn" autocomplete="new-password">` : html`<input name="token" type="password" autocomplete="new-password">`}</label>
					<label class="f"${p === 'custom' ? '' : raw(' hidden')}><span>UPDATE-ADRESSE ({host} {ip} {ip6})</span><input name="url" value="${d.url || ''}" placeholder="https://dyndns.example.net/nic/update?hostname={host}&amp;myip={ip}" autocomplete="off" spellcheck="false"></label>
				</div>
				<div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
					<label class="chk"><input type="checkbox" name="ipv4"${d.ipv4 !== false ? raw(' checked') : ''}>IPv4</label>
					<label class="chk"><input type="checkbox" name="ipv6"${d.ipv6 ? raw(' checked') : ''}>IPv6</label>
				</div>
				<p class="note">Die Box meldet ihre öffentliche Adresse alle 5 Minuten, wenn sie sich geändert hat. Viele Anschlüsse (DS-Lite, Glasfaser, Mobilfunk) haben keine eigene IPv4-Adresse – dann IPv6 nehmen. Für Zugriff von außen muss der Router den Port weiterleiten (bzw. bei IPv6 freigeben).</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button>
					${d.enabled ? html`<button class="btn" type="button" data-act="ddns-now">Jetzt aktualisieren</button>` : ''}</div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">ZUSTAND</span>${ok ? html`<span class="tag ok ml">aktuell</span>` : err ? html`<span class="tag err ml">Fehler</span>` : ''}</div>
				${d.enabled && l ? html`<dl class="kv">
					<dt>Name</dt><dd>${l.host || d.host || '–'}</dd>
					<dt>IPv4</dt><dd>${l.ip4 || '–'}</dd>
					<dt>IPv6</dt><dd style="word-break:break-all">${l.ip6 || '–'}</dd>
					<dt>Zuletzt gemeldet</dt><dd>${fmtTime(l.sent)}</dd>
					<dt>Zuletzt geprüft</dt><dd>${fmtTime(l.checked)}</dd>
				</dl>
				${err ? html`<p class="note" style="color:var(--red)">${l.error}</p>` : ''}`
				: html`<p class="mut" style="margin:0;font-size:13px">${d.enabled ? 'Noch keine Meldung – kommt gleich.' : 'DynDNS ist aus.'}</p>`}
			</div>
		</div>`;
	},

	// own certificate authority and Let's Encrypt
	ca() {
		const c = S.ca, a = S.acme || {}, d = S.ddns || {};
		if (!c) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
		const leOk = d.enabled && (d.provider === 'duckdns' || d.provider === 'cloudflare') && d.host;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">ZERTIFIZIERUNGSSTELLE (CA)</span>${c.web ? html`<span class="tag ok ml">diese Box nutzt sie</span>` : ''}</div>
				${c.exists ? html`<dl class="kv">
					<dt>Name</dt><dd>${c.subject || '–'}</dd>
					<dt>Gültig bis</dt><dd>${c.until || '–'}</dd>
					<dt>Fingerabdruck</dt><dd style="word-break:break-all;font-size:11px">${c.fingerprint || '–'}</dd>
				</dl>
				<div class="acts" style="margin-top:14px">
					<button class="btn" type="button" data-act="ca-root">${svg(I.dl)}Stammzertifikat</button>
					<button class="btn${c.web ? '' : ' primary'}" type="button" data-act="ca-web">${c.web ? 'Zertifikat der Box neu ausstellen' : 'Für diese Box verwenden'}</button>
				</div>
				<p class="note">Das Stammzertifikat einmal auf PC und Handy als vertrauenswürdig installieren (Windows: Doppelklick → „Vertrauenswürdige Stammzertifizierungsstellen“, Android/iOS: Einstellungen → Sicherheit). Danach sind alle Zertifikate dieser CA ohne Warnung – für die Box und andere Geräte im Heimnetz.</p>`
				: html`<p class="mut" style="margin:0 0 12px;font-size:13px">Eine eigene Zertifizierungsstelle stellt Zertifikate für die Box und andere Geräte im Heimnetz aus (z. B. <code>*.home.lan</code>). Ihr Stammzertifikat wird einmal auf den Geräten installiert – danach gibt es keine Zertifikatswarnungen mehr.</p>
				<div class="acts"><button class="btn primary" type="button" data-act="ca-init">Zertifizierungsstelle anlegen</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">LET'S ENCRYPT</span>${a.active ? html`<span class="tag ok ml">aktiv${a.staging ? ' (Test)' : ''}</span>` : ''}</div>
				${a.running ? html`<div class="empty" style="padding:8px 0"><div class="spin" style="margin:0"></div><span>Zertifikat wird geholt – das dauert bis zu 3 Minuten …</span></div>`
				: a.active ? html`<dl class="kv"><dt>Name</dt><dd>${a.name || '–'}</dd><dt>Gültig bis</dt><dd>${a.until || '–'}</dd></dl>
					<p class="note">Wird täglich geprüft und 30 Tage vor Ablauf erneuert.</p>
					<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="acme-off">Abschalten</button></div>`
				: leOk ? html`<form id="f-acme">
					<p class="mut" style="margin:0 0 12px;font-size:13px">Ein Zertifikat für <b>${d.provider === 'duckdns' && !/\.duckdns\.org$/.test(d.host) ? d.host + '.duckdns.org' : d.host}</b>, dem alle Browser vertrauen. Die Prüfung läuft über einen DNS-Eintrag beim DynDNS-Anbieter – kein Port muss offen sein.</p>
					<label class="f"><span>E-MAIL (OPTIONAL, FÜR HINWEISE VON LET'S ENCRYPT)</span><input name="email" type="email" value="${a.email || ''}" autocomplete="off"></label>
					<label class="chk" style="margin-top:10px"><input type="checkbox" name="staging">Testmodus (Test-CA, Browser warnen)</label>
					<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Zertifikat holen</button></div>
				</form>`
				: html`<p class="mut" style="margin:0;font-size:13px">Braucht DynDNS mit DuckDNS oder Cloudflare (oben).</p>`}
				${a.error && !a.running ? html`<p class="note" style="color:var(--red)">${a.error}</p>` : ''}
			</div>
		</div>
		${c.exists ? html`<form class="panel" id="f-ca-issue" style="margin-top:16px">
			<div class="ph"><span class="pt">ZERTIFIKAT FÜR EIN ANDERES GERÄT</span></div>
			<div class="fields">
				<label class="f"><span>NAME</span><input name="name" placeholder="router" autocomplete="off" spellcheck="false" maxlength="63"></label>
				<label class="f"><span>HOSTNAMEN UND IP-ADRESSEN (KOMMA-GETRENNT)</span><input name="hosts" placeholder="router.home.lan, 192.168.1.1" autocomplete="off" spellcheck="false"></label>
			</div>
			<p class="note">Gültig 825 Tage. Auch Platzhalter wie <code>*.home.lan</code> sind möglich. Zertifikat und Schlüssel herunterladen und im Gerät eintragen.</p>
			<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Ausstellen</button></div>
			${c.certs?.length ? html`<div class="tw" style="margin-top:16px"><table class="t" style="min-width:560px"><thead><tr><th>NAME</th><th>HOSTNAMEN</th><th>GÜLTIG BIS</th><th></th></tr></thead><tbody>
				${c.certs.map((x) => html`<tr><td>${x.name}</td><td style="word-break:break-all">${x.hosts.join(', ')}</td><td>${x.until}</td>
					<td style="white-space:nowrap"><button class="btn sm ghost" type="button" data-act="ca-dl" data-id="${x.name}" data-kind="crt">Zertifikat</button><button class="btn sm ghost" type="button" data-act="ca-dl" data-id="${x.name}" data-kind="key">Schlüssel</button><button class="btn sm ghost" type="button" data-act="ca-del" data-id="${x.name}">Löschen</button></td></tr>`)}
			</tbody></table></div>` : ''}
		</form>` : ''}`;
	},

	terminal() {
		const t = S.term;
		if (!S.sysapps) { S.sysapps = []; rpc('shareos.apps', 'installed', {}).then((r) => { S.sysapps = (r.apps || []).filter((a) => a.type === 'system'); if (S.sysapps.length && !S.term) renderMain(); }).catch(() => {}); }
		return html`<div class="panel">
			<div class="ph"><span class="pt">TERMINAL</span><span class="tag warn ml">root</span>
				${t ? html`<button class="btn sm ghost" type="button" data-act="term-window">In eigenem Fenster ↗</button><button class="btn sm ghost" type="button" data-act="term-close">Beenden</button>` : ''}</div>
			${t?.window ? html`<p class="mut" style="margin:0 0 12px">Das Terminal läuft in einem eigenen Fenster.</p>
				<div class="acts"><button class="btn" type="button" data-act="term-open">Hier anzeigen</button></div>`
			: t ? html`<iframe class="termframe" src="${termUrl(t)}" title="Terminal" allow="clipboard-read; clipboard-write"></iframe>`
				: html`<p class="mut" style="margin:0 0 12px">Eine Shell als <b>root</b> direkt auf der Box – für Diagnose und Handarbeit (BusyBox, uci, logread, mdadm, smartctl …).</p>
				${sysApps().length ? html`<p class="mut" style="margin:0 0 12px"><span>Aus System-Apps:</span> ${sysApps().map((a, i) => html`${i ? ' · ' : ''}${sysCmds(a)}`)}</p>` : ''}
				<div class="acts"><button class="btn primary" type="button" data-act="term-open">Terminal öffnen</button><button class="btn" type="button" data-act="term-window">In eigenem Fenster ↗</button></div>`}
			<p class="note">Die Sitzung gilt für ein Fenster und endet, wenn es geschlossen wird – ein eigenes Fenster bekommt eine neue Sitzung. Vorsicht: Befehle als root wirken sofort und ohne Papierkorb.</p>
		</div>`;
	},

	logs() {
		return html`<div class="panel">
			<div class="ph"><span class="pt">PROTOKOLL</span>
				<div class="acts ml"><select id="log-src" class="btn sm ghost" aria-label="Quelle">${[['system', 'System (syslog)'], ['kernel', 'Kernel (dmesg)'], ...(S.bootlogs || []).map((l) => ['boot:' + l.name, 'Start-Protokoll ' + bootlogTime(l.name)])].map(([v, t]) => html`<option value="${v}"${S.logSrc === v ? raw(' selected') : ''}>${t}</option>`)}</select>
				<button class="btn sm" type="button" data-act="log">Aktualisieren</button></div></div>
			<pre class="logbox" id="logbox">lade …</pre>
		</div>`;
	},

	appearance() {
		const names = { green: 'Grün', red: 'Rot', blue: 'Blau', white: 'Weiß' };
		return html`<div class="lookcols"><div class="panel" style="max-width:560px">
			<div class="ph"><span class="pt">DARSTELLUNG</span><span class="tag ml">gilt für alle</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>HELL ODER DUNKEL</span><select id="opt-theme">
				${[['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'Wie das Betriebssystem (automatisch)']].map(([v, t]) => html`<option value="${v}"${S.theme === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<div class="pt" style="margin:14px 0 8px">AKZENTFARBE</div>
			<div class="row">${Object.keys(names).map((c) => html`<button class="sw c-${c}${S.accent === c ? ' on' : ''}" type="button" data-act="accent" data-c="${c}" aria-label="Akzentfarbe ${names[c]}" aria-pressed="${S.accent === c}" title="${names[c]}"><i></i></button>`)}</div>
			<p class="note">Logo und Browser-Symbol nehmen die Akzentfarbe an. Die Einstellung gilt für alle, auch für die Anmeldeseite.</p>
			<div style="display:grid;gap:6px;margin-top:14px">
				<label class="chk"><input type="checkbox" id="opt-scan"${S.scan ? raw(' checked') : ''}>Scanlines (nur in diesem Browser)</label>
			</div>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">FAV APPS</span><span class="tag ml">nur für dich</span></div>
			<div style="display:grid;gap:6px">${favBarOpt()}</div>
			<p class="note">Mit dem Stern auf einer App-Kachel wird sie zum Favoriten. Die Leiste steht über „Status“ in der Übersicht und über den installierten Apps.</p>
		</div>
		${chipsPanel()}
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">SPRACHE</span><span class="tag ml">gilt für alle</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>SPRACHE DER OBERFLÄCHE</span><select id="opt-lang" data-i18n-skip>
				${(S.languages || [{ code: LANG, name: LANG }]).map((l) => html`<option value="${l.code}"${l.code === LANG ? raw(' selected') : ''}>${l.name}</option>`)}
			</select></label></div>
			<p class="note">Weitere Sprachen: eine Datei in <code>/www/i18n/</code> – siehe docs/TRANSLATING.md.</p>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">BEREICHE</span><span class="tag ml">gilt für alle</span></div>
			<div style="display:grid;gap:6px">
				${[['apps', 'Apps (App-Store, Web-Apps, Aufgaben der Apps)'], ['cloud', 'Cloud (Abgleich mit Cloud-Speichern)'], ['paperless', 'Paperless (Eingangsordner für Paperless-ngx)']].map(([k, t]) =>
					html`<label class="chk"><input type="checkbox" class="opt-area" data-area="${k}"${tabOn(k) ? raw(' checked') : ''}>${t}</label>`)}
			</div>
			<p class="note">Ausgeschaltet: Der Reiter verschwindet, auch für Benutzer in „Mein ShareOS“, und die Hintergrundarbeit ruht (App-Webserver und App-Aufgaben, geplante Cloud-Aufträge, Paperless-Eingänge). Einstellungen und Daten bleiben erhalten; einschalten macht alles wieder an.</p>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">LOGO</span><span class="tag ml">gilt für alle</span></div>
			<label class="chk"><input type="checkbox" id="opt-logo"${S.logo ? raw(' checked') : ''}>ShareOS-Logo anzeigen (aus: nur Schriftzug)</label>
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
					<dt>Stufe</dt><dd>${r.stage || '–'}</dd>
					<dt>Gerät</dt><dd>${i.board?.name || i.model || '–'}${i.board?.id && i.board.id !== 'unknown' && !i.board.tested ? html` <span class="tag warn" title="ShareOS wurde auf diesem Modell noch nicht auf echter Hardware getestet.">noch ungetestet</span>` : ''}</dd>
					<dt>Firmware-Name</dt><dd>${i.board?.fwname || r.fwname || '–'}</dd>
					<dt>Kernel</dt><dd>Linux ${i.kernel || '–'}</dd>
					<dt>Start aus</dt><dd>${i.boot || '–'}</dd>
				</dl>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">PROJEKT</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6">ShareOS ist eine freie Firmware für D-Link-NAS, hervorgegangen aus Alt-F. Basis: buildroot, Linux, BusyBox; Bedienkonzept nach OpenWrt (UCI, ubus, rpcd, ucode). Lizenz GPLv2.</p>
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
				try { S.noteCfg = await rpc('shareos.notify', 'set', a); toast('Gespeichert.'); renderMain(); }
				catch (err) { toast('Meldungen: ' + err.message, true); }
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
				try { setTime(await rpc('shareos.time', 'set', { timezone: f.tz.value, ntp: f.ntp.checked, servers })); toast('Gespeichert.'); renderMain(); }
				catch (err) { toast('Zeit: ' + err.message, true); }
			});
			$('#f-clock')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const sec = fromLocalInput(e.target.dt.value, S.time.timezone);
				if (sec == null) { toast('Ungültige Uhrzeit.', true); return; }
				try { setTime(await rpc('shareos.time', 'set_clock', { time: sec })); toast('Uhrzeit gesetzt.'); renderMain(); }
				catch (err) { toast('Uhrzeit: ' + err.message, true); }
			});
		}
		if (sub === 'network') {
			if (!S.net) loadNet();
			$('#net-proto')?.addEventListener('change', (e) => { $('#net-static').hidden = e.target.value !== 'static'; });
			$('#f-net')?.addEventListener('submit', netSubmit);
		}
		if (sub === 'power') {
			if (!S.hw) loadHw();
			if (!S.pwr) rpc('shareos.system', 'power_schedule').then((r) => { S.pwr = r; if (S.route.sub === 'power') renderMain(); }).catch((e) => toast('Zeitplan: ' + e.message, true));
			$('#f-power')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, days = {};
				for (const [d] of PWR_DAYS) days[d] = { on: f['on_' + d]?.value || '', off: f['off_' + d].value || '' };
				try {
					S.pwr = await rpc('shareos.system', 'power_schedule_set', { enabled: f.enabled.checked, days });
					S.pwrEdit = false;
					toast(!S.pwr.enabled ? 'Zeitplan gespeichert (ausgeschaltet).' : S.pwr.next_on ? `Zeitplan gespeichert – die Box schaltet sich am ${fmtPwr(S.pwr.next_on)} ein.` : 'Zeitplan gespeichert – kein Einschalten geplant.');
					renderMain();
				}
				catch (err) { toast('Zeitplan: ' + err.message, true); }
			});
			document.querySelectorAll('#f-fan input[name=preset]').forEach((r) => r.addEventListener('change', () => { $('#fan-custom').hidden = r.value !== 'custom'; }));
			$('#f-fan')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, preset = $('input[name=preset]:checked', f).value;
				try {
					const r = await rpc('shareos.hw', 'set_fan', { preset, off_temp: +f.off_temp.value, full_temp: +f.full_temp.value, half_temp: +f.half_temp.value });
					S.hw.fan = r.fan; toast('Lüfter gespeichert.');
				} catch (err) { toast('Lüfter: ' + err.message, true); }
			});
			for (const k of ['status', 'power', 'disks'])
				$('#led-' + k)?.addEventListener('change', async (e) => {
					try { const r = await rpc('shareos.hw', 'set_led', { [k]: e.target.value }); S.hw.led = r.led; toast('LED gespeichert.'); }
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
				if (v.enabled && (!v.provider || !v.host)) { toast('Bitte Anbieter und Namen angeben.', true); return; }
				try {
					const r = await rpc('shareos.web', 'ddns_set', v);
					S.ddnsProv = null;
					toast(r.pending ? 'Gespeichert – die Adresse wird gemeldet.' : 'Gespeichert.');
					await loadNetExtra(); renderMain();
					if (r.pending) setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 6000);
				} catch (err) { toast('DynDNS: ' + err.message, true); }
			});
			$('#f-ca-issue')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, hosts = f.hosts.value.split(/[\s,;]+/).filter(Boolean);
				if (!f.name.value.trim() || !hosts.length) { toast('Bitte Name und Hostnamen angeben.', true); return; }
				try { await rpc('shareos.web', 'ca_issue', { name: f.name.value.trim(), hosts }); toast('Zertifikat ausgestellt.'); await loadNetExtra(); renderMain(); }
				catch (err) { toast('Zertifikat: ' + err.message, true); }
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
					toast('Name gespeichert.'); renderMain();
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
					toast('Zertifikat übernommen.');
					afterWebRestart();
				} catch (err) { toast('Zertifikat: ' + err.message, true); btn.disabled = false; }
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
						toast('Hochgeladen – das Paket wird geprüft.');
						S.updPending = { state: 'verifying', until: Date.now() + 15000 };
						S.upd = { ...S.upd, state: 'verifying', release: { tag: 'local', version: file.name.replace(/^ShareOS-|-DNS-.*$/g, '') } };
						renderMain();
						refreshUpdateStatus();
					} catch (err) { toast('Firmware-Datei: ' + err.message, true); }
					btn.disabled = false;
					return;
				}
				try {
					const t = await rpc('shareos.update', 'bin_ticket');
					await fbSend(t.url, file, () => {});
					const i = await rpc('shareos.update', 'bin_info');
					const kind = { shareos: 'ShareOS', altf: 'Alt-F', other: 'andere Firmware' }[i.kind] || i.kind;
					box.innerHTML = html`<dl class="kv" style="margin-top:10px"><dt>Art</dt><dd><b>${kind}</b></dd><dt>Kernel</dt><dd>${i.kernel}</dd>
						<dt>Größe</dt><dd>${fmtBytes(+i.kernel_size)} + ${fmtBytes(+i.initramfs_size)}</dd></dl>
						${i.kind === 'altf' || i.kind === 'other' ? html`<p class="note" style="color:var(--amber)">Danach startet ${kind}. Die Zusatzpakete von Alt-F fehlen dann – in Alt-F dieselbe Datei noch einmal über dessen Firmware-Seite flashen. Zurück zu ShareOS: die ShareOS-.bin in Alt-F flashen, System und Einstellungen sind noch da.</p>` : ''}
						<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="bin-write">Einspielen</button></div>`.s;
					$('#bin-write').addEventListener('click', async () => {
						if (!await confirmDlg(`${kind} einspielen?`, 'Kernel und Startsystem werden ersetzt und geprüft. Box während des Schreibens nicht ausschalten.', 'Einspielen', true)) return;
						cover('Firmware wird geschrieben', 'Kernel und Startsystem – bitte warten, nicht ausschalten');
						try {
							await rpc('shareos.update', 'bin_write', { confirm: true });
							uncover();
							if (await confirmDlg('Geschrieben', `${kind} ist im Flash. Jetzt neu starten?`, 'Neu starten')) {
								try { await rpc('shareos.system', 'reboot'); } catch (err) { }
								stopPolling();
								if (i.kind === 'shareos') waitForBox('Neustart läuft', `${kind} startet`);
								else cover('Neustart läuft', `${kind} startet – dessen Oberfläche ist gleich unter ${location.hostname} erreichbar (Port 80).`);
							}
						} catch (err) { uncover(); toast('Einspielen: ' + err.message, true); }
					});
				} catch (err) { box.innerHTML = ''; toast('Firmware-Datei: ' + err.message, true); }
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
				if (await confirmDlg('Neuen Schlüssel erzeugen?', 'Die bisherige Adresse funktioniert danach nicht mehr – Widgets müssen die neue bekommen.', 'Erzeugen', true)) widgetSet({ renew: true });
			});
			$('#widget-copy')?.addEventListener('click', () => copyText($('#widget-url').value));
			$('#f-host').addEventListener('submit', async (e) => {
				e.preventDefault();
				try {
					const r = await rpc('shareos.system', 'set_hostname', { hostname: e.target.hostname.value.trim() });
					toast(r.cert_renewed ? 'Hostname gespeichert. Das HTTPS-Zertifikat wurde für den neuen Namen neu ausgestellt – der Browser fragt einmal neu nach.' : 'Hostname gespeichert.');
					tick();
				}
				catch (err) { toast('Hostname: ' + err.message, true); }
			});
			$('#f-backup').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, btn = $('button[type=submit]', f);
				btn.disabled = true;
				try {
					const r = await rpc('shareos.backup', 'export', { password: f.pw.value });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(new Blob([r.content], { type: 'application/json' }));
					a.download = r.filename;
					document.body.append(a); a.click(); a.remove();
					setTimeout(() => URL.revokeObjectURL(a.href), 5000);
					f.reset();
					toast(r.encrypted ? 'Verschlüsselte Sicherung heruntergeladen.' : 'Sicherung heruntergeladen.');
				} catch (err) { toast('Sichern: ' + err.message, true); }
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
						<dt>Gerät</dt><dd>${p.host || '–'}</dd>
						<dt>Erstellt</dt><dd>${p.created ? new Date(p.created * 1000).toLocaleString(LOC) : '–'}</dd>
						<dt>ShareOS</dt><dd>${p.version || '–'}</dd>
						<dt>Benutzerkonten</dt><dd>${p.users.join(', ') || '–'}</dd>
						<dt>Freigaben</dt><dd>${p.shares.join(', ') || '–'}</dd>
						<dt>Zertifikat</dt><dd>${p.certificate ? 'ja' : 'nein'}</dd></dl>
						<p class="note" style="color:var(--amber)">Beim Wiederherstellen werden die aktuellen Einstellungen, Benutzer und Freigaben ersetzt. Danach ist ein Neustart nötig. Daten auf den Laufwerken bleiben unberührt.</p>
						<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="restore-apply">Wiederherstellen</button></div>`.s;
					$('#restore-apply').addEventListener('click', async () => {
						if (!await confirmDlg('Einstellungen wiederherstellen?', 'Die aktuellen Einstellungen, Benutzer und Freigaben werden durch die Sicherung ersetzt.', 'Wiederherstellen', true)) return;
						try {
							await rpc('shareos.backup', 'restore', { content, password: f.pw.value, apply: true });
							if (await confirmDlg('Wiederhergestellt', 'Die Einstellungen sind zurückgespielt. Jetzt neu starten, damit alles gilt?', 'Neu starten')) {
								try { await rpc('shareos.system', 'reboot'); } catch (err) { }
								stopPolling();
								waitForBox('Neustart läuft', 'ShareOS startet neu');
							}
						} catch (err) { toast('Wiederherstellen: ' + err.message, true); }
					});
				} catch (err) {
					box.innerHTML = '';
					toast(err.message === 'password required' ? 'Die Sicherung ist verschlüsselt – bitte das Passwort eingeben.' : 'Sicherung: ' + err.message, true);
				}
			});
			$('#f-pass').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				if (f.p1.value !== f.p2.value) { toast('Die Passwörter stimmen nicht überein.', true); return; }
				try { await rpc('shareos.system', 'set_password', { password: f.p1.value }); f.reset(); toast('Passwort geändert.'); }
				catch (err) { toast('Passwort: ' + err.message, true); }
			});
		}
		if (sub === 'appearance') {
			$('#opt-theme').addEventListener('change', (e) => { S.theme = e.target.value; applyTheme(); renderHeader(); renderMain(); saveLook({ theme: S.theme }); });
			$('#opt-lang').addEventListener('change', async (e) => {
				try {
					await rpc('shareos.ui', 'set', { lang: e.target.value });
					try { localStorage.setItem('shareos.lang', e.target.value); } catch (err) { }
					location.reload();
				} catch (err) { toast('Sprache: ' + err.message, true); }
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
					S.areas = r.areas; renderTabs(); toast(on ? 'Bereich eingeschaltet.' : 'Bereich ausgeschaltet.');
				} catch (err) { e.target.checked = !on; toast('Bereich: ' + err.message, true); }
			}));
		}
		if (sub === 'firmware') {
			$('#channel')?.addEventListener('change', async (e) => {
				try {
					await rpc('uci', 'set', { config: 'shareos', section: 'update', values: { channel: e.target.value } });
					await rpc('uci', 'commit', { config: 'shareos' });
					checkUpdates();
				} catch (err) { toast('Kanal: ' + err.message, true); }
			});
		}
	},
	storage() {
		if (S.route.sub === 'snapshots') { snapAfter(); return; }
		if (!S.stActive) loadStorage();
		$('#smart-sched')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'smart_schedule', { mode: e.target.value }); S.storage.smart_schedule = e.target.value; toast('Zeitplan gespeichert.'); }
			catch (err) { toast('Selbsttest: ' + err.message, true); }
		});
		$('#f-usbcopy')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { S.storage.usb_copy = await rpc('shareos.storage', 'usb_copy_config', { enabled: f.enabled.checked, volume: f.volume.value, path: f.path.value.trim() }); toast('USB-Taste gespeichert.'); renderMain(); }
			catch (err) { toast('USB-Taste: ' + err.message, true); }
		});
		$('#spindown')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'spindown', { minutes: +e.target.value }); toast('Ruhezustand gespeichert.'); }
			catch (err) { toast('Ruhezustand: ' + err.message, true); }
		});
	},
	cloud() {
		if (S.cloud?.scope !== 'admin') { loadCloud('admin'); return; }
		cloudAfter('admin');
	},
	paperless() {
		if (!S.pl || !S.acc || !S.shares) { loadPaperless(); return; }
		const kind = $('#f-inbox select[name=kind]');
		const syncKind = () => { if (!kind) return; $('#ib-owner').hidden = kind.value !== 'user'; $('#ib-share').hidden = kind.value !== 'share'; };
		kind?.addEventListener('change', syncKind); syncKind();
		$('#f-pl')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.paperless', 'set_global', { url: f.url.value.trim(), interval: +f.interval.value, after: f.after.value, enabled: f.enabled.checked }); toast('Gespeichert.'); loadPaperless(); }
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
			try { await rpc('shareos.paperless', 'inbox_set', args); S.plEdit = null; toast(`Eingang „${name}“ gespeichert.`); loadPaperless(); }
			catch (err) { toast('Eingang: ' + err.message, true); }
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
		$('#f-share')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, rw = [], ro = [];
			document.querySelectorAll('#f-share select.acl').forEach((s2) => { if (s2.value === 'rw') rw.push(s2.dataset.tag); if (s2.value === 'ro') ro.push(s2.dataset.tag); });
			const args = { name: f.name.value.trim().toLowerCase(), volume: f.volume.value, path: f.path.value.trim() || f.name.value.trim().toLowerCase(), comment: f.comment.value.trim(),
				smb: f.smb.checked, guest: f.guest.checked, nfs: f.nfs.checked, nfs_rw: f.nfs_rw.checked,
				nfs_hosts: f.nfs_hosts.value.split(/[\s,;]+/).filter(Boolean), rw, ro };
			if (args.nfs && !args.nfs_hosts.length) { toast('Für NFS mindestens einen Client (IP oder Netz) eintragen.', true); return; }
			try { S.shares = await rpc('shareos.shares', 'set', args); S.shEdit = null; toast(`Freigabe „${args.name}“ gespeichert.`); renderMain(); }
			catch (err) { toast('Freigabe: ' + err.message, true); }
		});
		$('#f-user')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, isNew = S.uEdit.mode === 'new';
			const args = { name: f.name.value.trim().toLowerCase(), fullname: f.fullname.value.trim(), role: f.role.value, home: f.home.value,
				quota: Math.max(0, Math.round(+f.quota.value || 0)) * 1000, web: f.web.checked, cloud: f.cloud.checked, files: f.files.checked,
				groups: [...document.querySelectorAll('#f-user .u-group:checked')].map((x) => x.value) };
			if (isNew) {
				if (f.p1.value !== f.p2.value) { toast('Die Passwörter stimmen nicht überein.', true); return; }
				args.password = f.p1.value;
			}
			try { S.acc = await rpc('shareos.accounts', isNew ? 'add' : 'set', args); S.uEdit = null; toast(`Benutzer „${args.name}“ ${isNew ? 'angelegt' : 'gespeichert'}.`); renderMain(); }
			catch (err) { toast('Benutzer: ' + err.message, true); }
		});
	},
	services() {
		if (S.route.sub === 'dlna') { dlnaAfter(); return; }
		if (S.route.sub === 'printer') { printerAfter(); return; }
		if (S.route.sub === 'ups') { upsAfter(); return; }
		if (!S.services) loadServices();
		document.querySelectorAll('.as-toggle').forEach((c) => c.addEventListener('change', async () => {
			c.disabled = true;
			try {
				const r = await rpc('shareos.service', 'autostart', { name: c.dataset.name, enabled: c.checked });
				const s = S.services.find((x) => x.name === r.name);
				if (s) s.autostart = r.autostart;
				toast(`${r.name}: ${r.autostart ? 'startet beim Einschalten' : 'startet nicht mehr beim Einschalten'}`);
			} catch (err) { c.checked = !c.checked; toast(err.message, true); }
			c.disabled = false;
		}));
	},
	overview() {
		if (!S.services) loadServices();
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
	try { S.noteCfg = await rpc('shareos.notify', 'get'); } catch (e) { toast('Meldungen: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'notifications') renderMain();
}

async function loadTime() {
	try {
		const [t, z] = await Promise.all([rpc('shareos.time', 'get'), S.zones ? null : rpc('shareos.setup', 'zones')]);
		setTime(t); if (z) S.zones = z.zones;
	} catch (e) { toast('Zeit: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'time') renderMain();
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
	try { S.net = await rpc('shareos.net', 'get'); } catch (e) { toast('Netzwerk: ' + e.message, true); }
	if (S.route.sub === 'network') renderMain();
	if (S.net?.pending) { clearTimeout(S.netTimer); S.netTimer = setTimeout(() => { S.net = null; loadNet(); }, 5000); }
}

// reaching the box after a network change is the confirmation
async function netAutoConfirm() {
	try {
		const n = await rpc('shareos.net', 'get');
		if (!n.pending) return;
		await rpc('shareos.net', 'confirm');
		toast('Neue Netzwerkeinstellungen bestätigt.');
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
		? `Die Box holt sich ihre Adresse vom Router. Sie ist danach eventuell unter einer anderen Adresse erreichbar (im Router nachsehen). Wird die Änderung nicht innerhalb von ${t} Sekunden von der Box aus bestätigt, gelten wieder die bisherigen Einstellungen.`
		: moves ? `Die Box wechselt auf ${target}. Diese Seite öffnet danach die neue Adresse und bestätigt die Änderung. Klappt das nicht, gelten nach ${t} Sekunden wieder die bisherigen Einstellungen.`
		: `Die Netzwerkeinstellungen werden übernommen und von dieser Seite bestätigt. Klappt das nicht, gelten nach ${t} Sekunden wieder die bisherigen Einstellungen.`;
	if (!await confirmDlg('Netzwerk ändern?', text, 'Übernehmen')) return;
	try { await rpc('shareos.net', 'set', args); } catch (err) { toast('Netzwerk: ' + err.message, true); return; }
	stopPolling();
	if (moves) {
		cover('Netzwerk wird umgestellt', `neue Adresse ${target}`);
		const url = `${location.protocol}//${target}${location.port ? ':' + location.port : ''}/#confirm=${S.sid}`;
		setTimeout(() => { location.href = url; }, 6000);
		return;
	}
	// same address (or DHCP): wait until this page reaches the box again, then confirm
	cover('Netzwerk wird neu gestartet', 'warte auf die Box');
	const t0 = Date.now();
	await new Promise((r) => setTimeout(r, 5000));
	for (;;) {
		try {
			await rpc('shareos.net', 'confirm');
			uncover(); toast('Neue Netzwerkeinstellungen bestätigt.');
			S.net = null; startPolling(); renderMain();
			return;
		} catch (err) { }
		const sec = Math.round((Date.now() - t0) / 1000);
		const el = $('#cover-text');
		if (el) el.textContent = sec > t ? 'Keine Verbindung – die Box sollte die alten Einstellungen wiederhergestellt haben. Seite neu laden.'
			: `warte auf die Box (${sec} s)${proto === 'dhcp' && sec > 20 ? ' – nicht erreichbar? Neue Adresse im Router nachsehen und dort anmelden.' : ''}`;
		await new Promise((r) => setTimeout(r, 3000));
	}
}

/* ---------- first-run wizard -------------------------------------------------- */

const FR_STEPS = ['Sprache', 'Alt-F', 'Passwort', 'Name & Zeit', 'Updates', 'Fertig'];

async function checkFirstRun(force = false) {
	try {
		const st = await rpc('shareos.setup', 'status');
		if (st.done && !force) return;
		const [z, a] = await Promise.all([rpc('shareos.setup', 'zones'), rpc('shareos.setup', 'altf').catch(() => ({ found: false }))]);
		let step = 0;
		try { step = +(sessionStorage.getItem('shareos.frstep') || 0); } catch (e) { }
		S.fr = { step, st, zones: z.zones, altf: a, use_altf: !!a.found, hostname: a.found && a.hostname ? a.hostname : st.hostname,
			timezone: a.found && a.timezone && z.zones.includes(a.timezone) ? a.timezone : st.timezone, channel: st.channel, password: '' };
		renderMain();
	} catch (e) { /* not fatal: the box works without the wizard */ }
}

function frStepVisible(k) { return k !== 1 || S.fr.altf.found; }

function firstRunView() {
	const f = S.fr, a = f.altf;
	const steps = FR_STEPS.map((n, k) => [n, k]).filter(([, k]) => frStepVisible(k));
	let body;
	if (f.step === 0) {
		body = html`<p style="margin:0 0 14px;font-size:14px">Willkommen bei ShareOS. In wenigen Schritten ist die Box eingerichtet; alles lässt sich später unter <b>System</b> ändern.</p>
			<div class="fields" style="grid-template-columns:minmax(0,320px)"><label class="f"><span>SPRACHE DER OBERFLÄCHE</span><select id="fr-lang" data-i18n-skip>
				${(S.languages || [{ code: LANG, name: LANG }]).map((l) => html`<option value="${l.code}"${l.code === LANG ? raw(' selected') : ''}>${l.name}</option>`)}</select></label></div>`;
	} else if (f.step === 1) {
		body = html`<p style="margin:0 0 12px;font-size:13px">Auf dieser Box wurden Einstellungen von <b>Alt-F</b> gefunden (${a.date || a.file}).</p>
			<dl class="kv" style="max-width:560px">
				${a.hostname ? html`<dt>Gerätename</dt><dd>${a.hostname}</dd>` : ''}
				${a.timezone ? html`<dt>Zeitzone</dt><dd>${a.timezone}</dd>` : ''}
				${a.fan_lo_temp ? html`<dt>Lüfter</dt><dd>voll ab ${a.fan_lo_temp} °C</dd>` : ''}
				${a.users.length ? html`<dt>Benutzerkonten</dt><dd>${a.users.map((u) => u.split(':')[0]).join(', ')}</dd>` : ''}
				${a.shares.length ? html`<dt>Freigaben</dt><dd>${a.shares.join(', ')}</dd>` : ''}
				${a.nfs.length ? html`<dt>NFS</dt><dd>${a.nfs.join(', ')}</dd>` : ''}
			</dl>
			<label class="chk" style="margin-top:14px"><input type="checkbox" id="fr-altf"${f.use_altf ? raw(' checked') : ''}>Gerätename, Zeitzone und Lüfter übernehmen</label>
			<p class="note">Benutzer und Freigaben werden aufbewahrt und mit dem Bereich „Freigaben“ angeboten. Die Alt-F-Daten im Flash bleiben unverändert.</p>`;
	} else if (f.step === 2) {
		body = html`<p style="margin:0 0 12px;font-size:13px">Das Standardpasswort <code>shareos</code> kennt jeder – bitte jetzt ein eigenes setzen. Es gilt für die Weboberfläche und SSH.</p>
			<div class="fields" style="max-width:560px">
				<label class="f"><span>NEUES PASSWORT</span><input id="fr-p1" type="password" minlength="6" autocomplete="new-password" value="${f.password}"></label>
				<label class="f"><span>WIEDERHOLEN</span><input id="fr-p2" type="password" minlength="6" autocomplete="new-password" value="${f.password}"></label>
			</div>
			<p class="note">Leer lassen, um das Passwort später zu ändern.</p>`;
	} else if (f.step === 3) {
		body = html`<div class="fields" style="max-width:640px">
				<label class="f"><span>GERÄTENAME</span><input id="fr-host" value="${f.hostname}" pattern="[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?"></label>
				<label class="f"><span>ZEITZONE</span><select id="fr-tz" data-i18n-skip>${f.zones.map((z) => html`<option${z === f.timezone ? raw(' selected') : ''}>${z}</option>`)}</select></label>
			</div>
			<p class="note">Unter diesem Namen erscheint die Box im Netzwerk. Die Uhr stellt sich per NTP selbst.</p>`;
	} else if (f.step === 4) {
		body = html`<div style="display:grid;gap:10px;max-width:640px">${[['stable', 'Stabil', 'Nur fertige Versionen – empfohlen.'], ['beta', 'Beta', 'Auch Testversionen, mit neuen Funktionen früher.']].map(([id, t, d]) => html`
			<label class="panel" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;${f.channel === id ? 'border-color:var(--accent);box-shadow:var(--glow)' : ''}">
				<input type="radio" name="fr-channel" value="${id}"${f.channel === id ? raw(' checked') : ''} style="margin-top:4px;accent-color:var(--accent)">
				<span><b class="name" style="font-size:14px">${t}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
			<p class="note">Updates kommen von GitHub und werden unter System → Firmware installiert.</p>`;
	} else {
		body = html`<dl class="kv" style="max-width:560px">
				${a.found ? html`<dt>Alt-F übernehmen</dt><dd>${f.use_altf ? 'ja' : 'nein'}</dd>` : ''}
				<dt>Passwort</dt><dd>${f.password ? 'wird geändert' : 'bleibt (später ändern)'}</dd>
				<dt>Gerätename</dt><dd>${f.hostname}</dd>
				<dt>Zeitzone</dt><dd>${f.timezone}</dd>
				<dt>Update-Kanal</dt><dd>${f.channel === 'beta' ? 'Beta' : 'Stabil'}</dd>
			</dl>
			<p class="note">Danach kannst du gleich die Festplatten einrichten.</p>`;
	}
	const last = f.step === 5;
	return html`<section class="sec"><div class="panel" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">ERSTEINRICHTUNG</span><button class="btn sm ghost ml" type="button" data-act="fr-skip">Überspringen</button></div>
		<div class="steps" style="margin-bottom:18px">${steps.map(([n, k], i) => html`<div class="step ${k < f.step ? 'done' : k === f.step ? 'act' : ''}"><div class="n">${i + 1}${k < f.step ? ' ✓' : ''}</div>${n}</div>`)}</div>
		${body}
		<div class="acts" style="margin-top:18px;justify-content:space-between">
			<button class="btn ghost" type="button" data-act="fr-back" ${f.step === 0 ? 'disabled' : ''}>Zurück</button>
			${last ? html`<div class="acts"><button class="btn" type="button" data-act="fr-finish" data-next="overview">Fertig</button><button class="btn primary" type="button" data-act="fr-finish" data-next="storage">Fertig & Speicher einrichten</button></div>`
				: html`<button class="btn primary" type="button" data-act="fr-next">Weiter</button>`}
		</div></div></section>`;
}

function firstRunAfter() {
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
			if (p1 !== p2) return 'Die Passwörter stimmen nicht überein.';
			if (p1.length < 6) return 'Das Passwort braucht mindestens 6 Zeichen.';
		}
		f.password = p1;
	}
	if (f.step === 3 && !/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(f.hostname)) return 'Ungültiger Gerätename.';
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
window.addEventListener('appinstalled', () => { S.installEvt = null; toast('ShareOS ist als App installiert.'); });

function appPanel() {
	const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
	let state, note;
	if (standalone) { state = html`<span class="tag ok ml">läuft als App</span>`; note = 'Diese Oberfläche läuft gerade als installierte App.'; }
	else if (S.installEvt) { state = html`<span class="tag ok ml">bereit</span>`; note = 'Der Browser kann ShareOS als App mit eigenem Symbol installieren.'; }
	else if (!window.isSecureContext) { state = html`<span class="tag ml">nur über HTTPS</span>`; note = html`Browser installieren Web-Apps nur über <b>HTTPS mit einem vertrauenswürdigen Zertifikat</b> (z. B. Let's Encrypt, unter SYSTEM → NETZWERK einspielen). Über http:// bietet Chrome im Menü nur <b>„Zum Startbildschirm hinzufügen“</b> – das legt ein Lesezeichen-Symbol an.`; }
	else { state = html`<span class="tag ml">über das Browsermenü</span>`; note = html`Im Browsermenü <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen. Mit einem selbst signierten Zertifikat bieten Browser die echte Installation nicht an.`; }
	return html`<div class="panel">
		<div class="ph"><span class="pt">ALS APP INSTALLIEREN</span>${state}</div>
		<p class="note" style="margin-top:0">${note}</p>
		<p class="note">Auf Android: das App-Symbol lange drücken öffnet die Kurzbefehle <b>Übersicht, Speicher, Freigaben, Firmware</b>. Echte Startbildschirm-Widgets bietet Chrome für Web-Apps nicht – dafür gibt es rechts den Status für Widget-Apps.</p>
		${S.installEvt ? html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" id="app-install">${svg(I.dl)}Als App installieren</button></div>` : ''}
	</div>`;
}

function widgetUrl() {
	return S.widget?.token ? location.origin + '/cgi-bin/status?token=' + S.widget.token : '';
}

function widgetPanel() {
	const w = S.widget;
	if (!w) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
	return html`<div class="panel">
		<div class="ph"><span class="pt">STATUS FÜR WIDGETS</span><span class="tag ml${w.enabled ? ' ok' : ''}">${w.enabled ? 'an' : 'aus'}</span></div>
		<label class="chk"><input type="checkbox" id="opt-widget"${w.enabled ? raw(' checked') : ''}>Status-Adresse einschalten</label>
		${w.enabled && w.token ? html`<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>ADRESSE (GEHEIM HALTEN)</span><input id="widget-url" readonly value="${widgetUrl()}" style="font-family:var(--mono);font-size:12px"></label></div>
			<div class="acts" style="margin-top:10px"><button class="btn sm" type="button" id="widget-copy">Kopieren</button><button class="btn sm ghost" type="button" id="widget-renew">Neuer Schlüssel</button><a class="btn sm ghost" href="${widgetUrl()}" target="_blank" rel="noopener">Öffnen ↗</a></div>` : ''}
		<p class="note">Liefert eine kurze JSON-Antwort ohne Anmeldung: Name, Version, Laufzeit, Last, Temperatur, Belegung der Laufwerke, RAID-Zustand und Warnungen (<code>ok</code>, <code>alerts</code>). Gedacht für Widget-Apps wie <b>KWGT</b> (Android), Home Assistant oder eigene Skripte. Wer die Adresse kennt, sieht diese Werte – ändern kann damit niemand etwas.</p>
	</div>`;
}

async function loadWidget() {
	try { S.widget = await rpc('shareos.widget', 'get'); } catch (e) { S.widget = { enabled: false, token: '' }; }
	if (S.route.tab === 'system' && S.route.sub === 'general') renderMain();
}

async function widgetSet(a) {
	try { S.widget = await rpc('shareos.widget', 'set', a); toast(a.renew ? 'Neuer Schlüssel erzeugt.' : a.enabled ? 'Status-Adresse eingeschaltet.' : 'Status-Adresse ausgeschaltet.'); }
	catch (e) { toast('Widgets: ' + e.message, true); }
	renderMain();
}

async function copyText(t) {
	try { await navigator.clipboard.writeText(t); toast('Kopiert.'); }
	catch (e) {
		const i = $('#widget-url'); i?.select();
		try { document.execCommand('copy'); toast('Kopiert.'); } catch (e2) { toast('Bitte die Adresse selbst markieren und kopieren.', true); }
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
	if (S.acme?.running) S.acmeTimer = setTimeout(async () => { if (S.route.sub !== 'network') return; const was = S.acme.running; await loadNetExtra(); if (was && !S.acme.running) { toast(S.acme.active ? 'Let\'s-Encrypt-Zertifikat aktiv – die Seite verbindet sich neu.' : 'Let\'s Encrypt: ' + (S.acme.error || 'fehlgeschlagen'), !S.acme.active); if (S.acme.active) afterWebRestart(); } renderMain(); }, 5000);
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
		toast('Gespeichert – der Webserver startet neu.');
		if (location.protocol === 'https:' && v.https === false) { setTimeout(() => { location.href = 'http://' + location.host + '/'; }, 2500); return; }
		afterWebRestart();
	} catch (e) { toast('HTTPS: ' + e.message, true); }
}

// 20261027-071400 -> local date and time of the snapshot (taken 5 min after the start)
const bootlogTime = (n) => { const m = n.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).toLocaleString(LOC, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : n; };
// power schedule (shareos-power): switch-off by cron, switch-on by the MCU's wake-up alarm
const PWR_DAYS = [['mon', 'Montag'], ['tue', 'Dienstag'], ['wed', 'Mittwoch'], ['thu', 'Donnerstag'], ['fri', 'Freitag'], ['sat', 'Samstag'], ['sun', 'Sonntag']];
const fmtPwr = (t) => (t ? new Date(t.replace(' ', 'T')).toLocaleString(LOC, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
// any time entered in the schedule?
const pwrHasTimes = (p) => Object.values(p?.days || {}).some((d) => d.on || d.off);
function powerSchedule() {
	const p = S.pwr;
	if (!p) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
	if (p.error) return html`<div class="panel"><p class="mut">${p.error}</p></div>`;
	const head = html`<div class="ph"><span class="pt">AUS- UND EINSCHALTEN NACH ZEITPLAN</span>
			${p.enabled ? html`<span class="tag ok ml">aktiv</span>` : html`<span class="tag ml">aus</span>`}</div>`;
	// first a short overview; the table only after "Einrichten"/"Bearbeiten"
	if (!S.pwrEdit) {
		const set = PWR_DAYS.filter(([d]) => p.days?.[d]?.on || p.days?.[d]?.off);
		return html`<div class="panel">${head}
			${!set.length ? html`<p class="mut" style="margin:0">Keine Zeiten eingerichtet.</p>`
				: html`<dl class="kv">${set.map(([d, n]) => html`<dt>${n}</dt><dd>${p.days[d].on ? html`an ${p.days[d].on}` : ''}${p.days[d].on && p.days[d].off ? ' · ' : ''}${p.days[d].off ? html`aus ${p.days[d].off}` : ''}</dd>`)}</dl>`}
			${p.enabled && set.length ? html`<p style="margin:10px 0 0">${p.supported ? html`Nächstes Einschalten: <b>${fmtPwr(p.next_on)}</b> · ` : ''}Nächstes Ausschalten: <b>${fmtPwr(p.next_off)}</b></p>`
				: !p.enabled && set.length ? html`<div class="banner" style="margin-top:10px">${svg(I.warn)}<span>Der Zeitplan ist aus – die eingetragenen Zeiten gelten erst mit dem Haken bei „Zeitplan einschalten“.</span></div>` : ''}
			<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="pwr-edit">${set.length ? 'Bearbeiten' : 'Einrichten'}</button></div>
		</div>`;
	}
	return html`<form class="panel" id="f-power">
		<div class="ph"><span class="pt">AUS- UND EINSCHALTEN NACH ZEITPLAN</span>
			${p.enabled ? html`<span class="tag ok ml">aktiv</span>` : html`<span class="tag ml">aus</span>`}</div>
		<label class="chk"><input type="checkbox" name="enabled"${p.enabled ? raw(' checked') : ''}> Zeitplan einschalten</label>
		<div class="tw"><table class="t" style="min-width:360px"><thead><tr><th>TAG</th>${p.supported ? html`<th>EINSCHALTEN</th>` : ''}<th>AUSSCHALTEN</th></tr></thead>
			<tbody>${PWR_DAYS.map(([d, n]) => html`<tr><td>${n}</td>
				${p.supported ? html`<td><input type="time" name="on_${d}" value="${p.days?.[d]?.on || ''}" aria-label="${n} einschalten"></td>` : ''}
				<td><input type="time" name="off_${d}" value="${p.days?.[d]?.off || ''}" aria-label="${n} ausschalten"></td></tr>`)}</tbody></table></div>
		${p.enabled ? html`<p style="margin:10px 0 0">${p.supported ? html`Nächstes Einschalten: <b>${fmtPwr(p.next_on)}</b> · ` : ''}Nächstes Ausschalten: <b>${fmtPwr(p.next_off)}</b></p>`
			: pwrHasTimes(p) ? html`<div class="banner" style="margin-top:10px">${svg(I.warn)}<span>Der Zeitplan ist aus – die eingetragenen Zeiten gelten erst mit dem Haken bei „Zeitplan einschalten“.</span></div>` : ''}
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-act="pwr-cancel">Abbrechen</button></div>
		<p class="note">${p.supported ? 'Leere Felder: an diesem Tag nichts. Ausgeschaltet wird sauber (wie mit dem Knopf); läuft gerade ein Speicher-Auftrag (z. B. RAID-Aufbau), bleibt die Box an. Zum Einschalten stellt ShareOS die Weckzeit der Gerätesteuerung – den Stecker nicht ziehen.'
			: 'Diese Box kann sich nicht selbst einschalten (keine Weckfunktion) – nur das Ausschalten nach Zeitplan geht. Einschalten über den Power-Taster.'}</p>
	</form>`;
}

async function loadLog() {
	const box = $('#logbox');
	if (!box) return;
	try {
		const r = await rpc('shareos.system', 'log', { lines: 300, source: $('#log-src')?.value || 'system' });
		box.textContent = (r.lines || []).join('\n') || '(leer)';
		box.scrollTop = box.scrollHeight;
	} catch (e) { box.textContent = 'Fehler: ' + e.message; }
}

/* ---------- update flow ----------------------------------------------------- */

async function checkUpdates(quiet = false) {
	S.checking = true;
	if (S.route.sub === 'firmware') renderMain();
	try {
		S.check = await rpc('shareos.update', 'check');
		if (!quiet) toast(S.check.update_available ? `Update ${S.check.latest} verfügbar.` : 'ShareOS ist aktuell.');
	} catch (e) {
		if (!quiet && e.code !== 'auth') toast('Prüfen fehlgeschlagen: ' + e.message, true);
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
		if (prev && prev !== S.upd.state && S.upd.state === 'ready') toast('Update geladen und geprüft.');
		if (prev && prev !== S.upd.state && S.upd.state === 'flashed') toast('Update geschrieben – bitte neu starten.');
		const busy = ['downloading', 'verifying', 'flashing'].includes(S.upd.state);
		S.updTimer = setTimeout(refreshUpdateStatus, busy || S.updPending ? 1000 : 30000);
	} catch (e) {
		if (e.code !== 'auth') S.updTimer = setTimeout(refreshUpdateStatus, 10000);
	}
}

/* ---------- actions (delegated clicks) -------------------------------------- */

const ACTIONS = {
	'chips-more'() { S.chipsAll = !S.chipsAll; fitChips(); },
	'page-reload': () => location.reload(),
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
			renderUserHeader(); renderUserMain(); toast('Darstellung wie für alle.');
		} catch (e) { toast('Darstellung: ' + e.message, true); }
	},
	async 'pl-run'() { try { await rpc('shareos.paperless', 'run'); toast('Übertragung gestartet.'); setTimeout(loadPaperless, 5000); } catch (e) { toast(e.message, true); } },
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
			toast(`Verbindung in Ordnung – ${r.documents} Dokumente in Paperless.`);
		} catch (e) { toast('Paperless: ' + e.message, true); }
	},
	async 'pl-log'(el) { try { S.plLog = { name: el.dataset.name, entries: (await rpc('shareos.paperless', 'log', { inbox: el.dataset.name })).entries }; renderMain(); } catch (e) { toast(e.message, true); } },
	'pl-log-close'() { S.plLog = null; renderMain(); },
	async 'pl-del'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Eingang „${n}“ entfernen?`, 'Es wird nichts mehr übertragen. Der Ordner und die Dateien darin bleiben erhalten.', 'Entfernen')) return;
		try { await rpc('shareos.paperless', 'inbox_del', { name: n }); toast(`Eingang „${n}“ entfernt.`); loadPaperless(); } catch (e) { toast(e.message, true); }
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
		} catch (e) { w?.close(); toast('Anmelden: ' + e.message, true); }
		scope === 'admin' ? renderMain() : renderUserMain();
	},
	async 'cl-authfin'(el) {
		const scope = el.dataset.scope, re = S.cloud.remoteEdit, f = $('#f-remote');
		re.name = f.name.value;
		el.disabled = true;
		try {
			const url = f.auth_url.value.trim();
			if (scope === 'admin') await rpc('shareos.cloud', 'auth_finish', { url }); else await rpc('shareos.me', 'cloud_auth_finish', { url });
			re.authed = true; toast('Angemeldet – jetzt „Hinzufügen“.');
		} catch (e) { toast('Anmelden: ' + e.message, true); }
		scope === 'admin' ? renderMain() : renderUserMain();
	},
	'cl-rcancel'(el) { S.cloud.remoteEdit = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-rtest'(el) {
		el.disabled = true;
		try { const r = await CLOUD_API[el.dataset.scope].testRemote(el.dataset.name); toast(`${el.dataset.name}: Verbindung in Ordnung (${r.folders} Ordner).`); }
		catch (e) { toast(`${el.dataset.name}: ${e.message}`, true); }
		el.disabled = false;
	},
	async 'cl-rdel'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Konto „${n}“ entfernen?`, 'Die Zugangsdaten werden gelöscht. Aufträge mit diesem Konto laufen dann nicht mehr. In der Cloud wird nichts gelöscht.', 'Entfernen')) return;
		try { await CLOUD_API[el.dataset.scope].delRemote(n); toast(`Konto „${n}“ entfernt.`); loadCloud(el.dataset.scope); } catch (e) { toast(e.message, true); }
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
		try { await CLOUD_API[el.dataset.scope].runJob(el.dataset.name); toast(`Auftrag „${el.dataset.name}“ gestartet.`); setTimeout(() => loadCloud(el.dataset.scope), 1500); }
		catch (e) { toast(e.message, true); el.disabled = false; }
	},
	async 'cl-jstop'(el) { try { await CLOUD_API[el.dataset.scope].stopJob(el.dataset.name); toast('Gestoppt.'); setTimeout(() => loadCloud(el.dataset.scope), 1500); } catch (e) { toast(e.message, true); } },
	async 'cl-jlog'(el) {
		try { S.cloud.log = { name: el.dataset.name, lines: (await CLOUD_API[el.dataset.scope].log(el.dataset.name)).lines }; renderMain(); } catch (e) { toast(e.message, true); }
	},
	'cl-logclose'(el) { S.cloud.log = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-jdel'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Auftrag „${n}“ entfernen?`, 'Der Auftrag läuft nicht mehr. Dateien auf dem NAS und in der Cloud bleiben, wie sie sind.', 'Entfernen')) return;
		try { await CLOUD_API[el.dataset.scope].delJob(n); toast(`Auftrag „${n}“ entfernt.`); loadCloud(el.dataset.scope); } catch (e) { toast(e.message, true); }
	},
	async 'dlna-rescan'(el) {
		el.disabled = true;
		try { S.dlna = await rpc('shareos.dlna', 'rescan'); toast('Medienserver liest alle Ordner neu ein.'); } catch (e) { toast(e.message, true); }
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
		try { await rpc('shareos.snapshots', 'run', { name: el.dataset.name }); toast(`Snapshot „${el.dataset.name}“ läuft.`); } catch (e) { toast(e.message, true); }
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
		if (!await confirmDlg('Snapshot löschen?', `Den Stand vom ${fmtTime(sn?.time)} löschen? Die anderen Snapshots bleiben vollständig.`, 'Löschen', true)) return;
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'remove', { name: n, snapshot: x })).jobs; toast('Snapshot gelöscht.'); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sn-browse'(el) {
		const j = S.snap.data.jobs.find((y) => y.name === el.dataset.name);
		const f = fbInit();
		f.root = j.target; f.path = `Snapshots/${j.name}/${el.dataset.snap}`; f.data = null; f.sel = new Set();
		location.hash = '#/shares/files';
	},
	async 'sn-del'(el) {
		const n = el.dataset.name, j = S.snap.data.jobs.find((y) => y.name === n);
		if (!await confirmDlg(`Auftrag „${n}“ entfernen?`, 'Es werden keine neuen Snapshots mehr angelegt.', 'Entfernen')) return;
		const data = j.snapshots.length > 0 && await confirmDlg('Snapshots auch löschen?', `Die ${j.snapshots.length} vorhandenen Snapshots in ${j.target}/Snapshots/${n} ebenfalls löschen? Sonst bleiben sie dort liegen.`, 'Snapshots löschen', true);
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'job_del', { name: n, data })).jobs; toast(`Auftrag „${n}“ entfernt.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sh-new'() {
		S.shEdit = { mode: 'new', data: { name: '', volume: S.vols[0]?.name || '', path: '', comment: '', smb: true, guest: false, nfs: false, nfs_rw: false, nfs_hosts: [], rw: [], ro: [] } };
		renderMain(); window.scrollTo(0, 0);
	},
	'sh-edit'(el) { S.shEdit = { mode: 'edit', data: structuredClone(S.shares.shares.find((x) => x.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'sh-cancel'() { S.shEdit = null; renderMain(); },
	async 'sh-del'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Freigabe „${n}“ entfernen?`, 'Die Freigabe verschwindet aus dem Netzwerk. Der Ordner und alle Dateien darin bleiben auf dem Laufwerk erhalten.', 'Entfernen')) return;
		try { S.shares = await rpc('shareos.shares', 'del', { name: n }); toast(`Freigabe „${n}“ entfernt.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'u-new'() {
		S.uEdit = { mode: 'new', data: { name: '', fullname: '', role: 'share', home: S.vols.filter(linuxFs)[0]?.name || '', quota: 0, web: true, groups: [] } };
		renderMain(); window.scrollTo(0, 0);
	},
	'u-edit'(el) { S.uEdit = { mode: 'edit', data: structuredClone(S.acc.users.find((x) => x.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'u-cancel'() { S.uEdit = null; renderMain(); },
	async 'u-pass'(el) {
		const n = el.dataset.name;
		const p = await promptDlg(`Passwort für ${n}`, 'Neues Passwort (mindestens 6 Zeichen). Gilt für Freigaben und – je nach Rolle – für die Weboberfläche.', '', 'Setzen', 'password');
		if (p == null) return;
		try { await rpc('shareos.accounts', 'passwd', { name: n, password: p }); toast(`Passwort von ${n} geändert.`); } catch (e) { toast(e.message, true); }
	},
	async 'u-del'(el) {
		const n = el.dataset.name, u = S.acc.users.find((x) => x.name === n);
		if (!await confirmDlg(`Benutzer „${n}“ löschen?`, `Das Konto wird entfernt; Rechte an Freigaben entfallen.${u?.home ? ' Der persönliche Ordner bleibt erhalten.' : ''}`, 'Löschen', true)) return;
		try { S.acc = await rpc('shareos.accounts', 'del', { name: n }); toast(`Benutzer „${n}“ gelöscht.`); loadShareData(); } catch (e) { toast(e.message, true); }
	},
	async 'u-altf'() {
		if (!await confirmDlg('Benutzer von Alt-F übernehmen?', 'Benutzer und Gruppen aus den gesicherten Alt-F-Einstellungen werden angelegt (Rolle „Nur Freigaben“). Passwörter werden übernommen, wo Alt-F sie gespeichert hat.', 'Übernehmen')) return;
		try {
			const r = await rpc('shareos.accounts', 'import_altf');
			S.acc = r;
			toast(r.imported.length ? `Übernommen: ${r.imported.join(', ')}` : 'Keine neuen Benutzer gefunden.');
			if (r.skipped.length) toast(`Übersprungen: ${r.skipped.join(', ')}`, true);
			renderMain();
		} catch (e) { toast('Alt-F: ' + e.message, true); }
	},
	async 'g-new'() {
		const g = ((await promptDlg('Neue Gruppe', 'Name der Gruppe (a–z, 0–9 und _, beginnt mit einem Buchstaben):', '', 'Anlegen')) || '').toLowerCase();
		if (!g) return;
		try { S.acc = await rpc('shareos.accounts', 'group_add', { name: g }); toast(`Gruppe „${g}“ angelegt.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	async 'g-del'(el) {
		const g = el.dataset.name;
		if (!await confirmDlg(`Gruppe „${g}“ löschen?`, 'Die Mitglieder bleiben bestehen, verlieren aber die Rechte, die über diese Gruppe vergeben wurden.', 'Löschen', true)) return;
		try { S.acc = await rpc('shareos.accounts', 'group_del', { name: g }); toast(`Gruppe „${g}“ gelöscht.`); loadShareData(); } catch (e) { toast(e.message, true); }
	},
	view(el) {
		const id = el.dataset.id;
		S.views[id] = isTable(id) ? 'tiles' : 'table';
		store.set('views', JSON.stringify(S.views));
		renderMain();
	},
	async 'net-confirm'() {
		try { await rpc('shareos.net', 'confirm'); toast('Neue Netzwerkeinstellungen bestätigt.'); } catch (e) { toast(e.message, true); }
		S.net = null; loadNet();
	},
	check() { checkUpdates(); },
	'fr-next'() { const e = frCollect(); if (e) { toast(e, true); return; } frGo(1); },
	'fr-back'() { frCollect(); frGo(-1); },
	async 'fr-skip'() {
		if (!await confirmDlg('Ersteinrichtung überspringen?', 'Alles lässt sich später unter System einstellen. Das Passwort bleibt „shareos“, bis du es änderst.', 'Überspringen')) return;
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
			toast('Ersteinrichtung abgeschlossen.');
			frEnd(el.dataset.next);
		} catch (e) { toast(e.message, true); el.disabled = false; }
	},
	async 'fr-again'() {
		try { await rpc('shareos.setup', 'reset'); try { sessionStorage.setItem('shareos.frstep', '0'); } catch (e) { } checkFirstRun(true); }
		catch (e) { toast(e.message, true); }
	},

	'wiz-start'() {
		const disks = (S.storage?.disks || []).filter((d) => !d.usb && !d.rm && d.tran !== 'usb').map((d) => d.name);
		S.wiz = { step: 0, disks: disks.slice(0, 2), layout: disks.length >= 2 ? 'mirror' : 'single', swap: 1024, names: { __mirror: 'daten' }, fs: { __mirror: 'ext4' } };
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
		if (w.step === 1 && w.layout === 'single') w.disks.forEach((d, k) => { if (!w.names[d]) w.names[d] = k ? 'daten' + (k + 1) : 'daten'; });
		w.step++;
		renderMain();
	},
	async 'wiz-run'() {
		const w = S.wiz;
		if (!await confirmDlg('Platten löschen und einrichten?', `${w.disks.join(' und ')} werden vollständig gelöscht. Das lässt sich nicht rückgängig machen.`, 'Löschen & einrichten', true)) return;
		const args = pairLayout(w.layout)
			? { layout: w.layout, name: w.names.__mirror, disks: w.disks, swap: w.swap, fs: w.fs.__mirror || 'ext4', confirm: true }
			: { layout: 'single', volumes: w.disks.map((d) => ({ name: w.names[d], disk: d, fs: w.fs[d] || 'ext4' })), swap: w.swap, confirm: true };
		try { await rpc('shareos.storage', 'setup', args); S.wiz = null; toast('Einrichtung gestartet.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Einrichten: ' + e.message, true); }
	},
	async adopt(el) {
		const { part, fs, size } = el.dataset;
		const name = await promptDlg(`${part} übernehmen`, `${part} (${FS_NAME[fs] || fs}, ${fmtBytes(+size)}) wird so, wie es ist, als Laufwerk eingebunden – es wird nichts gelöscht. Name des Laufwerks (a–z, 0–9, - und _, max. 16 Zeichen):`, 'daten', 'Übernehmen', 'text', 16);
		if (!name) return;
		if (!NAME_RE.test(name.toLowerCase())) { toast('Ungültiger Name.', true); return; }
		el.disabled = true;
		try {
			await rpc('shareos.storage', 'adopt', { name: name.toLowerCase(), part });
			toast(`${part} ist jetzt das Laufwerk „${name.toLowerCase()}“ – die Daten sind erhalten. Freigaben für vorhandene Ordner unter „Freigaben“ anlegen.`);
		} catch (e) { toast(`${part} übernehmen: ${e.message}`, true); el.disabled = false; }
		loadStorage();
	},
	async format(el) {
		const disk = el.dataset.disk;
		const d = S.storage.disks.find((x) => x.name === disk);
		const r = await fsDlg(`${disk} formatieren`, 'Name des neuen Laufwerks (a–z, 0–9, - und _, max. 16 Zeichen) und Dateisystem:', 'daten', FS_DISK, 'ext4', 'Weiter');
		if (!r) return;
		const name = r.name.toLowerCase();
		if (!NAME_RE.test(name)) { toast('Ungültiger Name.', true); return; }
		if (!await confirmDlg(`${disk} löschen?`, `${disk} (${d?.model || ''}, ${fmtBytes(d?.size)}) wird vollständig gelöscht und als Laufwerk „${name}“ (${FS_NAME[r.fs]}) neu eingerichtet.`, 'Löschen & formatieren', true)) return;
		try { await rpc('shareos.storage', 'setup', { layout: 'single', volumes: [{ name, disk, fs: r.fs }], confirm: true }); toast('Formatieren gestartet.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Formatieren: ' + e.message, true); }
	},
	async 'usb-eject'(el) {
		el.disabled = true;
		try {
			await rpc('shareos.storage', 'usb_eject', { disk: el.dataset.disk });
			toast(`${el.dataset.disk} kann jetzt abgezogen werden.`);
		} catch (e) { toast('Entfernen: ' + e.message, true); el.disabled = false; }
		setTimeout(loadStorage, 800);
	},
	async 'usb-format'(el) {
		const disk = el.dataset.disk, d = S.storage.disks.find((x) => x.name === disk);
		const r = await fsDlg(`${disk} formatieren`, `${d?.model || 'USB-Laufwerk'}, ${fmtBytes(d?.size)} – Name (Buchstaben, Ziffern, Leerzeichen, - und _) und Dateisystem:`, 'USB', FS_USB, 'exfat', 'Weiter');
		if (!r) return;
		if (!/^[A-Za-z0-9 _-]{1,16}$/.test(r.name)) { toast('Ungültiger Name.', true); return; }
		if (!await confirmDlg(`${disk} löschen?`, `Alles auf ${disk} wird gelöscht. Danach ist es ein ${FS_NAME[r.fs]}-Laufwerk „${r.name}“.`, 'Löschen & formatieren', true)) return;
		try { await rpc('shareos.storage', 'usb_format', { disk, fs: r.fs, name: r.name, confirm: true }); toast('Formatieren gestartet.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Formatieren: ' + e.message, true); }
	},
	async 'usb-copy'(el) {
		el.disabled = true;
		try { await rpc('shareos.storage', 'usb_copy'); toast('USB-Kopie gestartet.'); }
		catch (e) { toast('USB-Kopie: ' + (USB_COPY_ERR[e.message] || e.message), true); }
		setTimeout(loadStorage, 1500);
	},
	async smart(el) {
		el.disabled = true;
		try { await rpc('shareos.storage', 'smart', { disk: el.dataset.disk }); } catch (e) { toast('SMART: ' + e.message, true); }
		loadStorage();
	},
	async 'smart-test'(el) {
		const disk = el.dataset.disk, t = el.dataset.t;
		if (t === 'long' && !await confirmDlg('Langtest starten?', `Der Langtest liest die ganze Platte ${disk} – bei großen Platten viele Stunden. Die Box bleibt dabei nutzbar, die Platte ist etwas langsamer.`, 'Starten')) return;
		el.disabled = true;
		try { await rpc('shareos.storage', 'smart_test', { disk, type: t }); toast(t === 'abort' ? 'Selbsttest abgebrochen.' : 'Selbsttest gestartet.'); }
		catch (e) { toast('Selbsttest: ' + e.message, true); }
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
		if (!await confirmDlg(`Spiegel „${name}“ reparieren?`, `${d.name} (${d.model || ''} · ${fmtBytes(d.size)}) wird vollständig gelöscht und als zweite Platte in den Spiegel aufgenommen. Die Daten werden danach im Hintergrund kopiert (bei großen Platten mehrere Stunden); das Laufwerk bleibt nutzbar.`, 'Löschen & reparieren', true)) return;
		try { await rpc('shareos.storage', 'repair', { name, disk: d.name, confirm: true }); toast('Reparatur gestartet.'); }
		catch (e) { toast(`${name}: ${e.message}`, true); }
		loadStorage();
	},

	async vol(el) {
		const { name, op } = el.dataset;
		if (op === 'forget' && !await confirmDlg(`„${name}“ entfernen?`, 'Das Laufwerk wird ausgehängt und aus der Konfiguration genommen. Die Daten auf der Platte bleiben erhalten, bis sie neu eingerichtet wird.', 'Entfernen')) return;
		try { await rpc('shareos.storage', 'volume', { name, action: op }); toast(`${name}: ${op === 'mount' ? 'eingehängt' : op === 'umount' ? 'ausgehängt' : 'entfernt'}`); }
		catch (e) { toast(`${name}: ${e.message}`, true); }
		loadStorage();
	},

	log() { loadLog(); },

	async svc(el) {
		const { name, op } = el.dataset;
		el.disabled = true;
		try {
			const r = await rpc('shareos.service', 'action', { name, action: op });
			if (r.delayed) { waitForBox('Dienst wird neu gestartet', 'warte auf die Box', false); return; }
			toast(`${name}: ${op === 'start' ? 'gestartet' : op === 'stop' ? 'gestoppt' : 'neu gestartet'}`);
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
		if (!await confirmDlg('Update installieren?', `ShareOS ${(el.dataset.ver || tag).replace(/^v/, '')} wird in den Flash geschrieben. Danach ist ein Neustart nötig, bei dem das neue System installiert wird. Während des Schreibens die Box nicht ausschalten.`, 'Installieren')) { el.disabled = false; return; }
		S.updPending = { state: 'flashing', until: Date.now() + 15000 };
		S.upd = { ...S.upd, state: 'flashing', step: '' };
		renderMain();
		try { await rpc('shareos.update', 'apply', { tag, confirm: true }); refreshUpdateStatus(); }
		catch (e) { S.updPending = null; toast('Installieren: ' + e.message, true); refreshUpdateStatus(); }
	},

	async 'time-sync'(el) {
		el.disabled = true;
		try { setTime(await rpc('shareos.time', 'sync')); toast('Uhrzeit abgeglichen.'); renderMain(); }
		catch (e) { toast('Abgleich: ' + e.message, true); el.disabled = false; }
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
		try { await rpc('shareos.printer', 'test', { lp: el.dataset.id }); toast('Testseite geschickt.'); }
		catch (e) { toast('Testseite: ' + e.message, true); }
	},

	async 'ddns-now'() {
		try { await rpc('shareos.web', 'ddns_update'); toast('Wird gemeldet …'); setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 5000); }
		catch (e) { toast('DynDNS: ' + e.message, true); }
	},

	async 'ca-init'() {
		try { await rpc('shareos.web', 'ca_init'); toast('Zertifizierungsstelle angelegt.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-root'() {
		try { const r = await rpc('shareos.web', 'ca_pem', { kind: 'root' }); pemDownload(r.pem, 'shareos-ca.crt'); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-web'() {
		if (!await confirmDlg('Zertifikat der eigenen CA verwenden?', 'Die Box bekommt ein Zertifikat ihrer eigenen Zertifizierungsstelle für Gerätenamen, .local-Namen und IP-Adresse; es ersetzt das bisherige. Ohne installiertes Stammzertifikat warnt der Browser weiter.', 'Verwenden')) return;
		try { await rpc('shareos.web', 'ca_web'); toast('Zertifikat installiert – die Seite verbindet sich neu.'); afterWebRestart(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-dl'(el) {
		try { const r = await rpc('shareos.web', 'ca_pem', { name: el.dataset.id, kind: el.dataset.kind }); pemDownload(r.pem, el.dataset.id + (el.dataset.kind === 'key' ? '.key' : '.crt')); }
		catch (e) { toast('Zertifikat: ' + e.message, true); }
	},

	async 'ca-del'(el) {
		if (!await confirmDlg('Zertifikat löschen?', `Das Zertifikat „${el.dataset.id}“ und sein Schlüssel werden von der Box gelöscht. Geräte, die es schon nutzen, behalten ihre Kopie.`, 'Löschen', true)) return;
		try { await rpc('shareos.web', 'ca_delete', { name: el.dataset.id }); toast('Gelöscht.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('Zertifikat: ' + e.message, true); }
	},

	async 'acme-off'() {
		if (!await confirmDlg('Let\'s Encrypt abschalten?', 'Die Box nutzt danach wieder ein selbstsigniertes Zertifikat.', 'Abschalten')) return;
		try { await rpc('shareos.web', 'acme_off'); toast('Abgeschaltet – die Seite verbindet sich neu.'); await loadNetExtra(); afterWebRestart(); }
		catch (e) { toast('Let\'s Encrypt: ' + e.message, true); }
	},

	async 'cert-self'() {
		if (!await confirmDlg('Neues selbstsigniertes Zertifikat?', 'Ein neues Zertifikat für den aktuellen Namen und die aktuelle IP wird erstellt und ersetzt das bisherige. Browser zeigen danach einmalig wieder eine Warnung.', 'Erstellen')) return;
		try { const r = await rpc('shareos.web', 'selfsigned'); S.web.cert = r.cert; toast('Zertifikat erstellt.'); afterWebRestart(); }
		catch (e) { toast('Zertifikat: ' + e.message, true); }
	},

	async reboot() {
		if (!await confirmDlg('Neu starten?', 'Die Box startet neu. Die Seite verbindet sich danach von selbst wieder (ca. 1–2 Minuten).', 'Neu starten')) return;
		try { await rpc('shareos.system', 'reboot'); } catch (e) { }
		stopPolling();
		waitForBox('Neustart läuft', 'ShareOS startet neu');
	},

	'pwr-edit'() { S.pwrEdit = true; renderMain(); },
	'pwr-cancel'() { S.pwrEdit = false; renderMain(); },
	async poweroff() {
		// with a power schedule: when the box will come on again
		let p = null;
		try { p = await rpc('shareos.system', 'power_schedule'); } catch (e) { p = null; }
		const back = p?.supported && p.enabled && p.next_on ? `Nach Zeitplan schaltet sie sich am ${fmtPwr(p.next_on)} wieder ein.` : 'Einschalten danach nur am Gerät.';
		if (!await confirmDlg('Ausschalten?', `ShareOS fährt herunter und die Box schaltet sich aus. ${back}`, 'Ausschalten', true)) return;
		try { await rpc('shareos.system', 'poweroff', { confirm: true }); } catch (e) { toast(e.message, true); return; }
		stopPolling();
		cover('Box wird ausgeschaltet', 'Du kannst dieses Fenster schließen.');
	},

	async factory() {
		if (!await confirmDlg('Werkseinstellungen?', 'Alle Einstellungen und installierten Pakete werden gelöscht, danach startet die Box neu. Das Passwort ist dann wieder „shareos“.', 'Zurücksetzen', true)) return;
		try { await rpc('shareos.system', 'factory_reset', { confirm: true }); } catch (e) { toast(e.message, true); return; }
		stopPolling();
		store.del('sid');
		waitForBox('Werkseinstellungen', 'ShareOS startet neu');
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

window.addEventListener('hashchange', () => {
	if (!S.sid || !$('#main')) return;
	if (isUser()) {
		parseUserRoute();
		if (S.fb && S.utab === 'files') S.fb.roots = null;
		renderUserTabs(); renderUserMain(); window.scrollTo(0, 0);
		return;
	}
	parseRoute();
	if (S.route.tab !== 'storage') { clearTimeout(S.stTimer); S.stTimer = null; S.stActive = false; }
	if (S.route.tab !== 'storage' || S.route.sub !== 'snapshots') { clearTimeout(S.snapTimer); if (S.snap) { S.snap.edit = null; S.snap.log = null; } }
	if (S.route.tab !== 'shares') { S.shEdit = null; S.uEdit = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'dlna') clearTimeout(S.dlnaTimer);
	if (S.route.tab !== 'services' || S.route.sub !== 'printer') { clearTimeout(S.prnTimer); S.prnTimer = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'ups') { clearTimeout(S.upsTimer); S.upsTimer = null; }
	if (S.fb && S.route.sub === 'files') S.fb.roots = null;   // volumes may have changed
	if (S.route.tab !== 'paperless') { S.plEdit = null; S.plLog = null; } else if (S.pl) loadPaperless();
	if (S.route.tab !== 'cloud') { clearTimeout(S.cloudTimer); if (S.cloud?.scope === 'admin') { S.cloud.remoteEdit = null; S.cloud.jobEdit = null; S.cloud.log = null; } }
	else if (S.cloud?.scope === 'admin') loadCloud('admin');
	else if (S.shares) loadShareData();
	renderTabs();
	renderMain();
	window.scrollTo(0, 0);
});

// clock in the header without waiting for the next poll
setInterval(() => {
	const c = $('.clock');
	if (c) c.textContent = new Date().toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
}, 10000);

/* ---------- file browser (admins: all volumes, users: personal folder + shares by rights) */

function fbInit() {
	if (!S.fb) S.fb = { roots: null, root: '', path: '', data: null, sel: new Set(), hidden: false, uploads: [], err: null };
	if (!S.fbApps) { S.fbApps = { apps: [] }; loadOpeners(); }
	return S.fb;
}

const fbRootLabel = (r) => (r.home ? 'Persönlicher Ordner' : r.ro ? r.name + ' (nur lesen)' : r.name);
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
		if (path != null && path !== f.path) { toast('Dateien: ' + e.message, true); f.err = null; }
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
	if (!f.roots) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
	if (!f.roots.length) return html`<div class="panel"><div class="empty">${svg(I.info)}<span>${S.me?.role === 'admin' || !S.me ? 'Kein Laufwerk eingehängt – zuerst unter SPEICHER einrichten.' : 'Weder ein persönlicher Ordner noch eine Freigabe für dich.'}</span></div></div>`;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
	const root = f.roots.find((r) => r.name === f.root) || f.roots[0], ro = !!root.ro;
	if (f.trash) return fbTrashInner(root);
	const parts = f.path ? f.path.split('/') : [];
	const n = f.sel.size, all = d.entries.length && n === d.entries.length;
	const busy = f.uploads.some((u) => u.pct != null && u.pct < 100 && !u.err);
	return html`<div class="panel fb" id="fb-drop">
		<div class="fbbar">
			${f.roots.length > 1 ? html`<select id="fb-root" class="btn sm ghost" aria-label="Laufwerk">${f.roots.map((r) => html`<option value="${r.name}"${r.name === f.root ? raw(' selected') : ''}>${fbRootLabel(r)}</option>`)}</select>` : ''}
			<nav class="crumbs" aria-label="Pfad">
				<button type="button" data-act="fb-crumb" data-p="">${svg(I.folder)}${fbRootLabel(root)}</button>${parts.map((p, i) => html`<span>/</span><button type="button" data-act="fb-crumb" data-p="${parts.slice(0, i + 1).join('/')}">${p}</button>`)}
			</nav>
			${d.free != null ? html`<span class="tag ml">${fmtBytes(d.free)} frei</span>` : ''}
		</div>
		<div class="acts fbtools">
			<button class="btn sm ghost" type="button" data-act="fb-up" ${parts.length ? '' : 'disabled'} title="Ordner nach oben" aria-label="Ordner nach oben">${svg(I.up)}</button>
			<button class="btn sm" type="button" data-act="fb-mkdir" ${ro ? 'disabled' : ''}>${svg(I.plus)}Neuer Ordner</button>
			<label class="btn sm${busy || ro ? ' dis' : ''}">${svg(I.ul)}Hochladen<input type="file" id="fb-file" multiple hidden ${busy || ro ? 'disabled' : ''}></label>
			<span class="sep"></span>
			<button class="btn sm ghost" type="button" data-act="fb-rename" ${n === 1 && !ro ? '' : 'disabled'}>${svg(I.pen)}Umbenennen</button>
			<button class="btn sm ghost" type="button" data-act="fb-move" ${n && !ro ? '' : 'disabled'}>${svg(I.move)}Verschieben</button>
			<button class="btn sm ghost" type="button" data-act="fb-copy" ${n && !ro ? '' : 'disabled'}>${svg(I.copy)}Kopieren</button>
			<button class="btn sm danger" type="button" data-act="fb-del" ${n && !ro ? '' : 'disabled'}>${svg(I.trash)}Löschen</button>
			${f.trashConf?.enabled ? html`<button class="btn sm ghost" type="button" data-act="fb-trash">${svg(I.trash)}Papierkorb</button>` : ''}
			<label class="chk ml"><input type="checkbox" id="fb-hidden"${f.hidden ? raw(' checked') : ''}>Versteckte</label>
		</div>
		${f.uploads.length ? html`<div class="fbup">${f.uploads.map((u) => html`<div class="fbuprow"><span class="nm">${u.name}</span>
			${u.err ? html`<span class="tag err">${u.err}</span>` : u.pct >= 100 ? html`<span class="tag ok">fertig</span>` : html`<div class="bar busy"><i style="width:${u.pct || 0}%"></i></div><span class="vv">${u.pct || 0} %</span>`}</div>`)}</div>` : ''}
		${d.entries.length ? html`<div class="tw"><table class="t fbt">
			<thead><tr><th style="width:34px"><input type="checkbox" class="fb-all" aria-label="Alle auswählen"${all ? raw(' checked') : ''}></th><th>NAME</th><th class="r">GRÖSSE</th><th>GEÄNDERT</th><th></th></tr></thead>
			<tbody>${d.entries.map((e) => {
				const dir = e.type === 'dir' || e.type === 'dirlink';
				return html`<tr class="${f.sel.has(e.name) ? 'sel' : ''}">
					<td><input type="checkbox" class="fb-sel" data-name="${e.name}" aria-label="${e.name} auswählen"${f.sel.has(e.name) ? raw(' checked') : ''}></td>
					<td class="nm">${dir ? html`<button type="button" class="lnk" data-act="fb-open" data-name="${e.name}">${svg(I.folder)}<span>${e.name}</span></button>`
						: e.type === 'file' ? (fbOpeners(e.name)[0]
							? html`<button type="button" class="lnk" data-act="fb-app" data-name="${e.name}" data-app="${fbOpeners(e.name)[0].id}" title="Öffnen mit ${fbOpeners(e.name)[0].name}">${svg(I.doc)}<span>${e.name}</span></button>`
							: html`<button type="button" class="lnk" data-act="fb-dl" data-name="${e.name}" title="Herunterladen">${svg(I.doc)}<span>${e.name}</span></button>`)
						: html`<span class="lnk mut">${svg(I.doc)}<span>${e.name}</span></span>`}</td>
					<td class="r mut">${dir ? '' : fmtBytes(e.size)}</td>
					<td class="mut">${fmtTime(e.mtime)}</td>
					<td class="r">${e.type === 'file' ? html`${fbOpeners(e.name).map((a) => html`<button class="btn sm ghost" type="button" data-act="fb-app" data-name="${e.name}" data-app="${a.id}" title="Öffnen mit ${a.name}">${a.name} ↗</button> `)}<button class="btn sm ghost" type="button" data-act="fb-dl" data-name="${e.name}" title="Herunterladen" aria-label="${e.name} herunterladen">${svg(I.dl)}</button>` : ''}</td></tr>`;
			})}</tbody></table></div>`
			: html`<div class="empty">${svg(I.folder)}<span>Dieser Ordner ist leer.</span></div>`}
		${d.truncated ? html`<p class="note">Es werden nur die ersten 2000 Einträge gezeigt.</p>` : ''}
		<p class="note">Dateien lassen sich auch einfach hierher ziehen. ${n ? html`<b>${n} ausgewählt.</b>` : ''}</p>
	</div>`;
}

// admins: trash on/off and how long it keeps things (below the file browser)
function trashSettings() {
	const c = S.fb?.trashConf;
	if (!c) return '';
	return html`<section class="sec"><h2 class="gh">PAPIERKORB</h2><div class="g2"><div class="panel">
		<label class="chk"><input type="checkbox" id="trash-on"${c.enabled ? raw(' checked') : ''}>Gelöschtes im Dateibrowser erst in den Papierkorb legen</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>AUTOMATISCH ENDGÜLTIG LÖSCHEN NACH</span><select id="trash-days" ${c.enabled ? '' : 'disabled'}>
			${[[7, '7 Tagen'], [14, '14 Tagen'], [30, '30 Tagen'], [60, '60 Tagen'], [90, '90 Tagen'], [0, 'nie (nur von Hand leeren)']].map(([v, t]) => html`<option value="${v}"${c.days === v ? raw(' selected') : ''}>${t}</option>`)}
		</select></label></div>
		<p class="note">Jeder Ordner hat seinen eigenen Papierkorb: der persönliche Ordner, jede Freigabe, jedes Laufwerk. Er liegt auf derselben Platte und zählt zum Speicherlimit. Gilt für den Dateibrowser dieser Oberfläche – über SMB vom PC oder in Apps Gelöschtes ist sofort weg; dafür gibt es die Snapshots.</p>
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
			<nav class="crumbs" aria-label="Pfad"><button type="button" data-act="fb-trash-close">${svg(I.folder)}${fbRootLabel(root)}</button><span>/</span><b>Papierkorb</b></nav>
			${d?.days ? html`<span class="tag ml">löscht nach ${d.days} Tagen</span>` : ''}
		</div>
		<div class="acts fbtools">
			<button class="btn sm ghost" type="button" data-act="fb-trash-close" title="Zurück" aria-label="Zurück">${svg(I.up)}</button>
			<button class="btn sm" type="button" data-act="fb-trash-restore" ${n && !ro ? '' : 'disabled'}>${svg(I.reboot)}Wiederherstellen</button>
			<button class="btn sm danger" type="button" data-act="fb-trash-del" ${n && !ro ? '' : 'disabled'}>${svg(I.trash)}Endgültig löschen</button>
			<span class="sep"></span>
			<button class="btn sm danger" type="button" data-act="fb-trash-del" data-all="1" ${items.length && !ro ? '' : 'disabled'}>Papierkorb leeren</button>
		</div>
		${!d ? html`<div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div>`
			: d.error ? html`<div class="empty">${svg(I.warn)}<span>${d.error}</span></div>`
			: items.length ? html`<div class="tw"><table class="t fbt">
				<thead><tr><th style="width:34px"></th><th>NAME</th><th>HERKUNFT</th><th class="r">GRÖSSE</th><th>GELÖSCHT</th></tr></thead>
				<tbody>${items.map((x) => html`<tr class="${f.tsel.has(x.id) ? 'sel' : ''}">
					<td><input type="checkbox" class="fb-tsel" data-id="${x.id}" aria-label="${x.name} auswählen"${f.tsel.has(x.id) ? raw(' checked') : ''}></td>
					<td class="nm"><span class="lnk">${svg(x.type === 'dir' ? I.folder : I.doc)}<span>${x.name}</span></span></td>
					<td class="mut">${x.path ? '/' + x.path : '/'}</td>
					<td class="r mut">${x.size != null ? fmtBytes(x.size) : ''}</td>
					<td class="mut">${fmtTime(x.time)}${x.user && x.user !== S.me?.name ? html` · ${x.user}` : ''}</td></tr>`)}</tbody></table></div>`
			: html`<div class="empty">${svg(I.trash)}<span>Der Papierkorb ist leer.</span></div>`}
	</div>`;
}

async function fbDownload(name) {
	const f = S.fb;
	try {
		const r = await rpc('shareos.files', 'ticket', { root: f.root, path: f.path, name, mode: 'get' });
		const a = document.createElement('a');
		a.href = r.url; a.download = name;
		document.body.append(a); a.click(); a.remove();
	} catch (e) { toast('Herunterladen: ' + e.message, true); }
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
	const w = window.open('about:blank', a.window ? 'sosfile-' + Date.now() : '_blank', winFeatures(a));
	try {
		const r = await rpc('shareos.files', 'app_ticket', { root: S.fb.root, path: S.fb.path, name, app: appId });
		const url = `${appBase(r)}/${r.app}/${r.entry || 'index.html'}?${appParams({ file: r.ticket, name, ...(r.grant ? { fs: r.grant } : {}) })}`;
		if (w) { w.location.href = url; appWins.add(w); } else location.href = url;
	} catch (e) { w?.close(); toast('Öffnen: ' + e.message, true); }
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
		x.onerror = () => reject(new Error('Verbindung unterbrochen'));
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
				if (!await confirmDlg('Datei ersetzen?', `„${u.name}“ gibt es in diesem Ordner schon.`, 'Ersetzen', true)) { u.err = 'übersprungen'; fbRender(); continue; }
				t = await rpc('shareos.files', 'ticket', { root, path, name: u.name, mode: 'put', overwrite: true });
			}
			let last = 0;
			await fbSend(t.url, u.file, (p) => { u.pct = p; if (p - last >= 3 || p === 100) { last = p; fbRender(); } });
			u.pct = 100;
		} catch (e) { u.err = e.message; }
		fbRender();
	}
	const bad = list.filter((u) => u.err && u.err !== 'übersprungen').length;
	toast(bad ? `${bad} Datei(en) nicht hochgeladen.` : `${list.length} Datei(en) hochgeladen.`, !!bad);
	if (S.fb && S.fb.root === root && S.fb.path === path) await fbLoad();
	setTimeout(() => { if (S.fb && S.fb.uploads === list && !list.some((u) => u.err)) { S.fb.uploads = []; fbRender(); } }, 4000);
}

async function fbTransfer(copy) {
	const f = S.fb, names = [...f.sel];
	const dest = await promptDlg(copy ? 'Kopieren nach' : 'Verschieben nach',
		`${names.length} Eintrag/Einträge. Zielordner als Pfad in „${fbRootLabel(f.roots.find((r) => r.name === f.root))}“, z. B. Fotos/2026 (leer = oberste Ebene).`,
		f.path, copy ? 'Kopieren' : 'Verschieben', 'text', 1024);
	if (dest == null) return;
	try {
		await rpc('shareos.files', 'move', { root: f.root, path: f.path, names, dest: dest.replace(/^\/+|\/+$/g, ''), copy });
		toast(copy ? 'Kopiert.' : 'Verschoben.');
		fbLoad();
	} catch (e) { toast((copy ? 'Kopieren: ' : 'Verschieben: ') + e.message, true); }
}

Object.assign(ACTIONS, {
	'fb-open'(el) { fbLoad(fbJoin(S.fb.path, el.dataset.name)); },
	'fb-crumb'(el) { fbLoad(el.dataset.p); },
	'fb-up'() { const p = S.fb.path.split('/'); p.pop(); fbLoad(p.join('/')); },
	'fb-dl'(el) { fbDownload(el.dataset.name); },
	async 'note-read'(el) { try { await rpc('shareos.notify', 'read', { id: el.dataset.id }); } catch (e) { toast(e.message, true); } loadNotes(); },
	async 'note-del'(el) {
		if (el.dataset.id === 'all' && !await confirmDlg('Alle Meldungen löschen?', 'Die Liste wird geleert. Besteht ein Problem weiter, meldet die Box es bei der nächsten Prüfung wieder.', 'Löschen')) return;
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
		if (!w) { toast('Fenster blockiert – Pop-ups für diese Seite erlauben.', true); return; }
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
			if (!r.chats.length) { toast('Noch keine Nachricht an den Bot – erst den Token speichern, dann dem Bot in Telegram schreiben.', true); return; }
			const c = r.chats[r.chats.length - 1];
			$('#f-notify input[name=push_chat]').value = c.id;
			toast(`Chat gefunden: ${c.name || c.username || c.id} – jetzt speichern.`);
		} catch (e) { toast('Telegram: ' + e.message, true); }
		finally { el.disabled = false; }
	},
	async 'note-test'(el) {
		el.disabled = true;
		try { await rpc('shareos.notify', 'test'); toast('Testnachricht verschickt.'); }
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
		const name = await promptDlg('Neuer Ordner', 'Name des neuen Ordners:', '', 'Anlegen', 'text', 255);
		if (!name) return;
		try { await rpc('shareos.files', 'mkdir', { root: S.fb.root, path: S.fb.path, name }); fbLoad(); }
		catch (e) { toast('Ordner: ' + e.message, true); }
	},
	async 'fb-rename'() {
		const old = [...S.fb.sel][0];
		const to = await promptDlg('Umbenennen', `Neuer Name für „${old}“:`, old, 'Umbenennen', 'text', 255);
		if (!to || to === old) return;
		try { await rpc('shareos.files', 'rename', { root: S.fb.root, path: S.fb.path, name: old, to }); fbLoad(); }
		catch (e) { toast('Umbenennen: ' + e.message, true); }
	},
	'fb-move'() { fbTransfer(false); },
	'fb-copy'() { fbTransfer(true); },
	async 'fb-del'() {
		const names = [...S.fb.sel], list = `${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''}`;
		const trash = S.fb.trashConf?.enabled && !(S.fb.path === '.shareos-trash' || S.fb.path.startsWith('.shareos-trash/'));
		if (trash) {
			if (!await confirmDlg(`${names.length} Eintrag/Einträge in den Papierkorb?`, `${list} – lässt sich im Papierkorb wiederherstellen.`, 'In den Papierkorb')) return;
		} else if (!await confirmDlg(`${names.length} Eintrag/Einträge löschen?`, `${list} – Ordner samt Inhalt. Das lässt sich nicht rückgängig machen.`, 'Löschen', true)) return;
		try {
			const r = await rpc('shareos.files', 'delete', { root: S.fb.root, path: S.fb.path, names });
			toast(r.trash ? 'In den Papierkorb verschoben.' : 'Gelöscht.'); fbLoad();
		} catch (e) { toast('Löschen: ' + e.message, true); }
	},
	async 'fb-trash'() { S.fb.trash = true; S.fb.tsel = new Set(); S.fb.tdata = null; fbRender(); fbTrashLoad(); },
	'fb-trash-close'() { S.fb.trash = false; fbLoad(); },
	async 'fb-trash-restore'() {
		const ids = [...S.fb.tsel];
		try {
			const r = await rpc('shareos.files', 'trash_restore', { root: S.fb.root, ids });
			toast(`${r.restored.length} Eintrag/Einträge wiederhergestellt.`); S.fb.tsel = new Set(); fbTrashLoad();
		} catch (e) { toast('Wiederherstellen: ' + e.message, true); }
	},
	async 'fb-trash-del'(el) {
		const all = el.dataset.all === '1', ids = all ? [] : [...S.fb.tsel];
		const n = all ? (S.fb.tdata?.items || []).length : ids.length;
		const title = `Endgültig löschen – ${n} Eintrag/Einträge`;
		if (!await confirmDlg(all ? 'Papierkorb leeren?' : title, 'Das lässt sich nicht rückgängig machen.', all ? 'Leeren' : 'Endgültig löschen', true)) return;
		try { await rpc('shareos.files', 'trash_empty', { root: S.fb.root, ids }); toast(all ? 'Papierkorb geleert.' : 'Endgültig gelöscht.'); S.fb.tsel = new Set(); fbTrashLoad(); }
		catch (e) { toast('Löschen: ' + e.message, true); }
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
		toast(t.value === 'page' ? 'Öffnet sich jetzt in der Seite.' : 'Öffnet sich jetzt in einem eigenen Fenster.');
		renderMain();
	} catch (err) { toast('Anzeige: ' + err.message, true); }
});

// trash settings (admins, below the file browser)
document.addEventListener('change', async (e) => {
	if (e.target.id !== 'trash-on' && e.target.id !== 'trash-days') return;
	const c = S.fb?.trashConf;
	if (!c) return;
	const on = $('#trash-on').checked, days = +$('#trash-days').value;
	try { S.fb.trashConf = await rpc('shareos.files', 'trash_config', { enabled: on, days }); toast('Papierkorb gespeichert.'); }
	catch (err) { toast('Papierkorb: ' + err.message, true); }
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

const APP_SUBS = [['installed', 'INSTALLIERT'], ['store', 'STORE'], ['sources', 'QUELLEN']];
const APP_CAT = { tools: 'Werkzeuge', media: 'Medien', office: 'Büro', network: 'Netzwerk', system: 'System', download: 'Download', sync: 'Sync' };
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

// favourite apps of the logged-in account ("FAV APPS" bar above the overview / the apps / Mein ShareOS)
const favIds = () => S.me?.fav?.apps || [];
const favBarOn = () => S.me?.fav?.bar !== false;
const favTextOn = () => S.me?.fav?.text !== false;
const appHref = (a, srv) => appMode(a) === 'page' ? (isUser() ? '#/app/' : '#/apps/run/') + a.id : appLaunchUrl(a, srv);
function favStar(a) {
	if (a.type === 'system') return '';
	const on = favIds().includes(a.id);
	const t = on ? 'Aus den Favoriten nehmen' : 'Als Favorit markieren';
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
const favBarOpt = () => html`<label class="chk"><input type="checkbox" id="opt-favbar"${favBarOn() ? raw(' checked') : ''}>App-Leiste „FAV APPS“ anzeigen (nur für dich)</label>
	<label class="chk"><input type="checkbox" id="opt-favtext"${favTextOn() ? raw(' checked') : ''}${favBarOn() ? '' : raw(' disabled')}>Namen unter den Symbolen zeigen (aus: nur Symbole)</label>`;
async function favSave(args) {
	try { S.me.fav = await rpc('shareos.me', 'fav_set', args); }
	catch (e) { toast('Favoriten: ' + e.message, true); }
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
// "eigenes Fenster" for it); "window": a window of its own
const appMode = (a) => ((a?.permissions || []).includes('embed') && a.display !== 'window' ? 'page' : 'window');
const findApp = (id) => (S.apps?.installed?.apps || []).find((x) => x.id === id) || (S.me?.apps || []).find((x) => x.id === id)
	|| (S.fbApps?.apps || []).find((x) => x.id === id);
const appSrv = () => S.apps?.installed || S.me?.apps_server || S.fbApps;

const sysApps = () => S.sysapps || [];

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
	catch (e) { if (e.message !== 'not allowed') toast('Dateizugriff: ' + e.message, true); return null; }
}

// apps shown in the page get their own address in this interface, the others a window
function launchApp(a) {
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
	if (!a) return html`<section class="sec"><div class="panel"><div class="empty">${S.apps?.installed || S.me ? html`${svg(I.warn)}<span>Diese App gibt es nicht (mehr). <a href="${back}">Zurück</a></span>`
		: html`<div class="spin" style="margin:0"></div><span>Lade …</span>`}</div></div></section>`;
	return html`<section class="sec apppage-sec"><h2 class="gh apph">${appIcon(a, appSrv())}<span class="an">${a.name}</span>
		<button class="btn sm ghost" type="button" data-act="app-window" data-id="${a.id}">In eigenem Fenster ↗</button>
		<a class="btn sm ghost" href="${back}" aria-label="Schließen">✕</a></h2>
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
	try { $('#appframe')?.contentWindow?.postMessage(msg, origin); } catch (e) { }
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
		if (!quiet) toast(S.apps.catalog.errors?.length ? 'Store: ' + S.apps.catalog.errors[0].error : 'Store aktualisiert.', !!S.apps.catalog.errors?.length);
	} catch (e) { if (!quiet) toast('Store: ' + e.message, true); }
	S.apps.busy = false;
	if (S.route.tab === 'apps') renderMain();
}

async function pollAppJob() {
	clearTimeout(S.appTimer);
	try {
		const j = await rpc('shareos.apps', 'status');
		S.apps.job = j;
		if (['downloading', 'verifying', 'installing'].includes(j.state)) { S.appTimer = setTimeout(pollAppJob, 1000); }
		else {
			if (j.state === 'done') toast((j.also || []).length ? `${j.id} ${j.version} installiert, dazu: ${j.also.join(', ')}.` : `${j.id} ${j.version} installiert.`);
			if (j.state === 'done' && j.warning) toast('Hinweis: ' + j.warning, true);
			else if (j.state === 'error') toast('Installieren: ' + (j.error || 'fehlgeschlagen'), true);
			S.apps.job = null;
			await loadApps(['installed', 'catalog']);
			return;
		}
	} catch (e) { S.appTimer = setTimeout(pollAppJob, 2000); }
	if (S.route.tab === 'apps') renderMain();
}

const JOB_TXT = { downloading: 'wird geladen', verifying: 'wird geprüft', installing: 'wird installiert' };

function appsView() {
	const sub = S.route.sub, A = S.apps;
	const nav = html`<nav class="subtabs" aria-label="Apps">${APP_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/apps/${id}">${label}</a>`)}</nav>`;
	if (!A?.installed) return html`${nav}<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Lade …</span></div></div>`;
	const job = A.job && JOB_TXT[A.job.state] ? html`<div class="banner" style="border-color:var(--dim)"><div class="spin" style="margin:0;width:20px;height:20px"></div><span><b>${A.job.id}</b> ${JOB_TXT[A.job.state]} …</span></div>` : '';
	if (sub === 'run') return html`${nav}${appPageView(findApp(S.route.app), '#/apps/installed')}`;
	return html`${nav}${job}${sub === 'store' ? appStore() : sub === 'sources' ? appSources() : appInstalled()}`;
}

function appUsersTxt(a) {
	if (a.type === 'system') return 'Terminal (Administratoren)';
	if (a.users.includes('*')) return 'alle Benutzer';
	if (!a.users.length) return 'nur Administratoren';
	return a.users.join(', ');
}

function appInstalled() {
	const A = S.apps, list = A.installed.apps || [], cat = {};
	for (const c of A.catalog?.apps || []) cat[c.id] = c;
	if (A.edit) return appUsersEditor(A.edit);
	if (A.jobs) return appJobsEditor(A.jobs);
	const upd = (a) => cat[a.id]?.update_available ? cat[a.id] : null;
	const t = isTable('apps');
	return html`${favBar(list)}<section class="sec">${secHead('apps', 'INSTALLIERTE APPS', list.length ? `${list.length}` : '')}
		${!list.length ? html`<div class="panel"><div class="empty">${svg(I.box)}<span>Noch keine App installiert. Im <a href="#/apps/store">Store</a> gibt es Apps zum Installieren – oder ein eigenes Paket (.sapp) hochladen.</span></div></div>`
		: t ? html`<div class="tw"><table class="t" style="min-width:720px"><thead><tr><th></th><th>APP</th><th>VERSION</th><th>HERAUSGEBER</th><th>SICHTBAR FÜR</th><th></th></tr></thead><tbody>
			${list.map((a) => html`<tr><td style="width:44px">${appIcon(a)}</td><td><b>${a.name}</b> ${favStar(a)}${a.verified ? '' : html` <span class="tag warn">eigene</span>`}<div class="mut" style="font-size:12px">${txtOf(a.description)}</div></td>
				<td>${a.version}${upd(a) ? html` <span class="tag warn">→ ${upd(a).latest}</span>` : ''}</td><td class="mut">${a.publisher}</td><td class="mut">${appUsersTxt(a)}</td>
				<td style="white-space:nowrap">${appActions(a, upd(a))}</td></tr>`)}</tbody></table></div>`
		: html`<div class="grid">${list.map((a) => html`<div class="card">${favStar(a)}
			<div class="icon">${appIcon(a)}</div>
			<div class="info"><div class="name">${a.name} <span class="mut" style="font-size:12px">${a.version}</span></div>
				<div class="desc">${txtOf(a.description)}</div>
				<div class="desc" style="margin-top:6px"><span class="tag ${a.verified ? 'ok' : 'warn'}">${a.verified ? 'aus dem Store' : 'eigene / ungeprüft'}</span> ${upd(a) ? html`<span class="tag warn">Update ${upd(a).latest}</span>` : ''}</div>
				${permTags(appPerms(a))}
				<div class="ip">${a.publisher} · ${a.type === 'system' ? html`<span>Befehl</span> ${sysCmds(a)}` : 'sichtbar für ' + appUsersTxt(a)}</div>
				<div class="acts" style="margin-top:10px">${appActions(a, upd(a))}</div></div></div>`)}</div>`}
		<p class="note">Web-Apps laufen auf einem eigenen Port (${A.installed.port}${A.installed.https ? ' / ' + A.installed.https_port + ' für HTTPS' : ''}) – getrennt von dieser Oberfläche, damit eine App deine Anmeldung nicht benutzen kann. Wer die Adresse kennt, kann eine Web-App im Netzwerk öffnen; „sichtbar für“ steuert, wem sie in „Mein ShareOS“ angezeigt wird.</p>
	</section>`;
}

// commands of a system app, e.g. "nano"
const sysCmds = (a) => (a.commands || []).map((c, i) => html`${i ? ', ' : ''}<code style="white-space:nowrap">${c}</code>`);

function appActions(a, upd) {
	const busy = !!(S.apps.job && JOB_TXT[S.apps.job.state]);
	const sys = a.type === 'system';
	return html`${sys ? html`<a class="btn sm" href="#/system/terminal">${svg(I.term)}Terminal</a>`
		: html`<button class="btn sm" type="button" data-act="app-launch" data-id="${a.id}">${appMode(a) === 'page' ? 'Öffnen' : 'Öffnen ↗'}</button>`}
		${!sys && (a.permissions || []).includes('embed') ? html`<select class="btn sm ghost app-display" data-id="${a.id}" aria-label="Anzeige von ${a.name}">
			<option value="page"${a.display !== 'window' ? raw(' selected') : ''}>In der Seite</option><option value="window"${a.display === 'window' ? raw(' selected') : ''}>Eigenes Fenster</option></select>` : ''}
		${upd ? html`<button class="btn sm primary" type="button" data-act="app-install" data-id="${a.id}" data-v="${upd.latest}" ${busy ? 'disabled' : ''}>${svg(I.dl)}Aktualisieren</button>` : ''}
		${(a.jobs || []).length ? html`<button class="btn sm ghost" type="button" data-act="app-jobs" data-id="${a.id}">${svg(I.clock)}Aufgaben</button>` : ''}
		${sys ? '' : html`<button class="btn sm ghost" type="button" data-act="app-users" data-id="${a.id}">${svg(I.users)}Benutzer</button>`}
		<button class="btn sm ghost" type="button" data-act="app-remove" data-id="${a.id}">${svg(I.trash)}Entfernen</button>`;
}

// permissions an app can ask for (app.json "permissions")
const PERM_TAG = { cron: 'Zeitgesteuerte Aufgaben', embed: 'In ShareOS anzeigen', files: 'Zugriff auf Dateien', torrent: 'Eigene Torrents (Transmission)', media: 'Medien umwandeln (FFmpeg)', vpn: 'VPN der Box (OpenVPN)', tailscale: 'Fernzugriff (Tailscale)', autobrr: 'Download-Automatik (autobrr)', sysinfo: 'Werte der Box', netcheck: 'Netzwerk prüfen', docker: 'Docker-Hosts', tuya: 'Smart Home (Tuya)', notify: 'Meldungen senden', status: 'Anzeige im Kopf', internet: 'Nutzt das Internet', system: 'System-App · Terminal' };
// permissions plus "internet" (manifest field: the app loads data from the internet – not a restriction, shown for transparency)
// and "system" for system apps (programs for the terminal)
const appPerms = (x) => [...(x?.type === 'system' ? ['system'] : []), ...(x?.permissions || []), ...(x?.internet ? ['internet'] : [])];
const permTags = (perms) => (perms.length ? html`<div class="desc" style="margin-top:6px">${perms.map((p) => html`<span class="tag" title="${PERM_TXT[p] || p}">${PERM_TAG[p] || p}</span> `)}</div>` : '');
const PERM_TXT = { cron: 'Darf zeitgesteuerte Aufgaben auf der Box ausführen – als eigener eingeschränkter Benutzer, nur in ihrem Datenordner, mit Zeitlimit.',
	embed: 'Darf als Seite in der ShareOS-Oberfläche angezeigt werden (statt in einem eigenen Fenster).',
	files: 'Darf die Dateien lesen, ändern und löschen, die der angemeldete Benutzer im Dateibrowser erreicht – mit seinen Rechten, solange die App offen ist.',
	torrent: 'Darf den eigenen Transmission-Dienst des Benutzers steuern: Torrents hinzufügen, anhalten und löschen. Jeder Benutzer hat seinen eigenen Dienst; Downloads landen nur in seinen Ordnern.',
	media: 'Darf auf der Box Audio und Video des Benutzers umwandeln lassen (FFmpeg) – mit seinen Rechten, nur in seinen Ordnern, aus festen Auswahlen (kein beliebiger Befehl).',
	vpn: 'Darf die Box als VPN-Client verbinden und trennen und VPN-Profile verwalten (OpenVPN) – das betrifft das Netzwerk der ganzen Box, deshalb nur für Administratoren.',
	tailscale: 'Darf die Box mit Tailscale verbinden, an- und abmelden und die Geräte des Tailnets sehen – das betrifft das Netzwerk der ganzen Box, deshalb nur für Administratoren.',
	autobrr: 'Darf autobrr der Box einrichten und steuern (Filter, Indexer, IRC, Releases) und festlegen, in wessen Transmission gefundene Torrents landen – ein Dienst für die ganze Box, deshalb nur für Administratoren.',
	sysinfo: 'Darf die Werte der Box lesen (CPU, Arbeitsspeicher, Temperatur, Lüfter, Laufwerke, Prozesse) und Prozesse beenden, die ShareOS nicht braucht – nur für Administratoren.',
	netcheck: 'Darf von der Box aus prüfen, ob Geräte und Dienste im Netz erreichbar sind (Ping, Port, HTTP/HTTPS) – nur für Administratoren.',
	docker: 'Darf die Docker-Hosts verwalten, die der Administrator einträgt, und dort Container ansehen, starten, stoppen und neu starten sowie ihre Protokolle lesen (Docker-API) – nur für Administratoren.',
	tuya: 'Darf von der Box aus Tuya-Geräte im Heimnetz suchen, ihren Zustand lesen und sie schalten (lokal, ohne Cloud) – nur für Administratoren.',
	notify: 'Darf Meldungen über die Benachrichtigungen der Box senden (Oberfläche, E-Mail, Push) – höchstens 20 pro Stunde, mit dem Namen der App davor; im Browser nur für Administratoren.',
	status: 'Darf oben in der Kopfzeile der ShareOS-Oberfläche einen kurzen Zustand anzeigen (z. B. „verbunden“) – nur für den Benutzer, der die App geöffnet hat; er verschwindet nach höchstens 10 Minuten von selbst.',
	internet: 'Lädt Daten aus dem Internet (z. B. Online-Dienste, Streams, Karten). Ohne Internetverbindung funktionieren diese Teile der App nicht.',
	system: 'Programm für die Kommandozeile der Box (System → Terminal oder SSH). Es läuft mit den Rechten dessen, der es startet – im Terminal als root.' };

function appJobsEditor(id) {
	const a = (S.apps.installed.apps || []).find((x) => x.id === id);
	if (!a) { S.apps.jobs = null; return ''; }
	const last = (j) => !j.last ? html`<span class="mut">noch nie</span>`
		: html`${fmtTime(j.last.time)} · ${j.last.timeout ? html`<span class="tag warn">Zeitlimit</span>` : j.last.rc === 0 ? html`<span class="tag ok">OK</span>` : html`<span class="tag err">Fehler ${j.last.rc}</span>`} · ${j.last.duration} s`;
	return html`<section class="sec"><form class="panel" id="f-appjobs" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${a.name.toUpperCase()} · AUFGABEN</span><button class="btn sm ghost ml" type="button" data-act="app-jobs-cancel">Schließen</button></div>
		<div class="tw"><table class="t" style="min-width:760px"><thead><tr><th>AUFGABE</th><th>ZEITPLAN (CRON)</th><th>AKTIV</th><th>ZULETZT</th><th></th></tr></thead><tbody>
			${a.jobs.map((j) => html`<tr data-job="${j.id}"><td><b>${j.name}</b><div class="mut" style="font-size:12px">${j.command} · max. ${j.timeout} s</div></td>
				<td><label class="f" style="margin:0;width:160px"><input class="job-sched" value="${j.schedule}" spellcheck="false" pattern="[0-9*/,\\-]+( [0-9*/,\\-]+){4}"></label>${j.schedule !== j.default_schedule ? html`<div class="mut" style="font-size:11px">Standard: ${j.default_schedule}</div>` : ''}</td>
				<td><label class="chk"><input type="checkbox" class="job-on"${j.enabled ? raw(' checked') : ''}></label></td>
				<td style="font-size:12px">${j.running ? html`<span class="tag">läuft</span>` : last(j)}</td>
				<td style="white-space:nowrap"><button class="btn sm" type="button" data-act="app-job-run" data-id="${a.id}" data-job="${j.id}" ${j.running ? 'disabled' : ''}>Jetzt ausführen</button>
					<button class="btn sm ghost" type="button" data-act="app-job-log" data-id="${a.id}" data-job="${j.id}">Protokoll</button></td></tr>`)}
		</tbody></table></div>
		${S.apps.jobLog ? html`<div class="pt" style="margin:14px 0 6px">PROTOKOLL · ${S.apps.jobLog.job}</div><pre class="logbox" style="max-height:260px">${S.apps.jobLog.log || '(leer)'}</pre>` : ''}
		<p class="note"><span>${PERM_TXT.cron}</span> Zeitplan im Cron-Format (Minute Stunde Tag Monat Wochentag), höchstens alle 5 Minuten, z. B. <code>30 3 * * *</code> = täglich 3:30 Uhr.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button></div>
	</form></section>`;
}

function appUsersEditor(id) {
	const a = (S.apps.installed.apps || []).find((x) => x.id === id);
	if (!a) { S.apps.edit = null; return ''; }
	const acc = S.acc || { users: [], groups: [] };
	const web = acc.users.filter((u) => u.role === 'user' && u.web);
	const all = a.users.includes('*');
	return html`<section class="sec"><form class="panel" id="f-appusers" style="border-color:var(--dim);box-shadow:var(--glow);max-width:720px">
		<div class="ph"><span class="pt">${a.name.toUpperCase()} · SICHTBAR FÜR</span><button class="btn sm ghost ml" type="button" data-act="app-users-cancel">Abbrechen</button></div>
		<label class="chk"><input type="checkbox" name="all"${all ? raw(' checked') : ''}>Alle Benutzer mit Web-Zugang</label>
		<div id="app-users-list"${all ? raw(' hidden') : ''}>
			${acc.groups.length ? html`<div class="pt" style="margin:14px 0 6px">GRUPPEN</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${acc.groups.map((g) => html`<label class="chk"><input type="checkbox" class="app-u" value="@${g.name}"${a.users.includes('@' + g.name) ? raw(' checked') : ''}>${g.name}</label>`)}</div>` : ''}
			<div class="pt" style="margin:14px 0 6px">BENUTZER</div>
			${web.length ? html`<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${web.map((u) => html`<label class="chk"><input type="checkbox" class="app-u" value="${u.name}"${a.users.includes(u.name) ? raw(' checked') : ''}>${u.fullname || u.name}</label>`)}</div>`
				: html`<p class="note">Kein Benutzer mit Web-Zugang – unter Freigaben → Benutzer einrichten.</p>`}
		</div>
		<p class="note">Administratoren sehen alle Apps. Die Auswahl bestimmt, wem die App in „Mein ShareOS“ angezeigt wird.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button></div>
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
		rows.push(html`<tr class="grp" data-cat="${k}"><td colspan="7">${APP_CAT[k] || 'Sonstige'} <span class="mut">${list.length}</span></td></tr>`);
	for (const a of list) {
		const v = a.versions[0];
		rows.push(html`<tr data-cat="${k}" data-q="${(a.name + ' ' + a.id + ' ' + txtOf(a.description) + ' ' + (a.publisher || '')).toLowerCase()}"><td style="width:44px">${appIcon(a)}</td>
			<td><b>${a.name}</b>${a.category ? html` <span class="tag">${APP_CAT[a.category] || a.category}</span>` : ''}<div class="mut" style="font-size:12px;max-width:420px">${txtOf(a.description)}</div>${permTags(appPerms({ ...v, type: a.type }))}</td>
			<td><b>${v.version}</b>${v.prerelease ? html` <span class="tag">BETA</span>` : ''}</td>
			<td class="mut">${a.publisher}</td><td class="mut">${fmtDate(v.date)}</td><td class="mut">${fmtBytes(v.size)}</td>
			<td style="white-space:nowrap">${a.installed && !a.update_available ? html`<span class="tag ok">installiert</span>`
				: !a.compatible ? html`<span class="tag warn">braucht neuere ShareOS</span>`
				: html`<button class="btn sm${a.installed ? ' primary' : ''}" type="button" data-act="app-install" data-id="${a.id}" data-v="${v.version}" ${busy ? 'disabled' : ''}>${svg(I.dl)}${a.installed ? 'Aktualisieren' : 'Installieren'}</button>`}
				${v.notes_url ? html`<a class="btn sm ghost" href="${v.notes_url}" target="_blank" rel="noopener">Notes ↗</a>` : ''}</td></tr>`);
	}
	}
	const catBtn = (k, label, n) => html`<button class="btn sm${cat === k ? ' primary' : ' ghost'}" type="button" data-act="app-cat" data-cat="${k}">${label} <span class="${cat === k ? '' : 'mut'}">${n}</span></button>`;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">APP-STORE</span><span class="tag ml">${c.time ? 'Stand ' + fmtTime(c.time) : 'noch nicht geladen'}</span></div>
				<div class="fields"><label class="f"><span>KANAL</span><select id="app-channel">
					<option value="stable"${ch === 'stable' ? raw(' selected') : ''}>Stabil (Releases)</option>
					<option value="beta"${ch === 'beta' ? raw(' selected') : ''}>Beta (auch Vorabversionen)</option></select></label></div>
				${(c.errors || []).map((e) => html`<p class="note" style="color:var(--amber)">${e.source}: ${e.error}</p>`)}
				<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="app-refresh" ${A.busy ? 'disabled' : ''}>${A.busy ? 'Lade …' : 'Jetzt aktualisieren'}</button></div>
			</div>
			<form class="panel" id="f-appupload">
				<div class="ph"><span class="pt">PAKET INSTALLIEREN</span><span class="tag ml">.sapp</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>PAKETDATEI</span><input type="file" name="file" accept=".sapp,application/gzip" required></label></div>
				<p class="note">Für eigene Apps (gebaut mit <code>tools/build.py</code> aus dem App-Repo). Hochgeladene Pakete gelten als „eigene / ungeprüft“.</p>
				<div class="acts" style="margin-top:12px"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${svg(I.ul)}Hochladen & installieren</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">VERFÜGBARE APPS <span>${apps.length}</span></h2>
		${apps.length ? html`<div class="acts store-cats" style="margin-bottom:12px">${catBtn('all', 'Alle', apps.length)}${cats.map((k) => catBtn(k, APP_CAT[k] || 'Sonstige', apps.filter((a) => catOf(a) === k).length))}
			<input id="app-search" type="search" placeholder="Suchen …" autocomplete="off" spellcheck="false" value="${A.q || ''}" style="margin-left:auto;min-height:32px;min-width:180px;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:0 10px"></div>` : ''}
		${rows.length ? html`<div class="tw"><table class="t store" style="min-width:820px"><thead><tr><th></th><th>APP</th><th>VERSION</th><th>HERAUSGEBER</th><th>DATUM</th><th>GRÖSSE</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
			: html`<div class="panel"><div class="empty">${svg(I.cloud)}<span>${A.busy ? 'Lade den Katalog …' : 'Keine Apps gefunden – Internetverbindung und Quellen prüfen.'}</span></div></div>`}
	</section>`;
}

function appSources() {
	const st = S.apps.store || { sources: [] };
	return html`<section class="sec"><form class="panel" id="f-appsrc" style="max-width:820px">
		<div class="ph"><span class="pt">APP-QUELLEN</span><span class="tag ml">${st.sources.length}</span></div>
		<div style="display:grid;gap:8px">${st.sources.map((u, i) => html`<div class="acts" style="flex-wrap:nowrap"><input class="src-url" value="${u}" style="flex:1;min-height:36px;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:0 10px"><button class="btn sm ghost" type="button" data-act="app-src-del" data-i="${i}">Entfernen</button></div>`)}</div>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>WEITERE QUELLE (KATALOG-ADRESSE)</span><input name="add" placeholder="https://github.com/<name>/<repo>/releases/download/catalog/index.json"></label></div>
		<p class="note">Eine Quelle ist ein App-Katalog (<code>index.json</code>) im Format des Repos <a href="https://github.com/UniqueDroid/ShareOS-Apps" target="_blank" rel="noopener">ShareOS-Apps</a>. Eigene Apps: das Repo als Vorlage nehmen, die GitHub Action baut Pakete und Katalog. Nur Quellen eintragen, denen du vertraust.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Speichern</button></div>
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
			toast('Gespeichert.'); loadApps(['installed']);
		} catch (err) { toast('Aufgaben: ' + err.message, true); }
	});
	$('#f-appusers input[name=all]')?.addEventListener('change', (e) => { $('#app-users-list').hidden = e.target.checked; });
	$('#f-appusers')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, users = f.all.checked ? ['*'] : [...f.querySelectorAll('.app-u:checked')].map((x) => x.value);
		try { await rpc('shareos.apps', 'set', { id: S.apps.edit, users }); S.apps.edit = null; toast('Gespeichert.'); loadApps(['installed']); }
		catch (err) { toast('Apps: ' + err.message, true); }
	});
	$('#f-appsrc')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, sources = [...f.querySelectorAll('.src-url')].map((x) => x.value.trim()).filter(Boolean);
		if (f.add.value.trim()) sources.push(f.add.value.trim());
		try { await rpc('shareos.apps', 'store_set', { sources }); S.apps.store.sources = sources; toast('Gespeichert.'); refreshCatalog(true); renderMain(); }
		catch (err) { toast('Quellen: ' + err.message, true); }
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
			toast(`${r.id} ${r.version} installiert (eigene App).`);
			e.target.reset();
			await loadApps(['installed', 'catalog']);
		} catch (err) { toast('Paket: ' + err.message, true); btn.disabled = false; }
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
		const parts = [...perms.map((p) => PERM_TXT[p] || p), ...(need.length ? [`Dazu wird installiert: ${need.join(', ')}.`] : [])];
		if (parts.length && !await confirmDlg(`${c.name}: Berechtigungen`, raw(html`${parts.map((t) => html`<span>${t}</span> `)}`.s), 'Erlauben & installieren')) return;
		try {
			await rpc('shareos.apps', 'install', { id: el.dataset.id, version: el.dataset.v });
			S.apps.job = { state: 'downloading', id: el.dataset.id };
			renderMain();
			setTimeout(pollAppJob, 800);
		} catch (e) { toast('Installieren: ' + e.message, true); }
	},
	async 'app-remove'(el) {
		const a = (S.apps.installed.apps || []).find((x) => x.id === el.dataset.id);
		const users = (S.apps.installed.apps || []).filter((x) => x.id !== el.dataset.id && (x.requires || []).includes(el.dataset.id)).map((x) => x.name);
		const parts = [(a?.jobs || []).length ? 'Die App wird gelöscht, mit ihren Aufgaben und ihren Daten auf der Box.' : 'Die App wird gelöscht. Daten, die sie im Browser gespeichert hat, bleiben dort.',
			...(users.length ? [`Gebraucht von: ${users.join(', ')} – diese Apps funktionieren danach nicht mehr.`] : [])];
		if (!await confirmDlg(`${a?.name || el.dataset.id} entfernen?`, raw(html`${parts.map((t) => html`<span>${t}</span> `)}`.s), 'Entfernen', true)) return;
		try { await rpc('shareos.apps', 'remove', { id: el.dataset.id, force: users.length > 0 }); toast('Entfernt.'); loadApps(['installed', 'catalog']); }
		catch (e) { toast('Entfernen: ' + e.message, true); }
	},
	'app-users'(el) { S.apps.edit = el.dataset.id; if (!S.acc) rpc('shareos.accounts', 'list').then((a) => { S.acc = a; renderMain(); }).catch(() => {}); renderMain(); window.scrollTo(0, 0); },
	'app-users-cancel'() { S.apps.edit = null; renderMain(); },
	'app-jobs'(el) { S.apps.jobs = el.dataset.id; S.apps.jobLog = null; renderMain(); window.scrollTo(0, 0); },
	'app-jobs-cancel'() { S.apps.jobs = null; S.apps.jobLog = null; renderMain(); },
	async 'app-job-run'(el) {
		el.disabled = true;
		try {
			await rpc('shareos.apps', 'job_run', { id: el.dataset.id, job: el.dataset.job });
			toast('Aufgabe gestartet.');
			setTimeout(() => loadApps(['installed']), 1500);
		} catch (e) { toast('Aufgabe: ' + e.message, true); el.disabled = false; }
	},
	async 'app-job-log'(el) {
		try { const r = await rpc('shareos.apps', 'job_log', { id: el.dataset.id, job: el.dataset.job }); S.apps.jobLog = { job: el.dataset.job, log: r.log }; renderMain(); }
		catch (e) { toast('Protokoll: ' + e.message, true); }
	},
	async 'app-src-del'(el) {
		const sources = S.apps.store.sources.filter((_, i) => i !== +el.dataset.i);
		if (!await confirmDlg('Quelle entfernen?', 'Apps aus dieser Quelle erscheinen nicht mehr im Store. Installierte Apps bleiben.', 'Entfernen', true)) return;
		try { await rpc('shareos.apps', 'store_set', { sources }); S.apps.store.sources = sources; refreshCatalog(true); renderMain(); }
		catch (e) { toast('Quellen: ' + e.message, true); }
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
