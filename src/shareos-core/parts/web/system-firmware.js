/* ---------- System: Firmware, update ------------------------------------------ */

const STEP_NAMES = ['Download', 'Verify', 'Ready', 'Write', 'Restart'];
// flashing sub-steps reported by shareos-update -> [place of the bar, label].
// The updater reports the step it is in, not a measured share: the page says
// "step 3 of 8" and the bar only shows how far down the list that is.
const FLASH_STEPS = {
	'check bundle': [5, 'Checking the package again'],
	'stage rootfs': [20, 'Preparing the system for the restart'],
	'erase ramdisk': [45, 'Boot system: erasing flash'],
	'write ramdisk': [50, 'Writing the boot system'],
	'verify ramdisk': [58, 'Checking the boot system'],
	'erase uImage': [64, 'Kernel: erasing flash'],
	'write uImage': [72, 'Writing the kernel'],
	'verify uImage': [88, 'Checking the kernel']
};
function stepIndex(state) {
	return { downloading: 0, verifying: 1, ready: 2, flashing: 3, flashed: 4 }[state] ?? -1;
}

/* ---------- update flow ----------------------------------------------------- */

async function checkUpdates(quiet = false) {
	S.checking = true;
	if (S.route.sub === 'firmware') renderMain();
	try {
		S.check = await rpc('shareos.update', 'check');
		if (!quiet) toast(S.check.update_available ? `Update ${S.check.latest} available.` : 'ShareOS is up to date.');
	} catch (e) {
		if (!quiet && e.code !== 'auth') toast('Check failed: ' + e.message, true);
	}
	S.checking = false;
	renderHeader();
	if (S.route.tab === 'system' && S.route.sub === 'firmware') renderMain();
}

async function refreshUpdateStatus() {
	clearTimeout(S.updTimer);
	try {
		const prev = S.upd?.state;
		S.upd = await rpc('shareos.update', 'status');
		// the updater runs as its own process: right after a click its status can
		// still say 'ready'/'idle' for a moment – keep showing what was started
		const pend = S.updPending;
		if (pend && Date.now() < pend.until && ['ready', 'idle'].includes(S.upd.state)) S.upd = { ...S.upd, state: pend.state, step: '' };
		else S.updPending = null;
		// the box checks GitHub every 6 hours by itself; show what it found
		const had = S.check?.update_available ? S.check.latest : null;
		if (S.upd.check && (!S.check || S.upd.check.time >= (S.check.time || 0))) S.check = { ...S.upd.check, current: S.upd.current };
		if ((S.check?.update_available ? S.check.latest : null) !== had) renderHeader();
		// no result yet (fresh start) or an old one: ask now (GitHub allows 60 anonymous API calls per hour)
		// – in the background on the box (the result arrives with a later status), and
		// not again within an hour after a check that failed (no internet)
		const nowS = Date.now() / 1000;
		if (!S.checking && !S.autoChecked && (!S.upd.check || nowS - S.upd.check.time > 6 * 3600) && !(S.upd.check_failed && nowS - S.upd.check_failed.time < 3600)) {
			S.autoChecked = true;
			rpc('shareos.update', 'check_auto').then(() => { clearTimeout(S.updTimer); S.updTimer = setTimeout(refreshUpdateStatus, 8000); }).catch(() => { });
		}
		// keep the page while a .bin is being checked/written below
		if (S.route.tab === 'system' && S.route.sub === 'firmware' && !document.activeElement?.matches('select') && !$('#bin-info:not(:empty)') && !$('#f-bin input')?.files?.length) renderMain();
		if (prev && prev !== S.upd.state && S.upd.state === 'ready') toast('Update downloaded and verified.');
		if (prev && prev !== S.upd.state && S.upd.state === 'flashed') toast('Update written – please reboot.');
		const busy = ['downloading', 'verifying', 'flashing'].includes(S.upd.state);
		S.updTimer = setTimeout(refreshUpdateStatus, busy || S.updPending ? 1000 : 30000);
	} catch (e) {
		if (e.code !== 'auth') S.updTimer = setTimeout(refreshUpdateStatus, 10000);
	}
}

/* --- the pages --- */

