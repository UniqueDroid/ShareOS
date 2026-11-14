/* ---------- System: General, Appearance, Time, Power & hardware, Terminal ----- */

// --- time page helpers: show the box's clock in the box's time zone ---
function tzSafe(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch (e) { return 'UTC'; } }
function boxTime(t) { return new Date(t.now * 1000).toLocaleTimeString(LOC, { timeZone: tzSafe(t.timezone), hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function boxDate(t) { return new Date(t.now * 1000).toLocaleDateString(LOC, { timeZone: tzSafe(t.timezone), weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
// "YYYY-MM-DDTHH:MM:SS" as the wall clock in time zone tz
function localInput(t) {
	const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tzSafe(t.timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
		.formatToParts(new Date(t.now * 1000)).map((x) => [x.type, x.value]));
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
// wall clock in tz -> seconds since 1970 (two rounds settle daylight saving)
function fromLocalInput(v, tz) {
	const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/.exec(v || '');
	if (!m) return null;
	const want = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
	let guess = want;
	for (let k = 0; k < 2; k++) {
		const shown = localInput({ now: guess, timezone: tz }).match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)$/);
		guess += want - Date.UTC(+shown[1], shown[2] - 1, +shown[3], +shown[4], +shown[5], +shown[6]) / 1000;
	}
	return Math.round(guess);
}
function setTime(t) { S.time = t; S.timeOffset = t.now - Math.floor(Date.now() / 1000); }
async function loadNotes() {
	if (away()) return;
	try {
		const n = await rpc('shareos.notify', 'list');
		const was = S.notes?.unread;
		S.notes = n;
		if (was !== n.unread) renderHeader();
		if (S.route.tab === 'system' && S.route.sub === 'notifications' && !$('#f-notify :focus')) renderMain();
	} catch (e) { }
}

async function loadNoteCfg() {
	try { S.noteCfg = await rpc('shareos.notify', 'get'); } catch (e) { toast('Messages: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'notifications') renderMain();
}

async function loadTime() {
	try {
		const [t, z] = await Promise.all([rpc('shareos.time', 'get'), S.zones ? null : rpc('shareos.setup', 'zones')]);
		setTime(t); if (z) S.zones = z.zones;
	} catch (e) { toast('Time: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'time') renderMain();
}

// "now: 41 °C · half" of the fan panel: the values of the last tick (every 5 s)
function fanNow() {
	const i = S.info || S.hw || {};
	return `now: ${i.temperature != null ? (i.temperature / 1000).toFixed(0) + ' °C' : '–'} · ${fanTxt(i.fan_pwm)}`;
}
async function loadHw() {
	try { S.hw = await rpc('shareos.hw', 'get'); } catch (e) { toast('Hardware: ' + e.message, true); }
	if (S.route.sub === 'power') renderMain();
}

/* --- the pages --- */

Object.assign(SYS, {
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
});

/* --- after the page is drawn: listeners, loading --- */

afterSystemPage('time', () => {
		if (!S.time) loadTime();
		clearInterval(S.clockTimer);
		S.clockTimer = setInterval(() => {
			if (!$('#clock-now') || !S.time) { clearInterval(S.clockTimer); return; }
			const t = { ...S.time, now: Math.floor(Date.now() / 1000) + S.timeOffset };
			$('#clock-now').textContent = boxTime(t); $('#clock-date').textContent = boxDate(t);
		}, 1000);
		$('#f-time')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, servers = f.servers.value.split(/\s+/).map((x) => x.trim()).filter(Boolean);
			try { setTime(await rpc('shareos.time', 'set', { timezone: f.tz.value, ntp: f.ntp.checked, servers })); toast('Saved.'); renderMain(); }
			catch (err) { toast('Time: ' + err.message, true); }
		});
		$('#f-clock')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const sec = fromLocalInput(e.target.dt.value, S.time.timezone);
			if (sec == null) { toast('Invalid time.', true); return; }
			try { setTime(await rpc('shareos.time', 'set_clock', { time: sec })); toast('Time set.'); renderMain(); }
			catch (err) { toast('Time: ' + err.message, true); }
		});
});

afterSystemPage('power', (sub) => {
		if (!S.hw) loadHw();
		if (!S.pwr) rpc('shareos.system', 'power_schedule').then((r) => { S.pwr = r; if (S.route.sub === 'power') renderMain(); }).catch((e) => toast('Schedule: ' + e.message, true));
		$('#f-power')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, days = {};
			for (const [d] of PWR_DAYS) days[d] = { on: f['on_' + d]?.value || '', off: f['off_' + d].value || '' };
			try {
				S.pwr = await rpc('shareos.system', 'power_schedule_set', { enabled: f.enabled.checked, days });
				S.pwrEdit = false;
				if (S.pwr.arm_error) toast(`Schedule saved, but the wake-up alarm could not be set: ${S.pwr.arm_error}`, true);
				else toast(!S.pwr.enabled ? 'Schedule saved (switched off).' : S.pwr.next_on ? `Schedule saved – the box switches on on ${fmtPwr(S.pwr.next_on)}.` : 'Schedule saved – no switch-on planned.');
				renderMain();
			}
			catch (err) { toast('Schedule: ' + err.message, true); }
		});
		document.querySelectorAll('#f-fan input[name=preset]').forEach((r) => r.addEventListener('change', () => { $('#fan-custom').hidden = r.value !== 'custom'; }));
		$('#f-fan')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, preset = $('input[name=preset]:checked', f).value;
			try {
				const r = await rpc('shareos.hw', 'set_fan', { preset, off_temp: +f.off_temp.value, full_temp: +f.full_temp.value, half_temp: +f.half_temp.value });
				S.hw.fan = r.fan; toast('Fan saved.');
			} catch (err) { toast('Fan: ' + err.message, true); }
		});
		for (const k of ['status', 'power', 'disks'])
			$('#led-' + k)?.addEventListener('change', async (e) => {
				try { const r = await rpc('shareos.hw', 'set_led', { [k]: e.target.value }); S.hw.led = r.led; toast('LED saved.'); }
				catch (err) { toast('LED: ' + err.message, true); }
			});
});

afterSystemPage('general', () => {
		if (!S.widget) loadWidget();
		$('#app-install')?.addEventListener('click', async () => {
			const ev = S.installEvt; if (!ev) return;
			ev.prompt();
			try { await ev.userChoice; } catch (e) { }
			S.installEvt = null; renderMain();
		});
		$('#opt-widget')?.addEventListener('change', (e) => widgetSet({ enabled: e.target.checked }));
		$('#widget-renew')?.addEventListener('click', async () => {
			if (await confirmDlg('Create a new key?', 'The old address stops working – widgets need the new one.', 'Create', true)) widgetSet({ renew: true });
		});
		$('#widget-copy')?.addEventListener('click', () => copyText($('#widget-url').value));
		$('#f-host').addEventListener('submit', async (e) => {
			e.preventDefault();
			try {
				const r = await rpc('shareos.system', 'set_hostname', { hostname: e.target.hostname.value.trim() });
				toast(r.cert_renewed ? 'Hostname saved. The HTTPS certificate was reissued for the new name – the browser will ask once more.' : 'Hostname saved.');
				tick();
			}
			catch (err) { toast('Hostname: ' + err.message, true); }
		});
		if (!S.backupOffer) rpc('shareos.backup', 'offer').then((o) => {
			S.backupOffer = o;
			const k = $('#backup-keys');
			if (k) { k.innerHTML = backupKeys().s; for (const c of k.querySelectorAll('input')) c.disabled = !$('#f-backup').pw.value; }
		}).catch(() => {});
		$('#f-backup').pw.addEventListener('input', (e) => { for (const c of e.target.form.querySelectorAll('#backup-keys input')) c.disabled = !e.target.value; });
		$('#f-backup').addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, btn = $('button[type=submit]', f);
			btn.disabled = true;
			try {
				const r = await rpc('shareos.backup', 'export', { password: f.pw.value, certificate: !!f.cert?.checked && !!f.pw.value, ca: !!f.ca?.checked && !!f.pw.value });
				const a = document.createElement('a');
				a.href = URL.createObjectURL(new Blob([r.content], { type: 'application/json' }));
				a.download = r.filename;
				document.body.append(a); a.click(); a.remove();
				setTimeout(() => URL.revokeObjectURL(a.href), 5000);
				f.reset();
				toast(r.encrypted ? 'Encrypted backup downloaded.' : 'Backup downloaded.');
			} catch (err) { toast('Backup: ' + err.message, true); }
			btn.disabled = false;
		});
		$('#f-restore').addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, file = f.file.files[0];
			if (!file) return;
			const content = await file.text();
			const box = $('#restore-preview');
			try {
				const p = await rpc('shareos.backup', 'restore', { content, password: f.pw.value, apply: false });
				box.innerHTML = html`<dl class="kv" style="margin-top:12px">
					<dt>Device</dt><dd>${p.host || '–'}</dd>
					<dt>Created</dt><dd>${p.created ? new Date(p.created * 1000).toLocaleString(LOC) : '–'}</dd>
					<dt>ShareOS</dt><dd>${p.version || '–'}</dd>
					<dt>User accounts</dt><dd>${p.users.join(', ') || '–'}</dd>
					<dt>Groups</dt><dd>${(p.groups || []).join(', ') || '–'}</dd>
					<dt>Shares</dt><dd>${p.shares.join(', ') || '–'}</dd>
					<dt>Services</dt><dd>${(p.services || []).map((x) => REC_SERVICES[x] || x).join(', ') || '–'}</dd>
					<dt>Apps</dt><dd>${(p.apps || []).map((a) => a.name || a.id).join(', ') || '–'}</dd>
					<dt>Certificate</dt><dd>${p.certificate ? 'yes' : 'no'}</dd>
					<dt>Own CA</dt><dd>${p.ca ? 'yes' : 'no'}${p.ca && p.ca_certs?.length ? html` <span class="mut">(${p.ca_certs.length} issued certificates)</span>` : ''}</dd></dl>
					<p class="note" style="color:var(--amber)">Root password, network, device name, time zone, drives and the settings of the web interface are taken over right away. Then the box restarts and asks in recovery mode what else should come back. Data on the drives stays untouched.</p>
					<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="restore-apply">Restore</button></div>`.s;
				$('#restore-apply').addEventListener('click', async () => {
					if (!await confirmDlg('Restore settings?', 'Root password, network, name, time zone and drives come from the backup right away, then the box restarts. You choose the rest afterwards in recovery mode.', 'Restore and restart', true)) return;
					try {
						await rpc('shareos.backup', 'restore', { content, password: f.pw.value, apply: true });
						try { await rpc('shareos.system', 'reboot'); } catch (err) { }
						stopPolling();
						waitForBox('Rebooting', 'Then it continues in recovery mode');
					} catch (err) { toast('Restore: ' + err.message, true); }
				});
			} catch (err) {
				box.innerHTML = '';
				toast(err.message === 'password required' ? 'The backup is encrypted – please enter the password.' : 'Backup: ' + err.message, true);
			}
		});
		$('#f-pass').addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			if (f.p1.value !== f.p2.value) { toast('The passwords do not match.', true); return; }
			try { await rpc('shareos.system', 'set_password', { password: f.p1.value }); f.reset(); toast('Password changed.'); }
			catch (err) { toast('Password: ' + err.message, true); }
		});
});

