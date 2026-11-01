#!/bin/sh
#
# Tests shareos-ups (system app "nut") with fake NUT programs: the files it
# writes for each setting, the driver chosen, the events (messages, the timer
# for "minutes on battery"), the status lines and the final UPS power-off.
#
#   tests/test-ups.sh [dir with uci]
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
P="$TOP/src/shareos-core/usr/sbin/shareos-ups"
T=$(mktemp -d)
trap 'SHAREOS_ROOT=$T sh "$P" stop-all >/dev/null 2>&1; rm -rf "$T"' EXIT
export PATH="${1:+$1:}$PATH"
mkdir -p $T/etc/config $T/bin $T/run $T/sys/bus/usb/devices/1-1
echo 051d > $T/sys/bus/usb/devices/1-1/idVendor; echo 0002 > $T/sys/bus/usb/devices/1-1/idProduct
# fake NUT: daemons stay in the background with a pid file, upsc answers from a file
for p in usbhid-ups nutdrv_qx blazer_usb upsd upsmon; do
	cat > $T/bin/$p <<EOF
#!/bin/sh
echo "$p \$*" >> $T/calls.log
case "\$*" in *-c\ stop*) kill \$(cat $T/run/$p.pid 2>/dev/null) 2>/dev/null; exit 0 ;; *-c\ fsd*) echo FSD >> $T/calls.log; exit 0 ;; *-k*) exit 0 ;; esac
[ -f $T/fail-$p ] && { echo "no matching device"; exit 1; }
( while :; do sleep 1; done ) &
case $p in upsd|upsmon) echo \$! > $T/run/$p.pid ;; *) echo \$! > \$NUT_STATEPATH/$p-ups.pid ;; esac
EOF
	chmod 755 $T/bin/$p
done
printf '#!/bin/sh\ncat %s/upsc.out\n' $T > $T/bin/upsc; chmod 755 $T/bin/upsc
printf 'ups.status: OL\nbattery.charge: 100\nbattery.runtime: 1800\nups.load: 12\ndevice.mfr: APC\ndevice.model: Back-UPS ES 700\n' > $T/upsc.out
export SHAREOS_ROOT=$T SHAREOS_UPS_BIN=$T/bin SHAREOS_UPS_SYS=$T/sys
run() { sh "$P" "$@"; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
conf() { printf "config ups 'main'\n" > $T/etc/config/ups; for kv; do printf "\toption %s '%s'\n" "${kv%%=*}" "${kv#*=}" >> $T/etc/config/ups; done; }
C=$T/tmp/shareos-ups/conf

conf enabled=1 shutdown=low
run start
check "start: driver, upsd and upsmon run" "grep -q '^usbhid-ups -a ups -u root' $T/calls.log && grep -q '^upsd -u root' $T/calls.log && grep -q '^upsmon' $T/calls.log"
check "APC (051d) is detected, usbhid-ups chosen" "grep -q 'driver = usbhid-ups' $C/ups.conf && run status | grep -qx 'detected=051d:0002'"
check "low battery: no override of the UPS limit" "! grep -q ignorelb $C/ups.conf"
check "upsd only on localhost without the server option" "[ \"\$(cat $C/upsd.conf)\" = 'LISTEN 127.0.0.1 3493' ]"
check "upsmon: primary, our shutdown and event commands, killpower flag" "grep -q 'MONITOR ups@localhost 1 shareos .* primary' $C/upsmon.conf && grep -q 'SHUTDOWNCMD \"/usr/sbin/shareos-ups shutdown\"' $C/upsmon.conf && grep -q 'NOTIFYFLAG ONBATT SYSLOG+EXEC' $C/upsmon.conf && grep -q POWERDOWNFLAG $C/upsmon.conf"
check "config files root only" "[ \$(stat -c %a $C/upsd.users) = 600 ]"
check "status: values of the UPS" "run status | grep -qx 'status=OL' && run status | grep -qx 'charge=100' && run status | grep -qx 'model=Back-UPS ES 700'"
run stop
check "stop: nothing runs" "! run status | grep -qx 'running=1'"

conf enabled=1 shutdown=percent percent=40 server=1 password=geheim killpower=0
: > $T/calls.log
run start
check "percent: the driver reports low battery below 40 %" "grep -q ignorelb $C/ups.conf && grep -q 'override.battery.charge.low = 40' $C/ups.conf"
check "server: upsd listens on the network, user monitor" "grep -q 'LISTEN 0.0.0.0 3493' $C/upsd.conf && grep -q -A2 '\\[monitor\\]' $C/upsd.users && grep -q 'password = geheim' $C/upsd.users"
check "killpower off: no flag" "! grep -q POWERDOWNFLAG $C/upsmon.conf"
run stop

conf enabled=1 driver=auto; touch $T/fail-usbhid-ups; : > $T/calls.log
run start
check "auto: usbhid-ups finds nothing – nutdrv_qx is tried" "grep -q '^nutdrv_qx -a ups' $T/calls.log && grep -q 'driver = nutdrv_qx' $C/ups.conf"
run stop; rm $T/fail-usbhid-ups

conf enabled=1 shutdown=minutes minutes=1
run start
NOTIFYTYPE=ONBATT run "UPS ups@localhost on battery"
check "on battery: message and a timer" "grep -q 'notify warn ups-onbatt' $T/tmp/shareos-ups/notify.log && [ -s $T/tmp/shareos-ups/timer.pid ]"
NOTIFYTYPE=ONLINE run "UPS ups@localhost on line power"
check "power back: timer stopped, message cleared" "[ ! -e $T/tmp/shareos-ups/timer.pid ] && grep -q 'clear ups-onbatt' $T/tmp/shareos-ups/notify.log && grep -q 'notify info ups-online' $T/tmp/shareos-ups/notify.log"
printf 'ups.status: OB DISCHRG\n' > $T/upsc.out
run timer
check "timer over and still on battery: forced shutdown" "grep -q FSD $T/calls.log"
: > $T/calls.log; printf 'ups.status: OL\n' > $T/upsc.out
run timer
check "timer over but power back: nothing" "! grep -q FSD $T/calls.log"
check "events listed in the status" "run status | grep -q '^event=[0-9]* ONBATT'"
run shutdown
check "shutdown command powers off" "grep -qx poweroff $T/tmp/shareos-ups/notify.log"
touch $T/tmp/shareos-ups/killpower; : > $T/calls.log
run killpower
check "killpower: the driver tells the UPS to switch off" "grep -q 'usbhid-ups -a ups -u root -k' $T/calls.log"
run stop

conf enabled=0
check "boot while switched off: nothing" "run boot && ! [ -s $T/run/upsmon.pid ] || ! kill -0 \$(cat $T/run/upsmon.pid) 2>/dev/null"

echo "test-ups: $pass passed, $failed failed"
[ $failed = 0 ]
