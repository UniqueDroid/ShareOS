#!/bin/bash
#
# Tests shareos-net (network from UCI with automatic rollback) on a fake root:
# ifup/ifdown/ip/logger are stubs that only log, nothing touches the real
# network.
#
#   tests/test-net.sh <uci-binary>      (host build, see build-host-ucode.sh)
#
set -u
UCI=${1:?uci binary}
TOP=$(cd "$(dirname "$0")/.." && pwd)
NET="$TOP/src/shareos-core/usr/sbin/shareos-net"
T=$(mktemp -d /tmp/shareos-net-test.XXXX)
trap 'rm -rf "$T"' EXIT
R=$T/root
mkdir -p $R/etc/config $R/etc/network $R/etc/shareos $R/tmp $T/bin
cp "$TOP/src/shareos-core/etc/config/network" $R/etc/config/network
: > $R/etc/resolv.conf

for c in ifup ifdown ip logger start-stop-daemon udhcpc; do
	printf '#!/bin/sh\necho "%s $*" >> %s/calls\n' $c "$T" > $T/bin/$c
done
printf '#!/bin/sh\nexec %q -c %q "$@"\n' "$(readlink -f "$UCI")" "$R/etc/config" > $T/bin/uci
chmod +x $T/bin/*
export SHAREOS_ROOT=$R SHAREOS_TEST_PATH=$T/bin

pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
u() { $T/bin/uci "$@"; }

sh "$NET" start >/dev/null
check "dhcp: interfaces file uses dhcp with hostname" "grep -q 'iface eth0 inet dhcp' $R/etc/network/interfaces && grep -q 'hostname' $R/etc/network/interfaces"
check "start runs ifup -a" "grep -q '^ifup -a' $T/calls"
check "dhcp without answer: fallback address and DHCP watcher" "grep -q '^ip addr add 192.168.0.32/24 dev eth0 label eth0:fb' $T/calls && grep -q '^start-stop-daemon -S -b .* watch' $T/calls"
: > $T/calls
sh "$NET" stop >/dev/null
check "stop removes the fallback address" "grep -q '^ip addr del 192.168.0.32/24 dev eth0' $T/calls"
u set network.lan.fallback=off; u commit network
: > $T/calls
sh "$NET" start >/dev/null
check "fallback can be switched off" "! grep -q 'addr add' $T/calls"

# DHCP waits for the link (DNR-322L: about 12 s after boot)
mkdir -p $R/sys/class/net/eth0; echo 0 > $R/sys/class/net/eth0/carrier
: > $T/calls
( sleep 1.2; echo 1 > $R/sys/class/net/eth0/carrier ) &
sh "$NET" start >/dev/null; wait
check "dhcp: waits for the link before ifup" "grep -q 'link on eth0 after' $T/calls && [ \"\$(grep -nE 'link on eth0|^ifup' $T/calls | cut -d: -f1 | tr '\n' ' ')\" = \"\$(grep -n 'link on eth0' $T/calls | cut -d: -f1) \$(grep -n '^ifup' $T/calls | cut -d: -f1) \" ]"
: > $T/calls
sh "$NET" start >/dev/null
check "dhcp: no waiting when the link is up" "! grep -q 'link on eth0' $T/calls && grep -q '^ifup -a' $T/calls"
rm -rf $R/sys

u set network.lan.proto=static; u set network.lan.ipaddr=192.168.7.20; u set network.lan.netmask=255.255.255.0
u set network.lan.gateway=192.168.7.1; u set network.lan.dns='192.168.7.2 9.9.9.9'; u commit network
: > $T/calls
sh "$NET" restart >/dev/null
check "static: no fallback address" "! grep -q 'label eth0:fb' $T/calls"
check "static: address, netmask, gateway written" "grep -q 'address 192.168.7.20' $R/etc/network/interfaces && grep -q 'netmask 255.255.255.0' $R/etc/network/interfaces && grep -q 'gateway 192.168.7.1' $R/etc/network/interfaces"
check "static: resolv.conf from the DNS list" "[ \"\$(cat $R/etc/resolv.conf)\" = \"\$(printf 'nameserver 192.168.7.2\nnameserver 9.9.9.9')\" ]"
check "restart: ifdown before ifup" "[ \"\$(grep -E '^if(up|down)' $T/calls | cut -d' ' -f1 | tr '\n' ' ')\" = 'ifdown ifup ' ]"

u set network.lan.dns=''; u commit network
sh "$NET" restart >/dev/null
check "static without DNS: the gateway is the DNS server" "grep -qx 'nameserver 192.168.7.1' $R/etc/resolv.conf"

u set network.lan.dns='192.168.7.20'; u commit network
sh "$NET" restart >/dev/null
check "static, the box itself as DNS (DNS filter): the gateway as second server" "[ \"\$(cat $R/etc/resolv.conf)\" = \"\$(printf 'nameserver 192.168.7.20\nnameserver 192.168.7.1')\" ]"

# udhcpc hook: the network hands out the box itself as DNS server
HOOK="$TOP/src/shareos-core/usr/share/udhcpc/default.script.d/shareos-dns"
dhcp() { printf 'search test.lan\n' > $R/etc/resolv.conf; for d in $3; do echo "nameserver $d" >> $R/etc/resolv.conf; done; ip=$1 router=$2 dns=$3 sh "$HOOK" "${4:-bound}"; }
dhcp 192.168.7.20 192.168.7.1 192.168.7.20
check "dhcp, the box itself as DNS: the router added" "[ \"\$(grep nameserver $R/etc/resolv.conf | tr '\n' ' ')\" = 'nameserver 192.168.7.20 nameserver 192.168.7.1 ' ]"
ip=192.168.7.20 router=192.168.7.1 dns=192.168.7.20 sh "$HOOK" renew
check "dhcp renew: the router not added twice" "[ \$(grep -c 'nameserver 192.168.7.1' $R/etc/resolv.conf) = 1 ]"
dhcp 192.168.7.20 192.168.7.1 '192.168.7.2 9.9.9.9'
check "dhcp, other DNS servers: unchanged" "! grep -q 'nameserver 192.168.7.1' $R/etc/resolv.conf"
dhcp 192.168.7.20 192.168.7.1 '192.168.7.20 9.9.9.9'
check "dhcp, the box and another server: unchanged" "! grep -q 'nameserver 192.168.7.1' $R/etc/resolv.conf"
dhcp 192.168.7.20 192.168.7.1 192.168.7.20 deconfig
check "dhcp deconfig: nothing added" "! grep -q 'nameserver 192.168.7.1' $R/etc/resolv.conf"

# apply without confirmation -> rollback
cp $R/etc/config/network $R/etc/shareos/network.rollback
u set network.lan.ipaddr=10.9.9.9; u set network.lan.netmask=255.0.0.0; u set network.lan.gateway=''; u commit network
sh "$NET" apply 2 >/dev/null
check "unconfirmed apply rolls back" "[ \"\$(cat $R/tmp/shareos-net/result)\" = rolledback ] && [ \"\$(u get network.lan.ipaddr)\" = 192.168.7.20 ] && grep -q 'address 192.168.7.20' $R/etc/network/interfaces"
check "rollback file removed, nothing pending" "[ ! -e $R/etc/shareos/network.rollback ] && [ ! -e $R/tmp/shareos-net/pending ]"

# apply with confirmation -> kept
cp $R/etc/config/network $R/etc/shareos/network.rollback
u set network.lan.proto=dhcp; u commit network
sh "$NET" apply 6 >/dev/null &
for i in $(seq 1 30); do [ -e $R/tmp/shareos-net/pending ] && break; sleep 0.2; done
check "pending while waiting" "[ -e $R/tmp/shareos-net/pending ]"
sleep 3; sh "$NET" confirm
wait
check "confirmed apply keeps the new settings" "[ \"\$(cat $R/tmp/shareos-net/result)\" = ok ] && [ \"\$(u get network.lan.proto)\" = dhcp ] && grep -q 'inet dhcp' $R/etc/network/interfaces"
check "confirm without a pending change does nothing" "! sh $NET confirm && [ ! -e $R/tmp/shareos-net/confirmed ]"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