Object.assign(SYS, {
	firmware() {
		const i = S.info || {}, u = S.upd || {}, c = S.check;
		const cur = i.release?.version || u.current || '–';
		const latest = c?.releases?.[0];
		const busy = ['downloading', 'verifying', 'flashing'].includes(u.state);
		const si = stepIndex(u.state);
		const prog = u.state === 'downloading' && u.progress?.total ? pct(u.progress.bytes, u.progress.total) : null;
		const bootOk = i.boot === 'flash';
		return html`
		${(u.pending_reboot || u.state === 'flashed') && !busy ? html`<div class="banner">${svg(I.reboot)}<span style="flex:1;min-width:240px"><b>Reboot needed</b> – the new system is installed on the next start (about 1 minute, do not switch off the box).</span><button class="btn primary" type="button" data-act="reboot">Reboot now</button></div>` : ''}
		${u.last_upgrade ? html`<div class="banner" style="${u.last_upgrade.startsWith('ok') ? 'border-color:var(--dim)' : ''}">${svg(u.last_upgrade.startsWith('ok') ? I.ok : I.warn)}<span style="flex:1">Last update: <b>${u.last_upgrade.startsWith('ok') ? 'installed successfully (' + u.last_upgrade.slice(3) + ')' : u.last_upgrade}</b></span>${closeX('upd-ack')}</div>` : ''}
		${!bootOk && i.boot ? html`<div class="banner">${svg(I.warn)}<span>The box is not running from the flash right now (<b>${i.boot}</b>). Updates on this page only work after a normal start from the flash.</span></div>` : ''}
		<div class="split">
			<section class="main">
				<div class="panel">
					<div class="ph"><span class="pt">FIRMWARE UPDATE</span><span class="tag ml">Source: GitHub releases · ${c?.repo || 'UniqueDroid/ShareOS'}</span></div>
					<div class="ver">
						<div class="tile"><div class="k">Installed</div><div class="v">${cur}</div><div class="s">Kernel, initramfs and system</div></div>
						<span class="arrow" aria-hidden="true">→</span>
						<div class="tile"${c?.update_available ? raw(' style="border-color:color-mix(in srgb,var(--amber) 45%,transparent)"') : ''}>
							<div class="k">Latest · ${c ? (c.channel === 'beta' ? 'Beta' : 'Stable') : '–'}</div>
							<div class="v ${c?.update_available ? 'warn' : ''}">${latest ? latest.version : c ? 'none' : '?'}</div>
							<div class="s">${c ? (c.update_available ? 'Update available' : latest ? 'up to date' : 'no release for this device yet') : 'not checked yet'}</div></div>
					</div>
					${si >= 0 ? html`
						<div class="pt" style="margin:18px 0 8px">PROGRESS · ${u.release?.version || ''}</div>
						<div class="steps">${STEP_NAMES.map((n, k) => html`<div class="step ${k < si || u.state === 'flashed' ? 'done' : k === si ? 'act' : ''}"><div class="n">${k + 1}${k < si || (u.state === 'flashed' && k <= si) ? ' ✓' : k === si ? ' · RUNNING' : ''}</div>${n}</div>`)}</div>
						${prog != null ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:${prog.toFixed(0)}%"></i></div><p class="note">${fmtBytes(u.progress.bytes)} of ${fmtBytes(u.progress.total)}</p>` : ''}
						${u.state === 'verifying' ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Checking the bundle …</b> SHA-256 and contents, takes about half a minute.</p>` : ''}
						${u.state === 'flashing' ? (() => { const [fp, fl] = FLASH_STEPS[u.step] || [2, 'Starting'], fn = Object.keys(FLASH_STEPS).indexOf(u.step) + 1; return html`<div class="bar big busy" style="margin-top:12px"><i style="width:${fp}%"></i></div><p class="note"><b>${fl} …</b> (step ${fn || 1} of ${Object.keys(FLASH_STEPS).length}) – <b>do not switch off</b>, this takes about 1–2 minutes.</p>`; })() : ''}
						${u.state === 'flashed' ? html`<div class="bar big" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Installation finished</b> (100 %) – restart now.</p>` : ''}
						${u.state === 'ready' ? html`<div class="acts" style="margin-top:14px"><button class="btn primary" type="button" data-act="apply" data-tag="${u.release.tag}" data-ver="${u.release.version}" ${bootOk ? '' : 'disabled'}>Install ${svg(I.dl)}${u.release.version}</button><button class="btn ghost" type="button" data-act="cancel">Discard</button></div>
							<p class="note">${u.release.local ? (u.release.sha_checked ? 'Uploaded file – verified: SHA-256 of the .sha256 file, checksums of all parts, made for this device.' : 'Uploaded file – verified: checksums of all parts, made for this device (without .sha256 file).') : 'Verified: SHA-256, checksums of all parts, made for this device.'} Settings and packages are kept.</p>` : ''}`
					: ''}
					${u.state === 'error' ? html`<div class="banner" style="margin:16px 0 0">${svg(I.warn)}<span><b>Error:</b> ${u.error}</span><button class="btn sm ghost" type="button" data-act="cancel">OK</button></div>` : ''}
					<div class="fields" style="margin-top:18px">
						<label class="f"><span>UPDATE CHANNEL</span><select id="channel">
							<option value="stable"${(c?.channel || 'stable') === 'stable' ? raw(' selected') : ''}>Stable (releases)</option>
							<option value="beta"${c?.channel === 'beta' ? raw(' selected') : ''}>Beta (also pre-releases)</option></select></label>
					</div>
					<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="check" ${S.checking || busy ? 'disabled' : ''}>${S.checking ? 'Checking …' : 'Check now'}</button></div>
				</div>
				${c?.releases?.length ? html`<div>
					<h2 class="gh">VERSIONS <span>from GitHub</span></h2>
					<div class="tw"><table class="t" style="min-width:600px">
						<thead><tr><th>VERSION</th><th>DATE</th><th>CHANNEL</th><th>SIZE</th><th></th></tr></thead>
						<tbody>${(S.relAll ? c.releases : c.releases.slice(0, 3)).map((r) => html`<tr>
							<td><b>${r.version}</b></td><td>${fmtDate(r.date)}</td>
							<td><span class="tag">${r.prerelease ? 'BETA' : 'STABLE'}</span></td><td class="mut">${fmtBytes(r.size)}</td>
							<td>${r.version === cur ? html`<span class="tag ok">installed</span>`
								: html`<button class="btn sm${r.tag === latest?.tag ? '' : ' ghost'}" type="button" data-act="download" data-tag="${r.tag}" ${busy || !bootOk ? 'disabled' : ''}>Download</button>`}
								<a class="btn sm ghost" href="${r.url}" target="_blank" rel="noopener">Notes ↗</a></td></tr>`)}
						</tbody></table></div>
					${c.releases.length > 3 ? html`<div class="acts" style="margin-top:8px"><button class="btn sm ghost" type="button" data-act="rel-all">${S.relAll ? 'Show fewer' : `Show all (${c.releases.length})`}</button></div>` : ''}</div>` : ''}
				${latest?.notes ? html`<div class="panel"><div class="ph"><span class="pt">CHANGES IN ${latest.version}</span></div><pre class="notes">${latest.notes}</pre></div>` : ''}
			</section>
			<aside class="aside">
				<div class="panel">
					<div class="ph"><span class="pt">HOW AN UPDATE WORKS</span></div>
					<ol class="plan" style="padding-left:20px">
						<li>Download the bundle from GitHub and check it (SHA-256, device, sizes)</li>
						<li>Write kernel and initramfs to flash and read them back</li>
						<li>Stage the new system</li>
						<li>Reboot: the initramfs installs the system, then ShareOS starts again</li>
					</ol>
					<p class="note">Settings and installed packages are kept. If interrupted, the installation is repeated on the next boot.</p>
				</div>
				<form class="panel" id="f-bin" style="margin-top:16px">
					<div class="ph"><span class="pt">INSTALL FIRMWARE FILE</span><span class="tag ml">.tar · .bin</span></div>
					<p class="note" style="margin:0 0 10px"><b>Update without internet:</b> upload the .sysupgrade.tar of a ShareOS release, preferably with its .sha256 file. It is checked like an update from GitHub.</p>
					<p class="note" style="margin:0 0 10px">A firmware in D-Link format, e.g. for the <b>switch back to Alt-F</b>. Kernel and boot system are written; the ShareOS system and settings stay in flash.</p>
					<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>FILE</span><input type="file" name="file" accept=".tar,.bin" required></label>
						<label class="f"><span>CHECKSUM (.SHA256, OPTIONAL)</span><input type="file" name="sha" accept=".sha256,.txt"></label></div>
					<div id="bin-info"></div>
					<div class="acts" style="margin-top:12px"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${svg(I.ul)}Upload & check</button></div>
				</form>
			</aside>
		</div>`;
	}
});

/* --- after the page is drawn: listeners, loading --- */

afterSystemPage('firmware', () => {
		$('#f-bin')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, file = f.file.files[0], box = $('#bin-info'), btn = $('button[type=submit]', f);
			if (!file) return;
			btn.disabled = true;
			if (/\.tar$/i.test(file.name)) {
				try {
					const sha = f.sha.files[0] ? (await f.sha.files[0].text()).slice(0, 400) : '';
					const t = await rpc('shareos.update', 'local_ticket');
					await fbSend(t.url, file, () => {});
					await rpc('shareos.update', 'local', { sha256: sha });
					f.reset();
					toast('Uploaded – the bundle is being checked.');
					S.updPending = { state: 'verifying', until: Date.now() + 15000 };
					S.upd = { ...S.upd, state: 'verifying', release: { tag: 'local', version: '' } };
					renderMain();
					refreshUpdateStatus();
				} catch (err) { toast('Firmware file: ' + err.message, true); }
				btn.disabled = false;
				return;
			}
			try {
				const t = await rpc('shareos.update', 'bin_ticket');
				await fbSend(t.url, file, () => {});
				const i = await rpc('shareos.update', 'bin_info');
				const kind = { shareos: 'ShareOS', altf: 'Alt-F', other: 'other firmware' }[i.kind] || i.kind;
				box.innerHTML = html`<dl class="kv" style="margin-top:10px"><dt>Type</dt><dd><b>${kind}</b></dd><dt>Kernel</dt><dd>${i.kernel}</dd>
					<dt>Size</dt><dd>${fmtBytes(+i.kernel_size)} + ${fmtBytes(+i.initramfs_size)}</dd></dl>
					${i.kind === 'altf' || i.kind === 'other' ? html`<p class="note" style="color:var(--amber)">Afterwards ${kind} starts. Alt-F's extra packages are missing then – flash the same file once more in Alt-F's firmware page. Back to ShareOS: flash the ShareOS .bin in Alt-F, system and settings are still there.</p>` : ''}
					<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="bin-write">Install</button></div>`.s;
				$('#bin-write').addEventListener('click', async () => {
					if (!await confirmDlg(`Install ${kind}?`, 'Kernel and boot system are replaced and checked. Do not switch the box off while writing.', 'Install', true)) return;
					cover('Writing firmware', 'Kernel and boot system – please wait, do not switch off');
					try {
						await rpc('shareos.update', 'bin_write', { confirm: true });
						uncover();
						if (await confirmDlg('Written', `${kind} is in flash. Restart now?`, 'Reboot')) {
							try { await rpc('shareos.system', 'reboot'); } catch (err) { }
							stopPolling();
							if (i.kind === 'shareos') waitForBox('Rebooting', `${kind} is starting`);
							else cover('Rebooting', `${kind} is starting – its interface will be at ${location.hostname} shortly (port 80).`);
						}
					} catch (err) { uncover(); toast('Install: ' + err.message, true); }
				});
			} catch (err) { box.innerHTML = ''; toast('Firmware file: ' + err.message, true); }
			btn.disabled = false;
		});
});

afterSystemPage('firmware', () => {
		$('#channel')?.addEventListener('change', async (e) => {
			try {
				await rpc('shareos.update', 'set_channel', { channel: e.target.value });
				checkUpdates();
			} catch (err) { toast('Channel: ' + err.message, true); }
		});
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	// the GitHub versions on the update page: the newest 3, or all of them
	'rel-all'() { S.relAll = !S.relAll; renderMain(); },
	check() { checkUpdates(); },
	async download(el) {
		el.disabled = true;
		S.updPending = { state: 'downloading', until: Date.now() + 15000 };
		S.upd = { ...S.upd, state: 'downloading', progress: null };
		renderMain();
		try { await rpc('shareos.update', 'download', { tag: el.dataset.tag }); refreshUpdateStatus(); }
		catch (e) { S.updPending = null; toast('Download: ' + e.message, true); refreshUpdateStatus(); }
	},
	async apply(el) {
		const tag = el.dataset.tag;
		el.disabled = true;
		if (!await confirmDlg('Install update?', `ShareOS ${(el.dataset.ver || tag).replace(/^v/, '')} will be written to flash. A reboot is needed afterwards, during which the new system is installed. Do not switch the box off while writing.`, 'Install')) { el.disabled = false; return; }
		S.updPending = { state: 'flashing', until: Date.now() + 15000 };
		S.upd = { ...S.upd, state: 'flashing', step: '' };
		renderMain();
		try { await rpc('shareos.update', 'apply', { tag, confirm: true }); refreshUpdateStatus(); }
		catch (e) { S.updPending = null; toast('Install: ' + e.message, true); refreshUpdateStatus(); }
	},
	async 'upd-ack'() {
		try { S.upd = await rpc('shareos.update', 'ack'); renderMain(); } catch (e) { toast(e.message, true); }
	},
	async cancel() {
		try { S.upd = await rpc('shareos.update', 'cancel'); renderMain(); } catch (e) { toast(e.message, true); }
	}
});
