#!/bin/bash
#
# Builds the small ShareOS initramfs (rescue system + UBI loader) from the
# buildroot target directory.  Result: $BINARIES_DIR/initramfs.cpio.xz
#
#   mk-initramfs.sh <TARGET_DIR> <BINARIES_DIR> <HOST_DIR> <BOARD_DIR>
#
set -euo pipefail
TARGET=$1 OUT=$2 HOSTD=$3 BOARD=$4

R=$(mktemp -d)
trap 'rm -rf "$R"' EXIT

# programs needed besides busybox
BINS="
usr/sbin/dropbear usr/bin/scp usr/bin/dropbearkey
usr/sbin/ubiattach usr/sbin/ubidetach usr/sbin/ubimkvol usr/sbin/ubirmvol
usr/sbin/ubiupdatevol usr/sbin/ubiformat usr/sbin/ubiblock usr/sbin/ubinfo
usr/sbin/nanddump usr/sbin/nandwrite usr/sbin/flash_erase usr/sbin/mtdinfo
usr/sbin/dns323-fw
usr/bin/curl
usr/bin/pk_verify
"
FILES="
etc/passwd etc/group etc/shadow etc/shells etc/shareos-release
usr/lib/shareos/board.sh
usr/share/udhcpc/default.script
etc/ssl/certs/ca-certificates.crt
etc/shareos/release.pub
"

copy() { # copy a path from the target, keeping symlinks
	local p=$1
	[ -e "$TARGET/$p" ] || [ -L "$TARGET/$p" ] || { echo "mk-initramfs: missing $p" >&2; exit 1; }
	mkdir -p "$R/$(dirname "$p")"
	cp -a "$TARGET/$p" "$R/$p"
	if [ -L "$TARGET/$p" ]; then # follow the link target too
		local t; t=$(cd "$TARGET/$(dirname "$p")" && realpath -m --relative-to="$TARGET" "$(readlink "$TARGET/$p")")
		[ -e "$R/$t" ] || copy "$t"
	fi
}

# busybox and all its applet links
copy bin/busybox
(cd "$TARGET" && find . -type l -lname '*busybox' | sed 's|^\./||') | while read -r l; do copy "$l"; done

for p in $BINS $FILES; do copy "$p"; done

# shared libraries (NEEDED, recursively) – musl: libc.so is also the loader
READELF=$(ls "$HOSTD"/bin/*-readelf | head -1)
copy lib/ld-musl-arm.so.1
need_libs() {
	find "$R" -type f -perm /111 | while read -r f; do
		"$READELF" -d "$f" 2>/dev/null | sed -n 's/.*NEEDED.*\[\(.*\)\]/\1/p'
	done | sort -u
}
for round in 1 2 3; do
	for lib in $(need_libs); do
		for d in lib usr/lib; do
			if [ -e "$TARGET/$d/$lib" ]; then [ -e "$R/$d/$lib" ] || copy "$d/$lib"; break; fi
		done
	done
done

# kernel modules for the first installation from a USB stick or disk
KV=$(ls "$TARGET/lib/modules" | head -1)
MODS="usb-common usbcore ehci-hcd ehci-orion usb-storage fat vfat exfat mbcache jbd2 ext4 nls_cp437 nls_iso8859-1"
DEP="$TARGET/lib/modules/$KV/modules.dep"
want=""
for m in $MODS; do
	line=$(grep -E "(^|/)$m\.ko(\.[a-z]+)?:" "$DEP" || true)
	[ -n "$line" ] || { echo "mk-initramfs: module $m not found" >&2; exit 1; }
	want="$want ${line%%:*} ${line#*:}"
done
for f in $(echo $want | tr ' ' '\n' | sort -u); do copy "lib/modules/$KV/$f"; done
for f in modules.dep modules.alias modules.symbols modules.builtin modules.builtin.modinfo modules.order; do
	[ -e "$TARGET/lib/modules/$KV/$f" ] && copy "lib/modules/$KV/$f"
done

# init and tools
install -m 0755 "$BOARD/initramfs/init" "$R/init"
install -D -m 0755 "$BOARD/initramfs/usr/sbin/shareos-install-ubi" "$R/usr/sbin/shareos-install-ubi"
install -D -m 0755 "$BOARD/initramfs/usr/sbin/shareos-firstinstall" "$R/usr/sbin/shareos-firstinstall"
mkdir -p "$R"/{proc,sys,dev,tmp,run,mnt,root,var,etc/dropbear}
ln -sf /tmp "$R/var/tmp"
echo shareos-rescue > "$R/etc/hostname"
printf 'export PATH=/sbin:/bin:/usr/sbin:/usr/bin\nexport PS1="rescue# "\n[ -f /etc/motd ] && cat /etc/motd\n' > "$R/etc/profile"

# cpio with root ownership and the device nodes the kernel needs before /init
"$HOSTD/bin/fakeroot" -- bash -c "
	chown -R 0:0 '$R'
	mknod -m 600 '$R/dev/console' c 5 1
	mknod -m 666 '$R/dev/null' c 1 3
	cd '$R' && find . | LC_ALL=C sort | cpio --quiet -o -H newc
" > "$OUT/initramfs.cpio"
# the kernel's XZ decoder only supports CRC32 checks
xz -f --check=crc32 -9 "$OUT/initramfs.cpio"

echo "mk-initramfs: $(du -sh "$R" | cut -f1) unpacked, $(stat -c %s "$OUT/initramfs.cpio.xz") bytes compressed"
