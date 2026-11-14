/* ---------- hardware settings, first run, Alt-F ---------- */

// The fan curves are defined in one file; shareos-board regulates by it.
function fan_presets() {
	let p = {};
	for (let l in split(readfile('/usr/lib/shareos/fan-presets') ?? '', '\n')) {
		let m = match(l, /^([a-z]+)[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]*$/);
		if (m) p[m[1]] = { off_temp: +m[2], full_temp: +m[3], half_temp: +m[4] };
	}
	return p;
}
const FAN_PRESETS = fan_presets();

function fan_settings() {
	let c = cursor();
	let preset = c.get('shareos', 'fan', 'preset') ?? 'balanced';
	let v = FAN_PRESETS[preset] ?? {
		off_temp: +(c.get('shareos', 'fan', 'off_temp') ?? 0),
		full_temp: +(c.get('shareos', 'fan', 'full_temp') ?? 50),
		half_temp: +(c.get('shareos', 'fan', 'half_temp') ?? 45)
	};
	return { preset, ...v };
}

function led_settings() {
	let c = cursor();
	return {
		status: c.get('shareos', 'led', 'status') ?? 'heartbeat',
		power: c.get('shareos', 'led', 'power') ?? 'on',
		disks: c.get('shareos', 'led', 'disks') ?? 'off'
	};
}

