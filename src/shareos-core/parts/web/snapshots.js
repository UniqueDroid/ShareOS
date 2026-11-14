/* ---------- snapshots (Storage -> Snapshots) ------------------------------------ */

const SNAP_EVERY = { hour: 'Hourly', '6h': 'Every 6 hours', day: 'Daily', week: 'Weekly (Sunday)' };
const SNAP_KEEP = [['keep_last', 'THE LAST'], ['keep_daily', 'DAYS (ONE EACH)'], ['keep_weekly', 'WEEKS (ONE EACH)'], ['keep_monthly', 'MONTHS (ONE EACH)']];

async function loadSnapshots() {
	clearTimeout(S.snapTimer);
	S.snap = S.snap || {};
	try { S.snap.data = await rpc('shareos.snapshots', 'status'); }
	catch (e) { toast('Snapshots: ' + e.message, true); }
	if (S.route.tab === 'storage' && S.route.sub === 'snapshots') {
		if (!document.activeElement?.matches('input,select,textarea')) renderMain();
		if (S.snap.data?.jobs?.some((j) => j.running)) S.snapTimer = setTimeout(loadSnapshots, 3000);
	}
}

function snapSourceTxt(d, id) {
	const x = (d.sources || []).find((s) => s.id === id);
	if (!x) return id || '–';
	return x.kind === 'share' ? `Share ${x.name}` : x.kind === 'homes' ? `Personal folders (${x.name})` : `Whole drive ${x.name}`;
}
const snapSrcVol = (d, id) => { const x = (d.sources || []).find((s) => s.id === id); return x ? (x.volume || x.name) : null; };
const snapEveryTxt = (j) => (SNAP_EVERY[j.every] || j.every) + (j.every === 'day' || j.every === 'week' ? ' ' + j.time : '');
function snapKeepTxt(j) {
	const p = [];
	if (j.keep_last) p.push(`the last ${j.keep_last}`);
	if (j.keep_daily) p.push(`${j.keep_daily} days`);
	if (j.keep_weekly) p.push(`${j.keep_weekly} weeks`);
	if (j.keep_monthly) p.push(`${j.keep_monthly} months`);
	// one span each: the translation sees the parts
	return p.map((x, i) => html`${i ? ' · ' : ''}<span>${x}</span>`);
}
function snapState(j) {
	const l = j.last;
	if (j.running) return html`<span class="tag">running</span>`;
	if (!l) return html`<span class="mut">never</span>`;
	if (l.state === 'ok') return html`<span class="tag ok">OK</span> <span class="mut">${fmtTime(l.ended)}</span>`;
	if (l.state === 'stopped') return html`<span class="tag warn">stopped</span> <span class="mut">${fmtTime(l.ended)}</span>`;
	return html`<span class="tag err">Error</span> <span class="mut">${fmtTime(l.ended)}</span>`;
}
function snapSummary(j) {
	const l = j.last;
	if (!l || j.running) return '';
	if (l.state === 'error') return html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--red)">${l.error || ''}</div>`;
	if (l.state !== 'ok') return '';
	return html`<div class="desc mut" style="margin-top:4px;font-size:12px"><span>${l.files} files</span> · <span>${l.changed} changed</span> (${fmtBytes(l.bytes)})${l.removed ? html` · <span>${l.removed} old ones removed</span>` : ''}</div>
		${l.warning ? html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--amber)">${l.warning}</div>` : ''}`;
}
function snapActions(j) {
	return html`${j.running ? html`<button class="btn sm danger" type="button" data-act="sn-stop" data-name="${j.name}">Stop</button>`
		: html`<button class="btn sm primary" type="button" data-act="sn-run" data-name="${j.name}">Back up now</button>`}
		<button class="btn sm" type="button" data-act="sn-list" data-name="${j.name}">Snapshots (${j.snapshots.length})</button>
		<button class="btn sm" type="button" data-act="sn-edit" data-name="${j.name}">Edit</button>
		<button class="btn sm" type="button" data-act="sn-log" data-name="${j.name}">Log</button>
		<button class="btn sm ghost" type="button" data-act="sn-del" data-name="${j.name}">Remove</button>`;
}

function snapshotsView() {
	const sn = S.snap || {}, d = sn.data;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading snapshots …</span></div></div>`;
	const ed = sn.edit, open = sn.open && d.jobs.find((j) => j.name === sn.open);
	const targets = d.volumes.filter((v) => v.links);
	return html`
	<section class="sec">
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SNAPSHOTS</span><span class="tag ml">${d.jobs.length ? d.jobs.length + ' jobs' : 'none yet'}</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>A snapshot keeps the state of a folder – hourly, daily or weekly.</span> <span>Each state looks like a full copy, but unchanged files take no extra space.</span> <span>To get back a file deleted or overwritten yesterday or last week, copy it back from the snapshot in the file browser.</span></p>
				${!d.rsync ? html`<p class="note" style="color:var(--amber)">rsync is missing in this firmware.</p>` : ''}
				${!targets.length ? html`<p class="note" style="color:var(--amber)">No suitable target: snapshots need a drive with ext4 or Btrfs (FAT32/exFAT have no hard links). <a href="#/storage/volumes">Set up storage</a></p>` : ''}
				${ed || !targets.length || !d.sources.length ? '' : html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="sn-new">New snapshot job</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Best save to another drive (second disk or USB disk): then snapshots also protect against a failing disk.</span> <span>A mirror (RAID 1) does not replace snapshots – it mirrors every deletion at once.</span> <span>The snapshots are in the folder</span> <code>Snapshots</code> <span>of the target drive and are visible to administrators only.</span> <span>For an off-site copy, a cloud job can upload the snapshot folder.</span></p>
			</div>
		</div>
	</section>
	${ed ? snapEditor(d, ed) : ''}
	<section class="sec">
		${secHead('snapjobs', 'JOBS', d.jobs.length ? d.jobs.length + ' set up' : 'none yet')}
		${!d.jobs.length ? html`<div class="panel"><div class="empty">${svg(I.disk)}<span>No snapshot job yet. A job saves a share, the personal folders or a whole drive on a schedule.</span></div></div>`
			: isTable('snapjobs') ? html`<div class="tw"><table class="t" style="min-width:900px"><thead><tr><th>JOB</th><th>SOURCE → TARGET</th><th>SCHEDULE · KEEP</th><th>LOAD</th><th></th></tr></thead>
				<tbody>${d.jobs.map((j) => html`<tr><td><b>${j.name}</b><div class="mut" style="font-size:12px">${j.snapshots.length} Snapshots</div></td>
					<td style="font-size:12px">${snapSourceTxt(d, j.source)} → ${j.target}</td>
					<td style="font-size:12px">${snapEveryTxt(j)}${j.enabled ? '' : ' · off'}<div class="mut">${snapKeepTxt(j)}</div></td>
					<td>${snapState(j)}${snapSummary(j)}</td><td><div class="acts">${snapActions(j)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.jobs.map((j) => html`<div class="card${j.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.disk)}<span class="dot ${j.last?.state === 'error' ? 'down' : j.running || j.last?.warning ? 'warn' : j.last?.state === 'ok' && j.enabled ? 'up' : ''}"></span></div>
				<div class="info"><div class="name">${j.name}</div>
					<div class="desc" style="font-size:12px">${snapSourceTxt(d, j.source)} → ${j.target}</div>
					<div class="desc" style="margin-top:6px">${snapEveryTxt(j)}${j.enabled ? '' : html` · <span>off</span>`}</div>
					<div class="desc mut" style="font-size:12px">${snapKeepTxt(j)}</div>
					<div class="desc" style="margin-top:6px">${snapState(j)}</div>${snapSummary(j)}
					<div class="desc mut" style="margin-top:4px;font-size:12px"><span>${j.snapshots.length} Snapshots</span>${j.snapshots[0] ? html` · <span>newest</span> ${fmtTime(j.snapshots[0].time)}` : ''}</div>
					<div class="acts" style="margin-top:12px">${snapActions(j)}</div></div></div>`)}</div>`}
	</section>
	${open ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">SNAPSHOTS · ${open.name}</span><button class="btn sm ghost ml" type="button" data-act="sn-listclose">Close</button></div>
		${!open.mounted ? html`<p class="note" style="color:var(--amber)">The target drive ${open.target} is not mounted.</p>` : ''}
		${open.snapshots.length ? html`<div class="tw"><table class="t"><thead><tr><th>STATE</th><th>FOLDER</th><th></th></tr></thead><tbody>
			${open.snapshots.map((x) => html`<tr><td><b>${fmtTime(x.time)}</b></td><td class="mut" style="font-size:12px">${open.target}/Snapshots/${open.name}/${x.name}</td>
				<td><div class="acts"><button class="btn sm" type="button" data-act="sn-browse" data-name="${open.name}" data-snap="${x.name}">Open in the file browser</button>
				<button class="btn sm ghost" type="button" data-act="sn-rm" data-name="${open.name}" data-snap="${x.name}">Delete</button></div></td></tr>`)}</tbody></table></div>`
			: html`<p class="mut" style="margin:0;font-size:13px">No snapshot yet – “Back up now” takes the first one.</p>`}
		<p class="note">To restore, copy the file or folder from the snapshot back to its old place in the file browser. Do not change files inside a snapshot: unchanged files share their space with the other snapshots.</p>
	</div></section>` : ''}
	${sn.log ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">LOG · ${sn.log.name}</span><button class="btn sm ghost ml" type="button" data-act="sn-logclose">Close</button></div>
		<pre class="logbox" style="max-height:360px">${sn.log.text || '(empty)'}</pre></div></section>` : ''}`;
}

function snapEditor(d, ed) {
	const x = ed.data, srcVol = snapSrcVol(d, x.source);
	const label = (s) => s.kind === 'share' ? `Share ${s.name}` : s.kind === 'homes' ? `Personal folders (${s.name})` : `Whole drive ${s.name}`;
	return html`<section class="sec"><form class="panel" id="f-snap" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${ed.mode === 'new' ? 'NEW SNAPSHOT JOB' : 'JOB ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="sn-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required placeholder="photos"${ed.mode === 'new' ? '' : raw(' readonly')}></label>
			<label class="f"><span>WHAT TO SAVE</span><select name="source" id="snap-src">${d.sources.map((s) => html`<option value="${s.id}"${x.source === s.id ? raw(' selected') : ''}>${label(s)}</option>`)}</select></label>
			<label class="f"><span>TARGET DRIVE</span><select name="target" id="snap-tgt">${d.volumes.map((v) => html`<option value="${v.name}"${x.target === v.name ? raw(' selected') : ''}${v.links ? '' : raw(' disabled')}>${v.name} (${v.fstype})${v.links ? '' : ' – no hard links'}</option>`)}</select></label>
			<label class="f"><span>HOW OFTEN</span><select name="every" id="snap-every">${Object.entries(SNAP_EVERY).map(([k, t]) => html`<option value="${k}"${x.every === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>${x.every === 'hour' ? 'MINUTE (HH:MM, ONLY THE MINUTE COUNTS)' : x.every === '6h' ? 'FROM' : 'TIME'}</span><input name="time" type="time" value="${x.time}" required></label>
		</div>
		${srcVol && srcVol === x.target ? html`<p class="note" style="color:var(--amber)">Source and target are on the same drive: this protects against accidental deletion, not against a failing disk.</p>` : ''}
		<div class="pt" style="margin:16px 0 8px">KEEP</div>
		<div class="fields">${SNAP_KEEP.map(([k, t]) => html`<label class="f"><span>${t}</span><input name="${k}" type="number" min="0" max="999" value="${x[k]}"></label>`)}</div>
		<p class="note">The last N snapshots always stay (also those taken by hand); plus the newest of each day, week and month. Example daily: 7 days · 4 weeks · 6 months ≈ half a year back with 17 states.</p>
		<label class="f" style="margin-top:12px"><span>EXCLUSIONS (ONE PER LINE, E.G. *.tmp OR /Downloads/)</span>
			<textarea name="exclude" rows="3" spellcheck="false" data-i18n-skip style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px">${(x.exclude || []).join('\n')}</textarea></label>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>Schedule active</label>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function dlnaAfter() {
	if (!S.dlna) { loadDlna(); return; }
	document.querySelectorAll('.dlna-sub-type').forEach((x) => x.addEventListener('change', () => { S.dlnaSubs[+x.dataset.i].type = x.value; }));
	$('#f-dlna')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, media = [];
		document.querySelectorAll('.dlna-type').forEach((x) => { if (x.value) media.push({ share: x.dataset.share, type: x.value }); });
		(S.dlnaSubs || []).forEach((m) => media.push({ share: m.share, path: m.path, type: m.type }));
		if (f.enabled.checked && !media.length) { toast('Choose at least one share.', true); return; }
		const b = $('button[type=submit]', f); b.disabled = true;
		try { S.dlna = await rpc('shareos.dlna', 'set', { enabled: f.enabled.checked, name: f.name.value.trim(), media }); S.dlnaSubs = null; toast('Media server saved.'); }
		catch (err) { toast('Media server: ' + err.message, true); }
		loadDlna();
	});
}

