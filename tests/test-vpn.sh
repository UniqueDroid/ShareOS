#!/bin/bash
#
# Tests the VPN client and the status chips: system app openvpn, shareos-vpn,
# rpcd shareos.appvpn / appstatus / status – built ARM userland (qemu-user) in a
# chroot, in its own network name space (a test server on 127.0.0.1).
#
#   sudo tests/test-vpn.sh [output/dns320l] [openvpn.sapp]   (make sysapps-pack)
#
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts --net env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/openvpn-*.sapp 2>/dev/null | head -1)}
[ -f "$SAPP" ] || { echo "no openvpn .sapp – make sysapps-pack"; exit 1; }
command -v openssl >/dev/null || { echo "needs openssl on the host"; exit 1; }

T=$(mktemp -d /tmp/shareos-vpn-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-vpn disconnect; [ -f /tmp/srv/pid ] && kill $(cat /tmp/srv/pid); /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
	for m in $(grep " $R/" /proc/mounts | awk '{print $2}' | sort -r); do umount -l "$m" 2>/dev/null; done
	if grep -q " $R/" /proc/mounts; then echo "still mounted below $R – not removed" >&2; else rm -rf "$T"; fi
}
trap cleanup EXIT

if [ ! -e /proc/sys/fs/binfmt_misc/qemu-arm ]; then
	[ -e /proc/sys/fs/binfmt_misc/register ] || mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
	echo ":qemu-arm:M::\x7fELF\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x28\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:$QEMU:F" \
		> /proc/sys/fs/binfmt_misc/register
fi

"$UNSQ" -q -d "$R" "$SQFS" >/dev/null
mount -t proc proc "$R/proc"
mount --bind /dev "$R/dev"
mount -t tmpfs tmpfs "$R/tmp"
mkdir -p "$R/var/run/ubus" "$R/var/log" "$R/mnt/daten"
mount -t tmpfs tmpfs "$R/mnt/daten"

run() { chroot "$R" /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

run "ip link set lo up" >/dev/null
run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci commit storage" >/dev/null
run "echo anna1234 | shareos-users add anna user --home=daten --web=1 --files=1" >/dev/null

# certificates for a test server and a client (EC, quick)
K=$T/pki; mkdir -p $K
( cd $K
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key 2>/dev/null
  openssl req -x509 -new -key ca.key -days 2 -subj /CN=testca -out ca.crt 2>/dev/null
  for n in server client; do
    openssl ecparam -name prime256v1 -genkey -noout -out $n.key 2>/dev/null
    openssl req -new -key $n.key -subj /CN=$n -out $n.csr 2>/dev/null
    printf 'extendedKeyUsage=%s\n' $([ $n = server ] && echo serverAuth || echo clientAuth) > $n.ext
    openssl x509 -req -in $n.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile $n.ext -out $n.crt 2>/dev/null
  done )
mkdir -p $R/tmp/srv; cp $K/ca.crt $K/server.crt $K/server.key $R/tmp/srv/
profile() {   # extra lines
	printf 'client\ndev tun\nproto udp\nremote 127.0.0.1 11194\nnobind\nverb 3\n%s\n<ca>\n%s\n</ca>\n<cert>\n%s\n</cert>\n<key>\n%s\n</key>\n' "$1" "$(cat $K/ca.crt)" "$(cat $K/client.crt)" "$(cat $K/client.key)"
}
mkapp() {   # id perms
	mkdir -p $T/$1/files
	echo '<!doctype html><title>ok</title>' > $T/$1/files/index.html
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/$1/files/icon.svg
	python3 -c "import json; json.dump({'id':'$1','name':'$1','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':$2}, open('$T/$1/app.json','w'))"
	(cd $T/$1 && tar -czf $R/tmp/$1.sapp app.json -C files .)
	run "shareos-apps install-file /tmp/$1.sapp"
}
check "vpn without files is refused" "mkapp nofiles '[\"vpn\"]' | grep -q 'vpn.*needs'"
mkapp nettunnel '["files","vpn","status"]' >/dev/null
run "uci set apps.nettunnel=app 2>/dev/null; true" >/dev/null
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.appvpn' | grep -q appvpn || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done
grant() { local t; t=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); mkdir -p $R/tmp/shareos-appgrants; printf '%s\n%s\n%d\n' "$1" "$2" $(( $(date +%s) + 3600 )) > $R/tmp/shareos-appgrants/$t; echo $t; }
GR=$(grant root nettunnel); GA=$(grant anna nettunnel)
v() { local m=$1 a=${2:-'{}'}; a=$(echo "$a" | python3 -c "import json,sys; d=json.load(sys.stdin); d['grant']='$GR'; print(json.dumps(d))"); printf '%s' "$a" > $R/tmp/req.json; run "ubus call shareos.appvpn $m \"\$(cat /tmp/req.json)\""; }
imp() { python3 -c "import json,sys; print(json.dumps({'name':sys.argv[1],'text':open(sys.argv[2]).read(),'full':False}))" "$1" "$2"; }

