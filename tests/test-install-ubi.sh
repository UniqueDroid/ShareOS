#!/bin/bash
#
# Host test of the size check in shareos-install-ubi: it must accept the 'image'
# partition of every supported model and refuse any other size before anything
# is written (the script stops at the check, no flash tool is called).
#
#   tests/test-install-ubi.sh
#
set -u
TOP=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT=$TOP/board/dlink/dns320l/initramfs/usr/sbin/shareos-install-ubi
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; sed 's/^/      /' $T/out | tail -3; failed=$((failed+1)); fi; }
mtd() {   # size of 'image' -> fake /proc/mtd
	printf 'dev:    size   erasesize  name\nmtd0: 00100000 00020000 "u-boot"\nmtd3: %s 00020000 "image"\nmtd4: 00a00000 00020000 "mini firmware"\n' "$1" > $T/mtd
}
run() { SHAREOS_PROC_MTD=$T/mtd sh "$SCRIPT" "$T/no-such-file" --yes > $T/out 2>&1; }

mtd 06400000; run
check "DNS-320L / 320 rev B (0x06400000): size accepted" "! grep -q 'unexpected size' $T/out && grep -q 'missing' $T/out"
mtd 06600000; run
check "DNS-325 / 320 rev A (0x06600000): size accepted" "! grep -q 'unexpected size' $T/out && grep -q 'missing' $T/out"
mtd 04600000; run
check "DNR-322L (0x04600000): size accepted" "! grep -q 'unexpected size' $T/out && grep -q 'missing' $T/out"

# the rootfs volume: 48 MiB, 32 MiB on the 70 MB partition of the DNR-322L.
# Stub flash tools in PATH record what would be written; nothing is written.
mkdir -p $T/bin
for t in ubiformat ubiattach ubimkvol ubiupdatevol ubinfo ubidetach ubiblock; do
	printf '#!/bin/sh\necho "%s $*" >> %s/calls\n' "$t" "$T" > $T/bin/$t; chmod +x $T/bin/$t
done
printf 'hsqs' > $T/rootfs.squashfs; head -c 4096 /dev/zero >> $T/rootfs.squashfs
vol() {   # size of 'image' -> -s of the rootfs volume
	rm -f $T/calls; mtd "$1"
	PATH=$T/bin:$PATH SHAREOS_PROC_MTD=$T/mtd sh "$SCRIPT" "$T/rootfs.squashfs" --yes > $T/out 2>&1
	sed -n 's/^ubimkvol .*-N rootfs -s \([0-9]*\).*/\1/p' $T/calls 2>/dev/null
}
check "DNS-320L: rootfs volume 48 MiB" "[ \"\$(vol 06400000)\" = 50331648 ]"
check "DNR-322L: rootfs volume 32 MiB" "[ \"\$(vol 04600000)\" = 33554432 ]"
check "DNR-322L: rootfs_data takes the rest, nothing else is touched" "grep -q '^ubimkvol /dev/ubi0 -N rootfs_data -m' $T/calls && grep -q '^ubiformat /dev/mtd3 ' $T/calls"
mtd 06000000; run
check "other size refused" "grep -q 'unexpected size 0x06000000' $T/out"
mtd 00500000; run
check "a small partition refused" "grep -q 'unexpected size 0x00500000' $T/out"
printf 'dev:    size   erasesize  name\nmtd1: 00500000 00020000 "uImage"\n' > $T/mtd; run
check "no 'image' partition refused" "grep -q \"partition 'image' not found\" $T/out"

echo; echo "$pass passed, $failed failed"
[ $failed = 0 ]
