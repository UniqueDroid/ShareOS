# Überwachung mit Zabbix

*English: [MONITORING.md](MONITORING.md)*

Die System-App **zabbix-agent** bringt den klassischen Zabbix-Agenten
(`zabbix_agentd`, in C – nicht den Agent 2 in Go) auf die Box. Er meldet
Auslastung, Arbeitsspeicher, Netzwerk und Dateisysteme an einen Zabbix-Server
und dazu Werte, die es nur auf der NAS gibt: SMART und Temperatur jeder
Platte, den Zustand jedes RAIDs, Temperatur und Lüfter der Box.

- **Aktiv-Modus:** Der Agent verbindet sich selbst mit dem Server und schickt
  die Werte in seinem eigenen Takt. Es gibt keinen offenen Port und keine
  wartenden Prozesse (`StartAgents=0`) – das spart Arbeitsspeicher und CPU,
  Samba bleibt schnell.
- **Klein:** Agent mit OpenSSL (für verschlüsselte Verbindungen) und pcre2,
  etwa 5 MB. Er bleibt im Flash (`"flash": true`), damit er weiter meldet,
  wenn das Apps-Laufwerk ausfällt – genau dafür überwacht man ja.
- **Als eigener Benutzer:** Der Agent läuft als `zabbix`, nicht als root.
  `system.run` ist gesperrt. Die SMART-Werte liest root alle 30 Minuten
  (`shareos-zabbix collect`, Cron) aus demselben Zwischenspeicher wie
  *Speicher → Gesundheit*; eine schlafende Platte wird dabei nicht geweckt.

## Einrichten

1. **Installieren:** APPS → Store → System-Apps → **Zabbix Agent**.
2. **Auf der Box** (System → Terminal oder SSH) den Server eintragen und
   einschalten:

   ```sh
   echo '{"enabled": true, "server": "zabbix.example.lan"}' | shareos-zabbix set
   ```

   Weitere Server mit Komma (`"zabbix1, 10.0.0.5:10051"`). Der Hostname in
   Zabbix ist der Name der Box; ein anderer mit `"hostname": "nas-keller"`.
3. **Verschlüsselt (empfohlen):** einen Schlüssel erzeugen – zum Beispiel auf
   dem Zabbix-Server oder einem PC – und auf der Box eintragen:

   ```sh
   openssl rand -hex 32
   echo '{"psk_identity": "nas-keller PSK", "psk": "<die 64 Zeichen>"}' | shareos-zabbix set
   ```

   Der Schlüssel liegt nur für root lesbar in `/etc/shareos/zabbix.psk` und
   ist in der Einstellungssicherung. Entfernen:
   `echo '{"psk": "", "psk_identity": ""}' | shareos-zabbix set`.
4. **Im Zabbix-Server** (7.0 oder neuer):
   - *Datenerfassung → Vorlagen → Importieren*: `docs/zabbix/shareos_template.yaml`
     aus diesem Repository.
   - *Datenerfassung → Hosts → Host anlegen*: Hostname = Name der Box (bzw.
     `hostname`), Vorlagen **Linux by Zabbix agent active** und
     **ShareOS by Zabbix agent active**. Eine Schnittstelle ist für den
     Aktiv-Modus nicht nötig.
   - Bei PSK: Reiter *Verschlüsselung* → *Verbindungen vom Host*: **PSK**,
     dieselbe Identität und denselben Schlüssel.
   - Statt Hosts von Hand anzulegen geht auch die Auto-Registrierung: Der
     Agent schickt `ShareOS` als Metadaten (änderbar mit `"metadata"`).
5. Nach ein bis zwei Minuten kommen die ersten Werte (*Überwachung →
   Neueste Daten*), die Platten und RAIDs erscheinen nach der ersten
   Erkennung (bis zu einer Stunde, oder *Jetzt ausführen* an der Regel).

