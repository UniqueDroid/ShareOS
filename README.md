# ShareOS

ShareOS is a free, open source alternative firmware for the D-Link
DNS-320L, DNS-320 (rev A/B) and DNS-325 (later perhaps more, e.g. the
DNS-327L).

It is a fork of [Alt-F](http://sourceforge.net/projects/alt-f) by João
Cardoso. All credit for the original design, the hardware support and
years of work goes to the Alt-F project — see [LICENSE](LICENSE) and
[COPYING](COPYING) for the GPLv2 terms.

> **Built by an AI.** Apart from importing Alt-F, ShareOS was developed by
> Claude (Anthropic): architecture, all code, builds, tests and docs. Jan
> started the project, made the decisions and tested on the real box.
> Timeline with timestamps and screenshots:
> **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** ([Deutsch](docs/ENTWICKLUNG.md)).
>
> Testing and installing: [docs/TESTING.md](docs/TESTING.md) ([Deutsch](docs/TESTEN.md)).
> **First sign-in:** `http://<box-IP>/`, user **root**, password **shareos** – the box asks you to set your own password right away (also for SSH).
> Translating the web interface: [docs/TRANSLATING.md](docs/TRANSLATING.md).

![ShareOS web interface](docs/images/gui-uebersicht.png)

## Status: public test versions (beta)

**DNS-320L:** the main device, tested on hardware with every release.
**More models** from 0.2.0-beta.3: DNS-320 rev B, DNS-325 rev A, DNS-320 rev A – built; the DNS-325 rev A1 boots from flash (from 0.2.0-beta.9) and its buttons work (from 0.2.0-beta.10), the DNS-320 rev A/B are not tested yet; testers wanted: [docs/DEVICES.md](docs/DEVICES.md).

**Known issue:** a share that gives access only to a **group** is refused over SMB to the members of that group; naming the user in the share works ([#57](https://github.com/UniqueDroid/ShareOS/issues/57), fix with ksmbd-tools 3.5.3 planned).

ShareOS runs from flash on the DNS-320L (kernel, initramfs and the system in
UBI with a persistent overlay for settings and packages). Test releases
(`v0.2.0-beta.x`, before that `v0.1.0-beta.x`; pre-releases, for test devices
only) are published on
[GitHub Releases](https://github.com/UniqueDroid/ShareOS/releases); a running
ShareOS updates itself from there.

ShareOS is built on a current, maintainable base while keeping what made
Alt-F easy to use: the stock U-Boot and the stock flash layout.

## Install – from Alt-F or the D-Link firmware

No serial console, no soldering; the data on the disks is not touched.
Details and troubleshooting: [docs/SWITCHING.md](docs/SWITCHING.md) ([Deutsch](docs/UMSTIEG.md)).

1. From the [latest release](https://github.com/UniqueDroid/ShareOS/releases) download the two files with **your model's name** (DNS-320L: `DNS-320L-rev-Ax`; other models: [docs/DEVICES.md](docs/DEVICES.md)):
   `ShareOS-<version>-<model>.bin` and `ShareOS-<version>-<model>.sysupgrade.tar`.
2. Keep the `.bin` of your current firmware (e.g. Alt-F) for the way back.
3. Copy the `.sysupgrade.tar` to a USB stick (FAT32, exFAT or ext4) and plug it into the box.
   Without a stick the box downloads it from GitHub (network cable, DHCP).
4. Flash the ShareOS `.bin` on the **firmware page of Alt-F or of the D-Link interface**. Do not cut the power.
5. The box restarts and installs the system from the stick (**orange USB LED blinks fast**, a few minutes), then restarts once more into ShareOS.
6. Open `http://<box-IP>/` (or `http://<device-name>.local/`), sign in as **root** / **shareos** and follow the setup wizard; add your disks under **Storage** – the data stays.

Updates afterwards: **System → Firmware** (from GitHub, or the `.sysupgrade.tar` as a file).

## Back to Alt-F (or the D-Link firmware)

1. In ShareOS: **System → Firmware → Install firmware file** → choose the Alt-F `.bin` → **Install**. ShareOS checks the file (format, checksums, device) and reads it back after writing.
2. **Restart**: Alt-F starts, at the same IP address.
3. Flash the same Alt-F `.bin` once more on Alt-F's firmware page to get its add-on packages back.
4. To the D-Link firmware: from Alt-F, as with Alt-F itself ([docs/SWITCHING.md](docs/SWITCHING.md)).

If ShareOS does not start, U-Boot starts the D-Link rescue system ("mini firmware"), from which Alt-F can be flashed.

## Features

Version in brackets = first release with the feature.

**Storage**
- Setup wizard: one disk, two separate disks, a mirror (RAID 1), RAID 0 or JBOD (mdadm; RAID 0/JBOD from beta.9), optional swap partition per disk
- File system per volume: **ext4** (recommended: owners, storage limit per user, personal folders, apps), **Btrfs**, **exFAT**, **NTFS** (beta.7), **ext3**, **ext2**, **FAT32** (beta.9)
- Share rights are also set as POSIX ACLs on the share folders (ext4, Btrfs), so every program of a user is held to them, not only SMB (0.2.0-beta.6)
- **Snapshots:** dated states of shares, personal folders or whole drives on another drive (hourly to weekly, hard links like rsnapshot, keep the last N plus days/weeks/months), restore with the file browser (0.2.0-beta.6)
- SMART values and health, disk standby, RAID status with sync progress, repair a mirror with a new disk (beta.9), mount/unmount/remove volumes
- **USB sticks and disks:** mounted at `/mnt/usb-<name>` when plugged in (FAT32, exFAT, NTFS, ext4, Btrfs), **Safely remove**, **Format** with exFAT, FAT32, NTFS or ext4 (beta.7)

**Shares, users, files**
- SMB 2/3 (ksmbd) and NFS v4 shares with read/write permissions per user and group, guest access optional
- Users and groups; one account for shares, web interface and apps; storage limit per user (ext4); import of Alt-F users with their passwords
- "My ShareOS": users with web access manage their own password, look, shares, storage, cloud and Paperless
- File browser in the web interface: admins for all drives and USB drives, users for their personal folder and the shares they have rights to (enabled per user; read-only shares stay read-only, also for apps); upload/download with progress, drag and drop, large files; trash per folder with restore and automatic emptying (0.2.0-beta.12)

**Apps and integrations**
- APPS area with a store from [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps) – 38 web apps for files and office, media, network, security, development and everyday life: one-click install/update with SHA-256 check, own `.sapp` packages, more catalogs, visibility per user/group; apps run on their own port (8081/8444) (beta.6)
- App permissions: scheduled tasks (`cron`) as a restricted app user, schedule editable in the interface (beta.7)
- Open files from the file browser in apps (e.g. Webpad), save back; app SDK and ShareOS look for apps (`/_shareos/theme.css`, `/_shareos/app.js`), apps inside the interface (permission `embed`) (beta.9)
- App permission `files`: apps work with the folders of the box with the user's rights – ShareCommander (two-pane file manager), Webpad saves on the box; music and videos stream with seeking (beta.11)
- System apps: native programs for the terminal from the store – nano, htop (0.2.0-beta.1); strace, iperf3 (0.2.0-beta.2); bash (0.2.0-beta.5); store in sections with search (0.2.0-beta.5)
- Feature lock 0.2.0-beta.2: faster interface (results kept between requests, store refresh in the background), smaller system without OpenSSL, GIO and unused tools
- App data per account in the browser, file dialog of the box for apps (WinWeb Player plays music from the box) (0.2.0-beta.1)
- Cloud sync with rclone (Nextcloud/WebDAV, S3, SFTP, Google Drive …) for the device and per user, with schedule and bandwidth limit (beta.4)
- Paperless-ngx: inbox folders per user or shared (e.g. for a scanner), upload through the Paperless API (beta.4)
- Installable as an app (PWA), status address for widget apps (beta.4)
- "Share with" on Android: the installed app saves shared photos, files and links into `Geteilt` in the personal folder (0.2.0-beta.11)
- Remote access with Tailscale (system app `tailscaled`, starts by itself, admins only, permission `tailscale` for apps): the box in a tailnet without port forwarding, also behind DS-Lite (0.2.0-beta.7)
- Download automation with autobrr (system app, one for the box, admins only, permission `autobrr` for apps): IRC announces and RSS feeds, matching torrents go to the Transmission of a chosen account (0.2.0-beta.9)
- Apps keep their data on the box also for accounts without file access: a private folder per app and account (0.2.0-beta.9)
- Admins get a personal folder for apps too (their home, for root `home/root` on the apps drive), so app data no longer lands at the top of a drive (0.2.0-beta.10)
- App permissions `sysinfo`, `netcheck`, `docker` and `tuya` (admins only): SysMon, HomePing, DockerDeck and TuyaPulse show real data – the box's values, checks from the box, Docker hosts of the homelab, Tuya devices locally without the cloud (0.2.0-beta.11)
- File dialog of the apps with the personal folder and the user's shares, also for accounts without file access (0.2.0-beta.11)
- System apps declare their service in `app.json` (`"service"`), ShareOS starts and stops it through the firmware's controller; how to submit a system app: `sysapps/README.md` (0.2.0-beta.9)
- Large system apps on the apps drive (link in `/opt`), the flash stays free (0.2.0-beta.7)
- Media server (DLNA/UPnP AV, MiniDLNA as a system app): TVs and players play music, videos and pictures from chosen shares (0.2.0-beta.6)
- VPN for the box in both directions (OpenVPN as a system app, app NetTunnel, admins only): as client with cleaned profiles, as server with its own CA and a ready-made profile per device; status chips of services and apps in the header (0.2.0-beta.6)
- Transmission with own torrents per user: system app `transmission-daemon`, app permission `torrent`; apps bring the system apps they need (`"requires"`) (0.2.0-beta.4)
- Media jobs: FFmpeg as a system app, app permission `media` – convert audio, change the container of videos, cut, in the background with the user's rights (MediaTranscoder) (0.2.0-beta.5)

**Firmware and system**
- Online updates from GitHub Releases: checked every 6 hours, SHA-256 verified, progress for download, check and installation (beta.1)
- First installation from the Alt-F or D-Link web interface: the `.bin` fetches the system from a USB stick or from GitHub (beta.7; tested on real hardware, step by step: [SWITCHING.md](docs/SWITCHING.md) · [UMSTIEG.md](docs/UMSTIEG.md))
- Back to Alt-F (or any D-Link `.bin`) from the firmware page, checked and read back (beta.7)
- First-run assistant, network settings with automatic rollback, name via mDNS (`<name>.local`), fallback address `192.168.0.32` without DHCP
- HTTPS with a self-signed certificate that follows name and IP, own certificate possible
- Reset button: access reset (5–10 s: network, root password, certificate) or factory reset (≥ 15 s), USB button removes USB drives (beta.9); the buttons work again on the DNS-320L and DNS-325 (0.2.0-beta.10)
- Messages: RAID, volumes, temperature, SMART, updates, failed cloud jobs and app tasks – in the interface, by e-mail (SMTP) and push (ntfy, Gotify, webhook) (beta.9), Telegram bot (beta.12)
- Terminal in the browser (System → Terminal, root shell, beta.12); Apps, Cloud and Paperless can be switched off (beta.12)
- Services with autostart, fan curve and LEDs, logs, settings backup and restore (JSON, optionally AES-256), messages that can be closed
- Look: light/dark/system, accent colours, tiles or tables, per user; Appearance page in two columns on wide screens (0.2.0-beta.10)
- FAV APPS: favourite apps per account as an icon bar above the overview status, the installed apps and in *Mein ShareOS* (with names or icons only, 0.2.0-beta.10)
- *Mein ShareOS*: tab *Einstellungen* with look and password, storage as a table per drive with own use, limit and free space (0.2.0-beta.11)
- 10 languages: English, German, Chinese, Hindi, Spanish, French, Arabic (right to left), Bengali, Portuguese, Russian (beta.7; more: [docs/TRANSLATING.md](docs/TRANSLATING.md))
- Time: time zone, NTP on/off with own servers (e.g. the router), sync now, set the clock by hand; the battery clock follows (beta.7)
- SSH/SFTP (Dropbear), rescue system in the initramfs (SSH, flash tools)

## D-Link firmware, Alt-F and ShareOS compared (DNS-320L)

| | D-Link firmware (ShareCenter) | Alt-F | ShareOS |
|---|---|---|---|
| Last release | 1.11 (last version listed for CVE-2024-3273); product end of life | 1.0 (Oct 2017); trunk r3935 (basis of ShareOS) | 0.2.0 betas (2026), updated continuously |
| Linux kernel | 2.6.31 ¹ | 3.10.32 (0.1RC4, 2014), 4.4.86 (1.0), 4.14.268 (trunk) | **6.18 LTS** |
| Boot loader | Marvell U-Boot 1.1.4 | stock U-Boot (unchanged) | stock U-Boot (unchanged, never written) |
| Build system / toolchain | D-Link GPL sources, uClibc ¹ | buildroot 2009.08 fork, GCC 7.4, uClibc-ng 1.0.44 (trunk) | buildroot 2026.02 LTS (`BR2_EXTERNAL`), GCC 14.3, musl 1.2.6 |
| System layout | own image formats | squashfs/jffs2, packages in the flash or on disk | squashfs in UBI + UBIFS overlay for settings and packages |
| SMB | Samba 3.x, SMB1 ¹ | Samba 3.6.25: SMB1 and SMB2 (1.0); Samba 4.15 as an optional package | ksmbd (in the kernel): SMB 2.1/3 |
| NFS | ¹ | nfs-utils | NFS v4 (nfs-utils 2.8) |
| SSH | none (only via fun_plug workarounds) | Dropbear (OpenSSH as a package) | Dropbear 2026.91, SFTP |
| Web interface | ShareCenter UI | BusyBox httpd + shell CGIs | uhttpd + ubus/rpcd (ucode), new interface, light/dark, per user |
| Configuration | own config files | many scattered files | UCI (OpenWrt style), backup/restore as JSON |
| Updates | manual upload of a `.bin` | manual upload of a `.bin` | online from GitHub Releases, verified, every 6 h checked |
| File systems | ext3/ext4; FAT32/NTFS via FUSE ¹ | ext2/3/4, FAT, NTFS (ntfs-3g), btrfs, LVM2 | ext4, Btrfs, exFAT, NTFS (kernel ntfs3), FAT32 |
| RAID | own metadata format ¹ | mdadm (RAID 0/1/5, JBOD), LVM | mdadm RAID 1 (mirror), RAID 0, JBOD |
| USB drives | mounted ¹ | mounted on plug-in | mounted on plug-in, safely remove, format (4 file systems) |
| Users and rights | users, groups, quota ¹ | users, groups, quota | users, groups, rights per share, storage limit per user, users with their own web area |
| Extensions | add-ons (discontinued) | ipkg packages with a web page | app store (ShareOS-Apps): web apps on their own port, system apps (nano, htop, strace, iperf3, bash, Transmission, FFmpeg, MiniDLNA, OpenVPN, Tailscale, autobrr) |
| Cloud / documents | – | – (single packages) | rclone cloud sync, Paperless-ngx inbox |
| HTTPS | ¹ | self-signed or Let's Encrypt | self-signed (follows name/IP) or own certificate |
| Security | unpatched remote code execution (CVE-2024-3273, CVE-2024-3274); D-Link advises to retire the devices | last release 2017; old kernel and Samba | current kernel and libraries, updates via GitHub |
| Install | factory | `.bin` via the D-Link/Alt-F web page | `.bin` via the D-Link/Alt-F web page + system from USB stick/GitHub, or serial console; back to Alt-F from the web page |

¹ Details of the D-Link firmware are taken from vendor pages and community
reports and were not checked on a box. Alt-F data from its release notes
(`legacy/alt-f/NEWS`) and build configuration in this repository. Sources:
[CVE-2024-3273](https://cve.circl.lu/vuln/cve-2024-3273),
[D-Link storage security notice](https://www.dlink.com/de/de/support/storagesecurity),
[DNS-320L boot loader banners](https://hackaday.io/project/179084-rebuilding-the-linux-for-dns-320l-nas).

**Installing:** flash the ShareOS `.bin` from the Alt-F or D-Link firmware
page; ShareOS then installs its system from a USB stick or from GitHub by
itself (since 0.1.0-beta.7, tested on the DNS-320L). The way over the
serial console (TFTP boot) stays available. **Back to Alt-F** works from the
ShareOS firmware page. Details: [docs/TESTING.md](docs/TESTING.md),
[docs/HARDWARE-DNS320L.md](docs/HARDWARE-DNS320L.md). The backend can be run on
a build host with qemu (`tests/run-stack-qemu.sh`), the web interface with
sample data via `tests/mock-ubus.py`.

## Roadmap

- Hardware tests of the current betas, then a public beta
- More native apps in the same store: system apps for the terminal (0.2.0-beta.1), Transmission (0.2.0-beta.4), FFmpeg (0.2.0-beta.5), the media server MiniDLNA and OpenVPN (0.2.0-beta.6), Tailscale (0.2.0-beta.7) and autobrr (0.2.0-beta.9) are there; next Syncthing …
- More of the app platform: "open with" defaults per file type
- Storage: **LVM2**; RAID 5 only makes sense with three or more disks (the DNS-320L has two bays)
- More devices: hardware tests of the DNS-320 rev A/B; the DNS-327L (Armada 370, ARMv7) needs its own kernel configuration and a tester ([#61](https://github.com/UniqueDroid/ShareOS/issues/61))

## Layout

```
configs/                 buildroot defconfigs (shareos_<board>_defconfig)
board/dlink/dns320l/     device tree, kernel fragment, rootfs overlay, image scripts
package/                 ShareOS buildroot packages
src/alt-f-utils/         Alt-F device tools (MCU daemon, dns323-fw, sysctrl)
patches/                 hashes/patches for buildroot packages
src/shareos-core/        backend: rpcd ucode plugin, updater, UCI defaults, init scripts
sysapps/                 system apps (native programs and services) for the store
tests/                   host and emulator tests (updater, network, users/shares, storage, cloud/Paperless, qemu stack), UI mock
scripts/                 helper scripts
legacy/alt-f/            the original Alt-F tree, kept for reference
```

## Apps: where to submit what

- **Web apps** (HTML/JS, run in the browser, use the app SDK) →
  [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps).
- **System apps** (native programs for the box, and services/daemons) → here,
  in [`sysapps/`](sysapps/README.md): they are built with the firmware's
  toolchain, and a service needs its controller in the firmware. The README
  there has an example of each kind.

## Building

See [docs/BUILD.md](docs/BUILD.md). In short:

```sh
make dns320l
# -> output/dns320l/images/ShareOS-<version>-DNS-320L-rev-Ax.bin
```
