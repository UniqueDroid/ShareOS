#!/bin/bash
#
# ShareOS post-build (DNS-320L), runs before the rootfs images are made.
# $1 = TARGET_DIR
#
set -e

TARGET_DIR="$1"
BOARD_DIR="$(dirname "$0")"
TOP_DIR="$(cd "$BOARD_DIR/../../.." && pwd)"

VERSION="$("$TOP_DIR/scripts/version.sh")"
case "$VERSION" in
	0.0-*) STAGE=dev ;;          # untagged build
	*-*) STAGE=beta ;;           # v1.2.0-beta.1, -rc.1 ...
	*) STAGE=stable ;;
esac

cat > "$TARGET_DIR/etc/shareos-release" <<EOF
SHAREOS_VERSION="$VERSION"
SHAREOS_BOARD="dns320l"
SHAREOS_FWNAME="DNS-320L-rev-Ax"
SHAREOS_STAGE="$STAGE"
EOF

# All kernel modules stay in the squashfs root; the small initramfs needs
# none (UBI, UBIFS, squashfs and overlayfs are built into the kernel).

# The UBI installer is part of both the initramfs and the full system
install -D -m 0755 "$BOARD_DIR/initramfs/usr/sbin/shareos-install-ubi" "$TARGET_DIR/usr/sbin/shareos-install-ubi"

# Nothing in the test system needs these
rm -rf "$TARGET_DIR/usr/share/man" "$TARGET_DIR/usr/share/doc" \
	"$TARGET_DIR/usr/lib/pkgconfig" "$TARGET_DIR/usr/include"

# clean UBIFS overlay on shutdown (runs after rcK, before umount -a)
grep -q shareos-shutdown "$TARGET_DIR/etc/inittab" || \
	sed -i 's|^::shutdown:/sbin/swapoff -a|&\n::shutdown:/usr/sbin/shareos-shutdown|' "$TARGET_DIR/etc/inittab"

# mbedtls installs ~60 demo/test programs; ShareOS needs three (shareos-cert)
for p in aead_demo benchmark cert_req cipher_aead_demo crl_app crypt_and_hash crypto_examples \
	dh_client dh_genprime dh_server dlopen dtls_client dtls_server ecdh_curve25519 ecdsa \
	gen_entropy gen_random_ctr_drbg generic_sum hello hmac_demo key_app key_app_writer \
	key_ladder_demo key_ladder_demo.sh load_roots md_hmac_demo metatest mini_client mpi_demo \
	pem2der pk_decrypt pk_encrypt pk_sign pk_verify psa_constant_names psa_hash psa_hash_demo.sh \
	query_compile_time_config query_included_headers req_app rsa_decrypt rsa_encrypt rsa_genkey \
	rsa_sign rsa_sign_pss rsa_verify rsa_verify_pss selftest ssl_client1 ssl_client2 \
	ssl_context_info ssl_fork_server ssl_mail_client ssl_pthread_server ssl_server ssl_server2 \
	strerror udp_proxy udp_proxy_wrapper.sh zeroize; do
	rm -f "$TARGET_DIR/usr/bin/$p"
done

# busybox nslookup cannot read resolv.conf lines with a trailing comment, and
# udhcpc tags its lines with "# <interface>". The box has one interface, so
# write plain lines and replace all DNS lines on renew instead.
DS="$TARGET_DIR/usr/share/udhcpc/default.script"
if [ -f "$DS" ]; then
	sed -i -e 's/ # \$interface" >> \$RESOLV_CONF/" >> $RESOLV_CONF/' \
		-e 's/grep -vE "# \$interface\\\$" \$RESOLV_CONF/grep -vE "^(nameserver|search|domain) " $RESOLV_CONF/' "$DS"
fi

# NFS and rpcbind only run when there is an NFS share: shareos-shares starts
# them, so they must not start at boot by themselves
for f in S30rpcbind:rpcbind S60nfs:nfs; do
	if [ -f "$TARGET_DIR/etc/init.d/${f%%:*}" ]; then
		mv "$TARGET_DIR/etc/init.d/${f%%:*}" "$TARGET_DIR/etc/init.d/${f#*:}"
	fi
done

# USB sticks and disks: mounted when plugged in, cleaned up when pulled
# (shareos-usb ignores the internal SATA disks)
grep -q shareos-usb "$TARGET_DIR/etc/mdev.conf" || \
	printf 'sd[a-z][0-9]*\troot:disk 660 */usr/sbin/shareos-usb hotplug\n' >> "$TARGET_DIR/etc/mdev.conf"

