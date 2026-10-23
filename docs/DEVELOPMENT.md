# How ShareOS was built – an AI development log

*Deutsche Version: [ENTWICKLUNG.md](ENTWICKLUNG.md)*

ShareOS was developed almost entirely by an AI: **Claude** (Anthropic).
Jan started the project and steered it as a "vibe coder": he set the goals,
made the fundamental decisions and tried everything on the real hardware.
The analysis, the architecture, all of the code, the builds, the tests, the
debugging and this documentation come from Claude.

This document records, with timestamps, how that went. It shows how far an
AI got in October 2026 with real embedded development: old hardware, a
bootloader that must not be changed, and no debugger except a serial console.

![Timeline](images/zeitstrahl.png)

*Each dot is a commit (times in CEST). Generated from the git history by
`scripts/zeitstrahl.py`.*

## Who did what

| | Jan (initiator) | Claude (AI) |
|---|---|---|
| Goals & direction | Modernise Alt-F, a web UI in the style of his intranet, updates from GitHub, cloud, Paperless | Proposals with trade-offs (OpenWrt vs. Alt-F base, CGI vs. rpcd/ucode, partitioning) |
| Decisions | "Replace the old UI completely", "foundation first", "no OpenWrt", as little soldering as possible, a wizard *and* a manual path | – |
| Code | 1 commit: importing Alt-F | 26 commits, about 5,500 new lines (build system, device tree, init, updater, backend, web UI, tests, docs) |
| Hardware | Connected the serial adapter, drove U-Boot, ran commands, sent back logs, installed the disks | Specified every command, read every log, found the causes |
| Tests | The real box (DNS-320L rev A3) | Emulator (qemu-user), test suites with a simulated box and virtual disks |

Once, "Konrad", Jan's local Claude instance, also helped: it looked directly on
the box for why the web server was not running.

## Timeline

### Friday, 16 Oct 2026 – from concept to a new base

| Time | Event |
|---|---|
| ~16:00 | Jan creates the project and imports Alt-F (r3935) into the repo as ShareOS. |
| ~16:20 | **UI concept**: Claude analyses Alt-F's 178 CGI scripts and groups them into 8 areas. The design takes its style from Jan's Skynet intranet. |
| ~16:55 | **Modernisation plan**: inventory (buildroot 2009, kernel 4.14 EOL, uClibc). Decision with Jan: modernise the Alt-F base and adopt OpenWrt's operating model (UCI, ubus, rpcd, ucode), because OpenWrt itself could only be installed through the serial console. |
| 17:10 | **New build base**: buildroot 2026.02 LTS as BR2_EXTERNAL, GCC 14, musl, kernel 6.18 with a ported DNS-320L device tree. |
| 19:10 | The kernel is too big (4.2 MB); the stock U-Boot only loads 3 MB. With xz and a leaner config it fits (2.1 MB). |
| 19:54 | Test through Alt-F's "TryIt"/kexec: the box hangs, even with Alt-F's own kernel. Claude finds the Alt-F author's confirmation that kexec does not work on the DNS-320L. **No way forward without a serial console.** |
| 21:25 | **Core stack**: UCI, ubus, rpcd with a ucode plugin, uhttpd and an updater for GitHub releases, fully tested in the emulator. |

### Saturday, 17 Oct 2026 – on the real hardware

