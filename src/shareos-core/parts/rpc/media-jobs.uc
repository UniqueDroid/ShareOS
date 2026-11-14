/* ---------- media jobs (ffmpeg system app, apps with "media") ---------- */

const MEDIA_DIR = '/tmp/shareos-media/jobs';
const FFPROBE = '/opt/shareos/bin/ffprobe';
const MEDIA_REMUX = { mp4: 'mp4', mkv: 'mkv', mov: 'mov', ts: 'ts', webm: 'webm' };
const MEDIA_AUDIO = { mp3: [ 'mp3', 'libmp3lame' ], m4a: [ 'm4a', 'aac' ], opus: [ 'opus', 'libopus' ], flac: [ 'flac', 'flac' ], wav: [ 'wav', 'pcm_s16le' ] };
const MEDIA_COPY_EXT = { aac: 'm4a', alac: 'm4a', mp3: 'mp3', mp2: 'mp2', opus: 'opus', vorbis: 'ogg', flac: 'flac', ac3: 'mka', eac3: 'mka' };
const MEDIA_BITRATES = { '64k': 1, '96k': 1, '128k': 1, '160k': 1, '192k': 1, '256k': 1, '320k': 1 };
const MEDIA_MAX_QUEUED = 10;

function media_time(v) {
	if (v == null || v == '') return null;
	v = '' + v;
	return match(v, /^([0-9]{1,2}:)?[0-9]{1,2}:[0-9]{2}(\.[0-9]{1,3})?$/) || match(v, /^[0-9]{1,6}(\.[0-9]{1,3})?$/) ? v : false;
}
function media_secs(v) {
	if (v == null) return null;
	let p = split(v, ':'), n = 0;
	for (let x in p) n = n * 60 + +x;
	return n;
}

// ffprobe with the account's rights; streams and format, nothing else
function media_probe(u, abs) {
	if (stat(FFPROBE)?.type != 'file') return { error: 'ffmpeg is not installed (system app "ffmpeg" in the store)' };
	let r = files_sh(u, sprintf('timeout 30 %s -v error -protocol_whitelist file -show_format -show_streams -of json -- %s', shq(FFPROBE), shq(abs)));
	let d = jparse(r.out ?? '');
	if (r.rc != 0 || type(d) != 'object') return { error: 'not a media file' + (trim(r.out) ? ': ' + substr(trim(r.out), 0, 200) : '') };
	let f = d.format ?? {};
	return {
		format: f.format_name ?? '', duration: +(f.duration ?? 0), size: +(f.size ?? 0), bit_rate: +(f.bit_rate ?? 0),
		title: f.tags?.title ?? null,
		streams: map(d.streams ?? [], (x) => ({ index: x.index, type: x.codec_type, codec: x.codec_name, channels: x.channels ?? null,
			sample_rate: +(x.sample_rate ?? 0) || null, bit_rate: +(x.bit_rate ?? 0) || null, width: x.width ?? null, height: x.height ?? null,
			language: x.tags?.language ?? null, title: x.tags?.title ?? null }))
	};
}

// root + path + name of the account -> absolute file (must exist)
function media_file(u, f) {
	if (type(f) != 'object' || !name_ok(f.name)) return { error: 'invalid file' };
	let p = files_path(u, f.root, f.path, 'dir');
	if (p.error) return p;
	let abs = realpath(p.abs) + '/' + f.name;
	if (lstat(abs)?.type != 'file') return { error: 'not a file' };
	return { abs };
}

function media_jobs(u) {
	let list = [];
	let wp = +trim(readfile('/tmp/shareos-media/worker.pid') ?? '0'), worker = wp > 1 && stat('/proc/' + wp) != null;
	for (let f in lsdir(MEDIA_DIR) ?? []) {
		let m = match(f, /^([0-9a-f]{16})\.json$/);
		if (!m) continue;
		let j = null;
		try { j = json(readfile(MEDIA_DIR + '/' + f) ?? 'null'); } catch (e) { }
		// "running" without the worker (killed, out of memory): interrupted
		if (type(j) == 'object' && (j.state == 'running' || j.state == 'stopping') && !worker) {
			j.state = 'error';
			j.error = 'the job was interrupted';
		}
		if (type(j) == 'object' && j.user == u)
			push(list, { id: j.id, state: j.state, action: j.action, format: j.format, input: j.input_box, output: j.output_box,
				progress: j.progress ?? 0, error: j.error ?? null, created: j.created, started: j.started ?? null,
				finished: j.finished ?? null, size: j.size ?? null, duration: j.duration ?? 0 });
	}
	return sort(list, (a, b) => b.created - a.created);
}

