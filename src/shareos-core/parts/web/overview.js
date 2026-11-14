/* ---------- views ----------------------------------------------------------- */

function mrow(label, p, value, cls = '') {
	return html`<div class="mrow"><span class="kk">${label}</span><div class="bar"><i class="${cls}" style="width:${p.toFixed(0)}%"></i></div><span class="vv">${value}</span></div>`;
}

function spark() {
	const n = 120, rx = S.rxHist, tx = S.txHist;
	if (rx.length < 2) return html`<div class="spark" style="display:grid;place-items:center;font-size:12px;color:var(--muted)">collecting samples …</div>`;
	const max = Math.max(1024, ...rx, ...tx);
	const pts = (arr) => arr.map((v, k) => `${((k + n - arr.length) / (n - 1) * 300).toFixed(1)},${(68 - (v / max) * 62).toFixed(1)}`).join(' ');
	const first = ((n - rx.length) / (n - 1) * 300).toFixed(1);
	return raw(`<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Network traffic of the last 10 minutes">
		<polyline style="fill:rgba(var(--rgb),.12);stroke:none" points="${first},70 ${pts(rx)} 300,70"></polyline>
		<polyline style="fill:none;stroke:var(--accent);stroke-width:1.5" points="${pts(rx)}"></polyline>
		<polyline style="fill:none;stroke:var(--amber);stroke-width:1.5" points="${pts(tx)}"></polyline></svg>`);
}

function statusTiles(rows, table) {
	if (table) return html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>METRIC</th><th>VALUE</th><th>NOTE</th></tr></thead>
		<tbody>${rows.map(([k, v, n]) => html`<tr><td>${k}</td><td><b>${v}</b></td><td class="mut">${n}</td></tr>`)}</tbody></table></div>`;
	return html`<div class="tiles">${rows.map(([k, v, n]) => html`<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${n}</div></div>`)}</div>`;
}

// internal disks in standby (hdparm -C, read at most once a minute by the box,
// #154): dimmed dot and ASLEEP; USB disks have no sleep state here
const usbDisk = (d) => d.usb || d.removable;
const asleep = (d) => html`${d.standby ? html` <span class="tag" title="Checked once a minute">ASLEEP</span>` : ''}${d.smart && d.smart !== 'good' ? html` <span class="tag ${SMART_RATING[d.smart][0]}">${SMART_RATING[d.smart][1]}</span>` : ''}`;
// dot of a disk: red/amber by the SMART values read last, green only with
// good values and awake; dimmed when asleep or when nothing is known (no
// SMART values yet, USB disk, sleep state not readable)
const diskDot = (d) => (d.smart === 'bad' ? ' down' : d.smart === 'warn' ? ' warn' : d.smart === 'good' && d.standby === false ? ' up' : '');
function diskCards(i, table = false) {
	const disks = i.disks || [];
	if (!disks.length)
		return html`<div class="panel"><div class="empty">${svg(I.info)}<span>No hard disk or USB storage detected. ShareOS runs entirely from the internal flash – drives appear here as soon as they are attached.</span></div></div>`;
	if (table) return html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>DRIVE</th><th>TYPE</th><th>MODEL</th><th>SIZE</th></tr></thead>
		<tbody>${disks.map((d) => html`<tr><td><b>${d.name}</b> <span class="mut">/dev/${d.name}</span>${asleep(d)}</td><td>${usbDisk(d) ? 'USB' : 'Disk'}</td><td>${d.model || 'unknown model'}</td><td>${fmtBytes(d.size)}</td></tr>`)}</tbody></table></div>`;
	return html`<div class="grid">${disks.map((d) => html`
		<div class="card">
			<div class="icon">${svg(usbDisk(d) ? I.usb : I.disk)}<span class="dot${diskDot(d)}"></span></div>
			<div class="info"><div class="name">${usbDisk(d) ? 'USB' : 'Disk'} · ${d.name}${asleep(d)}</div>
				<div class="desc">${d.model || 'unknown model'} · ${fmtBytes(d.size)}</div>
				<div class="ip">/dev/${d.name}</div></div>
		</div>`)}</div>`;
}

// The fan has no speed sensor: what is shown is the setting the box asked for
// (pwm1: 0 = off, 1–127 = half, 128–255 = full, as dns320l-daemon and gpio-fan
// apply it).
const fanTxt = (pwm) => (pwm == null ? '–' : pwm === 0 ? 'off' : pwm < 128 ? 'half' : 'full');
// warn colour of the temperature bar: the default limit of the messages (temp_max)
const TEMP_WARN = 55;
// is the fan control at work? (rpcd board_control: shareos-board and, on boxes
// with an MCU, dns320l-daemon run and a fresh temperature is there)
function boardTag(bc) {
	if (!bc || !bc.control) return html`<span class="tag ml">no board control</span>`;
	return bc.running && bc.sensor ? html`<span class="tag ml ok">board control active</span>`
		: html`<span class="tag ml err" title="${bc.running ? 'No temperature reading – the fan runs at full speed.' : 'The fan control of the box is not running.'}">board control not running</span>`;
}

const fsLabel = { '/overlay': 'Settings & packages', '/rom': 'System (read-only)', '/tmp': 'RAM (tmp)' };

