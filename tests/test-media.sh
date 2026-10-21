#!/bin/bash
#
# Tests media jobs: rpcd shareos.appmedia (probe, start, jobs, cancel),
# /_shareos/cgi/media of the apps web server and the worker shareos-media
# with the system app ffmpeg – built ARM userland (qemu-user) in a chroot.
#
#   sudo tests/test-media.sh [output/dns320l] [ffmpeg.sapp]
#
# Needs the system app (make sysapps-pack). Test audio is made here (WAV).
#
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/ffmpeg-*.sapp 2>/dev/null | head -1)}
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
[ -f "$SAPP" ] || { echo "no ffmpeg .sapp – make sysapps-pack"; exit 1; }
PORT=${SHAREOS_TEST_MEDIA_PORT:-18093}

T=$(mktemp -d /tmp/shareos-media-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-media stop-all; /etc/init.d/S51apps stop; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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

# --- test audio: 3 s and 120 s of a stereo sine (WAV) in anna's folder -----------------
wav() { python3 - "$1" "$2" <<'PY'
import math, struct, sys, wave
f, secs = sys.argv[1], int(sys.argv[2])
w = wave.open(f, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100)
frames = bytearray()
for i in range(44100 * secs):
    v = int(12000 * math.sin(2 * math.pi * 440 * i / 44100))
    frames += struct.pack('<hh', v, v)
w.writeframes(bytes(frames)); w.close()
PY
}
run "mkdir -p /mnt/daten/home/anna/Musik; chown anna /mnt/daten/home/anna/Musik" >/dev/null
wav $R/mnt/daten/home/anna/Musik/ton.wav 3
wav $R/mnt/daten/home/anna/Musik/lang.wav 120
run "chown anna /mnt/daten/home/anna/Musik/*.wav" >/dev/null

mkapp() {   # id perms
	mkdir -p $T/$1/files
	echo '<!doctype html><title>ok</title>' > $T/$1/files/index.html
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/$1/files/icon.svg
	python3 -c "import json; json.dump({'id':'$1','name':'$1','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':$2}, open('$T/$1/app.json','w'))"
	(cd $T/$1 && tar -czf $R/tmp/$1.sapp app.json -C files .)
	run "shareos-apps install-file /tmp/$1.sapp"
}
check "media without files is refused" "mkapp nofiles '[\"media\"]' | grep -q 'media.*needs'"
mkapp mclient '["files","media"]' >/dev/null
mkapp fileonly '["files"]' >/dev/null

run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start && /etc/init.d/S51apps start' >/dev/null
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/" || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done

grant() { local t; t=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); mkdir -p $R/tmp/shareos-appgrants; printf '%s\n%s\n%d\n' "$1" "$2" $(( $(date +%s) + 3600 )) > $R/tmp/shareos-appgrants/$t; echo $t; }
GA=$(grant anna mclient); GB=$(grant bernd mclient); GF=$(grant anna fileonly)
m() { curl -s -m 120 -X POST -d "$2" "http://127.0.0.1:$PORT/_shareos/cgi/media?g=$1"; }
code() { curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST -d "$2" "http://127.0.0.1:$PORT/_shareos/cgi/media?g=$1"; }
TON='{"root":"home","path":"Musik","name":"ton.wav"}'
OUT() { echo "{\"root\":\"home\",\"path\":\"Musik\",\"name\":\"$1\"}"; }
wait_job() {   # grant id -> final job json
	local i=0 o
	while [ $i -lt 240 ]; do
		o=$(m $1 '{"op":"jobs"}')
		echo "$o" | python3 -c "import json,sys; d=json.load(sys.stdin); j=[x for x in d['jobs'] if x['id']=='$2'][0]; sys.exit(0 if j['state'] in ('done','error','cancelled') else 1)" 2>/dev/null && { echo "$o" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps([x for x in d['jobs'] if x['id']=='$2'][0]))"; return; }
		sleep 1; i=$((i + 1))
	done
	echo '{}'
}
start() { m $1 "{\"op\":\"start\",\"input\":$2,$3}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or 'ERR:' + d.get('error',''))"; }