function files_list(u, root, rel, hidden) {
	let p = files_path(u, root, rel, 'dir');
	if (p.error) return p;
	let names = lsdir(p.abs) ?? [], out = [], n = 0;
	for (let name in sort(names)) {
		if (!hidden && substr(name, 0, 1) == '.') continue;
		if (name == '.shareos-trash' && p.rel == '') continue;   // the trash has its own view
		if (++n > FILES_MAX) break;
		let st = lstat(p.abs + '/' + name);
		if (!st) continue;
		let t = st.type == 'directory' ? 'dir' : st.type == 'link' ? (stat(p.abs + '/' + name)?.type == 'directory' ? 'dirlink' : 'link') : st.type == 'file' ? 'file' : 'other';
		push(out, { name, type: t, size: st.size, mtime: st.mtime });
	}
	out = sort(out, (a, b) => ((a.type == 'dir') != (b.type == 'dir')) ? (a.type == 'dir' ? -1 : 1) : (lc(a.name) < lc(b.name) ? -1 : 1));
	let df = split(trim(split(sh('df -k ' + shq(p.root.path)).out, '\n')[1] ?? ''), /\s+/);
	return { root, path: p.rel, entries: out, truncated: n > FILES_MAX,
		free: length(df) >= 4 ? +df[3] * 1024 : null, size: length(df) >= 4 ? +df[1] * 1024 : null };
}

function pct_enc(s) {
	let o = '';
	for (let i = 0; i < length(s); i++) {
		let c = ord(s, i);
		o += (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || index('-._~', chr(c)) >= 0 ? chr(c) : sprintf('%%%02X', c);
	}
	return o;
}

// favourite apps of an account ("FAV APPS" bar): root keeps them in shareos.ui,
// every other account in its accounts section
function fav_of(c, u) {
	let cfg = u == 'root' ? [ 'shareos', 'ui' ] : [ 'accounts', u ];
	return { apps: list_of(c.get(cfg[0], cfg[1], 'fav')), bar: c.get(cfg[0], cfg[1], 'fav_bar') != '0',
		text: c.get(cfg[0], cfg[1], 'fav_text') != '0' };
}

function me_info(u) {
	let c = cursor();
	let role = u == 'root' ? 'admin' : (c.get('accounts', u, 'role') ?? 'share');
	let info = { name: u, role, fullname: u == 'root' ? 'Administrator' : (c.get('accounts', u, 'fullname') ?? ''),
		groups: list_of(c.get('accounts', u, 'groups')), quota: +(c.get('accounts', u, 'quota') ?? 0) };
	let home = c.get('accounts', u, 'home');
	info.home = home ? { volume: home, path: '/mnt/' + home + '/home/' + u, smb: u } : null;
	info.usage = quota_usage()[u] ?? [];
	// shares this account can reach and how
	let mine = [];
	let tags = [ u, ...map(info.groups, (g) => '@' + g) ];
	c.foreach('shares', 'share', (x) => {
		let rw = list_of(x.rw), ro = list_of(x.ro), access = null;
		for (let t in tags) { if (index(rw, t) >= 0) access = 'rw'; else if (!access && index(ro, t) >= 0) access = 'ro'; }
		if (!access && x.guest == '1') access = 'ro';
		if (access && x.smb == '1') push(mine, { name: x['.name'], access, comment: x.comment ?? '', volume: x.volume ?? '',
			vault: x.vault == '1', vault_ttl: vault_ttl(x.vault_ttl), vault_until: 0 });
	});
	if (length(filter(mine, (x) => x.vault))) {
		let open = vault_state();
		for (let x in mine) if (x.vault) x.vault_until = filter(open[x.name] ?? [], (o) => o.user == u)[0]?.until ?? 0;
	}
	info.shares = mine;
	// the drives of the personal folder and the shares: size and free space
	// ("SPEICHER" table of Mein ShareOS)
	let vols = home ? [ home ] : [], mounts = readfile('/proc/mounts') ?? '';
	for (let s in mine) if (s.volume && index(vols, s.volume) < 0) push(vols, s.volume);
	// is the drive of a share there? (the dot of the share under My ShareOS)
	for (let s in mine) s.mounted = !!s.volume && index(mounts, ' /mnt/' + s.volume + ' ') >= 0;
	vols = filter(vols, (v) => match(v, /^[A-Za-z0-9._-]+$/) && index(mounts, ' /mnt/' + v + ' ') >= 0);
	info.volumes = [];
	if (length(vols))
		for (let line in split(sh('df -k ' + join(' ', map(vols, (v) => shq('/mnt/' + v)))).out, '\n')) {
			let f = split(trim(line), /\s+/);
			if (length(f) < 6 || !match(f[1], /^[0-9]+$/) || substr(f[5], 0, 5) != '/mnt/') continue;
			push(info.volumes, { name: substr(f[5], 5), size: +f[1] * 1024, used: +f[2] * 1024, avail: +f[3] * 1024 });
		}
	info.host = read_trim('/proc/sys/kernel/hostname');
	info.cloud = area_on('cloud') && me_cloud_allowed(u);
	info.files = u != 'root' && role != 'admin' && files_allowed(u);
	info.apps = role == 'admin' || !area_on('apps') ? [] : map(apps_for(u), (a) => ({ id: a.id, name: a.name, entry: a.entry, icon: a.icon, icon_data: a.icon_data, description: a.description,
		permissions: a.permissions ?? [], window: a.window, display: a.display }));
	info.apps_server = apps_server();
	info.ui = u == 'root' ? null : { theme: c.get('accounts', u, 'theme') ?? null, accent: c.get('accounts', u, 'accent') ?? null };
	info.fav = fav_of(c, u);
	info.paperless = area_on('paperless') && !!c.get('paperless', 'global', 'url') && c.get('paperless', 'global', 'enabled') != '0' && !!home;
	return info;
}

