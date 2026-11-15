#!/bin/bash
#
# Tests the first installation (shareos-firstinstall) in the built ARM
# initramfs with qemu-user: package from a "USB stick" folder or from a
# release list (file:// URLs), checks for damaged/foreign packages and the
# signature of downloads (pk_verify of the initramfs). Flash
# tools and shareos-install-ubi are stand-ins working on files.
#
#   sudo tests/test-firstinstall.sh [output/dns320l]
#
# own UTS name space: start scripts of the box set the host name, which
# would otherwise change the host name of the build machine
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
IMG=$OUT/images
CPIO=$IMG/initramfs.cpio.xz
PKG=$(ls -t $IMG/ShareOS-*-DNS-320L-rev-Ax.sysupgrade.tar | head -1)   # the fake box is a DNS-320L
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$CPIO" ] && [ -f "$PKG" ] || { echo "build first"; exit 1; }

T=$(mktemp -d /tmp/shareos-fi-test.XXXX)
R=$T/root
trap 'rm -rf "$T"' EXIT     # nothing is mounted below $R in this test
if [ ! -e /proc/sys/fs/binfmt_misc/qemu-arm ]; then
	[ -e /proc/sys/fs/binfmt_misc/register ] || mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
	echo ":qemu-arm:M::\x7fELF\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x28\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:$QEMU:F" \
		> /proc/sys/fs/binfmt_misc/register
fi
mkdir -p $R && (cd $R && xz -dc "$CPIO" | cpio -id --quiet 2>/dev/null)
# a fake flash: /proc/mtd and /dev/mtdN are plain files (no /proc mounted)
mkdir -p $R/proc $R/dev $R/tmp $R/usb $R/rel
printf 'dev:    size   erasesize  name\nmtd1: 00500000 00020000 "uImage"\nmtd2: 00500000 00020000 "ramdisk"\nmtd3: 06400000 00020000 "image"\n' > $R/proc/mtd
blank() { head -c 5242880 /dev/zero | tr '\0' '\377' > "$1"; }
blank $R/dev/mtd1; blank $R/dev/mtd2
# curl (OpenSSL) needs random numbers; on the box devtmpfs provides these
mknod -m 666 $R/dev/urandom c 1 9; mknod -m 666 $R/dev/random c 1 8; [ -e $R/dev/null ] || mknod -m 666 $R/dev/null c 1 3
cat > $R/usr/sbin/flash_erase <<'S'
#!/bin/sh
head -c 5242880 /dev/zero | tr '\000' '\377' > "$2"; echo "erase $2" >> /tmp/calls
S
cat > $R/usr/sbin/nandwrite <<'S'
#!/bin/sh
dd if="$4" of="$3" conv=notrunc 2>/dev/null; echo "write $3" >> /tmp/calls
S
cat > $R/usr/sbin/nanddump <<'S'
#!/bin/sh
# nanddump -q -l <len> /dev/mtdN  (to stdout)
head -c "$3" "$4"
S
cat > $R/usr/sbin/shareos-install-ubi <<'S'
#!/bin/sh
echo "install-ubi $*" >> /tmp/calls; cp "$1" /tmp/installed.squashfs
S
chmod 755 $R/usr/sbin/flash_erase $R/usr/sbin/nandwrite $R/usr/sbin/nanddump $R/usr/sbin/shareos-install-ubi

run() { chroot $R /usr/bin/env -i "$@" /bin/sh /usr/sbin/shareos-firstinstall >$T/out 2>&1; echo $?; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; sed 's/^/      /' $T/out | tail -5; failed=$((failed+1)); fi; }
X=$T/x; mkdir -p $X && tar -xf "$PKG" -C $X
FW=$(sed -n 's/^SHAREOS_FWNAME="\(.*\)"/\1/p' $X/shareos-release)
NAME=$(basename "$PKG")

cp "$PKG" $R/usb/
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/none.json)
check "USB: package found, checked and installed" "[ $rc = 0 ] && grep -q 'install-ubi rootfs.squashfs --yes' $R/tmp/calls && cmp -s $R/tmp/installed.squashfs $X/rootfs.squashfs"
check "USB: kernel and initramfs written from the package" "cmp -s <(head -c \$(stat -c %s $X/uImage) $R/dev/mtd1) $X/uImage && cmp -s <(head -c \$(stat -c %s $X/urootfs) $R/dev/mtd2) $X/urootfs"
: > $R/tmp/calls
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1)
check "same kernel again: not rewritten" "[ $rc = 0 ] && ! grep -q '^erase' $R/tmp/calls && grep -q 'already up to date' $T/out"

# damaged package: one byte of the system changed
rm -f $R/usb/*; D=$T/d; cp -a $X $D
printf 'X' | dd of=$D/rootfs.squashfs bs=1 seek=100000 conv=notrunc 2>/dev/null
(cd $D && tar -cf $R/usb/$NAME uImage urootfs rootfs.squashfs shareos-release SHA256SUMS)
: > $R/tmp/calls
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/none.json)
check "damaged package rejected, nothing written" "[ $rc = 1 ] && grep -q 'damaged' $R/tmp/firstinstall.err && ! grep -q 'install-ubi' $R/tmp/calls"

# package for another device (consistent checksums)
rm -f $R/usb/*; F=$T/f; cp -a $X $F
sed -i 's/^SHAREOS_FWNAME=.*/SHAREOS_FWNAME="DNS-325-rev-Ax"/' $F/shareos-release
(cd $F && sha256sum uImage urootfs rootfs.squashfs shareos-release > SHA256SUMS && tar -cf $R/usb/$NAME uImage urootfs rootfs.squashfs shareos-release SHA256SUMS)
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/none.json)
check "package for another device rejected" "[ $rc = 1 ] && grep -q 'another device' $R/tmp/firstinstall.err"

