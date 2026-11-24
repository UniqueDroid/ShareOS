# ShareOS – which box is this, and how is it driven?
#
# Sourced by the start scripts, the initramfs and shareos-boardinfo
# (tests: SHAREOS_ROOT=<fake root>, SHAREOS_BOARD_LIB=<this file>):
#   . /usr/lib/shareos/board.sh; board_detect
# sets the BOARD_* variables from the device-tree model. One system image
# serves all models; everything that differs between them is described here.
#
#   BOARD_ID            short name: dns320l, dns320b, dns320a, dnr322l, dns325, dns327l, unknown
#   BOARD_NAME          for people
#   BOARD_FWNAME        name in the release files: ShareOS-<version>-<fwname>.bin
#   BOARD_SIG           signature of D-Link firmware files for this box (dns323-fw)
#   BOARD_MODEL         text the device-tree model must contain
#   BOARD_CONTROL       fan, temperature and power-off:
#                         mcu       Weltrend MCU on ttyS1 (dns320l-daemon): fan,
#                                   temperature, power LED, RTC, power-off
#                         hwmon     kernel: gpio-fan, lm75 temperature, gpio-poweroff
#                         mcu-temp  kernel gpio-fan and gpio-poweroff, the temperature
#                                   comes from the MCU on ttyS1 (DNS-320 rev A)
#   BOARD_RTC           mcu (through dns320l-daemon) or kernel (/dev/rtc0)
#   BOARD_POWER_BUTTON  chip:line of a power button that raises no interrupt
#                       (polled by shareos-board); empty: gpio-keys (shareos-buttons)
#   BOARD_POWER_BACK    gpio "chip:line" that switches the box on again after a
#                       power cut (set at boot), empty: the MCU does it / none
#   BOARD_LED_STATUS    LED for the status setting (heartbeat/on/off)
#   BOARD_LED_USB       LED for USB activity and the reset/rescue feedback
#   BOARD_LED_INSTALL   LED that blinks during the first installation and in
#                       rescue mode; empty: BOARD_LED_USB
#   BOARD_LED_DISK1, BOARD_LED_DISK2   disk LEDs (left, right)
#   BOARD_LED_POWER     power LED; empty: driven by the MCU (/tmp/sys/power_led)
#   BOARD_RAM_SMALL     1 on boxes with 128 MB RAM
#   BOARD_TESTED        1 when tested on real hardware
#   BOARD_DEVTEST       1 on a model that is being added (devtest image): root
#                       keeps the password "shareos" (no claiming), the web
#                       interface says so and offers the device info
#                       (#/deviceinfo); its files are named …-devtest and are
#                       never part of a release. Only set in the case of
#                       such a model – an unknown model (no device tree, the
#                       emulator) is claimed as usual.

