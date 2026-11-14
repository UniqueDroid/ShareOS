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

