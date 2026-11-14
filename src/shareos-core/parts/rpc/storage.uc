/* ---------- storage ---------- */

const STORAGE = '/usr/sbin/shareos-storage';
const SMART_DIR = '/tmp/shareos-storage';
const SMART_MAX_AGE = 1800;     // s; SMART reads keep disks awake, so cache them

function valid_name(n) { return type(n) == 'string' && match(n, /^[a-z0-9][a-z0-9_-]{0,15}$/); }
function valid_disk(d) { return type(d) == 'string' && match(d, /^sd[a-z]$/) && stat('/sys/block/' + d); }
const USB = '/usr/sbin/shareos-usb';
const FS_DISK = { ext4: 1, ext3: 1, ext2: 1, btrfs: 1, exfat: 1, ntfs: 1, vfat: 1 };
const FS_USB = { exfat: 1, vfat: 1, ntfs: 1, ext4: 1 };
// USB sticks/disks hang below a USB host in sysfs; the bays are SATA
function is_usb(d) { return valid_disk(d) && index(realpath('/sys/block/' + d) ?? '', '/usb') >= 0; }
// Is an internal disk asleep? CHECK POWER MODE (hdparm -C) does not wake it.
// true/false; null when it cannot be told (USB disk, hdparm failed).
function disk_standby(d) {
	if (is_usb(d)) return null;
	let o = sh('hdparm -C /dev/' + d).out;
	return match(o, /drive state is:\s*(standby|sleeping)/) ? true : (match(o, /drive state is:/) ? false : null);
}
// The disks for the overview and the apps: USB or bay, asleep or not, and the
// SMART rating from the values read last (good | warn | bad; null: none yet).
// Asked at most once a minute.
function disks_state() {
	return memo('disks-state', '', 60, () => map(disks(), (d) => {
		let s = null;
		try { s = json(readfile(SMART_DIR + '/smart-' + d.name + '.json')); } catch (e) { }
		return { ...d, usb: is_usb(d.name), standby: disk_standby(d.name), smart: type(s) == 'object' ? (s.rating ?? null) : null };
	}));
}
// mounted USB partitions: { dev, path, fs }
// (asked on every file operation and every status: "shareos-usb list" runs
// only when the mounts or the list of USB partitions changed)
function usb_mounts() {
	return memo('usb-mounts', (readfile('/proc/mounts') ?? '') + join(',', lsdir('/tmp/shareos-usb') ?? []), 0, () => {
		let l = [];
		for (let line in split(sh(USB + ' list').out, '\n')) {
			let f = split(trim(line), ' ');
			if (length(f) == 3) push(l, { dev: f[0], path: f[1], fs: f[2] });
		}
		return l;
	});
}

function ubiblock_major() {
	let m = match(readfile('/proc/devices') ?? '', /\n *([0-9]+) ubiblock\n/);
	return m ? m[1] : null;
}

function lsblk_read() {
	// -e: leave out mtdblock (31), ram (1) and ubiblock devices – only disks matter here
	let r = sh_quiet('lsblk -J -b -e 1,31,' + (ubiblock_major() ?? '31') + ' -o NAME,TYPE,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINT,MODEL,SERIAL,TRAN,RM,ROTA');
	let j = null;
	try { j = json(r.out); } catch (e) { }
	return j?.blockdevices ?? [];
}
// The storage page asks every few seconds: the answer is kept for 20 s while
// the block devices and the mounts are the same. While a storage job runs
// (it formats, builds arrays) nothing is kept.
function lsblk() {
	if (stat(SMART_DIR + '/lock')) { forget('lsblk'); return lsblk_read(); }
	return memo('lsblk', join(',', glob('/sys/class/block/*')) + (readfile('/proc/mounts') ?? ''), 20, lsblk_read);
}
// the sleep state for the storage page: asked at most every 30 s per disk
function disk_standby_memo(d) { return memo('standby:' + d, '', 30, () => disk_standby(d)); }

// SSD wear from the vendor attributes (normalized value = life left in %)
const WEAR_ATTRS = [ 'Percent_Lifetime_Remain', 'SSD_Life_Left', 'Remaining_Lifetime_Perc', 'Media_Wearout_Indicator', 'Wear_Leveling_Count', 'Percent_Life_Remaining' ];
// written bytes: attribute name -> bytes per raw unit (LBAs: the logical block size)
const WRITE_ATTRS = { Total_LBAs_Written: 0, Host_Writes_32MiB: 33554432, Host_Writes_GiB: 1073741824, Lifetime_Writes_GiB: 1073741824, Total_Writes_GB: 1000000000 };