o=$(m $GA "{\"op\":\"probe\",$(echo $TON | sed 's/^{//; s/}$//')}")
check "not installed: probe says so" "echo '$o' | js \"'not installed' in d['error']\""

cp "$SAPP" "$R/tmp/ff.sapp"
check "system app ffmpeg installs (ffmpeg and ffprobe)" "run 'shareos-apps install-file /tmp/ff.sapp' | js \"d.get('id')=='ffmpeg'\" && [ -x $R/opt/shareos/bin/ffmpeg ] && [ -x $R/opt/shareos/bin/ffprobe ]"
check "ffmpeg runs, no network protocols" "run '/opt/shareos/bin/ffmpeg -hide_banner -protocols' | grep -q '^  file' && ! run '/opt/shareos/bin/ffmpeg -hide_banner -protocols' | grep -qw http"

check "no grant: 403" "[ \$(code 0123456789abcdef0123456789abcdef '{\"op\":\"jobs\"}') = 403 ]"
check "app without media permission: 403" "[ \$(code $GF '{\"op\":\"jobs\"}') = 403 ]"
o=$(m $GA "{\"op\":\"probe\",$(echo $TON | sed 's/^{//; s/}$//')}")
check "probe: format, duration, audio stream" "echo '$o' | js \"d['format']=='wav' and 2.9<d['duration']<3.1 and d['streams'][0]['type']=='audio' and d['streams'][0]['codec']=='pcm_s16le' and d['streams'][0]['channels']==2\""
check "probe: not a file of anna's -> refused" "m $GA '{\"op\":\"probe\",\"root\":\"home\",\"path\":\"../bernd\",\"name\":\"x.wav\"}' | js \"'error' in d\""

for f in mp3 m4a opus flac wav; do
	id=$(start $GA "$TON" "\"output\":$(OUT ton-$f),\"action\":\"audio\",\"format\":\"$f\",\"bitrate\":\"128k\"")
	j=$(wait_job $GA $id)
	ext=$f
	check "audio to $f: done, file belongs to anna" "echo '$j' | js \"d.get('state')=='done' and d['output']['name']=='ton-$f.$ext'\" && [ \"\$(run 'stat -c %U /mnt/daten/home/anna/Musik/ton-$f.$ext')\" = anna ]"
