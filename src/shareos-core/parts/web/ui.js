/* ---------- UI primitives --------------------------------------------------- */

function toast(msg, bad = false) {
	const el = document.createElement('div');
	if (bad) el.className = 'bad';
	el.textContent = msg;
	$('#toast').append(el);
	setTimeout(() => el.remove(), bad ? 7000 : 4000);
}

function confirmDlg(title, text, okLabel, danger = false) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<h3>${title}</h3><p>${text}</p><div class="acts">
			<button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn ${danger ? 'danger' : 'primary'}" type="button" value="yes">${okLabel}</button></div>`.s;
		$('#app').append(d);
		d.addEventListener('click', (e) => {
			const v = e.target.closest('button')?.value;
			if (v) { d.close(); resolve(v === 'yes'); }
		});
		d.addEventListener('cancel', () => resolve(false));
		d.addEventListener('close', () => d.remove());
		d.showModal();
		$('button[value=no]', d).focus();
	});
}

async function shareGlobal(v) {
	try { S.shares = await rpc('shareos.shares', 'global', v); toast('Saved.'); renderMain(); } catch (e) { toast(e.message, true); }
}

function promptDlg(title, text, value, okLabel, type = 'text', max = 0) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<form method="dialog"><h3>${title}</h3><p>${text}</p>
			<label class="f" style="margin-bottom:16px"><input name="v" value="${value}" type="${type}" maxlength="${max || (type === 'password' ? 128 : 32)}"${type === 'password' ? raw(' minlength="8" autocomplete="new-password"') : ''} required></label>
			<div class="acts"><button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn primary" type="submit" value="yes">${okLabel}</button></div></form>`.s;
		$('#app').append(d);
		let result = null;
		$('button[value=no]', d).addEventListener('click', () => d.close());
		$('form', d).addEventListener('submit', () => { result = type === 'password' ? $('input', d).value : $('input', d).value.trim(); });
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		d.showModal();
		$('input', d).select();
	});
}

// unlocking a vault: password again and how long; resolves {password, minutes} or null
const VAULT_TTLS = [5, 15, 30, 60, 120, 240, 480];
const vaultMin = (m) => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);
function vaultDlg(share, ttl) {
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.innerHTML = html`<form method="dialog"><h3>Unlock vault “${share}”</h3><p>Your password again, for safety. The vault is then reachable in the network for you only and locks itself again.</p>
			<label class="f" style="margin-bottom:12px"><span>PASSWORD</span><input name="pw" type="password" autocomplete="current-password" maxlength="128" required></label>
			<label class="f" style="margin-bottom:16px"><span>OPEN FOR</span><select name="min">${VAULT_TTLS.map((m) => html`<option value="${m}"${m === ttl ? raw(' selected') : ''}>${vaultMin(m)}</option>`)}</select></label>
			<div class="acts"><button class="btn ghost" type="button" value="no">Cancel</button>
			<button class="btn primary" type="submit" value="yes">Unlock</button></div></form>`.s;
		$('#app').append(d);
		let result = null;
		$('button[value=no]', d).addEventListener('click', () => d.close());
		$('form', d).addEventListener('submit', () => { result = { password: $('input', d).value, minutes: +$('select', d).value }; });
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		d.showModal();
		$('input', d).focus();
	});
}

