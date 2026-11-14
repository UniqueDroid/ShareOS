/* ---------- storage (Speicher) ---------------------------------------------- */

const LAYOUT_TXT = { mirror: 'Mirror (RAID 1)', stripe: 'RAID 0', span: 'JBOD', single: 'Single drive' };
// layouts with one volume over both disks
const pairLayout = (l) => l === 'mirror' || l === 'stripe' || l === 'span';
// file systems: label and what the choice means
const FS_DISK = [['ext4', 'ext4 – recommended', 'Everything: permissions per user, storage limit, personal folders, apps.'],
	['btrfs', 'Btrfs', 'Permissions per user, personal folders, apps; no storage limit per user. Needs more memory.'],
	['exfat', 'exFAT', 'Also readable on Windows and macOS. No permissions per user (whoever may write to a share may change everything in it), no storage limit, no personal folders, no apps.'],
	['ntfs', 'NTFS', 'Also readable on Windows. No permissions per user, no storage limit, no personal folders, no apps.'],
	['ext3', 'ext3', 'Older Linux file system (e.g. known from Alt-F): permissions per user, personal folders, apps; no storage limit.'],
	['ext2', 'ext2', 'No journal – long check after a power cut. Only if an old device needs it.'],
	['vfat', 'FAT32', 'For very old devices. Files up to 4 GB, no permissions per user, no storage limit, no personal folders, no apps.']];
const FS_USB = [['exfat', 'exFAT – recommended', 'Windows, macOS, Linux, TVs; files over 4 GB.'],
	['vfat', 'FAT32', 'For older devices (car radio, camera); files up to 4 GB.'],
	['ntfs', 'NTFS', 'For Windows computers.'],
	['ext4', 'ext4', 'For Linux and backups with permissions.']];
const FS_NAME = { ext4: 'ext4', ext3: 'ext3', ext2: 'ext2', btrfs: 'Btrfs', exfat: 'exFAT', ntfs: 'NTFS', ntfs3: 'NTFS', vfat: 'FAT32' };
const LINUX_FS = ['ext4', 'ext3', 'ext2', 'btrfs'];
const linuxFs = (v) => !v.fstype || LINUX_FS.includes(v.fstype);
const fsSelect = (list, val, cls = '') => html`<select class="${cls}">${list.map(([v, t]) => html`<option value="${v}"${val === v ? raw(' selected') : ''}>${t}</option>`)}</select>`;
const fsNote = (list, val) => html`<p class="note fs-note" style="margin:6px 0 0">${(list.find((x) => x[0] === val) || list[0])[2]}</p>`;

// form dialog: name + file system; resolves { name, fs } or null
function fsDlg(title, text, name, list, fs, okLabel, max = 16) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<form method="dialog"><h3>${title}</h3><p>${text}</p>
			<div class="fields" style="grid-template-columns:1fr;margin-bottom:6px">
				<label class="f"><span>NAME</span><input name="v" value="${name}" maxlength="${max}" required></label>
				<label class="f"><span>FILE SYSTEM</span>${fsSelect(list, fs, 'fs-sel')}</label></div>
			${fsNote(list, fs)}
			<div class="acts" style="margin-top:16px"><button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn primary" type="submit" value="yes">${okLabel}</button></div></form>`.s;
		$('#app').append(d);
		let result = null;
		$('.fs-sel', d).addEventListener('change', (e) => { $('.fs-note', d).textContent = list.find((x) => x[0] === e.target.value)[2]; });
		$('button[value=no]', d).addEventListener('click', () => d.close());
		$('form', d).addEventListener('submit', () => { result = { name: $('input', d).value.trim(), fs: $('.fs-sel', d).value }; });
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		d.showModal();
		$('input', d).select();
	});
}
const SPINDOWN = [[0, 'never'], [10, '10 minutes'], [20, '20 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']];

function arrayOf(st, dev) {
	const name = (dev || '').replace('/dev/', '');
	return st?.arrays?.[name] || null;
}

