/* ---------- settings backup and recovery mode ----------------------------------
 * A backup holds the box (network, name, time, storage, root password, web
 * settings), users and groups, shares, the settings of services, the list of
 * installed apps (with the app settings) and – only when encrypted and asked
 * for – the HTTPS certificate and the own CA with the certificates it issued.
 * Restoring takes over what the box needs to run (root password, network,
 * name, time zone, storage, web settings) and keeps the whole backup in
 * RECOVERY: after the reboot the box is in recovery mode and the admin picks
 * what else comes back (shareos.recovery). Apps are installed from the store
 * in the background; what fails stays in RECOVERY_APPS for the apps page. */

const CRYPT = '/usr/sbin/shareos-crypt';
const RECOVERY = '/etc/shareos/recovery.json';
const RECOVERY_APPS = '/etc/shareos/recovery-apps';
const RESTORE_APPS = '/usr/sbin/shareos-restore-apps';
const BACKUP_ESSENTIAL = [ 'shareos', 'network', 'storage' ];
const BACKUP_SERVICES = [ 'paperless', 'cloud', 'snapshots', 'dlna', 'dockerhosts', 'zabbix', 'printer', 'ups', 'dnsfilter' ];
const BACKUP_CONFIGS = [ ...BACKUP_ESSENTIAL, 'accounts', 'shares', 'apps', ...BACKUP_SERVICES ];
const BACKUP_FILES = [ '/etc/hostname', '/etc/timezone', '/etc/ksmbd/ksmbdpwd.db', '/etc/shareos/zabbix.psk',
	'/etc/shareos/dnsfilter.pass', '/etc/shareos/dnsfilter/AdGuardHome.yaml' ];
const CERT_CRT = '/etc/ssl/shareos/server.crt', CERT_KEY = '/etc/ssl/shareos/server.key';
const CA_DIR = '/etc/shareos/ca';
const CA_FILE = /^(ca\.(crt|key)|certs\/[A-Za-z0-9*._-]{1,64}\.(crt|key))$/;
const WEB_CERT_OPTS = [ 'cert', 'key', 'source' ];


// run shareos-crypt: the password is the first line of its input
function crypt(mode, pass, data) {
	// own file names per call in a directory only root can enter: nobody can
	// put a link there beforehand, and two calls cannot mix up their data
	let tin = sh_in_file(pass + '\n' + data), tout = tin + '.out';
	system('umask 077; : > ' + tout);
	let r = sh(sprintf('%s %s < %s > %s', CRYPT, mode, tin, tout));
	let out = readfile(tout);
	unlink(tin); unlink(tout);
	return r.rc == 0 ? { data: out } : { error: r.rc == 2 ? 'wrong password or damaged file' : 'encryption failed' };
}

// what this box could put into a backup (for the export form)
function backup_offer() {
	let c = cursor();
	let certs = filter(lsdir(CA_DIR + '/certs') ?? [], (f) => match(f, /\.crt$/));
	return { certificate: !!stat(c.get('shareos', 'web', 'key') ?? CERT_KEY), source: c.get('shareos', 'web', 'source') ?? '',
		ca: !!stat(CA_DIR + '/ca.key'), ca_certs: length(certs) };
}

