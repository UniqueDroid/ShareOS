/* ---------- cloud (rclone), for the admin and for users ------------------------- */

const CLOUD_MODES = {
	upload: 'Upload – copy to the cloud, nothing is deleted',
	download: 'Download – copy to the NAS, nothing is deleted',
	mirror_up: 'Mirror to the cloud – deletes in the cloud what is missing here',
	mirror_down: 'Mirror from the cloud – deletes here what is missing in the cloud'
};
const CLOUD_SCHED = [['', 'manual only'], ['17 * * * *', 'hourly'], ['30 2 * * *', 'daily at 2:30'], ['0 3 * * 0', 'Sundays at 3:00'], ['custom', 'custom time (cron)']];
const REMOTE_TYPES = { gdrive: 'Google Drive', gphotos: 'Google Photos', onedrive: 'Microsoft OneDrive', dropbox: 'Dropbox', webdav: 'Nextcloud / ownCloud / WebDAV',
	s3: 'S3 (AWS, MinIO, Wasabi …)', b2: 'Backblaze B2', mega: 'MEGA', pcloud: 'pCloud', box: 'Box', koofr: 'Koofr', yandex: 'Yandex Disk',
	sftp: 'SFTP (SSH server)', ftp: 'FTP', smb: 'Windows share (SMB)', raw: 'other – paste rclone configuration' };
// services where you sign in in the browser (OAuth): no password is stored, only a token
const REMOTE_OAUTH = { gdrive: 1, gphotos: 1, onedrive: 1, dropbox: 1, pcloud: 1, box: 1, yandex: 1 };
const REMOTE_FIELDS = {
	ftp: [['host', 'SERVER'], ['port', 'PORT', '21'], ['user', 'USER'], ['pass', 'PASSWORD', 'password']],
	smb: [['host', 'SERVER'], ['user', 'USER'], ['domain', 'DOMAIN (OPTIONAL)', 'WORKGROUP'], ['pass', 'PASSWORD', 'password']],
	mega: [['user', 'E-MAIL'], ['pass', 'PASSWORD', 'password']],
	b2: [['account', 'KEY-ID (ACCOUNT)'], ['key', 'APPLICATION KEY', 'password']],
	koofr: [['provider', 'PROVIDER', ['koofr', 'digistorage', 'other']], ['user', 'E-MAIL'], ['password', 'APP PASSWORD', 'password']],
	webdav: [['url', 'ADDRESS (WEBDAV URL)', 'https://cloud.example.com/remote.php/dav/files/NAME/'], ['vendor', 'PROVIDER', ['nextcloud', 'owncloud', 'other']], ['user', 'USER'], ['pass', 'PASSWORD / APP PASSWORD', 'password']],
	s3: [['provider', 'PROVIDER', ['AWS', 'Minio', 'Wasabi', 'Other']], ['endpoint', 'ENDPOINT (EMPTY FOR AWS)'], ['region', 'REGION'], ['access_key_id', 'ACCESS KEY'], ['secret_access_key', 'SECRET KEY', 'password']],
	sftp: [['host', 'SERVER'], ['port', 'PORT', '22'], ['user', 'USER'], ['pass', 'PASSWORD', 'password']]
};

const CLOUD_API = {
	admin: {
		async load() {
			const [st, r, j, sh] = await Promise.all([rpc('shareos.cloud', 'status'), rpc('shareos.cloud', 'remotes'), rpc('shareos.cloud', 'jobs'), rpc('shareos.shares', 'list')]);
			return { status: st, remotes: r.remotes, jobs: j.jobs, locals: sh.shares.map((x) => ['share:' + x.name, 'Share ' + x.name]),
				places: Object.fromEntries(sh.shares.filter((x) => x.volume).map((x) => ['share:' + x.name, { name: x.name, root: x.volume, base: x.path }])) };
		},
		addRemote: (a) => rpc('shareos.cloud', 'remote_add', a), delRemote: (n) => rpc('shareos.cloud', 'remote_del', { name: n }),
		testRemote: (n) => rpc('shareos.cloud', 'remote_test', { name: n }), saveJob: (a) => rpc('shareos.cloud', 'job_set', a),
		delJob: (n) => rpc('shareos.cloud', 'job_del', { name: n }), runJob: (n) => rpc('shareos.cloud', 'job_run', { name: n }),
		stopJob: (n) => rpc('shareos.cloud', 'job_stop', { name: n }), log: (n) => rpc('shareos.cloud', 'job_log', { name: n })
	},
	me: {
		async load() {
			const c = await rpc('shareos.me', 'cloud');
			return { status: { installed: c.installed }, remotes: c.remotes || [], jobs: c.jobs || [], allowed: c.allowed,
				locals: [['home', 'Personal folder'], ...(c.shares || []).map((x) => ['share:' + x, 'Share ' + x])],
				places: Object.fromEntries([['home', { name: 'home', root: 'home', base: '' }], ...(c.shares || []).map((x) => ['share:' + x, { name: x, root: x, base: '' }])]) };
		},
		addRemote: (a) => rpc('shareos.me', 'cloud_remote_add', a), delRemote: (n) => rpc('shareos.me', 'cloud_remote_del', { name: n }),
		testRemote: null, saveJob: (a) => rpc('shareos.me', 'cloud_job_set', a), delJob: (n) => rpc('shareos.me', 'cloud_job_del', { name: n }),
		runJob: (n) => rpc('shareos.me', 'cloud_job_run', { name: n }), stopJob: null, log: null
	}
};

