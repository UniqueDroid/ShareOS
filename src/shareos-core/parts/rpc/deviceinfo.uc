/* ---------- device info: hardware facts of a new model (shareos-deviceinfo) ---------- */

const DEVICEINFO = '/usr/sbin/shareos-deviceinfo';

// a model that is being added (BOARD_DEVTEST in board.sh): root keeps the
// password "shareos", the web interface says so and offers the device info
function devtest() { return board().devtest == '1'; }

/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.deviceinfo': {
		// the report as text; full: without masking MAC addresses and serial numbers
		get: {
			args: { full: false },
			call: function(req) {
				let r = sh(DEVICEINFO + (req.args.full === true ? ' --full' : ''));
				return { text: r.out, full: req.args.full === true, devtest: devtest(),
					fwname: board().fwname || board().id || 'unknown' };
			}
		}
	}
});