// worst SMART rating of the disks a volume lies on (null: no values read)
function volSmart(st, v) {
	const md = arrayOf(st, v.device);
	const base = (x) => String(x || '').replace('/dev/', '').replace(/[0-9]+$/, '');
	const devs = md ? (md.members || []).map(base) : [base(v.device)];
	let worst = null;
	for (const d of st.disks || []) {
		if (!devs.includes(d.name) || !d.smart || d.smart.standby || d.smart.error) continue;
		const r = smartRating(d.smart);
		if (r === 'bad' || !worst || (r === 'warn' && worst === 'good')) worst = r;
	}
	return worst;
}
const volSmartTag = (sm) => (sm && sm !== 'good' ? html`<span class="tag ${SMART_RATING[sm][0]}" title="SMART values of a disk of this volume">${SMART_RATING[sm][1]}</span>` : '');

function diskUse(st, d) {
	// what is on a disk: ShareOS volume / RAID member / foreign file system / empty
	const parts = d.children || [];
	if (!parts.length && !d.fstype) return { empty: true, txt: 'empty' };
	const txt = parts.map((p) => {
		if (p.fstype === 'linux_raid_member') {
			const md = (p.children || [])[0];
			return `RAID member${md ? ' of ' + md.name : ''}${p.label ? ' (' + p.label.replace(/^.*:/, '') + ')' : ''}`;
		}
		return [p.name, p.fstype || 'no file system', p.label, p.mountpoint ? '→ ' + p.mountpoint : ''].filter(Boolean).join(' · ');
	});
	return { empty: false, txt: txt.join(' | ') || d.fstype };
}

function smartLine(sm) {
	if (!sm) return html`<span class="mut">SMART not read yet</span>`;
	if (sm.standby) return html`<span class="mut">asleep (SMART on next wake-up)</span>`;
	if (sm.error) return html`<span class="mut">${sm.error}</span>`;
	const r = smartRating(sm);
	return html`<a class="tag ${SMART_RATING[r][0]}" href="#/storage/health" title="Health">SMART <span>${SMART_RATING[r][1]}</span></a>
		${sm.temperature != null ? html` · <span>${sm.temperature} °C</span>` : ''}
		${sm.power_on_hours != null ? html` · <span>${Math.round(sm.power_on_hours / 24)} days powered on</span>` : ''}
		${sm.life_left != null ? html` · <span>SSD ${sm.life_left} % left</span>` : ''}
		${sm.test_running ? html` · <span>self-test running</span>` : ''}`;
}

// small "x" that hides a message for good (the box forgets it)
const closeX = (act) => html`<button class="bx" type="button" data-act="${act}" title="Close" aria-label="Close">${svg(I.x)}</button>`;

// USB button: copy the USB drives into a folder on a drive (short press)
const USB_COPY_ERR = { 'no USB drive': 'No USB drive plugged in.', 'not enough space': 'Not enough space on the target – nothing copied.',
	'target drive not mounted': 'The target drive is not mounted.', 'no target set': 'No target set.' };
function usbCopyPanel(st) {
	const u = st.usb_copy || { enabled: false, volume: '', path: '' }, last = u.last;
	return html`<form class="panel" id="f-usbcopy">
		<div class="ph"><span class="pt">USB BUTTON</span>${u.enabled ? html`<span class="tag ml ok">copies</span>` : ''}</div>
		<label class="chk"><input type="checkbox" name="enabled"${u.enabled ? raw(' checked') : ''}>A short press copies the USB drives, holding 3 s ejects them</label>
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>TARGET DRIVE</span><select name="volume">
				<option value="">–</option>
				${(st.volumes || []).map((v) => html`<option value="${v.name}"${u.volume === v.name ? raw(' selected') : ''}>${v.name}</option>`)}
			</select></label>
			<label class="f"><span>FOLDER</span><input name="path" value="${u.path}" maxlength="200"></label>
		</div>
		<p class="note">A new folder with the date every time, e.g. <code>${u.volume || 'data'}/${u.path}/2026-10-25_1430-STICK</code> – nothing on the box is overwritten or deleted. The USB light blinks while copying; the result comes as a message. Without the tick the button only ejects, as before.</p>
		${last ? html`<p class="note">Last: ${last.state === 'running' ? html`<b>running …</b>` : last.state === 'done' ? html`<span class="tag ok">OK</span> ${fmtTime(last.time)} · ${last.files} files · ${fmtBytes(last.bytes || 0)}` : html`<span class="tag err">ERROR</span> ${USB_COPY_ERR[last.error] || last.error}`}</p>` : ''}
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button>
			<button class="btn" type="button" data-act="usb-copy" ${u.volume && (st.usb || []).length && last?.state !== 'running' ? '' : 'disabled'}>Copy now</button></div>
	</form>`;
}

