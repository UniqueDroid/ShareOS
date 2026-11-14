/* ---------- permission "sysinfo": the box's values for apps (read only) ---------- */

// mounted drives and the flash overlay with their use
function sys_volumes() {
	let mounts = readfile('/proc/mounts') ?? '', fst = {}, mps = [ '/overlay' ];
	for (let line in split(mounts, '\n')) {
		let f = split(line, ' ');
		if (length(f) > 2 && match(f[1], /^\/mnt\/[A-Za-z0-9._-]+$/) && !fst[f[1]]) { push(mps, f[1]); fst[f[1]] = f[2]; }
	}
	let list = [];
	for (let line in split(sh('df -k ' + join(' ', map(mps, shq))).out, '\n')) {
		let f = split(trim(line), /\s+/);
		if (length(f) < 6 || !match(f[1], /^[0-9]+$/)) continue;
		let mp = f[5];
		push(list, { name: mp == '/overlay' ? 'flash' : substr(mp, 5), mount: mp, fs: mp == '/overlay' ? 'ubifs' : (fst[mp] ?? ''),
			usb: index(mp, '/mnt/usb-') == 0, size: +f[1] * 1024, used: +f[2] * 1024, avail: +f[3] * 1024 });
	}
	return list;
}

function sys_info() {
	let up = split(read_trim('/proc/uptime') ?? '0', ' ');
	let load = split(read_trim('/proc/loadavg') ?? '', ' ');
	let net = '/sys/class/net/eth0/';
	return {
		model: read_trim('/proc/device-tree/model'), board: board().fwname ?? null, version: release().version ?? null,
		hostname: read_trim('/proc/sys/kernel/hostname'), kernel: read_trim('/proc/sys/kernel/osrelease'),
		time: time(), uptime: +up[0], load: [ +load[0], +load[1], +load[2] ], procs: load[3] ?? '',
		cpu: cpustat(), cores: length(filter(split(readfile('/proc/cpuinfo') ?? '', '\n'), (l) => match(l, /^processor\s*:/))) || 1,
		memory: meminfo(), temperature: box_temp(), fan_pwm: read_int('/tmp/sys/pwm1'), board_control: memo('boardctl', '', 10, board_control),
		network: { speed: read_int(net + 'speed'), rx_bytes: read_int(net + 'statistics/rx_bytes'), tx_bytes: read_int(net + 'statistics/tx_bytes') },
		volumes: memo('sysvol', '', 20, sys_volumes),
		disks: disks_state()
	};
}

// every process: pid, name, command line, user, state, memory, CPU ticks;
// the app computes the CPU share from two samples (ticks / cpu.total)
function sys_processes() {
	let users = {};
	for (let l in lines_of('/etc/passwd')) users[field(l, 2)] = field(l, 0);
	let list = [];
	for (let pid in lsdir('/proc') ?? []) {
		if (!match(pid, /^[0-9]+$/)) continue;
		let st = readfile('/proc/' + pid + '/stat');
		let m = st ? match(st, /^[0-9]+ \((.*)\) ([A-Za-z]) (.*)$/) : null;
		if (!m) continue;
		let f = split(trim(m[3]), ' ');
		let uid = match(readfile('/proc/' + pid + '/status') ?? '', /\nUid:\s+([0-9]+)/);
		let cmd = trim(join(' ', split(readfile('/proc/' + pid + '/cmdline') ?? '', chr(0))));
		push(list, { pid: +pid, ppid: +f[0], name: m[1], cmd: substr(cmd, 0, 240), kernel: cmd == '',
			user: uid ? (users[uid[1]] ?? uid[1]) : '', state: m[2], threads: +f[16], nice: +f[15],
			ticks: +f[10] + +f[11], start: +f[18], rss: +f[20] * 4096 });
	}
	return { cpu: cpustat(), hz: 100, uptime: +split(read_trim('/proc/uptime') ?? '0', ' ')[0], processes: list };
}

// processes an app may not end: init and what keeps ShareOS and its interface running
// (the kernel keeps 15 characters of a name: shareos-supervise, which restarts
// ubusd and rpcd – ending it ends them)
const SYS_KEEP = { init: 1, ubusd: 1, rpcd: 1, uhttpd: 1, 'dns320l-daemon': 1, syslogd: 1, klogd: 1, 'shareos-supervi': 1 };

/* ---------- permission "docker": Docker hosts the admin added (Docker Engine API) ---------- */

function docker_url_ok(u) {
	return type(u) == 'string' && length(u) <= 200 && !!match(u, /^https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?\/?$/);
}
function docker_hosts(c) {
	let l = [];
	c.foreach('dockerhosts', 'host', (x) => push(l, { name: x['.name'], label: x.label ?? x['.name'], url: x.url ?? '', insecure: x.insecure == '1' }));
	return l;
}

// shareos-autobrr <args> (JSON on stdin for set, password, api)
const AUTOBRR = '/usr/sbin/shareos-autobrr';

