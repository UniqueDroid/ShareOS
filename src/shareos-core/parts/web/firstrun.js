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
			if (p1.length < 8) return 'The password needs at least 8 characters.';
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

