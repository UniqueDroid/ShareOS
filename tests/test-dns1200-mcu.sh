#!/bin/sh
#
# DNS-1200-05: dns1200-mcu against a simulated microcontroller on a pseudo
# terminal – the frames it sends, the acknowledgement it waits for and the
# answers it reads (protocol: D-Link's up_send_ctl/up_read_daemon, checked
# on a box under D-Link's firmware).
#
#   tests/test-dns1200-mcu.sh
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
W=$(mktemp -d)
trap 'kill $SIM 2>/dev/null; rm -rf "$W"' EXIT
cc -O2 -Wall -Wextra -Werror -o "$W/dns1200-mcu" "$TOP/src/dns1200-mcu/dns1200-mcu.c" || { echo "FAIL  build"; exit 1; }

# the microcontroller: acknowledges every frame, answers clock and version
# requests, logs what it got; "noack" in $W/mode makes it stay silent
cat > "$W/sim.py" <<'EOF'
import os, pty, sys, time, tty
w = sys.argv[1]
master, slave = pty.openpty()
tty.setraw(slave)
os.symlink(os.ttyname(slave), w + '/port')
clock = {1: 0x42, 2: 0x27, 3: 0x17, 5: 0x28, 6: 0x11, 7: 0x26}
buf = b''
while True:
    buf += os.read(master, 64)
    while b'\xfb' in buf:
        f, buf = buf.split(b'\xfb', 1)
        f = f[f.find(b'\xfa'):] + b'\xfb'
        with open(w + '/log', 'a') as l:
            l.write(f.hex(' ') + '\n')
        if os.path.exists(w + '/noack'):
            continue
        os.write(master, bytes([0xfa, 0x30, 0, 0, 0, 0, 0xfb]))
        if f[1] == 0x01 and f[3] == 0x01:
            os.write(master, bytes([0xfa, 0x01, f[2], 0x01, 0, clock[f[2]], 0xfb]))
        if f[1] == 0x03 and f[2] == 0x05:
            os.write(master, bytes([0xfa, 0x03, 0x05, 0x00, 0, 0x0e, 0xfb]))
EOF
python3 "$W/sim.py" "$W" & SIM=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -e "$W/port" ] && break; sleep 0.2; done
export DNS1200_MCU_PORT="$W/port"

pass=0; failed=0
check() { # name, expected, got
	if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1))
	else echo "FAIL  $1"; echo "      want: $2"; echo "      got:  $3"; failed=$((failed+1)); fi
}
run() { : > "$W/log"; "$W/dns1200-mcu" "$@"; }
sent() { tr '\n' '|' < "$W/log"; }

out=$(run version); check "version: 0x0e -> 0.00b14" "0.00b14" "$out"
check "version: frame" "fa 03 05 00 00 00 fb|" "$(sent)"

out=$(run time); check "time: six registers read as BCD" "2026-11-28 17:27:42 UTC" "$out"
check "time: frames for year, month, day, hour, minute, second" \
	"fa 01 07 01 01 00 fb|fa 01 06 01 01 00 fb|fa 01 05 01 01 00 fb|fa 01 03 01 01 00 fb|fa 01 02 01 01 00 fb|fa 01 01 01 01 00 fb|" "$(sent)"

run name ShareOS; check "name: length and ASCII" "fa 04 01 00 07 53 68 61 72 65 4f 53 fb|" "$(sent)"
run name "" 2>/dev/null; check "name: empty is refused, nothing sent" "1:" "$?:$(sent)"
run name "123456789012345678901" 2>/dev/null; check "name: longer than 20 is refused" "1:" "$?:$(sent)"
run name "$(printf 'a\tb')" 2>/dev/null; check "name: control characters are refused" "1:" "$?:$(sent)"

run ip 1 10.241.1.124; check "ip: port 1, two half bytes per byte" "fa 04 02 01 08 00 0a 0f 01 00 01 07 0c fb|" "$(sent)"
run ip 2 192.168.0.1; check "ip: port 2" "fa 04 02 02 08 0c 00 0a 08 00 00 00 01 fb|" "$(sent)"
run ip 3 10.0.0.1 2>/dev/null; check "ip: port 3 is refused" "1:" "$?:$(sent)"
run ip 1 10.0.0.256 2>/dev/null; check "ip: bad address is refused" "1:" "$?:$(sent)"

run fan half; check "fan half" "fa 02 00 01 00 00 fb|" "$(sent)"
run fan full; check "fan full" "fa 02 00 02 00 00 fb|" "$(sent)"
run fan off 2>/dev/null; check "fan off is not offered" "1:" "$?:$(sent)"

run shutdown 2>/dev/null; check "unknown command (shutdown): nothing sent" "2:" "$?:$(sent)"

touch "$W/noack"
run fan full 2>/dev/null; rc=$?
check "no acknowledgement: ten tries, then an error" "1:10" "$rc:$(grep -c . "$W/log")"
rm -f "$W/noack"

echo
echo "$pass passed, $failed failed"
[ $failed = 0 ]
