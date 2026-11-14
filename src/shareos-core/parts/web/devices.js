/* ---------- printers (Services -> Printers, system app "printer") ------------------- */

async function loadPrinter() {
	clearTimeout(S.prnTimer);
	try { S.prn = await rpc('shareos.printer', 'status'); } catch (e) { toast('Printer: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'printer') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		// printers come and go: look again now and then
		S.prnTimer = setTimeout(loadPrinter, 20000);
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
	if (!S.prnTimer) S.prnTimer = setTimeout(loadPrinter, 20000);
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
		S.upsTimer = setTimeout(loadUps, S.ups?.running ? 10000 : 30000);
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
	if (!S.upsTimer) S.upsTimer = setTimeout(loadUps, 10000);
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