board_detect() {
	model=$( { tr -d '\000' < ${SHAREOS_ROOT:-}/proc/device-tree/model; } 2>/dev/null)
	BOARD_POWER_BUTTON= BOARD_POWER_BACK= BOARD_LED_POWER= BOARD_RAM_SMALL=0 BOARD_TESTED=0 BOARD_DEVTEST=0
	case "$model" in
	*DNS-320L*)
		BOARD_ID=dns320l BOARD_NAME="D-Link DNS-320L rev A" BOARD_FWNAME=DNS-320L-rev-Ax
		BOARD_SIG=DNS320L BOARD_MODEL=DNS-320L BOARD_CONTROL=mcu BOARD_RTC=mcu
		BOARD_POWER_BUTTON=gpiochip0:29
		BOARD_LED_STATUS=dns320l:blue:usb BOARD_LED_USB=dns320l:orange:usb
		BOARD_LED_DISK1=dns320l:red:sata0 BOARD_LED_DISK2=dns320l:red:sata1
		BOARD_TESTED=1 ;;
	*DNS-320-rev-B*)
		# the board of the DNS-320L with 128 MB RAM
		BOARD_ID=dns320b BOARD_NAME="D-Link DNS-320 rev B" BOARD_FWNAME=DNS-320-rev-Bx
		BOARD_SIG=DNS320B BOARD_MODEL=DNS-320-rev-B BOARD_CONTROL=mcu BOARD_RTC=mcu
		BOARD_POWER_BUTTON=gpiochip0:29
		BOARD_LED_STATUS=dns320l:blue:usb BOARD_LED_USB=dns320l:orange:usb
		BOARD_LED_DISK1=dns320l:red:sata0 BOARD_LED_DISK2=dns320l:red:sata1
		BOARD_RAM_SMALL=1 ;;
	*DNS-325*)
		BOARD_ID=dns325 BOARD_NAME="D-Link DNS-325 rev A" BOARD_FWNAME=DNS-325-rev-Ax
		BOARD_SIG=DNS-325 BOARD_MODEL=DNS-325 BOARD_CONTROL=hwmon BOARD_RTC=kernel
		BOARD_POWER_BACK=gpiochip1:5
		BOARD_LED_STATUS=dns325:white:usb BOARD_LED_USB=dns325:red:usb
		BOARD_LED_DISK1=dns325:red:l_hdd BOARD_LED_DISK2=dns325:red:r_hdd
		BOARD_LED_POWER=dns325:white:power ;;
	*DNR-322L*)
		# the board of the DNS-320 rev A as a video recorder: 256 MB RAM, a
		# smaller system partition, a partition for the NUUO software
		BOARD_ID=dnr322l BOARD_NAME="D-Link DNR-322L rev A" BOARD_FWNAME=DNR-322L-rev-Ax
		BOARD_SIG=DNR-322 BOARD_MODEL=DNR-322L BOARD_CONTROL=mcu-temp BOARD_RTC=kernel
		BOARD_POWER_BACK=gpiochip1:5
		BOARD_LED_STATUS=dns320:blue:usb BOARD_LED_USB=dns320:orange:usb
		BOARD_LED_DISK1=dns320:orange:l_hdd BOARD_LED_DISK2=dns320:orange:r_hdd
		BOARD_LED_POWER=dns320:blue:power
		# the front has the power and disk LEDs only (D-Link manual): installation
		# and rescue mode blink the power LED
		BOARD_LED_INSTALL=dns320:blue:power
		# being added: root / shareos, device info (#180)
		BOARD_DEVTEST=1 ;;
	*DNS-320*)
		BOARD_ID=dns320a BOARD_NAME="D-Link DNS-320 rev A" BOARD_FWNAME=DNS-320-rev-Ax
		BOARD_SIG=DNS323D1 BOARD_MODEL=DNS-320 BOARD_CONTROL=mcu-temp BOARD_RTC=kernel
		BOARD_POWER_BACK=gpiochip1:5
		BOARD_LED_STATUS=dns320:blue:usb BOARD_LED_USB=dns320:orange:usb
		BOARD_LED_DISK1=dns320:orange:l_hdd BOARD_LED_DISK2=dns320:orange:r_hdd
		BOARD_LED_POWER=dns320:blue:power BOARD_RAM_SMALL=1 ;;
	*DNS-327L*)
		BOARD_ID=dns327l BOARD_NAME="D-Link DNS-327L rev A" BOARD_FWNAME=DNS-327L-rev-Ax
		BOARD_SIG=DNS327L BOARD_MODEL=DNS-327L BOARD_CONTROL=mcu BOARD_RTC=mcu
		BOARD_POWER_BUTTON=gpiochip2:1
		BOARD_LED_STATUS=dns327l:white:usb BOARD_LED_USB=dns327l:white:usb
		BOARD_LED_DISK1=dns327l:amber:sata-l BOARD_LED_DISK2=dns327l:amber:sata-r ;;
	*)
		BOARD_ID=unknown BOARD_NAME="${model:-unknown}" BOARD_FWNAME= BOARD_SIG= BOARD_MODEL=
		BOARD_CONTROL=none BOARD_RTC=kernel
		BOARD_LED_STATUS= BOARD_LED_USB= BOARD_LED_DISK1= BOARD_LED_DISK2= ;;
	esac
}

# all variables as KEY=value lines (for /tmp/sys/board.env and shareos-boardinfo)
board_env() {
	for v in ID NAME FWNAME SIG MODEL CONTROL RTC POWER_BUTTON POWER_BACK \
		LED_STATUS LED_USB LED_INSTALL LED_DISK1 LED_DISK2 LED_POWER RAM_SMALL TESTED DEVTEST; do
		eval "printf 'BOARD_%s=\"%s\"\n' $v \"\$BOARD_$v\""
	done
}

# an LED: name trigger [brightness]; nothing when the box has no such LED
board_led() {
	[ -n "$1" ] && [ -e "${SHAREOS_ROOT:-}/sys/class/leds/$1/trigger" ] || return 0
	echo "$2" > "${SHAREOS_ROOT:-}/sys/class/leds/$1/trigger" 2>/dev/null
	[ -n "$3" ] && echo "$3" > "${SHAREOS_ROOT:-}/sys/class/leds/$1/brightness"
	return 0
}
