/* ---------- cloud (rclone) ---------- */

const CLOUD = '/usr/sbin/shareos-cloud';
const CLOUD_OFF = { error: 'Cloud is not installed (system app cloud)' };
const CLOUD_ST = '/tmp/shareos-cloud';
const REMOTE_KEYS = {
	webdav: { plain: [ 'url', 'vendor', 'user' ], secret: [ 'pass' ] },
	s3: { plain: [ 'provider', 'endpoint', 'region', 'access_key_id' ], secret: [ 'secret_access_key' ] },
	sftp: { plain: [ 'host', 'port', 'user' ], secret: [ 'pass' ] },
	ftp: { plain: [ 'host', 'port', 'user' ], secret: [ 'pass' ] },
	smb: { plain: [ 'host', 'user', 'domain' ], secret: [ 'pass' ] },
	mega: { plain: [ 'user' ], secret: [ 'pass' ] },
	b2: { plain: [ 'account' ], secret: [ 'key' ] },
	koofr: { plain: [ 'provider', 'user' ], secret: [ 'password' ] },
	// signed in with OAuth first (shareos-cloud auth-start/auth-finish)
	gdrive: { plain: [], secret: [] }, gphotos: { plain: [], secret: [] }, onedrive: { plain: [], secret: [] },
	dropbox: { plain: [], secret: [] }, box: { plain: [], secret: [] }, pcloud: { plain: [], secret: [] }, yandex: { plain: [], secret: [] }
};
const OAUTH_TYPES = { gdrive: 1, gphotos: 1, onedrive: 1, dropbox: 1, box: 1, pcloud: 1, yandex: 1 };

function cloud_auth_start(owner, type) {
	if (!OAUTH_TYPES[type]) return { error: 'no sign-in for this type' };
	let r = tool_result(sh(sprintf('%s auth-start %s %s', CLOUD, shq(owner == '' ? '-' : owner), shq(type))));
	if (r.error) return r;
	let m = match(r.output, /url=(https?:\/\/[^ \t\n]+)/);
	return m ? { url: m[1] } : { error: 'no sign-in address' };
}
function cloud_auth_finish(owner, url) {
	if (type(url) != 'string' || length(url) > 4096) return { error: 'invalid address' };
	return tool_result(sh(sprintf('%s auth-finish %s %s', CLOUD, shq(owner == '' ? '-' : owner), shq(url))));
}
const CLOUD_MODES = { upload: 1, download: 1, mirror_up: 1, mirror_down: 1 };

function kv_file(path) {
	let o = {};
	for (let l in split(readfile(path) ?? '', '\n')) {
		let m = match(l, /^([a-z_]+)=(.*)$/);
		if (m) o[m[1]] = m[2];
	}
	return o;
}

function cloud_status() {
	let st = {};
	for (let l in split(sh(CLOUD + ' status').out, '\n')) {
		let m = match(l, /^([a-z_]+)=(.*)$/);
		if (m) st[m[1]] = m[2];
	}
	return { installed: !!st.rclone, version: st.version ?? null, apps: st.apps || null,
		installing: st.install_state == 'installing', install_error: st.install_state == 'error' ? st.install_error : null };
}

function cloud_remotes(owner) {
	let list = [];
	for (let l in split(sh(CLOUD + ' remotes ' + shq(owner ?? '-')).out, '\n')) {
		let m = match(l, /^([^:]+):(.+)$/);
		if (m) push(list, { name: m[1], type: m[2] });
	}
	return list;
}

// is the rclone of a job alive? (shareos-cloud keeps its PID while it runs)
function cloud_job_alive(n) {
	let pid = +trim(readfile(CLOUD_ST + '/' + n + '.pid') ?? '0');
	return pid > 1 && stat('/proc/' + pid) != null;
}
// Start a job in the background. "running" is noted at once so the page shows
// it without waiting for rclone; shareos-cloud replaces it with the result –
// also when the run cannot start. A job that is running is left alone.
function cloud_job_start(n) {
	if (cloud_job_alive(n)) return { error: 'the job is already running' };
	system(sprintf('mkdir -p %s; printf "state=running\\nstarted=%%s\\n" "$(date +%%s)" > %s/%s.state; start-stop-daemon -S -b -x %s -- run %s',
		CLOUD_ST, CLOUD_ST, n, CLOUD, n));
	return { started: true };
}

