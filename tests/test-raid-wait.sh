#!/bin/bash
#
# Tests the wait for late RAID members at boot (shareos-storage boot,
# wait_members, #65) on the build host with a fake mdadm: disks that come up
# one after the other, a disk that never comes, foreign members, no
# mdadm.conf. The real md driver is covered on the box (docs/TESTING.md).
#
#   tests/test-raid-wait.sh
#
set -u
TOP=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT=$TOP/src/shareos-core/usr/sbin/shareos-storage
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass + 1)); else echo "FAIL  $1"; fail=$((fail + 1)); fi; }

mkdir -p $T/bin
# fake mdadm: members/<part> holds the UUID of a partition, need/<uuid> how
# many members start the array; state in $T/st
cat > $T/bin/mdadm <<'SH'
#!/bin/sh
S=$FAKE/st; echo "$*" >> $S/calls
case "$*" in
	"--examine --export /dev/"*) p=${3#/dev/}; [ -f $S/members/$p ] && echo "MD_UUID=$(cat $S/members/$p)"; exit 0 ;;
	"--incremental --run --scan") for d in $S/added/*; do [ -d "$d" ] && touch $S/running/${d##*/}; done; exit 0 ;;
	"--incremental /dev/"*) p=${2#/dev/}; u=$(cat $S/members/$p); mkdir -p $S/added/$u $FAKE/sys/$p/holders; touch $S/added/$u/$p $FAKE/sys/$p/holders/md0
		[ $(ls $S/added/$u | wc -l) -ge $(cat $S/need/$u) ] && touch $S/running/$u; exit 0 ;;
	"--detail --scan") for d in $S/added/*; do [ -d "$d" ] || continue; u=${d##*/}
		if [ -e $S/running/$u ]; then echo "ARRAY /dev/md/v metadata=1.0 name=box:v UUID=$u"; else echo "INACTIVE-ARRAY /dev/md127 metadata=1.0 name=box:v UUID=$u"; fi; done; exit 0 ;;
