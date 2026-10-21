# Changelog

Changes per release (newest first). The section of a version is added to its
GitHub release automatically when the release is built. Test versions are
pre-releases for test devices only.

## 0.2.0-beta.6

- **Snapshots (Storage → Snapshots):** dated states of a share, of the personal folders or of a whole drive on another drive – hourly, every 6 hours, daily or weekly. Every snapshot looks like a full copy; files that did not change are hard links to the snapshot before and take no space twice (rsync `--link-dest`, the way rsnapshot works, without Perl). What to keep: the last N in any case (also those taken by hand) plus the newest of each day, week and month (e.g. 3 · 7 days · 4 weeks · 6 months). Exclusions (`*.tmp`, `/Downloads/`), *Back up now*, stop (the next run continues the half snapshot), list of the snapshots, open one in the file browser to restore, delete one, log, message when a snapshot fails. The snapshots are in `/mnt/<drive>/Snapshots/<job>/<YYYY-MM-DD_HHMMSS>` (root only, 0700); the target needs hard links (ext4, Btrfs – not FAT32/exFAT). A drive saved into itself leaves its `Snapshots` folder out.
- App SDK: `ShareOS.lang` – the language of the ShareOS interface, for apps with their own translations (e.g. Transmission 1.2).
- rsync 3.4 in the firmware (without OpenSSL, 0.2 MB) and `ionice`: snapshots run at the lowest CPU and disk priority.
- **Media server (Services → Media server):** MiniDLNA 1.3.3 (ReadyMedia) as the system app `minidlna` (2.8 MB, in the release as `.sapp`): TVs, receivers, game consoles and apps like VLC find the box in the network (DLNA/UPnP AV) and play music, videos and pictures from the chosen shares – per share everything or only music, videos or pictures, with its own name in the network. New files show up by themselves (inotify); *Read everything again* rebuilds the library. The library is kept on the drive of the apps area, so a restart does not read everything again. The page shows the number of tracks, videos and pictures and the players that were connected. The firmware starts and stops the server (`shareos-dlna`, `S96dlna`); removing the system app stops it. It only reads the folders and shows the chosen shares to every device in the network, without sign-in.
- **VPN client (OpenVPN) for the box:** the system app `openvpn` (OpenVPN 2.6.20, 2.4 MB, in the release as `.sapp`) and the app NetTunnel (ShareOS-Apps) connect the box to a VPN – e.g. to the office or a VPN provider. The kernel now has tunnel support (`CONFIG_TUN`). Profiles (`.ovpn`) are cleaned on import: nothing that runs programs (`up`/`down` scripts, plugins, `script-security` …), no settings of the box itself (log, status, user, chroot, management …), keys and certificates only inline; server profiles are refused. OpenVPN always runs with `--script-security 1`. User name and password for `auth-user-pass` are kept beside the profile (root only, `/etc/shareos/vpn`). Per profile: all traffic of the box through the tunnel, or only the VPN networks (the pushed default route is ignored); one profile can connect when the box starts (`S94vpn`). Removing the system app ends the connection.
- **VPN server (OpenVPN) on the box:** reach home from anywhere – phone or laptop connect to the box. The box makes its own small CA on first use (EC keys with mbedTLS, `tls-crypt` key, valid 10 years, in `/etc/shareos/vpn/server`, root only) and one certificate per device; NetTunnel gives a complete `.ovpn` profile per device for the OpenVPN app. Only known devices get in (`--ccd-exclusive`): removing a device locks it out at once. Settings: on/off (also after a restart, `S94vpn`), address in the internet (DynDNS), port, UDP/TCP, VPN network (not the home network), optionally the whole home network (pushed route + IP forwarding; the router needs a route back). Connected devices with VPN address and traffic; header chip **VPN-SERVER · n Geräte**.
- **Permission `vpn`** for apps (needs `files`): `ShareOS.vpn` – list, status, log, importProfile, set, remove, connect, disconnect, and `ShareOS.vpn.server` – status, set, log, addDevice, profile, removeDevice – through `/_shareos/cgi/vpn`; admin accounts only (a VPN changes the network of the whole box).
- **Status in the header:** next to *Online*, chips show what is running – the VPN (connected, address), the user's Transmission service, the media server (when installed) – and a click opens the app. **Permission `status`** (needs `files`): an app may show one short state of its own (`ShareOS.status.set({ text, state, ttl })`, max. 24 characters, ok/warn/err/info); it disappears by itself after at most 10 minutes unless the app sets it again, and only the account that opened the app sees it. Users see their chips in "My ShareOS". System → Appearance: which chips this browser shows.

