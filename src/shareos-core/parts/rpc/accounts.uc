/* ---------- accounts, shares, the logged-in user ---------- */

const USERS = '/usr/sbin/shareos-users';
const SHARES = '/usr/sbin/shareos-shares';
const QUOTA = '/usr/sbin/shareos-quota';
const SESS_DIR = '/tmp/shareos-sessions';
const ACC_RE = /^[a-z][a-z0-9_]{0,31}$/;

function acc_name_ok(n) { return type(n) == 'string' && match(n, ACC_RE); }

// run a tool with the password on stdin (never on the command line)
function sh_pass(cmd, pass) {
	return sh_in(cmd, (pass ?? '') + '\n');
}
function tool_result(r) {
	if (r.rc == 0) return { ok: true, output: trim(r.out) };
	let m = match(r.out, /error: ([^\n]*)/);
	return { error: m ? m[1] : (trim(r.out) || 'failed') };
}

function opt_args(a) {
	let o = [];
	if (a.fullname != null) push(o, '--fullname=' + a.fullname);
	if (a.groups != null) push(o, '--groups=' + join(',', a.groups));
	if (a.home != null) push(o, '--home=' + a.home);
	if (a.quota != null) push(o, '--quota=' + int(+a.quota));
	if (a.web != null) push(o, '--web=' + (a.web ? '1' : '0'));
	if (a.role != null) push(o, '--role=' + a.role);
	if (a.cloud != null) push(o, '--cloud=' + (a.cloud ? '1' : '0'));
	if (a.files != null) push(o, '--files=' + (a.files ? '1' : '0'));
	return join(' ', map(o, shq));
}

function quota_read() {
	let u = {};
	for (let line in split(sh(QUOTA + ' report').out, '\n')) {
		let m = match(line, /^user=([^:]+):([^:]+):([0-9]+):([0-9]+)$/);
		if (!m) continue;
		u[m[1]] ??= [];
		push(u[m[1]], { volume: m[2], used: +m[3] * 1024, limit: +m[4] * 1024 });
	}
	return u;
}
function quota_usage() {   // user -> [{volume, used, limit}] in bytes
	// a new limit shows at once (accounts file), used space within 30 s
	return memo('quota', fstamp('/etc/config/accounts', '/etc/config/storage'), 30, quota_read);
}

function list_of(v) { return v == null ? [] : (type(v) == 'array' ? v : split(v, ' ')); }

function accounts() {
	let c = cursor(), users = [], groups = [];
	let usage = quota_usage();
	c.foreach('accounts', 'user', (x) => {
		push(users, {
			name: x['.name'], role: x.role ?? 'share', fullname: x.fullname ?? '', uid: +(x.uid ?? 0),
			groups: list_of(x.groups), home: x.home ?? '', quota: +(x.quota ?? 0), web: (x.web ?? '1') != '0', cloud: x.cloud == '1', files: x.files == '1',
			usage: usage[x['.name']] ?? []
		});
	});
	c.foreach('accounts', 'group', (x) => {
		push(groups, { name: x['.name'], desc: x.desc ?? '',
			members: map(filter(users, (u) => index(u.groups, x['.name']) >= 0), (u) => u.name) });
	});
	return { users: sort(users, (a, b) => a.name < b.name ? -1 : 1), groups: sort(groups, (a, b) => a.name < b.name ? -1 : 1) };
}

/* ---------- vault shares (discussion #88): locked, unlocked on demand ---------- */

const VAULT_FAILS = '/tmp/shareos-vault-fails';
const VAULT_TTLS = [ 5, 15, 30, 60, 120, 240, 480 ];

function vault_ttl(v) { let n = +(v ?? 15); return n >= 1 && n <= 480 ? int(n) : 15; }

// share -> [{user, until}] of the vaults that are unlocked now
// (read here as "shareos-shares vault-status" does, without starting it:
// this is asked with every list of shares – /tmp/shareos-vault/<share> holds
// "user until" lines, only vaults count, only times that have not run out)
function vault_state() {
	let st = {}, c = cursor(), now = time();
	for (let n in lsdir('/tmp/shareos-vault') ?? []) {
		if (c.get('shares', n) != 'share' || c.get('shares', n, 'vault') != '1') continue;
		for (let line in split(readfile('/tmp/shareos-vault/' + n) ?? '', '\n')) {
			let m = match(line, /^(\S+) ([0-9]+)$/);
			if (m && +m[2] > now) push(st[n] ??= [], { user: m[1], until: +m[2] });
		}
	}
	return st;
}