check "USB: installed without a signature although the box has the release key" "grep -q 'BEGIN PUBLIC KEY' $R/etc/shareos/release.pub && [ -x $R/usr/bin/pk_verify ]"

# download from a release list. Downloads must be signed: the test puts its
# own public key into the fake box and signs like the release build does.
rm -f $R/usb/*
openssl ecparam -name prime256v1 -genkey -noout -out $T/rel.key 2>/dev/null
openssl ecparam -name prime256v1 -genkey -noout -out $T/other.key 2>/dev/null
cp $R/etc/shareos/release.pub $T/project.pub
openssl ec -in $T/rel.key -pubout -out $R/etc/shareos/release.pub 2>/dev/null
cp "$PKG" $R/rel/$NAME; (cd $R/rel && sha256sum $NAME > $NAME.sha256)
cat > $R/rel/releases.json <<J
[ { "tag_name": "v9", "assets": [ { "browser_download_url": "file:///rel/$NAME.sha256" }, { "browser_download_url": "file:///rel/$NAME" } ] } ]
J
: > $R/tmp/calls
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/releases.json)
check "download without a signature rejected, nothing written" "[ $rc = 1 ] && grep -q 'not signed' $R/tmp/firstinstall.err && ! grep -q 'install-ubi\|^write' $R/tmp/calls"
openssl dgst -sha256 -sign $T/other.key -out $R/rel/$NAME.sig $R/rel/$NAME
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/releases.json)
check "download signed with another key rejected" "[ $rc = 1 ] && grep -q 'signature' $R/tmp/firstinstall.err && ! grep -q 'install-ubi' $R/tmp/calls"
openssl dgst -sha256 -sign $T/rel.key -out $R/rel/$NAME.sig $R/rel/$NAME
echo tampered >> $R/rel/$NAME; (cd $R/rel && sha256sum $NAME > $NAME.sha256)
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/releases.json)
check "download changed after signing rejected (although its .sha256 fits)" "[ $rc = 1 ] && grep -q 'signature' $R/tmp/firstinstall.err && ! grep -q 'install-ubi' $R/tmp/calls"
cp "$PKG" $R/rel/$NAME; (cd $R/rel && sha256sum $NAME > $NAME.sha256)
cp $T/project.pub $R/etc/shareos/release.pub
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/releases.json)
check "the key of the project does not accept a signature of the test key" "[ $rc = 1 ] && grep -q 'signature' $R/tmp/firstinstall.err"
openssl ec -in $T/rel.key -pubout -out $R/etc/shareos/release.pub 2>/dev/null
cat > $R/rel/releases.json <<J
[ { "tag_name": "v9", "assets": [ { "browser_download_url": "file:///rel/$NAME.sha256" }, { "browser_download_url": "file:///rel/$NAME" } ] } ]
J
blank $R/dev/mtd1; blank $R/dev/mtd2; : > $R/tmp/calls
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/releases.json)
check "download: newest package for this box, signature and checksum verified, installed" "[ $rc = 0 ] && grep -q 'install-ubi' $R/tmp/calls && grep -q 'download' $T/out && grep -q 'signature of the ShareOS project: valid' $T/out"
echo 0000000000000000000000000000000000000000000000000000000000000000 > $R/rel/$NAME.sha256
: > $R/tmp/calls
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/releases.json)
check "download with a wrong checksum rejected" "[ $rc = 1 ] && grep -q 'checksum' $R/tmp/firstinstall.err && ! grep -q 'install-ubi' $R/tmp/calls"
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/missing.json)
check "no package anywhere: clear message" "[ $rc = 1 ] && grep -q 'GitHub not reachable' $R/tmp/firstinstall.err"
check "initramfs has the USB modules" "ls $R/lib/modules/*/kernel/drivers/usb/storage/usb-storage.ko >/dev/null && ls $R/lib/modules/*/kernel/fs/fat/vfat.ko >/dev/null && ls $R/lib/modules/*/kernel/fs/ext4/ext4.ko >/dev/null"
mv $R/etc/shareos/release.pub $T/test.pub; rm -f $R/rel/$NAME.sig; (cd $R/rel && sha256sum $NAME > $NAME.sha256)
blank $R/dev/mtd1; blank $R/dev/mtd2; : > $R/tmp/calls
rc=$(run FI_SRC_DIR=/usb FI_NO_NET=1 FI_API=file:///rel/releases.json)
check "no key file in the initramfs: signature check off, checksum still decides" "[ $rc = 0 ] && grep -q 'install-ubi' $R/tmp/calls"
check "initramfs has curl with CA certificates" "[ -x $R/usr/bin/curl ] && [ -s $R/etc/ssl/certs/ca-certificates.crt ]"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
