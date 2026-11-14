/* ---------- VPN client (OpenVPN system app, shareos-vpn) and status chips ---------- */

const VPN = '/usr/sbin/shareos-vpn';
const TAILSCALE = '/usr/sbin/shareos-tailscale';
const APPSTATUS = '/tmp/shareos-appstatus';
const CHIP_STATES = { ok: 1, warn: 1, err: 1, info: 1 };

function vpn_tool(args, input) {
	let cmd = VPN + ' ' + join(' ', map(args, shq));
	if (input != null) {
		let f = '/tmp/.shareos-vpn-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
		let r = sh(cmd);
		unlink(f);
		let j = jparse(trim(r.out) || 'null');
		return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
	}
	let j = jparse(trim(sh(cmd).out) || 'null');
	return type(j) == 'object' ? j : { error: 'failed' };
}

// shareos-tailscale <args> (JSON on stdin for up)
function ts_tool(args, input) {
	let cmd = TAILSCALE + ' ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-ts-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = jparse(trim(r.out) || 'null');
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}

// grant of an app with the permission p (and "files"); vpn, tailscale,
// autobrr, sysinfo, netcheck, docker, tuya, notify: admin accounts only
const ADMIN_PERMS = { vpn: 1, tailscale: 1, autobrr: 1, zabbix: 1, sysinfo: 1, netcheck: 1, docker: 1, tuya: 1, notify: 1 };
function app_grant_perm(grant, p) {
	let g = app_grant_user(grant);
	if (!g || index(g.app.permissions ?? [], p) < 0) return null;
	if (ADMIN_PERMS[p] && acc_role(g.u) != 'admin') return null;
	return g;
}

