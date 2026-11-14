/* --- disk health (SMART): rating, values, self-tests, all attributes --- */

const SMART_RATING = { good: ['ok', 'GOOD'], warn: ['warn', 'CAUTION'], bad: ['err', 'CRITICAL'] };
// reasons of the rating (rpcd smart_assess) as text
function smartReason(sm, r) {
	const m = /^attr_(now|past):(.+)$/.exec(r);
	if (m) return m[1] === 'now' ? `Value ${m[2]} below the manufacturer's threshold` : `Value ${m[2]} was below the threshold earlier`;
	return {
		failed: 'The disk itself reports: failure is imminent (SMART overall assessment FAILED).',
		test_failed: 'The last self-test failed.',
		reallocated: `${sm.reallocated} sectors have already been replaced (reallocated).`,
		pending: `${sm.pending} sectors are uncertain (pending) – they are checked on the next write.`,
		uncorrectable: `${sm.uncorrectable} sectors could not be read.`,
		crc: `${sm.crc_errors} transfer errors (CRC) – usually the connector or cable, not the disk itself.`,
		errors: `${sm.error_count} entries in the disk's error log.`,
		worn: `The SSD is almost worn out: ${sm.life_left} % life left.`,
		wearing: `The SSD is wearing: ${sm.life_left} % life left.`,
		hot: `Very warm: ${sm.temperature} °C.`,
		warm: `Warm: ${sm.temperature} °C.`
	}[r] || r;
}
// values without a rating (cached by an older firmware) get one here
function smartRating(sm) {
	if (sm.rating) return sm.rating;
	return sm.passed === false ? 'bad' : (sm.reallocated || sm.pending || sm.uncorrectable) ? 'warn' : 'good';
}
const fmtHours = (h) => (h >= 24 * 365 ? `${(h / 24 / 365).toLocaleString(LOC, { maximumFractionDigits: 1 })} years` : `${Math.round(h / 24)} days`);
const fmtTestMin = (m) => (m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`);

function healthCard(d) {
	const sm = d.smart, open = S.hOpen?.has(d.name), bay = !d.usb && d.tran !== 'usb';
	const head = html`<div class="ph"><span class="pt">${bay ? 'BAY' : 'USB'} · ${d.name}</span>
		${d.standby != null ? html`<span class="tag ml">${d.standby ? 'ASLEEP' : 'ACTIVE'}</span>` : ''}
		${sm && !sm.standby && !sm.error ? html`<span class="tag ${d.standby != null ? '' : 'ml'} ${SMART_RATING[smartRating(sm)][0]}">${SMART_RATING[smartRating(sm)][1]}</span>` : ''}</div>
		<div class="mut" style="font-size:13px;margin:-4px 0 12px"><span>${d.model || sm?.model || 'unknown model'}</span> · ${fmtBytes(d.size)}${sm?.ssd ? ' · SSD' : sm?.rpm ? html` · <span>${sm.rpm} rpm</span>` : ''}${(sm?.serial || d.serial) ? ' · ' + (sm?.serial || d.serial) : ''}${sm?.firmware ? ' · ' + sm.firmware : ''}</div>`;
	const read = html`<button class="btn sm" type="button" data-act="smart" data-disk="${d.name}">${sm ? 'Read again' : 'Read now'}</button>`;
	if (!sm || sm.standby || sm.error) return html`<div class="panel">${head}
		<p class="mut" style="margin:0 0 12px;font-size:13px">${!sm ? 'SMART not read yet. Reading wakes the disk up.' : sm.standby ? 'The disk is asleep – the values come when it next wakes up.' : bay ? 'This disk gives no SMART values.' : 'This USB adapter does not pass on SMART values.'}</p>
		<div class="acts">${read}</div></div>`;
	const rating = smartRating(sm), reasons = sm.reasons || [];
	const kv = [
		['Temperature', sm.temperature == null ? null : sm.temperature_max != null ? `${sm.temperature} °C (highest: ${sm.temperature_max} °C)` : `${sm.temperature} °C`],
		['Running time', sm.power_on_hours != null ? `${fmtHours(sm.power_on_hours)} (${sm.power_on_hours.toLocaleString(LOC)} h)` : null],
		['Power cycles', sm.power_cycles],
		['Motor start-ups', sm.ssd ? null : sm.start_stops],
		['Reallocated sectors', sm.reallocated],
		['Pending sectors', sm.pending],
		['Unreadable sectors', sm.uncorrectable],
		['Transfer errors (CRC)', sm.crc_errors],
		['Error log', sm.error_count != null ? `${sm.error_count} entries` : null],
		['Written', sm.written != null ? fmtBytes(sm.written) : null]
	].filter(([, v]) => v != null);
	const t = sm.test_running, last = sm.last_test, mins = sm.test_minutes || {};
	return html`<div class="panel">${head}
		${reasons.length ? html`<ul class="hreasons">${reasons.map((r) => html`<li>${smartReason(sm, r)}</li>`)}</ul>`
			: html`<p style="margin:0 0 12px;font-size:13px">Nothing unusual.</p>`}
		${sm.life_left != null ? html`<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between;font-size:13px"><span>SSD life</span><b>${sm.life_left} % left</b></div>
			<div class="bar" style="margin-top:4px"><i class="${sm.life_left <= 10 ? 'crit' : sm.life_left <= 20 ? 'warn' : ''}" style="width:${sm.life_left}%"></i></div></div>` : ''}
		<dl class="kv">${kv.map(([k, v]) => html`<dt>${k}</dt><dd>${typeof v === 'number' ? v.toLocaleString(LOC) : v}</dd>`)}</dl>
		<div class="pt" style="margin:16px 0 8px">SELF-TEST</div>
		${t ? html`<div style="font-size:13px">Running – ${t.remaining} % left<div class="bar busy" style="margin-top:4px"><i style="width:${100 - t.remaining}%"></i></div></div>`
			: last ? html`<div style="font-size:13px"><span class="tag ${last.passed === false ? 'err' : 'ok'}">${last.passed === false ? 'FAILED' : 'OK'}</span> <span>${({ 'Short offline': 'Short test', 'Extended offline': 'Long test', 'Short captive': 'Short test', 'Extended captive': 'Long test' })[last.type] || last.type}</span> · ${last.passed === false ? last.status : html`<span>without errors</span>`}${last.hours != null ? html` <span class="mut">(at ${last.hours.toLocaleString(LOC)} h)</span>` : ''}</div>`
			: html`<div class="mut" style="font-size:13px">No self-test has run yet.</div>`}
		<div class="acts" style="margin-top:12px">
			${read}
			${bay && !t ? html`<button class="btn sm" type="button" data-act="smart-test" data-disk="${d.name}" data-t="short"><span>Short test</span>${mins.short ? html` <span class="mut">${fmtTestMin(mins.short)}</span>` : ''}</button>
				<button class="btn sm" type="button" data-act="smart-test" data-disk="${d.name}" data-t="long"><span>Long test</span>${mins.long ? html` <span class="mut">${fmtTestMin(mins.long)}</span>` : ''}</button>` : ''}
			${bay && t ? html`<button class="btn sm danger" type="button" data-act="smart-test" data-disk="${d.name}" data-t="abort">Abort test</button>` : ''}
			${(sm.attributes || []).length ? html`<button class="btn sm ghost ml" type="button" data-act="smart-attrs" data-disk="${d.name}" aria-expanded="${!!open}">${open ? 'Hide values' : 'All values'}</button>` : ''}
		</div>
		${open ? html`<div class="tw" style="margin-top:12px"><table class="t" style="min-width:560px"><thead><tr><th class="r">ID</th><th>VALUE</th><th class="r">CURRENT</th><th class="r">WORST</th><th class="r">THRESHOLD</th><th>RAW VALUE</th></tr></thead>
			<tbody>${sm.attributes.map((a) => html`<tr${a.when_failed ? raw(' class="sel"') : ''}><td class="r mut">${a.id}</td><td>${a.name}${a.when_failed ? html` <span class="tag ${a.when_failed === 'now' ? 'err' : 'warn'}">${a.when_failed === 'now' ? 'NOW' : 'EARLIER'}</span>` : ''}</td>
				<td class="r">${a.value}</td><td class="r mut">${a.worst}</td><td class="r mut">${a.thresh}</td><td class="mut"><code>${a.raw}</code></td></tr>`)}</tbody></table></div>` : ''}
		${rating === 'bad' ? html`<p class="note" style="color:var(--red)">Back up the data and replace the disk soon.</p>` : ''}
		${sm.time ? html`<p class="note">Read ${fmtTime(sm.time)}.</p>` : ''}
	</div>`;
}

function healthView() {
	const st = S.storage;
	if (!st) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading drives …</span></div></div>`;
	const sched = st.smart_schedule || '';
	return html`<section class="sec">
		<h2 class="gh">HEALTH <span>SMART of the disks and SSDs</span></h2>
		${st.disks.length ? html`<div class="g2">${st.disks.map((d) => healthCard(d))}</div>` : html`<div class="panel"><div class="empty">${svg(I.info)}<span>No disk found.</span></div></div>`}
	</section>
	<section class="sec">
		<h2 class="gh">SETTINGS</h2>
		<div class="g2"><div class="panel">
			<div class="ph"><span class="pt">SCHEDULED SELF-TEST</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>ALL DISKS IN THE BAYS</span><select id="smart-sched">
				${[['', 'Off'], ['short_weekly', 'Short test every Sunday (3:30 am)'], ['long_monthly', 'Long test on the 1st of every month (3:30 am)']].map(([v, t]) => html`<option value="${v}"${sched === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<p class="note">The short test checks the electronics and part of the surface, the long test reads the whole disk (many hours for large disks; the disk stays awake meanwhile). The result shows here and as a message when something is wrong.</p>
		</div>
		<div class="panel">
			<div class="ph"><span class="pt">HOW IT IS RATED</span></div>
			<dl class="hrate"><dt><span class="tag err">CRITICAL</span></dt><dd>The disk itself reports a failure, a value is below the manufacturer's threshold, a self-test failed, more than 100 reallocated or more than 10 pending sectors, an SSD with 10 % life or less, 60 °C and above.</dd>
			<dt><span class="tag warn">CAUTION</span></dt><dd>A few reallocated, pending or unreadable sectors, transfer errors, entries in the error log, an SSD with 20 % life or less, from 55 °C.</dd></dl>
		</div></div>
	</section>`;
}

function diskTable(st, running) {
	return html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>DRIVE</th><th>MODEL</th><th>SIZE</th><th>SMART</th><th>CONTENTS</th><th></th></tr></thead>
		<tbody>${st.disks.map((d) => html`<tr>
			<td><b>${d.usb || d.tran === 'usb' ? 'USB' : 'Bay'} · ${d.name}</b></td>
			<td>${d.model || 'unknown model'}${d.serial ? html`<div class="mut" style="font-size:12px">${d.serial}</div>` : ''}</td>
			<td>${fmtBytes(d.size)}</td><td>${smartLine(d.smart)}</td><td class="mut" style="font-size:12px">${diskUse(st, d).txt}</td>
			<td><div class="acts">${diskActions(d, running)}</div></td></tr>`)}</tbody></table></div>`;
}

function volumeCard(st, v, running) {
	const md = arrayOf(st, v.device);
	const degraded = md && md.health && md.health.includes('_');
	const p = pct(v.used, v.size), sm = volSmart(st, v);
	return html`<div class="card${v.mounted ? '' : ' off'}">
		<div class="icon">${svg(I.disk)}<span class="dot ${!v.mounted || sm === 'bad' ? 'down' : degraded || sm === 'warn' ? 'warn' : 'up'}"></span></div>
		<div class="info">
			<div class="name">${v.name}${S.storage?.apps === v.name ? html` <span class="tag" title="Packages and app data live in .shareos">APPS</span>` : ''} ${volSmartTag(sm)}</div>
			<div class="desc">${LAYOUT_TXT[v.layout] || v.layout || ''} · ${FS_NAME[v.fstype] || v.fstype || '?'}${v.mounted ? html` · ${fmtBytes(v.avail)} free of ${fmtBytes(v.size)}` : ' · not mounted'}</div>
			${v.mounted ? html`<div class="bar" style="margin-top:10px"><i class="${p > 90 ? 'crit' : p > 80 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}
			${md ? html`<div class="desc" style="margin-top:8px">${md.name}: ${degraded ? html`<span style="color:var(--amber)">one disk missing (${md.health})</span>` : html`both disks active (${md.health || '?'})`}</div>` : ''}
			${degraded && !md.sync && v.layout === 'mirror' && !repairCandidates(st, md).length ? html`<div class="desc" style="margin-top:6px">Put a new disk into the free bay, then “Repair mirror”.</div>` : ''}
			${md?.sync ? html`<div class="desc" style="margin-top:6px">${md.sync.action === 'resync' ? 'Initial sync' : md.sync.action === 'recovery' ? 'Recovery' : 'Check'}: ${md.sync.delayed ? 'waiting' : md.sync.percent.toFixed(1) + ' %' + (md.sync.finish ? ' · ' + fmtMin(md.sync.finish) + ' left' : '')}</div>
				<div class="bar" style="margin-top:6px"><i class="warn" style="width:${md.sync.percent}%"></i></div>` : ''}
			<div class="ip">${v.mountpoint}${v.device ? ' · ' + v.device : ' · file system not found'}</div>
			<div class="acts" style="margin-top:12px">${volActions(v, running)}</div>
		</div></div>`;
}

function fmtMin(s) {
	const m = parseFloat(s);
	if (!(m >= 0)) return s;
	return m >= 90 ? `${(m / 60).toLocaleString(LOC, { maximumFractionDigits: 1 })} h` : `${Math.round(m)} min`;
}

// partitions (or RAID arrays) of a disk with a file system ShareOS does not
// know yet – a data disk of Alt-F or the D-Link firmware: they can be taken
// over as they are
const ADOPT_FS = ['ext4', 'ext3', 'ext2', 'btrfs', 'exfat', 'ntfs', 'vfat'];
function adoptable(st, d) {
	const known = new Set((st.volumes || []).map((v) => v.uuid));
	const out = [];
	for (const p of d.children || []) {
		const t = p.fstype === 'linux_raid_member' ? (p.children || [])[0] : p;
		if (t && ADOPT_FS.includes(t.fstype) && t.uuid && !known.has(t.uuid) && !t.mountpoint && !out.some((x) => x.name === t.name)) out.push(t);
	}
	return out;
}

function diskActions(d, running) {
	if (d.usb) return html`<button class="btn sm" type="button" data-act="usb-eject" data-disk="${d.name}" ${running ? 'disabled' : ''}>Safely remove</button>
		<button class="btn sm danger" type="button" data-act="usb-format" data-disk="${d.name}" ${running ? 'disabled' : ''}>Format</button>`;
	return html`${adoptable(S.storage, d).map((p) => html`<button class="btn sm primary" type="button" data-act="adopt" data-part="${p.name}" data-fs="${p.fstype}" data-size="${p.size}" ${running || S.wiz ? 'disabled' : ''}>Take over ${p.name}</button>`)}
		<button class="btn sm" type="button" data-act="smart" data-disk="${d.name}">Read SMART</button>
		<button class="btn sm danger" type="button" data-act="format" data-disk="${d.name}" ${running || S.wiz ? 'disabled' : ''}>Erase & format</button>`;
}

// mounted partitions of a USB drive
function usbLines(st, d) {
	const m = (st.usb || []).filter((x) => x.dev.replace('/dev/', '').replace(/p?\d+$/, '') === d.name);
	return m.length ? html`<div class="desc" style="margin-top:8px">${m.map((x) => html`<div>${FS_NAME[x.fs] || x.fs} · <code>${x.path}</code></div>`)}</div>`
		: html`<div class="desc" style="margin-top:8px;color:var(--muted)">not mounted</div>`;
}

function diskCard(st, d, running) {
	const use = diskUse(st, d);
	const sm = d.smart;
	return html`<div class="card">
		<div class="icon">${svg(d.rm || d.tran === 'usb' ? I.usb : I.disk)}<span class="dot${diskDot({ smart: sm && !sm.standby && !sm.error ? smartRating(sm) : null, standby: d.standby })}"></span></div>
		<div class="info">
			<div class="name">${d.usb || d.tran === 'usb' ? 'USB' : 'Bay'} · ${d.name}${d.standby ? html` <span class="tag">ASLEEP</span>` : ''}</div>
			<div class="desc">${d.model || 'unknown model'} · ${fmtBytes(d.size)}${d.serial ? ' · ' + d.serial : ''}</div>
			${d.usb ? usbLines(st, d) : html`<div class="desc" style="margin-top:8px">${smartLine(sm)}</div>`}
			<div class="ip">${use.txt}</div>
			<div class="acts" style="margin-top:12px">${diskActions(d, running)}</div>
		</div></div>`;
}

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	async smart(el) {
		el.disabled = true;
		try { await rpc('shareos.storage', 'smart', { disk: el.dataset.disk }); } catch (e) { toast('SMART: ' + e.message, true); }
		loadStorage();
	},
	async 'smart-test'(el) {
		const disk = el.dataset.disk, t = el.dataset.t;
		if (t === 'long' && !await confirmDlg('Start the long test?', `The long test reads the whole disk ${disk} – many hours for large disks. The box stays usable, the disk is a bit slower.`, 'Start')) return;
		el.disabled = true;
		try { await rpc('shareos.storage', 'smart_test', { disk, type: t }); toast(t === 'abort' ? 'Self-test aborted.' : 'Self-test started.'); }
		catch (e) { toast('Self-test: ' + e.message, true); }
		loadStorage();
	},
	'smart-attrs'(el) {
		S.hOpen = S.hOpen || new Set();
		const d = el.dataset.disk;
		if (S.hOpen.has(d)) S.hOpen.delete(d); else S.hOpen.add(d);
		renderMain();
	}
});
