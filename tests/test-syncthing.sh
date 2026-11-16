#!/bin/bash
#
# Tests Syncthing per account: shareos-syncthing (one Syncthing per account,
# with its rights), the proxy /_shareos/cgi/syncthing of the apps web server
# and the rpcd object shareos.appsyncthing – with the built ARM userland
# (qemu-user) in a chroot and the system app syncthing. Two accounts of the
# box pair their Syncthings over 127.0.0.1 and sync a folder (no internet
# needed).
#
#   sudo tests/test-syncthing.sh [output/dns320l] [syncthing.sapp]
#
# Needs the system app (make sysapps-pack).
#
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/syncthing-*.sapp 2>/dev/null | head -1)}
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
[ -f "$SAPP" ] || { echo "no syncthing .sapp – make sysapps-pack"; exit 1; }
PORT=${SHAREOS_TEST_ST_PORT:-18093}

T=$(mktemp -d /tmp/shareos-st-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-syncthing stop-all; /etc/init.d/S51apps stop; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
hostname testbox

run() { chroot "$R" /usr/bin/env SHAREOS_APPS_ALLOW_FILE=1 /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci commit storage; uci set apps.store.port=$PORT; uci set apps.store.https_port=$((PORT+1)); uci set shareos.web.https=0; uci commit apps; uci commit shareos" >/dev/null
run "echo anna1234 | shareos-users add anna user --home=daten --web=1 --files=1; echo bernd123 | shareos-users add bernd user --home=daten --web=1 --files=1" >/dev/null

# --- before the system app ------------------------------------------------------------
o=$(run "shareos-syncthing start anna")
check "not installed: start says so" "echo '$o' | js \"'not installed' in d['error']\""

cp "$SAPP" "$R/tmp/st.sapp"
o=$(run "umask 077; shareos-apps install-file /tmp/st.sapp")
check "system app syncthing installs" "echo '$o' | js \"d.get('id')=='syncthing'\""
check "starter in /opt/shareos/bin" "[ -x $R/opt/shareos/bin/syncthing ]"

# a web app with "files" + "syncthing", one with "files" only
mkapp() {   # id perms
	mkdir -p $T/$1/files
	echo '<!doctype html><title>ok</title>' > $T/$1/files/index.html
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/$1/files/icon.svg
	python3 -c "import json; json.dump({'id':'$1','name':'$1','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':$2}, open('$T/$1/app.json','w'))"
	(cd $T/$1 && tar -czf $R/tmp/$1.sapp app.json -C files .)
	run "shareos-apps install-file /tmp/$1.sapp"
}
mkapp sclient '["files","syncthing"]' >/dev/null
mkapp fileonly '["files"]' >/dev/null
check "syncthing without files is refused" "mkapp bad '[\"syncthing\"]' | grep -q 'syncthing.*needs'"
run "uci set apps.sclient.users='*'; uci set apps.fileonly.users='*'; uci commit apps" >/dev/null 2>&1

run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start && /etc/init.d/S51apps start' >/dev/null
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/" || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done

# grants like the admin interface hands out (account, app, expiry)
grant() { local t; t=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); mkdir -p $R/tmp/shareos-appgrants; printf '%s\n%s\n%d\n' "$1" "$2" $(( $(date +%s) + 3600 )) > $R/tmp/shareos-appgrants/$t; echo $t; }
GA=$(grant anna sclient); GB=$(grant bernd sclient); GF=$(grant anna fileonly); GR=$(grant root sclient)
st() { curl -s -m 180 -X POST -d "$2" "http://127.0.0.1:$PORT/_shareos/cgi/syncthing?g=$1"; }
code() { curl -s -m 180 -o /dev/null -w '%{http_code}' -X POST -d "$2" "http://127.0.0.1:$PORT/_shareos/cgi/syncthing?g=$1"; }
get() { st $1 "{\"method\":\"GET\",\"path\":\"$2\"${3:+,\"query\":$3}}"; }

check "no grant: 403" "[ \$(code 0123456789abcdef0123456789abcdef '{\"method\":\"GET\",\"path\":\"/rest/system/status\"}') = 403 ]"
check "app without syncthing permission: 403" "[ \$(code $GF '{\"method\":\"GET\",\"path\":\"/rest/system/status\"}') = 403 ]"
o=$(get $GA /rest/system/status)
check "first call starts anna's Syncthing, its status answers" "echo '$o' | js \"d['status']==200 and len(d['data']['myID'])>50\""
IDA=$(echo "$o" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['myID'])")
check "anna's Syncthing runs as anna, nice 10, one process" "[ \"\$(run 'stat -c %U /proc/\$(cat /tmp/shareos-syncthing/anna/pid)')\" = anna ] && [ \"\$(run 'cut -d\" \" -f19 /proc/\$(cat /tmp/shareos-syncthing/anna/pid)/stat')\" = 10 ] && [ \"\$(run \"pgrep -f '[/]bin/syncthing serve'\" | wc -l)\" = 1 ]"
check "keys and database in anna's home, not in the flash" "[ -f $R/mnt/daten/home/anna/.config/syncthing/config.xml ] && [ \"\$(run 'stat -c %U /mnt/daten/home/anna/.config/syncthing/cert.pem')\" = anna ]"
check "REST API only on a Unix socket (no TCP port 8384), key not readable for others" "[ -S $R/tmp/shareos-syncthing/anna/api.sock ] && ! (exec 3<>/dev/tcp/127.0.0.1/8384) 2>/dev/null && [ \"\$(stat -c %a $R/tmp/shareos-syncthing/anna)\" = 700 ]"
UA=$(run "id -u anna"); UB=$(run "id -u bernd"); PA=$((22000 + UA - 999)); PB=$((22000 + UB - 999))
o=$(get $GA /rest/config/options)
check "no usage or crash reports, no updates, its own sync port" "echo '$o' | js \"d['data']['urAccepted']==-1 and not d['data']['crashReportingEnabled'] and d['data']['autoUpgradeIntervalH']==0 and 'tcp://:$PA' in d['data']['listenAddresses']\""
o=$(get $GA /rest/config/devices/$IDA)
check "own device named after the box and the account" "echo '$o' | js \"d['data']['name']=='testbox (anna)'\""
o=$(get $GA /rest/config/defaults/folder)
check "new folders start in the personal folder (shown as root name)" "echo '$o' | js \"d['data']['path']=='home' and d['data']['fsWatcherEnabled']\""
o=$(st $GA '{"method":"GET","path":"/qr","query":{"text":"'$IDA'"}}')
check "QR code of the device ID" "echo '$o' | js \"d['data'].startswith('data:image/png;base64,')\""

o=$(get $GB /rest/system/status)
IDB=$(echo "$o" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['myID'])")
check "bernd has his own Syncthing with another ID" "[ -n '$IDB' ] && [ '$IDB' != '$IDA' ] && [ -f $R/tmp/shareos-syncthing/bernd/pid ]"

# --- what is refused -----------------------------------------------------------------
run "mkdir -p /mnt/daten/home/anna/Sync /mnt/daten/home/bernd/Sync; chown anna /mnt/daten/home/anna/Sync; chown bernd /mnt/daten/home/bernd/Sync" >/dev/null
f() { echo "{\"method\":\"POST\",\"path\":\"/rest/config/folders\",\"body\":{\"id\":\"x1\",\"path\":\"$1\"${2:-}}}"; }
check "folder in /etc refused" "[ \$(code $GA \"\$(f /etc)\") = 403 ]"
check "absolute path refused (also her own)" "[ \$(code $GA \"\$(f /mnt/daten/home/anna/Sync)\") = 403 ]"
check "../ out of her folder refused" "[ \$(code $GA \"\$(f home/../bernd)\") = 403 ]"
check "versions in another place or by a program refused" "[ \$(code $GA \"\$(f home/Sync ',\"versioning\":{\"type\":\"external\",\"params\":{\"command\":\"/bin/sh\"}}')\") = 403 ] && [ \$(code $GA \"\$(f home/Sync ',\"versioning\":{\"type\":\"simple\",\"fsPath\":\"/etc\"}')\") = 403 ]"
check "other file systems refused" "[ \$(code $GA \"\$(f home/Sync ',\"filesystemType\":\"fake\"')\") = 403 ]"
check "GUI, listen addresses, whole config, shutdown refused" "[ \$(code $GA '{\"method\":\"PATCH\",\"path\":\"/rest/config/options\",\"body\":{\"listenAddresses\":[\"tcp://:1\"]}}') = 403 ] && [ \$(code $GA '{\"method\":\"PATCH\",\"path\":\"/rest/config/gui\",\"body\":{\"address\":\"0.0.0.0:8384\"}}') = 403 ] && [ \$(code $GA '{\"method\":\"GET\",\"path\":\"/rest/config\"}') = 403 ] && [ \$(code $GA '{\"method\":\"POST\",\"path\":\"/rest/system/shutdown\"}') = 403 ]"
check "query values checked" "[ \$(code $GA '{\"method\":\"GET\",\"path\":\"/rest/db/status\",\"query\":{\"folder\":\"a&b=c\"}}') = 400 ]"
o=$(st $GA '{"method":"PATCH","path":"/rest/config/options","body":{"maxRecvKbps":500}}')
check "allowed options pass (bandwidth)" "get $GA /rest/config/options | js \"d['data']['maxRecvKbps']==500\""

# --- anna and bernd pair and sync a folder ---------------------------------------------
st $GA "{\"method\":\"POST\",\"path\":\"/rest/config/devices\",\"body\":{\"deviceID\":\"$IDB\",\"name\":\"Bernd\",\"addresses\":[\"tcp://127.0.0.1:$PB\"]}}" >/dev/null
st $GB "{\"method\":\"POST\",\"path\":\"/rest/config/devices\",\"body\":{\"deviceID\":\"$IDA\",\"name\":\"Anna\",\"addresses\":[\"tcp://127.0.0.1:$PA\"]}}" >/dev/null
o=$(st $GA "{\"method\":\"POST\",\"path\":\"/rest/config/folders\",\"body\":{\"id\":\"docs-1\",\"label\":\"Docs\",\"path\":\"home/Sync\",\"devices\":[{\"deviceID\":\"$IDB\"}]}}")
check "anna shares home/Sync with bernd" "echo '$o' | js \"d['status']==200\" && get $GA /rest/config/folders | js \"[(x['id'],x['path']) for x in d['data']]==[('docs-1','home/Sync')]\""
check "Syncthing got the absolute path inside her folder" "grep -q 'path=\"/mnt/daten/home/anna/Sync\"' $R/mnt/daten/home/anna/.config/syncthing/config.xml"
for i in $(seq 90); do get $GB /rest/cluster/pending/folders | js "'docs-1' in d['data']" && break; sleep 2; done
check "bernd is asked about anna's folder" "get $GB /rest/cluster/pending/folders | js \"'docs-1' in d['data'] and '$IDA' in d['data']['docs-1']['offeredBy']\""
o=$(st $GB "{\"method\":\"POST\",\"path\":\"/rest/config/folders\",\"body\":{\"id\":\"docs-1\",\"label\":\"Docs\",\"path\":\"home/Sync\",\"devices\":[{\"deviceID\":\"$IDA\"}]}}")
check "bernd accepts it into his home/Sync" "echo '$o' | js \"d['status']==200\""
run "su -s /bin/sh anna -c 'echo hallo > /mnt/daten/home/anna/Sync/notiz.txt'" >/dev/null
st $GA '{"method":"POST","path":"/rest/db/scan","query":{"folder":"docs-1"}}' >/dev/null
for i in $(seq 90); do [ -f $R/mnt/daten/home/bernd/Sync/notiz.txt ] && break; sleep 2; done
check "anna's file arrives in bernd's folder, owned by bernd" "[ \"\$(cat $R/mnt/daten/home/bernd/Sync/notiz.txt 2>/dev/null)\" = hallo ] && [ \"\$(stat -c %u $R/mnt/daten/home/bernd/Sync/notiz.txt)\" = $UB ]"
# the file is there before anna's side has heard that bernd is complete
for i in $(seq 30); do
	o=$(get $GA /rest/db/completion "{\"folder\":\"docs-1\",\"device\":\"$IDB\"}")
	echo "$o" | js "d['data']['completion']==100" && break; sleep 2
done
check "status: folder complete on bernd's side" "echo '$o' | js \"d['data']['completion']==100\""
check "rpcd object not reachable for web sessions" "! grep -q appsyncthing $R/usr/share/rpcd/acl.d/shareos.json"

p1=$(cat $R/tmp/shareos-syncthing/anna/pid)
o=$(st $GA '{"method":"POST","path":"/rest/system/restart"}')
check "restart through the box: new process, still answers" "echo '$o' | js \"d['data']['ok']\" && [ \"\$(cat $R/tmp/shareos-syncthing/anna/pid)\" != $p1 ] && get $GA /rest/system/status | js \"d['data']['myID']=='$IDA'\""

o=$(get $GR /rest/system/status)
check "admin: own Syncthing as root, state on the volume" "echo '$o' | js \"d['status']==200\" && [ \"\$(run 'stat -c %U /proc/\$(cat /tmp/shareos-syncthing/root/pid)')\" = root ] && [ -f $R/mnt/daten/.shareos/syncthing/root/config.xml ]"

check "accounts remembered for the next start" "[ -f $R/etc/shareos/syncthing/anna ] && [ -f $R/etc/shareos/syncthing/bernd ]"
run "shareos-syncthing stop-all" >/dev/null
check "stop-all ends them" "! run \"pgrep -f '[/]bin/syncthing serve'\" | grep -q ."
o=$(run "shareos-syncthing boot")
check "boot starts them again, devices and folders kept" "echo '$o' | js \"sorted(d['started'])==['anna','bernd','root']\" && get $GA /rest/config/folders | js \"[x['id'] for x in d['data']]==['docs-1']\""
run "shareos-apps remove syncthing" >/dev/null
check "removing the system app stops them" "! run \"pgrep -f '[/]bin/syncthing serve'\" | grep -q . && [ ! -e $R/opt/shareos/bin/syncthing ]"
check "synced files and state stay on the drive" "[ -f $R/mnt/daten/home/anna/.config/syncthing/config.xml ] && [ -f $R/mnt/daten/home/bernd/Sync/notiz.txt ]"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
