#!/bin/bash
#
# Tests the Zabbix agent: system app zabbix-agent, shareos-zabbix – built ARM
# userland (qemu-user) in a chroot, fake disks, a fake Zabbix server
# (tests/zabbix-fake-server.py) on the host that takes the agent's active checks.
#
#   sudo tests/test-zabbix.sh [output/dns320l] [zabbix-agent.sapp]   (make sysapps-pack)
#
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/zabbix-agent-*.sapp 2>/dev/null | head -1)}
[ -f "$SAPP" ] || { echo "no zabbix-agent .sapp – make sysapps-pack"; exit 1; }
PORT=10951

T=$(mktemp -d /tmp/shareos-zabbix-test.XXXX)
R=$T/root
SRV=
cleanup() {
	[ -n "$SRV" ] && kill "$SRV" 2>/dev/null
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-zabbix stop-all; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
	for m in $(grep " $R/" /proc/mounts | awk '{print $2}' | sort -r); do umount -l "$m" 2>/dev/null; done
	if grep -q " $R/" /proc/mounts; then echo "still mounted below $R – not removed" >&2; else rm -rf "$T"; fi
}
trap cleanup EXIT

if [ ! -e /proc/sys/fs/binfmt_misc/qemu-arm ]; then
	[ -e /proc/sys/fs/binfmt_misc/register ] || mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
	echo ":qemu-arm:M::\x7fELF\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x28\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:$QEMU:F" \
		> /proc/sys/fs/binfmt_misc/register
fi

"$UNSQ" -q -d "$R" "$SQFS" >/dev/null
# testing a changed controller with an older image: SHAREOS_TEST_CONTROLLER=<file>
[ -n "${SHAREOS_TEST_CONTROLLER:-}" ] && cp "$SHAREOS_TEST_CONTROLLER" "$R/usr/sbin/shareos-zabbix"
mount -t proc proc "$R/proc"
mount --bind /dev "$R/dev"
mount -t tmpfs tmpfs "$R/tmp"
mkdir -p "$R/var/run/ubus" "$R/var/log" "$R/etc/crontabs"

run() { chroot "$R" /usr/bin/env SHAREOS_TEST_SYSBLOCK=/tmp/fakeblock /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }
z() { run "echo '$1' | shareos-zabbix set"; }
srv() { python3 -c "import json,sys; d=json.load(open('$T/server.json')); sys.exit(0 if ($1) else 1)" 2>/dev/null; }
# wait until the fake server has seen what $1 tests (at most $2 seconds)
wait_srv() { i=0; until srv "$1" || [ $i -ge ${2:-60} ]; do sleep 1; i=$((i + 1)); done; }

# two disks in the bays (sda, sdb) and a USB stick (sdc) – only the bays count;
# SMART values of sda and sdb as Storage → Health caches them, sdb asleep
mkdir -p $R/tmp/fake/devices/ata1/host0/sda $R/tmp/fake/devices/ata2/host1/sdb $R/tmp/fake/devices/usb1/1-1/host2/sdc $R/tmp/fakeblock $R/tmp/shareos-storage
ln -sfn /tmp/fake/devices/ata1/host0/sda $R/tmp/fakeblock/sda
ln -sfn /tmp/fake/devices/ata2/host1/sdb $R/tmp/fakeblock/sdb
ln -sfn /tmp/fake/devices/usb1/1-1/host2/sdc $R/tmp/fakeblock/sdc
now=$(date +%s)
cat > $R/tmp/shareos-storage/smart-sda.json <<EOF
{"time":$now,"passed":true,"temperature":38,"temperature_max":51,"power_on_hours":21034,"power_cycles":412,"start_stops":420,"reallocated":0,"pending":2,"uncorrectable":0,"crc_errors":0,"error_count":0,"model":"WDC WD40EFRX","serial":"WD-TEST1","ssd":false,"life_left":null,"rating":"warn","reasons":["pending"]}
EOF
cat > $R/tmp/shareos-storage/smart-sdb.json <<EOF
{"time":$now,"passed":true,"temperature":35,"power_on_hours":512,"reallocated":0,"pending":0,"model":"Samsung SSD 870","serial":"S-TEST2","ssd":true,"life_left":97,"rating":"good","reasons":[]}
EOF

run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.storage' | grep -q storage || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done

python3 "$TOP/tests/zabbix-fake-server.py" $PORT "$T/server.json" agent.ping agent.version 'vm.memory.size[available]' \
	'shareos.box[version]' 'shareos.box[nonsense]' shareos.disk.discovery shareos.raid.discovery \
	'shareos.disk[sda,temperature]' 'shareos.disk[sda,rating]' 'shareos.disk[sda,pending]' 'shareos.disk[sda,model]' \
	'shareos.disk[sdb,life_left]' 'shareos.disk[sda,life_left]' 'shareos.disk[sdz,temperature]' 'system.run[id]' &
SRV=$!
sleep 1

