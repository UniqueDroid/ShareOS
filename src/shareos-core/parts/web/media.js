/* ---------- media server (Services -> Media server, MiniDLNA) ------------------- */

const DLNA_TYPES = [['', 'do not share'], ['-', 'music, videos and pictures'], ['A', 'music only'], ['V', 'videos only'], ['P', 'pictures only']];

async function loadDlna() {
	clearTimeout(S.dlnaTimer);
	try { S.dlna = await rpc('shareos.dlna', 'status'); } catch (e) { toast('Media server: ' + e.message, true); }
	if (S.route.tab === 'services' && S.route.sub === 'dlna') {
		if (!document.activeElement?.matches('input,select')) renderMain();
		if (S.dlna?.running) S.dlnaTimer = setTimeout(loadDlna, S.dlna.scanning ? 4000 : 15000);
	}
}

function dlnaView() {
	const d = S.dlna;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading media server …</span></div></div>`;
	if (!d.installed) return html`<section class="sec"><div class="panel"><div class="empty">${svg(I.info)}<div>
		<span>The media server (MiniDLNA) is a system app: TVs, receivers, game consoles and apps like VLC then find the box in the network and play music, videos and pictures from the shares.</span>
		<div class="acts" style="margin-top:12px"><a class="btn primary" href="#/apps/store">Install from the store (MiniDLNA)</a></div></div></div></div></section>`;
	const media = {};
	d.media.forEach((m) => { if (!m.path) media[m.share] = m.type; });
	const subs = S.dlnaSubs || (S.dlnaSubs = d.media.filter((m) => m.path).map((m) => ({ ...m })));
	const host = location.hostname;
	return html`<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">MEDIA SERVER</span>${d.running ? html`<span class="tag ok ml">running</span>` : html`<span class="tag ml">off</span>`}${d.scanning ? html` <span class="tag">reading folders …</span>` : ''}</div>
				${d.running ? html`<div class="tiles" style="margin:0">
					<div class="tile"><div class="k">TRACKS</div><div class="v">${d.audio ?? '–'}</div></div>
					<div class="tile"><div class="k">VIDEOS</div><div class="v">${d.video ?? '–'}</div></div>
					<div class="tile"><div class="k">PICTURES</div><div class="v">${d.image ?? '–'}</div></div></div>
					<p class="note"><span>In the network as</span> <b>${d.name || d.hostname}</b> · <code>http://${host}:8200/</code></p>
					${d.clients.length ? html`<div class="pt" style="margin:12px 0 6px">DEVICES</div><div style="display:grid;gap:4px;font-size:13px">${d.clients.map((c) => html`<div>${c.type} <span class="mut">· ${c.ip}</span></div>`)}</div>` : ''}
					<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="dlna-rescan" ${d.scanning ? 'disabled' : ''}>Read everything again</button></div>`
				: html`<p class="mut" style="margin:0;font-size:13px">The media server is switched off. Choose folders below and switch it on.</p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Devices in the same network find the server by themselves (DLNA/UPnP AV), e.g. under “Media server” or “Sources” on the TV.</span> <span>New files show up by themselves after a short while; after big changes “Read everything again” helps.</span> <span>The server only reads – and shows everything in the chosen shares to every device in the network, without sign-in.</span> <span>Videos are not converted: the device must be able to play the format itself.</span></p>
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-dlna" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Media server switched on (also starts after a restart)</label>
		<div class="fields" style="margin-top:12px"><label class="f"><span>NAME IN THE NETWORK</span><input name="name" value="${d.name}" maxlength="48" placeholder="${d.hostname}"></label></div>
		<div class="pt" style="margin:16px 0 8px">SHARES</div>
		${d.shares.length ? html`<div class="tw"><table class="t"><thead><tr><th>SHARE</th><th>SHOW AS</th></tr></thead><tbody>
			${d.shares.map((n) => html`<tr><td><b>${n}</b></td><td><select class="dlna-type" data-share="${n}">${DLNA_TYPES.map(([v, t]) => html`<option value="${v}"${(media[n] || '') === v ? raw(' selected') : ''}>${t}</option>`)}</select></td></tr>`)}</tbody></table></div>`
			: html`<p class="note">No share yet – create one under <a href="#/shares/shares">Shares</a> .</p>`}
		${d.shares.length ? html`<div class="pt" style="margin:16px 0 8px">SUBFOLDERS</div>
		<p class="mut" style="margin:0 0 8px;font-size:13px">Single folders from a share – no extra share needed.</p>
		${subs.length ? html`<div class="tw"><table class="t"><thead><tr><th>FOLDER</th><th>SHOW AS</th><th></th></tr></thead><tbody>
			${subs.map((m, i) => html`<tr><td data-i18n-skip><b>${m.share}</b>/${m.path}</td><td><select class="dlna-sub-type" data-i="${i}">${DLNA_TYPES.filter(([v]) => v).map(([v, t]) => html`<option value="${v}"${m.type === v ? raw(' selected') : ''}>${t}</option>`)}</select></td>
				<td><button class="btn sm ghost" type="button" data-act="dlna-subdel" data-i="${i}">Remove</button></td></tr>`)}</tbody></table></div>` : ''}
		<div class="acts" style="margin-top:10px"><button class="btn" type="button" data-act="dlna-subadd">Add subfolder</button></div>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

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

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	async 'tr-revoke'(el) {
		const u = el.dataset.user;
		if (!await confirmDlg(`Revoke the remote password of “${u}”?`, 'Programs using this password lose access. The user can create a new one in the Transmission app.', 'Revoke', true)) return;
		try { S.tremote = await rpc('shareos.tremote', 'revoke', { user: u }); toast(`Remote password of “${u}” revoked.`); } catch (e) { toast(e.message, true); }
		renderMain();
	},
	async 'dlna-rescan'(el) {
		el.disabled = true;
		try { S.dlna = await rpc('shareos.dlna', 'rescan'); toast('Media server reads all folders again.'); } catch (e) { toast(e.message, true); }
		loadDlna();
	},
	async 'dlna-subadd'() {
		const places = (S.dlna?.share_dirs || []).map((x) => ({ name: x.name, root: x.volume, base: x.path }));
		const r = await folderDlg('Choose folder', places);
		if (!r) return;
		if (!r.path) { toast('Choose whole shares in the list above.', true); return; }
		if (!S.dlnaSubs.some((m) => m.share === r.place && m.path === r.path)) S.dlnaSubs.push({ share: r.place, path: r.path, type: 'V' });
		renderMain();
	},
	'dlna-subdel'(el) { S.dlnaSubs.splice(+el.dataset.i, 1); renderMain(); }
});
