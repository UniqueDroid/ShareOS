#!/bin/bash
#
# Tests autobrr: system app autobrr with its service, shareos-autobrr (sign-up,
# API key, hand-over folder for Transmission, web interface, password),
# rpcd shareos.appautobrr (admins only, autobrr's API through the key) –
# built ARM userland (qemu-user) in a chroot, in its own network name space.
#
#   sudo tests/test-autobrr.sh [output/dns320l] [autobrr.sapp]   (make sysapps-pack)
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
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/autobrr-*.sapp 2>/dev/null | head -1)}
TRS=$(ls -t "$TOP"/output/sysapps/sapp/transmission-daemon-*.sapp 2>/dev/null | head -1)
[ -f "$SAPP" ] || { echo "no autobrr .sapp – make sysapps-pack"; exit 1; }

T=$(mktemp -d /tmp/shareos-ab-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-autobrr stop-all; /usr/sbin/shareos-transmission stop-all; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
run "mkdir -p /mnt/daten/.shareos; uci set storage.global=global; uci set storage.global.apps=daten; uci commit storage" >/dev/null
cp "$SAPP" $R/tmp/ab.sapp


# --- the system app and its service -------------------------------------------------------
o=$(run "umask 077; shareos-apps install-file /tmp/ab.sapp")
check "autobrr installs (on the apps drive)" "echo '$o' | js \"d.get('id')=='autobrr'\" && [ -L $R/opt/shareos/sysapps/autobrr ]"
check "it is a service: control autobrr, started after installing" "run 'shareos-apps services list' | js \"[(s['control'],s['on_install']) for s in d['services'] if s['id']=='autobrr']==[('autobrr','start')]\""
i=0; until run '/usr/sbin/shareos-autobrr status' | js "d['ready']" || [ $i -ge 240 ]; do sleep 0.5; i=$((i + 1)); done
check "installing starts autobrr, signs it up and makes the API key" "run '/usr/sbin/shareos-autobrr status' | js \"d['running'] and d['ready'] and d['enabled']\""
P=$(cat $R/tmp/shareos-autobrr/pid 2>/dev/null)
check "runs as the user autobrr with a memory limit" "[ \"\$(awk '/^Uid:/{print \$2}' /proc/$P/status)\" = \"\$(grep '^autobrr:' $R/etc/passwd | cut -d: -f3)\" ] && tr '\\0' '\\n' < /proc/$P/environ | grep -q '^GOMEMLIMIT=48MiB'"
check "listens only on 127.0.0.1:7474" "grep -q ' 0100007F:1D32 00000000:0000 0A' /proc/net/tcp && ! grep -q ' 00000000:1D32 00000000:0000 0A' /proc/net/tcp"
check "database on the apps drive (autobrr's, 0700), key and password root only" "[ \"\$(stat -c %a $R/mnt/daten/.shareos/autobrr)\" = 700 ] && [ -f $R/mnt/daten/.shareos/autobrr/autobrr.db ] && [ \"\$(stat -c '%u %a' $R/etc/shareos/autobrr/secret.json)\" = '0 600' ] && [ \"\$(stat -c %a $R/etc/shareos/autobrr)\" = 700 ]"
echo "INFO  memory of autobrr under qemu-user: $(grep VmRSS /proc/$P/status | tr -s ' ')"

# --- for apps: rpcd shareos.appautobrr (permission autobrr, admins) --------------------
mkdir -p $T/x
mkapp() {   # id permissions
	mkdir -p $T/$1/files
	echo '<!doctype html><title>ok</title>' > $T/$1/files/index.html
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/$1/files/icon.svg
	python3 -c "import json; json.dump({'id':'$1','name':'$1','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':$2}, open('$T/$1/app.json','w'))"
	(cd $T/$1 && tar -czf $R/tmp/$1.sapp app.json -C files .)
	run "shareos-apps install-file /tmp/$1.sapp"
}
check "autobrr without files is refused" "mkapp nofiles '[\"autobrr\"]' | grep -q 'autobrr.*needs'"
mkapp abui '["files","autobrr"]' >/dev/null
mkapp other '["files"]' >/dev/null
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.appautobrr' | grep -q appautobrr || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done
grant() { local t; t=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); mkdir -p $R/tmp/shareos-appgrants; printf '%s\n%s\n%d\n' "$1" "$2" $(( $(date +%s) + 3600 )) > $R/tmp/shareos-appgrants/$t; echo $t; }
GR=$(grant root abui); GA=$(grant anna abui); GO=$(grant root other)
a() { local m=$1 x=${2:-'{}'}; x=$(echo "$x" | python3 -c "import json,sys; d=json.load(sys.stdin); d['grant']='$GR'; print(json.dumps(d))"); printf '%s' "$x" > $R/tmp/req.json; run "ubus -t 60 call shareos.appautobrr $m \"\$(cat /tmp/req.json)\""; }
check "user account: no access" "run \"ubus call shareos.appautobrr status '{\\\"grant\\\":\\\"$GA\\\"}'\" | js \"d.get('error')=='no access'\""
check "app without the permission: no access" "run \"ubus call shareos.appautobrr status '{\\\"grant\\\":\\\"$GO\\\"}'\" | js \"d.get('error')=='no access'\""
check "status for the admin app" "a status | js \"d['ready'] and d['port']==7474 and d['user']=='admin' and d['drive']\""
check "api: autobrr's config with the key of ShareOS" "a api '{\"method\":\"GET\",\"path\":\"/api/config\"}' | js \"d['status']==200 and d['data']['version']=='1.84.0'\""
check "api: create a filter and list it" "a api '{\"method\":\"POST\",\"path\":\"/api/filters\",\"body\":{\"name\":\"Test-Filter\",\"enabled\":false,\"resolutions\":[],\"codecs\":[],\"sources\":[],\"containers\":[]}}' | js \"d['status'] in (200,201)\" && a api '{\"method\":\"GET\",\"path\":\"/api/filters\"}' | js \"'Test-Filter' in [f['name'] for f in d['data']]\""
check "api: keys and sign-in stay closed, no other paths" "a api '{\"method\":\"GET\",\"path\":\"/api/keys\"}' | grep -q 'not allowed' && a api '{\"method\":\"GET\",\"path\":\"/api/../etc\"}' | grep -q 'invalid path' && a api '{\"method\":\"GET\",\"path\":\"/x\"}' | grep -q 'invalid path' && a api '{\"method\":\"TRACE\",\"path\":\"/api/config\"}' | grep -q 'invalid method'"
check "accounts for the hand-over" "a accounts | js \"[x['name'] for x in d['accounts']]==['root','anna']\""

