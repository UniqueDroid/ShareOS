// ShareOS app platform: what the CGIs under /_shareos/cgi have in common.
//
// A web app calls   POST /_shareos/cgi/<name>?g=<grant>   body: {"op": …, …}
// The grant comes from the admin interface (one app, one account, 8 hours).
// The CGI checks the shape of the request, hands the operation with its
// arguments to an rpcd object – which checks the grant and the permissions
// and does the work – and returns the answer as JSON.
//
// A CGI sets the global APP_CGI and includes this file:
//
//   global.APP_CGI = {
//       object: 'shareos.appsys',      // the rpcd object
//       ops: { info: [], kill: [ 'pid', 'signal' ] },   // operation -> arguments that pass
//       max: 4096,                     // largest body in bytes (default 4096)
//       timeout: 120,                  // seconds to wait for rpcd (default: ubus' own)
//       no_answer: [ '400 Bad Request', 'invalid values' ]   // when rpcd gives no answer
//   };
//   include('/usr/share/shareos/app-cgi.uc');
import { stdin, stdout } from 'fs';

// JSON text -> value; null when the text is not JSON (never an exception:
// a damaged body must not end the call without an answer)
function jparse(s) { try { return json(s); } catch (e) { return null; } }

function reply(status, obj) {
	stdout.write(sprintf('Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n%J\n', status, obj));
	exit(0);
}

const C = APP_CGI;
let g = match(getenv('QUERY_STRING') ?? '', /(^|&)g=([0-9a-f]{32})(&|$)/);
if (!g) reply('403 Forbidden', { error: 'no access' });
if (getenv('REQUEST_METHOD') != 'POST') reply('405 Method Not Allowed', { error: 'method not allowed' });
let len = +(getenv('CONTENT_LENGTH') ?? 0);
if (!(len > 0) || len > (C.max ?? 4096)) reply('413 Payload Too Large', { error: 'invalid request' });
// the web server may hand the body over in pieces
let body = '';
while (length(body) < len) {
	let chunk = stdin.read(len - length(body));
	if (chunk == null || chunk == '') break;
	body += chunk;
}
let req = jparse(body || 'null');
if (type(req) != 'object' || type(req.op) != 'string' || !exists(C.ops, req.op))
	reply('400 Bad Request', { error: 'invalid request' });

let args = { grant: g[2] };
for (let k in C.ops[req.op])
	if (req[k] != null) args[k] = req[k];

const ubus = require('ubus');
let conn = C.timeout ? ubus.connect(null, C.timeout) : ubus.connect();
if (!conn) reply('503 Service Unavailable', { error: 'not ready' });
let r = conn.call(C.object, req.op, args);
if (r == null) reply(C.no_answer?.[0] ?? '500 Internal Server Error', { error: C.no_answer?.[1] ?? 'failed' });
if (r.error == 'no access') reply('403 Forbidden', r);
reply('200 OK', r);
