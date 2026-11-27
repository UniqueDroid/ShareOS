#!/bin/bash
#
# ShareOS post-image (Cavium OCTEON boxes: D-Link DNS-1200-05): the files the
# box's U-Boot 1.1.1 (Cavium SDK) can start.
#
# The kernel is an ELF file with the whole system as its initramfs:
#   …-devtest.elf     for "bootoctlinux <address>" at the U-Boot prompt
#   …-devtest.uImage  the same file in the wrapper D-Link's own start uses
#                     (jffs2 file "uImage": type kernel, mips64, uncompressed)
#
# U-Boot reads the file from a JFFS2 of 30 MiB (kernel1-initrd / kernel2-initrd)
# into its load area at 0x20000000 (96 MiB) and unpacks the ELF segments to
# 0x1100000; 128 MiB are reserved for the kernel.
#   ELF_MAX    the file itself: half of the load area
#   JFFS2_MAX  what it needs in the JFFS2. That compresses with zlib in pages
#              of 4 KiB (the kernel code shrinks, the xz initramfs does not);
#              the gzip size of the file is taken as the estimate, and 8 MiB
#              are left for the node headers, the worse ratio of small pages
#              and the blocks JFFS2 keeps free.
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
JFFS2_MAX=23068672

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
packed=$(gzip -6 -c "$B/vmlinux.stripped" | wc -c)
if [ "$packed" -gt "$JFFS2_MAX" ]; then
	echo "post-image: the kernel with its initramfs needs about $packed bytes in the JFFS2, more than $JFFS2_MAX"
	exit 1
fi

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
	for f in "$out.elf" "$out.uImage"; do
		(cd "$B" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256")
	done
	echo "post-image: $(basename "$out").elf $(basename "$out").uImage ($size bytes, about $packed in a JFFS2)"
done
rm -f "$B/vmlinux.stripped"
