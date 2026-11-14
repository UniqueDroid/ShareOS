/* ---------- file browser (admins: all volumes, users: personal folder + shares by rights) */

function fbInit() {
	if (!S.fb) S.fb = { roots: null, root: '', path: '', data: null, sel: new Set(), hidden: false, uploads: [], err: null };
	if (!S.fbApps) { S.fbApps = { apps: [] }; loadOpeners(); }
	return S.fb;
}

const fbRootLabel = (r) => (r.home ? 'Personal folder' : r.ro ? r.name + ' (read only)' : r.name);
const fbJoin = (a, b) => (a ? a + '/' + b : b);

async function fbLoad(path) {
	const f = fbInit();
	try {
		if (!f.roots) {
			const rr = await rpc('shareos.files', 'roots');
			f.roots = rr.roots || []; f.trashConf = rr.trash || { enabled: false, days: 0 };
			if (!f.roots.some((r) => r.name === f.root)) { f.root = f.roots[0]?.name || ''; f.path = ''; }
		}
		if (f.root) {
			const d = await rpc('shareos.files', 'list', { root: f.root, path: path ?? f.path, hidden: f.hidden });
			f.data = d; f.path = d.path; f.sel = new Set(); f.err = null;
		}
	} catch (e) {
		f.err = e.message;
		if (path != null && path !== f.path) { toast('Files: ' + e.message, true); f.err = null; }
	}
	fbRender();
}

function fbRender() {
	const box = $('#fb');
	if (box) box.innerHTML = fbInner().s;
	const ts = $('#fb-trashset');
	if (ts) ts.innerHTML = trashSettings().s ?? '';
}

function filesView() {
	const f = fbInit();
	if (!f.roots && !f.err) fbLoad();
	return html`<section class="sec"><div id="fb">${fbInner()}</div></section>`;
}

