# DNS-320L rev A3 – hardware and boot findings

Collected while bringing up ShareOS phase 1 (2026-10-16).

## Network

- Alt-F (kernel 4.14, generic PHY driver) links at **1000 Mbit/s full duplex**
  on a rev A3 board. The Marvell PHY driver is therefore only built as a module.

## Flash (`/proc/mtd` under Alt-F)

| mtd | size | name |
|---|---|---|
| mtd0 | 0x00100000 | u-boot |
| mtd1 | 0x00500000 | uImage |
| mtd2 | 0x00500000 | ramdisk |
| mtd3 | 0x06400000 | image |
| mtd4 | 0x00a00000 | mini firmware |
| mtd5 | 0x00500000 | config |
| mtd6 | 0x00200000 | my-dlink |

Reading mtd0 with `nanddump` reports uncorrectable ECC errors on the first two
pages (0x0, 0x800): those pages use the boot ROM ECC layout, not the one the
Linux NAND driver expects. The rest of the dump is valid.

## Stock U-Boot

- `U-Boot 1.1.4 (Aug 22 2012) Marvell version: 3.6.0.DNS-320L.01`, linked at
  0x600000 (NAND image offset 0x200).
- **No saved environment** in mtd0 (no CRC-valid block) – the compiled-in
  defaults are used:
  - `bootcmd=nand read.e 0xa00000 0x100000 0x300000;nand read.e 0xf00000 0x600000 0x300000;bootm 0xa00000 0xf00000`
    → only 3 MB of the uImage and ramdisk partitions are read (hard size limit)
  - `bootargs=root=/dev/ram console=ttyS0,115200 :::DB88FXX81:egiga0:none`
  - `bootdelay=1`, `ipaddr=2.66.66.201`, `serverip=2.66.66.32`, `rcvrip=169.254.100.100`
- Commands present: `usb`, `fatload`, `ext2load`, `usbboot`, `rcvr`.
- `rcvr` (Marvell recovery): loads `/flashware.img` or `/multiware.img` from a
  USB stick (FAT, then ext2 partitions 0/1); if not found, does a DHCP/TFTP
  "distress beacon" recovery; then boots the image from RAM (no flashing).
- Auto-recovery at power-on is wired to a board GPIO of class 17. The DNS-320L
  runs as board "DB-88F6702A-BP" (board id 14, default when unset), whose GPIO
  table has **no class-17 entry** → `rcvr` can only be started from the serial
  console, there is no button-triggered recovery.

## kexec

- Alt-F greys out "TryIt" on Kirkwood boxes.
- Manual kexec from Alt-F into the ShareOS kernel hung before netconsole came
  up (no UDP packets, LEDs unchanged).
- kexec of Alt-F's **own** flashed kernel (`touch /boot/.kexec; reboot`) also
  hung → kexec with the Alt-F 4.14 kernel does not work on this box at all.

## Consequence

There is no safe way to run an untested kernel without a serial console.
The JP1 serial header is not populated (3.3 V TTL, 115200 8N1, GND/TX/RX);
the holes are filled with solder, so a pin header does not go in without
clearing them first – soldering three wires (GND/TX/RX) to the pads is easier.
With the console, ShareOS can be started from RAM via `rcvr`/TFTP or
`tftpboot` + `bootm` without touching the flash.

## Comparison with Alt-F Release 1.0 (the version on the test box)

Checked against `tags/Release-1.0` (r3795, kernel 4.4.86) and `branches/1.0.1`
in the Alt-F SVN, versus the trunk (r3935, kernel 4.14.268) ShareOS forked from:

| Boot-relevant item | Release 1.0 | trunk | ShareOS |
|---|---|---|---|
| DNS-320L device tree | reference | identical to 1.0 | ported from it (Linux 6.x paths) |
| Kernel image | zImage + appended DTB, uImage `-a/-e 0x8000`, no mach-id prologue | same | same |
| Initramfs | uImage ramdisk `-a 0x800000` (squashfs "sqall") | same (UBI variant) | cpio.xz content, load address `0x800000` (DNS-320L, DNS-320) or `0x1000000` (DNS-325 only: at `0x800000` the kernel drops the initramfs there, "overlaps in-use memory region") |
| Size limits | 3 MB kernel / 3 MB initramfs | same | same, checked at build time |
| D-Link signature | prod 0, cust 8, model 11, sub 1, ver 1, type 6 | same | same |
| Extra image | squashfs sqimage appended (`sqsplit`) | UBI image (`ubisplit`) | none yet |
| Kernel options | ATAGS, ARM_APPENDED_DTB, ATAG_DTB_COMPAT(+CMDLINE_EXTEND), CMDLINE_EXTEND, CPU_FEROCEON_OLD_ID, CACHE_FEROCEON_L2, AUTO_ZRELADDR, KERNEL_XZ | same | same |

So the trunk was not "unbootable" (the Alt-F author ran 4.14.78 on his
DNS-320 boxes), and ShareOS uses the same boot contract as Release 1.0.

kexec: the Alt-F author states "For the DNS-320L/325 kexec is not working"
(groups.google.com/g/alt-f/c/PPXssiwm7mo) – consistent with our test where
even Alt-F's own kernel hangs. Our failed kexec attempts therefore say
nothing about whether the ShareOS kernel boots from U-Boot.

## Serial console (verified 2026-10-17)

JP1 next to the USB port, pins `[4 3 2 _ 1]`: 4 = TX (box), 3 = GND,
1 = RX (box), 2 = 3.3 V (leave unconnected). 115200 8N1. Adapter RXD → pin 4,
TXD → pin 1, GND → pin 3. Pin 1 is the square pad. The holes are filled with
solder: three wires soldered to the pads (pin 3, 4 and 1) are the easy way.

