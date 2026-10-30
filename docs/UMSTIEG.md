# Von Alt-F zu ShareOS – und zurück (DNS-320L)

*English version: [SWITCHING.md](SWITCHING.md)*

Der Wechsel läuft komplett über die Weboberflächen, ohne serielle Konsole und
ohne Löten. Auf echter Hardware erprobt am 20.10.2026: Alt-F → ShareOS und
ShareOS → Alt-F.

**Was nie angefasst wird:** die Daten auf den Platten, U-Boot, die MAC-Adresse
und das D-Link-Rettungssystem. Gewechselt werden nur Kernel, Startsystem und
das System im Flash.

## Vorbereitung

1. Aus dem [neuesten Release](https://github.com/UniqueDroid/ShareOS/releases)
   herunterladen:
   - `ShareOS-<version>-DNS-320L-rev-Ax.bin` (Kernel und Startsystem, ca. 3,3 MB)
   - `ShareOS-<version>-DNS-320L-rev-Ax.sysupgrade.tar` (das System)
2. Die `.sysupgrade.tar` auf einen USB-Stick kopieren (FAT32, exFAT oder ext4;
   oberste Ebene oder Ordner `shareos`). Ohne Stick lädt die Box das Paket
   selbst von GitHub – dann muss das Netzwerkkabel stecken und der Router per
   DHCP eine Adresse vergeben.
3. Die Alt-F-`.bin` für den Rückweg aufheben (z. B.
   `Alt-F-1.0-DNS-320L-rev-A.bin` von der Alt-F-Seite).
4. Optional: In Alt-F die Einstellungen sichern. ShareOS übernimmt beim ersten
   Start Benutzer (mit Passwörtern), Gruppen und Freigaben von Alt-F, wenn sie
   im Flash liegen.
5. Die IP-Adresse der Box notieren (in Alt-F oder im Router). ShareOS holt
   sich die Adresse ebenfalls per DHCP; mit derselben MAC-Adresse vergibt der
   Router normalerweise dieselbe.

## Alt-F → ShareOS

1. Den USB-Stick mit der `.sysupgrade.tar` in die Box stecken.
2. In der Weboberfläche von Alt-F die **Firmware-Seite** öffnen (Firmware
   aktualisieren).
3. Die ShareOS-`.bin` auswählen, hochladen und flashen. Alt-F prüft die Datei
   und schreibt Kernel und Startsystem. Den Strom während des Flashens nicht
   trennen.
4. Die Box startet neu. ShareOS merkt, dass noch kein System im Flash ist, und
   installiert es – zuerst vom USB-Stick, sonst von GitHub; die Prüfsummen
   werden kontrolliert. Die **orange USB-LED blinkt schnell**, das dauert
   einige Minuten. Die Zusatzpakete von Alt-F im Flash werden dabei ersetzt.
5. Danach startet die Box von selbst noch einmal neu – jetzt mit ShareOS.
6. Im Browser `http://<IP-der-Box>/` öffnen (oder `http://<Gerätename>.local/`).
   Anmelden mit **root** und dem Passwort **shareos**.
7. Der Einrichtungsassistent führt durch Sprache, Übernahme aus Alt-F,
   Passwort, Name und Zeit und Updates. Danach die Platten mit den Daten
   übernehmen: **Speicher → Laufwerke**, an der Platte **„sda2 übernehmen“** (ein
   Knopf je Partition mit Dateisystem) – es wird nichts gelöscht. **Den
   Einrichtungsassistenten nicht für Platten mit Daten nehmen: er löscht sie.**
   Danach unter **Freigaben** Freigaben für die vorhandenen Ordner anlegen. (Ab
   0.2.0-beta.17; bei älteren Versionen siehe
   [Platten von Hand übernehmen](#platten-von-hand-übernehmen).)

Ab jetzt laufen Updates über **System → Firmware** (aus dem Internet oder als
Datei).

**Wenn die Installation nicht klappt** (kein Stick, kein Netz, Paket defekt),
bleibt die Box im **Rettungsmodus**: Die orange USB-LED blinkt langsam. Dann
die `.sysupgrade.tar` auf einen USB-Stick kopieren, einstecken und die Box
aus- und wieder einschalten. Den Grund zeigt `ssh root@<IP>` (Passwort
`shareos`) in `/tmp/firstinstall.err`.

## ShareOS → Alt-F

1. In ShareOS **System → Firmware → Firmware-Datei einspielen** öffnen.
2. Die Alt-F-`.bin` auswählen und hochladen. ShareOS prüft die Datei (D-Link-
   Format, Prüfsummen, Gerät, Größe) und zeigt an, was drin ist („Alt-F“).
3. **Einspielen** – Kernel und Startsystem werden geschrieben und zur Kontrolle
   zurückgelesen.
4. **Neu starten**. Alt-F startet, unter derselben IP-Adresse.
5. Alt-F läuft jetzt ohne seine Zusatzpakete. Um sie zurückzubekommen, in Alt-F
   dieselbe Alt-F-`.bin` noch einmal über dessen Firmware-Seite flashen.

## Wieder zurück zu ShareOS

Wie oben unter „Alt-F → ShareOS“: die ShareOS-`.bin` in Alt-F flashen.

- Wurde in Alt-F Schritt 5 ausgelassen (die Alt-F-`.bin` nicht noch einmal
  geflasht), sind System und Einstellungen von ShareOS noch im Flash – ShareOS
  startet sofort wieder mit allen Einstellungen.
- Sonst installiert sich ShareOS wie beim ersten Mal neu (USB-Stick oder
  GitHub). Eine vorher gespeicherte Sicherung („Einstellungen sichern & wiederherstellen“ unter System → Allgemein) lässt sich danach wieder einspielen.

## Zur D-Link-Firmware

Am einfachsten über Alt-F: erst zurück zu Alt-F (siehe oben), dann von dort die
D-Link-Firmware flashen.

## Platten von Hand übernehmen

Vor 0.2.0-beta.17 gibt es den Knopf noch nicht; über SSH geht dasselbe (hier
die Partition `sda2` als Laufwerk `data`, das auch der App-Bereich wird):

```sh
blkid /dev/sda2                     # TYPE="ext4" und eine UUID
uci set storage.data=volume
uci set storage.data.uuid=$(blkid -s UUID -o value /dev/sda2)
uci set storage.data.fstype=ext4
uci set storage.data.layout=single
uci set storage.data.enabled=1
uci set storage.global=global
uci set storage.global.apps=data
uci commit storage
shareos-storage mount data
mkdir -p /mnt/data/.shareos && chmod 711 /mnt/data/.shareos
```

Ab 0.2.0-beta.17: `shareos-storage adopt data sda2`.

## Wenn gar nichts mehr geht

- Startet die Box nicht mehr in eine Weboberfläche, startet U-Boot bei einem
  defekten Kernel automatisch das **D-Link-Rettungssystem**. Darüber lässt sich
  Alt-F per Weboberfläche flashen.
- Mit serieller Konsole (siehe [TESTEN.md](TESTEN.md), Weg B) kann ShareOS aus
  dem RAM gestartet und das Flash von dort repariert werden.
