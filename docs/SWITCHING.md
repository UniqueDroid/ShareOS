# From Alt-F to ShareOS – and back (DNS-320L)

*Deutsche Fassung: [UMSTIEG.md](UMSTIEG.md)*

The switch works entirely through the web interfaces, without a serial console
and without soldering. Tested on real hardware on 20 Oct 2026: Alt-F → ShareOS
and ShareOS → Alt-F.

**Never touched:** the data on the disks, U-Boot, the MAC address and the
D-Link rescue system. Only the kernel, the boot system and the system in the
flash change.

## Preparation

1. Download from the [latest release](https://github.com/UniqueDroid/ShareOS/releases):
   - `ShareOS-<version>-DNS-320L-rev-Ax.bin` (kernel and boot system, about 3.3 MB)
   - `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` (the system)
2. Copy the `.sysupgrade.tar` to a USB stick (FAT32, exFAT or ext4; top level
   or a folder `shareos`). Without a stick the box downloads the package from
   GitHub itself – then the network cable must be plugged in and the router
   must hand out an address by DHCP.
3. Keep the Alt-F `.bin` for the way back (e.g.
   `Alt-F-1.0-DNS-320L-rev-A.bin` from the Alt-F site).
4. Optional: save the settings in Alt-F. On its first start ShareOS takes over
   users (with their passwords), groups and shares from Alt-F when they are in
   the flash.
5. Write down the box's IP address (in Alt-F or the router). ShareOS also gets
   its address by DHCP; with the same MAC address the router usually hands out
   the same one.

## Alt-F → ShareOS

1. Plug the USB stick with the `.sysupgrade.tar` into the box.
2. Open the **firmware page** in the Alt-F web interface (firmware update).
3. Choose the ShareOS `.bin`, upload and flash it. Alt-F checks the file and
   writes the kernel and the boot system. Do not cut the power while flashing.
4. The box restarts. ShareOS sees that there is no system in the flash yet and
   installs it – from the USB stick first, otherwise from GitHub; checksums are
   verified. The **orange USB LED blinks fast**, this takes a few minutes. The
   Alt-F add-on packages in the flash are replaced.
5. Then the box restarts once more on its own – now with ShareOS.
6. Open `http://<box-IP>/` in the browser (or `http://<device-name>.local/`).
   Sign in as **root** with the password **shareos**.
7. The setup wizard guides through language, taking over from Alt-F,
   password, name and time, and updates. Then take over the disks with your
   data: **Storage → Drives**, at the disk **„sda2 übernehmen“** (one button per
   partition with a file system) – nothing is erased. **Do not use the setup
   wizard for disks with data: it erases them.** Then create shares for the
   existing folders under **Freigaben**. (From 0.2.0-beta.17; with older
   versions see [Taking over disks by hand](#taking-over-disks-by-hand).)

From now on updates go through **System → Firmware** (from the internet or as
a file).

**If the installation fails** (no stick, no network, broken package), the box
stays in **rescue mode**: the orange USB LED blinks slowly. Copy the
`.sysupgrade.tar` to a USB stick, plug it in and switch the box off and on.
The reason is in `/tmp/firstinstall.err` (`ssh root@<IP>`, password
`shareos`).

## ShareOS → Alt-F

1. In ShareOS open **System → Firmware → Install firmware file**.
2. Choose and upload the Alt-F `.bin`. ShareOS checks the file (D-Link format,
   checksums, device, size) and shows what is inside ("Alt-F").
3. **Install** – the kernel and the boot system are written and read back.
4. **Restart**. Alt-F starts, at the same IP address.
5. Alt-F now runs without its add-on packages. To get them back, flash the same
   Alt-F `.bin` once more on Alt-F's firmware page.

## Back to ShareOS again

As above under "Alt-F → ShareOS": flash the ShareOS `.bin` in Alt-F.

- If step 5 was skipped in Alt-F (the Alt-F `.bin` not flashed a second time),
  the ShareOS system and settings are still in the flash – ShareOS starts
  right away with all its settings.
- Otherwise ShareOS installs itself again like the first time (USB stick or
  GitHub). A backup saved before ("Back up & restore settings" under System →
  General) can be restored afterwards.

## To the D-Link firmware

Easiest through Alt-F: first back to Alt-F (see above), then flash the D-Link
firmware from there.

## Taking over disks by hand

Before 0.2.0-beta.17 there is no button; over SSH it is the same (here the
partition `sda2` as volume `data`, which also becomes the apps area):

```sh
blkid /dev/sda2                     # TYPE="ext4" and a UUID
uci set storage.data=volume
uci set storage.data.uuid=$(blkid -s UUID -o value /dev/sda2)
uci set storage.data.fstype=ext4
uci set storage.data.layout=single
uci set storage.data.enabled=1
uci set storage.global=global
uci set storage.global.apps=data
uci commit storage
shareos-storage mount data
mkdir -p /mnt/data/.shareos && chmod 711 /mnt/data/.shareos
```

From 0.2.0-beta.17: `shareos-storage adopt data sda2`.

## When nothing works any more

- If the box does not start into a web interface any more, U-Boot starts the
  **D-Link rescue system** on its own when the kernel is broken. Alt-F can be
  flashed through its web page.
- With a serial console (see [TESTING.md](TESTING.md), way B) ShareOS can be
  started from RAM and the flash repaired from there.
