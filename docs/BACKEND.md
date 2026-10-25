# ShareOS backend

The ShareOS backend follows OpenWrt's operating model on top of the
buildroot base: **UCI** holds the configuration, **ubus** connects the
services, **rpcd** provides sessions/ACLs and runs the ShareOS logic as
**ucode** plugins, **uhttpd** serves the web UI and exposes ubus as
JSON-RPC on `/ubus`.

```
Browser ──HTTP──► uhttpd ──/ubus (JSON-RPC)──► rpcd ──► shareos.uc (ucode)
                   │                             │         ├─ shareos.system
                   └─ /www (web UI)              │         └─ shareos.update ──► shareos-update (ucode CLI)
                                                 ├─ session (login, ACLs)        curl/mbedTLS → GitHub
                                                 └─ uci (/etc/config/*)          dns323-fw, mtd-utils
```

## Components

| Component | Source | Package |
|---|---|---|
| uci | github.com/openwrt/uci | `package/uci` |
| ucode | github.com/jow-/ucode | `package/ucode` |
| rpcd | github.com/openwrt/rpcd | `package/rpcd` |
| libubox, ubus, uhttpd | buildroot | – |
| ShareOS backend | `src/shareos-core` | `package/shareos-core` |

Commits of uci/ucode/rpcd are pinned to the same period as buildroot's
libubox (buildroot 2026.08.1), see the `.mk` files.

## Files on the box

| Path | Purpose |
|---|---|
| `/etc/config/shareos` | ShareOS settings (UCI), section `update`: `repo`, `channel`, `api` |
| `/etc/config/rpcd` | web logins (`root`, checked against `/etc/shadow`) |
| `/usr/share/rpcd/ucode/shareos.uc` | ubus objects `shareos.system`, `shareos.update` |
| `/usr/share/rpcd/acl.d/shareos.json` | ACL group `shareos-admin` |
| `/usr/share/rpcd/acl.d/unauthenticated.json` | anonymous clients may only call `session.login` |
| `/usr/sbin/shareos-update` | updater (ucode CLI, also usable from SSH) |
| `/usr/sbin/shareos-usb` | USB sticks/disks: mount on plug-in (mdev), eject, format |
| `/usr/sbin/shareos-flash-bin` | writes another D-Link `.bin` (e.g. back to Alt-F) |
| `/etc/init.d/S12ubus`, `S13rpcd`, `S50uhttpd` | services |
| `/www/index.html` | backend test page (the real UI follows) |

## API

All calls go through `POST /ubus` with JSON-RPC 2.0:
`{"jsonrpc":"2.0","id":1,"method":"call","params":[<session>, <object>, <method>, {args}]}`.
Log in with `session.login {username, password}` using the null session
`00000000000000000000000000000000`; use the returned `ubus_rpc_session`.

| Object.method | Args | Result |
|---|---|---|
| `shareos.system.info` | – | model, release, kernel, uptime, load, memory, temperature (m°C), fan_pwm, eth0 (ipv4, speed, mac), disks |
| `shareos.system.reboot` | – | reboots after 2 s |
| `shareos.update.check` | `channel` (`stable`/`beta`) | releases for this box, `latest`, `update_available` |
| `shareos.update.status` | – | `state` (`idle`, `downloading`, `verifying`, `ready`, `flashing`, `flashed`, `error`), progress, error |
| `shareos.update.download` | `tag` | starts download + verification in the background |
| `shareos.update.apply` | `tag`, `confirm: true` | flashes the verified download in the background |
| `shareos.update.cancel` | – | forgets a download |
| `shareos.storage.setup` | `layout`, `name`/`disks` or `volumes` [{`name`, `disk`, `fs`}], `swap`, `fs`, `confirm: true` | erases disks and creates volumes; `fs`: `ext4` (default), `btrfs`, `exfat`, `ntfs` |
| `shareos.storage.usb_eject` | `disk` | unmounts a USB drive and powers it down |
| `shareos.storage.usb_format` | `disk`, `fs` (`exfat`/`vfat`/`ntfs`/`ext4`), `name`, `confirm: true` | erases a USB drive, one partition (MBR), mounts it |
| `shareos.update.bin_ticket` | – | upload address for a D-Link `.bin` (one-time ticket, 5 min) |
| `shareos.update.bin_info` | – | what the uploaded `.bin` contains: `kind` (`shareos`/`altf`/`other`), kernel name, sizes – or `error` |
| `shareos.update.bin_write` | `confirm: true` | writes kernel + initramfs of the uploaded `.bin`, then removes it |
| `uci.*` | rpcd standard | read/write `/etc/config/shareos` |

## Updater

Releases come from `https://api.github.com/repos/<repo>/releases`. A release
qualifies when it has `ShareOS-<ver>-<fwname>.bin` and `.bin.sha256` assets
(`fwname` from `/etc/shareos-release`, e.g. `DNS-320L-rev-Ax`); drafts are
ignored, pre-releases only on the `beta` channel. Before anything is
flashed:

1. HTTPS with certificate verification (curl + mbedTLS + CA bundle)
2. SHA-256 against the published `.sha256`
3. D-Link container signature must match the box (`dns323-fw -f`)
4. container checksums (`dns323-fw -s`), kernel and initramfs each ≤ 3 MB
   (what the stock U-Boot loads)
5. board check (`/proc/device-tree/model`) and an explicit `confirm`
6. every written partition is read back and compared

Rollback = flash an older release from the list. Still open: signed
releases (detached signature), settings backup before flashing,
persistent configuration (config partition, phase 3).

**Not yet tested on hardware:** the flashing step itself (`flash_erase`,
`nandwrite`, read-back) – it needs the serial console as a safety net first.

## Testing without hardware

```sh
# updater logic against a mock GitHub API (host ucode)
tests/build-host-ucode.sh ~/hostroot
LD_LIBRARY_PATH=~/hostroot/lib tests/test-update.sh ~/hostroot/bin/ucode

# the real ARM userland with qemu-user: ubusd + rpcd + uhttpd
sudo tests/run-stack-qemu.sh output/dns320l 8080 --check   # smoke tests
sudo tests/run-stack-qemu.sh output/dns320l 8080           # http://127.0.0.1:8080/
```

The second one is also the development setup for the web UI.
