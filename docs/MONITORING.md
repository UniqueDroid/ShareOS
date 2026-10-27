# Monitoring with Zabbix

*Deutsch: [UEBERWACHUNG.md](UEBERWACHUNG.md)*

The system app **zabbix-agent** brings the classic Zabbix agent
(`zabbix_agentd`, written in C – not the Go agent 2) to the box. It reports
load, memory, network and file systems to a Zabbix server, plus values only a
NAS has: SMART and temperature of every disk, the state of every RAID,
temperature and fan of the box.

- **Active mode:** the agent connects to the server itself and sends its
  values at its own pace. No open port and no waiting listener processes
  (`StartAgents=0`) – less memory and CPU, Samba stays fast.
- **Small:** the agent with OpenSSL (for encrypted connections) and pcre2,
  about 5 MB. It stays on the flash (`"flash": true`) so it keeps reporting
  when the apps drive fails – which is what you monitor for.
- **Its own user:** the agent runs as `zabbix`, not root; `system.run` is
  denied. Root reads the SMART values every 30 minutes (`shareos-zabbix
  collect`, cron) from the same cache as *Storage → Health*; a sleeping disk
  is not woken up.

## Setting up

1. **Install:** APPS → Store → system apps → **Zabbix Agent**.
2. **On the box** (System → Terminal or SSH), set the server and switch it on:

   ```sh
   echo '{"enabled": true, "server": "zabbix.example.lan"}' | shareos-zabbix set
   ```

   More servers separated by commas (`"zabbix1, 10.0.0.5:10051"`). The host
   name in Zabbix is the box's name; another one with `"hostname": "nas-cellar"`.
3. **Encrypted (recommended):** make a key – on the Zabbix server or a PC, for
   example – and set it on the box:

   ```sh
   openssl rand -hex 32
   echo '{"psk_identity": "nas-cellar PSK", "psk": "<the 64 characters>"}' | shareos-zabbix set
   ```

   The key is kept root-only in `/etc/shareos/zabbix.psk` and is in the
   settings backup. Remove it:
   `echo '{"psk": "", "psk_identity": ""}' | shareos-zabbix set`.
4. **In the Zabbix server** (7.0 or newer):
   - *Data collection → Templates → Import*: `docs/zabbix/shareos_template.yaml`
     from this repository.
   - *Data collection → Hosts → Create host*: host name = the box's name (or
     `hostname`), templates **Linux by Zabbix agent active** and
     **ShareOS by Zabbix agent active**. Active mode needs no interface.
   - With PSK: tab *Encryption* → *Connections from host*: **PSK**, the same
     identity and key.
   - Instead of adding hosts by hand, auto-registration works too: the agent
     sends `ShareOS` as metadata (change it with `"metadata"`).
5. The first values arrive after a minute or two (*Monitoring → Latest
   data*); disks and RAIDs appear after the first discovery (up to an hour,
   or *Execute now* on the rule).

`shareos-zabbix status` shows the settings, `shareos-zabbix log` the agent's
log. *Services → Status* stops and starts it. Switch it off:
`echo '{"enabled": false}' | shareos-zabbix set`.

## All settings

`shareos-zabbix set` takes a JSON object; every field is optional. A wrong
value is refused and nothing changes.

| Field | Meaning |
|---|---|
| `enabled` | on/off (starts at boot) |
| `server` | Zabbix servers for active checks, `host[:port]`, several separated by commas (at most 8) |
| `hostname` | host name in Zabbix (default: the box's name); `""` = the box's name again |
| `metadata` | HostMetadata for auto-registration (default `ShareOS`) |
| `psk_identity`, `psk` | encryption with a pre-shared key (32 … 512 hex digits) |
| `passive`, `allow`, `port` | also answer passive checks: listens on `port` (default 10050) for the addresses in `allow` – needs more memory, off by default |
| `disk_interval` | minutes between two SMART reads: 10, 15, 20, 30 (default) or 60. If your disks sleep after 30 minutes or later, take 60 – every read restarts the time until they sleep. |

The settings are kept in `/etc/config/zabbix` (UCI) and are in the settings
backup.

## The box's values

| Key | Value |
|---|---|
| `shareos.box[temperature]` | temperature of the box in °C |
| `shareos.box[fan_rpm]`, `shareos.box[fan_pwm]` | fan (speed, level 0–255) |
| `shareos.box[version]`, `shareos.box[board]` | ShareOS version, model |
| `shareos.disk.discovery` | disks in the bays (no USB drives): `{#DISK}`, `{#MODEL}`, `{#SERIAL}` |
| `shareos.disk[<disk>,<value>]` | `rating` (0 good, 1 warning, 2 critical – as *Storage → Health*), `passed`, `temperature`, `temperature_max`, `reallocated`, `pending`, `uncorrectable`, `crc_errors`, `error_count`, `life_left` (SSD), `power_on_hours`, `power_cycles`, `standby`, `age`, `model`, `serial` |
| `shareos.raid.discovery` | RAID arrays: `{#RAID}`, `{#LEVEL}` |
| `shareos.raid[<md>,<value>]` | `active`, `level`, `disks`, `working`, `missing`, `health` (`UU`, `U_`), `syncing`, `sync_percent`, `sync_action` |

A missing value (e.g. `life_left` of a hard disk) is empty; an unknown key
gives `error: …`. Both make a numeric item "not supported" in Zabbix. When a
disk sleeps, its last values stay and `standby` is 1.

The template `docs/zabbix/shareos_template.yaml` (made by
`tools/zabbix/make-template.py`) has triggers for: critical disk, SMART
warning, failed SMART check, hot disk (macro `{$SHAREOS.DISK.TEMP.WARN}`,
55 °C), new reallocated sectors, pending sectors, new CRC errors, worn SSD
(`{$SHAREOS.SSD.LIFE.WARN}`, 20 %), replaced disk, RAID inactive or degraded,
hot box (`{$SHAREOS.BOX.TEMP.WARN}`, 55 °C) and firmware update.
