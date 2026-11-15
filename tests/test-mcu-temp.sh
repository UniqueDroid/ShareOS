#!/bin/sh
#
# DNS-320 rev A: reading the temperature from the answer of the MCU on ttyS1
# (mcu_parse of shareos-board), with the answer of a real box (issue #163).
#
#   tests/test-mcu-temp.sh
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
B="$TOP/board/dlink/dns320l/rootfs-overlay/usr/sbin/shareos-board"
eval "$(sed -n '/^mcu_parse() {$/,/^}$/p' "$B")"
pass=0; failed=0
check() { # name, expected output ("" = no reading), bytes in hex
	d=""; for h in $3; do d="$d $((0x$h))"; done
	# shellcheck disable=SC2086
	got=$(mcu_parse $d); rc=$?
	want=1; [ -n "$2" ] && want=0
	if [ "$got" = "$2" ] && [ $rc = $want ]; then
		echo "PASS  $1"; pass=$((pass+1))
	else
		echo "FAIL  $1 (got '$got', rc $rc)"; failed=$((failed+1))
	fi
}
check "answer of a real DNS-320 rev A1: 46 °C" 46000 "f0 f0 d0 04 02 2e 00 00 00 00 00 00 00 e4 e4 e4"
check "answer after a stray byte"               44000 "00 f0 f0 d0 04 02 2c 00 00 00 00 00 00 00 e2 e2"
check "header lost: taken from the checksum"    46000 "2e 00 00 00 00 00 00 00 e4 e4 e4"
check "nothing received: no reading"            ""    ""
check "only zeros: no reading"                  ""    "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00"
check "the request echoed back: no reading"     ""    "f0 f0 10 04 02 00 00 00 00 00 00 00 00 f6 f6 f6"
check "temperature 0 in the header, no checksum: no reading" "" "f0 f0 d0 04 02 00 00 00 00 00 00 00 00 b6 b6 b6"
grep -q '3<>/dev/ttyS1' "$B" && ! grep -q "> /dev/ttyS1" "$B" && { echo "PASS  the port is opened once for asking and reading"; pass=$((pass+1)); } || { echo "FAIL  the port is opened once for asking and reading"; failed=$((failed+1)); }

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
