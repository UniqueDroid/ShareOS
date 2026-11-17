/* ---------- long file operations in the background ---------- */

// Copying, moving between drives and deleting can take minutes. rpcd answers
// one call at a time, so such a command runs in the background: the call
// waits 3 s for it – most are done by then and answer as before – and
// otherwise returns { ok, running, job }; "job" (files / appfs) tells later
// how it ended. Jobs live in FJOBS (in RAM): <id>/user, pid, out, rc.
const FJOBS = '/tmp/shareos-filejobs';
function files_job_dir(u, id) {
	let d = FJOBS + '/' + id;
	return type(id) == 'string' && match(id, /^[0-9a-f]{16}$/) && read_trim(d + '/user') == u ? d : null;
}
// fields of /proc/<pid>/stat after the name (which may hold spaces and
// brackets): [0] state, [1] parent, [2] process group
function proc_stat(pid) {
	let st = readfile('/proc/' + pid + '/stat');
	return st ? split(trim(substr(st, rindex(st, ')') + 1)), ' ') : null;
}
function files_job_alive(d) {
	let pid = +(read_trim(d + '/pid') ?? 0), st = pid > 1 ? proc_stat(pid) : null;
	// a process that ended but was not collected yet (Z) is not running
	return st && st[0] != 'Z' ? pid : 0;
}
// A copy or a move between drives also tells how far it is: total_kb (what
// the sources take; missing until they are counted) and done_kb (what the
// targets take so far), measured by the job itself – see files_bg().
function files_job(u, id) {
	let d = files_job_dir(u, id);
	if (!d) return { error: 'unknown job' };
	let rc = read_trim(d + '/rc');
	if (rc == null) {
		if (files_job_alive(d)) {
			let r = { ok: true, running: true, job: id }, t = read_trim(d + '/total'), n = read_trim(d + '/done');
			if (t != null && match(t, /^[0-9]+$/)) r.total_kb = +t;
			if (n != null && match(n, /^[0-9]+$/)) r.done_kb = r.total_kb != null && +n > r.total_kb ? r.total_kb : +n;
			return r;
		}
		let cancelled = stat(d + '/cancelled') != null;
		system('rm -rf ' + shq(d));
		// the shell is gone without a result: stopped by the user, or killed
		return cancelled ? { ok: true, cancelled: true } : { error: 'the operation was interrupted' };
	}
	let r = { rc: +rc, out: readfile(d + '/out') ?? '' };
	system('rm -rf ' + shq(d));
	return r.rc == 0 ? { ok: true } : { error: files_err(r) };
}
// Stops a running job. start-stop-daemon -b gives the job a session of its
// own; its process group holds the shell, cp/mv/rm and the measuring and
// nothing else, so every process of that group is stopped. What was copied
// so far stays. The next "job" reports { cancelled }.
function proc_group(pid) { return +(proc_stat(pid)?.[2] ?? 0); }
function job_procs(pid) {
	let pg = proc_group(pid);
	if (pg <= 1 || pg == proc_group('self')) return [ pid ];
	return filter(lsdir('/proc') ?? [], (p) => match(p, /^[0-9]+$/) && proc_group(p) == pg);
}
function files_job_cancel(u, id) {
	let d = files_job_dir(u, id);
	if (!d) return { error: 'unknown job' };
	let pid = files_job_alive(d);
	if (!pid || read_trim(d + '/rc') != null) return { ok: true };
	writefile(d + '/cancelled', '1\n');
	system('kill -TERM ' + join(' ', job_procs(pid)) + ' 2>/dev/null');
	for (let i = 0; i < 20 && files_job_alive(d); i++) sleep(100);
	// what is left (a stopped process, one that ignores the signal)
	let rest = files_job_alive(d) ? job_procs(pid) : [];
	if (length(rest)) system('kill -KILL ' + join(' ', rest) + ' 2>/dev/null');
	return { ok: true };
}
// prog: { src: [paths], dst: [paths] } – the job counts what the sources take
// (once) and what the targets take (again and again, the slower the counting,
// the longer the pause), as root and with low priority
function files_bg(u, cmd, shared, prog) {
	let id = substr(new_token(), 0, 16), d = FJOBS + '/' + id;
	// results nobody asked for (a closed tab) are dropped after a day
	for (let old in lsdir(FJOBS) ?? [])
		if (match(old, /^[0-9a-f]{16}$/) && time() - (stat(FJOBS + '/' + old)?.mtime ?? 0) > 86400) system('rm -rf ' + shq(FJOBS + '/' + old));
	system(sprintf('mkdir -p %s && chmod 700 %s && mkdir %s', FJOBS, FJOBS, shq(d)));
	writefile(d + '/user', u);
	let full = acc_role(u) == 'admin' ? 'umask 002; ' + cmd
		: sprintf('su -s /bin/sh %s -c %s', shq(u), shq((shared ? 'umask 002; ' : 'umask 077; ') + cmd));
	let q = shq(d), script = sprintf('( %s ) >%s/out 2>&1; echo $? >%s/rc', full, q, q);
	if (prog) {
		let kb = (paths, to) => sprintf("nice du -sk -- %s 2>/dev/null | awk '{ s += $1 } END { print s + 0 }' >%s/%s.tmp && mv %s/%s.tmp %s/%s",
			join(' ', map(paths, shq)), q, to, q, to, q, to);
		script = sprintf('( %s ) & ( while :; do t=$(date +%%s); %s; s=$(( ($(date +%%s) - t) * 4 )); [ $s -lt 2 ] && s=2; sleep $s; done ) & mon=$!; ( %s ) >%s/out 2>&1; rc=$?; kill $mon 2>/dev/null; echo $rc >%s/rc',
			kb(prog.src, 'total'), kb(prog.dst, 'done'), full, q, q);
	}
	system(sprintf('start-stop-daemon -S -q -b -m -p %s/pid -x /bin/sh -- -c %s', q, shq(script)));
	for (let i = 0; i < 30 && !stat(d + '/rc'); i++) sleep(100);
	return files_job(u, id);
}