esac
exit 0
SH
# sleep: one second passes; late partitions appear at their second
cat > $T/bin/sleep <<'SH'
#!/bin/sh
n=$(( $(cat $FAKE/st/slept) + 1 )); echo $n > $FAKE/st/slept
[ -f $FAKE/late.$n ] && cat $FAKE/late.$n >> $FAKE/partitions
exit 0
SH
printf '#!/bin/sh\necho "$*" >> $FAKE/st/log\n' > $T/bin/logger
printf '#!/bin/sh\nexit 1\n' > $T/bin/uci
printf '#!/bin/sh\nexit 0\n' > $T/bin/hdparm
cp $T/bin/hdparm $T/bin/blkid
chmod +x $T/bin/*

U1=11111111:22222222:33333333:44444444
U2=aaaaaaaa:bbbbbbbb:cccccccc:dddddddd
setup() {   # fresh state: setup <conf-uuids...>
	export FAKE=$T/case; rm -rf $FAKE; mkdir -p $FAKE/st/members $FAKE/st/need $FAKE/st/added $FAKE/st/running $FAKE/sys
	echo 0 > $FAKE/st/slept; : > $FAKE/st/calls; : > $FAKE/st/log
	printf 'major minor  #blocks  name\n\n   8        0  3907018584 sda\n' > $FAKE/partitions
	if [ $# -gt 0 ]; then
		{ echo "# written by shareos-storage"; echo "DEVICE partitions"; echo "HOMEHOST <ignore>"
		  for u in "$@"; do echo "ARRAY /dev/md/v metadata=1.0 name=box:v UUID=$u"; done; } > $FAKE/mdadm.conf
	fi
}
part() { echo "   8        2   3906000000 $1" >> $FAKE/partitions; mkdir -p $FAKE/sys/$1/holders; echo $2 > $FAKE/st/members/$1; }
late() { echo "   8       18   3906000000 $1" >> $FAKE/late.$3; mkdir -p $FAKE/sys/$1/holders; echo $2 > $FAKE/st/members/$1; }
need() { echo $2 > $FAKE/st/need/$1; }
# the script with its paths pointed at the fake box
boot() {
	sed -e "s|^PATH=.*|PATH=$T/bin:/usr/bin:/bin|" -e "s|^MDCONF=.*|MDCONF=$FAKE/mdadm.conf|" -e "s|^PARTITIONS=.*|PARTITIONS=$FAKE/partitions|" \
		-e "s|^SYSBLOCK=.*|SYSBLOCK=$FAKE/sys|" -e "s|^RAID_WAIT=.*|RAID_WAIT=${WAIT:-40}|" $SCRIPT > $T/storage
	grep -q "^RAID_WAIT=${WAIT:-40}\$" $T/storage || { echo "cannot point the script at the fake box"; exit 1; }
	timeout 20 dash $T/storage boot >/dev/null 2>&1
}
slept() { cat $FAKE/st/slept; }
ran() { grep -qx -- "$1" $FAKE/st/calls; }

setup $U1; need $U1 2; part sda2 $U1; part sdb2 $U1; boot
check "both disks there: mirror complete at once, no waiting" "[ -e \$FAKE/st/running/$U1 ] && [ \$(slept) = 0 ] && ! ran '--incremental --run --scan'"

setup $U1; need $U1 2; part sda2 $U1; late sdb2 $U1 9; boot
check "second disk 9 s late: waits for it, mirror complete, not started with one disk" "[ -e \$FAKE/st/running/$U1 ] && [ \$(slept) = 9 ] && ! ran '--incremental --run --scan' && [ ! -s \$FAKE/st/log ]"

setup $U1; need $U1 2; late sda2 $U1 3; late sdb2 $U1 5; boot
check "stripe/span whose disks are both late: started when the last one is there" "[ -e \$FAKE/st/running/$U1 ] && [ \$(slept) = 5 ]"

WAIT=6; setup $U1; need $U1 2; part sda2 $U1; boot; WAIT=40
check "disk never comes: after the limit the mirror starts degraded, logged" "[ -e \$FAKE/st/running/$U1 ] && [ \$(slept) = 6 ] && ran '--incremental --run --scan' && grep -q 'RAID incomplete after 6s' \$FAKE/st/log"

setup $U1; need $U1 2; part sda2 $U1; part sdb2 $U1; part sdc1 $U2; boot
check "foreign RAID member (not in mdadm.conf) is left alone" "! ran '--incremental /dev/sdc1' && [ ! -d \$FAKE/st/added/$U2 ]"

setup $U1 $U2; need $U1 2; need $U2 2; part sda2 $U1; part sdb2 $U1; part sda3 $U2; late sdb3 $U2 4; boot
check "two arrays, one complete, one late: waits for the late one only" "[ -e \$FAKE/st/running/$U1 ] && [ -e \$FAKE/st/running/$U2 ] && [ \$(slept) = 4 ]"

setup $U1; need $U1 2; part sda2 $U1; part sdb2 $U1; mkdir -p $FAKE/sys/sda2/holders; touch $FAKE/sys/sda2/holders/md0; touch $FAKE/st/running/$U1; mkdir -p $FAKE/st/added/$U1; boot
check "partitions already in an array are not examined again" "! ran '--examine --export /dev/sda2'"

setup; part sda2 $U1; part sdb2 $U1; boot
check "no mdadm.conf: no waiting, nothing examined" "[ \$(slept) = 0 ] && ! grep -q -- '--examine' \$FAKE/st/calls && ran '--assemble --scan'"

setup $U1; need $U1 1; part sda1 $U1; boot
check "a mirror left with one disk on purpose (superblock: 1 active) starts at once" "[ -e \$FAKE/st/running/$U1 ] && [ \$(slept) = 0 ]"

echo "$pass passed, $fail failed"
[ $fail = 0 ]
