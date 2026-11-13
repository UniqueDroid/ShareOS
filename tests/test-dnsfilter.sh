#!/bin/bash
#
# Tests the DNS filter module: system app "dnsfilter" (AdGuard Home), shareos-
# dnsfilter, rpcd shareos.dnsfilter – built ARM userland (qemu-user) in a
# chroot, an apps drive, a block list served from the host. AdGuard Home
# binds port 53 and the given web port on the host (it shares the network).
#
#   sudo tests/test-dnsfilter.sh [output/dns320l] [dnsfilter.sapp]   (make sysapps-pack)
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
SAPP=${2:-$(ls -t "$TOP"/output/sysapps/sapp/dnsfilter-*.sapp 2>/dev/null | head -1)}
[ -f "$SAPP" ] || { echo "no dnsfilter .sapp – make sysapps-pack"; exit 1; }
LPORT=18977

T=$(mktemp -d /tmp/shareos-dnsfilter-test.XXXX)
R=$T/root
SRV=
cleanup() {
	[ -n "$SRV" ] && kill "$SRV" 2>/dev/null
	chroot "$R" /bin/sh -c '/usr/sbin/shareos-dnsfilter stop-all; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
[ -n "${SHAREOS_TEST_CONTROLLER:-}" ] && cp "$SHAREOS_TEST_CONTROLLER" "$R/usr/sbin/shareos-dnsfilter"
mount -t proc proc "$R/proc"
mount --bind /dev "$R/dev"
mount -t tmpfs tmpfs "$R/tmp"
mkdir -p "$R/var/run/ubus" "$R/var/log" "$R/etc/crontabs" "$T/drive" "$R/mnt/daten"
# the apps drive: a folder of the host, mounted so that /proc/mounts lists it
mount --bind "$T/drive" "$R/mnt/daten"
mkdir -p "$R/mnt/daten/.shareos"

run() { chroot "$R" /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }
df() { run "echo '${2:-}' | shareos-dnsfilter $1"; }
ub() { local a=${2:-'{}'}; run "ubus call shareos.dnsfilter $1 '$a'"; }
# a DNS query to the box: prints the first IPv4 address of the answer (or rc=<rcode>)
dnsq() {
	python3 - "$1" <<'EOF'
import socket, struct, sys
name = sys.argv[1]
q = struct.pack('>HHHHHH', 0x1234, 0x100, 1, 0, 0, 0) + b''.join(bytes([len(p)]) + p.encode() for p in name.split('.')) + b'\0\0\1\0\1'
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(8)
s.sendto(q, ('127.0.0.1', 53))
try: r = s.recv(1024)
except Exception: print('timeout'); sys.exit()
rc, an = r[3] & 15, struct.unpack('>H', r[6:8])[0]
if not an: print('rc=%d' % rc); sys.exit()
i = len(q)
for _ in range(an):
	i += 2; t, c, ttl, l = struct.unpack('>HHIH', r[i:i + 10]); i += 10
	if t == 1: print('.'.join(str(b) for b in r[i:i + 4])); sys.exit()
	i += l
print('rc=%d' % rc)
EOF
}
wait_ready() { i=0; until ub status | js "d.get('ready')" || [ $i -ge ${1:-120} ]; do sleep 1; i=$((i + 1)); done; }

# a block list on the host
mkdir -p "$T/www"
printf '# test list\n0.0.0.0 ads.shareos-test.example\n0.0.0.0 tracker.shareos-test.example\n||banner.shareos-test.example^\n' > "$T/www/list.txt"
(cd "$T/www" && exec python3 -m http.server $LPORT --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!

run 'uci set storage.global=storage; uci set storage.global.apps=daten; uci commit storage' >/dev/null
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.dnsfilter' | grep -q dnsfilter || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done

# --- module ------------------------------------------------------------------------
check "not installed: rpc refused" "ub status | grep -q 'not installed'"
check "not installed: no tab" "run 'ubus call shareos.ui get' | js \"d['areas']['dnsfilter']==False\""
cp "$SAPP" "$R/tmp/dnsfilter.sapp"
check "installed from its package (module)" "run 'shareos-apps install-file /tmp/dnsfilter.sapp' | js \"d['ok'] and d['module']\""
check "tab once installed" "run 'ubus call shareos.ui get' | js \"d['areas']['dnsfilter']==True\""
check "listed as module and service" "run 'shareos-apps modules' | js \"'dnsfilter' in d['modules']\" && run 'shareos-apps services list' | grep -q dnsfilter"
check "off after installing" "ub status | js \"d['installed'] and not d['enabled'] and not d['running']\""
check "boot does nothing while off" "df boot | js \"d.get('started')==False\""

# --- first start ----------------------------------------------------------------------
# local names: host name, search domain and the DNS server from the network
hostname shareos-t
run 'rm -f /etc/resolv.conf; printf "search test.lan\nnameserver 10.9.8.7\n" > /etc/resolv.conf'
BOXIP=$(ip -4 -o addr show dev eth0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)
check "switch on: starts in the background" "ub set '{\"enabled\":true}' | js \"d.get('ok')\""
wait_ready 180
check "first start: running and ready" "ub status | js \"d['ready'] and d['web_port']==8053 and d['version']\""
ub status | js "d['ready']" 2>/dev/null || { echo "      status: $(ub status | tr '\n' ' ' | cut -c1-600)"; echo "      log: $(df log | tr '\n' ' ' | tail -c 1500)"; echo "      port 53 on this host: $(ss -lnup 2>/dev/null | grep ':53 ' | tr '\n' ' ' | cut -c1-300)"; }
Y=$R/etc/shareos/dnsfilter/AdGuardHome.yaml
check "settings written by AdGuard's setup" "grep -q '^schema_version:' $Y && grep -q 'address: 0.0.0.0:8053' $Y"
check "guard rail: query log in RAM, no file" "grep -A8 '^querylog:' $Y | grep -q 'file_enabled: false' && grep -A8 '^querylog:' $Y | grep -q 'dir_path: /tmp/shareos-dnsfilter/data'"
check "guard rail: statistics in RAM" "grep -A3 '^statistics:' $Y | grep -q 'dir_path: /tmp/shareos-dnsfilter/data'"
P=$(cat $R/tmp/shareos-dnsfilter/pid)
check "guard rail: GOMEMLIMIT set" "tr '\0' '\n' < $R/proc/$P/environ | grep -q '^GOMEMLIMIT=32MiB$'"
check "password: random, root only" "[ \"\$(stat -c %a $R/etc/shareos/dnsfilter.pass)\" = 600 ] && ub password | js \"d['user']=='admin' and len(d['password'])==20\""
PW=$(ub password | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')
check "AdGuard's interface: login with that password" "curl -s -o /dev/null -w '%{http_code}' -u admin:$PW http://127.0.0.1:8053/control/status | grep -q 200"
check "AdGuard's interface: wrong password refused" "curl -s -o /dev/null -w '%{http_code}' -u admin:wrong http://127.0.0.1:8053/control/status | grep -q 401"
check "lists: the default lists of AdGuard" "ub filters | js \"len(d['filters'])>=1\""
# the rewrites are set right after AdGuard answers (the start runs in the background)
i=0; until [ -s $R/etc/shareos/dnsfilter/local.json ] || [ $i -ge 60 ]; do sleep 1; i=$((i + 1)); done
check "local names: the box answers for its own names" "[ -n \"$BOXIP\" ] && [ \"\$(dnsq shareos-t.test.lan)\" = $BOXIP ] && [ \"\$(dnsq shareos-t)\" = $BOXIP ]"
check "local names: the local domain goes to the network's DNS server, hidden from the upstream list" "curl -s -u admin:$PW http://127.0.0.1:8053/control/dns_info | js \"'[/test.lan/]10.9.8.7' in d['upstream_dns']\" && ub status | js \"d['local']['names']==['shareos-t','shareos-t.test.lan'] and d['local']['domains']==['test.lan'] and not [u for u in d['upstream'] if u.startswith('[/')]\""

# --- HTTPS of AdGuard's interface: the certificate of the web interface ---------------
check "https: off without a certificate" "ub status | js \"d['https']==False and d['https_port']==8054\" && grep -A2 '^tls:' $Y | grep -q 'enabled: false'"
run 'shareos-cert selfsigned' >/dev/null
i=0; until curl -sk -o /dev/null https://127.0.0.1:8054/ 2>/dev/null || [ $i -ge 120 ]; do sleep 1; i=$((i + 1)); done; wait_ready 120
check "https: self-signed certificate → HTTPS on 8054, HTTP not redirected (no HSTS)" "ub status | js \"d['ready'] and d['https'] and not d['https_forced']\" && curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1:8054/login.html | grep -q 200 && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8053/login.html | grep -q 200 && ! curl -skI https://127.0.0.1:8054/login.html | grep -qi strict-transport"
check "https: DNS over TLS and QUIC stay off" "grep -A6 '^tls:' $Y | grep -q 'port_dns_over_tls: 0' && grep -A6 '^tls:' $Y | grep -q 'port_dns_over_quic: 0' && ! python3 -c 'import socket; socket.create_connection((\"127.0.0.1\",853),2)' 2>/dev/null"
# a certificate of a CA (issuer differs from the subject), like the own CA or Let's Encrypt
C=$T/ca; mkdir -p $C
openssl ecparam -name prime256v1 -genkey -noout -out $C/ca.key 2>/dev/null
openssl req -new -x509 -key $C/ca.key -out $C/ca.crt -days 30 -subj '/CN=Test CA' 2>/dev/null
openssl ecparam -name prime256v1 -genkey -noout -out $C/web.key 2>/dev/null
openssl req -new -key $C/web.key -out $C/web.csr -subj '/CN=shareos' 2>/dev/null
printf 'subjectAltName=DNS:shareos,IP:127.0.0.1\n' > $C/ext
openssl x509 -req -in $C/web.csr -CA $C/ca.crt -CAkey $C/ca.key -CAcreateserial -out $C/web.crt -days 30 -extfile $C/ext 2>/dev/null
cp $C/web.crt $C/web.key $R/tmp/
o=$(run 'shareos-cert install /tmp/web.crt /tmp/web.key')
i=0; until curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8053/login.html 2>/dev/null | grep -q 307 || [ $i -ge 120 ]; do sleep 1; i=$((i + 1)); done; wait_ready 120
check "https: trusted certificate → HTTP redirects to HTTPS (same host name)" "echo \"\$o\" | grep -q installed && ub status | js \"d['ready'] and d['https_forced']\" && curl -s -o /dev/null -w '%{redirect_url}' -H 'Host: shareos.lan:8053' http://127.0.0.1:8053/login.html | grep -qx 'https://shareos.lan:8054/login.html'"
check "https: AdGuard serves the new certificate" "echo | openssl s_client -connect 127.0.0.1:8054 2>/dev/null | grep -q 'issuer=CN.*Test CA'"
check "https: the controller still talks to AdGuard (over HTTPS)" "ub filters | js \"len(d['filters'])>=1\""
check "https: the same port as HTTP refused" "ub set '{\"https_port\":8053}' | grep -q 'must differ'"

# --- block lists ----------------------------------------------------------------------
check "list added" "ub filter_add '{\"name\":\"Test\",\"url\":\"http://127.0.0.1:$LPORT/list.txt\"}' | js \"[f for f in d['filters'] if f['name']=='Test' and f['rules']==3]\""
[ "$(dnsq ads.shareos-test.example)" = 0.0.0.0 ] || { echo "      answers: $(dnsq ads.shareos-test.example) $(dnsq banner.shareos-test.example)"; echo "      status: $(ub status | tr '\n' ' ' | cut -c1-700)"; }
check "blocked name answered with 0.0.0.0" "[ \"\$(dnsq ads.shareos-test.example)\" = 0.0.0.0 ] && [ \"\$(dnsq banner.shareos-test.example)\" = 0.0.0.0 ]"
check "status: rules, queries, blocked, estimate" "ub status | js \"d['rules']>=3 and d['blocked']>=2 and d['queries']>=2 and d['estimate_mb']>=25 and not d['warn']\""
check "list switched off: name no longer blocked" "ub filter_enable '{\"url\":\"http://127.0.0.1:$LPORT/list.txt\",\"enabled\":false}' | js \"[f for f in d['filters'] if f['name']=='Test' and not f['enabled']]\" && [ \"\$(dnsq tracker.shareos-test.example)\" != 0.0.0.0 ]"
check "list removed" "ub filter_remove '{\"url\":\"http://127.0.0.1:$LPORT/list.txt\"}' | js \"not [f for f in d['filters'] if f['name']=='Test']\""
check "invalid list address refused" "ub filter_add '{\"name\":\"x\",\"url\":\"file:///etc/shadow\"}' | grep -q 'http(s) address'"
check "lists refreshed" "ub refresh | js \"'filters' in d\""

# --- settings -------------------------------------------------------------------------
check "upstream set" "ub set '{\"upstream\":[\"https://dns.quad9.net/dns-query\",\"1.1.1.1\"]}' | js \"d['upstream']==['https://dns.quad9.net/dns-query','1.1.1.1']\""
check "upstream set: the local domain stays" "run 'shareos-dnsfilter status' | js \"d['local']['domains']==['test.lan']\" && [ \"\$(dnsq shareos-t.test.lan)\" = $BOXIP ]"
hostname shareos-u
check "host name changed: rewrites follow (old name gone)" "df local-names | js \"d['names']==['shareos-u','shareos-u.test.lan']\" && [ \"\$(dnsq shareos-u.test.lan)\" = $BOXIP ] && [ \"\$(dnsq shareos-t.test.lan)\" != $BOXIP ]"
check "local entry added: answered, listed without the box's names" "ub rewrite_add '{\"domain\":\"Drucker.test.lan\",\"answer\":\"10.9.8.50\"}' | js \"d['rewrites']==[{'domain':'drucker.test.lan','answer':'10.9.8.50'}]\" && [ \"\$(dnsq drucker.test.lan)\" = 10.9.8.50 ]"
check "local entry: wildcard" "ub rewrite_add '{\"domain\":\"*.web.test.lan\",\"answer\":\"10.9.8.60\"}' | js \"len(d['rewrites'])==2\" && [ \"\$(dnsq a.web.test.lan)\" = 10.9.8.60 ]"
check "local entry: twice refused" "ub rewrite_add '{\"domain\":\"drucker.test.lan\",\"answer\":\"10.9.8.50\"}' | grep -q 'exists already'"
check "local entry: name of the box refused" "ub rewrite_add '{\"domain\":\"shareos-u.test.lan\",\"answer\":\"10.9.8.51\"}' | grep -q 'belongs to the box'"
check "local entry: invalid name and address refused" "ub rewrite_add '{\"domain\":\"a b\",\"answer\":\"10.9.8.50\"}' | grep -q 'host name' && ub rewrite_add '{\"domain\":\"x.test.lan\",\"answer\":\"999.1.1.1\"}' | grep -q 'IPv4'"
check "local entry: kept when the box names are set again" "df local-names >/dev/null; ub rewrites | js \"len(d['rewrites'])==2\""
check "local entry removed" "ub rewrite_remove '{\"domain\":\"*.web.test.lan\",\"answer\":\"10.9.8.60\"}' | js \"d['rewrites']==[{'domain':'drucker.test.lan','answer':'10.9.8.50'}]\" && [ \"\$(dnsq a.web.test.lan)\" != 10.9.8.60 ]"
check "invalid upstream refused" "ub set '{\"upstream\":[\"rm -rf /\"]}' | grep -q 'invalid upstream'"
check "port of the box refused" "ub set '{\"web_port\":443}' | grep -q 'not a port of the box'"
check "filtering paused and on again" "ub set '{\"protection\":false}' | js \"d['protection']==False\" && ub set '{\"protection\":true}' | js \"d['protection']==True\""
check "web port changed: restarted on the new ports (HTTPS one above)" "ub set '{\"web_port\":8063}' | js \"d['ready'] and d['web_port']==8063 and d['https_port']==8064\" && curl -s -o /dev/null -w '%{http_code}' -u admin:$PW http://127.0.0.1:8063/control/status | grep -q 307 && curl -sk -o /dev/null -w '%{http_code}' -u admin:$PW https://127.0.0.1:8064/control/status | grep -q 200"
o=$(df restart); echo "$o" | js "d['ready']" 2>/dev/null || echo "      restart: $(echo "$o" | tr '\n' ' ' | cut -c1-500)"
check "settings kept over a restart" "echo '$o' | js \"d['ready'] and d['upstream'][0]=='https://dns.quad9.net/dns-query'\""

# --- switching off, boot, removal -------------------------------------------------------
check "switched off: stopped" "ub set '{\"enabled\":false}' | js \"not d['running'] and not d['enabled']\" && [ \"\$(dnsq ads.shareos-test.example)\" = timeout ]"
check "boot while off: not started" "df boot | js \"d.get('started')==False\""
run "uci set dnsfilter.main.enabled=1; uci commit dnsfilter" >/dev/null
o=$(df boot)
check "boot while on: started" "echo \"\$o\" | js \"d.get('ready')\" || { echo \"\$o\"; false; }"
check "boot while on: ready means DNS answers, local names set" "[ \"\$(dnsq shareos-u.test.lan)\" = $BOXIP ] && echo \"\$o\" | js \"d['dns'] and d['local']['names']\""
svc() { run 'ubus call shareos.service list' | js "[s for s in d['services'] if s['name']=='dnsfilter'][0]['running']==$1"; }
check "Services page: shown as running (AdGuardHome, the app lists no command)" "svc True"

# --- switching off and on in operation (DNS-FILTER tab), the network hands out the box as DNS ---
# the box is its own DNS server: the local domains go to the default gateway
GW=$(ip route | awk '/^default/ {print $3; exit}')
run "printf 'search test.lan\nnameserver $BOXIP\n' > /etc/resolv.conf"
check "switched off in operation: stopped, Services page too" "ub set '{\"enabled\":false}' | js \"not d['running'] and not d['enabled']\" && svc False"
check "switched on in operation: starts in the background" "ub set '{\"enabled\":true}' | js \"d.get('ok')\""
first=; i=0
while [ $i -lt 240 ]; do
	st=$(ub status)
	if echo "$st" | js "d.get('ready')"; then first=$(dnsq shareos-u.test.lan); break; fi
	echo "$st" | js "d.get('starting') or not d.get('running')" || break
	sleep 1; i=$((i + 1))
done
check "switched on: not ready before DNS answers (port 53)" "[ \"$first\" = $BOXIP ]"
sleep 15
check "switched on: stays on (setting, process, DNS, Services page)" "[ \"\$(run 'uci -q get dnsfilter.main.enabled')\" = 1 ] && ub status | js \"d['enabled'] and d['running'] and d['ready']\" && [ \"\$(dnsq shareos-u.test.lan)\" = $BOXIP ] && svc True"
echo "      local.json: $(tr '\n' ' ' < $R/etc/shareos/dnsfilter/local.json 2>/dev/null | cut -c1-300) | upstream: $(curl -sk -u admin:$PW https://127.0.0.1:8064/control/dns_info | cut -c1-400)"
check "the box as its own DNS server: local domain to the gateway ($GW)" "[ -z \"$GW\" ] || { i=0; until [ -s $R/etc/shareos/dnsfilter/local.json ] && grep -q '$GW' $R/etc/shareos/dnsfilter/local.json || [ \$i -ge 30 ]; do sleep 1; i=\$((i + 1)); done; curl -sk -u admin:$PW https://127.0.0.1:8064/control/dns_info | js \"'[/test.lan/]$GW' in d['upstream_dns']\"; }"
check "removed: stopped, tab gone, settings kept" "run 'shareos-apps remove dnsfilter' >/dev/null; ! [ -e $R/tmp/shareos-dnsfilter/pid ] && run 'ubus call shareos.ui get' | js \"d['areas']['dnsfilter']==False\" && [ -f $Y ]"

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
