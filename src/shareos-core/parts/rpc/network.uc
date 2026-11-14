/* ---------- network ---------- */

function ip4_ok(a) {
	let m = match(a ?? '', /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
	if (!m) return false;
	for (let i = 1; i <= 4; i++) if (+m[i] > 255) return false;
	return true;
}

function pow2(n) {
	let v = 1;
	for (let i = 0; i < n; i++) v *= 2;
	return v;
}

function ip4_num(a) {
	let p = split(a, '.');
	return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3];
}

// prefix length of a netmask, null if the mask is not contiguous
function mask_prefix(m) {
	if (!ip4_ok(m)) return null;
	let n = ip4_num(m), bits = 0;
	for (let i = 31; i >= 0; i--) {
		let b = int(n / (pow2(i))) % 2;
		if (b == 1 && bits == 31 - i) bits++;
		else if (b == 1) return null;
	}
	return bits;
}

function net_settings() {
	let c = cursor();
	let dns = c.get('network', 'lan', 'dns') ?? '';
	if (type(dns) == 'array') dns = join(' ', dns);
	return {
		proto: c.get('network', 'lan', 'proto') == 'static' ? 'static' : 'dhcp',
		ipaddr: c.get('network', 'lan', 'ipaddr') ?? '',
		netmask: c.get('network', 'lan', 'netmask') ?? '255.255.255.0',
		gateway: c.get('network', 'lan', 'gateway') ?? '',
		dns: filter(split(trim(dns), /[ ,]+/), (x) => x != '')
	};
}

function net_state() {
	let pending = read_int(NET_ST + '/pending');
	return {
		pending: pending != null ? { until: pending, left: (pending > time() ? pending - time() : 0) } : null,
		result: read_trim(NET_ST + '/result')
	};
}

function cert_info_read() {
	let r = sh(CERT + ' info');
	let i = { san: [] };
	for (let line in split(r.out, '\n')) {
		let m = match(line, /^([a-z]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'san') push(i.san, m[2]);
		else i[m[1]] = m[2];
	}
	i.selfsigned = !!(i.issuer && i.issuer == i.subject);
	return i;
}
function cert_info() {
	let c = cursor(), crt = c.get('shareos', 'web', 'cert') ?? '/etc/ssl/shareos/server.crt';
	return memo('cert', crt + '|' + fstamp(crt), 0, cert_info_read);
}

// where the web certificate comes from: ca (own CA), acme (Let's Encrypt), '' (self-signed/own)
function web_source(v) {
	let c = cursor();
	c.set('shareos', 'web', 'web');
	if (v) c.set('shareos', 'web', 'source', v); else c.delete('shareos', 'web', 'source');
	c.commit('shareos');
}

// both web servers (admin interface and apps) run under shareos-uhttpd,
// which starts them again and reads settings and certificate anew
function restart_uhttpd() {
	system('(sleep 1; killall uhttpd) >/dev/null 2>&1 &');
}

// our self-signed certificate names hostname and IP: renew it after a change
function cert_refresh() {
	if (cursor().get('shareos', 'web', 'https') == '0') return false;
	let r = sh(CERT + ' ensure'); forget('cert');
	if (!match(r.out, /renewed/)) return false;
	restart_uhttpd();
	return true;
}

