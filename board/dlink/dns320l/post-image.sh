#!/bin/bash
#
# ShareOS post-image (D-Link Kirkwood models: DNS-320L, DNS-320 rev A/B,
# DNS-325): builds the firmware files in the D-Link container format,
# flashable / "TryIt"-able from the stock web UI, Alt-F and ShareOS, and the
# sysupgrade bundles. Replaces Alt-F's mkfw.sh for these boards.
#
# Layout and limits (stock U-Boot, see legacy/alt-f/mkfw.sh NOTE-2):
#   uImage  partition 5 MB, U-Boot reads 0x300000 -> uImage   <= 3145728
#   ramdisk partition 5 MB, U-Boot reads 0x300000 -> urootfs  <= 3145728
#   (one urootfs.<model> per model, they differ only in the load address)
#
set -euo pipefail

BOARD_DIR="$(dirname "$0")"
TOP_DIR="$(cd "$BOARD_DIR/../../.." && pwd)"
B="$BINARIES_DIR"
MKIMAGE="$HOST_DIR/bin/mkimage"
FW="$HOST_DIR/bin/dns323-fw"

VERSION="$("$TOP_DIR/scripts/version.sh")"
KERNEL_MAX=3145728
INITRD_MAX=3145728

# The Kirkwood models: one kernel, one initramfs and one system for all, a
# uImage per model (zImage + its device tree, U-Boot passes none), an initramfs
# header per model (load address, see below) and a .bin with the D-Link
# signature of the model (legacy/alt-f/mkfw.sh).
#   firmware name     device tree        product custom model sub nver type  initramfs address
MODELS="
DNS-320L-rev-Ax   kirkwood-dns320l   0 8 11 1 1 6   0x00800000
DNS-320-rev-Bx    kirkwood-dns320b   0 8 12 1 1 5   0x00800000
DNS-320-rev-Ax    kirkwood-dns320    0 8  7 2 0 4   0x01000000
DNS-325-rev-Ax    kirkwood-dns325    0 8  5 2 0 3   0x01000000
"

KVER=$(sed -n 's/^BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE="\(.*\)"/\1/p' "$BR2_CONFIG")

# small initramfs (rescue system + UBI loader) for the 'ramdisk' partition
"$BOARD_DIR/mk-initramfs.sh" "$TARGET_DIR" "$B" "$HOST_DIR" "$BOARD_DIR"
[ -s "$B/rootfs.squashfs" ] || { echo "post-image: rootfs.squashfs missing"; exit 1; }

# Load address of the initramfs (last column of MODELS): the stock U-Boot reads
# the ramdisk partition to 0xf00000 and copies it here before it starts the
# kernel. 0x800000 is what Alt-F uses and what the DNS-320L has booted with.
# On the DNS-325 it is inside memory that is in use: the kernel prints
# "INITRD: ... overlaps in-use memory region - disabling initrd", finds no
# /init and panics in a reboot loop. 0x1000000 booted from flash on a DNS-325
# rev A1. The DNS-320 rev A (88F6281 and U-Boot of the DNS-325 family) showed
# the same reboot loop with 0x800000 (#96), so it gets 0x1000000 too; the
# DNS-320 rev B (board of the DNS-320L) keeps 0x800000 until tried (a wrong
# address means a reboot loop that needs a serial console). The kernel is the same everywhere, so what is in
# use at 0x800000 depends on the board or its U-Boot (not found yet).
# Only the header differs: the data of the initramfs is the same for all.

check_size() {
	local f=$1 max=$2 sz
	sz=$(stat -c %s "$f")
	if [ "$sz" -gt "$max" ]; then
		echo "post-image: $(basename "$f") is $sz bytes, too big by $((sz - max)) (max $max)" >&2
		exit 1
	fi
	echo "post-image: $(basename "$f") $sz bytes, $((max - sz)) bytes free"
}

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

