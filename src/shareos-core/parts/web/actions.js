/* ---------- actions (delegated clicks) -------------------------------------- */

const ACTIONS = {
	async 'df-pass'() { try { S.dfPass = S.dfPass ? null : await rpc('shareos.dnsfilter', 'password'); renderMain(); } catch (e) { toast(e.message, true); } },
	async 'df-refresh'() { try { await rpc('shareos.dnsfilter', 'refresh'); toast('Lists updated.'); loadDnsfilter(); } catch (e) { toast(e.message, true); } },
	async 'df-rwdel'(el) {
		if (!await confirmDlg('Remove entry?', el.dataset.domain + ' → ' + el.dataset.answer, 'Remove', true)) return;
		try { await rpc('shareos.dnsfilter', 'rewrite_remove', { domain: el.dataset.domain, answer: el.dataset.answer }); toast('Entry removed.'); loadDnsfilter(); } catch (e) { toast(e.message, true); }
	},
	async 'df-del'(el) {
		if (!await confirmDlg('Remove list?', el.dataset.url, 'Remove', true)) return;
		try { await rpc('shareos.dnsfilter', 'filter_remove', { url: el.dataset.url }); toast('List removed.'); loadDnsfilter(); } catch (e) { toast(e.message, true); }
	},
	async 'rec-apply'() {
		const on = (k) => !!$(`input[data-rec="${k}"]`)?.checked;
		const pick = (p) => [...document.querySelectorAll(`input[data-rec^="${p}:"]`)].filter((x) => x.checked).map((x) => x.dataset.rec.slice(p.length + 1));
		const args = { users: on('users'), shares: on('shares'), services: pick('svc'), apps: pick('app'), certificate: on('certificate'), ca: on('ca') };
		if (!await confirmDlg('Apply the selection?', 'The box applies the chosen settings and restarts.', 'Apply and restart')) return;
		recoveryEnd(args);
	},
	async 'rec-discard'() {
		if (!await confirmDlg('Take over nothing else?', 'The box stays as it is now: only password, network, name, time zone and drives come from the backup. The backup can be restored again later.', 'End recovery', true)) return;
		recoveryEnd(null);
	},
	async 'rec-apps-install'() {
		try { await rpc('shareos.recovery', 'apps_install'); S.recApps.running = true; toast('The apps are being installed in the background.'); renderMain(); }
		catch (err) { toast('Apps: ' + err.message, true); }
	},
	async 'rec-apps-dismiss'() {
		try { await rpc('shareos.recovery', 'apps_dismiss'); S.recApps = { pending: [], running: false }; renderMain(); }
		catch (err) { toast('Apps: ' + err.message, true); }
	},
	// the GitHub versions on the update page: the newest 3, or all of them
	'rel-all'() { S.relAll = !S.relAll; renderMain(); },
	'chips-more'() { S.chipsAll = !S.chipsAll; fitChips(); },
	'page-reload': () => location.reload(),
	'desk-view': () => setView('desktop'),
	theme() {
		S.theme = effTheme() === 'light' ? 'dark' : 'light';
		if (isUser()) S.me.ui = { ...S.me.ui, theme: S.theme };
		applyTheme(); renderHeader();
		if (isUser()) { renderUserHeader(); if (S.utab === 'settings') renderUserMain(); }
		else if (S.route.sub === 'appearance') renderMain();
		// plain users change it only for themselves (the look for everyone is an admin setting)
		saveLook({ theme: S.theme });
	},
	logout,
	accent(el) {
		S.accent = el.dataset.c; applyTheme();
		if (isUser()) { S.me.ui = { ...S.me.ui, accent: S.accent }; renderUserHeader(); renderUserMain(); } else { renderHeader(); renderMain(); }
		saveLook({ accent: S.accent });
	},
	async 'look-reset'() {
		try {
			S.me.ui = await rpc('shareos.me', 'ui_set', { theme: '', accent: '' });
			applyOwnLook(); store.set('theme', S.theme); store.set('accent', S.accent);
			renderUserHeader(); renderUserMain(); toast('Look reset to the one for everyone.');
		} catch (e) { toast('Appearance: ' + e.message, true); }
	},
	async 'pl-run'() { try { await rpc('shareos.paperless', 'run'); toast('Transfer started.'); setTimeout(loadPaperless, 5000); } catch (e) { toast(e.message, true); } },
	'pl-new'() { S.plEdit = { mode: 'new', data: { name: '', owner: '', share: '', tags: [], enabled: true } }; renderMain(); },
	async 'pl-edit'(el) {
		const ib = S.pl.inboxes.find((x) => x.name === el.dataset.name);
		S.plEdit = { mode: 'edit', data: structuredClone(ib), tags: null };
		renderMain();
		try { S.plEdit.tags = (await rpc('shareos.paperless', 'tags', { inbox: ib.name })).tags; renderMain(); } catch (e) { }
	},
	'pl-cancel'() { S.plEdit = null; renderMain(); },
	async 'pl-test'() {
		const f = $('#f-inbox'), ed = S.plEdit;
		try {
			const r = await rpc('shareos.paperless', 'test', { url: S.pl.url, token: f.token.value.trim(), inbox: ed.mode === 'edit' ? ed.data.name : '' });
			toast(`Connection OK – ${r.documents} documents in Paperless.`);
		} catch (e) { toast('Paperless: ' + e.message, true); }
	},
	async 'pl-log'(el) { try { S.plLog = { name: el.dataset.name, entries: (await rpc('shareos.paperless', 'log', { inbox: el.dataset.name })).entries }; renderMain(); } catch (e) { toast(e.message, true); } },
	'pl-log-close'() { S.plLog = null; renderMain(); },
	async 'pl-del'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove inbox “${n}”?`, 'Nothing will be sent any more. The folder and the files in it are kept.', 'Remove')) return;
		try { await rpc('shareos.paperless', 'inbox_del', { name: n }); toast(`Inbox “${n}” removed.`); loadPaperless(); } catch (e) { toast(e.message, true); }
	},

	async 'cl-install'() {
		try { await rpc('shareos.cloud', 'install'); S.cloud.data.status.installing = true; renderMain(); setTimeout(() => loadCloud('admin'), 3000); }
		catch (e) { toast('rclone: ' + e.message, true); }
	},
	'cl-rnew'(el) { S.cloud.remoteEdit = { type: 'webdav' }; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-auth'(el) {
		const scope = el.dataset.scope, re = S.cloud.remoteEdit, f = $('#f-remote');
		re.name = f.name.value;
		const w = window.open('about:blank', '_blank');
		el.disabled = true;
		try {
			const r = scope === 'admin' ? await rpc('shareos.cloud', 'auth_start', { type: re.type }) : await rpc('shareos.me', 'cloud_auth_start', { type: re.type });
			if (w) w.location.href = r.url; else window.open(r.url, '_blank');
			re.authUrl = r.url; re.authed = false;
		} catch (e) { w?.close(); toast('Sign in: ' + e.message, true); }
		scope === 'admin' ? renderMain() : renderUserMain();
	},
	async 'cl-authfin'(el) {
		const scope = el.dataset.scope, re = S.cloud.remoteEdit, f = $('#f-remote');
		re.name = f.name.value;
		el.disabled = true;
		try {
			const url = f.auth_url.value.trim();
			if (scope === 'admin') await rpc('shareos.cloud', 'auth_finish', { url }); else await rpc('shareos.me', 'cloud_auth_finish', { url });
			re.authed = true; toast('Signed in – now “Add”.');
		} catch (e) { toast('Sign in: ' + e.message, true); }
		scope === 'admin' ? renderMain() : renderUserMain();
	},
	'cl-rcancel'(el) { S.cloud.remoteEdit = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-rtest'(el) {
		el.disabled = true;
		try { const r = await CLOUD_API[el.dataset.scope].testRemote(el.dataset.name); toast(`${el.dataset.name}: connection OK (${r.folders} folders).`); }
		catch (e) { toast(`${el.dataset.name}: ${e.message}`, true); }
		el.disabled = false;
	},
	async 'cl-rdel'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove account “${n}”?`, 'The credentials are deleted. Jobs using this account stop working. Nothing is deleted in the cloud.', 'Remove')) return;
		try { await CLOUD_API[el.dataset.scope].delRemote(n); toast(`Account “${n}” removed.`); loadCloud(el.dataset.scope); } catch (e) { toast(e.message, true); }
	},
	'cl-jnew'(el) {
		const d = S.cloud.data;
		S.cloud.jobEdit = { mode: 'new', data: { name: '', local: d.locals[0]?.[0] || '', remote: d.remotes[0]?.name || '', remote_path: '', mode: 'upload', schedule: '30 2 * * *', bwlimit: '', enabled: true } };
		el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); window.scrollTo(0, 0);
	},
	'cl-jedit'(el) {
		S.cloud.jobEdit = { mode: 'edit', data: structuredClone(S.cloud.data.jobs.find((j) => j.name === el.dataset.name)) };
		el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); window.scrollTo(0, 0);
	},
	'cl-jcancel'(el) { S.cloud.jobEdit = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-jrun'(el) {
		el.disabled = true;
		try { await CLOUD_API[el.dataset.scope].runJob(el.dataset.name); toast(`Job “${el.dataset.name}” started.`); setTimeout(() => loadCloud(el.dataset.scope), 1500); }
		catch (e) { toast(e.message, true); el.disabled = false; }
	},
	async 'cl-jstop'(el) { try { await CLOUD_API[el.dataset.scope].stopJob(el.dataset.name); toast('Stopped.'); setTimeout(() => loadCloud(el.dataset.scope), 1500); } catch (e) { toast(e.message, true); } },
	async 'cl-jlog'(el) {
		try { S.cloud.log = { name: el.dataset.name, lines: (await CLOUD_API[el.dataset.scope].log(el.dataset.name)).lines }; renderMain(); } catch (e) { toast(e.message, true); }
	},
	'cl-logclose'(el) { S.cloud.log = null; el.dataset.scope === 'admin' ? renderMain() : renderUserMain(); },
	async 'cl-jdel'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove job “${n}”?`, 'The job will not run any more. Files on the NAS and in the cloud stay as they are.', 'Remove')) return;
		try { await CLOUD_API[el.dataset.scope].delJob(n); toast(`Job “${n}” removed.`); loadCloud(el.dataset.scope); } catch (e) { toast(e.message, true); }
	},
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
	'sn-new'() {
		const d = S.snap.data, t = d.volumes.find((v) => v.links), src = d.sources.find((x) => x.kind === 'share') || d.sources[0];
		S.snap.edit = { mode: 'new', data: { name: '', source: src?.id || '', target: (d.volumes.find((v) => v.links && v.name !== (src?.volume || src?.name)) || t)?.name || '',
			every: 'day', time: '03:15', keep_last: 3, keep_daily: 7, keep_weekly: 4, keep_monthly: 6, exclude: [], enabled: true } };
		renderMain(); window.scrollTo(0, 0);
	},
	'sn-edit'(el) { S.snap.edit = { mode: 'edit', data: structuredClone(S.snap.data.jobs.find((j) => j.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'sn-cancel'() { S.snap.edit = null; renderMain(); },
	async 'sn-run'(el) {
		el.disabled = true;
		try { await rpc('shareos.snapshots', 'run', { name: el.dataset.name }); toast(`Snapshot “${el.dataset.name}” is running.`); } catch (e) { toast(e.message, true); }
		loadSnapshots();
	},
	async 'sn-stop'(el) {
		el.disabled = true;
		try { await rpc('shareos.snapshots', 'stop', { name: el.dataset.name }); } catch (e) { toast(e.message, true); }
		setTimeout(loadSnapshots, 1500);
	},
	'sn-list'(el) { S.snap.open = S.snap.open === el.dataset.name ? null : el.dataset.name; renderMain(); },
	'sn-listclose'() { S.snap.open = null; renderMain(); },
	async 'sn-log'(el) {
		try { S.snap.log = { name: el.dataset.name, text: (await rpc('shareos.snapshots', 'log', { name: el.dataset.name })).log }; renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sn-logclose'() { S.snap.log = null; renderMain(); },
	async 'sn-rm'(el) {
		const n = el.dataset.name, x = el.dataset.snap, j = S.snap.data.jobs.find((y) => y.name === n), sn = j?.snapshots.find((y) => y.name === x);
		if (!await confirmDlg('Delete snapshot?', `Delete the state of ${fmtTime(sn?.time)}? The other snapshots stay complete.`, 'Delete', true)) return;
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'remove', { name: n, snapshot: x })).jobs; toast('Snapshot deleted.'); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sn-browse'(el) {
		const j = S.snap.data.jobs.find((y) => y.name === el.dataset.name);
		const f = fbInit();
		f.root = j.target; f.path = `Snapshots/${j.name}/${el.dataset.snap}`; f.data = null; f.sel = new Set();
		location.hash = '#/shares/files';
	},
	async 'sn-del'(el) {
		const n = el.dataset.name, j = S.snap.data.jobs.find((y) => y.name === n);
		if (!await confirmDlg(`Remove job “${n}”?`, 'No new snapshots will be taken.', 'Remove')) return;
		const data = j.snapshots.length > 0 && await confirmDlg('Delete the snapshots too?', `Also delete the ${j.snapshots.length} snapshots in ${j.target}/Snapshots/${n}? Otherwise they stay there.`, 'Delete snapshots', true);
		try { S.snap.data.jobs = (await rpc('shareos.snapshots', 'job_del', { name: n, data })).jobs; toast(`Job “${n}” removed.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'sh-new'() {
		S.shEdit = { mode: 'new', data: { name: '', volume: S.vols[0]?.name || '', path: '', comment: '', smb: true, guest: false, nfs: false, nfs_rw: false, nfs_hosts: [], rw: [], ro: [] } };
		renderMain(); window.scrollTo(0, 0);
	},
	'sh-edit'(el) { S.shEdit = { mode: 'edit', data: structuredClone(S.shares.shares.find((x) => x.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'sh-cancel'() { S.shEdit = null; renderMain(); },
	async 'cl-browse'(el) {
		const f = $('#f-job'), p = S.cloud?.data?.places?.[f.local.value];
		if (!p) return;
		const r = await folderDlg('Choose folder', [p], { path: f.sub.value.trim() });
		if (r) f.sub.value = r.path;
	},
	async 'dlna-subadd'() {
		const places = (S.dlna?.share_dirs || []).map((x) => ({ name: x.name, root: x.volume, base: x.path }));
		const r = await folderDlg('Choose folder', places);
		if (!r) return;
		if (!r.path) { toast('Choose whole shares in the list above.', true); return; }
		if (!S.dlnaSubs.some((m) => m.share === r.place && m.path === r.path)) S.dlnaSubs.push({ share: r.place, path: r.path, type: 'V' });
		renderMain();
	},
	'dlna-subdel'(el) { S.dlnaSubs.splice(+el.dataset.i, 1); renderMain(); },
	async 'sh-browse'() {
		const f = $('#f-share'), v = f.volume.value;
		const r = await folderDlg('Choose folder', [{ name: v, root: v, base: '' }], { path: f.path.value.trim() || f.name.value.trim() });
		if (r) f.path.value = r.path;
	},
	async 'vault-unlock'(el) {
		const r0 = await vaultDlg(el.dataset.share, +el.dataset.ttl || 15);
		if (!r0) return;
		try {
			const r = await rpc('shareos.me', 'vault_unlock', { share: el.dataset.share, minutes: r0.minutes, password: r0.password });
			toast(`Vault “${el.dataset.share}” is open until ${vaultTime(r.until)}.`);
			if (isUser()) { S.me = { ...S.me, ...r }; renderUserMain(); } else loadShareData();
		} catch (e) { toast('Vault: ' + e.message, true); }
	},
	async 'vault-lock'(el) {
		try { S.me = { ...S.me, ...await rpc('shareos.me', 'vault_lock', { share: el.dataset.share }) }; toast(`Vault “${el.dataset.share}” locked.`); renderUserMain(); }
		catch (e) { toast('Vault: ' + e.message, true); }
	},
	async 'sh-vlock'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Lock vault “${n}” now?`, 'The vault disappears from the network for everyone who unlocked it. Open connections lose access.', 'Lock')) return;
		try { S.shares = await rpc('shareos.shares', 'vault_lock', { name: n }); toast(`Vault “${n}” locked.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	async 'sh-del'(el) {
		const n = el.dataset.name;
		if (!await confirmDlg(`Remove share “${n}”?`, 'The share disappears from the network. The folder and all files in it stay on the drive.', 'Remove')) return;
		try { S.shares = await rpc('shareos.shares', 'del', { name: n }); toast(`Share “${n}” removed.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	'u-new'() {
		S.uEdit = { mode: 'new', data: { name: '', fullname: '', role: 'share', home: S.vols.filter(linuxFs)[0]?.name || '', quota: 0, web: true, groups: [] } };
		renderMain(); window.scrollTo(0, 0);
	},
	'u-edit'(el) { S.uEdit = { mode: 'edit', data: structuredClone(S.acc.users.find((x) => x.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'u-cancel'() { S.uEdit = null; renderMain(); },
	async 'u-pass'(el) {
		const n = el.dataset.name;
		const p = await promptDlg(`Password for ${n}`, 'New password (at least 8 characters). Used for shares and – depending on the role – for the web interface.', '', 'Set', 'password');
		if (p == null) return;
		try { await rpc('shareos.accounts', 'passwd', { name: n, password: p }); toast(`Password of ${n} changed.`); } catch (e) { toast(e.message, true); }
	},
	async 'u-del'(el) {
		const n = el.dataset.name, u = S.acc.users.find((x) => x.name === n);
		if (!await confirmDlg(`Delete user “${n}”?`, `The account is removed; rights on shares are dropped.${u?.home ? ' The personal folder is kept.' : ''}`, 'Delete', true)) return;
		try { S.acc = await rpc('shareos.accounts', 'del', { name: n }); toast(`User “${n}” deleted.`); loadShareData(); } catch (e) { toast(e.message, true); }
	},
	async 'u-altf'() {
		if (!await confirmDlg('Import users from Alt-F?', 'Users and groups from the kept Alt-F settings are created (role “Shares only”). Passwords are taken over where Alt-F stored them.', 'Apply')) return;
		try {
			const r = await rpc('shareos.accounts', 'import_altf');
			S.acc = r;
			toast(r.imported.length ? `Imported: ${r.imported.join(', ')}` : 'No new users found.');
			if (r.skipped.length) toast(`Skipped: ${r.skipped.join(', ')}`, true);
			renderMain();
		} catch (e) { toast('Alt-F: ' + e.message, true); }
	},
	async 'g-new'() {
		const g = ((await promptDlg('New group', 'Group name (a–z, 0–9 and _, starting with a letter):', '', 'Create')) || '').toLowerCase();
		if (!g) return;
		try { S.acc = await rpc('shareos.accounts', 'group_add', { name: g }); toast(`Group “${g}” created.`); renderMain(); } catch (e) { toast(e.message, true); }
	},
	async 'g-del'(el) {
		const g = el.dataset.name;
		if (!await confirmDlg(`Delete group “${g}”?`, 'The members stay, but lose the permissions given through this group.', 'Delete', true)) return;
		try { S.acc = await rpc('shareos.accounts', 'group_del', { name: g }); toast(`Group “${g}” deleted.`); loadShareData(); } catch (e) { toast(e.message, true); }
	},
	view(el) {
		const id = el.dataset.id;
		S.views[id] = isTable(id) ? 'tiles' : 'table';
		store.set('views', JSON.stringify(S.views));
		renderMain();
	},
	async 'net-confirm'() {
		try { await rpc('shareos.net', 'confirm'); toast('New network settings confirmed.'); } catch (e) { toast(e.message, true); }
		S.net = null; loadNet();
	},
	check() { checkUpdates(); },
	'fr-next'() { const e = frCollect(); if (e) { toast(e, true); return; } frGo(1); },
	'fr-back'() { frCollect(); frGo(-1); },
	async 'fr-skip'() {
		if (!await confirmDlg('Skip first-time setup?', S.fr?.st?.default_password !== false ? 'Everything can be set later under System. The password stays "shareos" until you change it.' : 'Everything can be set later under System.', 'Skip')) return;
		try { await rpc('shareos.setup', 'apply', {}); } catch (e) { }
		frEnd('overview');
	},
	async 'fr-finish'(el) {
		const f = S.fr;
		el.disabled = true;
		try {
			const tzChanged = f.timezone !== f.st.timezone;
			await rpc('shareos.setup', 'apply', { altf: f.altf.found && f.use_altf, password: f.password,
				hostname: f.hostname !== f.st.hostname ? f.hostname : '', timezone: tzChanged ? f.timezone : '', channel: f.channel });
			toast('First-time setup finished.');
			frEnd(el.dataset.next);
		} catch (e) { toast(e.message, true); el.disabled = false; }
	},
	async 'fr-again'() {
		try { await rpc('shareos.setup', 'reset'); try { sessionStorage.setItem('shareos.frstep', '0'); } catch (e) { } checkFirstRun(true); }
		catch (e) { toast(e.message, true); }
	},

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

	log() { loadLog(); },

	async svc(el) {
		const { name, op } = el.dataset;
		el.disabled = true;
		try {
			const r = await rpc('shareos.service', 'action', { name, action: op });
			if (r.delayed) { waitForBox('Service is restarting', 'waiting for the box', false); return; }
			// the box says what the service does now: success only when that fits
			const done = r.ok !== false && (op === 'stop' ? r.running !== true : r.running !== false);
			const why = String(r.output || '').trim().split('\n').pop();
			if (done) toast(`${name}: ${op === 'start' ? 'started' : op === 'stop' ? 'stopped' : 'restarted'}`);
			else toast(name + ': ' + (op === 'start' ? 'did not start' : op === 'stop' ? 'did not stop' : 'did not restart') + (why ? ' – ' + why : ''), true);
		} catch (e) { toast(`${name}: ${e.message}`, true); }
		loadServices();
	},

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

	async 'time-sync'(el) {
		el.disabled = true;
		try { setTime(await rpc('shareos.time', 'sync')); toast('Time synced.'); renderMain(); }
		catch (e) { toast('Sync: ' + e.message, true); el.disabled = false; }
	},
	'time-browser'() {
		const f = $('#f-clock');
		if (f && S.time) f.dt.value = localInput({ now: Math.floor(Date.now() / 1000), timezone: S.time.timezone });
	},

	async 'upd-ack'() {
		try { S.upd = await rpc('shareos.update', 'ack'); renderMain(); } catch (e) { toast(e.message, true); }
	},

	async 'job-clear'() {
		try { await rpc('shareos.storage', 'job_clear'); if (S.storage) S.storage.job = null; renderMain(); } catch (e) { toast(e.message, true); }
	},

	async 'net-dismiss'() {
		try { await rpc('shareos.net', 'dismiss'); if (S.net) S.net.result = null; renderMain(); } catch (e) { toast(e.message, true); }
	},

	async cancel() {
		try { S.upd = await rpc('shareos.update', 'cancel'); renderMain(); } catch (e) { toast(e.message, true); }
	},


	async 'prn-test'(el) {
		try { await rpc('shareos.printer', 'test', { lp: el.dataset.id }); toast('Test page sent.'); }
		catch (e) { toast('Test page: ' + e.message, true); }
	},

	async 'ddns-now'() {
		try { await rpc('shareos.web', 'ddns_update'); toast('Reporting …'); setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 5000); }
		catch (e) { toast('DynDNS: ' + e.message, true); }
	},

	async 'ca-init'() {
		try { await rpc('shareos.web', 'ca_init'); toast('Certificate authority created.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-root'() {
		try { const r = await rpc('shareos.web', 'ca_pem', { kind: 'root' }); pemDownload(r.pem, 'shareos-ca.crt'); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-web'() {
		if (!await confirmDlg('Use a certificate of the own CA?', 'The box gets a certificate of its own CA for the device name, the .local name and the IP address; it replaces the current one. Without the root certificate installed, the browser keeps warning.', 'Use')) return;
		try { await rpc('shareos.web', 'ca_web'); toast('Certificate installed – the page reconnects.'); afterWebRestart(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},

	async 'ca-dl'(el) {
		try { const r = await rpc('shareos.web', 'ca_pem', { name: el.dataset.id, kind: el.dataset.kind }); pemDownload(r.pem, el.dataset.id + (el.dataset.kind === 'key' ? '.key' : '.crt')); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},

	async 'ca-del'(el) {
		if (!await confirmDlg('Delete certificate?', `The certificate “${el.dataset.id}” and its key are deleted from the box. Devices that already use it keep their copy.`, 'Delete', true)) return;
		try { await rpc('shareos.web', 'ca_delete', { name: el.dataset.id }); toast('Deleted.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},

	async 'acme-off'() {
		if (!await confirmDlg('Switch off Let\'s Encrypt?', 'The box then uses a self-signed certificate again.', 'Switch off')) return;
		try { await rpc('shareos.web', 'acme_off'); toast('Switched off – the page reconnects.'); await loadNetExtra(); afterWebRestart(); }
		catch (e) { toast('Let\'s Encrypt: ' + e.message, true); }
	},

	async 'cert-self'() {
		if (!await confirmDlg('New self-signed certificate?', 'A new certificate for the current name and IP is created and replaces the old one. Browsers will show a warning once again.', 'Create')) return;
		try { const r = await rpc('shareos.web', 'selfsigned'); S.web.cert = r.cert; toast('Certificate created.'); afterWebRestart(); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},

	async reboot() {
		if (!await confirmDlg('Reboot?', 'The box reboots. This page reconnects on its own (about 1–2 minutes).', 'Reboot')) return;
		try { await rpc('shareos.system', 'reboot'); } catch (e) { }
		stopPolling();
		waitForBox('Rebooting', 'ShareOS is restarting');
	},

	'pwr-edit'() { S.pwrEdit = true; renderMain(); },
	'pwr-cancel'() { S.pwrEdit = false; renderMain(); },
	async poweroff() {
		// with a power schedule: when the box will come on again
		let p = null;
		try { p = await rpc('shareos.system', 'power_schedule'); } catch (e) { p = null; }
		const back = p?.supported && p.enabled && p.next_on ? `By schedule it switches on again on ${fmtPwr(p.next_on)}.` : 'Switching on afterwards only at the device.';
		if (!await confirmDlg('Power off?', `ShareOS shuts down and the box switches off. ${back}`, 'Power off', true)) return;
		try { await rpc('shareos.system', 'poweroff', { confirm: true }); } catch (e) { toast(e.message, true); return; }
		stopPolling();
		cover('Box is powering off', 'You can close this window.');
	},

	async factory() {
		if (!await confirmDlg('Factory reset?', 'All settings and installed packages are erased, then the box reboots. Afterwards it has no password: press the USB button on its front, then choose a new one.', 'Reset', true)) return;
		try { await rpc('shareos.system', 'factory_reset', { confirm: true }); } catch (e) { toast(e.message, true); return; }
		stopPolling();
		store.del('sid');
		waitForBox('Factory reset', 'ShareOS is restarting');
	}
};

document.addEventListener('click', (e) => {
	const el = e.target.closest('[data-act]');
	if (!el || el.disabled) return;
	const fn = ACTIONS[el.dataset.act];
	if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('change', (e) => {
	if (e.target.name === 'wiz-layout' && S.wiz) { wizardCollect(); renderMain(); }
	if (e.target.classList.contains('wiz-fs') && S.wiz) { wizardCollect(); renderMain(); }
});

// The page changed (classic: another address; desktop: another window came to
// the front): stop what only the page left behind needs, load what the new one
// shows. Edits in progress are dropped in the classic view only – in the
// desktop view the other window is still there (see pageClosed).
function pageChanged() {
	if (isUser()) {
		if (S.fb && S.utab === 'files') S.fb.roots = null;
		renderUserTabs(); renderUserMain();
		return;
	}
	const keep = !!S.desk;
	if (S.route.tab !== 'storage') { clearTimeout(S.stTimer); S.stTimer = null; S.stActive = false; }
	if (S.route.tab !== 'storage' || S.route.sub !== 'snapshots') { clearTimeout(S.snapTimer); if (S.snap && !keep) { S.snap.edit = null; S.snap.log = null; } }
	if (S.route.tab !== 'shares' && !keep) { S.shEdit = null; S.uEdit = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'dlna') clearTimeout(S.dlnaTimer);
	if (S.route.tab !== 'services' || S.route.sub !== 'printer') { clearTimeout(S.prnTimer); S.prnTimer = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'ups') { clearTimeout(S.upsTimer); S.upsTimer = null; }
	if (S.route.tab === 'services' && S.route.sub === 'torrent' && S.tremote) loadTremote();
	// the DNS filter may have been switched elsewhere (Services, another window): fresh state, not the form of the last visit
	if (S.route.tab === 'dnsfilter' && S.df) loadDnsfilter();
	if (S.fb && S.route.sub === 'files') S.fb.roots = null;   // volumes may have changed
	if (S.route.tab !== 'paperless') { if (!keep) { S.plEdit = null; S.plLog = null; } } else if (S.pl) loadPaperless();
	if (S.route.tab !== 'dnsfilter') { clearTimeout(S.dfTimer); if (!keep) S.dfPass = null; } else if (S.df) loadDnsfilter();
	if (S.route.tab !== 'cloud') { clearTimeout(S.cloudTimer); if (S.cloud?.scope === 'admin' && !keep) { S.cloud.remoteEdit = null; S.cloud.jobEdit = null; S.cloud.log = null; } }
	else if (S.cloud?.scope === 'admin') loadCloud('admin');
	else if (S.shares) loadShareData();
	renderTabs();
	renderMain();
}
// desktop view: the window of a page was closed – drop its edits in progress
function pageClosed(r) {
	if (r.tab === 'storage' && r.sub === 'snapshots' && S.snap) { S.snap.edit = null; S.snap.log = null; }
	if (r.tab === 'shares') { S.shEdit = null; S.uEdit = null; }
	if (r.tab === 'paperless') { S.plEdit = null; S.plLog = null; }
	if (r.tab === 'dnsfilter') S.dfPass = null;
	if (r.tab === 'cloud' && S.cloud?.scope === 'admin') { S.cloud.remoteEdit = null; S.cloud.jobEdit = null; S.cloud.log = null; }
}

window.addEventListener('hashchange', () => {
	if (!S.sid) return;
	// desktop view: an address opens (or brings forward) the window of that page
	if (S.desk) { if (typeof deskNav === 'function') deskNav(location.hash); return; }
	if (!mainEl()) return;
	if (isUser()) parseUserRoute(); else parseRoute();
	pageChanged();
	window.scrollTo(0, 0);
});

// clock in the header without waiting for the next poll: for admins the
// clock of the box (boxNow), for plain users – who get no box time – the
// browser's
setInterval(() => {
	const c = $('.clock');
	if (!c) return;
	const now = isUser() ? new Date() : boxNow();
	if (now) c.textContent = now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
}, 10000);

// "My ShareOS": storage use, shares and open vaults change without the user
// doing anything (uploads from a PC, a vault that closes) – the data is read
// again every minute while that page is shown and nobody types in it
setInterval(async () => {
	if (!isUser() || !S.sid || S.utab !== 'me' || S.desk || document.hidden) return;
	if (document.querySelector('dialog[open]') || document.activeElement?.matches?.('input, select, textarea')) return;
	try { S.me = { ...S.me, ...(await rpc('shareos.me', 'get')) }; renderUserMain(); } catch (e) { /* the next round tries again */ }
}, 60000);

