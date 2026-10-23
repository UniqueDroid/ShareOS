#!/bin/bash
#
# Tests the ShareOS app store (shareos-apps, rpcd shareos.apps, the web server
# for apps) with the built ARM userland (qemu-user) in a chroot. Catalog and
# packages are served from files (file:// is allowed only for this test).
#
#   sudo tests/test-apps.sh [output/dns320l] [webpad.sapp]
#
# own UTS name space: start scripts of the box set the host name, which
# would otherwise change the host name of the build machine
[ -n "${SHAREOS_TEST_UTS:-}" ] || exec unshare --uts env SHAREOS_TEST_UTS=1 "$0" "$@"
set -u
OUT=${1:-output/dns320l}
TOP=$(cd "$(dirname "$0")/.." && pwd)
case "$OUT" in /*) ;; *) OUT="$TOP/$OUT" ;; esac
SQFS="$OUT/images/rootfs.squashfs"
UNSQ="$OUT/host/bin/unsquashfs"
QEMU=$(command -v qemu-arm-static) || { echo "install qemu-user-static"; exit 1; }
[ -f "$SQFS" ] || { echo "no $SQFS"; exit 1; }
PORT=${SHAREOS_TEST_APPS_PORT:-18081}

T=$(mktemp -d /tmp/shareos-apps-test.XXXX)
R=$T/root
cleanup() {
	chroot "$R" /bin/sh -c '/etc/init.d/S51apps stop; /etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1
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
mkdir -p "$R/var/run/ubus" "$R/var/log"

run() { chroot "$R" /usr/bin/env SHAREOS_APPS_ALLOW_FILE=1 /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
rpc() { run "ubus call $1 $2 '$3'"; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

# --- packages: a good one, a bad checksum, path tricks, a link, broken manifest
P=$R/tmp/pkg; mkdir -p $P
mkapp() {   # dir id version [extra python for the manifest]
	mkdir -p "$1/files"
	echo '<!doctype html><title>ok</title>' > "$1/files/index.html"
	echo '<svg xmlns="http://www.w3.org/2000/svg"/>' > "$1/files/icon.svg"
	python3 - "$1" "$2" "$3" <<'PY'
import json, sys
d, i, v = sys.argv[1:4]
json.dump({"id": i, "name": "Test " + i, "version": v, "publisher": "Test", "type": "webapp", "entry": "index.html", "icon": "icon.svg",
           "description": {"de": "Test-App", "en": "test app"}}, open(d + "/app.json", "w"))
PY
}
pack() { (cd "$1" && tar -czf "$2" app.json -C files .); }
mkapp $T/a1 hello 1.0.0; pack $T/a1 $P/hello-1.0.0.sapp
mkapp $T/a2 hello 1.1.0; pack $T/a2 $P/hello-1.1.0.sapp
mkapp $T/a3 evil 1.0.0; (cd $T/a3 && tar -czf $P/evil-dots.sapp app.json --transform 's|^|../|' -C files .)
mkapp $T/a4 linky 1.0.0; ln -s /etc/shadow $T/a4/files/shadow; pack $T/a4 $P/linky.sapp
mkapp $T/a5 native 1.0.0; python3 -c "import json; f='$T/a5/app.json'; d=json.load(open(f)); d['type']='native'; json.dump(d,open(f,'w'))"; pack $T/a5 $P/native.sapp
mkapp $T/a6 noentry 1.0.0; rm $T/a6/files/index.html; echo x > $T/a6/files/other.html; pack $T/a6 $P/noentry.sapp
mkapp $T/a7 helper 1.0.0; pack $T/a7 $P/helper-1.0.0.sapp
mkapp $T/a8 needy 1.0.0; python3 -c "import json; f='$T/a8/app.json'; d=json.load(open(f)); d['requires']=['helper']; json.dump(d,open(f,'w'))"; pack $T/a8 $P/needy-1.0.0.sapp
mkapp $T/a9 orphan 1.0.0; python3 -c "import json; f='$T/a9/app.json'; d=json.load(open(f)); d['requires']=['nothere']; json.dump(d,open(f,'w'))"; pack $T/a9 $P/orphan-1.0.0.sapp
mkapp $T/a10 selfish 1.0.0; python3 -c "import json; f='$T/a10/app.json'; d=json.load(open(f)); d['requires']=['selfish']; json.dump(d,open(f,'w'))"; pack $T/a10 $P/selfish-1.0.0.sapp
[ -n "${2:-}" ] && [ -f "$2" ] && cp "$2" $P/webpad.sapp
sha() { sha256sum "$1" | cut -d' ' -f1; }
python3 - "$P" "$(sha $P/hello-1.0.0.sapp)" "$(sha $P/hello-1.1.0.sapp)" "$(sha $P/helper-1.0.0.sapp)" "$(sha $P/needy-1.0.0.sapp)" <<'PY' > $P/index.json
import json, sys
p, s1, s2, s3, s4 = sys.argv[1:6]
v = lambda ver, f, s, pre=False: {"version": ver, "date": "2026-10-18T10:00:00Z", "prerelease": pre, "url": "file:///tmp/pkg/" + f, "sha256": s, "size": 100, "min_shareos": "0.0"}
print(json.dumps({"schema": 1, "apps": [
  {"id": "hello", "name": "Hello", "publisher": "Test", "type": "webapp", "versions": [v("1.0.0", "hello-1.0.0.sapp", s1), v("1.1.0", "hello-1.1.0.sapp", s2, True)]},
  {"id": "helper", "name": "Helper", "publisher": "Test", "type": "webapp", "versions": [v("1.0.0", "helper-1.0.0.sapp", s3)]},
  {"id": "needy", "name": "Needy", "publisher": "Test", "type": "webapp", "versions": [dict(v("1.0.0", "needy-1.0.0.sapp", s4), requires=["helper"])]},
  {"id": "broken", "name": "Broken", "publisher": "Test", "type": "webapp", "versions": [v("1.0.0", "hello-1.0.0.sapp", "0" * 64)]},
  {"id": "insecure", "name": "Insecure", "publisher": "Test", "versions": [dict(v("1.0.0", "x", s1), url="http://example.com/x.sapp")]}]}))
PY
run "uci -q delete apps.store.source; uci add_list apps.store.source=file:///tmp/pkg/index.json; uci set apps.store.port=$PORT; uci set apps.store.https_port=$((PORT+1)); uci set shareos.web.https=0; uci commit apps; uci commit shareos" >/dev/null

C=$(run "shareos-apps catalog")
check "catalog: stable channel shows release versions only" "echo '$C' | js \"[(a['id'],a['latest']) for a in d['apps']]==[('broken','1.0.0'),('hello','1.0.0'),('helper','1.0.0'),('needy','1.0.0')]\""
check "catalog: plain http package URLs are ignored" "! echo '$C' | grep -q insecure"
run "uci set apps.store.channel=beta; uci commit apps" >/dev/null
check "catalog: beta channel offers the pre-release" "run 'shareos-apps cached' | js \"[a['latest'] for a in d['apps'] if a['id']=='hello']==['1.1.0']\""
run "uci set apps.store.channel=stable; uci commit apps" >/dev/null
check "install from the catalog (checksum verified)" "run 'shareos-apps install hello' | js \"d['ok'] and d['version']=='1.0.0' and d['verified']\" && [ -f $R/www-apps/hello/index.html ] && [ -f $R/www-apps/hello/app.json ]"
check "installed list" "run 'shareos-apps list' | js \"[(a['id'],a['version'],a['verified'],a['users']) for a in d['apps']]==[('hello','1.0.0',True,['*'])]\""
check "update offered after switching to beta" "run 'uci set apps.store.channel=beta; uci commit apps; shareos-apps cached' | js \"[a['update_available'] for a in d['apps'] if a['id']=='hello']==[True]\""
check "update installs the new version" "run 'shareos-apps install hello 1.1.0' | js \"d['version']=='1.1.0'\" && run 'shareos-apps list' | js \"d['apps'][0]['version']=='1.1.0'\""
check "wrong checksum: not installed" "run 'shareos-apps install broken' | grep -q 'checksum mismatch' && [ ! -d $R/www-apps/broken ]"
check "job status after an install" "run 'shareos-apps status' | js \"d['state'] in ('done','error')\""
check "package with ../ paths rejected" "run 'shareos-apps install-file /tmp/pkg/evil-dots.sapp' | grep -q 'unsafe path' && [ ! -e $R/www-apps/evil ] && [ ! -e $R/evil ]"
check "package with a symlink rejected" "run 'shareos-apps install-file /tmp/pkg/linky.sapp' | grep -q 'links' && [ ! -e $R/www-apps/linky ]"
check "native apps are refused (not supported yet)" "run 'shareos-apps install-file /tmp/pkg/native.sapp' | grep -q 'not supported'"
check "missing entry file rejected" "run 'shareos-apps install-file /tmp/pkg/noentry.sapp' | grep -q 'entry file' && [ ! -e $R/www-apps/noentry ]"
check "requires: listed in the catalog" "run 'shareos-apps cached' | js \"[a['requires'] for a in d['apps'] if a['id']=='needy']==[['helper']]\""
check "requires: the app it needs comes first from the store" "run 'shareos-apps install needy' | js \"d['ok'] and d.get('also')==['helper']\" && [ -f $R/www-apps/helper/app.json ] && [ -f $R/www-apps/needy/app.json ]"
check "requires: shown in the installed list" "run 'shareos-apps list' | js \"[a['requires'] for a in d['apps'] if a['id']=='needy']==[['helper']]\""
check "requires: an app another one needs is not removed" "run 'shareos-apps remove helper' | grep -q 'needed by Test needy' && [ -d $R/www-apps/helper ]"
check "requires: removed with --force" "run 'shareos-apps remove helper --force' | js \"d['ok']\" && [ ! -d $R/www-apps/helper ]"
check "requires: upload installs the missing app from the store" "run 'shareos-apps remove needy >/dev/null; shareos-apps install-file /tmp/pkg/needy-1.0.0.sapp' | js \"d['ok'] and d.get('also')==['helper']\" && [ -d $R/www-apps/helper ]"
check "requires: not in the store – app installed with a note" "run 'shareos-apps install-file /tmp/pkg/orphan-1.0.0.sapp' | js \"d['ok'] and 'needs nothere' in d.get('warning','')\""
check "requires: an app cannot need itself" "run 'shareos-apps install-file /tmp/pkg/selfish-1.0.0.sapp' | grep -q 'requires: invalid'"
run 'shareos-apps remove needy; shareos-apps remove helper; shareos-apps remove orphan' >/dev/null
check "no leftovers from failed installs" "[ -z \"\$(ls -A $R/www-apps | grep '^\.new')\" ]"

# --- system apps (type "system"): programs for the terminal
mksys() {   # dir id command [extra python for the manifest]
	mkdir -p "$1/bin" "$1/lib" "$1/share/terminfo/x"
	printf '#!/bin/sh\necho "run $0 lib=$LD_LIBRARY_PATH ti=$TERMINFO_DIRS args=$*"\n' > "$1/bin/$3"; chmod 755 "$1/bin/$3"
	echo x > "$1/lib/libdemo.so.1"; echo t > "$1/share/terminfo/x/xterm"
	python3 - "$1" "$2" "$3" "${4:-}" <<'PY'
import json, sys
d, i, c, extra = sys.argv[1:5]
a = {"id": i, "name": "Sys " + i, "version": "1.0.0", "publisher": "Test", "type": "system", "commands": [c]}
exec(extra)
json.dump(a, open(d + "/app.json", "w"))
PY
	(cd "$1" && tar -czf "$P/$2.sapp" app.json bin lib share)
}
mksys $T/s1 demo-sys demo-cmd
mksys $T/s2 other-sys demo-cmd
mksys $T/s3 ls-sys ls
mksys $T/s4 nobin-sys ghost "a['commands']=['missing-cmd']"
mksys $T/s5 cron-sys cron-cmd "a['permissions']=['cron']"
check "system app installs to /opt/shareos/sysapps" "run 'shareos-apps install-file /tmp/pkg/demo-sys.sapp' | js \"d['ok']\" && [ -x $R/opt/shareos/sysapps/demo-sys/bin/demo-cmd ] && [ ! -e $R/www-apps/demo-sys ]"
check "system app: starter in /opt/shareos/bin" "grep -q 'shareos-sysapp: demo-sys' $R/opt/shareos/bin/demo-cmd && [ -x $R/opt/shareos/bin/demo-cmd ]"
check "system app: command in PATH of a login shell, with lib and terminfo" "run '. /etc/profile; demo-cmd a b' | grep -q 'run /opt/shareos/sysapps/demo-sys/bin/demo-cmd lib=/opt/shareos/sysapps/demo-sys/lib ti=/opt/shareos/sysapps/demo-sys/share/terminfo args=a b'"
check "system app: listed with type and commands" "run 'shareos-apps list' | js \"[(a['type'],a['commands'],a['users']) for a in d['apps'] if a['id']=='demo-sys']==[('system',['demo-cmd'],[])]\""
check "system app: not served by the apps web server" "[ ! -e $R/www-apps/demo-sys ]"
check "system app: a command of another app is refused" "run 'shareos-apps install-file /tmp/pkg/other-sys.sapp' | grep -q 'comes from the app demo-sys' && [ ! -e $R/opt/shareos/sysapps/other-sys ]"
check "system app: a command of the firmware is refused" "run 'shareos-apps install-file /tmp/pkg/ls-sys.sapp' | grep -q 'part of ShareOS already'"
check "system app: a missing program is refused" "run 'shareos-apps install-file /tmp/pkg/nobin-sys.sapp' | grep -q 'bin/missing-cmd missing'"
check "system app: permissions are refused" "run 'shareos-apps install-file /tmp/pkg/cron-sys.sapp' | grep -q 'only for web apps'"
check "system app: no leftovers from failed installs" "[ -z \"\$(ls -A $R/opt/shareos/sysapps | grep '^\.new')\" ] && [ -z \"\$(ls -A $R/www-apps | grep '^\.new')\" ]"
check "system app: reinstall keeps one starter" "run 'shareos-apps install-file /tmp/pkg/demo-sys.sapp' | js \"d['ok']\" && [ \"\$(ls $R/opt/shareos/bin)\" = demo-cmd ]"
# --- system apps that are services ("service" in app.json, controllers of the firmware)
printf '#!/bin/sh\n# shareos-service: boot start stop-all\necho "$1" >> /tmp/demosvc.log\n' > $R/usr/sbin/shareos-demosvc
printf '#!/bin/sh\n# shareos-service: stop-all\necho "$1" >> /tmp/onlystop.log\n' > $R/usr/sbin/shareos-onlystop
printf '#!/bin/sh\necho "$1" >> /tmp/nomark.log\n' > $R/usr/sbin/shareos-nomark
chmod 755 $R/usr/sbin/shareos-demosvc $R/usr/sbin/shareos-onlystop $R/usr/sbin/shareos-nomark
rm -f $R/tmp/demosvc.log $R/tmp/onlystop.log $R/tmp/nomark.log
mksys $T/v1 demo-svc demo-svcd "a['service']={'control':'demosvc','on_install':'start','delay':0}"
mksys $T/v2 ghost-svc ghost-svcd "a['service']={'control':'nothere'}"
mksys $T/v3 nomark-svc nomark-svcd "a['service']={'control':'nomark'}"
mksys $T/v4 noboot-svc noboot-svcd "a['service']={'control':'onlystop'}"
mksys $T/v5 stoponly-svc stoponly-svcd "a['service']={'control':'onlystop','boot':False}"
mksys $T/v6 badkey-svc badkey-svcd "a['service']={'control':'demosvc','run':'/bin/sh'}"
mksys $T/v7 badverb-svc badverb-svcd "a['service']={'control':'onlystop','boot':False,'on_install':'start'}"
mksys $T/v8 minidlna minidlnad-test
waitlog() { i=0; until grep -qx "$2" $R/tmp/$1 2>/dev/null || [ $i -ge 20 ]; do sleep 0.2; i=$((i + 1)); done; grep -qx "$2" $R/tmp/$1 2>/dev/null; }
check "service: installs and starts right away (on_install)" "run 'shareos-apps install-file /tmp/pkg/demo-svc.sapp' | js \"d['ok']\" && waitlog demosvc.log start"
check "service: an unknown controller is refused" "run 'shareos-apps install-file /tmp/pkg/ghost-svc.sapp' | grep 'no service controller' | grep -q nothere && [ ! -e $R/opt/shareos/sysapps/ghost-svc ]"
check "service: a program without the shareos-service line is no controller" "run 'shareos-apps install-file /tmp/pkg/nomark-svc.sapp' | grep -q 'no service controller' && [ ! -e $R/tmp/nomark.log ]"
check "service: boot needs a controller that can boot" "run 'shareos-apps install-file /tmp/pkg/noboot-svc.sapp' | grep -q 'cannot start at boot'"
check "service: unknown fields are refused (no own commands)" "run 'shareos-apps install-file /tmp/pkg/badkey-svc.sapp' | grep -q 'unknown service field run'"
check "service: on_install only with what the controller can do" "run 'shareos-apps install-file /tmp/pkg/badverb-svc.sapp' | grep -q 'on_install must be one of'"
check "service: boot false with a stop-only controller installs" "run 'shareos-apps install-file /tmp/pkg/stoponly-svc.sapp' | js \"d['ok']\""
check "service: an older package without \"service\" gets the known one (minidlna)" "run 'shareos-apps install-file /tmp/pkg/minidlna.sapp' | js \"d['ok']\" && run 'shareos-apps services list' | js \"[(s['control'],s['legacy'],s['delay']) for s in d['services'] if s['id']=='minidlna']==[('dlna',True,5)]\""
check "services list: sorted by delay, with the program for the state" "run 'shareos-apps services list' | js \"[(s['id'],s['boot'],s['proc']) for s in d['services']]==[('demo-svc',True,'demo-svcd'),('minidlna',True,'minidlnad-test'),('stoponly-svc',False,'stoponly-svcd')]\""
rm -f $R/tmp/demosvc.log
check "services boot: starts the boot services in the background" "run 'shareos-apps services boot' | js \"d['started']==['demosvc','dlna']\" && waitlog demosvc.log boot"
run "uci set shareos.autostart=autostart; uci add_list shareos.autostart.disabled=demosvc; uci commit shareos" >/dev/null
check "services boot: one switched off under Autostart stays off" "run 'shareos-apps services boot' | js \"d['started']==['dlna']\""
run "uci delete shareos.autostart.disabled; uci commit shareos" >/dev/null
rm -f $R/tmp/demosvc.log $R/tmp/onlystop.log
check "init script S90services boots them" "run '/etc/init.d/S90services start' >/dev/null && waitlog demosvc.log boot"
check "services stop (shutdown): stop-all of every service, also boot-less ones" "run 'shareos-apps services stop' | js \"d['stopped']==['onlystop','dlna','demosvc']\" && waitlog demosvc.log stop-all && waitlog onlystop.log stop-all"
rm -f $R/tmp/demosvc.log
check "remove: the service is stopped first" "run 'shareos-apps remove stoponly-svc; shareos-apps remove minidlna' | grep -c ok | grep -qx 2 && run 'shareos-apps remove demo-svc' | js \"d['ok']\" && grep -qx stop-all $R/tmp/demosvc.log"
run 'shareos-apps install-file /tmp/pkg/demo-svc.sapp' >/dev/null
SYSDIR=${SHAREOS_TEST_SYSAPPS:-$TOP/output/sysapps/sapp}
if ls $SYSDIR/nano-*.sapp $SYSDIR/htop-*.sapp >/dev/null 2>&1; then
	cp $SYSDIR/nano-*.sapp $P/nano.sapp; cp $SYSDIR/htop-*.sapp $P/htop.sapp
	check "nano (real package) installs and runs" "run 'shareos-apps install-file /tmp/pkg/nano.sapp' | js \"d['ok']\" && run '. /etc/profile; nano --version' | grep -q 'GNU nano'"
	check "htop (real package) installs and runs" "run 'shareos-apps install-file /tmp/pkg/htop.sapp' | js \"d['ok']\" && run '. /etc/profile; htop --version' | grep -q '^htop 3'"
	check "htop draws its screen in a terminal (ncurses, terminfo)" "python3 $TOP/tests/pty-run.py 25 q chroot $R /bin/sh -c '. /etc/profile; TERM=xterm-256color htop' | grep -q 'Load average'"
	for x in strace:'strace -- version' iperf3:'iperf 3' bash:'GNU bash, version 5'; do
		id=${x%%:*}; want=${x#*:}
		ls $SYSDIR/$id-*.sapp >/dev/null 2>&1 || continue
		cp $SYSDIR/$id-*.sapp $P/$id.sapp
		check "$id (real package) installs and runs" "run 'shareos-apps install-file /tmp/pkg/$id.sapp' | js \"d['ok']\" && run '. /etc/profile; $id --version 2>&1' | grep -q '$want'"
		run "shareos-apps remove $id" >/dev/null
	done
	run 'shareos-apps remove nano; shareos-apps remove htop' >/dev/null
else
	echo "SKIP  nano/htop packages (make sysapps-pack)"
fi
if [ -f $P/webpad.sapp ]; then
	check "Webpad package from the app repo installs (own upload)" "run 'shareos-apps install-file /tmp/pkg/webpad.sapp' | js \"d['id']=='webpad' and not d['verified']\" && [ -f $R/www-apps/webpad/vendor/codemirror/lib/codemirror.js ]"
fi

# --- web server for apps and rpcd
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start && /etc/init.d/S51apps start' >/dev/null
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/" || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done
check "apps are served on their own port" "[ \"\$(curl -s http://127.0.0.1:$PORT/hello/index.html)\" = '<!doctype html><title>ok</title>' ]"
check "app server has no /ubus (no admin login there)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -d '{}' http://127.0.0.1:$PORT/ubus)\" != 200 ]"
check "app server root leads to the admin interface" "curl -s http://127.0.0.1:$PORT/ | grep -q '#/apps'"
check "app server: no directory listing" "! curl -s http://127.0.0.1:$PORT/hello/ | grep -qi 'index of'"
i=0; until run "ubus list shareos.apps" >/dev/null 2>&1 || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done
check "rpc: installed with server ports" "rpc shareos.apps installed '{}' | js \"d['port']==$PORT and [a['id'] for a in d['apps']][0]=='hello'\""
check "rpc: catalog refresh answers at once and runs in the background" "rpc shareos.apps catalog '{\"refresh\":true}' | js \"d['refreshing']==True\""
for i in $(seq 60); do rpc shareos.apps catalog '{}' | js "d['refreshing']==False" && break; sleep 0.5; done
check "rpc: refreshed catalog is there afterwards" "rpc shareos.apps catalog '{}' | js \"d['refreshing']==False and d['time']>0 and 'hello' in [a['id'] for a in d['apps']]\""
check "rpc: installed list follows an install (cached result renewed)" "rpc shareos.apps installed '{}' | js \"[a['version'] for a in d['apps'] if a['id']=='hello']==['1.1.0']\" && run 'shareos-apps install-file /tmp/pkg/hello-1.0.0.sapp' >/dev/null && rpc shareos.apps installed '{}' | js \"[a['version'] for a in d['apps'] if a['id']=='hello']==['1.0.0']\" && run 'shareos-apps install-file /tmp/pkg/hello-1.1.0.sapp' >/dev/null && rpc shareos.apps installed '{}' | js \"[a['version'] for a in d['apps'] if a['id']=='hello']==['1.1.0']\""
check "rpc: services report running state" "rpc shareos.service list '{}' | js \"[s['running'] for s in d['services'] if s['name']=='rpcd']==[True]\""
check "rpc: services of system apps are listed under their control name" "rpc shareos.service list '{}' | js \"[(s['sysapp'],s['label'],s['autostart'],s['essential']) for s in d['services'] if s['name']=='demosvc']==[('demo-svc','Sys demo-svc',True,False)]\""
rm -f $R/tmp/demosvc.log
check "rpc: start / stop of a system app service run its controller" "rpc shareos.service action '{\"name\":\"demosvc\",\"action\":\"start\"}' | js \"d['ok']\" && rpc shareos.service action '{\"name\":\"demosvc\",\"action\":\"stop\"}' | js \"d['ok']\" && [ \"\$(cat $R/tmp/demosvc.log | tr '\\n' ' ')\" = 'boot stop-all ' ]"
check "rpc: autostart of a system app service can be switched off" "rpc shareos.service autostart '{\"name\":\"demosvc\",\"enabled\":false}' | js \"d['autostart']==False\" && run 'uci get shareos.autostart.disabled' | grep -qw demosvc && rpc shareos.service autostart '{\"name\":\"demosvc\",\"enabled\":true}' | js \"d['autostart']==True\""
check "rpc: unknown services stay unknown" "rpc shareos.service action '{\"name\":\"nothere\",\"action\":\"start\"}' | js \"d.get('error')=='unknown service'\""
run 'shareos-apps remove demo-svc' >/dev/null
check "rpc: icon as data URL (no request to the apps server)" "rpc shareos.apps installed '{}' | js \"d['apps'][0]['icon_data'].startswith('data:image/svg+xml;base64,')\""
check "rpc: box name for app links set by hand" "rpc shareos.web set '{\"host\":\"NAS.example.lan\"}' | js \"d['ok']\" && rpc shareos.apps installed '{}' | js \"d['host']=='nas.example.lan' and d['host_auto']==False\""
check "rpc: invalid box name rejected" "rpc shareos.web set '{\"host\":\"a b\"}' | grep -q 'invalid host'"
check "rpc: box name cleared again" "rpc shareos.web set '{\"host\":\"\"}' | js \"d['ok']\" && ! run 'uci -q get shareos.web.host'"
run 'killall uhttpd'
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/" || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done
check "apps server comes back after killall uhttpd (supervisor)" "[ \"\$(curl -s http://127.0.0.1:$PORT/hello/index.html)\" = '<!doctype html><title>ok</title>' ]"
run "uci set shareos.ui=ui; uci set shareos.ui.area_apps=0; uci commit shareos; /etc/init.d/S51apps stop; /etc/init.d/S51apps start" >/dev/null; sleep 2
check "area Apps off: apps web server does not start" "! curl -s -o /dev/null http://127.0.0.1:$PORT/"
run "uci set shareos.ui.area_apps=1; uci commit shareos; /etc/init.d/S51apps start" >/dev/null
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/" || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done
check "rpc: store sources must be https" "rpc shareos.apps store_set '{\"sources\":[\"http://x/index.json\"]}' | grep -q 'https'"
check "rpc: unknown user in visibility rejected" "rpc shareos.apps set '{\"id\":\"hello\",\"users\":[\"ghost\"]}' | grep -q 'unknown user'"
mkdir -p "$R/mnt/daten"; run "uci set storage.daten=volume; uci commit storage; echo lisa1234 | shareos-users add lisa user; echo bert1234 | shareos-users add bert user" >/dev/null
check "rpc: visibility per user" "rpc shareos.apps set '{\"id\":\"hello\",\"users\":[\"lisa\"]}' | js \"d['ok']\""
L1=$(rpc session login '{"username":"lisa","password":"lisa1234"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["ubus_rpc_session"])')
L2=$(rpc session login '{"username":"bert","password":"bert1234"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["ubus_rpc_session"])')
check "allowed user sees the app in My ShareOS" "rpc shareos.me bind '{\"username\":\"lisa\",\"password\":\"lisa1234\",\"ubus_rpc_session\":\"$L1\"}' | js \"'hello' in [a['id'] for a in d['apps']] and d['apps_server']['port']==$PORT\""
check "other users do not" "rpc shareos.me bind '{\"username\":\"bert\",\"password\":\"bert1234\",\"ubus_rpc_session\":\"$L2\"}' | js \"'hello' not in [a['id'] for a in d['apps']]\""
check "system apps are not offered in My ShareOS" "rpc shareos.me bind '{\"username\":\"lisa\",\"password\":\"lisa1234\",\"ubus_rpc_session\":\"$L1\"}' | js \"'demo-sys' not in [a['id'] for a in d['apps']]\""
check "system app: remove takes the starter along" "run 'shareos-apps remove demo-sys' | js \"d['ok']\" && [ ! -e $R/opt/shareos/bin/demo-cmd ] && [ ! -e $R/opt/shareos/sysapps/demo-sys ]"
TK=$(rpc shareos.apps upload_ticket '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"].split("t=")[1])')
cp $P/hello-1.0.0.sapp $R/tmp/up.sapp
o=$(run "QUERY_STRING=t=$TK REQUEST_METHOD=POST CONTENT_LENGTH=$(stat -c %s $R/tmp/up.sapp) /www/cgi-bin/files < /tmp/up.sapp")
check "upload a package through the CGI and install it" "echo \"\$o\" | grep -q 'Status: 200' && rpc shareos.apps install_upload '{}' | js \"d['id']=='hello' and d['version']=='1.0.0' and not d['verified']\""
check "users stay after reinstalling" "run 'shareos-apps list' | js \"d['apps'][0]['users']==['lisa']\""
check "remove" "rpc shareos.apps remove '{\"id\":\"hello\"}' | js \"d['ok']\" && [ ! -e $R/www-apps/hello ] && ! run 'uci -q get apps.app_hello' | grep -q app"
check "invalid id rejected" "rpc shareos.apps remove '{\"id\":\"../etc\"}' | grep -q 'invalid'"

# --- scheduled tasks (permission "cron") ---
mkjob() {   # dir id [python dict update for the manifest]
	mkapp "$1" "$2" 1.0.0
	mkdir -p "$1/files/jobs"
	cat > "$1/files/jobs/tick.sh" <<'SH'
echo "user=$(id -un) dir=$(pwd) app=$APP_ID"
date +%s >> "$APP_DATA/ticks"
touch "$APP_DIR/hack" 2>/dev/null && echo HACKED || echo denied
cat /etc/shadow >/dev/null 2>&1 && echo SHADOW || echo noshadow
SH
	printf 'sleep 30\n' > "$1/files/jobs/slow.sh"
	python3 - "$1/app.json" "${3:-{\}}" <<'PY'
import json, sys
f, upd = sys.argv[1], sys.argv[2]
d = json.load(open(f))
d.update({"permissions": ["cron"], "jobs": [{"id": "tick", "name": "Tick", "command": "jobs/tick.sh", "schedule": "*/10 * * * *", "timeout": 60},
                                             {"id": "slow", "name": "Slow", "command": "jobs/slow.sh", "schedule": "0 4 * * *", "timeout": 10}]})
