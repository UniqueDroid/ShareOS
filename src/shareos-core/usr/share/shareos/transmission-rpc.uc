// ShareOS: the account's own Transmission daemon over HTTP – shared by two
// entry points (each sets the global TR_MODE and includes this file):
//
//   'app'     /_shareos/cgi/transmission?g=<grant> on the apps web server, for
//             web apps with the permissions "files" and "torrent". The grant
//             (from the admin interface, one app, one account, 8 hours) names
//             the account.
//   'remote'  /transmission/rpc on its own port (shareos.tremote, S52tremote),
//             for remote programs (Transmission Remote GUI, Transmissionic,
//             Tremotesf …): HTTP basic auth with the account name and the
//             account's own remote password (set in the Transmission app),
//             only from the home network, only RPC – no web interface.
//
// body: {"method": "torrent-get", "arguments": {…}, "tag": …}  (Transmission RPC)
// rpcd (shareos.apptorrent) checks grant or password, starts the account's
// daemon when needed (shareos-transmission) and names its Unix socket.
// Only methods and arguments a remote control needs pass – nothing that sets
// scripts, the RPC itself or reads other places. Folders are exchanged as
// "<root>/<path>" ('remote': "/<root>/<path>", programs expect absolute
// paths; root = a name from ShareOS.fs.roots()); the daemon gets absolute
// paths inside the account's folders only.
import { stdin, stdout, readfile, writefile, unlink, popen } from 'fs';
import * as ubus from 'ubus';

// JSON text -> value; null when the text is not JSON (never an exception:
// a damaged file or a tool that printed an error must not end the call)
function jparse(s) { try { return json(s); } catch (e) { return null; } }

const REMOTE = TR_MODE == 'remote';
const MAX_BODY = 16 * 1048576;     // .torrent files go in base64
const CURL_MAX = 32 * 1048576;

function reply(status, obj, head) {
	stdout.write(sprintf('Status: %s\r\n%sContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n%J\n', status, head ?? '', obj));
	exit(0);
}
function fail(status, msg, head) { reply(status, { result: msg }, head); }
function shq(s) { return "'" + replace(s, "'", "'\\''") + "'"; }

// --- what may pass -------------------------------------------------------------
const IDS = [ 'ids' ];
const PATHS = { 'download-dir': 1, 'incomplete-dir': 1, 'location': 1, 'path': 1 };
const METHODS = {
	'session-get': [ 'fields' ],
	'session-stats': [],
	'session-set': [ 'alt-speed-down', 'alt-speed-enabled', 'alt-speed-time-begin', 'alt-speed-time-day', 'alt-speed-time-enabled',
		'alt-speed-time-end', 'alt-speed-up', 'speed-limit-down', 'speed-limit-down-enabled', 'speed-limit-up', 'speed-limit-up-enabled',
		'download-dir', 'incomplete-dir', 'incomplete-dir-enabled', 'download-queue-enabled', 'download-queue-size',
		'seed-queue-enabled', 'seed-queue-size', 'queue-stalled-enabled', 'queue-stalled-minutes', 'seedRatioLimit', 'seedRatioLimited',
		'idle-seeding-limit', 'idle-seeding-limit-enabled', 'start-added-torrents', 'rename-partial-files', 'encryption',
		'dht-enabled', 'pex-enabled', 'lpd-enabled', 'utp-enabled', 'peer-limit-global', 'peer-limit-per-torrent', 'port-forwarding-enabled' ],
	'free-space': [ 'path' ],
	'port-test': [ 'ipProtocol' ],
	'torrent-get': [ 'ids', 'fields', 'format' ],
	'torrent-add': [ 'metainfo', 'filename', 'paused', 'download-dir', 'labels', 'bandwidthPriority', 'files-wanted', 'files-unwanted',
		'priority-high', 'priority-low', 'priority-normal', 'peer-limit', 'sequential_download' ],
	'torrent-start': IDS, 'torrent-start-now': IDS, 'torrent-stop': IDS, 'torrent-verify': IDS, 'torrent-reannounce': IDS,
	'torrent-remove': [ 'ids', 'delete-local-data' ],
	'torrent-set': [ 'ids', 'bandwidthPriority', 'downloadLimit', 'downloadLimited', 'uploadLimit', 'uploadLimited', 'files-wanted',
		'files-unwanted', 'priority-high', 'priority-low', 'priority-normal', 'honorsSessionLimits', 'seedRatioLimit', 'seedRatioMode',
		'seedIdleLimit', 'seedIdleMode', 'peer-limit', 'labels', 'queuePosition', 'sequentialDownload', 'trackerList', 'group' ],
	'torrent-set-location': [ 'ids', 'location', 'move' ],
	'torrent-rename-path': [ 'ids', 'path', 'name' ],
	'queue-move-top': IDS, 'queue-move-up': IDS, 'queue-move-down': IDS, 'queue-move-bottom': IDS
};
// paths in answers become "<root>/<path>"; these never leave the box
const HIDE = { 'config-dir': 1, 'rpc-bind-address': 1, 'script-torrent-done-filename': 1, 'script-torrent-added-filename': 1,
	'script-torrent-done-seeding-filename': 1, 'blocklist-url': 1 };