done
check "results are real (ffprobe: mp3 codec, 3 s)" "run '/opt/shareos/bin/ffprobe -v error -show_entries stream=codec_name:format=duration -of csv=p=0 /mnt/daten/home/anna/Musik/ton-mp3.mp3' | tr '\n' ' ' | grep -Eq 'mp3 +(2\.9|3\.0)'"
id=$(start $GA "$TON" "\"output\":$(OUT kurz),\"action\":\"audio\",\"format\":\"mp3\",\"start\":\"1\",\"duration\":\"00:00:01\"")
wait_job $GA $id >/dev/null
check "trim: start 1 s, length 1 s" "run '/opt/shareos/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 /mnt/daten/home/anna/Musik/kurz.mp3' | grep -Eq '^(0\.9|1\.0)'"
id=$(start $GA "$TON" "\"output\":$(OUT ton-mkv),\"action\":\"remux\",\"format\":\"mkv\"")
JM=$id
j=$(wait_job $GA $id)
check "remux to mkv without re-encoding (pcm stays)" "echo '$j' | js \"d.get('state')=='done'\" && run '/opt/shareos/bin/ffprobe -v error -show_entries stream=codec_name -of csv=p=0 /mnt/daten/home/anna/Musik/ton-mkv.mkv' | grep -q pcm_s16le"
id=$(m $GA "{\"op\":\"start\",\"input\":$TON,\"output\":$(OUT ton-mp3),\"action\":\"audio\",\"format\":\"mp3\"}")
check "existing output refused" "echo '$id' | js \"d.get('error')=='output file exists'\""
check "invalid format refused" "m $GA '{\"op\":\"start\",\"input\":$TON,\"output\":$(OUT x),\"action\":\"audio\",\"format\":\"exe\"}' | js \"d.get('error')=='invalid format'\""
check "invalid bitrate refused" "m $GA '{\"op\":\"start\",\"input\":$TON,\"output\":$(OUT x),\"action\":\"audio\",\"format\":\"mp3\",\"bitrate\":\"9999k\"}' | js \"d.get('error')=='invalid bitrate'\""
check "invalid time refused" "m $GA '{\"op\":\"start\",\"input\":$TON,\"output\":$(OUT x),\"action\":\"audio\",\"format\":\"mp3\",\"start\":\"1;rm\"}' | js \"d.get('error')=='invalid time'\""
check "output in a folder that is not hers refused" "m $GA '{\"op\":\"start\",\"input\":$TON,\"output\":{\"root\":\"daten\",\"path\":\"\",\"name\":\"x\"},\"action\":\"audio\",\"format\":\"mp3\"}' | js \"d.get('error')=='unknown folder'\""
check "output name with a slash refused" "m $GA '{\"op\":\"start\",\"input\":$TON,\"output\":{\"root\":\"home\",\"path\":\"Musik\",\"name\":\"../x\"},\"action\":\"audio\",\"format\":\"mp3\"}' | js \"d.get('error')=='invalid name'\""
check "bernd does not see anna's jobs" "m $GB '{\"op\":\"jobs\"}' | js \"d['jobs']==[]\""
check "bernd cannot cancel or remove anna's job" "m $GB '{\"op\":\"cancel\",\"id\":\"$JM\"}' | js \"d.get('error')=='unknown job'\" && m $GB '{\"op\":\"remove\",\"id\":\"$JM\"}' | js \"'error' in d\" && m $GA '{\"op\":\"jobs\"}' | grep -q $JM"

id=$(start $GA '{"root":"home","path":"Musik","name":"lang.wav"}' "\"output\":$(OUT lang),\"action\":\"audio\",\"format\":\"mp3\"")
sleep 3
check "a long job shows progress while running" "m $GA '{\"op\":\"jobs\"}' | js \"[x['state'] for x in d['jobs'] if x['id']=='$id'][0] in ('running','queued')\""
m $GA "{\"op\":\"cancel\",\"id\":\"$id\"}" >/dev/null
j=$(wait_job $GA $id)
check "cancel: job cancelled, no output, no half file" "echo '$j' | js \"d.get('state')=='cancelled'\" && [ ! -e $R/mnt/daten/home/anna/Musik/lang.mp3 ] && [ -z \"\$(ls -A $R/mnt/daten/home/anna/Musik | grep '^\.lang')\" ] && ! run "pgrep -f '[/]bin/ffmpeg '" | grep -q ."
check "remove a finished job from the list" "m $GA '{\"op\":\"remove\",\"id\":\"$id\"}' | js \"d.get('ok')\" && ! m $GA '{\"op\":\"jobs\"}' | grep -q $id"
check "rpcd object not reachable for web sessions" "! grep -q appmedia $R/usr/share/rpcd/acl.d/shareos.json"
id=$(start $GA '{"root":"home","path":"Musik","name":"lang.wav"}' "\"output\":$(OUT lang2),\"action\":\"audio\",\"format\":\"flac\"")
sleep 2
run "shareos-apps remove ffmpeg" >/dev/null
j=$(wait_job $GA $id)
check "removing the system app cancels running jobs" "echo '$j' | js \"d.get('state') in ('cancelled','error')\" && ! run "pgrep -f '[/]bin/ffmpeg '" | grep -q ."

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
