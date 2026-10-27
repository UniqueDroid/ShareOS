# System apps

Native programs for the box (type `"system"`). There are two kinds:

- **Programs** for the terminal (System → Terminal, SSH) or for apps that use
  them as tools – e.g. `nano`, `htop`, `ffmpeg`.
- **Services** (daemons) that run in the background – e.g. `tailscaled`,
  `openvpn`, `transmission-daemon`, `minidlna`.

> **System apps are submitted here, in the ShareOS repository** (folder
> `sysapps/`), because they are built with the firmware's toolchain and a
> service needs a controller in the firmware.
> [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps) only takes
> **web apps**; a web app that needs a system app names it in `"requires"`.

## Building

They are built with the firmware's toolchain (`configs/shareos_sysapps_defconfig`)
and packed as `.sapp` like the web apps:

    make dns320l          # once – makes the toolchain
    make sysapps-pack     # → output/sysapps/sapp/<id>-<version>.sapp (+ .sha256)

Per app, `sysapps/<id>/` holds

- `app.json` – the manifest (`"type": "system"`, `"commands"`, for services
  `"service"`), as on the box;
- `icon.svg`;
- `pack.json` – what goes into the package, paths in the buildroot target:
  `"bin"` programs (become `bin/<name>`), `"share"` folders (become
  `share/<name>`). Libraries the programs need and the firmware lacks are added
  to `lib/` by themselves (read from the ELF headers).

On the box `shareos-apps` unpacks a system app to `/opt/shareos/sysapps/<id>`
and writes a starter for every entry of `"commands"` to `/opt/shareos/bin`
(in `PATH`). The starter sets `LD_LIBRARY_PATH` to the app's `lib/` and
`TERMINFO_DIRS` to its `share/terminfo` if present. System apps over 2 MB go
to the apps drive (`/mnt/<drive>/.shareos/sysapps/<id>`, linked from
`/opt/shareos/sysapps/<id>`), small ones stay on the flash. A system app that
has to work when the apps drive fails says `"flash": true` in its `app.json`
(ShareOS 0.2.0-beta.15+): it stays on the flash up to 8 MB (the Zabbix agent,
which reports exactly such a failure).

**In the store:** CI attaches the `.sapp` files to every ShareOS release;
the catalog of ShareOS-Apps lists them from there (metadata from
`sysapps/<id>/app.json` at the release tag).

## Example 1: a program (no service)

[`docs/examples/sysapps/tree`](../docs/examples/sysapps/tree) – `tree` for the terminal:

```json
{
	"id": "tree", "name": "tree", "version": "2.2.1", "publisher": "Your name",
	"description": { "de": "…", "en": "…" },
	"type": "system",
	"commands": [ "tree" ],
	"icon": "icon.svg", "category": "tools", "license": "GPL-2.0-or-later",
	"min_shareos": "0.2.0-beta.1"
}
```

`pack.json`: `{ "bin": [ "usr/bin/tree" ] }`

Steps:

1. Enable the buildroot package in `configs/shareos_sysapps_defconfig`
   (here `BR2_PACKAGE_TREE=y`); a package buildroot lacks goes to
   `package/<name>/` (see `package/shareos-tailscale`).
