#!/bin/sh
# Disk change wizard: shareos-migrate (plan, copy, cancel, resume, switch) on
# the host with two folders as drives.
#   tests/test-migrate.sh <uci binary>
# Needs rsync; ACLs are checked when setfacl works on the temp folder. With
# the host ucode next to uci (<dir>/ucode, <dir>/../lib/ucode) the switch also
# moves the paths of Transmission and Syncthing (relocate).
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
for s in S50crond S51apps S52tremote S70shares S90services; do
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
config job 'homes'
	option source 'homes:old'
	option target 'other'
config job 'whole'
	option source 'volume:old'
	option target 'other'
config job 'music'
	option source 'share:music'
	option target 'other'
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
# what Transmission and Syncthing keep: absolute paths on the old drive
TS=$R/mnt/old/.shareos/transmission/root
mkdir -p "$TS/resume" "$R/mnt/old/home/jan/.config/syncthing" "$R/mnt/old/home/jan/.config/transmission-daemon"
printf '{"download-dir": "/mnt/old/Downloads", "watch-dir": "/mnt/other/w"}\n' > "$TS/settings.json"
printf 'd11:destination18:/mnt/old/Downloads4:name1:x6:piecesi5ee' > "$TS/resume/a.resume"
echo /mnt/old/home/jan/watch > "$R/mnt/old/home/jan/.config/transmission-daemon/.shareos-watch"
printf '<folder id="a" path="/mnt/old/home/jan/Sync"></folder>\n' > "$R/mnt/old/home/jan/.config/syncthing/config.xml"
UC=$(dirname "$UCI")/ucode RELOC=0
if [ -x "$UC" ]; then
	RELOC=1
	for t in transmission syncthing; do
		printf '#!/bin/sh\nexec %s -L %s -S %s "$@"\n' "$UC" "$(dirname "$(dirname "$UCI")")/lib/ucode" "$TOP/src/shareos-core/usr/sbin/shareos-$t" > "$T/bin/shareos-$t"
		chmod +x "$T/bin/shareos-$t"
	done
fi
ACL=0; setfacl -m u:12345:rx "$R/mnt/old/Photos" 2>/dev/null && ACL=1

m() { env PATH="$T/bin:$PATH" SHAREOS_ROOT="$R" SHAREOS_MIGRATE_TEST=1 SHAREOS_MIGRATE_POLL=0.2 SHAREOS_MIGRATE_SBIN="$T/bin" "$@"; }
mig() { m sh "$MIG" "$@"; }
wait_state() {   # <state> – up to 20 s
	i=0; while [ $i -lt 100 ]; do mig state | js "d['state']=='$1'" && return 0; sleep 0.2; i=$((i + 1)); done; return 1
}