echo "$MODELS" | while read -r NAME DTB PROD CUST MODEL SUB NVER TYPE INITRD_ADDR; do
	[ -n "$NAME" ] || continue
	ZIMAGE="$B/zImage.$DTB"
	[ -f "$ZIMAGE" ] || { echo "post-image: $ZIMAGE missing"; exit 1; }
	UIMAGE="$B/uImage.$NAME"
	UROOTFS="$B/urootfs.$NAME"
	OUT="ShareOS-${VERSION}-${NAME}.bin"

	"$MKIMAGE" -A arm -O linux -T kernel -C none -a 0x00008000 -e 0x00008000 \
		-n "ShareOS-${VERSION}, kernel ${KVER}" -d "$ZIMAGE" "$UIMAGE" >/dev/null
	check_size "$UIMAGE" $KERNEL_MAX

	"$MKIMAGE" -A arm -O linux -T ramdisk -C none -a $INITRD_ADDR -e $INITRD_ADDR \
		-n "ShareOS-${VERSION}, initrd" -d "$B/initramfs.cpio.xz" "$UROOTFS" >/dev/null
	"$MKIMAGE" -l "$UROOTFS" | grep -q "Load Address: $(printf '%08x' $((INITRD_ADDR)))" \
		|| { echo "post-image: initramfs load address of $NAME is not $INITRD_ADDR" >&2; exit 1; }
	check_size "$UROOTFS" $INITRD_MAX

	rm -f "$B/$OUT"
	"$FW" -m -q -p $PROD -c $CUST -l $MODEL -u $SUB -v $NVER -t $TYPE \
		-k "$UIMAGE" -i "$UROOTFS" "$B/$OUT"

	# verify: split again and compare with the parts
	"$FW" -s -q -k "$T/kernel" -i "$T/initramfs" "$B/$OUT"
	cmp "$T/kernel" "$UIMAGE"
	cmp "$T/initramfs" "$UROOTFS"
	"$MKIMAGE" -l "$T/kernel" >/dev/null
	"$MKIMAGE" -l "$T/initramfs" >/dev/null

	(cd "$B" && sha256sum "$OUT" > "$OUT.sha256")
	# Alt-F's firmware page accepts an optional *.sha1 file next to the .bin
	(cd "$B" && sha1sum "$OUT" > "${OUT%.bin}.sha1")
	"$FW" -f "$B/$OUT" >/dev/null || true
	echo "post-image: created $B/$OUT"

	# sysupgrade bundle: everything for an update from ShareOS (shareos-update)
	# and for a netboot via TFTP (U-Boot loads uImage + urootfs, the initramfs
	# fetches rootfs.squashfs). Published in GitHub Releases with its .sha256.
	# The bundle names its model in shareos-release (SHAREOS_FWNAME).
	SU="ShareOS-${VERSION}-${NAME}.sysupgrade.tar"
	P="$T/su-$NAME"; mkdir -p "$P"
	cp "$UIMAGE" "$P/uImage"; cp "$UROOTFS" "$P/urootfs"
	ln -f "$B/rootfs.squashfs" "$P/rootfs.squashfs" 2>/dev/null || cp "$B/rootfs.squashfs" "$P/rootfs.squashfs"
	sed "s/^SHAREOS_FWNAME=.*/SHAREOS_FWNAME=\"$NAME\"/" "$TARGET_DIR/etc/shareos-release" > "$P/shareos-release"
	(cd "$P" && sha256sum uImage urootfs rootfs.squashfs > SHA256SUMS \
		&& rm -f "$B/$SU" && tar -cf "$B/$SU" uImage urootfs rootfs.squashfs shareos-release SHA256SUMS)
	(cd "$B" && sha256sum "$SU" > "$SU.sha256")
	rm -rf "$P"
	echo "post-image: created $B/$SU"
done

# the DNS-320L parts under their old names (netboot docs, tools)
cp "$B/uImage.DNS-320L-rev-Ax" "$B/uImage"
cp "$B/urootfs.DNS-320L-rev-Ax" "$B/urootfs"
echo "post-image: rootfs.squashfs $(stat -c %s "$B/rootfs.squashfs") bytes (UBI volume 'rootfs')"