const VIEWS = {
	overview() {
		const i = S.info;
		if (!i) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading system data …</span></div></div>`;
		const m = i.memory || {}, used = (m.memtotal || 0) - (m.memavailable || 0);
		const t = i.temperature != null ? i.temperature / 1000 : null;
		const ov = (i.filesystems || []).find((f) => f.mount === '/overlay');
		const e = i.network?.eth0 || {};
		const bootTxt = { flash: 'Flash (UBI)', netroot: 'Network (RAM)', ram: 'RAM' }[i.boot] || i.boot;
		const svcUp = S.services ? S.services.filter((x) => x.running).length : null;
		return html`
		<section class="sec" data-part="load">
			<h2 class="gh">SYSTEM <span>live · every 5 s</span></h2>
			<div class="g2">
				<div class="panel">
					<div class="ph"><span class="pt">LOAD</span>${boardTag(i.board_control)}</div>
					<div class="mbars">
						${mrow('CPU', S.cpu ?? 0, S.cpu == null ? '…' : S.cpu.toFixed(0) + ' %')}
						${mrow('RAM', pct(used, m.memtotal), fmtBytes(used, 0))}
						${mrow('TEMP', t == null ? 0 : pct(t, 65), t == null ? '–' : t.toFixed(0) + ' °C', t >= TEMP_WARN ? 'warn' : '')}
						${mrow('FAN', i.fan_pwm == null ? 0 : pct(i.fan_pwm, 255), fanTxt(i.fan_pwm))}
						${ov ? mrow('FLASH', pct(ov.used, ov.size), fmtBytes(ov.used, 0)) : ''}
					</div>
					<p class="note">${i.model ? i.model + ' · ' : ''}Linux ${i.kernel} · Load ${(i.load || []).map((x) => x.toFixed(2)).join(' ')}</p>
				</div>
				<div class="panel">
					<div class="ph"><span class="pt">NETWORK · eth0</span><span class="tag ml">${e.speed ? e.speed + ' Mbit/s' : 'no link'}</span></div>
					${spark()}
					<div class="rates"><span class="rx">↓ <b>${fmtRate(S.rxRate)}</b> rx</span><span class="mut">last 10 min</span><span class="tx">↑ <b>${fmtRate(S.txRate)}</b> tx</span></div>
					<dl class="kv" style="margin-top:14px">
						<dt>IPv4</dt><dd>${e.ipv4 ? `${e.ipv4.address} / ${e.ipv4.prefix}` : '–'}</dd>
						<dt>Gateway · DNS</dt><dd>${e.gateway || '–'} · ${(e.dns || []).join(', ') || '–'}</dd>
						<dt>MAC</dt><dd>${e.mac || '–'}</dd>
					</dl>
				</div>
			</div>
		</section>
		${favBar(S.apps?.installed?.apps || [])}
		<section class="sec" data-part="status">
			${secHead('status', 'STATUS')}
			${statusTiles([
				['Firmware', i.release?.version || '–', S.check?.update_available ? 'Update ' + S.check.latest + ' available' : S.check?.channel ? 'Channel ' + S.check.channel : 'not checked yet'],
				['Booted from', bootTxt, i.boot === 'flash' ? 'Settings are kept' : 'Changes are lost on reboot'],
				['Uptime', fmtUptime(i.uptime), 'since the last boot'],
				['Services', svcUp == null ? '…' : `${svcUp} / ${S.services.length}`, 'running'],
				['Flash free', ov ? fmtBytes(ov.avail, 0) : '–', 'for settings & packages'],
				['Drives', String((i.disks || []).length), (i.disks || []).length ? 'detected' : 'none attached']
			], isTable('status'))}
		</section>
		<section class="sec" data-part="disks">
			${secHead('disks', 'DRIVES', `${(i.disks || []).length} detected`)}
			${diskCards(i, isTable('disks'))}
		</section>
		<section class="sec" data-part="services">
			${secHead('services', 'SERVICES', html`<a href="#/services">manage all</a>`)}
			${serviceCards(false, isTable('services'))}
		</section>`;
	},

	storage() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Storage">${STO_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/storage/${id}">${label}</a>`)}</nav>
		${sub === 'snapshots' ? snapshotsView() : sub === 'health' ? healthView() : storageView()}`;
	},

	shares() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Shares">${SHR_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/shares/${id}">${label}</a>`)}</nav>
		${sub === 'files' ? html`${filesView()}<div id="fb-trashset">${trashSettings()}</div>` : !S.shares || !S.acc || !S.vols ? html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`
			: sub === 'users' ? usersView() : sub === 'groups' ? groupsView() : sharesView()}`;
	},
	apps: () => appsView(),
	cloud: () => cloudSection('admin'),
	paperless: () => paperlessView(),
	dnsfilter: () => dnsfilterView(),

	services() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="Services">${SVC_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/services/${id}">${label}</a>`)}</nav>
		${sub === 'dlna' ? dlnaView() : sub === 'printer' ? printerView() : sub === 'ups' ? upsView() : sub === 'torrent' ? tremoteView() : sub === 'autostart' ? autostartView()
			: html`<section class="sec">${secHead('services', 'SERVICES', 'start, stop, restart')}${serviceCards(true, isTable('services'))}</section>`}`;
	},

	system() {
		const sub = S.route.sub;
		return html`
		<nav class="subtabs" aria-label="System">${SYS_SUBS.map(([id, label]) => html`<a class="st${sub === id ? ' on' : ''}" href="#/system/${id}">${label}</a>`)}</nav>
		${(SYS[sub] || SYS.general)()}`;
	}
};

/* --- after the page is drawn: listeners, loading --- */

Object.assign(VIEWS_AFTER, {
	overview() {
		loadServicesFresh();
		// the FAV APPS bar needs the installed apps (asked once)
		if (tabOn('apps') && !S.apps?.installed && !S.apps?.tried) { S.apps = { ...S.apps, tried: true }; loadApps(['installed']); }
	}
});