async function loadCloud(scope) {
	clearTimeout(S.cloudTimer);
	try { S.cloud = { ...(S.cloud?.scope === scope ? S.cloud : {}), scope, data: await CLOUD_API[scope].load() }; }
	catch (e) { if (e.code !== 'auth') toast('Cloud: ' + e.message, true); return; }
	const busy = S.cloud.data.status.installing || S.cloud.data.jobs.some((j) => j.state === 'running');
	const here = scope === 'admin' ? S.route.tab === 'cloud' : S.me && S.me.role !== 'admin';
	if (here && !document.activeElement?.matches('input,select,textarea')) { if (scope === 'admin') renderMain(); else renderUserMain(); }
	if (busy && here) S.cloudTimer = setTimeout(() => loadCloud(scope), 4000);
}

function jobState(j) {
	if (j.state === 'running') return html`<span class="tag warn">running since ${fmtTime(j.started)}</span>`;
	if (j.state === 'ok') return html`<span class="tag ok" title="${j.summary}">ok · ${fmtTime(j.ended)}</span>`;
	if (j.state === 'error') return html`<span class="tag err" title="${j.error}">Error · ${fmtTime(j.ended)}</span>`;
	return html`<span class="tag">not run yet</span>`;
}
const schedTxt = (s) => (CLOUD_SCHED.find(([v]) => v === s) || [s, s ? 'cron: ' + s : 'manual only'])[1];
// job.local: "home", "home:<sub>", "share:<name>" or "share:<name>/<sub>" -> [base, sub]
function localSplit(l) {
	const m = /^(home):(.+)$/.exec(l || '') || /^(share:[^/]+)\/(.+)$/.exec(l || '');
	return m ? [m[1], m[2]] : [l || '', ''];
}
const localTxt = (d, l) => { const [b, sub] = localSplit(l); return (d.locals.find(([v]) => v === b) || [b, b])[1] + (sub ? ' / ' + sub : ''); };