function share_list() {
	let c = cursor(), list = [];
	// path and state as "shareos-shares status" gives them, worked out here:
	// the tool starts several uci programs per share, and this list is asked
	// by many pages
	let st = {}, open = vault_state(), mounts = readfile('/proc/mounts') ?? '', names = proc_names();
	c.foreach('shares', 'share', (x) => {
		let n = x['.name'], v = x.volume, p = x.path || n;
		if (v && c.get('storage', v) == 'volume' && substr(p, 0, 1) != '/' && index(p, '..') < 0)
			st[n] = { path: '/mnt/' + v + '/' + p, mounted: index(mounts, ' /mnt/' + v + ' ') >= 0 };
	});
	c.foreach('shares', 'share', (x) => {
		let n = x['.name'];
		push(list, {
			name: n, volume: x.volume ?? '', path: x.path ?? n, comment: x.comment ?? '',
			smb: x.smb == '1', nfs: x.nfs == '1', guest: x.guest == '1',
			rw: list_of(x.rw), ro: list_of(x.ro), nfs_rw: x.nfs_rw == '1', nfs_hosts: list_of(x.nfs_hosts),
			vault: x.vault == '1', vault_ttl: vault_ttl(x.vault_ttl), vault_open: x.vault == '1' ? (open[n] ?? []) : [],
			fullpath: st[n]?.path ?? null, mounted: st[n]?.mounted ?? false
		});
	});
	return {
		shares: sort(list, (a, b) => a.name < b.name ? -1 : 1),
		workgroup: c.get('shares', 'global', 'workgroup') ?? 'WORKGROUP',
		smb_enabled: (c.get('shares', 'global', 'smb') ?? '1') != '0',
		smb_compat: c.get('shares', 'global', 'smb_compat') == '1',
		nfs_enabled: (c.get('shares', 'global', 'nfs') ?? '1') != '0',
		smb_running: running('ksmbd.mountd', names), nfs_running: running('rpc.mountd', names)
	};
}

// which account belongs to a web session: set by "bind" right after login
function session_user(req) {
	let sid = req.args?.ubus_rpc_session;
	if (type(sid) != 'string' || !match(sid, /^[0-9a-f]{32}$/)) return null;
	let u = read_trim(SESS_DIR + '/' + sid);
	return u && (u == 'root' || acc_name_ok(u)) ? u : null;
}

// check a password against /etc/shadow (crypt via busybox mkpasswd)
function password_ok(user, pass) {
	let line = filter(split(readfile('/etc/shadow') ?? '', '\n'), (l) => index(l, user + ':') == 0)[0];
	let hash = line ? split(line, ':')[1] : null;
	if (!hash || length(hash) < 13 || substr(hash, 0, 1) == '!' || substr(hash, 0, 1) == '*') return false;
	let m = match(hash, /^\$([156])\$([^$]+)\$/);
	let method = m ? { '1': 'md5', '5': 'sha256', '6': 'sha512' }[m[1]] : 'des';
	let salt = m ? m[2] : substr(hash, 0, 2);
	let r = sh_in(sprintf('mkpasswd -P 0 -m %s -S %s', method, shq(salt)), pass);
	return trim(r.out) == hash;
}

// root still has the factory password "shareos" (public in the docs; the login
// page shows it then – anyone could simply try it). Checked again only when
// root's hash changes (the hash itself is the stamp: two changes within one
// second leave size and time of /etc/shadow alike).
function default_password() {
	let line = filter(split(readfile('/etc/shadow') ?? '', '\n'), (l) => index(l, 'root:') == 0)[0] ?? '';
	return memo('default_password', split(line, ':')[1] ?? '', 0, () => password_ok('root', 'shareos'));
}

// A box whose root account is locked ("!" or "*" in /etc/shadow) is not claimed
// yet (init script S03claim). Claiming needs the USB button: shareos-buttons
// touches CLAIM_WINDOW, which is valid for 2 minutes. Someone in the LAN
// could use that window, but only while a person stands at the box.
const CLAIM_WINDOW = '/run/shareos/claim-window';
const CLAIM_SECS = 120;

function root_locked() {
	let line = filter(split(readfile('/etc/shadow') ?? '', '\n'), (l) => index(l, 'root:') == 0)[0];
	let hash = line ? split(line, ':')[1] : null;
	return !!hash && (substr(hash, 0, 1) == '!' || substr(hash, 0, 1) == '*');
}

function claim_window() {
	let st = stat(CLAIM_WINDOW);
	return !!st && time() - st.mtime < CLAIM_SECS;
}

// lines of a text file and a field of a passwd-style line
function lines_of(path) { return filter(split(readfile(path) ?? '', '\n'), (l) => l != ''); }
function field(l, i) { return split(l, ':')[i]; }