| Time | Event |
|---|---|
| ~11:00 | Jan solders three wires of a USB-TTL adapter to the unpopulated header JP1 (the holes are filled with solder, a pin header does not go in). Claude guides him through the pinout, swapped RX/TX wires and a loose ground. |
| ~12:15 | Stopping autoboot does not work. Claude finds the D-Link quirk in the U-Boot code: **space, then 1**. |
| ~12:30 | TFTP timeouts: the cause is the firewall (ufw) on Jan's PC. |
| 12:44 | **ShareOS boots on the box for the first time**, from RAM, without flashing anything. Gigabit, MAC address, fan, temperature, buttons and the web interface all work. |
| 12:57 | **UBI layout**: the system as squashfs, settings as a UBIFS overlay, a small initramfs with a rescue mode. |
| 13:48 | System written to flash. The settings survive a reboot. The fix for a clean shutdown is in place. |
| 14:11 | Kernel and initramfs flashed: **the box boots ShareOS on its own**, without a PC or console. The Alt-F partitions were backed up first. |
| 14:47 | **Updater for the new layout** and **new web interface** in Skynet style. |
| 15:00–15:44 | The web interface is gone after every boot. Debugging with Jan and Konrad. Claude reproduces the crash in the emulator: every browser request with `If-Modified-Since` crashes `uhttpd` (musl `strptime` with `%Z`). Fixed with a patch. |
| 15:51 | The disks are detected. This confirms the SATA power line that was corrected during porting (gpio0 24 instead of Alt-F's gpio1 24). |
| 16:00 | **Storage**: wizard and manual management (ext4, RAID 1, SMART, spindown, swap, app area). |
| 16:45 | English interface from language files, HTTPS with a self-signed certificate, first-run wizard with Alt-F import, fan and LED settings. |
| 17:20 | The storage tests with virtual disks find a real bug: with two single disks, the second ended up under the first one's name. Fixed before it reached the box. |
| 18:13 | Everything goes to `main`; Jan creates the first release `v0.1.0-beta.1`, GitHub builds the update bundle. |
| 18:26 | The box cannot reach GitHub: "certificate is not correctly signed". Claude's first guess (the network intercepts HTTPS) is wrong – Jan's output shows Google's genuine certificate. Cause: buildroot gives curl with mbedTLS no path to the CA certificates. Workaround via `/root/.curlrc`, fix in the build. |
| 20:15 | **First online update on real hardware:** the box downloads `0.1.0-beta.1` from GitHub, verifies it, writes kernel and initramfs and installs the system on restart. The first-run wizard works without problems. |
| 20:18 | Jan's feedback: after "Install" nothing visible happens. Claude adds a progress bar with the individual steps. |
| 20:31 | New requirements from Jan: menu as in "Haupt-Funktion" (Services → Autostart, System → Network), tile/table view per section, light/dark/system, logo and browser icon in the accent colour. Network settings with automatic rollback so nobody locks themselves out. |
| 22:50 | Jan tests `beta.2` end to end – everything works. Feedback: logo off centre on the login page, Install button stays active, notices at the bottom right go unnoticed. |
| 23:00 | Concept **users, shares, apps**: one account for everything (shares, web interface, apps, cloud). Jan decides: own area "My ShareOS" for users, storage limit per user, cloud sync per device and per user, ksmbd as SMB server. |
| 23:05 | Jan's log shows ECC errors: `blkid`/`lsblk` read the raw flash partitions on every storage query, including D-Link's unreadable "my-dlink". Claude switches the flash block devices off. |
| 23:30 | **Shares (SMB/NFS), users, groups, storage limits, "My ShareOS", backup/restore** (JSON, optionally AES-256). Alt-F users are imported including their passwords. 52 checks in the ARM emulator. |

### Sunday, 18 Oct 2026 – Paperless, cloud and app

| Time | What happened |
|---|---|
| 00:37 | Jan publishes `v0.1.0-beta.3` and goes to bed: "Carry on with the roadmap – cloud, Paperless. I'll test in the morning." |
| 01:00 | **Paperless-ngx**: inbox folders per user (in the personal folder) or shared on a share, e.g. for a scanner. ShareOS uploads new files through the Paperless API, polls the result and shows it. Users enter their own token under "My ShareOS". |
| 01:00 | **Cloud sync with rclone**: rclone is downloaded from GitHub on demand (checksum verified) and lives in the apps area. Accounts (WebDAV/Nextcloud, S3, SFTP or a section from `rclone.conf`) and jobs (upload, download, mirror) with schedule and bandwidth limit – for the device and, if allowed, for each user with their own credentials. 29 checks against a fake Paperless and a local WebDAV server. |
| 01:20 | **Installable as an app** (icon, shortcuts) and a **status address for widget apps** such as KWGT – Chrome offers no home-screen widgets for web apps. |
| 01:40 | Re-running all tests shows that since the cloud work, plain users could not log in: a function was used before the line that defines it (ucode has no hoisting). Fixed before it reached a box; a new CI check now finds such cases automatically. |
| 09:20 | Jan publishes `v0.1.0-beta.4`. Shares, users and groups work "very well" on the box. |
| 10:00 | Jan's feedback: a long field label pushes its input down, file buttons look different from the others, wish for a **file browser** (admin: everything, users: own folder, enabled per user) and an **own look** for users. |
| 10:09 | Question about the update notice: so far only an open web interface checked. Now the box checks by itself every 6 hours. |
| 10:30 | Login text `user@shareos`, certificate follows name and IP. Recommendation instead of a fixed factory IP: DHCP, name via mDNS (`shareos.local`) and a fallback address `192.168.0.32` without DHCP. Jan: "Yes, please." |
| 11:00 | File browser with upload/download through one-time tickets; users' files are read and written with their own rights. A uhttpd patch keeps large transfers from being cut off after 60 s. While testing in the cloud workspace a cleanup step accidentally emptied its `/dev` – the test scripts now only delete when nothing is mounted any more. |
| 11:53 | Jan publishes `v0.1.0-beta.5` and brings roadmap ideas: an app store with Docker/Compose and a notification system. Claude writes a feasibility study: Docker does not fit the DNS-320L (ARMv5, 256 MB, no images); instead "apps light" with native packages, notifications over ubus. Jan: "Containers are out." |
| 12:12 | Jan sends his Webpad: there should be **ShareOS web apps** as installable packages with an app JSON (version, publisher), offered like the firmware versions, from their own repository. Jan creates `ShareOS-Apps`. |
| 12:45 | App repository with the `.sapp` package format, build, one release per version and the catalog `index.json` via GitHub Actions; Webpad 1.0.0 as the first app with its libraries packaged (works offline). In the firmware: APPS area with store, install with SHA-256 check, own web server port for apps, visibility per user, upload of own packages. |
| 13:15 | Jan sends photos of the board and the serial console for the docs (EXIF removed) and asks for README and docs to be updated with every release – `docs/RELEASE.md` now lists that. The "Restart now" button only appears once the progress bar is at 100 %. |
| 13:34 | Question: can ShareOS be flashed from an old D-Link or Alt-F firmware? Jan: "Yes please, a compatible bin from the web interface, the system installed from a USB stick." The ShareOS `.bin` installs the system by itself on the first start – from a USB stick or from GitHub – and System → Firmware can write an Alt-F `.bin` to go back. Tested in the emulator with a simulated flash and damaged and foreign bundles. |
| 15:02 | Jan reports that messages such as "Last update: installed" and "Setup failed: wipefs sdc failed" cannot be closed. They get an **x** and the box forgets them; erasing a disk now reports the reason. |
| 15:10 | Jan: safely remove USB sticks, and a choice of **file system** when formatting – sticks and disks. For disks he picks ext4, Btrfs, exFAT and NTFS, for USB exFAT, FAT32, NTFS and ext4. USB drives are mounted when plugged in and get "Safely remove" and "Format". |
| 16:20 | Jan tests `beta.6`: the APPS area logs admins out – its functions were missing from the access rules; a new CI check makes sure every function is covered. The log was in UTC (musl writes UTC time stamps), now in local time. |
| 16:30 | Jan asks for **time settings under System** and the **10 most spoken languages**. New page System → Time (time zone, NTP with own servers, clock by hand) and eight new languages translated by Claude, Arabic with a right-to-left layout. |
| 17:10 | Paperless fully on the box? Claude's estimate: not feasible on 256 MB RAM and ARMv5 – Jan drops the idea. |
| 18:38 | Jan: web apps need **permissions**, first one: scheduled tasks. Jan picks scripts from the app package, declared in `app.json` and editable in the interface. Permission `cron`: tasks run as the app's own restricted user with a time limit. |
| 18:55 | Jan's idea of a **shared app architecture**: one manifest (window size, file types), shared design tokens with a classic menu bar like Notepad++, and apps talking to each other. Claude writes a concept; Jan decides that apps open in their own window and only settings apps are shown inside ShareOS – as a permission (`embed`). |
| 19:57 | The tag `v0.1.0-beta.7` was set on `main` before the beta.7 changes were merged; Claude notices it before the boxes are offered the wrong version. Jan stops the build and deletes release and tag; beta.7 is then released from `main` – including the beta.8 features, so the changelog moves them. |
| 20:46 | Jan's wildcard certificate for `*.skynet.lan` is refused. Reproduced through the real web-interface path: every own certificate was refused, because the test page of the certificate check was not readable under rpcd's strict umask (uhttpd answered 403). Fixed and covered by a test. |
| 21:36 | Jan: the labels of the menu buttons are not quite centred. Upper-case text keeps empty space for descenders; trimmed to cap height. |
| 22:47 | Jan updates to beta.7: Webpad says "needs a newer ShareOS" – `0.1.0-beta.7` counts as older than `0.1.0`. Fixing it shows a second bug that had not struck yet: `beta.10` would have been older than `beta.9`, so a box on beta.9 would never have been offered beta.10. |
| 23:12 | Jan: firmware updates also **without internet** – the `.sysupgrade.tar` can now be uploaded in the interface, with the same checks as from GitHub. |
| 23:26 | Jan asks what the **reset button** does: nothing so far. Claude suggests 5–10 s = access reset (network, root password, certificate), 15 s = factory reset, LED feedback; Jan: "Great suggestion. Take it. Please carry on with the roadmap. See you tomorrow." |

### Night to Monday, 19 Oct 2026 – Claude alone on the roadmap

| Time | What happened |
|---|---|
| 23:45 | Reset and USB buttons built, tested with recorded input events and on the ARM userland. |
| 00:10 | **App platform**: `window`/`opens` in the manifest, `/_shareos/theme.css` and the app SDK, file tickets – Webpad 1.1 opens a text file from the file browser and saves it back, tested end to end in Chromium. |
| 00:50 | **Storage**: RAID 0 and JBOD besides the mirror, ext3/ext2/FAT32, repair a mirror with a new disk. |
| 01:20 | **Messages**: checks every 10 minutes (RAID, volumes, temperature, SMART, updates), failed jobs report at once; e-mail and push (ntfy, Gotify, webhook). |
| 07:08 | Jan merged WebTerm 1.0.0 and Webpad 1.2.0; the app store released both on its own. |
| 09:10 | Jan's test of beta.9: installed apps without icon, links with the IP instead of `shareos.skynet.lan`. Cause: the interface was opened by IP, apps and icons came from `https://<IP>:8444` – the wildcard certificate does not cover that, and browsers do not ask about images. Fix: icons come with the app list, links use the certificate's name (or one set by hand), the apps web server gets the same supervisor as the interface. |

### Tuesday, 20 Oct 2026 – apps with access to the box

| Time | What happened |
|---|---|
| 08:20 | Jan sends four apps (ShareCommander, WinWeb Player, SheetOS, DevBox). Claude adapts them to the app platform, fixes bugs (SheetOS did not compute formulas, ZIPs were JSON) and tests all of them in the emulator with Chromium. |
| 08:30 | So the player can seek in large files: a small uhttpd patch (Range header to CGI scripts) and byte ranges in the file CGI. |
| 08:34 | Jan: ShareCommander and Webpad should access the box. Claude builds the app permission `files` (`ShareOS.fs`): one grant per app and account, every check in rpcd with the user's rights. ShareCommander now shows folders of the box, Webpad saves there. |
| 08:52 | Jan's next list: internet for apps, Webpad crash on close, switching guide, soldering correction, translations, web terminal, switchable areas, year in dates, cloud services, Telegram. Claude works through it: Telegram bot, Google sign-in through the box (rclone authorize, the address from the browser bar is handed back), areas, ttyd as terminal, about 90 translations with a new check. Found on the way: inside ucode regex classes `\s` is not whitespace but the letter "s" – ntfy addresses were refused. |

| 10:00 | Jan: "nano, htop – I want to see the implementation first. It's an app type of its own." Claude builds the app type `system`: native programs, built with the firmware's toolchain in a second buildroot (external toolchain = the firmware's), packed with their own libraries (ncurses) and terminal descriptions; on the box under `/opt/shareos/sysapps`, a starter per command in `PATH`. nano and htop run in the emulator; a test drives htop in a pseudo terminal. |

