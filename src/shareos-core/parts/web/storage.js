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

