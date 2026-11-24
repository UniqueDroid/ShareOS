/* ---------- System: device info (hidden page #/deviceinfo) -------------------- */

// What a new model needs to be added to ShareOS: flash layout, CPU, LEDs,
// sensors, buttons, the U-Boot environment and the kernel log, as one text
// file. Not in the menu: the testers of a devtest image get the link from the
// overview (and from the issue); every admin can open #/deviceinfo.

const devtestBox = () => !!S.info?.board?.devtest;

// the banner of a devtest image on the overview
function devtestBanner() {
	if (!devtestBox()) return '';
	return html`<div class="banner" style="margin:0 0 16px">${svg(I.warn)}<span><b>Test image for a new model.</b> root keeps the password shareos – use the box only in your own network. Please send the device info: <a href="#/deviceinfo">Device info</a></span></div>`;
}

function deviceinfoFile() {
	const d = new Date(), p = (n) => String(n).padStart(2, '0');
	return `shareos-deviceinfo-${S.devinfo?.fwname || 'box'}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${S.devinfo?.full ? '-full' : ''}.txt`;
}

function loadDeviceinfo() {
	const full = !!S.devinfoFull;
	S.devinfo = { loading: true, full };
	renderMain();
	rpc('shareos.deviceinfo', 'get', { full }).then((r) => { S.devinfo = r; if (S.route.sub === 'deviceinfo') renderMain(); })
		.catch((e) => { S.devinfo = { error: e.message, full }; if (S.route.sub === 'deviceinfo') renderMain(); });
}

Object.assign(SYS, {
	deviceinfo() {
		const d = S.devinfo;
		return html`<section class="sec">
			<h2 class="gh">DEVICE INFO <span>hardware facts for adding a model</span></h2>
			<div class="panel">
				<p class="mut" style="margin:0 0 10px">Model, flash partitions, CPU, memory, LEDs, sensors, buttons, GPIOs, serial ports, network, the U-Boot environment and the kernel log of this box – everything a new model needs. Only read, nothing is changed. Attach the file to the issue of the model.</p>
				<label class="chk"><input type="checkbox" id="di-full"${S.devinfoFull ? raw(' checked') : ''}><span>Show MAC addresses and serial numbers (otherwise masked – keep them out of public issues)</span></label>
				<div class="acts" style="margin-top:10px">
					<button class="btn primary sm" type="button" data-act="di-download"${d?.text ? '' : raw(' disabled')}>Download</button>
					<button class="btn sm" type="button" data-act="di-copy"${d?.text ? '' : raw(' disabled')}>Copy</button>
					<button class="btn sm ghost" type="button" data-act="di-reload">Read again</button>
				</div>
			</div>
			${!d || d.loading ? html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Reading …</span></div></div>`
				: d.error ? html`<div class="banner">${svg(I.warn)}<span>${d.error}</span></div>`
				: html`<pre class="panel" style="white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:60vh;overflow:auto;margin:0">${d.text}</pre>`}
		</section>`;
	}
});

afterSystemPage('deviceinfo', () => {
	if (!S.devinfo || S.devinfo.full !== !!S.devinfoFull) loadDeviceinfo();
	$('#di-full')?.addEventListener('change', (e) => { S.devinfoFull = e.target.checked; loadDeviceinfo(); });
});

Object.assign(ACTIONS, {
	'di-reload'() { loadDeviceinfo(); },
	'di-download'() {
		if (!S.devinfo?.text) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([S.devinfo.text], { type: 'text/plain' }));
		a.download = deviceinfoFile();
		document.body.append(a); a.click(); a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	},
	async 'di-copy'() {
		try { await navigator.clipboard.writeText(S.devinfo?.text || ''); toast('Copied.'); }
		catch (e) { toast('Copying is not allowed here – use Download.', true); }
	}
});