2. Copy the example folder to `sysapps/<id>/`, fill in `app.json`
   (`version` = the program's version, descriptions in German and English).
3. `make sysapps-pack` and try the `.sapp` on a box or in the emulator
   (`tests/test-apps.sh` installs the real packages it finds).

A command the firmware has or another app provides is refused. Programs run
with the rights of who starts them; system apps have no permissions, jobs or
windows.

## Example 2: a service

[`docs/examples/sysapps/mosquitto`](../docs/examples/sysapps/mosquitto) – the MQTT broker Mosquitto:

```json
{
	"id": "mosquitto", "name": "Mosquitto", "version": "2.0.22", "publisher": "Your name",
	"type": "system",
	"commands": [ "mosquitto" ],
	"service": { "control": "mosquitto", "on_install": "start", "delay": 5 },
	…
	"min_shareos": "0.2.0-beta.9"
}
```

`"service"` (ShareOS 0.2.0-beta.9+):

| Field | Meaning |
|---|---|
| `control` | the controller in the firmware, `/usr/sbin/shareos-<control>` (required) |
| `boot` | start at boot with `shareos-<control> boot` (default `true`); the controller decides from its settings, e.g. only when switched on. Under *Services → Autostart* it can be switched off by its control name |
| `on_install` | `"start"` or `"boot"`: run right after installing (optional) |
| `delay` | seconds after boot before it starts, 0 … 60 (default 5) – drives and network are up by then |

Removing the app runs `shareos-<control> stop-all`; so does shutting down.
The boot runs from `/etc/init.d/S90services` (`shareos-apps services boot`),
the state shows under *Services → Status*, where it can be started and stopped.

**The controller** is part of the firmware, never of the package – only
reviewed code starts daemons as root. It is a script in
`src/shareos-core/usr/sbin/shareos-<control>` (example:
[`firmware/usr/sbin/shareos-mosquitto`](../docs/examples/sysapps/mosquitto/firmware/usr/sbin/shareos-mosquitto))
and says what it can do in one line:

    // shareos-service: boot start stop-all

- `boot` – start if switched on (settings in UCI, e.g. `/etc/config/<control>`);
- `start` – start now (used by `on_install`);
- `stop-all` – stop everything (app removed, shutdown).

What a controller should do: run the daemon as its own user where it can
(not root), keep its data on the apps drive (not the flash), write a log to
`/tmp/shareos-<control>/log`, hold Go programs to a memory limit
(`GOMEMLIMIT`, the box has 256 MB), and answer in JSON.

A pull request for a service contains:

1. the buildroot package (defconfig or `package/<name>/`; for the example
   `BR2_PACKAGE_MOSQUITTO=y` and `BR2_PACKAGE_MOSQUITTO_BROKER=y`);
2. `sysapps/<id>/` (`app.json` with `"service"`, `icon.svg`, `pack.json`);
3. the controller `src/shareos-core/usr/sbin/shareos-<control>` (+ default
   settings `src/shareos-core/etc/config/<control>`), installed in
   `package/shareos-core/shareos-core.mk`;
4. if web apps control it: an rpcd object, a CGI under
   `www-apps/_shareos/cgi/`, an app permission and its SDK functions
   (see `shareos.apptailscale`, permission `tailscale`);
5. a test `tests/test-<control>.sh` (emulator) and the docs
   (CHANGELOG, `docs/TESTEN.md`/`TESTING.md`).

The settings page in the interface, if any, comes with the firmware too
(e.g. *Services → Media server* for `minidlna`).

## The services of the box

| System app | `control` | Controller | Controlled by |
|---|---|---|---|
| `tailscaled` | `tailscale` | `shareos-tailscale` | app Tailscale (permission `tailscale`) |
| `openvpn` | `vpn` | `shareos-vpn` | app NetTunnel (permission `vpn`) |
| `transmission-daemon` | `transmission` | `shareos-transmission` (one daemon per account) | app Transmission (permission `torrent`) |
| `minidlna` | `dlna` | `shareos-dlna` | *Services → Media server* |
| `ffmpeg` | `media` (`"boot": false`, only `stop-all`) | `shareos-media` | app MediaTranscoder (permission `media`) |
| `zabbix-agent` | `zabbix` | `shareos-zabbix` (user `zabbix`, active mode) | `shareos-zabbix set` on the command line, see [docs/MONITORING.md](../docs/MONITORING.md) |
| `autobrr` | `autobrr` | `shareos-autobrr` (one for the box, user `autobrr`) | an app with the permission `autobrr` (admins), or autobrr's own web interface on port 7474 |

`zabbix-agent` is built from `package/shareos-zabbix-agent` (the classic
agent only; buildroot's `zabbix` needs glibc).

Packages of these apps built before 0.2.0-beta.9 have no `"service"` yet;
`shareos-apps` knows their entries (`LEGACY_SERVICE`) until they are updated.
`autobrr` is built from `package/shareos-autobrr` (1.89, built with the Go of buildroot 2026.08.1; its web interface comes from the release's `web-dist.tar.gz`).
`tailscaled` is built from `package/shareos-tailscale` (newer than buildroot's,
one binary with the CLI built in – `TS_BE_CLI=1 tailscaled …`).
