/* ---------- status for widget apps ---------- */

function new_token() {
	let r = readfile('/dev/urandom', 16) ?? '';
	let t = '';
	for (let i = 0; i < length(r); i++) t += sprintf('%02x', ord(r, i));
	return t;
}

// Copying, moving between drives and deleting can take minutes. rpcd answers
// one call at a time, so such a command runs in the background: the call
// waits 3 s for it – most are done by then and answer as before – and
// otherwise returns { ok, running, job }; "job" (files / appfs) tells later
// how it ended. Jobs live in FJOBS (in RAM): <id>/user, pid, out, rc.
const FJOBS = '/tmp/shareos-filejobs';
function files_job(u, id) {
	let d = FJOBS + '/' + id;
	if (type(id) != 'string' || !match(id, /^[0-9a-f]{16}$/) || read_trim(d + '/user') != u) return { error: 'unknown job' };
	let rc = read_trim(d + '/rc');
	if (rc == null) {
		let pid = +(read_trim(d + '/pid') ?? 0);
		if (pid > 1 && stat('/proc/' + pid)) return { ok: true, running: true, job: id };
		// the shell is gone without a result: killed
		system('rm -rf ' + shq(d));
		return { error: 'the operation was interrupted' };
	}
	let r = { rc: +rc, out: readfile(d + '/out') ?? '' };
	system('rm -rf ' + shq(d));
	return r.rc == 0 ? { ok: true } : { error: files_err(r) };
}
function files_bg(u, cmd, shared) {
	let id = substr(new_token(), 0, 16), d = FJOBS + '/' + id;
	// results nobody asked for (a closed tab) are dropped after a day
	for (let old in lsdir(FJOBS) ?? [])
		if (match(old, /^[0-9a-f]{16}$/) && time() - (stat(FJOBS + '/' + old)?.mtime ?? 0) > 86400) system('rm -rf ' + shq(FJOBS + '/' + old));
	system(sprintf('mkdir -p %s && chmod 700 %s && mkdir %s', FJOBS, FJOBS, shq(d)));
	writefile(d + '/user', u);
	let full = acc_role(u) == 'admin' ? 'umask 002; ' + cmd
		: sprintf('su -s /bin/sh %s -c %s', shq(u), shq((shared ? 'umask 002; ' : 'umask 077; ') + cmd));
	system(sprintf('start-stop-daemon -S -q -b -m -p %s/pid -x /bin/sh -- -c %s',
		shq(d), shq(sprintf('( %s ) >%s/out 2>&1; echo $? >%s/rc', full, shq(d), shq(d)))));
	for (let i = 0; i < 30 && !stat(d + '/rc'); i++) sleep(100);
	return files_job(u, id);
}

