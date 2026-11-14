/* ---------- System: Network, HTTPS, dynamic DNS, own CA ----------------------- */

/* ---------- network ------------------------------------------------------------- */

function prefixMask(p) {
	const n = p ? (0xffffffff << (32 - p)) >>> 0 : 0;
	return [24, 16, 8, 0].map((b) => (n >>> b) & 255).join('.');
}

async function loadNet() {
	try { S.net = await rpc('shareos.net', 'get'); } catch (e) { toast('Network: ' + e.message, true); }
	if (S.route.sub === 'network') renderMain();
	if (S.net?.pending) { clearTimeout(S.netTimer); S.netTimer = setTimeout(() => { S.net = null; loadNet(); }, 5000); }
}

// reaching the box after a network change is the confirmation
async function netAutoConfirm() {
	try {
		const n = await rpc('shareos.net', 'get');
		if (!n.pending) return;
		await rpc('shareos.net', 'confirm');
		toast('New network settings confirmed.');
		S.net = null;
	} catch (e) { }
}

async function netSubmit(e) {
	e.preventDefault();
	const f = e.target, proto = f.proto.value;
	const args = { proto, confirm: true };
	if (proto === 'static') {
		Object.assign(args, { ipaddr: f.ipaddr.value.trim(), netmask: f.netmask.value.trim(), gateway: f.gateway.value.trim(),
			dns: f.dns.value.split(/[\s,;]+/).filter(Boolean) });
	}
	const target = proto === 'static' ? args.ipaddr : null;
	const moves = target && target !== location.hostname;
	const t = S.net?.timeout || 120;
	const text = proto === 'dhcp'
		? `The box gets its address from the router. Afterwards it may be reachable under a different address (look it up in the router). If the change is not confirmed on the box within ${t} seconds, the previous settings apply again.`
		: moves ? `The box switches to ${target}. This page then opens the new address and confirms the change. If that does not work, the previous settings apply again after ${t} seconds.`
		: `The network settings are applied and confirmed by this page. If that does not work, the previous settings apply again after ${t} seconds.`;
	if (!await confirmDlg('Change the network?', text, 'Apply')) return;
	try { await rpc('shareos.net', 'set', args); } catch (err) { toast('Network: ' + err.message, true); return; }
	stopPolling();
	if (moves) {
		cover('Switching the network', `new address ${target}`);
		const url = `${location.protocol}//${target}${location.port ? ':' + location.port : ''}/#confirm=${S.sid}`;
		setTimeout(() => { location.href = url; }, 6000);
		return;
	}
	// same address (or DHCP): wait until this page reaches the box again, then confirm
	cover('Restarting the network', 'waiting for the box');
	const t0 = Date.now();
	await new Promise((r) => setTimeout(r, 5000));
	for (;;) {
		try {
			await rpc('shareos.net', 'confirm');
			uncover(); toast('New network settings confirmed.');
			S.net = null; startPolling(); renderMain();
			return;
		} catch (err) { }
		const sec = Math.round((Date.now() - t0) / 1000);
		const el = $('#cover-text');
		if (el) el.textContent = sec > t ? 'No connection – the box should have restored the old settings. Reload the page.'
			: `waiting for the box (${sec} s)${proto === 'dhcp' && sec > 20 ? ' – not reachable? Look up the new address in the router and sign in there.' : ''}`;
		await new Promise((r) => setTimeout(r, 3000));
	}
}

/* --- the pages --- */

Object.assign(SYS, {
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
	}
});

/* --- after the page is drawn: listeners, loading --- */

afterSystemPage('network', () => {
		if (!S.net) loadNet();
		$('#net-proto')?.addEventListener('change', (e) => { $('#net-static').hidden = e.target.value !== 'static'; });
		$('#f-net')?.addEventListener('submit', netSubmit);
});

