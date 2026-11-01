#!/bin/sh
#
# Tests shareos-printer (system app "printer") with a fake /sys and fake
# ipp-usb / p910nd: which printer gets which way, the avahi service file of a
# port-9100 printer, mode raw, unplugging, switching off, the status lines.
#
#   tests/test-printer.sh [dir with uci]
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
P="$TOP/src/shareos-core/usr/sbin/shareos-printer"
T=$(mktemp -d)
cleanup() { SHAREOS_ROOT=$T sh "$P" stop-all >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT
[ -n "$DEBUG" ] && trap "" EXIT
export PATH="${1:+$1:}$PATH"
mkdir -p $T/etc/config $T/sys/bus/usb/devices $T/dev/usb $T/bin
# fake programs: stay running, log their arguments
for p in ipp-usb p910nd; do
	printf '#!/bin/sh\necho "$0 $*" >> %s/calls.log\n[ "$1" = status ] && { echo " Num  Device              Vndr:Prod  Port  Model"; echo "   1. Bus 001 Device 003  03f0:5c11  60000 \\"HP Smart Tank 5100 series\\""; exit 0; }\nwhile :; do sleep 1; done\n' $T > $T/bin/$p
	chmod 755 $T/bin/$p
done
export SHAREOS_ROOT=$T SHAREOS_PRINTER_SYS=$T/sys SHAREOS_PRINTER_IPPUSB=$T/bin/ipp-usb SHAREOS_PRINTER_P910ND=$T/bin/p910nd
run() { sh "$P" "$@"; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
conf() { printf "config printer 'main'\n" > $T/etc/config/printer; for kv; do printf "\toption %s '%s'\n" "${kv%%=*}" "${kv#*=}" >> $T/etc/config/printer; done; }
# usb device <dir> <vid> <pid> <maker> <model> <interface protocols...> (lp node on the 7/1/2 one)
dev() {
	d=$T/sys/bus/usb/devices/$1; mkdir -p $d
	echo $2 > $d/idVendor; echo $3 > $d/idProduct; echo "$4" > $d/manufacturer; echo "$5" > $d/product
	n=0; shift 5
	for proto; do
		i=$d:1.$n; mkdir -p $i; echo 07 > $i/bInterfaceClass; echo $proto > $i/bInterfaceProtocol
		[ $proto = 02 ] && { mkdir -p $i/usbmisc/lp$LP; touch $T/dev/usb/lp$LP; }
		n=$((n + 1))
	done
}
running() { [ -n "$(cat $T/tmp/shareos-printer/$1.pid 2>/dev/null)" ] && kill -0 "$(cat $T/tmp/shareos-printer/$1.pid)" 2>/dev/null; }

conf enabled=1
LP=0 dev 1-1 03f0 5c11 HP "Smart Tank 5100 series" 02 04 04
LP=1 dev 1-2 04a9 1234 Canon "LBP2900" 02
run apply
check "IPP-over-USB printer: ipp-usb runs" "running ipp-usb"
check "ipp-usb: network config, ports from 60000" "grep -q 'interface = all' $T/tmp/shareos-printer/conf/ipp-usb.conf && grep -q 'http-min-port = 60000' $T/tmp/shareos-printer/conf/ipp-usb.conf"
check "ipp-usb: port state kept on the flash" "grep -q -- '-path-dev-state-dir $T/etc/shareos/printer/dev' $T/calls.log"
check "the IPP printer gets no p910nd" "! running p9100"
check "older printer: p910nd on lp1 (port 9101)" "running p9101 && grep -q 'p910nd -f $T/dev/usb/lp1 -b -d 1' $T/calls.log"
check "older printer: announced as _pdl-datastream on 9101" "grep -q '<port>9101</port>' $T/etc/avahi/services/shareos-printer-lp1.service && grep -q '<name>Canon LBP2900</name>' $T/etc/avahi/services/shareos-printer-lp1.service"
check "status: both printers with their way and port" "run status | grep -qx 'printer=03f0:5c11|1|lp0|ipp-usb|60000|HP | Smart Tank 5100 series' && run status | grep -qx 'printer=04a9:1234|0|lp1|p910nd|9101|Canon | LBP2900'"
p=$(cat $T/tmp/shareos-printer/p9101.pid)
run apply
check "apply again: nothing restarted" "[ \"\$(cat $T/tmp/shareos-printer/p9101.pid)\" = $p ]"
rm -rf $T/sys/bus/usb/devices/1-2 $T/sys/bus/usb/devices/1-2:*
run apply
check "unplugged: its p910nd stops, its service file goes" "! running p9101 && [ ! -e $T/etc/avahi/services/shareos-printer-lp1.service ]"
conf enabled=1 mode=raw
run apply
check "mode raw: ipp-usb off, p910nd also for the IPP printer" "! running ipp-usb && running p9100"
conf enabled=0
run apply
check "switched off: nothing runs" "! running ipp-usb && ! running p9100 && ! ls $T/etc/avahi/services/ | grep -q shareos-printer"
check "status: switched off, no ports" "run status | grep -qx 'enabled=0' && run status | grep -qx 'printer=03f0:5c11|1|lp0|ipp-usb||HP | Smart Tank 5100 series'"
check "boot while switched off: nothing" "run boot && ! running ipp-usb"
check "test page: refuses an unknown printer" "run test lp7 | grep -q 'no such printer'"

echo "test-printer: $pass passed, $failed failed"
[ $failed = 0 ]
