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

// the version the starter (index.html) loaded this interface with, as a query
// for files loaded later: a new firmware has new addresses, nothing stale
// comes from the browser's cache
const verQuery = () => (window.SHAREOS_V ? '?v=' + encodeURIComponent(window.SHAREOS_V) : '');

// The box runs another version than this page was loaded with (a firmware
// update while the tab was open): load the new interface. Once per version,
// and not while somebody types or a dialog is open – then at the next tick.
function reloadIfUpdated(ver) {
	const mine = window.SHAREOS_V;
	if (!mine || !ver || ver === mine) return;
	let done = null;
	try { done = sessionStorage.getItem('sos-reloaded'); } catch (e) { /* no storage: reload once per page life */ }
	if (done === ver || S.reloading) return;
	if (document.querySelector('dialog[open]') || document.activeElement?.matches?.('input, select, textarea')) return;
	S.reloading = true;
	try { sessionStorage.setItem('sos-reloaded', ver); } catch (e) { /* see above */ }
	toast('ShareOS was updated – loading the new interface …');
	setTimeout(() => location.reload(), 2500);
}

// the desktop view lives in desktop.js and desktop.css, loaded only when used
function deskStart() {
	if (typeof deskRun === 'function') { deskRun(); return; }
	$('#root').innerHTML = html`<div class="login"><div class="spin"></div></div>`.s;
	const css = document.createElement('link');
	css.rel = 'stylesheet'; css.href = 'desktop.css' + verQuery();
	document.head.append(css);
	const js = document.createElement('script');
	js.src = 'desktop.js' + verQuery();
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
		reloadIfUpdated(info.release?.version);
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

