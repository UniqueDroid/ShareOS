#!/bin/sh
# Disk change wizard: shareos-migrate (plan, copy, cancel, resume, switch) on
# the host with two folders as drives.
#   tests/test-migrate.sh <uci binary>
# Needs rsync; ACLs are checked when setfacl works on the temp folder.
set -u
TOP=$(cd "$(dirname "$0")/.." && pwd)
MIG=$TOP/src/shareos-core/usr/sbin/shareos-migrate
UCI=${1:?usage: test-migrate.sh <uci binary>}
T=$(mktemp -d /tmp/shareos-migrate-test.XXXX)
R=$T/root
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass + 1)); else echo "FAIL  $1"; failed=$((failed + 1)); fi; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }

mkdir -p "$T/bin" "$R/etc/config" "$R/etc/init.d" "$R/mnt/old/lost+found" "$R/mnt/new/lost+found" "$R/mnt/other"
ln -s "$UCI" "$T/bin/uci"
printf '#!/bin/sh\n' > "$T/bin/logger"; chmod +x "$T/bin/logger"
for s in S51apps S52tremote S70shares S90services; do
	printf '#!/bin/sh\necho "%s $1" >> %s/calls\n' "$s" "$T" > "$R/etc/init.d/$s"; chmod +x "$R/etc/init.d/$s"
done
cat > "$R/etc/config/storage" <<'EOF'
config global 'global'
	option apps 'old'
config volume 'old'
config volume 'new'
config volume 'other'
EOF
cat > "$R/etc/config/shares" <<'EOF'
config share 'photos'
	option volume 'old'
	option path 'Photos'
config share 'music'
	option volume 'other'
	option path 'Music'
EOF
cat > "$R/etc/config/accounts" <<'EOF'
config user 'jan'
	option home 'old'
config user 'anna'
	option home 'other'
config user 'tv'
EOF
cat > "$R/etc/config/snapshots" <<'EOF'
config job 'daily'
	option target 'old'
EOF
cat > "$R/etc/config/shareos" <<'EOF'
config usbcopy 'usbcopy'
	option volume 'old'
EOF
mkdir -p "$R/mnt/old/Photos/2026" "$R/mnt/old/home/jan" "$R/mnt/old/.shareos/apps" "$R/mnt/old/Snapshots/daily" "$R/mnt/old/Not shared"
echo pic > "$R/mnt/old/Photos/2026/a.jpg"; echo doc > "$R/mnt/old/home/jan/doc.txt"
echo app > "$R/mnt/old/.shareos/apps/x"; echo snap > "$R/mnt/old/Snapshots/daily/s"; echo lost > "$R/mnt/old/lost+found/l"
echo keep > "$R/mnt/old/Not shared/k"; ln "$R/mnt/old/Photos/2026/a.jpg" "$R/mnt/old/Photos/hardlink.jpg"
chmod 700 "$R/mnt/old/home/jan"
ACL=0; setfacl -m u:12345:rx "$R/mnt/old/Photos" 2>/dev/null && ACL=1

m() { env PATH="$T/bin:$PATH" SHAREOS_ROOT="$R" SHAREOS_MIGRATE_TEST=1 SHAREOS_MIGRATE_POLL=0.2 "$@"; }
mig() { m sh "$MIG" "$@"; }
wait_state() {   # <state> – up to 20 s
	i=0; while [ $i -lt 100 ]; do mig state | js "d['state']=='$1'" && return 0; sleep 0.2; i=$((i + 1)); done; return 1
}

# --- plan --------------------------------------------------------------------
P=$(mig plan old new)
check "plan: shares, personal folders, app area and snapshot jobs of the old drive" "echo '$P' | js \"d['ok'] and d['shares']==['photos'] and d['homes']==['jan'] and d['apps'] and d['snapshot_jobs']==['daily'] and d['used']>0\""
check "plan: the same drive is refused" "mig plan old old | js \"not d['ok'] and 'same' in d['problem']\""
check "plan: an unknown drive is refused" "mig plan old nope | js \"not d['ok'] and 'unknown' in d['problem']\""
check "plan: a drive that is not mounted is refused" "mig plan old gone 2>/dev/null | js \"not d['ok']\""
echo x > "$R/mnt/other/x"
check "plan: a target that holds data is refused" "mig plan old other | js \"not d['ok'] and 'not empty' in d['problem']\""
check "plan: FAT/exFAT/NTFS as target is refused" "SHAREOS_MIGRATE_FS=exfat mig plan old new | js \"not d['ok'] and 'ext4' in d['problem']\""
check "plan: not enough free space is refused" "SHAREOS_MIGRATE_FREE=10 mig plan old new | js \"not d['ok'] and 'space' in d['problem']\""
check "switch without a copy is refused" "mig switch | grep -q 'copy everything first'"

