#!/bin/bash
#
# Checks the load address in the header of the initramfs (urootfs) of every
# sysupgrade bundle of a build: 0x01000000 on the DNS-325, 0x00800000 on the
# other models (see post-image.sh). A wrong address means a reboot loop that
# needs a serial console, so this runs after every firmware build.
#
#   tests/check-initrd-address.sh output/dns320l/images
#
set -u
DIR=${1:?folder with the ShareOS-*.sysupgrade.tar files}
pass=0; failed=0
for tar in "$DIR"/ShareOS-*.sysupgrade.tar; do
	[ -f "$tar" ] || { echo "no sysupgrade bundle in $DIR"; exit 1; }
	model=$(basename "$tar" .sysupgrade.tar); model=${model#ShareOS-*-DNS}; model=DNS$model
	case "$model" in
		DNS-325-*) want=01000000 ;;
		*) want=00800000 ;;
	esac
	# u-boot image header: magic(4) crc(4) time(4) size(4) load(4) ...
	got=$(tar -xOf "$tar" urootfs | od -An -tx1 -j16 -N4 | tr -d ' \n')
	if [ "$got" = "$want" ]; then
		echo "PASS  $model: initramfs load address 0x$got"; pass=$((pass+1))
	else
		echo "FAIL  $model: initramfs load address 0x$got, expected 0x$want"; failed=$((failed+1))
	fi
done
echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
