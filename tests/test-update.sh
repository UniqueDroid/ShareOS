#!/bin/bash
#
# Host test for shareos-update against a mock GitHub API, including a full
# apply on a fake box (flash partitions are plain files, the flash tools are
# shell stand-ins).
#
#   tests/test-update.sh <ucode-binary>
#
# Needs: python3, curl, sha256sum, tar, mkimage, openssl; ucode built with fs + uci.
#
set -u
UCODE=$(realpath "${1:?ucode binary}")
TOP=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT="$TOP/src/shareos-core/usr/sbin/shareos-update"

T=$(mktemp -d)
[ -d "$T" ] || exit 1
cd "$T"
SRV=
trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
ROOT=$T/root
WEB=$T/web
PORT=$((20000 + RANDOM % 10000))
API="http://127.0.0.1:$PORT"
FWN=DNS-320L-rev-Ax

# --- bundles -------------------------------------------------------------------
# bundle <name> <version> [fwname] [kernel image name] [kernel size]
bundle() {
	local d=$T/b/$1 v=$2 fw=${3:-$FWN} kn=${4:-"ShareOS-$2, kernel"} ks=${5:-1500000}
	mkdir -p "$d"
	head -c "$ks" /dev/urandom > "$d/zImage"
	head -c 900000 /dev/urandom > "$d/initrd"
	mkimage -A arm -O linux -T kernel -C none -a 0x8000 -e 0x8000 -n "$kn" -d "$d/zImage" "$d/uImage" >/dev/null
	mkimage -A arm -O linux -T ramdisk -C none -a 0x800000 -e 0x800000 -n "ShareOS-$v, initrd" -d "$d/initrd" "$d/urootfs" >/dev/null
	{ printf hsqs; head -c 3000000 /dev/urandom; } > "$d/rootfs.squashfs"
	printf 'SHAREOS_VERSION="%s"\nSHAREOS_BOARD="dns320l"\nSHAREOS_FWNAME="%s"\n' "$v" "$fw" > "$d/shareos-release"
	(cd "$d" && sha256sum uImage urootfs rootfs.squashfs > SHA256SUMS)
}
publish() { # <bundle name> <version>
	local n=ShareOS-$2-$FWN.sysupgrade.tar
	(cd "$T/b/$1" && tar -cf "$WEB/dl/$n" uImage urootfs rootfs.squashfs shareos-release SHA256SUMS)
	(cd "$WEB/dl" && sha256sum "$n" > "$n.sha256")
}
mkdir -p "$WEB/repos/UniqueDroid/ShareOS" "$WEB/dl"
bundle good 0.1.0;                 publish good 0.1.0
bundle beta 0.2.0-beta.1;          publish beta 0.2.0-beta.1
bundle beta9 0.2.0-beta.9;         publish beta9 0.2.0-beta.9
bundle beta10 0.2.0-beta.10;       publish beta10 0.2.0-beta.10        # beta.10 > beta.9 (not as text)
bundle other 0.1.1 DNS-325-rev-Ax; publish other 0.1.1                       # wrong box
bundle broken 0.0.9;               publish broken 0.0.9
echo "0000000000000000000000000000000000000000000000000000000000000000  x" > "$WEB/dl/ShareOS-0.0.9-$FWN.sysupgrade.tar.sha256"
bundle inner 0.0.8;  echo garbage >> "$T/b/inner/rootfs.squashfs"; publish inner 0.0.8   # SHA256SUMS mismatch
bundle foreign 0.0.7 $FWN "Alt-F-1.0, kernel";  publish foreign 0.0.7
bundle big 0.0.6 $FWN "ShareOS-0.0.6, kernel" 3200000; publish big 0.0.6

