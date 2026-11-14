/* ---------- remote access for Transmission programs (Services -> Torrents) ---------- */

async function loadTremote() {
	try { S.tremote = await rpc('shareos.tremote', 'get'); } catch (e) { toast('Torrent remote access: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'torrent' && !document.activeElement?.matches('input')) renderMain();
}

function tremoteView() {
	const d = S.tremote;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>Torrents run on the system app Transmission: every user has their own service and controls it with the Transmission app. Here you can also switch on access for programs such as Transmission Remote GUI or Transmissionic.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Install from the store (Transmission)</a></div></div></div></div></section>`;
	const host = d.host || location.hostname;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">REMOTE ACCESS FOR TORRENT PROGRAMS</span>${d.running ? html`<span class="tag ok ml">running</span>` : html`<span class="tag ml">off</span>`}</div>
				${d.enabled ? html`<dl class="kv">
					<dt>Address</dt><dd data-i18n-skip><code>http://${host}:${d.port}${d.path}</code></dd>
					${d.https ? html`<dt>HTTPS</dt><dd data-i18n-skip><code>https://${host}:${d.https_port}${d.path}</code></dd>` : ''}
				</dl>` : html`<p class="mut" style="margin:0;font-size:13px">Switched off – torrents can only be controlled with the Transmission app.</p>`}
				<div class="pt" style="margin:14px 0 6px">USERS WITH A REMOTE PASSWORD</div>
				${d.accounts.length ? html`<div class="tw"><table class="t"><tbody>${d.accounts.map((u) => html`<tr><td data-i18n-skip><b>${u}</b></td>
					<td><div class="acts"><button class="btn sm ghost" type="button" data-act="tr-revoke" data-user="${u}">Revoke password</button></div></td></tr>`)}</tbody></table></div>`
				: html`<p class="mut" style="margin:0;font-size:13px">None yet – each user creates their password in the Transmission app.</p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Programs such as Transmission Remote GUI, Transmissionic or Tremotesf use it to control a user’s own Transmission service.</span> <span>Sign in with the user name and a separate remote password the user creates in the Transmission app – not with the box password.</span> <span>Only from the home network, also over VPN or Tailscale; access from the internet is blocked.</span> <span>After 5 wrong passwords, sign-in is blocked for 10 minutes.</span> <span>There is no separate web interface: in the browser, use the Transmission app.</span></p>
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-tremote" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Switch on remote access for torrent programs (also starts after a restart)</label>
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>PORT (HTTP)</span><input name="port" type="number" min="1024" max="65535" value="${d.port}"></label>
			<label class="f"><span>PORT (HTTPS)</span><input name="https_port" type="number" min="1024" max="65535" value="${d.https_port}"></label>
		</div>
		<p class="note">HTTPS is available while the web interface uses HTTPS (System → Network); the same certificate applies. Many programs expect port 9091.</p>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function tremoteAfter() {
	if (!S.tremote) { loadTremote(); return; }
	$('#f-tremote')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, b = $('button[type=submit]', f); b.disabled = true;
		try {
			S.tremote = await rpc('shareos.tremote', 'set', { enabled: f.enabled.checked, port: +f.port.value, https_port: +f.https_port.value });
			toast('Torrent remote access saved.');
		} catch (err) { toast('Torrent remote access: ' + err.message, true); }
		renderMain();
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
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'job_set', a)).jobs; S.snap.edit = null; toast(`Job “${a.name}” saved.`); loadSnapshots(); }
		catch (err) { toast('Snapshots: ' + err.message, true); }
	});
}