function cloud_jobs(c, owner) {   // owner null = all
	let list = [];
	c.foreach('cloud', 'job', (x) => {
		let o = x.owner ?? '';
		if (owner != null && o != owner) return;
		let n = x['.name'];
		let st = kv_file(CLOUD_ST + '/' + n + '.state');
		if (!st.state) {
			let a = c.get('storage', 'global', 'apps');
			if (a) st = kv_file('/mnt/' + a + '/.shareos/cloud/logs/' + n + '.state');
		}
		// "running" without a living rclone (killed, box out of memory): an
		// interrupted run, not one that goes on for ever. The first seconds
		// after the start the PID is not written yet.
		if (st.state == 'running' && !cloud_job_alive(n) && time() - +(st.started ?? 0) > 20) {
			st.state = 'error';
			st.error = 'the run was interrupted';
			st.ended = st.started;
		}
		push(list, { name: n, owner: o, remote: x.remote ?? '', remote_path: x.remote_path ?? '', local: x.local ?? '',
			mode: x.mode ?? 'upload', schedule: x.schedule ?? '', bwlimit: x.bwlimit ?? '', enabled: x.enabled != '0',
			state: st.state ?? null, started: +(st.started ?? 0), ended: +(st.ended ?? 0), summary: st.summary ?? '', error: st.error ?? '' });
	});
	return sort(list, (a, b) => a.name < b.name ? -1 : 1);
}

// a folder below a share: "Music/Live" – relative, no "." / ".." parts,
// no control characters (stored in uci lists, read line by line)
function sub_ok(sub) {
	if (sub == null || sub == '') return true;
	if (type(sub) != 'string' || length(sub) > 200 || match(sub, /[[:cntrl:]]/)) return false;
	for (let p in split(sub, '/'))
		if (p == '' || p == '.' || p == '..') return false;
	return true;
}

// "share:<name>" or "share:<name>/<sub>" -> { share, sub } (null: not a share)
function share_ref(x) {
	let m = match(x ?? '', /^share:([a-z0-9][a-z0-9_-]{0,15})(\/(.+))?$/);
	return m && sub_ok(m[3]) ? { share: m[1], sub: m[3] ?? '' } : null;
}

// the folder of a share plus an optional subfolder, if it exists and stays
// inside the share (no symlink out of it)
function share_subdir(c, share, sub) {
	if (c.get('shares', share) != 'share' || !sub_ok(sub)) return null;
	let v = c.get('shares', share, 'volume'), rel = c.get('shares', share, 'path') ?? share;
	if (!v) return null;
	let base = realpath('/mnt/' + v + '/' + rel), dir = sub ? realpath('/mnt/' + v + '/' + rel + '/' + sub) : base;
	if (!base || !dir || (dir != base && index(dir, base + '/') != 0) || stat(dir)?.type != 'directory') return null;
	return dir;
}

// may this owner use this local folder? ('home', 'home:<sub>', 'share:<name>'
// or 'share:<name>/<sub>')
function cloud_local_ok(c, owner, local, mode) {
	let h = match(local ?? '', /^home:(.+)$/);
	if (local == 'home' || (h && sub_ok(h[1])))
		return owner != '' && !!c.get('accounts', owner, 'home');
	let ref = share_ref(local), m = ref ? [ null, ref.share ] : null;
	if (!m || c.get('shares', m[1]) != 'share') return false;
	if (ref.sub != '' && !share_subdir(c, ref.share, ref.sub)) return false;
	if (owner == '') return true;
	let tags = [ owner, ...map(list_of(c.get('accounts', owner, 'groups')), (g) => '@' + g) ];
	let rw = list_of(c.get('shares', m[1], 'rw')), ro = list_of(c.get('shares', m[1], 'ro'));
	let can_w = length(filter(tags, (t) => index(rw, t) >= 0)) > 0;
	let can_r = can_w || length(filter(tags, (t) => index(ro, t) >= 0)) > 0;
	return (mode == 'download' || mode == 'mirror_down') ? can_w : can_r;
}