# --- copy, cancel, resume ------------------------------------------------------
# an rsync that hangs: the copy can be cancelled, and nothing keeps running
mkdir -p "$T/slow"; printf '#!/bin/sh\nsleep 60\n' > "$T/slow/rsync"; chmod +x "$T/slow/rsync"
check "copy starts in the background" "env PATH=$T/slow:$T/bin:\$PATH SHAREOS_ROOT=$R SHAREOS_MIGRATE_TEST=1 SHAREOS_MIGRATE_POLL=0.2 sh $MIG copy old new | js \"d['ok']\""
sleep 0.5
check "state: copying" "mig state | js \"d['state']=='copying' and d['from']=='old' and d['to']=='new' and d['total']>0\""
check "a second copy while one runs is refused" "mig copy old new | grep -q 'already running'"
check "cancel stops the copy and its rsync" "mig cancel | js \"d['ok']\" && sleep 0.5 && mig state | js \"d['state']=='cancelled'\" && ! pgrep -f '$T/slow/rsync' >/dev/null"
echo partial > "$R/mnt/new/partial"
check "the new drive notes where its data comes from" "[ \"\$(cat $R/mnt/new/.shareos-migrate-from)\" = old ]"
check "after a restart the plan allows going on into the same drive" "rm -rf $R/tmp/shareos-migrate && mig plan old new | js \"d['ok']\""
check "after a restart (no state any more) a stopped copy still goes on into the same drive" "rm -rf $R/tmp/shareos-migrate && mig copy old new | js \"d['ok']\" && wait_state copied"
check "another drive with data is still refused as target" "mig plan other new | js \"not d['ok'] and 'not empty' in d['problem']\""
check "copied: shares, personal folders, app area, folders that are not shared" "cmp -s $R/mnt/old/Photos/2026/a.jpg $R/mnt/new/Photos/2026/a.jpg && [ -f $R/mnt/new/home/jan/doc.txt ] && [ -f $R/mnt/new/.shareos/apps/x ] && [ -f '$R/mnt/new/Not shared/k' ]"
check "not copied: lost+found and Snapshots" "[ ! -e $R/mnt/new/Snapshots ] && [ ! -e $R/mnt/new/lost+found/l ]"
check "rights and hard links are kept" "[ \"\$(stat -c %a $R/mnt/new/home/jan)\" = 700 ] && [ \"\$(stat -c %i $R/mnt/new/Photos/hardlink.jpg)\" = \"\$(stat -c %i $R/mnt/new/Photos/2026/a.jpg)\" ]"
[ $ACL = 1 ] && check "ACLs are kept" "getfacl -n $R/mnt/new/Photos 2>/dev/null | grep -q 'user:12345:r-x'"
check "state: copied, 100 %" "mig state | js \"d['state']=='copied' and d['percent']==100\""
check "nothing was switched yet" "[ \"\$($UCI -c $R/etc/config get shares.photos.volume)\" = old ]"

# --- switch --------------------------------------------------------------------
echo new > "$R/mnt/old/Photos/after.jpg"; rm "$R/mnt/old/home/jan/doc.txt"
: > "$T/calls"
check "switch" "mig switch | js \"d['ok']\" && mig state | js \"d['state']=='done'\""
check "switch: what changed since the copy is there, what was deleted is gone" "[ -f $R/mnt/new/Photos/after.jpg ] && [ ! -e $R/mnt/new/home/jan/doc.txt ] && [ ! -e $R/mnt/new/partial ] && [ ! -e $R/mnt/new/.shareos-migrate-from ]"
g() { "$UCI" -c "$R/etc/config" get "$1"; }
check "switch: shares, personal folders, app area, USB copy and snapshot jobs point to the new drive" "[ \"\$(g shares.photos.volume) \$(g accounts.jan.home) \$(g storage.global.apps) \$(g shareos.usbcopy.volume) \$(g snapshots.daily.target)\" = 'new new new new new' ]"
check "switch: other drives stay as they are" "[ \"\$(g shares.music.volume) \$(g accounts.anna.home)\" = 'other other' ] && ! $UCI -c $R/etc/config -q get accounts.tv.home"
check "switch: services stopped before and started after" "[ \"\$(tr '\\n' ' ' < $T/calls)\" = 'S90services stop S52tremote stop S51apps stop S70shares stop S70shares start S51apps start S52tremote start S90services start ' ]"
check "the old drive is not changed" "[ -f $R/mnt/old/Photos/2026/a.jpg ] && [ -f $R/mnt/old/Snapshots/daily/s ] && [ -f $R/mnt/old/.shareos/apps/x ]"
check "clear forgets the job" "mig clear | js \"d['ok']\" && mig state | js \"d['state']=='none'\""

rm -rf "$T"
echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