// Folder browser on the box (shareos.files list/mkdir): places = [{ name,
// root (files root: a volume for admins, a share or "home" for users),
// base (folder inside the root) }]. With several places the first level
// lists them. Resolves { place, path } (path relative to the place) or null.
function folderDlg(title, places, start = {}) {
	const join = (...p) => p.filter(Boolean).join('/');
	let place = places.length === 1 ? places[0] : places.find((x) => x.name === start.place) || null;
	let cur = place ? (start.path || '').replace(/^\/+|\/+$/g, '') : '';
	return new Promise((resolve) => {
		const d = document.createElement('dialog');
		d.className = 'dlg';
		d.style.width = d.style.maxWidth = 'min(560px, calc(100vw - 32px))';
		let result = null, first = true;
		const draw = async () => {
			let body;
			if (!place) {
				body = html`<div class="fb-list" data-i18n-skip>${places.map((x, i) => html`<button class="btn ghost fb-item" type="button" data-place="${i}">${svg(I.folder)}<span>${x.name}</span></button>`)}</div>`;
			} else {
				let r;
				try { r = await rpc('shareos.files', 'list', { root: place.root, path: join(place.base, cur) }); }
				catch (e) {
					if (first && cur) { cur = ''; first = false; return draw(); }
					body = html`<p class="note">${e.message === 'not allowed' ? 'The folder browser needs the “Files” permission – please type the folder.' : e.message}</p>`;
				}
				if (r) {
					const dirs = r.entries.filter((x) => x.type === 'dir' || x.type === 'dirlink');
					body = dirs.length ? html`<div class="fb-list" data-i18n-skip>${dirs.map((x) => html`<button class="btn ghost fb-item" type="button" data-dir="${x.name}">${svg(I.folder)}<span>${x.name}</span></button>`)}</div>`
						: html`<p class="mut" style="margin:10px 0">No subfolders.</p>`;
				}
			}
			first = false;
			const where = place ? '/' + join(places.length > 1 ? place.name : '', cur) : '';
			d.innerHTML = html`<h3>${title}</h3>
				<div class="fb-path"><button class="btn sm" type="button" value="up"${place && (cur || places.length > 1) ? '' : raw(' disabled')}>Up</button>
					<code data-i18n-skip>${place ? (places.length > 1 ? '' : place.name) + where : '/'}</code></div>
				${body}
				<div class="acts" style="margin-top:14px">${place ? html`<button class="btn" type="button" value="mkdir">New folder</button>` : ''}
					<button class="btn ghost ml" type="button" value="no">Cancel</button>
					<button class="btn primary" type="button" value="ok"${place ? '' : raw(' disabled')}>Choose this folder</button></div>`.s;
		};
		d.addEventListener('click', async (e) => {
			const b = e.target.closest('button');
			if (!b) return;
			if (b.dataset.place != null) { place = places[+b.dataset.place]; cur = ''; return draw(); }
			if (b.dataset.dir != null) { cur = join(cur, b.dataset.dir); return draw(); }
			if (b.value === 'up') {
				if (cur) cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '';
				else place = null;
				return draw();
			}
			if (b.value === 'mkdir') {
				const n = await promptDlg('New folder', 'Name of the new folder:', '', 'Create', 'text', 255);
				if (!n) return;
				try { await rpc('shareos.files', 'mkdir', { root: place.root, path: join(place.base, cur), name: n }); cur = join(cur, n); }
				catch (err) { toast(err.message, true); }
				return draw();
			}
			if (b.value === 'ok') { result = { place: place.name, path: cur }; d.close(); }
			if (b.value === 'no') d.close();
		});
		d.addEventListener('close', () => { d.remove(); resolve(result); });
		$('#app').append(d);
		d.innerHTML = html`<h3>${title}</h3><div class="spin" style="margin:12px 0"></div>`.s;
		d.showModal();
		draw();
	});
}

let coverEl = null;
function cover(title, text) {
	uncover();
	coverEl = document.createElement('div');
	coverEl.className = 'cover';
	coverEl.innerHTML = html`<div class="panel"><div class="spin"></div><b class="name">${title}</b><span class="mut"><span id="cover-text">${text}</span> <span id="cover-sec"></span></span></div>`.s;
	$('#app').append(coverEl);
}
function uncover() { coverEl?.remove(); coverEl = null; }

// after reboot / restart: wait until the box answers again, then reload
async function waitForBox(title, text, minDown = true) {
	cover(title, text);
	let wasDown = !minDown;
	const t0 = Date.now();
	for (;;) {
		await new Promise((r) => setTimeout(r, 3000));
		try {
			const r = await fetch('/ubus', { method: 'POST', body: '{"jsonrpc":"2.0","id":0,"method":"list","params":["session"]}' });
			if (r.ok && wasDown) { location.reload(); return; }
		} catch (e) { wasDown = true; }
		if (!wasDown && Date.now() - t0 > 90000) wasDown = true;  // reboot faster than our polling
		const s = Math.round((Date.now() - t0) / 1000);
		// the seconds apart from the text: the text stays translatable
		const el = $('#cover-sec');
		if (el) el.textContent = `(${s} s)`;
	}
}

