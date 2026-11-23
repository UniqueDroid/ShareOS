/* ---------- disk change: everything from one drive to another (shareos-migrate) ---------- */

const MIGRATE = '/usr/sbin/shareos-migrate';

function migrate_tool(args) {
	let r = sh(MIGRATE + ' ' + join(' ', map(args, shq)));
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

// a volume name as the storage tool takes it
function migrate_vol(v) { return type(v) == 'string' && match(v, /^[a-z0-9][a-z0-9_-]{0,15}$/); }

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.migrate': {
		// what moves from <from> to <to>, and whether it can
		plan: {
			args: { from: '', to: '' },
			call: function(req) {
				let a = req.args;
				if (!migrate_vol(a.from) || !migrate_vol(a.to)) return { error: 'invalid drive' };
				return migrate_tool([ 'plan', a.from, a.to ]);
			}
		},

		state: {
			call: function() { return migrate_tool([ 'state' ]); }
		},

		// copy in the background; a stopped copy goes on where it was
		copy: {
			args: { from: '', to: '' },
			call: function(req) {
				let a = req.args;
				if (flash_busy()) return { error: FLASH_BUSY };
				if (!migrate_vol(a.from) || !migrate_vol(a.to)) return { error: 'invalid drive' };
				if (storage_job()?.state == 'running') return { error: 'a storage job is already running' };
				return migrate_tool([ 'copy', a.from, a.to ]);
			}
		},

		cancel: {
			call: function() { return migrate_tool([ 'cancel' ]); }
		},

		// services stop, last copy, settings point to the new drive, services
		// start – in the background (can take minutes); the page polls state
		switch: {
			args: { confirm: false },
			call: function(req) {
				if (req.args.confirm !== true) return { error: 'confirm must be true' };
				if (flash_busy()) return { error: FLASH_BUSY };
				let s = migrate_tool([ 'state' ]);
				if (s.state != 'copied') return { error: 'copy everything first' };
				system(sprintf('start-stop-daemon -S -b -x %s -- switch', MIGRATE));
				return { started: true };
			}
		},

		clear: {
			call: function() { return migrate_tool([ 'clear' ]); }
		}
	}
});