# ntfs-3g: only mkntfs/ntfslabel are used (mounting goes through the kernel's ntfs3)
for p in ntfs-3g ntfs-3g.probe lowntfs-3g ntfscat ntfscluster ntfscmp ntfsfix ntfsinfo ntfsls \
	ntfscp ntfsclone ntfsresize ntfsundelete ntfstruncate ntfsmove ntfsdecrypt ntfswipe ntfsusermap ntfssecaudit; do
	rm -f "$TARGET_DIR/bin/$p" "$TARGET_DIR/usr/bin/$p" "$TARGET_DIR/sbin/$p" "$TARGET_DIR/usr/sbin/$p"
done
rm -f "$TARGET_DIR/sbin/mount.ntfs" "$TARGET_DIR/sbin/mount.ntfs-3g" "$TARGET_DIR/sbin/mount.lowntfs-3g"

# btrfs-progs: mkfs.btrfs, btrfs and the check are enough
rm -f "$TARGET_DIR"/usr/bin/btrfs-convert "$TARGET_DIR"/usr/bin/btrfs-image "$TARGET_DIR"/usr/bin/btrfs-map-logical \
	"$TARGET_DIR"/usr/bin/btrfs-select-super "$TARGET_DIR"/usr/bin/btrfs-find-root "$TARGET_DIR"/usr/bin/btrfstune

# ---- unused parts (feature lock, 0.2.0) -------------------------------------
# Programs and libraries no part of ShareOS uses. tools/check-elf-deps.py
# below fails the build if a remaining program still needs one of them.
# (paths without spaces; * expands inside the target)
rm_t() { for p in "$@"; do rm -rf "$TARGET_DIR"/$p; done; }
# OpenSSL: only ttyd selected it; libwebsockets uses mbedtls (external.mk)
rm_t usr/lib/libssl.so* usr/lib/libcrypto.so* usr/lib/ossl-modules usr/lib/engines-3 \
	usr/bin/openssl usr/bin/c_rehash etc/ssl/openssl.cnf etc/ssl/ct_log_list.cnf* etc/ssl/misc
# GLib: ksmbd only needs libglib itself, not GIO/GObject and their tools
rm_t usr/bin/gapplication usr/bin/gdbus usr/bin/gio usr/bin/gio-querymodules usr/bin/gresource \
	usr/bin/gsettings usr/bin/gi-compile-repository usr/bin/gi-decompile-typelib usr/bin/gi-inspect-typelib \
	usr/bin/glib-compile-schemas usr/bin/glib-compile-resources usr/bin/gobject-query usr/bin/gtester \
	usr/lib/libgio-2.0.so* usr/lib/libgobject-2.0.so* usr/lib/libgmodule-2.0.so* usr/lib/libgthread-2.0.so* \
	usr/lib/libgirepository-2.0.so* usr/lib/libffi.so* usr/lib/gio usr/lib/girepository-1.0 usr/share/glib-2.0
rm_t usr/bin/pcre2test usr/bin/pcre2grep usr/lib/libpcre2-posix.so*
# event loops of libwebsockets other than libuv (ttyd), avahi bindings,
# libevent beyond libevent_core (in a clean build it also links OpenSSL)
rm_t usr/lib/libwebsockets-evlib_glib.so usr/lib/libwebsockets-evlib_event.so \
	usr/lib/libavahi-glib.so* usr/lib/libavahi-libevent.so* \
	usr/lib/libevent-2.1.so* usr/lib/libevent.so usr/lib/libevent_extra* usr/lib/libevent_pthreads* \
	usr/lib/libevent_openssl*
# libnl parts ksmbd does not use; C++ binding of libgpiod; e2fsprogs' libss
rm_t usr/lib/libnl-idiag-3.so* usr/lib/libnl-nf-3.so* usr/lib/libnl-xfrm-3.so* usr/lib/libnl-route-3.so* \
	usr/lib/libgpiodcxx.so* usr/lib/libss.so* usr/share/ss
# tools nothing calls: SQLite shell (fsidd keeps the library), SMART daemon
# (ShareOS reads SMART itself), mdmon (only for IMSM/DDF metadata), lzo
# examples, gpio tools besides gpioget/gpioset, the leap-second time zones
# ("right/"; the zones themselves are links into "posix/")
rm_t usr/bin/sqlite3 usr/sbin/smartd usr/sbin/update-smart-drivedb etc/smartd.conf etc/smartd_warning.sh \
	sbin/mdmon usr/libexec/lzo usr/bin/gpiodetect usr/bin/gpioinfo usr/bin/gpiomon usr/bin/gpionotify \
	usr/share/zoneinfo/right
# strace and iperf3 are system apps now (sysapps/); gone here also in
# incremental builds, where buildroot keeps files of removed packages
rm_t usr/bin/strace usr/bin/strace-log-merge usr/bin/iperf3 usr/lib/libiperf.so*
# every program and library must still find its libraries
python3 "$TOP_DIR/tools/check-elf-deps.py" "$TARGET_DIR"