// health of a disk from its SMART values: rating good | warn | bad and the
// reasons (codes; the interface turns them into text)
function smart_assess(s) {
	let bad = [], warn = [];
	if (s.passed === false) push(bad, 'failed');
	for (let a in s.attributes ?? []) {
		if (a.when_failed == 'now') push(bad, 'attr_now:' + a.name);
		else if (a.when_failed == 'past') push(warn, 'attr_past:' + a.name);
	}
	if (s.last_test?.passed === false) push(bad, 'test_failed');
	if (+s.reallocated > 100) push(bad, 'reallocated'); else if (+s.reallocated > 0) push(warn, 'reallocated');
	if (+s.pending > 10) push(bad, 'pending'); else if (+s.pending > 0) push(warn, 'pending');
	if (+s.uncorrectable > 0) push(warn, 'uncorrectable');
	if (+s.crc_errors > 0) push(warn, 'crc');
	if (+s.error_count > 0) push(warn, 'errors');
	if (s.life_left != null) { if (s.life_left <= 10) push(bad, 'worn'); else if (s.life_left <= 20) push(warn, 'wearing'); }
	if (s.temperature != null) { if (s.temperature >= 60) push(bad, 'hot'); else if (s.temperature >= 55) push(warn, 'warm'); }
	return { rating: length(bad) ? 'bad' : length(warn) ? 'warn' : 'good', reasons: [ ...bad, ...warn ] };
}

function smart_parse(j) {
	let attr = {}, table = [];
	for (let a in j.ata_smart_attributes?.table ?? []) {
		attr[a.id] = a.raw?.value;
		attr[a.name] = a;
		push(table, { id: a.id, name: a.name, value: a.value, worst: a.worst, thresh: a.thresh,
			raw: a.raw?.string ?? '' + a.raw?.value, when_failed: a.when_failed ?? '', prefail: !!a.flags?.prefailure });
	}
	let ssd = j.rotation_rate === 0 || !!match(j.device?.type ?? '', /nvme/);
	// life left: the endurance indicator of the device statistics, else the vendor attribute
	let life = null;
	for (let p in j.ata_device_statistics?.pages ?? [])
		for (let e in p.table ?? [])
			if (e.name == 'Percentage Used Endurance Indicator' && type(e.value) == 'int') life = 100 - e.value;
	if (life == null && ssd)
		for (let n in WEAR_ATTRS)
			if (attr[n] && life == null) life = attr[n].value;
	if (life != null) life = life < 0 ? 0 : life > 100 ? 100 : life;
	let written = null;
	for (let n, u in WRITE_ATTRS)
		if (attr[n] && written == null) written = +attr[n].raw?.value * (u || +(j.logical_block_size ?? 512));
	// lifetime maximum temperature: "35 (Min/Max 18/52)" in the raw text of 194 (WD, HGST)
	let tmax = j.temperature?.lifetime_max;
	if (tmax == null) { let m = match(attr['Temperature_Celsius']?.raw?.string ?? '', /Min\/Max [0-9]+\/([0-9]+)/); if (m) tmax = +m[1]; }
	let st = j.ata_smart_data?.self_test, log = j.ata_smart_self_test_log?.standard?.table ?? [];
	let tests = map(slice(log, 0, 5), (t) => ({ type: t.type?.string ?? '', status: t.status?.string ?? '', passed: t.status?.passed, hours: t.lifetime_hours }));
	let res = {
		time: time(),
		passed: j.smart_status?.passed,
		temperature: j.temperature?.current,
		temperature_max: tmax,
		power_on_hours: j.power_on_time?.hours,
		power_cycles: j.power_cycle_count,
		start_stops: attr[4],
		reallocated: attr[5],
		pending: attr[197],
		uncorrectable: attr[198],
		crc_errors: attr[199],
		error_count: j.ata_smart_error_log?.summary?.count ?? 0,
		model: j.model_name,
		serial: j.serial_number,
		firmware: j.firmware_version,
		rpm: j.rotation_rate,
		ssd,
		life_left: life,
		written,
		capacity: j.user_capacity?.bytes,
		// a running self-test: remaining_percent; otherwise the last result
		test_running: st?.status?.remaining_percent != null ? { remaining: st.status.remaining_percent, text: st.status.string } : null,
		test_minutes: { short: st?.polling_minutes?.short, long: st?.polling_minutes?.extended },
		last_test: length(tests) ? tests[0] : null,
		tests,
		attributes: table
	};
	let h = smart_assess(res);
	res.rating = h.rating; res.reasons = h.reasons;
	return res;
}

