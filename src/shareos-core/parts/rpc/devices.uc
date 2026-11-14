/* ---------- printers (system app "printer": ipp-usb, p910nd) ---------- */

const PRINTER = '/usr/sbin/shareos-printer';
function printer_status() {
	let st = {}, printers = [];
	for (let l in split(sh(PRINTER + ' status').out, '\n')) {
		let m = match(l, /^([a-z0-9]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'printer') {
			let f = split(m[2], '|');
			push(printers, { id: f[0], ipp: f[1] == '1', lp: f[2] == '-' ? null : f[2], via: f[3] || null, port: f[4] ? +f[4] : null,
				maker: trim(f[5] ?? ''), model: trim(join('|', slice(f, 6))) });
		}
		else st[m[1]] = m[2];
	}
	return { installed: st.installed == '1', enabled: st.enabled == '1', mode: st.mode ?? 'auto', ippusb: st.ippusb == '1', printers,
		hostname: trim(readfile('/proc/sys/kernel/hostname') ?? '') };
}

/* ---------- UPS (system app "nut", shareos-ups) ---------- */

const UPS = '/usr/sbin/shareos-ups';
function ups_status() {
	let st = {}, events = [];
	for (let l in split(sh(UPS + ' status').out, '\n')) {
		let m = match(l, /^([a-z_]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'event') { let f = split(m[2], ' '); push(events, { time: +f[0], type: f[1] }); }
		else st[m[1]] = m[2];
	}
	let c = cursor(), g = (k, d) => c.get('ups', 'main', k) ?? d;
	return { installed: st.installed == '1', enabled: st.enabled == '1', running: st.running == '1', detected: st.detected || null,
		driver: st.driver ?? null, status: st.status ?? null, charge: st.charge != null ? +st.charge : null,
		runtime: st.runtime != null ? +st.runtime : null, load: st.load != null ? +st.load : null, voltage: st.voltage != null ? +st.voltage : null,
		mfr: st.mfr ?? null, model: st.model ?? null, charge_low: st.charge_low != null ? +st.charge_low : null, battery_date: st.battery_date ?? null,
		events: reverse(events),
		settings: { driver: g('driver', 'auto'), shutdown: g('shutdown', 'low'), percent: +g('percent', '30'), minutes: +g('minutes', '5'),
			killpower: g('killpower', '1') != '0', server: g('server', '0') == '1', password_set: !!g('password', '') } };
}

