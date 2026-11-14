/* ---------- update flow ----------------------------------------------------- */

async function checkUpdates(quiet = false) {
	S.checking = true;
	if (S.route.sub === 'firmware') renderMain();
	try {
		S.check = await rpc('shareos.update', 'check');
		if (!quiet) toast(S.check.update_available ? `Update ${S.check.latest} available.` : 'ShareOS is up to date.');
	} catch (e) {
		if (!quiet && e.code !== 'auth') toast('Check failed: ' + e.message, true);
	}
	S.checking = false;
	renderHeader();
	if (S.route.tab === 'system' && S.route.sub === 'firmware') renderMain();
}

async function refreshUpdateStatus() {
	clearTimeout(S.updTimer);
	try {
		const prev = S.upd?.state;
		S.upd = await rpc('shareos.update', 'status');
		// the updater runs as its own process: right after a click its status can
		// still say 'ready'/'idle' for a moment – keep showing what was started
		const pend = S.updPending;
		if (pend && Date.now() < pend.until && ['ready', 'idle'].includes(S.upd.state)) S.upd = { ...S.upd, state: pend.state, step: '' };
		else S.updPending = null;
		// the box checks GitHub every 6 hours by itself; show what it found
		const had = S.check?.update_available ? S.check.latest : null;
		if (S.upd.check && (!S.check || S.upd.check.time >= (S.check.time || 0))) S.check = { ...S.upd.check, current: S.upd.current };
		if ((S.check?.update_available ? S.check.latest : null) !== had) renderHeader();
		// no result yet (fresh start) or an old one: ask now (GitHub allows 60 anonymous API calls per hour)
		// – in the background on the box (the result arrives with a later status), and
		// not again within an hour after a check that failed (no internet)
		const nowS = Date.now() / 1000;
		if (!S.checking && !S.autoChecked && (!S.upd.check || nowS - S.upd.check.time > 6 * 3600) && !(S.upd.check_failed && nowS - S.upd.check_failed.time < 3600)) {
			S.autoChecked = true;
			rpc('shareos.update', 'check_auto').then(() => { clearTimeout(S.updTimer); S.updTimer = setTimeout(refreshUpdateStatus, 8000); }).catch(() => { });
		}
		// keep the page while a .bin is being checked/written below
		if (S.route.tab === 'system' && S.route.sub === 'firmware' && !document.activeElement?.matches('select') && !$('#bin-info:not(:empty)') && !$('#f-bin input')?.files?.length) renderMain();
		if (prev && prev !== S.upd.state && S.upd.state === 'ready') toast('Update downloaded and verified.');
		if (prev && prev !== S.upd.state && S.upd.state === 'flashed') toast('Update written – please reboot.');
		const busy = ['downloading', 'verifying', 'flashing'].includes(S.upd.state);
		S.updTimer = setTimeout(refreshUpdateStatus, busy || S.updPending ? 1000 : 30000);
	} catch (e) {
		if (e.code !== 'auth') S.updTimer = setTimeout(refreshUpdateStatus, 10000);
	}
}