# --- plan --------------------------------------------------------------------
P=$(mig plan old new)
check "plan: shares, personal folders, app area and snapshot jobs of the old drive (target or source)" "echo '$P' | js \"d['ok'] and d['shares']==['photos'] and d['homes']==['jan'] and d['apps'] and sorted(d['snapshot_jobs'])==['daily','homes','whole'] and d['used']>0\""
head -c 2000000 /dev/urandom > "$R/mnt/old/Snapshots/daily/big"
check "plan: the snapshots do not count as data to copy" "mig plan old new | js \"d['used'] < 1000000\""
rm "$R/mnt/old/Snapshots/daily/big"
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
check "a state call right after the start (no PID file yet) does not take the copy for stopped" "cp $R/tmp/shareos-migrate/pid $T/pid.keep && rm $R/tmp/shareos-migrate/pid && mig state | js \"d['state']=='copying'\"; mv $T/pid.keep $R/tmp/shareos-migrate/pid"
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
# something that writes to the drives keeps the switch from starting
mkdir -p "$R/tmp/shareos-cloud"; sleep 30 & W=$!; echo $W > "$R/tmp/shareos-cloud/job1.pid"
check "busy: a running cloud job is reported" "mig busy | js \"d['busy'] and 'cloud job' in d['problem']\""
check "switch: refused while a cloud job runs, nothing changed" "mig switch | grep -q 'wait until it is done' && mig state | js \"d['state']=='copied' and 'wait until' in d['error']\" && [ \"\$($UCI -c $R/etc/config get shares.photos.volume)\" = old ]"
kill $W 2>/dev/null; wait $W 2>/dev/null
check "busy: nothing runs any more" "mig busy | js \"not d['busy']\""
: > "$T/calls"
check "switch" "mig switch | js \"d['ok']\" && mig state | js \"d['state']=='done'\""
check "switch: what changed since the copy is there, what was deleted is gone" "[ -f $R/mnt/new/Photos/after.jpg ] && [ ! -e $R/mnt/new/home/jan/doc.txt ] && [ ! -e $R/mnt/new/partial ] && [ ! -e $R/mnt/new/.shareos-migrate-from ]"
g() { "$UCI" -c "$R/etc/config" get "$1"; }
check "switch: shares, personal folders, app area, USB copy and snapshot jobs point to the new drive" "[ \"\$(g shares.photos.volume) \$(g accounts.jan.home) \$(g storage.global.apps) \$(g shareos.usbcopy.volume) \$(g snapshots.daily.target)\" = 'new new new new new' ]"
check "switch: snapshot jobs that save personal folders or the whole drive save the new one" "[ \"\$(g snapshots.homes.source) \$(g snapshots.whole.source) \$(g snapshots.music.source) \$(g snapshots.homes.target)\" = 'homes:new volume:new share:music other' ]"
check "switch: the old drive is marked as moved" "[ \"\$(g storage.old.moved_to)\" = new ] && ! $UCI -c $R/etc/config -q get storage.new.moved_to"
if [ $RELOC = 1 ]; then
	NT=$R/mnt/new/.shareos/transmission/root
	check "switch: Transmission's download folder and torrents name the new drive" "grep -q '\"/mnt/new/Downloads\"' $NT/settings.json && grep -q '/mnt/other/w' $NT/settings.json && [ \"\$(cat $NT/resume/a.resume)\" = 'd11:destination18:/mnt/new/Downloads4:name1:x6:piecesi5ee' ] && [ \"\$(cat $R/mnt/new/home/jan/.config/transmission-daemon/.shareos-watch)\" = /mnt/new/home/jan/watch ]"
	check "switch: Syncthing's folders name the new drive" "grep -q 'path=\"/mnt/new/home/jan/Sync\"' $R/mnt/new/home/jan/.config/syncthing/config.xml"
	check "the old drive's files of Transmission and Syncthing are not changed" "grep -q '/mnt/old/Downloads' $TS/settings.json && grep -q '/mnt/old/home/jan/Sync' $R/mnt/old/home/jan/.config/syncthing/config.xml"
fi
check "switch: other drives stay as they are" "[ \"\$(g shares.music.volume) \$(g accounts.anna.home)\" = 'other other' ] && ! $UCI -c $R/etc/config -q get accounts.tv.home"
check "switch: services and cron stopped before and started after" "[ \"\$(tr '\\n' ' ' < $T/calls)\" = 'S50crond stop S90services stop S52tremote stop S51apps stop S70shares stop S70shares start S51apps start S52tremote start S90services start S50crond start ' ]"
check "the old drive is not changed" "[ -f $R/mnt/old/Photos/2026/a.jpg ] && [ -f $R/mnt/old/Snapshots/daily/s ] && [ -f $R/mnt/old/.shareos/apps/x ]"
# a switch whose process died: the state does not stay "switching"
mkdir -p "$R/tmp/shareos-migrate"; printf 'state=switching\nfrom=old\nto=new\n' > "$R/tmp/shareos-migrate/state.x"
cp "$R/tmp/shareos-migrate/state" "$T/state.keep"; mv "$R/tmp/shareos-migrate/state.x" "$R/tmp/shareos-migrate/state"
sh -c 'exit 0' & D=$!; wait $D; echo $D > "$R/tmp/shareos-migrate/switch.pid"
check "a switch that died is reported, it can be started again" "mig state | js \"d['state']=='copied' and 'stopped before' in d['error']\""
cp "$T/state.keep" "$R/tmp/shareos-migrate/state"
check "clear forgets the job" "mig clear | js \"d['ok']\" && mig state | js \"d['state']=='none'\""

rm -rf "$T"
echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
