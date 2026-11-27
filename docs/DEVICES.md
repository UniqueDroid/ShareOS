# Supported devices and testers

*Deutsche Fassung: [GERAETE.md](GERAETE.md)*

ShareOS was developed on the **D-Link DNS-320L rev A**. From 0.2.0-beta.3 the
same system is built for the related Kirkwood boxes as well. They share the
processor family, the flash layout and the stock U-Boot; what differs (fan,
temperature sensor, buttons, LEDs, power-off) is described per model in
[`/usr/lib/shareos/board.sh`](../board/dlink/dns320l/rootfs-overlay/usr/lib/shareos/board.sh).

| Model | Release files | RAM | Status |
|---|---|---|---|
| DNS-320L rev A (A1–A3) | `ShareOS-<ver>-DNS-320L-rev-Ax.*` | 256 MB | **tested** |
| DNS-320LW rev A (A2) | `ShareOS-<ver>-DNS-320L-rev-Ax.*` | 256 MB | **tested** (0.2.0-beta.20) – the white DNS-320L: same board and flash layout, uses the DNS-320L files |
| DNS-320 rev B | `ShareOS-<ver>-DNS-320-rev-Bx.*` | 128 MB | built, **testers wanted** |
| DNS-325 rev A | `ShareOS-<ver>-DNS-325-rev-Ax.*` | 256 MB | **partly tested** (rev A1, see below), more testers wanted |
| DNS-320 rev A | `ShareOS-<ver>-DNS-320-rev-Ax.*` | 128 MB | **partly tested** (rev A1 with 0.3.0-beta.9: installed, web interface; temperature and fan control with the fix of 0.3.0-beta.11, [#163](https://github.com/UniqueDroid/ShareOS/issues/163)), more testers wanted – up to 0.2.0-beta.16 it restarts in a loop after flashing (initramfs address, [#96](https://github.com/UniqueDroid/ShareOS/issues/96)); use 0.2.0-beta.17 or newer |
| DNR-322L | – | 128 MB | planned |
| DNS-327L | – | 512 MB | planned (own kernel and flash layout) |

Not possible: DNS-323, DNS-321, DNS-343 (64 MB RAM, 8 MB flash).

## DNS-325 rev A1: what has been checked

First test on real hardware with a serial console (0.2.0-beta.7 and a build
of the fix for 0.2.0-beta.9).

- **Works:** boots from flash (from 0.2.0-beta.9; the beta.7 `.bin` restarts
  in a loop, see the [changelog](../CHANGELOG.md)), model and RAM (256 MB), 1
  Gbit/s Ethernet, temperature sensor, clock, USB, the 6 flash partitions, the
  LEDs, the fan presets (quiet, balanced, cool), the power, reset and USB
  buttons (from 0.2.0-beta.10; before, `shareos-buttons` found no input device
  on this box), power-on after a power cut, an update through System →
  Firmware.
- **Not checked yet:** a complete first installation from a freshly flashed
  `.bin` with the fixed image.
- A DNS-325 that already runs the beta.7 image and restarts in a loop needs a
  serial console to recover (the old initramfs is in its flash).

## How the models differ

| | DNS-320L / 320 rev B | DNS-325 | DNS-320 rev A |
|---|---|---|---|
| Fan, temperature | Weltrend MCU on ttyS1 (`dns320l-daemon`) | `gpio-fan`, `lm75` sensor (kernel) | `gpio-fan`; temperature asked from the MCU on ttyS1 |
| Power button | GPIO 29, polled | gpio-keys | gpio-keys |
| Power-off, power-on after a power cut | MCU | `gpio-poweroff`, GPIO 37 | `gpio-poweroff`, GPIO 37 |
| Clock (RTC) | MCU | kernel (`/dev/rtc0`) | kernel |
| LEDs | `dns320l:*` | `dns325:*` | `dns320:*` |
| D-Link signature | `DNS320L` / `DNS320B` | `DNS-325` | `DNS323D1` |

One kernel serves all four: post-image appends the model's device tree to the
kernel (the stock U-Boot passes none) and writes a `.bin` with the model's
signature. Initramfs and system are the same; the box finds its model in the
device tree at boot (`shareos-boardinfo`).

## For testers

**You need:** one of the boxes above with Alt-F or the D-Link firmware, a
USB stick (FAT32/exFAT/ext4), a network with DHCP. No soldering, no serial
console.

1. Download from the [latest release](https://github.com/UniqueDroid/ShareOS/releases)
   the two files with **your model's name**:
   `ShareOS-<ver>-<model>.bin` and `ShareOS-<ver>-<model>.sysupgrade.tar`.
2. Copy the `.sysupgrade.tar` to the USB stick and plug it in.
3. Flash the `.bin` on the firmware page of Alt-F or the D-Link interface
   (the box refuses files for another model).
4. The box restarts, installs the system from the stick (USB LED blinks fast,
   a few minutes) and restarts again into ShareOS: `http://<box-IP>/`,
   press the **USB button** on the front (or the reset button
   briefly, under 5 s), then choose the password for
   **root** (before 0.3.0-beta.2: password **shareos**).
5. Please check and report (GitHub issue, title "Test <model>"):
   - System → About: device and firmware name right?
   - Overview: temperature shown? Fan audible at the presets of System →
     Power & reset (quiet / balanced / cool)?
   - Power button: the box shuts down; it switches off completely?
   - Reset button 5–10 s: access reset (USB LED blinks slowly while held)
   - USB button: USB drives are removed safely
   - LEDs: status and disk LEDs (System → Power & reset)
   - After a power cut: does the box start again by itself?
   - System → Time: correct after a restart without network?
   - Storage: create a volume, share, copy files from a computer
   - Free memory after start (System → Terminal: `free`), above all on the
     128 MB boxes
   - The hardware report: System → Terminal → `shareos-check`, attach
     `/tmp/shareos-check.txt`

**The way back** is always there: System → Firmware → *Install firmware
file* with the Alt-F `.bin` (see [SWITCHING.md](SWITCHING.md)). If the box
does not start into ShareOS, U-Boot starts the D-Link rescue system ("mini
firmware"), from which Alt-F can be flashed. The data on the disks is never
touched.

## Adding a model

1. Device tree: in the kernel (`BR2_LINUX_KERNEL_INTREE_DTS_NAME`) or in
   `board/dlink/dns320l/dts/` (`BR2_LINUX_KERNEL_CUSTOM_DTS_PATH`).
2. A line in `MODELS` of `board/dlink/dns320l/post-image.sh` (firmware name,
   device tree, D-Link signature from `legacy/alt-f/mkfw.sh`).
3. A case in `board_detect` of `board.sh` (model text, LEDs, control,
   buttons) and in `tests/test-boards.sh`.

### Devtest image: the first image for a new model

A model that is being added is built as a **devtest image** until it has been
tested: status `devtest` in its `MODELS` line (files
`ShareOS-<version>-<name>-devtest.bin` / `.sysupgrade.tar`) and
`BOARD_DEVTEST=1` in its case of `board.sh`. Its testers get the files from the
build of the pull request (Actions → artifact), never from a release – the
release job refuses devtest files.

On such a box:

- root keeps the password **shareos** – no claiming with a button (the buttons
  of a new model are not known yet). Web interface and SSH: `root` / `shareos`.
  Use it only in your own network.
- The overview and the messages say that it is a test image and link to the
  **device info**: `http://<box>/deviceinfo` (also open for admins on every
  other model). It collects what is needed to add the model – flash partitions,
  CPU, memory, device tree, LEDs, sensors, buttons (input devices), GPIOs,
  serial ports, I2C, USB, network, the U-Boot environment (read from flash,
  never written) and the kernel log – and offers it as a text file. MAC
  addresses and serial numbers are masked unless *Show MAC addresses and serial
  numbers* is ticked: attach the masked file to the issue of the model.
- In the rescue system (SSH after a TFTP or rescue boot) the same report:
  `shareos-deviceinfo > /tmp/info.txt`, then copy it with `scp`
  (`--full`: without masking).

When the model works: status `release`, `BOARD_DEVTEST=0`, and it goes into
the next release with the normal claiming.

## Cavium OCTEON: D-Link DNS-1200-05 (being added)

A second platform next to the Kirkwood boxes: `make octeon`
(`configs/shareos_octeon_defconfig`, `board/dlink/octeon/`). It is built so
that the first start on the box can be tried – nothing of it has run there yet.

| | |
|---|---|
| CPU | Cavium OCTEON Plus CN5230, 4 cores, MIPS64 big endian, no FPU |
| RAM | 1 GB (one DDR2 DIMM) |
| Disks | 5 bays: 2× SiI3132 on PCIe (`sata_sil24`), one port through a SiI5723 |
| Network | 2× Gigabit (Marvell 88E1112, SGMII) |
| Flash | NAND 256 MiB with two banks of D-Link's firmware; mainline Linux has no driver for it |
| Microcontroller | on ttyS1: OLED display, clock, fan, power-off, schedule – not driven yet |
| Serial console | header JP3, 115200 8N1, 3.3 V |

**How it starts.** The box's U-Boot 1.1.1 (Cavium SDK) reads the kernel from
the flash (a file in a JFFS2, or a raw partition with `nand read`) and starts
it with `bootoctlinux`; it cannot load from the network, USB or the serial
line. Ctrl+C right after `NAND:  256 MiB` stops it
at the prompt `Octeon ebh5200#`. It passes no device tree: the bootloader
reports the board type EBH5200 (Cavium's reference board), the kernel takes its
built-in device tree for that, and `board.sh` knows the box by this
`system type` in `/proc/cpuinfo`.

**The image.** `ShareOS-<version>-DNS-1200-05-rev-Ax-devtest.elf` – the kernel
with the whole system as its initramfs: nothing is installed, and settings are
gone after a restart – the same file as `.uImage` (the wrapper D-Link's own
start uses) and `.uRamdisk`, an empty initramfs in the ramdisk wrapper in case
`bootoctlinux` asks for one. They come from the artifact `devtest-octeon` of a
build and are never part of a release. It is a [devtest image](#devtest-image-the-first-image-for-a-new-model):
`root` / `shareos`.

**Not there yet:** fan control, clock, display and power-off (the
microcontroller), LEDs and disk power (D-Link's own GPIO driver), access to the
flash (settings that survive a restart, updates), system apps for MIPS64.

**Rules for this box:** never `saveenv` or `eraseenv` in U-Boot (its
environment has never been saved), the firmware of the microcontroller is never
rewritten, and D-Link's running firmware stays in its bank.
