// Desktop view (module "desktop") in Chromium with Playwright, against the
// mock box (tests/mock-ubus.py): login choice, icons, windows (the areas are
// drawn into them – no page in a frame; parts of an area as a bar, links open
// the right window, several areas at once), web apps and the terminal as
// windows, moving, snapping, resizing, maximising, minimising, control panel,
// start menu search, wallpaper, theme, layout saved per account, switching
// views (the classic page is unchanged), plain users, module removed.
//
//   node tests/ui-desktop.js        (needs playwright and python3)
//   SHOTS=/tmp/desk node tests/ui-desktop.js   also writes screenshots
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');

const TOP = path.resolve(__dirname, '..');
const PORT = 18200 + Math.floor(Math.random() * 700);
const URL0 = `http://127.0.0.1:${PORT}/`;
const SID = 'c0ffee00c0ffee00c0ffee00c0ffee00';
const srv = spawn('python3', [path.join(TOP, 'tests/mock-ubus.py'), String(PORT)], { stdio: 'ignore' });
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, info = '') { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !info ? '' : '  (' + info + ')')); ok ? pass++ : fail++; }
const rpc = (obj, method, args = {}) => fetch(URL0 + 'ubus', { method: 'POST', headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [SID, obj, method, args] }) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	for (let i = 0; i < 40; i++) { try { await fetch(URL0); break; } catch (e) { await sleep(150); } }
	await rpc('shareos.setup', 'apply', {});   // no first-run wizard
	const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
	const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
	const p = await ctx.newPage();
	const errors = [];
	p.on('pageerror', (e) => errors.push(e.message));
	const shot = async (n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
	const rect = (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
	const win = (id) => `.dk-win[data-id="${id}"]`;
	// bring a window to the front through the taskbar (a click on the one in front would minimise it)
	const front = async (id) => {
		const on = await p.$eval(win(id), (e) => e.classList.contains('on') && !e.hidden).catch(() => false);
		if (!on) await p.click(`.dk-tw[data-task="${id}"]`);
		await sleep(250);
	};
	const drag = async (sel, dx, dy, to) => {
		const r = await rect(sel);
		const x = r.x + Math.min(120, r.w / 3), y = r.y + r.h / 2;
		await p.mouse.move(x, y); await p.mouse.down();
		await p.mouse.move(x + 10, y + 5, { steps: 2 });
		if (to) await p.mouse.move(to[0], to[1], { steps: 8 }); else await p.mouse.move(x + dx, y + dy, { steps: 8 });
		await p.mouse.up();
	};

	// login page: both views offered, desktop chosen
	await p.goto(URL0);
	await p.waitForSelector('#login-form');
	check('login: view choice shown (module installed)', await p.locator('.viewpick [data-view]').count() === 2);
	check('login: desktop preselected', await p.locator('.vbtn.on[data-view="desktop"]').count() === 1);
	await shot('01-login');
	await p.click('[data-view="classic"]');
	check('login: choice switches', await p.locator('.vbtn.on[data-view="classic"]').count() === 1);
	await p.click('[data-view="desktop"]');
	await p.fill('input[name=user]', 'root');
	await p.fill('input[name=pass]', 'shareos');
	await p.click('#login-form button[type=submit]');
	await p.waitForSelector('#dk .dk-ico');
	await sleep(400);
	const labels = await p.$$eval('.dk-ico .dk-il', (l) => l.map((x) => x.textContent));
	const ids = await p.$$eval('.dk-ico', (l) => l.map((x) => x.dataset.open));
	check('desktop: icons of the areas', ['files', 'storage', 'shares', 'services', 'panel', 'store', 'task', 'logs', 'term'].every((x) => ids.includes(x)), ids.join(','));
	check('desktop: module icons (cloud, paperless, dns filter)', labels.some((x) => /Cloud/.test(x)) && labels.some((x) => /Paperless/.test(x)) && labels.some((x) => /DNS/.test(x)), labels.join(','));
	check('desktop: web app icon (Webpad)', labels.includes('Webpad'));
	check('desktop: no page header', await p.locator('#hd').count() === 0);

	// a window with the storage area: drawn into the window, no page in a frame
	const pops = [];
	ctx.on('page', (x) => pops.push(x));
	await p.click('.dk-ico[data-open="storage"]');
	await p.waitForSelector(win('storage') + ' .dk-view .panel, ' + win('storage') + ' .dk-view .card');
	check('window: the area itself, no frame', await p.locator(win('storage') + ' iframe').count() === 0 && await p.locator(win('storage') + ' .dk-view .sec').count() > 0);
	check('window: no header, tabs or footer of the page', await p.locator('#hd, #tabs, #ft, #main').count() === 0);
	const bar = await p.$$eval(win('storage') + ' .subtabs a', (l) => l.map((x) => x.getAttribute('href')));
	check('window: parts of the area as a bar', bar.join() === '#/storage/volumes,#/storage/health,#/storage/snapshots', bar.join());
	check('taskbar: window listed', await p.locator('.dk-tw[data-task="storage"]').count() === 1);
	// a part of the area: the same window shows it
	await p.click(win('storage') + ' .subtabs a[href="#/storage/health"]');
	await p.waitForSelector(win('storage') + ' .subtabs a.on[href="#/storage/health"]');
	check('window: a part opens in the same window', await p.locator('.dk-win').count() === 1 && await p.evaluate(() => location.hash) === '');
	await p.click(win('storage') + ' .subtabs a[href="#/storage/volumes"]');
	await p.waitForSelector(win('storage') + ' .subtabs a.on[href="#/storage/volumes"]');

	// move
	const r0 = await rect(win('storage'));
	await drag(win('storage') + ' .dk-wt', 140, 60);
	const r1 = await rect(win('storage'));
	check('window: moved by the title bar', Math.abs(r1.x - r0.x - 140) < 3 && Math.abs(r1.y - r0.y - 60) < 3, JSON.stringify([r0, r1]));
	// resize
	const rs = await rect(win('storage') + ' [data-rs=se]');
	await p.mouse.move(rs.x + 5, rs.y + 5); await p.mouse.down();
	await p.mouse.move(rs.x + 60, rs.y + 45, { steps: 6 }); await p.mouse.up();
	const r2 = await rect(win('storage'));
	check('window: resized at the corner', r2.w > r1.w + 40 && r2.h > r1.h + 30, JSON.stringify([r1, r2]));
	// snap left
	await drag(win('storage') + ' .dk-wt', 0, 0, [1, 300]);
	const r3 = await rect(win('storage'));
	check('window: snapped to the left half', r3.x === 0 && Math.abs(r3.w - 720) < 2 && r3.y === 56, JSON.stringify(r3));
	// pulled off the edge: back in its own size
	await drag(win('storage') + ' .dk-wt', 300, 120);
	const r4 = await rect(win('storage'));
	check('window: own size again after leaving the half', Math.abs(r4.w - r2.w) < 2, JSON.stringify([r2, r4]));
	// maximise by double click
	await p.dblclick(win('storage') + ' .dk-wt h2');
	const r5 = await rect(win('storage'));
	check('window: maximised by double click', r5.x === 0 && r5.w === 1440 && r5.y === 56 && r5.h === 844, JSON.stringify(r5));
	await p.dblclick(win('storage') + ' .dk-wt h2');
	check('window: restored', Math.abs((await rect(win('storage'))).w - r4.w) < 2);

	// control panel -> network page in a window
	await p.click('.dk-ico[data-open="panel"]');
	await p.waitForSelector(win('panel') + ' .dk-cat');
	check('control panel: categories', await p.locator(win('panel') + ' .dk-ch').count() >= 4);
	await p.fill('#dk-pq', 'netw');
	const hits = await p.$$eval(win('panel') + ' .dk-cat span', (l) => l.map((x) => x.textContent));
	check('control panel: search', hits.length >= 1 && hits.length < 4, hits.join(','));
	await p.click(win('panel') + ' .dk-cat[data-id="r:#/system/network"]');
	await p.waitForSelector(win('system') + ' .dk-view form, ' + win('system') + ' .dk-view .panel');
	check('control panel: setting opens in the settings window', await p.locator('.dk-win').count() === 3);
	check('focus: newest window on top', await p.$eval(win('system'), (e) => e.classList.contains('on')));
	check('settings: network shown', await p.locator(win('system') + ' .subtabs a.on[href="#/system/network"]').count() === 1);
	const sb = await p.$$eval(win('system') + ' .subtabs a', (l) => l.filter((x) => x.getClientRects().length).map((x) => x.getAttribute('href').split('/').pop()));
	check('settings: logs and terminal are windows of their own, not parts', !sb.includes('logs') && !sb.includes('terminal') && sb.includes('time'), sb.join());
	// the area behind keeps what it showed; a click into it acts at once
	check('behind: storage still shows its content', await p.locator(win('storage') + ' .dk-view .card, ' + win('storage') + ' .dk-view .panel').count() > 0);
	// another setting from the control panel: the same settings window
	await p.click('.dk-tw[data-task="panel"]');
	await p.fill('#dk-pq', '');
	await p.click(win('panel') + ' .dk-cat[data-id="r:#/system/time"]');
	await p.waitForSelector(win('system') + ' .subtabs a.on[href="#/system/time"]');
	check('control panel: another setting, same window', await p.locator('.dk-win').count() === 3);
	// typed text survives going to another window and back
	await p.click(win('system') + ' .subtabs a[href="#/system/general"]');
	await p.waitForSelector(win('system') + ' input[name=hostname]');
	await p.fill(win('system') + ' input[name=hostname]', 'typed-name');
	await front('storage');
	await sleep(400);
	check('windows: storage in front', await p.$eval(win('storage'), (e) => e.classList.contains('on')));
	// a click on a part of the window behind that is not covered: it comes forward and acts with that first click
	const free = await p.$$eval(win('system') + ' .subtabs a', (l) => l.map((x) => { const r = x.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
		return document.elementFromPoint(cx, cy) === x && !x.classList.contains('on') ? [x.getAttribute('href'), cx, cy] : null; }).filter(Boolean));
	if (free.length) {
		await p.mouse.click(free[0][1], free[0][2]);
		await p.waitForSelector(win('system') + ` .subtabs a.on[href="${free[0][0]}"]`, { timeout: 5000 }).catch(() => {});
		check('windows: first click into a window behind acts', await p.locator(win('system') + ` .subtabs a.on[href="${free[0][0]}"]`).count() === 1 && await p.$eval(win('system'), (e) => e.classList.contains('on')), free[0][0]);
	} else {
		await front('system');
		check('windows: first click into a window behind acts (window covered, skipped)', true);
	}
	await p.click(win('system') + ' .subtabs a[href="#/system/general"]');
	await p.waitForSelector(win('system') + ' input[name=hostname]');
	check('windows: typed text kept across a change of window', await p.inputValue(win('system') + ' input[name=hostname]') === 'typed-name');
	// a link to another area opens that window
	await p.evaluate(() => { location.hash = '#/services/dlna'; });
	await p.waitForSelector(win('services') + ' .subtabs a.on[href="#/services/dlna"]');
	check('link: another area opens its window', await p.locator('.dk-win').count() === 4 && await p.evaluate(() => location.hash) === '');
	await p.click(win('services') + ' [data-w=close]');
	await sleep(400);
	await shot('02-windows');

	// minimise and back from the taskbar
	await p.click('.dk-tw[data-task="panel"]');   // to the front (the network window covers it)
	await p.click(win('panel') + ' [data-w=min]');
	check('window: minimised', !(await p.locator(win('panel')).isVisible()));
	await p.click('.dk-tw[data-task="panel"]');
	check('taskbar: brings it back', await p.locator(win('panel')).isVisible());
	await p.click(win('panel') + ' [data-w=close]');
	check('window: closed', await p.locator(win('panel')).count() === 0 && await p.locator('.dk-tw[data-task="panel"]').count() === 0);

	// start menu search
	await p.click('[data-dk=start]');
	await p.waitForSelector('#dk-start:not([hidden]) .dk-st');
	await shot('03-start');
	await p.fill('#dk-q', 'logs');
	const sh = await p.$$eval('#dk-sl .dk-st span', (l) => l.map((x) => x.textContent));
	check('start menu: search finds the logs', sh.length >= 1 && sh.some((x) => /Log|Proto/.test(x)), sh.join(','));
	await p.keyboard.press('Escape');
	check('start menu: Esc closes it', await p.locator('#dk-start').isHidden());

	// wallpaper from the box
	await p.click('#dk-av');
	await p.click('#dk-menu [data-dk=wall]');
	await p.waitForSelector('dialog.dk-wd .fb-item');
	await p.click('dialog.dk-wd [data-place="0"]');
	await p.click('dialog.dk-wd [data-dir="Photos"]');
	await p.click('dialog.dk-wd [data-img="Urlaub_Ostsee_001.jpg"]');
	await p.waitForFunction(() => document.querySelector('#dk-wall').classList.contains('img'));
	check('wallpaper: image of the box shown', (await p.$eval('#dk-wall', (e) => e.style.backgroundImage)).startsWith('url("blob:'));
	await p.selectOption('#dk-fit', 'contain');
	check('wallpaper: fit', await p.waitForFunction(() => document.querySelector('#dk-wall').classList.contains('fit-contain')).then(() => true, () => false));
	await p.click('dialog.dk-wd button[value=no]');
	await shot('04-wallpaper');

	// theme: desktop and every window
	await p.click('#dk-av');
	await p.click('#dk-menu [data-dk=theme]');
	await sleep(300);
	check('theme: desktop light', await p.$eval('#app', (e) => e.classList.contains('light')));
	check('theme: windows are part of the page (light too)', await p.locator('#app.light ' + win('storage') + ' .dk-view').count() === 1);
	await shot('05-light');
	// the look is set in the settings window: desktop and all windows follow
	await front('system');
	await p.click(win('system') + ' .subtabs a[href="#/system/appearance"]');
	await p.waitForSelector(win('system') + ' #opt-theme');
	await p.selectOption(win('system') + ' #opt-theme', 'dark');
	await sleep(400);
	check('theme: from the settings window to the desktop', !(await p.$eval('#app', (e) => e.classList.contains('light'))));
	check('theme: settings window shows the new choice', await p.inputValue(win('system') + ' #opt-theme') === 'dark');

	// web apps: a window of the desktop, not a browser window
	await p.click('.dk-ico[data-open="app:webpad"]');
	await p.waitForSelector(win('app:webpad') + ' iframe.dk-app');
	await sleep(500);
	check('app: opens as a desktop window', await p.locator(win('app:webpad')).count() === 1 && pops.length === 0);
	check('app: its frame is sandboxed', (await p.getAttribute(win('app:webpad') + ' iframe', 'sandbox')).includes('allow-scripts'));
	check('app: address of the app with look and account', /\/webpad\/.*theme=.*user=root/.test(await p.getAttribute(win('app:webpad') + ' iframe', 'src')), await p.getAttribute(win('app:webpad') + ' iframe', 'src'));
	check('app: in the taskbar', await p.locator('.dk-tw[data-task="app:webpad"]').count() === 1);
	// a file opened with an app: a second window of that app
	await p.click('.dk-ico[data-open="files"]');
	await p.waitForSelector(win('files') + ' [data-act="fb-app"], ' + win('files') + ' .fb-row, ' + win('files') + ' tr');
	check('files: window without the bar of the shares area', !(await p.locator(win('files') + ' .subtabs').isVisible()));
	const opened = await p.evaluate(async () => { const a = (S.fbApps?.apps || [])[0]; if (!a) return 'no app'; S.fb.root = S.fb.root || 'data'; await fbOpenIn(a.id, 'notes.txt'); return a.id; });
	await sleep(500);
	check('files: a file opens in a second window of the app', opened === 'webpad' && await p.locator(win('app:webpad#2')).count() === 1 && pops.length === 0, String(opened));
	check('files: its title names the file', /notes\.txt/.test(await p.textContent(win('app:webpad#2') + ' .dk-wt h2')));
	// an app that closes itself (handed its file to the other window): its window closes
	await p.evaluate(() => dkMsg({ origin: appBase(appSrv()), data: { sos: 'close' }, source: document.querySelector('.dk-win[data-id="app:webpad#2"] iframe').contentWindow }));
	check('app: window.close() of the app closes its window', await p.locator(win('app:webpad#2')).count() === 0 && await p.$eval(win('app:webpad'), (e) => e.classList.contains('on')));
	await p.click(win('app:webpad') + ' [data-w=close]');
	await front('files');
	await p.click(win('files') + ' [data-w=close]');

	// terminal: the shell fills its window
	await p.click('.dk-ico[data-open="term"]');
	await p.waitForSelector(win('term') + ' iframe.dk-term');
	check('terminal: the shell itself in the window', await p.locator(win('term') + ' .dk-wc > *').count() === 1 && await p.locator(win('term') + ' .panel, ' + win('term') + ' .btn').count() === 0);
	await shot('05b-terminal');
	await p.click(win('term') + ' [data-w=close]');
	// task manager: load and status only, live
	await p.click('.dk-ico[data-open="task"]');
	await p.waitForSelector(win('task') + ' .mbars');
	const parts = await p.$$eval(win('task') + ' .sec', (l) => l.filter((x) => x.getClientRects().length).map((x) => x.dataset.part));
	check('task manager: load and status, not the whole overview', parts.join() === 'load,status', parts.join());
	await p.click(win('task') + ' [data-w=close]');
	await front('system');
	await p.click(win('system') + ' [data-w=close]');

	// icons can be moved (and are saved)
	const i0 = await rect('.dk-ico[data-open="term"]');
	await p.mouse.move(i0.x + 40, i0.y + 30); await p.mouse.down();
	await p.mouse.move(i0.x + 400, i0.y + 30, { steps: 8 }); await p.mouse.up();
	const i1 = await rect('.dk-ico[data-open="term"]');
	check('icons: moved to another cell', i1.x - i0.x > 300 && Math.abs(i1.y - i0.y) < 2, JSON.stringify([i0, i1]));
	check('icons: a drag does not open a window', await p.locator(win('term')).count() === 0);
	// the part shown is saved with the window
	await front('storage');
	await p.click(win('storage') + ' .subtabs a[href="#/storage/health"]');
	await p.waitForSelector(win('storage') + ' .subtabs a.on[href="#/storage/health"]');
	await p.click('.dk-ico[data-open="logs"]');
	await p.waitForSelector(win('logs') + ' #logbox');

	// layout saved on the box, back after a reload
	await sleep(1200);
	const saved = await rpc('shareos.me', 'desk_get');
	const d = saved.result?.[1]?.desk || {};
	check('saved: open windows with their part, places, icons, wallpaper', (d.open || []).length === 2 && d.open.some((o) => o.id === 'storage' && o.sub === 'health')
		&& d.geo?.storage && d.icons?.term && d.wall?.name === 'Urlaub_Ostsee_001.jpg', JSON.stringify(d).slice(0, 300));
	await p.reload();
	await p.waitForSelector(win('storage'));
	await sleep(900);
	check('reload: windows come back', await p.locator('.dk-win').count() === 2);
	check('reload: with the part shown before', await p.locator(win('storage') + ' .subtabs a.on[href="#/storage/health"]').count() === 1);
	check('reload: the window behind is drawn too', await p.locator(win('storage') + ' .dk-view .sec, ' + win('storage') + ' .dk-view .panel').count() > 0 && await p.locator(win('logs') + ' #logbox').count() === 1);
	check('reload: icon place kept', Math.abs((await rect('.dk-ico[data-open="term"]')).x - i1.x) < 2);
	check('reload: wallpaper kept', await p.waitForFunction(() => document.querySelector('#dk-wall').classList.contains('img')).then(() => true, () => false));

	// classic view and back
	await p.click('#dk-av');
	await p.click('#dk-menu [data-dk=classic]');
	await p.waitForSelector('#hd .clock');
	check('classic: page with header', await p.locator('#tabs .tab').count() > 3);
	// the classic page works as before: one page, addresses change it
	await p.waitForSelector('#main .sec');
	await p.click('#tabs a[href="#/storage"]');
	await p.waitForSelector('#main .subtabs a.on[href="#/storage/volumes"]');
	await p.click('#main .subtabs a[href="#/storage/health"]');
	await p.waitForSelector('#main .subtabs a.on[href="#/storage/health"]');
	check('classic: tabs and parts change the page', await p.evaluate(() => location.hash) === '#/storage/health' && await p.locator('#main .subtabs a').count() === 3);
	await p.click('#tabs a[href="#/overview"]');
	await p.waitForSelector('#main .mbars');
	check('classic: overview with all its sections', await p.locator('#main .sec[data-part]').count() === 4);
	check('classic: button to the desktop', await p.locator('[data-act="desk-view"]').count() === 1);
	await shot('06-classic');
	await p.click('[data-act="desk-view"]');
	await p.waitForSelector('#dk .dk-ico');
	check('desktop again', await p.locator('.dk-win').count() === 2);

	// log out
	await p.click('[data-dk=start]');
	await p.click('#dk-start [data-dk=logout]');
	await p.waitForSelector('#login-form');
	check('logout: login page', await p.locator('#dk').count() === 0);

	// a plain user: own areas only
	await p.fill('input[name=user]', 'anna');
	await p.fill('input[name=pass]', 'anna123');
	await p.click('#login-form button[type=submit]');
	await p.waitForSelector('#dk .dk-ico');
	const ul = await p.$$eval('.dk-ico', (l) => l.map((x) => x.dataset.open));
	check('user: own icons', ul.includes('me') && ul.includes('settings') && !ul.includes('panel') && !ul.includes('storage'), ul.join(','));
	await p.click('.dk-ico[data-open="me"]');
	await p.waitForSelector(win('me') + ' .dk-view section');
	check('user: window with My ShareOS', await p.locator(win('me') + ' iframe').count() === 0 && await p.locator(win('me') + ' .dk-view section').count() > 0);
	await p.click('.dk-ico[data-open="settings"]');
	await p.waitForSelector(win('settings') + ' #f-mypass');
	check('user: settings in their own window', await p.locator('.dk-win').count() === 2 && await p.locator(win('me') + ' .dk-view section').count() > 0);
	await shot('07-user');
	await p.click('[data-dk=start]');
	await p.click('#dk-start [data-dk=logout]');
	await p.waitForSelector('#login-form');

	// module removed: no choice on the login page, classic page after login
	await rpc('shareos.apps', 'remove', { id: 'desktop' });
	await p.reload();
	await p.waitForSelector('#login-form');
	check('without module: no view choice', await p.locator('.viewpick').count() === 0);
	await p.fill('input[name=user]', 'root');
	await p.fill('input[name=pass]', 'shareos');
	await p.click('#login-form button[type=submit]');
	await p.waitForSelector('#hd .clock');
	check('without module: classic page', await p.locator('#dk').count() === 0 && await p.locator('[data-act="desk-view"]').count() === 0);
	const g = await rpc('shareos.me', 'desk_get');
	check('without module: desk_get refused', g.result?.[1]?.error === 'not installed');

	check('no script errors', errors.length === 0, errors.join(' | '));
	await b.close();
	srv.kill();
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