// access of an account to a vault from its lists: 'rw', 'ro' or null (no guests)
function vault_access(c, share, u) {
	let rw = list_of(c.get('shares', share, 'rw')), ro = list_of(c.get('shares', share, 'ro')), access = null;
	for (let t in [ u, ...map(list_of(c.get('accounts', u, 'groups')), (g) => '@' + g) ]) {
		if (index(rw, t) >= 0) return 'rw';
		if (index(ro, t) >= 0) access = 'ro';
	}
	return access;
}

// vaults an account can unlock: [{name, comment, access, ttl, until}]
function vault_list(u) {
	let c = cursor(), open = vault_state(), out = [];
	c.foreach('shares', 'share', (x) => {
		if (x.vault != '1') return;
		let access = u == 'root' ? null : vault_access(c, x['.name'], u);
		if (!access && u != 'root') return;
		let mine = filter(open[x['.name']] ?? [], (o) => o.user == u)[0];
		push(out, { name: x['.name'], comment: x.comment ?? '', access, ttl: vault_ttl(x.vault_ttl), until: mine?.until ?? 0,
			open_for: length(open[x['.name']] ?? []) });
	});
	return sort(out, (a, b) => a.name < b.name ? -1 : 1);
}

// unlock a vault for an account after it entered its password again; five
// wrong passwords within 10 minutes block unlocking for that account
function vault_unlock(u, share, minutes, password) {
	let c = cursor();
	if (!valid_name(share) || c.get('shares', share) != 'share' || c.get('shares', share, 'vault') != '1') return { error: 'not a vault' };
	if (u == 'root' || !acc_name_ok(u)) return { error: 'only accounts with an SMB password can unlock a vault' };
	if (!vault_access(c, share, u)) return { error: 'no access to this share' };
	let f = VAULT_FAILS + '.' + u, now = time();
	let fails = filter(map(split(readfile(f) ?? '', '\n'), (x) => +x), (t) => t > now - 600);
	if (length(fails) >= 5) return { error: 'too many wrong passwords – try again in 10 minutes' };
	if (type(password) != 'string' || !password_ok(u, password)) {
		push(fails, now);
		writefile(f, join('\n', fails) + '\n');
		return { error: 'wrong password' };
	}
	unlink(f);
	let m = minutes != null && minutes !== '' ? int(+minutes) : vault_ttl(c.get('shares', share, 'vault_ttl'));
	if (!(m >= 1 && m <= 480)) return { error: 'invalid time (1–480 minutes)' };
	let r = sh(SHARES + ' vault-unlock ' + shq(share) + ' ' + shq(u) + ' ' + m);
	let t = match(r.out, /until=([0-9]+)/);
	if (r.rc != 0 || !t) return tool_result(r);
	return { ok: true, share, until: +t[1] };
}

function vault_lock(share, u) {
	let c = cursor();
	if (!valid_name(share) || c.get('shares', share) != 'share' || c.get('shares', share, 'vault') != '1') return { error: 'not a vault' };
	let r = sh(SHARES + ' vault-lock ' + shq(share) + (u ? ' ' + shq(u) : ''));
	return r.rc == 0 ? { ok: true, share } : tool_result(r);
}

// A locked vault is closed with the ACL of its folder (shareos-shares
// vault_gate): that works on drives with Linux permissions only. On exFAT,
// NTFS or FAT the folder would stay open for apps and other services.
const VAULT_FS = { ext4: 1, ext3: 1, ext2: 1, btrfs: 1 };
const VAULT_FS_ERR = 'a vault needs a drive with Linux permissions (ext4 or Btrfs)';
function vault_fs_ok(c, volume) { return !!VAULT_FS[c.get('storage', volume ?? '', 'fstype') ?? 'ext4']; }

// change the vault settings of a share (admins)
function vault_set(share, on, ttl) {
	let c = cursor();
	if (!valid_name(share) || c.get('shares', share) != 'share') return { error: 'unknown share' };
	if (on) {
		if (c.get('shares', share, 'smb') != '1') return { error: 'a vault needs SMB' };
		if (!vault_fs_ok(c, c.get('shares', share, 'volume'))) return { error: VAULT_FS_ERR };
		c.set('shares', share, 'guest', '0');
		c.set('shares', share, 'nfs', '0');
	}
	if (on != null) c.set('shares', share, 'vault', on ? '1' : '0');
	if (ttl != null) {
		if (!(+ttl >= 1 && +ttl <= 480)) return { error: 'invalid time (1–480 minutes)' };
		c.set('shares', share, 'vault_ttl', '' + int(+ttl));
	}
	c.commit('shares');
	sh(SHARES + ' apply');
	sh('/usr/sbin/shareos-cron sync');
	return { ok: true };
}