check "user account: no access" "run \"ubus call shareos.appvpn list '{\\\"grant\\\":\\\"$GA\\\"}'\" | js \"d.get('error')=='no access'\""
check "admin: list (not installed, nothing yet)" "v list | js \"d['profiles']==[] and not d['status']['installed']\""
profile 'up /bin/evil.sh
script-security 2
plugin /tmp/x.so
management 127.0.0.1 7505
<script-thing>
rm -rf /
</script-thing>
redirect-gateway def1' > $T/test.ovpn
o=$(v import "$(imp Test $T/test.ovpn)")
check "import: scripts, plugins, management and unknown blocks removed" "echo '$o' | js \"d.get('ok') and set(d['removed'])>={'up','script-security','plugin','management','<script-thing>'} and d['remote']=='127.0.0.1:11194'\""
check "stored profile has none of them, root only" "! grep -qE '^(up|plugin|script-security|management)|rm -rf' $R/etc/shareos/vpn/Test.ovpn && [ \$(stat -c %a $R/etc/shareos/vpn) = 700 ] && [ \$(stat -c %a $R/etc/shareos/vpn/Test.ovpn) = 600 ]"
profile 'mode server' > $T/srv.ovpn
check "server profile refused" "v import \"\$(imp S $T/srv.ovpn)\" | js \"'server profiles' in d.get('error','')\""
printf 'client\nremote 1.2.3.4\nca /etc/ssl/ca.crt\n' > $T/file.ovpn
check "file references refused (inline only)" "v import \"\$(imp F $T/file.ovpn)\" | js \"'must be inside' in d.get('error','')\""
printf 'client\nremote 1.2.3.4\nauth-user-pass\n<ca>\nx\n</ca>\n' > $T/auth.ovpn
check "auth-user-pass: profile needs credentials" "v import \"\$(imp Auth $T/auth.ovpn)\" | js \"d['needs_auth']\" && v connect '{\"name\":\"Auth\"}' | js \"'user name and password' in d.get('error','') or 'not installed' in d.get('error','')\""
check "connect without the system app: clear error" "v connect '{\"name\":\"Test\"}' | js \"'not installed' in d.get('error','')\""
cp "$SAPP" $R/tmp/ovpn.sapp
check "system app openvpn installs" "run 'shareos-apps install-file /tmp/ovpn.sapp' | js \"d.get('id')=='openvpn'\" && [ -x $R/opt/shareos/bin/openvpn ]"
# the test server (same OpenVPN, in the chroot, own network name space)
run "/opt/shareos/bin/openvpn --dev tun9 --server 10.99.0.0 255.255.255.0 --topology subnet --proto udp --local 127.0.0.1 --port 11194 --ca /tmp/srv/ca.crt --cert /tmp/srv/server.crt --key /tmp/srv/server.key --dh none --push 'redirect-gateway def1' --daemon --log /tmp/srv/log --writepid /tmp/srv/pid" >/dev/null
sleep 2
check "test server runs" "grep -q 'Initialization Sequence Completed' $R/tmp/srv/log"
o=$(v connect '{"name":"Test"}')
check "connect: starts" "echo '$o' | js \"d['running'] and d['profile']=='Test'\""
i=0; while ! v status | js "d['state']=='CONNECTED'" && [ $i -lt 40 ]; do sleep 1; i=$((i + 1)); done
check "connected: tunnel address from the server" "v status | js \"d['state']=='CONNECTED' and d['ip'].startswith('10.99.0.')\""
check "only the VPN networks (full off): the pushed default route was ignored" "! run 'ip route' | grep -q '^0.0.0.0/1'"
check "tunnel works (ping the server through it)" "run 'ping -c 2 -W 2 10.99.0.1' | grep -q ' 0% packet loss'"
check "OpenVPN runs with script-security 1 (no scripts)" "tr '\\0' ' ' < $R/proc/\$(cat $R/tmp/shareos-vpn/pid)/cmdline | grep -q -- '--script-security 1 '"
check "log readable" "v log | js \"'Initialization Sequence Completed' in d['log']\""
SID=0123456789abcdef0123456789abcdef; mkdir -p $R/tmp/shareos-sessions; echo root > $R/tmp/shareos-sessions/$SID
chips() { run "ubus call shareos.status chips '{\"ubus_rpc_session\":\"$SID\"}'"; }
check "header chip: VPN connected, opens NetTunnel" "chips | js \"[c for c in d['chips'] if c['id']=='svc:vpn'][0]['state']=='ok' and [c for c in d['chips'] if c['id']=='svc:vpn'][0]['app']=='nettunnel'\""
s() { printf '%s' "$2" | python3 -c "import json,sys; d=json.load(sys.stdin); d['grant']='$GR'; print(json.dumps(d))" > $R/tmp/req.json; run "ubus call shareos.appstatus $1 \"\$(cat /tmp/req.json)\""; }
check "app status: too long text refused" "s set '{\"text\":\"0123456789012345678901234\",\"state\":\"ok\"}' | js \"'invalid text' in d.get('error','')\""
check "app status: chip set" "s set '{\"text\":\"3 Profile\",\"state\":\"info\",\"ttl\":10}' | js \"d.get('ok')\" && chips | js \"[c for c in d['chips'] if c['id']=='app:nettunnel'][0]['label']=='3 Profile'\""
check "app status: anna does not see root's chip" "echo anna > $R/tmp/shareos-sessions/$SID && ! chips | grep -q 'app:nettunnel'; echo root > $R/tmp/shareos-sessions/$SID"
sleep 11
check "app status: gone after its time" "! chips | grep -q 'app:nettunnel'"
o=$(v disconnect)
check "disconnect: off, tunnel gone" "echo '$o' | js \"d['state']=='OFF' and not d['running']\" && ! run 'ip link show' | grep -q tun0"
check "settings: full tunnel and autostart" "v set '{\"name\":\"Test\",\"full\":true,\"autostart\":true}' | js \"[p for p in d['profiles'] if p['name']=='Test'][0]['autostart'] and [p for p in d['profiles'] if p['name']=='Test'][0]['full']\""
run 'shareos-vpn boot' >/dev/null
i=0; while ! v status | js "d['state']=='CONNECTED'" && [ $i -lt 40 ]; do sleep 1; i=$((i + 1)); done
check "boot: the autostart profile connects; full tunnel takes the pushed default route" "v status | js \"d['state']=='CONNECTED'\" && run 'ip route' | grep -q '^0.0.0.0/1'"
# --- server: a device connects to the box ---
sv() { v "$1" "${2:-{\}}"; }
check "server: wrong VPN network refused" "sv server_set '{\"net\":\"8.8.8.0\"}' | js \"'invalid VPN network' in d.get('error','')\""
o=$(sv server_set '{"enabled":true,"port":11195,"proto":"udp","net":"10.77.0.0","host":"127.0.0.1","lan":false}')
check "server: switched on, own certificates made" "echo '$o' | js \"d['running'] and d['ready'] and d['port']==11195\" && [ -f $R/etc/shareos/vpn/server/ca.crt ] && [ \$(stat -c %a $R/etc/shareos/vpn/server/ca.key) = 600 ]"
o=$(sv device_add '{"name":"handy"}')
check "server: device added, profile with everything inline" "echo '$o' | js \"d.get('ok') and 'remote 127.0.0.1 11195' in d['profile'] and '<tls-crypt>' in d['profile'] and '<key>' in d['profile'] and 'verify-x509-name' in d['profile']\""
echo "$o" | python3 -c "import json,sys; open(sys.argv[1],'w').write(json.load(sys.stdin)['profile'])" $R/tmp/handy.ovpn
check "server: same device name refused" "sv device_add '{\"name\":\"handy\"}' | js \"'exists' in d.get('error','')\""
check "server: invalid device name refused" "sv device_add '{\"name\":\"../x\"}' | js \"'invalid device name' in d.get('error','')\""
run "/opt/shareos/bin/openvpn --config /tmp/handy.ovpn --daemon --log /tmp/handy.log --writepid /tmp/handy.pid" >/dev/null
i=0; while ! grep -q 'Initialization Sequence Completed' $R/tmp/handy.log 2>/dev/null && [ $i -lt 40 ]; do sleep 1; i=$((i + 1)); done
check "the device connects with the generated profile" "grep -q 'Initialization Sequence Completed' $R/tmp/handy.log"
check "the device reaches the box through the tunnel" "run 'ping -c 2 -W 2 10.77.0.1' | grep -q ' 0% packet loss'"
i=0; while ! sv server_status | js "d['online']==1" && [ $i -lt 40 ]; do sleep 1; i=$((i + 1)); done
check "server status: the device is online with its tunnel address" "sv server_status | js \"[x for x in d['devices'] if x['name']=='handy'][0]['online'] and [x for x in d['devices'] if x['name']=='handy'][0]['ip'].startswith('10.77.0.')\""
sleep 31
check "header chip: VPN server with one device" "chips | js \"[c for c in d['chips'] if c['id']=='svc:vpnserver'][0]['detail']=='1 Gerät'\""
check "server: profile can be fetched again" "sv device_profile '{\"name\":\"handy\"}' | js \"'BEGIN' in d['profile']\""
sv device_remove '{"name":"handy"}' >/dev/null
run "kill \$(cat /tmp/handy.pid)" >/dev/null 2>&1; sleep 1; : > $R/tmp/handy.log
run "/opt/shareos/bin/openvpn --config /tmp/handy.ovpn --daemon --log /tmp/handy.log --writepid /tmp/handy.pid" >/dev/null
sleep 8
check "removed device is locked out" "! grep -q 'Initialization Sequence Completed' $R/tmp/handy.log && sv server_status | js \"d['devices']==[]\""
run "kill \$(cat /tmp/handy.pid)" >/dev/null 2>&1
run "shareos-apps remove openvpn" >/dev/null
check "removing the system app ends the connection and stops the server" "v status | js \"not d['running']\" && ! pgrep -f '[r]un.ovpn' >/dev/null && sv server_status | js \"not d['running']\""
check "remove a profile" "v remove '{\"name\":\"Auth\"}' | js \"[p['name'] for p in d['profiles']]==['Test']\" && [ ! -e $R/etc/shareos/vpn/Auth.ovpn ]"
run "kill \$(cat /tmp/srv/pid)" >/dev/null 2>&1

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
