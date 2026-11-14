return {
	'shareos.ui': {
		// public (also before login): language and logo for the login page
		get: {
			call: function() { return { ...ui_settings(), default_password: default_password() }; }
		},

		set: {
			args: { lang: '', logo: false, theme: '', accent: '', areas: {} },
			call: function(req) {
				let c = cursor();
				c.set('shareos', 'ui', 'ui');   // section may be missing in configs from older versions
				let changed = {};
				if (type(req.args.areas) == 'object')
					for (let a in AREAS) if (req.args.areas[a] != null) {
						let v = req.args.areas[a] ? '1' : '0';
						if ((c.get('shareos', 'ui', 'area_' + a) ?? '1') != v) changed[a] = v;
						c.set('shareos', 'ui', 'area_' + a, v);
					}
				if (req.args.lang != null && req.args.lang != '') {
					if (!match(req.args.lang, /^[a-z]{2}(-[A-Za-z]{2})?$/)) return { error: 'invalid language' };
					c.set('shareos', 'ui', 'lang', req.args.lang);
				}
				if (req.args.logo != null)
					c.set('shareos', 'ui', 'logo', req.args.logo ? '1' : '0');
				if (req.args.theme) {
					if (!THEMES[req.args.theme]) return { error: 'invalid theme' };
					c.set('shareos', 'ui', 'theme', req.args.theme);
				}
				if (req.args.accent) {
					if (!ACCENTS[req.args.accent]) return { error: 'invalid accent' };
					c.set('shareos', 'ui', 'accent', req.args.accent);
				}
				c.commit('shareos');
				if (length(changed)) {
					system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
					if (changed.apps) system('/etc/init.d/S51apps ' + (changed.apps == '1' ? 'start' : 'stop') + ' >/dev/null 2>&1');
				}
				return ui_settings();
			}
		}
	},

	'shareos.web': {
		get: {
			call: function() {
				let c = cursor();
				let wh = web_host();
				return { https: c.get('shareos', 'web', 'https') != '0', redirect: c.get('shareos', 'web', 'redirect') == '1', cert: cert_info(),
					host: c.get('shareos', 'web', 'host') ?? '', cert_host: cert_host(), source: c.get('shareos', 'web', 'source') ?? '' };
			}
		},

		set: {
			args: { https: true, redirect: false, host: '' },
			call: function(req) {
				let c = cursor();
				let h = req.args.host;
				if (h != null && h != '' && !match(h, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,250}[A-Za-z0-9])?$/)) return { error: 'invalid host name' };
				c.set('shareos', 'web', 'web');
				if (h != null) {
					if (h == '') c.delete('shareos', 'web', 'host'); else c.set('shareos', 'web', 'host', lc(h));
					if (req.args.https == null && req.args.redirect == null) { c.commit('shareos'); return { ok: true }; }
				}
				if (req.args.https != null) c.set('shareos', 'web', 'https', req.args.https ? '1' : '0');
				if (req.args.redirect != null) c.set('shareos', 'web', 'redirect', req.args.redirect ? '1' : '0');
				c.commit('shareos');
				restart_uhttpd();
				return { ok: true };
			}
		},

		selfsigned: {
			call: function() {
				let r = sh(CERT + ' selfsigned'); forget('cert');
				if (r.rc != 0) return { error: trim(r.out) };
				web_source('');
				restart_uhttpd();
				return { ok: true, cert: cert_info() };
			}
		},

		// dynamic DNS (shareos-ddns); the token is never sent back
		ddns_get: {
			call: function() { return jparse(trim(sh('/usr/sbin/shareos-ddns status').out) || 'null') ?? { error: 'shareos-ddns failed' }; }
		},

		ddns_set: {
			args: { enabled: false, provider: '', host: '', token: '', user: '', url: '', ipv4: true, ipv6: false },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.provider && !(a.provider in { duckdns: 1, dynv6: 1, cloudflare: 1, noip: 1, custom: 1 })) return { error: 'invalid provider' };
				if (a.host && !match(a.host, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/)) return { error: 'invalid host name' };
				if (a.url && !match(a.url, /^https?:\/\/[^ ]+$/)) return { error: 'invalid URL' };
				for (let k in [ 'token', 'user', 'url' ]) if (length(a[k] ?? '') > 512 || match(a[k] ?? '', /[\n\r]/)) return { error: 'invalid ' + k };
				c.set('shareos', 'ddns', 'ddns');
				c.set('shareos', 'ddns', 'enabled', a.enabled ? '1' : '0');
				for (let k in [ 'provider', 'host', 'user', 'url' ])
					if (a[k] != null) { if (a[k] == '') c.delete('shareos', 'ddns', k); else c.set('shareos', 'ddns', k, k == 'host' ? lc(a[k]) : a[k]); }
				// empty: keep the stored token
				if (a.token) c.set('shareos', 'ddns', 'token', a.token);
				if (a.ipv4 != null) c.set('shareos', 'ddns', 'ipv4', a.ipv4 ? '1' : '0');
				if (a.ipv6 != null) c.set('shareos', 'ddns', 'ipv6', a.ipv6 ? '1' : '0');
				c.commit('shareos');
				system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
				system('rm -f /tmp/shareos-ddns.json');
				if (a.enabled) system('(/usr/sbin/shareos-ddns update force) >/dev/null 2>&1 &');
				return { ok: true, pending: !!a.enabled };
			}
		},

		ddns_update: {
			call: function() {
				system('(/usr/sbin/shareos-ddns update force) >/dev/null 2>&1 &');
				return { ok: true, pending: true };
			}
		},

		// own certificate authority (shareos-ca)
		ca_get: {
			call: function() {
				let i = jparse(trim(sh('/usr/sbin/shareos-ca info').out) || 'null') ?? { exists: false };
				i.certs = i.exists ? (jparse(trim(sh('/usr/sbin/shareos-ca list').out) || '[]') ?? []) : [];
				i.web = cursor().get('shareos', 'web', 'source') == 'ca';
				return i;
			}
		},

		ca_init: {
			call: function() {
				let r = sh('/usr/sbin/shareos-ca init');
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		ca_issue: {
			args: { name: '', hosts: [] },
			call: function(req) {
				let n = req.args.name ?? '', h = req.args.hosts;
				if (!match(n, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/)) return { error: 'invalid name' };
				if (type(h) != 'array' || !length(h) || length(h) > 20) return { error: 'no host names' };
				for (let x in h) if (type(x) != 'string' || !match(x, /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/)) return { error: 'invalid host name: ' + x };
				let r = sh('/usr/sbin/shareos-ca issue ' + shq(n) + ' ' + join(' ', map(h, shq)));
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		// PEM: root (the CA), or crt/key of an issued certificate
		ca_pem: {
			args: { name: '', kind: '' },
			call: function(req) {
				let n = req.args.name ?? '', k = req.args.kind ?? '';
				let r = k == 'root' ? sh('/usr/sbin/shareos-ca root')
					: match(n, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/) && (k == 'crt' || k == 'key') ? sh('/usr/sbin/shareos-ca show ' + shq(n) + ' ' + k)
					: null;
				if (!r) return { error: 'invalid request' };
				return r.rc == 0 ? { pem: r.out } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		ca_delete: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name ?? '';
				if (!match(n, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/)) return { error: 'invalid name' };
				let r = sh('/usr/sbin/shareos-ca delete ' + shq(n));
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-ca: ', '') };
			}
		},

		// the web interface gets a certificate of the own CA
		ca_web: {
			call: function() {
				let r = sh('/usr/sbin/shareos-ca web'); forget('cert');
				if (r.rc != 0) return { error: replace(trim(r.out), 'shareos-ca: ', '') };
				system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
				restart_uhttpd();
				return { ok: true };
			}
		},

		// Let's Encrypt for the DynDNS name (shareos-acme, takes up to a few minutes)
		acme_get: {
			call: function() {
				let j = jparse(trim(sh('/usr/sbin/shareos-acme status').out) || 'null') ?? {};
				j.running = acme_running();
				return j;
			}
		},

		acme_issue: {
			args: { email: '', staging: false },
			call: function(req) {
				let m = req.args.email ?? '';
				if (m != '' && !match(m, /^[^@ ]+@[^@ ]+\.[^@ ]+$/)) return { error: 'invalid e-mail address' };
				if (acme_running()) return { error: 'already running' };
				let c = cursor();
				c.set('shareos', 'acme', 'acme');
				if (m == '') c.delete('shareos', 'acme', 'email'); else c.set('shareos', 'acme', 'email', m);
				c.commit('shareos');
				system('(touch /tmp/shareos-acme.running; /usr/sbin/shareos-acme issue ' + (req.args.staging ? 'staging' : '') +
					' >/tmp/shareos-acme.out 2>&1; rm -f /tmp/shareos-acme.running) >/dev/null 2>&1 &');
				forget('cert');
				return { ok: true, running: true };
			}
		},

		acme_off: {
			call: function() {
				let r = sh('/usr/sbin/shareos-acme off'); forget('cert');
				return r.rc == 0 ? { ok: true } : { error: replace(trim(r.out), 'shareos-acme: ', '') };
			}
		},

		install: {
			// PEM texts; the certificate may be followed by the chain
			args: { cert: '', key: '' },
			call: function(req) {
				let crt = req.args.cert ?? '', key = req.args.key ?? '';
				if (length(crt) > 65536 || length(key) > 16384) return { error: 'file too large' };
				let d = trim(sh_quiet('mktemp -d').out);
				if (!match(d, /^\/tmp\/[A-Za-z0-9._-]+$/)) return { error: 'no room for temporary files' };
				writefile(d + '/crt', crt);
				writefile(d + '/key', key);
				let r = sh(CERT + ' install ' + shq(d + '/crt') + ' ' + shq(d + '/key')); forget('cert');
				system('rm -rf ' + shq(d));
				if (r.rc != 0) return { error: replace(trim(r.out), 'shareos-cert: ', '') };
				web_source('');
				restart_uhttpd();
				return { ok: true, cert: cert_info() };
			}
		}
	},

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

	'shareos.net': {
		get: {
			call: function() {
				return { ...net_settings(), ...net_state(), timeout: NET_TIMEOUT };
			}
		},

		// takes effect at once; rolled back unless confirmed within NET_TIMEOUT
		set: {
			args: { proto: '', ipaddr: '', netmask: '', gateway: '', dns: [], confirm: false },
			call: function(req) {
				let a = req.args;
				if (!a.confirm) return { error: 'confirm required' };
				if (net_state().pending) return { error: 'a network change is still waiting for confirmation' };
				if (!(a.proto in { dhcp: 1, static: 1 })) return { error: 'invalid mode' };
				let dns = filter(a.dns ?? [], (x) => x != '');
				let gw = a.gateway ?? '';
				if (a.proto == 'static') {
					if (!ip4_ok(a.ipaddr)) return { error: 'invalid IP address' };
					let pfx = mask_prefix(a.netmask);
					if (pfx == null || pfx < 8 || pfx > 30) return { error: 'invalid subnet mask' };
					let net = (x) => int(ip4_num(x) / (pow2(32 - pfx)));
					let host = ip4_num(a.ipaddr) % (pow2(32 - pfx));
					if (host == 0 || host == pow2(32 - pfx) - 1) return { error: 'the IP address is the network or broadcast address' };
					if (gw != '') {
						if (!ip4_ok(gw)) return { error: 'invalid gateway' };
						if (net(gw) != net(a.ipaddr)) return { error: 'the gateway is not in the same network' };
						if (gw == a.ipaddr) return { error: 'gateway and IP address are the same' };
					}
					if (length(dns) > 3) return { error: 'at most 3 DNS servers' };
					for (let d in dns) if (!ip4_ok(d)) return { error: 'invalid DNS server ' + d };
				}
				system('mkdir -p /etc/shareos && cp /etc/config/network ' + NET_ROLLBACK);
				let c = cursor();
				c.set('network', 'lan', 'interface');
				c.set('network', 'lan', 'ifname', 'eth0');
				c.set('network', 'lan', 'proto', a.proto);
				if (a.proto == 'static') {
					c.set('network', 'lan', 'ipaddr', a.ipaddr);
					c.set('network', 'lan', 'netmask', a.netmask);
					c.set('network', 'lan', 'gateway', gw);
					c.set('network', 'lan', 'dns', join(' ', dns));
				}
				c.commit('network');
				system(sprintf('rm -f %s/result; start-stop-daemon -S -b -x %s -- apply %d', NET_ST, NET, NET_TIMEOUT));
				return { ok: true, timeout: NET_TIMEOUT, address: a.proto == 'static' ? a.ipaddr : null };
			}
		},

		confirm: {
			call: function() {
				if (!net_state().pending) return { ok: true, pending: false };
				system(NET + ' confirm');
				return { ok: true, cert_renewed: cert_refresh() };
			}
		},

		// hide the "rolled back" message
		dismiss: {
			call: function() {
				unlink(NET_ST + '/result');
				return { ok: true };
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

	'shareos.time': {
		get: {
			call: function() { return time_info(); }
		},

		// timezone, ntp (on/off), servers (host names or IPs, at most 5)
		set: {
			args: { timezone: '', ntp: true, servers: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.timezone && !set_timezone(a.timezone)) return { error: 'unknown time zone' };
				if (a.servers != null) {
					if (type(a.servers) != 'array' || length(a.servers) > 5) return { error: 'at most 5 servers' };
					for (let x in a.servers)
						if (type(x) != 'string' || !match(x, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,252}[A-Za-z0-9])?$/) && !match(x, /^[0-9a-fA-F:]+$/))
							return { error: 'invalid server: ' + x };
				}
				c.set('shareos', 'time', 'time');
				if (a.ntp != null) c.set('shareos', 'time', 'ntp', a.ntp ? '1' : '0');
				if (a.servers != null) {
					c.delete('shareos', 'time', 'server');
					if (length(a.servers)) c.set('shareos', 'time', 'server', a.servers);
				}
				c.commit('shareos');
				system('/etc/init.d/S45ntpd restart >/dev/null 2>&1');
				return time_info();
			}
		},

		// ask the servers once now (takes a few seconds)
		sync: {
			call: function() {
				let args = join(' ', map(ntp_servers(cursor()), (x) => '-p ' + shq(x)));
				let r = sh('timeout 20 ntpd -q -n ' + args);
				if (r.rc != 0) return { error: 'no answer from the time servers' };
				rtc_save();
				writefile('/tmp/shareos-ntp/last', time() + ' manual\n');
				return time_info();
			}
		},

		// set the clock by hand: time = seconds since 1970 (UTC)
		set_clock: {
			args: { time: 0 },
			call: function(req) {
				let t = +req.args.time;
				if (!(t >= 1735689600 && t < 4102444800)) return { error: 'invalid time' };   // 2025 … 2099
				let g = gmtime(t);
				let r = sh(sprintf('date -u -s "%04d-%02d-%02d %02d:%02d:%02d"', g.year, g.mon, g.mday, g.hour, g.min, g.sec));
				if (r.rc != 0) return { error: 'setting the clock failed' };
				rtc_save();
				return time_info();
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
	},

	'shareos.storage': {
		// only the volumes (name, mounted, size): for pages that need no disks,
		// SMART or arrays – one df instead of a dozen programs
		volumes: {
			call: function() { return { volumes: volumes(), apps: cursor().get('storage', 'global', 'apps') }; }
		},

		status: {
			call: function() {
				let disks = [];
				for (let d in lsblk()) {
					if (d.type != 'disk' || !match(d.name, /^sd[a-z]$/)) continue;
					d.usb = is_usb(d.name);
					d.smart = d.usb ? null : smart_read(d.name, false);
					// CHECK POWER MODE does not wake a sleeping disk
					d.standby = disk_standby_memo(d.name);
					push(disks, d);
				}
				let c = cursor();
				let swaps = [];
				for (let line in slice(split(readfile('/proc/swaps') ?? '', '\n'), 1)) {
					let f = split(trim(line), /\s+/);
					if (length(f) >= 4) push(swaps, { device: f[0], size: +f[2] * 1024, used: +f[3] * 1024 });
				}
				return {
					disks,
					swaps,
					apps: c.get('storage', 'global', 'apps'),
					arrays: mdstat(),
					volumes: volumes(),
					spindown: +(c.get('storage', 'global', 'spindown') ?? 0),
					smart_schedule: c.get('storage', 'global', 'smart_test') ?? '',
					usb: usb_mounts(),
					usb_copy: usb_copy_info(),
					job: storage_job()
				};
			}
		},

		smart: {
			args: { disk: '' },
			call: function(req) {
				if (!valid_disk(req.args.disk))
					return { error: 'unknown disk' };
				return smart_read(req.args.disk, true);
			}
		},

		// SMART self-test: short (minutes) | long (hours, reads the whole
		// disk) | abort; the disk wakes up for it. The values are read again
		// right away, so the running test shows.
		smart_test: {
			args: { disk: '', type: '' },
			call: function(req) {
				let d = req.args.disk, t = req.args.type;
				if (!valid_disk(d) || is_usb(d)) return { error: 'unknown disk' };
				let opt = { short: '-t short', long: '-t long', abort: '-X' }[t];
				if (!opt) return { error: 'invalid test' };
				let r = sh('smartctl ' + opt + ' /dev/' + d);
				// exit bits 0-2: command line, open, SMART command failed (the others are the disk's state)
				if (r.rc & 7) { let l = filter(split(trim(r.out), '\n'), (x) => length(trim(x))); return { error: trim(l[length(l) - 1] ?? '') || 'failed' }; }
				return smart_read(d, true);
			}
		},

		// self-tests by schedule: '' (none) | short_weekly (Sunday 03:30) |
		// long_monthly (1st of the month, 03:30) – see shareos-cron
		smart_schedule: {
			args: { mode: '' },
			call: function(req) {
				let m = req.args.mode ?? '';
				if (index([ '', 'short_weekly', 'long_monthly' ], m) < 0) return { error: 'invalid value' };
				let c = cursor();
				if (c.get('storage', 'global') != 'global') c.set('storage', 'global', 'global');
				if (m == '') c.delete('storage', 'global', 'smart_test'); else c.set('storage', 'global', 'smart_test', m);
				c.save('storage'); c.commit('storage');
				system(CRON + ' sync >/dev/null 2>&1');
				return { ok: true, mode: m };
			}
		},

		setup: {
			// layout mirror (RAID 1) | stripe (RAID 0) | span (JBOD): name + disks[2];
			// layout single: volumes [{name, disk}]
			// fs: ext4 (default), ext3, ext2, btrfs, exfat, ntfs, vfat – volumes may carry their own
			args: { layout: '', name: '', disks: [], volumes: [], swap: 1024, fs: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true)
					return { error: 'confirm must be true' };
				let swap = a.swap == null ? 1024 : +a.swap;
				if (!(swap >= 0 && swap <= 8192))
					return { error: 'invalid swap size' };
				let sw = '--swap=' + int(swap);
				let fs = a.fs || 'ext4';
				if (!FS_DISK[fs]) return { error: 'invalid file system' };
				let j = storage_job();
				if (j?.state == 'running')
					return { error: 'a storage job is already running' };
				if (a.layout == 'mirror' || a.layout == 'stripe' || a.layout == 'span') {
					if (!valid_name(a.name)) return { error: 'invalid name' };
					if (type(a.disks) != 'array' || length(a.disks) != 2 || a.disks[0] == a.disks[1] ||
					    !valid_disk(a.disks[0]) || !valid_disk(a.disks[1]))
						return { error: 'two different disks are needed' };
					if (is_usb(a.disks[0]) || is_usb(a.disks[1]))
						return { error: 'USB drives are formatted with usb_format' };
					return spawn_storage([ 'setup', a.layout, a.name, a.disks[0], a.disks[1], sw, '--fs=' + fs, '--yes' ]);
				}
				if (a.layout == 'single') {
					if (type(a.volumes) != 'array' || !length(a.volumes))
						return { error: 'no disks given' };
					let args = [ 'setup', 'single' ], seen = {};
					for (let v in a.volumes) {
						if (!valid_name(v?.name) || !valid_disk(v?.disk) || seen[v.name] || seen[v.disk])
							return { error: 'invalid name or disk' };
						if (v.fs && !FS_DISK[v.fs]) return { error: 'invalid file system' };
						if (is_usb(v.disk)) return { error: 'USB drives are formatted with usb_format' };
						seen[v.name] = seen[v.disk] = true;
						push(args, v.name + '=' + v.disk + ':' + (v.fs || fs));
					}
					push(args, sw, '--yes');
					return spawn_storage(args);
				}
				return { error: 'unknown layout' };
			}
		},

		// a mirror with a missing disk: erase a disk and add it
		repair: {
			args: { name: '', disk: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true) return { error: 'confirm must be true' };
				if (!valid_name(a.name)) return { error: 'invalid name' };
				if (cursor().get('storage', a.name, 'layout') != 'mirror') return { error: 'not a mirror' };
				if (!valid_disk(a.disk)) return { error: 'invalid disk' };
				if (is_usb(a.disk)) return { error: 'USB drives cannot be part of a mirror' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is already running' };
				return spawn_storage([ 'repair', a.name, a.disk, '--yes' ]);
			}
		},

		// a partition that already has a file system (Alt-F, D-Link) becomes
		// a volume as it is – nothing is erased
		adopt: {
			args: { name: '', part: '' },
			call: function(req) {
				let n = req.args.name, p = req.args.part;
				if (!valid_name(n)) return { error: 'invalid name' };
				if (!match(p ?? '', /^(sd[a-z]+[0-9]+|md[0-9]+)$/)) return { error: 'invalid partition' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is running' };
				let r = sh(STORAGE + ' adopt ' + shq(n) + ' ' + shq(p));
				if (r.rc != 0) return { error: trim(replace(r.out, /^.*ERROR: /s, '')) || 'adopt failed' };
				system(USERS + ' sync >/dev/null 2>&1');
				return { ok: true };
			}
		},

		volume: {
			args: { name: '', action: '' },
			call: function(req) {
				let n = req.args.name, act = req.args.action;
				if (!valid_name(n)) return { error: 'invalid name' };
				if (!(act in { mount: 1, umount: 1, forget: 1 })) return { error: 'unknown action' };
				let r = sh(STORAGE + ' ' + act + ' ' + shq(n));
				if (r.rc == 0) system(USERS + ' sync >/dev/null 2>&1');
				return r.rc == 0 ? { ok: true } : { error: trim(r.out) || act + ' failed' };
			}
		},

		// USB stick/disk: unmount and power down, then it can be pulled
		usb_eject: {
			args: { disk: '' },
			call: function(req) {
				if (!is_usb(req.args.disk)) return { error: 'not a USB drive' };
				let r = sh(USB + ' eject ' + req.args.disk);
				if (r.rc != 0) return { error: replace(trim(r.out), /^error: /, '') || 'eject failed' };
				return { ok: true };
			}
		},

		// erase a USB stick/disk: one partition, fs: exfat (default), vfat, ntfs, ext4
		// USB button: short press copies the USB drives into volume/path
		usb_copy_config: {
			args: { enabled: false, volume: '', path: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (type(a.enabled) != 'bool') return { error: 'invalid value' };
				let path = trim(a.path ?? '') || folder_name('usb');
				for (let part in split(path, '/')) if (!name_ok(part) || substr(part, 0, 1) == '.') return { error: 'invalid folder' };
				if (a.enabled || a.volume) {
					if (!valid_name(a.volume) || c.get('storage', a.volume) != 'volume') return { error: 'unknown volume' };
				}
				if (c.get('shareos', 'usbcopy') != 'usbcopy') c.set('shareos', 'usbcopy', 'usbcopy');
				c.set('shareos', 'usbcopy', 'enabled', a.enabled ? '1' : '0');
				c.set('shareos', 'usbcopy', 'volume', a.volume ?? '');
				c.set('shareos', 'usbcopy', 'path', path);
				c.save('shareos'); c.commit('shareos');
				return usb_copy_info();
			}
		},

		// copy now (like a short press of the USB button)
		usb_copy: {
			call: function() {
				let i = usb_copy_info();
				if (!i.volume) return { error: 'no target set' };
				if (stat('/tmp/shareos-usb.copy.lock')) return { error: 'already running' };
				if (!length(usb_mounts())) return { error: 'no USB drive' };
				system(sprintf('start-stop-daemon -S -b -x %s -- copy', USB));
				return { started: true };
			}
		},

		usb_format: {
			args: { disk: '', fs: '', name: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true) return { error: 'confirm must be true' };
				if (!is_usb(a.disk)) return { error: 'not a USB drive' };
				let fs = a.fs || 'exfat';
				if (!FS_USB[fs]) return { error: 'invalid file system' };
				if (type(a.name) != 'string' || !match(a.name, /^[A-Za-z0-9 _-]{1,16}$/)) return { error: 'invalid name' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is already running' };
				system(sprintf('start-stop-daemon -S -b -x %s -- format %s %s %s --yes', USB, a.disk, fs, shq(a.name)));
				return { started: true };
			}
		},

		// hide the message of a finished or failed setup job
		job_clear: {
			call: function() {
				if (storage_job()?.state == 'running')
					return { error: 'a storage job is running' };
				unlink(SMART_DIR + '/job');
				return { ok: true };
			}
		},

		spindown: {
			args: { minutes: 0 },
			call: function(req) {
				let m = +req.args.minutes;
				if (m < 0 || m > 330) return { error: 'invalid value' };
				let r = sh(STORAGE + ' spindown ' + m);
				return r.rc == 0 ? { ok: true, minutes: m } : { error: trim(r.out) };
			}
		}
	},


	'shareos.accounts': {
		list: {
			call: function() { return accounts(); }
		},

		add: {
			args: { name: '', role: '', password: '', fullname: '', groups: [], home: '', quota: 0, web: true, cloud: false, files: false },
			call: function(req) {
				let a = req.args;
				if (!acc_name_ok(a.name)) return { error: 'invalid name (a-z, 0-9 and _, starting with a letter)' };
				if (!(a.role in { admin: 1, user: 1, share: 1 })) return { error: 'invalid role' };
				let o = { ...a }; delete o.role;
				let r = tool_result(sh_pass(sprintf('%s add %s %s %s', USERS, shq(a.name), a.role, opt_args(o)), a.password));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		set: {
			args: { name: '', role: '', fullname: '', groups: [], home: '', quota: 0, web: true, cloud: false, files: false },
			call: function(req) {
				let a = req.args;
				if (!acc_name_ok(a.name)) return { error: 'invalid name' };
				let r = tool_result(sh(sprintf('%s set %s %s', USERS, shq(a.name), opt_args(a))));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		passwd: {
			args: { name: '', password: '' },
			call: function(req) {
				let n = req.args.name;
				if (!(n == 'root' || acc_name_ok(n))) return { error: 'invalid name' };
				return tool_result(sh_pass(sprintf('%s passwd %s', USERS, shq(n)), req.args.password));
			}
		},

		del: {
			args: { name: '', remove_home: false },
			call: function(req) {
				let n = req.args.name;
				if (!acc_name_ok(n)) return { error: 'invalid name' };
				if (n == session_user(req)) return { error: 'you cannot delete your own account' };
				let r = tool_result(sh(sprintf('%s del %s%s', USERS, shq(n), req.args.remove_home ? ' --remove-home' : '')));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		group_add: {
			args: { name: '', desc: '' },
			call: function(req) {
				let g = req.args.name;
				if (!acc_name_ok(g)) return { error: 'invalid name' };
				let r = tool_result(sh(sprintf('%s group-add %s %s', USERS, shq(g), shq('--desc=' + (req.args.desc ?? '')))));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		group_del: {
			args: { name: '' },
			call: function(req) {
				let g = req.args.name;
				if (!acc_name_ok(g)) return { error: 'invalid name' };
				let r = tool_result(sh(sprintf('%s group-del %s', USERS, shq(g))));
				return r.error ? r : { ok: true, ...accounts() };
			}
		},

		import_altf: {
			call: function() {
				let r = sh(USERS + ' import-altf');
				if (r.rc != 0) return tool_result(r);
				let im = match(r.out, /imported=([^\n]*)/), sk = match(r.out, /skipped=([^\n]*)/);
				return { ok: true, imported: im && im[1] != '' ? split(im[1], ' ') : [], skipped: sk && sk[1] != '' ? split(sk[1], ' ') : [], ...accounts() };
			}
		}
	},

	'shareos.shares': {
		list: {
			call: function() { return share_list(); }
		},

		// create or change a share
		set: {
			args: { name: '', volume: '', path: '', comment: '', smb: true, nfs: false, guest: false,
				rw: [], ro: [], nfs_rw: false, nfs_hosts: [], vault: false, vault_ttl: 0 },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!valid_name(a.name)) return { error: 'invalid name (a-z, 0-9, - and _, max. 16)' };
				if (a.name == 'homes' || a.name == 'global' || a.name == 'ipc') return { error: 'this name is reserved' };
				if (c.get('storage', a.volume) != 'volume') return { error: 'unknown volume' };
				let path = a.path ?? a.name;
				if (path == '' || !match(path, /^[A-Za-z0-9 ._-]+(\/[A-Za-z0-9 ._-]+)*$/) || match(path, /(^|\/)\.\.?(\/|$)/))
					return { error: 'invalid folder (letters, digits, space . _ - and /)' };
				if (match(a.comment ?? '', /[\n\r\[\]]/)) return { error: 'invalid description' };
				let accs = accounts(), known = {};
				for (let u in accs.users) known[u.name] = true;
				for (let g in accs.groups) known['@' + g.name] = true;
				for (let x in [ ...(a.rw ?? []), ...(a.ro ?? []) ]) if (!known[x]) return { error: 'unknown user or group ' + x };
				for (let h in a.nfs_hosts ?? [])
					if (!match(h, /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/[0-9]{1,2})?$|^\*$|^[A-Za-z0-9.-]+$/)) return { error: 'invalid NFS client ' + h };
				// a vault: only over SMB, only for named users (no guests, no NFS)
				let vault = a.vault ?? (c.get('shares', a.name, 'vault') == '1');
				if (vault && (!a.smb || a.guest || a.nfs)) return { error: 'a vault is shared over SMB only, without guests and NFS' };
				if (vault && !length([ ...(a.rw ?? []), ...(a.ro ?? []) ])) return { error: 'a vault needs at least one user or group' };
				if (vault && !vault_fs_ok(c, a.volume)) return { error: VAULT_FS_ERR };
				if (a.vault_ttl != null && a.vault_ttl !== 0 && !(+a.vault_ttl >= 1 && +a.vault_ttl <= 480)) return { error: 'invalid time (1–480 minutes)' };
				c.set('shares', 'global', 'global');
				c.set('shares', a.name, 'share');
				c.set('shares', a.name, 'volume', a.volume);
				c.set('shares', a.name, 'path', path);
				c.set('shares', a.name, 'comment', a.comment ?? '');
				for (let k in [ 'smb', 'nfs', 'guest', 'nfs_rw' ]) c.set('shares', a.name, k, a[k] ? '1' : '0');
				for (let k in [ 'rw', 'ro', 'nfs_hosts' ]) {
					c.delete('shares', a.name, k);
					if (length(a[k] ?? [])) c.set('shares', a.name, k, a[k]);
				}
				let was = c.get('shares', a.name, 'vault') == '1';
				c.set('shares', a.name, 'vault', vault ? '1' : '0');
				if (a.vault_ttl) c.set('shares', a.name, 'vault_ttl', '' + int(+a.vault_ttl));
				c.commit('shares');
				// switched off: forget who unlocked it; on or off: the cron entry
				if (was && !vault) sh(SHARES + ' vault-lock ' + shq(a.name));
				sh(SHARES + ' apply');
				if (was != vault) sh(CRON + ' sync');
				return { ok: true, ...share_list() };
			}
		},

		del: {
			args: { name: '' },
			call: function(req) {
				let c = cursor();
				if (!valid_name(req.args.name) || c.get('shares', req.args.name) != 'share') return { error: 'unknown share' };
				let was = c.get('shares', req.args.name, 'vault') == '1';
				if (was) sh(SHARES + ' vault-lock ' + shq(req.args.name));
				c.delete('shares', req.args.name);
				c.commit('shares');
				sh(SHARES + ' apply');
				if (was) sh(CRON + ' sync');
				return { ok: true, ...share_list() };   // the folder and its files stay
			}
		},

		// lock a vault now (for everybody, or for one user)
		vault_lock: {
			args: { name: '', user: '' },
			call: function(req) {
				let u = req.args.user;
				if (u && !acc_name_ok(u)) return { error: 'unknown user' };
				let r = vault_lock(req.args.name, u || null);
				return r.error ? r : { ok: true, ...share_list() };
			}
		},

		global: {
			args: { workgroup: '', smb: true, nfs: true, smb_compat: true },
			call: function(req) {
				let a = req.args, c = cursor();
				c.set('shares', 'global', 'global');
				if (a.workgroup) {
					if (!match(a.workgroup, /^[A-Za-z0-9_-]{1,15}$/)) return { error: 'invalid workgroup' };
					c.set('shares', 'global', 'workgroup', uc(a.workgroup));
				}
				if (a.smb != null) c.set('shares', 'global', 'smb', a.smb ? '1' : '0');
				if (a.nfs != null) c.set('shares', 'global', 'nfs', a.nfs ? '1' : '0');
				if (a.smb_compat != null) c.set('shares', 'global', 'smb_compat', a.smb_compat ? '1' : '0');
				c.commit('shares');
				sh(SHARES + ' apply');
				return { ok: true, ...share_list() };
			}
		}
	},

	'shareos.me': {
		// "Share with" of the installed app (Web Share Target): an upload
		// ticket for one shared file into the folder for shared files in the
		// personal folder ("Shared", named in the language of the box; one made
		// earlier in another language is used as it is); a name that is taken
		// gets " (2)", " (3)" … – nothing is replaced
		share_ticket: {
			args: { name: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u) return { error: 'not allowed' };
				if (!name_ok(a.name) || substr(a.name, 0, 1) == '.') return { error: 'invalid name' };
				let c = cursor(), mounts = readfile('/proc/mounts') ?? '', h = null;
				if (acc_role(u) == 'admin') h = admin_home(c, u, mounts);
				else {
					let r = filter(user_roots(c, u, mounts), (x) => x.home)[0];
					h = r?.path;
				}
				if (!h) return { error: 'no personal folder' };
				let folder = filter(folder_all_names('shared'), (x) => stat(h + '/' + x)?.type == 'directory')[0] ?? folder_name('shared');
				let d = h + '/' + folder;
				if (lstat(d) && stat(d)?.type != 'directory') return { error: 'not a folder: ' + folder };
				if (!lstat(d)) {
					let r = files_sh(u, 'mkdir -- ' + shq(d), false);
					if (r.rc != 0) return { error: files_err(r) };
				}
				let dot = rindex(a.name, '.'), n = a.name;
				let base = dot > 0 && length(a.name) - dot <= 11 ? substr(a.name, 0, dot) : a.name, ext = substr(a.name, length(base));
				for (let i = 2; lstat(d + '/' + n); i++) {
					if (i > 999) return { error: 'already exists' };
					n = base + ' (' + i + ')' + ext;
				}
				system('mkdir -p ' + FILES_TICKETS + ' && chmod 700 ' + FILES_TICKETS);
				system('find ' + FILES_TICKETS + ' -type f -mmin +5 -delete 2>/dev/null');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\n%s\n%s\n%d\n%s\n', acc_role(u) == 'admin' ? 'root' : u, d + '/' + n, time() + 120, pct_enc(n)));
				return { url: '/cgi-bin/files?t=' + t, name: n, folder };
			}
		},

		// vault shares of this account: unlock (password again) and lock
		vault_unlock: {
			args: { share: '', minutes: 0, password: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u) return { error: 'not allowed' };
				let r = vault_unlock(u, a.share, a.minutes || null, a.password);
				return r.error ? r : { ...r, ...me_info(u) };
			}
		},
		vault_lock: {
			args: { share: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'not allowed' };
				let c = cursor();
				if (!valid_name(req.args.share) || !vault_access(c, req.args.share, u)) return { error: 'not a vault' };
				let r = vault_lock(req.args.share, u);
				return r.error ? r : { ok: true, ...me_info(u) };
			}
		},

		// link this web session to the account that logged in
		bind: {
			args: { username: '', password: '' },
			call: function(req) {
				let u = req.args.username, sid = req.args.ubus_rpc_session;
				if (type(sid) != 'string' || !match(sid, /^[0-9a-f]{32}$/)) return { error: 'no session' };
				if (!(u == 'root' || acc_name_ok(u)) || !password_ok(u, req.args.password)) return { error: 'login failed' };
				system('mkdir -p ' + SESS_DIR + ' && chmod 700 ' + SESS_DIR);
				// drop links of sessions older than a week
				system('find ' + SESS_DIR + ' -type f -mtime +7 -delete 2>/dev/null');
				writefile(SESS_DIR + '/' + sid, u + '\n');
				return me_info(u);
			}
		},

		get: {
			call: function(req) {
				let u = session_user(req);
				return u ? me_info(u) : { error: 'session not bound' };
			}
		},


		paperless: {
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let u = session_user(req), c = cursor();
				if (!u || u == 'root') return { error: 'session not bound' };
				let g = paperless_global(c), name = 'u_' + u;
				return { url: g.url, available: g.url != '' && g.enabled && !!c.get('accounts', u, 'home'),
					inbox: c.get('paperless', name) == 'inbox' ? inbox_info(c, name) : null,
					folder: c.get('accounts', u, 'home') ? '\\\\' + read_trim('/proc/sys/kernel/hostname') + '\\' + u + '\\Paperless' : null };
			}
		},

		paperless_set: {
			args: { token: '', tags: [], enabled: true, test: false },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let u = session_user(req), c = cursor();
				if (!u || u == 'root') return { error: 'session not bound' };
				if (!c.get('accounts', u, 'home')) return { error: 'you have no personal folder' };
				if (!c.get('paperless', 'global', 'url')) return { error: 'Paperless is not set up on this box' };
				let a = req.args, name = 'u_' + u;
				if (a.token && !token_ok(a.token)) return { error: 'invalid token' };
				if (a.test) {
					let tok = a.token || c.get('paperless', name, 'token');
					if (!tok) return { error: 'token needed' };
					let r = sh_in(sprintf('%s test %s', PAPERLESS, shq(c.get('paperless', 'global', 'url'))), tok + '\n');
					let m = match(r.out, /ok documents=([0-9?]+)/);
					return m ? { ok: true, documents: m[1] } : tool_result(r);
				}
				if (!a.token && c.get('paperless', name) != 'inbox') return { error: 'token needed' };
				inbox_save(c, name, { owner: u, share: '', token: a.token, tags: a.tags, enabled: a.enabled });
				return { ok: true, inbox: inbox_info(c, name) };
			}
		},

		cloud: {
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { allowed: false };
				let c = cursor(), st = cloud_status();
				let shares = [];
				c.foreach('shares', 'share', (x) => { if (cloud_local_ok(c, u, 'share:' + x['.name'], 'upload')) push(shares, x['.name']); });
				return { allowed: true, installed: st.installed, remotes: cloud_remotes(u), jobs: cloud_jobs(c, u), shares };
			}
		},

		cloud_remote_add: {
			args: { name: '', type: '', params: {}, raw: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				let r = cloud_remote_add(u, req.args);
				return r.error ? r : { ok: true, remotes: cloud_remotes(u) };
			}
		},

		cloud_auth_start: {
			args: { type: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				return cloud_auth_start(u, req.args.type);
			}
		},

		cloud_auth_finish: {
			args: { url: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				return cloud_auth_finish(u, req.args.url);
			}
		},

		cloud_remote_del: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (!match(req.args.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				let r = tool_result(sh(CLOUD + ' remote-del ' + shq(u) + ' ' + shq(req.args.name)));
				return r.error ? r : { ok: true, remotes: cloud_remotes(u) };
			}
		},

		cloud_job_set: {
			args: { name: '', remote: '', remote_path: '', local: '', mode: '', schedule: '', bwlimit: '', enabled: true },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				let r = cloud_job_save(c, u, req.args);
				return r.error ? r : { ok: true, jobs: cloud_jobs(cursor(), u) };
			}
		},

		cloud_job_del: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (c.get('cloud', req.args.name) != 'job' || c.get('cloud', req.args.name, 'owner') != u) return { error: 'unknown job' };
				c.delete('cloud', req.args.name); c.commit('cloud');
				sh(CRON + ' sync');
				return { ok: true, jobs: cloud_jobs(cursor(), u) };
			}
		},

		cloud_job_run: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (c.get('cloud', req.args.name) != 'job' || c.get('cloud', req.args.name, 'owner') != u) return { error: 'unknown job' };
				return cloud_job_start(req.args.name);
			}
		},

		ui_set: {
			// own look; null/'' = back to the look for everyone
			args: { theme: '', accent: '' },
			call: function(req) {
				let u = session_user(req), a = req.args, c = cursor();
				if (!u || u == 'root' || c.get('accounts', u) != 'user') return { error: 'session not bound' };
				if (a.theme && !(a.theme in { dark: 1, light: 1, system: 1 })) return { error: 'invalid theme' };
				if (a.accent && !(a.accent in ACCENTS)) return { error: 'invalid accent' };
				for (let k in [ 'theme', 'accent' ]) {
					if (!(k in a)) continue;
					if (a[k]) c.set('accounts', u, k, a[k]); else c.delete('accounts', u, k);
				}
				c.commit('accounts');
				return { theme: c.get('accounts', u, 'theme') ?? null, accent: c.get('accounts', u, 'accent') ?? null };
			}
		},

		fav_set: {
			// favourite apps (ids, in order), whether the bar is shown and with names or icons only;
			// a missing key stays as it is
			args: { apps: [], bar: true, text: true },
			call: function(req) {
				let u = session_user(req), a = req.args, c = cursor();
				if (!u) return { error: 'session not bound' };
				let cfg = u == 'root' ? [ 'shareos', 'ui' ] : [ 'accounts', u ];
				if (u != 'root' && c.get('accounts', u) != 'user') return { error: 'session not bound' };
				if ('apps' in a) {
					if (type(a.apps) != 'array' || length(a.apps) > 64) return { error: 'invalid apps' };
					let ids = [];
					for (let id in a.apps) {
						if (type(id) != 'string' || !match(id, /^[a-z][a-z0-9-]{1,31}$/)) return { error: 'invalid app id' };
						if (index(ids, id) < 0) push(ids, id);
					}
					if (length(ids)) c.set(cfg[0], cfg[1], 'fav', ids); else c.delete(cfg[0], cfg[1], 'fav');
				}
				for (let k in [ 'bar', 'text' ]) {
					if (!(k in a)) continue;
					if (type(a[k]) != 'bool') return { error: 'invalid ' + k };
					if (a[k]) c.delete(cfg[0], cfg[1], 'fav_' + k); else c.set(cfg[0], cfg[1], 'fav_' + k, '0');
				}
				c.commit(cfg[0]);
				return fav_of(cursor(), u);
			}
		},

		// desktop view (module "desktop"): layout of the account – window
		// places, open windows, wallpaper; a small JSON object per account
		desk_get: {
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'session not bound' };
				if (!module_on('desktop')) return { error: 'not installed' };
				let d = null;
				try { d = json(readfile(DESK_DIR + '/' + u + '.json') ?? 'null'); } catch (e) { }
				return { desk: type(d) == 'object' ? d : {} };
			}
		},

		desk_set: {
			args: { desk: {} },
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'session not bound' };
				if (!module_on('desktop')) return { error: 'not installed' };
				if (type(req.args.desk) != 'object') return { error: 'invalid desk' };
				let s = sprintf('%J', req.args.desk);
				if (length(s) > DESK_MAX) return { error: 'too large' };
				system('mkdir -p ' + DESK_DIR + ' && chmod 700 ' + DESK_DIR);
				let f = DESK_DIR + '/' + u + '.json';
				if (!writefile(f + '.new', s) || !rename(f + '.new', f)) return { error: 'cannot save' };
				return { ok: true };
			}
		},

		passwd: {
			args: { old: '', password: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'session not bound' };
				if (!password_ok(u, req.args.old)) return { error: 'the current password is wrong' };
				return tool_result(sh_pass(sprintf('%s passwd %s', USERS, shq(u)), req.args.password));
			}
		}
	},

	'shareos.backup': {
		// what can go into a backup: certificate, own CA (with issued certificates)
		offer: { call: function() { return backup_offer(); } },

		// certificate / ca: also the private keys – only in an encrypted backup
		export: {
			args: { password: '', certificate: false, ca: false },
			call: function(req) {
				let pass = req.args.password ?? '';
				if (pass != '' && length(pass) < 6) return { error: 'the password needs at least 6 characters' };
				if (pass == '' && (req.args.certificate || req.args.ca)) return { error: 'certificate and CA keys need an encrypted backup' };
				let b = backup_build({ certificate: !!req.args.certificate, ca: !!req.args.ca });
				let text = sprintf('%J', b);
				let name = sprintf('shareos-%s-%s', b.host, replace(trim(sh('date +%Y%m%d-%H%M').out), /[^0-9-]/, ''));
				if (pass == '')
					return { filename: name + '.json', encrypted: false, content: text, ...backup_summary(b) };
				let r = crypt('enc', pass, text);
				if (r.error) return r;
				// date, box and version stay readable, so a list of backups can show them
				let wrap = { shareos_backup: 2, encrypted: true, cipher: 'AES-256-GCM, PBKDF2-SHA256',
					host: b.host, created: b.created, version: b.version, data: b64enc(r.data) };
				return { filename: name + '.json', encrypted: true, content: sprintf('%J', wrap), ...backup_summary(b) };
			}
		},

		// apply: false = only show what is inside; true = take over what the
		// box needs to run, keep the rest for the recovery mode (after a reboot)
		restore: {
			args: { content: '', password: '', apply: false },
			call: function(req) {
				let j = jparse(req.args.content ?? '');
				if (type(j) != 'object' || index([ 1, 2 ], j.shareos_backup) < 0) return { error: 'not a ShareOS settings backup' };
				if (j.encrypted) {
					if (!req.args.password) return { error: 'password required', encrypted: true };
					let r = crypt('dec', req.args.password, b64dec(j.data ?? '') ?? '');
					if (r.error) return { ...r, encrypted: true };
					j = jparse(r.data);
					if (type(j) != 'object' || index([ 1, 2 ], j.shareos_backup) < 0) return { error: 'damaged backup' };
				}
				j = backup_upgrade(j);
				if (!req.args.apply) return { ok: true, preview: true, encrypted: !!req.args.password, ...backup_summary(j) };
				let essentials = restore_essentials(j);
				return { ok: true, reboot: true, recovery: true, essentials };
			}
		}
	},

	// after restoring a settings backup: pick what else comes back
	'shareos.recovery': {
		status: {
			call: function() {
				let b = jparse(readfile(RECOVERY) ?? 'null');
				let pending = recovery_pending_apps();
				let pid = read_trim('/tmp/shareos-restore-apps.run');
				let job = !!pid && match(pid, /^[0-9]+$/) && stat('/proc/' + pid) != null;
				if (type(b) != 'object') return { active: false, pending_apps: pending, apps_running: job };
				return { active: true, ...backup_summary(b), pending_apps: pending, apps_running: job };
			}
		},

		// users: users and groups; services: names; apps: ids to install;
		// certificate: reuse the backed-up one; ca: own CA with issued certificates
		apply: {
			args: { users: false, shares: false, services: [], apps: [], certificate: false, ca: false },
			call: function(req) {
				let b = jparse(readfile(RECOVERY) ?? 'null');
				if (type(b) != 'object') return { error: 'not in recovery mode' };
				return recovery_apply(b, req.args);
			}
		},

		// keep the box as it is now (only the essentials of the backup)
		discard: { call: function() { unlink(RECOVERY); return { ok: true }; } },

		// apps of the backup that are not installed yet (apps page)
		apps_install: {
			call: function() {
				let p = recovery_pending_apps();
				if (!length(p)) return { error: 'no apps to install' };
				return { started: recovery_start_apps(p, true), apps: p };
			}
		},
		apps_dismiss: { call: function() { unlink(RECOVERY_APPS); return { ok: true }; } }
	},

	'shareos.paperless': {
		get: {
			call: function() {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor(), list = [];
				c.foreach('paperless', 'inbox', (x) => { push(list, inbox_info(c, x['.name'])); });
				return { ...paperless_global(c), inboxes: list };
			}
		},

		set_global: {
			args: { url: '', enabled: true, interval: 2, after: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let a = req.args, c = cursor();
				if (a.url != null && a.url != '' && !match(a.url, /^https?:\/\/[A-Za-z0-9.:\[\]_-]+(:[0-9]+)?(\/[^[:space:]]*)?$/)) return { error: 'invalid URL (http://… or https://…)' };
				if (a.interval != null && !(+a.interval >= 1 && +a.interval <= 60)) return { error: 'interval 1–60 minutes' };
				if (a.after && !(a.after in { delete: 1, keep: 1 })) return { error: 'invalid value' };
				c.set('paperless', 'global', 'global');
				if (a.url != null) c.set('paperless', 'global', 'url', replace(a.url, /\/+$/, ''));
				if (a.enabled != null) c.set('paperless', 'global', 'enabled', a.enabled ? '1' : '0');
				if (a.interval != null) c.set('paperless', 'global', 'interval', '' + int(+a.interval));
				if (a.after) c.set('paperless', 'global', 'after', a.after);
				c.commit('paperless');
				sh(CRON + ' sync');
				return paperless_global(c);
			}
		},

		test: {
			args: { url: '', token: '', inbox: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor(), tok = req.args.token || (req.args.inbox ? c.get('paperless', req.args.inbox, 'token') : null);
				let url = req.args.url || c.get('paperless', 'global', 'url');
				if (!url || !tok) return { error: 'URL and token needed' };
				let r = sh_in(sprintf('%s test %s', PAPERLESS, shq(url)), tok + '\n');
				let m = match(r.out, /ok documents=([0-9?]+)/);
				return m ? { ok: true, documents: m[1] } : tool_result(r);
			}
		},

		// admin inboxes: one per user (owner) or a shared one on a share
		inbox_set: {
			args: { name: '', owner: '', share: '', token: '', tags: [], enabled: true },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let a = req.args, c = cursor();
				if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name (a-z, 0-9 and _)' };
				let exists = c.get('paperless', a.name) == 'inbox';
				if (a.owner) {
					if (c.get('accounts', a.owner) != 'user') return { error: 'unknown user' };
					if (!c.get('accounts', a.owner, 'home')) return { error: 'the user has no personal folder' };
					a.share = '';
				} else if (c.get('shares', a.share) != 'share') return { error: 'choose a share for a shared inbox' };
				if (a.token && !token_ok(a.token)) return { error: 'invalid token' };
				if (!a.token && !exists) return { error: 'token needed (Paperless → profile → API token)' };
				inbox_save(c, a.name, a);
				return { ok: true, inbox: inbox_info(c, a.name) };
			}
		},

		inbox_del: {
			args: { name: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor();
				if (c.get('paperless', req.args.name) != 'inbox') return { error: 'unknown inbox' };
				c.delete('paperless', req.args.name); c.commit('paperless');
				sh(CRON + ' sync');
				return { ok: true };   // the folder and its files stay
			}
		},

		run: {
			call: function() {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				system('start-stop-daemon -S -b -x ' + PAPERLESS + ' -- run');
				return { started: true };
			}
		},

		tags: {
			args: { inbox: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				if (!match(req.args.inbox ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid inbox' };
				let j = jparse(sh(PAPERLESS + ' tags ' + shq(req.args.inbox)).out);
				return { tags: map(j?.results ?? [], (t) => ({ id: t.id, name: t.name })) };
			}
		},

		log: {
			args: { inbox: '' },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let c = cursor();
				if (c.get('paperless', req.args.inbox) != 'inbox') return { error: 'unknown inbox' };
				return { entries: paperless_log(inbox_path(c, req.args.inbox), 100) };
			}
		}
	},

	'shareos.cloud': {
		status: { call: function() { if (!module_on('cloud')) return CLOUD_OFF; return cloud_status(); } },

		install: {
			call: function() { if (!module_on('cloud')) return CLOUD_OFF;
				let st = cloud_status();
				if (!st.apps) return { error: 'no apps area – set up a volume first (Storage)' };
				system('mkdir -p ' + CLOUD_ST + ' && echo state=installing > ' + CLOUD_ST + '/install');
				system('start-stop-daemon -S -b -x ' + CLOUD + ' -- install');
				return { started: true };
			}
		},

		remotes: { call: function() { if (!module_on('cloud')) return CLOUD_OFF; return { remotes: cloud_remotes('-') }; } },

		remote_add: {
			args: { name: '', type: '', params: {}, raw: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF; let r = cloud_remote_add('', req.args); return r.error ? r : { ok: true, remotes: cloud_remotes('-') }; }
		},

		auth_start: {
			args: { type: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF; return cloud_auth_start('', req.args.type); }
		},

		auth_finish: {
			args: { url: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF; return cloud_auth_finish('', req.args.url); }
		},

		remote_del: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				if (!match(req.args.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				let r = tool_result(sh(CLOUD + ' remote-del - ' + shq(req.args.name)));
				return r.error ? r : { ok: true, remotes: cloud_remotes('-') };
			}
		},

		remote_test: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				if (!match(req.args.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				let r = sh(CLOUD + ' remote-test - ' + shq(req.args.name));
				let m = match(r.out, /ok folders=([0-9]+)/);
				return m ? { ok: true, folders: +m[1] } : tool_result(r);
			}
		},

		jobs: { call: function() { if (!module_on('cloud')) return CLOUD_OFF; return { jobs: cloud_jobs(cursor(), null) }; } },

		job_set: {
			args: { name: '', remote: '', remote_path: '', local: '', mode: '', schedule: '', bwlimit: '', enabled: true },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let c = cursor();
				// the admin edits system jobs here; a user's job keeps its owner
				let owner = c.get('cloud', req.args.name) == 'job' ? (c.get('cloud', req.args.name, 'owner') ?? '') : '';
				let r = cloud_job_save(c, owner, req.args);
				return r.error ? r : { ok: true, jobs: cloud_jobs(cursor(), null) };
			}
		},

		job_del: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let c = cursor();
				if (c.get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				c.delete('cloud', req.args.name); c.commit('cloud');
				sh(CRON + ' sync');
				return { ok: true, jobs: cloud_jobs(cursor(), null) };
			}
		},

		job_run: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				if (cursor().get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				return cloud_job_start(req.args.name);
			}
		},

		job_stop: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				if (cursor().get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				return tool_result(sh(CLOUD + ' stop ' + shq(req.args.name)));
			}
		},

		job_log: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let c = cursor();
				if (c.get('cloud', req.args.name) != 'job') return { error: 'unknown job' };
				return { lines: cloud_log(c, req.args.name, 80) };
			}
		}
	},

	// called only by /_shareos/cgi/vpn on the apps web server (as root, with
	// the grant of an app with the permission "vpn"; admin accounts only)
	// called only by /_shareos/cgi/tailscale on the apps web server (grant of an
	// app with the permission "tailscale"; admin accounts only)
	'shareos.apptailscale': {
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'log' ]) : { error: 'no access' }; } },
		up: {
			args: { grant: '', authkey: '' },
			call: function(req) {
				if (!app_grant_perm(req.args.grant, 'tailscale')) return { error: 'no access' };
				return ts_tool([ 'up' ], { authkey: req.args.authkey ?? '' });
			}
		},
		login: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'login' ]) : { error: 'no access' }; } },
		down: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'down' ]) : { error: 'no access' }; } },
		logout: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'logout' ]) : { error: 'no access' }; } },
		ping: { args: { grant: '', ip: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tailscale') ? ts_tool([ 'ping', req.args.ip ?? '' ]) : { error: 'no access' }; } }
	},

	// called only by /_shareos/cgi/autobrr (as root, local ubus socket): autobrr
	// for apps with "files" + "autobrr", admin accounts only
	'shareos.appautobrr': {
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'log' ]) : { error: 'no access' }; } },
		start: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'start' ]) : { error: 'no access' }; } },
		set: {
			args: { grant: '', enabled: false, ui: false, account: '' },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'autobrr')) return { error: 'no access' };
				for (let k in [ 'enabled', 'ui', 'account' ]) if (a[k] != null) i[k] = a[k];
				return ab_tool([ 'set' ], i);
			}
		},
		password: {
			args: { grant: '', password: '' },
			call: function(req) { return app_grant_perm(req.args.grant, 'autobrr') ? ab_tool([ 'password' ], { password: req.args.password }) : { error: 'no access' }; }
		},
		api: {
			args: { grant: '', method: '', path: '', body: {} },
			call: function(req) {
				let a = req.args;
				if (!app_grant_perm(a.grant, 'autobrr')) return { error: 'no access' };
				return ab_tool([ 'api' ], { method: a.method ?? 'GET', path: a.path ?? '', body: a.body });
			}
		},
		// accounts whose Transmission can get autobrr's torrents
		accounts: {
			args: { grant: '' },
			call: function(req) {
				if (!app_grant_perm(req.args.grant, 'autobrr')) return { error: 'no access' };
				let l = [ { name: 'root', fullname: 'Administrator' } ], c = cursor();
				c.foreach('accounts', 'user', (x) => { if (x.role == 'user' || x.role == 'admin') push(l, { name: x['.name'], fullname: x.fullname ?? '' }); });
				return { accounts: l };
			}
		}
	},

	// called only by /_shareos/cgi/zabbix: the Zabbix agent of the box
	// (system app "zabbix-agent"), admin accounts only – shareos-zabbix checks
	// every value; the pre-shared key goes in, never out (status: psk true/false)
	'shareos.appzabbix': {
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'zabbix') ? zb_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'zabbix') ? zb_tool([ 'log' ]) : { error: 'no access' }; } },
		restart: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'zabbix') ? zb_tool([ 'restart' ]) : { error: 'no access' }; } },
		set: {
			args: { grant: '', enabled: false, server: '', hostname: '', metadata: '', psk_identity: '', psk: '', passive: false, allow: '', port: 0, disk_interval: 0 },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'zabbix')) return { error: 'no access' };
				for (let k in ZB_SET) if (a[k] != null) i[k] = a[k];
				return zb_tool([ 'set' ], i);
			}
		}
	},

	// called only by /_shareos/cgi/sysinfo: the box's values, admin accounts only
	'shareos.appsys': {
		info: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'sysinfo') ? sys_info() : { error: 'no access' }; } },
		processes: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'sysinfo') ? sys_processes() : { error: 'no access' }; } },
		kill: {
			args: { grant: '', pid: 0, signal: '' },
			call: function(req) {
				let a = req.args;
				if (!app_grant_perm(a.grant, 'sysinfo')) return { error: 'no access' };
				let pid = +a.pid, sig = a.signal ?? 'TERM';
				if (!(sig in { TERM: 1, KILL: 1, HUP: 1 })) return { error: 'invalid signal' };
				if (!(pid > 1)) return { error: 'invalid process' };
				let name = trim(readfile('/proc/' + pid + '/comm') ?? '');
				if (name == '') return { error: 'no such process' };
				if (readfile('/proc/' + pid + '/cmdline') == '') return { error: 'kernel threads cannot be ended' };
				if (SYS_KEEP[name]) return { error: 'this process keeps ShareOS running' };
				let r = sh(sprintf('kill -%s %d', sig, pid));
				return r.rc == 0 ? { ok: true, pid, name, signal: sig } : { error: trim(r.out) || 'failed' };
			}
		}
	},

	// called only by /_shareos/cgi/netcheck: may this app check hosts from the box?
	'shareos.appnet': {
		allowed: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'netcheck') ? { ok: true } : { error: 'no access' }; } }
	},

	// called only by /_shareos/cgi/notify: messages of an app (permission
	// "notify", admins) – checked and sent by shareos-apps notify
	// called only by /_shareos/cgi/vault: vault shares of the account that
	// opened the app (permissions "files" + "vault"); set: admins only
	'shareos.appvault': {
		status: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'vault');
				if (!g) return { error: 'no access' };
				return { user: g.u, host: trim(readfile('/proc/sys/kernel/hostname') ?? ''), vaults: vault_list(g.u) };
			}
		},
		unlock: {
			args: { grant: '', share: '', minutes: 0, password: '' },
			call: function(req) {
				let a = req.args, g = app_grant_perm(a.grant, 'vault');
				if (!g) return { error: 'no access' };
				return vault_unlock(g.u, a.share, a.minutes || null, a.password);
			}
		},
		lock: {
			args: { grant: '', share: '' },
			call: function(req) {
				let a = req.args, g = app_grant_perm(a.grant, 'vault');
				if (!g) return { error: 'no access' };
				let admin = acc_role(g.u) == 'admin';
				if (!valid_name(a.share) || !(admin || vault_access(cursor(), a.share, g.u))) return { error: 'not a vault' };
				// users lock their own access, admins the whole vault
				return vault_lock(a.share, admin ? null : g.u);
			}
		},
		set: {
			args: { grant: '', share: '', vault: false, default_ttl: 0 },
			call: function(req) {
				let a = req.args, g = app_grant_perm(a.grant, 'vault');
				if (!g) return { error: 'no access' };
				if (acc_role(g.u) != 'admin') return { error: 'admins only' };
				return vault_set(a.share, a.vault, a.default_ttl || null);
			}
		}
	},

	'shareos.appnotify': {
		send: {
			args: { grant: '', level: '', key: '', title: '', text: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'notify'), a = req.args;
				if (!g) return { error: 'no access' };
				return app_notify_tool([ 'send', '' + (a.level || 'info'), '' + (a.key ?? ''), '' + (a.title ?? ''), '' + (a.text ?? '') ], g.app.id);
			}
		},
		clear: {
			args: { grant: '', key: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'notify');
				if (!g) return { error: 'no access' };
				return app_notify_tool([ 'clear', '' + (req.args.key ?? '') ], g.app.id);
			}
		}
	},

	// called only by /_shareos/cgi/tuya: may this app talk to Tuya devices?
	'shareos.apptuya': {
		allowed: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'tuya') ? { ok: true } : { error: 'no access' }; } }
	},

	// called only by /_shareos/cgi/docker: the Docker hosts (admin accounts only)
	'shareos.appdocker': {
		hosts: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'docker') ? { hosts: docker_hosts(cursor()) } : { error: 'no access' }; } },
		host_set: {
			args: { grant: '', name: '', label: '', url: '', insecure: false },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!app_grant_perm(a.grant, 'docker')) return { error: 'no access' };
				if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				if (!docker_url_ok(a.url)) return { error: 'invalid address (http://host:2375 or https://host:2376)' };
				if (c.get('dockerhosts', a.name) == null && length(docker_hosts(c)) >= 16) return { error: 'at most 16 hosts' };
				c.set('dockerhosts', a.name, 'host');
				c.set('dockerhosts', a.name, 'label', substr(trim(a.label ?? '') || a.name, 0, 40));
				c.set('dockerhosts', a.name, 'url', replace(a.url, /\/$/, ''));
				c.set('dockerhosts', a.name, 'insecure', a.insecure ? '1' : '0');
				c.commit('dockerhosts');
				return { hosts: docker_hosts(cursor()) };
			}
		},
		host_del: {
			args: { grant: '', name: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!app_grant_perm(a.grant, 'docker')) return { error: 'no access' };
				if (c.get('dockerhosts', a.name ?? '') != 'host') return { error: 'unknown host' };
				c.delete('dockerhosts', a.name); c.commit('dockerhosts');
				return { hosts: docker_hosts(cursor()) };
			}
		},
		// address of one host for the CGI, which talks to it
		target: {
			args: { grant: '', host: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!app_grant_perm(a.grant, 'docker')) return { error: 'no access' };
				let h = filter(docker_hosts(c), (x) => x.name == a.host)[0];
				return h && docker_url_ok(h.url) ? { url: h.url, insecure: h.insecure } : { error: 'unknown host' };
			}
		}
	},

	'shareos.appvpn': {
		list: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'list' ]) : { error: 'no access' }; } },
		status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'status' ]) : { error: 'no access' }; } },
		log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'log' ]) : { error: 'no access' }; } },
		disconnect: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'disconnect' ]) : { error: 'no access' }; } },
		import: {
			args: { grant: '', name: '', text: '', user: '', pass: '', full: true },
			call: function(req) {
				let a = req.args;
				if (!app_grant_perm(a.grant, 'vpn')) return { error: 'no access' };
				return vpn_tool([ 'import', a.name ?? '' ], { text: a.text, user: a.user, pass: a.pass, full: a.full !== false });
			}
		},
		set: {
			args: { grant: '', name: '', autostart: false, full: true, user: '', pass: '' },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'vpn')) return { error: 'no access' };
				for (let k in [ 'autostart', 'full', 'user', 'pass' ]) if (a[k] != null) i[k] = a[k];
				return vpn_tool([ 'set', a.name ?? '' ], i);
			}
		},
		remove: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'remove', req.args.name ?? '' ]) : { error: 'no access' }; } },
		connect: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'connect', req.args.name ?? '' ]) : { error: 'no access' }; } },
		// server: devices connect to the box
		server_status: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'server-status' ]) : { error: 'no access' }; } },
		server_log: { args: { grant: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'server-log' ]) : { error: 'no access' }; } },
		server_set: {
			args: { grant: '', enabled: false, port: 0, proto: '', net: '', host: '', lan: false },
			call: function(req) {
				let a = req.args, i = {};
				if (!app_grant_perm(a.grant, 'vpn')) return { error: 'no access' };
				for (let k in [ 'enabled', 'port', 'proto', 'net', 'host', 'lan' ]) if (a[k] != null) i[k] = a[k];
				return vpn_tool([ 'server-set' ], i);
			}
		},
		device_add: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'device-add', req.args.name ?? '' ]) : { error: 'no access' }; } },
		device_profile: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'device-profile', req.args.name ?? '' ]) : { error: 'no access' }; } },
		device_remove: { args: { grant: '', name: '' }, call: function(req) { return app_grant_perm(req.args.grant, 'vpn') ? vpn_tool([ 'device-remove', req.args.name ?? '' ]) : { error: 'no access' }; } }
	},

	// called only by /_shareos/cgi/status (apps with the permission "status")
	'shareos.appstatus': {
		set: {
			args: { grant: '', text: '', state: '', ttl: 0 },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'status'), a = req.args;
				if (!g) return { error: 'no access' };
				let text = trim('' + (a.text ?? ''));
				if (text == '' || length(text) > 24 || match(text, /[[:cntrl:]<>]/)) return { error: 'invalid text (1–24 characters)' };
				let st = a.state || 'info';
				if (!CHIP_STATES[st]) return { error: 'invalid state (ok, warn, err, info)' };
				let ttl = int(+(a.ttl || 300));
				if (!(ttl >= 10 && ttl <= 600)) return { error: 'invalid ttl (10–600 seconds)' };
				system('mkdir -p ' + APPSTATUS + ' && chmod 711 ' + APPSTATUS + ' && mkdir -p ' + shq(APPSTATUS + '/' + g.u));
				writefile(APPSTATUS + '/' + g.u + '/' + g.app.id + '.json', sprintf('%J\n', { text, state: st, until: time() + ttl }));
				return { ok: true, until: time() + ttl };
			}
		},
		clear: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_perm(req.args.grant, 'status');
				if (!g) return { error: 'no access' };
				unlink(APPSTATUS + '/' + g.u + '/' + g.app.id + '.json');
				return { ok: true };
			}
		}
	},

	'shareos.dlna': {
		status: { call: function() { return dlna_status(); } },

		// enabled, name, media: [{share, path (subfolder, optional), type: A|V|P|-}]
		set: {
			args: { enabled: false, name: '', media: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				let name = trim(a.name ?? '');
				if (length(name) > 48 || match(name, /[\n\r=]/)) return { error: 'invalid name' };
				let shares = map(share_list().shares, (x) => x.name), list = [], seen = {};
				for (let m in (type(a.media) == 'array' ? a.media : [])) {
					if (type(m) != 'object' || !(m.type in DLNA_TYPES) || index(shares, m.share) < 0) return { error: 'invalid folder' };
					let sub = m.path ?? '';
					if (type(sub) != 'string') return { error: 'invalid folder' };
					sub = trim(sub, '/');
					if (sub != '' && !share_subdir(c, m.share, sub)) return { error: 'folder not found: ' + m.share + '/' + sub };
					let ref = m.share + (sub != '' ? '/' + sub : '');
					if (seen[ref]) continue;
					seen[ref] = 1;
					push(list, m.type + ',share:' + ref);
				}
				c.set('dlna', 'main', 'dlna');
				c.set('dlna', 'main', 'enabled', a.enabled === true ? '1' : '0');
				c.set('dlna', 'main', 'name', name);
				c.delete('dlna', 'main', 'media');
				if (length(list)) c.set('dlna', 'main', 'media', list);
				c.commit('dlna');
				let r = sh(DLNA + (a.enabled === true ? ' restart' : ' stop'));
				let m = match(r.out, /error: ([^\n]*)/);
				if (m || r.rc != 0) return { error: m ? m[1] : (trim(r.out) || 'failed') };
				return dlna_status();
			}
		},

		rescan: {
			call: function() {
				if (cursor().get('dlna', 'main', 'enabled') != '1') return { error: 'the media server is switched off' };
				let r = sh(DLNA + ' rescan');
				let m = match(r.out, /error: ([^\n]*)/);
				return m ? { error: m[1] } : dlna_status();
			}
		}
	},

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
	},

	// DNS filter (module): AdGuard Home on port 53, admins
	'shareos.dnsfilter': {
		status: { call: function() { return module_on('dnsfilter') ? df_tool([ 'status' ]) : DF_OFF; } },
		filters: { call: function() { return module_on('dnsfilter') ? df_tool([ 'filters' ]) : DF_OFF; } },
		password: { call: function() { return module_on('dnsfilter') ? df_tool([ 'password' ]) : DF_OFF; } },
		log: { call: function() { return module_on('dnsfilter') ? df_tool([ 'log' ]) : DF_OFF; } },
		// switching on starts in the background (the first start sets AdGuard up)
		set: {
			args: { enabled: false, web_port: 0, https_port: 0, upstream: [], protection: false },
			call: function(req) {
				if (!module_on('dnsfilter')) return DF_OFF;
				let a = req.args, inp = {};
				if (a.enabled === true) {
					let st = df_tool([ 'status' ]);
					if (!st.running) return df_tool([ 'start-bg' ]);
				}
				for (let k in [ 'enabled', 'web_port', 'https_port', 'upstream', 'protection' ]) if (a[k] != null) inp[k] = a[k];
				return df_tool([ 'set' ], inp);
			}
		},
		filter_add: { args: { name: '', url: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'filter-add' ], { name: req.args.name ?? '', url: req.args.url ?? '' }) : DF_OFF; } },
		filter_remove: { args: { url: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'filter-remove' ], { url: req.args.url ?? '' }) : DF_OFF; } },
		filter_enable: { args: { url: '', enabled: false }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'filter-enable' ], { url: req.args.url ?? '', enabled: req.args.enabled === true }) : DF_OFF; } },
		refresh: { call: function() { return module_on('dnsfilter') ? df_tool([ 'refresh' ]) : DF_OFF; } },
		rewrites: { call: function() { return module_on('dnsfilter') ? df_tool([ 'rewrites' ]) : DF_OFF; } },
		rewrite_add: { args: { domain: '', answer: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'rewrite-add' ], { domain: req.args.domain ?? '', answer: req.args.answer ?? '' }) : DF_OFF; } },
		rewrite_remove: { args: { domain: '', answer: '' }, call: function(req) { return module_on('dnsfilter') ? df_tool([ 'rewrite-remove' ], { domain: req.args.domain ?? '', answer: req.args.answer ?? '' }) : DF_OFF; } }
	},

	// chips in the header of the interface: services and apps of the account
	'shareos.status': {
		chips: {
			call: function(req) {
				let u = session_user(req);
				return u ? { chips: status_chips(u) } : { chips: [] };
			}
		}
	},

	'shareos.snapshots': {
		status: {
			call: function() {
				let src = snap_tool([ 'sources' ]);
				return { jobs: snap_jobs(), volumes: src.volumes ?? [], sources: src.sources ?? [], rsync: stat('/usr/bin/rsync') != null };
			}
		},

		job_set: {
			args: { name: '', new: false, source: '', target: '', every: '', time: '', keep_last: 0, keep_daily: 0, keep_weekly: 0,
				keep_monthly: 0, exclude: [], enabled: true },
			call: function(req) {
				let r = snap_save(req.args);
				return r.error ? r : { ok: true, jobs: snap_jobs() };
			}
		},

		// data: also remove the snapshots of the job (in the background)
		job_del: {
			args: { name: '', data: false },
			call: function(req) {
				let n = req.args.name, c = cursor();
				if (!match(n ?? '', SNAP_JOB_RE) || c.get('snapshots', n) != 'job') return { error: 'unknown job' };
				if (snap_running(n)) return { error: 'the snapshot is running – stop it first' };
				if (req.args.data === true) {
					let r = sh(SNAP + ' purge ' + shq(n));
					if (r.rc != 0) return { error: trim(r.out) || 'failed' };
				}
				c.delete('snapshots', n); c.commit('snapshots');
				sh(CRON + ' sync');
				return { ok: true, jobs: snap_jobs() };
			}
		},

		run: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name;
				if (!match(n ?? '', SNAP_JOB_RE) || cursor().get('snapshots', n) != 'job') return { error: 'unknown job' };
				if (snap_running(n)) return { error: 'already running' };
				system('start-stop-daemon -S -b -x ' + SNAP + ' -- run ' + shq(n));
				// the worker writes its pid at once; show "running" right away
				for (let i = 0; i < 20 && !snap_running(n); i++) system('sleep 0.1');
				return { started: true };
			}
		},

		stop: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name;
				if (!match(n ?? '', SNAP_JOB_RE) || cursor().get('snapshots', n) != 'job') return { error: 'unknown job' };
				return snap_tool([ 'stop', n ]);
			}
		},

		remove: {
			args: { name: '', snapshot: '' },
			call: function(req) {
				let n = req.args.name;
				if (!match(n ?? '', SNAP_JOB_RE) || cursor().get('snapshots', n) != 'job') return { error: 'unknown job' };
				let r = snap_tool([ 'delete', n, req.args.snapshot ?? '' ]);
				forget('snaplist:' + n);
				return r.error ? r : { ok: true, jobs: snap_jobs() };
			}
		},

		log: {
			args: { name: '' },
			call: function(req) {
				let n = req.args.name, c = cursor();
				if (!match(n ?? '', SNAP_JOB_RE) || c.get('snapshots', n) != 'job') return { error: 'unknown job' };
				let t = readfile('/mnt/' + (c.get('snapshots', n, 'target') ?? '-') + '/Snapshots/' + n + '/.log') ?? '';
				return { log: length(t) > 16384 ? substr(t, length(t) - 16384) : t };
			}
		}
	},

	'shareos.files': {
		roots: {
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return { roots: map(files_roots(u), (r) => ({ name: r.name, home: r.home, ro: !!r.ro })), trash: trash_conf() };
			}
		},

		list: {
			args: { root: '', path: '', hidden: false },
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return files_list(u, req.args.root, req.args.path, req.args.hidden === true);
			}
		},

		mkdir: {
			args: { root: '', path: '', name: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = files_wpath(u, a.root, a.path, 'dir');
				if (p.error) return p;
				let r = files_sh(u, 'mkdir -- ' + shq(p.abs + '/' + a.name), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		rename: {
			args: { root: '', path: '', name: '', to: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name) || !name_ok(a.to)) return { error: 'invalid name' };
				let p = files_wpath(u, a.root, a.path, 'dir');
				if (p.error) return p;
				if (lstat(p.abs + '/' + a.to)) return { error: 'already exists' };
				let r = files_sh(u, sprintf('mv -- %s %s', shq(p.abs + '/' + a.name), shq(p.abs + '/' + a.to)), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		move: {
			// names from one folder into another folder (dest_root: of another
			// root, e.g. from a share into the personal folder); copy: keep the originals
			args: { root: '', path: '', names: [], dest: '', dest_root: '', copy: false },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (type(a.names) != 'array' || !length(a.names)) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let droot = a.dest_root ? a.dest_root : a.root;
				let p = a.copy ? files_path(u, a.root, a.path, 'dir') : files_wpath(u, a.root, a.path, 'dir'), d = files_wpath(u, droot, a.dest, 'dir');
				if (p.error) return p;
				if (d.error) return d;
				for (let n in a.names) {
					let src = p.abs + '/' + n;
					if (d.abs == src || index(d.abs + '/', src + '/') == 0) return { error: 'a folder cannot be moved into itself' };
					if (lstat(d.abs + '/' + n)) return { error: 'already exists: ' + n };
				}
				return files_bg(u, sprintf('%s -- %s %s', a.copy ? 'cp -a' : 'mv', join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), shq(d.abs + '/')), d.root.share);
			}
		},

		delete: {
			// into the trash when it is on (permanent: for good)
			args: { root: '', path: '', names: [], permanent: false },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (type(a.names) != 'array' || !length(a.names)) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let p = files_wpath(u, a.root, a.path, 'dir');
				if (p.error) return p;
				if (a.permanent !== true && trash_conf().enabled && !in_trash(p.rel) && !(p.rel == '' && index(a.names, TRASH) >= 0)) {
					let r = trash_move(u, p, a.names);
					trash_purge(u, files_wpath(u, a.root, '', 'dir'));
					return r;
				}
				return files_bg(u, 'rm -rf -- ' + join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), p.root.share);
			}
		},

		// how a copy, move or delete that went on in the background ended
		job: {
			args: { id: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return files_job(u, req.args.id);
			}
		},

		// the trash of a root (personal folder, share, drive)
		trash_list: {
			args: { root: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				let p = files_path(u, req.args.root, '', 'dir');
				if (p.error) return p;
				if (!p.root.ro) trash_purge(u, p);
				return { ...trash_conf(), items: trash_items(p), ro: !!p.root.ro };
			}
		},

		trash_restore: {
			args: { root: '', ids: [] },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!trash_ids_ok(a.ids)) return { error: 'nothing selected' };
				let p = files_wpath(u, a.root, '', 'dir');
				if (p.error) return p;
				let items = trash_items(p), t = trash_dir(p), done = [];
				for (let id in a.ids) {
					let it = filter(items, (x) => x.id == id)[0];
					if (!it) return { error: 'not in the trash' };
					// back into its folder; when that is gone, to the top
					let d = files_wpath(u, a.root, it.path, 'dir');
					if (d.error) d = p;
					let dot = rindex(it.name, '.'), base = dot > 0 ? substr(it.name, 0, dot) : it.name, ext = dot > 0 ? substr(it.name, dot) : '', n = it.name;
					for (let i = 2; lstat(d.abs + '/' + n); i++) n = base + ' (' + i + ')' + ext;
					let r = files_sh(u, sprintf('mv -- %s %s', shq(t + '/' + id), shq(d.abs + '/' + n)), p.root.share);
					if (r.rc != 0) return { error: files_err(r) };
					unlink(t + '/' + id + '.json');
					push(done, { name: n, path: d.rel });
				}
				return { ok: true, restored: done };
			}
		},

		// delete for good: the given entries, or all (ids empty)
		trash_empty: {
			args: { root: '', ids: [] },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				let p = files_wpath(u, a.root, '', 'dir');
				if (p.error) return p;
				let t = trash_dir(p);
				let ids = (type(a.ids) == 'array' && length(a.ids)) ? a.ids : map(trash_items(p), (x) => x.id);
				if (!length(ids)) return { ok: true, removed: 0 };
				if (!trash_ids_ok(ids)) return { error: 'invalid entry' };
				let r = files_bg(u, 'rm -rf -- ' + join(' ', map(ids, (i) => shq(t + '/' + i) + ' ' + shq(t + '/' + i + '.json'))), p.root.share);
				return r.error ? r : { ...r, removed: length(ids) };
			}
		},

		// admins: trash on/off and how many days it keeps things (0 = until emptied)
		trash_config: {
			args: { enabled: true, days: 30 },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || acc_role(u) != 'admin') return { error: 'not allowed' };
				let d = +a.days;
				if (!(d >= 0 && d <= 365) || type(a.enabled) != 'bool') return { error: 'invalid value' };
				let c = cursor();
				if (c.get('shareos', 'files') != 'files') c.set('shareos', 'files', 'files');
				c.set('shareos', 'files', 'trash', a.enabled ? '1' : '0');
				c.set('shareos', 'files', 'trash_days', '' + d);
				c.save('shareos'); c.commit('shareos');
				return trash_conf();
			}
		},

		ticket: {
			// one-time address for /cgi-bin/files: get = download a file,
			// put = upload into path/name (overwrite: replace an existing file)
			args: { root: '', path: '', name: '', mode: 'get', overwrite: false },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = a.mode == 'put' ? files_wpath(u, a.root, a.path, 'dir') : files_path(u, a.root, a.path, 'dir');
				if (p.error) return p;
				let target = p.abs + '/' + a.name, st = lstat(target);
				if (a.mode == 'get') { if (st?.type != 'file') return { error: 'not a file' }; }
				else if (a.mode == 'put') { if (st && (!a.overwrite || st.type != 'file')) return { error: 'already exists' }; }
				else return { error: 'invalid mode' };
				system('mkdir -p ' + FILES_TICKETS + ' && chmod 700 ' + FILES_TICKETS);
				system('find ' + FILES_TICKETS + ' -type f -mmin +5 -delete 2>/dev/null');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('%s\n%s\n%s\n%d\n%s\n', a.mode, acc_role(u) == 'admin' ? 'root' : u, target, time() + 120, pct_enc(a.name)));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		// apps that open files (manifest "opens") for this account
		openers: {
			call: function(req) {
				let u = session_user(req);
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				return { ...apps_server(), apps: map(filter(apps_for(u), (a) => length(a.opens ?? []) > 0),
					(a) => ({ id: a.id, name: a.name, entry: a.entry, icon: a.icon, window: a.window, opens: a.opens })) };
			}
		},

		// open a file in an app: a ticket for the apps web server
		// (/_shareos/cgi/file), bound to this file, this app and this account
		app_ticket: {
			args: { root: '', path: '', name: '', app: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u || !files_allowed(u)) return { error: 'not allowed' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let app = filter(apps_for(u), (x) => x.id == a.app)[0];
				if (!app) return { error: 'app not available' };
				let m = match(lc(a.name), /(\.[a-z0-9]{1,10})$/), mode = null;
				for (let o in app.opens ?? [])
					if (m && index(o.ext, m[1]) >= 0 && mode != 'edit') mode = o.mode;
				if (!mode) return { error: 'the app does not open this file type' };
				let p = files_path(u, a.root, a.path, 'dir');
				if (p.error) return p;
				let target = p.abs + '/' + a.name;
				if (lstat(target)?.type != 'file') return { error: 'not a file' };
				if (p.root.ro) mode = 'view';
				system('mkdir -p ' + APP_TICKETS + ' && chmod 700 ' + APP_TICKETS);
				system('find ' + APP_TICKETS + ' -type f -mmin +480 -delete 2>/dev/null');
				let t = new_token();
				writefile(APP_TICKETS + '/' + t, sprintf('%s\n%s\n%s\n%d\n%s\n%s\n', mode, acc_role(u) == 'admin' ? 'root' : u, target, time() + 8 * 3600, app.id, pct_enc(a.name)));
				return { ticket: t, mode, app: app.id, entry: app.entry, window: app.window, ...apps_server(),
					grant: app_has_files(app) ? app_grant_new(u, app) : null };
			}
		},

		// an app with the permission "files" is opened: its grant for /_shareos/cgi/fs
		app_grant: {
			args: { app: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u || !(files_allowed(u) || app_private_allowed(u))) return { error: 'not allowed' };
				let app = filter(apps_for(u), (x) => x.id == req.args.app)[0];
				if (!app) return { error: 'app not available' };
				if (!app_has_files(app)) return { error: 'the app has no access to files' };
				return { grant: app_grant_new(u, app) };
			}
		}
	},

	// called only by /_shareos/cgi/media on the apps web server (as root, over
	// the local ubus socket); no web session has this object in its ACL.
	// Media jobs of the account (ffmpeg), for apps with "files" + "media".
	'shareos.appmedia': {
		probe: {
			args: { grant: '', root: '', path: '', name: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				let f = media_file(g.u, req.args);
				return f.error ? f : media_probe(g.u, f.abs);
			}
		},

		// action "remux": other container (format mp4/mkv/mov/ts/webm), no re-encoding;
		// action "audio": one audio track (stream = number among the audio tracks) as
		// mp3/m4a/opus/flac/wav (bitrate for the lossy ones) or "copy" (as it is);
		// start/duration (HH:MM:SS or seconds) cut without re-encoding
		start: {
			args: { grant: '', input: {}, output: {}, action: '', format: '', bitrate: '', stream: 0, start: '', duration: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant), a = req.args;
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				if (length(filter(media_jobs(g.u), (j) => j.state == 'queued' || j.state == 'running' || j.state == 'stopping')) >= MEDIA_MAX_QUEUED)
					return { error: 'too many jobs waiting' };
				let inp = media_file(g.u, a.input);
				if (inp.error) return inp;
				let info = media_probe(g.u, inp.abs);
				if (info.error) return info;
				let ss = media_time(a.start), dur = media_time(a.duration);
				if (ss === false || dur === false) return { error: 'invalid time' };
				let seek = [ ...(ss ? [ '-ss', ss ] : []), ...(dur ? [ '-t', dur ] : []) ];
				let ext, args;
				if (a.action == 'remux') {
					ext = MEDIA_REMUX[a.format];
					if (!ext) return { error: 'invalid format' };
					args = [ ...seek, '-i', inp.abs, '-map', '0:v?', '-map', '0:a?', ...(ext == 'mkv' ? [ '-map', '0:s?' ] : []), '-c', 'copy',
						...(ext == 'mp4' || ext == 'mov' ? [ '-movflags', '+faststart' ] : []) ];
				} else if (a.action == 'audio') {
					let auds = filter(info.streams, (x) => x.type == 'audio');
					let n = +(a.stream ?? 0);
					if (!(n >= 0 && n < length(auds))) return { error: 'no such audio track' };
					let codec = auds[n].codec;
					let hint = codec == 'aac' ? [ '-c:a', 'aac_fixed' ] : codec == 'ac3' ? [ '-c:a', 'ac3_fixed' ] : [];
					if (a.format == 'copy') {
						ext = MEDIA_COPY_EXT[codec] ?? (match(codec ?? '', /^pcm_/) ? 'wav' : 'mka');
						args = [ ...seek, '-i', inp.abs, '-map', '0:a:' + n, '-vn', '-sn', '-c:a', 'copy' ];
					} else {
						let fm = MEDIA_AUDIO[a.format];
						if (!fm) return { error: 'invalid format' };
						ext = fm[0];
						let br = a.bitrate || '192k';
						if (ext != 'flac' && ext != 'wav' && !MEDIA_BITRATES[br]) return { error: 'invalid bitrate' };
						args = [ ...hint, ...seek, '-i', inp.abs, '-map', '0:a:' + n, '-vn', '-sn', '-c:a', fm[1],
							...(ext == 'flac' || ext == 'wav' ? [] : [ '-b:a', br ]) ];
					}
				} else return { error: 'invalid action' };
				// output: a folder of the account and a name; the extension follows the format
				let o = a.output ?? {};
				let base = replace(o.name ?? '', /\.[A-Za-z0-9]{1,5}$/, '');
				if (!name_ok(base + '.' + ext) || substr(base, 0, 1) == '.') return { error: 'invalid name' };
				let od = files_wpath(g.u, o.root, o.path, 'dir');
				if (od.error) return od;
				let dir = realpath(od.abs), name = base + '.' + ext;
				if (lstat(dir + '/' + name)) return { error: 'output file exists' };
				let id = substr(new_token(), 0, 16);
				let total = dur ? media_secs(dur) : (info.duration - (ss ? media_secs(ss) : 0));
				let job = { id, user: g.u, run_as: acc_role(g.u) == 'admin' ? 'root' : g.u, action: a.action, format: a.format,
					input: inp.abs, output: dir + '/' + name, tmp: dir + '/.' + base + '.' + id + '.' + ext,
					input_box: { root: a.input.root, path: a.input.path ?? '', name: a.input.name },
					output_box: { root: o.root, path: od.rel, name }, duration: total > 0 ? total : 0,
					args, state: 'queued', created: time() };
				push(job.args, job.tmp);
				system('mkdir -p ' + MEDIA_DIR + ' && chmod 700 /tmp/shareos-media ' + MEDIA_DIR);
				writefile(MEDIA_DIR + '/' + id + '.json', sprintf('%J\n', job));
				system('start-stop-daemon -S -b -x /usr/sbin/shareos-media -- run');
				return { id, output: job.output_box };
			}
		},

		jobs: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				return { jobs: media_jobs(g.u), installed: stat('/opt/shareos/bin/ffmpeg')?.type == 'file' };
			}
		},

		cancel: {
			args: { grant: '', id: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				if (!match(req.args.id ?? '', /^[0-9a-f]{16}$/)) return { error: 'invalid job' };
				let f = MEDIA_DIR + '/' + req.args.id + '.json', j = jparse(readfile(f) ?? 'null');
				if (type(j) != 'object' || j.user != g.u) return { error: 'unknown job' };
				if (j.state == 'queued' || j.state == 'running') {
					// the worker sees the stop file, ends ffmpeg and removes the half file;
					// the job is "stopping" until then
					writefile(MEDIA_DIR + '/' + j.id + '.stop', '');
					if (j.state == 'queued') { j.state = 'cancelled'; j.finished = time(); }
					else j.state = 'stopping';
					writefile(f, sprintf('%J\n', j));
					system("pkill -f '[/]bin/ffmpeg .*\\." + j.id + "\\.'");
				}
				return { ok: true };
			}
		},

		remove: {
			args: { grant: '', id: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'media') < 0) return { error: 'no access' };
				if (!match(req.args.id ?? '', /^[0-9a-f]{16}$/)) return { error: 'invalid job' };
				let j = jparse(readfile(MEDIA_DIR + '/' + req.args.id + '.json') ?? 'null');
				if (type(j) != 'object' || j.user != g.u) return { error: 'unknown job' };
				if (j.state == 'queued' || j.state == 'running' || j.state == 'stopping') return { error: 'job still running' };
				for (let x in [ '.json', '.log', '.stop' ]) unlink(MEDIA_DIR + '/' + j.id + x);
				return { ok: true };
			}
		}
	},

	// called only by /_shareos/cgi/transmission on the apps web server and by
	// /transmission/rpc of the remote access (as root, over the local ubus
	// socket); no web session has this object in its ACL. The account's own
	// Transmission daemon, for apps with "files" + "torrent" (grant) or for
	// remote programs (remote_session, then its ticket).
	'shareos.apptorrent': {
		session: {
			args: { grant: '' },
			call: function(req) {
				let g = torrent_user({ grant: req.args.grant });
				return g ? torrent_session(g.u) : { error: 'no access' };
			}
		},

		// remote access: account name + remote password from an address of the
		// home network -> like session, plus a ticket for path/watch/port
		remote_session: {
			args: { user: '', pass: '', ip: '' },
			call: function(req) {
				let u = req.args.user, pass = req.args.pass, ip = req.args.ip;
				if (!tremote_conf().enabled) return { error: 'off' };
				if (!ip_local(ip)) return { error: 'not local' };
				if (type(u) != 'string' || type(pass) != 'string') return { error: 'denied' };
				let ki = 'ip-' + tremote_fail_key(ip), ku = 'u-' + tremote_fail_key(substr(u, 0, 64));
				if (length(tremote_fails(ki)) >= TREMOTE_FAILS || length(tremote_fails(ku)) >= TREMOTE_FAILS) return { error: 'locked' };
				let ok = false, hash = (u == 'root' || acc_name_ok(u)) ? tremote_hash(u) : '';
				if (hash != '' && length(pass) <= 128) {
					let c = tremote_ok[u];
					if (c && c.hash == hash && c.until > time() && same_token(c.pass, pass)) ok = true;
					else {
						let m = match(hash, /^\$5\$([^$]+)\$/);
						let r = m ? sh_in(sprintf('mkpasswd -P 0 -m sha256 -S %s', shq(m[1])), pass) : null;
						ok = !!r && trim(r.out) == hash;
						if (ok) tremote_ok[u] = { pass, hash, until: time() + 300 };
					}
				}
				if (!ok || !torrent_allowed(u)) {
					system('mkdir -p ' + TREMOTE_RUN + ' && chmod 700 ' + TREMOTE_RUN);
					for (let k in [ ki, ku ])
						writefile(TREMOTE_RUN + '/fail-' + k, join('\n', [ ...tremote_fails(k), time() ]) + '\n');
					delete tremote_ok[u];
					return { error: 'denied' };
				}
				unlink(TREMOTE_RUN + '/fail-' + ki);
				unlink(TREMOTE_RUN + '/fail-' + ku);
				system('mkdir -p ' + TREMOTE_RUN + ' && chmod 700 ' + TREMOTE_RUN);
				let s = torrent_session(u);
				if (s.error) return s;
				s.ticket = tremote_ticket(u);
				return s;
			}
		},

		// the Transmission app: the account's remote access and how to reach it
		remote_get: {
			args: { grant: '' },
			call: function(req) {
				let g = torrent_user({ grant: req.args.grant });
				if (!g) return { error: 'no access' };
				let t = tremote_conf();
				return { user: g.u, on: tremote_hash(g.u) != '', box_enabled: t.enabled, port: t.port, https: t.https, https_port: t.https_port,
					host: web_host().host, path: '/transmission/rpc' };
			}
		},

		// on: false removes the password; on: true makes one when there is none
		// (regen: always a new one). The password is in the answer only then.
		remote_set: {
			args: { grant: '', on: false, regen: false },
			call: function(req) {
				let g = torrent_user({ grant: req.args.grant });
				if (!g) return { error: 'no access' };
				let f = TREMOTE_KEYS + '/' + g.u, out = {};
				delete tremote_ok[g.u];
				if (!req.args.on) unlink(f);
				else if (req.args.regen || tremote_hash(g.u) == '') {
					let p = tremote_new_pass();
					let r = sh_in('mkpasswd -P 0 -m sha256', p);
					let h = trim(r.out);
					if (!match(h, /^\$5\$/)) return { error: 'cannot make a password' };
					system(sprintf('mkdir -p %s && chmod 700 %s && umask 077 && : > %s', TREMOTE_KEYS, TREMOTE_KEYS, shq(f)));
					writefile(f, h + '\n');
					out.password = p;
				}
				let t = tremote_conf();
				return { ...out, user: g.u, on: tremote_hash(g.u) != '', box_enabled: t.enabled, port: t.port, https: t.https, https_port: t.https_port,
					host: web_host().host, path: '/transmission/rpc' };
			}
		},

		// a folder of the account (root + relative path) -> absolute path for the daemon
		path: {
			args: { grant: '', ticket: '', root: '', path: '' },
			call: function(req) {
				let g = torrent_user(req.args);
				if (!g) return { error: 'no access' };
				let p = files_wpath(g.u, req.args.root, req.args.path, 'dir');
				if (p.error) return p;
				return { path: realpath(p.abs) };
			}
		},

		// the account's own watch folder (root + relative path; root "" switches it off)
		watch: {
			args: { grant: '', ticket: '', root: '', path: '' },
			call: function(req) {
				let g = torrent_user(req.args);
				if (!g) return { error: 'no access' };
				let abs = '';
				if ((req.args.root ?? '') != '') {
					let p = files_wpath(g.u, req.args.root, req.args.path, 'dir');
					if (p.error) return p;
					abs = realpath(p.abs);
				}
				let r = sh('/usr/sbin/shareos-transmission watch ' + shq(g.u) + ' ' + shq(abs));
				return jparse(trim(r.out) || 'null') ?? { error: trim(r.out) || 'failed' };
			}
		},

		// the account's own peer port (0 = the default of the box); the
		// controller checks range, other accounts, the box's services, ports in use
		port: {
			args: { grant: '', ticket: '', port: 0 },
			call: function(req) {
				let g = torrent_user(req.args);
				if (!g) return { error: 'no access' };
				let p = req.args.port;
				if (type(p) != 'int' || p < 0 || p > 65535) return { error: 'the peer port must be a number' };
				let r = sh('/usr/sbin/shareos-transmission port ' + shq(g.u) + ' ' + shq(p == 0 ? '' : '' + p));
				return jparse(trim(r.out) || 'null') ?? { error: trim(r.out) || 'failed' };
			}
		}
	},

	// Services -> Torrents: remote access for Transmission programs (admins)
	'shareos.tremote': {
		get: { call: function() { return tremote_status(); } },

		set: {
			args: { enabled: false, port: 0, https_port: 0 },
			call: function(req) {
				let c = cursor(), t = tremote_conf(), a = req.args;
				let port = a.port || t.port, hp = a.https_port || t.https_port;
				for (let p in [ port, hp ])
					if (type(p) != 'int' || p < 1024 || p > 65535) return { error: 'the ports must be between 1024 and 65535' };
				if (port == hp) return { error: 'HTTP and HTTPS need two different ports' };
				let as = apps_server(), used = [ 80, 443, as.port, as.https_port, 8053, 8054, 8200, 8384, 10050 ];
				for (let p in [ port, hp ])
					if (index(used, p) >= 0) return { error: 'port ' + p + ' is used by a service of the box' };
				if (c.get('shareos', 'tremote') == null) c.set('shareos', 'tremote', 'tremote');
				c.set('shareos', 'tremote', 'enabled', a.enabled ? '1' : '0');
				c.set('shareos', 'tremote', 'port', '' + port);
				c.set('shareos', 'tremote', 'https_port', '' + hp);
				c.commit('shareos');
				sh('/etc/init.d/S52tremote restart');
				return tremote_status();
			}
		},

		// takes an account's remote password away (it can make a new one in the app)
		revoke: {
			args: { user: '' },
			call: function(req) {
				let u = req.args.user;
				if (!(u == 'root' || acc_name_ok(u))) return { error: 'invalid name' };
				unlink(TREMOTE_KEYS + '/' + u);
				delete tremote_ok[u];
				return tremote_status();
			}
		}
	},

	// called only by /_shareos/cgi/syncthing on the apps web server (as root,
	// over the local ubus socket); no web session has this object in its ACL.
	// The account's own Syncthing, for apps with "files" + "syncthing".
	'shareos.appsyncthing': {
		session: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'syncthing') < 0) return { error: 'no access' };
				let st = jparse(sh('/usr/sbin/shareos-syncthing status ' + shq(g.u)).out ?? '') ?? {};
				if (!st.running) {
					let r = sh('/usr/sbin/shareos-syncthing start ' + shq(g.u));
					st = jparse(r.out ?? '') ?? { error: trim(r.out) || 'cannot start' };
					if (st.error) return { error: st.error, installed: st.installed };
				}
				return { user: g.u, socket: st.socket, key: trim(readfile('/tmp/shareos-syncthing/' + g.u + '/apikey') ?? ''),
					roots: map(files_roots(g.u), (r) => ({ name: r.name, path: realpath(r.path) ?? r.path, home: !!r.home })) };
			}
		},

		// a folder of the account (root + relative path) -> absolute path for Syncthing
		path: {
			args: { grant: '', root: '', path: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'syncthing') < 0) return { error: 'no access' };
				let p = files_wpath(g.u, req.args.root, req.args.path, 'dir');
				if (p.error) return p;
				return { path: realpath(p.abs) };
			}
		},

		// settings that only apply after a restart of Syncthing
		restart: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant);
				if (!g || index(g.app.permissions ?? [], 'syncthing') < 0) return { error: 'no access' };
				let r = sh('/usr/sbin/shareos-syncthing restart ' + shq(g.u));
				return jparse(r.out ?? '') ?? { error: trim(r.out) || 'failed' };
			}
		}
	},

	// called only by /_shareos/cgi/fs on the apps web server (as root, over the
	// local ubus socket); no web session has this object in its ACL
	'shareos.appfs': {
		// ShareOS.openApp: an app with "files" opens another app for the same
		// account (e.g. BeatBox -> WinWeb Player). The other app gets its own
		// grant, but only if it asks for nothing more than the opening app has
		// (apps share one origin, so the opener could use that grant itself).
		grant_app: {
			args: { grant: '', app: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				let app = filter(apps_for(g.u), (x) => x.id == req.args.app)[0];
				if (!app) return { error: 'app not available' };
				if (!app_has_files(app)) return { error: 'the app has no access to files' };
				let mine = g.app.permissions ?? [];
				for (let p in app.permissions ?? [])
					if (p != 'embed' && p != 'cron' && index(mine, p) < 0) return { error: 'the app needs more permissions than the opening app' };
				return { grant: app_grant_new(g.u, app) };
			}
		},

		roots: {
			args: { grant: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				return { roots: map(files_roots(g), (r) => ({ name: r.name, home: r.home, usb: !!r.usb, ro: !!r.ro, private: !!r.private, personal: !!r.personal, share: !!r.share })), user: g.u };
			}
		},

		list: {
			args: { grant: '', root: '', path: '', hidden: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				return files_list(g, req.args.root, req.args.path, req.args.hidden === true);
			}
		},

		mkdir: {
			args: { grant: '', root: '', path: '', name: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = files_wpath(g, a.root, a.path, 'dir');
				if (p.error) return p;
				let r = files_sh(g.u, 'mkdir -- ' + shq(p.abs + '/' + a.name), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		rename: {
			args: { grant: '', root: '', path: '', name: '', to: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name) || !name_ok(a.to)) return { error: 'invalid name' };
				let p = files_wpath(g, a.root, a.path, 'dir');
				if (p.error) return p;
				if (!lstat(p.abs + '/' + a.name)) return { error: 'not found' };
				if (lstat(p.abs + '/' + a.to)) return { error: 'already exists' };
				let r = files_sh(g.u, sprintf('mv -- %s %s', shq(p.abs + '/' + a.name), shq(p.abs + '/' + a.to)), p.root.share);
				return r.rc == 0 ? { ok: true } : { error: files_err(r) };
			}
		},

		// names from one folder into another (also of another root); copy keeps the originals
		move: {
			args: { grant: '', root: '', path: '', names: [], dest_root: '', dest: '', copy: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (type(a.names) != 'array' || !length(a.names) || length(a.names) > 1000) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let droot = a.dest_root || a.root;
				let p = a.copy ? files_path(g, a.root, a.path, 'dir') : files_wpath(g, a.root, a.path, 'dir'), d = files_wpath(g, droot, a.dest, 'dir');
				if (p.error) return p;
				if (d.error) return d;
				for (let n in a.names) {
					if (!lstat(p.abs + '/' + n)) return { error: 'not found: ' + n };
					let src = (p.rel != '' ? p.rel + '/' : '') + n;
					if (droot == a.root && (d.rel == src || index(d.rel + '/', src + '/') == 0)) return { error: 'a folder cannot be moved into itself' };
					if (lstat(d.abs + '/' + n)) return { error: 'already exists: ' + n };
				}
				return files_bg(g.u, sprintf('%s -- %s %s', a.copy ? 'cp -a' : 'mv', join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), shq(d.abs + '/')), d.root.share);
			}
		},

		delete: {
			args: { grant: '', root: '', path: '', names: [] },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (type(a.names) != 'array' || !length(a.names) || length(a.names) > 1000) return { error: 'nothing selected' };
				for (let n in a.names) if (!name_ok(n)) return { error: 'invalid name' };
				let p = files_wpath(g, a.root, a.path, 'dir');
				if (p.error) return p;
				return files_bg(g.u, 'rm -rf -- ' + join(' ', map(a.names, (n) => shq(p.abs + '/' + n))), p.root.share);
			}
		},

		// how a copy, move or delete that went on in the background ended
		job: {
			args: { grant: '', id: '' },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true);
				if (!g) return { error: 'no access' };
				return files_job(g.u, req.args.id);
			}
		},

		// a file ticket for /_shareos/cgi/file: read, or write (create: also a new file)
		open: {
			args: { grant: '', root: '', path: '', name: '', write: false, create: false },
			call: function(req) {
				let g = app_grant_user(req.args.grant, true), a = req.args;
				if (!g) return { error: 'no access' };
				if (!name_ok(a.name)) return { error: 'invalid name' };
				let p = a.write ? files_wpath(g, a.root, a.path, 'dir') : files_path(g, a.root, a.path, 'dir');
				if (p.error) return p;
				let target = p.abs + '/' + a.name, st = lstat(target);
				if (st ? st.type != 'file' : !(a.write && a.create)) return { error: st ? 'not a file' : 'not found' };
				system('mkdir -p ' + APP_TICKETS + ' && chmod 700 ' + APP_TICKETS);
				system('find ' + APP_TICKETS + ' -type f -mmin +480 -delete 2>/dev/null');
				let t = new_token(), mode = a.write ? 'edit' : 'view';
				writefile(APP_TICKETS + '/' + t, sprintf('%s\n%s\n%s\n%d\n%s\n%s\n', mode, acc_role(g.u) == 'admin' ? 'root' : g.u, target, time() + 8 * 3600, g.app.id, pct_enc(a.name)));
				return { ticket: t, mode, name: a.name, size: st ? st.size : 0, exists: !!st };
			}
		}
	},

	'shareos.apps': {
		installed: {
			call: function() { return { ...apps_server(), apps: apps_list().apps ?? [] }; }
		},

		catalog: {
			// refresh: ask the catalog sources (network) in the background – rpcd
			// answers one call at a time and a slow source would block the whole
			// interface. The answer is the last result; "refreshing" stays true
			// until the new one is there (the interface asks again).
			args: { refresh: false },
			call: function(req) {
				let lock = '/tmp/shareos-apps/catalog.lock', st = stat(lock);
				if (st && time() - st.mtime > 120) { unlink(lock); st = null; }     // left over
				if (req.args.refresh && !st) {
					system('mkdir -p /tmp/shareos-apps');
					writefile(lock, '' + time());
					system(sprintf('(%s catalog; rm -f %s) >/dev/null 2>&1 </dev/null &', APPS_TOOL, lock));
				}
				let A = '/tmp/shareos-apps/';
				let r = memo('catalog', fstamp(A + 'catalogs.json', A + 'catalog-time', A + 'catalog-errors.json', '/etc/config/apps', '/etc/shareos-release')
					+ '|' + fstamp('/www-apps', '/opt/shareos/sysapps'), 30, () => apps_json([ 'cached' ]));
				r = { ...r, refreshing: !!stat(lock) };
				return r;
			}
		},

		install: {
			args: { id: '', version: '' },
			call: function(req) {
				let a = req.args;
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/)) return { error: 'invalid app id' };
				if (a.version && !match(a.version, /^v?[0-9]+\.[0-9]+(\.[0-9]+)?(-[A-Za-z0-9.]+)?$/)) return { error: 'invalid version' };
				system('mkdir -p /tmp/shareos-apps && printf \'{"state":"downloading","id":"%s"}\' ' + shq(a.id) + ' > /tmp/shareos-apps/job.json');
				system('start-stop-daemon -S -b -x ' + APPS_TOOL + ' -- install ' + shq(a.id) + (a.version ? ' ' + shq(a.version) : ''));
				return { started: true };
			}
		},

		status: { call: function() { return apps_json([ 'status' ]); } },

		upload_ticket: {
			// one-time address: the browser sends the .sapp file there (cgi-bin/files)
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-apps && chmod 700 ' + FILES_TICKETS + '; rm -f ' + APPS_UPLOAD);
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n%s\n%d\nupload.sapp\n', APPS_UPLOAD, time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		install_upload: {
			call: function() {
				if (!stat(APPS_UPLOAD)) return { error: 'no uploaded package' };
				let r = apps_json([ 'install-file', APPS_UPLOAD ]);
				unlink(APPS_UPLOAD);
				return r;
			}
		},

		remove: {
			// force: also when another installed app needs it ("requires")
			args: { id: '', force: false },
			call: function(req) {
				if (!match(req.args.id ?? '', /^[a-z][a-z0-9-]{1,31}$/)) return { error: 'invalid app id' };
				return apps_json(req.args.force === true ? [ 'remove', req.args.id, '--force' ] : [ 'remove', req.args.id ]);
			}
		},

		set: {
			// users: '*' (everyone with web access), user names, '@group';
			// display: 'page' (in the ShareOS page, apps with "embed") or 'window'
			args: { id: '', users: [], display: '' },
			call: function(req) {
				let a = req.args, c = cursor(), s = 'app_' + replace(a.id ?? '', '-', '_');
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || c.get('apps', s) != 'app') return { error: 'unknown app' };
				if (a.display != null) {
					if (!(a.display in { page: 1, window: 1 })) return { error: 'invalid display' };
					c.set('apps', s, 'display', a.display);
				}
				if (a.users != null) {
					if (type(a.users) != 'array') return { error: 'invalid users' };
					for (let x in a.users) {
						if (x == '*') continue;
						if (substr(x, 0, 1) == '@' ? c.get('accounts', substr(x, 1)) != 'group' : c.get('accounts', x) != 'user') return { error: 'unknown user or group: ' + x };
					}
					c.delete('apps', s, 'users');
					if (length(a.users)) c.set('apps', s, 'users', a.users);
				}
				c.commit('apps');
				return { ok: true };
			}
		},

		// scheduled task of an app: schedule (cron time, at most every 5 min) and on/off
		job_set: {
			args: { id: '', job: '', schedule: '', enabled: true },
			call: function(req) {
				let a = req.args, c = cursor();
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || !match(a.job ?? '', /^[a-z][a-z0-9-]{0,23}$/)) return { error: 'invalid app or job' };
				let s = 'job_' + replace(a.id, '-', '_') + '__' + replace(a.job, '-', '_');
				if (c.get('apps', s) != 'appjob') return { error: 'unknown job' };
				if (a.schedule != null && a.schedule != '') {
					let min = split(a.schedule, ' ')[0], m = match(min, /^\*\/([0-9]+)$/);
					if (!match(a.schedule, /^[0-9*\/,-]+( [0-9*\/,-]+){4}$/) || min == '*' || (m && +m[1] < 5))
						return { error: 'invalid schedule (cron time, at most every 5 minutes)' };
					if (a.schedule != c.get('apps', s, 'schedule')) { c.set('apps', s, 'schedule', a.schedule); c.set('apps', s, 'custom', '1'); }
				}
				if (a.enabled != null) c.set('apps', s, 'enabled', a.enabled ? '1' : '0');
				c.commit('apps');
				system('/usr/sbin/shareos-cron sync >/dev/null 2>&1');
				return { ok: true };
			}
		},

		// run a scheduled task now (in the background)
		job_run: {
			args: { id: '', job: '' },
			call: function(req) {
				let a = req.args;
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || !match(a.job ?? '', /^[a-z][a-z0-9-]{0,23}$/)) return { error: 'invalid app or job' };
				system('start-stop-daemon -S -b -x ' + APPS_TOOL + ' -- run-job ' + shq(a.id) + ' ' + shq(a.job));
				return { started: true };
			}
		},

		job_log: {
			args: { id: '', job: '' },
			call: function(req) {
				let a = req.args;
				if (!match(a.id ?? '', /^[a-z][a-z0-9-]{1,31}$/) || !match(a.job ?? '', /^[a-z][a-z0-9-]{0,23}$/)) return { error: 'invalid app or job' };
				return apps_json([ 'job-log', a.id, a.job ]);
			}
		},

		store_get: {
			call: function() {
				let c = cursor(), src = c.get('apps', 'store', 'source');
				return { channel: c.get('apps', 'store', 'channel') ?? 'stable', sources: type(src) == 'array' ? src : (src ? [ src ] : []), ...apps_server() };
			}
		},

		store_set: {
			args: { channel: '', sources: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.channel && !(a.channel in { stable: 1, beta: 1 })) return { error: 'invalid channel' };
				if (a.sources != null) {
					if (type(a.sources) != 'array' || length(a.sources) > 10) return { error: 'invalid sources' };
					for (let u in a.sources)
						if (!match(u, /^https:\/\/[A-Za-z0-9.:\[\]_-]+(\/[^[:space:]"'<>]*)?$/)) return { error: 'invalid source (https://… only): ' + u };
				}
				c.set('apps', 'store', 'store');
				if (a.channel) c.set('apps', 'store', 'channel', a.channel);
				if (a.sources != null) { c.delete('apps', 'store', 'source'); if (length(a.sources)) c.set('apps', 'store', 'source', a.sources); }
				c.commit('apps');
				return { ok: true };
			}
		}
	},

	'shareos.notify': {
		list: {
			call: function() { return notify_json([ 'list' ]); }
		},
		// id or "all"
		read: {
			args: { id: '' },
			call: function(req) {
				let id = req.args.id || 'all';
				if (id != 'all' && !match(id, /^[0-9a-f]{1,32}$/)) return { error: 'invalid id' };
				return notify_json([ 'read', id ]);
			}
		},
		delete: {
			args: { id: '' },
			call: function(req) {
				let id = req.args.id || 'all';
				if (id != 'all' && !match(id, /^[0-9a-f]{1,32}$/)) return { error: 'invalid id' };
				return notify_json([ 'delete', id ]);
			}
		},
		get: {
			call: function() { return notify_settings(); }
		},
		// smtp_pass / push_token: null = keep, '' = remove
		set: {
			args: { email: false, smtp_host: '', smtp_tls: '', smtp_port: '', smtp_user: '', smtp_pass: '', mail_from: '', mail_to: '', email_level: '',
				push: false, push_type: '', push_url: '', push_token: '', push_chat: '', push_level: '', temp_max: 55, disk_full: 90 },
			call: function(req) {
				let a = req.args, c = cursor();
				let mail = (x) => x == null || x == '' || match(x, /^[^@[:space:],;]+@[^@[:space:],;]+$/);
				if (a.smtp_host != null && a.smtp_host != '' && !match(a.smtp_host, /^[A-Za-z0-9.-]{1,253}$/)) return { error: 'invalid mail server' };
				if (a.smtp_tls != null && a.smtp_tls != '' && !(a.smtp_tls in { starttls: 1, ssl: 1, none: 1 })) return { error: 'invalid encryption' };
				if (a.smtp_port != null && a.smtp_port != '' && !(match('' + a.smtp_port, /^[0-9]+$/) && +a.smtp_port >= 1 && +a.smtp_port <= 65535)) return { error: 'invalid port' };
				if (!mail(a.mail_from)) return { error: 'invalid sender address' };
				for (let r in split(a.mail_to ?? '', /[ ,;]+/)) if (length(r) && !mail(r)) return { error: 'invalid recipient: ' + r };
				for (let k in [ 'email_level', 'push_level' ]) if (a[k] != null && a[k] != '' && !(a[k] in { info: 1, warn: 1, error: 1 })) return { error: 'invalid level' };
				if (a.push_type != null && a.push_type != '' && !(a.push_type in { ntfy: 1, gotify: 1, telegram: 1, webhook: 1 })) return { error: 'invalid push service' };
				if (a.push_chat != null && a.push_chat != '' && !match('' + a.push_chat, /^-?[0-9]{1,20}$|^@[A-Za-z0-9_]{5,32}$/)) return { error: 'invalid chat ID' };
				if (a.push_url != null && a.push_url != '' && !match(a.push_url, /^https?:\/\/[^[:space:]'"]{3,250}$/)) return { error: 'invalid push address' };
				if (a.temp_max != null && !(+a.temp_max >= 40 && +a.temp_max <= 70)) return { error: 'temperature limit: 40 … 70 °C' };
				if (a.disk_full != null && !(+a.disk_full >= 50 && +a.disk_full <= 99)) return { error: 'full limit: 50 … 99 %' };
				for (let k in [ 'smtp_user', 'smtp_pass', 'push_token' ]) if (a[k] != null && match(a[k], /[\n\r]/)) return { error: 'invalid characters' };
				if (c.get('shareos', 'notify') != 'notify') c.set('shareos', 'notify', 'notify');
				for (let k in [ 'smtp_host', 'smtp_tls', 'smtp_port', 'smtp_user', 'mail_from', 'mail_to', 'email_level', 'push_type', 'push_url', 'push_chat', 'push_level' ])
					if (a[k] != null) c.set('shareos', 'notify', k, '' + a[k]);
				for (let k in [ 'smtp_pass', 'push_token' ]) if (a[k] != null) c.set('shareos', 'notify', k, a[k]);
				if (a.email != null) c.set('shareos', 'notify', 'email', a.email ? '1' : '0');
				if (a.push != null) c.set('shareos', 'notify', 'push', a.push ? '1' : '0');
				if (a.temp_max != null) c.set('shareos', 'notify', 'temp_max', '' + int(a.temp_max));
				if (a.disk_full != null) c.set('shareos', 'notify', 'disk_full', '' + int(a.disk_full));
				c.commit('shareos');
				return notify_settings();
			}
		},
		test: {
			call: function() { return notify_json([ 'test' ]); }
		},
		telegram_chats: {
			call: function() { return notify_json([ 'telegram-chats' ]); }
		}
	},

	'shareos.widget': {
		get: {
			call: function() {
				let c = cursor();
				return { enabled: c.get('shareos', 'widget', 'enabled') == '1', token: c.get('shareos', 'widget', 'token') ?? '' };
			}
		},

		set: {
			// enabled: on/off; renew: new token (the old address stops working)
			args: { enabled: false, renew: false },
			call: function(req) {
				let c = cursor();
				c.set('shareos', 'widget', 'widget');
				if (req.args.enabled != null) c.set('shareos', 'widget', 'enabled', req.args.enabled ? '1' : '0');
				if (req.args.renew || !c.get('shareos', 'widget', 'token')) c.set('shareos', 'widget', 'token', new_token());
				c.commit('shareos');
				return { enabled: c.get('shareos', 'widget', 'enabled') == '1', token: c.get('shareos', 'widget', 'token') };
			}
		},

		status: {
			// called by /www/cgi-bin/status with the token from the address;
			// no web login has it in its ACL
			args: { token: '' },
			call: function(req) {
				let c = cursor();
				if (c.get('shareos', 'widget', 'enabled') != '1') return { error: 'disabled' };
				if (!same_token(req.args.token, c.get('shareos', 'widget', 'token'))) return { error: 'denied' };
				return widget_status();
			}
		}
	},

	'shareos.update': {
		// the one setting of the Firmware page. It has a method of its own, so
		// that web sessions need no general write access to the settings (uci)
		set_channel: {
			args: { channel: '' },
			call: function(req) {
				if (!channel_ok(req.args.channel)) return { error: 'invalid channel' };
				let c = cursor();
				c.set('shareos', 'update', 'update');
				c.set('shareos', 'update', 'channel', req.args.channel);
				c.commit('shareos');
				return { ok: true, channel: req.args.channel };
			}
		},

		check: {
			args: { channel: 'stable' },
			call: function(req) {
				let ch = req.args.channel;
				return run_updater(ch ? [ 'check', ch ] : [ 'check' ]);
			}
		},

		// The check the interface starts by itself: in the background. Asking
		// GitHub takes up to a minute on a box without internet, and rpcd
		// answers one call at a time – the result comes with "status".
		check_auto: {
			call: function() { return spawn_updater([ 'auto' ]); }
		},

		status: {
			// asked every few seconds by the interface: only when the update state changed
			call: function() {
				let d = '/tmp/shareos-update';
				return memo('update', fstamp(d + '/state.json', d + '/dl/fw.tar.part', d + '/dl/fw.tar',
					'/overlay/upgrade-result', '/overlay/upgrade/rootfs.squashfs', '/etc/shareos-release'), 60,
					() => run_updater([ 'status' ]));
			}
		},

		download: {
			args: { tag: '' },
			call: function(req) {
				if (!req.args.tag)
					return { error: 'tag missing' };
				let s = run_updater([ 'status' ]);
				if (s.state == 'downloading' || s.state == 'verifying' || s.state == 'flashing')
					return { error: 'busy: ' + s.state };
				return spawn_updater([ 'download', req.args.tag ]);
			}
		},

		apply: {
			// "confirm" must be true: flashing is the one step that cannot be undone
			args: { tag: '', confirm: false },
			call: function(req) {
				if (req.args.confirm !== true)
					return { error: 'confirm must be true' };
				let s = run_updater([ 'status' ]);
				if (s.state != 'ready' || s.release?.tag != req.args.tag)
					return { error: 'release not downloaded and verified' };
				return spawn_updater([ 'apply', req.args.tag ]);
			}
		},

		cancel: {
			call: function() {
				return run_updater([ 'cancel' ]);
			}
		},

		// hide the "last update" message
		ack: {
			call: function() {
				return run_updater([ 'ack' ]);
			}
		},

		// update without internet: upload the .sysupgrade.tar of a release
		local_ticket: {
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-fw && chmod 700 ' + FILES_TICKETS + ' /tmp/shareos-fw; rm -f /tmp/shareos-fw/upload.tar');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n/tmp/shareos-fw/upload.tar\n%d\nupload.tar\n', time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		local: {
			// sha256: content of the release's .sha256 file (optional)
			args: { sha256: '' },
			call: function(req) {
				let sha = req.args.sha256 ?? '';
				let m = match(sha, /[0-9a-f]{64}/);
				if (sha != '' && !m) return { error: 'checksum file is invalid' };
				if (!stat('/tmp/shareos-fw/upload.tar')) return { error: 'no uploaded file' };
				let s = run_updater([ 'status' ]);
				if (s.state == 'downloading' || s.state == 'verifying' || s.state == 'flashing')
					return { error: 'busy: ' + s.state };
				return spawn_updater(m ? [ 'local', '/tmp/shareos-fw/upload.tar', m[0] ] : [ 'local', '/tmp/shareos-fw/upload.tar' ]);
			}
		},

		// another firmware file in D-Link format (.bin), e.g. back to Alt-F
		bin_ticket: {
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-fw && chmod 700 ' + FILES_TICKETS + ' /tmp/shareos-fw; rm -f /tmp/shareos-fw/upload.bin');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n/tmp/shareos-fw/upload.bin\n%d\nupload.bin\n', time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		bin_info: {
			call: function() {
				if (!stat('/tmp/shareos-fw/upload.bin')) return { error: 'no uploaded file' };
				let r = sh('/usr/sbin/shareos-flash-bin info /tmp/shareos-fw/upload.bin'), o = {};
				if (r.rc != 0) { unlink('/tmp/shareos-fw/upload.bin'); return { error: replace(trim(r.out), /^error: /, '') }; }
				for (let l in split(r.out, '\n')) { let m = match(l, /^([a-z_]+)=(.*)$/); if (m) o[m[1]] = m[2]; }
				return o;
			}
		},

		bin_write: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true) return { error: 'confirm must be true' };
				if (!stat('/tmp/shareos-fw/upload.bin')) return { error: 'no uploaded file' };
				let r = sh('/usr/sbin/shareos-flash-bin write /tmp/shareos-fw/upload.bin --yes');
				unlink('/tmp/shareos-fw/upload.bin');
				if (r.rc != 0) return { error: replace(trim(r.out), /^error: /, '') };
				let m = match(r.out, /kind=([a-z]+)/);
				return { ok: true, kind: m ? m[1] : 'other' };
			}
		}
	}
};