asset() { printf '{"name":"%s","size":%d,"browser_download_url":"%s/dl/%s"}' "$1" "$(stat -c %s "$WEB/dl/$1")" "$API" "$1"; }
rel() { # tag prerelease body version
	local n=ShareOS-$4-$FWN.sysupgrade.tar
	printf '{"tag_name":"%s","draft":false,"prerelease":%s,"published_at":"2026-10-18T10:00:00Z","body":"%s","assets":[%s,%s]}' \
		"$1" "$2" "$3" "$(asset "$n")" "$(asset "$n.sha256")"
}
{
	echo '['
	echo ' {"tag_name":"v0.3.0","draft":true,"prerelease":false,"assets":[]},'
	rel v0.2.0-beta.9 true beta9 0.2.0-beta.9; echo ','
	rel v0.2.0-beta.10 true beta10 0.2.0-beta.10; echo ','
	rel v0.2.0-beta.1 true beta 0.2.0-beta.1; echo ','
	rel v0.1.1 false "wrong box" 0.1.1; echo ','
	rel v0.1.0 false "first release" 0.1.0; echo ','
	rel v0.0.9 false broken 0.0.9; echo ','
	rel v0.0.8 false inner 0.0.8; echo ','
	rel v0.0.7 false foreign 0.0.7; echo ','
	rel v0.0.6 false big 0.0.6; echo ','
	echo ' {"tag_name":"v0.0.5","draft":false,"prerelease":false,"assets":[{"name":"ShareOS-0.0.5-DNS-325-rev-Ax.sysupgrade.tar","size":1,"browser_download_url":"x"}]}'
	echo ']'
} > "$WEB/repos/UniqueDroid/ShareOS/releases"
(cd "$WEB" && exec python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1) &
SRV=$!
for i in $(seq 50); do curl -s -o /dev/null "$API/" && break; sleep 0.1; done

# --- fake box -----------------------------------------------------------------
mkdir -p "$ROOT/etc/config" "$ROOT/tmp" "$ROOT/proc/device-tree" "$ROOT/dev" "$ROOT/overlay" \
	"$ROOT/sys/class/ubi/ubi0_0" "$T/bin"
cp "$TOP/src/shareos-core/etc/config/shareos" "$ROOT/etc/config/"
sed -i "s|option api .*|option api '$API'|" "$ROOT/etc/config/shareos"
printf 'SHAREOS_VERSION="0.0-20261016-test"\nSHAREOS_BOARD="dns320l"\nSHAREOS_FWNAME="%s"\n' $FWN > "$ROOT/etc/shareos-release"
printf 'Some Other Board\0' > "$ROOT/proc/device-tree/model"
printf 'rootfs\n' > "$ROOT/sys/class/ubi/ubi0_0/name"
echo 50448384 > "$ROOT/sys/class/ubi/ubi0_0/data_bytes"
printf 'dev:    size   erasesize  name\nmtd1: 00500000 00020000 "uImage"\nmtd2: 00500000 00020000 "ramdisk"\nmtd3: 06400000 00020000 "image"\n' > "$ROOT/proc/mtd"
echo "overlay / overlay rw 0 0" > "$ROOT/proc/mounts"
blank() { head -c 5242880 /dev/zero | tr '\0' '\377' > "$1"; }
blank "$ROOT/dev/mtd1"; blank "$ROOT/dev/mtd2"

# flash tool stand-ins working on the files above (args as used by the updater)
printf '#!/bin/sh\n# flash_erase -q <dev> 0 0\nhead -c 5242880 /dev/zero | tr "\\000" "\\377" > "$2"\n' > "$T/bin/flash_erase"
printf '#!/bin/sh\n# nandwrite -q -p <dev> <file>\ndd if="$4" of="$3" conv=notrunc status=none\n' > "$T/bin/nandwrite"
printf '#!/bin/sh\n# nanddump -q -l <len> -f <out> <dev>\nhead -c "$3" "$6" > "$5"\n' > "$T/bin/nanddump"
chmod +x "$T/bin/flash_erase" "$T/bin/nandwrite" "$T/bin/nanddump"

# --- runner -------------------------------------------------------------------
pass=0; failed=0
run() { PATH="$T/bin:$PATH" SHAREOS_ROOT=$ROOT "$UCODE" -S "$SCRIPT" "$@" 2>&1; }
check() { # name, json-output, python expression on d
	if printf '%s' "$2" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); sys.exit(0 if ($3) else 1)" 2>/dev/null; then
		echo "PASS  $1"; pass=$((pass+1))
	else
		echo "FAIL  $1"; echo "      output: $2"; failed=$((failed+1))
	fi
}

