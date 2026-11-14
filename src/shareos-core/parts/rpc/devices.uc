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

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.printer': {
		status: { call: function() { return printer_status(); } },

		set: {
			args: { enabled: false, mode: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.mode && !(a.mode in { auto: 1, raw: 1 })) return { error: 'invalid mode' };
				c.set('printer', 'main', 'printer');
				c.set('printer', 'main', 'enabled', a.enabled === true ? '1' : '0');
				if (a.mode) c.set('printer', 'main', 'mode', a.mode);
				c.commit('printer');
				let r = sh(PRINTER + (a.enabled === true ? ' restart' : ' stop'));
				let m = match(r.out, /error: ([^\n]*)/);
				if (m || r.rc != 0) return { error: m ? m[1] : (trim(r.out) || 'failed') };
				sleep(500);
				return printer_status();
			}
		},

		test: {
			args: { lp: '' },
			call: function(req) {
				if (!match(req.args.lp ?? '', /^lp[0-9]$/)) return { error: 'no such printer' };
				let r = sh(PRINTER + ' test ' + req.args.lp);
				let m = match(r.out, /error: ([^\n]*)/);
				return m || r.rc != 0 ? { error: m ? m[1] : 'failed' } : { ok: true };
			}
		}
	},

	'shareos.ups': {
		status: { call: function() { return ups_status(); } },

		set: {
			args: { enabled: false, driver: '', shutdown: '', percent: 0, minutes: 0, killpower: true, server: false, password: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.driver && !(a.driver in { auto: 1, 'usbhid-ups': 1, nutdrv_qx: 1, blazer_usb: 1 })) return { error: 'invalid driver' };
				if (a.shutdown && !(a.shutdown in { low: 1, percent: 1, minutes: 1 })) return { error: 'invalid shutdown' };
				if (a.percent != null && a.percent != 0 && (a.percent < 10 || a.percent > 90)) return { error: 'percent: 10 … 90' };
				if (a.minutes != null && a.minutes != 0 && (a.minutes < 1 || a.minutes > 120)) return { error: 'minutes: 1 … 120' };
				let pw = a.password ?? '';
				if (pw != '' && !match(pw, /^[A-Za-z0-9._-]{6,64}$/)) return { error: 'password: 6 … 64 letters, digits, . _ -' };
				c.set('ups', 'main', 'ups');
				c.set('ups', 'main', 'enabled', a.enabled === true ? '1' : '0');
				if (a.driver) c.set('ups', 'main', 'driver', a.driver);
				if (a.shutdown) c.set('ups', 'main', 'shutdown', a.shutdown);
				if (a.percent) c.set('ups', 'main', 'percent', '' + a.percent);
				if (a.minutes) c.set('ups', 'main', 'minutes', '' + a.minutes);
				if (a.killpower != null) c.set('ups', 'main', 'killpower', a.killpower ? '1' : '0');
				if (a.server != null) c.set('ups', 'main', 'server', a.server ? '1' : '0');
				if (pw != '') c.set('ups', 'main', 'password', pw);
				if (a.server && !c.get('ups', 'main', 'password')) return { error: 'the network needs a password' };
				c.commit('ups');
				let r = sh(UPS + (a.enabled === true ? ' restart' : ' stop'));
				let m = match(r.out, /error: ([^\n]*)/);
				if (m || r.rc != 0) return { error: m ? m[1] : (trim(r.out) || 'failed') };
				return ups_status();
			}
		}
	}
});
