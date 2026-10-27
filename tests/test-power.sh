#!/bin/sh
#
# Tests shareos-power (switch off and on by a weekly schedule): the next
# switch-on and switch-off, the wake-up alarm written through dns320l-daemon
# (a fake here), no switch-off while a storage job runs.
#
#   tests/test-power.sh [dir with ucode]      (LD_LIBRARY_PATH for its libraries)
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
BIN=${1:-}
UCODE=${BIN:+$BIN/}ucode
P="$TOP/src/shareos-core/usr/sbin/shareos-power"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p $T/etc/config $T/tmp
cat > $T/etc/config/shareos <<'CFG'
config power 'power'
	option enabled '1'
	option on_mon '07:00'
	option off_mon '23:30'
	option on_sat '09:15'
	option off_fri '22:00'
CFG
cat > $T/daemon <<'D'
#!/bin/sh
echo "$*" >> "$(dirname "$0")/daemon.log"
case "$2" in ReadAlarm) echo "Wakeup alarm set to: x" ;; *) echo "Wakeup alarm set to: $*" ;; esac
D
chmod 755 $T/daemon
export SHAREOS_ROOT=$T SHAREOS_POWER_DAEMON=$T/daemon SHAREOS_POWER_DRY=1 TZ=Europe/Berlin
run() { "$UCODE" -L "${BIN:+$BIN/../lib/ucode}" "$P" "$@"; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }

# Tuesday 27 Oct 2026, 08:00 local
export SHAREOS_POWER_NOW=$(date -d '2026-10-27 08:00' +%s)
check "status: next switch-on Saturday 09:15, next switch-off Friday 22:00" "run status | js \"d['supported'] and d['enabled'] and d['next_on']=='2026-10-31 09:15' and d['next_off']=='2026-10-30 22:00'\""
: > $T/daemon.log
check "arm: wake-up alarm Saturday 31 Oct 09:15 (local time)" "run arm | js \"d['armed']=='2026-10-31 09:15'\" && grep -qx -- '-x WriteAlarm 10 31 9 15' $T/daemon.log"
# Sunday 1 Nov 06:58: the switch-on Monday 07:00 is 2 minutes away – too close, the next one
export SHAREOS_POWER_NOW=$(date -d '2026-11-01 06:58' +%s)
check "arm: a switch-on less than 3 minutes ahead is skipped" "run arm | js \"d['armed']=='2026-11-02 07:00'\""
export SHAREOS_POWER_NOW=$(date -d '2026-11-02 06:58' +%s)
check "arm: not 2 minutes ahead – the week after" "run arm | js \"d['armed']=='2026-11-07 09:15'\""
# across the change to winter time (25 Oct 2026): Saturday 24 Oct 23:00 -> Monday 26 Oct 07:00
export SHAREOS_POWER_NOW=$(date -d '2026-10-24 23:00' +%s)
check "arm: across the change of summer time" "run arm | js \"d['armed']=='2026-10-26 07:00'\""
: > $T/daemon.log
check "off: arms, then powers off" "run off | grep -qx poweroff && grep -q 'WriteAlarm' $T/daemon.log"
mkdir -p $T/tmp/shareos-storage/lock
check "off: not while a storage job runs" "run off | js \"'storage job' in d.get('error','')\""
rmdir $T/tmp/shareos-storage/lock
sed -i "s/option enabled '1'/option enabled '0'/" $T/etc/config/shareos
: > $T/daemon.log
check "schedule off: alarm disabled, no switch-off" "run arm | js \"d['armed'] is None\" && grep -qx -- '-x WriteAlarm disable' $T/daemon.log && run off | js \"'off' in d.get('error','')\""

echo
echo "test-power: $pass passed, $failed failed"
[ $failed -eq 0 ]
