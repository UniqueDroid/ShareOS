#!/bin/bash
#
# Tests Transmission per account: shareos-transmission (one daemon per
# account, with its rights), the proxy /_shareos/cgi/transmission of the apps
# web server and the rpcd object shareos.apptorrent – with the built ARM
# userland (qemu-user) in a chroot and the system app transmission-daemon.
#
#   sudo tests/test-transmission.sh [output/dns320l] [transmission-daemon.sapp]
#
# Needs the system app (make sysapps-pack). Peers are not reached (no
# internet needed): torrents are added from a magnet link and stay without data.
#
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/transmission-daemon-*.sapp 2>/dev/null | head -1)}
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
[ -f "$SAPP" ] || { echo "no transmission-daemon .sapp – make sysapps-pack"; exit 1; }
PORT=${SHAREOS_TEST_TR_PORT:-18091}

T=$(mktemp -d /tmp/shareos-tr-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-transmission stop-all; /etc/init.d/S51apps stop; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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

run() { chroot "$R" /usr/bin/env SHAREOS_APPS_ALLOW_FILE=1 /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci commit storage; uci set apps.store.port=$PORT; uci set apps.store.https_port=$((PORT+1)); uci set shareos.web.https=0; uci commit apps; uci commit shareos" >/dev/null
run "echo anna1234 | shareos-users add anna user --home=daten --web=1 --files=1; echo bernd123 | shareos-users add bernd user --home=daten --web=1 --files=1" >/dev/null

# --- before the system app ------------------------------------------------------------
o=$(run "shareos-transmission start anna")
check "not installed: start says so" "echo '$o' | js \"'not installed' in d['error']\""

cp "$SAPP" "$R/tmp/td.sapp"
# installed the way rpcd does it (umask 077): still usable for every account
o=$(run "umask 077; shareos-apps install-file /tmp/td.sapp")
check "system apps folder readable for every account" "[ \"\$(stat -c %a $R/opt/shareos) \$(stat -c %a $R/opt/shareos/sysapps) \$(stat -c %a $R/opt/shareos/bin)\" = '755 755 755' ]"
run "chmod 700 /opt/shareos" >/dev/null; run "shareos-apps fix-perms" >/dev/null
check "root-only folder of older versions is repaired at boot" "[ \"\$(stat -c %a $R/opt/shareos)\" = 755 ]"
check "system app transmission-daemon installs" "echo '$o' | js \"d.get('id')=='transmission-daemon'\""
check "starter in /opt/shareos/bin" "[ -x $R/opt/shareos/bin/transmission-daemon ]"

# a web app with "files" + "torrent", one with "files" only
mkapp() {   # id perms
	mkdir -p $T/$1/files
	echo '<!doctype html><title>ok</title>' > $T/$1/files/index.html
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/$1/files/icon.svg
	python3 -c "import json; json.dump({'id':'$1','name':'$1','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':$2}, open('$T/$1/app.json','w'))"
	(cd $T/$1 && tar -czf $R/tmp/$1.sapp app.json -C files .)
	run "shareos-apps install-file /tmp/$1.sapp" >/dev/null
}
mkapp tclient '["files","torrent"]'
mkapp fileonly '["files"]'
mkdir -p $T/bad/files; echo x > $T/bad/files/index.html; echo '<svg/>' > $T/bad/files/icon.svg
python3 -c "import json; json.dump({'id':'bad','name':'b','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':['torrent']}, open('$T/bad/app.json','w'))"
(cd $T/bad && tar -czf $R/tmp/bad.sapp app.json -C files .)
check "torrent without files is refused" "run 'shareos-apps install-file /tmp/bad.sapp' | grep -q 'torrent.*needs'"
run "uci set apps.tclient.users='*'; uci set apps.fileonly.users='*'; uci commit apps" >/dev/null 2>&1
run "uci show apps | grep -q users" >/dev/null || true

run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start && /etc/init.d/S51apps start' >/dev/null
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/" || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done

# grants like the admin interface hands out (account, app, expiry)
grant() { local t; t=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); mkdir -p $R/tmp/shareos-appgrants; printf '%s\n%s\n%d\n' "$1" "$2" $(( $(date +%s) + 3600 )) > $R/tmp/shareos-appgrants/$t; echo $t; }
GA=$(grant anna tclient); GB=$(grant bernd tclient); GF=$(grant anna fileonly); GR=$(grant root tclient)
tr() { curl -s -m 120 -X POST -d "$2" "http://127.0.0.1:$PORT/_shareos/cgi/transmission?g=$1"; }
code() { curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST -d "$2" "http://127.0.0.1:$PORT/_shareos/cgi/transmission?g=$1"; }

check "no grant: 403" "[ \$(code 0123456789abcdef0123456789abcdef '{\"method\":\"session-get\"}') = 403 ]"
check "app without torrent permission: 403" "[ \$(code $GF '{\"method\":\"session-get\"}') = 403 ]"
o=$(tr $GA '{"method":"session-get"}')
check "first call starts anna's daemon, session-get works" "echo '$o' | js \"d['result']=='success' and d['arguments']['download-dir']=='home/Downloads'\""
check "internal settings hidden (config dir, RPC socket, scripts)" "echo '$o' | js \"'config-dir' not in d['arguments'] and 'rpc-bind-address' not in d['arguments'] and not any(k.startswith('script-') and k.endswith('filename') for k in d['arguments'])\""
check "anna's daemon runs as anna" "[ \"\$(run 'stat -c %U /proc/\$(cat /tmp/shareos-transmission/anna/pid)')\" = anna ]"
check "state in anna's home, not in the flash" "[ -f $R/mnt/daten/home/anna/.config/transmission-daemon/settings.json ] && [ \"\$(run 'stat -c %U /mnt/daten/home/anna/.config/transmission-daemon/settings.json')\" = anna ]"
check "RPC only on a Unix socket (no TCP port 9091)" "[ -S $R/tmp/shareos-transmission/anna/rpc.sock ] && ! (exec 3<>/dev/tcp/127.0.0.1/9091) 2>/dev/null"

MAG='magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=ShareOS-Test'
o=$(tr $GA "{\"method\":\"torrent-add\",\"arguments\":{\"filename\":\"$MAG\",\"paused\":true}}")
check "anna adds a magnet link" "echo '$o' | js \"d['result']=='success' and d['arguments'].get('torrent-added',{}).get('name')=='ShareOS-Test'\""
o=$(tr $GA '{"method":"torrent-get","arguments":{"fields":["id","name","downloadDir"]}}')
check "anna sees it, folder as home/Downloads" "echo '$o' | js \"[(t['name'],t['downloadDir']) for t in d['arguments']['torrents']]==[('ShareOS-Test','home/Downloads')]\""
o=$(tr $GB '{"method":"torrent-get","arguments":{"fields":["id","name"]}}')
check "bernd has his own daemon and does not see anna's torrents" "echo '$o' | js \"d['arguments']['torrents']==[]\" && [ -f $R/tmp/shareos-transmission/bernd/pid ]"

run "mkdir -p /mnt/daten/home/anna/Filme; chown anna /mnt/daten/home/anna/Filme" >/dev/null
o=$(tr $GA '{"method":"torrent-set-location","arguments":{"ids":[1],"location":"home/Filme","move":false}}')
check "folder of her own as <root>/<path>" "echo '$o' | js \"d['result']=='success'\""
check "her own folder as absolute path too" "[ \$(code $GA '{\"method\":\"session-set\",\"arguments\":{\"download-dir\":\"/mnt/daten/home/anna/Filme\"}}') = 200 ]"
check "bernd's folder refused" "[ \$(code $GA '{\"method\":\"torrent-set-location\",\"arguments\":{\"ids\":[1],\"location\":\"/mnt/daten/home/bernd\"}}') = 403 ]"
check "system folders refused" "[ \$(code $GA '{\"method\":\"session-set\",\"arguments\":{\"download-dir\":\"/etc\"}}') = 403 ]"
check "../ out of her folder refused" "[ \$(code $GA '{\"method\":\"session-set\",\"arguments\":{\"download-dir\":\"home/../bernd\"}}') = 403 ]"
check "torrent-add from a local path refused" "[ \$(code $GA '{\"method\":\"torrent-add\",\"arguments\":{\"filename\":\"/etc/shadow\"}}') = 403 ]"
check "unknown methods refused" "[ \$(code $GA '{\"method\":\"blocklist-update\"}') = 403 ]"
tr $GA '{"method":"session-set","arguments":{"script-torrent-done-enabled":true,"script-torrent-done-filename":"/bin/sh","rpc-bind-address":"0.0.0.0","speed-limit-down":123,"speed-limit-down-enabled":true}}' >/dev/null
o=$(tr $GA '{"method":"session-get"}')
check "session-set: allowed keys pass (speed limit)" "echo '$o' | js \"d['arguments']['speed-limit-down']==123 and d['arguments']['speed-limit-down-enabled']\""
check "rpcd object not reachable for web sessions" "! grep -q apptorrent $R/usr/share/rpcd/acl.d/shareos.json"

o=$(tr $GR '{"method":"session-get"}')
check "admin: own daemon as root, downloads on the volume" "echo '$o' | js \"d['arguments']['download-dir']=='daten/Downloads'\" && [ \"\$(run 'stat -c %U /proc/\$(cat /tmp/shareos-transmission/root/pid)')\" = root ]"

run "shareos-transmission stop anna" >/dev/null
check "scripts and RPC address never reached the daemon" "grep -q '\"script-torrent-done-enabled\": false' $R/mnt/daten/home/anna/.config/transmission-daemon/settings.json && ! grep -q '/bin/sh' $R/mnt/daten/home/anna/.config/transmission-daemon/settings.json && grep -q '\"rpc-bind-address\": \"unix:' $R/mnt/daten/home/anna/.config/transmission-daemon/settings.json"
check "accounts remembered for the next start" "[ -f $R/etc/shareos/transmission/anna ] && [ -f $R/etc/shareos/transmission/bernd ]"
run "shareos-transmission stop-all" >/dev/null
check "stop-all ends the daemons" "! run \"pgrep -f '[/]bin/transmission-daemon '\" | grep -q ."
o=$(run "shareos-transmission boot")
check "boot starts them again, torrents kept" "echo '$o' | js \"sorted(d['started'])==['anna','bernd','root']\" && tr $GA '{\"method\":\"torrent-get\",\"arguments\":{\"fields\":[\"name\"]}}' | js \"[t['name'] for t in d['arguments']['torrents']]==['ShareOS-Test']\""
run "shareos-apps remove transmission-daemon" >/dev/null
check "removing the system app stops the daemons" "! run \"pgrep -f '[/]bin/transmission-daemon '\" | grep -q . && [ ! -e $R/opt/shareos/bin/transmission-daemon ]"
check "downloads and state stay on the drive" "[ -f $R/mnt/daten/home/anna/.config/transmission-daemon/settings.json ]"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
