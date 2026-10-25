#!/bin/bash
#
# Tests accounts (shareos-users), shares (shareos-shares) and the rpcd methods
# shareos.accounts / shareos.shares / shareos.me with the built ARM userland
# (qemu-user) in a chroot. Services (ksmbd, nfsd) are not started – they need
# the box kernel; their configuration files are checked instead.
#
#   sudo tests/test-users.sh [output/dns320l]
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

T=$(mktemp -d /tmp/shareos-users-test.XXXX)
R=$T/root
cleanup() {
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
mount -t sysfs sysfs "$R/sys"
mount --bind /dev "$R/dev"
mount -t tmpfs tmpfs "$R/tmp"
mkdir -p "$R/var/run/ubus" "$R/var/log" "$R/mnt/daten"
# a "volume" for shares and home folders
mount -t tmpfs tmpfs "$R/mnt/daten"

run() { chroot "$R" /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
rpc() { run "ubus call $1 $2 '$3'"; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

run "uci set storage.daten=volume; uci set storage.daten.uuid=0; uci commit storage"
run "uci set shares.global.smb=0; uci set shares.global.nfs=0; uci commit shares"

# --- shareos-users ------------------------------------------------------------
o=$(run "shareos-users group-add familie --desc=Familie")
check "group added" "run 'uci get accounts.familie' | grep -qx group && grep -q '^familie:x:1[0-9][0-9][0-9]:' $R/etc/group"
o=$(run "echo geheim1 | shareos-users add jan admin --fullname=Jan --groups=familie --home=daten")
check "admin added" "grep -q '^jan:x:1[0-9][0-9][0-9]:100:Jan:/mnt/daten/home/jan:/bin/sh\$' $R/etc/passwd"
o=$(run "echo anna1234 | shareos-users add anna user --groups=familie --quota=5000")
check "user added without SSH shell" "grep -q '^anna:.*:/bin/false\$' $R/etc/passwd"
o=$(run "echo tvtvtv | shareos-users add tv share")
check "share-only user added" "run 'uci get accounts.tv.role' | grep -qx share"
o=$(run "echo short | shareos-users add bob share")
check "short password rejected" "echo \"\$o\" | grep -q '6 characters' && ! grep -q '^bob:' $R/etc/passwd"
o=$(run "echo geheim1 | shareos-users add root share")
check "reserved name rejected" "echo \"\$o\" | grep -q reserved"
o=$(run "echo geheim1 | shareos-users add Bad share")
check "invalid name rejected" "echo \"\$o\" | grep -q 'invalid name'"
check "group members written" "grep -qE '^familie:x:[0-9]+:(jan,anna|anna,jan)\$' $R/etc/group"
check "home folder created, private" "[ -d $R/mnt/daten/home/jan ] && [ \"\$(stat -c %a $R/mnt/daten/home/jan)\" = 700 ]"
check "web login for the admin" "run 'uci get rpcd.acc_jan.read' | grep -qx '\*'"
check "web login for the user (own area)" "run 'uci get rpcd.acc_anna.read' | grep -qx shareos-user"
check "no web login for share-only" "! run 'uci -q get rpcd.acc_tv' | grep -q login"
check "Linux password set (sha512)" "grep -q '^anna:\\\$6\\\$' $R/etc/shadow"
check "SMB password set" "grep -q '^anna:' $R/etc/ksmbd/ksmbdpwd.db"
o=$(run "shareos-users set anna --web=0")
check "web access can be withdrawn" "! run 'uci -q get rpcd.acc_anna' | grep -q login"
run "shareos-users set anna --web=1" >/dev/null

# --- rpcd: login, bind, me, accounts ----------------------------------------
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run "ubus list shareos.me" >/dev/null 2>&1 || [ $i -ge 30 ]; do sleep 0.5; i=$((i + 1)); done
L=$(rpc session login '{"username":"anna","password":"anna1234"}')
SID=$(echo "$L" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ubus_rpc_session"])' 2>/dev/null)
check "user can log in" "[ -n \"\$SID\" ]"
check "user has only the own-area ACL" "echo '$L' | js \"'shareos.me' in d['acls']['ubus'] and 'shareos.system' not in d['acls']['ubus']\""
check "share-only user cannot log in" "! rpc session login '{\"username\":\"tv\",\"password\":\"tvtvtv\"}' | grep -q ubus_rpc_session"
check "bind with a wrong password fails" "rpc shareos.me bind '{\"username\":\"anna\",\"password\":\"nope\",\"ubus_rpc_session\":\"$SID\"}' | grep -q 'login failed'"
B=$(rpc shareos.me bind "{\"username\":\"anna\",\"password\":\"anna1234\",\"ubus_rpc_session\":\"$SID\"}")
check "bind returns the own account" "echo '$B' | js \"d['name']=='anna' and d['role']=='user' and d['quota']==5000\""
check "me: session is linked" "rpc shareos.me get '{\"ubus_rpc_session\":\"$SID\"}' | js \"d['name']=='anna'\""
check "me: other sessions are not" "rpc shareos.me get '{\"ubus_rpc_session\":\"0123456789abcdef0123456789abcdef\"}' | grep -q 'not bound'"
check "me: password change needs the old one" "rpc shareos.me passwd '{\"old\":\"x\",\"password\":\"neu12345\",\"ubus_rpc_session\":\"$SID\"}' | grep -q wrong"
check "me: password changed" "rpc shareos.me passwd '{\"old\":\"anna1234\",\"password\":\"neu12345\",\"ubus_rpc_session\":\"$SID\"}' | js \"d['ok']\" && rpc session login '{\"username\":\"anna\",\"password\":\"neu12345\"}' | grep -q ubus_rpc_session"
A=$(rpc shareos.accounts list '{}')
check "accounts list" "echo '$A' | js \"[u['name'] for u in d['users']]==['anna','jan','tv'] and d['groups'][0]['members']==['anna','jan'] or d['groups'][0]['members']==['jan','anna']\""
check "rpc: add with an invalid role rejected" "rpc shareos.accounts add '{\"name\":\"max\",\"role\":\"boss\",\"password\":\"geheim1\"}' | grep -q 'invalid role'"
check "rpc: add" "rpc shareos.accounts add '{\"name\":\"max\",\"role\":\"share\",\"password\":\"geheim1\",\"groups\":[\"familie\"]}' | js \"any(u['name']=='max' for u in d['users'])\""
check "rpc: unknown group rejected" "rpc shareos.accounts set '{\"name\":\"max\",\"groups\":[\"nope\"]}' | grep -q 'unknown group'"

# --- shares -------------------------------------------------------------------
S1=$(rpc shareos.shares set '{"name":"fotos","volume":"daten","path":"Fotos","comment":"Familienfotos","smb":true,"rw":["jan"],"ro":["@familie"]}')
check "share created" "echo '$S1' | js \"d['shares'][0]['name']=='fotos' and d['shares'][0]['mounted']\""
aclwait() { local i=0; until run "getfacl -p $1 2>/dev/null" | grep -q "$2" || [ $i -ge 40 ]; do sleep 0.25; i=$((i + 1)); done; }
aclwait /mnt/daten/Fotos 'group:familie:r-x'
check "share folder created (owner root)" "[ \"\$(stat -c '%U' $R/mnt/daten/Fotos)\" = root ] && [ -d $R/mnt/daten/Fotos ]"
check "share folder: rights as ACL (jan rwx, @familie r-x, others nothing)" "run 'getfacl -p /mnt/daten/Fotos' | grep -qx 'user:jan:rwx' && run 'getfacl -p /mnt/daten/Fotos' | grep -qx 'group:familie:r-x' && run 'getfacl -p /mnt/daten/Fotos' | grep -qx 'other::---' && run 'getfacl -p /mnt/daten/Fotos' | grep -qx 'group::---' && run 'getfacl -p /mnt/daten/Fotos' | grep -qx 'default:user:jan:rwx'"
check "ksmbd share section" "grep -q '^\[fotos\]' $R/etc/ksmbd/ksmbd.conf && grep -q 'path = /mnt/daten/Fotos' $R/etc/ksmbd/ksmbd.conf"
check "ksmbd access lists" "grep -q 'valid users = jan @familie' $R/etc/ksmbd/ksmbd.conf && grep -q 'write list = jan' $R/etc/ksmbd/ksmbd.conf && grep -q 'read list = @familie' $R/etc/ksmbd/ksmbd.conf"
check "ksmbd home folders" "grep -q '^\[homes\]' $R/etc/ksmbd/ksmbd.conf"
check "unknown user in a share rejected" "rpc shareos.shares set '{\"name\":\"x\",\"volume\":\"daten\",\"rw\":[\"ghost\"]}' | grep -q 'unknown user'"
check "path escaping the volume rejected" "rpc shareos.shares set '{\"name\":\"x\",\"volume\":\"daten\",\"path\":\"../etc\"}' | grep -q 'invalid folder'"
S2=$(rpc shareos.shares set '{"name":"medien","volume":"daten","smb":true,"guest":true,"nfs":true,"nfs_rw":false,"nfs_hosts":["10.0.0.0/24"]}')
check "guest share" "grep -A8 '^\[medien\]' $R/etc/ksmbd/ksmbd.conf | grep -q 'guest ok = yes'"
check "NFS export" "grep -q '^/mnt/daten/medien 10.0.0.0/24(ro,sync,no_subtree_check,all_squash,anonuid=65534,anongid=100)' $R/etc/exports"
check "user sees own shares" "rpc shareos.me get '{\"ubus_rpc_session\":\"$SID\"}' | js \"sorted((s['name'],s['access']) for s in d['shares'])==[('fotos','ro'),('medien','ro')]\""
check "share removed, folder kept" "rpc shareos.shares del '{\"name\":\"medien\"}' | js \"[s['name'] for s in d['shares']]==['fotos']\" && [ -d $R/mnt/daten/medien ] && ! grep -q medien $R/etc/exports"

# --- file browser, own look ---------------------------------------------------
o=$(run "echo lisa1234 | shareos-users add lisa user --home=daten --files=1")
L2=$(rpc session login '{"username":"lisa","password":"lisa1234"}')
SL=$(echo "$L2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ubus_rpc_session"])' 2>/dev/null)
rpc shareos.me bind "{\"username\":\"lisa\",\"password\":\"lisa1234\",\"ubus_rpc_session\":\"$SL\"}" >/dev/null
fs() { rpc shareos.files "$1" "{\"ubus_rpc_session\":\"$SL\"${2:+,$2}}"; }
check "files: users get the file browser in their ACL" "echo '$L2' | js \"'shareos.files' in d['acls']['ubus'] and 'ticket' in d['acls']['ubus']['shareos.files']\""
check "files: allowed user sees the flag" "rpc shareos.me get '{\"ubus_rpc_session\":\"$SL\"}' | js \"d['files'] and d['ui']=={'theme':None,'accent':None}\""
check "files: user without the right is refused" "rpc shareos.files roots '{\"ubus_rpc_session\":\"$SID\"}' | grep -q 'not allowed'"
check "files: user without shares: the personal folder only" "fs roots '' | js \"d['roots']==[{'name':'home','home':True,'ro':False}]\""
check "files: user cannot pick a volume" "fs list '\"root\":\"daten\",\"path\":\"\"' | grep -q 'unknown folder'"
check "files: mkdir as the user" "fs mkdir '\"root\":\"home\",\"path\":\"\",\"name\":\"Docs\"' | js \"d['ok']\" && [ \"\$(run 'stat -c %U /mnt/daten/home/lisa/Docs')\" = lisa ]"
check "files: .. is rejected" "fs list '\"root\":\"home\",\"path\":\"../jan\"' | grep -q 'invalid path'"
check "files: bad names rejected" "fs mkdir '\"root\":\"home\",\"path\":\"\",\"name\":\"a/b\"' | grep -q 'invalid name'"
ln -s /mnt/daten/home/jan "$R/mnt/daten/home/lisa/esc"
check "files: symlink out of the folder is not followed" "fs list '\"root\":\"home\",\"path\":\"esc\"' | grep -q 'not found'"
rm -f "$R/mnt/daten/home/lisa/esc"
TK=$(fs ticket '"root":"home","path":"Docs","name":"a b.txt","mode":"put"' | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"].split("t=")[1])')
printf 'hallo welt\n' > "$R/tmp/up.txt"
o=$(run "QUERY_STRING=t=$TK REQUEST_METHOD=POST CONTENT_LENGTH=11 /www/cgi-bin/files < /tmp/up.txt")
check "files: upload through the CGI" "echo \"\$o\" | grep -q 'Status: 200' && [ \"\$(cat '$R/mnt/daten/home/lisa/Docs/a b.txt')\" = 'hallo welt' ] && [ \"\$(run 'stat -c %U \"/mnt/daten/home/lisa/Docs/a b.txt\"')\" = lisa ]"
o=$(run "QUERY_STRING=t=$TK REQUEST_METHOD=POST CONTENT_LENGTH=11 /www/cgi-bin/files < /tmp/up.txt")
check "files: a ticket works only once" "echo \"\$o\" | grep -q 'Status: 403'"
check "files: existing file needs overwrite" "fs ticket '\"root\":\"home\",\"path\":\"Docs\",\"name\":\"a b.txt\",\"mode\":\"put\"' | grep -q 'already exists'"
TK=$(fs ticket '"root":"home","path":"Docs","name":"a b.txt","mode":"get"' | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"].split("t=")[1])')
o=$(run "QUERY_STRING=t=$TK REQUEST_METHOD=GET /www/cgi-bin/files")
check "files: download through the CGI" "echo \"\$o\" | grep -q 'Content-Length: 11' && echo \"\$o\" | grep -q \"filename\*=UTF-8''a%20b.txt\" && echo \"\$o\" | grep -q '^hallo welt'"
check "files: list shows the file" "fs list '\"root\":\"home\",\"path\":\"Docs\"' | js \"[(e['name'],e['type'],e['size']) for e in d['entries']]==[('a b.txt','file',11)]\""
check "files: rename" "fs rename '\"root\":\"home\",\"path\":\"Docs\",\"name\":\"a b.txt\",\"to\":\"c.txt\"' | js \"d['ok']\" && [ -f $R/mnt/daten/home/lisa/Docs/c.txt ]"
check "files: copy" "fs move '\"root\":\"home\",\"path\":\"Docs\",\"names\":[\"c.txt\"],\"dest\":\"\",\"copy\":true' | js \"d['ok']\" && [ -f $R/mnt/daten/home/lisa/c.txt ] && [ -f $R/mnt/daten/home/lisa/Docs/c.txt ]"
check "files: folder cannot go into itself" "fs move '\"root\":\"home\",\"path\":\"\",\"names\":[\"Docs\"],\"dest\":\"Docs\"' | grep -q 'into itself'"
# --- trash (on by default): delete moves into <root>/.shareos-trash ---------------
check "files: delete goes into the trash (hidden in the list)" "fs delete '\"root\":\"home\",\"path\":\"\",\"names\":[\"c.txt\",\"Docs\"]' | js \"d['ok'] and d['trash']\" && [ -z \"\$(ls $R/mnt/daten/home/lisa)\" ] && fs list '\"root\":\"home\",\"path\":\"\",\"hidden\":true' | js \"'.shareos-trash' not in [e['name'] for e in d['entries']]\" && [ \"\$(run 'stat -c %U /mnt/daten/home/lisa/.shareos-trash')\" = lisa ]"
TL=$(fs trash_list '"root":"home"')
check "trash: both entries with name, folder and account" "echo '$TL' | js \"d['enabled'] and d['days']==30 and sorted(x['name'] for x in d['items'])==['Docs','c.txt'] and all(x['path']=='' and x['user']=='lisa' for x in d['items']) and [x['size'] for x in d['items'] if x['name']=='c.txt']==[11]\""
ID1=$(echo "$TL" | python3 -c 'import json,sys; print([x["id"] for x in json.load(sys.stdin)["items"] if x["name"]=="Docs"][0])')
ID2=$(echo "$TL" | python3 -c 'import json,sys; print([x["id"] for x in json.load(sys.stdin)["items"] if x["name"]=="c.txt"][0])')
printf 'neu\n' > $R/mnt/daten/home/lisa/c.txt; run 'chown lisa /mnt/daten/home/lisa/c.txt'
check "trash: restore puts it back; a taken name gets (2)" "fs trash_restore '\"root\":\"home\",\"ids\":[\"$ID1\",\"$ID2\"]' | js \"sorted(x['name'] for x in d['restored'])==['Docs','c (2).txt']\" && [ -f $R/mnt/daten/home/lisa/Docs/c.txt ] && [ \"\$(cat $R/mnt/daten/home/lisa/c\ \(2\).txt)\" = 'hallo welt' ] && fs trash_list '\"root\":\"home\"' | js \"d['items']==[]\""
check "trash: permanent delete skips it" "fs delete '\"root\":\"home\",\"path\":\"\",\"names\":[\"c.txt\"],\"permanent\":true' | js \"d['ok'] and not d.get('trash')\" && [ ! -e $R/mnt/daten/home/lisa/c.txt ] && fs trash_list '\"root\":\"home\"' | js \"d['items']==[]\""
fs delete '"root":"home","path":"","names":["c (2).txt","Docs"]' >/dev/null
check "trash: empty one entry, then all" "I=\$(fs trash_list '\"root\":\"home\"' | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"items\"][0][\"id\"])') && fs trash_empty \"\\\"root\\\":\\\"home\\\",\\\"ids\\\":[\\\"\$I\\\"]\" | js \"d['removed']==1\" && fs trash_empty '\"root\":\"home\"' | js \"d['removed']==1\" && [ -z \"\$(ls -A $R/mnt/daten/home/lisa/.shareos-trash)\" ]"
check "trash: invalid ids refused" "fs trash_restore '\"root\":\"home\",\"ids\":[\"../x\"]' | grep -q 'nothing selected' && fs trash_empty '\"root\":\"home\",\"ids\":[\"../../etc\"]' | grep -q 'invalid entry'"
# an entry older than the configured days goes when the trash is used next
run 'su -s /bin/sh lisa -c "echo alt > /mnt/daten/home/lisa/.shareos-trash/1000-aaaaaaaa"'
printf '{"name":"alt.txt","path":"","time":1000,"user":"lisa","type":"file","size":4}' > $R/mnt/daten/home/lisa/.shareos-trash/1000-aaaaaaaa.json
check "trash: entries older than 30 days are purged" "fs trash_list '\"root\":\"home\"' | js \"d['items']==[]\" && [ ! -e $R/mnt/daten/home/lisa/.shareos-trash/1000-aaaaaaaa ]"
check "trash: settings only for admins" "fs trash_config '\"enabled\":false,\"days\":7' | grep -q 'not allowed'"
# --- "Teilen mit" of the installed app: into <personal folder>/Geteilt ---------
st() { rpc shareos.me share_ticket "{\"ubus_rpc_session\":\"${2:-$SL}\",\"name\":\"$1\"}"; }
S1=$(st 'Foto 1.jpg')
TK=$(echo "$S1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"].split("t=")[1])')
o=$(run "QUERY_STRING=t=$TK REQUEST_METHOD=POST CONTENT_LENGTH=11 /www/cgi-bin/files < /tmp/up.txt")
check "share: ticket into Geteilt, folder made for the user (0700), upload" "echo '$S1' | js \"d['name']=='Foto 1.jpg' and d['folder']=='Geteilt'\" && echo \"\$o\" | grep -q 'Status: 200' && [ \"\$(cat '$R/mnt/daten/home/lisa/Geteilt/Foto 1.jpg')\" = 'hallo welt' ] && [ \"\$(run 'stat -c %U:%a /mnt/daten/home/lisa/Geteilt')\" = lisa:700 ]"
check "share: a taken name gets a number, nothing is replaced" "st 'Foto 1.jpg' | js \"d['name']=='Foto 1 (2).jpg'\" && st 'notiz' | js \"d['name']=='notiz'\""
check "share: bad names rejected" "st 'a/b' | grep -q 'invalid name' && st '.profile' | grep -q 'invalid name'"
check "share: account without a personal folder is refused" "st 'x.txt' '$SID' | grep -q 'no personal folder'"
check "me: drives of the personal folder with free space" "rpc shareos.me get '{\"ubus_rpc_session\":\"$SL\"}' | js \"[v['name'] for v in d['volumes']]==['daten'] and d['volumes'][0]['avail']>0 and d['volumes'][0]['size']>=d['volumes'][0]['used']\""
rm -rf "$R/mnt/daten/home/lisa/Geteilt"
LJ=$(rpc session login '{"username":"jan","password":"geheim1"}')
SJ=$(echo "$LJ" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ubus_rpc_session"])' 2>/dev/null)
rpc shareos.me bind "{\"username\":\"jan\",\"password\":\"geheim1\",\"ubus_rpc_session\":\"$SJ\"}" >/dev/null
check "files: admins see whole volumes" "rpc shareos.files list '{\"ubus_rpc_session\":\"$SJ\",\"root\":\"daten\",\"path\":\"\"}' | js \"'home' in [e['name'] for e in d['entries']] and d['free']>0\""
check "trash: admin switches it off, then delete is direct" "rpc shareos.files trash_config '{\"ubus_rpc_session\":\"$SJ\",\"enabled\":false,\"days\":7}' | js \"d=={'enabled':False,'days':7}\" && run 'uci get shareos.files.trash' | grep -qx 0 && printf x > $R/mnt/daten/home/lisa/off.txt && fs delete '\"root\":\"home\",\"path\":\"\",\"names\":[\"off.txt\"]' | js \"d['ok'] and not d.get('trash')\" && [ ! -e $R/mnt/daten/home/lisa/off.txt ] && rpc shareos.files roots '{\"ubus_rpc_session\":\"$SL\"}' | js \"d['trash']['enabled']==False\""
check "trash: invalid settings refused, on again" "rpc shareos.files trash_config '{\"ubus_rpc_session\":\"$SJ\",\"enabled\":true,\"days\":999}' | grep -q 'invalid value' && rpc shareos.files trash_config '{\"ubus_rpc_session\":\"$SJ\",\"enabled\":true,\"days\":30}' | js \"d['enabled']\""
# --- shares in the file browser and in apps: by rights, enforced by Linux too ---
run "shareos-users set anna --files=1" >/dev/null
fa() { rpc shareos.files "$1" "{\"ubus_rpc_session\":\"$SID\"${2:+,$2}}"; }
check "shares: anna (no personal folder) sees fotos read-only" "fa roots '' | js \"d['roots']==[{'name':'fotos','home':False,'ro':True}]\""
printf 'bild\n' > $R/mnt/daten/Fotos/urlaub.txt; run 'chown jan /mnt/daten/Fotos/urlaub.txt'
run 'shareos-shares apply' >/dev/null; sleep 1
check "shares: anna lists fotos" "fa list '\"root\":\"fotos\",\"path\":\"\"' | js \"'urlaub.txt' in [e['name'] for e in d['entries']]\""
check "shares: read-only refuses mkdir, rename, delete, upload" "fa mkdir '\"root\":\"fotos\",\"path\":\"\",\"name\":\"neu\"' | grep -q 'read only' && fa rename '\"root\":\"fotos\",\"path\":\"\",\"name\":\"urlaub.txt\",\"to\":\"x.txt\"' | grep -q 'read only' && fa delete '\"root\":\"fotos\",\"path\":\"\",\"names\":[\"urlaub.txt\"]' | grep -q 'read only' && fa ticket '\"root\":\"fotos\",\"path\":\"\",\"name\":\"up.txt\",\"mode\":\"put\"' | grep -q 'read only'"
check "shares: read-only allows download" "fa ticket '\"root\":\"fotos\",\"path\":\"\",\"name\":\"urlaub.txt\",\"mode\":\"get\"' | grep -q url"
check "Linux: anna can read but not write in fotos" "run 'su -s /bin/sh anna -c \"cat /mnt/daten/Fotos/urlaub.txt\"' | grep -qx bild && ! run 'su -s /bin/sh anna -c \"touch /mnt/daten/Fotos/hack\"' >/dev/null && [ ! -e $R/mnt/daten/Fotos/hack ]"
check "Linux: lisa (no rights) cannot even list fotos" "! run 'su -s /bin/sh lisa -c \"ls /mnt/daten/Fotos\"' >/dev/null"
check "shares: lisa does not see fotos" "! fs roots '' | grep -q fotos"
rpc shareos.shares set '{"name":"fotos","volume":"daten","path":"Fotos","comment":"Familienfotos","smb":true,"rw":["jan","lisa"],"ro":["@familie"]}' >/dev/null
aclwait /mnt/daten/Fotos/urlaub.txt 'user:lisa:rw-'
check "shares: lisa with write rights sees fotos writable" "fs roots '' | js \"{'name':'fotos','home':False,'ro':False} in d['roots']\""
check "shares: lisa creates a folder, owned by her" "fs mkdir '\"root\":\"fotos\",\"path\":\"\",\"name\":\"Neu\"' | js \"d['ok']\" && [ \"\$(run 'stat -c %U /mnt/daten/Fotos/Neu')\" = lisa ]"
check "Linux: the new folder inherits the rights (anna reads, cannot write)" "run 'getfacl -p /mnt/daten/Fotos/Neu' | grep -qx 'group:familie:r-x' && run 'su -s /bin/sh anna -c \"ls /mnt/daten/Fotos/Neu\"' >/dev/null && ! run 'su -s /bin/sh anna -c \"touch /mnt/daten/Fotos/Neu/x\"' >/dev/null"
check "Linux: existing files got the new right" "run 'su -s /bin/sh lisa -c \"echo mehr >> /mnt/daten/Fotos/urlaub.txt\"' >/dev/null && grep -qx mehr $R/mnt/daten/Fotos/urlaub.txt"
rpc shareos.shares set '{"name":"fotos","volume":"daten","path":"Fotos","comment":"Familienfotos","smb":true,"rw":["jan"],"ro":["@familie"]}' >/dev/null
aclwait /mnt/daten/Fotos/Neu 'group:familie:r-x'; sleep 1
check "Linux: a right taken away is gone everywhere" "! run 'getfacl -p -R /mnt/daten/Fotos' | grep -q 'user:lisa' && ! run 'su -s /bin/sh lisa -c \"ls /mnt/daten/Fotos\"' >/dev/null"
check "files: right can be withdrawn" "run 'shareos-users set lisa --files=0' >/dev/null; fs roots '' | grep -q 'not allowed'"
check "look: own theme and accent" "rpc shareos.me ui_set '{\"ubus_rpc_session\":\"$SL\",\"theme\":\"light\",\"accent\":\"green\"}' | js \"d=={'theme':'light','accent':'green'}\" && rpc shareos.me get '{\"ubus_rpc_session\":\"$SL\"}' | js \"d['ui']['theme']=='light'\""
check "look: invalid accent rejected" "rpc shareos.me ui_set '{\"ubus_rpc_session\":\"$SL\",\"accent\":\"pink\"}' | grep -q 'invalid accent'"
check "look: back to the look for everyone" "rpc shareos.me ui_set '{\"ubus_rpc_session\":\"$SL\",\"theme\":\"\",\"accent\":\"\"}' | js \"d=={'theme':None,'accent':None}\""
check "fav: none at first, bar on" "rpc shareos.me get '{\"ubus_rpc_session\":\"$SL\"}' | js \"d['fav']=={'apps':[],'bar':True,'text':True}\""
check "fav: own favourites (doubles dropped) and bar off" "rpc shareos.me fav_set '{\"ubus_rpc_session\":\"$SL\",\"apps\":[\"notes\",\"webpad\",\"notes\"],\"bar\":false,\"text\":false}' | js \"d=={'apps':['notes','webpad'],'bar':False,'text':False}\" && rpc shareos.me get '{\"ubus_rpc_session\":\"$SL\"}' | js \"d['fav']['apps']==['notes','webpad'] and not d['fav']['bar']\""
check "fav: a missing key stays" "rpc shareos.me fav_set '{\"ubus_rpc_session\":\"$SL\",\"bar\":true}' | js \"d=={'apps':['notes','webpad'],'bar':True,'text':False}\""
check "fav: invalid app id rejected" "rpc shareos.me fav_set '{\"ubus_rpc_session\":\"$SL\",\"apps\":[\"../x\"]}' | grep -q 'invalid app id'"
RS=fedcba9876543210fedcba9876543210; mkdir -p $R/tmp/shareos-sessions; echo root > $R/tmp/shareos-sessions/$RS
check "fav: root keeps its own (in shareos.ui)" "rpc shareos.me fav_set '{\"ubus_rpc_session\":\"$RS\",\"apps\":[\"webpad\"]}' | js \"d=={'apps':['webpad'],'bar':True,'text':True}\" && run 'uci -q get shareos.ui.fav' | grep -qx webpad && rpc shareos.me get '{\"ubus_rpc_session\":\"$SL\"}' | js \"d['fav']['apps']==['notes','webpad']\""
check "files: root gets home/root as its personal folder first (apps keep files there)" "rpc shareos.files roots '{\"ubus_rpc_session\":\"$RS\"}' | js \"d['roots'][0]=={'name':'home','home':True,'ro':False} and any(r['name']=='daten' for r in d['roots'])\" && [ \"\$(run 'stat -c %a:%U /mnt/daten/home/root')\" = 700:root ]"
rm -f $R/tmp/shareos-sessions/$RS
run "shareos-users del lisa" >/dev/null

# --- delete, Alt-F import -----------------------------------------------------
check "rpc: delete" "rpc shareos.accounts del '{\"name\":\"tv\"}' | js \"all(u['name']!='tv' for u in d['users'])\" && ! grep -q '^tv:' $R/etc/passwd $R/etc/shadow"
mkdir -p $R/etc/shareos/altf/samba
printf 'root:x:0:0:root:/root:/bin/sh\nmaria:x:1001:100:Maria,,,:/home/maria:/bin/sh\nBad.Name:x:1002:100::/:/bin/sh\n' > $R/etc/shareos/altf/passwd
printf 'maria:$1$abcdefgh$0123456789abcdefghijk.:19000:0:99999:7:::\n' > $R/etc/shareos/altf/shadow
printf 'users:x:100:\nmusik:x:1005:maria\n' > $R/etc/shareos/altf/group
printf 'maria:1001:AAD3B435B51404EEAAD3B435B51404EE:8846F7EAEE8FB117AD06BDD830B7586C:[U          ]:LCT-00000000:\n' > $R/etc/shareos/altf/samba/smbpasswd
I=$(rpc shareos.accounts import_altf '{}')
check "Alt-F: users imported, bad names skipped" "echo '$I' | js \"d['imported']==['maria'] and 'Bad.Name' in d['skipped']\""
check "Alt-F: group and membership" "grep -q '^musik:x:[0-9]*:maria\$' $R/etc/group"
check "Alt-F: Linux password hash kept" "grep -q '^maria:\\\$1\\\$abcdefgh\\\$0123456789abcdefghijk\\.:' $R/etc/shadow"
check "Alt-F: SMB hash kept" "grep -qx 'maria:iEb36u6PsRetBr3YMLdYbA==' $R/etc/ksmbd/ksmbdpwd.db"

# --- settings backup ------------------------------------------------------------
E1=$(rpc shareos.backup export '{}')
echo "$E1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["content"])' > $T/plain.json
check "backup: plain JSON with accounts and shares" "python3 -c \"import json; d=json.load(open('$T/plain.json')); assert d['shareos_backup']==1 and any(l.startswith('jan:') for l in d['accounts']['passwd']) and 'fotos' in d['configs']['shares']\""
check "backup: short password rejected" "rpc shareos.backup export '{\"password\":\"abc\"}' | grep -q '6 characters'"
E2=$(rpc shareos.backup export '{"password":"backup-pw"}')
echo "$E2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["content"])' > $T/enc.json
check "backup: encrypted file hides the content" "python3 -c \"import json; d=json.load(open('$T/enc.json')); assert d['encrypted'] and 'accounts' not in d\" && ! grep -q jan $T/enc.json"
cat > $T/req.py <<'PY'
import json, sys
c = open(sys.argv[1]).read()
print(json.dumps({"content": c, "password": sys.argv[2], "apply": sys.argv[3] == "1"}))
PY
python3 $T/req.py $T/enc.json nope 0 > $R/tmp/req-wrong.json
check "restore: wrong password" "run 'ubus call shareos.backup restore \"\$(cat /tmp/req-wrong.json)\"' | grep -q 'wrong password'"
python3 $T/req.py $T/enc.json backup-pw 0 > $R/tmp/req-preview.json
python3 $T/req.py $T/enc.json backup-pw 1 > $R/tmp/req-apply.json
P=$(run 'ubus call shareos.backup restore "$(cat /tmp/req-preview.json)"')
check "restore: preview of the encrypted backup" "echo '$P' | js \"d['preview'] and 'jan' in d['users'] and 'fotos' in d['shares']\""
run "shareos-users del max" >/dev/null; run "uci delete shares.fotos; uci commit shares" >/dev/null
check "restore: (max and the share are gone now)" "! grep -q '^max:' $R/etc/passwd && ! run 'uci -q get shares.fotos' | grep -q share"
A2=$(run 'ubus call shareos.backup restore "$(cat /tmp/req-apply.json)"')
check "restore: applied" "echo '$A2' | js \"d['ok']\" && grep -q '^max:' $R/etc/passwd && grep -q '^max:' $R/etc/shadow && run 'uci get shares.fotos' | grep -qx share"
check "restore: web logins rebuilt" "run 'uci get rpcd.acc_jan.read' | grep -qx '\*'"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
