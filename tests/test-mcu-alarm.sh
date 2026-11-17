#!/bin/sh
#
# Tests alarm_when() of the MCU daemon (src/alt-f-utils/mcu-alarm.h): the
# wake-up alarm holds no year, so the moment it stands for is worked out –
# also across New Year. And: reading the alarm sends nothing that switches it.
#
#   tests/test-mcu-alarm.sh
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
SRC="$TOP/src/alt-f-utils"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/t.c" <<'C'
#include <stdio.h>
#include <stdlib.h>
#include "mcu-alarm.h"
/* t <now> <month> <day> <hour> <min> <utc>  ->  local "YYYY-MM-DD HH:MM" */
int main(int argc, char **argv) {
	char buf[32];
	time_t t;
	if (argc != 7) return 2;
	t = alarm_when((time_t)atol(argv[1]), atoi(argv[2]), atoi(argv[3]), atoi(argv[4]), atoi(argv[5]), atoi(argv[6]));
	if (t == (time_t)-1) { puts("error"); return 1; }
	strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", localtime(&t));
	puts(buf);
	return 0;
}
C
${CC:-cc} -D_GNU_SOURCE -Wall -Werror -I"$SRC" -o "$T/t" "$T/t.c" || { echo "FAIL  the helper does not compile"; exit 1; }
export TZ=Europe/Berlin
at() { date -d "$1" +%s; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
is() { [ "$("$T/t" "$(at "$1")" $2)" = "$3" ]; }

# the MCU's fields are UTC, shown in local time (winter: +1 h, summer: +2 h)
check "read: an alarm later this year, winter time" "is '2026-11-17 08:00' '11 21 8 15 1' '2026-11-21 09:15'"
check "read: summer time" "is '2026-06-01 08:00' '6 6 7 15 1' '2026-06-06 09:15'"
check "read: 1 January, read on 31 December – next year, not elapsed" "is '2026-12-31 22:00' '1 1 6 0 1' '2027-01-01 07:00'"
check "read: an alarm of an hour ago stays in this year (elapsed)" "is '2026-11-17 08:00' '11 17 6 0 1' '2026-11-17 07:00'"
check "read: an alarm of last week stays in this year (elapsed)" "is '2026-01-05 08:00' '1 1 6 0 1' '2026-01-01 07:00'"
check "read: local 1 January 00:30 is 31 December in the MCU" "is '2026-12-31 22:00' '12 31 23 30 1' '2027-01-01 00:30'"
# what the user gives is local time
check "write: local time later this year" "is '2026-11-17 08:00' '11 21 9 15 0' '2026-11-21 09:15'"
check "write: 1 January, set on 31 December – next year" "is '2026-12-31 22:00' '1 1 7 0 0' '2027-01-01 07:00'"
check "write: 29 February of the next year, a leap year" "is '2027-12-30 12:00' '2 29 7 0 0' '2028-02-29 07:00'"
check "write: minutes beyond 59 are carried over ('now' adds 3)" "is '2026-11-17 08:58' '11 17 8 61 0' '2026-11-17 09:01'"

# reading must not switch the alarm: readAlarm_cmd sends no enable/disable
body=$(sed -n '/^int readAlarm_cmd/,/^}/p' "$SRC/dns320l-daemon.c")
check "ReadAlarm sends nothing that switches the alarm" "[ -n \"\$body\" ] && ! echo \"\$body\" | grep -q 'WAlarm\\(Enable\\|Disable\\)Cmd'"
wbody=$(sed -n '/^int writeAlarm_cmd/,/^}/p' "$SRC/dns320l-daemon.c")
check "WriteAlarm switches the alarm on or off" "echo \"\$wbody\" | grep -q 'disable_alarm ? WAlarmDisableCmd : WAlarmEnableCmd'"

echo
echo "test-mcu-alarm: $pass passed, $failed failed"
[ $failed -eq 0 ]