## 0.2.0-beta.5

- **Media jobs on the box – FFmpeg as a system app:** `ffmpeg` (FFmpeg 6.1.5 with `ffprobe`, LAME and Opus, about 2.6 MB, in the release as `.sapp`) converts audio and puts videos into another container. The box runs the jobs itself, in the background, one after another, at the lowest priority and with the account's rights (admins: root, like their file browser): files belong to the account, storage limits apply. Videos are not re-encoded – the box's ARM CPU has no FPU, that would take many times the length of the film. The app MediaTranscoder (ShareOS-Apps) uses it.
- **Permission `media`** for apps (needs `files`): `ShareOS.media` – `probe` (format, length, tracks of a file), `start` (a job from fixed choices: `audio` to MP3, M4A/AAC, Opus, FLAC, WAV or the track as it is; `remux` to MP4, MKV, MOV, TS, WebM; cut with start and length), `jobs` (state and progress), `cancel`, `remove` – through `/_shareos/cgi/media`. No ffmpeg command line from an app reaches the box: the box builds the arguments, reads and writes only inside the account's folders, never overwrites a file (the result appears under its name when it is complete), only local files (no network protocols in this FFmpeg), at most 10 waiting jobs per account. Removing the system app cancels running jobs.
- **App store in sections:** the available apps are grouped by category (Media, Office, Network, Tools, System …) with a filter per section and a search field.
- **Bash** as a system app (GNU bash 5.2, 0.7 MB): `bash` in the terminal; the box's default shell stays ash.

## 0.2.0-beta.4

