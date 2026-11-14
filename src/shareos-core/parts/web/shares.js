/* ---------- shares, users, groups (Freigaben) -------------------------------- */

const ACCESS_TXT = { rw: 'read & write', ro: 'read only', '': 'no access' };
const fmtMB = (mb) => (mb ? fmtBytes(mb * 1e6, 0) : 'unlimited');

async function loadShareData() {
	try {
		const [sh, acc, st] = await Promise.all([rpc('shareos.shares', 'list'), rpc('shareos.accounts', 'list'), rpc('shareos.storage', 'volumes')]);
		S.shares = sh; S.acc = acc; S.vols = st.volumes || [];
	} catch (e) { if (e.code !== 'auth') toast('Shares: ' + e.message, true); }
	if (S.route.tab === 'shares' && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

function accessOf(sh, tag) { return sh.rw.includes(tag) ? 'rw' : sh.ro.includes(tag) ? 'ro' : ''; }
// the logged-in admin account's own access to a share (directly or by a group)
function accessOfUser(sh) {
	const u = S.acc?.users.find((x) => x.name === S.me?.name);
	return u ? [u.name, ...u.groups.map((g) => '@' + g)].map((t) => accessOf(sh, t)).find(Boolean) || '' : '';
}

function shareAccessSummary(sh) {
	const parts = [...sh.rw.map((x) => x + ' (rw)'), ...sh.ro.map((x) => x + ' (r)')];
	if (sh.guest) parts.unshift('Guests (r)');
	return parts.join(', ') || 'nobody yet';
}

function sharesView() {
	const d = S.shares, host = S.info?.hostname || location.hostname, ip = S.info?.network?.eth0?.ipv4?.address || location.hostname;
	const e = S.shEdit;
	const list = d.shares;
	return html`
	${e ? shareEditor(e) : ''}
	<section class="sec">
		${secHead('shares', 'SHARES', list.length ? list.length + ' set up' : 'none yet')}
		${!S.vols.length ? html`<div class="panel"><div class="empty">${svg(I.info)}<span>Shares need a drive – first set one up under <a href="#/storage">Storage</a> .</span></div></div>`
			: !list.length ? html`<div class="panel"><div class="empty">${svg(I.folder)}<div><span>No share yet. A share makes a folder on a drive reachable on the network – from Windows, macOS and Linux.</span>
				<div class="acts" style="margin-top:12px">${e ? '' : html`<button class="btn primary" type="button" data-act="sh-new">Create a share</button>`}</div></div></div></div>`
			: isTable('shares') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>SHARE</th><th>FOLDER</th><th>LOGS</th><th>ACCESS</th><th></th></tr></thead>
				<tbody>${list.map((x) => html`<tr>
					<td><b>${x.name}</b>${x.comment ? html`<div class="mut" style="font-size:12px">${x.comment}</div>` : ''}</td>
					<td><code>${x.fullpath || x.volume + '/' + x.path}</code>${x.mounted ? '' : html` <span class="tag err">drive missing</span>`}</td>
					<td>${shareTags(x)}</td><td class="mut" style="font-size:12px">${shareAccessSummary(x)}</td>
					<td><div class="acts">${shareActions(x)}</div></td></tr>`)}</tbody></table></div>`
			: html`<div class="grid">${list.map((x) => html`<div class="card${x.mounted ? '' : ' off'}">
				<div class="icon">${svg(I.folder)}<span class="dot ${x.mounted ? 'up' : 'down'}"></span></div>
				<div class="info"><div class="name">${x.name}</div>
					<div class="desc">${x.comment || (x.fullpath || x.volume + '/' + x.path)}</div>
					<div class="desc" style="margin-top:8px">${shareTags(x)}</div>
					<div class="desc" style="margin-top:6px">${shareAccessSummary(x)}</div>
					<div class="ip">${x.smb ? '\\\\' + host + '\\' + x.name : x.fullpath || ''}</div>
					<div class="acts" style="margin-top:12px">${shareActions(x)}</div></div></div>`)}</div>`}
		${list.length && !e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="sh-new">New share</button></div>` : ''}
	</section>
	<section class="sec">
		<h2 class="gh">SERVICES</h2>
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SMB (WINDOWS, MACOS, LINUX)</span><span class="tag ml ${d.smb_running ? 'ok' : ''}">${d.smb_running ? 'running' : 'off'}</span></div>
				<label class="chk"><input type="checkbox" id="opt-smb"${d.smb_enabled ? raw(' checked') : ''}>Offer SMB shares</label>
				<div class="fields" style="grid-template-columns:1fr;margin-top:12px"><label class="f"><span>WORKGROUP</span><input id="opt-wg" value="${d.workgroup}" maxlength="15"></label></div>
				<label class="chk" style="margin-top:12px"><input type="checkbox" id="opt-smbcompat"${d.smb_compat ? raw(' checked') : ''}>Compatibility mode (SMB 2.1 at most)</label>
				<p class="note">Only for devices that have trouble with SMB 3. The signature Windows 11 requires on every connection is computed by the crypto engine of the box with SMB 3 (measured about 19–23 MB/s when writing, about 35 without signing); SMB 2.1 computes it on the processor (about 9–14 MB/s) and has no encryption and no multichannel. Open connections are dropped when this is changed.</p>
				<dl class="kv" style="margin-top:12px">
					<dt>Windows</dt><dd><code>\\\\${host}\\&lt;share&gt;</code></dd>
					<dt>macOS / Linux</dt><dd><code>smb://${ip}/&lt;share&gt;</code></dd>
				</dl>
				<p class="note">The SMB service starts automatically as soon as there is a share. Personal folders appear as <code>\\\\${host}\\&lt;user&gt;</code>.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">NFS (LINUX, PROXMOX)</span><span class="tag ml ${d.nfs_running ? 'ok' : ''}">${d.nfs_running ? 'running' : 'off'}</span></div>
				<label class="chk"><input type="checkbox" id="opt-nfs"${d.nfs_enabled ? raw(' checked') : ''}>Offer NFS shares</label>
				<p class="note">NFS has no user accounts: the listed computers or networks get access. Files are stored as <code>nobody:users</code> . Mount e.g. with <code>mount ${ip}:/mnt/&lt;drive&gt;/&lt;folder&gt; /target</code>.</p>
			</div>
		</div>
	</section>`;
}

// vault share: who unlocked it until when
const vaultTime = (t) => new Date(t * 1000).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
function vaultTag(x) {
	if (!x.vault) return '';
	const open = x.vault_open || [];
	return html`<span class="tag warn">VAULT</span> ${open.length ? open.map((o) => html`<span class="tag ok">${o.user}: open until ${vaultTime(o.until)}</span> `) : html`<span class="tag">locked</span> `}`;
}
function shareTags(x) {
	return html`${vaultTag(x)}${x.smb ? html`<span class="tag">SMB</span> ` : ''}${x.nfs ? html`<span class="tag">NFS${x.nfs_rw ? '' : ' (r)'}</span> ` : ''}${x.guest ? html`<span class="tag warn">GUEST</span>` : ''}${!x.smb && !x.nfs ? html`<span class="tag err">no protocol</span>` : ''}`;
}
function shareActions(x) {
	const me = S.me?.name, mine = (x.vault_open || []).some((o) => o.user === me);
	return html`${x.vault && me && me !== 'root' && !mine && accessOfUser(x) ? html`<button class="btn sm" type="button" data-act="vault-unlock" data-share="${x.name}" data-ttl="${x.vault_ttl}">${svg(I.key)}Unlock</button> ` : ''}
		${x.vault && (x.vault_open || []).length ? html`<button class="btn sm" type="button" data-act="sh-vlock" data-name="${x.name}">${svg(I.lock)}Lock now</button> ` : ''}
		<button class="btn sm" type="button" data-act="sh-edit" data-name="${x.name}">Edit</button>
		<button class="btn sm ghost" type="button" data-act="sh-del" data-name="${x.name}">Remove</button>`;
}

function shareEditor(e) {
	const x = e.data, accs = S.acc;
	const rows = [...accs.users.map((u) => [u.name, u.fullname ? `${u.name} – ${u.fullname}` : u.name, I.user]),
		...accs.groups.map((g) => ['@' + g.name, `Group ${g.name}`, I.users])];
	return html`<section class="sec"><form class="panel" id="f-share" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${e.mode === 'new' ? 'NEW SHARE' : 'SHARE ' + x.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="sh-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>NAME</span><input name="name" value="${x.name}" maxlength="16" pattern="[a-z0-9][a-z0-9_-]{0,15}" required${e.mode === 'edit' ? raw(' readonly') : ''}></label>
			<label class="f"><span>DRIVE</span><select name="volume">${S.vols.map((v) => html`<option value="${v.name}"${x.volume === v.name ? raw(' selected') : ''}>${v.name} (${LAYOUT_TXT[v.layout] || v.layout})</option>`)}</select></label>
			<label class="f"><span>FOLDER ON THE DRIVE</span><div class="fb-row"><input name="path" value="${x.path}" placeholder="same as the name"><button class="btn sm" type="button" data-act="sh-browse">Browse …</button></div></label>
			<label class="f"><span>DESCRIPTION</span><input name="comment" value="${x.comment}" maxlength="64"></label>
		</div>
		<div class="pt" style="margin:18px 0 8px">ACCESS VIA SMB</div>
		<div style="display:grid;gap:6px">
			<label class="chk"><input type="checkbox" name="smb"${x.smb ? raw(' checked') : ''}>Share via SMB (Windows, macOS, Linux)</label>
			<label class="chk"><input type="checkbox" name="guest"${x.guest ? raw(' checked') : ''}>Guests may read without a password</label>
		</div>
		${rows.length ? html`<div class="tw" style="margin-top:12px"><table class="t" style="min-width:420px"><thead><tr><th>USER / GROUP</th><th style="width:220px">PERMISSION</th></tr></thead>
			<tbody>${rows.map(([tag, label, icon]) => html`<tr><td><span style="display:inline-flex;gap:8px;align-items:center">${svg(icon)}${label}</span></td>
				<td><select class="acl" data-tag="${tag}" aria-label="Permission for ${label}">${['', 'ro', 'rw'].map((v) => html`<option value="${v}"${accessOf(x, tag) === v ? raw(' selected') : ''}>${ACCESS_TXT[v]}</option>`)}</select></td></tr>`)}</tbody></table></div>`
			: html`<p class="note">No users yet – create them under <a href="#/shares/users">User</a> , or allow guest access.</p>`}
		<div class="pt" style="margin:18px 0 8px">VAULT</div>
		<label class="chk"><input type="checkbox" name="vault"${x.vault ? raw(' checked') : ''}>As a vault: share only on request, for some minutes</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:10px"><label class="f"><span>DEFAULT TIME WHEN UNLOCKING</span><select name="vault_ttl">${VAULT_TTLS.map((m) => html`<option value="${m}"${(x.vault_ttl || 15) === m ? raw(' selected') : ''}>${vaultMin(m)}</option>`)}</select></label></div>
		<p class="note">A vault is not visible in the network. A user with rights on it unlocks it under “My ShareOS” (or in an app) with their password – then, for the chosen time, it is reachable for them only as <code>\\box\${x.name || 'name'}</code> and locks itself afterwards. While locked, nobody gets at the files, not through open connections or apps either. A vault is shared over SMB only, without guests and NFS.</p>
		<div class="pt" style="margin:18px 0 8px">ACCESS VIA NFS</div>
		<div style="display:grid;gap:6px">
			<label class="chk"><input type="checkbox" name="nfs"${x.nfs ? raw(' checked') : ''}>Share via NFS</label>
			<label class="chk"><input type="checkbox" name="nfs_rw"${x.nfs_rw ? raw(' checked') : ''}>NFS clients may write</label>
		</div>
		<div class="fields" style="grid-template-columns:1fr;margin-top:10px"><label class="f"><span>NFS CLIENTS (IP OR NETWORK, COMMA-SEPARATED)</span><input name="nfs_hosts" value="${x.nfs_hosts.join(', ')}" placeholder="192.168.1.0/24"></label></div>
		<p class="note">The folder is created if it is missing. Removing a share keeps the folder and its files.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
	</form></section>`;
}

function usageLine(u) {
	if (!u.usage?.length) return u.quota ? html`Limit ${fmtMB(u.quota)} per drive` : html`<span class="mut">no limit</span>`;
	return html`${u.usage.map((x) => { const p = x.limit ? pct(x.used, x.limit) : 0; return html`<div style="margin-top:4px"><span class="mut">${x.volume}:</span> ${fmtBytes(x.used)}${x.limit ? html` of ${fmtBytes(x.limit)}` : ''}
		${x.limit ? html`<div class="bar" style="margin-top:4px"><i class="${p > 95 ? 'crit' : p > 85 ? 'warn' : ''}" style="width:${p.toFixed(0)}%"></i></div>` : ''}</div>`; })}`;
}

function usersView() {
	const a = S.acc, e = S.uEdit;
	return html`
	${e ? userEditor(e) : ''}
	<section class="sec">
		${secHead('users', 'USER', a.users.length ? a.users.length + ' created' : 'none yet')}
		${!a.users.length ? html`<div class="panel"><div class="empty">${svg(I.user)}<div><span>No users yet. One account works everywhere: for shares, the web interface and later for apps and cloud sync.</span>
			<div class="acts" style="margin-top:12px">${e ? '' : html`<button class="btn primary" type="button" data-act="u-new">Create a user</button>`}
			<button class="btn ghost" type="button" data-act="u-altf">Import from Alt-F</button></div></div></div></div>`
		: isTable('users') ? html`<div class="tw"><table class="t" style="min-width:820px"><thead><tr><th>USER</th><th>ROLE</th><th>GROUPS</th><th>PERSONAL FOLDER</th><th>STORAGE</th><th></th></tr></thead>
			<tbody>${a.users.map((u) => html`<tr>
				<td><b>${u.name}</b>${u.fullname ? html`<div class="mut" style="font-size:12px">${u.fullname}</div>` : ''}</td>
				<td>${roleTag(u)}</td><td class="mut">${u.groups.join(', ') || '–'}</td>
				<td class="mut">${u.home ? '/mnt/' + u.home + '/home/' + u.name : '–'}</td>
				<td style="font-size:12px;min-width:160px">${usageLine(u)}</td>
				<td><div class="acts">${userActions(u)}</div></td></tr>`)}</tbody></table></div>`
		: html`<div class="grid">${a.users.map((u) => html`<div class="card">
			<div class="icon">${svg(I.user)}</div>
			<div class="info"><div class="name">${u.name} ${roleTag(u)}</div>
				<div class="desc">${u.fullname || ''}${u.groups.length ? (u.fullname ? ' · ' : '') + u.groups.join(', ') : ''}</div>
				<div class="desc" style="margin-top:8px;font-size:12px">${usageLine(u)}</div>
				<div class="ip">${u.home ? '/mnt/' + u.home + '/home/' + u.name : 'no personal folder'}</div>
				<div class="acts" style="margin-top:12px">${userActions(u)}</div></div></div>`)}</div>`}
		${a.users.length && !e ? html`<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="u-new">New user</button>
			<button class="btn ghost" type="button" data-act="u-altf">Import from Alt-F</button></div>` : ''}
		<p class="note">Roles: <b>Administrator</b> – everything, including SSH. <b>User</b> – own area “My ShareOS” in the web interface. <b>Shares only</b> – access to shares, no web login. The account <code>root</code> is always an administrator.</p>
	</section>`;
}

function roleTag(u) {
	return html`<span class="tag ${u.role === 'admin' ? 'warn' : ''}">${ROLE_TXT[u.role] || u.role}${u.role === 'user' && !u.web ? ' · no web' : ''}</span>`;
}
function userActions(u) {
	return html`<button class="btn sm" type="button" data-act="u-edit" data-name="${u.name}">Edit</button>
		<button class="btn sm" type="button" data-act="u-pass" data-name="${u.name}">${svg(I.key)}Password</button>
		<button class="btn sm ghost" type="button" data-act="u-del" data-name="${u.name}">Delete</button>`;
}

function userEditor(e) {
	const u = e.data, isNew = e.mode === 'new';
	return html`<section class="sec"><form class="panel" id="f-user" style="border-color:var(--dim);box-shadow:var(--glow)">
		<div class="ph"><span class="pt">${isNew ? 'NEW USER' : 'USER ' + u.name.toUpperCase()}</span><button class="btn sm ghost ml" type="button" data-act="u-cancel">Cancel</button></div>
		<div class="fields">
			<label class="f"><span>USER NAME</span><input name="name" value="${u.name}" maxlength="32" pattern="[a-z][a-z0-9_]{0,31}" required autocomplete="off"${isNew ? '' : raw(' readonly')}></label>
			<label class="f"><span>FULL NAME</span><input name="fullname" value="${u.fullname}" maxlength="64"></label>
			<label class="f"><span>ROLE</span><select name="role">${Object.entries(ROLE_TXT).map(([k, t]) => html`<option value="${k}"${u.role === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
			<label class="f"><span>PERSONAL FOLDER</span><select name="home"><option value="">none</option>${S.vols.filter(linuxFs).map((v) => html`<option value="${v.name}"${u.home === v.name ? raw(' selected') : ''}>on ${v.name}</option>`)}</select></label>
			<label class="f"><span>STORAGE LIMIT (GB)</span><input name="quota" type="number" min="0" step="1" value="${Math.round((u.quota || 0) / 1000)}"></label>
			${isNew ? html`<label class="f"><span>PASSWORD</span><input name="p1" type="password" minlength="8" autocomplete="new-password" required></label>
				<label class="f"><span>REPEAT</span><input name="p2" type="password" minlength="8" autocomplete="new-password" required></label>` : ''}
		</div>
		<label class="chk" style="margin-top:12px" id="u-web-row"${u.role === 'user' ? '' : raw(' hidden')}><input type="checkbox" name="web"${u.web ? raw(' checked') : ''}>May log in to the web interface (“My ShareOS”)</label>
		<label class="chk" style="margin-top:6px"><input type="checkbox" name="cloud"${u.cloud ? raw(' checked') : ''}>May create own cloud sync jobs (needs a personal folder)</label>
		<label class="chk" style="margin-top:6px"><input type="checkbox" name="files"${u.files ? raw(' checked') : ''}>Files: personal folder and shares (by permissions) in the file browser and in apps</label>
		${S.acc.groups.length ? html`<div class="pt" style="margin:16px 0 8px">GROUPS</div><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${S.acc.groups.map((g) => html`
			<label class="chk"><input type="checkbox" class="u-group" value="${g.name}"${u.groups.includes(g.name) ? raw(' checked') : ''}>${g.name}</label>`)}</div>` : ''}
		<p class="note">User name: lower-case letters, digits and _, starting with a letter. The storage limit applies per drive, 0 = unlimited. The password is used for shares and – depending on the role – for the web interface.</p>
		<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">${isNew ? 'Create' : 'Save'}</button></div>
	</form></section>`;
}

function groupsView() {
	const a = S.acc;
	return html`<section class="sec">
		<h2 class="gh">GROUPS <span>${a.groups.length ? a.groups.length + ' created' : 'none yet'}</span></h2>
		${a.groups.length ? html`<div class="tw"><table class="t" style="min-width:560px"><thead><tr><th>GROUP</th><th>DESCRIPTION</th><th>MEMBERS</th><th></th></tr></thead>
			<tbody>${a.groups.map((g) => html`<tr><td><b>${g.name}</b></td><td class="mut">${g.desc || '–'}</td><td>${g.members.join(', ') || html`<span class="mut">none</span>`}</td>
				<td><button class="btn sm ghost" type="button" data-act="g-del" data-name="${g.name}">Delete</button></td></tr>`)}</tbody></table></div>`
			: html`<div class="panel"><div class="empty">${svg(I.users)}<span>Groups bring users together, e.g. “family” or “media”. Share permissions can then be given to the whole group.</span></div></div>`}
		<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="g-new">New group</button></div>
		<p class="note">Members are set on the user (Users → Edit).</p>
	</section>`;
}

/* --- after the page is drawn: listeners, loading --- */

Object.assign(VIEWS_AFTER, {
	shares() {
		if (S.route.sub === 'files') return;
		// Paperless loads shares and accounts too, but not the volumes
		if (!S.shares || !S.acc || !S.vols) { loadShareData(); return; }
		$('#opt-smb')?.addEventListener('change', (e) => shareGlobal({ smb: e.target.checked }));
		$('#opt-nfs')?.addEventListener('change', (e) => shareGlobal({ nfs: e.target.checked }));
		$('#opt-wg')?.addEventListener('change', (e) => shareGlobal({ workgroup: e.target.value.trim() }));
		$('#opt-smbcompat')?.addEventListener('change', (e) => shareGlobal({ smb_compat: e.target.checked }));
		$('#f-user select[name=role]')?.addEventListener('change', (e) => { $('#u-web-row').hidden = e.target.value !== 'user'; });
		// a vault: SMB only, no guests, no NFS
		const vaultSync = () => {
			const f = $('#f-share'); if (!f) return;
			const v = f.vault.checked;
			for (const n of ['guest', 'nfs', 'nfs_rw']) { if (v) f[n].checked = false; f[n].disabled = v; }
			if (v) f.smb.checked = true;
			f.smb.disabled = v; f.vault_ttl.disabled = !v;
		};
		$('#f-share input[name=vault]')?.addEventListener('change', vaultSync);
		vaultSync();
		$('#f-share')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, rw = [], ro = [];
			document.querySelectorAll('#f-share select.acl').forEach((s2) => { if (s2.value === 'rw') rw.push(s2.dataset.tag); if (s2.value === 'ro') ro.push(s2.dataset.tag); });
			const args = { name: f.name.value.trim().toLowerCase(), volume: f.volume.value, path: f.path.value.trim() || f.name.value.trim().toLowerCase(), comment: f.comment.value.trim(),
				smb: f.smb.checked, guest: f.guest.checked, nfs: f.nfs.checked, nfs_rw: f.nfs_rw.checked,
				nfs_hosts: f.nfs_hosts.value.split(/[\s,;]+/).filter(Boolean), rw, ro, vault: f.vault.checked, vault_ttl: +f.vault_ttl.value };
			if (args.vault) { args.guest = false; args.nfs = false; }
			if (args.nfs && !args.nfs_hosts.length) { toast('Enter at least one client (IP or network) for NFS.', true); return; }
			try { S.shares = await rpc('shareos.shares', 'set', args); S.shEdit = null; toast(`Share “${args.name}” saved.`); renderMain(); }
			catch (err) { toast('Share: ' + err.message, true); }
		});
		$('#f-user')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, isNew = S.uEdit.mode === 'new';
			const args = { name: f.name.value.trim().toLowerCase(), fullname: f.fullname.value.trim(), role: f.role.value, home: f.home.value,
				quota: Math.max(0, Math.round(+f.quota.value || 0)) * 1000, web: f.web.checked, cloud: f.cloud.checked, files: f.files.checked,
				groups: [...document.querySelectorAll('#f-user .u-group:checked')].map((x) => x.value) };
			if (isNew) {
				if (f.p1.value !== f.p2.value) { toast('The passwords do not match.', true); return; }
				args.password = f.p1.value;
			}
			try { S.acc = await rpc('shareos.accounts', isNew ? 'add' : 'set', args); S.uEdit = null; toast(isNew ? `User “${args.name}” created.` : `User “${args.name}” saved.`); renderMain(); }
			catch (err) { toast('User: ' + err.message, true); }
		});
	}
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	'sh-new'() {
		S.shEdit = { mode: 'new', data: { name: '', volume: S.vols[0]?.name || '', path: '', comment: '', smb: true, guest: false, nfs: false, nfs_rw: false, nfs_hosts: [], rw: [], ro: [] } };
		renderMain(); window.scrollTo(0, 0);
	},
	'sh-edit'(el) { S.shEdit = { mode: 'edit', data: structuredClone(S.shares.shares.find((x) => x.name === el.dataset.name)) }; renderMain(); window.scrollTo(0, 0); },
	'sh-cancel'() { S.shEdit = null; renderMain(); },
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
	}
});
