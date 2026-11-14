/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.update': {
		// the one setting of the Firmware page. It has a method of its own, so
		// that web sessions need no general write access to the settings (uci)
		set_channel: {
			args: { channel: '' },
			call: function(req) {
				if (!channel_ok(req.args.channel)) return { error: 'invalid channel' };
				let c = cursor();
				c.set('shareos', 'update', 'update');
				c.set('shareos', 'update', 'channel', req.args.channel);
				c.commit('shareos');
				return { ok: true, channel: req.args.channel };
			}
		},

		check: {
			args: { channel: 'stable' },
			call: function(req) {
				let ch = req.args.channel;
				return run_updater(ch ? [ 'check', ch ] : [ 'check' ]);
			}
		},

		// The check the interface starts by itself: in the background. Asking
		// GitHub takes up to a minute on a box without internet, and rpcd
		// answers one call at a time – the result comes with "status".
		check_auto: {
			call: function() { return spawn_updater([ 'auto' ]); }
		},

		status: {
			// asked every few seconds by the interface: only when the update state changed
			call: function() {
				let d = '/tmp/shareos-update';
				return memo('update', fstamp(d + '/state.json', d + '/dl/fw.tar.part', d + '/dl/fw.tar',
					'/overlay/upgrade-result', '/overlay/upgrade/rootfs.squashfs', '/etc/shareos-release'), 60,
					() => run_updater([ 'status' ]));
			}
		},

		download: {
			args: { tag: '' },
			call: function(req) {
				if (!req.args.tag)
					return { error: 'tag missing' };
				let s = run_updater([ 'status' ]);
				if (s.state == 'downloading' || s.state == 'verifying' || s.state == 'flashing')
					return { error: 'busy: ' + s.state };
				return spawn_updater([ 'download', req.args.tag ]);
			}
		},

		apply: {
			// "confirm" must be true: flashing is the one step that cannot be undone
			args: { tag: '', confirm: false },
			call: function(req) {
				if (req.args.confirm !== true)
					return { error: 'confirm must be true' };
				let s = run_updater([ 'status' ]);
				if (s.state != 'ready' || s.release?.tag != req.args.tag)
					return { error: 'release not downloaded and verified' };
				return spawn_updater([ 'apply', req.args.tag ]);
			}
		},

		cancel: {
			call: function() {
				return run_updater([ 'cancel' ]);
			}
		},

		// hide the "last update" message
		ack: {
			call: function() {
				return run_updater([ 'ack' ]);
			}
		},

		// update without internet: upload the .sysupgrade.tar of a release
		local_ticket: {
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-fw && chmod 700 ' + FILES_TICKETS + ' /tmp/shareos-fw; rm -f /tmp/shareos-fw/upload.tar');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n/tmp/shareos-fw/upload.tar\n%d\nupload.tar\n', time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		local: {
			// sha256: content of the release's .sha256 file (optional)
			args: { sha256: '' },
			call: function(req) {
				let sha = req.args.sha256 ?? '';
				let m = match(sha, /[0-9a-f]{64}/);
				if (sha != '' && !m) return { error: 'checksum file is invalid' };
				if (!stat('/tmp/shareos-fw/upload.tar')) return { error: 'no uploaded file' };
				let s = run_updater([ 'status' ]);
				if (s.state == 'downloading' || s.state == 'verifying' || s.state == 'flashing')
					return { error: 'busy: ' + s.state };
				return spawn_updater(m ? [ 'local', '/tmp/shareos-fw/upload.tar', m[0] ] : [ 'local', '/tmp/shareos-fw/upload.tar' ]);
			}
		},

		// another firmware file in D-Link format (.bin), e.g. back to Alt-F
		bin_ticket: {
			call: function() {
				system('mkdir -p ' + FILES_TICKETS + ' /tmp/shareos-fw && chmod 700 ' + FILES_TICKETS + ' /tmp/shareos-fw; rm -f /tmp/shareos-fw/upload.bin');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\nroot\n/tmp/shareos-fw/upload.bin\n%d\nupload.bin\n', time() + 300));
				return { url: '/cgi-bin/files?t=' + t };
			}
		},

		bin_info: {
			call: function() {
				if (!stat('/tmp/shareos-fw/upload.bin')) return { error: 'no uploaded file' };
				let r = sh('/usr/sbin/shareos-flash-bin info /tmp/shareos-fw/upload.bin'), o = {};
				if (r.rc != 0) { unlink('/tmp/shareos-fw/upload.bin'); return { error: replace(trim(r.out), /^error: /, '') }; }
				for (let l in split(r.out, '\n')) { let m = match(l, /^([a-z_]+)=(.*)$/); if (m) o[m[1]] = m[2]; }
				return o;
			}
		},

		bin_write: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true) return { error: 'confirm must be true' };
				if (!stat('/tmp/shareos-fw/upload.bin')) return { error: 'no uploaded file' };
				let r = sh('/usr/sbin/shareos-flash-bin write /tmp/shareos-fw/upload.bin --yes');
				unlink('/tmp/shareos-fw/upload.bin');
				if (r.rc != 0) return { error: replace(trim(r.out), /^error: /, '') };
				let m = match(r.out, /kind=([a-z]+)/);
				return { ok: true, kind: m ? m[1] : 'other' };
			}
		}
	}
});