function cloud_job_save(c, owner, a) {
	if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name (a-z, 0-9 and _)' };
	let existing = c.get('cloud', a.name);
	if (existing && existing != 'job') return { error: 'invalid name' };
	if (existing && (c.get('cloud', a.name, 'owner') ?? '') != owner) return { error: 'this name is taken' };
	if (!CLOUD_MODES[a.mode]) return { error: 'invalid mode' };
	if (index(map(cloud_remotes(owner == '' ? '-' : owner), (r) => r.name), a.remote) < 0) return { error: 'unknown connection' };
	if (match(a.remote_path ?? '', /[\n\r]|\.\./)) return { error: 'invalid remote folder' };
	if (!cloud_local_ok(c, owner, a.local, a.mode)) return { error: 'this folder is not allowed for this job' };
	if (a.schedule && !match(a.schedule, /^[0-9*\/,-]+( [0-9*\/,-]+){4}$/)) return { error: 'invalid schedule' };
	if (a.bwlimit && !match(a.bwlimit, /^[0-9]+(\.[0-9]+)?[KMG]?$/)) return { error: 'invalid bandwidth limit (e.g. 2M)' };
	c.set('cloud', a.name, 'job');
	c.set('cloud', a.name, 'owner', owner);
	for (let k in [ 'remote', 'remote_path', 'local', 'mode', 'schedule', 'bwlimit' ]) c.set('cloud', a.name, k, a[k] ?? '');
	c.set('cloud', a.name, 'enabled', a.enabled === false ? '0' : '1');
	c.commit('cloud');
	sh(CRON + ' sync');
	return { ok: true };
}

function cloud_remote_add(owner, a) {
	let o = owner == '' ? '-' : owner;
	if (!match(a.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name (a-z, 0-9 and _)' };
	if (a.type == 'raw') {
		if (!match(a.raw ?? '', /^\[[A-Za-z0-9_-]+\]\n/)) return { error: 'paste an rclone.conf section starting with [name]' };
		return tool_result(sh_in(sprintf('%s remote-add %s %s raw', CLOUD, shq(o), shq(a.name)), a.raw + '\n'));
	}
	let keys = REMOTE_KEYS[a.type];
	if (!keys) return { error: 'unknown type' };
	let args = [], secrets = [];
	for (let k in keys.plain) if (a.params?.[k]) {
		if (match('' + a.params[k], /[\n\r]/)) return { error: 'invalid ' + k };
		push(args, shq(k + '=' + a.params[k]));
	}
	for (let k in keys.secret) if (a.params?.[k]) {
		if (match('' + a.params[k], /[\n\r]/)) return { error: 'invalid ' + k };
		push(secrets, k + '=' + a.params[k]);
	}
	return tool_result(sh_in(sprintf('%s remote-add %s %s %s %s', CLOUD, shq(o), shq(a.name), a.type, join(' ', args)), join('\n', secrets) + '\n'));
}

function cloud_log(c, name, n) {
	let a = c.get('storage', 'global', 'apps');
	if (!a) return [];
	let lines = filter(split(readfile('/mnt/' + a + '/.shareos/cloud/logs/' + name + '.log') ?? '', '\n'), (l) => l != '');
	return slice(lines, -(n ?? 60));
}

function me_cloud_allowed(u) { return u != 'root' && cursor().get('accounts', u, 'cloud') == '1' && !!cursor().get('accounts', u, 'home'); }