| 13:13 | Jan tested beta.12: the terminal shows "Press ↵ to Reconnect" at once; app data of the admin (Webpad) is visible to every user; apps should open files of the box. Claude finds the terminal cause over HTTPS (HTTP/2 without Host header against ttyd's origin check; it worked over HTTP in the emulator), builds per-account browser storage into the app SDK and a file dialog of the box; WinWeb Player plays music from the box. On the way: ShareOS-Apps PR #4 had landed in a side branch instead of `main`. |

| 15:08 | Jan tested the new firmware and apps: terminal, nano, htop, Webpad and WebTerm work. Only: WebTerm opens a closed Webpad in a tab instead of a window. Claude adds `ShareOS.openApp` to the SDK. Jan picks the next version: **0.2.0-beta.1**. |

| 16:06 | Jan: Telegram works on the box. |
| 16:12 | Jan: "Feature lock – clean up, optimize." Claude measures first: in the emulator every page load waited 1.1 s on requests, a store refresh blocked the interface for 8 s (rpcd answers one request at a time), the 5-second status started three programs each time. Results of expensive steps are now kept between calls, the store refreshes in the background. The system loses OpenSSL (ttyd on mbedtls), unused GLib/libevent/libnl parts and tools – 16.2 → 11.6 MB; strace and iperf3 become system apps. |

| 18:48 | Jan: "first the device control per model, then the common Kirkwood build" – and he looks for testers. Claude replaces the DNS-320L wiring with model descriptions (`board.sh`: MCU or kernel sensors, polled or interrupt buttons, LED names, power-off, RTC, firmware name/signature) and builds one kernel with four device trees: a `.bin` and a bundle each for DNS-320L, DNS-320 rev B, DNS-320 rev A and DNS-325. Tester guide: DEVICES.md. |
| 22:47 | `v0.2.0-beta.3` with the common Kirkwood build: the same firmware for DNS-320L, DNS-320 rev A/B and DNS-325. |

### Wednesday, 21.10.2026 – services of the box

| Time | What happened |
|---|---|
| 10:13 | **Transmission** as a system app with its own daemon per user; the app controls it through the permission `torrent` (`v0.2.0-beta.4`). |
| 12:38 | **FFmpeg** as a system app and the permission `media`: conversion jobs run in the background on the box; with the app MediaTranscoder. |
| 14:48 | Jan asks for sections in the app store and for bash, rsnapshot and a DLNA server. Store with sections and search, Bash as a system app; at 14:56 Jan publishes `v0.2.0-beta.5`. |
| 15:24 | Jan sends a draft of NetTunnel and asks for the new **system menu** and for services and apps to show their state in the header. Claude makes the box an OpenVPN client (profiles are cleaned on import, admins only) and builds the permission `status` for chips next to *Online*. |
| 15:59 | Jan: NetTunnel should be a **server** too. The box makes its own small certificate authority and a ready-made `.ovpn` per device; a removed device is locked out at once. Tested in the emulator with a real OpenVPN server and client. |
| 16:30 | Instead of rsnapshot Claude builds **snapshots** right into ShareOS (rsync with hard links like rsnapshot, without OpenSSL) and the **media server** (MiniDLNA as a system app, settings under Services). |
| 18:26 | An outside Tailscale PR (ShareOS-Apps #16) only shows demo data, because there is no Tailscale on the box. Jan and Claude reply: the system app and an API in the firmware will come from ShareOS. |
| 19:37 | #37–#40 are merged, everything for `v0.2.0-beta.6` is on `main`. |
| 20:01 | Jan: ShareCommander shows a user only example files like `/etc/hosts`. Cause: users only got their personal folder, and only with "Dateien" ticked. Now they see their shares by rights; Jan's question "is that safe with the user concept?" leads to ACLs: Linux itself enforces the share rights for every program. ShareCommander 1.3 starts on the box. |
| 20:44 | Jan: Transmission only runs for admins. Cause: system apps installed from the web interface landed in a folder only root can read (rpcd works with umask 077); reproduced in the test and fixed. WinWeb Player 1.2 keeps its settings and playlist and plays whole folders of the box. |
| 21:12 | Jan: "What about Tailscale?" (an outside PR only showed demo data). Claude builds Tailscale for ARMv5: 1.98.8 (the newest that builds with buildroot's Go), without what a NAS does not need – 17 instead of 33 MB; in the emulator the daemon runs with about 50 MB RAM. |
| 21:52 | Jan's box has 27.9 MB free on the flash. Jan: "Move them out, create symbolic links – for large apps." System apps over 2 MB go to the drive, `/opt/shareos/sysapps/<id>` is a link there. Plus the permission `tailscale`, `ShareOS.tailscale` and the header chip. |
| 22:59 | Jan publishes `v0.2.0-beta.6`. |

### Thursday, 22.10.2026

| Time | What happened |
|---|---|
| 08:27 | Jan merges NetTunnel, ShareCommander 1.3, WinWeb Player 1.2 and Tailscale; the store shows the new apps. Everything for `v0.2.0-beta.7` is on `main`. |

### Friday, 23.10.2026

| Time | What happened |
|---|---|
| 08:30 | Jan: "it does not start by itself" – `tailscaled` only ran once an app pressed *Verbinden*, and the submitted Tailscale app talked to an interface the box does not have. Claude starts the daemon on install and at boot (ShareOS #48) and ports the app to `ShareOS.tailscale` with a real QR code (ShareOS-Apps #22). |
| 09:22 | Jan: "Can this be simpler with system apps?" Every service had its own init script and its own hook – Jan's rename to `tailscaled` had orphaned exactly that hook. Since then the service is declared in the system app's `app.json` (`"service"`), one init script starts them all, the control stays in the firmware. Jan decides: system apps are submitted to the ShareOS repo, ShareOS-Apps only takes web apps – with one example each for a program and a service. |
| 11:28 | Jan's app ShareNotes goes into the store. His requirement: accounts without "Dateien" should keep their notes on the box too. Jan picks a private folder per app and account on the apps drive; the account's folders, shares and file browser stay closed. |

## Notable problems solved

- **The bootloader's 3 MB limit:** the kernel shrank from 4.2 to 2.4 MB, with drivers moved to modules. The initramfs is only 0.9 MB.
- **No flashing without a way back:** first ShareOS ran from RAM, then from the network, then the system went into flash, and the kernel came last. Every step had a way back (Alt-F backup, D-Link rescue system, rescue mode).
- **U-Boot without documentation:** Claude worked out the abort sequence and the fallback to the rescue system on a broken image from the bootloader's behaviour and memory dump.
- **A hardware detail in the device tree:** Alt-F switched the SATA power through the wrong GPIO controller. Claude caught it while porting; the disks confirmed it.
- **Changing the network without locking yourself out:** a new IP takes effect at once, but the box waits 2 minutes for a confirmation from the new address. If none comes, it restores the old settings (as OpenWrt does). The web interface opens the new address itself and confirms.
- **A crash that only happened in a real browser:** the safeguard (automatic uhttpd restart, logging) came first. The actual cause was a bug in the C library, which Claude reproduced in the emulator and worked around.

## The web interface

The default is the dark blue theme with the logo. Light, dark or "same as the
operating system" and the accent colours blue, green, red and white apply to
all users. The logo and the browser icon take on the accent colour; the logo
can be switched off. Every section with tiles has a switch for a table view at
the right of its heading. The interface is available in German and English.

| Overview (English) | Storage wizard (English) |
|---|---|
| ![Overview](images/gui-en-overview.png) | ![Wizard](images/gui-en-wizard.png) |

| Login | Storage (mirror in initial sync) |
|---|---|
| ![Login](images/gui-login.png) | ![Storage](images/gui-speicher.png) |

| Firmware update | Appearance, language, logo |
|---|---|
| ![Firmware](images/gui-firmware.png) | ![Appearance](images/gui-darstellung.png) |

| Network with rollback, HTTPS | Services → Autostart |
|---|---|
| ![Network](images/gui-en-network.png) | ![Autostart](images/gui-en-autostart.png) |

| Table view | Accent colours, light and dark |
|---|---|
| ![Table view](images/gui-tabelle.png) | ![Colours](images/gui-farben.png) |

| Shares | Permissions per user and group |
|---|---|
| ![Shares](images/gui-freigaben.png) | ![Permissions](images/gui-freigabe-rechte.png) |

| Users | "My ShareOS" for users |
|---|---|
| ![Users](images/gui-benutzer.png) | ![My ShareOS](images/gui-mein-shareos.png) |

| Backup & restore | |
|---|---|
| ![Backup](images/gui-sichern.png) | |

| Paperless | Cloud sync |
|---|---|
| ![Paperless](images/gui-paperless.png) | ![Cloud](images/gui-en-cloud.png) |

| "My ShareOS": Paperless and cloud | App & widgets |
|---|---|
| ![My ShareOS with Paperless and cloud](images/gui-mein-paperless-cloud.png) | ![App and widgets](images/gui-app-widgets.png) |

| File browser (admin) | File browser (user) |
|---|---|
| ![Files](images/gui-en-files.png) | ![Files user](images/gui-dateien-benutzer.png) |

| Own look (user) | Create user |
|---|---|
| ![Look user](images/gui-darstellung-benutzer.png) | ![Create user](images/gui-benutzer-editor.png) |

| App store | Installed apps |
|---|---|
| ![Store](images/gui-apps-store.png) | ![Installed](images/gui-apps-installiert.png) |

| Update with progress | Phone |
|---|---|
| ![Update](images/gui-update-progress.png) | ![Phone](images/gui-handy.png) |

*Screenshots with sample data (`tests/mock-ubus.py`): two 4 TB disks as a
mirror and an update available.*

## Numbers (as of 17 Oct 2026, 16:00)

- Working time: about 6 hours on Friday and 5 hours on Saturday
- 27 commits, 26 of them by Claude
- about 5,500 new lines: build/board 1,300, backend + web UI 2,900, tests 370, docs 500
- 18 updater tests (including a complete install on a simulated box), 21 interface checks in the ARM emulator, storage tests with virtual disks
- 3 solder joints (the serial console), 0 bricked boxes

## How the work was done

Jan wrote in a chat, in German, what he wanted or what he was seeing; often
that was just a pasted console log. Claude worked in a cloud environment with
the repository: it built the firmware, tested it in the emulator, pushed to
GitHub and sent Jan the finished images with exact step-by-step instructions.
Everything that changed the box (flashing, erasing disks) happened only after
Jan's explicit OK.
