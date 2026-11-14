/* ---------- snapshots (rsync with hard links, shareos-snapshot) ---------- */

const SNAP = '/usr/sbin/shareos-snapshot';
const SNAP_ST = '/tmp/shareos-snapshots';
const SNAP_JOB_RE = /^[a-z][a-z0-9_]{0,31}$/;
const SNAP_KEEP = [ 'keep_last', 'keep_daily', 'keep_weekly', 'keep_monthly' ];

function snap_tool(args) {
	let r = sh(SNAP + ' ' + join(' ', map(args, shq)));
	let j = null;
	try { j = json(trim(r.out) || 'null'); } catch (e) { }
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

function snap_running(job) {
	let p = +trim(readfile(SNAP_ST + '/' + job + '.pid') ?? '0');
	return p > 1 && index(readfile('/proc/' + p + '/cmdline') ?? '', 'shareos-snapshot') >= 0;
}

function snap_jobs() {
	let list = [];
	cursor().foreach('snapshots', 'job', (x) => {
		let n = x['.name'];
		let st = null;
		try { st = json(readfile(SNAP_ST + '/' + n + '.state') ?? readfile('/mnt/' + (x.target ?? '-') + '/Snapshots/' + n + '/.state.json') ?? 'null'); } catch (e) { }
		// the list of snapshots: read again when the job's state changed, a
		// snapshot was deleted (forget below) or after 30 s – not at every poll
		let l = memo('snaplist:' + n, fstamp(SNAP_ST + '/' + n + '.state') + (x.target ?? ''), 30, () => snap_tool([ 'list', n ]));
		let job = { name: n, source: x.source ?? '', target: x.target ?? '', every: x.every ?? 'day', time: x.time ?? '03:15',
			exclude: type(x.exclude) == 'array' ? x.exclude : (x.exclude ? [ x.exclude ] : []), enabled: x.enabled != '0',
			running: snap_running(n), last: type(st) == 'object' ? st : null, snapshots: l.snapshots ?? [], path: l.path ?? null,
			mounted: l.mounted ?? false };
		for (let k in SNAP_KEEP) job[k] = +(x[k] ?? 0);
		if (job.last?.state == 'running' && !job.running) job.last.state = 'error';
		push(list, job);
	});
	return sort(list, (a, b) => a.name < b.name ? -1 : 1);
}

function snap_save(a) {
	if (!match(a.name ?? '', SNAP_JOB_RE)) return { error: 'invalid name' };
	let c = cursor(), exists = c.get('snapshots', a.name) == 'job';
	if (a.new && exists) return { error: 'name already in use' };
	if (!a.new && !exists) return { error: 'unknown job' };
	if (c.get('snapshots', a.name) && !exists) return { error: 'name already in use' };
	let src = snap_tool([ 'sources' ]);
	if (!filter(src.sources ?? [], (x) => x.id == a.source)[0]) return { error: 'unknown source' };
	let vol = filter(src.volumes ?? [], (x) => x.name == a.target)[0];
	if (!vol) return { error: 'unknown target drive' };
	if (!vol.links) return { error: 'the target drive (' + vol.fstype + ') has no hard links – use ext4 or Btrfs' };
	if (!(a.every in { hour: 1, '6h': 1, day: 1, week: 1 })) return { error: 'invalid interval' };
	if (!match(a.time ?? '', /^([01][0-9]|2[0-3]):[0-5][0-9]$/)) return { error: 'invalid time' };
	let keep = {}, total = 0;
	for (let k in SNAP_KEEP) {
		let v = int(+(a[k] ?? 0));
		if (!(v >= 0 && v <= 999)) return { error: 'invalid number to keep' };
		keep[k] = v; total += v;
	}
	if (total < 1) return { error: 'keep at least one snapshot' };
	let ex = filter(map(type(a.exclude) == 'array' ? a.exclude : [], (e) => trim('' + e)), (e) => e != '');
	if (length(ex) > 30 || length(filter(ex, (e) => length(e) > 200 || match(e, /[\n\r]/))) > 0) return { error: 'invalid exclusions' };
	if (!exists) c.set('snapshots', a.name, 'job');
	c.set('snapshots', a.name, 'source', a.source);
	c.set('snapshots', a.name, 'target', a.target);
	c.set('snapshots', a.name, 'every', a.every);
	c.set('snapshots', a.name, 'time', a.time);
	for (let k in SNAP_KEEP) c.set('snapshots', a.name, k, '' + keep[k]);
	c.delete('snapshots', a.name, 'exclude');
	if (length(ex)) c.set('snapshots', a.name, 'exclude', ex);
	c.set('snapshots', a.name, 'enabled', a.enabled === false ? '0' : '1');
	c.commit('snapshots');
	sh(CRON + ' sync');
	return { ok: true };
}