check "not installed: status says so, start refused" "run 'shareos-zabbix status' | js \"not d['installed'] and not d['running'] and not d['enabled']\" && run 'shareos-zabbix start' | js \"'not installed' in d.get('error','')\""
cp "$SAPP" "$R/tmp/z.sapp"
check "system app zabbix-agent installs (on the flash, small)" "run 'shareos-apps install-file /tmp/z.sapp' | js \"d.get('id')=='zabbix-agent'\" && [ -x $R/opt/shareos/bin/zabbix-agentd ] && [ ! -L $R/opt/shareos/sysapps/zabbix-agent ]"
check "not started by the install (no server yet)" "run 'shareos-zabbix status' | js \"d['installed'] and not d['running']\""
check "service list shows the agent" "run 'ubus call shareos.service list' | grep -q 'zabbix'"
check "the agent's own version, with TLS (OpenSSL)" "run '/opt/shareos/bin/zabbix-agentd -V' | grep -q '(Zabbix) 7\.0\.' && run '/opt/shareos/bin/zabbix-agentd -V' | grep -q 'Compiled with OpenSSL'"
check "switching on without a server: clear error" "z '{\"enabled\":true}' | js \"'no Zabbix server' in d.get('error','')\""
check "invalid server refused" "z '{\"server\":\"a b;rm -rf /\"}' | js \"'invalid server' in d.get('error','')\""
check "invalid hostname refused" "z '{\"hostname\":\"a\\\\nb\"}' | js \"'hostname' in d.get('error','')\""
check "invalid disk interval refused" "z '{\"disk_interval\":7}' | js \"'disk_interval' in d.get('error','')\""
o=$(z "{\"enabled\":true,\"server\":\"127.0.0.1:$PORT\",\"hostname\":\"nas-test\",\"metadata\":\"ShareOS NAS\"}")
check "switched on: running with the settings" "echo '$o' | js \"d['running'] and d['server']==['127.0.0.1:$PORT'] and d['hostname_used']=='nas-test'\""
C=$R/tmp/shareos-zabbix/zabbix_agentd.conf
check "active mode: no listener (StartAgents=0), no Server line" "grep -q '^StartAgents=0$' $C && grep -q '^ServerActive=127.0.0.1:$PORT$' $C && ! grep -q '^Server=' $C"
check "configuration and data not readable for everybody" "[ \$(stat -c %a $C) = 640 ] && [ \$(stat -c %a $R/tmp/shareos-zabbix) = 750 ] && [ \$(stat -c %a $R/tmp/shareos-zabbix/disks.json) = 640 ]"
p=$(cat $R/tmp/shareos-zabbix/pid 2>/dev/null)
check "the agent runs as the user zabbix, not root" "[ -n '$p' ] && [ \"\$(awk '/^Uid:/ {print \$2}' /proc/$p/status)\" = \"\$(run 'id -u zabbix')\" ] && [ \"\$(run 'id -u zabbix')\" != 0 ]"
check "no TCP port opened" "! grep -qi ':2742 ' /proc/net/tcp"   # 10050 = 0x2742
check "the cron job reads the disks every 30 minutes" "grep -q '^\*/30 \* \* \* \* /usr/sbin/shareos-zabbix collect' $R/etc/crontabs/root"
wait_srv "d['values'].get('shareos.disk[sdb,life_left]') is not None and d['values'].get('agent.ping')" 90
check "auto-registration data: host name and metadata" "srv \"'nas-test' in d['hosts'] and 'ShareOS NAS' in d['metadata']\""
check "standard items: agent.ping, version, free memory" "srv \"d['values'].get('agent.ping')=='1' and d['values'].get('agent.version','').startswith('7.0') and int(d['values'].get('vm.memory.size[available]','0'))>0\""
check "shareos.box[version] = the firmware's version" "srv \"d['values'].get('shareos.box[version]')=='\$(. $R/etc/shareos-release; echo \$SHAREOS_VERSION)'\""
check "disk discovery: the bays, not the USB stick" "srv \"sorted(x['{#DISK}'] for x in json.loads(d['values']['shareos.disk.discovery']))==['sda','sdb'] and json.loads(d['values']['shareos.disk.discovery'])[0]['{#MODEL}']=='WDC WD40EFRX'\""
check "disk values from the SMART cache" "srv \"d['values'].get('shareos.disk[sda,temperature]')=='38' and d['values'].get('shareos.disk[sda,rating]')=='1' and d['values'].get('shareos.disk[sda,pending]')=='2' and d['values'].get('shareos.disk[sda,model]')=='WDC WD40EFRX' and d['values'].get('shareos.disk[sdb,life_left]')=='97'\""
check "RAID discovery answers (JSON list)" "srv \"isinstance(json.loads(d['values']['shareos.raid.discovery']), list)\""
check "no value: empty; unknown disk or key: error text" "srv \"d['values'].get('shareos.disk[sda,life_left]')=='' and d['values'].get('shareos.disk[sdz,temperature]','').startswith('error:') and d['values'].get('shareos.box[nonsense]','').startswith('error: unknown key')\""
check "system.run is refused" "srv \"'system.run[id]' in d['errors'] and 'system.run[id]' not in d['values']\""
check "get/discovery work as the user zabbix" "run 'su -s /bin/sh zabbix -c \"/usr/sbin/shareos-zabbix get disk sda temperature\"' | grep -qx 38"
check "a sleeping disk keeps its values (standby 1)" "rm -f $R/tmp/shareos-storage/smart-sda.json; run 'mkdir -p /tmp/bin; printf \"#!/bin/sh\necho {\\\\\\\"standby\\\\\\\":true}\n\" > /tmp/bin/ubus; chmod +x /tmp/bin/ubus; PATH=/tmp/bin:\$PATH shareos-zabbix collect' >/dev/null; run 'shareos-zabbix get disk sda standby; shareos-zabbix get disk sda temperature' | tr '\n' ' ' | grep -q '^1 38 \$'"
check "PSK without identity refused" "z '{\"psk\":\"00112233445566778899aabbccddeeff\"}' | js \"'psk_identity' in d.get('error','')\""
check "PSK too short refused" "z '{\"psk\":\"abcd\",\"psk_identity\":\"x\"}' | js \"'psk:' in d.get('error','')\""
z '{"psk":"00112233445566778899AABBCCDDEEFF00112233445566778899aabbccddeeff","psk_identity":"nas-test PSK"}' >/dev/null
check "PSK: encrypted connections, key root-only, for the agent group-readable" "grep -q '^TLSConnect=psk$' $C && grep -q '^TLSPSKIdentity=nas-test PSK$' $C && [ \$(stat -c %a $R/etc/shareos/zabbix.psk) = 600 ] && [ \$(stat -c %a $R/tmp/shareos-zabbix/psk) = 640 ] && [ \$(stat -c %g $R/tmp/shareos-zabbix/psk) = \$(run 'id -g zabbix') ] && grep -qx '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff' $R/etc/shareos/zabbix.psk"
# a second fake server that takes only TLS with this key
ZBX_PSK_IDENTITY="nas-test PSK" ZBX_PSK=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff \
	python3 "$TOP/tests/zabbix-fake-server.py" $((PORT + 1)) "$T/server-psk.json" agent.ping 'shareos.disk[sda,temperature]' &
