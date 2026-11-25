/* ---------- disk change: everything from one drive to another (shareos.migrate) ---------- */

// S.mig: { vols, from, to, plan, st } – st is the state of the job on the box
const MIG_FS = ['ext4', 'ext3', 'btrfs'];
const migBusy = (st) => st && (st.state === 'copying' || st.state === 'switching');

function migChooser(m) {
	const vols = (m.vols || []).filter((v) => v.mounted);
	const sel = (id, val, list) => html`<select id="${id}"><option value="">–</option>${list.map((v) => html`<option value="${v.name}"${val === v.name ? raw(' selected') : ''}>${v.name} · ${FS_NAME[v.fstype] || v.fstype || ''} · ${fmtBytes(v.used || 0)} of ${fmtBytes(v.size || 0)}</option>`)}</select>`;
	const p = m.plan;
	return html`<div class="panel">
		<div class="ph"><span class="pt">1 · CHOOSE THE DRIVES</span></div>
		<div class="fields">
			<label class="f"><span>OLD DRIVE (FROM)</span>${sel('mig-from', m.from, vols)}</label>
			<label class="f"><span>NEW DRIVE (TO)</span>${sel('mig-to', m.to, vols.filter((v) => MIG_FS.includes(v.fstype)))}</label>
		</div>
		<p class="note">The new drive must be set up and empty, with ext4 or Btrfs. It can be in the second bay or in a USB case – after the move it can go into a bay. Set it up first under <a href="#/storage/volumes">Drives</a>. <span>An old disk in a USB case is added there without erasing it (a disk with data).</span></p>
		${p ? html`<div style="margin-top:14px">
			<dl class="kv">
				<dt>Shares</dt><dd>${p.shares.length ? p.shares.join(', ') : '–'}</dd>
				<dt>Personal folders</dt><dd>${p.homes.length ? p.homes.join(', ') : '–'}</dd>
				<dt>App area</dt><dd>${p.apps ? 'moves along' : '–'}</dd>
				<dt>Snapshot jobs</dt><dd>${p.snapshot_jobs.length ? p.snapshot_jobs.join(', ') : '–'}</dd>
				<dt>Data</dt><dd>${fmtBytes(p.used)} · free on the new drive: ${fmtBytes(p.free)}</dd>
			</dl>
			${p.ok ? '' : html`<div class="banner" style="margin-top:12px">${svg(I.warn)}<span>${p.problem}</span></div>`}
			<p class="note">Everything on the old drive is copied – also folders that are not shared – except the snapshots. Owners, permissions and ACLs stay. The old drive is not changed.</p>
		</div>` : ''}
		<div class="acts" style="margin-top:12px">
			<button class="btn" type="button" data-act="mig-plan" ${m.from && m.to ? '' : 'disabled'}>Check</button>
			<button class="btn primary" type="button" data-act="mig-copy" ${p?.ok ? '' : 'disabled'}>${svg(I.dl)}Start copying</button>
		</div>
	</div>`;
}

function migProgress(st) {
	const sw = st.state === 'switching';
	return html`<div class="panel">
		<div class="ph"><span class="pt">${sw ? '3 · SWITCHING' : '2 · COPYING'}</span><span class="mut">${st.from} → ${st.to}</span></div>
		<div class="bar" style="margin:6px 0 8px"><i style="width:${sw ? 100 : st.percent}%"></i></div>
		<p class="mut" style="margin:0">${sw ? html`<span>Services are stopped for the last copy – shares are back in a moment.</span>`
			: html`${st.percent} % · ${fmtBytes(st.done)} of ${fmtBytes(st.total)}`}</p>
		${sw ? '' : html`<p class="note">The box can be used while it copies. What changes until the switch is copied then.</p>
		<div class="acts" style="margin-top:10px"><button class="btn ghost" type="button" data-act="mig-cancel">Cancel</button></div>`}
	</div>`;
}

