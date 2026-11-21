#!/bin/bash
#
# Tests the Paperless upload (against a small fake Paperless API) and cloud
# sync with the real rclone ARM build (local "cloud" remote) in an ARM chroot.
#
#   sudo tests/test-cloud-paperless.sh [output/dns320l] [rclone download dir]
#
# The rclone download dir must contain v<version>/rclone-v<version>-linux-arm.zip
# and v<version>/SHA256SUMS (from the rclone GitHub release); without it the
# cloud part is skipped.
#
# own UTS name space: start scripts of the box set the host name, which
# would otherwise change the host name of the build machine
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
RDL=${2:-}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
PPORT=18765 RPORT=18766

T=$(mktemp -d /tmp/shareos-cp-test.XXXX)
R=$T/root
PIDS=
cleanup() {
	for p in $PIDS; do kill $p 2>/dev/null; done
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
mount -t proc proc "$R/proc"; mount -t sysfs sysfs "$R/sys"; mount --bind /dev "$R/dev"
mount -t tmpfs tmpfs "$R/tmp"
mkdir -p "$R/var/run/ubus" "$R/var/log" "$R/mnt/daten"
mount -t tmpfs -o size=900m tmpfs "$R/mnt/daten"
echo "nameserver 127.0.0.1" > "$R/etc/resolv.conf.test"; [ -L "$R/etc/resolv.conf" ] && rm "$R/etc/resolv.conf"; cp "$R/etc/resolv.conf.test" "$R/etc/resolv.conf"

run() { chroot "$R" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; [ -n "$3" ] && echo "      $3" | head -5; failed=$((failed+1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

# --- fake Paperless --------------------------------------------------------------
cat > $T/paperless.py <<'PY'
import json, sys, uuid, re
from http.server import BaseHTTPRequestHandler, HTTPServer
TOKEN = 'a' * 40
LOG = sys.argv[2]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def ok(self):
        if self.headers.get('Authorization') != 'Token ' + TOKEN:
            self.send_response(401); self.end_headers(); self.wfile.write(b'{"detail":"Invalid token."}'); return False
        return True
    def reply(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if not self.ok(): return
        if self.path.startswith('/api/documents/'): return self.reply({'count': 42, 'results': []})
        if self.path.startswith('/api/tags/'): return self.reply({'results': [{'id': 3, 'name': 'Rechnung'}, {'id': 7, 'name': 'Scan'}]})
        if self.path.startswith('/api/tasks/'):
            t = re.search(r'task_id=([0-9a-f-]+)', self.path).group(1)
            return self.reply([{'task_id': t, 'status': 'SUCCESS', 'result': 'Success. New document id 5 created', 'related_document': 5}])
        self.reply({}, 404)
    def do_POST(self):
        if not self.ok(): return
        n = int(self.headers['Content-Length']); body = self.rfile.read(n)
        if self.path == '/api/documents/post_document/':
            names = re.findall(rb'filename="([^"]+)"', body)
            tags = re.findall(rb'name="tags"\r\n\r\n([0-9]+)', body)
            open(LOG, 'a').write(json.dumps({'files': [x.decode() for x in names], 'tags': [x.decode() for x in tags]}) + '\n')
            return self.reply(str(uuid.uuid4()))
        self.reply({}, 404)
HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY
python3 $T/paperless.py $PPORT $T/uploads.jsonl & PIDS="$PIDS $!"
sleep 1
TOK=$(printf 'a%.0s' $(seq 40))

run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci commit storage" >/dev/null
run "echo anna1234 | shareos-users add anna user --home=daten --cloud=1" >/dev/null

# --- Paperless via the tool --------------------------------------------------------
check "test: good token" "run \"echo $TOK | shareos-paperless test http://127.0.0.1:$PPORT\" | grep -q 'ok documents=42'"
check "test: bad token" "run \"echo wrongwrongwrongwrongwrong | shareos-paperless test http://127.0.0.1:$PPORT\" | grep -q 'token rejected'"
run "uci set paperless.global.url=http://127.0.0.1:$PPORT; uci set paperless.u_anna=inbox; uci set paperless.u_anna.owner=anna; uci set paperless.u_anna.token=$TOK; uci add_list paperless.u_anna.tags=3; uci commit paperless" >/dev/null
IN=$R/mnt/daten/home/anna/Paperless

# --- Paperless is a module (system app "paperless") ---------------------------------
run "shareos-paperless folders" >/dev/null
check "module not installed: no folders, run does nothing" "[ ! -d $IN ] && run 'shareos-paperless run; echo rc=\$?' | grep -q rc=0"
o=$(run "shareos-apps modules migrate")
check "module: installed once from the firmware copy (Paperless was set up)" "echo \"\$o\" | js \"d['installed']==['paperless']\" && [ -f $R/opt/shareos/sysapps/paperless/app.json ] && [ -f $R/etc/shareos/module-migrated.paperless ]"
check "module: listed" "run 'shareos-apps modules' | js \"d['modules']==['paperless']\""
check "module: install hook created the inbox folder" "[ -d $IN ]"
run "shareos-cron sync" >/dev/null
check "module: cron entry while installed" "grep -q 'shareos-paperless run' $R/etc/crontabs/root"
run "shareos-apps remove paperless" >/dev/null
check "module removed: no cron entry, folder stays" "! grep -q 'shareos-paperless run' $R/etc/crontabs/root && [ -d $IN ] && [ ! -e $R/opt/shareos/sysapps/paperless ]"
check "module removed: migration does not bring it back" "run 'shareos-apps modules migrate' | js \"d['installed']==[]\""
(cd "$TOP/sysapps/paperless" && tar -cf - app.json icon.svg | gzip -c > "$R/tmp/paperless.sapp")
check "module: installed from its package" "run 'shareos-apps install-file /tmp/paperless.sapp' | js \"d['ok'] and d['module']\""
mkdir -p $T/fake && printf '{"id":"nosuchmodule","name":"x","version":"1.0.0","type":"system","module":"nosuchmodule","commands":[]}' > $T/fake/app.json
(cd $T/fake && tar -cf - app.json | gzip -c > "$R/tmp/fake.sapp")
check "module: unknown module refused" "run 'shareos-apps install-file /tmp/fake.sapp' | grep -q 'no module'"
printf '{"id":"paperless2","name":"x","version":"1.0.0","type":"system","module":"paperless","commands":[]}' > $T/fake/app.json
(cd $T/fake && tar -cf - app.json | gzip -c > "$R/tmp/fake.sapp")
check "module: must equal the id" "run 'shareos-apps install-file /tmp/fake.sapp' | grep -q 'must equal the id'"
run "shareos-paperless folders" >/dev/null
check "personal inbox folder created for the user" "[ -d $IN ] && [ \"\$(run stat -c %U /mnt/daten/home/anna/Paperless)\" = anna ]"
echo "%PDF-1.4 test" > $IN/rechnung.pdf; echo hi > $IN/notiz.xyz; echo "%PDF-1.4 new" > $IN/frisch.pdf
touch -d '-5 minutes' $IN/rechnung.pdf $IN/notiz.xyz
run "shareos-paperless run" >/dev/null
check "file uploaded with token and tag" "grep -q '\"rechnung.pdf\"' $T/uploads.jsonl && grep -q '\"tags\": \\[\"3\"\\]' $T/uploads.jsonl"
check "uploaded file removed, others stay" "[ ! -e $IN/rechnung.pdf ] && [ -e $IN/notiz.xyz ] && [ -e $IN/frisch.pdf ]"
check "files still being copied are skipped" "! grep -q frisch.pdf $T/uploads.jsonl"
check "log: pending, then success after the task check" "grep -q 'rechnung.pdf.*SUCCESS' $IN/.paperless/log"
run "uci set paperless.u_anna.token=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; uci commit paperless" >/dev/null
touch -d '-5 minutes' $IN/frisch.pdf
run "shareos-paperless run" >/dev/null
check "rejected token: logged, file kept for the next try" "grep -q 'frisch.pdf.*FAILURE.*token rejected' $IN/.paperless/log && [ -e $IN/frisch.pdf ]"
run "uci set paperless.u_anna.token=$TOK; uci commit paperless" >/dev/null
run "shareos-cron sync" >/dev/null
check "cron entry for Paperless" "grep -q 'shareos-paperless run' $R/etc/crontabs/root"
run "uci set paperless.global.enabled=0; uci commit paperless; shareos-cron sync" >/dev/null
check "cron entry gone when switched off" "! grep -q 'shareos-paperless run' $R/etc/crontabs/root"
run "uci set paperless.global.enabled=1; uci commit paperless" >/dev/null

# --- rpcd ---------------------------------------------------------------------------
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run "ubus list shareos.paperless" >/dev/null 2>&1 || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done
check "rpc: area Paperless on while the module is installed" "run \"ubus call shareos.ui get\" | js \"d['areas']['paperless']\""
G=$(run "ubus call shareos.paperless get")
check "rpc: get hides the token" "echo '$G' | js \"d['inboxes'][0]['token_hint']=='••••aaaa' and 'token' not in d['inboxes'][0] and d['inboxes'][0]['recent'][0]['state'] in ('FAILURE','SUCCESS')\""
check "rpc: tags" "run \"ubus call shareos.paperless tags '{\\\"inbox\\\":\\\"u_anna\\\"}'\" | js \"[t['name'] for t in d['tags']]==['Rechnung','Scan']\""
check "rpc: invalid URL rejected" "run \"ubus call shareos.paperless set_global '{\\\"url\\\":\\\"ftp://x\\\"}'\" | grep -q 'invalid URL'"
U0=$(run "uci -q get paperless.global.url")
check "rpc: a host name with port is accepted (#194)" "run \"ubus call shareos.paperless set_global '{\\\"url\\\":\\\"http://paperless.lan:8000\\\"}'\" | js \"'error' not in d\" && [ \"\$(run 'uci -q get paperless.global.url')\" = http://paperless.lan:8000 ]"
run "ubus call shareos.paperless set_global '{\"url\":\"$U0\"}'" >/dev/null
L=$(run "ubus call session login '{\"username\":\"anna\",\"password\":\"anna1234\"}'")
SID=$(echo "$L" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ubus_rpc_session"])' 2>/dev/null)
run "ubus call shareos.me bind '{\"username\":\"anna\",\"password\":\"anna1234\",\"ubus_rpc_session\":\"$SID\"}'" >/dev/null
check "me: own Paperless inbox" "run \"ubus call shareos.me paperless '{\\\"ubus_rpc_session\\\":\\\"$SID\\\"}'\" | js \"d['available'] and d['inbox']['owner']=='anna'\""
check "me: token test" "run \"ubus call shareos.me paperless_set '{\\\"test\\\":true,\\\"ubus_rpc_session\\\":\\\"$SID\\\"}'\" | js \"d['ok'] and d['documents']=='42'\""

# --- the desktop view is a module (system app "desktop") ----------------------------------
me() { run "ubus call shareos.me $1 '$2'"; }
S1="\"ubus_rpc_session\":\"$SID\""
check "desktop module not installed: area off, desk_get refused" "run 'ubus call shareos.ui get' | js \"not d['areas']['desktop']\" && me desk_get '{'\"\$S1\"'}' | grep -q 'not installed'"
check "desktop module: not taken over by the migration" "run 'shareos-apps modules migrate' | js \"'desktop' not in d['installed']\" && [ ! -e $R/opt/shareos/sysapps/desktop ]"
(cd "$TOP/sysapps/desktop" && tar -cf - app.json icon.svg | gzip -c > "$R/tmp/desktop.sapp")
check "desktop module: installed from its package, area on" "run 'shareos-apps install-file /tmp/desktop.sapp' | js \"d['ok'] and d['module']\" && run 'ubus call shareos.ui get' | js \"d['areas']['desktop']\""
check "desktop: empty layout at first" "me desk_get '{'\"\$S1\"'}' | js \"d['desk']=={}\""
DESK='{"v":1,"open":[{"id":"storage","max":true}],"geo":{"storage":{"x":40,"y":80,"w":900,"h":600}},"wall":{"root":"home","path":"Bilder","name":"berg.jpg","fit":"cover"}}'
check "desktop: layout saved for the account" "me desk_set '{\"desk\":'\"\$DESK\"','\"\$S1\"'}' | js \"d['ok']\" && [ -f $R/etc/shareos/desktop/anna.json ] && [ \"\$(stat -c %a $R/etc/shareos/desktop)\" = 700 ]"
check "desktop: layout read back" "me desk_get '{'\"\$S1\"'}' | js \"d['desk']['open'][0]['id']=='storage' and d['desk']['wall']['name']=='berg.jpg' and d['desk']['geo']['storage']['w']==900\""
BIG=$(python3 -c "import json; print(json.dumps({'v': 1, 'x': 'a' * 17000}))")
check "desktop: too large refused" "me desk_set '{\"desk\":'\"\$BIG\"','\"\$S1\"'}' | grep -q 'too large'"
check "desktop: without a bound session refused" "run \"ubus call shareos.me desk_get '{}'\" | grep -q 'session not bound'"
run "shareos-apps remove desktop" >/dev/null
check "desktop module removed: area off, refused, layout kept" "run 'ubus call shareos.ui get' | js \"not d['areas']['desktop']\" && me desk_get '{'\"\$S1\"'}' | grep -q 'not installed' && [ -f $R/etc/shareos/desktop/anna.json ]"
check "desktop controller: forget removes the layout" "run 'shareos-desktop forget anna' && [ ! -e $R/etc/shareos/desktop/anna.json ] && ! run 'shareos-desktop forget ../x' >/dev/null"

# --- Cloud is a module (system app "cloud") --------------------------------------------
check "cloud module not installed: rpc and run refused" "run 'ubus call shareos.cloud status' | grep -q 'not installed' && run 'shareos-cloud run x' | grep -q 'not installed'"
check "cloud module: not taken over while unused" "[ -f $R/etc/shareos/module-migrated.cloud ] && [ ! -e $R/opt/shareos/sysapps/cloud ]"
run "uci set cloud.mig=job; uci commit cloud; rm -f /etc/shareos/module-migrated.cloud" >/dev/null
check "cloud module: taken over where jobs exist" "run 'shareos-apps modules migrate' | js \"d['installed']==['cloud']\" && run 'ubus call shareos.ui get' | js \"d['areas']['cloud']\""
run "uci delete cloud.mig; uci commit cloud" >/dev/null

# --- cloud ----------------------------------------------------------------------------
if [ -n "$RDL" ] && [ -d "$RDL" ]; then
	(cd "$RDL" && python3 -m http.server $RPORT --bind 127.0.0.1 >/dev/null 2>&1) & PIDS="$PIDS $!"
	sleep 1
	run "uci set storage.global=global; uci set storage.global.apps=daten; uci commit storage" >/dev/null
	o=$(run "SHAREOS_RCLONE_URL=http://127.0.0.1:$RPORT shareos-cloud install")
	check "rclone: downloaded, checksum verified, runs" "echo \"\$o\" | grep -q '^rclone v1.75.2' && [ -x $R/mnt/daten/.shareos/bin/rclone ] && [ -L $R/usr/bin/rclone ]"
	echo 'tampered' >> "$RDL/v1.75.2/rclone-v1.75.2-linux-arm.zip.bad" 2>/dev/null
	mkdir -p $R/mnt/daten/cloud
	o=$(run "printf '[target]\ntype = local\n' | shareos-cloud remote-add - target raw")
	check "remote: pasted rclone section" "grep -q '^\[target\]' $R/etc/shareos/cloud/rclone.conf && [ \"\$(stat -c %a $R/etc/shareos/cloud/rclone.conf)\" = 600 ]"
	check "remote: test" "run 'shareos-cloud remote-test - target' | grep -q '^ok'"
	o=$(run "echo 'pass=geheim' | shareos-cloud remote-add - dav webdav url=https://dav.example.com vendor=nextcloud user=jan")
	check "remote: webdav with obscured password" "grep -A5 '^\[dav\]' $R/etc/shareos/cloud/rclone.conf | grep -q '^pass = ' && ! grep -q geheim $R/etc/shareos/cloud/rclone.conf"
	o=$(run "echo 'pass=geheim2' | shareos-cloud remote-add - ftpbox ftp host=ftp.example.com user=jan")
	check "remote: FTP from the list of services" "grep -A4 '^\[ftpbox\]' $R/etc/shareos/cloud/rclone.conf | grep -q '^type = ftp' && ! grep -q geheim2 $R/etc/shareos/cloud/rclone.conf"
	o=$(run "shareos-cloud remote-add - gd gdrive < /dev/null" 2>&1)
	check "remote: Google Drive needs the sign-in first" "echo \"\$o\" | grep -q 'sign in first'" "$o"
	o=$(run "shareos-cloud auth-start - gdrive")
	check "sign-in: rclone gives the Google sign-in address" "echo \"\$o\" | grep -q '^url=https://accounts.google.com/'" "$o"
	o=$(run "shareos-cloud auth-finish - 'https://example.com/?code=x'" 2>&1)
	check "sign-in: only the local address is taken" "echo \"\$o\" | grep -q 'paste the whole address'" "$o"
	st=$(echo "$o" | head -1)
	o=$(run "shareos-cloud auth-finish - 'http://127.0.0.1:53682/?state=falsch&code=x'" 2>&1)
	check "sign-in: wrong state ends with an error, no token" "echo \"\$o\" | grep -q 'sign-in failed' && [ ! -s $R/tmp/shareos-cloud/auth.token ]" "$o"
	o=$(run "ubus call shareos.cloud auth_start '{\"type\":\"onedrive\"}'")
	check "rpc: sign-in address for OneDrive" "echo '$o' | js \"d['url'].startswith('https://login.microsoftonline.com/')\"" "$o"
	run "shareos-cloud auth-finish - x" >/dev/null 2>&1; pkill -f 'rclone authorize' 2>/dev/null
	run "uci set shares.fotos=share; uci set shares.fotos.volume=daten; uci set shares.fotos.path=Fotos; uci commit shares" >/dev/null
	mkdir -p $R/mnt/daten/Fotos/2026; echo bild1 > $R/mnt/daten/Fotos/2026/a.jpg; echo bild2 > $R/mnt/daten/Fotos/b.jpg
	run "uci set cloud.fotos=job; uci set cloud.fotos.owner=''; uci set cloud.fotos.remote=target; uci set cloud.fotos.remote_path=/mnt/daten/cloud/fotos; uci set cloud.fotos.local=share:fotos; uci set cloud.fotos.mode=upload; uci set cloud.fotos.schedule='30 2 * * *'; uci commit cloud" >/dev/null
	o=$(run "shareos-cloud run fotos")
	check "job: upload copies the share" "[ \"\$(cat $R/mnt/daten/cloud/fotos/2026/a.jpg)\" = bild1 ] && [ -f $R/mnt/daten/cloud/fotos/b.jpg ]"
	check "job: state ok with summary" "grep -q '^state=ok' $R/tmp/shareos-cloud/fotos.state"
	check "job: log written" "grep -q 'Copied' $R/mnt/daten/.shareos/cloud/logs/fotos.log"
	rm $R/mnt/daten/Fotos/b.jpg
	run "uci set cloud.fotos.mode=mirror_up; uci commit cloud; shareos-cloud run fotos" >/dev/null
	check "job: mirror deletes in the cloud what is gone here" "[ ! -e $R/mnt/daten/cloud/fotos/b.jpg ] && [ -f $R/mnt/daten/cloud/fotos/2026/a.jpg ]"
	# a subfolder of a share as the local folder (folder browser)
	o=$(run "ubus call shareos.cloud job_set '{\"name\":\"fsub\",\"remote\":\"target\",\"remote_path\":\"/mnt/daten/cloud/fsub\",\"local\":\"share:fotos/2026\",\"mode\":\"upload\"}'")
	check "job: subfolder of a share accepted" "echo '$o' | js \"d.get('ok')\"" "$o"
	run "shareos-cloud run fsub" >/dev/null
	check "job: subfolder uploads only its content" "[ \"\$(cat $R/mnt/daten/cloud/fsub/a.jpg)\" = bild1 ] && [ ! -e $R/mnt/daten/cloud/fsub/2026 ]"
	check "job: missing subfolder refused" "run \"ubus call shareos.cloud job_set '{\\\"name\\\":\\\"fx\\\",\\\"remote\\\":\\\"target\\\",\\\"local\\\":\\\"share:fotos/nix\\\",\\\"mode\\\":\\\"upload\\\"}'\" | grep -q 'not allowed'"
	check "job: '..' in the subfolder refused" "run \"ubus call shareos.cloud job_set '{\\\"name\\\":\\\"fx\\\",\\\"remote\\\":\\\"target\\\",\\\"local\\\":\\\"share:fotos/../x\\\",\\\"mode\\\":\\\"upload\\\"}'\" | grep -q 'not allowed'"
	ln -s /etc $R/mnt/daten/Fotos/aus
	check "job: symlink out of the share refused" "run \"ubus call shareos.cloud job_set '{\\\"name\\\":\\\"fx\\\",\\\"remote\\\":\\\"target\\\",\\\"local\\\":\\\"share:fotos/aus\\\",\\\"mode\\\":\\\"upload\\\"}'\" | grep -q 'not allowed'"
	rm $R/mnt/daten/Fotos/aus; run "uci delete cloud.fsub; uci commit cloud" >/dev/null
	# a system job downloading into a share: the users of the share can open
	# what came down, also when started from the web interface (rpcd: umask 077) (#91)
	run "uci set shares.fotos.rw=anna; uci commit shares; SHAREOS_ACL_WAIT=1 shareos-shares apply" >/dev/null
	mkdir -p $R/mnt/daten/cloud/dl/sub; echo neu > $R/mnt/daten/cloud/dl/sub/x.txt; chmod -R a+rX $R/mnt/daten/cloud
	run "uci set cloud.fotodl=job; uci set cloud.fotodl.owner=''; uci set cloud.fotodl.remote=target; uci set cloud.fotodl.remote_path=/mnt/daten/cloud/dl; uci set cloud.fotodl.local=share:fotos; uci set cloud.fotodl.mode=download; uci commit cloud" >/dev/null
	run "umask 077; shareos-cloud run fotodl" >/dev/null
	o=$(run "su -s /bin/sh anna -c 'ls /mnt/daten/Fotos/sub && cat /mnt/daten/Fotos/sub/x.txt'")
	check "system download into a share: its users open folders and files" "echo \"\$o\" | grep -q '^neu'" "$o; $(run ls -la /mnt/daten/Fotos/sub; run getfacl -p /mnt/daten/Fotos/sub 2>&1)"
	run "uci delete cloud.fotodl; uci commit cloud; uci delete shares.fotos.rw; uci commit shares" >/dev/null
	# ... and into a share inside a personal folder (no ACLs there): the files
	# belong to that user (#91)
	run "uci set shares.annah=share; uci set shares.annah.volume=daten; uci set shares.annah.path=home/anna; uci commit shares" >/dev/null
	run "uci set cloud.annadl=job; uci set cloud.annadl.owner=''; uci set cloud.annadl.remote=target; uci set cloud.annadl.remote_path=/mnt/daten/cloud/dl; uci set cloud.annadl.local=share:annah; uci set cloud.annadl.mode=download; uci commit cloud" >/dev/null
	run "umask 077; shareos-cloud run annadl" >/dev/null
	o=$(run "su -s /bin/sh anna -c 'ls /mnt/daten/home/anna/sub && cat /mnt/daten/home/anna/sub/x.txt'")
	check "system download into a personal folder: the files belong to the user" "echo \"\$o\" | grep -q '^neu' && [ \"\$(run stat -c %U /mnt/daten/home/anna/sub/x.txt)\" = anna ]" "$o"
	run "uci delete cloud.annadl; uci delete shares.annah; uci commit cloud; uci commit shares; rm -rf /mnt/daten/home/anna/sub" >/dev/null
	# OneDrive: the drive of the account goes into the remote (#92); Microsoft
	# Graph is a file here
	mkdir -p $R/tmp/graph/me; echo '{"id":"b!Xy_1","driveType":"personal","owner":{"user":{"id":"other"}}}' > $R/tmp/graph/me/drive
	mkdir -p $R/tmp/shareos-cloud; printf - > $R/tmp/shareos-cloud/auth.owner; printf onedrive > $R/tmp/shareos-cloud/auth.type
	printf '{"access_token":"at","token_type":"Bearer","refresh_token":"rt","expiry":"2030-01-01T00:00:00Z"}' > $R/tmp/shareos-cloud/auth.token
	o=$(run "SHAREOS_GRAPH_URL=file:///tmp/nothing shareos-cloud remote-add - od onedrive </dev/null")
	check "OneDrive: no drive – no remote, the sign-in stays" "echo \"\$o\" | grep -q 'could not be read' && [ -s $R/tmp/shareos-cloud/auth.token ] && ! grep -q '^\[od\]' $R/etc/shareos/cloud/rclone.conf" "$o"
	o=$(run "SHAREOS_GRAPH_URL=file:///tmp/graph shareos-cloud remote-add - od onedrive </dev/null")
	check "OneDrive: remote with drive_id and drive_type" "grep -A6 '^\[od\]' $R/etc/shareos/cloud/rclone.conf | grep -q '^drive_id = b!Xy_1' && grep -A6 '^\[od\]' $R/etc/shareos/cloud/rclone.conf | grep -q '^drive_type = personal' && [ ! -e $R/tmp/shareos-cloud/auth.token ]" "$o; $(grep -A6 '^\[od\]' $R/etc/shareos/cloud/rclone.conf)"
	run "shareos-cron sync" >/dev/null
	check "cron entry for the scheduled job" "grep -q '^30 2 \* \* \* /usr/sbin/shareos-cloud run fotos' $R/etc/crontabs/root"
	# a user's job runs as that user
	run "printf '[mine]\ntype = local\n' | shareos-cloud remote-add anna mine raw" >/dev/null
	check "user remote in the user's own config" "grep -q '^\[mine\]' $R/mnt/daten/home/anna/.config/rclone/rclone.conf && [ \"\$(run stat -c %U /mnt/daten/home/anna/.config/rclone/rclone.conf)\" = anna ]"
	mkdir -p $R/mnt/daten/cloud/anna-src; echo doc > $R/mnt/daten/cloud/anna-src/d.txt; chmod -R a+rX $R/mnt/daten/cloud
	run "uci set cloud.annajob=job; uci set cloud.annajob.owner=anna; uci set cloud.annajob.remote=mine; uci set cloud.annajob.remote_path=/mnt/daten/cloud/anna-src; uci set cloud.annajob.local=home; uci set cloud.annajob.mode=download; uci commit cloud" >/dev/null
	run "shareos-cloud run annajob" >/dev/null
	check "user job: files belong to the user" "[ \"\$(run stat -c %U /mnt/daten/home/anna/d.txt)\" = anna ]"
	C=$(run "ubus call shareos.me cloud '{\"ubus_rpc_session\":\"$SID\"}'")
	check "me: own cloud jobs only" "echo '$C' | js \"d['allowed'] and [j['name'] for j in d['jobs']]==['annajob'] and [r['name'] for r in d['remotes']]==['mine']\""
	check "me: share without access refused" "run \"ubus call shareos.me cloud_job_set '{\\\"name\\\":\\\"x\\\",\\\"remote\\\":\\\"mine\\\",\\\"local\\\":\\\"share:fotos\\\",\\\"mode\\\":\\\"download\\\",\\\"ubus_rpc_session\\\":\\\"$SID\\\"}'\" | grep -q 'not allowed'"
	J=$(run "ubus call shareos.cloud jobs")
	check "rpc: all jobs with state" "echo '$J' | js \"sorted(j['name'] for j in d['jobs'])==['annajob','fotos'] and [j for j in d['jobs'] if j['name']=='fotos'][0]['state']=='ok'\""
	run "shareos-apps remove cloud" >/dev/null
	check "cloud module removed: no cron entry, jobs and accounts kept" "! grep -q 'shareos-cloud run' $R/etc/crontabs/root && [ \"\$(run 'uci -q get cloud.fotos')\" = job ] && grep -q '^\[target\]' $R/etc/shareos/cloud/rclone.conf"
else
	echo "SKIP  cloud (no rclone download dir given)"
fi

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
