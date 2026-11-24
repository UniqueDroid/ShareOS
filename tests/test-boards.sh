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

# --- devtest: a model that is being added, and an unknown one
check "known models are no devtest" "[ \"\$(info devtest)\" = 0 ] && info | grep -qx 'BOARD_DEVTEST=\"0\"'"
box "Some other NAS"
check "an unknown model counts as devtest" "[ \"\$(info devtest)\" = 1 ]"
# S03claim leaves root alone on a devtest box
cl() { # model -> root hash after S03claim (fake /etc, /overlay)
	box "$1"; mkdir -p $T/c/etc $T/c/overlay; : > $T/c/overlay/claim
	h=$(openssl passwd -1 -salt abcdefgh shareos); echo "root:$h:19000:0:99999:7:::" > $T/c/shadow
	sed -e "s|/proc/cmdline|$T/c/cmdline|; s|/overlay/claim|$T/c/overlay/claim|g; s|/etc/shadow|$T/c/shadow|g" $O/etc/init.d/S03claim > $T/c/S03claim
	printf '#!/bin/sh\nexec sh %s "$@"\n' $O/usr/sbin/shareos-boardinfo > $S/shareos-boardinfo
	printf '#!/bin/sh\n[ "$1" = -P ] && { read -r p <&0; openssl passwd -1 -salt abcdefgh "$p"; }\n' > $S/mkpasswd; chmod 755 $S/*
	: > $T/c/cmdline; sh $T/c/S03claim start; cut -d: -f2 $T/c/shadow
}
if command -v openssl >/dev/null; then
	check "S03claim: a new DNS-320L gets root locked" "[ \"\$(cl 'D-Link DNS-320L-rev-Ax NAS')\" = '!' ]"
	check "S03claim: a devtest box keeps root / shareos" "case \"\$(cl 'Some other NAS')\" in '\$1\$'*) true ;; *) false ;; esac"
fi

# --- shareos-deviceinfo: masked for public issues, --full on request
D=$O/usr/sbin/shareos-deviceinfo
box "D-Link DNR-322L"; mkdir -p $SHAREOS_ROOT/sys/class/net/eth0 $SHAREOS_ROOT/dev $SHAREOS_ROOT/sys/class/leds/dnr:blue:power
echo "[none] timer heartbeat" > "$SHAREOS_ROOT/sys/class/leds/dnr:blue:power/trigger"
echo 00:50:43:12:ab:cd > $SHAREOS_ROOT/sys/class/net/eth0/address
printf 'Processor\t: Feroceon 88FR131 rev 1 (v5l)\nSerial\t\t: 1234567890abcdef\n' > $SHAREOS_ROOT/proc/cpuinfo
printf 'dev:    size   erasesize  name\nmtd0: 00100000 00020000 "u-boot"\nmtd1: 00020000 00020000 "u-boot-env"\n' > $SHAREOS_ROOT/proc/mtd
printf 'ABCDbootcmd=nand read 0xa00000 0x100000 0x300000\0ethaddr=00:50:43:12:ab:cd\0serialno=XYZ123456\0\0' > $SHAREOS_ROOT/dev/mtd1
printf 'console=ttyS0,115200\0' > $SHAREOS_ROOT/proc/cmdline
printf '#!/bin/sh\necho "[    0.000] Booting Linux, MAC 00:50:43:12:ab:cd"\n' > $S/dmesg; chmod 755 $S/dmesg
sh $D > $T/di.txt 2>&1; sh $D --full > $T/full.txt 2>&1
check "deviceinfo: model, flash, U-Boot environment, LEDs, kernel log" "grep -q 'DNR-322L' $T/di.txt && grep -q 'u-boot-env' $T/di.txt && grep -q 'bootcmd=nand read' $T/di.txt && grep -q 'dnr:blue:power: none' $T/di.txt && grep -q 'Booting Linux' $T/di.txt"
check "deviceinfo: MAC addresses and serial numbers masked by default" "! grep -qi '00:50:43:12:ab:cd\\|XYZ123456\\|1234567890abcdef' $T/di.txt && grep -q 'xx:xx:xx:xx:ab:cd' $T/di.txt && grep -q 'serialno=(masked)' $T/di.txt"
check "deviceinfo --full: everything as it is" "grep -q 'ethaddr=00:50:43:12:ab:cd' $T/full.txt && grep -q 'serialno=XYZ123456' $T/full.txt && grep -q 'NOT MASKED' $T/full.txt"

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
