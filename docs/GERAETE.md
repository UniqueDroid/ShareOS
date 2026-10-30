# Unterstützte Geräte und Tester

*English version: [DEVICES.md](DEVICES.md)*

ShareOS wurde auf dem **D-Link DNS-320L rev A** entwickelt. Ab 0.2.0-beta.3
wird dasselbe System auch für die verwandten Kirkwood-Boxen gebaut. Sie haben
dieselbe Prozessorfamilie, dasselbe Flash-Layout und das Original-U-Boot; was
sich unterscheidet (Lüfter, Temperatursensor, Tasten, LEDs, Ausschalten), ist
je Modell in
[`/usr/lib/shareos/board.sh`](../board/dlink/dns320l/rootfs-overlay/usr/lib/shareos/board.sh)
beschrieben.

| Modell | Release-Dateien | RAM | Stand |
|---|---|---|---|
| DNS-320L rev A (A1–A3) | `ShareOS-<ver>-DNS-320L-rev-Ax.*` | 256 MB | **getestet** |
| DNS-320 rev B | `ShareOS-<ver>-DNS-320-rev-Bx.*` | 128 MB | gebaut, **Tester gesucht** |
| DNS-325 rev A | `ShareOS-<ver>-DNS-325-rev-Ax.*` | 256 MB | **teilweise getestet** (rev A1, siehe unten), weitere Tester gesucht |
| DNS-320 rev A | `ShareOS-<ver>-DNS-320-rev-Ax.*` | 128 MB | gebaut, **Tester gesucht** – bis 0.2.0-beta.16 startet sie nach dem Flashen immer wieder neu (Adresse des Initramfs, [#96](https://github.com/UniqueDroid/ShareOS/issues/96)); 0.2.0-beta.17 oder neuer nehmen |
| DNR-322L | – | 128 MB | geplant |
| DNS-327L | – | 512 MB | geplant (eigener Kernel und eigenes Flash-Layout) |

Nicht möglich: DNS-323, DNS-321, DNS-343 (64 MB RAM, 8 MB Flash).

## DNS-325 rev A1: was geprüft wurde

Erster Test auf echter Hardware mit serieller Konsole (0.2.0-beta.7 und ein
Build der Korrektur für 0.2.0-beta.9).

- **Funktioniert:** Start aus dem Flash (ab 0.2.0-beta.9; die `.bin` von
  beta.7 startet in einer Schleife neu, siehe [Changelog](../CHANGELOG.md)),
  Modell und RAM (256 MB), 1-Gbit/s-Ethernet, Temperatursensor, Uhr, USB, die
  6 Flash-Partitionen, die LEDs, die Lüfterstufen (leise, ausgewogen, kühl),
  die Tasten (Ein/Aus, Reset, USB; ab 0.2.0-beta.10 – vorher fand
  `shareos-buttons` auf dieser Box kein Eingabegerät), Einschalten nach einem
  Stromausfall, ein Update über System → Firmware.
- **Noch nicht geprüft:** eine vollständige Erstinstallation von einer frisch
  geflashten `.bin` mit dem korrigierten Abbild.
- Ein DNS-325, auf dem schon das beta.7-Abbild läuft und in einer Schleife
  neu startet, braucht zur Rettung eine serielle Konsole (die alte
  Initramfs liegt in seinem Flash).

## Unterschiede der Modelle

| | DNS-320L / 320 rev B | DNS-325 | DNS-320 rev A |
|---|---|---|---|
| Lüfter, Temperatur | Weltrend-MCU an ttyS1 (`dns320l-daemon`) | `gpio-fan`, Sensor `lm75` (Kernel) | `gpio-fan`; Temperatur von der MCU an ttyS1 |
| Ein/Aus-Taster | GPIO 29, abgefragt | gpio-keys | gpio-keys |
| Ausschalten, Einschalten nach Stromausfall | MCU | `gpio-poweroff`, GPIO 37 | `gpio-poweroff`, GPIO 37 |
| Uhr (RTC) | MCU | Kernel (`/dev/rtc0`) | Kernel |
| LEDs | `dns320l:*` | `dns325:*` | `dns320:*` |
| D-Link-Signatur | `DNS320L` / `DNS320B` | `DNS-325` | `DNS323D1` |

Ein Kernel für alle vier: post-image hängt den Device-Tree des Modells an den
Kernel (das Original-U-Boot übergibt keinen) und schreibt eine `.bin` mit der
Signatur des Modells. Initramfs und System sind gleich; die Box erkennt ihr
Modell beim Start am Device-Tree (`shareos-boardinfo`).

## Für Tester

**Du brauchst:** eine der Boxen oben mit Alt-F oder der D-Link-Firmware,
einen USB-Stick (FAT32/exFAT/ext4), ein Netzwerk mit DHCP. Kein Löten, keine
serielle Konsole.

1. Aus dem [neuesten Release](https://github.com/UniqueDroid/ShareOS/releases)
   die beiden Dateien mit **dem Namen deines Modells** laden:
   `ShareOS-<ver>-<Modell>.bin` und `ShareOS-<ver>-<Modell>.sysupgrade.tar`.
2. Die `.sysupgrade.tar` auf den USB-Stick kopieren und einstecken.
3. Die `.bin` auf der Firmware-Seite von Alt-F oder der D-Link-Oberfläche
   flashen (Dateien für ein anderes Modell lehnt die Box ab).
4. Die Box startet neu, installiert das System vom Stick (USB-LED blinkt
   schnell, einige Minuten) und startet noch einmal – jetzt mit ShareOS:
   `http://<IP-der-Box>/`, Benutzer **root**, Passwort **shareos**.
5. Bitte prüfen und melden (GitHub-Issue, Titel „Test <Modell>“):
   - System → Über: Gerät und Firmware-Name richtig?
   - Übersicht: Temperatur angezeigt? Lüfter hörbar bei den Voreinstellungen
     unter System → Energie & Reset (leise / ausgewogen / kühl)?
   - Ein/Aus-Taster: Box fährt herunter und schaltet sich ganz aus?
   - Reset-Taste 5–10 s: Zugangs-Reset (USB-LED blinkt langsam, solange gedrückt)
   - USB-Taste: USB-Laufwerke werden sicher entfernt
   - LEDs: Status- und Platten-LEDs (System → Energie & Reset)
   - Nach einem Stromausfall: startet die Box von selbst?
   - System → Zeit: richtig nach einem Neustart ohne Netzwerk?
   - Speicher: Laufwerk anlegen, Freigabe, Dateien vom Rechner kopieren
   - Freier Speicher nach dem Start (System → Terminal: `free`), vor allem auf
     den 128-MB-Boxen
   - Hardware-Bericht: System → Terminal → `shareos-check`,
     `/tmp/shareos-check.txt` anhängen

**Der Weg zurück** bleibt immer offen: System → Firmware →
*Firmware-Datei installieren* mit der Alt-F-`.bin` (siehe
[UMSTIEG.md](UMSTIEG.md)). Startet die Box nicht in ShareOS, startet U-Boot
das D-Link-Rettungssystem („mini firmware“), über das Alt-F geflasht werden
kann. Die Daten auf den Platten werden nie angefasst.

## Ein Modell hinzufügen

1. Device-Tree: im Kernel (`BR2_LINUX_KERNEL_INTREE_DTS_NAME`) oder in
   `board/dlink/dns320l/dts/` (`BR2_LINUX_KERNEL_CUSTOM_DTS_PATH`).
2. Eine Zeile in `MODELS` von `board/dlink/dns320l/post-image.sh`
   (Firmware-Name, Device-Tree, D-Link-Signatur aus `legacy/alt-f/mkfw.sh`).
3. Ein Fall in `board_detect` von `board.sh` (Modelltext, LEDs, Steuerung,
   Tasten) und in `tests/test-boards.sh`.