// USB copy (USB button / interface): settings and the state of the last run
function usb_copy_info() {
	let c = cursor(), st = {};
	for (let line in split(readfile('/tmp/shareos-usb.copy/state') ?? '', '\n')) {
		let m = match(line, /^([a-z]+)=(.*)$/);
		if (m) st[m[1]] = match(m[2], /^[0-9]+$/) ? +m[2] : m[2];
	}
	if (st.state == 'running' && !stat('/tmp/shareos-usb.copy.lock')) { st.state = 'error'; st.error ??= 'stopped'; }
	return { enabled: c.get('shareos', 'usbcopy', 'enabled') == '1', volume: c.get('shareos', 'usbcopy', 'volume') ?? '',
		path: c.get('shareos', 'usbcopy', 'path') ?? folder_name('usb'), last: length(st) ? st : null };
}

function smart_read(disk, refresh) {
	let cache = SMART_DIR + '/smart-' + disk + '.json';
	let st = stat(cache);
	if (!refresh && st && time() - st.mtime < SMART_MAX_AGE) {
		let c = null;
		try { c = json(readfile(cache)); } catch (e) { }
		if (c) return c;
	}
	if (!refresh && !st)
		return null;
	// old values and the disk asleep (asked every 30 s at most): no smartctl
	// at every status poll just to hear "standby" again
	if (!refresh && disk_standby_memo(disk) === true)
		return { standby: true };
	// -n standby: do not wake a sleeping disk just for SMART; -a: health,
	// attributes, error and self-test log; devstat: the SSD endurance indicator
	let r = sh_quiet('smartctl -j -n standby -a -l devstat /dev/' + disk);
	let j = null;
	try { j = json(r.out); } catch (e) { }
	if (!j)
		return { error: 'no SMART data' };
	if (j.smartctl?.exit_status == 2 && match(r.out, /standby|STANDBY|sleep/))
		return { standby: true };
	if (!j.smart_status && !j.ata_smart_attributes)
		return { error: 'no SMART data' };
	let res = smart_parse(j);
	system('mkdir -p ' + SMART_DIR);
	writefile(cache, sprintf('%J', res));
	return res;
}

function mdstat() {
	let arrays = {};
	let cur = null;
	for (let line in split(readfile('/proc/mdstat') ?? '', '\n')) {
		let m = match(line, /^(md[0-9]+) : (\S+) (\S+) (.*)$/);
		if (m) {
			cur = { name: m[1], state: m[2], level: m[3], members: map(split(trim(m[4]), ' '), (x) => replace(x, /\[[0-9]+\](\(.\))?/, '')) };
			arrays[m[1]] = cur;
			continue;
		}
		if (!cur) continue;
		let h = match(line, /\[([0-9]+)\/([0-9]+)\] \[([U_]+)\]/);
		if (h) { cur.disks = +h[1]; cur.active = +h[2]; cur.health = h[3]; }
		let p = match(line, /(resync|recovery|check|reshape) *= *([0-9.]+)%.*finish=([0-9.]+min)/);
		if (p) { cur.sync = { action: p[1], percent: +p[2], finish: p[3] }; }
		let d = match(line, /(resync|recovery)=DELAYED/);
		if (d) cur.sync = { action: d[1], percent: 0, delayed: true };
	}
	return arrays;
}

function storage_job() {
	let j = {};
	for (let line in split(readfile(SMART_DIR + '/job') ?? '', '\n')) {
		let m = match(line, /^([a-z]+)=(.*)$/);
		if (m) j[m[1]] = m[2];
	}
	if (j.state == 'running' && !stat(SMART_DIR + '/lock')) {
		j.state = 'error';
		j.error = j.error ?? 'job ended unexpectedly';
	}
	return length(j) ? j : null;
}

