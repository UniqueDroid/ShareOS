/* ---------- DNS filter (module "dnsfilter", AdGuard Home) ---------- */

function df_tool(args, input) {
	let cmd = '/usr/sbin/shareos-dnsfilter ' + join(' ', map(args, shq));
	let f = null;
	if (input != null) {
		f = '/tmp/.shareos-df-in.' + substr(new_token(), 0, 12);
		system('umask 077; : > ' + shq(f));
		writefile(f, sprintf('%J', input));
		cmd += ' < ' + shq(f);
	}
	let r = sh(cmd);
	if (f) unlink(f);
	let j = null;
	try { j = json(trim(r.out) || 'null'); } catch (e) { }
	return type(j) == 'object' ? j : { error: trim(r.out) || 'failed' };
}
const DF_OFF = { error: 'the DNS filter is not installed (system app dnsfilter)' };

