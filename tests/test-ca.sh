#!/bin/sh
#
# Tests shareos-ca (own certificate authority): CA, issued certificates with
# their names and server authentication, the web certificate renewed only when
# its names change or it runs out. Needs the mbedtls programs gen_key,
# cert_write and cert_app – of the firmware through qemu-arm, e.g.
#
#   tests/test-ca.sh <dir with uci> <dir with mbedtls programs>
#   (a dir of wrappers: exec qemu-arm-static -L <target> <target>/usr/bin/<prog> "$@")
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
UCIBIN=${1:-}
export SHAREOS_CA_BIN=${2:?mbedtls programs}
P="$TOP/src/shareos-core/usr/sbin/shareos-ca"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p $T/etc/config
: > $T/etc/config/shareos
export SHAREOS_ROOT=$T PATH="${UCIBIN:+$UCIBIN:}$PATH"
run() { sh "$P" "$@"; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
app() { "$SHAREOS_CA_BIN/cert_app" mode=file filename="$1" 2>/dev/null; }

check "info without CA" "run info | grep -q '\"exists\":false'"
check "init creates the CA" "run init | grep -q 'CA created' && [ -s $T/etc/shareos/ca/ca.key ]"
check "init again keeps it" "run init | grep -q 'CA exists'"
check "CA key root only" "[ \$(stat -c %a $T/etc/shareos/ca/ca.key) = 600 ]"
check "CA certificate is a CA" "app $T/etc/shareos/ca/ca.crt | grep -qi 'CA *= *true'"
check "info: subject and fingerprint" "run info | grep -q '\"subject\":\"CN=ShareOS CA testbox, O=ShareOS\"' && run info | grep -qE '\"fingerprint\":\"([0-9A-F]{2}:){31}[0-9A-F]{2}\"'"
check "issue for a host with wildcard and IP" "run issue nas nas.home.lan '*.home.lan' 192.168.1.5 | grep -q issued"
check "issued: names" "app $T/etc/shareos/ca/certs/nas.crt | grep -q 'dNSName *: \\*.home.lan' && app $T/etc/shareos/ca/certs/nas.crt | grep -q 'iPAddress *: 192.168.1.5'"
check "issued: server authentication, signed by the CA" "app $T/etc/shareos/ca/certs/nas.crt | grep -qi 'TLS Web Server' && app $T/etc/shareos/ca/certs/nas.crt | grep -q 'issuer name *: CN=ShareOS CA testbox'"
check "list" "run list | python3 -c \"import json,sys; d=json.load(sys.stdin); sys.exit(0 if d[0]['name']=='nas' and sorted(d[0]['hosts'])==['*.home.lan','192.168.1.5','nas.home.lan'] and d[0]['expires']>0 else 1)\""
check "show crt: certificate and CA" "[ \$(run show nas crt | grep -c 'BEGIN CERTIFICATE') = 2 ]"
check "bad host name refused" "! run issue x 'a b' 2>/dev/null"
check "bad certificate name refused" "! run issue '../x' a.lan 2>/dev/null"
check "delete" "run delete nas >/dev/null && [ ! -e $T/etc/shareos/ca/certs/nas.crt ] && run list | grep -qx '\\[\\]'"
check "web certificate" "run web | grep -q 'web certificate issued' && [ \"\$(uci -c $T/etc/config get shareos.web.source)\" = ca ]"
cp $T/etc/shareos/ca/web.crt $T/w1
check "web check: names unchanged – kept" "run web check && cmp -s $T/w1 $T/etc/shareos/ca/web.crt"
SHAREOS_CA_IP=192.0.2.99 check "web check: new IP – renewed" "run web check | grep -q issued && ! cmp -s $T/w1 $T/etc/shareos/ca/web.crt && app $T/etc/shareos/ca/web.crt | grep -q 192.0.2.99"
cp $T/etc/shareos/ca/web.crt $T/w2
SHAREOS_CA_IP=192.0.2.99 SHAREOS_CA_NOW=$(( $(date +%s) + 800 * 86400 )) check "web check: under 30 days left – renewed" "run web check | grep -q issued && ! cmp -s $T/w2 $T/etc/shareos/ca/web.crt"

echo "test-ca: $pass passed, $failed failed"
[ $failed = 0 ]
