#!/bin/sh
#
# Tests shareos-zabbix without the agent: checking the settings, the PSK file,
# reading the disks' SMART values (fake disks, the SMART cache of Storage →
# Health, a fake ubus for a sleeping disk), the low-level discovery and the
# values for the agent's items (box, disks, RAID from a fake /proc/mdstat).
# The agent itself runs in tests/test-zabbix.sh (ARM emulator).
#
#   tests/test-zabbix-items.sh [dir with ucode]      (LD_LIBRARY_PATH for its libraries)
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
BIN=${1:-}
UCODE=${BIN:+$BIN/}ucode
Z="$TOP/src/shareos-core/usr/sbin/shareos-zabbix"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p $T/etc/config $T/tmp/sys $T/tmp/shareos-storage $T/proc $T/sys/block \
	$T/devices/ata1/host0/sda $T/devices/ata2/host1/sdb $T/devices/usb1/1-1/host2/sdc
cp "$TOP/src/shareos-core/etc/config/zabbix" $T/etc/config/zabbix
ln -s $T/devices/ata1/host0/sda $T/sys/block/sda
ln -s $T/devices/ata2/host1/sdb $T/sys/block/sdb
ln -s $T/devices/usb1/1-1/host2/sdc $T/sys/block/sdc
echo 'SHAREOS_VERSION="0.2.0-beta.15"' > $T/etc/shareos-release
echo 'BOARD_NAME="DNS-320L rev A"' > $T/tmp/sys/board.env
echo 41000 > $T/tmp/sys/temp1_input; echo 2200 > $T/tmp/sys/fan1_input; echo 127 > $T/tmp/sys/pwm1
cat > $T/proc/mdstat <<'MD'
Personalities : [raid1] [raid0]
md0 : active raid1 sdb2[1] sda2[0]
      3902296064 blocks super 1.2 [2/1] [U_]
      [===>.................]  recovery = 17.3% (675100672/3902296064) finish=310.2min speed=173380K/sec

md1 : active raid0 sdb3[1] sda3[0]
      2097152 blocks super 1.2 512k chunks

unused devices: <none>
MD
now=$(date +%s)
cat > $T/tmp/shareos-storage/smart-sda.json <<EOF
{"time":$now,"passed":true,"temperature":38,"temperature_max":51,"power_on_hours":21034,"power_cycles":412,"reallocated":0,"pending":2,"uncorrectable":0,"crc_errors":0,"error_count":0,"model":"WDC WD40EFRX","serial":"WD-TEST1","life_left":null,"rating":"warn"}
EOF
cat > $T/tmp/shareos-storage/smart-sdb.json <<EOF
{"time":$now,"passed":true,"temperature":35,"model":"Samsung SSD 870","serial":"S-TEST2","life_left":97,"rating":"good"}
EOF
# a fake ubus: sda is asleep, sdb gets fresh values (as rpcd would read them)
cat > $T/ubus <<EOF
#!/bin/sh
echo "\$*" >> $T/ubus.log
case "\$*" in
	*sda*) echo '{"standby":true}' ;;
	*sdb*) echo '{"time":$now,"passed":false,"temperature":61,"model":"Samsung SSD 870","serial":"S-TEST2","life_left":8,"rating":"bad"}' ;;
esac
EOF
chmod 755 $T/ubus
export SHAREOS_ROOT=$T SHAREOS_TEST_UBUS=$T/ubus
run() { "$UCODE" -L "${BIN:+$BIN/../lib/ucode}" "$Z" "$@"; }
set_() { echo "$1" | run set; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }

check "status: off, not installed, defaults" "run status | js \"not d['installed'] and not d['enabled'] and d['metadata']=='ShareOS' and d['disk_interval']==30 and d['port']==10050\""
check "settings: servers, host name, metadata" "set_ '{\"server\":\"zbx.example.org, [fd00::5]:10051,10.0.0.5:10051\",\"hostname\":\"nas 1\",\"metadata\":\"ShareOS NAS\"}' | js \"d['server']==['zbx.example.org','[fd00::5]:10051','10.0.0.5:10051'] and d['hostname']=='nas 1'\""
check "invalid server refused, nothing saved" "set_ '{\"server\":\"a;b\",\"hostname\":\"x\"}' | js \"'invalid server' in d['error']\" && run status | js \"d['hostname']=='nas 1'\""
check "invalid port refused" "set_ '{\"server\":\"zbx:70000\"}' | js \"'invalid port' in d['error']\""
check "hostname with a line break refused" "set_ '{\"hostname\":\"a\\\\nb\"}' | js \"'hostname' in d['error']\""
check "metadata with a line break refused" "set_ '{\"metadata\":\"a\\\\nb\"}' | js \"'metadata' in d['error']\""
check "passive without allowed addresses refused" "set_ '{\"passive\":true}' | js \"'allow' in d['error']\""
check "passive with allowed addresses" "set_ '{\"passive\":true,\"allow\":\"10.0.0.5, 10.0.1.0/24\",\"port\":10050}' | js \"d['passive'] and d['allow']==['10.0.0.5','10.0.1.0/24']\""
check "disk interval: only 10/15/20/30/60" "set_ '{\"disk_interval\":7}' | js \"'disk_interval' in d['error']\" && set_ '{\"disk_interval\":15}' | js \"d['disk_interval']==15\""
check "PSK: identity without a key refused" "set_ '{\"psk_identity\":\"nas\"}' | js \"'no key' in d['error']\""
check "PSK: odd or short keys refused" "set_ '{\"psk\":\"0011223344556677889900112233445\",\"psk_identity\":\"nas\"}' | js \"'psk:' in d['error']\" && set_ '{\"psk\":\"00ff\",\"psk_identity\":\"nas\"}' | js \"'psk:' in d['error']\""
check "PSK: saved in lower case, root only" "set_ '{\"psk\":\"00112233445566778899AABBCCDDEEFF\",\"psk_identity\":\"nas PSK\"}' | js \"d['psk'] and d['psk_identity']=='nas PSK'\" && grep -qx 00112233445566778899aabbccddeeff $T/etc/shareos/zabbix.psk && [ \$(stat -c %a $T/etc/shareos/zabbix.psk) = 600 ]"
check "PSK: a key needs its identity" "set_ '{\"psk_identity\":\"\"}' | js \"'psk_identity' in d['error']\""
check "PSK: removed together" "set_ '{\"psk\":\"\",\"psk_identity\":\"\"}' | js \"not d['psk'] and d['psk_identity']==''\" && [ ! -e $T/etc/shareos/zabbix.psk ]"
check "switching on without the system app: clear error" "set_ '{\"enabled\":true}' | js \"'not installed' in d['error']\""

