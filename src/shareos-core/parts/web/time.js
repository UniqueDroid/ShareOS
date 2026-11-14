// --- time page helpers: show the box's clock in the box's time zone ---
function tzSafe(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch (e) { return 'UTC'; } }
function boxTime(t) { return new Date(t.now * 1000).toLocaleTimeString(LOC, { timeZone: tzSafe(t.timezone), hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function boxDate(t) { return new Date(t.now * 1000).toLocaleDateString(LOC, { timeZone: tzSafe(t.timezone), weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
// "YYYY-MM-DDTHH:MM:SS" as the wall clock in time zone tz
function localInput(t) {
	const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tzSafe(t.timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
		.formatToParts(new Date(t.now * 1000)).map((x) => [x.type, x.value]));
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
// wall clock in tz -> seconds since 1970 (two rounds settle daylight saving)
function fromLocalInput(v, tz) {
	const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/.exec(v || '');
	if (!m) return null;
	const want = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
	let guess = want;
	for (let k = 0; k < 2; k++) {
		const shown = localInput({ now: guess, timezone: tz }).match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)$/);
		guess += want - Date.UTC(+shown[1], shown[2] - 1, +shown[3], +shown[4], +shown[5], +shown[6]) / 1000;
	}
	return Math.round(guess);
}
function setTime(t) { S.time = t; S.timeOffset = t.now - Math.floor(Date.now() / 1000); }
async function loadNotes() {
	if (away()) return;
	try {
		const n = await rpc('shareos.notify', 'list');
		const was = S.notes?.unread;
		S.notes = n;
		if (was !== n.unread) renderHeader();
		if (S.route.tab === 'system' && S.route.sub === 'notifications' && !$('#f-notify :focus')) renderMain();
	} catch (e) { }
}

async function loadNoteCfg() {
	try { S.noteCfg = await rpc('shareos.notify', 'get'); } catch (e) { toast('Messages: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'notifications') renderMain();
}

async function loadTime() {
	try {
		const [t, z] = await Promise.all([rpc('shareos.time', 'get'), S.zones ? null : rpc('shareos.setup', 'zones')]);
		setTime(t); if (z) S.zones = z.zones;
	} catch (e) { toast('Time: ' + e.message, true); }
	if (S.route.tab === 'system' && S.route.sub === 'time') renderMain();
}

// "now: 41 °C · half" of the fan panel: the values of the last tick (every 5 s)
function fanNow() {
	const i = S.info || S.hw || {};
	return `now: ${i.temperature != null ? (i.temperature / 1000).toFixed(0) + ' °C' : '–'} · ${fanTxt(i.fan_pwm)}`;
}
async function loadHw() {
	try { S.hw = await rpc('shareos.hw', 'get'); } catch (e) { toast('Hardware: ' + e.message, true); }
	if (S.route.sub === 'power') renderMain();
}