// the device of a volume. Must not touch the disks: this runs on every poll of
// the storage page and the status page, and a probe wakes sleeping disks
// (issue #155). A mounted volume: from /proc/mounts. Otherwise blkid – it
// reads every partition – kept for 10 minutes and as long as the same block
// devices exist.
function volume_device(uuid, mp, mounts) {
	for (let line in split(mounts, '\n')) {
		let f = split(line, ' ');
		if (f[1] == mp && index(f[0], '/dev/') == 0) return f[0];
	}
	if (!uuid) return null;
	return memo('voldev:' + uuid, join(',', glob('/sys/class/block/*')), 600, () => {
		let d = trim(sh('blkid -o device -t UUID=' + shq(uuid) + ' /dev/sd[a-z]* /dev/md[0-9]* /dev/loop[0-9]* 2>/dev/null | head -1').out);
		return length(d) ? d : null;
	});
}

function volumes() {
	let list = [];
	let c = cursor();
	let mounts = readfile('/proc/mounts') ?? '';
	c.foreach('storage', 'volume', function(s) {
		let name = s['.name'];
		let mp = '/mnt/' + name;
		let dev = volume_device(s.uuid, mp, mounts);
		let mounted = index(mounts, ' ' + mp + ' ') >= 0;
		// the file system as it is mounted; the one noted in the settings only
		// while the volume is not mounted
		let mfs = mounted ? match(mounts, regexp('(^|\n)\\S+ ' + mp + ' (\\S+) '))?.[2] : null;
		let v = { name, uuid: s.uuid, fstype: mfs ?? s.fstype, layout: s.layout, enabled: s.enabled != '0',
			device: dev, mountpoint: mp, mounted };
		push(list, v);
	});
	// sizes: one df for all mounted volumes
	let mps = map(filter(list, (v) => v.mounted), (v) => v.mountpoint);
	if (length(mps)) {
		let by = {};
		for (let line in split(sh('df -k ' + join(' ', map(mps, shq))).out, '\n')) {
			let f = split(trim(line), /\s+/);
			if (length(f) >= 6 && match(f[1], /^[0-9]+$/)) by[f[5]] = f;
		}
		for (let v in list) {
			let f = by[v.mountpoint];
			if (f) { v.size = +f[1] * 1024; v.used = +f[2] * 1024; v.avail = +f[3] * 1024; }
		}
	}
	return list;
}

