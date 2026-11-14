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