// setting the watch folder restarts the daemon: that can take a while
let conn = ubus.connect(null, 120);
if (!conn) fail('503 Service Unavailable', 'not ready');

// --- who calls ------------------------------------------------------------------------
let g = null, s = null, key = null, req = null;
if (REMOTE) {
	// a browser sends Origin with every cross-site POST: nothing here is for a
	// browser (no web interface), so this keeps other pages from using a
	// password the browser has remembered. Remote programs send no Origin.
	if (getenv('HTTP_ORIGIN')) fail('403 Forbidden', 'no access from a browser');
	const NEED = 'WWW-Authenticate: Basic realm="ShareOS Transmission"\r\n';
	let m = match(getenv('HTTP_AUTHORIZATION') ?? '', /^Basic +([A-Za-z0-9+\/=]+) *$/i);
	let cred = m ? b64dec(m[1]) : null;
	let i = type(cred) == 'string' ? index(cred, ':') : -1;
	if (i < 1) fail('401 Unauthorized', 'name and password needed', NEED);
	s = conn.call('shareos.apptorrent', 'remote_session', { user: substr(cred, 0, i), pass: substr(cred, i + 1), ip: getenv('REMOTE_ADDR') ?? '' });
	if (s == null) fail('500 Internal Server Error', 'failed');
	if (s.error == 'denied') fail('401 Unauthorized', 'wrong name or password', NEED);
	if (s.error == 'locked') fail('429 Too Many Requests', 'too many wrong passwords – try again in a few minutes', 'Retry-After: 600\r\n');
	if (s.error == 'not local' || s.error == 'off') fail('403 Forbidden', s.error == 'off' ? 'remote access is off' : 'only from the home network');
	if (s.error) fail('503 Service Unavailable', s.error);
	key = { ticket: s.ticket };
} else {
	g = match(getenv('QUERY_STRING') ?? '', /(^|&)g=([0-9a-f]{32})(&|$)/);
	if (!g) fail('403 Forbidden', 'no access');
	key = { grant: g[2] };
}

// --- request ----------------------------------------------------------------------
if (getenv('REQUEST_METHOD') != 'POST') fail('405 Method Not Allowed', 'method not allowed');
let len = +(getenv('CONTENT_LENGTH') ?? 0);
if (!(len > 0) || len > MAX_BODY) fail('413 Payload Too Large', 'invalid request');
let body = '';
while (length(body) < len) {
	let chunk = stdin.read(len - length(body));
	if (chunk == null || chunk == '') break;
	body += chunk;
}
req = jparse(body);

// errors about the request itself: remote programs show "result" of an answer
// (Transmission answers them with 200 as well), apps get the HTTP status
function bad(status, msg) {
	if (REMOTE) reply('200 OK', { result: msg, arguments: {}, tag: req?.tag });
	fail(status, msg);
}