check "collect: the disks in the bays from the SMART cache, no USB stick" "run collect | js \"sorted(d['disks'])==['sda','sdb'] and d['disks']['sda']['temperature']==38 and d['disks']['sda']['rating']==1\" && [ ! -e $T/ubus.log ]"
check "discovery disk: LLD macros" "run discovery disk | js \"d==[{'{#DISK}':'sda','{#MODEL}':'WDC WD40EFRX','{#SERIAL}':'WD-TEST1'},{'{#DISK}':'sdb','{#MODEL}':'Samsung SSD 870','{#SERIAL}':'S-TEST2'}]\""
g() { run get "$@"; }
check "disk values" "[ \"\$(g disk sda temperature)\" = 38 ] && [ \"\$(g disk sda pending)\" = 2 ] && [ \"\$(g disk sda passed)\" = 1 ] && [ \"\$(g disk sda standby)\" = 0 ] && [ \"\$(g disk sdb life_left)\" = 97 ] && [ \"\$(g disk sda model)\" = 'WDC WD40EFRX' ]"
check "disk age in seconds" "a=\$(g disk sda age); [ \"\$a\" -ge 0 ] && [ \"\$a\" -lt 60 ]"
check "missing value: empty" "[ -z \"\$(g disk sda life_left)\" ]"
check "unknown disk / key / invalid name: error text" "g disk sdz temperature | grep -q '^error: no values' && g disk sda nonsense | grep -q '^error: unknown key' && g disk 'sda;id' temperature | grep -q '^error: invalid disk'"
# older cache: rpcd is asked again – sda sleeps (keeps its values), sdb has new ones
touch -d '2 hours ago' $T/tmp/shareos-storage/smart-sda.json $T/tmp/shareos-storage/smart-sdb.json
run collect >/dev/null
check "older cache: read again through ubus (rpcd), without waking disks" "grep -q 'call shareos.storage smart {\"disk\":\"sda\"}' $T/ubus.log && grep -q '\"disk\":\"sdb\"' $T/ubus.log"
check "a sleeping disk keeps its last values, standby 1" "[ \"\$(g disk sda standby)\" = 1 ] && [ \"\$(g disk sda temperature)\" = 38 ]"
check "new values of a disk: critical, hot, worn" "[ \"\$(g disk sdb rating)\" = 2 ] && [ \"\$(g disk sdb temperature)\" = 61 ] && [ \"\$(g disk sdb life_left)\" = 8 ] && [ \"\$(g disk sdb passed)\" = 0 ]"
check "box values: temperature, fan, version, model" "[ \"\$(g box temperature)\" = 41 ] && [ \"\$(g box fan_rpm)\" = 2200 ] && [ \"\$(g box fan_pwm)\" = 127 ] && [ \"\$(g box version)\" = 0.2.0-beta.15 ] && [ \"\$(g box board)\" = 'DNS-320L rev A' ]"
check "discovery raid" "run discovery raid | js \"d==[{'{#RAID}':'md0','{#LEVEL}':'raid1'},{'{#RAID}':'md1','{#LEVEL}':'raid0'}]\""
check "a degraded mirror in recovery" "[ \"\$(g raid md0 health)\" = U_ ] && [ \"\$(g raid md0 missing)\" = 1 ] && [ \"\$(g raid md0 working)\" = 1 ] && [ \"\$(g raid md0 syncing)\" = 1 ] && [ \"\$(g raid md0 sync_percent)\" = 17.3 ] && [ \"\$(g raid md0 sync_action)\" = recovery ] && [ \"\$(g raid md0 active)\" = 1 ]"
check "a stripe without redundancy: no health line" "[ \"\$(g raid md1 level)\" = raid0 ] && [ -z \"\$(g raid md1 health)\" ] && [ \"\$(g raid md1 syncing)\" = 0 ] && [ \"\$(g raid md1 sync_action)\" = idle ]"
check "unknown array: error text" "g raid md9 health | grep -q '^error: no array'"
check "data for the agent not readable for everybody" "[ \$(stat -c %a $T/tmp/shareos-zabbix/disks.json) = 640 ]"

echo
echo "test-zabbix-items: $pass passed, $failed failed"
[ $failed -eq 0 ]
