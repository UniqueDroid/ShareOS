/* ---------- clicks, page changes, timers -------------------------------------- */

// System: what every sub page needs, then what the sub pages registered
VIEWS_AFTER.system = () => {
	const sub = S.route.sub;
	if (sub !== 'terminal') { if (S.term) S.term = null; S.sysapps = null; }
	for (const fn of SYS_AFTER[sub] || []) fn(sub);
};

document.addEventListener('click', (e) => {
	const el = e.target.closest('[data-act]');
	if (!el || el.disabled) return;
	const fn = ACTIONS[el.dataset.act];
	if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('change', (e) => {
	if (e.target.name === 'wiz-layout' && S.wiz) { wizardCollect(); renderMain(); }
	if (e.target.classList.contains('wiz-fs') && S.wiz) { wizardCollect(); renderMain(); }
});

// The page changed (classic: another address; desktop: another window came to
// the front): stop what only the page left behind needs, load what the new one
// shows. Edits in progress are dropped in the classic view only – in the
// desktop view the other window is still there (see pageClosed).
function pageChanged() {
	if (isUser()) {
		if (S.fb && S.utab === 'files') S.fb.roots = null;
		renderUserTabs(); renderUserMain();
		return;
	}
	const keep = !!S.desk;
	if (S.route.tab !== 'storage') { clearTimeout(S.stTimer); S.stTimer = null; S.stActive = false; }
	if (S.route.tab !== 'storage' || S.route.sub !== 'snapshots') { clearTimeout(S.snapTimer); if (S.snap && !keep) { S.snap.edit = null; S.snap.log = null; } }
	if (S.route.tab !== 'shares' && !keep) { S.shEdit = null; S.uEdit = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'dlna') clearTimeout(S.dlnaTimer);
	if (S.route.tab !== 'services' || S.route.sub !== 'printer') { clearTimeout(S.prnTimer); S.prnTimer = null; }
	if (S.route.tab !== 'services' || S.route.sub !== 'ups') { clearTimeout(S.upsTimer); S.upsTimer = null; }
	if (S.route.tab === 'services' && S.route.sub === 'torrent' && S.tremote) loadTremote();
	// the DNS filter may have been switched elsewhere (Services, another window): fresh state, not the form of the last visit
	if (S.route.tab === 'dnsfilter' && S.df) loadDnsfilter();
	if (S.fb && S.route.sub === 'files') S.fb.roots = null;   // volumes may have changed
	if (S.route.tab !== 'paperless') { if (!keep) { S.plEdit = null; S.plLog = null; } } else if (S.pl) loadPaperless();
	if (S.route.tab !== 'dnsfilter') { clearTimeout(S.dfTimer); if (!keep) S.dfPass = null; } else if (S.df) loadDnsfilter();
	if (S.route.tab !== 'cloud') { clearTimeout(S.cloudTimer); if (S.cloud?.scope === 'admin' && !keep) { S.cloud.remoteEdit = null; S.cloud.jobEdit = null; S.cloud.log = null; } }
	else if (S.cloud?.scope === 'admin') loadCloud('admin');
	else if (S.shares) loadShareData();
	renderTabs();
	renderMain();
}
// desktop view: the window of a page was closed – drop its edits in progress
function pageClosed(r) {
	if (r.tab === 'storage' && r.sub === 'snapshots' && S.snap) { S.snap.edit = null; S.snap.log = null; }
	if (r.tab === 'shares') { S.shEdit = null; S.uEdit = null; }
	if (r.tab === 'paperless') { S.plEdit = null; S.plLog = null; }
	if (r.tab === 'dnsfilter') S.dfPass = null;
	if (r.tab === 'cloud' && S.cloud?.scope === 'admin') { S.cloud.remoteEdit = null; S.cloud.jobEdit = null; S.cloud.log = null; }
}

window.addEventListener('hashchange', () => {
	if (!S.sid) return;
	// desktop view: an address opens (or brings forward) the window of that page
	if (S.desk) { if (typeof deskNav === 'function') deskNav(location.hash); return; }
	if (!mainEl()) return;
	if (isUser()) parseUserRoute(); else parseRoute();
	pageChanged();
	window.scrollTo(0, 0);
});

// clock in the header without waiting for the next poll: for admins the
// clock of the box (boxNow), for plain users – who get no box time – the
// browser's
setInterval(() => {
	const c = $('.clock');
	if (!c) return;
	const now = isUser() ? new Date() : boxNow();
	if (now) c.textContent = now.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
}, 10000);

// "My ShareOS": storage use, shares and open vaults change without the user
// doing anything (uploads from a PC, a vault that closes) – the data is read
// again every minute while that page is shown and nobody types in it
setInterval(async () => {
	if (!isUser() || !S.sid || S.utab !== 'me' || S.desk || document.hidden) return;
	if (document.querySelector('dialog[open]') || document.activeElement?.matches?.('input, select, textarea')) return;
	try { S.me = { ...S.me, ...(await rpc('shareos.me', 'get')) }; renderUserMain(); } catch (e) { /* the next round tries again */ }
}, 60000);