function backup_build(opts) {
	let b = { shareos_backup: 2, version: release().version, host: read_trim('/proc/sys/kernel/hostname'),
		created: time(), configs: {}, files: {}, accounts: {}, apps: [] };
	for (let c in BACKUP_CONFIGS) {
		let t = readfile('/etc/config/' + c);
		if (t != null) b.configs[c] = t;
	}
	for (let f in BACKUP_FILES) {
		let t = readfile(f);
		if (t != null) b.files[f] = t;
	}
	let tz = readlink('/etc/localtime');
	if (tz) b.files['/etc/localtime'] = { link: tz };
	// accounts: uid/gid >= 1000 plus the root password
	b.accounts.passwd = filter(lines_of('/etc/passwd'), (l) => +field(l, 2) >= 1000 && +field(l, 2) < 65534);
	let names = map(b.accounts.passwd, (l) => field(l, 0));
	b.accounts.shadow = filter(lines_of('/etc/shadow'), (l) => field(l, 0) == 'root' || index(names, field(l, 0)) >= 0);
	b.accounts.group = filter(lines_of('/etc/group'), (l) => +field(l, 2) >= 1000 && +field(l, 2) < 65534);
	for (let a in apps_list().apps ?? [])
		push(b.apps, { id: a.id, name: a.name ?? a.id, version: a.version ?? '', type: a.type ?? 'webapp', source: a.source ?? '' });
	let c = cursor();
	if (opts.certificate) {
		let crt = readfile(c.get('shareos', 'web', 'cert') ?? CERT_CRT), key = readfile(c.get('shareos', 'web', 'key') ?? CERT_KEY);
		if (crt && key) b.certificate = { crt, key, source: c.get('shareos', 'web', 'source') ?? '' };
	}
	if (opts.ca && stat(CA_DIR + '/ca.key')) {
		b.ca = {};
		for (let f in [ 'ca.crt', 'ca.key', ...map(lsdir(CA_DIR + '/certs') ?? [], (x) => 'certs/' + x) ]) {
			let t = match(f, CA_FILE) ? readfile(CA_DIR + '/' + f) : null;
			if (t != null) b.ca[f] = t;
		}
	}
	return b;
}

// version 1 (up to beta.20) kept the certificate and the CA among the files
function backup_upgrade(b) {
	if (b.shareos_backup != 1) return b;
	let f = b.files ?? {};
	if (type(f[CERT_KEY]) == 'string' && type(f[CERT_CRT]) == 'string') b.certificate = { crt: f[CERT_CRT], key: f[CERT_KEY], source: '' };
	if (type(f[CA_DIR + '/ca.key']) == 'string') b.ca = { 'ca.crt': f[CA_DIR + '/ca.crt'], 'ca.key': f[CA_DIR + '/ca.key'] };
	for (let k in [ CERT_CRT, CERT_KEY, CA_DIR + '/ca.crt', CA_DIR + '/ca.key' ]) delete f[k];
	b.apps ??= [];
	return b;
}

function uci_sections(text, kind) {
	let out = [];
	for (let l in split(text ?? '', '\n')) {
		let m = match(l, /^config (\w+) '([^']+)'/);
		if (m && (!kind || m[1] == kind)) push(out, m[2]);
	}
	return out;
}

// what the backup holds, by part
function backup_summary(b) {
	let users = map(b.accounts?.passwd ?? [], (l) => field(l, 0));
	let ca_certs = filter(keys(b.ca ?? {}), (k) => match(k, /^certs\/.*\.crt$/));
	return { version: b.version, host: b.host, created: b.created, users,
		groups: uci_sections(b.configs?.accounts, 'group'),
		shares: uci_sections(b.configs?.shares, 'share'),
		services: filter(BACKUP_SERVICES, (s) => b.configs?.[s] != null),
		apps: map(b.apps ?? [], (a) => ({ id: a.id, name: a.name, version: a.version })),
		configs: keys(b.configs ?? {}),
		certificate: !!b.certificate?.key, cert_source: b.certificate?.source ?? '',
		ca: !!b.ca?.['ca.key'], ca_certs: map(ca_certs, (k) => replace(k, /^certs\/(.*)\.crt$/, '$1')) };
}

// Files are written beside their place and moved there: a power cut leaves
// the old or the new file, never a cut-off one.
function put_file(path, data, private) {
	system('mkdir -p ' + shq(replace(path, /\/[^\/]+$/, '')));
	let tmp = path + '.new';
	writefile(tmp, data);
	system('chmod ' + (private ? '600 ' : '644 ') + shq(tmp) + '; sync');
	rename(tmp, path);
}