| JP1 pinout | Connected | Board (DNS-320L rev A3) |
|---|---|---|
| ![JP1](images/hw-jp1.jpg) | ![JP1 wired](images/hw-jp1-kabel.jpg) | ![Board](images/hw-platine.jpg) |

Stock boot log: U-Boot reads 3 MB each of uImage and
ramdisk, `Hit any key to stop autoboot` counts down from 1 (bootdelay=1).

**Stopping autoboot needs `<space>` followed by `1`** (D-Link change in
abortboot, U-Boot @0x62e5fc): a space sets the delay to 0 but keeps waiting for
the rest of that second for a `1`; any other key just boots immediately. So
"press any key" or holding space does not work – type space, 1, space, 1 …
right after power-on until `<INTERRUPT>` / `Marvell>>` appears.

Alt-F 1.0 boot facts from the log:
- kernel cmdline = built-in CMDLINE + U-Boot bootargs
  (`root=/dev/ram console=ttyS0,115200 :::DB88FXX81:egiga0:none`)
- no `local-mac-address` in the DT → eth0 starts with the Marvell default
  `00:50:43:00:02:02`; Alt-F's rcS reads the real MAC from the first 2 KB of
  the "mini firmware" partition (mtd4) and sets it. ShareOS does the same in
  `S05board`.
- NAND: Hynix H27U1G8F2BTR-BC, bad blocks 167 and 1023 on the test box;
  reading `my-dlink` (mtd6) gives ECC errors – harmless, nothing uses it.
- `rtc-mv: internal RTC not ticking` is expected, the RTC is in the MCU.

## Stock U-Boot fallback: D-Link rescue firmware

When `bootm` finds no valid image (bad magic / bad CRC), the stock U-Boot
reads 5 MB from 0x6f00800 ("mini firmware" / "rescue firmware" partition) and
boots D-Link's rescue system (Linux 2.6.31.8, BusyBox 1.11.2, lighttpd,
hostname `dlink-<mac>`). Seen on 2026-10-17 after a failed TFTP load.

Consequences:
- A flashed ShareOS kernel with a **corrupt** uImage/initrd header or CRC does
  not brick the box – U-Boot falls back to the rescue system (web flashing).
  A kernel that loads fine but **hangs** is not caught by this.
- The rescue system reads the MAC from the first 2 KB of that partition
  (`mac1 = C4:A8:1D:...`), which confirms where ShareOS takes it from.
- ShareOS must never overwrite the "mini firmware" partition.

## TFTP boot from U-Boot (no flashing)

```
<space>1                      # stop autoboot
setenv ipaddr <free ip>
setenv serverip <pc ip>
setenv netmask 255.255.255.0
ping <pc ip>                  # check network first
tftpboot 0xa00000 uImage
tftpboot 0xf00000 urootfs
bootm 0xa00000 0xf00000       # never saveenv
```
PC: `dnsmasq --no-daemon --port=0 --enable-tftp --tftp-root=/srv/tftp --tftp-single-port`.

## First boot of ShareOS on hardware (2026-10-17)

TFTP-booted from RAM (`uImage` + `urootfs`, commit d43dcb5), rev A3 box:

| Check | Result |
|---|---|
| Kernel 6.18.57 + ported DTS | boots, model "D-Link DNS-320L-rev-Ax NAS", 256 MB |
| NAND | 7 partitions as in Alt-F, same bad blocks |
| Ethernet | 1000 Mb/s full duplex, DHCP lease, real MAC from mtd4 |
| MCU (dns320l-daemon) | running, temperature read (36–38 °C), fan runs |
| LEDs / buttons | all 4 LEDs, gpio-keys; blue USB LED heartbeat; reset button: access reset (5–10 s) / factory reset (≥ 15 s), USB button: remove USB drives (`shareos-buttons`) |
| Power button / poweroff | MCU switches the box off |
| ubusd / rpcd / uhttpd | web test page works (system info, login) |
| SSH | works |
| Kernel log | clean (only `orion_wdt: Initial timeout 25 sec`) |

Fixed afterwards: system time from the MCU RTC (`dns320l-daemon -x hctosys`)
plus busybox ntpd (RTC updated after each clock step), boot message waits for
the DHCP address, `shareos-check` shows all link modes and the PHY.

## ShareOS from flash (2026-10-17, build a2ca26f)

- `shareos-install-ubi` → UBI in `image` (rootfs 48.1 MiB squashfs volume,
  rootfs_data 47.3 MiB UBIFS; 1 bad PEB, 19 reserved).
- `shareos-install-ubi --keep-data` replaced the system, a file in the overlay
  survived.
- `shareos-flash-boot` wrote kernel + initramfs into mtd1/mtd2; the stock
  U-Boot boots ShareOS on its own (no TFTP, no console needed).
- Clean shutdown: UBIFS mounts without recovery after `reboot`.
- Alt-F backups of mtd1/mtd2 are taken to `/root/boot-backup` once.

## Update path and disks (2026-10-17, build 0a3cff2)

- Staged system update (`/overlay/upgrade`, installed by the initramfs on the
  next boot) works on hardware; settings in the overlay survive.
- SATA power regulator on **gpio0 24** confirmed: both disks spin up and are
  detected (Alt-F's `&gpio1 24` was wrong for mpp24).
- uhttpd crashed on every `If-Modified-Since` request (musl `strptime %Z`
  with unset `tzname`); patched in `patches/uhttpd/`.
