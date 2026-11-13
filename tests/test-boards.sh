#!/bin/bash
#
# Host test of the model descriptions (/usr/lib/shareos/board.sh) and the
# scripts that use them: shareos-boardinfo, shareos-leds, shareos-board (fan
# and temperature backends), on a fake root per model.
#
#   tests/test-boards.sh
#
set -u
TOP=$(cd "$(dirname "$0")/.." && pwd)
O=$TOP/board/dlink/dns320l/rootfs-overlay
export SHAREOS_BOARD_LIB=$O/usr/lib/shareos/board.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export SHAREOS_ROOT=$T/root
S=$T/stub; mkdir -p $S
# stand-ins: no uci settings (defaults), logger silent
printf '#!/bin/sh\nexit 1\n' > $S/uci; printf '#!/bin/sh\nexit 0\n' > $S/logger; chmod 755 $S/*
export PATH=$S:$PATH

pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
box() {   # model string -> fresh fake root
	rm -rf $SHAREOS_ROOT; mkdir -p $SHAREOS_ROOT/proc/device-tree $SHAREOS_ROOT/tmp/sys $SHAREOS_ROOT/sys/class/leds $SHAREOS_ROOT/sys/class/hwmon
	printf '%s\0' "$1" > $SHAREOS_ROOT/proc/device-tree/model
}
leds() { for l in "$@"; do mkdir -p $SHAREOS_ROOT/sys/class/leds/$l; echo none > $SHAREOS_ROOT/sys/class/leds/$l/trigger; echo 0 > $SHAREOS_ROOT/sys/class/leds/$l/brightness; done; }
trig() { cat $SHAREOS_ROOT/sys/class/leds/$1/trigger; }
info() { sh $O/usr/sbin/shareos-boardinfo "$@"; }

# --- detection of every model (device-tree model strings of the kernel / our DTS)
for x in "D-Link DNS-320L-rev-Ax NAS:dns320l:DNS-320L-rev-Ax:DNS320L:mcu" \
	"D-Link DNS-320-rev-Bx NAS:dns320b:DNS-320-rev-Bx:DNS320B:mcu" \
	"D-Link DNS-320 NAS (Rev A1):dns320a:DNS-320-rev-Ax:DNS323D1:mcu-temp" \
	"D-Link DNS-325 NAS (Rev A1):dns325:DNS-325-rev-Ax:DNS-325:hwmon" \
	"D-Link DNS-327L:dns327l:DNS-327L-rev-Ax:DNS327L:mcu"; do
	IFS=: read -r model id fw sig ctl <<< "$x"
	box "$model"
	check "$id: detected from \"$model\"" "[ \"\$(info id)\" = $id ] && [ \"\$(info fwname)\" = $fw ] && [ \"\$(info sig)\" = $sig ] && [ \"\$(info control)\" = $ctl ]"
done
box "Some other NAS"
check "unknown box: id unknown, no firmware name" "[ \"\$(info id)\" = unknown ] && [ -z \"\$(info fwname)\" ]"
box "D-Link DNS-320L-rev-Ax NAS"
check "boardinfo prints all keys" "[ \$(info | grep -c '^BOARD_') -ge 16 ] && info | grep -qx 'BOARD_TESTED=\"1\"'"
box "D-Link DNS-325 NAS (Rev A1)"
check "only the DNS-320L counts as tested" "[ \"\$(info tested)\" = 0 ]"

# --- LEDs
box "D-Link DNS-320L-rev-Ax NAS"; leds dns320l:blue:usb dns320l:red:sata0 dns320l:red:sata1; mkdir -p $SHAREOS_ROOT/tmp/sys/power_led
sh $O/usr/sbin/shareos-leds
check "DNS-320L: status LED heartbeat, disk LEDs off, power LED through the MCU" "[ \"\$(trig dns320l:blue:usb)\" = heartbeat ] && [ \"\$(trig dns320l:red:sata0)\" = none ] && [ \"\$(cat $SHAREOS_ROOT/tmp/sys/power_led/brightness)\" = 1 ]"
box "D-Link DNS-325 NAS (Rev A1)"; leds dns325:white:usb dns325:red:l_hdd dns325:red:r_hdd dns325:white:power
sh $O/usr/sbin/shareos-leds
check "DNS-325: its own LED names, power LED on a GPIO" "[ \"\$(trig dns325:white:usb)\" = heartbeat ] && [ \"\$(cat $SHAREOS_ROOT/sys/class/leds/dns325:white:power/brightness)\" = 1 ] && [ ! -e $SHAREOS_ROOT/tmp/sys/power_led ]"
box "D-Link DNS-320 NAS (Rev A1)"
check "missing LEDs are no error" "sh $O/usr/sbin/shareos-leds"

# --- fan and temperature
hw() { mkdir -p $SHAREOS_ROOT/sys/class/hwmon/$1; echo $2 > $SHAREOS_ROOT/sys/class/hwmon/$1/name; }
box "D-Link DNS-325 NAS (Rev A1)"; hw hwmon0 lm75; hw hwmon1 gpio_fan
echo 52000 > $SHAREOS_ROOT/sys/class/hwmon/hwmon0/temp1_input
SHAREOS_BOARD_ONCE=1 sh $O/usr/sbin/shareos-board
check "DNS-325: lm75 temperature copied, 52 °C -> fan full on gpio-fan" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/temp1_input)\" = 52000 ] && [ \"\$(cat $SHAREOS_ROOT/sys/class/hwmon/hwmon1/pwm1)\" = 255 ] && [ \"\$(cat $SHAREOS_ROOT/sys/class/hwmon/hwmon1/pwm1_enable)\" = 1 ] && [ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 255 ]"
echo 30000 > $SHAREOS_ROOT/sys/class/hwmon/hwmon0/temp1_input
SHAREOS_BOARD_ONCE=1 sh $O/usr/sbin/shareos-board
check "DNS-325: 30 °C -> half speed" "[ \"\$(cat $SHAREOS_ROOT/sys/class/hwmon/hwmon1/pwm1)\" = 100 ]"
box "D-Link DNS-320L-rev-Ax NAS"; hw hwmon0 gpio_fan
echo 56000 > $SHAREOS_ROOT/tmp/sys/temp1_input
SHAREOS_BOARD_ONCE=1 sh $O/usr/sbin/shareos-board
check "DNS-320L: MCU temperature -> pwm1 for the daemon, kernel fans left alone" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 255 ] && [ ! -e $SHAREOS_ROOT/sys/class/hwmon/hwmon0/pwm1 ]"

echo 30000 > $SHAREOS_ROOT/tmp/sys/temp1_input; echo 100 > $SHAREOS_ROOT/tmp/sys/pwm1
touch -d '10 minutes ago' $SHAREOS_ROOT/tmp/sys/temp1_input
SHAREOS_BOARD_ONCE=1 sh $O/usr/sbin/shareos-board
check "DNS-320L: one cycle without a fresh reading changes nothing" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 100 ]"
SHAREOS_BOARD_ONCE=1 SHAREOS_BOARD_MISS_MAX=1 sh $O/usr/sbin/shareos-board
check "DNS-320L: stale temperature (MCU silent) -> fan to full speed" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 255 ]"
touch $SHAREOS_ROOT/tmp/sys/temp1_input; echo 100 > $SHAREOS_ROOT/tmp/sys/pwm1
SHAREOS_BOARD_ONCE=1 SHAREOS_BOARD_MISS_MAX=1 sh $O/usr/sbin/shareos-board
check "DNS-320L: a fresh reading of 30 °C leaves the fan at half speed" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 100 ]"
# the presets come from one file (the web interface reads the same one)
printf '#!/bin/sh\n[ "$*" = "-q get shareos.fan.preset" ] && { echo quiet; exit 0; }\nexit 1\n' > $S/uci
echo 30000 > $SHAREOS_ROOT/tmp/sys/temp1_input
SHAREOS_BOARD_ONCE=1 sh $O/usr/sbin/shareos-board
check "preset quiet from the preset file: 30 °C -> fan off" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 0 ]"
echo 56000 > $SHAREOS_ROOT/tmp/sys/temp1_input
SHAREOS_BOARD_ONCE=1 sh $O/usr/sbin/shareos-board
check "preset quiet: 56 °C -> full" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 255 ]"
printf '#!/bin/sh\n[ "$*" = "-q get shareos.fan.preset" ] && { echo nonsense; exit 0; }\nexit 1\n' > $S/uci
echo 30000 > $SHAREOS_ROOT/tmp/sys/temp1_input; echo 100 > $SHAREOS_ROOT/tmp/sys/pwm1
SHAREOS_BOARD_ONCE=1 sh $O/usr/sbin/shareos-board
check "unknown preset: the fan never stops" "[ \"\$(cat $SHAREOS_ROOT/tmp/sys/pwm1)\" = 100 ]"
printf '#!/bin/sh\nexit 1\n' > $S/uci

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