o=$(run check);          check "check stable: newest is v0.1.1, drafts/betas/other boards hidden" "$o" \
	"d['latest']=='v0.1.1' and [r['tag'] for r in d['releases']]==['v0.1.1','v0.1.0','v0.0.9','v0.0.8','v0.0.7','v0.0.6'] and d['update_available']"
o=$(run check beta);     check "check beta: v0.2.0-beta.10 first (numeric beta order)" "$o" \
	"d['latest']=='v0.2.0-beta.10' and [r['tag'] for r in d['releases']][:3]==['v0.2.0-beta.10','v0.2.0-beta.9','v0.2.0-beta.1'] and len(d['releases'])==9"
o=$(run download v9.9);  check "download unknown tag is rejected" "$o" "d['state']=='error' and 'unknown release' in d['error']"
o=$(run download v0.1.1);check "bundle for another box is rejected" "$o" "d['state']=='error' and 'DNS-325' in d['error']"
o=$(run download v0.0.9);check "corrupted bundle is rejected (SHA-256)" "$o" "d['state']=='error' and 'SHA-256' in d['error']"
o=$(run download v0.0.8);check "damaged part is rejected (SHA256SUMS)" "$o" "d['state']=='error' and 'SHA256SUMS' in d['error']"
o=$(run download v0.0.7);check "non-ShareOS kernel is rejected" "$o" "d['state']=='error' and 'not ShareOS' in d['error']"
o=$(run download v0.0.6);check "kernel over 3 MB is rejected" "$o" "d['state']=='error' and 'only loads' in d['error']"
o=$(run download v0.2.0-beta.1); check "download + verify beta" "$o" "d['state']=='ready' and d['release']['tag']=='v0.2.0-beta.1'"
o=$(run status);         check "status reports ready" "$o" "d['state']=='ready' and d['current']=='0.0-20261016-test'"
sed -i "s|option api .*|option api 'http://127.0.0.1:1'|" "$ROOT/etc/config/shareos"
run auto >/dev/null
o=$(run status);         check "background check offline: no error, download stays ready" "$o" "d['state']=='ready' and 'error' not in d"
sed -i "s|option api .*|option api '$API'|" "$ROOT/etc/config/shareos"
run auto >/dev/null
o=$(run status);         check "background check (cron) stores the result" "$o" "d['state']=='ready' and d['check']['update_available'] and d['check']['latest']"
sed -i 's/^SHAREOS_VERSION=.*/SHAREOS_VERSION="9.9.9"/' "$ROOT/etc/shareos-release"
o=$(run status);         check "old check result does not offer an older version" "$o" "d['check']['update_available']==False"
sed -i 's/^SHAREOS_VERSION=.*/SHAREOS_VERSION="0.0-20261016-test"/' "$ROOT/etc/shareos-release"
o=$(run apply v0.1.0);   check "apply of a different tag is refused" "$o" "d['state']=='error' and 'not downloaded' in d['error']"
run download v0.1.0 >/dev/null
o=$(run apply v0.1.0);   check "apply refuses on a non-DNS-320L board" "$o" "d['state']=='error' and 'unexpected board' in d['error']"
printf 'D-Link DNS-320L-rev-Ax NAS\0' > "$ROOT/proc/device-tree/model"
run download v0.1.0 >/dev/null
o=$(run apply v0.1.0);   check "apply refuses without UBIFS overlay (netroot)" "$o" "d['state']=='error' and 'not running from flash' in d['error']"
echo "ubi0:rootfs_data /overlay ubifs rw 0 0" >> "$ROOT/proc/mounts"
run download v0.1.0 >/dev/null
o=$(run apply v0.1.0);   check "apply flashes and stages the system" "$o" "d['state']=='flashed' and d['flashed']['tag']=='v0.1.0'"
B=$T/b/good
cmp -s -n "$(stat -c %s "$B/uImage")" "$B/uImage" "$ROOT/dev/mtd1" && k=1 || k=0
cmp -s -n "$(stat -c %s "$B/urootfs")" "$B/urootfs" "$ROOT/dev/mtd2" && i=1 || i=0
cmp -s "$B/rootfs.squashfs" "$ROOT/overlay/upgrade/rootfs.squashfs" && r=1 || r=0
(cd "$ROOT/overlay/upgrade" && sha256sum -c --status rootfs.squashfs.sha256) && c=1 || c=0
v=$(cat "$ROOT/overlay/upgrade/version" 2>/dev/null)
check "kernel + initramfs written, rootfs staged with checksum and version" \
	"{\"k\":$k,\"i\":$i,\"r\":$r,\"c\":$c,\"v\":\"$v\"}" "d['k'] and d['i'] and d['r'] and d['c'] and d['v']=='0.1.0'"