function storageView() {
	const st = S.storage, i = S.info || {};
	if (!st) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading drives …</span></div></div>`;
	const job = st.job;
	const running = job?.state === 'running';
	return html`
	${running ? html`<div class="banner" style="border-color:var(--dim)"><div class="spin" style="margin:0;width:20px;height:20px"></div><span><b>Setup running</b> – ${job.step || ''}. Do not switch the box off.</span></div>` : ''}
	${job?.state === 'error' ? html`<div class="banner">${svg(I.warn)}<span style="flex:1"><b>Setup failed:</b> ${job.error}</span>${closeX('job-clear')}</div>` : ''}
	${S.wiz ? wizardView(st) : ''}
	<section class="sec">
		${secHead('volumes', 'VOLUMES', st.volumes.length ? st.volumes.length + ' set up' : 'none yet')}
		${st.volumes.length ? (isTable('volumes') ? volumeTable(st, running) : html`<div class="grid">${st.volumes.map((v) => volumeCard(st, v, running))}</div>`)
			: html`<div class="panel"><div class="empty">${svg(I.info)}<div><span>No storage set up yet. The wizard sets up the disks in a few steps – as a mirror (both disks hold the same data) or as separate drives.</span>
				<div class="acts" style="margin-top:12px">${S.wiz ? '' : html`<button class="btn primary" type="button" data-act="wiz-start" ${running || !st.disks.length ? 'disabled' : ''}>Set up storage</button>`}</div></div></div></div>`}
	</section>
	<section class="sec">
		${secHead('stdisks', 'DRIVES', `${st.disks.length} detected`)}
		${st.disks.length ? (isTable('stdisks') ? diskTable(st, running) : html`<div class="grid">${st.disks.map((d) => diskCard(st, d, running))}</div>`) : diskCards(i)}
	</section>
	<section class="sec">
		<h2 class="gh">SETTINGS</h2>
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SPINDOWN</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>SPIN DISKS DOWN AFTER</span><select id="spindown">
					${SPINDOWN.map(([m, t]) => html`<option value="${m}"${st.spindown === m ? raw(' selected') : ''}>${t}</option>`)}
					${SPINDOWN.some(([m]) => m === st.spindown) ? '' : html`<option value="${st.spindown}" selected>${st.spindown} minutes</option>`}
				</select></label></div>
				<p class="note">Saves power and wear. Disks spin up again on the next access (a few seconds).</p>
				<dl class="kv" style="margin-top:14px">
					<dt>Swap</dt><dd>${(st.swaps || []).length ? (st.swaps.map((x) => x.device.replace('/dev/', '')).join(', ') + ' · ' + fmtBytes(st.swaps.reduce((a, x) => a + x.used, 0)) + ' of ' + fmtBytes(st.swaps.reduce((a, x) => a + x.size, 0)) + ' used') : 'none active'}</dd>
					<dt>App area</dt><dd>${st.apps ? '/mnt/' + st.apps + '/.shareos' : 'none yet'}</dd>
				</dl>
			</div>
			${usbCopyPanel(st)}
			<div class="panel">
				<div class="ph"><span class="pt">SET UP AGAIN</span></div>
				<p class="mut" style="margin:0 0 12px;font-size:13px">The wizard erases the selected disks and sets them up again. Single disks can also be formatted directly at the disk under “Drives”. Disks with data (e.g. from Alt-F or the D-Link firmware) are added without erasing with “… take over” at the disk.</p>
				<button class="btn" type="button" data-act="wiz-start" ${running || !st.disks.length || S.wiz ? 'disabled' : ''}>Start wizard</button>
			</div>
		</div>
	</section>
	<section class="sec">
		<h2 class="gh">INTERNAL FLASH <span>NAND · UBI</span></h2>
		<div class="tw"><table class="t" style="min-width:560px">
			<thead><tr><th>AREA</th><th>MOUNTED</th><th>USED</th><th style="width:30%">LOAD</th></tr></thead>
			<tbody>${(i.filesystems || []).map((f) => html`<tr>
				<td><b>${fsLabel[f.mount] || f.mount}</b><div class="mut" style="font-size:12px">${f.source}</div></td>
				<td><code>${f.mount}</code></td>
				<td>${fmtBytes(f.used)} / ${fmtBytes(f.size)}</td>
				<td><div class="bar"><i class="${f.mount === '/rom' ? '' : pct(f.used, f.size) > 90 ? 'crit' : pct(f.used, f.size) > 75 ? 'warn' : ''}" style="width:${pct(f.used, f.size).toFixed(0)}%"></i></div></td></tr>`)}
			</tbody></table></div>
	</section>`;
}

// internal disks that could replace the missing disk of a mirror (not part of it, not USB)
function repairCandidates(st, md) {
	return (st.disks || []).filter((d) => !d.usb && !d.rm && d.tran !== 'usb'
		&& !(md.members || []).some((m) => m === d.name || m.startsWith(d.name)));
}

function volActions(v, running) {
	const st = S.storage, md = arrayOf(st, v.device);
	const repair = v.layout === 'mirror' && md?.health?.includes('_') && !md.sync && repairCandidates(st, md).length;
	return html`${repair ? html`<button class="btn sm primary" type="button" data-act="vol-repair" data-name="${v.name}" ${running ? 'disabled' : ''}>Repair mirror</button>` : ''}${v.mounted ? html`<button class="btn sm" type="button" data-act="vol" data-name="${v.name}" data-op="umount" ${running ? 'disabled' : ''}>Unmount</button>`
			: html`<button class="btn sm" type="button" data-act="vol" data-name="${v.name}" data-op="mount" ${running || !v.device ? 'disabled' : ''}>Mount</button>`}
		<button class="btn sm ghost" type="button" data-act="vol" data-name="${v.name}" data-op="forget" ${running ? 'disabled' : ''}>Remove</button>`;
}

function volumeTable(st, running) {
	return html`<div class="tw"><table class="t" style="min-width:760px"><thead><tr><th>NAME</th><th>LAYOUT</th><th>USED</th><th style="width:18%">LOAD</th><th>HEALTH</th><th></th></tr></thead>
		<tbody>${st.volumes.map((v) => {
			const md = arrayOf(st, v.device), degraded = md && md.health && md.health.includes('_'), p = pct(v.used, v.size), sm = volSmart(st, v);
			return html`<tr>
				<td><b>${v.name}</b>${S.storage?.apps === v.name ? html` <span class="tag">APPS</span>` : ''}<div class="mut" style="font-size:12px">${v.mountpoint}</div></td>
				<td>${LAYOUT_TXT[v.layout] || v.layout || ''} · ${FS_NAME[v.fstype] || v.fstype || '?'}${md ? html`<div class="mut" style="font-size:12px">${md.name} · ${md.health || '?'}</div>` : ''}</td>
				<td>${v.mounted ? html`${fmtBytes(v.used)} / ${fmtBytes(v.size)}` : '–'}</td>
				<td>${v.mounted ? html`<div class="bar"><i class="${p > 90 ? 'crit' : p > 80 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}</td>
				<td>${!v.mounted ? html`<span class="tag err">not mounted</span>` : degraded ? html`<span class="tag warn">a disk is missing</span>`
					: md?.sync ? html`<span class="tag warn">Sync ${md.sync.delayed ? 'waiting' : md.sync.percent.toFixed(1) + ' %'}</span>` : sm && sm !== 'good' ? '' : html`<span class="tag ok">OK</span>`} ${v.mounted ? volSmartTag(sm) : ''}</td>
				<td><div class="acts">${volActions(v, running)}</div></td></tr>`;
		})}</tbody></table></div>`;
}

/* --- setup wizard --- */

function wizardView(st) {
	const w = S.wiz;
	const disks = st.disks.filter((d) => !d.usb && !d.rm && d.tran !== 'usb');
	const chosen = st.disks.filter((d) => w.disks.includes(d.name));
	const steps = ['Disks', 'Layout', 'Name', 'Confirm'];
	const smallest = Math.min(...chosen.map((d) => d.size));
	let body;
	if (w.step === 0) {
		body = html`<p class="mut" style="margin:0 0 12px;font-size:13px">Which disks should be set up? <b style="color:var(--amber)">Everything on these disks will be erased.</b></p>
			<div style="display:grid;gap:8px">${(disks.length ? disks : st.disks).map((d) => { const u = diskUse(st, d); return html`
				<label class="chk" style="align-items:flex-start"><input type="checkbox" class="wiz-disk" value="${d.name}"${w.disks.includes(d.name) ? raw(' checked') : ''}>
				<span><b>${d.name}</b> · ${d.model || ''} · ${fmtBytes(d.size)}<br><span class="mut" style="font-size:12px">${u.empty ? 'empty' : 'contains: ' + u.txt}</span></span></label>`; })}</div>`;
	} else if (w.step === 1) {
		const two = chosen.length === 2;
		const opts = two
			? [['mirror', 'Mirror (RAID 1) – recommended', `Both disks hold the same data. If one fails, nothing is lost. Usable: ${fmtBytes(smallest)}.`],
				['stripe', 'RAID 0 – fast', `Both disks become one volume, data spread across them: faster, space ${fmtBytes(2 * smallest)}. If one disk fails, everything is lost.`],
				['span', 'JBOD – full space', `Both disks become one volume one after the other with ${fmtBytes(chosen.reduce((a, d) => a + d.size, 0))} (also with disks of different sizes). If one disk fails, everything is lost.`],
				['single', 'Two separate drives', `Twice the space (${fmtBytes(chosen.reduce((a, d) => a + d.size, 0))}), but no redundancy – each disk is a drive of its own.`]]
			: [['single', 'Single drive', `The disk becomes a drive of ${fmtBytes(chosen[0]?.size)}. For redundancy, add a second disk as a mirror later.`]];
		if (!opts.some((o) => o[0] === w.layout)) w.layout = opts[0][0];
		body = html`<div style="display:grid;gap:10px">${opts.map(([id, t, d]) => html`
			<label class="panel" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;${w.layout === id ? 'border-color:var(--accent);box-shadow:var(--glow)' : ''}">
				<input type="radio" name="wiz-layout" value="${id}"${w.layout === id ? raw(' checked') : ''} style="margin-top:4px;accent-color:var(--accent)">
				<span><b class="name" style="font-size:14px">${t}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
			<div class="fields" style="margin-top:14px"><label class="f"><span>SWAP PER DISK</span><select id="wiz-swap">
				${[[1024, '1 GB – recommended'], [2048, '2 GB'], [512, '512 MB'], [0, 'none']].map(([v, t]) => html`<option value="${v}"${w.swap === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<p class="note">The box has only 256 MB of RAM. Swap on the disks absorbs load peaks (shares, cloud sync, package installs). It is a small partition at the start of each disk; the rest becomes the drive.</p>`;
	} else if (w.step === 2) {
		const fields = pairLayout(w.layout) ? [['__mirror', w.layout === 'mirror' ? 'NAME OF THE MIRROR' : 'NAME OF THE VOLUME']] : chosen.map((d) => [d.name, `NAME FOR ${d.name.toUpperCase()} (${fmtBytes(d.size)})`]);
		body = html`<div style="display:grid;gap:14px">${fields.map(([k, l]) => html`<div class="fields">
				<label class="f"><span>${l}</span><input class="wiz-name" data-k="${k}" value="${w.names[k] || ''}" maxlength="16" pattern="[a-z0-9][a-z0-9_-]{0,15}" required></label>
				<label class="f"><span>FILE SYSTEM</span><select class="wiz-fs" data-k="${k}">${FS_DISK.map(([v, t]) => html`<option value="${v}"${(w.fs[k] || 'ext4') === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
				<div style="grid-column:1/-1">${fsNote(FS_DISK, w.fs[k] || 'ext4')}</div></div>`)}</div>
			<p class="note">Lower-case letters, digits, - and _ (max. 16 characters). The drive appears as <code>/mnt/&lt;name&gt;</code>; you create shares on it later.</p>`;
	} else {
		const pairSize = w.layout === 'mirror' ? smallest : w.layout === 'stripe' ? 2 * smallest : chosen.reduce((a, d) => a + d.size, 0);
		const vols = pairLayout(w.layout) ? [[w.names.__mirror, chosen.map((d) => d.name).join(' + '), fmtBytes(pairSize), w.fs.__mirror || 'ext4']]
			: chosen.map((d) => [w.names[d.name], d.name, fmtBytes(d.size), w.fs[d.name] || 'ext4']);
		body = html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>DRIVE</th><th>DISKS</th><th>SIZE</th><th>LAYOUT</th><th>FILE SYSTEM</th></tr></thead>
			<tbody>${vols.map(([n, ds, sz, f]) => html`<tr><td><b>${n}</b></td><td>${ds}</td><td>${sz}</td><td>${LAYOUT_TXT[w.layout]}</td><td>${FS_NAME[f]}</td></tr>`)}</tbody></table></div>
			<p class="note">${(() => { const k = (pairLayout(w.layout) ? ['__mirror'] : w.disks).find((x) => LINUX_FS.includes(w.fs[x] || 'ext4')); const sw = w.swap ? `${fmtBytes(w.swap * 1048576)} swap per disk` : 'No swap'; return k ? `${sw}, app area on "${w.names[k]}" (unless one exists).` : `${sw}, no app area (packages and app data need ext4 or Btrfs).`; })()}</p>
			<p class="note" style="color:var(--amber)">Clicking "Set up" erases ${chosen.map((d) => d.name).join(' and ')} completely.${w.layout === 'mirror' ? ' The initial sync then runs in the background (several hours on large disks); the drive can be used right away.' : ''}</p>`;
	}
	return html`<section class="sec"><div class="panel" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">SET UP STORAGE · WIZARD</span><button class="btn sm ghost ml" type="button" data-act="wiz-cancel">Cancel</button></div>
		<div class="steps" style="margin-bottom:16px">${steps.map((n, k) => html`<div class="step ${k < w.step ? 'done' : k === w.step ? 'act' : ''}"><div class="n">${k + 1}${k < w.step ? ' ✓' : ''}</div>${n}</div>`)}</div>
		${body}
		<div class="acts" style="margin-top:16px;justify-content:space-between">
			<button class="btn ghost" type="button" data-act="wiz-back" ${w.step === 0 ? 'disabled' : ''}>Back</button>
			${w.step < 3 ? html`<button class="btn primary" type="button" data-act="wiz-next">Next</button>`
				: html`<button class="btn danger" type="button" data-act="wiz-run">Set up</button>`}
		</div></div></section>`;
}

function wizardCollect() {
	const w = S.wiz;
	if (!w) return;
	if (w.step === 0) w.disks = [...document.querySelectorAll('.wiz-disk:checked')].map((x) => x.value);
	if (w.step === 1) {
		w.layout = $('input[name=wiz-layout]:checked')?.value || w.layout;
		if ($('#wiz-swap')) w.swap = +$('#wiz-swap').value;
	}
	if (w.step === 2) {
		document.querySelectorAll('.wiz-name').forEach((x) => { w.names[x.dataset.k] = x.value.trim().toLowerCase(); });
		document.querySelectorAll('.wiz-fs').forEach((x) => { w.fs[x.dataset.k] = x.value; });
	}
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,15}$/;

function wizardCheck() {
	const w = S.wiz, st = S.storage;
	if (w.step === 0) {
		if (!w.disks.length) return 'Please select at least one disk.';
		if (w.disks.length > 2) return 'Two disks at most.';
	}
	if (w.step === 2) {
		const keys = pairLayout(w.layout) ? ['__mirror'] : w.disks;
		const names = keys.map((k) => w.names[k] || '');
		if (names.some((n) => !NAME_RE.test(n))) return 'Invalid name: only a–z, 0–9, - and _, max. 16 characters.';
		if (new Set(names).size !== names.length) return 'The names must be different.';
		const taken = st.volumes.filter((v) => !(v.device || '').match(new RegExp('/dev/(' + w.disks.join('|') + ')|/dev/md'))).map((v) => v.name);
		const clash = names.find((n) => taken.includes(n));
		if (clash) return `The name “${clash}” is already taken.`;
	}
	return null;
}

async function loadStorage() {
	clearTimeout(S.stTimer);
	S.stActive = true;
	if (away()) { S.stTimer = setTimeout(loadStorage, 15000); return; }
	try {
		// a running self-test: read its disk again (the status only has cached values)
		if (S.route.sub === 'health') for (const d of (S.storage?.disks || []).filter((x) => x.smart?.test_running))
			try { await rpc('shareos.storage', 'smart', { disk: d.name }); } catch (e) { }
		S.storage = await rpc('shareos.storage', 'status');
		if (S.wizAfterLoad) { S.wizAfterLoad = false; if (!S.storage.volumes.length && S.storage.disks.length) { ACTIONS['wiz-start'](); } }
		if (S.route.tab === 'storage' && !(S.wiz && S.wiz.step === 2) && !document.activeElement?.matches('select')) renderMain();
		const busy = S.storage.job?.state === 'running' || Object.values(S.storage.arrays || {}).some((a) => a.sync);
		const testing = S.route.sub === 'health' && S.storage.disks.some((d) => d.smart?.test_running);
		if (S.route.tab === 'storage') S.stTimer = setTimeout(loadStorage, busy ? 3000 : testing ? 60000 : 15000);
	} catch (e) {
		if (e.code !== 'auth') { toast('Storage: ' + e.message, true); S.stTimer = setTimeout(loadStorage, 15000); }
	}
}

/* --- after the page is drawn: listeners, loading --- */

Object.assign(VIEWS_AFTER, {
	storage() {
		if (S.route.sub === 'snapshots') { snapAfter(); return; }
		if (!S.stActive) loadStorage();
		$('#smart-sched')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'smart_schedule', { mode: e.target.value }); S.storage.smart_schedule = e.target.value; toast('Schedule saved.'); }
			catch (err) { toast('Self-test: ' + err.message, true); }
		});
		$('#f-usbcopy')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { S.storage.usb_copy = await rpc('shareos.storage', 'usb_copy_config', { enabled: f.enabled.checked, volume: f.volume.value, path: f.path.value.trim() }); toast('USB button saved.'); renderMain(); }
			catch (err) { toast('USB button: ' + err.message, true); }
		});
		$('#spindown')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'spindown', { minutes: +e.target.value }); toast('Spindown saved.'); }
			catch (err) { toast('Standby: ' + err.message, true); }
		});
	}
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	'wiz-start'() {
		const disks = (S.storage?.disks || []).filter((d) => !d.usb && !d.rm && d.tran !== 'usb').map((d) => d.name);
		S.wiz = { step: 0, disks: disks.slice(0, 2), layout: disks.length >= 2 ? 'mirror' : 'single', swap: 1024, names: { __mirror: 'data' }, fs: { __mirror: 'ext4' } };
		renderMain();
		window.scrollTo(0, 0);
	},
	'wiz-cancel'() { S.wiz = null; renderMain(); },
	'wiz-back'() { wizardCollect(); S.wiz.step--; renderMain(); },
	'wiz-next'() {
		wizardCollect();
		const err = wizardCheck();
		if (err) { toast(err, true); return; }
		const w = S.wiz;
		if (w.step === 1 && w.layout === 'single') w.disks.forEach((d, k) => { if (!w.names[d]) w.names[d] = k ? 'data' + (k + 1) : 'data'; });
		w.step++;
		renderMain();
	},
	async 'wiz-run'() {
		const w = S.wiz;
		if (!await confirmDlg('Erase and set up the disks?', `${w.disks.join(' and ')} will be erased completely. This cannot be undone.`, 'Erase & set up', true)) return;
		const args = pairLayout(w.layout)
			? { layout: w.layout, name: w.names.__mirror, disks: w.disks, swap: w.swap, fs: w.fs.__mirror || 'ext4', confirm: true }
			: { layout: 'single', volumes: w.disks.map((d) => ({ name: w.names[d], disk: d, fs: w.fs[d] || 'ext4' })), swap: w.swap, confirm: true };
		try { await rpc('shareos.storage', 'setup', args); S.wiz = null; toast('Setup started.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Setup: ' + e.message, true); }
	},
	async adopt(el) {
		const { part, fs, size } = el.dataset;
		const name = await promptDlg(`Take over ${part}`, `${part} (${FS_NAME[fs] || fs}, ${fmtBytes(+size)}) is added as a drive as it is – nothing is erased. Name of the drive (a–z, 0–9, - and _, at most 16 characters):`, 'data', 'Apply', 'text', 16);
		if (!name) return;
		if (!NAME_RE.test(name.toLowerCase())) { toast('Invalid name.', true); return; }
		el.disabled = true;
		try {
			await rpc('shareos.storage', 'adopt', { name: name.toLowerCase(), part });
			toast(`${part} is now the drive “${name.toLowerCase()}” – the data is kept. Create shares for existing folders under “Shares”.`);
		} catch (e) { toast(`Take over ${part}: ${e.message}`, true); el.disabled = false; }
		loadStorage();
	},
	async format(el) {
		const disk = el.dataset.disk;
		const d = S.storage.disks.find((x) => x.name === disk);
		const r = await fsDlg(`Format ${disk}`, 'Name of the new volume (a–z, 0–9, - and _, at most 16 characters) and file system:', 'data', FS_DISK, 'ext4', 'Next');
		if (!r) return;
		const name = r.name.toLowerCase();
		if (!NAME_RE.test(name)) { toast('Invalid name.', true); return; }
		if (!await confirmDlg(`Erase ${disk}?`, `${disk} (${d?.model || ''}, ${fmtBytes(d?.size)}) is erased completely and set up again as volume “${name}” (${FS_NAME[r.fs]}).`, 'Erase & format', true)) return;
		try { await rpc('shareos.storage', 'setup', { layout: 'single', volumes: [{ name, disk, fs: r.fs }], confirm: true }); toast('Formatting started.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Format: ' + e.message, true); }
	},
	async 'usb-eject'(el) {
		el.disabled = true;
		try {
			await rpc('shareos.storage', 'usb_eject', { disk: el.dataset.disk });
			toast(`${el.dataset.disk} can be unplugged now.`);
		} catch (e) { toast('Remove: ' + e.message, true); el.disabled = false; }
		setTimeout(loadStorage, 800);
	},
	async 'usb-format'(el) {
		const disk = el.dataset.disk, d = S.storage.disks.find((x) => x.name === disk);
		const r = await fsDlg(`Format ${disk}`, `${d?.model || 'USB drive'}, ${fmtBytes(d?.size)} – name (letters, digits, spaces, - and _) and file system:`, 'USB', FS_USB, 'exfat', 'Next');
		if (!r) return;
		if (!/^[A-Za-z0-9 _-]{1,16}$/.test(r.name)) { toast('Invalid name.', true); return; }
		if (!await confirmDlg(`Erase ${disk}?`, `Everything on ${disk} is erased. Afterwards it is a ${FS_NAME[r.fs]} drive “${r.name}”.`, 'Erase & format', true)) return;
		try { await rpc('shareos.storage', 'usb_format', { disk, fs: r.fs, name: r.name, confirm: true }); toast('Formatting started.'); setTimeout(loadStorage, 1000); }
		catch (e) { toast('Format: ' + e.message, true); }
	},
	async 'usb-copy'(el) {
		el.disabled = true;
		try { await rpc('shareos.storage', 'usb_copy'); toast('USB copy started.'); }
		catch (e) { toast('USB copy: ' + (USB_COPY_ERR[e.message] || e.message), true); }
		setTimeout(loadStorage, 1500);
	},
	async 'vol-repair'(el) {
		const name = el.dataset.name, st = S.storage, v = (st.volumes || []).find((x) => x.name === name);
		const md = arrayOf(st, v?.device), cand = md ? repairCandidates(st, md) : [];
		if (!cand.length) return;
		const d = cand[0];
		if (!await confirmDlg(`Repair mirror “${name}”?`, `${d.name} (${d.model || ''} · ${fmtBytes(d.size)}) is erased completely and added to the mirror as the second disk. The data is then copied in the background (several hours for large disks); the volume stays usable.`, 'Erase & repair', true)) return;
		try { await rpc('shareos.storage', 'repair', { name, disk: d.name, confirm: true }); toast('Repair started.'); }
		catch (e) { toast(`${name}: ${e.message}`, true); }
		loadStorage();
	},
	async vol(el) {
		const { name, op } = el.dataset;
		if (op === 'forget' && !await confirmDlg(`Remove "${name}"?`, 'The drive is unmounted and removed from the configuration. The data on the disk stays until it is set up again.', 'Remove')) return;
		try { await rpc('shareos.storage', 'volume', { name, action: op }); toast(`${name}: ${op === 'mount' ? 'mounted' : op === 'umount' ? 'unmounted' : 'removed'}`); }
		catch (e) { toast(`${name}: ${e.message}`, true); }
		loadStorage();
	},
	async 'job-clear'() {
		try { await rpc('shareos.storage', 'job_clear'); if (S.storage) S.storage.job = null; renderMain(); } catch (e) { toast(e.message, true); }
	}
});
