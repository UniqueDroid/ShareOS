/* ---------- DNS filter (module "dnsfilter", AdGuard Home) ------------------------ */

async function loadDnsfilter() {
	clearTimeout(S.dfTimer);
	try {
		const d = await rpc('shareos.dnsfilter', 'status');
		d.filters = d.ready ? (await rpc('shareos.dnsfilter', 'filters')).filters : [];
		d.rewrites = d.ready ? (await rpc('shareos.dnsfilter', 'rewrites')).rewrites : [];
		S.df = d;
		if (!d.start_error && (d.starting || (d.enabled && !d.running && S.dfStarting))) S.dfTimer = setTimeout(loadDnsfilter, 3000);
		else S.dfStarting = false;
	} catch (e) { if (e.code !== 'auth') toast('DNS filter: ' + e.message, true); }
	if (S.route.tab === 'dnsfilter' && !document.activeElement?.matches('input,select,textarea')) renderMain();
}

function dnsfilterView() {
	const d = S.df;
	if (!d) return html`<div class="panel"><div class="empty"><div class="spin" style="margin:0"></div><span>Loading …</span></div></div>`;
	const host = location.hostname, num = (n) => (n ?? 0).toLocaleString(LOC);
	const starting = !d.ready && !d.start_error && (d.starting || S.dfStarting);
	const state = d.ready ? html`<span class="tag ok ml">running</span>` : starting ? html`<span class="tag warn ml">starting …</span>`
		: d.start_error ? html`<span class="tag err ml">Error</span>` : html`<span class="tag ml">off</span>`;
	return html`
	<section class="sec">
		<h2 class="gh">DNS FILTER <span>AdGuard Home${d.version ? ' ' + d.version : ''}</span></h2>
		${!d.drive ? html`<div class="panel" style="margin-bottom:12px"><div class="empty">${svg(I.warn)}<span>The DNS filter needs the apps drive (Storage → Drives).</span></div></div>` : ''}
		<div class="g2">
			<div class="panel">
				<div class="ph"><span class="pt">STATUS</span>${state}${d.ready && d.protection === false ? html`<span class="tag warn">filtering paused</span>` : ''}</div>
				${d.ready ? html`<div class="tiles" style="margin:0">
					<div class="tile"><div class="k">QUERIES</div><div class="v">${num(d.queries)}</div></div>
					<div class="tile"><div class="k">BLOCKED</div><div class="v">${num(d.blocked)}</div></div>
					<div class="tile"><div class="k">RULES</div><div class="v">${num(d.rules)}</div></div>
					<div class="tile"><div class="k">RAM</div><div class="v">${d.rss_mb != null ? Math.round(d.rss_mb) + ' MB' : '–'}</div></div></div>
					<p class="note"><span>Estimated need with these lists:</span> ~${d.estimate_mb} MB</p>
					${d.warn ? html`<p class="note" style="color:var(--amber)">Many rules: large lists cost a lot of memory. With the 256 MB of the box, better stay with the default list.</p>` : ''}`
				: starting ? html`<div class="empty" style="padding:8px 0"><div class="spin" style="margin:0"></div><span>AdGuard Home is starting and loading the block lists – this takes about a minute.</span></div>`
				: d.start_error ? html`<p class="mut" style="margin:0;font-size:13px"><span>Start failed:</span> <code data-i18n-skip>${d.start_error}</code></p>`
				: html`<p class="mut" style="margin:0;font-size:13px">Switch it on below.</p>`}
			</div>
			<div class="panel">
				<div class="ph"><span class="pt">HOW TO USE IT</span></div>
				<ol class="plan" style="padding-left:20px">
					<li><span>Enter the address of the box as DNS server in the router – or only on single devices:</span> <code>${S.info?.network?.eth0?.ipv4?.address || host}</code></li>
					<li>Do not enter a second DNS server, otherwise devices ask past the box. While the box is off or restarting, the devices have no DNS.</li>
					<li>Fine settings, query log and statistics in the interface of AdGuard Home.</li>
				</ol>
				<div class="acts">${d.ready ? html`<a class="btn" href="${d.https ? `https://${host}:${d.https_port}/` : `http://${host}:${d.web_port}/`}" target="_blank" rel="noopener">Open AdGuard Home ↗</a>` : ''}
					<button class="btn" type="button" data-act="df-pass">Show login</button></div>
				${d.ready ? html`<p class="note">${d.https_forced ? 'Encrypted (HTTPS) with the box\'s certificate; HTTP requests are redirected.'
					: d.https ? html`<span>Encrypted (HTTPS) with the box's self-signed certificate – the browser warns as with the interface. HTTP is only redirected once the box has a trusted certificate (own CA or Let's Encrypt under</span> <a href="#/system/network">System → Network</a>).`
					: 'Without a certificate of the box only unencrypted (HTTP).'}</p>` : ''}
				${d.ready && d.local?.names?.length ? html`<dl class="kv" style="margin-top:12px"><dt>Local names</dt><dd><code>${d.local.names.join(', ')}</code> → <code>${d.local.ip}</code></dd>
					${(d.local.domains || []).map((x) => html`<dt>Local domain</dt><dd><code>${x}</code> → <span>DNS server of the network</span></dd>`)}</dl>` : ''}
				${S.dfPass ? html`<dl class="kv" style="margin-top:12px"><dt>User</dt><dd><code>${S.dfPass.user}</code></dd><dt>Password</dt><dd><code>${S.dfPass.password}</code></dd></dl>` : ''}
			</div>
		</div>
	</section>
	<section class="sec"><form class="panel" id="f-df" style="max-width:820px">
		<div class="ph"><span class="pt">SETTINGS</span></div>
		<label class="chk"><input type="checkbox" name="enabled"${d.enabled ? raw(' checked') : ''}>Switch on the DNS filter (also starts after a restart)</label>
		${d.ready ? html`<label class="chk" style="margin-top:8px;display:flex"><input type="checkbox" name="protection"${d.protection !== false ? raw(' checked') : ''}>Filtering on (off = only forward)</label>
		<div class="fields" style="grid-template-columns:1fr;margin-top:12px">
			<label class="f"><span>UPSTREAM SERVERS (ONE PER LINE)</span><textarea name="upstream" rows="3">${(d.upstream || []).join('\n')}</textarea></label>
		</div>` : ''}
		<div class="fields" style="margin-top:12px">
			<label class="f"><span>PORT OF THE ADGUARD INTERFACE</span><input name="web_port" type="number" min="1024" max="65535" value="${d.web_port}"></label>
			<label class="f"><span>HTTPS PORT OF THE ADGUARD INTERFACE</span><input name="https_port" type="number" min="1024" max="65535" value="${d.https_port || d.web_port + 1}"></label>
		</div>
		<div class="acts" style="margin-top:12px"><button class="btn primary" type="submit"${starting ? raw(' disabled') : ''}>Save</button>
			${starting ? html`<span class="mut" style="font-size:12px">You can save again once it is running.</span>` : ''}</div>
	</form></section>
	${d.ready ? html`<section class="sec">
		<h2 class="gh">LOCAL ENTRIES <span>${d.rewrites.length}</span></h2>
		${d.rewrites.length ? html`<div class="tw"><table class="t" style="min-width:480px"><thead><tr><th>NAME</th><th>ADDRESS</th><th></th></tr></thead>
			<tbody>${d.rewrites.map((w) => html`<tr><td><code>${w.domain}</code></td><td><code>${w.answer}</code></td>
				<td><button class="btn sm ghost" type="button" data-act="df-rwdel" data-domain="${w.domain}" data-answer="${w.answer}">Remove</button></td></tr>`)}</tbody></table></div>` : ''}
		<form class="panel" id="f-dfrw" style="margin-top:12px;max-width:820px">
			<div class="fields"><label class="f"><span>NAME</span><input name="domain" maxlength="253" placeholder="printer.${d.local?.domains?.[0] || 'home.lan'}" autocapitalize="off" spellcheck="false"></label>
				<label class="f"><span>IP ADDRESS</span><input name="answer" maxlength="253" placeholder="192.168.1.50" autocapitalize="off" spellcheck="false"></label></div>
			<div class="acts" style="margin-top:12px"><button class="btn" type="submit">Add entry</button></div>
			<p class="note"><span>For devices with a fixed IP address that the router does not know.</span> <code>*.name</code> <span>applies to all names below it. ShareOS sets the box's own names itself.</span></p>
		</form>
	</section>
	<section class="sec">
		<h2 class="gh">BLOCK LISTS <span>${d.filters.length}</span></h2>
		<div class="tw"><table class="t" style="min-width:640px"><thead><tr><th>LIST</th><th>RULES</th><th>ACTIVE</th><th></th></tr></thead>
			<tbody>${d.filters.map((f) => html`<tr><td><b>${f.name}</b><div class="mut" style="font-size:12px;word-break:break-all">${f.url}</div></td>
				<td>${num(f.rules)}</td>
				<td><input type="checkbox" class="df-en" data-url="${f.url}"${f.enabled ? raw(' checked') : ''}></td>
				<td><button class="btn sm ghost" type="button" data-act="df-del" data-url="${f.url}">Remove</button></td></tr>`)}</tbody></table></div>
		<form class="panel" id="f-dfadd" style="margin-top:12px;max-width:820px">
			<div class="fields"><label class="f"><span>NAME</span><input name="name" maxlength="64"></label>
				<label class="f"><span>ADDRESS OF THE LIST</span><input name="url" inputmode="url" placeholder="https://…"></label></div>
			<div class="acts" style="margin-top:12px"><button class="btn" type="submit">Add list</button>
				<button class="btn" type="button" data-act="df-refresh">Update lists</button></div>
			<p class="note">Every rule costs memory (about 0.1 KB). From 300,000 rules on, ShareOS warns.</p>
		</form>
	</section>` : ''}`;
}

