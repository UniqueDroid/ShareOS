/* ---------- media server (MiniDLNA, shareos-dlna) ---------- */

const DLNA = '/usr/sbin/shareos-dlna';
const DLNA_TYPES = { A: 1, V: 1, P: 1, '-': 1 };

function dlna_status() {
	let st = {}, clients = [];
	for (let l in split(sh(DLNA + ' status').out, '\n')) {
		let m = match(l, /^([a-z]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'client') { let f = split(m[2], '|'); push(clients, { type: f[0], ip: f[1] }); }
		else st[m[1]] = m[2];
	}
	let c = cursor(), media = [];
	for (let x in list_of(c.get('dlna', 'main', 'media'))) {
		let m = match(x, /^([AVP-]),(share:.+)$/), ref = m ? share_ref(m[2]) : null;
		if (ref) push(media, ref.sub != '' ? { type: m[1], share: ref.share, path: ref.sub } : { type: m[1], share: ref.share });
	}
	// counts: null while the media server does not answer (starting, busy) –
	// not 0, which would read as an empty library
	let num = (v) => v != null && match(v, /^[0-9]+$/) ? +v : null;
	let shares = filter(share_list().shares, (x) => x.volume);
	return { installed: st.installed == '1', enabled: st.enabled == '1', running: st.running == '1', scanning: st.scanning == '1',
		audio: num(st.audio), video: num(st.video), image: num(st.image), db: st.db ?? null, clients,
		name: c.get('dlna', 'main', 'name') ?? '', hostname: trim(readfile('/proc/sys/kernel/hostname') ?? ''), media,
		shares: map(shares, (x) => x.name),
		share_dirs: map(shares, (x) => ({ name: x.name, volume: x.volume, path: x.path })) };
}