SRV2=$!
sleep 1
z "{\"server\":\"127.0.0.1:$((PORT + 1))\"}" >/dev/null
i=0; until python3 -c "import json,sys; d=json.load(open('$T/server-psk.json')); sys.exit(0 if d['values'].get('agent.ping')=='1' else 1)" 2>/dev/null || [ $i -ge 60 ]; do sleep 1; i=$((i + 1)); done
check "PSK: the values arrive over TLS" "python3 -c \"import json,sys; d=json.load(open('$T/server-psk.json')); sys.exit(0 if d['values'].get('shareos.disk[sda,temperature]')=='38' and 'TLSv1.2' in d['tls'] else 1)\""
kill $SRV2 2>/dev/null
z "{\"server\":\"127.0.0.1:$PORT\"}" >/dev/null
check "PSK in the settings backup" "run 'ubus call shareos.backup export \"{}\"' | grep -q zabbix.psk"
check "PSK removed: unencrypted again" "z '{\"psk\":\"\",\"psk_identity\":\"\"}' | js \"not d['psk'] and d['running']\" && grep -q '^TLSConnect=unencrypted$' $C && [ ! -e $R/tmp/shareos-zabbix/psk ]"
check "passive checks need allowed addresses" "z '{\"passive\":true}' | js \"'allow' in d.get('error','')\""
o=$(z '{"passive":true,"allow":"127.0.0.1","port":10052}')
check "passive checks: listens on the port for the allowed addresses" "echo '$o' | js \"d['running'] and d['passive']\" && grep -q '^Server=127.0.0.1$' $C && grep -q '^ListenPort=10052$' $C"
z '{"passive":false}' >/dev/null
check "disk interval 10 minutes in the cron job" "z '{\"disk_interval\":10}' | js \"d['disk_interval']==10\" && grep -q '^\*/10 \* \* \* \* /usr/sbin/shareos-zabbix collect' $R/etc/crontabs/root"
check "switched off: stopped, no cron job, boot does not start it" "z '{\"enabled\":false}' | js \"not d['running']\" && ! grep -q shareos-zabbix $R/etc/crontabs/root && run 'shareos-zabbix boot' | js \"d.get('started')==False\""
check "boot starts it when switched on" "z '{\"enabled\":true}' >/dev/null; run 'shareos-zabbix stop-all' >/dev/null; run 'shareos-zabbix boot' | js \"d['running']\""
check "removing the system app stops the agent" "run 'shareos-apps remove zabbix-agent' >/dev/null; run 'shareos-zabbix status' | js \"not d['running'] and not d['installed']\" && ! pgrep -f '[z]abbix-agentd' >/dev/null"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
