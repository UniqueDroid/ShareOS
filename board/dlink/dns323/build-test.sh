#!/bin/bash
#
# ShareOS Lite – builds the phase-1 hardware test firmware for the D-Link
# DNS-323 (kernel + test initramfs) without buildroot:
#
#   board/dlink/dns323/build-test.sh <linux-source-dir> <ShareOS-…-DNS-320L-rev-Ax.sysupgrade.tar> [outdir]
#
# Needs: arm-linux-gnueabi-gcc (Debian/Ubuntu gcc-arm-linux-gnueabi), make,
# bc, bison, flex, mkimage (u-boot-tools), cpio, xz, gcc (for dns323-fw).
# The userland of the test initramfs is the DNS-320L initramfs of a release
# (ARMv5 like the Orion, so it runs unchanged); this adds the DNS-323 kernel
# modules and replaces /init with test-init.
#
# Result: ShareOS-Lite-test-DNS-323-rev-AxBxCx.bin (+ .sha1), uImage, urootfs.
#
set -euo pipefail
KSRC=$(cd "$1" && pwd); SU=$(readlink -f "$2"); OUT=$(mkdir -p "${3:-out-dns323}" && cd "${3:-out-dns323}" && pwd)
BOARD=$(cd "$(dirname "$0")" && pwd); TOP=$(cd "$BOARD/../../.." && pwd)
export ARCH=arm CROSS_COMPILE=${CROSS_COMPILE:-arm-linux-gnueabi-}
KO=$OUT/kbuild; T=$OUT/tmp; rm -rf "$T"; mkdir -p "$KO" "$T"

# limits of the stock U-Boot of the DNS-323 (legacy/alt-f/mkfw.sh)
KERNEL_MAX=1572864
INITRD_MAX=6488064

# 1. kernel: orion5x_defconfig + fragment, zImage and modules
make -s -C "$KSRC" O="$KO" orion5x_defconfig
"$KSRC/scripts/kconfig/merge_config.sh" -m -O "$KO" "$KO/.config" "$BOARD/linux.fragment" >/dev/null
make -s -C "$KSRC" O="$KO" olddefconfig
make -s -C "$KSRC" O="$KO" -j"$(nproc)" zImage modules
KVER=$(make -s -C "$KSRC" O="$KO" kernelrelease)

# U-Boot passes mach-id 526; the board file needs 1542 (0x606):
# 'mov r1,#0x600; orr r1,r1,#6' in front of the zImage (Alt-F's prologue)
printf '\x06\x1c\xa0\xe3\x06\x10\x81\xe3' > "$T/prologue"
cat "$T/prologue" "$KO/arch/arm/boot/zImage" > "$T/tImage"
mkimage -A arm -O linux -T kernel -C none -a 0x00008000 -e 0x00008000 \
	-n "ShareOS Lite test, kernel $KVER" -d "$T/tImage" "$OUT/uImage" >/dev/null
ks=$(stat -c %s "$OUT/uImage")
[ "$ks" -le $KERNEL_MAX ] || { echo "uImage is $ks bytes, too big by $((ks - KERNEL_MAX))"; exit 1; }
echo "uImage: $ks of $KERNEL_MAX bytes ($(( (KERNEL_MAX - ks) / 1024 )) KB free)"

# 2. test initramfs: DNS-320L initramfs + modules + test-init
tar -xf "$SU" -C "$T" urootfs
dd if="$T/urootfs" of="$T/ur.cpio.xz" bs=64 skip=1 status=none
mkdir "$T/root"; (cd "$T/root" && xz -dc "$T/ur.cpio.xz" | cpio -idm --quiet)
rm -rf "$T/root/lib/modules"
make -s -C "$KSRC" O="$KO" INSTALL_MOD_PATH="$T/root" INSTALL_MOD_STRIP=1 DEPMOD=true modules_install
rm -f "$T/root/lib/modules/$KVER/build" "$T/root/lib/modules/$KVER/source"
if command -v depmod >/dev/null; then depmod -b "$T/root" "$KVER"; fi
install -m 0755 "$BOARD/test-init" "$T/root/init"
(cd "$T/root" && find . | cpio -o -H newc --quiet | xz -9 --check=crc32) > "$T/initramfs.cpio.xz"
mkimage -A arm -O linux -T ramdisk -C none -a 0x00800000 -e 0x00800000 \
	-n "ShareOS Lite test, initrd" -d "$T/initramfs.cpio.xz" "$OUT/urootfs" >/dev/null
is=$(stat -c %s "$OUT/urootfs")
[ "$is" -le $INITRD_MAX ] || { echo "urootfs is $is bytes, too big by $((is - INITRD_MAX))"; exit 1; }
echo "urootfs: $is of $INITRD_MAX bytes ($(( (INITRD_MAX - is) / 1024 )) KB free)"

# 3. .bin in the D-Link format, signature of the DNS-323 (7/1/1/1/4/0)
gcc -O2 -o "$T/dns323-fw" "$TOP/src/alt-f-utils/dns323-fw.c"
NAME=ShareOS-Lite-test-DNS-323-rev-AxBxCx
"$T/dns323-fw" -m -q -p 7 -c 1 -l 1 -u 1 -v 4 -t 0 -k "$OUT/uImage" -i "$OUT/urootfs" "$OUT/$NAME.bin"
"$T/dns323-fw" -s -q -k "$T/k" -i "$T/i" "$OUT/$NAME.bin"
cmp "$T/k" "$OUT/uImage"; cmp "$T/i" "$OUT/urootfs"
(cd "$OUT" && sha1sum "$NAME.bin" > "$NAME.sha1" && sha256sum "$NAME.bin" > "$NAME.bin.sha256")
rm -rf "$T"
echo "created $OUT/$NAME.bin"