d.update(eval(upd))
json.dump(d, open(f, "w"))
PY
}
mkjob $T/j1 ticker; pack $T/j1 $P/ticker.sapp
mkjob $T/j2 noperm '{"permissions": []}'; pack $T/j2 $P/noperm.sapp
mkjob $T/j3 rootish '{"permissions": ["cron", "root"]}'; pack $T/j3 $P/rootish.sapp
mkjob $T/j4 hasty '{"jobs": [{"id": "x", "command": "jobs/tick.sh", "schedule": "* * * * *"}]}'; pack $T/j4 $P/hasty.sapp
mkjob $T/j5 nofile '{"jobs": [{"id": "x", "command": "jobs/missing.sh", "schedule": "0 * * * *"}]}'; pack $T/j5 $P/nofile.sapp
mkjob $T/j6 ticker '{"version": "1.1.0", "jobs": [{"id": "tick", "name": "Tick", "command": "jobs/tick.sh", "schedule": "*/20 * * * *"}]}'; pack $T/j6 $P/ticker-1.1.sapp
check "jobs without the permission cron rejected" "run 'shareos-apps install-file /tmp/pkg/noperm.sapp' | grep -q 'need the permission'"
check "unknown permission rejected (newer ShareOS needed)" "run 'shareos-apps install-file /tmp/pkg/rootish.sapp' | grep -q 'not known to this ShareOS'"
check "schedule more often than every 5 minutes rejected" "run 'shareos-apps install-file /tmp/pkg/hasty.sapp' | grep -q 'every 5 minutes'"
check "job command missing in the package rejected" "run 'shareos-apps install-file /tmp/pkg/nofile.sapp' | grep -q 'missing in the package'"
o=$(run 'shareos-apps install-file /tmp/pkg/ticker.sapp')
check "app with jobs installed: own user and data folder" "echo '$o' | js \"d['ok']\" && grep -q '^app-ticker:' $R/etc/passwd && [ \"\$(run 'stat -c %U /var/lib/shareos-apps/ticker')\" = app-ticker ]"
check "jobs listed with schedule and permission" "run 'shareos-apps list' | js \"[ (j['id'], j['schedule'], j['enabled']) for a in d['apps'] if a['id']=='ticker' for j in a['jobs']]==[('tick','*/10 * * * *',True),('slow','0 4 * * *',True)] and 'cron' in [a for a in d['apps'] if a['id']=='ticker'][0]['permissions']\""
check "cron entries written" "grep -q '^\*/10 \* \* \* \* /usr/sbin/shareos-apps run-job ticker tick' $R/etc/crontabs/root && grep -q 'run-job ticker slow' $R/etc/crontabs/root"
o=$(run 'shareos-apps run-job ticker tick')
L=$(run 'shareos-apps job-log ticker tick')
check "job runs as the app user in its data folder" "echo '$o' | js \"d['rc']==0\" && echo '$L' | grep -q 'user=app-ticker dir=/var/lib/shareos-apps/ticker app=ticker' && [ -s $R/var/lib/shareos-apps/ticker/ticks ]"
check "job cannot change the app files or read /etc/shadow" "echo '$L' | grep -q denied && echo '$L' | grep -q noshadow"
o=$(run 'shareos-apps run-job ticker slow')
check "time limit stops a job" "echo '$o' | js \"d['timeout'] and d['duration']<25\""
check "failed task becomes a message" "run 'shareos-notify list' | js \"any(x['key']=='appjob-ticker-slow' and x['level']=='warn' for x in d['items'])\""
run 'ubus call shareos.apps job_set "{\"id\":\"ticker\",\"job\":\"tick\",\"schedule\":\"* * * * *\"}"' > $T/js1
check "rpc: too frequent schedule rejected" "grep -q 'every 5 minutes' $T/js1"
rpc_ok=$(run 'ubus call shareos.apps job_set "{\"id\":\"ticker\",\"job\":\"tick\",\"schedule\":\"15 2 * * *\"}"')
check "rpc: own schedule stored" "echo '$rpc_ok' | grep -q ok && grep -q '^15 2 \* \* \* /usr/sbin/shareos-apps run-job ticker tick' $R/etc/crontabs/root"
run 'ubus call shareos.apps job_set "{\"id\":\"ticker\",\"job\":\"slow\",\"enabled\":false}"' >/dev/null
check "rpc: job switched off, cron entry gone" "! grep -q 'run-job ticker slow' $R/etc/crontabs/root"
run 'shareos-apps install-file /tmp/pkg/ticker-1.1.sapp' >/dev/null
check "update keeps the own schedule, removed jobs disappear" "run 'shareos-apps list' | js \"[(j['id'], j['schedule']) for a in d['apps'] if a['id']=='ticker' for j in a['jobs']]==[('tick','15 2 * * *')]\" && ! run 'uci -q get apps.job_ticker__slow' | grep -q appjob"
run 'shareos-apps remove ticker' >/dev/null
check "remove: user, data, jobs and cron entries gone" "! grep -q '^app-ticker:' $R/etc/passwd && ! grep -q '^app-ticker:' $R/etc/group && [ ! -e $R/var/lib/shareos-apps/ticker ] && ! run 'uci show apps' | grep -q appjob && ! grep -q 'run-job ticker' $R/etc/crontabs/root"

