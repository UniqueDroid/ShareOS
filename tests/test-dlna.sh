#!/bin/bash
#
# Tests the media server: system app minidlna, shareos-dlna, rpcd shareos.dlna –
# built ARM userland (qemu-user) in a chroot, a drive as tmpfs.
#
#   sudo tests/test-dlna.sh [output/dns320l] [minidlna.sapp]   (make sysapps-pack)
#
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/minidlna-*.sapp 2>/dev/null | head -1)}
[ -f "$SAPP" ] || { echo "no minidlna .sapp – make sysapps-pack"; exit 1; }

T=$(mktemp -d /tmp/shareos-dlna-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-dlna stop; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
u() { run "ubus call shareos.dlna $1 '${2:-{\}}'"; }

run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci set storage.global=global; uci set storage.global.apps=daten; uci commit storage
	for s in musik bilder filme; do uci set shares.\$s=share; uci set shares.\$s.volume=daten; uci set shares.\$s.path=\$s; mkdir -p /mnt/daten/\$s; done; uci commit shares" >/dev/null
python3 - "$R/mnt/daten/musik" <<'PY'
import math, struct, sys, wave
d = sys.argv[1]
for n in ('eins', 'zwei'):
    w = wave.open(d + '/' + n + '.wav', 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b''.join(struct.pack('<h', int(8000 * math.sin(i / 5))) for i in range(8000))); w.close()
PY
# a small JPEG
python3 -c "import base64,sys; open(sys.argv[1],'wb').write(base64.b64decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='))" $R/mnt/daten/bilder/foto.jpg
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.dlna' | grep -q dlna || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done

check "not installed: status says so, no service entry" "u status | js \"not d['installed'] and not d['running'] and set(d['shares'])=={'musik','bilder','filme'}\" && ! run 'ubus call shareos.service list' | grep -q minidlnad"
check "switching on without the system app: clear error" "u set '{\"enabled\":true,\"name\":\"\",\"media\":[]}' | js \"'not installed' in d.get('error','')\""
cp "$SAPP" "$R/tmp/m.sapp"
check "system app minidlna installs" "run 'shareos-apps install-file /tmp/m.sapp' | js \"d.get('id')=='minidlna'\" && [ -x $R/opt/shareos/bin/minidlnad ]"
check "service list shows the media server" "run 'ubus call shareos.service list' | grep -q 'Medienserver'"
check "unknown share refused" "u set '{\"enabled\":true,\"name\":\"x\",\"media\":[{\"share\":\"nix\",\"type\":\"A\"}]}' | js \"d.get('error')=='invalid folder'\""
o=$(u set '{"enabled":true,"name":"Wohnzimmer NAS","media":[{"share":"musik","type":"A"},{"share":"bilder","type":"P"}]}')
check "switched on: running, folders in the settings" "echo '$o' | js \"d['running'] and d['name']=='Wohnzimmer NAS' and d['media']==[{'type':'A','share':'musik'},{'type':'P','share':'bilder'}]\" && grep -q '^media_dir=A,/mnt/daten/musik$' $R/tmp/shareos-dlna/minidlna.conf && grep -q '^media_dir=P,/mnt/daten/bilder$' $R/tmp/shareos-dlna/minidlna.conf"
i=0; while ! u status | js "d['audio']>=2 and d['image']>=1" && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
check "library: 2 audio files, 1 picture, no video" "u status | js \"d['audio']==2 and d['image']==1 and d['video']==0\""
check "library on the drive (survives a restart)" "[ -f $R/mnt/daten/.shareos/minidlna/files.db ]"
check "UPnP description with the name (port 8200)" "run 'curl -s http://127.0.0.1:8200/rootDesc.xml' | grep -q '<friendlyName>Wohnzimmer NAS</friendlyName>'"
check "announces itself in the network (SSDP, UDP 1900)" "grep -qi ':076C ' /proc/net/udp"
cat > $R/tmp/browse.xml <<'XML'
<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>0</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>0</StartingIndex><RequestedCount>10</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>
XML
check "content directory answers (UPnP Browse)" "run \"curl -s -H 'SOAPACTION: \\\"urn:schemas-upnp-org:service:ContentDirectory:1#Browse\\\"' -H 'Content-Type: text/xml' --data-binary @/tmp/browse.xml http://127.0.0.1:8200/ctl/ContentDir\" | grep -q 'TotalMatches'"
cp $R/mnt/daten/musik/eins.wav $R/mnt/daten/musik/drei.wav
i=0; while ! u status | js "d['audio']>=3" && [ $i -lt 45 ]; do sleep 1; i=$((i + 1)); done
check "a new file shows up by itself (inotify)" "u status | js \"d['audio']==3\""
check "read everything again (rescan)" "u rescan | js \"d['running']\""
i=0; while ! u status | js "d['audio']==3 and not d['scanning']" && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
check "after the rescan the library is complete" "u status | js \"d['audio']==3 and d['image']==1\""
check "switched off: stopped, boot does not start it" "u set '{\"enabled\":false,\"name\":\"Wohnzimmer NAS\",\"media\":[{\"share\":\"musik\",\"type\":\"A\"}]}' | js \"not d['running']\" && run 'shareos-dlna boot; shareos-dlna status' | grep -q '^running=0'"
u set '{"enabled":true,"name":"","media":[{"share":"filme","type":"-"}]}' >/dev/null
check "name empty: the box's name; folder for everything" "run 'curl -s http://127.0.0.1:8200/rootDesc.xml' | grep -q \"<friendlyName>\$(run 'cat /proc/sys/kernel/hostname')</friendlyName>\" && grep -q '^media_dir=/mnt/daten/filme$' $R/tmp/shareos-dlna/minidlna.conf"
check "removing the system app stops the server" "run 'shareos-apps remove minidlna' >/dev/null; ! run 'shareos-dlna status' | grep -q '^running=1' && ! pgrep -f '[/]minidlnad ' >/dev/null"
check "web sessions: status read, changes for admins (ACL)" "grep -q '\"shareos.dlna\"' $R/usr/share/rpcd/acl.d/shareos.json"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
