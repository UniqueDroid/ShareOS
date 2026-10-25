# Testing and installing ShareOS (DNS-320L)

*Deutsche Version: [TESTEN.md](TESTEN.md)*

As of 2026-10-18, ShareOS is in its **test phase**. There are two ways to
install it:

- **Way A – from the Alt-F or D-Link firmware page** (no serial console, from
  0.1.0-beta.7 on). Tested on real hardware (there and back, 20 Oct 2026) –
  step by step in [SWITCHING.md](SWITCHING.md).
- **Way B – over the serial console** (header JP1, three soldered wires, see
  [HARDWARE-DNS320L.md](HARDWARE-DNS320L.md)): tested, steps 1–3 below.

Once ShareOS is installed, updates go through the web interface. Going back to
Alt-F works from the web interface too (see [Back to Alt-F](#back-to-alt-f)).

## Way A: from the Alt-F or D-Link firmware page

From the GitHub release you need:

- `ShareOS-<version>-DNS-320L-rev-Ax.bin` (kernel and boot system, about 3.3 MB)
- recommended: `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` on a USB
  stick (FAT32, exFAT or ext4; top folder or folder `shareos`). Without a
  stick the box downloads the bundle from GitHub itself – the network cable
  must be plugged in and the router must hand out an address (DHCP).

1. Plug the USB stick with the bundle into the box (if you have one).
2. In the Alt-F (or D-Link) web interface, select the ShareOS `.bin` on the
   firmware page and flash it. Alt-F only writes the kernel and boot system.
3. The box restarts. ShareOS notices that there is no system in flash yet and
   installs it: from the USB stick, otherwise from GitHub (the checksum is
   verified). The **orange USB LED blinks fast**; this takes a few minutes.
   Alt-F's extra packages in flash are replaced.
4. The box then restarts on its own – now with ShareOS. Continue with
   [4. Web interface](#4-web-interface).

If the installation fails (no stick, no network, damaged bundle), the box
stays in **rescue mode** (orange USB LED blinks slowly). The reason is on the
serial console and, over SSH (`ssh root@<ip>`, password `shareos`), in
`/tmp/firstinstall.err`; the log is `/tmp/firstinstall.log`. Fix: copy the
bundle to a USB stick, plug it in, switch the box off and on again.

## Way B: over the serial console

### What you need

- the update bundle `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` from a
  GitHub release
- a USB-TTL adapter (3.3 V) on JP1: pin 4 = box TX, 3 = GND, 1 = box RX; leave
  pin 2 (3.3 V) unconnected. Settings: 115200 8N1
- a PC with a TFTP server, for example `dnsmasq`

### Connecting the serial console (three soldered wires)

JP1 sits next to the USB port and is not populated. A pin header cannot simply
be pushed in: the holes are still filled with solder and would have to be
cleared first (desoldering wick or pump). It is easier to solder three wires
(TX, RX, GND) straight to the pads and leave the 3.3 V pin free. Pin 1 is the
square pad (arrow on the board); there is a gap between pin 1 and pin 2.

| JP1 pinout | What it looks like connected |
|---|---|
| ![JP1 pinout](images/hw-jp1.jpg) | ![JP1 with wires](images/hw-jp1-kabel.jpg) |

| Setup with a USB-serial adapter | Board overview |
|---|---|
| ![Setup](images/hw-seriell-aufbau.jpg) | ![Board](images/hw-platine.jpg) |

On the PC: `screen /dev/ttyUSB0 115200` (or PuTTY/minicom). The adapter must be
set to **3.3 V** – 5 V can damage the box. TX and RX are crossed: the adapter's
TXD goes to pin 1 (box RX), RXD to pin 4.

## 1. Prepare the PC

```sh
sudo mkdir -p /srv/tftp && sudo rm -f /srv/tftp/*
sudo tar xf ShareOS-*.sysupgrade.tar -C /srv/tftp
cd /srv/tftp && sha256sum -c SHA256SUMS
sudo dnsmasq --no-daemon --port=0 --enable-tftp --tftp-root=/srv/tftp --tftp-single-port
```
The PC's firewall must let UDP port 69 through, for example
`sudo ufw allow from <net>/24 to any port 69 proto udp`.

## 2. Boot from RAM (writes nothing)

Power the box on and immediately type **space, 1, space, 1 …** until
`Marvell>>` appears. Then:
```
setenv ipaddr <free ip>
setenv serverip <pc ip>
setenv netmask 255.255.255.0
setenv bootargs shareos.netroot=<pc ip>
tftpboot 0xa00000 uImage
tftpboot 0xf00000 urootfs
bootm 0xa00000 0xf00000
```
Never type `saveenv`. Log in as `root` / `shareos`. Run `shareos-check` to
check the hardware.

## 3. Write the system to flash

On the box, still in the network boot from step 2:
```sh
shareos-install-ubi tftp://<pc ip>/rootfs.squashfs --yes
shareos-flash-boot tftp://<pc ip> --yes
```
- The first command writes the system to the `image` partition. This
  replaces Alt-F's extra packages; Alt-F itself still boots.
- The second command writes the kernel and initramfs. It first backs up
  Alt-F's partitions to `/root/boot-backup`. Copy that backup to your PC:
  `scp -O -r root@<ip>:/root/boot-backup .`

Then `reboot`: the box starts ShareOS on its own.

## 4. Web interface

Open `http://shareos.local` (or `http://shareos.fritz.box`, `http://<ip>`) and
log in as `root` / `shareos`. Change the password right away under
**System → General**.

- The box gets its address by **DHCP** from the router and registers its name there.
- Via **mDNS** it also answers as `<name>.local` (Windows 10/11, macOS, iOS, Android, Linux).
- If no DHCP server answers (box connected straight to a PC), it takes the **fallback address `192.168.0.32`** after about 15 s. Set the PC to e.g. `192.168.0.10/24`. As soon as a DHCP server answers, the box switches by itself.
- The self-signed HTTPS certificate names the hostname, `<name>.local` and the current IP. After a change it is reissued (the browser asks once more).

## 5. Updates

- **Automatically:** the box looks at GitHub every 6 hours. A new release shows up at the top as **UPDATE … available** once GitHub has built the update bundle (about 45 minutes after publishing).
- **From the web interface:** System → Firmware → *Check now*. For test
  versions, choose the **Beta** channel.
- **By hand**, with a bundle on the box:
  ```sh
  cd /tmp && mkdir u && tar xf ShareOS-*.sysupgrade.tar -C u
  shareos-flash-boot /tmp/u --yes
  mkdir -p /overlay/upgrade && cp /tmp/u/rootfs.squashfs /overlay/upgrade/
  cd /overlay/upgrade && sha256sum rootfs.squashfs > rootfs.squashfs.sha256 && echo <version> > version
  sync && reboot
  ```
  During boot the console shows `upgrade: installing system … done`.

Settings and installed packages are kept across updates.

**Versions up to 0.1.0-beta.1:** curl does not find the CA certificates there,
and the check against GitHub reports "certificate is not correctly signed".
Run this once on the box, then the update works (not needed from 0.1.0-beta.2):
```sh
echo 'cacert = /etc/ssl/certs/ca-certificates.crt' > /root/.curlrc
```

## 6. Network

A static IP can be set under **System → Network**. The change takes effect at
once; the box then waits 2 minutes for a confirmation from the new address.
The web interface opens the new address itself and confirms. Without a
confirmation (typo, wrong network) the box restores the old settings. Last
resort: factory reset (DHCP) from the serial console with
`shareos-factory-reset --yes`.

## 7. Shares and users

Create accounts under **Shares → Users** (role, personal folder, storage
limit), share folders under **Shares → Shares** and set permissions per user or
group. Windows: `\\<box>\<share>`, macOS/Linux: `smb://<box>/<share>`. Users
with web access see "My ShareOS" after login (own storage, shares, password,
Paperless, cloud).

## 8. Paperless-ngx

1. In Paperless: Profile → create an **API token**.
2. In ShareOS under **Paperless** enter the address (e.g. `http://192.168.1.20:8000`) and save.
3. **New inbox**: personal (folder `Paperless` in a user's personal folder) or shared (folder of a share, e.g. for the scanner), enter the token, **Test connection**.
4. Put a PDF into the inbox folder. Within 2 minutes (or at once with **Send now**) the log shows "processing", then "accepted", and the document is in Paperless.

Files Paperless rejects (e.g. duplicates) are moved to `.paperless/failed` in
the inbox folder. If Paperless cannot be reached, the file stays and is sent on
the next run.

## 9. Cloud sync

1. **Cloud → install rclone** (downloads rclone from GitHub, needs an apps area).
2. **Add account**: Nextcloud/WebDAV, S3 or SFTP directly; Google Drive, OneDrive, Dropbox: run `rclone config` on a PC and paste the finished section from `rclone.conf`. **Test** shows whether the login works.
3. **New job**: folder on the NAS, account, folder in the cloud, direction (upload is the safe choice, mirroring deletes on the target side), schedule. **Start now** and look at the **log**.

Users may create their own accounts and jobs when "May create own cloud sync
jobs" is set in their account (needs a personal folder). Their jobs run with
their permissions.

## 10. App and widgets

- **As an app:** Chrome and Edge offer "Install app" only over HTTPS with a trusted certificate (e.g. Let's Encrypt, install it under System → Network). Over http:// "Add to home screen" works (bookmark icon). Long-pressing the app icon shows the shortcuts.
- **Widgets:** enable under **System → General → Status for widgets** and copy the address. It returns JSON, e.g.:
  ```sh
  curl "http://<box>/cgi-bin/status?token=<token>"
  ```
  In KWGT (Android) values can be shown with `$wg("<address>", json, ".volumes[0].used_pct")$`. **New key** makes the old address invalid.

## 11. File browser and own look

- **Admins:** Shares → **Files** shows every mounted drive: create folders, upload (also by dragging), download, rename, move, copy, delete.
- **Users:** enable "Dateien" in the user account. "My ShareOS" then has a **Files** tab with the own folder and the shares the user has rights to (from 0.2.0-beta.6, see 14m).
- **Look:** users with web access set light/dark and the accent colour for themselves under **Appearance**. "Same as for everyone" goes back to the admin's choice.
- Test idea: upload a large file (e.g. 1 GB) and download it again. It must not stop after 60 s.

## 12. Apps (store)

- **APPS → Store → Refresh now** loads the catalog from the [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps) repository. **Install** next to **Webpad**: the box downloads the package, checks its SHA-256 and installs it.
- **APPS → Installed → Open ↗** starts the app in a new tab on port **8081** (8444 with HTTPS) – deliberately another address than the admin interface.
- **Users** decides who sees the app in "My ShareOS" (everyone, single users, groups).
- **Own app:** upload a `.sapp` file under Store → *Install package* (built with `tools/build.py` from the app repository). It is marked "own / not verified".
- **More sources** (own catalogs) under APPS → Sources.
- **Scheduled tasks** (from beta.7, for apps with the permission `cron`): the install dialog lists the permissions. **APPS → Installed → Tasks** shows schedule, on/off and the last run; *Run now*, then *Log* shows the output. A changed schedule stays after an app update. Check with `crontab -l` (line `shareos-apps run-job`) and `ps` (the job runs as user `app-<id>`).

## 12a. Update without internet

- Download `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` and its `.sha256` from a release on the PC.
- **System → Firmware → Install firmware file**: choose the `.tar` as *File* and the `.sha256` as *Checksum*, **Upload & check**. After about half a minute the update panel shows "<version> install" with "Uploaded file – verified …".
- **Install**, then **Restart now** – the same as an update from GitHub.
- Wrong `.sha256`, a file for another device or a damaged file are refused with a message.

## 13. File systems and USB drives

- **Storage → Wizard**: in the "Name" step every volume gets a choice of **ext4** (recommended, everything), **Btrfs** (no storage limit per user), **exFAT** and **NTFS** (also readable on Windows/macOS; no permissions per user, no storage limit, no personal folders, no apps). The summary shows the chosen file system. "Erase & format" on a disk has the same field.
- **Plug in a USB stick**: it shows up under Storage → Disks as "USB · sdX" and is mounted at `/mnt/usb-<name>` after a few seconds (FAT32, exFAT, NTFS, ext4, Btrfs). Admins see it in the file browser.
- **Safely remove** writes everything, unmounts and powers the stick down, then shows "sdX can be unplugged now". If a stick is pulled without it, ShareOS cleans up the mount point.
- **Format** (on a USB drive): choose a name and a file system – **exFAT** (recommended), **FAT32**, **NTFS** or **ext4**. The stick gets one partition (MBR) so every computer, camera and TV can read it.
- The disks in the bays are never mounted automatically; the USB functions do not touch them.

- **Two disks:** besides "Mirror (RAID 1)" and "two separate volumes" the wizard offers **RAID 0** and **JBOD**; the summary shows the size (RAID 0: twice the smaller disk, JBOD: both together). `cat /proc/mdstat` shows `raid0` or `linear`.
- File systems **ext3**, **ext2** and **FAT32** can be chosen for disks too (FAT32: files up to 4 GB).
- **Repair a mirror:** with a disk of a mirror missing (card: "one disk missing (U_)") and a disk in the free bay, *Repair mirror* erases that disk and adds it; the card then shows "Recovery … %".
- **Mirror after a reboot (disks that spin up one after the other, e.g. DNS-325):** reboot with a complete mirror several times; each time `cat /proc/mdstat` shows `[2/2] [UU]` and `dmesg | grep md/raid1` shows "active with 2 out of 2 mirrors", even when the second disk comes up seconds later (`dmesg | grep 'SATA link up'`). With one disk pulled the box waits up to 40 s, then starts the mirror with one disk and logs "RAID incomplete after 40s" (`grep shareos-storage /var/log/messages`).

## 14. Time and languages

- **System → Time:** the box's clock runs live in its time zone. Change the time zone, switch NTP off and on, enter own time servers (e.g. `fritz.box`), *Sync now*. With NTP off the clock can be set by hand or taken from the browser. Logs then show the local time.
- **System → Appearance → Language:** 10 languages (English, German, Chinese, Hindi, Spanish, French, Arabic, Bengali, Portuguese, Russian). Arabic switches the page to right to left. Translations other than German/English are machine-made – please report mistakes.

## 14a. Open files in apps

- Install **Webpad 1.1** (store). In the file browser a `.txt` file shows **Webpad ↗**; click it (or the file name): Webpad opens in its own window with the file.
- Change something, **Ctrl+S**: the message says "saved"; the file browser shows the new size and time. Owner and rights of the file stay.
- Look: switch light/dark or the accent colour in ShareOS – an open app follows.
- Users with a personal folder can do the same with their files.

- **Name and icons (beta.10):** open ShareOS by its IP (`https://10.241.1.106`). Under **Apps → Installed** Webpad and WebTerm show their icon. **Open** starts the app under the certificate's name (`https://shareos.skynet.lan:8444/…`) without a certificate warning. **System → Network → Box name for links** shows the name from the certificate as suggestion; a name of your own is saved there, empty = automatic.

- **Seeking (beta.11):** open a large MP3 or MP4 file with **WinWeb Player ↗** in the file browser: it starts at once and the slider jumps to any position.

- **File access for apps (beta.11):** install ShareCommander 1.1 and Webpad 1.3 from the store – before installing it says "Access to files". Open ShareCommander: the right pane shows `BOX:// <volume>`. Copy a file from the left pane (browser) to the box with **F5**, **F7** new folder, **F2** rename, **Del** delete – everything shows up in the ShareOS file browser. Open a text file of the box with **F4** in Webpad, change it, Ctrl+S: the file on the box is changed. Try *File → Save to the Box…* in Webpad. As a user without a personal folder ShareCommander only shows the browser file system.

## 14b. Messages

- **System → Messages**: e-mail (mail server, STARTTLS/SSL, user, password, sender, recipients) and/or push (ntfy: `https://ntfy.sh/<topic>`, subscribe to the topic in the ntfy app; Gotify: server and app token; webhook). **Save**, then **Test message** – it must arrive.
- Provoke a message: pull a disk of a mirror (or wait for a real one) – within 10 minutes "RAID md0 degraded" appears, the header shows "1 MESSAGE" and it is sent. After the repair it is shown as resolved.
- Check by hand: `shareos-notify check`, list: `shareos-notify list`.

## 14c. New in beta.12

- **Terminal:** System → Terminal → *Open terminal*: a root shell appears in the window (e.g. `uptime`, `tail /var/log/messages`). *End* or leaving the page ends it.
- **Areas:** System → Appearance → Areas: switch *Cloud* off – the CLOUD tab disappears, scheduled cloud jobs no longer run. Switch it on again.
- **Telegram:** System → Messages → Push → service *Telegram (bot)*: enter the bot token from @BotFather, save, write to the bot, *Find chat ID*, save, *Test message*.
- **Cloud:** Cloud → add account → *Google Drive*: "Sign in at Google Drive ↗", sign in, paste the address from the browser bar (http://127.0.0.1:53682/…), *Apply*, *Add*, *Check*.
- **Language:** System → Appearance → language *English*: click through all pages – no German should be visible.

## 14d. System apps (0.2.0-beta.1)

1. Apps → Store → *Install package*: choose `nano-8.7.0.sapp`, *Upload & install*. Same with `htop-3.4.1.sapp`.
2. Apps → Installed: both with the tag "System app · terminal" and the button *Terminal* (no *Open*, no *Users*).
3. System → Terminal shows "From system apps: nano · htop". *Open terminal*:
   - `htop` – processes, CPU and memory appear in colour; quit with `q`.
   - `nano /tmp/test.txt` – type something, save with Ctrl+O, Enter, quit with Ctrl+X; `cat /tmp/test.txt`. Umlauts (äöü) must look right.
   - `which nano` → `/opt/shareos/bin/nano`.
4. The same over SSH (`ssh root@<box>`, then `htop`).
5. Firmware update (or reboot): nano and htop are still there.
6. Apps → Installed → htop → *Remove*: `htop` in the terminal → "not found".

## 14e. Apps per account and files of the box (0.2.0-beta.1)

1. Install Webpad 1.4 and WinWeb Player 1.1 (store, or the `.sapp` files).
2. As **root**: open Webpad, type "secret of root", close the window.
3. Sign out, sign in as a **user** (with web access), open Webpad from *My ShareOS*: the text of root is **not** there. Type something, close.
4. As root again: Webpad shows "secret of root".
5. WinWeb Player → **+ From the box**: a dialog with your folders (user: personal folder; root: volumes and USB drives). Choose a folder with MP3s, select several with Ctrl+click, *Open*: they are in the playlist, play at once, the slider seeks. **+ From this computer** still works.
6. WebTerm: `webpad <file>` while Webpad is closed – Webpad opens in its **own window** (not a tab) with the file.
7. System → Terminal over **HTTPS** (`https://<box>/`): the shell appears (no "Press ↵ to Reconnect").

## 14f. Feature lock (0.2.0-beta.2)

1. Click through all pages: everything as before, pages appear faster (above all *Apps*, *System → Services*, the overview after signing in).
2. Apps → Store → *Refresh now*: the interface stays usable while the store asks its sources; the list updates by itself.
3. System → Terminal over HTTPS: works (now with mbedtls instead of OpenSSL).
4. Install `strace-6.19.0.sapp` and `iperf3-3.20.0.sapp` if needed: `strace -V`, `iperf3 -s` in the terminal.
5. Time zone, certificate (System → General), users and storage limits, messages: unchanged.

Telegram (14c) has been tested on the real box on 20 Oct 2026: bot, chat ID and test message work.

## 14g. Models (0.2.0-beta.3)

On the DNS-320L everything must work as before:
1. System → About: device "D-Link DNS-320L rev A", firmware name `DNS-320L-rev-Ax`, no "not tested yet".
2. System → Terminal: `shareos-boardinfo` lists `BOARD_ID="dns320l"`, `BOARD_CONTROL="mcu"`; `cat /tmp/sys/board.env`.
3. Fan presets, temperature, status LED, disk LEDs, power button, reset and USB button, time after a restart without network – as before.
4. System → Firmware → *Install firmware file* with `ShareOS-<ver>-DNS-325-rev-Ax.bin`: refused ("the file is for another device …").
5. An update from GitHub picks the `DNS-320L-rev-Ax` files.

Other models: [DEVICES.md](DEVICES.md) (tester guide).

## 14h. Transmission per account (0.2.0-beta.4)

Needs a drive (Storage) and the files `transmission-daemon-4.1.0.sapp` (release of the firmware) and `transmission-1.1.0.sapp` (app store, or from the ShareOS-Apps release).

1. Apps → Store → *Install package*: `transmission-daemon-4.1.0.sapp`, then `transmission-1.1.0.sapp` (or Transmission from the store). The install dialog shows "Own torrents (Transmission)".
2. As **root**: open Transmission. After a few seconds "● Verbunden"; *Einstellungen* shows the download folder `daten/Downloads` (your volume) and the peer port 51413.
3. *+ Torrent* → link tab: a magnet link (e.g. of a Linux ISO), *Durchsuchen* → choose a folder, *Hinzufügen*: it downloads into that folder.
4. Sign in as a **user** with web access and file browser, open Transmission from *My ShareOS*: an empty list (root's torrents are not there), download folder "Mein Ordner/Downloads". Add a torrent: the files belong to the user (file browser).
5. In the terminal: `ps | grep transmission-daemon` – one daemon per account (root and the user); `ls /tmp/shareos-transmission/`.
6. Restart the box: the torrents go on by themselves, without opening the app.
7. Apps → Installed → transmission-daemon → *Remove*: the daemons stop, the app shows "Der Transmission-Dienst ist nicht installiert". Downloads stay.

## 14i. Converting media with FFmpeg (0.2.0-beta.5)

Needs a drive, some media on it (a video, e.g. `.mkv` or `.mp4`, and a music file) and the files `ffmpeg-6.1.5.sapp` (release of the firmware) and `mediatranscoder-1.0.0.sapp` (app store, or from the ShareOS-Apps release).

1. Apps → Store: install MediaTranscoder (brings the system app `ffmpeg` along) – or *Install package* with `ffmpeg-6.1.5.sapp`, then `mediatranscoder-1.0.0.sapp`. The install dialog shows the permission "Convert media (FFmpeg)".
2. As **root** open MediaTranscoder: "FFmpeg bereit" at the top right.
3. *Datei wählen …* → a video: length, size, video and audio tracks appear; preset is *Container wechseln* to MP4 (MKV for an MP4 file). *Umwandeln starten*: the job runs with progress, the new file is in the same folder and plays in WinWeb Player (*Im WinWeb Player abspielen*).
4. *Audio umwandeln / herausholen*, format MP3, 192 kbit/s, *Ausschnitt* from `00:01:00`, length `30`, change the target folder: a 30 s MP3 in the chosen folder. On the box this takes about as long as the piece itself or less.
5. Start a long job and *Abbrechen*: state "abgebrochen", no (half) file in the folder (no hidden `.name.<id>.mp3` either).
6. The same file name again: "Eine Datei mit diesem Namen gibt es im Zielordner schon." – nothing is overwritten.
7. As a **user** with web access and file browser: MediaTranscoder in *My ShareOS*, only the own folder can be chosen, root's jobs are not shown; the result belongs to the user (file browser).
8. In the terminal during a job: `ps | grep ffmpeg` – runs with `nice` 19; `ls /tmp/shareos-media/jobs/`.
9. Apps → Installed → ffmpeg → *Remove* (asks, because MediaTranscoder needs it): running jobs stop, the app shows "FFmpeg fehlt".

**Store sections and Bash (0.2.0-beta.5):** Apps → Store: under "Available apps" the sections (Media, Network, Tools, System …) with counts; a click shows only that section, *All* everything again; "Search …" filters while typing. Install Bash from the store (section Tools), in the terminal `bash`, then `echo $BASH_VERSION` → `5.2.37…`, `exit`.

## 14j. Snapshots (0.2.0-beta.6)

Needs two drives with ext4 or Btrfs (e.g. the disk and a USB disk) and a share with some files.

1. Storage → **Snapshots** → *Neuer Snapshot-Auftrag*: name `fotos`, *Was sichern* = the share, *Ziel-Laufwerk* = the other drive, *Täglich* 03:15, keep 3 · 7 · 4 · 6, exclusion `*.tmp` → *Speichern*. A FAT32/exFAT drive is greyed out as a target.
2. *Jetzt sichern*: "läuft", then "OK" with the number of files and the size. The first snapshot copies everything – with many GB that takes a while (disk to disk about as long as copying).
3. In the share change a file, delete one, add one; *Jetzt sichern*: "N geändert" is small, the second snapshot is quick.
4. *Snapshots (2)* → on the older one *Im Dateibrowser öffnen*: the deleted file is there, with the old content of the changed one. Copy the file back into the share.
5. In the terminal: `du -sh /mnt/<target>/Snapshots/fotos/*` – the second snapshot takes almost nothing (hard links); `ls -ld /mnt/<target>/Snapshots` → `drwx------ root`.
6. Save a big folder, after a few seconds *Stopp*: "abgebrochen"; the next *Jetzt sichern* continues.
7. *Protokoll* on the job: the rsync summary. Unplug the target USB disk, *Jetzt sichern*: "Fehler" and a message (bell, e-mail/push if set up).
8. `cat /etc/crontabs/root`: a line `15 3 * * * /usr/sbin/shareos-snapshot run fotos`. The next morning the snapshot of 3:15 is there.
9. *Entfernen* → "Snapshots auch löschen?" → *Snapshots löschen*: job and folder are gone.

## 14k. Media server (0.2.0-beta.6)

Needs a drive with a share with music (MP3/FLAC) and one with videos (MP4/MKV) and the file `minidlna-1.3.3.sapp` (release of the firmware; or MiniDLNA from the store). Plus a TV or VLC in the same network.

1. Services → **Medienserver**: without the system app a hint with *Im Store installieren*. Install MiniDLNA (store or *Install package*).
2. *Einstellungen*: music share → "nur Musik", video share → "nur Videos", name e.g. "Wohnzimmer", *Medienserver eingeschaltet* → *Speichern*: "läuft", "liest Ordner ein …", the numbers go up.
3. VLC (View → Playlist → Local Network → Universal Plug'n'Play) or the TV (sources/media server): "Wohnzimmer" shows up, music and videos play, seek in a video.
4. Copy a new file into the music share: after a short while "Musikstücke" counts one more, without a restart.
5. Services → Status: "Medienserver (DLNA)" runs; restart the box: the server starts by itself and does not read everything again (the library is in `/mnt/<drive>/.shareos/minidlna`).
6. *Alles neu einlesen*: "liest Ordner ein …", afterwards the same numbers.
7. Switch it off → *Speichern*: TV/VLC no longer see the server (after a few minutes).
8. Apps → Installed → minidlna → *Remove*: the server stops, the page shows the hint again.

## 14l. VPN with NetTunnel (client and server) and header indicators (0.2.0-beta.6)

Needs an OpenVPN profile (`.ovpn`, e.g. from the office router or a VPN provider) with embedded certificates, the file `openvpn-2.6.20.sapp` (release of the firmware) and NetTunnel (store or `nettunnel-1.0.0.sapp`).

1. As **root**: Apps → Store → install NetTunnel (brings `openvpn` along). NetTunnel opens inside the interface.
2. *Vom Computer …* → the `.ovpn`: keep the name; if the profile asks for a login, enter user name/password → *Einspielen*. If the profile had e.g. an `up` script, NetTunnel says "Entfernt: up".
3. *Verbinden*: after a few seconds "VPN verbunden" with the tunnel address; in the header of the ShareOS interface the chip **VPN · 10.x.x.x**, a click opens NetTunnel.
4. In the terminal: `ip addr show tun0`, `ip route` – with "Gesamten Verkehr der Box durch den Tunnel" two routes `0.0.0.0/1` and `128.0.0.0/1` via tun0; without, only the VPN networks. A computer in the VPN network answers `ping`.
5. *Bearbeiten* → *Beim Start der Box verbinden* → restart the box: the connection comes up by itself after about half a minute.
6. A profile with `ca /path/ca.crt` instead of `<ca>…</ca>`: "Das Profil verweist auf Dateien …". A server profile: refused.
7. As a **user** (not admin): NetTunnel is not visible or says "nur für Administratoren".
8. A user's Transmission downloads something → header chip **TORRENT · ↓ 1** (from 0.2.0-beta.7 only while something is downloaded or uploaded; paused: no chip) (admin: own service; user: in "My ShareOS"). System → Appearance → *Anzeigen im Kopf*: untick → the chip disappears (this browser only).
9. Apps → Installed → openvpn → *Remove*: the connection ends, the chip goes.

**Server mode** (reach home from anywhere; needs a phone with the app "OpenVPN Connect" and mobile data instead of Wi-Fi):

10. Install openvpn again, NetTunnel → *Box als Server*. Address in the internet (DynDNS name of the router), port 1194, UDP, VPN network 10.8.0.0, *Server eingeschaltet* → *Speichern*: the first time takes a while (certificates), then "läuft"; header chip **VPN-SERVER · 0 Geräte**. VPN network = home network (e.g. 192.168.1.0): refused.
11. Set up the port forwarding from the hint in the router (UDP 1194 → IP of the box).
12. Name `handy-test` → *Gerät hinzufügen*: `ShareOS-handy-test.ovpn` is downloaded. Bring it to the phone (or *Auf der Box speichern* and fetch it from the share on the phone), import it in OpenVPN Connect, Wi-Fi off, connect.
13. NetTunnel lists the device as "verbunden" with VPN address 10.8.0.2 and traffic; the chip shows **1 Gerät**. On the phone, browser `http://10.8.0.1` → the ShareOS interface.
14. *Auch das Heimnetz erreichbar machen* + static route 10.8.0.0/24 → IP of the box in the router: the phone reaches the router (e.g. `http://192.168.1.1`).
15. *Entfernen* the device: the connection on the phone drops and does not come back. Restart the box: the server runs again by itself.

## 14m. Shares by rights – for apps and Linux too (0.2.0-beta.6)

Needs a drive with ext4 or Btrfs, the users **anna** and **lisa** (role user, "Dateien" switched on) and ShareCommander 1.3 (store).

1. Shares → new share `fotos`: anna *read & write*, lisa *read only*, copy a few files into it.
2. Sign in as **anna** → *My ShareOS* → **Files**: choice "Persönlicher Ordner" and "fotos". Create a folder in `fotos`: works.
3. As **lisa**: "fotos (nur lesen)"; *Neuer Ordner*, *Hochladen*, *Umbenennen*, *Löschen* are greyed out, downloading works.
4. lisa opens **ShareCommander**: left the personal folder, right "🔒 fotos (nur lesen)". **F7** in fotos: "nur lesen – hier darfst du nichts ändern". No `/etc` in the browser storage any more.
5. A user without rights on `fotos` does not see the share anywhere.
6. A user without "Dateien": ShareCommander shows the hint "Kein Zugriff auf die Ordner der Box …" instead of silently showing only the browser storage.
7. Linux level in the terminal (as root): `getfacl /mnt/<drive>/<fotos folder>` shows `user:anna:rwx`, `user:lisa:r-x`, `other::---`. `su -s /bin/sh lisa -c 'touch /mnt/<drive>/<fotos folder>/x'` → "Permission denied".
8. Over SMB from a computer: lisa can read, not write; anna both; lisa can open new files of anna.
9. Change the rights (remove lisa) → after a short while (longer with many files, it runs in the background) lisa has no access any more, not even to subfolders.
10. Over SMB, access through a group: put lisa in a group `familie`, give the share `fotos` to the group (`@familie`) only and remove lisa as a user of it. Sign in from macOS (Finder) as lisa: the share opens (before ksmbd-tools 3.5.3 the Finder said "the original item can't be found").
## 14n. Tailscale and large system apps on the drive (0.2.0-beta.7)

Needs a Tailscale account (free), a phone or computer with Tailscale, the file `tailscaled-1.98.8.sapp` (release of the firmware) and an app with the permission `tailscale` (ShareOS-Apps).

1. Before the update note `df -h /` in the terminal. After the update (restart) the box moves large system apps (FFmpeg, Transmission, MiniDLNA, OpenVPN) to the drive: `ls -l /opt/shareos/sysapps` shows `-> /mnt/<drive>/.shareos/sysapps/…` for them, nano/htop/bash stay folders. `df -h /` shows more free. Transmission, media server and VPN work as before.
2. Apps → Store → system apps → install **tailscaled**: `ls -l /opt/shareos/sysapps/tailscaled` is a link to the drive, `df -h /` hardly changes. Without anything else the daemon runs: `ps | grep [t]ailscaled` (from 0.2.0-beta.9).
3. Open the Tailscale app → *Verbinden*: a sign-in link (or QR code) appears. Open it on the phone, confirm with the Tailscale account. After a few seconds "verbunden", header chip **TAILSCALE · 100.x.y.z**.
4. On the phone (mobile data, Wi-Fi off, Tailscale on): `http://100.x.y.z` → the ShareOS interface; shares over SMB at `\\100.x.y.z`.
5. In the terminal: `ip addr show tailscale0`; `TS_BE_CLI=1 tailscaled --socket=/tmp/shareos-tailscale/tailscaled.sock status` lists the devices. `ps` shows `tailscaled`, `cat /proc/$(cat /tmp/shareos-tailscale/pid)/status | grep VmRSS` – below about 60 MB.
6. Restart the box: after about a minute it is back in the tailnet by itself.
7. In the app *Trennen*: the chip shows "getrennt"; *Abmelden*: the box leaves the tailnet (Tailscale admin console).
8. Apps → Installed → tailscaled → *Remove*: the service stops, the folder on the drive is gone.

## 14o. Apps in the page (0.2.0-beta.7)

1. Apps → Installed → NetTunnel → *Öffnen*: instead of "INSTALLIERTE APPS" the top says "NETTUNNEL", the app below in the full width; the address is `#/apps/run/nettunnel`. No box over the page.
2. Wait a few seconds (the interface refreshes): NetTunnel stays as it is (no reload).
3. *In eigenem Fenster ↗*: NetTunnel opens in a window of its own (without tabs and address bar), the page goes back to the list.
4. Set NetTunnel to *Eigenes Fenster*: *Öffnen* now opens a window. Back to *In der Seite*.
5. Webpad (without `embed`) → *Öffnen ↗*: a window of its own, not a new tab.
6. As a user in "My ShareOS": an app with `embed` opens in the page (`#/app/<id>`), ✕ goes back.

## 14w. Trash in the file browser (0.2.0-beta.12)

1. *Freigaben → Dateien* (or *Mein ShareOS → Dateien* as a user): select a file and a folder, *Löschen* → the dialog says "in den Papierkorb", the entries disappear from the list.
2. *Papierkorb*: both entries with origin and time. Select one → *Wiederherstellen*: it is back in its folder. If a file with that name exists by then, it comes back as `name (2).ext`.
3. *Endgültig löschen* / *Papierkorb leeren* remove for good. In the terminal: `ls -la /mnt/<drive>/home/<user>/.shareos-trash/` (personal folder) or `ls -la /mnt/<drive>/<share folder>/.shareos-trash/`.
4. Below the browser (admins): switch the trash off → *Löschen* deletes at once again (red dialog). Days: 7–90 or never; older entries go when that trash is opened or used next.
5. Over SMB from a PC a deleted file is gone at once (the `.shareos-trash` folder is hidden; leave it alone).

## 14v. Mein ShareOS, "Teilen mit", file dialog with shares (0.2.0-beta.11)

1. Log in as a plain user: the tabs read *MEIN SHAREOS*, (*DATEIEN*,) *EINSTELLUNGEN*. *Einstellungen* has the look on the left and *Passwort ändern* on the right; changing the password works as before. The old address `#/appearance` opens *Einstellungen*.
2. *Mein ShareOS*: *SPEICHER* is a table over the full width – one row per drive with what lies there (personal folder, shares), own use, limit, bar and free space. With a limit the bar shows the share of the limit, without one how full the drive is.
3. "Teilen mit" (Android, Chrome, interface opened with a trusted certificate, e.g. `https://shareos.skynet.lan`): menu ⋮ → *App installieren*. Then share a photo from the gallery → *ShareOS*. ShareOS opens; after the login (if needed) the toast says "1 Datei(en) in „Geteilt“ …" and the file browser shows `Persönlicher Ordner / Geteilt`. In the terminal: `ls -la /mnt/<drive>/home/<user>/Geteilt/` – the file belongs to the user, the folder is `drwx------`.
4. Share the same photo again: it arrives as `name (2).jpg`. Share a link from the browser: a file `Link <date time>.txt` with the address.
5. An account without a personal folder: sharing shows "no personal folder"; the shared item is dropped and does not come back at the next login.
6. File dialog of an app for an account **without** *Dateien* (e.g. Webpad → *Öffnen*): the list of folders shows *App-Daten* first, then *Mein Ordner* and the user's shares; read-only shares are marked and are missing when saving. The app still keeps its own files in *App-Daten*.

## 14u. Permissions sysinfo, netcheck, docker, tuya (0.2.0-beta.11)

Needs the apps SysMon, HomePing and DockerDeck in a version with these permissions (ShareOS-Apps) – or an own test app.

1. As root open SysMon: CPU, memory, temperature and fan match the ShareOS overview; the process list shows e.g. `rpcd`, `uhttpd`, `smbd`/`ksmbd`. Start `sleep 600 &` in the terminal and end it in SysMon: `ps | grep [s]leep` is empty. Ending `rpcd` is refused.
2. HomePing: add the router (ping), the box itself (`tcp` port 22) and a web interface (`http://…`) – green with times. A device switched off turns red.
3. DockerDeck: add a Docker host with its API open (`http://<server>:2375`; on the server e.g. `-H tcp://0.0.0.0:2375`, home network only). The containers appear with their state; *Restart* really restarts a container (`docker ps` on the server), *Log* shows its output.
4. TuyaPulse (version with `tuya`): *Search* finds the Tuya devices on the home network (IP, device id, protocol). Add a device with its local key (from the Tuya cloud, e.g. with `tinytuya wizard`): the switch switches the real device, the state matches the Smart Life app. A wrong local key gives an error. In the terminal the same works with `shareos-tuya discover 6` and `shareos-tuya status <ip> <id> <key> 3.3`.
5. Open them as a normal user (e.g. anna): the apps report "no access".
6. System → Backup: the file contains `dockerhosts`.

## 14t. Personal folder for admins (0.2.0-beta.10)

1. As root open ShareNotes (or another app with `files`) and add a note: the bottom line reads `Box: 🏠 home/notes/`. In the terminal: `ls -la /mnt/<apps drive>/home/root/notes/` shows the note; `/mnt/<apps drive>/home/root` is `drwx------ root`.
2. No new folder `notes` appears at the top of the drive (`ls /mnt/<drive>/`).
3. In root's file browser "Persönlicher Ordner" comes first, then the drives as before.
4. An admin account with its own personal folder (e.g. jan): apps store their files under `/mnt/<drive>/home/jan/`.
5. Move old notes from the top: `mkdir -p /mnt/daten/home/root && chmod 700 /mnt/daten/home/root`, then `mv /mnt/daten/notes /mnt/daten/home/root/` – ShareNotes shows them again.

## 14s. FAV APPS and Appearance (0.2.0-beta.10)

1. As root: Apps → Installed – every web app has a small star at the top right (system apps like nano do not). Click two: the star fills, and the bar **FAV APPS** with both apps appears above "Installierte Apps" (in the order they were marked). In the table view the star is next to the name.
2. Overview: the bar sits directly above "Status". A click on an icon opens the app (in the page or in a window of its own, as set).
3. System → Appearance → **FAV APPS**: "Namen unter den Symbolen zeigen" off → icons only; "App-Leiste anzeigen" off → the bar is gone from the overview and Apps. Switch it on again. In the terminal: `uci show shareos.ui | grep fav`.
4. Log in as a user (e.g. anna): My ShareOS → My apps has stars; a favourite appears as a bar at the top. anna's favourites are independent of root's; Appearance → both switches only affect anna (`uci show accounts.anna | grep fav`).
5. Appearance in a wide window: the panels stand in two columns; narrow window (or phone): one below the other, full width.
6. The tabs Apps, Cloud and Paperless no longer show "NEU".
7. Log in over SSH: the greeting reads `ShareOS 0.2.0-beta.10 on <model>: web interface http://<ip>/, link … Mbit/s.` (no "test system", no password).

## 14r. autobrr (0.2.0-beta.9)

Needs an apps drive, the system apps `autobrr` and `transmission-daemon` and an app with the permission `autobrr` (ShareOS-Apps).

1. Apps → Store → system apps → install **autobrr**. After about a minute: `ps | grep [a]utobrr` shows the service as the user `autobrr`; Services → Status: "Download-Automatik (autobrr)" running.
2. In the terminal: `/usr/sbin/shareos-autobrr status` – `"ready": true`; `ls -la /mnt/<drive>/.shareos/autobrr` belongs to `autobrr` (0700), `/etc/shareos/autobrr/secret.json` root only.
3. In the app choose the account for the hand-over (e.g. anna): `ls -ld /mnt/<drive>/.shareos/autobrr-drop` → `drwxrws--- anna autobrr`. Restart anna's Transmission: its `watch-dir` is that folder.
4. Switch the web interface on and set a password: `http://<box>:7474` opens autobrr, sign in with `admin` and the password. Add an indexer/IRC and a filter with the action *Watch dir* → `/mnt/<drive>/.shareos/autobrr-drop`.
5. Copy a `.torrent` file into the hand-over folder for a test (as root, `chown anna:autobrr`): it disappears after a few seconds and is in anna's Transmission.
6. `cat /proc/$(cat /tmp/shareos-autobrr/pid)/status | grep VmRSS` – about 40–60 MB. Restart the box: autobrr runs again. In the app: switched off → stays off, also after a restart.

## 14q. App folders for accounts without "Dateien" (0.2.0-beta.9)

1. Users → an account (e.g. lisa) with web interface but **without** "Dateien".
2. Sign in as lisa → My ShareOS → open ShareNotes: no notice "Kein Zugriff auf die Ordner der Box", the bottom line says `Box: 🏠 app/notes/`.
3. Create a note. In the terminal (as root): `ls -la /mnt/<apps drive>/.shareos/userdata/lisa/notes/notes/` shows `note_….json`, owner lisa; the folder `userdata/lisa` is `drwx------`.
4. As lisa: My ShareOS still shows no file browser; over SMB the folder is not visible.
5. Restart the box or open the app again: the note is still there (also in another browser).
6. Apps → Installed → remove ShareNotes: `userdata/lisa/notes` is gone. Delete the account lisa with "delete data": `userdata/lisa` is gone.

## 14p. Services of system apps (0.2.0-beta.9)

1. After the update in the terminal: `ls /etc/init.d` shows `S90services`, no more `S93tailscale`, `S94vpn`, `S95transmission`, `S96dlna`; `/usr/lib/shareos/apphooks` is gone.
2. `shareos-apps services list` lists the installed services, e.g. `tailscaled` with `control` `tailscale`. Packages from before beta.9 show `"legacy": true`.
3. Services → Status: Remote access (Tailscale), VPN (OpenVPN), Torrents (Transmission), Media server (DLNA) – depending on the installed system apps – with "läuft" / "gestoppt". Tailscale *Stop*: `ps | grep [t]ailscaled` is empty; *Start*: runs again.
4. Services → Autostart: untick *starten* for Tailscale, restart the box: `tailscaled` does not run. Tick it again, restart: it runs (the box is back in the tailnet by itself).
5. After a restart in the system log (`grep shareos- /var/log/messages`): `shareos-services` reports the started services, the controllers (`shareos-tailscale`, `shareos-transmission` …) their output.
6. Remove the system app *tailscaled* and install it again: the service stops, and runs right after installing.
7. Upload an own system app with `"service": { "control": "nothere" }`: refused with "this ShareOS has no service controller".

## 15. Buttons

- **Reset button** (pin hole at the back), hold and let go:
  - shorter than 5 s: nothing;
  - **5–10 s** (orange USB LED blinks slowly): **access reset** – network back to DHCP (fallback `192.168.0.32`), root password `shareos`, web interface over http again with a new self-signed certificate; users, shares, apps and data stay; the box restarts;
  - 10–15 s (LED off): cancelled;
  - **15 s or longer** (LED blinks fast): **factory reset** – all settings and installed packages are removed, the data on the disks stays.
- **USB button** (front): safely removes all USB drives.
- What happened is in the system log (`shareos-buttons`).

## Back to Alt-F

1. Have the Alt-F `.bin` for the DNS-320L ready (e.g. `Alt-F-1.0-DNS-320L-rev-A.bin`).
2. In ShareOS, upload it under **System → Firmware → Install firmware file**.
   ShareOS checks it (D-Link format, checksums, device, size) and shows what
   is inside.
3. **Install** – kernel and boot system are written and read back. Then
   **Reboot**: Alt-F starts.
4. Alt-F then runs without its extra packages. Flash the same `.bin` once
   more from Alt-F's firmware page to get them back.

Back to ShareOS: flash the ShareOS `.bin` from Alt-F. As long as Alt-F has not
overwritten the `image` partition (step 4 skipped), the ShareOS system and
settings are still there; otherwise ShareOS installs itself again as in way A.
The D-Link firmware is best installed from Alt-F.

## If something goes wrong

| Sign | Meaning / fix |
|---|---|
| The orange USB LED blinks | Rescue mode: the reason and the SSH address are on the console. `shareos-install-ubi` is available there. |
| U-Boot reports a bad image header | U-Boot boots the D-Link rescue system on its own. Flash Alt-F from its web page. |
| The kernel hangs | Boot over TFTP as in step 2 and write the backup back: `flash_erase /dev/mtd1 0 0; nandwrite -p /dev/mtd1 uImage.bin` (mtd2 with `ramdisk.bin`) |
| Back to Alt-F completely | Easiest from the web interface (see [Back to Alt-F](#back-to-alt-f)). Without it: write the backup back (row above), then re-flash Alt-F's extra packages from Alt-F |

ShareOS never touches U-Boot, the MAC address or the D-Link rescue system.
