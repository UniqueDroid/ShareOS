#!/bin/bash
#
# Tests the app permissions "sysinfo" (the box's values, processes, ending a
# process), "netcheck" (ping, TCP port, HTTP from the box) and "docker"
# (Docker hosts through their Engine API; here a fake Docker API on the
# build host) and "notify" (messages from the SDK and from app jobs)
# – rpcd shareos.appsys/appnet/appdocker/appnotify and the CGIs of the app
# web server, admins only. Built ARM userland (qemu-user) in a chroot, in its
# own network name space.
#
#   sudo tests/test-sysperms.sh [output/dns320l]
#
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts --net env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }

T=$(mktemp -d /tmp/shareos-sysperm-test.XXXX)
R=$T/root
cleanup() {
	[ -n "${FAKE:-}" ] && kill $FAKE 2>/dev/null
	chroot "$R" /bin/sh -c '/etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
mount -t proc proc "$R/proc"
mount --bind /dev "$R/dev"
mount -t tmpfs tmpfs "$R/tmp"
mkdir -p "$R/var/run/ubus" "$R/var/log" "$R/mnt/daten"
mount -t tmpfs tmpfs "$R/mnt/daten"

run() { chroot "$R" /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

run "ip link set lo up" >/dev/null
run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci commit storage" >/dev/null
run "echo anna1234 | shareos-users add anna user --home=daten --web=1 --files=1" >/dev/null

mkapp() {   # id permissions
	mkdir -p $T/$1/files
	echo '<!doctype html><title>ok</title>' > $T/$1/files/index.html
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/$1/files/icon.svg
	python3 -c "import json; json.dump({'id':'$1','name':'$1','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':$2}, open('$T/$1/app.json','w'))"
	(cd $T/$1 && tar -czf $R/tmp/$1.sapp app.json -C files .)
	run "shareos-apps install-file /tmp/$1.sapp"
}
check "sysinfo, netcheck, docker and tuya without files are refused" "mkapp nofiles1 '[\"sysinfo\"]' | grep -q 'sysinfo.*needs' && mkapp nofiles2 '[\"netcheck\"]' | grep -q 'netcheck.*needs' && mkapp nofiles3 '[\"docker\"]' | grep -q 'docker.*needs' && mkapp nofiles4 '[\"tuya\"]' | grep -q 'tuya.*needs'"
mkapp homelab '["files","sysinfo","netcheck","docker","tuya"]' >/dev/null
mkapp other '["files"]' >/dev/null
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run 'ubus list shareos.appsys' | grep -q appsys || [ $i -ge 40 ]; do sleep 0.5; i=$((i + 1)); done
grant() { local t; t=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'); mkdir -p $R/tmp/shareos-appgrants; printf '%s\n%s\n%d\n' "$1" "$2" $(( $(date +%s) + 3600 )) > $R/tmp/shareos-appgrants/$t; echo $t; }
GR=$(grant root homelab); GA=$(grant anna homelab); GO=$(grant root other)
# cgi <name> <grant> <json>: the CGI as the app web server runs it
cgi() { printf '%s' "$3" > $R/tmp/cgi.in; run "QUERY_STRING=g=$2 REQUEST_METHOD=POST CONTENT_LENGTH=\$(wc -c < /tmp/cgi.in) /www-apps/_shareos/cgi/$1 < /tmp/cgi.in" | sed '1,/^\r\?$/d'; }

# --- ShareOS.openApp: a grant for the other app ---------------------------------------------
o=$(cgi fs $GR '{"op":"grant_app","app":"other"}')
G2=$(echo "$o" | python3 -c "import json,sys; print(json.load(sys.stdin).get('grant',''))")
check "openApp: an app with more permissions gets a grant for an app with fewer" "[ \${#G2} = 32 ] && cgi fs $G2 '{\"op\":\"roots\"}' | js \"d['user']=='root'\""
check "openApp: no grant for an app that needs more than the opener, none without a grant" "cgi fs $GO '{\"op\":\"grant_app\",\"app\":\"homelab\"}' | grep -q 'more permissions' && cgi fs 00000000000000000000000000000000 '{\"op\":\"grant_app\",\"app\":\"other\"}' | grep -q 'no access'"

# --- sysinfo -----------------------------------------------------------------------------
check "sysinfo: user account and app without the permission get no access" "cgi sysinfo $GA '{\"op\":\"info\"}' | js \"d.get('error')=='no access'\" && cgi sysinfo $GO '{\"op\":\"info\"}' | js \"d.get('error')=='no access'\""
check "sysinfo: info with CPU, memory, volumes" "cgi sysinfo $GR '{\"op\":\"info\"}' | js \"d['cpu']['total']>0 and d['memory']['memtotal']>0 and d['uptime']>0 and len(d['load'])==3 and d['cores']>=1 and any(v['name']=='daten' for v in d['volumes'])\""
run "sleep 300 & echo \$! > /tmp/sleeper.pid" >/dev/null
SP=$(cat $R/tmp/sleeper.pid)
check "sysinfo: processes with user, memory and CPU ticks" "cgi sysinfo $GR '{\"op\":\"processes\"}' | js \"d['cpu']['total']>0 and any(p['pid']==$SP and p['name']=='sleep' and p['user']=='root' and p['rss']>0 and 'ticks' in p for p in d['processes']) and any(p['name']=='rpcd' for p in d['processes'])\""
RP=$(pgrep -f '/sbin/rpcd' | head -1)
check "sysinfo: init, kernel threads and rpcd cannot be ended" "cgi sysinfo $GR '{\"op\":\"kill\",\"pid\":1}' | grep -q 'invalid process' && cgi sysinfo $GR '{\"op\":\"kill\",\"pid\":2}' | grep -q 'kernel threads\|no such process' && cgi sysinfo $GR \"{\\\"op\\\":\\\"kill\\\",\\\"pid\\\":$RP}\" | grep -q 'keeps ShareOS running' && cgi sysinfo $GR \"{\\\"op\\\":\\\"kill\\\",\\\"pid\\\":$SP,\\\"signal\\\":\\\"STOP\\\"}\" | grep -q 'invalid signal'"
o=$(cgi sysinfo $GR "{\"op\":\"kill\",\"pid\":$SP}")
sleep 0.5
check "sysinfo: ends an ordinary process" "echo '$o' | js \"d['ok'] and d['name']=='sleep'\" && { [ ! -e /proc/$SP ] || grep -q '^[0-9]* (sleep) Z' /proc/$SP/stat; }" || echo "  $o"

# --- a fake Docker Engine API and web server on the build host ---------------------------
PORT=18237
cat > $T/fake.py <<'PY'
import http.server, json, struct, sys
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body=b'', ctype='application/json'):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        p = self.path
        if p == '/': return self.send(200, b'<html>ok</html>', 'text/html')
        if p == '/version': return self.send(200, json.dumps({'Version': '27.3.1', 'ApiVersion': '1.47'}).encode())
        if p.startswith('/containers/json'): return self.send(200, json.dumps([{'Id': 'abc123', 'Names': ['/web'], 'State': 'running', 'all': 'all=1' in p}]).encode())
        if p.startswith('/containers/abc123/logs'):
            fr = lambda s, t: struct.pack('>BxxxI', s, len(t)) + t
            return self.send(200, fr(1, b'hello\n') + fr(2, b'oops\n'), 'application/vnd.docker.raw-stream')
        if p == '/containers/nope/json': return self.send(404, json.dumps({'message': 'No such container: nope'}).encode())
        return self.send(404, b'{"message":"page not found"}')
    def do_POST(self):
        if self.path == '/containers/abc123/restart': return self.send(204)
        return self.send(404, b'{"message":"no"}')
http.server.HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY
python3 $T/fake.py $PORT & FAKE=$!
sleep 1

# --- netcheck -----------------------------------------------------------------------------
check "netcheck: no access for users and apps without the permission" "cgi netcheck $GA '{\"op\":\"check\",\"checks\":[{\"kind\":\"tcp\",\"host\":\"127.0.0.1\",\"port\":$PORT}]}' | js \"d.get('error')=='no access'\" && cgi netcheck $GO '{\"op\":\"check\",\"checks\":[{\"kind\":\"tcp\",\"host\":\"127.0.0.1\",\"port\":$PORT}]}' | js \"d.get('error')=='no access'\""
o=$(cgi netcheck $GR "{\"op\":\"check\",\"checks\":[{\"kind\":\"tcp\",\"host\":\"127.0.0.1\",\"port\":$PORT},{\"kind\":\"tcp\",\"host\":\"127.0.0.1\",\"port\":1},{\"kind\":\"http\",\"url\":\"http://127.0.0.1:$PORT/\"},{\"kind\":\"http\",\"url\":\"http://127.0.0.1:1/\"},{\"kind\":\"ping\",\"host\":\"bad host;x\"},{\"kind\":\"http\",\"url\":\"file:///etc/shadow\"}]}")
check "netcheck: open and closed port" "echo '$o' | js \"d['results'][0]['ok'] and d['results'][0]['ms'] is not None and not d['results'][1]['ok']\""
check "netcheck: HTTP answer with status and time, unreachable server" "echo '$o' | js \"d['results'][2]['ok'] and d['results'][2]['status']==200 and not d['results'][3]['ok'] and d['results'][3]['error']=='not reachable'\""
check "netcheck: invalid host and other schemes refused, in order" "echo '$o' | js \"d['results'][4]['error']=='invalid host' and d['results'][5]['error']=='invalid address' and len(d['results'])==6\""
o=$(cgi netcheck $GR '{"op":"check","checks":[{"kind":"ping","host":"127.0.0.1","count":2}]}')
if echo "$o" | js "d['results'][0]['ok']"; then
	check "netcheck: ping 127.0.0.1" "echo '$o' | js \"d['results'][0]['received']==2 and d['results'][0]['loss']==0 and d['results'][0]['ms'] is not None\""
else
	echo "SKIP  ping (no ICMP under qemu-user here: $(echo "$o" | head -c 160))"
fi
MANY=$(python3 -c "import json; print(json.dumps({'op':'check','checks':[{'kind':'tcp','host':'a','port':1}]*33}))")
check "netcheck: at most 32 checks" "cgi netcheck $GR '$MANY' | grep -q '1 to 32'"

# --- docker -------------------------------------------------------------------------------
check "docker: no access for users" "cgi docker $GA '{\"op\":\"hosts\"}' | js \"d.get('error')=='no access'\""
check "docker: invalid addresses refused" "cgi docker $GR '{\"op\":\"host_set\",\"name\":\"x\",\"url\":\"file:///etc\"}' | grep -q 'invalid address' && cgi docker $GR '{\"op\":\"host_set\",\"name\":\"x\",\"url\":\"http://a/b/c\"}' | grep -q 'invalid address' && cgi docker $GR '{\"op\":\"host_set\",\"name\":\"X y\",\"url\":\"http://a:2375\"}' | grep -q 'invalid name'"
check "docker: add a host (kept in /etc/config/dockerhosts)" "cgi docker $GR \"{\\\"op\\\":\\\"host_set\\\",\\\"name\\\":\\\"nuc\\\",\\\"label\\\":\\\"NUC\\\",\\\"url\\\":\\\"http://127.0.0.1:$PORT/\\\"}\" | js \"d['hosts']==[{'name':'nuc','label':'NUC','url':'http://127.0.0.1:$PORT','insecure':False}]\" && run 'uci -q get dockerhosts.nuc.url' | grep -qx 'http://127.0.0.1:$PORT'"
check "docker: version and containers" "cgi docker $GR '{\"op\":\"version\",\"host\":\"nuc\"}' | js \"d['status']==200 and d['data']['Version']=='27.3.1'\" && cgi docker $GR '{\"op\":\"containers\",\"host\":\"nuc\"}' | js \"d['data'][0]['Names']==['/web'] and d['data'][0]['all']\""
check "docker: logs come as plain text (frames removed)" "cgi docker $GR '{\"op\":\"logs\",\"host\":\"nuc\",\"id\":\"abc123\",\"tail\":50}' | js \"d['text']=='hello\\\\noops\\\\n'\""
check "docker: restart a container" "cgi docker $GR '{\"op\":\"action\",\"host\":\"nuc\",\"id\":\"abc123\",\"action\":\"restart\"}' | js \"d['status']==204\""
check "docker: Docker's error message, unknown actions and ids refused" "cgi docker $GR '{\"op\":\"inspect\",\"host\":\"nuc\",\"id\":\"nope\"}' | js \"d['error']=='No such container: nope'\" && cgi docker $GR '{\"op\":\"action\",\"host\":\"nuc\",\"id\":\"abc123\",\"action\":\"exec\"}' | grep -q 'invalid request' && cgi docker $GR '{\"op\":\"logs\",\"host\":\"nuc\",\"id\":\"../../etc\"}' | grep -q 'invalid container'"
check "docker: unknown host, unreachable host" "cgi docker $GR '{\"op\":\"info\",\"host\":\"gibtsnicht\"}' | grep -q 'unknown host' && cgi docker $GR '{\"op\":\"host_set\",\"name\":\"off\",\"url\":\"http://127.0.0.1:1\"}' >/dev/null && cgi docker $GR '{\"op\":\"info\",\"host\":\"off\"}' | grep -q 'host not reachable'"
check "docker: remove a host" "cgi docker $GR '{\"op\":\"host_del\",\"name\":\"off\"}' | js \"[h['name'] for h in d['hosts']]==['nuc']\""
check "docker hosts are in the settings backup" "run \"ubus call shareos.backup export '{}'\" | js \"'nuc' in json.loads(d['content'])['configs']['dockerhosts']\""

# --- tuya ---------------------------------------------------------------------------------
if python3 -c 'import tinytuya' 2>/dev/null; then
	check "tuya: no access for users" "cgi tuya $GA '{\"op\":\"discover\",\"seconds\":1}' | js \"d.get('error')=='no access'\""
	ID3=bf1234567890abcdefgh; K3=0123456789abcdef
	python3 $TOP/tests/fake-tuya.py 3.3 $ID3 $K3 127.0.0.1 2>/dev/null & TUYA=$!
	sleep 1
	check "tuya: discover finds the device (encrypted announcement on UDP 6667)" "cgi tuya $GR '{\"op\":\"discover\",\"seconds\":3}' | js \"d['devices']==[{'ip':'127.0.0.1','id':'$ID3','product':'keyfake123','version':'3.3','encrypted':True}]\""
	D3="\"ip\":\"127.0.0.1\",\"id\":\"$ID3\",\"key\":\"$K3\",\"version\":\"3.3\""
	check "tuya 3.3: status" "cgi tuya $GR '{\"op\":\"status\",$D3}' | js \"d['ok'] and d['dps']['1']==False and d['dps']['19']==1234\""
	check "tuya 3.3: switch on, the device reports it" "cgi tuya $GR '{\"op\":\"set\",$D3,\"dps\":{\"1\":true}}' | js \"d['dps']=={'1':True}\" && cgi tuya $GR '{\"op\":\"status\",$D3}' | js \"d['dps']['1']==True\""
	check "tuya: invalid input refused" "cgi tuya $GR '{\"op\":\"status\",\"ip\":\"x;reboot\",\"id\":\"$ID3\",\"key\":\"$K3\"}' | grep -q 'invalid IP' && cgi tuya $GR '{\"op\":\"status\",\"ip\":\"127.0.0.1\",\"id\":\"$ID3\",\"key\":\"short\"}' | grep -q '16 characters' && cgi tuya $GR '{\"op\":\"set\",$D3,\"dps\":{\"1\":[1]}}' | grep -q 'invalid dps' && cgi tuya $GR '{\"op\":\"status\",\"ip\":\"127.0.0.1\",\"id\":\"$ID3\",\"key\":\"$K3\",\"version\":\"3.5\"}' | grep -q '3.3 or 3.4'"
	kill $TUYA 2>/dev/null; wait $TUYA 2>/dev/null; sleep 0.5
	ID4=bf9999567890abcdefgh; K4=fedcba9876543210
	python3 $TOP/tests/fake-tuya.py 3.4 $ID4 $K4 127.0.0.1 2>/dev/null & TUYA=$!
	sleep 1
	D4="\"ip\":\"127.0.0.1\",\"id\":\"$ID4\",\"key\":\"$K4\",\"version\":\"3.4\""
	check "tuya 3.4: session key, status and switch" "cgi tuya $GR '{\"op\":\"status\",$D4}' | js \"d['ok'] and d['dps']['20']==2301\" && cgi tuya $GR '{\"op\":\"set\",$D4,\"dps\":{\"1\":true,\"18\":42}}' | js \"d['dps']=={'1':True,'18':42}\""
	check "tuya 3.4: wrong local key" "cgi tuya $GR '{\"op\":\"status\",\"ip\":\"127.0.0.1\",\"id\":\"$ID4\",\"key\":\"0000000000000000\",\"version\":\"3.4\"}' | grep -q 'wrong local key'"
	kill $TUYA 2>/dev/null; wait $TUYA 2>/dev/null
	check "tuya: device not reachable" "cgi tuya $GR '{\"op\":\"status\",$D4}' | grep -q 'not reachable'"
else
	echo "SKIP  tuya (pip install tinytuya for the fake device)"
fi

# --- notify ------------------------------------------------------------------------------
N=/etc/shareos/notifications.json
nmsg() { run "cat $N 2>/dev/null || echo []"; }
mkdir -p $T/pinger/files/jobs
echo '<!doctype html><title>ok</title>' > $T/pinger/files/index.html
echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > $T/pinger/files/icon.svg
cat > $T/pinger/files/jobs/check.sh <<'SH'
shareos-app-notify warn nas "NAS offline" "No answer since 10:00" || exit 1
shareos-app-notify clear old-key
shareos-app-notify warn 'bad key!' x 2>/dev/null && exit 2
# a link to a file of root is not read
ln -s /etc/shadow "$SHAREOS_NOTIFY_DIR/zz.json"
i=0; while [ $i -lt 12 ]; do shareos-app-notify info n$i "Message $i" 2>/dev/null; i=$((i + 1)); done
exit 0
SH
python3 -c "import json; json.dump({'id':'pinger','name':'Pinger','version':'1.0.0','publisher':'T','type':'webapp','entry':'index.html','icon':'icon.svg','description':{'de':'x','en':'x'},'permissions':['files','notify','cron'],'jobs':[{'id':'check','name':'Check','command':'jobs/check.sh','schedule':'*/5 * * * *','timeout':30}]}, open('$T/pinger/app.json','w'))"
(cd $T/pinger && tar -czf $R/tmp/pinger.sapp app.json -C files .)
check "notify: app with notify, files and cron installed" "run 'shareos-apps install-file /tmp/pinger.sapp' | js \"d['ok']\""
check "notify: the command only works inside a job" "! run 'shareos-app-notify info x y' >/dev/null && run 'shareos-app-notify info x y' | grep -q 'scheduled task'"
o=$(run 'shareos-apps run-job pinger check')
check "notify: job ran" "echo '$o' | js \"d['rc']==0\"" || { echo "  $o"; run 'shareos-apps job-log pinger check' | sed 's/^/  /'; }
check "notify: message of the job stored with the app's name, source apps" "nmsg | js \"any(m['key']=='app-pinger-nas' and m['title_de']=='Pinger: NAS offline' and m['text_de']=='No answer since 10:00' and m['level']=='warn' and m['source']=='apps' for m in d)\""
check "notify: at most 10 spool files per run, the link to /etc/shadow is skipped" "nmsg | js \"sorted(m['key'] for m in d if m['key'].startswith('app-pinger-'))==['app-pinger-n%d' % i for i in range(7)]+['app-pinger-nas'] and not any('root:' in json.dumps(m) for m in d)\""
check "notify: spool folder removed after the job" "[ ! -e $R/tmp/shareos-apps/spool/pinger ]"
GP=$(grant root pinger); GPA=$(grant anna pinger)
check "notify: SDK – user account and app without the permission get no access" "cgi notify $GPA '{\"op\":\"send\",\"key\":\"k\",\"title\":\"t\"}' | js \"d.get('error')=='no access'\" && cgi notify $GO '{\"op\":\"send\",\"key\":\"k\",\"title\":\"t\"}' | js \"d.get('error')=='no access'\""
check "notify: SDK – send and clear" "cgi notify $GP '{\"op\":\"send\",\"level\":\"error\",\"key\":\"sdk\",\"title\":\"From the browser\",\"text\":\"line 1\nline 2\"}' | js \"d['ok']\" && nmsg | js \"any(m['key']=='app-pinger-sdk' and m['level']=='error' and m['title_en']=='Pinger: From the browser' and not m['resolved'] for m in d)\" && cgi notify $GP '{\"op\":\"clear\",\"key\":\"sdk\"}' | js \"d['ok']\" && nmsg | js \"all(m['resolved'] for m in d if m['key']=='app-pinger-sdk')\""
check "notify: invalid input refused" "cgi notify $GP '{\"op\":\"send\",\"level\":\"fatal\",\"key\":\"k\",\"title\":\"t\"}' | grep -q 'invalid level' && cgi notify $GP '{\"op\":\"send\",\"key\":\"a/b\",\"title\":\"t\"}' | grep -q 'invalid key' && cgi notify $GP '{\"op\":\"send\",\"key\":\"k\",\"title\":\"\"}' | grep -q 'invalid title' && cgi notify $GP '{\"op\":\"send\",\"key\":\"k\",\"title\":\"a\u0007b\"}' | grep -q 'invalid title'"
# 8 from the job, 1 from the browser so far
for i in 1 2 3 4 5 6 7 8 9 10 11; do cgi notify $GP "{\"op\":\"send\",\"key\":\"r$i\",\"title\":\"t\"}" >/dev/null; done
check "notify: at most 20 messages an hour per app" "cgi notify $GP '{\"op\":\"send\",\"key\":\"over\",\"title\":\"t\"}' | grep -q 'too many messages' && ! nmsg | grep -q app-pinger-over"
check "notify: other apps cannot use it (no permission)" "run 'shareos-apps notify homelab send info k t' | grep -q 'no permission'"
check "notify: removing the app resolves its messages" "run 'shareos-apps remove pinger' | js \"d['ok']\" && nmsg | js \"all(m['resolved'] for m in d if m['key'].startswith('app-pinger-'))\""

echo
echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