function migrateView() {
	const m = S.mig || (S.mig = {}), st = m.st;
	if (!st && m.err) return html`<div class="banner">${svg(I.warn)}<span>${m.err}</span></div>
		<div class="acts" style="margin-top:10px"><button class="btn sm ghost" type="button" data-act="mig-reload">Read again</button></div>`;
	if (!st) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	let body;
	if (migBusy(st)) body = migProgress(st);
	else if (st.state === 'copied') body = html`<div class="panel">
		<div class="ph"><span class="pt">3 · SWITCH</span><span class="mut">${st.from} → ${st.to}</span></div>
		<p style="margin:0 0 8px">Everything is copied.</p>
		<p class="note">Switching stops shares, apps, downloads, the media server and scheduled jobs for a short time, copies what changed since and then points shares, personal folders, the app area, the USB copy, snapshot jobs and the folders of Transmission and Syncthing to the new drive.</p>
		${st.error ? html`<div class="banner" style="margin-top:10px">${svg(I.warn)}<span>${st.error}</span></div>` : ''}
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="mig-switch">Switch now</button>
		<button class="btn ghost" type="button" data-act="mig-clear">Discard</button></div></div>`;
	else if (st.state === 'done') body = html`<div class="panel">
		<div class="ph"><span class="pt">DONE</span><span class="mut">${st.from} → ${st.to}</span></div>
		<p style="margin:0 0 8px">Shares, personal folders and the app area are now on the new drive.</p>
		<p class="note">The old drive is unchanged. When everything works, forget it under <a href="#/storage/volumes">Drives</a> and take the disk out – or keep it as a backup.</p>
		${(st.notes || []).includes('autobrr') ? html`<div class="banner" style="margin-top:10px">${svg(I.warn)}<span>autobrr: filters with the action Watch dir still name the hand-over folder on the old drive – change it in autobrr to the folder on the new drive.</span></div>` : ''}
		<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="mig-clear">Close</button></div></div>`;
	else if (st.state === 'cancelled' || st.state === 'error') body = html`<div class="panel">
		<div class="ph"><span class="pt">2 · COPYING</span><span class="mut">${st.from} → ${st.to}</span></div>
		<div class="banner">${svg(I.warn)}<span>${st.state === 'error' ? st.error : 'The copy was stopped. Going on copies only what is missing.'}</span></div>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="mig-resume">Go on copying</button>
		<button class="btn ghost" type="button" data-act="mig-clear">Discard</button></div></div>`;
	else body = migChooser(m);
	return html`<section class="sec">
		<h2 class="gh">MOVE TO A NEW DRIVE</h2>
		<p class="mut" style="margin:0 0 14px;font-size:13px">Copies everything from an old drive to a new one – shares, personal folders and the app area – and then switches over, so that nothing has to be set up again.</p>
		${body}
	</section>`;
}

async function loadMigrate() {
	clearTimeout(S.migTimer);
	const m = S.mig || (S.mig = {});
	try {
		m.st = await rpc('shareos.migrate', 'state');
		m.err = null;
		if (!m.vols) m.vols = (await rpc('shareos.storage', 'volumes')).volumes || [];
		if (!document.activeElement?.matches('select')) renderMain();
		if (S.route.tab === 'storage' && S.route.sub === 'move' && (migBusy(m.st) || m.switching)) S.migTimer = setTimeout(loadMigrate, 3000);
		if (m.st.state !== 'copied') m.switching = false;
	} catch (e) {
		if (e.code === 'auth') return;
		// without a state the page would wait forever: show why instead
		if (!m.st) { m.err = e.message; renderMain(); } else toast('Move: ' + e.message, true);
	}
}

function migrateAfter() {
	// on entering the page (and at most every 10 s while it is drawn again)
	const m = S.mig || (S.mig = {});
	if (!m.t || Date.now() - m.t > 10000) { m.t = Date.now(); loadMigrate(); }
	for (const id of ['mig-from', 'mig-to'])
		$('#' + id)?.addEventListener('change', (e) => { S.mig[id === 'mig-from' ? 'from' : 'to'] = e.target.value; S.mig.plan = null; renderMain(); });
}

Object.assign(ACTIONS, {
	'mig-reload'() { S.mig.err = null; S.mig.t = 0; renderMain(); },
	async 'mig-plan'() {
		try { S.mig.plan = await rpc('shareos.migrate', 'plan', { from: S.mig.from, to: S.mig.to }); renderMain(); }
		catch (e) { toast(e.message, true); }
	},
	async 'mig-copy'() {
		try { await rpc('shareos.migrate', 'copy', { from: S.mig.from, to: S.mig.to }); S.mig.plan = null; loadMigrate(); }
		catch (e) { toast(e.message, true); }
	},
	async 'mig-resume'() {
		try { await rpc('shareos.migrate', 'copy', { from: S.mig.st.from, to: S.mig.st.to }); loadMigrate(); }
		catch (e) { toast(e.message, true); }
	},
	async 'mig-cancel'() {
		if (!await confirmDlg('Stop copying?', 'What is copied stays on the new drive; going on later copies only the rest.', 'Stop')) return;
		try { await rpc('shareos.migrate', 'cancel'); loadMigrate(); } catch (e) { toast(e.message, true); }
	},
	async 'mig-switch'() {
		if (!await confirmDlg('Switch to the new drive now?', 'Shares, apps, downloads and the media server stop for the last copy and start again on the new drive. Open files on the network are closed.', 'Switch now')) return;
		try { await rpc('shareos.migrate', 'switch', { confirm: true }); S.mig.switching = true; S.mig.st = { ...S.mig.st, state: 'switching' }; renderMain(); loadMigrate(); }
		catch (e) { toast(e.message, true); }
	},
	async 'mig-clear'() {
		try { await rpc('shareos.migrate', 'clear'); S.mig = { t: Date.now() }; loadMigrate(); } catch (e) { toast(e.message, true); }
	}
});