// step 1: what the box needs to run; the rest goes to the recovery mode
function restore_essentials(b) {
	let c = cursor(), web = {};
	for (let o in WEB_CERT_OPTS) web[o] = c.get('shareos', 'web', o);
	for (let n in BACKUP_ESSENTIAL)
		if (type(b.configs?.[n]) == 'string') writefile('/etc/config/' + n, b.configs[n]);
	// the certificate in use stays until the recovery mode decides
	c = cursor();
	if (c.get('shareos', 'web') == null) c.set('shareos', 'web', 'web');
	for (let o in WEB_CERT_OPTS) {
		if (web[o] != null) c.set('shareos', 'web', o, web[o]);
		else c.delete('shareos', 'web', o);
	}
	c.commit('shareos');
	for (let f in [ '/etc/hostname', '/etc/timezone' ])
		if (type(b.files?.[f]) == 'string') writefile(f, b.files[f]);
	let lt = b.files?.['/etc/localtime'];
	if (type(lt) == 'object' && match(lt.link ?? '', /^\/usr\/share\/zoneinfo\/[A-Za-z0-9_+\/-]+$/) && stat(lt.link)) {
		unlink('/etc/localtime'); symlink(lt.link, '/etc/localtime');
	}
	if (type(b.files?.['/etc/hostname']) == 'string') system('hostname ' + shq(trim(b.files['/etc/hostname'])));
	let root = filter(b.accounts?.shadow ?? [], (l) => field(l, 0) == 'root' && length(split(l, ':')) >= 2)[0];
	if (root)
		put_file('/etc/shadow', join('\n', map(lines_of('/etc/shadow'), (l) => field(l, 0) == 'root' ? root : l)) + '\n', true);
	put_file(RECOVERY, sprintf('%J', b), true);
	return [ 'root', 'network', 'hostname', 'timezone', 'storage', 'web' ];
}

function restore_accounts(b) {
	let ACC = /^[a-z][a-z0-9_]{0,31}$/;
	if (type(b.configs?.accounts) == 'string') writefile('/etc/config/accounts', b.configs.accounts);
	let good = (l, n) => length(split(l, ':')) == n && match(field(l, 0), ACC);
	let pw = filter(b.accounts?.passwd ?? [], (l) => good(l, 7) && +field(l, 2) >= 1000);
	let names = map(pw, (l) => field(l, 0));
	let sh_new = filter(b.accounts?.shadow ?? [], (l) => length(split(l, ':')) >= 2 && index(names, field(l, 0)) >= 0);
	let grp = filter(b.accounts?.group ?? [], (l) => good(l, 4) && +field(l, 2) >= 1000);
	let keep = (path, test) => filter(lines_of(path), test);
	let passwd = [ ...keep('/etc/passwd', (l) => !(+field(l, 2) >= 1000 && +field(l, 2) < 65534)), ...pw ];
	let sysnames = map(passwd, (l) => field(l, 0));
	let shadow = [ ...filter(lines_of('/etc/shadow'), (l) => index(sysnames, field(l, 0)) >= 0 && index(names, field(l, 0)) < 0), ...sh_new ];
	let group = [ ...keep('/etc/group', (l) => !(+field(l, 2) >= 1000 && +field(l, 2) < 65534)), ...grp ];
	put_file('/etc/passwd', join('\n', passwd) + '\n');
	put_file('/etc/shadow', join('\n', shadow) + '\n', true);
	put_file('/etc/group', join('\n', group) + '\n');
	if (type(b.files?.['/etc/ksmbd/ksmbdpwd.db']) == 'string') put_file('/etc/ksmbd/ksmbdpwd.db', b.files['/etc/ksmbd/ksmbdpwd.db'], true);
	system(USERS + ' sync >/dev/null 2>&1');
}

