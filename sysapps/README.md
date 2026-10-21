# System apps

Native programs for the box (type `"system"`), e.g. `nano` and `htop`. They
are built with the firmware's toolchain (`configs/shareos_sysapps_defconfig`)
and packed as `.sapp` like the web apps:

    make dns320l          # once – makes the toolchain
    make sysapps-pack     # → output/sysapps/sapp/<id>-<version>.sapp (+ .sha256)

Per app, `sysapps/<id>/` holds

- `app.json` – the manifest (`"type": "system"`, `"commands"`), as on the box;
- `icon.svg`;
- `pack.json` – what goes into the package, paths in the buildroot target:
  `"bin"` programs (become `bin/<name>`), `"share"` folders (become
  `share/<name>`). Libraries the programs need and the firmware lacks are added
  to `lib/` by themselves (read from the ELF headers).

On the box `shareos-apps` unpacks a system app to `/opt/shareos/sysapps/<id>`
and writes a starter for every entry of `"commands"` to `/opt/shareos/bin`
(in `PATH`). The starter sets `LD_LIBRARY_PATH` to the app's `lib/` and
`TERMINFO_DIRS` to its `share/terminfo` if present.

A new program: enable its buildroot package in the defconfig, add
`sysapps/<id>/`, `make sysapps-pack`.

**In the store:** CI attaches the `.sapp` files to every ShareOS release;
the catalog of [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps)
lists them from there (metadata from `sysapps/<id>/app.json` at the release
tag). A web app that needs one names it in `"requires"`, and the store
installs it along.

**Services:** a system app only brings the program. If it is a daemon (e.g.
`transmission-daemon`), the firmware starts and stops it (here
`shareos-transmission`, `S95transmission`, the removal hook
`/usr/lib/shareos/apphooks/<id>`) – a package never starts a service by
itself, so only reviewed daemons run on the box.
