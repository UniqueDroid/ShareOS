/* ---------- apps ---------- */

const APPS_TOOL = '/usr/sbin/shareos-apps';
const NOTIFY = '/usr/sbin/shareos-notify';
const NOTIFY_KEYS = [ 'email', 'smtp_host', 'smtp_tls', 'smtp_port', 'smtp_user', 'mail_from', 'mail_to', 'email_level',
	'push', 'push_type', 'push_url', 'push_chat', 'push_level', 'temp_max', 'disk_full' ];

function notify_run(args) {
	let r = sh(NOTIFY + ' ' + join(' ', map(args, shq)));
	let j = null;
	try { j = json(trim(r.out) || 'null'); } catch (e) { }
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}
// the list only when the messages changed; anything else changes them
function notify_json(args) {
	if (args[0] == 'list')
		return memo('notes', fstamp('/etc/shareos/notifications.json'), 60, () => notify_run(args));
	forget('notes');
	return notify_run(args);
}

// settings without the secrets (only whether they are set)
function notify_settings() {
	let n = cursor().get_all('shareos', 'notify') ?? {}, o = {};
	for (let k in NOTIFY_KEYS) o[k] = n[k] ?? '';
	o.email = n.email == '1'; o.push = n.push == '1';
	o.has_pass = !!length(n.smtp_pass ?? ''); o.has_token = !!length(n.push_token ?? '');
	o.temp_max = +(n.temp_max ?? 55); o.disk_full = +(n.disk_full ?? 90);
	return o;
}
const APPS_UPLOAD = '/tmp/shareos-apps/upload.sapp';

function apps_json(args) {
	let r = sh(APPS_TOOL + ' ' + join(' ', map(args, shq)));
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

// the installed apps (shareos-apps list): new when an app, its settings or
// the task states change
function apps_list() {
	let jobs = lsdir('/tmp/shareos-apps/jobs') ?? [];
	return memo('apps', fstamp('/www-apps', '/opt/shareos/sysapps', '/etc/config/apps', '/tmp/shareos-apps/jobs')
		+ '|' + join(',', sort(jobs)) + '|' + join(',', map(sort(jobs), (j) => fstamp('/tmp/shareos-apps/jobs/' + j))), 30,
		() => apps_json([ 'list' ]));
}

// the name under which the box is reached in links to apps: set by hand
// (shareos.web.host) or taken from an installed certificate – so an app opens
// under the name the certificate is valid for, also when this interface was
// opened by its IP address
function cert_host() {
	let i = cert_info();
	if (i.none || i.selfsigned) return null;
	let names = [];
	for (let s in i.san) { let m = match(s, /^dNSName:(.+)$/); if (m) push(names, lc(trim(m[1]))); }
	let cn = match(i.subject ?? '', /CN=([^,\/]+)/);
	if (cn) push(names, lc(trim(cn[1])));
	let h = lc(read_trim('/proc/sys/kernel/hostname') ?? '');
	for (let n in names) if (h && index(n, h + '.') == 0) return n;
	for (let n in names) { let m = match(n, /^\*\.([a-z0-9.-]+)$/); if (m && h) return h + '.' + m[1]; }
	for (let n in names) if (match(n, /^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+$/)) return n;
	return null;
}
function web_host() {
	let h = cursor().get('shareos', 'web', 'host');
	return h ? { host: h, auto: false } : { host: cert_host(), auto: true };
}

function apps_server() {
	let c = cursor(), wh = web_host();
	return { port: +(c.get('apps', 'store', 'port') ?? 8081), https_port: +(c.get('apps', 'store', 'https_port') ?? 8444),
		https: c.get('shareos', 'web', 'https') != '0', host: wh.host, host_auto: wh.auto };
}

// apps a user may see: users list contains '*', the name or one of its '@groups'
function apps_for(u) {
	if (!u) return [];
	let c = cursor(), groups = list_of(c.get('accounts', u, 'groups'));
	let admin = u == 'root' || c.get('accounts', u, 'role') == 'admin';
	// system apps are programs for the terminal, nothing to open in a browser
	return filter(apps_list().apps ?? [], (a) => a.type != 'system' && (admin || index(a.users, '*') >= 0 || index(a.users, u) >= 0
		|| length(filter(groups, (g) => index(a.users, '@' + g) >= 0)) > 0));
}

