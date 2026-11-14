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
			<label class="f"><span>NEW PASSWORD</span><input name="p1" type="password" minlength="8" autocomplete="new-password" required></label>
			<label class="f"><span>REPEAT</span><input name="p2" type="password" minlength="8" autocomplete="new-password" required></label>
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
