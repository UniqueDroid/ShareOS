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