`shareos-zabbix status` zeigt die Einstellungen, `shareos-zabbix log` das
Protokoll des Agenten. Unter *Dienste → Status* lässt er sich anhalten und
starten. Ausschalten: `echo '{"enabled": false}' | shareos-zabbix set`.

## Alle Einstellungen

`shareos-zabbix set` nimmt ein JSON-Objekt; jedes Feld ist optional. Ein
falscher Wert wird abgelehnt, dann bleibt alles wie es war.

| Feld | Bedeutung |
|---|---|
| `enabled` | an/aus (startet beim Booten) |
| `server` | Zabbix-Server für den Aktiv-Modus, `host[:port]`, mehrere mit Komma (höchstens 8) |
| `hostname` | Hostname in Zabbix (Standard: Name der Box); `""` = wieder der Name der Box |
| `metadata` | HostMetadata für die Auto-Registrierung (Standard `ShareOS`) |
| `psk_identity`, `psk` | Verschlüsselung mit Pre-Shared Key (32 … 512 Hex-Zeichen) |
| `passive`, `allow`, `port` | zusätzlich passive Abfragen annehmen: lauscht auf `port` (Standard 10050) für die Adressen in `allow` – braucht mehr Arbeitsspeicher, standardmäßig aus |
| `disk_interval` | Minuten zwischen zwei SMART-Lesungen: 10, 15, 20, 30 (Standard) oder 60. Wer seine Platten nach 30 Minuten oder später schlafen legt, nimmt 60 – jede Lesung setzt die Zeit bis zum Einschlafen zurück. |

Die Einstellungen stehen in `/etc/config/zabbix` (UCI) und sind in der
Einstellungssicherung.

## Die Werte der Box

| Schlüssel | Wert |
|---|---|
| `shareos.box[temperature]` | Temperatur der Box in °C |
| `shareos.box[fan_rpm]`, `shareos.box[fan_pwm]` | Lüfter (Drehzahl, Stufe 0–255) |
| `shareos.box[version]`, `shareos.box[board]` | ShareOS-Version, Modell |
| `shareos.disk.discovery` | Platten in den Schächten (keine USB-Laufwerke): `{#DISK}`, `{#MODEL}`, `{#SERIAL}` |
| `shareos.disk[<platte>,<wert>]` | `rating` (0 gut, 1 Achtung, 2 kritisch – wie *Speicher → Gesundheit*), `passed`, `temperature`, `temperature_max`, `reallocated`, `pending`, `uncorrectable`, `crc_errors`, `error_count`, `life_left` (SSD), `power_on_hours`, `power_cycles`, `standby`, `age`, `model`, `serial` |
| `shareos.raid.discovery` | RAIDs: `{#RAID}`, `{#LEVEL}` |
| `shareos.raid[<md>,<wert>]` | `active`, `level`, `disks`, `working`, `missing`, `health` (`UU`, `U_`), `syncing`, `sync_percent`, `sync_action` |

Fehlt ein Wert (z. B. `life_left` einer Festplatte), ist die Antwort leer;
ein unbekannter Schlüssel liefert `error: …`. Beides macht ein Zahlen-Item in
Zabbix „nicht unterstützt“. Schläft eine Platte, bleiben ihre letzten Werte
stehen und `standby` ist 1.

Die Vorlage `docs/zabbix/shareos_template.yaml` (erzeugt mit
`tools/zabbix/make-template.py`) hat Auslöser für: kritische Platte, SMART-Warnung,
fehlgeschlagener SMART-Test, heiße Platte (Makro `{$SHAREOS.DISK.TEMP.WARN}`,
55 °C), neue umgelagerte Sektoren, schwebende Sektoren, neue CRC-Fehler,
abgenutzte SSD (`{$SHAREOS.SSD.LIFE.WARN}`, 20 %), getauschte Platte, RAID
inaktiv oder unvollständig, heiße Box (`{$SHAREOS.BOX.TEMP.WARN}`, 55 °C) und
Firmware-Update.