o=$(run status);         check "status: reboot pending" "$o" "d.get('pending_reboot')==True"
echo "ok 0.1.0" > "$ROOT/overlay/upgrade-result"; rm -rf "$ROOT/overlay/upgrade"
o=$(run status);         check "status: result of the last upgrade" "$o" "d['last_upgrade']=='ok 0.1.0' and 'pending_reboot' not in d"
o=$(run cancel);         check "cancel resets the state" "$o" "d['state']=='idle'"

# --- update from an uploaded file (no internet) -----------------------------------
sed -i "s|option api .*|option api 'http://127.0.0.1:1'|" "$ROOT/etc/config/shareos"   # GitHub unreachable
TB=ShareOS-0.2.0-beta.1-$FWN.sysupgrade.tar
o=$(run local "$ROOT/tmp/none.tar"); check "local: missing file reported" "$o" "d['state']=='error' and 'no uploaded file' in d['error']"
cp "$WEB/dl/$TB" "$ROOT/tmp/up.tar"
o=$(run local "$ROOT/tmp/up.tar" 0000000000000000000000000000000000000000000000000000000000000000)
check "local: wrong .sha256 rejected" "$o" "d['state']=='error' and 'does not match' in d['error']"
cp "$WEB/dl/ShareOS-0.1.1-$FWN.sysupgrade.tar" "$ROOT/tmp/up.tar"
o=$(run local "$ROOT/tmp/up.tar"); check "local: bundle for another box rejected" "$o" "d['state']=='error' and 'DNS-325' in d['error']"
cp "$WEB/dl/ShareOS-0.0.8-$FWN.sysupgrade.tar" "$ROOT/tmp/up.tar"
o=$(run local "$ROOT/tmp/up.tar"); check "local: damaged part rejected without .sha256 too" "$o" "d['state']=='error' and 'SHA256SUMS' in d['error']"
cp "$WEB/dl/$TB" "$ROOT/tmp/up.tar"
o=$(run local "$ROOT/tmp/up.tar" "$(cat "$WEB/dl/$TB.sha256")")
check "local: verified with its .sha256, ready to install" "$o" "d['state']=='ready' and d['release']['tag']=='local' and d['release']['version']=='0.2.0-beta.1' and d['release']['sha_checked'] and not __import__('os').path.exists('$ROOT/tmp/up.tar')"
cp "$WEB/dl/$TB" "$ROOT/tmp/up.tar"
o=$(run local "$ROOT/tmp/up.tar"); check "local: works without .sha256" "$o" "d['state']=='ready' and 'sha_checked' not in d['release']"
o=$(run local "$ROOT/tmp/up.tar"); check "local: run again without a file keeps the verified package" "$o" "d['state']=='ready' and 'no uploaded file' in d['error']"
check "local: still ready afterwards" "$(run status)" "d['state']=='ready' and 'error' not in d"
o=$(run apply local);    check "local: apply flashes the uploaded version" "$o" "d['state']=='flashed' and d['flashed']['tag']=='local'"
check "local: staged version is the uploaded one" "{\"v\":\"$(cat "$ROOT/overlay/upgrade/version")\"}" "d['v']=='0.2.0-beta.1'"
run cancel >/dev/null

# the box from /tmp/sys/board.env (S05board): a DNS-325 takes DNS-325 release files
sed -i "s|option api .*|option api '$API'|" "$ROOT/etc/config/shareos"
mkdir -p "$ROOT/tmp/sys"
printf 'BOARD_ID="dns325"\nBOARD_FWNAME="DNS-325-rev-Ax"\nBOARD_MODEL="DNS-325"\n' > "$ROOT/tmp/sys/board.env"
o=$(run check);          check "board.env: a DNS-325 looks for DNS-325 files (none with checksum here), not DNS-320L ones" "$o" "d['fwname']=='DNS-325-rev-Ax' and d['releases']==[]"
run download v0.1.0 >/dev/null
o=$(run apply v0.1.0);   check "board.env: no DNS-325 bundle installed on it" "$o" "d['state']=='error'"
rm -f "$ROOT/tmp/sys/board.env"

