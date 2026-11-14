#!/bin/bash
#
# Rescue mode of the initramfs (board/dlink/dns320l/initramfs/init): after a
# failure SSH opens only when the USB button is pressed and closes again.
# The functions are taken out of the init script and run with stand-ins.
#
#   tests/test-rescue.sh
#
set -u
TOP=$(cd "$(dirname "$0")/.." && pwd)
INIT=$TOP/board/dlink/dns320l/initramfs/init
export T; T=$(mktemp -d); trap 'kill $(cat "$T"/run/*.pid "$T"/gate.pid 2>/dev/null) 2>/dev/null; rm -rf "$T"' EXIT
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; [ -n "${3:-}" ] && echo "      $3"; failed=$((failed+1)); fi; }

mkdir -p "$T/bin" "$T/run" "$T/sys/class/input/event0/device" "$T/sys/class/input/event1/device" "$T/dev/input"
echo "some keyboard" > "$T/sys/class/input/event0/device/name"
echo "gpio-keys" > "$T/sys/class/input/event1/device/name"
# stand-in for dropbear: notes the start and leaves a process that removes
# the file "listening" when it is stopped
cat > "$T/bin/dropbear" <<'D'
#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = -P ] && { shift; pid=$1; }; shift; done
d=$(dirname "$pid")/..
echo started >> "$d/ssh.log"
: > "$d/listening"
(trap 'rm -f "$d/listening"; exit 0' TERM; i=0; while [ $i -lt 600 ]; do sleep 0.2; i=$((i+1)); done) >/dev/null 2>&1 &
echo $! > "$pid"
D
chmod 755 "$T/bin/dropbear"
# the functions between the two marker lines of the init script
{
	# shellcheck disable=SC2016  # text for the script that is put together here
	echo 'log() { echo "$*" >> "$T/log"; }; LED=none'
	sed -n '/^# the event device of the buttons/,/^RESCUE_ASKED=0/p' "$INIT" | sed '$d'
	echo 'ssh_gate'
} > "$T/gate.sh"
# an input event: 8 bytes time, type, code, value (little endian)
event() {
	# shellcheck disable=SC2059  # the format is built here on purpose (octal bytes)
	printf "$(printf '\\0\\0\\0\\0\\0\\0\\0\\0\\%03o\\%03o\\%03o\\%03o\\1\\0\\0\\0' $(($1 & 255)) $(($1 >> 8)) $(($2 & 255)) $(($2 >> 8)))" > "$T/dev/input/event1"
}
gate() { PATH=$T/bin:$PATH SHAREOS_INIT_SYS=$T/sys SHAREOS_INIT_DEV=$T/dev SHAREOS_INIT_RUN=$T/run SHAREOS_INIT_SSH_TIME=${1:-2} sh "$T/gate.sh" & echo $! > "$T/gate.pid"; }
stop() { kill "$(cat "$T/gate.pid")" 2>/dev/null; wait 2>/dev/null; }

event 1 408      # reset button
gate; sleep 2
check "the device of the buttons is found (not the first input device)" "grep -q 'SSH is closed: press the USB button' $T/log"
check "another button does not open SSH" "[ ! -e $T/ssh.log ]"
stop

rm -f "$T/log"; event 1 133      # USB button (KEY_COPY)
gate 2; i=0; while [ $i -lt 20 ] && [ ! -s "$T/ssh.log" ]; do sleep 0.25; i=$((i+1)); done
check "USB button: SSH opens" "[ \"\$(cat $T/ssh.log 2>/dev/null)\" = started ] && [ -e $T/listening ]"
: > "$T/dev/input/event1"                            # no further press
i=0; while [ $i -lt 40 ] && ! grep -q 'SSH is closed again' "$T/log"; do sleep 0.25; i=$((i+1)); done
check "after the time SSH is closed again" "grep -q 'SSH is closed again' $T/log && sleep 0.5 && [ ! -e $T/listening ]" "$(cat "$T/log")"
stop

rm -f "$T/ssh.log"; event 1 161   # USB button of DNS-325/DNS-320
gate 30; i=0; while [ $i -lt 20 ] && [ ! -s "$T/ssh.log" ]; do sleep 0.25; i=$((i+1)); done
check "USB button of the other models (KEY_EJECTCD)" "[ \"\$(cat $T/ssh.log 2>/dev/null)\" = started ]"
stop; kill "$(cat "$T/run/dropbear.pid")" 2>/dev/null

rm -f "$T/ssh.log" "$T/log"; echo other > "$T/sys/class/input/event1/device/name"
gate; i=0; while [ $i -lt 20 ] && [ ! -s "$T/ssh.log" ]; do sleep 0.25; i=$((i+1)); done
check "a box without the buttons' device: SSH open at once (it could not be reached otherwise)" "[ \"\$(cat $T/ssh.log 2>/dev/null)\" = started ] && grep -q 'no buttons found' $T/log"
stop

check "asked for on the kernel command line: open at once" "grep -q 'has shareos.rescue && { RESCUE_ASKED=1; rescue' $INIT && grep -A2 'if \\[ \"\$RESCUE_ASKED\" = 1 \\]' $INIT | grep -q ssh_open"

echo
echo "$pass passed, $failed failed"
[ $failed = 0 ]
