# The parts of the web interface and of the rpcd plugin

`www/app.js` and `usr/share/rpcd/ucode/shareos.uc` are not in the repository.
`../build-parts.sh` joins them from the files here; the package build, the
mock (`tests/mock-ubus.py`) and the checks in `tests/` call it.

- One file per area. The same area has the same name on both sides
  (`web/cloud.js` and `rpc/cloud.uc`).
- A new area gets a file of its own and a line in `ORDER`. No part should grow
  beyond about 600 lines; split it by sub-area before that.
- To find the part a line of the joined file comes from:
  `grep -rn 'text of the line' src/shareos-core/parts`.

## web/ → www/app.js

Classic script, one global scope. A part adds its pages, its set-up after
drawing and its clicks to the tables of `core.js`: `Object.assign(SYS, …)`,
`Object.assign(VIEWS_AFTER, …)`, `afterSystemPage(…)`, `Object.assign(ACTIONS, …)`.

| Part | Area | Lines |
|---|---|---|
| `core.js` | language, helpers, icons, RPC, state, the tables the parts fill | 289 |
| `ui.js` | dialogs, toasts, tiles or table | 169 |
| `session.js` | sign-in, share target, polling | 229 |
| `layout.js` | header, menu, status chips | 448 |
| `overview.js` | Overview | 166 |
| `services.js` | Services: Status, Autostart | 94 |
| `shares.js` | Shares, users, groups, vaults | 336 |
| `dnsfilter.js` | DNS filter | 152 |
| `paperless.js` | Paperless | 160 |
| `cloud.js` | Cloud (admin and users) | 307 |
| `media.js` | Media server, remote access for Transmission programs | 162 |
| `snapshots.js` | Snapshots | 194 |
| `devices.js` | Printers, UPS | 154 |
| `me.js` | "My ShareOS" for plain users | 216 |
| `storage.js` | Drives, set-up wizard, USB | 432 |
| `smart.js` | Disk health (SMART) | 203 |
| `system-general.js` | System: General, Appearance, Time, Power & reset, Terminal | 508 |
| `system-network.js` | System: Network, HTTPS, dynamic DNS, own CA | 382 |
| `system-firmware.js` | System: Firmware, update flow | 245 |
| `system-messages.js` | System: Messages, Logs | 106 |
| `firstrun.js` | First-run wizard, recovery mode | 243 |
| `pwa.js` | installed app (PWA) and widget status | 154 |
| `files.js` | File browser | 432 |
| `apps.js` | Apps, store, sources | 514 |
| `events.js` | click and change dispatch, page changes, timers | 88 |
| `start.js` | start | 37 |

## rpc/ → usr/share/rpcd/ucode/shareos.uc

A part has its helper functions first and, below the line `methods`, its ubus
objects in `add_methods({ … })`. ucode knows a function only after its
definition, and methods use helpers of other parts, so `build-parts.sh` joins
all helpers first (in the order of `ORDER`) and all methods after them.
`tests/check-ucode-order.py` checks the result.

| Part | ubus objects / content | Lines |
|---|---|---|
| `core.uc` | imports, shell helpers, cached results, writing files, the method table | 345 |
| `storage.uc` | shareos.storage, SMART | 534 |
| `web.uc` | shareos.ui, shareos.web (language, logo, HTTPS) | 286 |
| `network.uc` | shareos.net | 162 |
| `system.uc` | shareos.system, service, hw, setup | 438 |
| `time.uc` | shareos.time | 171 |
| `accounts.uc` | shareos.accounts, shares, vault shares | 432 |
| `me.uc` | shareos.me | 290 |
| `paperless.uc` | shareos.paperless | 178 |
| `cloud.uc` | shareos.cloud | 298 |
| `devices.uc` | shareos.printer, ups | 106 |
| `snapshots.uc` | shareos.snapshots | 156 |
| `apps.uc` | shareos.apps, appstatus | 278 |
| `files.uc` | shareos.files, appfs, background file jobs | 560 |
| `trash.uc` | trash of the file browser | 133 |
| `media.uc` | shareos.dlna, appmedia, media jobs | 356 |
| `torrent.uc` | shareos.apptorrent, tremote | 288 |
| `app-perms.uc` | permissions of apps: appsys, appnet, appvault, appnotify, appdocker, apptuya | 214 |
| `app-services.uc` | apptailscale, appautobrr, appzabbix, appvpn, appsyncthing, dnsfilter | 418 |
| `backup.uc` | shareos.backup, recovery | 336 |
| `notify.uc` | shareos.notify, status, widget | 110 |
| `update.uc` | shareos.update | 140 |
| `end.uc` | returns the method table to rpcd | 3 |
