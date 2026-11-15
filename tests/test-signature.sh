#!/bin/sh
#
# Signed releases: what the release workflow signs (openssl dgst -sha256 -sign,
# ECDSA P-256) must be accepted by the program the box checks with (pk_verify
# of mbedtls) – and nothing else. Needs openssl and pk_verify, of the firmware
# through qemu-arm, e.g.
#
#   tests/test-signature.sh <pk_verify>
#   (a wrapper: exec qemu-arm-static -L <target> <target>/usr/bin/pk_verify "$@")
#
# Also checks that the public key of the firmware is a P-256 key.
TOP=$(cd "$(dirname "$0")/.." && pwd)
V=${1:?pk_verify}
PUB="$TOP/src/shareos-core/etc/shareos/release.pub"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
ok() { "$V" "$1" "$2" >/dev/null 2>&1; }

openssl ecparam -name prime256v1 -genkey -noout -out $T/a.key 2>/dev/null
openssl ecparam -name prime256v1 -genkey -noout -out $T/b.key 2>/dev/null
openssl ec -in $T/a.key -pubout -out $T/a.pub 2>/dev/null
openssl ec -in $T/b.key -pubout -out $T/b.pub 2>/dev/null
head -c 300000 /dev/urandom > $T/fw.tar
openssl dgst -sha256 -sign $T/a.key -out $T/fw.tar.sig $T/fw.tar

check "a signature of the release workflow is accepted" "ok $T/a.pub $T/fw.tar"
check "another key is rejected" "! ok $T/b.pub $T/fw.tar"
cp $T/fw.tar $T/x.tar; cp $T/fw.tar.sig $T/x.tar.sig; echo x >> $T/x.tar
check "a changed file is rejected" "! ok $T/a.pub $T/x.tar"
cp $T/fw.tar $T/y.tar
check "a missing signature is rejected" "! ok $T/a.pub $T/y.tar"
: > $T/y.tar.sig
check "an empty signature is rejected" "! ok $T/a.pub $T/y.tar"
check "the key of the firmware is a P-256 public key" \
	"openssl pkey -pubin -in '$PUB' -noout -text 2>/dev/null | grep -q 'prime256v1'"
cp $T/fw.tar $T/z.tar; cp $T/fw.tar.sig $T/z.tar.sig
check "the key of the firmware does not accept a foreign signature" "! ok '$PUB' $T/z.tar"
RES="${PUB%.pub}-reserve.pub"
check "the reserve key is a P-256 public key, another one than the release key" \
	"openssl pkey -pubin -in '$RES' -noout -text 2>/dev/null | grep -q 'prime256v1' && ! cmp -s '$PUB' '$RES'"
check "the reserve key does not accept a foreign signature" "! ok '$RES' $T/z.tar"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