// the Transmission app: the account's remote access (on/off, new password)
if (!REMOTE && type(req) == 'object' && (req.method == 'shareos-remote-get' || req.method == 'shareos-remote-set')) {
	let ra = type(req.arguments) == 'object' ? req.arguments : {};
	let r = req.method == 'shareos-remote-get'
		? conn.call('shareos.apptorrent', 'remote_get', key)
		: conn.call('shareos.apptorrent', 'remote_set', { ...key, on: ra.on === true, regen: ra.regen === true });
	if (r == null) fail('500 Internal Server Error', 'failed');
	if (r.error == 'no access') fail('403 Forbidden', 'no access');
	if (r.error) fail('400 Bad Request', r.error);
	reply('200 OK', { result: 'success', arguments: r });
}

if (type(req) != 'object' || type(req.method) != 'string' || !exists(METHODS, req.method))
	bad('403 Forbidden', 'method not allowed');
let a = req.arguments ?? {};
if (type(a) != 'object') bad('400 Bad Request', 'invalid request');

if (!REMOTE) {
	s = conn.call('shareos.apptorrent', 'session', key);
	if (s == null) fail('500 Internal Server Error', 'failed');
	if (s.error == 'no access') fail('403 Forbidden', 'no access');
	if (s.error) fail('503 Service Unavailable', s.error);
}

// "<root>/<path>" or an absolute path inside a root -> absolute path (checked by rpcd);
// remote programs: "/<root>/<path>" as well
function to_abs(v) {
	if (type(v) != 'string' || v == '') return null;
	let root = null, rel = '';
	if (substr(v, 0, 1) == '/') {
		for (let r in s.roots)
			if (v == r.path || index(v, r.path + '/') == 0) { root = r.name; rel = substr(v, length(r.path) + 1); break; }
		if (root == null && REMOTE) v = substr(v, 1);
	}
	if (root == null && substr(v, 0, 1) != '/') {
		let i = index(v, '/');
		root = i < 0 ? v : substr(v, 0, i);
		rel = i < 0 ? '' : substr(v, i + 1);
	}
	if (root == null) return null;
	let r = conn.call('shareos.apptorrent', 'path', { ...key, root, path: rel });
	return r?.path ?? null;
}
function to_box(v) {
	if (type(v) != 'string') return v;
	for (let r in s.roots)
		if (v == r.path || index(v, r.path + '/') == 0) return (REMOTE ? '/' : '') + r.name + substr(v, length(r.path));
	return '';      // outside the account's folders: not shown
}

let args = {};
for (let k in METHODS[req.method]) {
	if (a[k] == null) continue;
	if (PATHS[k] && !(req.method == 'torrent-rename-path' && k == 'path')) {
		let p = to_abs(a[k]);
		if (!p) bad('403 Forbidden', 'folder not allowed: ' + a[k]);
		args[k] = p;
	} else args[k] = a[k];
}
// watch folder (session-set "watch-dir", "watch-dir-enabled"; session-get shows
// them, plus "watch-dir-autobrr"): the box keeps it (shareos-transmission
// watch) and checks the folder; the account autobrr hands its torrents to
// keeps autobrr's folder
if (req.method == 'session-set' && (a['watch-dir'] != null || a['watch-dir-enabled'] != null)) {
	let on = a['watch-dir-enabled'] ?? true, root = '', rel = '';
	if (on) {
		let v = a['watch-dir'];
		if (type(v) != 'string' || v == '') bad('400 Bad Request', 'watch-dir missing');
		let abs = to_abs(v);
		if (!abs) bad('403 Forbidden', 'folder not allowed: ' + v);
		// rpcd checks it again (and stores it) from root + relative path
		for (let x in s.roots)
			if (abs == x.path || index(abs, x.path + '/') == 0) { root = x.name; rel = substr(abs, length(x.path) + 1); break; }
		if (root == '') bad('403 Forbidden', 'folder not allowed: ' + v);
	}
	// stored by the box; the daemon restarts with it (Transmission takes its
	// watch folder only from settings.json, not over RPC)
	let w = conn.call('shareos.apptorrent', 'watch', { ...key, root, path: rel });
	if (w == null || w.error) bad('403 Forbidden', w?.error ?? 'failed');
	s.watch = w.watch;
}
// peer port (session-set "peer-port"): the box keeps it per account (the
// default is chosen so the accounts' daemons never meet) and checks it –
// 1024-65535, not another account's, not a service of the box, not in use.
// The daemon restarts with it. "peer-port-random-on-start" does not pass: a
// random port could meet another daemon and breaks port forwarding.
if (req.method == 'session-set' && a['peer-port'] != null && a['peer-port'] != s.peer_port) {
	let v = a['peer-port'];
	if (type(v) == 'string' && match(v, /^[0-9]{1,5}$/)) v = +v;
	if (type(v) != 'int') bad('400 Bad Request', 'peer-port must be a number');
	let w = conn.call('shareos.apptorrent', 'port', { ...key, port: v });
	if (w == null || w.error) bad('400 Bad Request', w?.error ?? 'failed');
}
// a torrent comes as file content or as a magnet/http link – no local paths
if (req.method == 'torrent-add') {
	if (args.filename != null && (type(args.filename) != 'string' || !match(args.filename, /^(magnet:\?|https?:\/\/)/)))
		bad('403 Forbidden', 'only magnet or http(s) links');
	if (args.metainfo == null && args.filename == null) bad('400 Bad Request', 'no torrent');
}
// free-space without a path: the default download folder
if (req.method == 'free-space' && args.path == null) bad('400 Bad Request', 'path missing');