function cloudSection(scope) {
	const c = S.cloud?.scope === scope ? S.cloud : null, d = c?.data;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const api = CLOUD_API[scope], st = d.status;
	const head = scope === 'admin' ? html`<h2 class="gh">CLOUD-SYNC <span>${st.installed ? 'rclone ' + (st.version || '') : 'rclone not installed'}</span></h2>` : html`<h2 class="gh">MY CLOUD <span>own accounts and jobs</span></h2>`;
	if (!st.installed) {
		return html`<section class="sec">${head}<div class="panel"><div class="empty">${svg(I.cloud)}<div>
			${scope === 'admin' ? html`<span>Cloud sync uses <b>rclone</b> (Nextcloud, WebDAV, S3, SFTP, Google Drive, OneDrive, Dropbox and more). The program (about 20 MB) goes into the apps area on the disk${st.apps ? ` (${st.apps})` : ''}.</span>
				${st.installing ? html`<div style="margin-top:12px;display:flex;gap:10px;align-items:center"><div class="spin" style="margin:0;width:18px;height:18px"></div><span>downloading and checking …</span></div>`
				: html`<div class="acts" style="margin-top:12px"><button class="btn primary" type="button" data-act="cl-install" ${st.apps ? '' : 'disabled'}>Install rclone</button></div>`}
				${st.install_error ? html`<p class="note" style="color:var(--red)">Error: ${st.install_error}</p>` : ''}
				${st.apps ? '' : html`<p class="note">First, under <a href="#/storage">Storage</a> set up a drive.</p>`}`
			: html`<span>Cloud sync is not set up on this box yet – please ask the administrator.</span>`}
		</div></div></div></section>`;
	}
	const re = c.remoteEdit, je = c.jobEdit;
	return html`<section class="sec">${head}
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">ACCOUNTS</span><span class="tag ml">${d.remotes.length}</span></div>
				${d.remotes.length ? html`<div class="tw"><table class="t"><thead><tr><th>NAME</th><th>TYPE</th><th></th></tr></thead>
					<tbody>${d.remotes.map((r) => html`<tr><td><b>${r.name}</b></td><td class="mut">${r.type}</td>
						<td><div class="acts">${api.testRemote ? html`<button class="btn sm" type="button" data-act="cl-rtest" data-scope="${scope}" data-name="${r.name}">Test</button>` : ''}
							<button class="btn sm ghost" type="button" data-act="cl-rdel" data-scope="${scope}" data-name="${r.name}">Remove</button></div></td></tr>`)}</tbody></table></div>`
					: html`<p class="mut" style="margin:0;font-size:13px">No cloud account yet.</p>`}
				${re ? '' : html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="cl-rnew" data-scope="${scope}">Add account</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NOTES</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6"><span>Credentials stay on the box, readable for root only (passwords obscured by rclone, not encrypted).</span> <span>For Google Drive, OneDrive, Dropbox and similar services you sign in in the browser; for other services paste the finished section from “rclone config”.</span> <span>Jobs run with little memory (2 transfers at a time); a bandwidth limit like</span> <code>2M</code> <span>keeps the network free.</span>${scope === 'me' ? html` <span>Your credentials are kept in your personal folder; what you download counts towards your storage limit.</span>` : ''}</p>
			</div>
		</div>
		${re ? remoteEditor(scope, re) : ''}
	</section>
	${je ? jobEditor(scope, d, je) : ''}
	<section class="sec">
		${secHead('cloudjobs-' + scope, 'JOBS', d.jobs.length ? d.jobs.length + ' set up' : 'none yet')}
		${!d.jobs.length ? html`<div class="panel"><div class="empty">${svg(I.cloud)}<span>No job yet. A job copies or mirrors a folder with a cloud account – by hand or on a schedule.</span></div></div>`
			: isTable('cloudjobs-' + scope) ? html`<div class="tw"><table class="t" style="min-width:860px"><thead><tr><th>JOB</th><th>FROM → TO</th><th>SCHEDULE</th><th>LOAD</th><th></th></tr></thead>
				<tbody>${d.jobs.map((j) => html`<tr><td><b>${j.name}</b><div class="mut" style="font-size:12px">${scope === 'admin' ? (j.owner ? 'owner: ' + j.owner : 'System') : ''}</div></td>
					<td style="font-size:12px">${jobRoute(d, j)}</td><td class="mut">${schedTxt(j.schedule)}${j.enabled ? '' : ' · off'}</td><td>${jobState(j)}</td>
					<td><div class="acts">${jobActions(scope, j)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${d.jobs.map((j) => html`<div class="card${j.enabled ? '' : ' off'}">
				<div class="icon">${svg(I.cloud)}<span class="dot ${j.state === 'error' ? 'down' : j.state === 'running' ? 'warn' : j.state === 'ok' && j.enabled ? 'up' : ''}"></span></div>
				<div class="info"><div class="name">${j.name}</div>
					<div class="desc" style="font-size:12px">${jobRoute(d, j)}</div>
					<div class="desc" style="margin-top:6px">${schedTxt(j.schedule)}${scope === 'admin' && j.owner ? html` · <span>${'owner: ' + j.owner}</span>` : ''}</div>
					<div class="desc" style="margin-top:6px">${jobState(j)}</div>
					${j.state === 'error' && j.error ? html`<div class="desc" style="margin-top:4px;font-size:12px;color:var(--red)">${j.error}</div>` : j.summary ? html`<div class="desc mut" style="margin-top:4px;font-size:12px">${j.summary}</div>` : ''}
					<div class="acts" style="margin-top:12px">${jobActions(scope, j)}</div></div></div>`)}</div>`}
		${!je && d.remotes.length ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="cl-jnew" data-scope="${scope}">New job</button></div>` : ''}
	</section>
	${c.log ? html`<section class="sec"><div class="panel"><div class="ph"><span class="pt">LOG · ${c.log.name}</span><button class="btn sm ghost ml" type="button" data-act="cl-logclose" data-scope="${scope}">Close</button></div>
		<pre class="logbox">${c.log.lines.join('\n') || '(empty)'}</pre></div></section>` : ''}`;
}

function jobRoute(d, j) {
	const local = localTxt(d, j.local), remote = `${j.remote}:${j.remote_path || '/'}`;
	return j.mode === 'download' || j.mode === 'mirror_down' ? html`${remote} → ${local}` : html`${local} → ${remote}`;
}

function jobActions(scope, j) {
	const api = CLOUD_API[scope];
	return html`${j.state === 'running' ? (api.stopJob ? html`<button class="btn sm danger" type="button" data-act="cl-jstop" data-scope="${scope}" data-name="${j.name}">Stop</button>` : '')
		: html`<button class="btn sm" type="button" data-act="cl-jrun" data-scope="${scope}" data-name="${j.name}">Start now</button>`}
		<button class="btn sm" type="button" data-act="cl-jedit" data-scope="${scope}" data-name="${j.name}">Edit</button>
		${api.log ? html`<button class="btn sm" type="button" data-act="cl-jlog" data-scope="${scope}" data-name="${j.name}">Log</button>` : ''}
		<button class="btn sm ghost" type="button" data-act="cl-jdel" data-scope="${scope}" data-name="${j.name}">Remove</button>`;
}

function remoteEditor(scope, re) {
	const fields = REMOTE_FIELDS[re.type] || [];
	return html`<form class="panel" id="f-remote" data-scope="${scope}" style="margin-top:16px;border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">NEW CLOUD ACCOUNT</span><button class="btn sm ghost ml" type="button" data-act="cl-rcancel" data-scope="${scope}">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${re.name || ''}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required placeholder="nextcloud"></label>
			<label class="f"><span>TYPE</span><select name="type" id="remote-type">${Object.entries(REMOTE_TYPES).map(([k, t]) => html`<option value="${k}"${re.type === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			${fields.map(([k, label, extra]) => html`<label class="f"><span>${label}</span>${Array.isArray(extra)
				? html`<select name="p_${k}">${extra.map((o) => html`<option>${o}</option>`)}</select>`
				: html`<input name="p_${k}" type="${extra === 'password' ? 'password' : 'text'}" autocomplete="off"${extra && extra !== 'password' ? raw(` placeholder="${esc(extra)}"`) : ''}>`}</label>`)}
		</div>
		${REMOTE_OAUTH[re.type] ? html`<div style="margin-top:12px">
			<p class="note" style="margin-top:0">For ${REMOTE_TYPES[re.type]} you sign in in the browser; the box only stores an access token, no password.</p>
			<div class="acts"><button class="btn" type="button" data-act="cl-auth" data-scope="${scope}">1. Sign in at ${REMOTE_TYPES[re.type]} ↗</button>${re.authed ? html`<span class="tag ok">signed in ✓</span>` : ''}</div>
			${re.authUrl && !re.authed ? html`<p class="note">After signing in, the browser shows “page not reachable” with an address like <code>http://127.0.0.1:53682/?state=…&amp;code=…</code>. Copy this whole address from the address bar and paste it here:</p>
			<div class="fields" style="grid-template-columns:1fr auto;align-items:end"><label class="f"><span>2. ADDRESS AFTER SIGNING IN</span><input name="auth_url" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:53682/?state=…"></label>
			<button class="btn" type="button" data-act="cl-authfin" data-scope="${scope}">Apply</button></div>` : ''}
		</div>` : ''}
		${re.type === 'raw' ? html`<label class="f" style="margin-top:12px"><span>SECTION FROM RCLONE.CONF (STARTS WITH [NAME])</span>
			<textarea name="raw" rows="8" spellcheck="false" data-i18n-skip style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" placeholder="[gdrive]&#10;type = drive&#10;token = {...}"></textarea></label>` : ''}
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Add</button></div>
	</form>`;
}

function jobEditor(scope, d, je) {
	const x = je.data, custom = x.schedule && !CLOUD_SCHED.some(([v]) => v === x.schedule);
	return html`<section class="sec"><form class="panel" id="f-job" data-scope="${scope}" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${je.mode === 'new' ? 'NEW JOB' : 'JOB ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="cl-jcancel" data-scope="${scope}">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required${je.mode === 'new' ? '' : raw(' readonly')}></label>
			<label class="f"><span>FOLDER ON THE NAS</span><select name="local">${d.locals.map(([v, t]) => html`<option value="${v}"${localSplit(x.local)[0] === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>SUBFOLDER (OPTIONAL)</span><div class="fb-row"><input name="sub" value="${localSplit(x.local)[1]}" maxlength="200"><button class="btn sm" type="button" data-act="cl-browse" data-scope="${scope}">Browse …</button></div></label>
			<label class="f"><span>CLOUD ACCOUNT</span><select name="remote">${d.remotes.map((r) => html`<option value="${r.name}"${x.remote === r.name ? raw(' selected') : ''}>${r.name}</option>`)}</select></label>
			<label class="f"><span>FOLDER IN THE CLOUD</span><input name="remote_path" value="${x.remote_path}" placeholder="Backup/NAS"></label>
		</div>
		<div class="pt" style="margin:16px 0 8px">DIRECTION</div>
		<div style="display:grid;gap:6px">${Object.entries(CLOUD_MODES).map(([k, t]) => html`<label class="chk"><input type="radio" name="mode" value="${k}"${x.mode === k ? raw(' checked') : ''} style="accent-color:var(--accent)">${t}</label>`)}</div>
		<div class="fields" style="margin-top:14px">
			<label class="f"><span>SCHEDULE</span><select name="sched" id="job-sched">${CLOUD_SCHED.map(([v, t]) => html`<option value="${v}"${(custom ? 'custom' : x.schedule) === v ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f" id="job-cron"${custom ? '' : raw(' hidden')}><span>CRON TIME (MIN HOUR DAY MON WEEKDAY)</span><input name="cron" value="${custom ? x.schedule : ''}" placeholder="0 4 * * 1-5"></label>
			<label class="f"><span>BANDWIDTH (EMPTY = UNLIMITED)</span><input name="bwlimit" value="${x.bwlimit}" placeholder="2M"></label>
		</div>
		<label class="chk" style="margin-top:12px"><input type="checkbox" name="enabled"${x.enabled !== false ? raw(' checked') : ''}>Schedule active</label>
		<p class="note">Mirroring deletes on the target side what is missing on the source side – for plain backups choose “Upload”.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function cloudAfter(scope) {
	$('#remote-type')?.addEventListener('change', (e) => {
		const f = $('#f-remote');
		S.cloud.remoteEdit = { name: f.name.value, type: e.target.value };
		scope === 'admin' ? renderMain() : renderUserMain();
	});
	$('#job-sched')?.addEventListener('change', (e) => { $('#job-cron').hidden = e.target.value !== 'custom'; });
	$('#f-remote')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, type = f.type.value, params = {};
		if (REMOTE_OAUTH[type] && !S.cloud.remoteEdit?.authed) { toast('Sign in first (step 1 and 2).', true); return; }
		(REMOTE_FIELDS[type] || []).forEach(([k]) => { const v = f['p_' + k]?.value.trim(); if (v) params[k] = v; });
		try {
			await CLOUD_API[scope].addRemote({ name: f.name.value.trim(), type, params, raw: type === 'raw' ? f.raw.value.trim() + '\n' : '' });
			S.cloud.remoteEdit = null; toast(`Account “${f.name.value.trim()}” added.`); loadCloud(scope);
		} catch (err) { toast('Account: ' + err.message, true); }
	});
	$('#f-job')?.addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.target, sched = f.sched.value === 'custom' ? f.cron.value.trim() : f.sched.value;
		const sub = f.sub.value.trim().replace(/^\/+|\/+$/g, '');
		const local = !sub ? f.local.value : f.local.value === 'home' ? 'home:' + sub : f.local.value + '/' + sub;
		const args = { name: f.name.value.trim(), local, remote: f.remote.value, remote_path: f.remote_path.value.trim(),
			mode: $('input[name=mode]:checked', f)?.value || 'upload', schedule: sched, bwlimit: f.bwlimit.value.trim(), enabled: f.enabled.checked };
		if ((args.mode === 'mirror_down' || args.mode === 'mirror_up') && !await confirmDlg('Mirror?', args.mode === 'mirror_down'
			? 'Mirroring from the cloud deletes files on the NAS that are missing in the cloud.' : 'Mirroring to the cloud deletes files in the cloud that are missing on the NAS.', 'Understood', true)) return;
		try { await CLOUD_API[scope].saveJob(args); S.cloud.jobEdit = null; toast(`Job “${args.name}” saved.`); loadCloud(scope); }
		catch (err) { toast('Job: ' + err.message, true); }
	});
}