function timezone() {
	let t = trim(readfile('/etc/timezone') ?? '');
	if (t != '') return t;
	let l = readlink('/etc/localtime');
	return l ? replace(l, /^.*zoneinfo\//, '') : 'UTC';
}

function zones() {
	let list = [];
	for (let line in split(readfile('/usr/share/zoneinfo/zone1970.tab') ?? readfile('/usr/share/zoneinfo/zone.tab') ?? '', '\n')) {
		if (substr(line, 0, 1) == '#') continue;
		let f = split(line, '\t');
		if (length(f) >= 3) push(list, f[2]);
	}
	if (!length(list))
		for (let d in [ 'Africa', 'America', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Pacific' ])
			for (let z in glob('/usr/share/zoneinfo/' + d + '/*'))
				push(list, substr(z, 20));
	push(list, 'UTC');
	return sort(uniq(list));
}

function set_timezone(tz) {
	if (!match(tz ?? '', /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)*$/) || !stat('/usr/share/zoneinfo/' + tz))
		return false;
	let changed = tz != timezone();
	unlink('/etc/localtime');
	symlink('/usr/share/zoneinfo/' + tz, '/etc/localtime');
	writefile('/etc/timezone', tz + '\n');
	// running programs read the zone once: restart the ones that print times
	if (changed)
		system('(sleep 1; for s in /etc/init.d/S01syslogd /etc/init.d/S50crond; do [ -x $s ] && $s restart; done) >/dev/null 2>&1 &');
	return true;
}

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.system': {
		// a root shell in the browser (admins only): ttyd on its own port with
		// a secret path, for one client, ends when that client leaves
		terminal: {
			args: { tls: false, theme: {} },
			call: function(req) {
				let th = req.args.theme, t = {};
				if (type(th) == 'object')
					for (let k in [ 'background', 'foreground', 'cursor', 'selectionBackground' ])
						if (match(th[k] ?? '', /^#[0-9a-fA-F]{3,8}$/)) t[k] = th[k];
				let r = sh(sprintf('/usr/sbin/shareos-terminal start %s %s', req.args.tls ? 'tls' : 'plain', shq(length(t) ? sprintf('%J', t) : '')));
				let m = match(r.out, /port=([0-9]+) path=([0-9a-f]{32})/);
				if (!m) return { error: trim(replace(r.out, /^error: /, '')) || 'terminal did not start' };
				return { port: +m[1], path: m[2] };
			}
		},

		info: {
			call: function() {
				let up = split(read_trim('/proc/uptime') ?? '0', ' ');
				let load = split(read_trim('/proc/loadavg') ?? '', ' ');
				let net = '/sys/class/net/eth0/';
				return {
					model: read_trim('/proc/device-tree/model'),
					board: { id: board().id ?? null, name: board().name ?? null, fwname: board().fwname ?? null, tested: board().tested == '1' },
					release: release(),
					hostname: read_trim('/proc/sys/kernel/hostname'),
					kernel: read_trim('/proc/sys/kernel/osrelease'),
					boot: boot_mode(),
					time: time(),
					uptime: +up[0],
					load: [ +load[0], +load[1], +load[2] ],
					cpu: cpustat(),
					memory: meminfo(),
					temperature: box_temp(),   // m°C, from dns320l-daemon or shareos-board
					fan_pwm: read_int('/tmp/sys/pwm1'),
					network: {
						eth0: {
							ipv4: memo('ipv4', fstamp('/etc/resolv.conf'), 30, () => ipv4('eth0')),
							gateway: memo('gw', fstamp('/etc/resolv.conf'), 30, gateway),
							dns: dns(),
							speed: read_int(net + 'speed'),
							mac: read_trim(net + 'address'),
							rx_bytes: read_int(net + 'statistics/rx_bytes'),
							tx_bytes: read_int(net + 'statistics/tx_bytes')
						}
					},
					filesystems: memo('df', '', 30, filesystems),
					disks: disks_state(),
					board_control: memo('boardctl', '', 10, board_control)
				};
			}
		},

		log: {
			args: { lines: 200, source: 'system' },
			call: function(req) {
				let n = +(req.args.lines ?? 200);
				if (n < 1 || n > 2000) n = 200;
				let src = req.args.source ?? 'system', m = match(src, /^boot:([0-9]{8}-[0-9]{6})$/);
				// a kept start snapshot (shareos-bootlog): all of it
				if (m) return { lines: split(rtrim(sh('/usr/sbin/shareos-bootlog show ' + m[1]).out), '\n') };
				let r = src == 'kernel'
					? sh('dmesg | tail -n ' + n)
					: sh('tail -n ' + n + ' /var/log/messages');
				return { lines: split(rtrim(r.out), '\n') };
			}
		},

		// the kept snapshots of the last starts (shareos-bootlog)
		bootlogs: {
			call: function() {
				let j = jparse(trim(sh('/usr/sbin/shareos-bootlog list').out) || 'null');
				return type(j) == 'object' ? j : { logs: [] };
			}
		},

		reboot: {
			call: function() {
				if (flash_busy()) return { error: FLASH_BUSY };
				system('(sleep 2; reboot) >/dev/null 2>&1 &');
				return { rebooting: true };
			}
		},

		poweroff: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true)
					return { error: 'confirm must be true' };
				if (flash_busy()) return { error: FLASH_BUSY };
				// the next switch-on of the power schedule first (wake-up alarm)
				system('(sleep 2; /usr/sbin/shareos-power arm; poweroff) >/dev/null 2>&1 &');
				return { poweroff: true };
			}
		},

		// power schedule: switch off and on by weekday (shareos-power)
		power_schedule: {
			call: function() {
				let j = jparse(trim(sh('/usr/sbin/shareos-power status').out) || 'null');
				return type(j) == 'object' ? j : { error: 'failed' };
			}
		},

		power_schedule_set: {
			args: { enabled: false, days: {} },
			call: function(req) {
				let a = req.args, days = type(a.days) == 'object' ? a.days : {}, c = cursor();
				const T = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
				if (!c.get('shareos', 'power')) c.set('shareos', 'power', 'power');
				for (let d in [ 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun' ]) {
					let x = type(days[d]) == 'object' ? days[d] : {};
					for (let k in [ 'on', 'off' ]) {
						let v = '' + (x[k] ?? '');
						if (v != '' && !match(v, T)) return { error: 'invalid time ' + v + ' (HH:MM)' };
						if (v == '') c.delete('shareos', 'power', k + '_' + d);
						else c.set('shareos', 'power', k + '_' + d, v);
					}
				}
				c.set('shareos', 'power', 'enabled', a.enabled ? '1' : '0');
				c.commit('shareos');
				system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
				// set the wake-up alarm now and say so when the box did not take it:
				// the page must not promise a switch-on that is not armed
				let arm = null, j = null;
				try { arm = json(trim(sh('/usr/sbin/shareos-power arm').out) || 'null'); } catch (e) { }
				try { j = json(trim(sh('/usr/sbin/shareos-power status').out) || 'null'); } catch (e) { }
				if (type(j) != 'object') j = { ok: true };
				if (a.enabled && type(arm) == 'object' && arm.error) j.arm_error = arm.error;
				return j;
			}
		},

		factory_reset: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true)
					return { error: 'confirm must be true' };
				let r = sh('/usr/sbin/shareos-factory-reset --yes --no-reboot');
				if (r.rc != 0)
					return { error: trim(r.out) };
				system('(sleep 2; reboot) >/dev/null 2>&1 &');
				return { rebooting: true };
			}
		},

		set_password: {
			args: { password: '' },
			call: function(req) {
				let e = set_password(req.args.password);
				return e ? { error: e } : { ok: true };
			}
		},

		set_hostname: {
			args: { hostname: '' },
			call: function(req) {
				let h = req.args.hostname ?? '';
				if (!set_hostname(h)) return { error: 'invalid hostname' };
				return { ok: true, hostname: h, cert_renewed: cert_refresh() };
			}
		}
	},

	'shareos.service': {
		list: {
			call: function() {
				let list = [], names = proc_names(), off = autostart_off(), c = cursor();
				// descriptions that depend on the settings
				let desc = (name, d) => {
					if (name == 'uhttpd')
						return c.get('shareos', 'web', 'https') != '0' && stat(c.get('shareos', 'web', 'cert') ?? '/etc/ssl/shareos/server.crt')
							? 'uhttpd, ports 80 and 443' : 'uhttpd, port 80';
					if (name == 'zabbix') {
						let act = !!c.get('zabbix', 'main', 'server'), pas = c.get('zabbix', 'main', 'passive') == '1';
						return act && pas ? 'zabbix_agentd, active and passive mode' : pas ? 'zabbix_agentd, passive mode' : 'zabbix_agentd, active mode';
					}
					return d;
				};
				for (let name in sort(keys(SERVICES))) {
					let s = SERVICES[name];
					if (!init_script(name) || (s.needs && !stat(s.needs)))
						continue;
					// the board service is the MCU daemon only on boxes with that MCU
					let proc = name == 'board' && board().control && board().control != 'mcu' ? 'shareos-board' : s.proc;
					push(list, { name, label: s.label, desc: desc(name, s.desc), running: running(proc, names), essential: !!ESSENTIAL[name],
						autostart: !(name in off) });
				}
				for (let s in sys_services()) {
					let t = SYS_SVC_TEXT[s.control];
					push(list, { name: s.control, label: t?.label ?? s.name, desc: desc(s.control, t?.desc ?? s.id), running: running(t?.proc ?? s.proc, names),
						essential: false, autostart: !(s.control in off), sysapp: s.id });
				}
				return { services: list };
			}
		},

		action: {
			args: { name: '', action: '' },
			call: function(req) {
				let name = req.args.name, act = req.args.action;
				if (!(act in { start: 1, stop: 1, restart: 1 }))
					return { error: 'unknown action' };
				let script = SERVICES[name] ? init_script(name) : null;
				let svc = script ? null : sys_service(name);
				if (svc) {
					// start = what the boot does (the controller follows its settings)
					let ctl = '/usr/sbin/shareos-' + svc.control;
					let r = sh(act == 'start' ? ctl + ' boot' : act == 'stop' ? ctl + ' stop-all' : ctl + ' stop-all; ' + ctl + ' boot');
					return { ok: r.rc == 0, output: trim(r.out), running: settled(SYS_SVC_TEXT[svc.control]?.proc ?? svc.proc, act != 'stop') };
				}
				if (!script)
					return { error: 'unknown service' };
				if (act == 'stop' && ESSENTIAL[name])
					return { error: 'this service cannot be stopped from the web interface' };
				if (act == 'restart' && ESSENTIAL[name]) {
					// answer first, the restart may cut this connection
					system(sprintf('(sleep 1; %s restart) >/dev/null 2>&1 &', shq(script)));
					return { ok: true, delayed: true };
				}
				let r = sh(shq(script) + ' ' + act);
				let proc = name == 'board' && board().control && board().control != 'mcu' ? 'shareos-board' : SERVICES[name].proc;
				return { ok: r.rc == 0, output: trim(r.out), running: settled(proc, act != 'stop') };
			}
		},

		autostart: {
			args: { name: '', enabled: true },
			call: function(req) {
				let name = req.args.name;
				if (!(SERVICES[name] && init_script(name)) && !sys_service(name)) return { error: 'unknown service' };
				if (ESSENTIAL[name] && !req.args.enabled) return { error: 'this service is always started' };
				let off = autostart_off();
				if (req.args.enabled) delete off[name]; else off[name] = true;
				let c = cursor();
				c.set('shareos', 'autostart', 'autostart');
				c.delete('shareos', 'autostart', 'disabled');
				if (length(keys(off))) c.set('shareos', 'autostart', 'disabled', sort(keys(off)));
				c.commit('shareos');
				return { ok: true, name, autostart: !off[name] };
			}
		}
	},

	'shareos.hw': {
		get: {
			call: function() {
				return { fan: fan_settings(), led: led_settings(), presets: FAN_PRESETS,
					temperature: box_temp(), fan_pwm: read_int('/tmp/sys/pwm1'), board_control: memo('boardctl', '', 10, board_control) };
			}
		},

		set_fan: {
			args: { preset: '', off_temp: 0, full_temp: 0, half_temp: 0 },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.preset != 'custom' && !FAN_PRESETS[a.preset ?? '']) return { error: 'unknown preset' };
				c.set('shareos', 'fan', 'fan');
				c.set('shareos', 'fan', 'preset', a.preset);
				if (a.preset == 'custom') {
					let o = +a.off_temp, f = +a.full_temp, h = +a.half_temp;
					if (!(f >= 35 && f <= 70) || !(h >= 30 && h < f) || !(o == 0 || (o >= 25 && o < h)))
						return { error: 'invalid temperatures (0 or 25 <= off < half < full <= 70)' };
					c.set('shareos', 'fan', 'off_temp', '' + o);
					c.set('shareos', 'fan', 'full_temp', '' + f);
					c.set('shareos', 'fan', 'half_temp', '' + h);
				}
				c.commit('shareos');
				return { ok: true, fan: fan_settings() };
			}
		},

		set_led: {
			args: { status: '', power: '', disks: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				c.set('shareos', 'led', 'led');
				if (a.status) { if (!(a.status in { heartbeat: 1, on: 1, off: 1 })) return { error: 'invalid status LED mode' }; c.set('shareos', 'led', 'status', a.status); }
				if (a.power) { if (!(a.power in { on: 1, off: 1, blink: 1 })) return { error: 'invalid power LED mode' }; c.set('shareos', 'led', 'power', a.power); }
				if (a.disks) { if (!(a.disks in { off: 1, activity: 1 })) return { error: 'invalid disk LED mode' }; c.set('shareos', 'led', 'disks', a.disks); }
				c.commit('shareos');
				sh('/usr/sbin/shareos-leds');
				return { ok: true, led: led_settings() };
			}
		}
	},

	'shareos.setup': {
		// public (also before login): is this box still waiting to be claimed?
		claim_state: {
			call: function() { return { unclaimed: root_locked(), window: claim_window(), seconds: CLAIM_SECS }; }
		},

		// public: first password of a new box; only while root is locked and
		// the USB button was pressed within the last 2 minutes
		claim: {
			args: { password: '' },
			call: function(req) {
				if (!root_locked()) return { error: 'already claimed' };
				if (!claim_window()) return { error: 'press the USB button first' };
				let pw = req.args.password ?? '';
				if (length(pw) < ROOT_PW_MIN) return { error: 'password too short (min. ' + ROOT_PW_MIN + ')' };
				if (lc(pw) == 'shareos') return { error: 'choose your own password' };
				let e = set_password(pw);
				if (e) return { error: e };
				unlink(CLAIM_WINDOW);
				unlink('/overlay/claim');
				sh('logger -t shareos-claim "box claimed"');
				return { ok: true };
			}
		},

		status: {
			call: function() {
				let c = cursor();
				return { done: c.get('shareos', 'setup', 'done') == '1', default_password: default_password(), hostname: read_trim('/proc/sys/kernel/hostname'),
					timezone: timezone(), lang: c.get('shareos', 'ui', 'lang') ?? 'en', channel: c.get('shareos', 'update', 'channel') ?? 'stable' };
			}
		},

		zones: {
			call: function() { return { zones: zones(), current: timezone() }; }
		},

		altf: {
			call: function() { return altf_scan(); }
		},

		// first-run wizard: everything optional except marking it done
		apply: {
			args: { password: '', hostname: '', timezone: '', channel: '', altf: false },
			call: function(req) {
				let a = req.args, c = cursor(), done = [];
				if (a.altf === true) {
					let r = sh('/usr/sbin/shareos-altf import');
					for (let line in split(r.out, '\n')) {
						let m = match(line, /^imported=(.*)$/);
						if (m) push(done, 'altf:' + m[1]);
					}
				}
				if (a.hostname) { if (!set_hostname(a.hostname)) return { error: 'invalid hostname' }; push(done, 'hostname'); }
				if (a.timezone) { if (!set_timezone(a.timezone)) return { error: 'unknown time zone' }; push(done, 'timezone'); }
				if (a.channel) {
					if (!channel_ok(a.channel)) return { error: 'invalid channel' };
					c.set('shareos', 'update', 'channel', a.channel); push(done, 'channel');
				}
				if (a.password) { let e = set_password(a.password); if (e) return { error: e }; push(done, 'password'); }
				c.set('shareos', 'setup', 'setup');
				c.set('shareos', 'setup', 'done', '1');
				c.commit('shareos');
				return { ok: true, done };
			}
		},

		reset: {
			// show the wizard again on the next login
			call: function() {
				let c = cursor();
				c.set('shareos', 'setup', 'setup');
				c.set('shareos', 'setup', 'done', '0');
				c.commit('shareos');
				return { ok: true };
			}
		}
	}
});