function fbInner() {
	const f = S.fb, d = f.data;
	if (f.err && !d) return html`<div class="panel"><div class="empty">${svg(I.warn)}<span>${f.err}</span></div></div>`;
	if (!f.roots) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	if (!f.roots.length) return html`<div class="panel"><div class="empty">${svg(I.info)}<span>${S.me?.role === 'admin' || !S.me ? 'No drive mounted – set one up under STORAGE first.' : 'Neither a personal folder nor a share for you.'}</span></div></div>`;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const root = f.roots.find((r) => r.name === f.root) || f.roots[0], ro = !!root.ro;
	if (f.trash) return fbTrashInner(root);
	const parts = f.path ? f.path.split('/') : [];
	const n = f.sel.size, all = d.entries.length && n === d.entries.length;
	const busy = f.uploads.some((u) => u.pct != null && u.pct < 100 && !u.err);
	return html`<div class="panel fb" id="fb-drop">
		<div class="fbbar">
			${f.roots.length > 1 ? html`<select id="fb-root" class="btn sm ghost" aria-label="Drive">${f.roots.map((r) => html`<option value="${r.name}"${r.name === f.root ? raw(' selected') : ''}>${fbRootLabel(r)}</option>`)}</select>` : ''}
			<nav class="crumbs" aria-label="Path">
				<button type="button" data-act="fb-crumb" data-p="">${svg(I.folder)}${fbRootLabel(root)}</button>${parts.map((p, i) => html`<span>/</span><button type="button" data-act="fb-crumb" data-p="${parts.slice(0, i + 1).join('/')}" data-i18n-skip>${p}</button>`)}
			</nav>
			${d.free != null ? html`<span class="tag ml">${fmtBytes(d.free)} free</span>` : ''}
		</div>
		<div class="acts fbtools">
			<button class="btn sm ghost" type="button" data-act="fb-up" ${parts.length ? '' : 'disabled'} title="Folder up" aria-label="Folder up">${svg(I.up)}</button>
			<button class="btn sm" type="button" data-act="fb-mkdir" ${ro ? 'disabled' : ''}>${svg(I.plus)}New folder</button>
			<label class="btn sm${busy || ro ? ' dis' : ''}">${svg(I.ul)}Upload<input type="file" id="fb-file" multiple hidden ${busy || ro ? 'disabled' : ''}></label>
			<span class="sep"></span>
			<button class="btn sm ghost" type="button" data-act="fb-rename" ${n === 1 && !ro ? '' : 'disabled'}>${svg(I.pen)}Rename</button>
			<button class="btn sm ghost" type="button" data-act="fb-cut" ${n && !ro ? '' : 'disabled'}>${svg(I.move)}Cut</button>
			<button class="btn sm ghost" type="button" data-act="fb-copy" ${n ? '' : 'disabled'}>${svg(I.copy)}Copy</button>
			${S.fbClip ? html`<button class="btn sm primary" type="button" data-act="fb-paste" ${ro ? 'disabled' : ''} title="${S.fbClip.names.join(', ')}">${svg(I.copy)}Paste (${S.fbClip.names.length})</button>
				<button class="btn sm ghost" type="button" data-act="fb-clip-clear" title="Clear clipboard" aria-label="Clear clipboard">×</button>` : ''}
			<button class="btn sm danger" type="button" data-act="fb-del" ${n && !ro ? '' : 'disabled'}>${svg(I.trash)}Delete</button>
			${f.trashConf?.enabled ? html`<button class="btn sm ghost" type="button" data-act="fb-trash">${svg(I.trash)}Trash</button>` : ''}
			<label class="chk ml"><input type="checkbox" id="fb-hidden"${f.hidden ? raw(' checked') : ''}>Hidden</label>
		</div>
		${f.uploads.length ? html`<div class="fbup">${f.uploads.map((u) => html`<div class="fbuprow"><span class="nm">${u.name}</span>
			${u.err ? html`<span class="tag err">${u.err}</span>` : u.pct >= 100 ? html`<span class="tag ok">done</span>` : html`<div class="bar busy"><i style="width:${u.pct || 0}%"></i></div><span class="vv">${u.pct || 0} %</span>`}</div>`)}</div>` : ''}
		${d.entries.length ? html`<div class="tw"><table class="t fbt">
			<thead><tr><th style="width:34px"><input type="checkbox" class="fb-all" aria-label="Select all"${all ? raw(' checked') : ''}></th><th>NAME</th><th class="r">SIZE</th><th>MODIFIED</th><th></th></tr></thead>
			<tbody>${d.entries.map((e) => {
				const dir = e.type === 'dir' || e.type === 'dirlink';
				return html`<tr class="${f.sel.has(e.name) ? 'sel' : ''}">
					<td><input type="checkbox" class="fb-sel" data-name="${e.name}" aria-label="select ${e.name}"${f.sel.has(e.name) ? raw(' checked') : ''}></td>
					<td class="nm">${dir ? html`<button type="button" class="lnk" data-act="fb-open" data-name="${e.name}">${svg(I.folder)}<span>${e.name}</span></button>`
						: e.type === 'file' ? (fbOpeners(e.name)[0]
							? html`<button type="button" class="lnk" data-act="fb-app" data-name="${e.name}" data-app="${fbOpeners(e.name)[0].id}" title="Open with ${fbOpeners(e.name)[0].name}">${svg(I.doc)}<span>${e.name}</span></button>`
							: html`<button type="button" class="lnk" data-act="fb-dl" data-name="${e.name}" title="Download">${svg(I.doc)}<span>${e.name}</span></button>`)
						: html`<span class="lnk mut">${svg(I.doc)}<span>${e.name}</span></span>`}</td>
					<td class="r mut">${dir ? '' : fmtBytes(e.size)}</td>
					<td class="mut">${fmtTime(e.mtime)}</td>
					<td class="r">${e.type === 'file' ? html`${fbOpeners(e.name).map((a) => html`<button class="btn sm ghost" type="button" data-act="fb-app" data-name="${e.name}" data-app="${a.id}" title="Open with ${a.name}">${a.name} ↗</button> `)}<button class="btn sm ghost" type="button" data-act="fb-dl" data-name="${e.name}" title="Download" aria-label="download ${e.name}">${svg(I.dl)}</button>` : ''}</td></tr>`;
			})}</tbody></table></div>`
			: html`<div class="empty">${svg(I.folder)}<span>This folder is empty.</span></div>`}
		${d.truncated ? html`<p class="note">Only the first 2000 entries are shown.</p>` : ''}
		<p class="note">You can also simply drag files here. ${n ? html`<b>${n} selected.</b>` : ''}</p>
	</div>`;
}

