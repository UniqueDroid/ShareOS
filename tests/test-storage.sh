#!/bin/bash
#
# Tests shareos-storage and the shareos.storage rpcd methods with the built
# ARM userland (qemu-user) on loop devices of the build host.
#
#   sudo tests/test-storage.sh [output/dns320l]
#
# Covers the "single" layout, re-setup of a used disk, mount/umount/forget,
# shutdown/boot and the status call. The mirror layout needs the md driver
# in the host kernel and is skipped when /proc/mdstat is missing.
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

T=$(mktemp -d /tmp/shareos-storage-test.XXXX)
R=$T/root
LOOPS=
WATCH=
cleanup() {
	[ -n "$WATCH" ] && kill $WATCH 2>/dev/null
	# swap was switched on inside the chroot; switch it off there (the host sees other paths)
	[ -d "$R/proc/self" ] && chroot "$R" /bin/sh -c 'for s in $(awk "NR>1 && /loop/ {print \$1}" /proc/swaps); do swapoff $s; done' 2>/dev/null
	for m in $(grep " $R/" /proc/mounts | awk '{print $2}' | sort -r); do umount -l "$m" 2>/dev/null; done
	for l in $LOOPS; do losetup -d "$l" 2>/dev/null; done
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
mkdir -p "$R/var/run/ubus"

for i in 1 2 3; do
	truncate -s 300M "$T/disk$i.img"
	l=$(losetup -fP --show "$T/disk$i.img") || { echo "losetup failed"; exit 1; }
	LOOPS="$LOOPS $l"
done
set -- $LOOPS
A=${1#/dev/} B=${2#/dev/} C=${3#/dev/}
# qemu-user does not pass BLKRRPART on to the kernel, so the partitions sfdisk
# writes inside the chroot would never show up; re-read them from the host
( while :; do for l in $LOOPS; do partx -u "$l" 2>/dev/null; done; sleep 0.3; done ) &
WATCH=$!
echo "test disks: $A $B"

run() { chroot "$R" /usr/bin/env SHAREOS_STORAGE_DISKS='loop[0-9]+' /bin/sh -c "$*" 2>&1; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
mounted() { grep -q " $R/mnt/$1 " /proc/mounts; }
swapping() { run cat /proc/swaps | grep -q "^/dev/$1 "; }

o=$(run shareos-storage setup single foo=$A)
check "setup refuses without --yes" "echo \"\$o\" | grep -q 'add --yes'"
o=$(run shareos-storage setup single "BAD=$A" --yes)
check "invalid name rejected" "run shareos-storage job | grep -q 'state=error'"
o=$(run shareos-storage setup single "x=sdz" --yes)
check "unknown disk rejected" "run shareos-storage job | grep -q \"invalid disk\""

o=$(run shareos-storage setup single "daten=$A" "backup=$B" --swap=64 --yes); echo "$o" | sed 's/^/      /'
check "single setup of two disks finished" "run shareos-storage job | grep -q 'state=done'"
check "swap partitions created and active" "swapping ${A}p1 && swapping ${B}p1"
check "app area on the first volume" "run uci get storage.global.apps | grep -qx daten && [ -d $R/mnt/daten/.shareos ]"
check "both volumes mounted" "mounted daten && mounted backup"
check "volumes in UCI with uuid" "run uci get storage.daten.uuid | grep -qE '^[0-9a-f-]{36}$' && run uci get storage.backup.layout | grep -qx single"
check "ext4 label set on the data partition" "run blkid -s LABEL -o value /dev/${A}p2 | grep -qx daten"
echo hello > "$R/mnt/daten/file"

o=$(run shareos-storage umount daten)
check "umount" "! mounted daten && run uci get storage.daten.enabled | grep -qx 0"
o=$(run shareos-storage mount daten)
check "mount again, data still there" "mounted daten && grep -qx hello $R/mnt/daten/file"

run shareos-storage shutdown >/dev/null
check "shutdown unmounts all and stops swap" "! mounted daten && ! mounted backup && ! swapping ${A}p1"
run shareos-storage boot >/dev/null
check "boot mounts enabled volumes and swap" "mounted daten && mounted backup && swapping ${A}p1"

o=$(run shareos-storage setup single "neu=$B" --swap=0 --yes)
check "re-setup of a used disk releases the old volume (no swap now)" "run shareos-storage job | grep -q 'state=done' && ! run uci -q get storage.backup >/dev/null && mounted neu && ! mounted backup && ! swapping ${B}p1"

o=$(run shareos-storage forget neu)
check "forget removes from config" "! run uci -q get storage.neu >/dev/null && ! mounted neu"
o=$(run shareos-storage spindown 30)
check "spindown stored" "run uci get storage.global.spindown | grep -qx 30"

# rpcd: status call through ubus
mkdir -p "$R/var/log"
run '/etc/init.d/S12ubus start && /etc/init.d/S13rpcd start' >/dev/null
i=0; until run ubus list shareos.storage >/dev/null 2>&1 || [ $i -ge 20 ]; do sleep 0.5; i=$((i + 1)); done
S=$(run ubus call shareos.storage status)
[ -n "${VERBOSE:-}" ] && echo "$S" | head -20
check "status: volume daten mounted with size" "echo '$S' | python3 -c \"import json,sys; d=json.load(sys.stdin); v=[x for x in d['volumes'] if x['name']=='daten'][0]; sys.exit(0 if v['mounted'] and v['size']>0 and v['layout']=='single' else 1)\""
check "status: job and spindown reported" "echo '$S' | python3 -c \"import json,sys; d=json.load(sys.stdin); sys.exit(0 if d['spindown']==30 and d['job']['state']=='done' else 1)\""
E=$(run ubus call shareos.storage setup "'{\"layout\":\"mirror\",\"name\":\"x\",\"disks\":[\"sda\",\"sda\"],\"confirm\":true}'")
check "rpc: mirror with the same disk twice rejected" "echo '$E' | grep -q 'two different disks'"
E=$(run ubus call shareos.storage setup "'{\"layout\":\"stripe\",\"name\":\"x\",\"disks\":[\"sda\"],\"confirm\":true}'")
check "rpc: RAID 0 with one disk rejected" "echo '$E' | grep -q 'two different disks'"
E=$(run ubus call shareos.storage setup "'{\"layout\":\"raid5\",\"name\":\"x\",\"disks\":[\"sda\",\"sdb\"],\"confirm\":true}'")
check "rpc: unknown layout rejected" "echo '$E' | grep -q 'unknown layout'"
E=$(run ubus call shareos.storage repair "'{\"name\":\"daten\",\"disk\":\"sda\",\"confirm\":true}'")
check "rpc: repair of a volume that is no mirror rejected" "echo '$E' | grep -q 'not a mirror'"
E=$(run ubus call shareos.storage repair "'{\"name\":\"daten\",\"disk\":\"sda\"}'")
check "rpc: repair needs confirm" "echo '$E' | grep -q confirm"
E=$(run ubus call shareos.storage setup "'{\"layout\":\"single\",\"volumes\":[{\"name\":\"x\",\"disk\":\"sda\"}]}'")
check "rpc: setup needs confirm" "echo '$E' | grep -q confirm"
E=$(run ubus call shareos.storage volume "'{\"name\":\"../etc\",\"action\":\"mount\"}'")
check "rpc: invalid volume name rejected" "echo '$E' | grep -q 'invalid name'"
run '/etc/init.d/S13rpcd stop; /etc/init.d/S12ubus stop' >/dev/null 2>&1

if [ -e /proc/mdstat ]; then
	run shareos-storage setup mirror spiegel $A $B --swap=32 --yes >/dev/null
	check "mirror setup" "run shareos-storage job | grep -q 'state=done' && mounted spiegel && grep -q md /proc/mdstat"
	run shareos-storage shutdown >/dev/null
	for l in stripe span; do
		run shareos-storage setup $l gross $A $B --swap=0 --yes >/dev/null
		check "$l setup (RAID 0 / JBOD)" "run shareos-storage job | grep -q 'state=done' && mounted gross && run uci get storage.gross.layout | grep -qx $l"
		run shareos-storage shutdown >/dev/null
	done
else
	echo "SKIP  mirror (no md driver on this host)"
fi

# --- file systems (the host kernel here may lack exfat/ntfs3/btrfs: then only
# mkfs and the partition type are checked, the mount is expected to fail) ---
hostfs() { grep -qw "$1" /proc/filesystems; }
ptype() { run sfdisk -d /dev/$1 | sed -n "s/.*$2.*type=\([^,]*\).*/\1/p" | head -1; }
for f in btrfs exfat ntfs ext3 ext2 vfat; do
	run shareos-storage setup single "v$f=$B:$f" --swap=0 --yes >/dev/null
	t=$(run blkid -s TYPE -o value /dev/${B}p1)
	if hostfs "$([ $f = ntfs ] && echo ntfs3 || echo $f)"; then
		check "volume with $f: created, mounted, fstype in UCI" "[ '$t' = '$f' ] && mounted v$f && run uci get storage.v$f.fstype | grep -qx $f"
	else
		check "volume with $f: file system created (host cannot mount $f)" "[ '$t' = '$f' ] && run shareos-storage job | grep -q 'mounting v$f failed'"
	fi
done
check "FAT32 volume label in upper case, 11 characters" "[ \"\$(run blkid -s LABEL -o value /dev/${B}p1)\" = VVFAT ]"
check "exFAT/NTFS volumes get the Windows partition type" "ptype $B ${B}p1 | grep -qi EBD0A0A2"
run shareos-storage setup single "bad=$B:fat" --yes >/dev/null
check "unknown file system rejected" "run shareos-storage job | grep -q 'invalid file system'"
o=$(run shareos-storage repair nur $A 2>&1); check "repair needs --yes" "echo '$o' | grep -q 'add --yes'"
run shareos-storage repair nur $A --yes >/dev/null
check "repair of a volume that is no mirror refused" "run shareos-storage job | grep -q 'is not a mirror'"
run shareos-storage setup single "nur=$B:exfat" --swap=0 --yes >/dev/null
check "no app area on exFAT" "! run uci -q get storage.global.apps | grep -qx nur"

# --- USB drives (loop device $C stands in for a stick) ---
usb() { chroot "$R" /usr/bin/env SHAREOS_USB_DISKS="$C" /bin/sh -c "$*" 2>&1; }
o=$(usb shareos-usb format $C ext4 Stick)
check "usb format refuses without --yes" "echo \"\$o\" | grep -q 'add --yes'"
o=$(usb shareos-usb format $C ext4 "'Mein Stick'" --yes); [ -n "${VERBOSE:-}" ] && echo "$o"
check "usb: formatted with ext4 and mounted at /mnt/usb-mein_stick" "grep -q \" $R/mnt/usb-mein_stick \" /proc/mounts && usb shareos-usb list | grep -q '/mnt/usb-mein_stick ext4'"
check "usb: MBR partition type 83" "ptype $C ${C}p1 | grep -qx 83"
echo data > $R/mnt/usb-mein_stick/f
usb shareos-usb umount-all >/dev/null
check "usb: umount-all" "! grep -q \" $R/mnt/usb-mein_stick \" /proc/mounts && [ ! -d $R/mnt/usb-mein_stick ]"
usb shareos-usb mount-all >/dev/null
check "usb: mount-all finds it again, data there" "grep -qx data $R/mnt/usb-mein_stick/f"
check "usb: internal disks are not touched by mount-all" "! grep -q \" $R/mnt/usb-.*${B}\" /proc/mounts"
usb shareos-usb umount-all >/dev/null
chroot "$R" /usr/bin/env SHAREOS_USB_DISKS="$C" ACTION=add MDEV=${C}p1 /usr/sbin/shareos-usb hotplug; sleep 4
check "usb: plugged in (mdev hotplug) -> mounted" "grep -q \" $R/mnt/usb-mein_stick \" /proc/mounts"
# --- USB copy (short press of the USB button) ---------------------------------
V=$(for v in daten backup; do grep -q " $R/mnt/$v " /proc/mounts && { echo $v; break; }; done)
if [ -n "$V" ]; then
	o=$(usb shareos-usb copy; echo rc=$?)
	check "usb copy: no target set -> error, nothing copied" "echo '$o' | grep -q rc=1 && grep -q 'error=no target set' $R/tmp/shareos-usb.copy/state"
	run "uci set shareos.usbcopy=usbcopy; uci set shareos.usbcopy.enabled=1; uci set shareos.usbcopy.volume=$V; uci commit shareos" >/dev/null
	o=$(usb shareos-usb copy; echo rc=$?)
	check "usb copy: the stick into a new dated folder on $V" "echo '$o' | grep -q rc=0 && grep -qx data $R/mnt/$V/USB-Kopien/*-mein_stick/f && grep -q state=done $R/tmp/shareos-usb.copy/state && grep -q files=1 $R/tmp/shareos-usb.copy/state"
	usb shareos-usb copy >/dev/null
	check "usb copy: again -> a second folder, nothing overwritten" "[ \$(ls -d $R/mnt/$V/USB-Kopien/*mein_stick* | wc -l) = 2 ]"
	check "usb copy: the stick stays mounted" "grep -q \" $R/mnt/usb-mein_stick \" /proc/mounts"
	run "uci set shareos.usbcopy.path='../x'; uci commit shareos" >/dev/null
	o=$(usb shareos-usb copy; echo rc=$?)
	check "usb copy: a target outside the drive is refused" "echo '$o' | grep -q rc=1 && grep -q 'invalid target' $R/tmp/shareos-usb.copy/state"
	run "uci delete shareos.usbcopy; uci commit shareos" >/dev/null
else
	echo "SKIP  usb copy (no volume mounted here)"
fi
chroot "$R" /usr/bin/env ACTION=add MDEV=${B}p1 /usr/sbin/shareos-usb hotplug; sleep 3
check "usb: hotplug ignores internal disks" "! grep -q \"^/dev/${B}p1 $R/mnt/usb-\" /proc/mounts"
usb shareos-usb eject $C >/dev/null
check "usb: eject unmounts" "! grep -q \" $R/mnt/usb-mein_stick \" /proc/mounts"
for f in exfat vfat ntfs; do
	usb shareos-usb format $C $f Stick --yes >/dev/null
	want=$f; t=$(run blkid -s TYPE -o value /dev/${C}p1)
	check "usb: formatted with $f" "[ '$t' = '$want' ]"
done
check "usb: NTFS/exFAT partition type 7" "ptype $C ${C}p1 | grep -qx 7"
o=$(usb shareos-usb format $B ext4 X --yes)
check "usb format refuses a non-USB disk" "echo \"\$o\" | grep -q 'not a USB drive'"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