afterSystemPage('network', (sub) => {
		if (!S.web) loadWeb();
		$('#ddns-prov')?.addEventListener('change', (e) => { S.ddnsProv = e.target.value; renderMain(); });
		$('#f-ddns')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			const v = { enabled: f.enabled.checked, provider: f.provider.value, host: f.host.value.trim(), token: f.token.value, user: f.user.value.trim(), url: f.url.value.trim(), ipv4: f.ipv4.checked, ipv6: f.ipv6.checked };
			if (v.enabled && (!v.provider || !v.host)) { toast('Please enter provider and name.', true); return; }
			try {
				const r = await rpc('shareos.web', 'ddns_set', v);
				S.ddnsProv = null;
				toast(r.pending ? 'Saved – the address is being reported.' : 'Saved.');
				await loadNetExtra(); renderMain();
				if (r.pending) setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 6000);
			} catch (err) { toast('DynDNS: ' + err.message, true); }
		});
		$('#f-ca-issue')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, hosts = f.hosts.value.split(/[\s,;]+/).filter(Boolean);
			if (!f.name.value.trim() || !hosts.length) { toast('Please enter name and host names.', true); return; }
			try { await rpc('shareos.web', 'ca_issue', { name: f.name.value.trim(), hosts }); toast('Certificate issued.'); await loadNetExtra(); renderMain(); }
			catch (err) { toast('Certificate: ' + err.message, true); }
		});
		$('#f-acme')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.web', 'acme_issue', { email: f.email.value.trim(), staging: f.staging.checked }); await loadNetExtra(); renderMain(); }
			catch (err) { toast('Let\'s Encrypt: ' + err.message, true); }
		});
		$('#opt-https')?.addEventListener('change', (e) => webSet({ https: e.target.checked }));
		$('#opt-redirect')?.addEventListener('change', (e) => webSet({ redirect: e.target.checked }));
		$('#f-webhost')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const h = e.target.host.value.trim();
			try {
				await rpc('shareos.web', 'set', { host: h });
				S.web.host = h; if (S.apps) S.apps.installed = null;
				toast('Name saved.'); renderMain();
			} catch (err) { toast('Name: ' + err.message, true); }
		});
		document.querySelectorAll('#f-cert input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
			const f = inp.files[0];
			if (f) $(`#f-cert textarea[name=${inp.dataset.target}]`).value = await f.text();
		}));
		$('#f-cert')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, btn = $('button[type=submit]', f);
			btn.disabled = true;
			try {
				const r = await rpc('shareos.web', 'install', { cert: f.cert.value.trim() + '\n', key: f.key.value.trim() + '\n' });
				S.web.cert = r.cert;
				f.reset();
				toast('Certificate installed.');
				afterWebRestart();
			} catch (err) { toast('Certificate: ' + err.message, true); btn.disabled = false; }
		});
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	async 'net-confirm'() {
		try { await rpc('shareos.net', 'confirm'); toast('New network settings confirmed.'); } catch (e) { toast(e.message, true); }
		S.net = null; loadNet();
	},
	async 'net-dismiss'() {
		try { await rpc('shareos.net', 'dismiss'); if (S.net) S.net.result = null; renderMain(); } catch (e) { toast(e.message, true); }
	},
	async 'ddns-now'() {
		try { await rpc('shareos.web', 'ddns_update'); toast('Reporting …'); setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 5000); }
		catch (e) { toast('DynDNS: ' + e.message, true); }
	},
	async 'ca-init'() {
		try { await rpc('shareos.web', 'ca_init'); toast('Certificate authority created.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},
	async 'ca-root'() {
		try { const r = await rpc('shareos.web', 'ca_pem', { kind: 'root' }); pemDownload(r.pem, 'shareos-ca.crt'); }
		catch (e) { toast('CA: ' + e.message, true); }
	},
	async 'ca-web'() {
		if (!await confirmDlg('Use a certificate of the own CA?', 'The box gets a certificate of its own CA for the device name, the .local name and the IP address; it replaces the current one. Without the root certificate installed, the browser keeps warning.', 'Use')) return;
		try { await rpc('shareos.web', 'ca_web'); toast('Certificate installed – the page reconnects.'); afterWebRestart(); }
		catch (e) { toast('CA: ' + e.message, true); }
	},
	async 'ca-dl'(el) {
		try { const r = await rpc('shareos.web', 'ca_pem', { name: el.dataset.id, kind: el.dataset.kind }); pemDownload(r.pem, el.dataset.id + (el.dataset.kind === 'key' ? '.key' : '.crt')); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},
	async 'ca-del'(el) {
		if (!await confirmDlg('Delete certificate?', `The certificate “${el.dataset.id}” and its key are deleted from the box. Devices that already use it keep their copy.`, 'Delete', true)) return;
		try { await rpc('shareos.web', 'ca_delete', { name: el.dataset.id }); toast('Deleted.'); await loadNetExtra(); renderMain(); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	},
	async 'acme-off'() {
		if (!await confirmDlg('Switch off Let\'s Encrypt?', 'The box then uses a self-signed certificate again.', 'Switch off')) return;
		try { await rpc('shareos.web', 'acme_off'); toast('Switched off – the page reconnects.'); await loadNetExtra(); afterWebRestart(); }
		catch (e) { toast('Let\'s Encrypt: ' + e.message, true); }
	},
	async 'cert-self'() {
		if (!await confirmDlg('New self-signed certificate?', 'A new certificate for the current name and IP is created and replaces the old one. Browsers will show a warning once again.', 'Create')) return;
		try { const r = await rpc('shareos.web', 'selfsigned'); S.web.cert = r.cert; toast('Certificate created.'); afterWebRestart(); }
		catch (e) { toast('Certificate: ' + e.message, true); }
	}
});