// admins: trash on/off and how long it keeps things (below the file browser)
function trashSettings() {
	const c = S.fb?.trashConf;
	if (!c) return '';
	return html`<section class="sec"><h2 class="gh">TRASH</h2><div class="g2"><div class="panel">
		<label class="chk"><input type="checkbox" id="trash-on"${c.enabled ? raw(' checked') : ''}>Put what is deleted in the file browser into the trash first</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>DELETE FOR GOOD AUTOMATICALLY AFTER</span><select id="trash-days" ${c.enabled ? '' : 'disabled'}>
			${[[7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days'], [0, 'never (empty by hand only)']].map(([v, t]) => html`<option value="${v}"${c.days === v ? raw(' selected') : ''}>${t}</option>`)}
		</select></label></div>
		<p class="note">Every folder has its own trash: the personal folder, each share, each drive. It lies on the same disk and counts towards the storage limit. It applies to the file browser of this interface – what is deleted over SMB from a PC or in apps is gone at once; for that there are the snapshots.</p>
	</div></div></section>`;
}

// the trash of the current root (personal folder, share, drive)
async function fbTrashLoad() {
	try { S.fb.tdata = await rpc('shareos.files', 'trash_list', { root: S.fb.root }); }
	catch (e) { S.fb.tdata = { items: [], error: e.message }; }
	fbRender();
}

function fbTrashInner(root) {
	const f = S.fb, d = f.tdata, items = d?.items || [], n = f.tsel?.size || 0, ro = !!d?.ro;
	return html`<div class="panel fb">
		<div class="fbbar">
			<nav class="crumbs" aria-label="Path"><button type="button" data-act="fb-trash-close">${svg(I.folder)}${fbRootLabel(root)}</button><span>/</span><b>Trash</b></nav>
			${d?.days ? html`<span class="tag ml">deletes after ${d.days} days</span>` : ''}
		</div>
		<div class="acts fbtools">
			<button class="btn sm ghost" type="button" data-act="fb-trash-close" title="Back" aria-label="Back">${svg(I.up)}</button>
			<button class="btn sm" type="button" data-act="fb-trash-restore" ${n && !ro ? '' : 'disabled'}>${svg(I.reboot)}Restore</button>
			<button class="btn sm danger" type="button" data-act="fb-trash-del" ${n && !ro ? '' : 'disabled'}>${svg(I.trash)}Delete for good</button>
			<span class="sep"></span>
			<button class="btn sm danger" type="button" data-act="fb-trash-del" data-all="1" ${items.length && !ro ? '' : 'disabled'}>Empty trash</button>
		</div>
		${!d ? html`<div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div>`
			: d.error ? html`<div class="empty">${svg(I.warn)}<span>${d.error}</span></div>`
			: items.length ? html`<div class="tw"><table class="t fbt">
				<thead><tr><th style="width:34px"></th><th>NAME</th><th>FROM</th><th class="r">SIZE</th><th>DELETED</th></tr></thead>
				<tbody>${items.map((x) => html`<tr class="${f.tsel.has(x.id) ? 'sel' : ''}">
					<td><input type="checkbox" class="fb-tsel" data-id="${x.id}" aria-label="select ${x.name}"${f.tsel.has(x.id) ? raw(' checked') : ''}></td>
					<td class="nm"><span class="lnk">${svg(x.type === 'dir' ? I.folder : I.doc)}<span>${x.name}</span></span></td>
					<td class="mut">${x.path ? '/' + x.path : '/'}</td>
					<td class="r mut">${x.size != null ? fmtBytes(x.size) : ''}</td>
					<td class="mut">${fmtTime(x.time)}${x.user && x.user !== S.me?.name ? html` · ${x.user}` : ''}</td></tr>`)}</tbody></table></div>`
			: html`<div class="empty">${svg(I.trash)}<span>The trash is empty.</span></div>`}
	</div>`;
}

