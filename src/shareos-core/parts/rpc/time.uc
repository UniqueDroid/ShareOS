/* ---------- time: NTP, manual clock ---------- */

const NTP_DEFAULT = [ '0.pool.ntp.org', '1.pool.ntp.org', '2.pool.ntp.org' ];
const RTC_TOOL = '/usr/sbin/dns320l-daemon';

// which box this is: S05board writes /tmp/sys/board.env (/usr/lib/shareos/board.sh)
function board_read() {
	let b = {};
	for (let line in split(readfile('/tmp/sys/board.env') ?? '', '\n')) {
		let m = match(line, /^BOARD_([A-Z0-9_]+)="(.*)"$/);
		if (m) b[lc(m[1])] = m[2];
	}
	return b;
}
function board() { return memo('board', fstamp('/tmp/sys/board.env'), 0, board_read); }

// The box's temperature (m°C). A value older than TEMP_MAX_AGE seconds is not
// shown: the MCU or the sensor does not answer any more (shareos-board and
// shareos-notify use the same limit).
const TEMP_MAX_AGE = 90;
function box_temp() {
	let st = stat('/tmp/sys/temp1_input');
	return st && time() - st.mtime <= TEMP_MAX_AGE ? read_int('/tmp/sys/temp1_input') : null;
}
// Is the fan control of this box at work? control: how this model is cooled
// (mcu | hwmon | mcu-temp; null: unknown box, nothing regulates), running:
// shareos-board (and on MCU boxes dns320l-daemon) is alive, sensor: a fresh
// temperature is there.
function board_control() {
	let c = board().control ?? '';
	if (c == '' || c == 'none') return { control: null, running: false, sensor: false };
	let names = proc_names();
	return { control: c, running: running('shareos-board', names) && (c != 'mcu' || running('dns320l-daemon', names)),
		sensor: box_temp() != null };
}
// the RTC: the MCU's battery clock (dns320l-daemon) or the kernel's /dev/rtc0
function rtc_kind() {
	let k = board().rtc ?? (stat(RTC_TOOL) ? 'mcu' : 'kernel');
	if (k == 'mcu') return stat(RTC_TOOL) ? 'mcu' : null;
	return stat('/dev/rtc0') ? 'kernel' : null;
}

function ntp_servers(c) {
	let l = c.get('shareos', 'time', 'server');
	if (type(l) == 'string') l = [ l ];
	return type(l) == 'array' && length(l) ? l : NTP_DEFAULT;
}

function time_info() {
	let c = cursor();
	let last = split(read_trim('/tmp/shareos-ntp/last') ?? '', ' ');
	return {
		now: time(),
		timezone: timezone(),
		ntp: c.get('shareos', 'time', 'ntp') != '0',
		servers: ntp_servers(c),
		last_sync: last[0] && match(last[0], /^[0-9]+$/) ? +last[0] : null,
		ntp_running: system('pidof ntpd >/dev/null 2>&1') == 0,
		rtc: !!rtc_kind(),
		// did setting the battery clock work the last time? (null: not set yet)
		rtc_ok: ((x) => x == 'ok' ? true : x == 'failed' ? false : null)(read_trim('/tmp/shareos-ntp/rtc'))
	};
}

// clock -> the MCU's battery clock, so the time survives a power cut
function rtc_save() {
	let k = rtc_kind(), rc = null;
	if (k == 'mcu') rc = system(RTC_TOOL + ' -x systohc >/dev/null 2>&1');
	else if (k == 'kernel') rc = system('hwclock -w -u >/dev/null 2>&1');
	if (rc != null) { system('mkdir -p /tmp/shareos-ntp'); writefile('/tmp/shareos-ntp/rtc', rc == 0 ? 'ok\n' : 'failed\n'); }
}

