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

