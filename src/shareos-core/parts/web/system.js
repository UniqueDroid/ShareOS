/* ---------- system sub pages ------------------------------------------------ */

const STEP_NAMES = ['Download', 'Verify', 'Ready', 'Write', 'Restart'];
// flashing sub-steps reported by shareos-update -> [place of the bar, label].
// The updater reports the step it is in, not a measured share: the page says
// "step 3 of 8" and the bar only shows how far down the list that is.
const FLASH_STEPS = {
	'check bundle': [5, 'Checking the package again'],
	'stage rootfs': [20, 'Preparing the system for the restart'],
	'erase ramdisk': [45, 'Boot system: erasing flash'],
	'write ramdisk': [50, 'Writing the boot system'],
	'verify ramdisk': [58, 'Checking the boot system'],
	'erase uImage': [64, 'Kernel: erasing flash'],
	'write uImage': [72, 'Writing the kernel'],
	'verify uImage': [88, 'Checking the kernel']
};
function stepIndex(state) {
	return { downloading: 0, verifying: 1, ready: 2, flashing: 3, flashed: 4 }[state] ?? -1;
}

const SYS = {
	firmware() {
		const i = S.info || {}, u = S.upd || {}, c = S.check;
		const cur = i.release?.version || u.current || '–';
		const latest = c?.releases?.[0];
		const busy = ['downloading', 'verifying', 'flashing'].includes(u.state);
		const si = stepIndex(u.state);
		const prog = u.state === 'downloading' && u.progress?.total ? pct(u.progress.bytes, u.progress.total) : null;
		const bootOk = i.boot === 'flash';
		return html`
		${(u.pending_reboot || u.state === 'flashed') && !busy ? html`<div class="banner">${svg(I.reboot)}<span style="flex:1;min-width:240px"><b>Reboot needed</b> – the new system is installed on the next start (about 1 minute, do not switch off the box).</span><button class="btn primary" type="button" data-act="reboot">Reboot now</button></div>` : ''}
		${u.last_upgrade ? html`<div class="banner" style="${u.last_upgrade.startsWith('ok') ? 'border-color:var(--dim)' : ''}">${svg(u.last_upgrade.startsWith('ok') ? I.ok : I.warn)}<span style="flex:1">Last update: <b>${u.last_upgrade.startsWith('ok') ? 'installed successfully (' + u.last_upgrade.slice(3) + ')' : u.last_upgrade}</b></span>${closeX('upd-ack')}</div>` : ''}
		${!bootOk && i.boot ? html`<div class="banner">${svg(I.warn)}<span>The box is not running from the flash right now (<b>${i.boot}</b>). Updates on this page only work after a normal start from the flash.</span></div>` : ''}
		<div class="split">
			<section class="main">
				<div class="panel">
					<div class="ph"><span class="pt">FIRMWARE UPDATE</span><span class="tag ml">Source: GitHub releases · ${c?.repo || 'UniqueDroid/ShareOS'}</span></div>
					<div class="ver">
						<div class="tile"><div class="k">Installed</div><div class="v">${cur}</div><div class="s">Kernel, initramfs and system</div></div>
						<span class="arrow" aria-hidden="true">→</span>
						<div class="tile"${c?.update_available ? raw(' style="border-color:color-mix(in srgb,var(--amber) 45%,transparent)"') : ''}>
							<div class="k">Latest · ${c ? (c.channel === 'beta' ? 'Beta' : 'Stable') : '–'}</div>
							<div class="v ${c?.update_available ? 'warn' : ''}">${latest ? latest.version : c ? 'none' : '?'}</div>
							<div class="s">${c ? (c.update_available ? 'Update available' : latest ? 'up to date' : 'no release for this device yet') : 'not checked yet'}</div></div>
					</div>
					${si >= 0 ? html`
						<div class="pt" style="margin:18px 0 8px">PROGRESS · ${u.release?.version || ''}</div>
						<div class="steps">${STEP_NAMES.map((n, k) => html`<div class="step ${k < si || u.state === 'flashed' ? 'done' : k === si ? 'act' : ''}"><div class="n">${k + 1}${k < si || (u.state === 'flashed' && k <= si) ? ' ✓' : k === si ? ' · RUNNING' : ''}</div>${n}</div>`)}</div>
						${prog != null ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:${prog.toFixed(0)}%"></i></div><p class="note">${fmtBytes(u.progress.bytes)} of ${fmtBytes(u.progress.total)}</p>` : ''}
						${u.state === 'verifying' ? html`<div class="bar big busy" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Checking the bundle …</b> SHA-256 and contents, takes about half a minute.</p>` : ''}
						${u.state === 'flashing' ? (() => { const [fp, fl] = FLASH_STEPS[u.step] || [2, 'Starting'], fn = Object.keys(FLASH_STEPS).indexOf(u.step) + 1; return html`<div class="bar big busy" style="margin-top:12px"><i style="width:${fp}%"></i></div><p class="note"><b>${fl} …</b> (step ${fn || 1} of ${Object.keys(FLASH_STEPS).length}) – <b>do not switch off</b>, this takes about 1–2 minutes.</p>`; })() : ''}
						${u.state === 'flashed' ? html`<div class="bar big" style="margin-top:12px"><i style="width:100%"></i></div><p class="note"><b>Installation finished</b> (100 %) – restart now.</p>` : ''}
						${u.state === 'ready' ? html`<div class="acts" style="margin-top:14px"><button class="btn primary" type="button" data-act="apply" data-tag="${u.release.tag}" data-ver="${u.release.version}" ${bootOk ? '' : 'disabled'}>Install ${svg(I.dl)}${u.release.version}</button><button class="btn ghost" type="button" data-act="cancel">Discard</button></div>
							<p class="note">${u.release.local ? (u.release.sha_checked ? 'Uploaded file – verified: SHA-256 of the .sha256 file, checksums of all parts, made for this device.' : 'Uploaded file – verified: checksums of all parts, made for this device (without .sha256 file).') : 'Verified: SHA-256, checksums of all parts, made for this device.'} Settings and packages are kept.</p>` : ''}`
					: ''}
					${u.state === 'error' ? html`<div class="banner" style="margin:16px 0 0">${svg(I.warn)}<span><b>Error:</b> ${u.error}</span><button class="btn sm ghost" type="button" data-act="cancel">OK</button></div>` : ''}
					<div class="fields" style="margin-top:18px">
						<label class="f"><span>UPDATE CHANNEL</span><select id="channel">
							<option value="stable"${(c?.channel || 'stable') === 'stable' ? raw(' selected') : ''}>Stable (releases)</option>
							<option value="beta"${c?.channel === 'beta' ? raw(' selected') : ''}>Beta (also pre-releases)</option></select></label>
					</div>
					<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="check" ${S.checking || busy ? 'disabled' : ''}>${S.checking ? 'Checking …' : 'Check now'}</button></div>
				</div>
				${c?.releases?.length ? html`<div>
					<h2 class="gh">VERSIONS <span>from GitHub</span></h2>
					<div class="tw"><table class="t" style="min-width:600px">
						<thead><tr><th>VERSION</th><th>DATE</th><th>CHANNEL</th><th>SIZE</th><th></th></tr></thead>
						<tbody>${(S.relAll ? c.releases : c.releases.slice(0, 3)).map((r) => html`<tr>
							<td><b>${r.version}</b></td><td>${fmtDate(r.date)}</td>
							<td><span class="tag">${r.prerelease ? 'BETA' : 'STABLE'}</span></td><td class="mut">${fmtBytes(r.size)}</td>
							<td>${r.version === cur ? html`<span class="tag ok">installed</span>`
								: html`<button class="btn sm${r.tag === latest?.tag ? '' : ' ghost'}" type="button" data-act="download" data-tag="${r.tag}" ${busy || !bootOk ? 'disabled' : ''}>Download</button>`}
								<a class="btn sm ghost" href="${r.url}" target="_blank" rel="noopener">Notes ↗</a></td></tr>`)}
						</tbody></table></div>
					${c.releases.length > 3 ? html`<div class="acts" style="margin-top:8px"><button class="btn sm ghost" type="button" data-act="rel-all">${S.relAll ? 'Show fewer' : `Show all (${c.releases.length})`}</button></div>` : ''}</div>` : ''}
				${latest?.notes ? html`<div class="panel"><div class="ph"><span class="pt">CHANGES IN ${latest.version}</span></div><pre class="notes">${latest.notes}</pre></div>` : ''}
			</section>
			<aside class="aside">
				<div class="panel">
					<div class="ph"><span class="pt">HOW AN UPDATE WORKS</span></div>
					<ol class="plan" style="padding-left:20px">
						<li>Download the bundle from GitHub and check it (SHA-256, device, sizes)</li>
						<li>Write kernel and initramfs to flash and read them back</li>
						<li>Stage the new system</li>
						<li>Reboot: the initramfs installs the system, then ShareOS starts again</li>
					</ol>
					<p class="note">Settings and installed packages are kept. If interrupted, the installation is repeated on the next boot.</p>
				</div>
				<form class="panel" id="f-bin" style="margin-top:16px">
					<div class="ph"><span class="pt">INSTALL FIRMWARE FILE</span><span class="tag ml">.tar · .bin</span></div>
					<p class="note" style="margin:0 0 10px"><b>Update without internet:</b> upload the .sysupgrade.tar of a ShareOS release, preferably with its .sha256 file. It is checked like an update from GitHub.</p>
					<p class="note" style="margin:0 0 10px">A firmware in D-Link format, e.g. for the <b>switch back to Alt-F</b>. Kernel and boot system are written; the ShareOS system and settings stay in flash.</p>
					<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>FILE</span><input type="file" name="file" accept=".tar,.bin" required></label>
						<label class="f"><span>CHECKSUM (.SHA256, OPTIONAL)</span><input type="file" name="sha" accept=".sha256,.txt"></label></div>
					<div id="bin-info"></div>
					<div class="acts" style="margin-top:12px"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${svg(I.ul)}Upload & check</button></div>
				</form>
			</aside>
		</div>`;
	},

	general() {
		const i = S.info || {};
		return html`<div class="acts" style="margin-bottom:16px"><button class="btn ghost" type="button" data-act="fr-again">Run first-time setup again</button></div>
		<h2 class="gh" style="margin-top:22px">BACK UP & RESTORE SETTINGS</h2>
		<div class="g2">
			<form class="panel" id="f-backup">
				<div class="ph"><span class="pt">BACK UP</span><span class="tag ml">JSON file</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>PASSWORD FOR ENCRYPTION (OPTIONAL)</span><input name="pw" type="password" minlength="6" autocomplete="new-password" placeholder="empty = not encrypted"></label></div>
				<div id="backup-keys">${backupKeys()}</div>
				<p class="note">Contains the box (network, name, time, drives, root password), users and groups (passwords as hashes), shares, the settings of the services and the list of installed apps. Without a password the file is readable – keep it safe. With a password: AES-256, the password is needed to restore.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">${svg(I.dl)}Download backup</button></div>
			</form>
			<form class="panel" id="f-restore">
				<div class="ph"><span class="pt">RESTORE</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>BACKUP FILE</span><input name="file" type="file" accept=".json,application/json" required></label>
					<label class="f"><span>PASSWORD (IF ENCRYPTED)</span><input name="pw" type="password" autocomplete="off"></label>
				</div>
				<div id="restore-preview"></div>
				<div class="acts" style="margin-top:12px"><button class="btn" type="submit">Verify</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">APP & WIDGETS</h2>
		<div class="g2">${appPanel()}${widgetPanel()}</div>
		<h2 class="gh" style="margin-top:22px">DEVICE & ACCESS</h2>
		<div class="g2">
			<form class="panel" id="f-host">
				<div class="ph"><span class="pt">DEVICE NAME</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>HOSTNAME</span><input name="hostname" value="${i.hostname || ''}" pattern="[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?" required></label></div>
				<p class="note">Letters, digits and hyphens. Applies at once; the DHCP server sees it on the next lease renewal.</p>
				<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
			</form>
			<form class="panel" id="f-pass">
				<div class="ph"><span class="pt">ACCESS · ${S.user}</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>NEW PASSWORD</span><input name="p1" type="password" minlength="8" autocomplete="new-password" required></label>
					<label class="f"><span>REPEAT</span><input name="p2" type="password" minlength="8" autocomplete="new-password" required></label>
				</div>
				<p class="note">Applies to the web interface and SSH. At least 8 characters.</p>
				<div class="acts" style="margin-top:14px"><button class="btn primary" type="submit">Change password</button></div>
			</form>
		</div>
		<h2 class="gh" style="margin-top:22px">ABOUT</h2>
		${SYS.about()}`;
	},

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

	time() {
		const t = S.time;
		if (!t) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const zones = S.zones || [t.timezone];
		const last = t.last_sync ? new Date(t.last_sync * 1000).toLocaleString(LOC, { timeZone: tzSafe(t.timezone), dateStyle: 'short', timeStyle: 'short' }) : null;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">TIME ON THE BOX</span><span class="tag ml">${t.timezone}</span></div>
				<div id="clock-now" class="name" style="font-size:30px;letter-spacing:.04em;margin:6px 0 2px">${boxTime(t)}</div>
				<div id="clock-date" class="mut" style="font-size:13px">${boxDate(t)}</div>
				<dl class="kv" style="margin-top:14px">
					<dt>Time sync</dt><dd>${t.ntp ? (t.ntp_running ? 'from the internet (NTP)' : html`<span style="color:var(--amber)">NTP switched on but not running</span>`) : 'by hand'}</dd>
					<dt>Last synced</dt><dd>${last || (t.ntp ? 'not yet' : '–')}</dd>
					${t.rtc ? html`<dt>Battery clock</dt><dd>${t.rtc_ok === false ? html`<span style="color:var(--amber)">could not be set at the last sync</span>` : 'is set after every sync'}</dd>` : ''}
				</dl>
				<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="time-sync">${svg(I.reboot)}Sync now</button></div>
			</div>
			<form class="panel" id="f-time">
				<div class="ph"><span class="pt">TIME ZONE & TIME SERVERS</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>TIME ZONE</span><select name="tz">${zones.map((z) => html`<option value="${z}"${z === t.timezone ? raw(' selected') : ''}>${z.replace(/_/g, ' ')}</option>`)}</select></label>
					<label class="chk"><input type="checkbox" name="ntp"${t.ntp ? raw(' checked') : ''}><span>Get the time from the internet automatically (NTP)</span></label>
					<label class="f"><span>TIME SERVERS (ONE PER LINE, AT MOST 5)</span><textarea name="servers" rows="4" spellcheck="false">${t.servers.join('\n')}</textarea></label>
				</div>
				<p class="note">In a home network the router can be the time server too, e.g. <code>fritz.box</code>. The time zone applies to logs, schedules and the display.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
			</form>
		</div>
		<form class="panel" id="f-clock" style="margin-top:16px">
			<div class="ph"><span class="pt">SET THE CLOCK BY HAND</span></div>
			<div class="fields">
				<label class="f"><span>DATE AND TIME (${t.timezone})</span><input name="dt" type="datetime-local" step="1" value="${localInput(t)}" required></label>
			</div>
			<p class="note">${t.ntp ? 'While NTP is on, the box sets the clock from the internet again at the next sync. For a box without internet, switch NTP off above.' : 'The clock keeps running from there; the box\'s battery clock is set too.'}</p>
			<div class="acts" style="margin-top:12px">
				<button class="btn ghost" type="button" data-act="time-browser">Take this device's time</button>
				<button class="btn primary" type="submit">Set time</button>
			</div>
		</form>`;
	},

	hardware() {
		const h = S.hw;
		if (!h) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const f = h.fan, l = h.led;
		// the temperatures of the presets come from the box (one list for the
		// fan control and this page)
		const pd = (id) => { const p = h.presets?.[id]; return !p ? '' : p.off_temp ? `Fan stops below ${p.off_temp} °C, full from ${p.full_temp} °C` : `Fan always on, full from ${p.full_temp} °C`; };
		const presets = [['quiet', 'Quiet', pd('quiet')], ['balanced', 'Balanced', pd('balanced')],
			['cool', 'Cool', pd('cool')], ['custom', 'Custom values', 'Set the temperatures yourself']];
		const sel = (id, cur, opts) => html`<select id="${id}">${opts.map(([v, t2]) => html`<option value="${v}"${cur === v ? raw(' selected') : ''}>${t2}</option>`)}</select>`;
		return html`<div class="g2">
			<form class="panel" id="f-fan">
				<div class="ph"><span class="pt">FAN</span><span class="tag ml" id="fan-now">${fanNow()}</span></div>
				<div style="display:grid;gap:8px">${presets.map(([id, name, d]) => html`
					<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px"><input type="radio" name="preset" value="${id}"${f.preset === id ? raw(' checked') : ''} style="accent-color:var(--accent);margin-top:3px">
						<span><b>${name}</b><br><span class="mut" style="font-size:12px">${d}</span></span></label>`)}</div>
				<div class="fields" id="fan-custom" style="margin-top:14px"${f.preset === 'custom' ? '' : raw(' hidden')}>
					<label class="f"><span>OFF BELOW (°C, 0 = NEVER)</span><input name="off_temp" type="number" min="0" max="65" value="${f.off_temp}"></label>
					<label class="f"><span>FULL FROM (°C)</span><input name="full_temp" type="number" min="35" max="70" value="${f.full_temp}"></label>
					<label class="f"><span>BACK TO HALF BELOW (°C)</span><input name="half_temp" type="number" min="30" max="69" value="${f.half_temp}"></label>
				</div>
				<p class="note">The box runs the fan in three steps (off, half, full) according to the board temperature. Changes apply within seconds.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">LEDS</span><span class="tag ml">applies at once</span></div>
				<div class="fields" style="grid-template-columns:1fr">
					<label class="f"><span>STATUS LED (BLUE)</span>${sel('led-status', l.status, [['heartbeat', 'Heartbeat (ShareOS running)'], ['on', 'on'], ['off', 'off']])}</label>
					<label class="f"><span>POWER LED</span>${sel('led-power', l.power, [['on', 'on'], ['blink', 'blinking'], ['off', 'off']])}</label>
					<label class="f"><span>DISK LEDS (RED)</span>${sel('led-disks', l.disks, [['off', 'off'], ['activity', 'Show disk access']])}</label>
				</div>
				<p class="note">The orange USB LED shows rescue mode and updates during boot and cannot be changed.</p>
			</div>
		</div>`;
	},

	https() {
		const w = S.web;
		if (!w) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const c = w.cert || {};
		const name = w.host || w.cert_host || '';
		const host = name || location.hostname;
		const viaOther = name && location.protocol === "https:" && location.hostname !== name;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">CONNECTION</span><span class="tag ml ${location.protocol === 'https:' ? 'ok' : 'warn'}">${location.protocol === 'https:' ? 'this page: HTTPS' : 'this page: HTTP'}</span></div>
				<div style="display:grid;gap:6px">
					<label class="chk"><input type="checkbox" id="opt-https"${w.https ? raw(' checked') : ''}>HTTPS on port 443</label>
					<label class="chk"><input type="checkbox" id="opt-redirect"${w.redirect ? raw(' checked') : ''}${w.https ? '' : raw(' disabled')}>Redirect HTTP requests to HTTPS</label>
				</div>
				<dl class="kv" style="margin-top:14px">
					<dt>HTTPS</dt><dd><a href="https://${host}/">https://${host}/</a></dd>
					<dt>HTTP</dt><dd><a href="http://${host}/">http://${host}/</a></dd>
				</dl>
				${viaOther ? html`<p class="note">This page is opened via ${location.hostname}. Without a certificate warning: <a href="${location.protocol}//${name}/#/system/network">${location.protocol}//${name}/</a></p>` : ''}
				<form id="f-webhost" style="margin-top:14px">
					<label class="f"><span>BOX NAME FOR LINKS (E.G. TO THE APPS)</span>
						<input name="host" value="${w.host || ''}" placeholder="${w.cert_host || location.hostname}" autocomplete="off" spellcheck="false"></label>
					<p class="note">Leave empty: with your own certificate the name is taken from it, otherwise the address this page was opened with. The name must resolve in your network (DNS).</p>
					<div class="acts" style="margin-top:8px"><button class="btn" type="submit">Save name</button></div>
				</form>
				<p class="note">After a change the web server restarts; the page is unreachable for a moment.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">CERTIFICATE</span>${c.none ? '' : c.selfsigned ? html`<span class="tag warn ml">self-signed</span>` : w.source === 'ca' ? html`<span class="tag ok ml">own CA</span>` : w.source === 'acme' ? html`<span class="tag ok ml">Let's Encrypt</span>` : html`<span class="tag ok ml">own certificate</span>`}</div>
				${c.none ? html`<p class="mut" style="margin:0;font-size:13px">No certificate yet – one is created automatically when HTTPS is switched on.</p>` : html`
				<dl class="kv">
					<dt>Issued to</dt><dd>${c.subject || '–'}</dd>
					<dt>Issuer</dt><dd>${c.issuer || '–'}</dd>
					<dt>Valid from</dt><dd>${c.from || '–'}</dd>
					<dt>Valid until</dt><dd>${c.until || '–'}</dd>
					<dt>Names</dt><dd>${(c.san || []).map((x) => x.replace(/^(dNSName|iPAddress):/, '')).join(', ') || '–'}</dd>
				</dl>`}
				${c.selfsigned ? html`<p class="note">Browsers warn once about self-signed certificates. The connection is encrypted anyway; for a page without a warning, upload your own certificate (e.g. from your intranet CA or Let's Encrypt).</p>` : ''}
				<div class="acts" style="margin-top:14px"><button class="btn" type="button" data-act="cert-self">New self-signed certificate</button></div>
			</div>
		</div>
		<form class="panel" id="f-cert" style="margin-top:16px">
			<div class="ph"><span class="pt">UPLOAD YOUR OWN CERTIFICATE</span></div>
			<div class="g2">
				<label class="f"><span>CERTIFICATE (PEM, INTERMEDIATES WELCOME)</span>
					<textarea name="cert" rows="8" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----" style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" data-i18n-skip></textarea>
					<input type="file" accept=".pem,.crt,.cer" data-target="cert" style="margin-top:6px"></label>
				<label class="f"><span>PRIVATE KEY (PEM, NO PASSWORD)</span>
					<textarea name="key" rows="8" spellcheck="false" placeholder="-----BEGIN PRIVATE KEY-----" style="width:100%;font:inherit;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px" data-i18n-skip></textarea>
					<input type="file" accept=".pem,.key" data-target="key" style="margin-top:6px"></label>
			</div>
			<p class="note">Before it is used, the box checks that certificate and key belong together. The key never leaves the box.</p>
			<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Use certificate</button></div>
		</form>`;
	},

	power() {
		return html`<h2 class="gh">POWER & RESET</h2><div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">POWER</span></div>
				<div class="acts"><button class="btn" type="button" data-act="reboot">${svg(I.reboot)}Restart</button>
					<button class="btn danger" type="button" data-act="poweroff">${svg(I.power)}Power off</button></div>
				<p class="note">Powering off shuts ShareOS down and the board control cuts the power. Switch on with the power button.</p>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">FACTORY RESET</span><span class="tag err ml">erases settings</span></div>
				<p class="mut" style="margin:0 0 12px;font-size:13px">Removes all settings and installed packages from flash and reboots. The system and firmware version stay. Afterwards the box has no password: press the USB button on its front, then choose a new one in the web interface.</p>
				<button class="btn danger" type="button" data-act="factory">Reset to factory settings</button>
			</div>
		</div>
		<h2 class="gh" style="margin-top:22px">SCHEDULE</h2>
		${powerSchedule()}
		<h2 class="gh" style="margin-top:22px">FAN & LEDS</h2>
		${SYS.hardware()}`;
	},

	network() {
		const n = S.net, i = S.info || {}, e = i.network?.eth0 || {};
		if (!n) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const st = n.proto === 'static';
		// prefill the static fields with what DHCP gave, so switching is easy
		const cur = e.ipv4 ? e.ipv4.address : '';
		const curMask = e.ipv4 ? prefixMask(e.ipv4.prefix) : '255.255.255.0';
		const v = (k, d) => (st ? n[k] : '') || d;
		return html`
		${n.pending ? html`<div class="banner">${svg(I.warn)}<span style="flex:1;min-width:240px"><b>New network settings are waiting for confirmation</b> – without confirmation the box returns to the old ones in ${n.pending.left} s.</span><button class="btn primary" type="button" data-act="net-confirm">Keep</button></div>` : ''}
		${n.result === 'rolledback' && !n.pending ? html`<div class="banner">${svg(I.warn)}<span style="flex:1">The last change was not confirmed; the previous network settings are active again.</span>${closeX('net-dismiss')}</div>` : ''}
		<h2 class="gh">NETWORK <span>eth0 · ${e.speed ? e.speed + ' Mbit/s' : 'no link'}</span></h2>
		<div class="g2">
			<form class="panel" id="f-net">
				<div class="ph"><span class="pt">IPV4</span><span class="tag ml">${st ? 'static' : 'DHCP'}</span></div>
				<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>ADDRESS</span><select name="proto" id="net-proto">
					<option value="dhcp"${st ? '' : raw(' selected')}>Automatic (DHCP) – from the router</option>
					<option value="static"${st ? raw(' selected') : ''}>Static address</option></select></label></div>
				<div class="fields" id="net-static" style="margin-top:14px"${st ? '' : raw(' hidden')}>
					<label class="f"><span>IP ADDRESS</span><input name="ipaddr" value="${v('ipaddr', cur)}" inputmode="decimal" placeholder="192.168.1.20"></label>
					<label class="f"><span>SUBNET MASK</span><input name="netmask" value="${v('netmask', curMask)}" inputmode="decimal" placeholder="255.255.255.0"></label>
					<label class="f"><span>GATEWAY</span><input name="gateway" value="${v('gateway', e.gateway || '')}" inputmode="decimal" placeholder="192.168.1.1"></label>
					<label class="f"><span>DNS SERVERS (COMMA-SEPARATED)</span><input name="dns" value="${st ? (n.dns || []).join(', ') : (e.dns || []).join(', ')}" inputmode="decimal" placeholder="192.168.1.1"></label>
				</div>
				<p class="note">The change takes effect at once. The box then waits ${n.timeout || 120} seconds for a confirmation from the new address – if none comes, it restores the previous settings. So you cannot lock yourself out.</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit" ${n.pending ? 'disabled' : ''}>Apply</button></div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">CURRENT</span><span class="tag ml ${e.ipv4 ? 'ok' : 'warn'}">${e.ipv4 ? 'connected' : 'no address'}</span></div>
				<dl class="kv">
					<dt>IPv4</dt><dd>${e.ipv4 ? `${e.ipv4.address} / ${e.ipv4.prefix}` : '–'}</dd>
					<dt>Gateway</dt><dd>${e.gateway || '–'}</dd>
					<dt>DNS</dt><dd>${(e.dns || []).join(', ') || '–'}</dd>
					<dt>MAC</dt><dd>${e.mac || '–'}</dd>
					<dt>Connection</dt><dd>${e.speed ? e.speed + ' Mbit/s' : '–'}</dd>
					<dt>Device name</dt><dd>${i.hostname || '–'} <a href="#/system/general" style="font-size:12px">change</a></dd>
				</dl>
			</div>
		</div>
		<h2 class="gh" style="margin-top:22px">HTTPS & CERTIFICATE</h2>
		${SYS.https()}
		<h2 class="gh" style="margin-top:22px">DYNDNS</h2>
		${SYS.ddns()}
		<h2 class="gh" style="margin-top:22px">OWN CERTIFICATES</h2>
		${SYS.ca()}`;
	},

	// dynamic DNS: a name on the internet for the box (shareos-ddns)
	ddns() {
		const d = S.ddns;
		if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const p = S.ddnsProv ?? d.provider ?? '', l = d.last;
		const ok = d.enabled && l?.ok, err = d.enabled && l && !l.ok;
		const opt = (v, t) => html`<option value="${v}"${p === v ? raw(' selected') : ''}>${t}</option>`;
		const hostPh = { duckdns: 'meinebox.duckdns.org', dynv6: 'meinebox.dynv6.net', cloudflare: 'nas.example.org', noip: 'meinebox.ddns.net', custom: 'nas.example.org' }[p] || 'meinebox.duckdns.org';
		return html`<div class="g2">
			<form class="panel" id="f-ddns">
				<div class="ph"><span class="pt">PROVIDER</span><span class="tag ml ${d.enabled ? 'ok' : ''}">${d.enabled ? 'active' : 'off'}</span></div>
				<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Update dynamic DNS</label>
				<div class="fields" style="grid-template-columns:1fr;margin-top:12px">
					<label class="f"><span>PROVIDER</span><select name="provider" id="ddns-prov">
						${opt('', '– choose –')}${opt('duckdns', 'DuckDNS')}${opt('dynv6', 'dynv6')}${opt('cloudflare', 'Cloudflare')}${opt('noip', 'No-IP')}${opt('custom', 'Own URL (dyndns2)')}</select></label>
					<label class="f"><span>NAME</span><input name="host" value="${d.host || ''}" placeholder="${hostPh}" autocomplete="off" spellcheck="false"></label>
					<label class="f"${p === 'noip' || p === 'custom' ? '' : raw(' hidden')}><span>USER</span><input name="user" value="${d.user || ''}" autocomplete="off" spellcheck="false"></label>
					<label class="f"><span>${p === 'cloudflare' ? 'API TOKEN (ZONE:READ, DNS:EDIT)' : p === 'noip' || p === 'custom' ? 'PASSWORD' : 'TOKEN'}</span>${d.token_set ? html`<input name="token" type="password" placeholder="saved – leave empty to keep it" autocomplete="new-password">` : html`<input name="token" type="password" autocomplete="new-password">`}</label>
					<label class="f"${p === 'custom' ? '' : raw(' hidden')}><span>UPDATE URL ({host} {ip} {ip6})</span><input name="url" value="${d.url || ''}" placeholder="https://dyndns.example.net/nic/update?hostname={host}&amp;myip={ip}" autocomplete="off" spellcheck="false"></label>
				</div>
				<div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
					<label class="chk"><input type="checkbox" name="ipv4"${d.ipv4 !== false ? raw(' checked') : ''}>IPv4</label>
					<label class="chk"><input type="checkbox" name="ipv6"${d.ipv6 ? raw(' checked') : ''}>IPv6</label>
				</div>
				<p class="note">The box reports its public address every 5 minutes when it has changed. Many connections (DS-Lite, fibre, mobile) have no IPv4 address of their own – then use IPv6. For access from outside, the router has to forward the port (or open it for IPv6).</p>
				<p class="note">To learn its public IPv4 address, the box asks api.ipify.org (ipv4.icanhazip.com if that does not answer).</p>
				<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Save</button>
					${d.enabled ? html`<button class="btn" type="button" data-act="ddns-now">Refresh now</button>` : ''}</div>
			</form>
			<div class="panel">
				<div class="ph"><span class="pt">HEALTH</span>${ok ? html`<span class="tag ok ml">up to date</span>` : err ? html`<span class="tag err ml">Error</span>` : ''}</div>
				${d.enabled && l ? html`<dl class="kv">
					<dt>Name</dt><dd>${l.host || d.host || '–'}</dd>
					<dt>IPv4</dt><dd>${l.ip4 || '–'}</dd>
					<dt>IPv6</dt><dd style="word-break:break-all">${l.ip6 || '–'}</dd>
					<dt>Last reported</dt><dd>${fmtTime(l.sent)}</dd>
					<dt>Last checked</dt><dd>${fmtTime(l.checked)}</dd>
				</dl>
				${err ? html`<p class="note" style="color:var(--red)">${l.error}</p>` : ''}`
				: html`<p class="mut" style="margin:0;font-size:13px">${d.enabled ? 'Not reported yet – coming shortly.' : 'Dynamic DNS is off.'}</p>`}
			</div>
		</div>`;
	},

	// own certificate authority and Let's Encrypt
	ca() {
		const c = S.ca, a = S.acme || {}, d = S.ddns || {};
		if (!c) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
		const leOk = d.enabled && (d.provider === 'duckdns' || d.provider === 'cloudflare') && d.host;
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">CERTIFICATE AUTHORITY (CA)</span>${c.web ? html`<span class="tag ok ml">this box uses it</span>` : ''}</div>
				${c.exists ? html`<dl class="kv">
					<dt>Name</dt><dd>${c.subject || '–'}</dd>
					<dt>Valid until</dt><dd>${c.until || '–'}</dd>
					<dt>Fingerprint</dt><dd style="word-break:break-all;font-size:11px">${c.fingerprint || '–'}</dd>
				</dl>
				<div class="acts" style="margin-top:14px">
					<button class="btn" type="button" data-act="ca-root">${svg(I.dl)}Root certificate</button>
					<button class="btn${c.web ? '' : ' primary'}" type="button" data-act="ca-web">${c.web ? 'Reissue the box certificate' : 'Use for this box'}</button>
				</div>
				<p class="note">Install the root certificate once on PC and phone as trusted (Windows: double-click → “Trusted Root Certification Authorities”, Android/iOS: Settings → Security). After that all certificates of this CA work without a warning – for the box and other devices in the home network.</p>`
				: html`<p class="mut" style="margin:0 0 12px;font-size:13px">An own certificate authority issues certificates for the box and other devices in the home network (e.g. <code>*.home.lan</code>). Its root certificate is installed once on the devices – after that there are no more certificate warnings.</p>
				<div class="acts"><button class="btn primary" type="button" data-act="ca-init">Create certificate authority</button></div>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">LET'S ENCRYPT</span>${a.active ? html`<span class="tag ok ml">active${a.staging ? ' (Test)' : ''}</span>` : ''}</div>
				${a.running ? html`<div class="empty" style="padding:8px 0"><div class="spin" style="margin:0"></div><span>Getting the certificate – this takes up to 3 minutes …</span></div>`
				: a.active ? html`<dl class="kv"><dt>Name</dt><dd>${a.name || '–'}</dd><dt>Valid until</dt><dd>${a.until || '–'}</dd></dl>
					<p class="note">Checked daily and renewed 30 days before it expires.</p>
					<div class="acts" style="margin-top:12px"><button class="btn" type="button" data-act="acme-off">Switch off</button></div>`
				: leOk ? html`<form id="f-acme">
					<p class="mut" style="margin:0 0 12px;font-size:13px">A certificate for <b>${d.provider === 'duckdns' && !/\.duckdns\.org$/.test(d.host) ? d.host + '.duckdns.org' : d.host}</b>, trusted by all browsers. The check runs through a DNS record at the dynamic DNS provider – no port has to be open.</p>
					<label class="f"><span>E-MAIL (OPTIONAL, FOR NOTICES FROM LET'S ENCRYPT)</span><input name="email" type="email" value="${a.email || ''}" autocomplete="off"></label>
					<label class="chk" style="margin-top:10px"><input type="checkbox" name="staging">Test mode (test CA, browsers warn)</label>
					<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Get certificate</button></div>
				</form>`
				: html`<p class="mut" style="margin:0;font-size:13px">Needs dynamic DNS with DuckDNS or Cloudflare (above).</p>`}
				${a.error && !a.running ? html`<p class="note" style="color:var(--red)">${a.error}</p>` : ''}
			</div>
		</div>
		${c.exists ? html`<form class="panel" id="f-ca-issue" style="margin-top:16px">
			<div class="ph"><span class="pt">CERTIFICATE FOR ANOTHER DEVICE</span></div>
			<div class="fields">
				<label class="f"><span>NAME</span><input name="name" placeholder="router" autocomplete="off" spellcheck="false" maxlength="63"></label>
				<label class="f"><span>HOST NAMES AND IP ADDRESSES (COMMA-SEPARATED)</span><input name="hosts" placeholder="router.home.lan, 192.168.1.1" autocomplete="off" spellcheck="false"></label>
			</div>
			<p class="note">Valid for 825 days. Wildcards such as <code>*.home.lan</code> are possible too. Download certificate and key and enter them in the device.</p>
			<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit">Issue</button></div>
			${c.certs?.length ? html`<div class="tw" style="margin-top:16px"><table class="t" style="min-width:560px"><thead><tr><th>NAME</th><th>HOST NAMES</th><th>VALID UNTIL</th><th></th></tr></thead><tbody>
				${c.certs.map((x) => html`<tr><td>${x.name}</td><td style="word-break:break-all">${x.hosts.join(', ')}</td><td>${x.until}</td>
					<td style="white-space:nowrap"><button class="btn sm ghost" type="button" data-act="ca-dl" data-id="${x.name}" data-kind="crt">Certificate</button><button class="btn sm ghost" type="button" data-act="ca-dl" data-id="${x.name}" data-kind="key">Key</button><button class="btn sm ghost" type="button" data-act="ca-del" data-id="${x.name}">Delete</button></td></tr>`)}
			</tbody></table></div>` : ''}
		</form>` : ''}`;
	},

	terminal() {
		const t = S.term;
		if (!S.sysapps) { S.sysapps = []; rpc('shareos.apps', 'installed', {}).then((r) => { S.sysapps = (r.apps || []).filter((a) => a.type === 'system'); if (S.sysapps.length && !S.term) renderMain(); }).catch(() => {}); }
		return html`<div class="panel">
			<div class="ph"><span class="pt">TERMINAL</span><span class="tag warn ml">root</span>
				${t ? html`<button class="btn sm ghost" type="button" data-act="term-window">In its own window ↗</button><button class="btn sm ghost" type="button" data-act="term-close">End</button>` : ''}</div>
			${t?.window ? html`<p class="mut" style="margin:0 0 12px">The terminal runs in its own window.</p>
				<div class="acts"><button class="btn" type="button" data-act="term-open">Show here</button></div>`
			: t ? html`<iframe class="termframe" src="${termUrl(t)}" title="Terminal" allow="clipboard-read; clipboard-write"></iframe>`
				: html`<p class="mut" style="margin:0 0 12px">A shell as <b>root</b> right on the box – for diagnosis and manual work (BusyBox, uci, logread, mdadm, smartctl …).</p>
				${sysApps().length ? html`<p class="mut" style="margin:0 0 12px"><span>From system apps:</span> ${sysApps().map((a, i) => html`${i ? ' · ' : ''}${sysCmds(a)}`)}</p>` : ''}
				<div class="acts"><button class="btn primary" type="button" data-act="term-open">Open terminal</button><button class="btn" type="button" data-act="term-window">In its own window ↗</button></div>`}
			<p class="note">The session is for one window and ends when it is closed – a window of its own gets a new session. Careful: commands as root take effect at once and without a trash.</p>
		</div>`;
	},

	logs() {
		return html`<div class="panel">
			<div class="ph"><span class="pt">LOG</span>
				<div class="acts ml"><select id="log-src" class="btn sm ghost" aria-label="Source">${[['system', 'System (syslog)'], ['kernel', 'Kernel (dmesg)'], ...(S.bootlogs || []).map((l) => ['boot:' + l.name, 'Start log ' + bootlogTime(l.name)])].map(([v, t]) => html`<option value="${v}"${S.logSrc === v ? raw(' selected') : ''}>${t}</option>`)}</select>
				<button class="btn sm" type="button" data-act="log">Refresh</button></div></div>
			<pre class="logbox" id="logbox">loading …</pre>
		</div>`;
	},

	appearance() {
		const names = ACCENT_NAMES;
		return html`<div class="lookcols"><div class="panel" style="max-width:560px">
			<div class="ph"><span class="pt">APPEARANCE</span><span class="tag ml">applies to everyone</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>LIGHT OR DARK</span><select id="opt-theme">
				${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Same as the operating system (automatic)']].map(([v, t]) => html`<option value="${v}"${S.theme === v ? raw(' selected') : ''}>${t}</option>`)}
			</select></label></div>
			<div class="pt" style="margin:14px 0 8px">ACCENT COLOUR</div>
			<div class="row">${Object.keys(names).map((c) => html`<button class="sw c-${c}${S.accent === c ? ' on' : ''}" type="button" data-act="accent" data-c="${c}" aria-label="Accent colour ${names[c]}" aria-pressed="${S.accent === c}" title="${names[c]}"><i></i></button>`)}</div>
			<p class="note">The logo and the browser icon take on the accent colour. The setting applies to everyone, including the login page.</p>
			<div style="display:grid;gap:6px;margin-top:14px">
				<label class="chk"><input type="checkbox" id="opt-scan"${S.scan ? raw(' checked') : ''}>Scanlines (this browser only)</label>
			</div>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">FAV APPS</span><span class="tag ml">just for you</span></div>
			<div style="display:grid;gap:6px">${favBarOpt()}</div>
			<p class="note">The star on an app tile makes it a favourite. The bar sits above “Status” in the overview and above the installed apps.</p>
		</div>
		${chipsPanel()}
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">LANGUAGE</span><span class="tag ml">applies to everyone</span></div>
			<div class="fields" style="grid-template-columns:1fr"><label class="f"><span>INTERFACE LANGUAGE</span><select id="opt-lang" data-i18n-skip>
				${(S.languages || [{ code: LANG, name: LANG }]).map((l) => html`<option value="${l.code}"${l.code === LANG ? raw(' selected') : ''}>${l.name}</option>`)}
			</select></label></div>
			<p class="note">More languages: one file in <code>/www/i18n/</code> – see docs/TRANSLATING.md.</p>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">AREAS</span><span class="tag ml">applies to everyone</span></div>
			<div style="display:grid;gap:6px">
				${[['apps', 'Apps (app store, web apps, app tasks)']].map(([k, t]) =>
					html`<label class="chk"><input type="checkbox" class="opt-area" data-area="${k}"${tabOn(k) ? raw(' checked') : ''}>${t}</label>`)}
			</div>
			<p class="note">Switched off: the tab disappears, also for users in “My ShareOS”, and the background work rests (apps web server and app tasks). Settings and data stay; switching on brings everything back.</p>
			<p class="note">Paperless, Cloud and the DNS filter are modules: their tab appears when they are installed under APPS and disappears when removed – settings and data stay.</p>
		</div>
		<div class="panel" style="max-width:560px;margin-top:16px">
			<div class="ph"><span class="pt">LOGO</span><span class="tag ml">applies to everyone</span></div>
			<label class="chk"><input type="checkbox" id="opt-logo"${S.logo ? raw(' checked') : ''}>Show the ShareOS logo (off: text only)</label>
			<div style="margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--bg)">${brand()}</div>
		</div></div>`;
	},

	about() {
		const i = S.info || {}, r = i.release || {};
		return html`<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">SHAREOS</span></div>
				<dl class="kv">
					<dt>Version</dt><dd>${r.version || '–'}</dd>
					<dt>Stage</dt><dd>${r.stage || '–'}</dd>
					<dt>Device</dt><dd>${i.board?.name || i.model || '–'}${i.board?.id && i.board.id !== 'unknown' && !i.board.tested ? html` <span class="tag warn" title="ShareOS has not been tested on real hardware of this model yet.">not tested yet</span>` : ''}</dd>
					<dt>Firmware name</dt><dd>${i.board?.fwname || r.fwname || '–'}</dd>
					<dt>Kernel</dt><dd>Linux ${i.kernel || '–'}</dd>
					<dt>Booted from</dt><dd>${i.boot || '–'}</dd>
				</dl>
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">PROJECT</span></div>
				<p class="mut" style="margin:0;font-size:13px;line-height:1.6">ShareOS is free firmware for D-Link NAS boxes, derived from Alt-F. Based on buildroot, Linux and BusyBox; operating model after OpenWrt (UCI, ubus, rpcd, ucode). Licence GPLv2.</p>
				<p class="note"><a href="https://github.com/UniqueDroid/ShareOS" target="_blank" rel="noopener">github.com/UniqueDroid/ShareOS ↗</a></p>
			</div>
		</div>`;
	}
};

