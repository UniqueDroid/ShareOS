#!/bin/bash
#
# Host test for shareos-flash-bin: info and write with real D-Link .bin files
# (made with dns323-fw/mkimage), on a fake box whose flash partitions are
# plain files and whose flash tools are shell stand-ins.
#
#   tests/test-flash-bin.sh [host-bin-dir]   (default output/dns320l/host/bin)
#
set -u
TOP=$(cd "$(dirname "$0")/.." && pwd)
H=$(realpath "${1:-$TOP/output/dns320l/host/bin}")
SCRIPT="$TOP/src/shareos-core/usr/sbin/shareos-flash-bin"
[ -x "$H/dns323-fw" ] && [ -x "$H/mkimage" ] || { echo "dns323-fw/mkimage missing in $H"; exit 1; }

T=$(mktemp -d); [ -d "$T" ] || exit 1
trap 'rm -rf "$T"' EXIT
R=$T/root; S=$T/stub
mkdir -p $R/proc/device-tree $R/dev $R/tmp $S
printf 'dev:    size   erasesize  name\nmtd1: 00500000 00020000 "uImage"\nmtd2: 00500000 00020000 "ramdisk"\nmtd3: 06400000 00020000 "image"\n' > $R/proc/mtd
printf 'D-Link DNS-320L\0' > $R/proc/device-tree/model
blank() { head -c 5242880 /dev/zero | tr '\0' '\377' > "$1"; }
cat > $S/flash_erase <<'X'
#!/bin/sh
head -c 5242880 /dev/zero | tr '\000' '\377' > "$2"; echo "erase ${2##*/}" >> "$CALLS"
X
cat > $S/nandwrite <<'X'
#!/bin/sh
dd if="$4" of="$3" conv=notrunc 2>/dev/null; echo "write ${3##*/}" >> "$CALLS"
X
cat > $S/nanddump <<'X'
#!/bin/sh
# nanddump -q -l <len> -f <out> <dev>
head -c "$3" "$6" > "$5"
X
printf '#!/bin/sh\nexit 0\n' > $S/logger
chmod 755 $S/*
ln -s "$H/dns323-fw" $S/dns323-fw
export CALLS=$T/calls SHAREOS_ROOT=$R SHAREOS_TEST_PATH=$S SHAREOS_BOARD_LIB=$TOP/board/dlink/dns320l/rootfs-overlay/usr/lib/shareos/board.sh

# mkbin <file> <kernel name> [kernel size] [type]
mkbin() {
	local d=$T/p; rm -rf $d; mkdir -p $d
	head -c "${3:-1500000}" /dev/urandom > $d/z; head -c 900000 /dev/urandom > $d/i
	"$H/mkimage" -A arm -O linux -T kernel -C none -a 0x8000 -e 0x8000 -n "$2" -d $d/z $d/k >/dev/null
	"$H/mkimage" -A arm -O linux -T ramdisk -C none -a 0x800000 -e 0x800000 -n "${2%%,*}, initrd" -d $d/i $d/r >/dev/null
	"$H/dns323-fw" -m -q -p 0 -c 8 -l "${5:-11}" -u 1 -v 1 -t "${4:-6}" -k $d/k -i $d/r "$1" >/dev/null 2>&1
	cp $d/k "$1.kernel"; cp $d/r "$1.initramfs"
}
mkbin $T/shareos.bin "ShareOS-0.2.0, kernel 6.18"
mkbin $T/altf.bin "Alt-F-1.0, kernel 4.4.86"
mkbin $T/big.bin "Alt-F-1.0, kernel 4.4.86" 3200000
mkbin $T/dns325.bin "Alt-F-1.0, kernel 4.4.86" 1500000 3 5
head -c 2000000 /dev/urandom > $T/random.bin
cp $T/altf.bin $T/damaged.bin; printf 'XXXX' | dd of=$T/damaged.bin bs=1 seek=200000 conv=notrunc 2>/dev/null

pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; sed 's/^/      /' $T/out | tail -5; failed=$((failed+1)); fi; }
run() { : > $CALLS; sh "$SCRIPT" "$@" > $T/out 2>&1; echo $?; }
fresh() { blank $R/dev/mtd1; blank $R/dev/mtd2; }
same() { cmp -s <(head -c $(stat -c %s "$2") "$1") "$2"; }

rc=$(run info $T/altf.bin)
check "info: Alt-F .bin recognised" "[ $rc = 0 ] && grep -qx kind=altf $T/out && grep -q '^kernel=Alt-F-1.0' $T/out"
rc=$(run info $T/shareos.bin)
check "info: ShareOS .bin recognised" "[ $rc = 0 ] && grep -qx kind=shareos $T/out"
rc=$(run info $T/random.bin)
check "info: no D-Link file rejected" "[ $rc = 1 ] && grep -q 'not a D-Link firmware' $T/out"
rc=$(run info $T/damaged.bin)
check "info: damaged file rejected" "[ $rc = 1 ] && grep -q 'damaged' $T/out"
rc=$(run info $T/dns325.bin)
check "info: file for another device rejected" "[ $rc = 1 ] && grep -q 'another device' $T/out"
rc=$(run info $T/big.bin)
check "info: kernel larger than 3 MB rejected" "[ $rc = 1 ] && grep -q '3 MB' $T/out"

fresh
rc=$(run write $T/altf.bin)
check "write without --yes refused" "[ $rc = 1 ] && [ ! -s $CALLS ]"
rc=$(run write $T/altf.bin --yes)
check "write: Alt-F kernel and initramfs in flash" "[ $rc = 0 ] && same $R/dev/mtd1 $T/altf.bin.kernel && same $R/dev/mtd2 $T/altf.bin.initramfs && grep -q '^ok kind=altf' $T/out"
check "write: initramfs written before the kernel" "[ \"\$(grep ^write $CALLS | tr '\n' ' ')\" = 'write mtd2 write mtd1 ' ]"
check "write: image partition untouched" "! grep -q mtd3 $CALLS"
fresh
rc=$(run write $T/dns325.bin --yes)
check "write: wrong device, nothing written" "[ $rc = 1 ] && [ ! -s $CALLS ]"
rc=$(run write $T/damaged.bin --yes)
check "write: damaged file, nothing written" "[ $rc = 1 ] && [ ! -s $CALLS ]"
mkdir -p $R/tmp/shareos-update; echo '{ "state": "flashing" }' > $R/tmp/shareos-update/state.json
rc=$(run write $T/altf.bin --yes)
check "write refused while an update runs" "[ $rc = 1 ] && grep -q 'update is running' $T/out && [ ! -s $CALLS ]"
rm -rf $R/tmp/shareos-update
# one write at a time: a running one (its pid lives) blocks, a stale lock is taken over
sleep 30 & SP=$!
mkdir -p $R/tmp/shareos-flash-bin.lock; echo $SP > $R/tmp/shareos-flash-bin.lock/pid
rc=$(run write $T/altf.bin --yes)
check "write refused while another write runs" "[ $rc = 1 ] && grep -q 'another firmware write' $T/out && [ ! -s $CALLS ]"
kill $SP 2>/dev/null; wait $SP 2>/dev/null
rc=$(run write $T/altf.bin --yes)
check "write: stale lock taken over, lock released afterwards" "[ $rc = 0 ] && [ ! -e $R/tmp/shareos-flash-bin.lock ]"
fresh
printf 'D-Link DNS-325\0' > $R/proc/device-tree/model
rc=$(run write $T/altf.bin --yes)
check "write: a DNS-320L file refused on a DNS-325" "[ $rc = 1 ] && grep -q 'another device' $T/out && [ ! -s $CALLS ]"
fresh; rc=$(run write $T/dns325.bin --yes)
check "write: a DNS-325 file accepted on a DNS-325" "[ $rc = 0 ] && same $R/dev/mtd1 $T/dns325.bin.kernel"
printf 'Some other NAS\0' > $R/proc/device-tree/model
rc=$(run write $T/altf.bin --yes)
check "write refused on an unknown box" "[ $rc = 1 ] && grep -q 'not supported' $T/out && [ ! -s $CALLS ]"
printf 'D-Link DNS-320L\0' > $R/proc/device-tree/model
# a nandwrite that writes garbage: the readback must catch it
cp $S/nandwrite $T/nw.ok
printf '#!/bin/sh\nhead -c 4096 /dev/urandom | dd of="$3" conv=notrunc 2>/dev/null; echo "write ${3##*/}" >> "$CALLS"\n' > $S/nandwrite
rc=$(run write $T/altf.bin --yes)
check "write: bad readback detected, kernel left alone" "[ $rc = 1 ] && grep -q 'ramdisk does not read back' $T/out && ! grep -q 'write mtd1' $CALLS"
cp $T/nw.ok $S/nandwrite
REAL=$(ls -t "$TOP"/output/dns320l/images/ShareOS-*-DNS-320L-rev-Ax.bin 2>/dev/null | head -1)
if [ -n "$REAL" ]; then
	rc=$(run info "$REAL")
	check "info: the built ShareOS .bin" "[ $rc = 0 ] && grep -qx kind=shareos $T/out"
	# every model's .bin is accepted on its own model only
	V=${REAL##*/ShareOS-}; V=${V%-DNS-320L-rev-Ax.bin}
	for x in "DNS-320L-rev-Ax:D-Link DNS-320L-rev-Ax NAS:DNS320L" "DNS-320-rev-Bx:D-Link DNS-320-rev-Bx NAS:DNS320B" \
		"DNS-320-rev-Ax:D-Link DNS-320 NAS (Rev A1):DNS323D1" "DNS-325-rev-Ax:D-Link DNS-325 NAS (Rev A1):DNS-325"; do
		IFS=: read -r fw model sig <<< "$x"
		f="$TOP/output/dns320l/images/ShareOS-$V-$fw.bin"
		[ -f "$f" ] || continue
		printf '%s\0' "$model" > $R/proc/device-tree/model
		rc=$(run info "$f")
		check "built $fw .bin: signature $sig, accepted on its model" "[ $rc = 0 ] && grep -qx signature=$sig $T/out"
		printf 'D-Link DNS-320L-rev-Ax NAS\0' > $R/proc/device-tree/model
		[ $fw = DNS-320L-rev-Ax ] && continue
		rc=$(run info "$f")
		check "built $fw .bin: refused on a DNS-320L" "[ $rc = 1 ] && grep -q 'another device' $T/out"
	done
	printf 'D-Link DNS-320L\0' > $R/proc/device-tree/model
fi
echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