# --- signed releases --------------------------------------------------------------
# The box has the public key of the project: nothing from the internet is
# installed without a valid signature. Signatures as the release workflow makes
# them (openssl dgst -sha256 -sign); pk_verify of mbedtls is replaced by openssl.
check "without a key file the signature check is off" "$(run status)" "d['signing'] is False"
printf '#!/bin/sh\n# pk_verify <public key> <file>: the signature is in <file>.sig\nexec openssl dgst -sha256 -verify "$1" -signature "$2.sig" "$2" >/dev/null 2>&1\n' > "$T/bin/pk_verify"
chmod +x "$T/bin/pk_verify"
openssl ecparam -name prime256v1 -genkey -noout -out "$T/release.key" 2>/dev/null
openssl ecparam -name prime256v1 -genkey -noout -out "$T/other.key" 2>/dev/null
mkdir -p "$ROOT/etc/shareos"
openssl ec -in "$T/release.key" -pubout -out "$ROOT/etc/shareos/release.pub" 2>/dev/null
sign() { openssl dgst -sha256 -sign "$T/${2:-release}.key" -out "$WEB/dl/$1.sig" "$WEB/dl/$1"; }
bundle s1 0.4.0; publish s1 0.4.0; sign "ShareOS-0.4.0-$FWN.sysupgrade.tar"
bundle s2 0.4.1; publish s2 0.4.1; sign "ShareOS-0.4.1-$FWN.sysupgrade.tar" other      # signed by someone else
bundle s3 0.4.2; publish s3 0.4.2; sign "ShareOS-0.4.2-$FWN.sysupgrade.tar"
echo tampered >> "$WEB/dl/ShareOS-0.4.2-$FWN.sysupgrade.tar"                               # changed after signing
(cd "$WEB/dl" && sha256sum "ShareOS-0.4.2-$FWN.sysupgrade.tar" > "ShareOS-0.4.2-$FWN.sysupgrade.tar.sha256")
srel() { # tag version: a release with bundle, checksum and signature
	local n=ShareOS-$2-$FWN.sysupgrade.tar
	printf '{"tag_name":"%s","draft":false,"prerelease":false,"published_at":"2026-11-14T10:00:00Z","body":"signed","assets":[%s,%s,%s]}' \
		"$1" "$(asset "$n")" "$(asset "$n.sha256")" "$(asset "$n.sig")"
}
{ echo '['; srel v0.4.2 0.4.2; echo ','; srel v0.4.1 0.4.1; echo ','; srel v0.4.0 0.4.0; echo ','; rel v0.1.0 false "first release" 0.1.0; echo ']'; } > "$WEB/repos/UniqueDroid/ShareOS/releases"
check "with the key file the signature check is on" "$(run status)" "d['signing'] is True"
o=$(run check);          check "signed: the list says which releases carry a signature" "$o" "[bool(r['sig_url']) for r in d['releases']]==[True,True,True,False]"
o=$(run download v0.1.0);check "signed: a release without signature is not installed" "$o" "d['state']=='error' and 'not signed' in d['error']"
o=$(run download v0.4.1);check "signed: a signature of another key is rejected" "$o" "d['state']=='error' and 'not valid' in d['error']"
check "signed: the rejected download is gone" "{\"there\": $([ -e "$ROOT/tmp/shareos-update/dl/fw.tar" ] && echo true || echo false)}" "d['there'] is False"
o=$(run download v0.4.2);check "signed: a bundle changed after signing is rejected (although its .sha256 fits)" "$o" "d['state']=='error' and 'not valid' in d['error']"
o=$(run download v0.4.0);check "signed: valid signature, ready" "$o" "d['state']=='ready' and d['release']['signature']=='valid'"
echo x >> "$ROOT/tmp/shareos-update/dl/fw.tar"          # touched in /tmp after the check
o=$(run apply v0.4.0);   check "signed: checked again right before writing" "$o" "d['state']=='error' and 'not valid any more' in d['error']"
run download v0.4.0 >/dev/null
o=$(run apply v0.4.0);   check "signed: installed" "$o" "d['state']=='flashed' and d['flashed']['tag']=='v0.4.0'"
# the seal of the firmware page: how the running version was installed
check "seal: nothing said about the version that still waits for the reboot" "$(run status)" "'installed_signature' not in d"
sed -i 's/^SHAREOS_VERSION=.*/SHAREOS_VERSION="0.4.0"/' "$ROOT/etc/shareos-release"
check "seal: after the restart the running version counts as installed with a checked signature" "$(run status)" "d['installed_signature']=='valid'"
sed -i 's/^SHAREOS_VERSION=.*/SHAREOS_VERSION="0.0-20261016-test"/' "$ROOT/etc/shareos-release"
run cancel >/dev/null
# a file uploaded by hand: with its .sig like a download, without it only on request
S1=ShareOS-0.4.0-$FWN.sysupgrade.tar
cp "$WEB/dl/$S1" "$ROOT/tmp/up.tar"; cp "$WEB/dl/$S1.sig" "$ROOT/tmp/up.sig"
o=$(run local "$ROOT/tmp/up.tar" "" "$ROOT/tmp/up.sig"); check "signed, local: with its .sig the signature is valid" "$o" "d['state']=='ready' and d['release']['signature']=='valid'"
cp "$WEB/dl/$S1" "$ROOT/tmp/up.tar"; cp "$WEB/dl/ShareOS-0.4.1-$FWN.sysupgrade.tar.sig" "$ROOT/tmp/up.sig"
o=$(run local "$ROOT/tmp/up.tar" "" "$ROOT/tmp/up.sig"); check "signed, local: a .sig that does not fit is rejected" "$o" "d['state']=='error' and 'does not match' in d['error']"
cp "$WEB/dl/$S1" "$ROOT/tmp/up.tar"
o=$(run local "$ROOT/tmp/up.tar"); check "signed, local: without .sig the file counts as unsigned" "$o" "d['state']=='ready' and d['release']['signature']=='none'"
o=$(run apply local);    check "signed, local: an unsigned file is not installed just so" "$o" "'not signed' in d['error']"
check "signed, local: it stays ready for the decision" "$(run status)" "d['state']=='ready' and 'error' not in d"
o=$(run apply local unsigned); check "signed, local: installed when asked for (own build)" "$o" "d['state']=='flashed' and d['flashed']['tag']=='local'"
V=$(python3 -c "import json;print(json.load(open('$ROOT/etc/shareos/installed.json'))['version'])")
sed -i "s/^SHAREOS_VERSION=.*/SHAREOS_VERSION=\"$V\"/" "$ROOT/etc/shareos-release"
check "seal: a file installed without signature counts as unsigned" "$(run status)" "d['installed_signature']=='none'"
sed -i 's/^SHAREOS_VERSION=.*/SHAREOS_VERSION="0.0-20261016-test"/' "$ROOT/etc/shareos-release"
check "seal: nothing said about a system installed another way since" "$(run status)" "'installed_signature' not in d"
run cancel >/dev/null
# the reserve key: a release signed with it is accepted as well
openssl ec -in "$T/other.key" -pubout -out "$ROOT/etc/shareos/release-reserve.pub" 2>/dev/null
o=$(run download v0.4.1);check "reserve key: a release signed with it is accepted" "$o" "d['state']=='ready' and d['release']['signature']=='valid'"
o=$(run apply v0.4.1);   check "reserve key: installed" "$o" "d['state']=='flashed' and d['flashed']['tag']=='v0.4.1'"
run cancel >/dev/null
o=$(run download v0.4.2);check "reserve key: a changed bundle is still rejected" "$o" "d['state']=='error' and 'not valid' in d['error']"
rm -f "$ROOT/etc/shareos/release.pub"
check "only the reserve key on the box: the check stays on" "$(run status)" "d['signing'] is True"
o=$(run download v0.4.0);check "only the reserve key: a release of the other key is rejected" "$o" "d['state']=='error' and 'not valid' in d['error']"
rm -f "$ROOT/etc/shareos/release-reserve.pub"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
