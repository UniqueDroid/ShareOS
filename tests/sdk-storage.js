// Checks that the app SDK keeps the browser storage of accounts apart
// (localStorage and IndexedDB), in Chromium with Playwright.
//
//   node tests/sdk-storage.js            (needs playwright and python3)
//
// Serves www-apps/_shareos and a small test app from a temporary folder.
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const TOP = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sos-sdk-'));
fs.symlinkSync(path.join(TOP, 'src/shareos-core/www-apps/_shareos'), path.join(dir, '_shareos'));
fs.mkdirSync(path.join(dir, 'probe'));
fs.writeFileSync(path.join(dir, 'probe/index.html'),
	'<!doctype html><script src="/_shareos/app.js"></script><title>probe</title>');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name); ok ? pass++ : fail++; }

(async () => {
	await new Promise((r) => setTimeout(r, 800));
	const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
	const ctx = await b.newContext();
	const open = async (q) => { const p = await ctx.newPage(); await p.goto(`http://127.0.0.1:${PORT}/probe/index.html${q}`); return p; };
	const idbPut = (p, v) => p.evaluate((v) => new Promise((ok, no) => {
		const r = indexedDB.open('notes', 1);
		r.onupgradeneeded = () => r.result.createObjectStore('kv');
		r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, 'text'); tx.oncomplete = () => { r.result.close(); ok(); }; tx.onerror = () => no(tx.error); };
		r.onerror = () => no(r.error);
	}), v);
	const idbGet = (p) => p.evaluate(() => new Promise((ok, no) => {
		const r = indexedDB.open('notes', 1);
		r.onupgradeneeded = () => r.result.createObjectStore('kv');
		r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('text'); q.onsuccess = () => { r.result.close(); ok(q.result ?? null); }; };
		r.onerror = () => no(r.error);
	}));

	// legacy data from before (plain keys) belongs to root
	const legacy = await open('');
	await legacy.evaluate(() => { localStorage.clear(); });
	const raw = await open('?user=root');
	await raw.evaluate(() => { localStorage.setItem('note', 'von root'); });

	const jan = await open('?user=jan');
	check('ShareOS.user is the account from the URL', await jan.evaluate(() => ShareOS.user) === 'jan');
	await jan.evaluate(() => { localStorage.setItem('note', 'von jan'); localStorage.other = 'x'; });
	await idbPut(jan, 'jan-text');
	check('jan reads his own value', await jan.evaluate(() => localStorage.getItem('note')) === 'von jan');
	check('property access works', await jan.evaluate(() => localStorage.other) === 'x');
	check('jan sees only his keys', JSON.stringify(await jan.evaluate(() => Object.keys(localStorage).sort())) === '["note","other"]');

	const lisa = await open('?user=lisa');
	check('lisa does not see jan\'s value', await lisa.evaluate(() => localStorage.getItem('note')) === null);
	check('lisa has no keys', await lisa.evaluate(() => localStorage.length) === 0);
	check('lisa does not see jan\'s IndexedDB data', await idbGet(lisa) === null);
	check('IndexedDB list of lisa shows only her databases', JSON.stringify(await lisa.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))) === '["notes"]');
	await lisa.evaluate(() => localStorage.clear());

	const jan2 = await open('?user=jan');
	check('clear() of lisa left jan\'s data alone', await jan2.evaluate(() => localStorage.getItem('note')) === 'von jan');
	check('jan keeps his IndexedDB data', await idbGet(jan2) === 'jan-text');
	const root = await open('?user=root');
	check('root keeps the plain (old) keys', await root.evaluate(() => localStorage.getItem('note')) === 'von root');
	check('root does not list the other accounts\' keys', JSON.stringify(await root.evaluate(() => Object.keys(localStorage))) === '["note"]');
	const reload = await open('?user=jan');
	await reload.goto(`http://127.0.0.1:${PORT}/probe/index.html`);
	check('the account stays after a reload without ?user', await reload.evaluate(() => ShareOS.user) === 'jan');
	const guest = await ctx.newPage(); await guest.goto(`http://127.0.0.1:${PORT}/probe/index.html`);
	check('without ShareOS: guest, no data of others', await guest.evaluate(() => ShareOS.user + ':' + localStorage.getItem('note')) === 'guest:null');
	check('invalid account names are ignored', await (await open('?user=a%2Fb')).evaluate(() => ShareOS.user) === 'guest');

	// ShareOS.openApp: a window (popup) named like the ShareOS one, with the account
	fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'other/index.html'), '<!doctype html><script src="/_shareos/app.js"></script><title>other</title>');
	const opener = await open('?user=jan&theme=light&accent=green&style=glass');
	check('the style is applied to <html> (data-style)', await opener.evaluate(() => document.documentElement.dataset.style + ':' + ShareOS.theme.style) === 'glass:glass');
	const [win] = await Promise.all([ctx.waitForEvent('page'), opener.evaluate(() => { window.__w = ShareOS.openApp('other', { width: 700, height: 500 }); })]);
	await win.waitForLoadState();
	const u = new URL(win.url());
	check('openApp opens the app with account and look', u.pathname === '/other/index.html' && u.searchParams.get('user') === 'jan' && u.searchParams.get('theme') === 'light' && u.searchParams.get('accent') === 'green' && u.searchParams.get('style') === 'glass');
	check('openApp: a window of its own, named sosapp-<id>', await win.evaluate(() => window.name) === 'sosapp-other' && await opener.evaluate(() => !!window.__w));
	check('openApp: the other app sees the same account', await win.evaluate(() => ShareOS.user) === 'jan');
	check('openApp refuses invalid ids', await opener.evaluate(() => ShareOS.openApp('../x')) === null);

	// the app's own version: from its app.json, also without script
	fs.mkdirSync(path.join(dir, 'vers'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'vers/app.json'), JSON.stringify({ id: 'vers', name: 'Versions', version: '2.5.1', publisher: 'Test' }));
	fs.writeFileSync(path.join(dir, 'vers/index.html'), '<!doctype html><script src="/_shareos/app.js"></script><title>v</title><span id="a" data-sos-version>old</span><span id="b">plain</span>');
	const pv = await ctx.newPage(); await pv.goto(`http://127.0.0.1:${PORT}/vers/index.html`);
	check('appInfo: what app.json says', JSON.stringify(await pv.evaluate(() => ShareOS.appInfo())) === JSON.stringify({ id: 'vers', name: 'Versions', version: '2.5.1', publisher: 'Test' }));
	await pv.waitForFunction(() => document.getElementById('a').textContent !== 'old', null, { timeout: 3000 }).catch(() => {});
	check('data-sos-version: the element shows the version, others stay', await pv.evaluate(() => document.getElementById('a').textContent + '|' + document.getElementById('b').textContent) === '2.5.1|plain');
	check('no app.json: appInfo rejects, the element keeps its text', await (async () => {
		fs.writeFileSync(path.join(dir, 'probe/v.html'), '<!doctype html><script src="/_shareos/app.js"></script><span id="a" data-sos-version>1.0</span>');
		const p2 = await ctx.newPage(); await p2.goto(`http://127.0.0.1:${PORT}/probe/v.html`);
		const rej = await p2.evaluate(() => ShareOS.appInfo().then(() => false, () => true));
		return rej && await p2.evaluate(() => document.getElementById('a').textContent) === '1.0';
	})());

	await b.close();
	srv.kill();
	fs.rmSync(dir, { recursive: true, force: true });
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
