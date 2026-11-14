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

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
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
	view(el) {
		const id = el.dataset.id;
		S.views[id] = isTable(id) ? 'tiles' : 'table';
		store.set('views', JSON.stringify(S.views));
		renderMain();
	}
});