afterSystemPage('appearance', () => {
		$('#opt-theme').addEventListener('change', (e) => { S.theme = e.target.value; applyTheme(); renderHeader(); renderMain(); saveLook({ theme: S.theme }); });
		$('#opt-lang').addEventListener('change', async (e) => {
			try {
				await rpc('shareos.ui', 'set', { lang: e.target.value });
				try { localStorage.setItem('shareos.lang', e.target.value); } catch (err) { }
				location.reload();
			} catch (err) { toast('Language: ' + err.message, true); }
		});
		$('#opt-logo').addEventListener('change', async (e) => {
			const on = e.target.checked;
			try {
				await rpc('shareos.ui', 'set', { logo: on });
				S.logo = on; store.set('logo', on ? '1' : '0'); renderHeader(); renderMain();
			} catch (err) { e.target.checked = !on; toast('Logo: ' + err.message, true); }
		});
		$('#opt-scan').addEventListener('change', (e) => { S.scan = e.target.checked; store.set('scan', S.scan ? '1' : '0'); applyTheme(); });
		document.querySelectorAll('.chip-show').forEach((c) => c.addEventListener('change', () => {
			const h = new Set(chipHidden());
			if (c.checked) h.delete(c.dataset.id); else h.add(c.dataset.id);
			store.set('chips.hidden', JSON.stringify([...h]));
			renderHeader();
		}));
		document.querySelectorAll('.opt-area').forEach((cb) => cb.addEventListener('change', async (e) => {
			const k = e.target.dataset.area, on = e.target.checked;
			try {
				const r = await rpc('shareos.ui', 'set', { areas: { [k]: on } });
				S.areas = r.areas; renderTabs(); if (S.desk && typeof deskAreas === 'function') deskAreas(); toast(on ? 'Area switched on.' : 'Area switched off.');
			} catch (err) { e.target.checked = !on; toast('Area: ' + err.message, true); }
		}));
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
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
	async 'time-sync'(el) {
		el.disabled = true;
		try { setTime(await rpc('shareos.time', 'sync')); toast('Time synced.'); renderMain(); }
		catch (e) { toast('Sync: ' + e.message, true); el.disabled = false; }
	},
	'time-browser'() {
		const f = $('#f-clock');
		if (f && S.time) f.dt.value = localInput({ now: Math.floor(Date.now() / 1000), timezone: S.time.timezone });
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
});
