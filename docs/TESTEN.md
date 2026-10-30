# ShareOS testen und installieren (DNS-320L)

*English version: [TESTING.md](TESTING.md)*

Stand: 18.10.2026. ShareOS ist in der **Testphase**. Es gibt zwei Wege zur
Installation:

- **Weg A – über die Firmware-Seite von Alt-F oder D-Link** (ohne serielle
  Konsole, ab 0.1.0-beta.7). Auf echter Hardware erprobt (hin und zurück,
  20.10.2026) – Schritt für Schritt in [UMSTIEG.md](UMSTIEG.md).
- **Weg B – über die serielle Konsole** (Stiftleiste JP1, drei Kabel anlöten, siehe
  [HARDWARE-DNS320L.md](HARDWARE-DNS320L.md)): erprobt, Schritte 1–3 unten.

Ist ShareOS einmal installiert, laufen Updates über die Weboberfläche. Zurück
zu Alt-F geht ebenfalls über die Weboberfläche (siehe
[Zurück zu Alt-F](#zurück-zu-alt-f)).

## Weg A: über die Firmware-Seite von Alt-F oder D-Link

Aus dem GitHub-Release brauchst du:

- `ShareOS-<version>-DNS-320L-rev-Ax.bin` (Kernel und Startsystem, ca. 3,3 MB)
- empfohlen: `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` auf einem
  USB-Stick (FAT32, exFAT oder ext4; oberste Ebene oder Ordner `shareos`).
  Ohne Stick lädt die Box das Paket selbst von GitHub – dafür muss das
  Netzwerkkabel stecken und der Router per DHCP eine Adresse vergeben.

1. Den USB-Stick mit dem Paket in die Box stecken (falls vorhanden).
2. In der Weboberfläche von Alt-F (bzw. der D-Link-Firmware) auf der
   Firmware-Seite die ShareOS-`.bin` auswählen und flashen. Alt-F schreibt
   dabei nur Kernel und Startsystem.
3. Die Box startet neu. ShareOS merkt, dass noch kein System im Flash ist, und
   installiert es: zuerst vom USB-Stick, sonst von GitHub (Prüfsumme wird
   kontrolliert). Die **orange USB-LED blinkt schnell**, das dauert einige
   Minuten. Die Zusatzpakete von Alt-F im Flash werden dabei ersetzt.
4. Danach startet die Box von selbst neu – jetzt mit ShareOS. Weiter mit
   [4. Weboberfläche](#4-weboberfläche).

Klappt die Installation nicht (kein Stick, kein Netz, Paket defekt), bleibt
die Box im **Rettungsmodus** (orange USB-LED blinkt langsam). Der Grund steht
auf der seriellen Konsole und per SSH (`ssh root@<ip>`, Passwort `shareos`) in
`/tmp/firstinstall.err`, das Protokoll in `/tmp/firstinstall.log`. Abhilfe:
Paket auf einen USB-Stick kopieren, einstecken, Box aus- und wieder
einschalten.

## Weg B: über die serielle Konsole

### Was du brauchst

- das Update-Paket `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` aus einem
  GitHub-Release
- einen USB-TTL-Adapter (3,3 V) an JP1: Pin 4 = TX der Box, 3 = GND, 1 = RX der
  Box; Pin 2 (3,3 V) bleibt frei. Einstellung 115200 8N1
- einen PC mit TFTP-Server, zum Beispiel `dnsmasq`

### Serielle Konsole anschließen (drei Kabel anlöten)

JP1 sitzt neben dem USB-Anschluss und ist nicht bestückt. Eine Stiftleiste
lässt sich nicht einfach durchstecken: In den Lötaugen steckt noch Lötzinn, sie
müssten erst freigemacht werden (Entlötlitze/-pumpe). Einfacher ist es, drei
Kabel (TX, RX, GND) direkt an die Lötaugen anzulöten und den 3,3-V-Pin frei zu
lassen. Pin 1 ist das eckige Lötauge (Pfeil auf der Platine), zwischen Pin 1
und Pin 2 ist eine Lücke.

| Belegung von JP1 | So sieht es angeschlossen aus |
|---|---|
| ![JP1-Belegung](images/hw-jp1.jpg) | ![JP1 mit Kabeln](images/hw-jp1-kabel.jpg) |

| Aufbau mit USB-Seriell-Adapter | Platine im Überblick |
|---|---|
| ![Aufbau](images/hw-seriell-aufbau.jpg) | ![Platine](images/hw-platine.jpg) |

Am PC: `screen /dev/ttyUSB0 115200` (oder PuTTY/minicom). Der Adapter muss
auf **3,3 V** stehen – 5 V kann die Box beschädigen. TX und RX werden über
Kreuz verbunden: TXD des Adapters an Pin 1 (RX der Box), RXD an Pin 4.

## 1. PC vorbereiten

```sh
sudo mkdir -p /srv/tftp && sudo rm -f /srv/tftp/*
sudo tar xf ShareOS-*.sysupgrade.tar -C /srv/tftp
cd /srv/tftp && sha256sum -c SHA256SUMS
sudo dnsmasq --no-daemon --port=0 --enable-tftp --tftp-root=/srv/tftp --tftp-single-port
```
Die Firewall des PCs muss UDP-Port 69 durchlassen, zum Beispiel
`sudo ufw allow from <netz>/24 to any port 69 proto udp`.

## 2. Start aus dem RAM (schreibt nichts)

Box einschalten und sofort **Leertaste, 1, Leertaste, 1 …** tippen, bis
`Marvell>>` erscheint. Dann:
```
setenv ipaddr <freie IP>
setenv serverip <IP des PCs>
setenv netmask 255.255.255.0
setenv bootargs shareos.netroot=<IP des PCs>
tftpboot 0xa00000 uImage
tftpboot 0xf00000 urootfs
bootm 0xa00000 0xf00000
```
Niemals `saveenv` eingeben. Anmelden mit `root` / `shareos`. Mit
`shareos-check` lässt sich die Hardware prüfen.

## 3. System in den Flash schreiben

Auf der Box, im Netzwerk-Start aus Schritt 2:
```sh
shareos-install-ubi tftp://<IP des PCs>/rootfs.squashfs --yes
shareos-flash-boot tftp://<IP des PCs> --yes
```
- Der erste Befehl schreibt das System in die Partition `image`. Dabei gehen
  die Zusatzpakete von Alt-F verloren, Alt-F selbst bleibt startfähig.
- Der zweite Befehl schreibt Kernel und Start-System. Vorher sichert er die
  Alt-F-Partitionen nach `/root/boot-backup`. Bitte die Sicherung auf den PC
  holen: `scp -O -r root@<ip>:/root/boot-backup .`

Danach `reboot`: Die Box startet ShareOS allein.

## 4. Weboberfläche

`http://shareos.local` öffnen (oder `http://shareos.fritz.box`, `http://<ip>`)
und mit `root` / `shareos` anmelden. Das Passwort gleich unter
**System → Allgemein** ändern.

- Die Box holt sich ihre Adresse per **DHCP** vom Router und meldet sich dort mit ihrem Namen an.
- Per **mDNS** ist sie zusätzlich unter `<name>.local` erreichbar (Windows 10/11, macOS, iOS, Android, Linux).
- Antwortet kein DHCP-Server (Box direkt am PC), nimmt sie nach etwa 15 s die **Rückfall-Adresse `192.168.0.32`**. Den PC dann auf z. B. `192.168.0.10/24` stellen. Sobald ein DHCP-Server antwortet, wechselt sie von selbst.
- Das selbst ausgestellte HTTPS-Zertifikat nennt Name, `<name>.local` und die aktuelle IP. Nach einer Änderung wird es neu ausgestellt (der Browser fragt dann einmal neu nach).

## 5. Updates

- **Automatisch:** Die Box sieht alle 6 Stunden auf GitHub nach. Ein neues Release erscheint oben als **UPDATE … verfügbar**, sobald GitHub das Update-Paket gebaut hat (etwa 45 Minuten nach dem Veröffentlichen).
- **Über die Weboberfläche:** System → Firmware → *Jetzt prüfen*. Für
  Testversionen den Kanal **Beta** wählen.
- **Von Hand**, mit einem Paket auf der Box:
  ```sh
  cd /tmp && mkdir u && tar xf ShareOS-*.sysupgrade.tar -C u
  shareos-flash-boot /tmp/u --yes
  mkdir -p /overlay/upgrade && cp /tmp/u/rootfs.squashfs /overlay/upgrade/
  cd /overlay/upgrade && sha256sum rootfs.squashfs > rootfs.squashfs.sha256 && echo <version> > version
  sync && reboot
  ```
  Beim Start meldet die Konsole `upgrade: installing system … done`.

Einstellungen und installierte Pakete bleiben bei Updates erhalten.

**Versionen bis 0.1.0-beta.1:** curl findet dort die CA-Zertifikate nicht,
die Prüfung bei GitHub meldet „certificate is not correctly signed“. Einmal auf
der Box ausführen, danach klappt das Update (ab 0.1.0-beta.2 nicht mehr nötig):
```sh
echo 'cacert = /etc/ssl/certs/ca-certificates.crt' > /root/.curlrc
```

## 6. Netzwerk

Unter **System → Netzwerk** lässt sich eine feste IP einstellen. Die Änderung
gilt sofort; die Box wartet dann 2 Minuten auf eine Bestätigung von der neuen
Adresse. Die Oberfläche öffnet die neue Adresse selbst und bestätigt. Kommt
keine Bestätigung (Tippfehler, falsches Netz), stellt die Box die alten
Einstellungen wieder her. Notfalls: Werkseinstellungen (DHCP) über die serielle
Konsole mit `shareos-factory-reset --yes`.

## 7. Freigaben und Benutzer

Unter **Freigaben → Benutzer** Konten anlegen (Rolle, persönlicher Ordner,
Speicherlimit), unter **Freigaben → Freigaben** Ordner freigeben und Rechte je
Benutzer oder Gruppe setzen. Windows: `\\<box>\<freigabe>`, macOS/Linux:
`smb://<box>/<freigabe>`. Benutzer mit Web-Zugang sehen nach der Anmeldung
„Mein ShareOS“ (eigener Speicher, Freigaben, Passwort, Paperless, Cloud).

## 8. Paperless-ngx

1. In Paperless: Profil → **API-Token** erzeugen.
2. In ShareOS unter **Paperless** die Adresse eintragen (z. B. `http://192.168.1.20:8000`) und speichern.
3. **Neuer Eingang**: persönlich (Ordner `Paperless` im persönlichen Ordner eines Benutzers) oder gemeinsam (Ordner einer Freigabe, z. B. für den Scanner), Token eintragen, **Verbindung prüfen**.
4. Eine PDF in den Eingangsordner legen. Nach spätestens 2 Minuten (oder sofort mit **Jetzt übertragen**) erscheint sie im Protokoll als „wird verarbeitet“, dann „übernommen“ und in Paperless.

Dateien, die Paperless ablehnt (z. B. Duplikate), landen in `.paperless/failed`
im Eingangsordner. Ist Paperless nicht erreichbar, bleibt die Datei liegen und
wird beim nächsten Lauf erneut gesendet.

## 9. Cloud-Sync

1. **Cloud → rclone installieren** (lädt rclone von GitHub, braucht einen eingerichteten Apps-Bereich).
2. **Konto hinzufügen**: Nextcloud/WebDAV, S3 oder SFTP direkt; Google Drive, OneDrive, Dropbox: auf dem PC `rclone config` ausführen und den fertigen Abschnitt aus `rclone.conf` einfügen. **Testen** zeigt, ob die Anmeldung klappt.
3. **Neuer Auftrag**: Ordner auf dem NAS, Konto, Ordner in der Cloud, Richtung (Hochladen ist die sichere Wahl, Spiegeln löscht auf der Zielseite), Zeitplan. **Jetzt starten** und das **Protokoll** ansehen.

Benutzer dürfen eigene Konten und Aufträge anlegen, wenn im Benutzerkonto
„Darf eigene Cloud-Sync-Aufträge anlegen“ gesetzt ist (braucht einen
persönlichen Ordner). Ihre Aufträge laufen mit ihren Rechten.

## 10. App und Widgets

- **Als App:** Chrome und Edge bieten „App installieren“ nur über HTTPS mit einem vertrauenswürdigen Zertifikat an (z. B. Let's Encrypt, unter System → Netzwerk einspielen). Über http:// geht „Zum Startbildschirm hinzufügen“ (Lesezeichen-Symbol). Langes Drücken auf das App-Symbol zeigt die Kurzbefehle.
- **Widgets:** Unter **System → Allgemein → Status für Widgets** einschalten und die Adresse kopieren. Sie liefert JSON, z. B.:
  ```sh
  curl "http://<box>/cgi-bin/status?token=<token>"
  ```
  In KWGT (Android) kann man die Werte mit `$wg("<adresse>", json, ".volumes[0].used_pct")$` anzeigen. **Neuer Schlüssel** macht die alte Adresse ungültig.

## 11. Dateibrowser und eigene Darstellung

- **Admins:** Freigaben → **Dateien** zeigt alle eingehängten Laufwerke: Ordner anlegen, hochladen (auch per Ziehen), herunterladen, umbenennen, verschieben, kopieren, löschen.
- **Benutzer:** Im Benutzerkonto „Dateien“ einschalten. Dann gibt es in „Mein ShareOS“ den Reiter **Dateien** mit dem eigenen Ordner und den Freigaben, für die der Benutzer Rechte hat (ab 0.2.0-beta.6, siehe 14m).
- **Darstellung:** Benutzer mit Web-Zugang stellen unter **Darstellung** Hell/Dunkel und Akzentfarbe für sich ein. „Wie für alle“ nimmt wieder die Vorgabe des Admins.
- Testidee: eine große Datei (z. B. 1 GB) hochladen und wieder herunterladen. Das darf nicht nach 60 s abbrechen.

## 12. Apps (Store)

- **APPS → Store → Jetzt aktualisieren** lädt den Katalog aus dem Repo [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps). Bei **Webpad** auf **Installieren**: Die Box lädt das Paket, prüft die SHA-256-Summe und installiert es.
- **APPS → Installiert → Öffnen ↗** startet die App in einem neuen Tab auf Port **8081** (bzw. 8444 mit HTTPS). Das ist absichtlich eine andere Adresse als die Verwaltung.
- **Benutzer** legt fest, wem die App in „Mein ShareOS“ angezeigt wird (alle, einzelne Benutzer, Gruppen).
- **Eigene App:** unter Store → *Paket installieren* eine `.sapp`-Datei hochladen (gebaut mit `tools/build.py` aus dem App-Repo). Sie wird als „eigene / ungeprüft“ markiert.
- **Weitere Quellen** (eigene Kataloge) unter APPS → Quellen.
- **Geplante Aufgaben** (ab beta.7, für Apps mit der Berechtigung `cron`): Der Installationsdialog nennt die Berechtigungen. **APPS → Installiert → Aufgaben** zeigt Zeitplan, an/aus und den letzten Lauf; *Jetzt ausführen*, danach zeigt *Protokoll* die Ausgabe. Ein geänderter Zeitplan bleibt nach einem App-Update erhalten. Prüfen mit `crontab -l` (Zeile `shareos-apps run-job`) und `ps` (die Aufgabe läuft als Benutzer `app-<id>`).

## 12a. Update ohne Internet

- Am PC aus einem Release `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` und die passende `.sha256` herunterladen.
- **System → Firmware → Firmware-Datei einspielen**: bei *Datei* die `.tar`, bei *Prüfsumme* die `.sha256` wählen, **Hochladen & prüfen**. Nach etwa einer halben Minute zeigt der Update-Bereich „<version> installieren“ mit „Hochgeladene Datei – geprüft …“.
- **Installieren**, danach **Jetzt neu starten** – wie beim Update von GitHub.
- Falsche `.sha256`, eine Datei für ein anderes Gerät oder eine beschädigte Datei werden mit einer Meldung abgelehnt.

## 13. Dateisysteme und USB-Laufwerke

- **Speicher → Assistent**: Im Schritt „Name“ gibt es je Laufwerk die Auswahl **ext4** (empfohlen, alle Funktionen), **Btrfs** (ohne Speicherlimit je Benutzer), **exFAT** und **NTFS** (auch an Windows/macOS lesbar; keine Rechte je Benutzer, kein Speicherlimit, keine persönlichen Ordner, keine Apps). Die Zusammenfassung zeigt das gewählte Dateisystem. Das gleiche Feld hat „Löschen & formatieren“ an einer Platte.
- **USB-Stick einstecken**: Er erscheint unter Speicher → Laufwerke als „USB · sdX“ und ist nach wenigen Sekunden unter `/mnt/usb-<name>` eingehängt (FAT32, exFAT, NTFS, ext4, Btrfs). Admins sehen ihn im Dateibrowser.
- **Sicher entfernen**: schreibt alles weg, hängt aus und schaltet den Stick ab. Danach kommt „sdX kann jetzt abgezogen werden“. Wird ein Stick ohne diesen Knopf abgezogen, räumt ShareOS den Einhängepunkt auf.
- **Formatieren** (am USB-Laufwerk): Name und Dateisystem wählen – **exFAT** (empfohlen), **FAT32**, **NTFS** oder **ext4**. Der Stick bekommt eine Partition (MBR), damit ihn jeder Rechner, jede Kamera und jeder Fernseher liest.
- Die Platten in den Schächten werden nie automatisch eingehängt; die USB-Funktionen fassen sie nicht an.

- **Zwei Platten:** Neben „Spiegel (RAID 1)“ und „zwei getrennte Laufwerke“ bietet der Assistent **RAID 0** und **JBOD** an; die Zusammenfassung zeigt die Größe (RAID 0: doppelte kleinere Platte, JBOD: beide zusammen). `cat /proc/mdstat` zeigt `raid0` bzw. `linear`.
- Dateisysteme **ext3**, **ext2** und **FAT32** sind auch für Platten wählbar (FAT32: Dateien höchstens 4 GB).
- **Spiegel reparieren:** Fehlt eine Platte des Spiegels (Karte: „eine Platte fehlt (U_)“) und steckt eine Platte im freien Schacht, löscht *Spiegel reparieren* diese Platte und nimmt sie auf; die Karte zeigt danach „Wiederherstellung … %“.
- **Spiegel nach einem Neustart (Platten, die nacheinander anlaufen, z. B. DNS-325):** mit vollständigem Spiegel mehrmals neu starten; jedes Mal zeigt `cat /proc/mdstat` `[2/2] [UU]` und `dmesg | grep md/raid1` „active with 2 out of 2 mirrors“, auch wenn die zweite Platte Sekunden später kommt (`dmesg | grep 'SATA link up'`). Mit einer gezogenen Platte wartet die Box bis zu 40 s, startet dann den Spiegel mit einer Platte und schreibt „RAID incomplete after 40s“ ins Protokoll (`grep shareos-storage /var/log/messages`).
- **Gesundheit (SMART):** *Speicher → Gesundheit* zeigt je Platte eine Karte. Bei einer gesunden Platte: *GUT*, „Keine Auffälligkeiten“, Temperatur, Betriebszeit, Sektoren 0. *Neu lesen* weckt eine schlafende Platte und liest neu. *Kurztest* startet den Selbsttest: Die Karte zeigt „Läuft – noch … %“ und *Test abbrechen*; nach etwa 2 Minuten (*Neu lesen*) steht beim letzten Test *OK*. Im Terminal: `smartctl -l selftest /dev/sda` zeigt denselben Test. *Alle Werte* öffnet die Tabelle der Attribute. Bei einer SSD: „Lebensdauer der SSD“ mit Balken. Zeitplan *Kurztest jeden Sonntag*: `grep smart-test /etc/crontabs/root` zeigt `30 3 * * 0 … smart-test short`; von Hand mit `shareos-storage smart-test short`, nach wenigen Minuten zeigt `grep shareos-storage /var/log/messages` „SMART short self-test started“.

## 14. Zeit und Sprachen

- **System → Zeit:** Die Uhr der Box läuft live in ihrer Zeitzone. Zeitzone ändern, NTP aus- und einschalten, eigene Zeitserver eintragen (z. B. `fritz.box`), *Jetzt abgleichen*. Mit NTP aus lässt sich die Uhr von Hand stellen oder die Zeit des Browsers übernehmen. Protokolle zeigen danach die Ortszeit.
- **System → Darstellung → Sprache:** 10 Sprachen (Englisch, Deutsch, Chinesisch, Hindi, Spanisch, Französisch, Arabisch, Bengalisch, Portugiesisch, Russisch). Arabisch stellt die Seite auf rechts-nach-links um. Die Übersetzungen außer Deutsch/Englisch sind maschinell – Fehler bitte melden.

## 14a. Dateien in Apps öffnen

- **Webpad 1.1** installieren (Store). Im Dateibrowser steht bei einer `.txt`-Datei **Webpad ↗**; darauf (oder auf den Dateinamen) klicken: Webpad öffnet sich in einem eigenen Fenster mit der Datei.
- Etwas ändern, **Ctrl+S**: Meldung „gespeichert“; der Dateibrowser zeigt neue Größe und Zeit. Besitzer und Rechte der Datei bleiben.
- Aussehen: in ShareOS Hell/Dunkel oder die Akzentfarbe wechseln – eine offene App zieht mit.
- Benutzer mit persönlichem Ordner können das genauso mit ihren Dateien.

- **Name und Symbole (beta.10):** ShareOS über die IP öffnen (`https://10.241.1.106`). Unter **Apps → Installiert** haben Webpad und WebTerm ihr Symbol. **Öffnen** startet die App unter dem Namen des Zertifikats (`https://shareos.skynet.lan:8444/…`), ohne Zertifikatswarnung. **System → Netzwerk → Name der Box für Links** zeigt den Namen aus dem Zertifikat als Vorschlag; ein eigener Name wird dort gespeichert, leer = automatisch.

- **Spulen (beta.11):** Eine große MP3- oder MP4-Datei im Dateibrowser mit **WinWeb Player ↗** öffnen: Sie startet sofort, der Schieberegler springt an jede Stelle.

- **Dateizugriff für Apps (beta.11):** ShareCommander 1.1 und Webpad 1.3 aus dem Store installieren – vor dem Installieren steht „Zugriff auf Dateien“. ShareCommander öffnen: das rechte Panel zeigt `BOX:// <Volume>`. Eine Datei aus dem linken Panel (Browser) mit **F5** auf die Box kopieren, **F7** Ordner anlegen, **F2** umbenennen, **Entf** löschen – alles erscheint im ShareOS-Dateibrowser. Eine Textdatei der Box mit **F4** in Webpad öffnen, ändern, Strg+S: die Datei auf der Box ist geändert. In Webpad *Datei → Auf der Box speichern…* testen. Als Benutzer ohne persönlichen Ordner zeigt ShareCommander nur das Browser-Dateisystem.

## 14b. Meldungen

- **System → Meldungen**: E-Mail (Mailserver, STARTTLS/SSL, Benutzer, Passwort, Absender, Empfänger) und/oder Push (ntfy: `https://ntfy.sh/<thema>`, das Thema in der ntfy-App abonnieren; Gotify: Server und App-Token; Webhook). **Speichern**, dann **Testnachricht** – sie muss ankommen.
- Eine Meldung auslösen: eine Platte des Spiegels ziehen (oder auf eine echte warten) – innerhalb von 10 Minuten erscheint „RAID md0 unvollständig“, oben steht „1 MELDUNG“, und sie wird verschickt. Nach der Reparatur erscheint sie als erledigt.
- Von Hand prüfen: `shareos-notify check`, Liste: `shareos-notify list`.

## 14c. Neu in beta.12

- **Terminal:** System → Terminal → *Terminal öffnen*: eine Shell als root erscheint im Fenster (z. B. `uptime`, `tail /var/log/messages`). *Beenden* oder Seite verlassen beendet sie.
- **Bereiche:** System → Darstellung → Bereiche: *Cloud* ausschalten – der Reiter CLOUD verschwindet, geplante Cloud-Aufträge laufen nicht mehr. Wieder einschalten.
- **Telegram:** System → Meldungen → Push → Dienst *Telegram (Bot)*: Bot-Token von @BotFather eintragen, speichern, dem Bot schreiben, *Chat-ID suchen*, speichern, *Testnachricht*.
- **Cloud:** Cloud → Konto hinzufügen → *Google Drive*: „Bei Google Drive anmelden ↗“, anmelden, die Adresse aus der Browserzeile (http://127.0.0.1:53682/…) einfügen, *Übernehmen*, *Hinzufügen*, *Prüfen*.
- **Sprache:** System → Darstellung → Sprache *English*: alle Seiten durchklicken – es sollte kein Deutsch mehr zu sehen sein (sonst Bildschirmfoto an Claude).

## 14d. System-Apps (0.2.0-beta.1)

1. Apps → Store → *Paket installieren*: `nano-8.7.0.sapp` wählen, *Hochladen & installieren*. Genauso `htop-3.4.1.sapp`.
2. Apps → Installiert: beide mit dem Kennzeichen „System-App · Terminal“ und dem Knopf *Terminal* (kein *Öffnen*, kein *Benutzer*).
3. System → Terminal zeigt „Aus System-Apps: nano · htop“. *Terminal öffnen*:
   - `htop` – Prozesse, CPU und Speicher erscheinen farbig; beenden mit `q`.
   - `nano /tmp/test.txt` – etwas tippen, speichern mit Strg+O, Enter, beenden mit Strg+X; `cat /tmp/test.txt`. Umlaute (äöü) müssen richtig aussehen.
   - `which nano` → `/opt/shareos/bin/nano`.
4. Dasselbe per SSH (`ssh root@<box>`, dann `htop`).
5. Firmware-Update (oder Neustart): nano und htop sind noch da.
6. Apps → Installiert → htop → *Entfernen*: `htop` im Terminal → „not found“.

## 14e. Apps je Konto und Dateien der Box (0.2.0-beta.1)

1. Webpad 1.4 und WinWeb Player 1.1 installieren (Store oder die `.sapp`-Dateien).
2. Als **root**: Webpad öffnen, „Geheimnis von root“ tippen, Fenster schließen.
3. Abmelden, als **Benutzer** (mit Web-Zugang) anmelden, Webpad aus *Mein ShareOS* öffnen: Der Text von root ist **nicht** da. Etwas tippen, schließen.
4. Wieder als root: Webpad zeigt „Geheimnis von root“.
5. WinWeb Player → **+ Von der Box**: ein Dialog mit deinen Ordnern (Benutzer: persönlicher Ordner; root: Volumes und USB-Laufwerke). Einen Ordner mit MP3s wählen, mehrere mit Strg+Klick markieren, *Öffnen*: Sie stehen in der Playlist, spielen sofort, der Schieberegler spult. **+ Vom Rechner** geht weiterhin.
6. WebTerm: `webpad <datei>`, während Webpad geschlossen ist – Webpad öffnet sich in einem **eigenen Fenster** (kein Tab) mit der Datei.
7. System → Terminal über **HTTPS** (`https://<box>/`): Die Shell erscheint (kein „Press ↵ to Reconnect“).

## 14f. Feature Lock (0.2.0-beta.2)

1. Alle Seiten durchklicken: alles wie vorher, die Seiten erscheinen schneller (vor allem *Apps*, *System → Dienste*, die Übersicht nach dem Anmelden).
2. Apps → Store → *Jetzt aktualisieren*: Die Oberfläche bleibt bedienbar, während der Store seine Quellen fragt; die Liste aktualisiert sich von selbst.
3. System → Terminal über HTTPS: funktioniert (jetzt mit mbedtls statt OpenSSL).
4. Bei Bedarf `strace-6.19.0.sapp` und `iperf3-3.20.0.sapp` installieren: `strace -V`, `iperf3 -s` im Terminal.
5. Zeitzone, Zertifikat (System → Allgemein), Benutzer und Speichergrenzen, Meldungen: unverändert.

Telegram (14c) wurde am 20.10.2026 auf der echten Box getestet: Bot, Chat-ID und Testnachricht funktionieren.

## 14g. Modelle (0.2.0-beta.3)

Auf dem DNS-320L muss alles wie vorher funktionieren:
1. System → Über: Gerät „D-Link DNS-320L rev A“, Firmware-Name `DNS-320L-rev-Ax`, kein „noch ungetestet“.
2. System → Terminal: `shareos-boardinfo` zeigt `BOARD_ID="dns320l"`, `BOARD_CONTROL="mcu"`; `cat /tmp/sys/board.env`.
3. Lüfter-Voreinstellungen, Temperatur, Status-LED, Platten-LEDs, Ein/Aus-Taster, Reset- und USB-Taste, Uhrzeit nach Neustart ohne Netzwerk – wie vorher.
4. System → Firmware → *Firmware-Datei installieren* mit `ShareOS-<ver>-DNS-325-rev-Ax.bin`: abgelehnt (Meldung „the file is for another device …“).
5. Ein Update von GitHub nimmt die `DNS-320L-rev-Ax`-Dateien.

Andere Modelle: [GERAETE.md](GERAETE.md) (Anleitung für Tester).

## 14h. Transmission je Benutzer (0.2.0-beta.4)

Braucht ein Laufwerk (Speicher) und die Dateien `transmission-daemon-4.1.0.sapp` (Release der Firmware) und `transmission-1.1.0.sapp` (App-Store oder Release von ShareOS-Apps).

1. Apps → Store → *Paket installieren*: `transmission-daemon-4.1.0.sapp`, danach `transmission-1.1.0.sapp` (oder Transmission aus dem Store). Der Installationsdialog zeigt „Eigene Torrents (Transmission)“.
2. Als **root**: Transmission öffnen. Nach ein paar Sekunden „● Verbunden“; *Einstellungen* zeigt den Download-Ordner `daten/Downloads` (dein Laufwerk) und den Peer-Port 51413.
3. *+ Torrent* → Link: ein Magnet-Link (z. B. einer Linux-ISO), *Durchsuchen* → Ordner wählen, *Hinzufügen*: der Download landet in diesem Ordner.
4. Als **Benutzer** mit Weboberfläche und Dateibrowser anmelden, Transmission unter *Mein ShareOS* öffnen: leere Liste (die Torrents von root sind nicht da), Download-Ordner „Mein Ordner/Downloads“. Einen Torrent hinzufügen: die Dateien gehören dem Benutzer (Dateibrowser).
5. Im Terminal: `ps | grep transmission-daemon` – ein Dienst je Konto (root und der Benutzer); `ls /tmp/shareos-transmission/`.
6. Box neu starten: die Torrents laufen von selbst weiter, ohne die App zu öffnen.
7. Apps → Installiert → transmission-daemon → *Entfernen*: die Dienste halten an, die App meldet „Der Transmission-Dienst ist nicht installiert“. Die Downloads bleiben.

## 14i. Medien umwandeln mit FFmpeg (0.2.0-beta.5)

Braucht ein Laufwerk, ein paar Medien darauf (ein Video, z. B. `.mkv` oder `.mp4`, und ein Musikstück) und die Dateien `ffmpeg-6.1.5.sapp` (Release der Firmware) und `mediatranscoder-1.0.0.sapp` (App-Store oder Release von ShareOS-Apps).

1. Apps → Store: MediaTranscoder installieren (holt die System-App `ffmpeg` mit) – oder per *Paket installieren* erst `ffmpeg-6.1.5.sapp`, dann `mediatranscoder-1.0.0.sapp`. Der Installationsdialog zeigt die Berechtigung „Medien umwandeln (FFmpeg)“.
2. Als **root** MediaTranscoder öffnen: oben rechts „FFmpeg bereit“.
3. *Datei wählen …* → ein Video: Länge, Größe, Video- und Tonspuren erscheinen; voreingestellt ist *Container wechseln* nach MP4 (bei einer MP4-Datei MKV). *Umwandeln starten*: der Auftrag läuft mit Fortschritt, die neue Datei liegt im selben Ordner und spielt im WinWeb Player (*Im WinWeb Player abspielen*).
4. *Audio umwandeln / herausholen*, Format MP3, 192 kbit/s, *Ausschnitt* ab `00:01:00`, Länge `30`, Zielordner ändern: eine 30 s lange MP3-Datei im gewählten Ordner. Dauert auf der Box etwa so lange wie das Stück selbst oder weniger.
5. Einen langen Auftrag starten und *Abbrechen*: Status „abgebrochen“, keine (halbe) Datei im Ordner (auch keine versteckte `.name.<id>.mp3`).
6. Denselben Dateinamen noch einmal: Meldung „Eine Datei mit diesem Namen gibt es im Zielordner schon.“ – nichts wird überschrieben.
7. Als **Benutzer** mit Weboberfläche und Dateibrowser: MediaTranscoder unter *Mein ShareOS*, nur der eigene Ordner ist wählbar, die Aufträge von root sind nicht zu sehen; das Ergebnis gehört dem Benutzer (Dateibrowser).
8. Im Terminal während eines Auftrags: `ps | grep ffmpeg` – läuft mit `nice` 19; `ls /tmp/shareos-media/jobs/`.
9. Apps → Installiert → ffmpeg → *Entfernen* (fragt, weil MediaTranscoder sie braucht): laufende Aufträge brechen ab, die App meldet „FFmpeg fehlt“.

**Store-Rubriken und Bash (0.2.0-beta.5):** Apps → Store: unter „Verfügbare Apps“ die Rubriken (Medien, Netzwerk, Werkzeuge, System …) mit Anzahl; ein Klick zeigt nur diese Rubrik, *Alle* wieder alles; „Suchen …“ filtert beim Tippen. Bash aus dem Store (Rubrik Werkzeuge) installieren, im Terminal `bash`, dann `echo $BASH_VERSION` → `5.2.37…`, `exit`.

## 14j. Snapshots (0.2.0-beta.6)

Braucht zwei Laufwerke mit ext4 oder Btrfs (z. B. die Platte und eine USB-Festplatte) und eine Freigabe mit ein paar Dateien.

1. Speicher → **Snapshots** → *Neuer Snapshot-Auftrag*: Name `fotos`, *Was sichern* = die Freigabe, *Ziel-Laufwerk* = das andere Laufwerk, *Täglich* 03:15, Behalten 3 · 7 · 4 · 6, Ausnahme `*.tmp` → *Speichern*. Ein Laufwerk mit FAT32/exFAT ist als Ziel ausgegraut.
2. *Jetzt sichern*: „läuft“, danach „OK“ mit Anzahl der Dateien und der Größe. Der erste Snapshot kopiert alles – bei vielen GB dauert das (Platte → Platte etwa so lange wie Kopieren).
3. In der Freigabe eine Datei ändern, eine löschen, eine neue anlegen; *Jetzt sichern*: „N geändert“ ist klein, der zweite Snapshot geht schnell.
4. *Snapshots (2)* → beim älteren *Im Dateibrowser öffnen*: die gelöschte Datei ist dort, mit dem alten Inhalt der geänderten. Datei zurück in die Freigabe kopieren.
5. Im Terminal: `du -sh /mnt/<ziel>/Snapshots/fotos/*` – der zweite Snapshot belegt fast nichts (Hardlinks); `ls -ld /mnt/<ziel>/Snapshots` → `drwx------ root`.
6. Einen großen Ordner sichern, nach ein paar Sekunden *Stopp*: „abgebrochen“; das nächste *Jetzt sichern* macht weiter.
7. *Protokoll* am Auftrag: die rsync-Zusammenfassung. Ziel-USB-Platte abziehen, *Jetzt sichern*: „Fehler“ und eine Meldung (Glocke, E-Mail/Push falls eingerichtet).
8. `cat /etc/crontabs/root`: eine Zeile `15 3 * * * /usr/sbin/shareos-snapshot run fotos`. Am nächsten Morgen ist der Snapshot von 3:15 da.
9. *Entfernen* → „Snapshots auch löschen?“ → *Snapshots löschen*: Auftrag und Ordner sind weg.

## 14k. Medienserver (0.2.0-beta.6)

Braucht ein Laufwerk mit einer Freigabe mit Musik (MP3/FLAC) und einer mit Videos (MP4/MKV) und die Datei `minidlna-1.3.3.sapp` (Release der Firmware; oder MiniDLNA aus dem Store). Dazu ein Fernseher oder VLC im selben Netzwerk.

1. Dienste → **Medienserver**: ohne System-App der Hinweis mit *Im Store installieren*. MiniDLNA installieren (Store oder *Paket installieren*).
2. *Einstellungen*: Musik-Freigabe → „nur Musik“, Video-Freigabe → „nur Videos“, Name z. B. „Wohnzimmer“, *Medienserver eingeschaltet* → *Speichern*: „läuft“, „liest Ordner ein …“, die Zahlen steigen.
3. VLC (Ansicht → Wiedergabeliste → Lokales Netzwerk → Universal Plug'n'Play) oder der Fernseher (Quellen/Medienserver): „Wohnzimmer“ erscheint, Musik und Videos spielen, im Video spulen.
4. Neue Datei in die Musik-Freigabe kopieren: nach kurzer Zeit zählt „Musikstücke“ eins mehr, ohne Neustart.
5. Dienste → Status: „Medienserver (DLNA)“ läuft; Box neu starten: der Server startet von selbst und liest nicht alles neu (die Bibliothek liegt in `/mnt/<laufwerk>/.shareos/minidlna`).
6. *Alles neu einlesen*: „liest Ordner ein …“, danach dieselben Zahlen.
7. Ausschalten → *Speichern*: Fernseher/VLC sehen den Server nicht mehr (nach einigen Minuten).
8. Apps → Installiert → minidlna → *Entfernen*: der Server hält an, die Seite zeigt wieder den Hinweis.

## 14l. VPN mit NetTunnel (Client und Server) und Anzeigen im Kopf (0.2.0-beta.6)

Braucht ein OpenVPN-Profil (`.ovpn`, z. B. vom Router im Büro oder von einem VPN-Anbieter) mit eingebetteten Zertifikaten, die Datei `openvpn-2.6.20.sapp` (Release der Firmware) und NetTunnel (Store oder `nettunnel-1.0.0.sapp`).

1. Als **root**: Apps → Store → NetTunnel installieren (holt `openvpn` mit). NetTunnel öffnet sich in der Oberfläche.
2. *Vom Computer …* → das `.ovpn`: Name übernehmen; fragt das Profil nach Anmeldung, Benutzername/Passwort eintragen → *Einspielen*. Stand im Profil z. B. ein `up`-Skript, meldet NetTunnel „Entfernt: up“.
3. *Verbinden*: nach ein paar Sekunden „VPN verbunden“ mit Tunnel-Adresse; oben im Kopf der ShareOS-Oberfläche der Chip **VPN · 10.x.x.x**, ein Klick öffnet NetTunnel.
4. Im Terminal: `ip addr show tun0`, `ip route` – mit „Gesamten Verkehr der Box durch den Tunnel“ zwei Routen `0.0.0.0/1` und `128.0.0.0/1` über tun0; ohne nur die Netze des VPN. Ein Rechner im VPN-Netz ist per `ping` erreichbar.
5. *Bearbeiten* → *Beim Start der Box verbinden* → Box neu starten: die Verbindung steht nach etwa einer halben Minute von selbst.
6. Ein Profil mit `ca /pfad/ca.crt` statt `<ca>…</ca>`: „Das Profil verweist auf Dateien …“. Ein Server-Profil: abgelehnt.
7. Als **Benutzer** (kein Admin): NetTunnel ist nicht sichtbar bzw. meldet „nur für Administratoren“.
8. Transmission eines Benutzers lädt etwas herunter → im Kopf **TORRENT · ↓ 1** (ab 0.2.0-beta.7 nur, solange etwas geladen oder hochgeladen wird; pausiert: kein Chip) (Admin: der eigene Dienst; Benutzer: in „Mein ShareOS“). System → Darstellung → *Anzeigen im Kopf*: Häkchen weg → der Chip verschwindet (nur in diesem Browser).
9. Apps → Installiert → openvpn → *Entfernen*: die Verbindung endet, der Chip geht.

**Server-Modus** (von unterwegs ins Heimnetz; braucht ein Handy mit der App „OpenVPN Connect“ und mobile Daten statt WLAN):

10. openvpn wieder installieren, NetTunnel → *Box als Server*. Adresse im Internet (DynDNS-Name des Routers), Port 1194, UDP, VPN-Netz 10.8.0.0, *Server eingeschaltet* → *Speichern*: beim ersten Mal dauert es etwas (Zertifikate), dann „läuft“; im Kopf **VPN-SERVER · 0 Geräte**. VPN-Netz = Heimnetz (z. B. 192.168.1.0): abgelehnt.
11. Im Router die Portfreigabe aus dem Hinweis einrichten (UDP 1194 → IP der Box).
12. Name `handy-test` → *Gerät hinzufügen*: `ShareOS-handy-test.ovpn` wird heruntergeladen. Aufs Handy bringen (oder *Auf der Box speichern* und am Handy aus der Freigabe holen), in OpenVPN Connect importieren, WLAN aus, verbinden.
13. In NetTunnel steht das Gerät als „verbunden“ mit VPN-Adresse 10.8.0.2 und Datenmenge; der Chip zeigt **1 Gerät**. Am Handy im Browser `http://10.8.0.1` → die ShareOS-Oberfläche.
14. *Auch das Heimnetz erreichbar machen* + im Router die statische Route 10.8.0.0/24 → IP der Box: am Handy ist der Router (z. B. `http://192.168.1.1`) erreichbar.
15. Gerät *Entfernen*: die Verbindung am Handy bricht ab und kommt nicht wieder. Box neu starten: der Server läuft wieder von selbst.

## 14m. Freigaben nach Rechten – auch für Apps und Linux (0.2.0-beta.6)

Braucht ein Laufwerk mit ext4 oder Btrfs, die Benutzer **anna** und **lisa** (Rolle Benutzer, „Dateien“ eingeschaltet) und ShareCommander 1.3 (Store).

1. Freigaben → neue Freigabe `fotos`: anna *lesen & schreiben*, lisa *nur lesen*, ein paar Dateien hineinkopieren.
2. Als **anna** anmelden → *Mein ShareOS* → **Dateien**: Auswahl „Persönlicher Ordner“ und „fotos“. In `fotos` einen Ordner anlegen: klappt.
3. Als **lisa**: „fotos (nur lesen)“; *Neuer Ordner*, *Hochladen*, *Umbenennen*, *Löschen* sind ausgegraut, herunterladen geht.
4. lisa öffnet **ShareCommander**: links der persönliche Ordner, rechts „🔒 fotos (nur lesen)“. **F7** in fotos: „nur lesen – hier darfst du nichts ändern“. Kein `/etc` mehr im Browser-Speicher.
5. Ein Benutzer ohne Recht an `fotos` sieht die Freigabe nirgends.
6. Ein Benutzer ohne „Dateien“: ShareCommander zeigt den Hinweis „Kein Zugriff auf die Ordner der Box …“ statt stillschweigend nur den Browser-Speicher.
7. Linux-Ebene im Terminal (als root): `getfacl /mnt/<laufwerk>/<fotos-ordner>` zeigt `user:anna:rwx`, `user:lisa:r-x`, `other::---`. `su -s /bin/sh lisa -c 'touch /mnt/<laufwerk>/<fotos-ordner>/x'` → „Permission denied“.
8. Per SMB vom Rechner: lisa kann lesen, nicht schreiben; anna beides; neue Dateien von anna kann lisa öffnen.
9. Rechte ändern (lisa entfernen) → nach kurzer Zeit (bei vielen Dateien etwas länger, es läuft im Hintergrund) hat lisa keinen Zugriff mehr, auch nicht auf Unterordner.
10. Per SMB, Zugriff über eine Gruppe: lisa in eine Gruppe `familie` aufnehmen, die Freigabe `fotos` nur der Gruppe (`@familie`) geben und lisa dort als Benutzer entfernen. Am Mac (Finder) als lisa anmelden: die Freigabe öffnet sich (vor ksmbd-tools 3.5.3 meldete der Finder „Das Original wurde nicht gefunden“).
## 14n. Tailscale und große System-Apps auf dem Laufwerk (0.2.0-beta.7)

Braucht ein Tailscale-Konto (kostenlos), ein Handy oder einen Rechner mit Tailscale und die Datei `tailscaled-<version>.sapp` (Release der Firmware) sowie eine App mit der Berechtigung `tailscale` (ShareOS-Apps).

1. Vor dem Update im Terminal `df -h /` merken. Nach dem Update (Neustart) zieht die Box große System-Apps (FFmpeg, Transmission, MiniDLNA, OpenVPN) aufs Laufwerk: `ls -l /opt/shareos/sysapps` zeigt bei ihnen `-> /mnt/<laufwerk>/.shareos/sysapps/…`, nano/htop/bash bleiben Ordner. `df -h /` zeigt mehr frei. Transmission, Medienserver und VPN laufen wie vorher.
2. Apps → Store → System-Apps → **tailscaled** installieren: `ls -l /opt/shareos/sysapps/tailscaled` ist ein Link aufs Laufwerk, `df -h /` ändert sich kaum. Ohne weiteres Zutun läuft der Dienst: `ps | grep [t]ailscaled` (ab 0.2.0-beta.9).
3. Die Tailscale-App öffnen → *Verbinden*: Es erscheint ein Anmelde-Link (bzw. QR-Code). Am Handy öffnen, mit dem Tailscale-Konto bestätigen. Nach ein paar Sekunden „verbunden“, im Kopf **TAILSCALE · 100.x.y.z**.
4. Am Handy (mobile Daten, WLAN aus, Tailscale an): `http://100.x.y.z` → die ShareOS-Oberfläche; Freigaben per SMB über `\\100.x.y.z`.
5. Im Terminal: `ip addr show tailscale0`; `TS_BE_CLI=1 tailscaled --socket=/tmp/shareos-tailscale/tailscaled.sock status` listet die Geräte. `ps` zeigt `tailscaled`, `cat /proc/$(cat /tmp/shareos-tailscale/pid)/status | grep VmRSS` – unter etwa 60 MB.
6. Box neu starten: nach etwa einer Minute ist sie von selbst wieder im Tailnet.
7. In der App *Trennen*: der Chip zeigt „getrennt“; *Abmelden*: die Box verschwindet aus dem Tailnet (Admin-Konsole von Tailscale).
8. Apps → Installiert → tailscaled → *Entfernen*: der Dienst hält an, der Ordner auf dem Laufwerk ist weg.

## 14o. Apps in der Seite (0.2.0-beta.7)

1. Apps → Installiert → NetTunnel → *Öffnen*: Statt „INSTALLIERTE APPS“ steht oben „NETTUNNEL“, darunter die App in voller Breite; die Adresse ist `#/apps/run/nettunnel`. Kein Kasten über der Seite.
2. Ein paar Sekunden warten (die Oberfläche aktualisiert sich): NetTunnel bleibt, wie es ist (kein Neuladen).
3. *In eigenem Fenster ↗*: NetTunnel öffnet sich in einem eigenen Fenster (ohne Tabs und Adresszeile), die Seite springt zurück zur Liste.
4. Bei NetTunnel die Auswahl auf *Eigenes Fenster*: *Öffnen* öffnet jetzt ein Fenster. Zurück auf *In der Seite*.
5. Webpad (ohne `embed`) → *Öffnen ↗*: ein eigenes Fenster, kein neuer Tab.
6. Als Benutzer in „Mein ShareOS“: eine App mit `embed` öffnet sich in der Seite (`#/app/<id>`), ✕ führt zurück.

## 14w. Papierkorb im Dateibrowser (0.2.0-beta.12)

1. *Freigaben → Dateien* (oder als Benutzer *Mein ShareOS → Dateien*): eine Datei und einen Ordner auswählen, *Löschen* → der Dialog sagt „in den Papierkorb“, die Einträge verschwinden aus der Liste.
2. *Papierkorb*: beide Einträge mit Herkunft und Zeit. Einen auswählen → *Wiederherstellen*: wieder im ursprünglichen Ordner. Gibt es dort inzwischen eine Datei mit dem Namen, kommt sie als `name (2).ext` zurück.
3. *Endgültig löschen* / *Papierkorb leeren* löschen für immer. Im Terminal: `ls -la /mnt/<laufwerk>/home/<benutzer>/.shareos-trash/` (persönlicher Ordner) oder `ls -la /mnt/<laufwerk>/<freigabe-ordner>/.shareos-trash/`.
4. Unter dem Dateibrowser (Admins): Papierkorb ausschalten → *Löschen* löscht wieder sofort (roter Dialog). Tage: 7–90 oder nie; ältere Einträge verschwinden, wenn dieser Papierkorb das nächste Mal geöffnet oder benutzt wird.
5. Über SMB vom PC gelöschte Dateien sind sofort weg (der Ordner `.shareos-trash` ist versteckt; bitte nicht anfassen).
## 14x. USB-Kopie mit der USB-Taste (0.2.0-beta.12)

1. *Speicher → Einstellungen → USB-Taste*: Häkchen, Ziel-Laufwerk (z. B. `daten`), Ordner `USB-Kopien`, *Speichern*.
2. USB-Stick mit ein paar Dateien einstecken. USB-Taste kurz drücken: Die USB-Lampe blinkt; danach kommt die Meldung „USB-Kopie fertig“ mit der Zahl der Dateien. `ls /mnt/daten/USB-Kopien/` zeigt `2026-…_…-<Stick-Name>` mit den Dateien. Der Stick bleibt eingehängt.
3. Noch einmal drücken: ein zweiter Ordner, der erste bleibt unberührt.
4. Taste 3 s oder länger halten: Der Stick wird ausgeworfen (wie bisher).
5. *Jetzt kopieren* auf der Seite macht dasselbe. Ein Stick, der größer ist als der freie Platz: Meldung „Zu wenig Platz“, nichts kopiert.
6. Häkchen weg: Kurz drücken wirft wieder nur aus.

## 14v. Mein ShareOS, „Teilen mit“, Dateidialog mit Freigaben (0.2.0-beta.11)

1. Als normaler Benutzer anmelden: Die Reiter heißen *MEIN SHAREOS*, (*DATEIEN*,) *EINSTELLUNGEN*. *Einstellungen* zeigt links die Darstellung und rechts *Passwort ändern*; das Ändern funktioniert wie bisher. Die alte Adresse `#/appearance` öffnet *Einstellungen*.
2. *Mein ShareOS*: *SPEICHER* ist eine Tabelle über die ganze Breite – je Laufwerk eine Zeile mit Inhalt (persönlicher Ordner, Freigaben), eigenem Verbrauch, Limit, Balken und freiem Platz. Mit Limit zeigt der Balken den Anteil am Limit, ohne Limit die Belegung des Laufwerks.
3. „Teilen mit“ (Android, Chrome, Oberfläche mit vertrauenswürdigem Zertifikat geöffnet, z. B. `https://shareos.skynet.lan`): Menü ⋮ → *App installieren*. Dann in der Galerie ein Foto teilen → *ShareOS*. ShareOS öffnet sich; nach der Anmeldung (falls nötig) meldet ein Hinweis „1 Datei(en) in „Geteilt“ …“ und der Dateibrowser zeigt `Persönlicher Ordner / Geteilt`. Im Terminal: `ls -la /mnt/<laufwerk>/home/<benutzer>/Geteilt/` – die Datei gehört dem Benutzer, der Ordner hat `drwx------`.
4. Dasselbe Foto noch einmal teilen: Es kommt als `name (2).jpg` an. Einen Link aus dem Browser teilen: Es entsteht `Link <Datum Uhrzeit>.txt` mit der Adresse.
5. Konto ohne persönlichen Ordner: Teilen meldet „no personal folder“; das Geteilte wird verworfen und kommt bei der nächsten Anmeldung nicht wieder.
6. Dateidialog einer App für ein Konto **ohne** *Dateien* (z. B. Webpad → *Öffnen*): Die Ordnerauswahl zeigt zuerst *App-Daten*, dann *Mein Ordner* und die Freigaben des Benutzers; Freigaben nur zum Lesen sind markiert und fehlen beim Speichern. Die App legt ihre eigenen Dateien weiter in *App-Daten* ab.

## 14zd. SMB-Kompatibilitätsmodus (0.2.0-beta.17)

1. Freigaben → Dienste → SMB: *Kompatibilitätsmodus (höchstens SMB 2.1)* einschalten. `grep protocol /etc/ksmbd/ksmbd.conf` zeigt `server max protocol = SMB2_10`.
2. Unter Windows alle Explorer-Fenster zur Box schließen, `net use * /delete /y`, Freigabe neu öffnen. `Get-SmbConnection | Select-Object ServerName,Dialect,Signed` zeigt `2.1`. Eine große Datei kopieren: mit Signatur etwa 9–14 MB/s (DNS-320L), vorher 4–10.
3. Ausschalten: die Zeile verschwindet, nach dem Neuverbinden wieder `3.1.1`.

## 14zc. OneDrive (0.2.0-beta.16)

Braucht ein Microsoft-Konto mit OneDrive und rclone (Cloud → rclone installieren).

1. Cloud → *Konto hinzufügen* → Microsoft OneDrive: anmelden, Adresse einfügen, *Hinzufügen*. `grep -A6 '^\[<name>\]' /etc/shareos/cloud/rclone.conf` zeigt `drive_id` und `drive_type`. *Testen* zeigt die Ordner; ein Download-Auftrag läuft ohne SSH.
2. Dasselbe als Benutzer unter *Mein ShareOS* → Cloud: das Konto landet in `~/.config/rclone/rclone.conf` des Benutzers.
3. Freigabe mit Pfad im persönlichen Ordner eines Benutzers (z. B. `home/anna`), Admin-Auftrag *Herunterladen* dorthin, *Jetzt starten*: `ls -la /mnt/<laufwerk>/home/anna` zeigt die neuen Dateien als `anna users`; der Benutzer öffnet sie über SMB.

## 14za. Zabbix-Agent (0.2.0-beta.15)

Braucht einen Zabbix-Server 7.0 oder neuer im Netz (z. B. den auf der Arbeit oder einen Test-Server im Proxmox).

1. Apps → Store → System-Apps → **Zabbix Agent** installieren. `ls -l /opt/shareos/sysapps/` zeigt `zabbix-agent` als Ordner im Flash (kein Link aufs Laufwerk). `shareos-zabbix status`: `"installed": true`, `"running": false` – ohne Server startet er nicht.
2. `echo '{"enabled": true, "server": "<zabbix-server>"}' | shareos-zabbix set` → `"running": true`. `ps | grep [z]abbix` zeigt drei Prozesse des Benutzers `zabbix` (main, collector, active checks), `netstat -tln | grep 10050` ist leer.
3. Arbeitsspeicher: `for p in $(pgrep zabbix-agentd); do grep VmRSS /proc/$p/status; done` – zusammen nur wenige MB (bitte die Zahlen notieren).
4. Im Zabbix-Server die Vorlage `docs/zabbix/shareos_template.yaml` importieren, einen Host mit dem Namen der Box anlegen (Vorlagen *Linux by Zabbix agent active* und *ShareOS by Zabbix agent active*). Nach 1–2 Minuten: *Neueste Daten* zeigt CPU, Speicher, Netzwerk und `Box: temperature`. *Erkennungsregeln → Disks in the bays / RAID arrays → Jetzt ausführen*: die Platten (ohne USB-Stick) und das RAID erscheinen, mit Temperatur und Bewertung wie unter *Speicher → Gesundheit*.
5. Verschlüsselt: `openssl rand -hex 32` (auf dem PC), dann `echo '{"psk_identity": "<box> PSK", "psk": "<schlüssel>"}' | shareos-zabbix set`; im Host in Zabbix *Verschlüsselung → PSK* mit denselben Werten. Die Werte kommen weiter, `shareos-zabbix log` zeigt keine TLS-Fehler.
6. Eine Platte schlafen lassen (`hdparm -y /dev/sdb`), 30 Minuten warten: `shareos-zabbix get disk sdb standby` → `1`, die Temperatur bleibt der letzte Wert, `hdparm -C /dev/sdb` zeigt weiter *standby*.
7. `grep zabbix /etc/crontabs/root` zeigt `*/30 … shareos-zabbix collect`. Box neu starten: der Agent läuft wieder (Dienste → Status: „Überwachung (Zabbix-Agent)“). `echo '{"enabled": false}' | shareos-zabbix set`: gestoppt, keine Cron-Zeile mehr, bleibt nach einem Neustart aus.
8. System-App entfernen: der Agent hält an.

## 14zb. Start-Protokoll und Zeitplan (0.2.0-beta.15)

1. Box neu starten, 6 Minuten warten. System → Protokolle → *Start-Protokoll …*: der Start erscheint mit Datum; Auswahl zeigt Systemprotokoll, Kernel, Adressen, Routen, Ports, Prozesse, Laufwerke und RAID. Im Terminal: `shareos-bootlog list`, `ls -l /etc/shareos/bootlog` (je wenige KB).
2. Noch drei Mal neu starten: `shareos-bootlog list` zeigt nur die neuesten 3.
3. System → Energie & Reset → *Zeitplan*: einschalten, für heute Ausschalten in 5 Minuten und Einschalten 10 Minuten danach eintragen, *Speichern*. Die Seite zeigt das nächste Aus- und Einschalten; `shareos-power status` zeigt dieselben Zeiten und unter `alarm` den Weckalarm.
4. Zum Ausschalten fährt die Box sauber herunter; zur Einschaltzeit geht sie von selbst an (DNS-320L, DNS-320 rev B, DNS-327L). `grep shareos-power /var/log/messages` bzw. das Start-Protokoll zeigt „scheduled switch-off, back on …“.
5. Läuft ein RAID-Aufbau, wird das Ausschalten übersprungen (Meldung im Protokoll). Zeitplan ausschalten: `shareos-power status` → kein nächstes Ein-/Ausschalten, `grep shareos-power /etc/crontabs/root` ist leer.

## 14z. Neu in 0.2.0-beta.13 / beta.14

1. Erst *Paperless*, dann *Freigaben* öffnen: die Freigaben erscheinen (vorher blieb die Paperless-Seite stehen).
2. System → Terminal → *In eigenem Fenster ↗*: ein Fenster (kein Tab) öffnet sich mit funktionierender Shell; die Seite zeigt „Das Terminal läuft in einem eigenen Fenster“, *Hier anzeigen* holt es zurück.
3. BeatBox → *⚡ An WinWeb*: WinWeb Player öffnet sich und kann Dateien von der Box öffnen (*+ Von der Box*).
4. Öffnet eine einfache App eine App mit mehr Rechten (z. B. SysMon, NetTunnel), bekommt diese **keinen** Zugriff (keine Dateien in dem Fenster).
5. (beta.14) `ls -ld /mnt/*/.shareos` zeigt `drwx--x--x`; die System-App autobrr startet (APPS → autobrr oder `shareos-autobrr start`).

## 14y. Berechtigung notify (0.2.0-beta.12)

Braucht eine App mit der Berechtigung `notify` (z. B. HomePing in einer Version, die sie nutzt) – oder eine eigene Test-App mit einer Aufgabe, die `shareos-app-notify warn test "Test" "Hallo"` aufruft.

1. APPS → die App → *Berechtigungen*: das Schild *Meldungen senden* mit seiner Erklärung.
2. Aufgabe der App ausführen (APPS → Aufgaben → *Jetzt ausführen*): Unter System → Meldungen steht „<App>: Test“ mit dem Text; mit eingerichteter E-Mail oder Push kommt sie auch dort an.
3. Eine Aufgabe, die `shareos-app-notify clear test` aufruft, markiert die Meldung als erledigt.
4. Mehr als 20 Meldungen pro Stunde werden abgelehnt (`too many messages` im Protokoll der Aufgabe).
5. App entfernen: ihre offenen Meldungen werden als erledigt markiert.

## 14u. Berechtigungen sysinfo, netcheck, docker, tuya (0.2.0-beta.11)

Braucht die Apps SysMon, HomePing und DockerDeck in einer Version mit diesen Berechtigungen (ShareOS-Apps) – oder eine eigene Test-App.

1. Als root SysMon öffnen: CPU, Arbeitsspeicher, Temperatur und Lüfter entsprechen der Übersicht von ShareOS; die Prozessliste zeigt z. B. `rpcd`, `uhttpd`, `smbd`/`ksmbd`. Im Terminal `sleep 600 &` starten, in SysMon beenden: `ps | grep [s]leep` ist leer. `rpcd` beenden wird abgelehnt.
2. HomePing: den Router (Ping), die Box selbst (`tcp` Port 22) und eine Weboberfläche (`http://…`) eintragen – grün mit Zeiten. Ein ausgeschaltetes Gerät wird rot.
3. DockerDeck: einen Docker-Host mit freigegebener API eintragen (`http://<server>:2375`; am Server z. B. `-H tcp://0.0.0.0:2375` nur im Heimnetz). Die Container erscheinen mit Zustand; *Neu starten* startet einen Container wirklich neu (`docker ps` am Server), *Protokoll* zeigt seine Ausgabe.
4. TuyaPulse (Version mit `tuya`): *Suchen* findet die Tuya-Geräte im Heimnetz (IP, Geräte-ID, Protokoll). Ein Gerät mit seinem Local Key (aus der Tuya-Cloud, z. B. mit `tinytuya wizard`) anlegen: der Schalter schaltet das echte Gerät, der Zustand stimmt mit der Smart-Life-App überein. Ein falscher Local Key ergibt eine Fehlermeldung. Im Terminal geht dasselbe mit `shareos-tuya discover 6` und `shareos-tuya status <ip> <id> <key> 3.3`.
5. Als normaler Benutzer (z. B. anna) öffnen: die Apps melden „no access“.
6. System → Backup: die Datei enthält `dockerhosts`.

## 14t. Persönlicher Ordner für Admins (0.2.0-beta.10)

1. Als root ShareNotes (oder eine andere App mit `files`) öffnen und eine Notiz anlegen: unten steht `Box: 🏠 home/notes/`. Im Terminal: `ls -la /mnt/<apps-laufwerk>/home/root/notes/` zeigt die Notiz; `/mnt/<apps-laufwerk>/home/root` hat `drwx------ root`.
2. Oben auf dem Laufwerk (`ls /mnt/<laufwerk>/`) entsteht kein neuer Ordner `notes`.
3. Im Dateibrowser von root steht „Persönlicher Ordner“ an erster Stelle, danach die Laufwerke wie bisher.
4. Ein Admin-Konto mit eigenem persönlichen Ordner (z. B. jan): Apps legen ihre Dateien unter `/mnt/<laufwerk>/home/jan/` ab.
5. Alte Notizen von oben umziehen: `mkdir -p /mnt/daten/home/root && chmod 700 /mnt/daten/home/root`, dann `mv /mnt/daten/notes /mnt/daten/home/root/` – ShareNotes zeigt sie danach wieder.

## 14s. FAV APPS und Darstellung (0.2.0-beta.10)

1. Als root: Apps → Installiert – jede Web-App hat oben rechts einen kleinen Stern (System-Apps wie nano nicht). Zwei Apps anklicken: der Stern füllt sich, über „Installierte Apps“ erscheint die Leiste **FAV APPS** mit beiden Apps (in der Reihenfolge des Markierens). Auch in der Tabellenansicht steht der Stern neben dem Namen.
2. Übersicht: die Leiste steht direkt über „Status“. Ein Klick auf ein Symbol öffnet die App (in der Seite oder im eigenen Fenster, wie eingestellt).
3. System → Darstellung → **FAV APPS**: „Namen unter den Symbolen zeigen“ aus → nur Symbole; „App-Leiste anzeigen“ aus → die Leiste ist in Übersicht und Apps weg. Wieder einschalten. Im Terminal: `uci show shareos.ui | grep fav`.
4. Als Benutzer (z. B. anna) anmelden: Mein ShareOS → Meine Apps hat Sterne; ein Favorit erscheint oben als Leiste. annas Favoriten sind unabhängig von denen von root; Darstellung → beide Schalter wirken nur für anna (`uci show accounts.anna | grep fav`).
5. Darstellung bei breitem Fenster: die Felder stehen in zwei Spalten; Fenster schmal ziehen (oder Handy): untereinander, volle Breite.
6. Die Reiter Apps, Cloud und Paperless zeigen kein „NEU“ mehr.
7. Per SSH anmelden: die Begrüßung lautet `ShareOS 0.2.0-beta.10 on <Modell>: web interface http://<ip>/, link … Mbit/s.` (kein „test system“, kein Passwort).

## 14r. autobrr (0.2.0-beta.9)

Braucht ein Apps-Laufwerk, die System-Apps `autobrr` und `transmission-daemon` und eine App mit der Berechtigung `autobrr` (ShareOS-Apps).

1. Apps → Store → System-Apps → **autobrr** installieren. Nach etwa einer Minute: `ps | grep [a]utobrr` zeigt den Dienst unter dem Benutzer `autobrr`; Dienste → Status: „Download-Automatik (autobrr)“ läuft.
2. Im Terminal: `/usr/sbin/shareos-autobrr status` – `"ready": true`, `ls -la /mnt/<laufwerk>/.shareos/autobrr` gehört `autobrr` (0700), `/etc/shareos/autobrr/secret.json` nur root.
3. In der App das Konto für die Übergabe wählen (z. B. anna): `ls -ld /mnt/<laufwerk>/.shareos/autobrr-drop` → `drwxrws--- anna autobrr`. annas Transmission neu starten: in ihren Einstellungen ist `watch-dir` dieser Ordner.
4. Weboberfläche einschalten und ein Passwort setzen: `http://<box>:7474` öffnet autobrr, Anmeldung mit `admin` und dem Passwort. Dort einen Indexer/IRC und einen Filter mit der Aktion *Watch dir* → `/mnt/<laufwerk>/.shareos/autobrr-drop` anlegen.
5. Eine `.torrent`-Datei zum Test in den Übergabe-Ordner kopieren (als root, `chown anna:autobrr`): sie verschwindet nach ein paar Sekunden und steht in annas Transmission.
6. `cat /proc/$(cat /tmp/shareos-autobrr/pid)/status | grep VmRSS` – etwa 40–60 MB. Box neu starten: autobrr läuft wieder. App: ausschalten → bleibt aus, auch nach einem Neustart.

## 14q. App-Ordner für Konten ohne „Dateien“ (0.2.0-beta.9)

1. Benutzer → ein Konto (z. B. lisa) mit Weboberfläche, aber **ohne** „Dateien“.
2. Als lisa anmelden → Mein ShareOS → ShareNotes öffnen: kein Hinweis „Kein Zugriff auf die Ordner der Box“, unten steht `Box: 🏠 app/notes/`.
3. Eine Notiz anlegen. Im Terminal (als root): `ls -la /mnt/<apps-laufwerk>/.shareos/userdata/lisa/notes/notes/` zeigt `note_….json`, Besitzer lisa; der Ordner `userdata/lisa` hat `drwx------`.
4. Als lisa: Mein ShareOS zeigt weiterhin keinen Dateibrowser; per SMB ist der Ordner nicht zu sehen.
5. Box neu starten bzw. App neu öffnen: die Notiz ist noch da (auch in einem anderen Browser).
6. Apps → Installiert → ShareNotes entfernen: `userdata/lisa/notes` ist weg. Konto lisa mit „Daten löschen“ entfernen: `userdata/lisa` ist weg.

## 14p. Dienste der System-Apps (0.2.0-beta.9)

1. Nach dem Update im Terminal: `ls /etc/init.d` zeigt `S90services`, kein `S93tailscale`, `S94vpn`, `S95transmission`, `S96dlna` mehr; `/usr/lib/shareos/apphooks` gibt es nicht mehr.
2. `shareos-apps services list` listet die installierten Dienste, z. B. `tailscaled` mit `control` `tailscale`. Bei Paketen von vor beta.9 steht `"legacy": true`.
3. Dienste → Status: Fernzugriff (Tailscale), VPN (OpenVPN), Torrents (Transmission), Medienserver (DLNA) – je nach installierten System-Apps – mit „läuft“ / „gestoppt“. Tailscale *Stoppen*: `ps | grep [t]ailscaled` ist leer; *Starten*: läuft wieder.
4. Dienste → Autostart: bei Tailscale den Haken *starten* entfernen, Box neu starten: `tailscaled` läuft nicht. Haken wieder setzen, neu starten: läuft (die Box ist von selbst wieder im Tailnet).
5. Nach einem Neustart im Systemprotokoll (`grep shareos- /var/log/messages`): `shareos-services` meldet die gestarteten Dienste, die Steuerungen (`shareos-tailscale`, `shareos-transmission` …) ihre Ausgabe.
6. System-App *tailscaled* entfernen und wieder installieren: Der Dienst hält an bzw. läuft gleich nach der Installation.
7. Eine eigene System-App mit `"service": { "control": "gibtsnicht" }` hochladen: abgelehnt mit „this ShareOS has no service controller“.

## 15. Tasten

- **Reset-Taste** (Loch hinten), gedrückt halten und loslassen:
  - kürzer als 5 s: nichts;
  - **5–10 s** (orange USB-LED blinkt langsam): **Zugangs-Reset** – Netzwerk zurück auf DHCP (Ersatzadresse `192.168.0.32`), root-Passwort `shareos`, Weboberfläche wieder über http mit neuem selbstsigniertem Zertifikat; Benutzer, Freigaben, Apps und Daten bleiben; die Box startet neu;
  - 10–15 s (LED aus): abgebrochen;
  - **15 s oder länger** (LED blinkt schnell): **Werkseinstellungen** – alle Einstellungen und installierten Pakete werden entfernt, die Daten auf den Festplatten bleiben.
- **USB-Taste** (vorne): wirft alle USB-Laufwerke sicher aus.
- Was passiert ist, steht im Systemprotokoll (`shareos-buttons`).

## Zurück zu Alt-F

1. Die Alt-F-`.bin` für den DNS-320L bereitlegen (z. B. `Alt-F-1.0-DNS-320L-rev-A.bin`).
2. In ShareOS unter **System → Firmware → Firmware-Datei einspielen** die Datei
   hochladen. ShareOS prüft sie (D-Link-Format, Prüfsummen, Gerät, Größe) und
   zeigt an, was drin ist.
3. **Einspielen** – Kernel und Startsystem werden geschrieben und
   zurückgelesen. Danach **Neu starten**: Alt-F startet.
4. Alt-F läuft dann ohne seine Zusatzpakete. In Alt-F dieselbe `.bin` noch
   einmal über dessen Firmware-Seite flashen, dann sind sie wieder da.

Zurück zu ShareOS: die ShareOS-`.bin` in Alt-F flashen. Solange Alt-F die
Partition `image` nicht überschrieben hat (Schritt 4 ausgelassen), sind System
und Einstellungen von ShareOS noch da; sonst installiert ShareOS sich wie in
Weg A neu. Zur D-Link-Firmware geht es am besten über Alt-F.

## Wenn etwas schiefgeht

| Zeichen | Bedeutung / Abhilfe |
|---|---|
| Die orange USB-LED blinkt | Rettungsmodus: Grund und SSH-Adresse stehen auf der Konsole. `shareos-install-ubi` ist dort verfügbar. |
| U-Boot meldet einen defekten Image-Header | U-Boot startet automatisch das D-Link-Rettungssystem. Darüber lässt sich Alt-F per Weboberfläche flashen. |
| Der Kernel hängt | Wie in Schritt 2 per TFTP starten und die Sicherung zurückschreiben: `flash_erase /dev/mtd1 0 0; nandwrite -p /dev/mtd1 uImage.bin` (mtd2 mit `ramdisk.bin`) |
| Ganz zurück zu Alt-F | Am einfachsten über die Weboberfläche (siehe [Zurück zu Alt-F](#zurück-zu-alt-f)). Ohne Weboberfläche: Sicherung zurückschreiben (siehe Zeile davor), dann in Alt-F die Zusatzpakete neu flashen |

U-Boot, MAC-Adresse und das D-Link-Rettungssystem fasst ShareOS nie an.