async function fbDownload(name) {
	const f = S.fb;
	try {
		const r = await rpc('shareos.files', 'ticket', { root: f.root, path: f.path, name, mode: 'get' });
		const a = document.createElement('a');
		a.href = r.url; a.download = name;
		document.body.append(a); a.click(); a.remove();
	} catch (e) { toast('Download: ' + e.message, true); }
}

// apps that open this file (edit before view), from shareos.files openers
function fbOpeners(name) {
	const m = /(\.[a-z0-9]{1,10})$/.exec(name.toLowerCase());
	if (!m || !S.fbApps?.apps) return [];
	const hit = (a, mode) => (a.opens || []).some((o) => o.ext.includes(m[1]) && (!mode || o.mode === mode));
	return [...S.fbApps.apps.filter((a) => hit(a, 'edit')), ...S.fbApps.apps.filter((a) => !hit(a, 'edit') && hit(a))];
}
async function loadOpeners() {
	try { S.fbApps = await rpc('shareos.files', 'openers'); } catch (e) { S.fbApps = { apps: [] }; }
	if (S.fb?.data) fbRender();
}

// open a file in an app: the window must be opened right away (popup blockers),
// the address follows when the ticket is there
async function fbOpenIn(appId, name) {
	const a = (S.fbApps?.apps || []).find((x) => x.id === appId);
	if (!a) return;
	if (S.desk && typeof deskApp === 'function') {
		try {
			const r = await rpc('shareos.files', 'app_ticket', { root: S.fb.root, path: S.fb.path, name, app: appId });
			deskApp(a, `${appBase(r)}/${r.app}/${r.entry || 'index.html'}?${appParams({ file: r.ticket, name, ...(r.grant ? { fs: r.grant } : {}) })}`, name);
		} catch (e) { toast('Open: ' + e.message, true); }
		return;
	}
	const w = window.open('about:blank', a.window ? 'sosfile-' + Date.now() : '_blank', winFeatures(a));
	try {
		const r = await rpc('shareos.files', 'app_ticket', { root: S.fb.root, path: S.fb.path, name, app: appId });
		const url = `${appBase(r)}/${r.app}/${r.entry || 'index.html'}?${appParams({ file: r.ticket, name, ...(r.grant ? { fs: r.grant } : {}) })}`;
		if (w) { w.location.href = url; appWins.add(w); } else location.href = url;
	} catch (e) { w?.close(); toast('Open: ' + e.message, true); }
}

function fbSend(url, file, onpct) {
	return new Promise((resolve, reject) => {
		const x = new XMLHttpRequest();
		x.open('POST', url);
		x.upload.onprogress = (ev) => { if (ev.lengthComputable) onpct(Math.floor(ev.loaded * 100 / ev.total)); };
		x.onload = () => {
			let j = {};
			try { j = JSON.parse(x.responseText); } catch (e) { }
			x.status === 200 && j.ok ? resolve() : reject(new Error(j.error || 'HTTP ' + x.status));
		};
		x.onerror = () => reject(new Error('Connection lost'));
		x.send(file);
	});
}

