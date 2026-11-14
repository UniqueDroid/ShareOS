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

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
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
	}
});