function spawn_storage(args) {
	system(sprintf('start-stop-daemon -S -b -x %s -- %s', STORAGE, join(' ', map(args, shq))));
	return { started: true };
}

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.storage': {
		// only the volumes (name, mounted, size): for pages that need no disks,
		// SMART or arrays – one df instead of a dozen programs
		volumes: {
			call: function() { return { volumes: volumes(), apps: cursor().get('storage', 'global', 'apps') }; }
		},

		status: {
			call: function() {
				let disks = [];
				for (let d in lsblk()) {
					if (d.type != 'disk' || !match(d.name, /^sd[a-z]$/)) continue;
					d.usb = is_usb(d.name);
					d.smart = d.usb ? null : smart_read(d.name, false);
					// CHECK POWER MODE does not wake a sleeping disk
					d.standby = disk_standby_memo(d.name);
					push(disks, d);
				}
				let c = cursor();
				let swaps = [];
				for (let line in slice(split(readfile('/proc/swaps') ?? '', '\n'), 1)) {
					let f = split(trim(line), /\s+/);
					if (length(f) >= 4) push(swaps, { device: f[0], size: +f[2] * 1024, used: +f[3] * 1024 });
				}
				return {
					disks,
					swaps,
					apps: c.get('storage', 'global', 'apps'),
					arrays: mdstat(),
					volumes: volumes(),
					spindown: +(c.get('storage', 'global', 'spindown') ?? 0),
					smart_schedule: c.get('storage', 'global', 'smart_test') ?? '',
					usb: usb_mounts(),
					usb_copy: usb_copy_info(),
					job: storage_job()
				};
			}
		},

		smart: {
			args: { disk: '' },
			call: function(req) {
				if (!valid_disk(req.args.disk))
					return { error: 'unknown disk' };
				return smart_read(req.args.disk, true);
			}
		},

		// SMART self-test: short (minutes) | long (hours, reads the whole
		// disk) | abort; the disk wakes up for it. The values are read again
		// right away, so the running test shows.
		smart_test: {
			args: { disk: '', type: '' },
			call: function(req) {
				let d = req.args.disk, t = req.args.type;
				if (!valid_disk(d) || is_usb(d)) return { error: 'unknown disk' };
				let opt = { short: '-t short', long: '-t long', abort: '-X' }[t];
				if (!opt) return { error: 'invalid test' };
				let r = sh('smartctl ' + opt + ' /dev/' + d);
				// exit bits 0-2: command line, open, SMART command failed (the others are the disk's state)
				if (r.rc & 7) { let l = filter(split(trim(r.out), '\n'), (x) => length(trim(x))); return { error: trim(l[length(l) - 1] ?? '') || 'failed' }; }
				return smart_read(d, true);
			}
		},

		// self-tests by schedule: '' (none) | short_weekly (Sunday 03:30) |
		// long_monthly (1st of the month, 03:30) – see shareos-cron
		smart_schedule: {
			args: { mode: '' },
			call: function(req) {
				let m = req.args.mode ?? '';
				if (index([ '', 'short_weekly', 'long_monthly' ], m) < 0) return { error: 'invalid value' };
				let c = cursor();
				if (c.get('storage', 'global') != 'global') c.set('storage', 'global', 'global');
				if (m == '') c.delete('storage', 'global', 'smart_test'); else c.set('storage', 'global', 'smart_test', m);
				c.save('storage'); c.commit('storage');
				system(CRON + ' sync >/dev/null 2>&1');
				return { ok: true, mode: m };
			}
		},

		setup: {
			// layout mirror (RAID 1) | stripe (RAID 0) | span (JBOD): name + disks[2];
			// layout single: volumes [{name, disk}]
			// fs: ext4 (default), ext3, ext2, btrfs, exfat, ntfs, vfat – volumes may carry their own
			args: { layout: '', name: '', disks: [], volumes: [], swap: 1024, fs: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true)
					return { error: 'confirm must be true' };
				let swap = a.swap == null ? 1024 : +a.swap;
				if (!(swap >= 0 && swap <= 8192))
					return { error: 'invalid swap size' };
				let sw = '--swap=' + int(swap);
				let fs = a.fs || 'ext4';
				if (!FS_DISK[fs]) return { error: 'invalid file system' };
				let j = storage_job();
				if (j?.state == 'running')
					return { error: 'a storage job is already running' };
				if (a.layout == 'mirror' || a.layout == 'stripe' || a.layout == 'span') {
					if (!valid_name(a.name)) return { error: 'invalid name' };
					if (type(a.disks) != 'array' || length(a.disks) != 2 || a.disks[0] == a.disks[1] ||
					    !valid_disk(a.disks[0]) || !valid_disk(a.disks[1]))
						return { error: 'two different disks are needed' };
					if (is_usb(a.disks[0]) || is_usb(a.disks[1]))
						return { error: 'USB drives are formatted with usb_format' };
					return spawn_storage([ 'setup', a.layout, a.name, a.disks[0], a.disks[1], sw, '--fs=' + fs, '--yes' ]);
				}
				if (a.layout == 'single') {
					if (type(a.volumes) != 'array' || !length(a.volumes))
						return { error: 'no disks given' };
					let args = [ 'setup', 'single' ], seen = {};
					for (let v in a.volumes) {
						if (!valid_name(v?.name) || !valid_disk(v?.disk) || seen[v.name] || seen[v.disk])
							return { error: 'invalid name or disk' };
						if (v.fs && !FS_DISK[v.fs]) return { error: 'invalid file system' };
						if (is_usb(v.disk)) return { error: 'USB drives are formatted with usb_format' };
						seen[v.name] = seen[v.disk] = true;
						push(args, v.name + '=' + v.disk + ':' + (v.fs || fs));
					}
					push(args, sw, '--yes');
					return spawn_storage(args);
				}
				return { error: 'unknown layout' };
			}
		},

		// a mirror with a missing disk: erase a disk and add it
		repair: {
			args: { name: '', disk: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true) return { error: 'confirm must be true' };
				if (!valid_name(a.name)) return { error: 'invalid name' };
				if (cursor().get('storage', a.name, 'layout') != 'mirror') return { error: 'not a mirror' };
				if (!valid_disk(a.disk)) return { error: 'invalid disk' };
				if (is_usb(a.disk)) return { error: 'USB drives cannot be part of a mirror' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is already running' };
				return spawn_storage([ 'repair', a.name, a.disk, '--yes' ]);
			}
		},

		// a partition that already has a file system (Alt-F, D-Link) becomes
		// a volume as it is – nothing is erased
		adopt: {
			args: { name: '', part: '' },
			call: function(req) {
				let n = req.args.name, p = req.args.part;
				if (!valid_name(n)) return { error: 'invalid name' };
				if (!match(p ?? '', /^(sd[a-z]+[0-9]+|md[0-9]+)$/)) return { error: 'invalid partition' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is running' };
				let r = sh(STORAGE + ' adopt ' + shq(n) + ' ' + shq(p));
				if (r.rc != 0) return { error: trim(replace(r.out, /^.*ERROR: /s, '')) || 'adopt failed' };
				system(USERS + ' sync >/dev/null 2>&1');
				return { ok: true };
			}
		},

		volume: {
			args: { name: '', action: '' },
			call: function(req) {
				let n = req.args.name, act = req.args.action;
				if (!valid_name(n)) return { error: 'invalid name' };
				if (!(act in { mount: 1, umount: 1, forget: 1 })) return { error: 'unknown action' };
				let r = sh(STORAGE + ' ' + act + ' ' + shq(n));
				if (r.rc == 0) system(USERS + ' sync >/dev/null 2>&1');
				return r.rc == 0 ? { ok: true } : { error: trim(r.out) || act + ' failed' };
			}
		},

		// USB stick/disk: unmount and power down, then it can be pulled
		usb_eject: {
			args: { disk: '' },
			call: function(req) {
				if (!is_usb(req.args.disk)) return { error: 'not a USB drive' };
				let r = sh(USB + ' eject ' + req.args.disk);
				if (r.rc != 0) return { error: replace(trim(r.out), /^error: /, '') || 'eject failed' };
				return { ok: true };
			}
		},

		// erase a USB stick/disk: one partition, fs: exfat (default), vfat, ntfs, ext4
		// USB button: short press copies the USB drives into volume/path
		usb_copy_config: {
			args: { enabled: false, volume: '', path: '' },
			call: function(req) {
				let a = req.args, c = cursor();
				if (type(a.enabled) != 'bool') return { error: 'invalid value' };
				let path = trim(a.path ?? '') || folder_name('usb');
				for (let part in split(path, '/')) if (!name_ok(part) || substr(part, 0, 1) == '.') return { error: 'invalid folder' };
				if (a.enabled || a.volume) {
					if (!valid_name(a.volume) || c.get('storage', a.volume) != 'volume') return { error: 'unknown volume' };
				}
				if (c.get('shareos', 'usbcopy') != 'usbcopy') c.set('shareos', 'usbcopy', 'usbcopy');
				c.set('shareos', 'usbcopy', 'enabled', a.enabled ? '1' : '0');
				c.set('shareos', 'usbcopy', 'volume', a.volume ?? '');
				c.set('shareos', 'usbcopy', 'path', path);
				c.save('shareos'); c.commit('shareos');
				return usb_copy_info();
			}
		},

		// copy now (like a short press of the USB button)
		usb_copy: {
			call: function() {
				let i = usb_copy_info();
				if (!i.volume) return { error: 'no target set' };
				if (stat('/tmp/shareos-usb.copy.lock')) return { error: 'already running' };
				if (!length(usb_mounts())) return { error: 'no USB drive' };
				system(sprintf('start-stop-daemon -S -b -x %s -- copy', USB));
				return { started: true };
			}
		},

		usb_format: {
			args: { disk: '', fs: '', name: '', confirm: false },
			call: function(req) {
				let a = req.args;
				if (a.confirm !== true) return { error: 'confirm must be true' };
				if (!is_usb(a.disk)) return { error: 'not a USB drive' };
				let fs = a.fs || 'exfat';
				if (!FS_USB[fs]) return { error: 'invalid file system' };
				if (type(a.name) != 'string' || !match(a.name, /^[A-Za-z0-9 _-]{1,16}$/)) return { error: 'invalid name' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is already running' };
				system(sprintf('start-stop-daemon -S -b -x %s -- format %s %s %s --yes', USB, a.disk, fs, shq(a.name)));
				return { started: true };
			}
		},

		// hide the message of a finished or failed setup job
		job_clear: {
			call: function() {
				if (storage_job()?.state == 'running')
					return { error: 'a storage job is running' };
				unlink(SMART_DIR + '/job');
				return { ok: true };
			}
		},

		spindown: {
			args: { minutes: 0 },
			call: function(req) {
				let m = +req.args.minutes;
				if (m < 0 || m > 330) return { error: 'invalid value' };
				let r = sh(STORAGE + ' spindown ' + m);
				return r.rc == 0 ? { ok: true, minutes: m } : { error: trim(r.out) };
			}
		}
	}
});
