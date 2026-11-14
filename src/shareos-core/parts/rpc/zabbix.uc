/* ---------- permission "zabbix": the box's Zabbix agent for apps (admins) ---------- */

const ZB_SET = [ 'enabled', 'server', 'hostname', 'metadata', 'psk_identity', 'psk', 'passive', 'allow', 'port', 'disk_interval' ];
function zb_tool(args, input) {
	// SHAREOS_ZABBIX_RPCD: it must not call rpcd back while we wait for it
	let cmd = 'SHAREOS_ZABBIX_RPCD=1 /usr/sbin/shareos-zabbix ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-zb-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}
function ab_tool(args, input) {
	let cmd = AUTOBRR + ' ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-ab-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

function pid_alive(file, name) {
	let p = +trim(readfile(file) ?? '0');
	return p > 1 && index(readfile('/proc/' + p + '/cmdline') ?? '', name) >= 0;
}

// what the account's Transmission daemon is doing: torrents downloading,
// torrents seeding that upload right now (over its Unix socket, like
// /_shareos/cgi/transmission; the CSRF token of Transmission is shared with it)
function torrent_activity(u) {
	let dir = '/tmp/shareos-transmission/' + u, tokf = dir + '/token';
	let body = '{"method":"torrent-get","arguments":{"fields":["status","rateUpload"]}}';
	let call = () => {
		let r = sh(sprintf("curl -s -m 3 -D - --unix-socket %s -H %s -H 'Content-Type: application/json' --data-binary %s http://localhost/transmission/rpc",
			shq(dir + '/rpc.sock'), shq('X-Transmission-Session-Id: ' + trim(readfile(tokf) ?? '')), shq(body)));
		let i = index(r.out, '\r\n\r\n');
		if (i < 0) return null;
		let head = substr(r.out, 0, i);
		return { code: +(match(head, /^HTTP\/[0-9.]+ ([0-9]{3})/)?.[1] ?? 0), token: match(head, /\nX-Transmission-Session-Id: *([^\r\n]+)/i)?.[1], body: substr(r.out, i + 4) };
	};
	let r = call();
	if (r && r.code == 409 && r.token) { writefile(tokf, r.token); r = call(); }
	if (!r || r.code != 200) return null;
	let j = jparse(r.body);
	let down = 0, up = 0;
	for (let x in j?.arguments?.torrents ?? []) {
		if (x.status == 4) down++;                              // downloading
		else if (x.status == 6 && x.rateUpload > 0) up++;      // seeding, and someone loads from it
	}
	return { down, up };
}

// the chips of an account: services of the firmware, then the apps
function status_chips(u) {
	let chips = [], admin = acc_role(u) == 'admin', apps = apps_for(u), ids = {};
	for (let a in apps) ids[a.id] = a;
	if (admin && stat('/opt/shareos/bin/openvpn') && pid_alive('/tmp/shareos-vpn/pid', 'openvpn')) {
		let st = vpn_tool([ 'status' ]);
		let ok = st.state == 'CONNECTED';
		push(chips, { id: 'svc:vpn', label: 'VPN', detail: ok ? (st.ip ?? 'connected') : 'connecting …', state: ok ? 'ok' : 'warn',
			app: ids.nettunnel ? 'nettunnel' : null });
	}
	if (admin && stat('/opt/shareos/bin/openvpn') && pid_alive('/tmp/shareos-vpn-server/pid', 'openvpn')) {
		let n = 0;
		for (let l in split(readfile('/tmp/shareos-vpn-server/status') ?? '', '\n')) if (substr(l, 0, 12) == 'CLIENT_LIST,') n++;
		push(chips, { id: 'svc:vpnserver', label: 'VPN-SERVER', detail: n == 1 ? '1 device' : n + ' devices', state: 'ok',
			app: ids.nettunnel ? 'nettunnel' : null });
	}
	if (admin && stat('/opt/shareos/bin/tailscaled') && pid_alive('/tmp/shareos-tailscale/pid', 'tailscaled')) {
		// cheap (every 15 s): the address of tailscale0 instead of asking the daemon
		let m = match(sh('ip -4 -o addr show dev tailscale0').out, /inet (100\.[0-9.]+)\//);
		push(chips, { id: 'svc:tailscale', label: 'TAILSCALE', detail: m ? m[1] : 'disconnected',
			state: m ? 'ok' : 'warn', app: ids.tailscale ? 'tailscale' : null });
	}
	if (stat('/tmp/shareos-transmission/' + u + '/pid') && pid_alive('/tmp/shareos-transmission/' + u + '/pid', 'transmission')) {
		// only while something really moves: torrents downloading, or seeding with upload
		let t = torrent_activity(u);
		if (t && (t.down || t.up))
			push(chips, { id: 'svc:torrent', label: 'TORRENT', detail: join(' ', [ ...(t.down ? [ '↓ ' + t.down ] : []), ...(t.up ? [ '↑ ' + t.up ] : []) ]),
				state: 'ok', app: ids.transmission ? 'transmission' : null });
	}
	if (admin && pid_alive('/tmp/shareos-dlna/minidlna.pid', 'minidlna'))
		push(chips, { id: 'svc:dlna', label: 'DLNA', detail: 'running', state: 'ok', href: '#/services/dlna' });
	let now = time();
	for (let f in lsdir(APPSTATUS + '/' + u) ?? []) {
		let m = match(f, /^([a-z][a-z0-9-]{1,31})\.json$/), a = m ? ids[m[1]] : null;
		if (!a || index(a.permissions ?? [], 'status') < 0) continue;
		let x = jparse(readfile(APPSTATUS + '/' + u + '/' + f) ?? 'null');
		if (type(x) != 'object' || +x.until < now) continue;
		push(chips, { id: 'app:' + a.id, label: x.text, state: x.state, app: a.id, name: a.name });
	}
	return chips;
}


function widget_status() {
	let up = split(read_trim('/proc/uptime') ?? '0', ' ');
	let load = split(read_trim('/proc/loadavg') ?? '', ' ');
	let m = meminfo();
	let t = box_temp();
	let alerts = [];
	// the same limits as the messages (System → Messages), not fixed ones
	let nc = cursor();
	let temp_max = +(nc.get('shareos', 'notify', 'temp_max') ?? 55), disk_full = +(nc.get('shareos', 'notify', 'disk_full') ?? 90);
	let vols = [];
	for (let v in volumes()) {
		let x = { name: v.name, mounted: v.mounted };
		if (v.size) {
			x.size = v.size; x.free = v.avail;
			x.used_pct = int(v.used * 100 / v.size + 0.5);
			if (x.used_pct >= disk_full) push(alerts, 'volume ' + v.name + ' ' + x.used_pct + '% full');
		}
		if (v.enabled && !v.mounted) push(alerts, 'volume ' + v.name + ' not mounted');
		push(vols, x);
	}
	let raid = [];
	for (let n, a in mdstat()) {
		let x = { name: n, level: a.level, health: a.health, sync: a.sync?.percent };
		if (a.health && index(a.health, '_') >= 0) push(alerts, n + ' degraded [' + a.health + ']');
		push(raid, x);
	}
	if (t != null && t >= temp_max * 1000) push(alerts, 'temperature ' + int(t / 1000) + ' °C');
	// a box with fan control that gives no reading, and disks whose SMART
	// values are not good, are not "ok" either
	if (t == null && board_control().control) push(alerts, 'temperature cannot be read');
	for (let d in disks_state())
		if (d.smart == 'bad' || d.smart == 'warn') push(alerts, 'disk ' + d.name + ': SMART ' + (d.smart == 'bad' ? 'critical' : 'caution'));
	let r = release();
	return {
		host: read_trim('/proc/sys/kernel/hostname'),
		version: r.version ?? '',
		time: time(),
		uptime: int(+up[0]),
		load: +load[0],
		temp_c: t != null ? int(t / 100) / 10 : null,
		fan_pwm: read_int('/tmp/sys/pwm1'),
		mem_used_pct: m.memtotal ? int((m.memtotal - (m.memavailable ?? m.memfree)) * 100 / m.memtotal + 0.5) : null,
		volumes: vols,
		raid,
		ok: !length(alerts),
		alerts
	};
}