async function fbUpload(files) {
	const f = S.fb;
	if (!files?.length || !f?.root) return;
	const root = f.root, path = f.path;
	const list = [...files].map((file) => ({ file, name: file.name, pct: 0, err: null }));
	f.uploads = list;
	fbRender();
	for (const u of list) {
		try {
			let t;
			try { t = await rpc('shareos.files', 'ticket', { root, path, name: u.name, mode: 'put' }); }
			catch (e) {
				if (e.message !== 'already exists') throw e;
				if (!await confirmDlg('Replace file?', `“${u.name}” already exists in this folder.`, 'Replace', true)) { u.err = 'skipped'; fbRender(); continue; }
				t = await rpc('shareos.files', 'ticket', { root, path, name: u.name, mode: 'put', overwrite: true });
			}
			let last = 0;
			await fbSend(t.url, u.file, (p) => { u.pct = p; if (p - last >= 3 || p === 100) { last = p; fbRender(); } });
			u.pct = 100;
		} catch (e) { u.err = e.message; }
		fbRender();
	}
	const bad = list.filter((u) => u.err && u.err !== 'skipped').length;
	toast(bad ? `${bad} file(s) not uploaded.` : `${list.length} file(s) uploaded.`, !!bad);
	if (S.fb && S.fb.root === root && S.fb.path === path) await fbLoad();
	setTimeout(() => { if (S.fb && S.fb.uploads === list && !list.some((u) => u.err)) { S.fb.uploads = []; fbRender(); } }, 4000);
}

// clipboard of the file browser: copy / cut takes the selection, "Paste"
// in another folder (also of another drive or share) copies or moves it there
function fbClip(cut) {
	const f = S.fb, names = [...f.sel];
	if (!names.length) return;
	S.fbClip = { root: f.root, path: f.path, names, cut };
	f.sel.clear();
	toast(`${names.length} item(s) on the clipboard – choose “Paste” in the target folder.`);
	fbRender();
}

// Copy, move and delete: what takes longer than a few seconds goes on in the
// background on the box (the call answers { running, job }); wait for its
// result here, so the box stays usable meanwhile.
async function fileOp(method, args) {
	const first = await rpc('shareos.files', method, args);
	let r = first;
	if (r.running) toast('This takes a while – it goes on in the background …');
	while (r.running) {
		await new Promise((res) => { setTimeout(res, 1500); });
		r = await rpc('shareos.files', 'job', { id: first.job });
	}
	return { ...first, ...r, running: false };
}

async function fbPaste() {
	const f = S.fb, c = S.fbClip;
	if (!c) return;
	try {
		await fileOp('move', { root: c.root, path: c.path, names: c.names, dest: f.path, dest_root: f.root, copy: !c.cut });
		toast(c.cut ? 'Moved.' : 'Copied.');
		if (c.cut) S.fbClip = null;   // moved: gone from the old place; a copy can be pasted again
		fbLoad();
	} catch (e) { toast((c.cut ? 'Move: ' : 'Copy: ') + e.message, true); }
}