# --- app platform: theme/SDK, opening files in an app ---------------------------------
check "SDK and theme served to the apps" "curl -s http://127.0.0.1:$PORT/_shareos/app.js | grep -q 'window.ShareOS' && curl -s http://127.0.0.1:$PORT/_shareos/theme.css | grep -q 'sos-menubar'"
mkapp $T/ed editor 1.0.0 && python3 -c "import json; f='$T/ed/app.json'; d=json.load(open(f)); d.update(window={'width': 900, 'height': 600}, opens=[{'ext': ['.txt', '.md'], 'mode': 'edit'}, {'ext': ['.png'], 'mode': 'view'}]); json.dump(d,open(f,'w'))" && pack $T/ed $P/editor.sapp
mkapp $T/eb embedder 1.0.0 && python3 -c "import json; f='$T/eb/app.json'; d=json.load(open(f)); d.update(permissions=['embed'], opens=[{'ext': ['TXT']}]); json.dump(d,open(f,'w'))" && pack $T/eb $P/embedder-bad.sapp
mkapp $T/ew wide 1.0.0 && python3 -c "import json; f='$T/ew/app.json'; d=json.load(open(f)); d.update(window={'width': 99999}); json.dump(d,open(f,'w'))" && pack $T/ew $P/wide.sapp
check "manifest: invalid file extension refused" "run 'shareos-apps install-file /tmp/pkg/embedder-bad.sapp' | grep -q 'invalid extension'"
check "manifest: window size checked" "run 'shareos-apps install-file /tmp/pkg/wide.sapp' | grep -q 'window width'"
check "manifest: window and opens accepted and listed" "run 'shareos-apps install-file /tmp/pkg/editor.sapp' | js \"d.get('ok')\" && run 'shareos-apps list' | js \"[a for a in d['apps'] if a['id']=='editor'][0]['opens'][0]=={'ext':['.txt','.md'],'mode':'edit','label':None} and [a for a in d['apps'] if a['id']=='editor'][0]['window']=={'width':900,'height':600}\""
run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci commit storage; mkdir -p /mnt/daten /tmp/shareos-sessions" >/dev/null
mount -t tmpfs tmpfs "$R/mnt/daten"
printf 'Hallo Welt\n' > "$R/mnt/daten/notiz.txt"; printf 'x' > "$R/mnt/daten/bild.png"; printf 'x' > "$R/mnt/daten/archiv.zip"
SIDA=0123456789abcdef0123456789abcdef; echo root > "$R/tmp/shareos-sessions/$SIDA"
s() { printf '{"ubus_rpc_session":"%s"%s}' "$SIDA" "${1:-}"; }
check "openers: apps that open files" "rpc shareos.files openers '$(s)' | js \"[a['id'] for a in d['apps']]==['editor'] and d['port']==$PORT\""
check "app ticket: file type the app does not open refused" "rpc shareos.files app_ticket '$(s ',"root":"daten","path":"","name":"archiv.zip","app":"editor"')' | grep -q 'does not open'"
check "app ticket: unknown app refused" "rpc shareos.files app_ticket '$(s ',"root":"daten","path":"","name":"notiz.txt","app":"nope"')' | grep -q 'not available'"
check "app ticket: without session refused" "rpc shareos.files app_ticket '{\"root\":\"daten\",\"name\":\"notiz.txt\",\"app\":\"editor\"}' | grep -q 'not allowed'"
TK=$(rpc shareos.files app_ticket "$(s ',"root":"daten","path":"","name":"notiz.txt","app":"editor"')" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ticket"] if d.get("mode")=="edit" else "")')
TV=$(rpc shareos.files app_ticket "$(s ',"root":"daten","path":"","name":"bild.png","app":"editor"')" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ticket"] if d.get("mode")=="view" else "")')
F=http://127.0.0.1:$PORT/_shareos/cgi/file
check "app ticket: edit for .txt, view for .png" "[ \${#TK} -eq 32 ] && [ \${#TV} -eq 32 ]"
check "app reads the file with its ticket" "[ \"\$(curl -s '$F?t=$TK')\" = 'Hallo Welt' ] && curl -s '$F?t=$TK&info=1' | js \"d['name']=='notiz.txt' and d['mode']=='edit' and d['size']==11\""
check "app saves the file (twice), owner kept" "curl -s -X PUT --data-binary 'Neu 1' '$F?t=$TK' | js \"d['ok']\" && curl -s -X PUT --data-binary 'Neu 2' '$F?t=$TK' | js \"d['ok']\" && [ \"\$(cat $R/mnt/daten/notiz.txt)\" = 'Neu 2' ] && ! ls -a $R/mnt/daten | grep -q part"
check "byte range: 206 with Content-Range" "[ \"\$(curl -s -r 1-3 '$F?t=$TK')\" = 'eu ' ] && curl -s -D - -o /dev/null -r 1-3 '$F?t=$TK' | grep -q 'Content-Range: bytes 1-3/5'"
check "byte range: suffix and open end" "[ \"\$(curl -s -r -2 '$F?t=$TK')\" = ' 2' ] && [ \"\$(curl -s -r 2- '$F?t=$TK')\" = 'u 2' ]"
check "byte range: beyond the end gives 416" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -r 99-100 '$F?t=$TK')\" = 416 ]"
check "media type for pictures, download for the rest" "curl -s -D - -o /dev/null '$F?t=$TV' | grep -qi 'content-type: image/png' && curl -s -D - -o /dev/null '$F?t=$TK' | grep -qi 'content-type: application/octet-stream'"
check "view ticket cannot save" "curl -s -X PUT --data-binary 'evil' '$F?t=$TV' | grep -q 'read-only' && [ \"\$(cat $R/mnt/daten/bild.png)\" = x ]"
check "invalid ticket refused" "curl -s '$F?t=ffffffffffffffffffffffffffffffff' | grep -q 'invalid ticket' && curl -s '$F?t=../../etc/shadow' | grep -q 'invalid ticket'"
sed -i '4s/.*/1/' "$R/tmp/shareos-appfiles/$TK"
check "expired ticket refused" "curl -s '$F?t=$TK' | grep -q 'expired'"
# permission "files": the user's folders through /_shareos/cgi/fs
mkapp $T/fm filer 1.0.0 && python3 -c "import json; f='$T/fm/app.json'; d=json.load(open(f)); d['permissions']=['files']; json.dump(d,open(f,'w'))" && pack $T/fm $P/filer.sapp
check "app with permission files installs" "run 'shareos-apps install-file /tmp/pkg/filer.sapp' | js \"d.get('ok')\""
check "grant refused for an app without files" "rpc shareos.files app_grant '$(s ',"app":"editor"')' | grep -q 'no access to files'"
G=$(rpc shareos.files app_grant "$(s ',"app":"filer"')" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("grant",""))')
FS="http://127.0.0.1:$PORT/_shareos/cgi/fs?g=$G"
fs() { curl -s -X POST --data-binary "$1" "${2:-$FS}"; }
check "fs: grant for the app" "[ \${#G} -eq 32 ]"
check "fs: roots and list" "fs '{\"op\":\"roots\"}' | js \"[r['name'] for r in d['roots']]==['daten']\" && fs '{\"op\":\"list\",\"root\":\"daten\",\"path\":\"\"}' | js \"'notiz.txt' in [e['name'] for e in d['entries']]\""
check "fs: mkdir, copy into it, rename, move back" "fs '{\"op\":\"mkdir\",\"root\":\"daten\",\"path\":\"\",\"name\":\"ablage\"}' | js \"d['ok']\" && fs '{\"op\":\"move\",\"root\":\"daten\",\"path\":\"\",\"names\":[\"notiz.txt\"],\"dest\":\"ablage\",\"copy\":true}' | js \"d['ok']\" && fs '{\"op\":\"rename\",\"root\":\"daten\",\"path\":\"ablage\",\"name\":\"notiz.txt\",\"to\":\"kopie.txt\"}' | js \"d['ok']\" && [ -f $R/mnt/daten/ablage/kopie.txt ] && [ -f $R/mnt/daten/notiz.txt ]"
check "fs: folder not moved into itself, no overwrite" "fs '{\"op\":\"move\",\"root\":\"daten\",\"path\":\"\",\"names\":[\"ablage\"],\"dest\":\"ablage\"}' | grep -q 'into itself' && fs '{\"op\":\"move\",\"root\":\"daten\",\"path\":\"ablage\",\"names\":[\"kopie.txt\"],\"dest\":\"ablage\",\"copy\":true}' | grep -q 'already exists'"
check "fs: no way out of the folders" "fs '{\"op\":\"list\",\"root\":\"daten\",\"path\":\"../../etc\"}' | grep -q 'invalid path' && fs '{\"op\":\"list\",\"root\":\"etc\",\"path\":\"\"}' | grep -q 'unknown folder'"
TN=$(fs '{"op":"open","root":"daten","path":"ablage","name":"neu.txt","write":true,"create":true}' | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ticket",""))')
check "fs: open a new file for writing, save it with the ticket" "[ \${#TN} -eq 32 ] && curl -s -X PUT --data-binary 'aus der App' '$F?t=$TN' | js \"d['ok']\" && [ \"\$(cat $R/mnt/daten/ablage/neu.txt)\" = 'aus der App' ]"
check "fs: open read-only cannot save, missing file needs create" "T2=\$(fs '{\"op\":\"open\",\"root\":\"daten\",\"path\":\"ablage\",\"name\":\"neu.txt\"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"ticket\"])') && curl -s -X PUT --data-binary x \"$F?t=\$T2\" | grep -q 'read-only' && fs '{\"op\":\"open\",\"root\":\"daten\",\"path\":\"\",\"name\":\"fehlt.txt\",\"write\":true}' | grep -q 'not found'"
check "fs: delete" "fs '{\"op\":\"delete\",\"root\":\"daten\",\"path\":\"\",\"names\":[\"ablage\"]}' | js \"d['ok']\" && [ ! -e $R/mnt/daten/ablage ]"
check "fs: unknown op, wrong grant, GET refused" "fs '{\"op\":\"exec\"}' | grep -q 'invalid request' && fs '{\"op\":\"roots\"}' 'http://127.0.0.1:$PORT/_shareos/cgi/fs?g=ffffffffffffffffffffffffffffffff' | grep -q 'no access' && curl -s '$FS' | grep -q 'not allowed'"
check "fs: no web session may call shareos.appfs (ACL)" "! grep -q 'shareos.appfs' $R/usr/share/rpcd/acl.d/shareos.json"
run 'shareos-apps remove filer' >/dev/null
check "fs: grant ends with the app" "fs '{\"op\":\"roots\"}' | grep -q 'no access'"
check "only ShareOS scripts run as CGI on the app server" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/cgi-bin/x)\" != 200 ]"
umount -l "$R/mnt/daten"

# --- minimum ShareOS version on a beta of the box ---------------------------------
cp $R/etc/shareos-release $T/release.bak
sed -i 's/^SHAREOS_VERSION=.*/SHAREOS_VERSION="0.1.0-beta.10"/' $R/etc/shareos-release
for m in 0.1.0:ok 0.1.0-beta.9:ok 0.1.0-beta.10:ok 0.1.0-beta.11:old 0.1.1:old 0.2.0:old; do
	mkapp $T/mv mver 1.0.0 && python3 -c "import json; f='$T/mv/app.json'; d=json.load(open(f)); d['min_shareos']='${m%%:*}'; json.dump(d,open(f,'w'))" && pack $T/mv $P/mver.sapp
	o=$(run 'shareos-apps install-file /tmp/pkg/mver.sapp')
	if [ "${m##*:}" = ok ]; then check "beta.10 box: app needing ${m%%:*} installs" "echo '$o' | js \"d.get('ok')\""
	else check "beta.10 box: app needing ${m%%:*} refused" "echo '$o' | grep -q 'or newer'"; fi
	run 'shareos-apps remove mver' >/dev/null
	rm -rf $T/mv
done
cp $T/release.bak $R/etc/shareos-release

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
