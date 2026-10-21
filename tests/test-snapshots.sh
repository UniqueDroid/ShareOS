#!/bin/bash
#
# Tests snapshots: rpcd shareos.snapshots and shareos-snapshot (rsync with
# hard links) – built ARM userland (qemu-user) in a chroot, two drives as tmpfs.
#
#   sudo tests/test-snapshots.sh [output/dns320l]
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

T=$(mktemp -d /tmp/shareos-snap-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
mkdir -p "$R/var/run/ubus" "$R/var/log" "$R/mnt/daten" "$R/mnt/backup"
mount -t tmpfs tmpfs "$R/mnt/daten"
mount -t tmpfs tmpfs "$R/mnt/backup"

run() { chroot "$R" /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }
u() { run "ubus call shareos.snapshots $1 '${2:-{\}}'"; }
ino() { stat -c %i "$R$1"; }

run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci set storage.backup=volume; uci set storage.backup.uuid=1; uci commit storage
	uci set shares.fotos=share; uci set shares.fotos.volume=daten; uci set shares.fotos.path=fotos; uci commit shares
	mkdir -p /mnt/daten/fotos/2026 /mnt/daten/home/anna
	echo eins > /mnt/daten/fotos/a.txt; echo zwei > /mnt/daten/fotos/2026/b.txt; echo weg > /mnt/daten/fotos/c.tmp; echo bleibt > /mnt/daten/fotos/d.txt" >/dev/null
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.snapshots' | grep -q snapshots || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done

check "rsync is in the firmware" "run 'rsync --version' | grep -q 'rsync  version 3'"
o=$(u status)
check "status: drives and sources (share, personal folders, whole drives)" "echo '$o' | js \"d['rsync'] and {'share:fotos','homes:daten','volume:daten','volume:backup'} <= {s['id'] for s in d['sources']} and all(v['links'] for v in d['volumes'])\""

J='{"name":"fotos","new":true,"source":"share:fotos","target":"backup","every":"day","time":"03:15","keep_last":5,"keep_daily":7,"keep_weekly":4,"keep_monthly":6,"exclude":["*.tmp"],"enabled":true}'
check "job created" "u job_set '$J' | js \"d.get('ok') and d['jobs'][0]['name']=='fotos'\""
check "same name again refused" "u job_set '$J' | js \"d.get('error')=='name already in use'\""
check "unknown source refused" "u job_set '$(echo $J | sed 's/share:fotos/share:nix/; s/fotos\",\"new/x1\",\"new/')' | js \"d.get('error')=='unknown source'\""
check "keeping nothing refused" "u job_set '$(echo $J | sed 's/"keep_last":5,"keep_daily":7,"keep_weekly":4,"keep_monthly":6/"keep_last":0,"keep_daily":0,"keep_weekly":0,"keep_monthly":0/; s/fotos","new/x2","new/')' | js \"d.get('error')=='keep at least one snapshot'\""
check "invalid time refused" "u job_set '$(echo $J | sed 's/03:15/25:00/; s/fotos\",\"new/x3\",\"new/')' | js \"d.get('error')=='invalid time'\""
check "cron: daily at 3:15" "grep -q '^15 3 \* \* \* /usr/sbin/shareos-snapshot run fotos' $R/etc/crontabs/root"

check "first snapshot" "run 'shareos-snapshot run fotos' | js \"d.get('ok') and d['files']>=4\""
S1=$(ls $R/mnt/backup/Snapshots/fotos | grep -E '^[0-9]{4}-' | head -1)
check "snapshot has the files, not the excluded ones" "[ -f $R/mnt/backup/Snapshots/fotos/$S1/a.txt ] && [ -f $R/mnt/backup/Snapshots/fotos/$S1/2026/b.txt ] && [ ! -e $R/mnt/backup/Snapshots/fotos/$S1/c.tmp ]"
check "Snapshots folder only for root (0700)" "[ \$(stat -c %a $R/mnt/backup/Snapshots) = 700 ]"
sleep 1.2
run "echo neu > /mnt/daten/fotos/a.txt; rm /mnt/daten/fotos/d.txt; echo drei > /mnt/daten/fotos/e.txt" >/dev/null
check "second snapshot" "run 'shareos-snapshot run fotos' | js \"d.get('ok') and d['changed']==2\""
S2=$(ls $R/mnt/backup/Snapshots/fotos | grep -E '^[0-9]{4}-' | tail -1)
B=/mnt/backup/Snapshots/fotos
check "unchanged file is a hard link (no space twice)" "[ \$(ino $B/$S1/2026/b.txt) = \$(ino $B/$S2/2026/b.txt) ] && [ \$(stat -c %h $R$B/$S2/2026/b.txt) = 2 ]"
check "changed file: new in the new snapshot, old in the old one" "[ \"\$(cat $R$B/$S2/a.txt)\" = neu ] && [ \"\$(cat $R$B/$S1/a.txt)\" = eins ]"
check "deleted file: gone in the new snapshot, still in the old one" "[ ! -e $R$B/$S2/d.txt ] && [ -f $R$B/$S1/d.txt ]"
check "status lists both snapshots, newest first, and the last result" "u status | js \"[j for j in d['jobs'] if j['name']=='fotos'][0]['snapshots'][0]['name']=='$S2' and len(d['jobs'][0]['snapshots'])==2 and d['jobs'][0]['last']['state']=='ok'\""
check "log written" "u log '{\"name\":\"fotos\"}' | js \"'Number of files' in d['log']\""

# retention: old snapshots by day; keep_daily 3, nothing else
for n in 2026-01-01_030000 2026-01-01_120000 2026-01-02_030000 2026-01-03_030000 2026-01-04_030000; do mkdir -p $R$B/$n; done
u job_set '{"name":"fotos","source":"share:fotos","target":"backup","every":"day","time":"03:15","keep_last":1,"keep_daily":3,"keep_weekly":0,"keep_monthly":0,"exclude":["*.tmp"],"enabled":true}' >/dev/null
run 'shareos-snapshot run fotos' >/dev/null
left=$(ls $R$B | grep -E '^[0-9]{4}-' | tr '\n' ' ')
check "keep the newest and the newest per day, 3 days (today counts)" "[ \$(ls $R$B | grep -cE '^[0-9]{4}-') = 3 ] && ! echo '$left' | grep -q 2026-01-0[12] && echo '$left' | grep -q 2026-01-03_030000 && echo '$left' | grep -q 2026-01-04_030000 && ! ls -A $R$B | grep -q '^\.deleting'"
u job_set '{"name":"fotos","source":"share:fotos","target":"backup","every":"day","time":"03:15","keep_last":5,"keep_daily":7,"keep_weekly":4,"keep_monthly":6,"exclude":["*.tmp"],"enabled":true}' >/dev/null

# remove one snapshot
S=$(ls $R$B | grep -E '^[0-9]{4}-' | head -1)
check "remove one snapshot" "u remove '{\"name\":\"fotos\",\"snapshot\":\"$S\"}' | js \"d.get('ok')\" && [ ! -e $R$B/$S ]"
check "remove: invalid name refused" "u remove '{\"name\":\"fotos\",\"snapshot\":\"../x\"}' | js \"d.get('error')=='invalid snapshot'\""

# stop a running snapshot, the next run continues
run 'mkdir -p /mnt/daten/fotos/viel; i=0; while [ $i -lt 400 ]; do echo $i > /mnt/daten/fotos/viel/f$i; i=$((i+1)); done' >/dev/null
dd if=/dev/urandom of=$R/mnt/daten/fotos/viel/gross.bin bs=1M count=400 status=none
u run '{"name":"fotos"}' >/dev/null
sleep 1
check "a running snapshot shows as running" "u status | js \"d['jobs'][0]['running']\""
check "stop" "u stop '{\"name\":\"fotos\"}' | js \"d.get('ok')\""
i=0; while u status | js "d['jobs'][0]['running']" && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
check "stopped: state stopped, no new snapshot, the half one stays for the next run" "u status | js \"d['jobs'][0]['last']['state']=='stopped'\" && [ -d $R$B/.incomplete ] && ! pgrep -f '[r]sync .*/Snapshots/fotos/' >/dev/null"
check "next run continues and finishes" "run 'shareos-snapshot run fotos' | js \"d.get('ok')\" && [ ! -e $R$B/.incomplete ] && [ -f $R$B/\$(ls $R$B | grep -E '^[0-9]{4}-' | tail -1)/viel/f399 ]"

# a whole drive into a folder on the same drive: the snapshots stay out
u job_set '{"name":"alles","new":true,"source":"volume:daten","target":"daten","every":"week","time":"04:30","keep_last":0,"keep_daily":0,"keep_weekly":2,"keep_monthly":0,"exclude":[],"enabled":true}' >/dev/null
check "cron: weekly on Sunday 4:30" "grep -q '^30 4 \* \* 0 /usr/sbin/shareos-snapshot run alles' $R/etc/crontabs/root"
run 'shareos-snapshot run alles' >/dev/null; run 'shareos-snapshot run alles' >/dev/null
A=$(ls $R/mnt/daten/Snapshots/alles | grep -E '^[0-9]{4}-' | tail -1)
check "drive into itself: no snapshots inside the snapshot" "[ -f $R/mnt/daten/Snapshots/alles/$A/fotos/a.txt ] && [ ! -e $R/mnt/daten/Snapshots/alles/$A/Snapshots ]"

# failure: the target drive is gone
umount "$R/mnt/backup"
check "missing target drive: error, message" "! run 'shareos-snapshot run fotos' >/dev/null && u status | js \"[j for j in d['jobs'] if j['name']=='fotos'][0]['last']['state']=='error'\" && grep -q 'snapshot-fotos' $R/etc/shareos/notifications.json"
mount -t tmpfs tmpfs "$R/mnt/backup"

check "delete job with its snapshots" "u job_del '{\"name\":\"alles\",\"data\":true}' | js \"d.get('ok') and all(j['name']!='alles' for j in d['jobs'])\" && [ ! -e $R/mnt/daten/Snapshots/alles ] && ! grep -q 'run alles' $R/etc/crontabs/root"
check "web sessions: read status, admin changes (ACL)" "grep -q '\"shareos.snapshots\"' $R/usr/share/rpcd/acl.d/shareos.json"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