Object.assign(ACTIONS, {
	'fb-open'(el) { fbLoad(fbJoin(S.fb.path, el.dataset.name)); },
	'fb-crumb'(el) { fbLoad(el.dataset.p); },
	'fb-up'() { const p = S.fb.path.split('/'); p.pop(); fbLoad(p.join('/')); },
	'fb-dl'(el) { fbDownload(el.dataset.name); },
	async 'note-read'(el) { try { await rpc('shareos.notify', 'read', { id: el.dataset.id }); } catch (e) { toast(e.message, true); } loadNotes(); },
	async 'note-del'(el) {
		if (el.dataset.id === 'all' && !await confirmDlg('Delete all messages?', 'The list is emptied. If a problem persists, the box reports it again at the next check.', 'Delete')) return;
		try { await rpc('shareos.notify', 'delete', { id: el.dataset.id }); } catch (e) { toast(e.message, true); }
		loadNotes();
	},
	async 'term-open'(el) {
		el.disabled = true;
		try { S.term = await termStart(); renderMain(); }
		catch (e) { toast('Terminal: ' + e.message, true); el.disabled = false; }
	},
	// the terminal takes one client and ends when it leaves: the window gets a
	// session of its own (the one shown in the page ends). The window is opened
	// right away – a pop-up opened after waiting for the box would be blocked.
	async 'term-window'(el) {
		const w = window.open('', 'shareos-terminal', 'popup,width=960,height=620');
		if (!w) { toast('Window blocked – allow pop-ups for this page.', true); return; }
		el.disabled = true;
		try {
			const t = await termStart();
			w.location.href = termUrl(t);
			S.term = { ...t, window: true };
			renderMain();
		} catch (e) { w.close(); toast('Terminal: ' + e.message, true); el.disabled = false; }
	},
	'term-close'() { S.term = null; renderMain(); },
	async 'tg-chats'(el) {
		el.disabled = true;
		try {
			const r = await rpc('shareos.notify', 'telegram_chats');
			if (!r.chats.length) { toast('No message to the bot yet – first save the token, then write to the bot in Telegram.', true); return; }
			const c = r.chats[r.chats.length - 1];
			$('#f-notify input[name=push_chat]').value = c.id;
			toast(`Chat found: ${c.name || c.username || c.id} – now save.`);
		} catch (e) { toast('Telegram: ' + e.message, true); }
		finally { el.disabled = false; }
	},
	async 'note-test'(el) {
		el.disabled = true;
		try { await rpc('shareos.notify', 'test'); toast('Test message sent.'); }
		catch (e) { toast('Test: ' + e.message, true); }
		el.disabled = false;
	},
	'fb-app'(el) { fbOpenIn(el.dataset.app, el.dataset.name); },
	'app-launch'(el) { const a = findApp(el.dataset.id); if (a) launchApp(a); },
	fav(el) {
		const id = el.dataset.id, ids = favIds();
		S.me.fav = { bar: favBarOn(), text: favTextOn(), ...S.me.fav, apps: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
		favSave({ apps: S.me.fav.apps });
	},
	async 'chip-open'(el) {
		if (!findApp(el.dataset.app) && !(S.me && S.me.role !== 'admin')) await loadApps(['installed']);
		const a = findApp(el.dataset.app);
		if (a) launchApp(a); else location.hash = S.me && S.me.role !== 'admin' ? '#/me' : '#/apps/installed';
	},
	// the app of the page in a window of its own: the page goes back to the list
	'app-window'(el) {
		const a = findApp(el.dataset.id);
		if (!a) return;
		openAppWindow(a);
		location.hash = isUser() ? '#/me' : '#/apps/installed';
	},
	async 'fb-mkdir'() {
		const name = await promptDlg('New folder', 'Name of the new folder:', '', 'Create', 'text', 255);
		if (!name) return;
		try { await rpc('shareos.files', 'mkdir', { root: S.fb.root, path: S.fb.path, name }); fbLoad(); }
		catch (e) { toast('Folder: ' + e.message, true); }
	},
	async 'fb-rename'() {
		const old = [...S.fb.sel][0];
		const to = await promptDlg('Rename', `New name for “${old}”:`, old, 'Rename', 'text', 255);
		if (!to || to === old) return;
		try { await rpc('shareos.files', 'rename', { root: S.fb.root, path: S.fb.path, name: old, to }); fbLoad(); }
		catch (e) { toast('Rename: ' + e.message, true); }
	},
	'fb-cut'() { fbClip(true); },
	'fb-copy'() { fbClip(false); },
	'fb-paste'() { fbPaste(); },
	'fb-clip-clear'() { S.fbClip = null; fbRender(); },
	async 'fb-del'() {
		const names = [...S.fb.sel], list = `${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''}`;
		const trash = S.fb.trashConf?.enabled && !(S.fb.path === '.shareos-trash' || S.fb.path.startsWith('.shareos-trash/'));
		if (trash) {
			if (!await confirmDlg(`Move ${names.length} item(s) to the trash?`, `${list} – can be restored from the trash.`, 'Move to trash')) return;
		} else if (!await confirmDlg(`Delete ${names.length} item(s)?`, `${list} – folders with their content. This cannot be undone.`, 'Delete', true)) return;
		try {
			const r = await fileOp('delete', { root: S.fb.root, path: S.fb.path, names });
			toast(r.trash ? 'Moved to the trash.' : 'Deleted.'); fbLoad();
		} catch (e) { toast('Delete: ' + e.message, true); }
	},
	async 'fb-trash'() { S.fb.trash = true; S.fb.tsel = new Set(); S.fb.tdata = null; fbRender(); fbTrashLoad(); },
	'fb-trash-close'() { S.fb.trash = false; fbLoad(); },
	async 'fb-trash-restore'() {
		const ids = [...S.fb.tsel];
		try {
			const r = await rpc('shareos.files', 'trash_restore', { root: S.fb.root, ids });
			toast(`${r.restored.length} item(s) restored.`); S.fb.tsel = new Set(); fbTrashLoad();
		} catch (e) { toast('Restore: ' + e.message, true); }
	},
	async 'fb-trash-del'(el) {
		const all = el.dataset.all === '1', ids = all ? [] : [...S.fb.tsel];
		const n = all ? (S.fb.tdata?.items || []).length : ids.length;
		const title = `Delete ${n} item(s) for good?`;
		if (!await confirmDlg(all ? 'Empty the trash?' : title, 'This cannot be undone.', all ? 'Empty' : 'Delete for good', true)) return;
		try { await fileOp('trash_empty', { root: S.fb.root, ids }); toast(all ? 'Trash emptied.' : 'Deleted for good.'); S.fb.tsel = new Set(); fbTrashLoad(); }
		catch (e) { toast('Delete: ' + e.message, true); }
	}
});

// how an app opens: in the page or in a window of its own (for everyone on this box)
document.addEventListener('change', (e) => {
	const k = { 'opt-favbar': 'bar', 'opt-favtext': 'text' }[e.target.id];
	if (!k || !S.me) return;
	S.me.fav = { apps: favIds(), bar: favBarOn(), text: favTextOn(), ...S.me.fav, [k]: e.target.checked };
	favSave({ [k]: e.target.checked });
});

document.addEventListener('change', async (e) => {
	const t = e.target;
	if (!t.classList?.contains('app-display')) return;
	try {
		await rpc('shareos.apps', 'set', { id: t.dataset.id, display: t.value });
		const a = findApp(t.dataset.id); if (a) a.display = t.value;
		toast(t.value === 'page' ? 'Now opens in the page.' : 'Now opens in its own window.');
		renderMain();
	} catch (err) { toast('Display: ' + err.message, true); }
});

// trash settings (admins, below the file browser)
document.addEventListener('change', async (e) => {
	if (e.target.id !== 'trash-on' && e.target.id !== 'trash-days') return;
	const c = S.fb?.trashConf;
	if (!c) return;
	const on = $('#trash-on').checked, days = +$('#trash-days').value;
	try { S.fb.trashConf = await rpc('shareos.files', 'trash_config', { enabled: on, days }); toast('Trash settings saved.'); }
	catch (err) { toast('Trash: ' + err.message, true); }
	if (!S.fb.trashConf.enabled) S.fb.trash = false;
	renderMain();
});

document.addEventListener('change', (e) => {
	const t = e.target, f = S.fb;
	if (!f || !t.closest?.('#fb')) return;
	if (t.id === 'fb-root') { f.root = t.value; f.path = ''; f.data = null; f.trash = false; fbRender(); fbLoad(''); }
	else if (t.id === 'fb-hidden') { f.hidden = t.checked; fbLoad(); }
	else if (t.id === 'fb-file') fbUpload(t.files);
	else if (t.classList.contains('fb-sel')) { t.checked ? f.sel.add(t.dataset.name) : f.sel.delete(t.dataset.name); fbRender(); }
	else if (t.classList.contains('fb-all')) { f.sel = t.checked ? new Set(f.data.entries.map((x) => x.name)) : new Set(); fbRender(); }
	else if (t.classList.contains('fb-tsel')) { t.checked ? f.tsel.add(t.dataset.id) : f.tsel.delete(t.dataset.id); fbRender(); }
});
for (const ev of ['dragover', 'dragleave', 'drop']) {
	document.addEventListener(ev, (e) => {
		const box = e.target.closest?.('#fb-drop');
		if (!box || !e.dataTransfer?.types?.includes('Files')) return;
		e.preventDefault();
		box.classList.toggle('drag', ev === 'dragover');
		if (ev === 'drop') fbUpload(e.dataTransfer.files);
	});
}

