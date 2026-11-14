/* ---------- hardware settings, first run, Alt-F ---------- */

// The fan curves are defined in one file; shareos-board regulates by it.
function fan_presets() {
	let p = {};
	for (let l in split(readfile('/usr/lib/shareos/fan-presets') ?? '', '\n')) {
		let m = match(l, /^([a-z]+)[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]*$/);
		if (m) p[m[1]] = { off_temp: +m[2], full_temp: +m[3], half_temp: +m[4] };
	}
	return p;
}
const FAN_PRESETS = fan_presets();

function fan_settings() {
	let c = cursor();
	let preset = c.get('shareos', 'fan', 'preset') ?? 'balanced';
	let v = FAN_PRESETS[preset] ?? {
		off_temp: +(c.get('shareos', 'fan', 'off_temp') ?? 0),
		full_temp: +(c.get('shareos', 'fan', 'full_temp') ?? 50),
		half_temp: +(c.get('shareos', 'fan', 'half_temp') ?? 45)
	};
	return { preset, ...v };
}

function led_settings() {
	let c = cursor();
	return {
		status: c.get('shareos', 'led', 'status') ?? 'heartbeat',
		power: c.get('shareos', 'led', 'power') ?? 'on',
		disks: c.get('shareos', 'led', 'disks') ?? 'off'
	};
}

function timezone() {
	let t = trim(readfile('/etc/timezone') ?? '');
	if (t != '') return t;
	let l = readlink('/etc/localtime');
	return l ? replace(l, /^.*zoneinfo\//, '') : 'UTC';
}

function zones() {
	let list = [];
	for (let line in split(readfile('/usr/share/zoneinfo/zone1970.tab') ?? readfile('/usr/share/zoneinfo/zone.tab') ?? '', '\n')) {
		if (substr(line, 0, 1) == '#') continue;
		let f = split(line, '\t');
		if (length(f) >= 3) push(list, f[2]);
	}
	if (!length(list))
		for (let d in [ 'Africa', 'America', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Pacific' ])
			for (let z in glob('/usr/share/zoneinfo/' + d + '/*'))
				push(list, substr(z, 20));
	push(list, 'UTC');
	return sort(uniq(list));
}

function set_timezone(tz) {
	if (!match(tz ?? '', /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)*$/) || !stat('/usr/share/zoneinfo/' + tz))
		return false;
	let changed = tz != timezone();
	unlink('/etc/localtime');
	symlink('/usr/share/zoneinfo/' + tz, '/etc/localtime');
	writefile('/etc/timezone', tz + '\n');
	// running programs read the zone once: restart the ones that print times
	if (changed)
		system('(sleep 1; for s in /etc/init.d/S01syslogd /etc/init.d/S50crond; do [ -x $s ] && $s restart; done) >/dev/null 2>&1 &');
	return true;
}

