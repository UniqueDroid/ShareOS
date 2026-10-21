#!/bin/bash
#
# Runs the built ShareOS userland (ARM) on the build host with qemu-user:
# ubusd + rpcd (with the ShareOS ucode plugin) + uhttpd, serving the web UI
# on http://127.0.0.1:<port>/ – for backend and GUI development without
# hardware. Board-specific parts (MCU, LEDs, flash) are not available.
#
#   sudo tests/run-stack-qemu.sh [output/dns320l] [port] [--check]
#
#   --check   run JSON-RPC smoke tests, then stop again
#
# Needs root (chroot, mounts), qemu-user-static and binfmt_misc.
#
# own UTS name space: start scripts of the box set the host name, which
# would otherwise change the host name of the build machine
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -euo pipefail
OUT=${1:-output/dns320l}
PORT=${2:-8080}
CHECK=${3:-}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
[ -f "$SQFS" ] || { echo "no $SQFS – build first (make dns320l)"; exit 1; }
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }

R=$(mktemp -d /tmp/shareos-qemu.XXXX)
cleanup() {
	chroot "$R" /bin/sh -c '/etc/init.d/S50avahi-daemon stop; /etc/init.d/S50uhttpd stop; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1 || true
	umount -l "$R/dev/pts" 2>/dev/null; umount -l "$R/dev" 2>/dev/null; umount -l "$R/proc" 2>/dev/null
	# never delete through a mount that is still there (it would be the host's /dev)
	if grep -q " $R/" /proc/mounts; then echo "still mounted below $R – not removed" >&2
	else rm -rf "$R"; fi
}
trap cleanup EXIT
trap 'exit 1' INT TERM

# binfmt for ARM ELF -> qemu (F = fix binary, works inside the chroot)
if [ ! -e /proc/sys/fs/binfmt_misc/qemu-arm ]; then
	[ -e /proc/sys/fs/binfmt_misc/register ] || mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
	echo ":qemu-arm:M::\x7fELF\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x28\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:$QEMU:F" \
		> /proc/sys/fs/binfmt_misc/register
fi

rmdir "$R" && "$UNSQ" -q -d "$R" "$SQFS" >/dev/null
mkdir -p "$R/proc" "$R/dev"
mount -t proc proc "$R/proc"
mount --bind /dev "$R/dev"
# terminals (ttyd, System -> Terminal) need pseudo terminals
mount --bind /dev/pts "$R/dev/pts"
sed -i "s/^PORT=.*/PORT=$PORT/; s/\${SHAREOS_HTTPS_PORT:-443}/$((PORT+363))/" "$R/usr/sbin/shareos-uhttpd"

chroot "$R" /bin/sh -c '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start && /etc/init.d/S50uhttpd start'
for i in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.2; done

rpc() { curl -s "http://127.0.0.1:$PORT/ubus" -H 'Content-Type: application/json' \
	-d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"call\",\"params\":[\"$1\",\"$2\",\"$3\",${4:-{\}}]}"; }
ZERO=00000000000000000000000000000000

