# ShareOS Lite – D-Link DNS-323 (work in progress)

Marvell Orion 88F5181 (rev A1) / 88F5182 (rev B1, C1), 500 MHz ARMv5TE,
64 MB RAM, 8 MB NOR flash. Also meant for the clones CH3SNAS and DUO-35LR
(same board, other firmware signature) – untested.

The userland is the same as on the Kirkwood boxes (ARMv5, musl). What
differs: the kernel, the initramfs and where the system lives.

## Limits of the stock U-Boot

| Part | Max | Phase-1 build |
|---|---|---|
| uImage (kernel, U-Boot copies 1.5 MB) | 1 572 864 bytes | 1 379 856 (188 KB free) |
| urootfs (initramfs) | 6 488 064 bytes | 3 570 840 (test initramfs) |

The system (squashfs, ~12 MB) does not fit into 8 MB of NOR, so ShareOS Lite
keeps it on the disk (phase 2): the initramfs finds a ShareOS partition and
starts `system-a.sqfs` with an overlay from there (A/B, swap on the disk).

## Kernel (`linux.fragment`)

On top of `orion5x_defconfig`: only the DNS-323 board file
(`arch/arm/mach-orion5x/dns323-setup.c`, no device tree – the stock U-Boot
boots by machine id; a two-instruction prologue sets mach-id 1542 like
Alt-F did), XZ, `-Os`, no kallsyms/kprobes/BPF/cgroups/netfilter.
Built in is what cannot be a module (core, IPv4, PCI for the SiI3512 of
rev A1, serial). Drivers needed to reach the system on the disk (SATA,
md raid1, ext2, squashfs, overlayfs, Ethernet, I²C sensors, RTC, LEDs,
keys, NOR) are modules in the initramfs; ksmbd, NFS server, ext4, USB,
exFAT/NTFS etc. are modules on the disk.

Measured in QEMU (`versatilepb`, arm926, 64 MB) with the 0.3.0-beta.2
system: ~41 MB free after boot; SMB3 via ksmbd, Transmission and rclone
(with `--buffer-size 0 --transfers 1 --checkers 1 --use-mmap`) work; rclone's
default settings thrash. Swap on the disk is required.

## Phase 1 hardware test

    board/dlink/dns323/build-test.sh <linux-6.18-source> ShareOS-<ver>-DNS-320L-rev-Ax.sysupgrade.tar

builds `ShareOS-Lite-test-DNS-323-rev-AxBxCx.bin`: the kernel plus a test
initramfs (`test-init`) that loads the drivers, prints a hardware report
(flash, disks, Ethernet, sensors, RTC, LEDs, keys, memory), gets an address
by DHCP and starts SSH (root / shareos). It writes nothing to flash or disks.

Boot it without flashing, from Alt-F on the DNS-323 with *TryIt* (kexec –
works on Orion), or from U-Boot over the serial console.

**Do not flash this image – not with Alt-F's FlashIt and not with the
D-Link firmware upgrade page.** It carries the real DNS-323 signature, so
both would accept it; afterwards the box always boots the test initramfs
(no web interface, nothing to flash back from) and recovery needs the
serial console.

## Not planned for Lite (so far)

- Netfilter/nftables (kernel size): no firewall rules, no Tailscale subnet
  routing, VPN features that need NAT/firewall are hidden.
- Btrfs, cgroups (per-app RAM limits), kallsyms in oopses.
- rclone only in low-memory mode; heavy store apps carry a warning.