# --- hand-over to Transmission ------------------------------------------------------------
check "unknown account refused" "a set '{\"account\":\"nobody\"}' | grep -q 'unknown account'"
o=$(a set '{"account":"anna"}')
D=$R/mnt/daten/.shareos/autobrr-drop
check "hand-over folder: anna's, group autobrr, 2770; anna in the group" "echo '$o' | js \"d['account']=='anna' and d['drop']=='/mnt/daten/.shareos/autobrr-drop'\" && [ \"\$(stat -c '%u %g %a' $D)\" = \"\$(grep '^anna:' $R/etc/passwd | cut -d: -f3) \$(grep '^autobrr:' $R/etc/group | cut -d: -f3) 2770\" ] && grep -q '^autobrr:[^:]*:[0-9]*:.*anna' $R/etc/group"
check "autobrr can write into it, anna can read and delete" "run \"su -s /bin/sh autobrr -c 'umask 007; echo t > /mnt/daten/.shareos/autobrr-drop/x.torrent'\" && run \"su -s /bin/sh anna -c 'cat /mnt/daten/.shareos/autobrr-drop/x.torrent && rm /mnt/daten/.shareos/autobrr-drop/x.torrent'\" | grep -qx t"
if [ -f "$TRS" ]; then
	cp "$TRS" $R/tmp/trs.sapp; run "shareos-apps install-file /tmp/trs.sapp" >/dev/null
	run "/usr/sbin/shareos-transmission start anna" >/dev/null
	check "anna's Transmission watches the hand-over folder" "run 'cat /mnt/daten/home/anna/.shareos/transmission/settings.json 2>/dev/null || cat \$(find /mnt/daten -name settings.json -path \"*anna*\" | head -1)' | js \"d['watch-dir-enabled'] and d['watch-dir']=='/mnt/daten/.shareos/autobrr-drop'\""
	run "uci set autobrr.main.account=root; uci commit autobrr; /usr/sbin/shareos-transmission stop anna; /usr/sbin/shareos-transmission start anna" >/dev/null
	check "other accounts' Transmission does not" "run 'cat \$(find /mnt/daten -name settings.json -path \"*anna*\" | head -1)' | js \"not d['watch-dir-enabled']\""
	run "uci set autobrr.main.account=anna; uci commit autobrr; /usr/sbin/shareos-transmission stop-all" >/dev/null
else
	echo "SKIP  Transmission (no transmission-daemon .sapp)"
fi

# --- autobrr's own web interface, password ------------------------------------------------
check "password: too short refused" "a password '{\"password\":\"kurz\"}' | grep -q '8 to 128'"
check "password for admin set" "a password '{\"password\":\"geheim-12345\"}' | js \"d['ok']\""
check "the new password signs in" "run \"curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{\\\"username\\\":\\\"admin\\\",\\\"password\\\":\\\"geheim-12345\\\"}' http://127.0.0.1:7474/api/auth/login\" | grep -q '^20'"
o=$(a set '{"ui":true}')
check "web interface on: listens on all addresses, API key still works" "echo '$o' | js \"d['ui'] and d['running']\" && grep -q ' 00000000:1D32 00000000:0000 0A' /proc/net/tcp && a api '{\"method\":\"GET\",\"path\":\"/api/filters\"}' | js \"'Test-Filter' in [f['name'] for f in d['data']]\""
check "it serves its web interface" "run 'curl -s http://127.0.0.1:7474/' | grep -qi '<html'"
a set '{"ui":false}' >/dev/null

# --- boot, off, removal ----------------------------------------------------------------------
run "/usr/sbin/shareos-autobrr stop-all" >/dev/null
check "stopped" "a status | js \"not d['running']\""
run "/usr/sbin/shareos-apps services boot" >/dev/null
i=0; until a status | js "d['ready']" || [ $i -ge 240 ]; do sleep 0.5; i=$((i + 1)); done
check "boot (S90services) starts it again, the data stay" "a status | js \"d['ready']\" && a api '{\"method\":\"GET\",\"path\":\"/api/filters\"}' | js \"'Test-Filter' in [f['name'] for f in d['data']]\""
o=$(a set '{"enabled":false}')
check "switched off: it stops and stays off at boot" "echo '$o' | js \"not d['running'] and not d['enabled']\" && run '/usr/sbin/shareos-autobrr boot' | js \"d.get('started')==False\""
a set '{"enabled":true}' >/dev/null
o=$(run "shareos-apps remove autobrr")
check "removing the system app stops it; its database stays for a new install" "a status | js \"not d['installed'] and not d['running']\" && [ -f $R/mnt/daten/.shareos/autobrr/autobrr.db ]"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