if [ "$CHECK" = "--check" ]; then
	fails=0
	t() { if printf '%s' "$2" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); sys.exit(0 if ($3) else 1)"; then
		echo "PASS  $1"; else echo "FAIL  $1: $2"; fails=$((fails+1)); fi; }
	t "web root served" "$(curl -s -o /dev/null -w '{"c":%{http_code}}' http://127.0.0.1:$PORT/)" "d['c']==200"
	t "anonymous call denied" "$(rpc $ZERO shareos.system info)" "d['error']['code']==-32002"
	t "wrong password rejected" "$(rpc $ZERO session login '{"username":"root","password":"wrong"}')" "d['result'][0]==6"
	L=$(rpc $ZERO session login '{"username":"root","password":"shareos"}')
	t "login works, shareos-admin granted" "$L" "'shareos-admin' in d['result'][1]['acls']['access-group']"
	SID=$(printf '%s' "$L" | python3 -c "import json,sys;print(json.load(sys.stdin)['result'][1]['ubus_rpc_session'])")
	t "shareos.system info" "$(rpc $SID shareos.system info)" "d['result'][1]['release']['fwname']=='DNS-320L-rev-Ax'"
	t "uci get shareos" "$(rpc $SID uci get '{"config":"shareos"}')" "d['result'][1]['values']['update']['repo']=='UniqueDroid/ShareOS'"
	t "apply needs confirm" "$(rpc $SID shareos.update apply '{"tag":"v0"}')" "'confirm' in d['result'][1]['error']"
	t "update status" "$(rpc $SID shareos.update status)" "'state' in d['result'][1]"
	t "info: cpu, net counters, filesystems" "$(rpc $SID shareos.system info)" "d['result'][1]['cpu']['total']>0 and 'rx_bytes' in d['result'][1]['network']['eth0'] and 'filesystems' in d['result'][1]"
	t "service list" "$(rpc $SID shareos.service list)" "any(x['name']=='uhttpd' and x['running'] for x in d['result'][1]['services'])"
	t "essential service cannot be stopped" "$(rpc $SID shareos.service action '{"name":"rpcd","action":"stop"}')" "'cannot be stopped' in d['result'][1]['error']"
	t "unknown service rejected" "$(rpc $SID shareos.service action '{"name":"../../bin/sh","action":"start"}')" "d['result'][1]['error']=='unknown service'"
	t "log readable" "$(rpc $SID shareos.system log '{"lines":5,"source":"kernel"}')" "type(d['result'][1]['lines'])==list"
	t "factory reset needs confirm" "$(rpc $SID shareos.system factory_reset)" "'confirm' in d['result'][1]['error']"
	t "invalid hostname rejected" "$(rpc $SID shareos.system set_hostname '{"hostname":"bad name;x"}')" "d['result'][1]['error']=='invalid hostname'"
	t "short password rejected" "$(rpc $SID shareos.system set_password '{"password":"abc"}')" "'too short' in d['result'][1]['error']"
	t "anonymous service list denied" "$(rpc $ZERO shareos.service list)" "d['error']['code']==-32002"
	t "public: language/logo readable before login" "$(rpc $ZERO shareos.ui get)" "d['result'][1]['lang']=='en' and d['result'][1]['logo']==True"
	t "public: login page knows the factory password is still set" "$(rpc $ZERO shareos.ui get)" "d['result'][1]['default_password']==True"
	chroot "$R" /bin/sh -c 'echo root:another-pass | chpasswd -c sha512' >/dev/null 2>&1
	t "public: hint gone after the password was changed" "$(rpc $ZERO shareos.ui get)" "d['result'][1]['default_password']==False"
	chroot "$R" /bin/sh -c 'echo root:shareos | chpasswd -c sha512' >/dev/null 2>&1
	t "public: hint back with the factory password" "$(rpc $ZERO shareos.ui get)" "d['result'][1]['default_password']==True"
	t "public: nothing else readable before login" "$(rpc $ZERO shareos.web get)" "d['error']['code']==-32002"
	t "self-signed certificate created on start" "$(rpc $SID shareos.web get)" "d['result'][1]['https'] and d['result'][1]['cert']['selfsigned'] and d['result'][1]['cert']['subject'].startswith('CN=')"
	t "HTTPS answers with that certificate" "$(curl -sk -o /dev/null -w '{"c":%{http_code}}' https://127.0.0.1:$((PORT+363))/)" "d['c']==200"
	t "own certificate: garbage rejected" "$(rpc $SID shareos.web install '{"cert":"x","key":"y"}')" "'PEM' in d['result'][1]['error']"
	# own wildcard certificate from an own CA (like pfSense exports it), installed through the web interface path
	CT=$(mktemp -d)
	openssl req -x509 -newkey rsa:2048 -nodes -keyout $CT/ca.key -out $CT/ca.crt -days 30 -subj "/CN=Test CA" 2>/dev/null
	openssl req -newkey rsa:2048 -nodes -keyout $CT/w.key -out $CT/w.csr -subj "/CN=*.skynet.lan" 2>/dev/null
	printf 'subjectAltName=DNS:*.skynet.lan\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > $CT/ext
	openssl x509 -req -in $CT/w.csr -CA $CT/ca.crt -CAkey $CT/ca.key -CAcreateserial -out $CT/w.crt -days 30 -extfile $CT/ext 2>/dev/null
	certreq() { python3 -c "import json,sys; print(json.dumps({'cert':open(sys.argv[1]).read(),'key':open(sys.argv[2]).read()}))" "$1" "$2"; }
	t "own certificate: wrong key rejected" "$(rpc $SID shareos.web install "$(certreq $CT/w.crt $CT/ca.key)")" "'error' in d['result'][1]"
	t "own wildcard certificate installed" "$(rpc $SID shareos.web install "$(certreq $CT/w.crt $CT/w.key)")" "d['result'][1].get('ok') and 'skynet.lan' in d['result'][1]['cert']['subject']"
	# the web server restarts while answering – the reply may be cut off
	rpc $SID shareos.web selfsigned >/dev/null || true
	rm -rf $CT
	# the web server restarts after a certificate change
	sleep 2; for i in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.2; done
	t "notify: settings readable, no password" "$(rpc $SID shareos.notify get)" "d['result'][1]['temp_max']==55 and 'smtp_pass' not in d['result'][1]"
	t "notify: invalid push address rejected" "$(rpc $SID shareos.notify set '{"push_url":"javascript:x"}')" "'push address' in d['result'][1]['error']"
	t "notify: settings stored, password kept secret" "$(rpc $SID shareos.notify set '{"email":true,"smtp_host":"mail.example.org","smtp_pass":"geheim","mail_to":"a@example.org"}')" "d['result'][1]['email'] and d['result'][1]['has_pass'] and 'geheim' not in json.dumps(d)"
	t "notify: ntfy address and addresses with s accepted" "$(rpc $SID shareos.notify set '{"push_type":"ntfy","push_url":"https://ntfy.sh/mein-nas","mail_to":"sven@example.sh","mail_from":"nas@skynet.lan"}')" "d['result'][1].get('push_url')=='https://ntfy.sh/mein-nas'"
	t "notify: Telegram with chat ID" "$(rpc $SID shareos.notify set '{"push_type":"telegram","push_chat":"-100123"}')" "d['result'][1].get('push_chat')=='-100123'"
	t "notify: list" "$(rpc $SID shareos.notify list)" "'items' in d['result'][1]"
	t "language can be changed" "$(rpc $SID shareos.ui set '{"lang":"de"}')" "d['result'][1]['lang']=='de'"
	t "invalid language rejected" "$(rpc $SID shareos.ui set '{"lang":"../x"}')" "'invalid' in d['result'][1]['error']"
	t "area Cloud can be switched off" "$(rpc $SID shareos.ui set '{"areas":{"cloud":false}}')" "d['result'][1]['areas']=={'apps':True,'cloud':False,'paperless':True}"
	t "area off: no cloud jobs in crontab, on again" "$(chroot "$R" /bin/sh -c 'uci set cloud.x=job; uci set cloud.x.schedule="5 1 * * *"; uci commit cloud; shareos-cron sync; grep -c "shareos-cloud run" /etc/crontabs/root; true' | python3 -c 'import sys,json; print(json.dumps({"n": sys.stdin.read().strip()}))')" "d['n']=='0'"
	t "area Cloud on again" "$(rpc $SID shareos.ui set '{"areas":{"cloud":true}}')" "d['result'][1]['areas']['cloud']==True"
	t "hardware settings readable" "$(rpc $SID shareos.hw get)" "d['result'][1]['fan']['preset']=='balanced' and d['result'][1]['led']['status']=='heartbeat'"
	t "fan: custom curve validated" "$(rpc $SID shareos.hw set_fan '{"preset":"custom","off_temp":0,"full_temp":40,"half_temp":45}')" "'invalid' in d['result'][1]['error']"
	t "fan: custom curve stored" "$(rpc $SID shareos.hw set_fan '{"preset":"custom","off_temp":35,"full_temp":52,"half_temp":47}')" "d['result'][1]['fan']['full_temp']==52 and d['result'][1]['fan']['preset']=='custom'"
	t "LED setting stored" "$(rpc $SID shareos.hw set_led '{"power":"blink"}')" "d['result'][1]['led']['power']=='blink'"
	t "first run pending" "$(rpc $SID shareos.setup status)" "d['result'][1]['done']==False"
	t "time zones listed" "$(rpc $SID shareos.setup zones)" "'Europe/Berlin' in d['result'][1]['zones']"
	t "no Alt-F settings in the emulator" "$(rpc $SID shareos.setup altf)" "d['result'][1]['found']==False"
	t "first run: bad time zone rejected" "$(rpc $SID shareos.setup apply '{"timezone":"../../etc/passwd"}')" "'time zone' in d['result'][1]['error']"
	t "first run applied" "$(rpc $SID shareos.setup apply '{"timezone":"Europe/Vienna","channel":"beta"}')" "d['result'][1]['ok'] and 'timezone' in d['result'][1]['done']"
	t "first run done afterwards" "$(rpc $SID shareos.setup status)" "d['result'][1]['done']==True and d['result'][1]['timezone']=='Europe/Vienna'"
	t "look is system-wide (theme, accent)" "$(rpc $SID shareos.ui set '{"theme":"system","accent":"green"}')" "d['result'][1]['theme']=='system' and d['result'][1]['accent']=='green'"
	t "look readable before login" "$(rpc 00000000000000000000000000000000 shareos.ui get)" "d['result'][1]['accent']=='green'"
	t "invalid accent rejected" "$(rpc $SID shareos.ui set '{"accent":"pink"}')" "'invalid' in d['result'][1]['error']"
	t "services report autostart" "$(rpc $SID shareos.service list)" "all('autostart' in x for x in d['result'][1]['services'])"
	t "autostart can be switched off" "$(rpc $SID shareos.service autostart '{"name":"crond","enabled":false}')" "d['result'][1]['autostart']==False"
	t "autostart stored in UCI" "$(chroot "$R" uci -q get shareos.autostart.disabled | python3 -c 'import json,sys; print(json.dumps({"v":sys.stdin.read().split()}))')" "d['v']==['crond']"
	t "essential service always starts" "$(rpc $SID shareos.service autostart '{"name":"rpcd","enabled":false}')" "'always' in d['result'][1]['error']"
	t "autostart back on" "$(rpc $SID shareos.service autostart '{"name":"crond","enabled":true}')" "d['result'][1]['autostart']==True"
	t "network settings readable" "$(rpc $SID shareos.net get)" "d['result'][1]['proto']=='dhcp' and d['result'][1]['pending'] is None and d['result'][1]['timeout']==120"
	t "network change needs confirm" "$(rpc $SID shareos.net set '{"proto":"static","ipaddr":"10.0.0.5","netmask":"255.255.255.0"}')" "'confirm' in d['result'][1]['error']"
	t "network: bad mask rejected" "$(rpc $SID shareos.net set '{"proto":"static","ipaddr":"10.0.0.5","netmask":"255.0.255.0","confirm":true}')" "'mask' in d['result'][1]['error']"
	t "network: gateway outside rejected" "$(rpc $SID shareos.net set '{"proto":"static","ipaddr":"10.0.0.5","netmask":"255.255.255.0","gateway":"10.0.1.1","confirm":true}')" "'same network' in d['result'][1]['error']"
	t "network: broadcast address rejected" "$(rpc $SID shareos.net set '{"proto":"static","ipaddr":"10.0.0.255","netmask":"255.255.255.0","confirm":true}')" "'broadcast' in d['result'][1]['error']"
	t "network: bad DNS rejected" "$(rpc $SID shareos.net set '{"proto":"static","ipaddr":"10.0.0.5","netmask":"255.255.255.0","dns":["1.2.3"],"confirm":true}')" "'DNS' in d['result'][1]['error']"
	t "network: confirm without change is harmless" "$(rpc $SID shareos.net confirm)" "d['result'][1]['ok']"
	# every page of the web interface works with a web session (ACL)
	t "apps: installed list with a web session" "$(rpc $SID shareos.apps installed)" "'result' in d and d['result'][0]==0"
	t "apps: store settings with a web session" "$(rpc $SID shareos.apps store_get)" "'result' in d and d['result'][0]==0"
	# time (never with NTP on here: ntpd in the chroot would set the host's clock)
	t "time: clock, zone and servers readable" "$(rpc $SID shareos.time get)" "d['result'][1]['now']>1700000000 and d['result'][1]['servers']==['0.pool.ntp.org','1.pool.ntp.org','2.pool.ntp.org']"
	t "time: bad server rejected" "$(rpc $SID shareos.time set '{"ntp":false,"servers":["bad name;x"]}')" "'invalid server' in d['result'][1]['error']"
	t "time: NTP off, own servers stored" "$(rpc $SID shareos.time set '{"timezone":"Europe/Berlin","ntp":false,"servers":["fritz.box","192.168.178.1"]}')" "d['result'][1]['ntp']==False and d['result'][1]['servers']==['fritz.box','192.168.178.1'] and d['result'][1]['timezone']=='Europe/Berlin'"
	t "time: unknown zone rejected" "$(rpc $SID shareos.time set '{"timezone":"Mars/Base"}')" "'time zone' in d['result'][1]['error']"
	t "time: implausible manual time rejected" "$(rpc $SID shareos.time set_clock '{"time":1000}')" "'invalid time' in d['result'][1]['error']"
	# messages that can be closed for good
	chroot "$R" /bin/sh -c 'mkdir -p /overlay /tmp/shareos-storage /tmp/shareos-net; echo "ok 0.1.0" > /overlay/upgrade-result; printf "state=error\nerror=test\n" > /tmp/shareos-storage/job; echo rolledback > /tmp/shareos-net/result'
	t "last update shown" "$(rpc $SID shareos.update status)" "d['result'][1]['last_upgrade']=='ok 0.1.0'"
	t "last update message can be closed" "$(rpc $SID shareos.update ack)" "'last_upgrade' not in d['result'][1]"
	t "failed storage job shown" "$(rpc $SID shareos.storage status)" "d['result'][1]['job']['state']=='error'"
	t "storage job message can be closed" "$(rpc $SID shareos.storage job_clear >/dev/null; rpc $SID shareos.storage status)" "d['result'][1]['job'] is None"
	t "network rollback message can be closed" "$(rpc $SID shareos.net dismiss >/dev/null; rpc $SID shareos.net get)" "d['result'][1]['result'] is None"
	# firmware file in D-Link format (.bin): upload over HTTP, info, write refused off the box
	BIN=$(ls -t "$OUT"/images/ShareOS-*.bin | head -1)
	t "bin: info without upload" "$(rpc $SID shareos.update bin_info)" "'no uploaded' in d['result'][1]['error']"
	U=$(rpc $SID shareos.update bin_ticket | python3 -c "import json,sys;print(json.load(sys.stdin)['result'][1]['url'])")
	t "bin: upload through the ticket" "$(curl -s -o /dev/null -w '{"c":%{http_code}}' --data-binary @"$BIN" -H 'Content-Type: application/octet-stream' "http://127.0.0.1:$PORT$U")" "d['c']==200"
	t "bin: ShareOS .bin recognised" "$(rpc $SID shareos.update bin_info)" "d['result'][1]['kind']=='shareos' and d['result'][1]['kernel'].startswith('ShareOS-')"
	t "bin: write needs confirm" "$(rpc $SID shareos.update bin_write)" "'confirm' in d['result'][1]['error']"
	t "bin: write refused on a box of unknown model" "$(rpc $SID shareos.update bin_write '{"confirm":true}')" "'not supported' in d['result'][1]['error']"
	t "bin: upload removed after the attempt" "$(rpc $SID shareos.update bin_info)" "'no uploaded' in d['result'][1]['error']"
	# update package (.sysupgrade.tar, ~16 MB) without internet: upload over
	# HTTPS (uhttpd answered 413 when the body ended on a full read buffer,
	# which TLS records make likely – patches/uhttpd/0004)
	TAR=$(ls -t "$OUT"/images/ShareOS-*-DNS-320L-rev-Ax.sysupgrade.tar | head -1)
	for i in 1 2; do
		U=$(rpc $SID shareos.update local_ticket | python3 -c "import json,sys;print(json.load(sys.stdin)['result'][1]['url'])")
		t "tar: upload of the full package over HTTPS ($i)" "$(curl -sk -o /dev/null -w '{"c":%{http_code}}' -H 'Expect:' --data-binary @"$TAR" -H 'Content-Type: application/octet-stream' "https://127.0.0.1:$((PORT+363))$U")" "d['c']==200"
		t "tar: uploaded file complete ($i)" "{\"n\":$(stat -c %s "$R/tmp/shareos-fw/upload.tar" 2>/dev/null || echo 0)}" "d['n']==$(stat -c %s "$TAR")"
	done
	rm -f "$R/tmp/shareos-fw/upload.tar"
	t "a header larger than the buffer still gets 413" "$(curl -sk -o /dev/null -w '{"c":%{http_code}}' -H "X-Long: $(head -c 5000 /dev/zero | tr '\0' a)" "https://127.0.0.1:$((PORT+363))/")" "d['c']==413"
	st() { curl -s -w '\n%{http_code}' "http://127.0.0.1:$PORT/cgi-bin/status$1" | python3 -c "import json,sys; b,c=sys.stdin.read().rsplit('\n',1); print(json.dumps({'c':int(c),'b':json.loads(b) if b.strip() else None}))"; }
	t "widget status off by default" "$(st '?token=0123456789abcdef0123456789abcdef')" "d['c']==404"
	W=$(rpc $SID shareos.widget set '{"enabled":true}')
	t "widget status switched on, token created" "$W" "d['result'][1]['enabled'] and len(d['result'][1]['token'])==32"
	TOK=$(printf '%s' "$W" | python3 -c "import json,sys;print(json.load(sys.stdin)['result'][1]['token'])")
	t "widget status: wrong token denied" "$(st '?token=0123456789abcdef0123456789abcdef')" "d['c']==403 and d['b']['error']=='denied'"
	t "widget status: no token denied" "$(st '')" "d['c']==403"
	t "widget status: right token answers" "$(st "?token=$TOK")" "d['c']==200 and d['b']['host'] and 'ok' in d['b'] and type(d['b']['volumes'])==list"
	t "widget status: bearer header works" "$(curl -s -o /dev/null -w '{"c":%{http_code}}' -H "Authorization: Bearer $TOK" http://127.0.0.1:$PORT/cgi-bin/status)" "d['c']==200"
	t "widget status: not callable anonymously over /ubus" "$(rpc $ZERO shareos.widget status "{\"token\":\"$TOK\"}")" "d['error']['code']==-32002"
	t "widget: new token replaces the old one" "$(rpc $SID shareos.widget set '{"renew":true}' | python3 -c "import json,sys; t=json.load(sys.stdin)['result'][1]['token']; print(json.dumps({'new':t!='$TOK'}))")" "d['new']"
	t "widget status: old token denied after renew" "$(st "?token=$TOK")" "d['c']==403"
	t "app manifest served as JSON" "$(curl -s -o /dev/null -w '{"c":%{http_code},"t":"%{content_type}"}' http://127.0.0.1:$PORT/manifest.json)" "d['c']==200 and d['t'].startswith('application/json')"
	t "service worker and icons served" "$(curl -s -o /dev/null -w '{"s":%{http_code},' http://127.0.0.1:$PORT/sw.js; curl -s -o /dev/null -w '"i":%{http_code}}' http://127.0.0.1:$PORT/icon-512.png)" "d['s']==200 and d['i']==200"
	sed 's|^\thost=$(cat /proc/sys/kernel/hostname)|\thost=old-name|' "$R/usr/sbin/shareos-cert" > "$R/tmp/cert-old"
	chroot "$R" /bin/sh /tmp/cert-old selfsigned >/dev/null 2>&1
	t "self-signed certificate renewed after a name change" "$(chroot "$R" /usr/sbin/shareos-cert ensure | python3 -c 'import json,sys; print(json.dumps({"o":sys.stdin.read()}))')" "'renewed' in d['o']"
	t "renewed certificate names this box and its IP" "$(chroot "$R" /usr/sbin/shareos-cert info | python3 -c 'import json,sys; print(json.dumps({"l":sys.stdin.read().split()}))')" "any(x.startswith('san=iPAddress:') for x in d['l']) and 'san=dNSName:old-name' not in d['l']"
	t "a current certificate is left alone" "$(chroot "$R" /usr/sbin/shareos-cert ensure | python3 -c 'import json,sys; print(json.dumps({"o":sys.stdin.read()}))')" "d['o']==''"
	chroot "$R" /etc/init.d/S50avahi-daemon start >/dev/null 2>&1; sleep 3
	t "mDNS: <hostname>.local answers with the box address" "$(python3 "$TOP/tests/mdns-query.py" "$(cat /proc/sys/kernel/hostname).local" | python3 -c 'import json,sys; print(json.dumps({"ip":sys.stdin.read().strip()}))')" "d['ip'].count('.')==3"
	t "mDNS: avahi user exists after an upgrade (overlay passwd)" "$(grep -c '^avahi:' "$R/etc/passwd" | python3 -c 'import json,sys; print(json.dumps({"n":int(sys.stdin.read())}))')" "d['n']==1"
	# terminal over HTTPS: HTTP/1.1 only (h2 has no Host header – ttyd's origin check refused the WebSocket)
	TM=$(rpc $SID shareos.system terminal '{"tls":true}')
	TP=$(printf '%s' "$TM" | python3 -c "import json,sys; r=json.load(sys.stdin)['result'][1]; print(r['port'], r['path'])")
	set -- $TP
	t "terminal over HTTPS speaks HTTP/1.1 (no h2)" "$(curl -sk --http2 -o /dev/null -w '{"v":"%{http_version}","c":%{http_code}}' --max-time 20 https://127.0.0.1:$1/$2/)" "d['v']=='1.1' and d['c']==200"
	t "terminal refuses a WebSocket from another origin" "$(curl -sk --http1.1 -o /dev/null -w '{"c":"%{http_code}"}' --max-time 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: tty' -H 'Origin: https://evil.example' https://127.0.0.1:$1/$2/ws)" "d['c']!='101'"
	t "terminal WebSocket accepted from its own origin" "$(curl -sk --http1.1 -o /dev/null -w '{"c":"%{http_code}"}' --max-time 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: tty' -H "Origin: https://127.0.0.1:$1" https://127.0.0.1:$1/$2/ws)" "d['c']=='101'"
	chroot "$R" /usr/sbin/shareos-terminal stop
	t "GUI assets served" "$(curl -s -o /dev/null -w '{"a":%{http_code},' http://127.0.0.1:$PORT/app.js; curl -s -o /dev/null -w '"c":%{http_code}}' http://127.0.0.1:$PORT/shareos.css)" "d['a']==200 and d['c']==200"
	echo; [ $fails -eq 0 ] && echo "all checks passed" || { echo "$fails check(s) failed"; exit 1; }
	exit 0
fi

echo
echo "ShareOS stack running: http://127.0.0.1:$PORT/  (root / shareos)"
echo "Press Ctrl-C to stop."
while :; do sleep 3600 & wait $!; done