// the web certificate: reuse the one of the backup; otherwise a new one from
// the restored CA when the box used its own CA, else the box keeps the
// certificate it has now (a new box: its own self-signed one)
function restore_certificate(b, reuse, ca_back) {
	let c = cursor();
	if (reuse && b.certificate?.key) {
		for (let o in [ 'cert', 'key' ]) c.delete('shareos', 'web', o);
		put_file(CERT_CRT, b.certificate.crt, false);
		put_file(CERT_KEY, b.certificate.key, true);
		if (b.certificate.source) c.set('shareos', 'web', 'source', b.certificate.source);
		else c.delete('shareos', 'web', 'source');
		c.commit('shareos');
		return 'reused';
	}
	if (b.certificate?.source == 'ca' && ca_back) {
		for (let o in [ 'cert', 'key' ]) c.delete('shareos', 'web', o);
		c.commit('shareos');
		return sh('/usr/sbin/shareos-ca web').rc == 0 ? 'ca' : 'failed';
	}
	return 'kept';
}

function restore_ca(b) {
	system('rm -rf ' + CA_DIR + ' && mkdir -p ' + CA_DIR + '/certs && chmod 700 ' + CA_DIR + ' ' + CA_DIR + '/certs');
	for (let f in keys(b.ca ?? {}))
		if (match(f, CA_FILE) && type(b.ca[f]) == 'string') put_file(CA_DIR + '/' + f, b.ca[f], match(f, /\.key$/));
}

function recovery_pending_apps() {
	return filter(lines_of(RECOVERY_APPS), (l) => match(l, /^[a-z][a-z0-9-]{1,31}$/));
}

// start: now (apps page); otherwise after the reboot (S51apps)
function recovery_start_apps(ids, start) {
	ids = filter(ids, (id) => match(id ?? '', /^[a-z][a-z0-9-]{1,31}$/));
	if (!length(ids)) return false;
	put_file(RECOVERY_APPS, join('\n', ids) + '\n', true);
	if (start) system('start-stop-daemon -S -b -x ' + RESTORE_APPS);
	return true;
}

// step 2 (recovery mode): the parts the admin picked
function recovery_apply(b, a) {
	let done = [];
	if (a.users) { restore_accounts(b); push(done, 'users'); }
	if (a.shares && type(b.configs?.shares) == 'string') {
		writefile('/etc/config/shares', b.configs.shares);
		system('/usr/sbin/shareos-shares apply >/dev/null 2>&1');
		push(done, 'shares');
	}
	for (let s in a.services ?? []) {
		if (index(BACKUP_SERVICES, s) < 0 || type(b.configs?.[s]) != 'string') continue;
		writefile('/etc/config/' + s, b.configs[s]);
		if (s == 'zabbix' && type(b.files?.['/etc/shareos/zabbix.psk']) == 'string')
			put_file('/etc/shareos/zabbix.psk', b.files['/etc/shareos/zabbix.psk'], true);
		// DNS filter: AdGuard's settings (lists, upstream) and the password of its interface
		if (s == 'dnsfilter')
			for (let f in [ '/etc/shareos/dnsfilter.pass', '/etc/shareos/dnsfilter/AdGuardHome.yaml' ])
				if (type(b.files?.[f]) == 'string') { system('mkdir -p /etc/shareos/dnsfilter'); put_file(f, b.files[f], true); }
		push(done, s);
	}
	let ca_back = false;
	if (a.ca && b.ca?.['ca.key']) { restore_ca(b); ca_back = true; push(done, 'ca'); }
	push(done, 'certificate:' + restore_certificate(b, !!a.certificate, ca_back));
	let apps = [];
	if (length(a.apps ?? [])) {
		if (type(b.configs?.apps) == 'string') writefile('/etc/config/apps', b.configs.apps);
		let known = map(b.apps ?? [], (x) => x.id);
		apps = filter(a.apps, (id) => index(known, id) >= 0);
		if (recovery_start_apps(apps, false)) push(done, 'apps');
	}
	unlink(RECOVERY);
	return { ok: true, done, apps, reboot: true };
}