- **Transmission – every user their own torrents:** the system app `transmission-daemon` (Transmission 4.1.0, in the release as `.sapp`) gives every account its own daemon. It runs with the account's rights (admins: root, like their file browser), keeps its state on the account's drive (not in the flash), downloads into the account's folders and starts again after a restart of the box. The app Transmission (ShareOS-Apps, by @SamuelSilvaG) controls it.
- **Permission `torrent`** for apps (needs `files`): `ShareOS.torrent.rpc(method, args)` reaches the account's daemon through `/_shareos/cgi/transmission`. The daemon has no TCP port for its remote control (Unix socket only); the proxy passes only what a remote control needs – no scripts, no RPC settings, no torrents from local files – and folders only inside the account's own (`<root>/<path>` like `ShareOS.fs`).
- `ShareOS.fs.pick({ folder: true })`: the file dialog of the box chooses a folder.
- **Apps bring what they need:** `"requires": ["transmission-daemon"]` in `app.json` – installing the app installs the required app from the store first (also for an uploaded package); the store asks before removing an app another one needs. System apps (nano, htop, strace, iperf3, transmission-daemon) are in the store catalog now (ShareOS-Apps lists them from the ShareOS releases). Services come only with the firmware: a package never starts a daemon by itself.
- libevent: a request on a Unix socket no longer ends the program (musl's `getnameinfo` does not know `AF_UNIX`).
- **Login page shows the first sign-in** (user `root`, password `shareos`) as long as root still has the factory password; it disappears once an own password is set and comes back after an access reset. The password is public anyway, so the hint gives nothing away (asked in #28).

## 0.2.0-beta.3

- **More models: DNS-320 rev B, DNS-325 rev A, DNS-320 rev A** (not tested on hardware yet – testers wanted, see [DEVICES.md](docs/DEVICES.md)). One kernel, initramfs and system for all Kirkwood boxes; a `.bin` and a `.sysupgrade.tar` per model with its D-Link signature (`ShareOS-<ver>-<model>.*`). The DNS-320L works as before.
- **Model descriptions instead of DNS-320L wiring:** `/usr/lib/shareos/board.sh` describes each model (fan and temperature through the MCU or kernel sensors, power button polled or as a key, LED names, power-off, RTC, firmware name and signature); the box finds its model in the device tree (`shareos-boardinfo`). Fan control, LEDs, buttons, clock, flashing `.bin` files, updates and the first installation use it.
- `.bin` files for another model are refused on every box, and only a box of a known model writes one.
- System → About shows the model and "not tested yet" on models without a hardware test.
- Kernel: lm75 temperature sensor, gpio-fan and gpio-poweroff built in (DNS-325, DNS-320 rev A).
- **Fix: uploading an update package over HTTPS** (System → Firmware, `.sysupgrade.tar`) ended with "HTTP 413": uhttpd took the last part of a request body for an oversized header when it arrived as exactly one full read buffer – over TLS nearly every larger upload. Fixed in uhttpd (`patches/uhttpd/0004`); the emulator test uploads the full package over HTTPS. The fix works from this version on: to get here from an older box, use the update from GitHub, upload over `http://`, or copy the file over SSH and run `shareos-update local <file>`.
- `shareos-update local` run a second time without a file (e.g. over SSH) no longer throws away the package it verified before.

## 0.2.0-beta.2

Feature lock: the system is cleaned up and the interface is faster; the only addition is `ShareOS.openApp` for apps (below).

- **Faster interface:** the box keeps results of expensive steps between calls instead of starting programs again for every request (system info, services, installed apps, certificate, update state, messages, storage limits). In the emulator the requests after loading a page take 0.17 s instead of 1.1 s; the status asked every 5 seconds 45 ms instead of 240 ms; services 90 ms instead of 600 ms; installed apps 50 ms instead of 380 ms.
- **The app store no longer blocks the interface:** refreshing the catalogs runs in the background. Before, a slow or unreachable catalog source held up every other request for seconds (8 s in the emulator).
- **Smaller system (11.6 MB instead of 16.2 MB):** OpenSSL is gone – the terminal uses mbedtls like the web server and curl; unused parts of GLib (GIO/GObject and their tools), libevent, libnl, SQLite shell, SMART daemon, mdmon, gpio and lzo extras, leap-second time zones. A build check makes sure every program still finds its libraries.
- **strace and iperf3** are system apps now (store, `.sapp`) instead of being built in.
- Pictures of the interface (logos, app icons) are 84 KB instead of 340 KB, with the same look.
- Fix: storing the shares list called the share tool twice.
- **Apps open apps in a window:** `ShareOS.openApp(id)` in the app SDK opens another app of the box in its own window (the same one ShareOS uses), with look, language and account – e.g. `webpad <file>` in WebTerm when Webpad is not open yet (WebTerm 1.2 and ShareCommander 1.2 already open a pop-up window on 0.2.0-beta.1; before, a browser tab).

## 0.2.0-beta.1

- **System apps (new app type `"system"`):** native programs for the terminal, from the same store and as `.sapp` like the web apps. They go to `/opt/shareos/sysapps/<id>` (flash, kept across updates); a starter per command in `/opt/shareos/bin` (in `PATH`) brings the app's own libraries and terminal descriptions along, so the base system stays small. A command the firmware has or another app provides is refused. In the store marked "System app · terminal", in the list with "Terminal" instead of "Open"; System → Terminal lists their commands. First ones: **nano 8.7** (text editor) and **htop 3.4.1** (processes, CPU, memory), each about 270 KB.
- **Fix: terminal over HTTPS** (System → Terminal showed "Press ↵ to Reconnect" at once): over HTTPS the browser spoke HTTP/2 with the terminal, which has no Host header, and ttyd's origin check refused the connection. libwebsockets is now built without HTTP/2 – and without "secure streams" and the connection monitor, which asked `connectivitycheck.android.com` in the background.
- **App data per account:** ShareOS tells an app which account opened it, and the app SDK keeps the browser storage of the accounts apart (localStorage and IndexedDB) – what the admin writes in Webpad no longer shows up for another user in the same browser. Old data stays with root. In one browser this separates, it is no hard protection; private data belongs in the user's own folder on the box.
- **File dialog of the box for apps:** `ShareOS.fs.pick()` in the app SDK – apps with the permission `files` open and save files in the user's own area (personal folder; admins: volumes and USB drives). First user: WinWeb Player 1.1 ("+ From the box": music and videos streamed with seeking, besides "+ From this computer").
- The version goes to **0.2.0**: system apps, app data per account and the file dialog are a bigger step than another 0.1.0 beta.
- Build: `make sysapps-pack` builds them with the firmware's toolchain (`configs/shareos_sysapps_defconfig`, recipes in `sysapps/`); the CI attaches them to the release.

## 0.1.0-beta.12

- **Terminal (System → Terminal):** a root shell in the browser (ttyd), in the look of the interface. One window per start, secret address, ends when the window is closed (or after 90 seconds without anyone connecting); over HTTPS with the certificate of the box.
- **Switch areas off (System → Appearance):** Apps, Cloud and Paperless can be switched off – the tab disappears (also in "My ShareOS"), the background work rests (apps web server and app tasks, scheduled cloud jobs, Paperless inboxes); settings and data stay.
- **Messages over Telegram:** bot from @BotFather, token and chat ID; "Find chat ID" reads it from the bot. The token is never on a command line.
- **Cloud:** Google Drive, Google Photos, OneDrive, Dropbox, pCloud, Box and Yandex Disk directly in the list, with sign-in in the browser (no password stored, only a token; the address the browser ends up on after signing in is pasted back). Also Backblaze B2, MEGA, Koofr, FTP and Windows shares (SMB). Gmail is e-mail, not cloud storage – Google Drive or Google Photos are the storage services of Google.
- **Apps may use the internet:** the store shows "Uses the internet" for apps that declare it (`"internet": true`).
- **Translations:** about 90 texts that stayed German in all other languages are translated (cloud, Paperless, storage, update steps, network change, file browser, messages); a new check (`tests/check-i18n-coverage.js`) finds German texts without translation.
- Dates with the year (e.g. "Store as of 20.10.2026, 08:45").
- Fix: addresses containing an "s" were refused in some fields (ntfy push address, e-mail addresses, store sources, Paperless URL) – a regex class problem; a new check prevents it.
- Docs: switching Alt-F ↔ ShareOS step by step ([SWITCHING.md](docs/SWITCHING.md)), tested on real hardware; the serial console needs three soldered wires.

Also in this release (0.1.0-beta.11 was not published on its own):

- **App permission `files`:** an app may work with the folders of the box – exactly those the signed-in user reaches in the file browser (personal folder; admins: all volumes and USB drives), with his rights: list, new folder, rename, copy, move, delete, read and write files. ShareOS shows the permission before installing ("Access to files") and hands the app a grant when it is opened (bound to the app and the account, 8 hours, ends when the app is removed). For apps: `ShareOS.fs` in the app SDK. First users: ShareCommander 1.1 (two-pane file manager on the box) and Webpad 1.3 (open and save on the box).
- **Media files in apps:** files opened in an app (e.g. a video in WinWeb Player) are served in parts on request (HTTP range requests), so a player starts at once and can seek in large files; audio, video and pictures come with their media type. Other files stay a plain download.

## 0.1.0-beta.10

- **Apps open under the box's name:** links to apps (store, file browser, *My ShareOS*) used the address the interface was opened with – an IP address gave a certificate warning on port 8444 although a certificate for the name was installed. Apps now open under the name the installed certificate is valid for (a wildcard certificate `*.skynet.lan` gives `<hostname>.skynet.lan`) or under a name set by hand: System → Network → *Box name for links*. Opened by IP, the HTTPS panel links to the name.
- **App icons** of installed apps are shown again: they come with the app list instead of being loaded from the apps web server (other port, and a browser does not ask about a certificate for images).
- The apps web server (port 8081/8444) is now watched like the interface: it comes back on its own after a crash and after every certificate or network change, always with the current certificate.

## 0.1.0-beta.9

- **Update without internet:** System → Firmware → *Install firmware file* also takes the `.sysupgrade.tar` of a release (best with its `.sha256`). It is checked like an update from GitHub (checksums of all parts, made for this box, sizes) and then installed with the usual button – for boxes without internet or with GitHub blocked. Older and newer versions can be installed this way.
- **Reset button** (back): held 5–10 s = access reset (network back to DHCP with fallback 192.168.0.32, root password `shareos`, web interface over http with a new self-signed certificate; everything else stays), 15 s or longer = factory reset (settings and packages; the data on the disks stays), 10–15 s = cancel. The orange USB LED shows the zone while holding. Before, the button did nothing.
- **USB button** (front): safely removes all USB drives.
- **Open files in apps:** the file browser shows "<App> ↗" next to files an installed app can open (e.g. Webpad for text files); a click on the name opens the file there, in a window of the app's size. The app gets a ticket for exactly this file and the user's rights, saving writes back (owner and rights of the file stay).
- **App platform:** apps declare `window` (size) and `opens` (file types, view/edit) in `app.json`; the apps web server serves `/_shareos/theme.css` (look of ShareOS, light/dark, accent colour, title/menu/status bars like Notepad++, scroll bars) and `/_shareos/app.js` (menu bar, opened file, messages between apps). Apps get the user's look and follow changes.
- New permission **`embed`**: apps that only have settings are shown inside the ShareOS interface instead of their own window.
- **Storage:** the wizard also offers **RAID 0** (both disks as one fast volume) and **JBOD** (both disks one after the other, full space, also for different sizes) besides the mirror; both without redundancy, the wizard says so. File systems **ext3**, **ext2** and **FAT32** for the disks too.
- **Repair a mirror:** when one disk of a mirror is missing or failed, put a new disk into the free bay and click *Repair mirror* – the disk is added and the data copied in the background (progress in the volume card).
- **Messages (System → Messages):** the box checks RAID, volumes (mounted, how full), temperature, SMART values and updates every 10 minutes; failed cloud jobs, app tasks and storage jobs report at once. Messages are listed in the interface (header chip "1 MESSAGE"), can be sent by **e-mail** (SMTP with STARTTLS/SSL) and as **push** to the phone (**ntfy**, **Gotify** or a JSON webhook), each with its own minimum level; repeated messages are counted and sent again at most once a day. Limits for temperature and full volumes are adjustable; *Test message* checks the setup.
- Fix: after installing a certificate the apps web server (port 8081/8444) did not come back until the next restart.

## 0.1.0-beta.8

- Fix: an own HTTPS certificate (e.g. a wildcard certificate of an own CA) was always refused with "certificate and key do not match" when uploaded in the web interface – the check failed because of file permissions, not because of the certificate.
- Main menu: labels are centred vertically in the buttons (before they sat slightly too high).
- Fix: apps with a minimum ShareOS version (e.g. Webpad, "0.1.0") were refused on the betas with "needs a newer ShareOS". A minimum without beta is now met by the betas of that version.
- Fix: versions are compared number by number also in the beta part, so `beta.10` counts as newer than `beta.9` (firmware updates and apps).

## 0.1.0-beta.7

- **Install without the serial console:** flash the ShareOS `.bin` from the Alt-F or D-Link firmware page. On the first start ShareOS installs its system by itself – from a USB stick with the `.sysupgrade.tar` (FAT32/exFAT/ext4) or from GitHub (checksum verified). Not yet tried on real hardware.
- **Back to Alt-F from the web interface:** System → Firmware → *Install firmware file* writes another D-Link `.bin` (e.g. Alt-F); the file is checked (format, checksums, device, 3 MB limit) and read back after writing.
- Tests for both paths (emulator and host).
- Fix: the APPS area logged admins out ("session expired") – its functions were missing from the access rules. A new CI check makes sure every function is covered.
- Fix: the system log used UTC instead of the time zone set on the box.
- Messages such as "Last update: installed" or a failed disk setup can be closed with an **x**; the box forgets them.
- Disk setup: a disk still held by a RAID or another firmware is named in the message; erasing retries once and reports the reason.
- **File system per volume:** ext4 (recommended), Btrfs, exFAT or NTFS in the storage wizard and when formatting a disk; the interface says what each choice means (permissions, storage limit, personal folders, apps).
- **USB sticks and disks:** mounted automatically at `/mnt/usb-<name>` when plugged in (FAT32, exFAT, NTFS, ext4, Btrfs), visible in the file browser for admins, **Safely remove** button, **Format** with exFAT, FAT32, NTFS or ext4. The disks in the bays are never touched by this.
- Tools on board: mkfs for Btrfs, exFAT, FAT and NTFS.
- **System → Time:** time zone, NTP on/off with own time servers (e.g. the router), *sync now*, set the clock by hand (or take the time of the browser); the battery clock of the box is set too.
- Page addresses in English (`#/storage`, `#/shares/users`, `#/system/time` …); old German links and app shortcuts are redirected.
- **10 languages:** English, German, Chinese, Hindi, Spanish, French, Arabic (right to left), Bengali, Portuguese and Russian. Translations other than English/German by AI – corrections welcome.
- **Scheduled tasks for apps** (permission `cron`): an app can declare tasks in its `app.json` (script from the package, schedule, time limit). They run as the app's own restricted user (`app-<id>`), only in its data folder, at most every 5 minutes and up to 5 per app. The install dialog lists the permissions; *Apps → Tasks* changes the schedule, switches tasks on/off, runs them now and shows the last log.

## 0.1.0-beta.6

- **APPS area with a store** for ShareOS apps from [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps): install and update with SHA-256 check, upload own packages (`.sapp`), more catalogs as sources, visibility per user/group, apps in "My ShareOS". First app: Webpad.
- Web apps run on their own port (8081 / 8444) – another origin than the admin interface.
- Firmware update: "Restart now" appears only after the installation has finished; the progress bar ends at 100 %.
- Settings backup also covers Paperless, cloud and apps.
- Docs: photos of the board and the serial console (JP1).

## 0.1.0-beta.5

- File browser: admins for all drives, users for their personal folder (enabled per user); upload/download with progress, drag and drop, large files.
- Own look (light/dark, accent) per user.
- Reachable as `<name>.local` (mDNS); fallback address `192.168.0.32` when no DHCP server answers.
- The box checks for new firmware every 6 hours by itself.
- The self-signed certificate follows hostname and IP address.
- Forms: fields aligned, file pickers look like buttons; login prompt `user@shareos`.

## 0.1.0-beta.4

- Paperless-ngx: inbox folders per user or shared (e.g. for a scanner).
- Cloud sync with rclone (Nextcloud/WebDAV, S3, SFTP, Google Drive …) for the device and per user.
- Installable as an app (PWA) and a status address for widget apps.

## 0.1.0-beta.3

- Shares (ksmbd SMB, NFS) with permissions per user and group, storage limit per user.
- Users and groups, "My ShareOS" for users, import of Alt-F users with passwords.
- Settings backup and restore (JSON, optionally AES-256).

## 0.1.0-beta.2

- Menu after the concept, network page with automatic rollback, services with autostart, tile/table views, light/dark/system look with accent colours.
- Progress for download, check and installation of updates.

## 0.1.0-beta.1

- First test release: runs from flash, storage assistant, web interface, online update from GitHub releases.
