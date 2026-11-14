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