// --- to the daemon (Unix socket, CSRF token of Transmission kept per account) ---------
const TOKEN = '/tmp/shareos-transmission/' + s.user + '/token';
let payload = sprintf('%J', { method: req.method, arguments: args, tag: req.tag });
let rnd = readfile('/dev/urandom', 8) ?? '', id = '';
for (let i = 0; i < length(rnd); i++) id += sprintf('%02x', ord(rnd, i));
let tmp = '/tmp/shareos-transmission/' + s.user + '/req.' + id;
writefile(tmp, payload);

function call() {
	let tok = trim(readfile(TOKEN) ?? '');
	let p = popen(sprintf("curl -s -S --max-filesize %d -m 120 -D - --unix-socket %s -H %s -H 'Content-Type: application/json' --data-binary @%s http://localhost/transmission/rpc",
		CURL_MAX, shq(s.socket), shq('X-Transmission-Session-Id: ' + tok), shq(tmp)), 'r');
	if (!p) return null;
	let o = p.read('all') ?? '';
	p.close();
	let i = index(o, '\r\n\r\n');
	if (i < 0) return null;
	let head = substr(o, 0, i), code = +(match(head, /^HTTP\/[0-9.]+ ([0-9]{3})/)?.[1] ?? 0);
	let t = match(head, /\nX-Transmission-Session-Id: *([^\r\n]+)/i);
	return { code, token: t?.[1], body: substr(o, i + 4) };
}
let resp = call();
if (resp && resp.code == 409 && resp.token) { writefile(TOKEN, resp.token); resp = call(); }
unlink(tmp);
if (!resp) fail('502 Bad Gateway', 'Transmission does not answer');
if (resp.code != 200) fail('502 Bad Gateway', 'Transmission: HTTP ' + resp.code);

let res = jparse(resp.body);
if (type(res) != 'object') fail('502 Bad Gateway', 'Transmission: invalid answer');

// absolute paths -> "<root>/<path>", internal settings out
function scrub(o) {
	if (type(o) == 'array') return map(o, scrub);
	if (type(o) != 'object') return o;
	let n = {};
	for (let k, v in o) {
		if (HIDE[k]) continue;
		n[k] = (k == 'downloadDir' || k == 'download-dir' || k == 'incomplete-dir' || (k == 'path' && req.method == 'free-space')) ? to_box(v) : scrub(v);
	}
	return n;
}
res = scrub(res);
if (req.method == 'session-get' && type(res.arguments) == 'object') {
	res.arguments['watch-dir'] = s.watch && !s.watch_autobrr ? to_box(s.watch) : '';
	res.arguments['watch-dir-enabled'] = !!s.watch && !s.watch_autobrr;
	res.arguments['watch-dir-autobrr'] = !!s.watch_autobrr;
}
reply('200 OK', res);
