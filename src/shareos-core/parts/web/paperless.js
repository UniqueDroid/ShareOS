/* ---------- Paperless ----------------------------------------------------------- */

const PL_STATE = { SUCCESS: ['ok', 'accepted'], PENDING: ['', 'processing'], FAILURE: ['err', 'Error'], UNKNOWN: ['warn', 'unknown'] };
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString(LOC, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

async function loadPaperless() {
	try {
		const [pl, acc, sh] = await Promise.all([rpc('shareos.paperless', 'get'), rpc('shareos.accounts', 'list'), rpc('shareos.shares', 'list')]);
		S.pl = pl; S.acc = acc; S.shares = sh;
	} catch (e) { if (e.code !== 'auth') toast('Paperless: ' + e.message, true); }
	if (S.route.tab === 'paperless' && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

function plStateTag(e) { const [c, t] = PL_STATE[e.state] || ['', e.state]; return html`<span class="tag ${c}" title="${e.message}">${t}</span>`; }

function inboxWhere(ib) {
	const host = S.info?.hostname || location.hostname;
	if (ib.owner) return `\\\\${host}\\${ib.owner}\\Paperless`;
	return ib.share ? `\\\\${host}\\${ib.share}` : ib.path || '–';
}

function paperlessView() {
	const d = S.pl;
	if (!d || !S.acc || !S.shares) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const e = S.plEdit;
	return html`
	<section class="sec">
		<h2 class="gh">PAPERLESS-NGX <span>${d.url ? d.url : 'not connected yet'}</span></h2>
		<div class="g2">
			<form class="panel" id="f-pl">
				<div class="ph"><span class="pt">CONNECTION</span>${d.last ? html`<span class="tag ml">last ${fmtTime(d.last)}</span>` : ''}</div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>PAPERLESS ADDRESS</span><input name="url" value="${d.url}" placeholder="http://paperless.local:8000" inputmode="url"></label>
				</div>
				<div class="fields" style="margin-top:12px">
					<label class="f"><span>CHECK EVERY</span><select name="interval">${[1, 2, 5, 10, 15, 30, 60].map((m) => html`<option value="${m}"${d.interval === m ? raw(' selected') : ''}>${m} min</option>`)}</select></label>
					<label class="f"><span>AFTER UPLOAD</span><select name="after"><option value="delete"${d.after === 'delete' ? raw(' selected') : ''}>Delete file</option><option value="keep"${d.after === 'keep' ? raw(' selected') : ''}>keep (.paperless/done)</option></select></label>
				</div>
				<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Send inbox folders automatically</label>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button>
					<button class="btn" type="button" data-act="pl-run" ${d.url && d.inboxes.length ? '' : 'disabled'}>Send now</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">HOW IT WORKS</span></div>
				<ol class="plan" style="padding-left:20px">
					<li>Create an API token in Paperless for each inbox (Profile → API token). The documents then belong to that Paperless user.</li>
					<li>Put files (PDF, images, Office) into the inbox folder – from a PC or straight from the scanner.</li>
					<li>ShareOS uploads them through the Paperless API and shows whether Paperless accepted them.</li>
				</ol>
				<p class="note">Personal inboxes live in the personal folder (<code>Paperless</code>); users can also enter their token themselves under “My ShareOS”. Shared inboxes use a share, e.g. for a scanner.</p>
			</div>
		</div>
	</section>
	${e ? inboxEditor(e) : ''}
	<section class="sec">
		${secHead('inboxes', 'INBOXES', d.inboxes.length ? d.inboxes.length + ' set up' : 'none yet')}
		${!d.inboxes.length ? html`<div class="panel"><div class="empty">${svg(I.doc)}<span>${d.url ? 'No inbox yet.' : 'No inbox yet. First enter the address of Paperless above.'}</span></div></div>`
			: isTable('inboxes') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>INBOX</th><th>FOLDER</th><th>WAITING</th><th>LOAD</th><th></th></tr></thead>
				<tbody>${d.inboxes.map((ib) => html`<tr>
					<td><b>${ib.name}</b><div class="mut" style="font-size:12px">${ib.owner ? 'personal: ' + ib.owner : 'shared'}${ib.enabled ? '' : ' · off'}</div></td>
					<td><code>${inboxWhere(ib)}</code></td><td>${ib.waiting}</td>
					<td>${ib.recent[0] ? html`${plStateTag(ib.recent[0])} <span class="mut" style="font-size:12px">${ib.recent[0].file}</span>` : html`<span class="mut">–</span>`}</td>
					<td><div class="acts">${inboxActions(ib)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.inboxes.map((ib) => html`<div class="card${ib.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.doc)}<span class="dot ${!(ib.enabled && ib.token_set) ? 'down' : ib.recent[0]?.state === 'FAILURE' ? 'warn' : 'up'}"></span></div>
				<div class="info"><div class="name">${ib.name}</div>
					<div class="desc">${ib.owner ? `personal inbox of ${ib.owner} · ` : 'shared inbox · '}${ib.token_hint ? 'token ' + ib.token_hint : 'no token'}</div>
					<div class="desc" style="margin-top:6px">${ib.waiting ? ib.waiting + ' file(s) waiting' : 'nothing waiting'}</div>
					${ib.recent.slice(0, 3).map((x) => html`<div class="desc" style="margin-top:4px;font-size:12px">${plStateTag(x)} ${x.file} <span class="mut">${fmtTime(x.time)}</span></div>`)}
					<div class="ip">${inboxWhere(ib)}</div>
					<div class="acts" style="margin-top:12px">${inboxActions(ib)}</div></div></div>`)}</div>`}
		${!e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="pl-new" ${d.url ? '' : 'disabled'}>New inbox</button></div>` : ''}
	</section>
	${S.plLog ? html`<section class="sec"><div class="panel">
		<div class="ph"><span class="pt">LOG · ${S.plLog.name}</span><button class="btn sm ghost ml" type="button" data-act="pl-log-close">Close</button></div>
		${S.plLog.entries.length ? html`<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>TIME</th><th>FILE</th><th>STATUS</th><th>MESSAGE</th></tr></thead>
			<tbody>${S.plLog.entries.map((x) => html`<tr><td class="mut">${fmtTime(x.time)}</td><td>${x.file}</td><td>${plStateTag(x)}</td><td class="mut" style="font-size:12px">${x.message}</td></tr>`)}</tbody></table></div>`
			: html`<p class="mut" style="margin:0">Nothing transferred yet.</p>`}
	</div></section>` : ''}`;
}

function inboxActions(ib) {
	return html`<button class="btn sm" type="button" data-act="pl-edit" data-name="${ib.name}">Edit</button>
		<button class="btn sm" type="button" data-act="pl-log" data-name="${ib.name}">Log</button>
		<button class="btn sm ghost" type="button" data-act="pl-del" data-name="${ib.name}">Remove</button>`;
}

function inboxEditor(e) {
	const x = e.data, users = S.acc.users.filter((u) => u.home), isNew = e.mode === 'new';
	return html`<section class="sec"><form class="panel" id="f-inbox" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${isNew ? 'NEW INBOX' : 'INBOX ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="pl-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>TYPE</span><select name="kind"${isNew ? '' : raw(' disabled')}><option value="user"${x.owner || isNew ? raw(' selected') : ''}>personal (folder “Paperless” in the personal folder)</option><option value="share"${!x.owner && !isNew ? raw(' selected') : ''}>shared (folder of a share)</option></select></label>
			<label class="f" id="ib-owner"><span>USER</span><select name="owner"${isNew ? '' : raw(' disabled')}>${users.map((u) => html`<option value="${u.name}"${x.owner === u.name ? raw(' selected') : ''}>${u.name}${u.fullname ? ' – ' + u.fullname : ''}</option>`)}</select></label>
			<label class="f" id="ib-share" hidden><span>SHARE</span><select name="share"${isNew ? '' : raw(' disabled')}>${S.shares.shares.map((sh) => html`<option value="${sh.name}"${x.share === sh.name ? raw(' selected') : ''}>${sh.name}</option>`)}</select></label>
			<label class="f"><span>API TOKEN${isNew ? '' : ' (EMPTY = KEEP)'}</span><input name="token" type="password" autocomplete="off" placeholder="${x.token_hint || 'from Paperless: Profile → API token'}"${isNew ? raw(' required') : ''}></label>
		</div>
		${!isNew && e.tags ? html`<div class="pt" style="margin:16px 0 8px">TAGS FOR NEW DOCUMENTS</div>
			<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${e.tags.length ? e.tags.map((t) => html`<label class="chk"><input type="checkbox" class="ib-tag" value="${t.id}"${x.tags.includes(String(t.id)) ? raw(' checked') : ''}>${t.name}</label>`) : html`<span class="mut">no tags found</span>`}</div>` : ''}
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>active</label>
		${!users.length && isNew ? html`<p class="note">Personal inboxes need a user with a personal folder.</p>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="pl-test">Test connection</button></div>
	</form></section>`;
}

/* --- after the page is drawn: listeners, loading --- */

Object.assign(VIEWS_AFTER, {
	paperless() {
		if (!S.pl || !S.acc || !S.shares) { loadPaperless(); return; }
		const kind = $('#f-inbox select[name=kind]');
		const syncKind = () => { if (!kind) return; $('#ib-owner').hidden = kind.value !== 'user'; $('#ib-share').hidden = kind.value !== 'share'; };
		kind?.addEventListener('change', syncKind); syncKind();
		$('#f-pl')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.paperless', 'set_global', { url: f.url.value.trim(), interval: +f.interval.value, after: f.after.value, enabled: f.enabled.checked }); toast('Saved.'); loadPaperless(); }
			catch (err) { toast('Paperless: ' + err.message, true); }
		});
		$('#f-inbox')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, ed = S.plEdit, x = ed.data, kindv = f.kind.value;
			const owner = ed.mode === 'new' ? (kindv === 'user' ? f.owner.value : '') : x.owner;
			const share = ed.mode === 'new' ? (kindv === 'share' ? f.share.value : '') : x.share;
			const name = ed.mode === 'new' ? (owner ? 'u_' + owner : share.replace(/-/g, '_')) : x.name;
			const args = { name, owner, share, token: f.token.value.trim(), enabled: f.enabled.checked };
			if (ed.tags) args.tags = [...document.querySelectorAll('#f-inbox .ib-tag:checked')].map((c) => +c.value);
			try { await rpc('shareos.paperless', 'inbox_set', args); S.plEdit = null; toast(`Inbox “${name}” saved.`); loadPaperless(); }
			catch (err) { toast('Inbox: ' + err.message, true); }
		});
	}
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
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
	}
});
