#!/bin/bash
#
# Tests Tailscale and large system apps on the apps drive: system app
# tailscale, shareos-tailscale, rpcd shareos.apptailscale, the header chip;
# installing/moving/removing system apps with a link to the drive – built ARM
# userland (qemu-user) in a chroot, in its own network name space (no
# internet: the daemon starts and waits for the sign-in).
#
#   sudo tests/test-tailscale.sh [output/dns320l] [tailscale.sapp]   (make sysapps-pack)
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
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/tailscale-*.sapp 2>/dev/null | head -1)}
SMALL=$(ls -t "$TOP"/output/sysapps/sapp/nano-*.sapp 2>/dev/null | head -1)
MID=$(ls -t "$TOP"/output/sysapps/sapp/ffmpeg-*.sapp 2>/dev/null | head -1)
[ -f "$SAPP" ] && [ -f "$SMALL" ] && [ -f "$MID" ] || { echo "no tailscale/nano/ffmpeg .sapp – make sysapps-pack"; exit 1; }

T=$(mktemp -d /tmp/shareos-ts-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-tailscale stop-all; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
cp "$SAPP" $R/tmp/ts.sapp; cp "$SMALL" $R/tmp/small.sapp; cp "$MID" $R/tmp/mid.sapp

# --- system apps: small ones on the flash, large ones on the apps drive ----------------
o=$(run "umask 077; shareos-apps install-file /tmp/mid.sapp")
check "without an apps drive a large system app goes to the flash" "[ -d $R/opt/shareos/sysapps/ffmpeg ] && [ ! -L $R/opt/shareos/sysapps/ffmpeg ]"
run "mkdir -p /mnt/daten/.shareos; uci set storage.global=global; uci set storage.global.apps=daten; uci commit storage" >/dev/null
o=$(run "umask 077; shareos-apps install-file /tmp/small.sapp")
check "small system app (nano) stays on the flash" "[ -d $R/opt/shareos/sysapps/nano ] && [ ! -L $R/opt/shareos/sysapps/nano ]"
o=$(run "umask 077; shareos-apps install-file /tmp/ts.sapp")
check "tailscale installs" "echo '$o' | js \"d.get('id')=='tailscale'\""
check "large system app on the drive, a link in /opt" "[ -L $R/opt/shareos/sysapps/tailscale ] && [ \"\$(readlink $R/opt/shareos/sysapps/tailscale)\" = /mnt/daten/.shareos/sysapps/tailscale ] && [ -x $R/mnt/daten/.shareos/sysapps/tailscale/bin/tailscaled ]"
check "nothing of it left on the flash" "[ -z \"\$(ls -A $R/www-apps | grep '^\.new')\" ] && [ \"\$(du -sk $R/opt/shareos | cut -f1)\" -lt 15000 ]"
check "the command runs through the link" "run 'TS_BE_CLI=1 /opt/shareos/bin/tailscaled version' | grep -q '^1\.'"
o=$(run "shareos-apps fix-perms")
check "boot: a large system app of an older version moves to the drive" "echo '$o' | js \"d['moved']==['ffmpeg']\" && [ -L $R/opt/shareos/sysapps/ffmpeg ] && run '/opt/shareos/bin/ffmpeg -version' | grep -q 'ffmpeg version'"
o=$(run "umask 077; shareos-apps install-file /tmp/ts.sapp")
check "update of a large system app keeps it on the drive" "[ -L $R/opt/shareos/sysapps/tailscale ] && [ -x $R/mnt/daten/.shareos/sysapps/tailscale/bin/tailscaled ] && ! ls -d $R/mnt/daten/.shareos/sysapps/tailscale.old 2>/dev/null"

# --- permission, rpcd --------------------------------------------------------------
mkapp() {   # id perms
	mkdir -p $T/$1/files
	echo '<!doctype html><title>ok</title>' > $T/$1/files/index.html
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/$1/files/icon.svg
	python3 -c "import json; json.dump({'id':'$1','name':'$1','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':$2}, open('$T/$1/app.json','w'))"
	(cd $T/$1 && tar -czf $R/tmp/$1.sapp app.json -C files .)
	run "shareos-apps install-file /tmp/$1.sapp"
}
check "tailscale without files is refused" "mkapp nofiles '[\"tailscale\"]' | grep -q 'tailscale.*needs'"
mkapp tailscaleui '["files","tailscale"]' >/dev/null
mkapp other '["files"]' >/dev/null
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.apptailscale' | grep -q apptailscale || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done
grant() { local t; t=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); mkdir -p $R/tmp/shareos-appgrants; printf '%s\n%s\n%d\n' "$1" "$2" $(( $(date +%s) + 3600 )) > $R/tmp/shareos-appgrants/$t; echo $t; }
GR=$(grant root tailscaleui); GA=$(grant anna tailscaleui); GO=$(grant root other)
t() { local m=$1 a=${2:-'{}'}; a=$(echo "$a" | python3 -c "import json,sys; d=json.load(sys.stdin); d['grant']='$GR'; print(json.dumps(d))"); printf '%s' "$a" > $R/tmp/req.json; run "ubus call shareos.apptailscale $m \"\$(cat /tmp/req.json)\""; }
check "user account: no access" "run \"ubus call shareos.apptailscale status '{\\\"grant\\\":\\\"$GA\\\"}'\" | js \"d.get('error')=='no access'\""
check "app without the permission: no access" "run \"ubus call shareos.apptailscale status '{\\\"grant\\\":\\\"$GO\\\"}'\" | js \"d.get('error')=='no access'\""
check "admin: installed, not running" "t status | js \"d['installed'] and not d['running'] and d['state']=='Stopped'\""
check "invalid auth key refused" "t up '{\"authkey\":\"nope\"}' | grep -q 'invalid auth key'"
o=$(t up)
check "up: the daemon starts and waits for the sign-in" "echo '$o' | js \"d['running'] and d['state'] in ('NeedsLogin','NoState','Starting','Stopped')\" && run 'ip link show tailscale0' | grep -q tailscale0"
check "daemon: own state folder, root only, memory limit" "[ \"\$(stat -c %a $R/etc/shareos/tailscale)\" = 700 ] && tr '\\0' '\\n' < /proc/\$(cat $R/tmp/shareos-tailscale/pid)/environ | grep -q '^GOMEMLIMIT=40MiB'"
SID=0123456789abcdef0123456789abcdef; mkdir -p $R/tmp/shareos-sessions; echo root > $R/tmp/shareos-sessions/$SID
check "header chip: TAILSCALE, not connected yet" "run \"ubus call shareos.status chips '{\\\"ubus_rpc_session\\\":\\\"$SID\\\"}'\" | js \"[c for c in d['chips'] if c['id']=='svc:tailscale'][0]['state']=='warn'\""
check "ping: bad address refused" "t ping '{\"ip\":\"a b\"}' | grep -q 'invalid address'"
check "log readable" "t log | js \"'log' in d\""
check "remembered for the next start" "run 'uci get tailscale.main.enabled' | grep -qx 1"
run "/usr/sbin/shareos-tailscale stop-all" >/dev/null
check "stopped" "t status | js \"not d['running']\""
run "/usr/sbin/shareos-tailscale boot" >/dev/null
check "boot starts it again" "t status | js \"d['running']\""
o=$(run "shareos-apps remove tailscale")
check "removing the system app stops the daemon, link and folder on the drive go" "t status | js \"not d['installed'] and not d['running']\" && [ ! -e $R/opt/shareos/sysapps/tailscale ] && [ ! -L $R/opt/shareos/sysapps/tailscale ] && [ ! -e $R/mnt/daten/.shareos/sysapps/tailscale ] && [ ! -e $R/opt/shareos/bin/tailscaled ]"
o=$(run "shareos-apps remove ffmpeg")
check "removing a moved system app removes its folder on the drive" "[ ! -e $R/mnt/daten/.shareos/sysapps/ffmpeg ] && [ ! -L $R/opt/shareos/sysapps/ffmpeg ]"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
