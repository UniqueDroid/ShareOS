/* ---------- System: Notifications, Logs --------------------------------------- */

/* --- the pages --- */

Object.assign(SYS, {
	notifications() {
		const n = S.notes, c = S.noteCfg;
		if (!n || !c) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const de = LANG === 'de', when = (t) => fmtTime(t);
		const LV = { error: ['err', 'ERROR'], warn: ['warn', 'WARNING'], info: ['', 'INFO'] };
		const lvSel = (name, v) => html`<select name="${name}">${[['info', 'everything (info, warning, error)'], ['warn', 'warnings and errors'], ['error', 'errors only']].map(([k, t]) => html`<option value="${k}"${(v || 'warn') === k ? raw(' selected') : ''}>${t}</option>`)}</select>`;
		return html`<div class="split">
			<section class="main">
				<h2 class="gh">MESSAGES <span>${n.unread} unread</span></h2>
				${n.items.length ? html`<div class="acts" style="margin:0 0 12px"><button class="btn sm" type="button" data-act="note-read" data-id="all" ${n.unread ? '' : 'disabled'}>Mark all as read</button>
					<button class="btn sm ghost" type="button" data-act="note-del" data-id="all">Delete all</button></div>
				<div class="notelist">${n.items.map((x) => html`<div class="panel note-item${x.read || x.resolved ? ' read' : ''}">
					<div class="ph" style="gap:8px"><span class="tag ${x.resolved ? 'ok' : LV[x.level]?.[0] || ''}">${x.resolved ? 'RESOLVED' : LV[x.level]?.[1] || x.level}</span>
						<b class="name" style="font-size:14px">${de ? x.title_de : x.title_en}</b>${x.count > 1 ? html`<span class="tag">${x.count}×</span>` : ''}
						<span class="ml mut" style="font-size:12px">${when(x.last)}</span></div>
					${(de ? x.text_de : x.text_en) ? html`<p class="mut" style="margin:6px 0 0;font-size:13px">${de ? x.text_de : x.text_en}</p>` : ''}
					<div class="acts" style="margin-top:10px">${x.read || x.resolved ? '' : html`<button class="btn sm" type="button" data-act="note-read" data-id="${x.id}">Read</button>`}
						<button class="btn sm ghost" type="button" data-act="note-del" data-id="${x.id}">Delete</button></div></div>`)}</div>`
				: html`<div class="panel"><div class="empty">${svg(I.ok)}<span>No messages.</span></div></div>`}
				<p class="note">Every 10 minutes the box checks RAID, volumes (mounted, how full), temperature, SMART values (read again every 6 hours; a sleeping disk is not woken up) and updates; failed cloud jobs, app tasks and storage jobs report at once. Repeated messages are counted and sent again at most once a day.</p>
			</section>
			<aside class="aside">
				<form class="panel" id="f-notify">
					<div class="ph"><span class="pt">E-MAIL</span></div>
					<label class="chk"><input type="checkbox" name="email"${c.email ? raw(' checked') : ''}><span>Send messages by e-mail</span></label>
					<div class="fields" style="grid-template-columns:1fr;margin-top:10px">
						<label class="f"><span>MAIL SERVER (SMTP)</span><input name="smtp_host" value="${c.smtp_host}" placeholder="smtp.example.org" autocomplete="off"></label>
						<label class="f"><span>ENCRYPTION</span><select name="smtp_tls">${[['starttls', 'STARTTLS (port 587)'], ['ssl', 'SSL/TLS (port 465)'], ['none', 'none (port 25)']].map(([k, t]) => html`<option value="${k}"${(c.smtp_tls || 'starttls') === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
						<label class="f"><span>PORT (EMPTY = DEFAULT)</span><input name="smtp_port" value="${c.smtp_port}" inputmode="numeric"></label>
						<label class="f"><span>USER</span><input name="smtp_user" value="${c.smtp_user}" autocomplete="off"></label>
						<label class="f"><span>PASSWORD</span><input name="smtp_pass" type="password" autocomplete="new-password" placeholder="${c.has_pass ? '•••••• (saved)' : ''}"></label>
						<label class="f"><span>SENDER</span><input name="mail_from" value="${c.mail_from}" placeholder="nas@example.org"></label>
						<label class="f"><span>RECIPIENTS (SEPARATE WITH COMMAS)</span><input name="mail_to" value="${c.mail_to}" placeholder="ich@example.org"></label>
						<label class="f"><span>SEND</span>${lvSel('email_level', c.email_level)}</label>
					</div>
					<div class="ph" style="margin-top:18px"><span class="pt">PUSH</span></div>
					<label class="chk"><input type="checkbox" name="push"${c.push ? raw(' checked') : ''}><span>Send messages to the phone</span></label>
					<div class="fields" style="grid-template-columns:1fr;margin-top:10px">
						<label class="f"><span>SERVICE</span><select name="push_type">${[['ntfy', 'ntfy'], ['gotify', 'Gotify'], ['telegram', 'Telegram (bot)'], ['webhook', 'Webhook (JSON)']].map(([k, t]) => html`<option value="${k}"${(c.push_type || 'ntfy') === k ? raw(' selected') : ''}>${t}</option>`)}</select></label>
						<label class="f" data-push="url"${c.push_type === 'telegram' ? raw(' hidden') : ''}><span>ADDRESS</span><input name="push_url" value="${c.push_url}" placeholder="https://ntfy.sh/my-nas-topic"></label>
						<label class="f"><span data-push="url"${c.push_type === 'telegram' ? raw(' hidden') : ''}>ACCESS TOKEN (OPTIONAL)</span><span data-push="tg"${c.push_type === 'telegram' ? '' : raw(' hidden')}>BOT TOKEN (FROM @BOTFATHER)</span><input name="push_token" type="password" autocomplete="new-password" placeholder="${c.has_token ? '•••••• (saved)' : ''}"></label>
						<label class="f" data-push="tg"${c.push_type === 'telegram' ? '' : raw(' hidden')}><span>CHAT ID</span><span class="row" style="display:flex;gap:6px"><input name="push_chat" value="${c.push_chat || ''}" placeholder="123456789" style="flex:1"><button class="btn sm ghost" type="button" data-act="tg-chats">Find chat ID</button></span></label>
						<label class="f"><span>SEND</span>${lvSel('push_level', c.push_level)}</label>
					</div>
					<p class="note">ntfy: address with topic, e.g. <code>https://ntfy.sh/my-nas-7f3k</code> (an own ntfy server works too), subscribe to the same topic in the ntfy app. Gotify: server address and app token.</p>
					<p class="note">Telegram: create a bot with @BotFather in Telegram (/newbot), enter the token here and save. Then send your bot a message (or add it to a group) and click “Find chat ID”.</p>
					<div class="ph" style="margin-top:18px"><span class="pt">LIMITS</span></div>
					<div class="fields">
						<label class="f"><span>TEMPERATURE FROM (°C)</span><input name="temp_max" type="number" min="40" max="70" value="${c.temp_max}"></label>
						<label class="f"><span>VOLUME FULL FROM (%)</span><input name="disk_full" type="number" min="50" max="99" value="${c.disk_full}"></label>
					</div>
					<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="note-test">Test message</button></div>
				</form>
			</aside>
		</div>`;
	},
	logs() {
		return html`<div class="panel">
			<div class="ph"><span class="pt">LOG</span>
				<div class="acts ml"><select id="log-src" class="btn sm ghost" aria-label="Source">${[['system', 'System (syslog)'], ['kernel', 'Kernel (dmesg)'], ...(S.bootlogs || []).map((l) => ['boot:' + l.name, 'Start log ' + bootlogTime(l.name)])].map(([v, t]) => html`<option value="${v}"${S.logSrc === v ? raw(' selected') : ''}>${t}</option>`)}</select>
				<button class="btn sm" type="button" data-act="log">Refresh</button></div></div>
			<pre class="logbox" id="logbox">loading …</pre>
		</div>`;
	}
});

/* --- after the page is drawn: listeners, loading --- */

afterSystemPage('logs', (sub) => {
		loadLog();
		$('#log-src')?.addEventListener('change', (e) => { S.logSrc = e.target.value; loadLog(); });
		// snapshots of the last starts (kept across a power cut)
		if (!S.bootlogs) rpc('shareos.system', 'bootlogs').then((r) => { S.bootlogs = r.logs || []; if (S.bootlogs.length && S.route.sub === 'logs') renderMain(); }).catch(() => { S.bootlogs = []; });
});

afterSystemPage('notifications', () => {
		if (!S.noteCfg) loadNoteCfg();
		if (!S.notes) loadNotes();
		$('#f-notify')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			const a = { email: f.email.checked, smtp_host: f.smtp_host.value.trim(), smtp_tls: f.smtp_tls.value, smtp_port: f.smtp_port.value.trim(),
				smtp_user: f.smtp_user.value.trim(), mail_from: f.mail_from.value.trim(), mail_to: f.mail_to.value.trim(), email_level: f.email_level.value,
				push: f.push.checked, push_type: f.push_type.value, push_url: f.push_url.value.trim(), push_chat: f.push_chat.value.trim(), push_level: f.push_level.value,
				temp_max: +f.temp_max.value, disk_full: +f.disk_full.value };
			if (f.smtp_pass.value) a.smtp_pass = f.smtp_pass.value;
			if (f.push_token.value) a.push_token = f.push_token.value;
			try { S.noteCfg = await rpc('shareos.notify', 'set', a); toast('Saved.'); renderMain(); }
			catch (err) { toast('Messages: ' + err.message, true); }
		});
		$('#f-notify select[name=push_type]')?.addEventListener('change', (e) => {
			const tg = e.target.value === 'telegram';
			document.querySelectorAll('#f-notify [data-push]').forEach((el) => { el.hidden = (el.dataset.push === 'tg') !== tg; });
		});
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	log() { loadLog(); }
});
