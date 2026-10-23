#!/bin/bash
#
# Tests the reset/USB button handling (shareos-buttons) with recorded input
# events and the access reset (shareos-reset-access) on a fake root.
#
#   LD_LIBRARY_PATH=<hostroot>/lib tests/test-buttons.sh <hostroot>/bin
#
set -u
BIN=${1:?path to the host ucode/uci binaries}
TOP=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; echo "      $3"; failed=$((failed+1)); fi; }

# recorded events: (time, code, value); 0x198 = reset, 0x85 = USB, value 2 = repeat
python3 - "$T" <<'PY'
import struct, sys
T = sys.argv[1]
def ev(t, code, val):
    s = int(t); return struct.pack('<IIHHi', s, round((t - s) * 1e6), 1, code, val)
syn = lambda t: struct.pack('<IIHHi', int(t), 0, 0, 0, 0)
R, U = 0x198, 0x85
seqs = {'short': [(100, R, 1), (102.5, R, 0)],
        'access': [(100, R, 1), (100.5, R, 2), (107.2, R, 0)],
        'cancel': [(100, R, 1), (112, R, 0)],
        'factory': [(100, R, 1), (116, R, 0)],
        'usb': [(100, U, 1), (100.2, U, 0)],
        'release-only': [(100, R, 0)]}
for n, q in seqs.items():
    open(f'{T}/{n}.ev', 'wb').write(b''.join(ev(*e) + syn(e[0]) for e in q))
PY
btn() { SHAREOS_BUTTONS_DDPID=$T/dd.pid SHAREOS_BUTTONS_DEV=$T/$1.ev SHAREOS_BUTTONS_DRY=1 SHAREOS_BUTTONS_USB="${2:-}" \
	"$BIN/ucode" -L "$(dirname "$BIN")/lib/ucode" -S "$TOP/src/shareos-core/usr/sbin/shareos-buttons" 2>&1; }

o=$(btn short);   check "reset < 5 s: nothing" "! echo \"\$o\" | grep -q '^run:'" "$o"
check "the PID of the dd is written for S05board" "grep -qE '^[0-9]+\$' $T/dd.pid" "$(cat $T/dd.pid 2>&1)"
o=$(btn access);  check "reset 5-10 s: access reset" "echo \"\$o\" | grep -qx 'run: /usr/sbin/shareos-reset-access --yes'" "$o"
o=$(btn cancel);  check "reset 10-15 s: cancelled" "! echo \"\$o\" | grep -q '^run:' && echo \"\$o\" | grep -q cancelled" "$o"
o=$(btn factory); check "reset >= 15 s: factory reset" "echo \"\$o\" | grep -qx 'run: /usr/sbin/shareos-factory-reset --yes'" "$o"
o=$(btn release-only); check "release without press ignored" "[ -z \"\$o\" ]" "$o"
o=$(btn usb "$(printf '/dev/sdc1 /mnt/usb-A vfat\n/dev/sdc2 /mnt/usb-B ext4\n/dev/sdd1 /mnt/usb-C exfat')")
check "USB button ejects every USB disk once" "[ \"\$(echo \"\$o\" | grep -c '^run: /usr/sbin/shareos-usb eject')\" = 2 ] && echo \"\$o\" | grep -q 'eject sdc$' && echo \"\$o\" | grep -q 'eject sdd$'" "$o"
o=$(btn usb "");  check "USB button without drives: only a log line" "! echo \"\$o\" | grep -q '^run:' && echo \"\$o\" | grep -q 'no USB drive'" "$o"

# which input device is the buttons' (the kernel names it after the device-tree node)
find_dev() {   # name of the input device or "-" for none
	mkdir -p "$T/sys/event0/device" "$T/sys/event1/device"
	echo "other" > "$T/sys/event0/device/name"; rm -f "$T/sys/event1/device/name"
	[ "$1" = - ] || echo "$1" > "$T/sys/event1/device/name"
	SHAREOS_BUTTONS_SYS=$T/sys SHAREOS_BUTTONS_FIND=1 \
		"$BIN/ucode" -L "$(dirname "$BIN")/lib/ucode" -S "$TOP/src/shareos-core/usr/sbin/shareos-buttons" 2>&1
}
check "input device named gpio-keys (DNS-320L)" "[ \"\$(find_dev gpio-keys)\" = /dev/input/event1 ]" "$(find_dev gpio-keys)"
check "input device named gpio_keys (DNS-325)" "[ \"\$(find_dev gpio_keys)\" = /dev/input/event1 ]" "$(find_dev gpio_keys)"
check "no gpio-keys input device: none found" "[ \"\$(find_dev -)\" = none ]" "$(find_dev -)"

# access reset on a fake root
R=$T/root; mkdir -p "$R/etc/config"
cp "$TOP/src/shareos-core/etc/config/network" "$TOP/src/shareos-core/etc/config/shareos" "$R/etc/config/"
U="$BIN/uci -c $R/etc/config"
$U set network.lan.proto=static; $U set network.lan.ipaddr=10.9.9.9; $U set network.lan.gateway=10.9.9.1; $U set network.lan.fallback=off; $U commit network
$U set shareos.web.redirect=1; $U set shareos.web.cert=/mnt/x/own.crt; $U commit shareos
o=$(SHAREOS_UCI=$BIN/uci SHAREOS_ROOT=$R sh "$TOP/src/shareos-core/usr/sbin/shareos-reset-access" --yes --no-reboot 2>&1)
check "access reset: network back to DHCP with fallback" "[ \"\$($U get network.lan.proto)\" = dhcp ] && [ -z \"\$($U get network.lan.ipaddr)\" ] && [ \"\$($U get network.lan.fallback)\" = 192.168.0.32 ]" "$o"
check "access reset: http without redirect, own certificate dropped" "[ \"\$($U get shareos.web.redirect)\" = 0 ] && ! $U get shareos.web.cert >/dev/null 2>&1" "$o"
o=$(sh "$TOP/src/shareos-core/usr/sbin/shareos-reset-access" 2>&1); check "access reset needs --yes" "echo \"\$o\" | grep -q 'Nothing done'" "$o"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