function altf_scan() {
	let r = sh('/usr/sbin/shareos-altf scan');
	let a = { users: [], shares: [], nfs: [] };
	for (let line in split(r.out, '\n')) {
		let m = match(line, /^([a-z_]+)=(.*)$/);
		if (!m) continue;
		if (m[1] == 'user') push(a.users, m[2]);
		else if (m[1] == 'share') push(a.shares, m[2]);
		else if (m[1] == 'nfs') push(a.nfs, m[2]);
		else a[m[1]] = m[2];
	}
	a.found = a.found == '1';
	return a;
}

// root's password (System → General, the first set-up, claiming a new box):
// one minimum length; null or an error text
const ROOT_PW_MIN = 8;
function set_password(pw) {
	if (type(pw) != 'string' || length(pw) < ROOT_PW_MIN) return 'password too short (min. ' + ROOT_PW_MIN + ')';
	if (match(pw, /[\n\r:]/)) return 'password contains invalid characters';
	let p = popen('chpasswd -c sha512 >/dev/null 2>&1', 'w');
	if (!p) return 'chpasswd not available';
	p.write('root:' + pw + '\n');
	return p.close() == 0 ? null : 'chpasswd failed';
}

// the update channels there are (first set-up and Firmware page)
function channel_ok(ch) { return type(ch) == 'string' && ch in { stable: 1, beta: 1 }; }

function set_hostname(h) {
	if (!match(h ?? '', /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
	writefile('/etc/hostname', h + '\n');
	sh('hostname ' + shq(h));
	// mDNS name (<hostname>.local) follows
	system('[ -x /etc/init.d/S50avahi-daemon ] && pidof avahi-daemon >/dev/null && /etc/init.d/S50avahi-daemon restart >/dev/null 2>&1 &');
	return true;
}


/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.time': {
		get: {
			call: function() { return time_info(); }
		},

		// timezone, ntp (on/off), servers (host names or IPs, at most 5)
		set: {
			args: { timezone: '', ntp: true, servers: [] },
			call: function(req) {
				let a = req.args, c = cursor();
				if (a.timezone && !set_timezone(a.timezone)) return { error: 'unknown time zone' };
				if (a.servers != null) {
					if (type(a.servers) != 'array' || length(a.servers) > 5) return { error: 'at most 5 servers' };
					for (let x in a.servers)
						if (type(x) != 'string' || !match(x, /^[A-Za-z0-9]([A-Za-z0-9.-]{0,252}[A-Za-z0-9])?$/) && !match(x, /^[0-9a-fA-F:]+$/))
							return { error: 'invalid server: ' + x };
				}
				c.set('shareos', 'time', 'time');
				if (a.ntp != null) c.set('shareos', 'time', 'ntp', a.ntp ? '1' : '0');
				if (a.servers != null) {
					c.delete('shareos', 'time', 'server');
					if (length(a.servers)) c.set('shareos', 'time', 'server', a.servers);
				}
				c.commit('shareos');
				system('/etc/init.d/S45ntpd restart >/dev/null 2>&1');
				return time_info();
			}
		},

		// ask the servers once now (takes a few seconds)
		sync: {
			call: function() {
				let args = join(' ', map(ntp_servers(cursor()), (x) => '-p ' + shq(x)));
				let r = sh('timeout 20 ntpd -q -n ' + args);
				if (r.rc != 0) return { error: 'no answer from the time servers' };
				rtc_save();
				writefile('/tmp/shareos-ntp/last', time() + ' manual\n');
				return time_info();
			}
		},

		// set the clock by hand: time = seconds since 1970 (UTC)
		set_clock: {
			args: { time: 0 },
			call: function(req) {
				let t = +req.args.time;
				if (!(t >= 1735689600 && t < 4102444800)) return { error: 'invalid time' };   // 2025 … 2099
				let g = gmtime(t);
				let r = sh(sprintf('date -u -s "%04d-%02d-%02d %02d:%02d:%02d"', g.year, g.mon, g.mday, g.hour, g.min, g.sec));
				if (r.rc != 0) return { error: 'setting the clock failed' };
				rtc_save();
				return time_info();
			}
		}
	}
});
