/* ---------- services (Services -> Status, Autostart) -------------------------- */

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

/* --- after the page is drawn: listeners, loading --- */

Object.assign(VIEWS_AFTER, {
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
	}
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
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
	}
});
