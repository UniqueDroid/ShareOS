#!/bin/bash
#
# ShareOS post-image (Cavium OCTEON boxes: D-Link DNS-1200-05): the files the
# box's U-Boot 1.1.1 (Cavium SDK) can start.
#
# The kernel is an ELF file with the whole system as its initramfs:
#   …-devtest.uImage    in the wrapper D-Link's own start uses (type kernel,
#                       mips64, uncompressed): "bootoctlinux <address>" of this
#                       U-Boot checks that header before it reads the ELF file
#   …-devtest.elf       the ELF file itself
#   …-devtest.uRamdisk  an empty initramfs in the ramdisk wrapper, in case
#                       bootoctlinux insists on one at rd_start (D-Link's start
#                       always passes it)
#
# U-Boot gets the file into its load area at 0x20000000 (96 MiB) from the
# flash – "nand read" of a raw partition (app1/app2: 80 MiB) or "jffs2load"
# (kernel1-initrd/kernel2-initrd: a JFFS2 of 30 MiB) – and unpacks the ELF
# segments to 0x1100000, where 128 MiB are reserved for the kernel. ELF_MAX
# keeps the file within a partition of 80 MiB and half of the load area.
#
# All models of this platform are being added: status "devtest" (BOARD_DEVTEST=1
# in board.sh, root keeps the password "shareos"). The files are named
# ShareOS-<version>-<name>-devtest.* and are never part of a release.
#
set -euo pipefail

BOARD_DIR="$(dirname "$0")"
TOP_DIR="$(cd "$BOARD_DIR/../../.." && pwd)"
B="$BINARIES_DIR"
MKIMAGE="$HOST_DIR/bin/mkimage"

VERSION="$("$TOP_DIR/scripts/version.sh")"
ELF_MAX=50331648

#   firmware name        status
MODELS="
DNS-1200-05-rev-Ax   devtest
"

[ -s "$B/vmlinux" ] || { echo "post-image: vmlinux missing"; exit 1; }
STRIP=$(ls "$HOST_DIR"/bin/*-linux-*-strip 2>/dev/null | head -1)
[ -x "$STRIP" ] || { echo "post-image: no strip of the toolchain in $HOST_DIR/bin"; exit 1; }

# without symbols and debug sections: U-Boot only needs the program headers
cp "$B/vmlinux" "$B/vmlinux.stripped"
"$STRIP" --strip-all "$B/vmlinux.stripped"

desc=$(file -b "$B/vmlinux.stripped")
case "$desc" in
	"ELF 64-bit MSB executable, MIPS"*) ;;
	*) echo "post-image: vmlinux is not a 64-bit big-endian MIPS executable: $desc"; exit 1 ;;
esac
size=$(stat -c %s "$B/vmlinux.stripped")
if [ "$size" -gt "$ELF_MAX" ]; then
	echo "post-image: the kernel with its initramfs has $size bytes, more than $ELF_MAX"
	exit 1
fi
# an empty cpio archive (xz, the only compression of this kernel) as a ramdisk
: | cpio -o -H newc 2>/dev/null | xz --check=crc32 > "$B/empty.cpio.xz"

rm -f "$B"/ShareOS-*
echo "$MODELS" | while read -r name status; do
	[ -n "$name" ] || continue
	suffix=
	[ "$status" = devtest ] && suffix=-devtest
	out="$B/ShareOS-$VERSION-$name$suffix"
	cp "$B/vmlinux.stripped" "$out.elf"
	# load and entry address 0 like D-Link's uImage: U-Boot takes both from the ELF file
	"$MKIMAGE" -A mips64 -O linux -T kernel -C none -a 0 -e 0 \
		-n "ShareOS $VERSION" -d "$B/vmlinux.stripped" "$out.uImage" >/dev/null
	"$MKIMAGE" -A mips64 -O linux -T ramdisk -C none -a 0 -e 0 \
		-n "ShareOS empty" -d "$B/empty.cpio.xz" "$out.uRamdisk" >/dev/null
	for f in "$out.elf" "$out.uImage" "$out.uRamdisk"; do
		(cd "$B" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256")
	done
	echo "post-image: $(basename "$out").elf, .uImage, .uRamdisk ($size bytes)"
done
rm -f "$B/vmlinux.stripped" "$B/empty.cpio.xz"