/* --- after the page is drawn: listeners, loading --- */

Object.assign(VIEWS_AFTER, {
	dnsfilter() {
		if (!S.df) { loadDnsfilter(); return; }
		$('#f-df')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, args = { enabled: f.enabled.checked, web_port: +f.web_port.value, https_port: +f.https_port.value };
			if (f.protection) args.protection = f.protection.checked;
			if (f.upstream) args.upstream = f.upstream.value.split('\n').map((x) => x.trim()).filter(Boolean);
			const b = $('button[type=submit]', f); b.disabled = true;
			try {
				const r = await rpc('shareos.dnsfilter', 'set', args);
				// switched on: show "starting …" at once, the status follows every 3 s
				if (args.enabled && !S.df.running) { S.dfStarting = true; S.df = { ...S.df, enabled: true, start_error: null }; renderMain(); }
				toast(r.ok && args.enabled && !S.df.running ? 'DNS filter is starting …' : 'Saved.'); loadDnsfilter();
			} catch (err) { b.disabled = false; toast('DNS filter: ' + err.message, true); }
		});
		$('#f-dfadd')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.dnsfilter', 'filter_add', { name: f.name.value.trim(), url: f.url.value.trim() }); toast('List added.'); loadDnsfilter(); }
			catch (err) { toast('List: ' + err.message, true); }
		});
		$('#f-dfrw')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.dnsfilter', 'rewrite_add', { domain: f.domain.value.trim(), answer: f.answer.value.trim() }); f.reset(); toast('Entry added.'); loadDnsfilter(); }
			catch (err) { toast('Entry: ' + err.message, true); }
		});
		document.querySelectorAll('.df-en').forEach((c) => c.addEventListener('change', async () => {
			try { await rpc('shareos.dnsfilter', 'filter_enable', { url: c.dataset.url, enabled: c.checked }); loadDnsfilter(); }
			catch (err) { toast('List: ' + err.message, true); }
		}));
	}
});

/* --- clicks (data-act) --- */

Object.assign(ACTIONS, {
	async 'df-pass'() { try { S.dfPass = S.dfPass ? null : await rpc('shareos.dnsfilter', 'password'); renderMain(); } catch (e) { toast(e.message, true); } },
	async 'df-refresh'() { try { await rpc('shareos.dnsfilter', 'refresh'); toast('Lists updated.'); loadDnsfilter(); } catch (e) { toast(e.message, true); } },
	async 'df-rwdel'(el) {
		if (!await confirmDlg('Remove entry?', el.dataset.domain + ' → ' + el.dataset.answer, 'Remove', true)) return;
		try { await rpc('shareos.dnsfilter', 'rewrite_remove', { domain: el.dataset.domain, answer: el.dataset.answer }); toast('Entry removed.'); loadDnsfilter(); } catch (e) { toast(e.message, true); }
	},
	async 'df-del'(el) {
		if (!await confirmDlg('Remove list?', el.dataset.url, 'Remove', true)) return;
		try { await rpc('shareos.dnsfilter', 'filter_remove', { url: el.dataset.url }); toast('List removed.'); loadDnsfilter(); } catch (e) { toast(e.message, true); }
	}
});
