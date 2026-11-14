/* ---------- start ----------------------------------------------------------- */

// installable as an app (PWA) – browsers allow this only over HTTPS with a
// trusted certificate (or on localhost); plain http just skips it
if ('serviceWorker' in navigator && window.isSecureContext)
	navigator.serviceWorker.register('sw.js').catch(() => {});

(async function start() {
	LANG = await loadUiSettings();
	LOC = LOCALES[LANG] || LANG;
	document.documentElement.lang = LANG;
	document.documentElement.dir = RTL[LANG] ? 'rtl' : 'ltr';
	if (await i18nLoad(LANG)) i18nStart($('#app'));
	i18nLanguages().then((l) => { S.languages = l; });
	applyTheme();
	const m = location.hash.match(/^#confirm=([0-9a-f]{32})$/);
	if (m) {
		S.sid = m[1];
		store.set('sid', S.sid, false);
		history.replaceState(null, '', '#/system/network');
	}
	if (S.sid) {
		try {
			await rpc('session', 'access', { scope: 'ubus', object: 'shareos.ui', function: 'get' });
			try { S.me = await rpc('shareos.me', 'get'); }
			catch (e) {
				// a session from before accounts existed: only root could log in then
				if (e.code !== 'app') throw e;
				S.me = { name: S.user, role: S.user === 'root' ? 'admin' : 'user', unbound: true };
				if (S.user !== 'root') throw e;
			}
			enter();
			return;
		} catch (e) { S.sid = null; store.del('sid'); }
	}
	renderLogin();
})();
