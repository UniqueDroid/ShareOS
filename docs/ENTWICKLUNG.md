# Wie ShareOS entstanden ist – ein KI-Entwicklungsprotokoll

*English version: [DEVELOPMENT.md](DEVELOPMENT.md)*

ShareOS wurde fast vollständig von einer KI entwickelt: **Claude** (Anthropic).
Jan hat das Projekt angestoßen und als „Vibe Coder“ geführt: Er hat die Ziele
vorgegeben, die grundlegenden Entscheidungen getroffen und alles an der echten
Hardware ausprobiert. Analyse, Architektur, der gesamte Code, die Builds, die
Tests, die Fehlersuche und diese Dokumentation stammen von Claude.

Dieses Dokument hält mit Zeitstempeln fest, wie das abgelaufen ist. So sieht
man, wie weit eine KI im Oktober 2026 bei echter Embedded-Entwicklung kommt:
alte Hardware, ein Bootloader, der nicht verändert werden darf, und kein
Debugger außer einer seriellen Konsole.

![Zeitstrahl](images/zeitstrahl.png)

*Jeder Punkt ist ein Commit (Uhrzeiten MESZ). Erzeugt mit `scripts/zeitstrahl.py`
direkt aus der Git-Historie.*

## Wer hat was gemacht

| | Jan (Initiator) | Claude (KI) |
|---|---|---|
| Ziele & Richtung | Alt-F modernisieren, GUI im Stil seines Intranets, Updates über GitHub, Cloud, Paperless | Vorschläge mit Abwägungen (OpenWrt vs. Alt-F-Basis, CGI vs. rpcd/ucode, Partitionierung) |
| Entscheidungen | „Alte Oberfläche komplett ersetzen“, „erst das Fundament“, „kein OpenWrt“, so wenig löten wie möglich, Assistent *und* manueller Weg | – |
| Code | 1 Commit: Import von Alt-F | 26 Commits, rund 5 500 neue Zeilen (Build-System, Device Tree, Init, Updater, Backend, GUI, Tests, Doku) |
| Hardware | Seriellen Adapter angeschlossen, U-Boot bedient, Befehle ausgeführt, Logs zurückgeschickt, Platten eingebaut | Jeden Befehl vorgegeben, jedes Log ausgewertet, Ursachen gefunden |
| Tests | Echte Box (DNS-320L rev A3) | Emulator (qemu-user), Testsuiten mit simulierter Box und virtuellen Platten |

Einmal hat zusätzlich „Konrad“ geholfen, Jans lokale Claude-Instanz. Sie hat
direkt auf der Box nachgesehen, warum der Webserver nicht lief.

## Chronik

### Freitag, 16.10.2026 – vom Konzept zur neuen Basis

| Zeit | Ereignis |
|---|---|
| ~16:00 | Jan legt das Projekt an und importiert Alt-F (r3935) als ShareOS ins Repo. |
| ~16:20 | **GUI-Konzept**: Claude analysiert die 178 CGI-Skripte von Alt-F und ordnet sie in 8 Bereiche. Das Design übernimmt den Stil aus Jans Skynet-Intranet. |
| ~16:55 | **Modernisierungsplan**: Bestandsaufnahme (buildroot 2009, Kernel 4.14 EOL, uClibc). Entscheidung mit Jan: Alt-F-Basis modernisieren und das Bedienkonzept von OpenWrt übernehmen (UCI, ubus, rpcd, ucode), weil OpenWrt nur über die serielle Konsole installierbar wäre. |
| 17:10 | **Neue Build-Basis**: buildroot 2026.02 LTS als BR2_EXTERNAL, GCC 14, musl, Kernel 6.18 mit portiertem DNS-320L-Device-Tree. |
| 19:10 | Der Kernel ist zu groß (4,2 MB), das Original-U-Boot lädt nur 3 MB. Mit xz und schlankerer Konfiguration passt er (2,1 MB). |
| 19:54 | Test über Alt-Fs „TryIt“/kexec: Die Box hängt, auch mit Alt-Fs eigenem Kernel. Claude findet die Bestätigung des Alt-F-Autors, dass kexec auf dem DNS-320L nicht funktioniert. **Ohne serielle Konsole geht es nicht weiter.** |
| 21:25 | **Kern-Stack**: UCI, ubus, rpcd mit ucode-Plugin, uhttpd und ein Updater für GitHub Releases, komplett im Emulator getestet. |

### Samstag, 17.10.2026 – auf der echten Hardware

| Zeit | Ereignis |
|---|---|
| ~11:00 | Jan lötet drei Kabel eines USB-TTL-Adapters an die unbestückte Stiftleiste JP1 (in den Lötaugen steckt Lötzinn, eine Stiftleiste passt nicht durch). Claude führt durch: Pinbelegung, vertauschte RX/TX-Leitungen, eine wackelige Masse. |
| ~12:15 | Das Unterbrechen des Autoboots klappt nicht. Claude findet im U-Boot-Code die D-Link-Eigenheit: **Leertaste, dann 1**. |
| ~12:30 | TFTP-Timeouts: Ursache ist die Firewall (ufw) auf Jans PC. |
| 12:44 | **ShareOS startet zum ersten Mal auf der Box**, aus dem RAM, ohne etwas zu flashen. Gigabit, MAC-Adresse, Lüfter, Temperatur, Taster und Weboberfläche funktionieren. |
| 12:57 | **UBI-Layout**: System als squashfs, Einstellungen als UBIFS-Overlay, ein kleines Start-System mit Rettungsmodus. |
| 13:48 | System in den Flash geschrieben. Die Einstellungen überleben den Neustart. Der Fix fürs saubere Herunterfahren ist eingebaut. |
| 14:11 | Kernel und Start-System geflasht: **Die Box startet ShareOS allein**, ohne PC und ohne Konsole. Die Alt-F-Partitionen sind vorher gesichert. |
| 14:47 | **Updater für das neue Layout** und **neue Weboberfläche** im Skynet-Stil. |
| 15:00–15:44 | Die Weboberfläche ist nach jedem Start weg. Fehlersuche mit Jan und Konrad. Claude stellt den Absturz im Emulator nach: Jede Browser-Anfrage mit `If-Modified-Since` bringt `uhttpd` zum Absturz (musl-`strptime` mit `%Z`). Behoben mit einem Patch. |
| 15:51 | Die Festplatten werden erkannt. Die beim Portieren korrigierte SATA-Stromleitung (gpio0 24 statt Alt-Fs gpio1 24) ist damit bestätigt. |
| 16:00 | **Speicher**: Assistent und manuelle Verwaltung (ext4, RAID 1, SMART, Ruhezustand, Swap, Apps-Bereich). |
| 16:45 | Englische Oberfläche über Sprachdateien, HTTPS mit selbstsigniertem Zertifikat, Ersteinrichtungs-Assistent mit Alt-F-Übernahme, Lüfter- und LED-Einstellungen. |
| 17:20 | Die Speicher-Tests mit virtuellen Platten finden einen echten Fehler: Bei zwei einzelnen Platten landete die zweite unter dem Namen der ersten. Behoben, bevor er auf die Box kam. |
| 18:13 | Alles geht nach `main`; Jan legt das erste Release `v0.1.0-beta.1` an, GitHub baut das Update-Paket. |
| 18:26 | Die Box erreicht GitHub nicht: „certificate is not correctly signed“. Erster Verdacht von Claude (Netzwerk fängt HTTPS ab) ist falsch. Jans Ausgabe zeigt Googles echtes Zertifikat. Ursache: buildroot gibt curl mit mbedTLS keinen Pfad zu den CA-Zertifikaten. Workaround per `/root/.curlrc`, Fix im Build. |
| 20:15 | **Erstes Online-Update auf echter Hardware:** Die Box lädt `0.1.0-beta.1` von GitHub, prüft es, schreibt Kernel und Startsystem, installiert das System beim Neustart. Ersteinrichtung läuft ohne Probleme. |
| 20:18 | Jans Rückmeldung: Nach „Installieren“ sieht man nichts. Claude baut einen Fortschrittsbalken mit den einzelnen Schritten. |
| 20:31 | Neue Vorgaben von Jan: Menü nach „Haupt-Funktion“ (Dienste → Autostart, System → Netzwerk), Kachel-/Tabellenansicht je Bereich, Hell/Dunkel/System, Logo und Browser-Symbol in der Akzentfarbe. Netzwerk-Einstellungen mit automatischem Rückfall, damit man sich nicht aussperrt. |
| 22:50 | Jan testet `beta.2` komplett durch – alles läuft. Rückmeldungen: Logo auf der Anmeldeseite nicht mittig, Installieren-Knopf bleibt aktiv, Hinweise rechts unten gehen unter. |
| 23:00 | Konzept **Benutzer, Freigaben, Apps**: ein Konto für alles (Freigaben, Weboberfläche, Apps, Cloud). Jan entscheidet: eigener Bereich „Mein ShareOS“ für Benutzer, Speicherlimit je Benutzer, Cloud-Sync für Gerät und Benutzer, ksmbd als SMB-Server. |
| 23:05 | In Jans Protokoll fallen ECC-Fehler auf: `blkid`/`lsblk` lasen bei jeder Speicherabfrage auch die rohen Flash-Partitionen, darunter D-Links unlesbare „my-dlink“. Claude schaltet die Flash-Blockgeräte ab. |
| 23:30 | **Freigaben (SMB/NFS), Benutzer, Gruppen, Speicherlimits, „Mein ShareOS“, Sichern/Wiederherstellen** (JSON, optional AES-256). Alt-F-Benutzer werden mitsamt Passwörtern übernommen. 52 Prüfungen im ARM-Emulator. |

### Sonntag, 18.10.2026 – Paperless, Cloud und App

| Zeit | Was passiert ist |
|---|---|
| 00:37 | Jan veröffentlicht `v0.1.0-beta.3` und geht schlafen: „Du kannst weiter in der Roadmap machen, Cloud, Paperless. Ich teste dann morgen früh.“ |
| 01:00 | **Paperless-ngx**: Eingangsordner je Benutzer (im persönlichen Ordner) oder gemeinsam auf einer Freigabe, z. B. für einen Scanner. ShareOS lädt neue Dateien über die Paperless-API hoch, fragt das Ergebnis ab und zeigt es an. Benutzer tragen ihr Token selbst unter „Mein ShareOS“ ein. |
| 01:00 | **Cloud-Sync mit rclone**: rclone wird bei Bedarf von GitHub geladen (mit Prüfsumme) und liegt im Apps-Bereich. Konten (WebDAV/Nextcloud, S3, SFTP oder ein Abschnitt aus `rclone.conf`) und Aufträge (hochladen, herunterladen, spiegeln) mit Zeitplan und Bandbreitengrenze – für das Gerät und, wenn erlaubt, für jeden Benutzer mit eigenen Zugangsdaten. 29 Prüfungen mit einem nachgebauten Paperless und einem lokalen WebDAV-Server. |
| 01:20 | **Als App installierbar** (Symbol, Kurzbefehle) und eine **Status-Adresse für Widget-Apps** wie KWGT – Chrome bietet für Web-Apps keine Startbildschirm-Widgets. |
| 01:40 | Beim erneuten Durchlauf aller Tests fällt auf: Seit dem Cloud-Umbau scheiterte die Anmeldung normaler Benutzer an einer Funktion, die im Skript erst weiter unten stand (ucode kennt kein Hoisting). Behoben, bevor es eine Box erreicht hat; eine neue Prüfung im CI findet solche Fälle künftig automatisch. |
| 09:20 | Jan veröffentlicht `v0.1.0-beta.4`. Freigaben, Benutzer und Gruppen laufen auf der Box „sehr gut“. |
| 10:00 | Jans Rückmeldungen: ein zu langes Feld-Label verschiebt das Eingabefeld, Datei-Knöpfe sehen anders aus als die übrigen, Wunsch nach einem **Dateibrowser** (Admin: alles, Benutzer: eigener Ordner, je Benutzer freischaltbar) und **eigener Darstellung** für Benutzer. |
| 10:09 | Frage nach der Update-Anzeige: Bisher prüfte nur die geöffnete Oberfläche. Jetzt prüft die Box selbst alle 6 Stunden. |
| 10:30 | Login-Text `user@shareos`, Zertifikat folgt Name und IP. Empfehlung statt fester Werks-IP: DHCP, Name per mDNS (`shareos.local`) und eine Rückfall-Adresse `192.168.0.32` ohne DHCP. Jan: „Ja gerne.“ |
| 11:00 | Dateibrowser mit Hoch- und Herunterladen über einmalige Tickets; Dateien von Benutzern werden mit deren Rechten gelesen und geschrieben. Ein uhttpd-Patch verhindert, dass große Übertragungen nach 60 s abbrechen. Beim Testen in der Cloud-Umgebung hat ein Aufräumschritt versehentlich deren `/dev` geleert – die Testskripte löschen seitdem nur noch, wenn nichts mehr eingehängt ist. |
| 11:53 | Jan veröffentlicht `v0.1.0-beta.5` und bringt Ideen für die Roadmap: App-Store mit Docker/Compose und ein Benachrichtigungssystem. Claude schreibt eine Machbarkeitsstudie: Docker passt nicht auf den DNS-320L (ARMv5, 256 MB, keine Images); stattdessen „Apps light“ mit nativen Paketen, Benachrichtigungen über ubus. Jan: „Container sind raus.“ |
| 12:12 | Jan schickt sein Webpad: Es soll **ShareOS-WebApps** als nachinstallierbare Pakete mit App-JSON (Version, Herausgeber) geben, angeboten wie die Firmware-Versionen, aus einem eigenen Repo. Jan legt `ShareOS-Apps` an. |
| 12:45 | App-Repo mit Paketformat `.sapp`, Build, Releases je Version und Katalog `index.json` per GitHub Actions; Webpad 1.0.0 als erste App, mit eingepackten Bibliotheken (läuft offline). In der Firmware: APPS-Bereich mit Store, Installation mit SHA-256-Prüfung, eigener Web-Server-Port für Apps, Sichtbarkeit je Benutzer, eigene Pakete hochladen. |
| 13:15 | Jan schickt Fotos von Platine und serieller Konsole für die Doku (EXIF entfernt) und wünscht, dass README und Doku bei jedem Release mitgepflegt werden – dafür gibt es jetzt `docs/RELEASE.md`. Der „Jetzt neu starten“-Knopf erscheint erst, wenn der Fortschrittsbalken bei 100 % ist. |
| 13:34 | Frage: Lässt sich ShareOS über eine alte D-Link- oder Alt-F-Firmware flashen? Jan: „Ja gerne, kompatible bin über Oberfläche, Subsystem-Installation über USB-Stick.“ Die ShareOS-`.bin` installiert beim ersten Start das System selbst – vom USB-Stick oder von GitHub –, und unter System → Firmware lässt sich eine Alt-F-`.bin` einspielen, um zurückzuwechseln. Getestet im Emulator mit nachgebautem Flash, beschädigten und fremden Paketen. |
| 15:02 | Jan meldet: Meldungen wie „Letztes Update: erfolgreich installiert“ und „Einrichtung fehlgeschlagen: wipefs sdc failed“ lassen sich nicht schließen. Sie bekommen ein **x**, die Box vergisst sie danach; die Fehlermeldung beim Löschen einer Platte nennt jetzt den Grund. |
| 15:10 | Jan: USB-Sticks sicher entfernen, und beim Formatieren soll das **Dateisystem** wählbar sein – für Sticks und Platten. Für die Platten wählt er ext4, Btrfs, exFAT und NTFS, für USB exFAT, FAT32, NTFS und ext4. USB-Laufwerke werden beim Einstecken eingehängt und haben „Sicher entfernen“ und „Formatieren“. |
| 16:20 | Jan testet `beta.6`: Der APPS-Bereich wirft Admins raus – die Funktionen fehlten in den Zugriffsregeln; ein neuer CI-Check prüft jetzt, dass jede Funktion abgedeckt ist. Das Protokoll stand in UTC (musl schreibt UTC-Zeitstempel), jetzt in Ortszeit. |
| 16:30 | Jan wünscht **Zeiteinstellungen unter System** und die **10 häufigsten Sprachen**. Neue Seite System → Zeit (Zeitzone, NTP mit eigenen Servern, Uhr von Hand) und acht neue Sprachen von Claude übersetzt, Arabisch mit Rechts-nach-links-Layout. |
| 17:10 | Paperless komplett auf der Box? Claudes Einschätzung: mit 256 MB RAM und ARMv5 nicht machbar – Jan streicht die Idee. |
| 18:38 | Jan: Web-Apps brauchen **Berechtigungen**, als erste zeitgesteuerte Aufgaben. Jan wählt Skripte aus dem App-Paket, festgelegt im `app.json` und in der Oberfläche änderbar. Berechtigung `cron`: Aufgaben laufen als eigener eingeschränkter Benutzer der App mit Zeitlimit. |
| 18:55 | Jans Idee einer **gemeinsamen App-Architektur**: ein Manifest (Fenstergröße, Dateitypen), gemeinsame Design-Tokens mit klassischer Menüleiste wie Notepad++ und Apps, die miteinander reden. Claude schreibt ein Konzept; Jan entscheidet: Apps öffnen in eigenen Fenstern, nur Einstellungs-Apps werden in ShareOS angezeigt – als Berechtigung (`embed`). |
| 19:57 | Der Tag `v0.1.0-beta.7` stand auf `main`, bevor die beta.7-Änderungen gemergt waren; Claude bemerkt es, bevor den Boxen die falsche Version angeboten wird. Jan stoppt den Build und löscht Release und Tag; beta.7 kommt dann von `main` – samt den beta.8-Funktionen, das Changelog verschiebt sie. |
| 20:46 | Jans Wildcard-Zertifikat für `*.skynet.lan` wird abgelehnt. Über den echten Weg der Weboberfläche nachgestellt: Jedes eigene Zertifikat wurde abgelehnt, weil die Testseite der Zertifikatsprüfung unter der strengen umask von rpcd nicht lesbar war (uhttpd antwortete 403). Behoben und mit einem Test abgesichert. |
| 21:36 | Jan: Die Schrift der Menü-Knöpfe sitzt nicht ganz mittig. Großbuchstaben lassen Platz für Unterlängen frei; jetzt auf die Höhe der Großbuchstaben zugeschnitten. |
| 22:47 | Jan aktualisiert auf beta.7: Webpad meldet „needs a newer ShareOS“ – `0.1.0-beta.7` zählt als älter als `0.1.0`. Beim Beheben zeigt sich ein zweiter, noch nicht aufgetretener Fehler: `beta.10` wäre älter als `beta.9` gewesen, eine Box mit beta.9 hätte beta.10 nie angeboten bekommen. |
| 23:12 | Jan: Firmware-Updates auch **ohne Internet** – die `.sysupgrade.tar` lässt sich jetzt in der Oberfläche hochladen, mit denselben Prüfungen wie von GitHub. |
| 23:26 | Jan fragt, was die **Reset-Taste** macht: bisher nichts. Claude schlägt vor: 5–10 s = Zugangs-Reset (Netzwerk, root-Passwort, Zertifikat), 15 s = Werkseinstellungen, Rückmeldung per LED; Jan: „Super Vorschlag. Übernehmen. Bitte weiter an der Roadmap arbeiten. Bis morgen.“ |

### Nacht auf Montag, 19.10.2026 – Claude allein an der Roadmap

| Zeit | Was passiert ist |
|---|---|
| 23:45 | Reset- und USB-Taste gebaut, getestet mit aufgezeichneten Tastenereignissen und auf dem ARM-System. |
| 00:10 | **App-Plattform**: `window`/`opens` im Manifest, `/_shareos/theme.css` und das App-SDK, Datei-Tickets – Webpad 1.1 öffnet eine Textdatei aus dem Dateibrowser und speichert sie zurück, Ende zu Ende in Chromium getestet. |
| 00:50 | **Speicher**: RAID 0 und JBOD neben dem Spiegel, ext3/ext2/FAT32, Spiegel mit neuer Platte reparieren. |
| 01:20 | **Meldungen**: Prüfung alle 10 Minuten (RAID, Laufwerke, Temperatur, SMART, Updates), fehlgeschlagene Aufträge melden sich sofort; E-Mail und Push (ntfy, Gotify, Webhook). |
| 07:08 | Jan merged WebTerm 1.0.0 und Webpad 1.2.0; der App-Store veröffentlicht beide selbst. |
| 09:10 | Jans Test von beta.9: installierte Apps ohne Symbol, Links mit der IP statt `shareos.skynet.lan`. Ursache: Die Oberfläche war über die IP geöffnet, Apps und Symbole kamen von `https://<IP>:8444` – dafür gilt das Wildcard-Zertifikat nicht, und für Bilder fragt kein Browser nach. Lösung: Symbole kommen mit der App-Liste, Links nehmen den Namen aus dem Zertifikat (oder einen eingestellten), der App-Webserver bekommt denselben Wächter wie die Oberfläche. |

### Dienstag, 20.10.2026 – Apps mit Zugriff auf die Box

| Zeit | Was passiert ist |
|---|---|
| 08:20 | Jan schickt vier Apps (ShareCommander, WinWeb Player, SheetOS, DevBox). Claude passt sie an die App-Plattform an, korrigiert Fehler (SheetOS rechnete keine Formeln, ZIPs waren JSON) und testet alle im Emulator mit Chromium. |
| 08:30 | Damit der Player in großen Dateien spulen kann: ein kleiner Patch für uhttpd (Range-Header an CGI-Skripte) und Byte-Bereiche im Datei-CGI. |
| 08:34 | Jan: ShareCommander und Webpad sollen auf die Box zugreifen. Claude baut die App-Berechtigung `files` (`ShareOS.fs`): ein Schlüssel je App und Konto, alle Prüfungen in rpcd mit den Rechten des Benutzers. ShareCommander zeigt jetzt Ordner der Box, Webpad speichert dort. |
| 08:52 | Jans nächste Liste: Internet für Apps, Webpad-Absturz beim Schließen, Umstiegsanleitung, Löt-Korrektur, Übersetzungen, Web-Terminal, Bereiche abschaltbar, Jahreszahl, Cloud-Anbieter, Telegram. Claude arbeitet sie der Reihe nach ab: Telegram-Bot, Google-Anmeldung über die Box (rclone authorize, die Adresse aus der Browserzeile wird zurückgegeben), Bereiche, ttyd als Terminal, rund 90 Übersetzungen mit einem neuen Prüfskript. Nebenbei gefunden: In ucode-Regex-Klassen ist `\s` kein Leerraum, sondern ein „s“ – ntfy-Adressen wurden abgelehnt. |

| 10:00 | Jan: „nano, htop – ich will erstmal die Umsetzung sehen. Ist ja eine eigene App-Art.“ Claude baut den App-Typ `system`: native Programme, gebaut mit der Toolchain der Firmware in einem zweiten buildroot (externe Toolchain = die der Firmware), gepackt mit eigenen Bibliotheken (ncurses) und Terminal-Beschreibungen; auf der Box unter `/opt/shareos/sysapps`, ein Starter je Befehl im `PATH`. nano und htop laufen im Emulator; ein Test bedient htop in einem Pseudo-Terminal. |

| 13:13 | Jan hat beta.12 getestet: Das Terminal zeigt sofort „Press ↵ to Reconnect“; App-Daten des Admins (Webpad) sieht jeder Benutzer; Apps sollen Dateien der Box öffnen. Claude findet die Terminal-Ursache über HTTPS (HTTP/2 ohne Host-Header gegen ttyds Herkunftsprüfung; über HTTP lief es im Emulator), baut Browser-Speicher je Konto ins App-SDK und einen Dateidialog der Box; WinWeb Player spielt Musik von der Box. Nebenbei: PR #4 von ShareOS-Apps war in einem Nebenzweig statt in `main` gelandet. |

| 15:08 | Jan hat die neue Firmware und die Apps getestet: Terminal, nano, htop, Webpad und WebTerm laufen. Nur: WebTerm öffnet ein geschlossenes Webpad in einem Tab statt in einem Fenster. Claude ergänzt `ShareOS.openApp` im SDK. Jan wählt die nächste Version: **0.2.0-beta.1**. |

| 16:06 | Jan: Telegram funktioniert auf der Box. |
| 16:12 | Jan: „Feature Lock – aufräumen, optimieren.“ Claude misst zuerst: Im Emulator wartete jeder Seitenaufruf 1,1 s auf Anfragen, ein Store-Aktualisieren blockierte die Oberfläche 8 s (rpcd beantwortet eine Anfrage nach der anderen), der 5-Sekunden-Status startete jedes Mal drei Programme. Ergebnisse teurer Schritte werden jetzt zwischen den Aufrufen behalten, der Store aktualisiert im Hintergrund. Das System verliert OpenSSL (ttyd auf mbedtls), ungenutzte Teile von GLib/libevent/libnl und Werkzeuge – 16,2 → 11,6 MB; strace und iperf3 werden System-Apps. |

| 18:48 | Jan: „Erst die Gerätesteuerung pro Modell, dann der gemeinsame Kirkwood-Build“ – und er sucht Tester. Claude ersetzt die feste DNS-320L-Verdrahtung durch Modellbeschreibungen (`board.sh`: MCU oder Kernel-Sensoren, abgefragte oder Interrupt-Taster, LED-Namen, Ausschalten, Uhr, Firmware-Name/Signatur) und baut einen Kernel mit vier Device-Trees: je eine `.bin` und ein Bundle für DNS-320L, DNS-320 rev B, DNS-320 rev A und DNS-325. Anleitung für Tester: GERAETE.md. |
| 22:47 | `v0.2.0-beta.3` mit dem gemeinsamen Kirkwood-Build: dieselbe Firmware für DNS-320L, DNS-320 rev A/B und DNS-325. |

### Mittwoch, 21.10.2026 – Dienste der Box

| Zeit | Was passiert ist |
|---|---|
| 10:13 | **Transmission** als System-App mit eigenem Dienst je Benutzer; die App steuert ihn über die Berechtigung `torrent` (`v0.2.0-beta.4`). |
| 12:38 | **FFmpeg** als System-App und die Berechtigung `media`: Aufträge zum Umwandeln laufen im Hintergrund auf der Box; dazu die App MediaTranscoder. |
| 14:48 | Jan wünscht sich Rubriken im App-Store sowie bash, rsnapshot und einen DLNA-Server. Store mit Rubriken und Suche, Bash als System-App; um 14:56 veröffentlicht Jan `v0.2.0-beta.5`. |
| 15:24 | Jan schickt einen Entwurf von NetTunnel und wünscht sich das neue **Systemmenü** sowie Anzeigen von Diensten und Apps im Kopf. Claude macht die Box zum OpenVPN-Client (Profile werden beim Einspielen bereinigt, nur für Admins) und baut die Berechtigung `status` für Chips neben *Online*. |
| 15:59 | Jan: NetTunnel soll auch **Server** sein. Die Box erstellt ihre eigene kleine Zertifizierungsstelle und ein fertiges `.ovpn` je Gerät; ein entferntes Gerät ist sofort ausgesperrt. Getestet im Emulator mit echtem OpenVPN-Server und -Client. |
| 16:30 | Statt rsnapshot baut Claude **Snapshots** direkt in ShareOS (rsync mit Hardlinks wie rsnapshot, ohne OpenSSL) und den **Medienserver** (MiniDLNA als System-App, Einstellungen unter Dienste). |
| 18:26 | Ein Tailscale-PR von außen (ShareOS-Apps #16) zeigt nur Demo-Daten, weil es auf der Box kein Tailscale gibt. Jan und Claude antworten: Die System-App und eine Schnittstelle in der Firmware kommen von ShareOS. |
| 19:37 | #37–#40 sind gemergt, alles für `v0.2.0-beta.6` steht auf `main`. |
| 20:01 | Jan: ShareCommander zeigt einem Benutzer nur Beispieldateien wie `/etc/hosts`. Ursache: Benutzer bekamen nur ihren persönlichen Ordner, und auch das nur mit dem Haken „Dateien“. Jetzt sehen sie ihre Freigaben nach Rechten; Jans Frage „Ist das mit dem User-Konzept sicher?“ führt zu ACLs: Linux selbst setzt die Freigabe-Rechte für jedes Programm durch. ShareCommander 1.3 startet auf der Box. |
| 20:44 | Jan: Transmission läuft nur für Admins. Ursache: System-Apps aus der Weboberfläche landeten in einem Ordner, den nur root lesen kann (rpcd arbeitet mit umask 077); im Test nachgestellt und behoben. WinWeb Player 1.2 merkt sich Einstellungen und Playlist und spielt ganze Ordner der Box. |
| 21:12 | Jan: „Was ist mit Tailscale?“ (ein PR von außen zeigte nur Demo-Daten). Claude baut Tailscale für ARMv5: 1.98.8 (die neueste Version, die mit dem Go von buildroot geht), ohne alles, was ein NAS nicht braucht – 17 statt 33 MB; im Emulator läuft der Dienst mit etwa 50 MB RAM. |
| 21:52 | Jans Box hat noch 27,9 MB im Flash frei. Jan: „Auslagern, symbolische Links anlegen – bei großen Apps.“ System-Apps über 2 MB kommen aufs Laufwerk, `/opt/shareos/sysapps/<id>` ist ein Link dorthin. Dazu Berechtigung `tailscale`, `ShareOS.tailscale` und die Anzeige im Kopf. |
| 22:59 | Jan veröffentlicht `v0.2.0-beta.6`. |

### Donnerstag, 22.10.2026

| Zeit | Was passiert ist |
|---|---|
| 08:27 | Jan merged NetTunnel, ShareCommander 1.3, WinWeb Player 1.2 und Tailscale; der Store zeigt die neuen Apps. Alles für `v0.2.0-beta.7` steht auf `main`. |

### Freitag, 23.10.2026

| Zeit | Was passiert ist |
|---|---|
| 08:30 | Jan: „Der startet nicht von alleine“ – `tailscaled` lief erst, wenn eine App *Verbinden* drückte, und die eingereichte Tailscale-App sprach eine Schnittstelle an, die es auf der Box nicht gibt. Claude startet den Dienst bei Installation und Boot (ShareOS #48) und portiert die App auf `ShareOS.tailscale` mit echtem QR-Code (ShareOS-Apps #22). |
| 09:22 | Jan: „Kann man das mit SysApps vereinfachen?“ Jeder Dienst hatte ein eigenes Startskript und einen eigenen Hook – Jans Umbenennung in `tailscaled` hatte genau den Hook verwaist. Seitdem steht der Dienst in der `app.json` der System-App (`"service"`), ein Startskript startet alle, die Steuerung bleibt in der Firmware. Jan legt fest: System-Apps werden im ShareOS-Repo eingereicht, ShareOS-Apps nimmt nur Web-Apps – mit je einem Beispiel für ein Programm und einen Dienst. |
| 11:28 | Jans App ShareNotes kommt in den Store. Seine Vorgabe: auch Konten ohne „Dateien“ sollen ihre Notizen auf der Box haben. Jan wählt einen privaten Ordner je App und Konto auf dem Apps-Laufwerk; Ordner, Freigaben und Dateibrowser des Kontos bleiben zu. |
| 15:03 | autobrr für die Box (PR #20 von außen hatte nur die Oberfläche): Claude baut autobrr 1.84 für ARMv5 (32 MB samt Weboberfläche, im Emulator etwa 45 MB RAM). Jan entscheidet: ein autobrr für die ganze Box, eingerichtet von Administratoren; Treffer landen über einen Übergabe-Ordner im Transmission eines gewählten Kontos; dazu die eigene Weboberfläche von autobrr. |

### Samstag, 24.10.2026

| Zeit | Was passiert ist |
|---|---|
| 14:17 | Jan veröffentlicht `v0.2.0-beta.10`. |
| 17:30 | Jan: „Kannst du aus den Apps, die nichts Vernünftiges machen, etwas machen?“ SysMon, HomePing, DockerDeck und TuyaPulse zeigten Beispieldaten. Vier neue Berechtigungen nur für Admins: `sysinfo` (Werte der Box), `netcheck` (Prüfungen von der Box aus), `docker` (Docker-Hosts im Heimnetz) und `tuya` – dafür ein eigenes kleines Programm `shareos-tuya` (C, 13 KB), das Tuya-Geräte lokal ohne Cloud schaltet, geprüft gegen ein nachgebautes Gerät aus dem Code von tinytuya. Dazu ShareVault mit Rubriken, TinyPDF mit echtem PDF-Betrachter, KeyKeeper verschlüsselt, alle UniqueDroid-Apps unter GPL-2.0-only. |
| 19:20 | Jans Redesign von *Mein ShareOS*: *Darstellung* wird *Einstellungen* mit Passwort, *Speicher* als Tabelle über die ganze Breite, „Teilen mit“ auf dem Handy in den Ordner `Geteilt` und Freigaben im Dateidialog der Apps auch ohne „Dateien“. Jan: „Wir können auch alles zusammen in einem Release machen“ – alles kommt in `v0.2.0-beta.11`. |
| 22:40 | Jan veröffentlicht `v0.2.0-beta.11`. |

### Sonntag, 25.10.2026

| Zeit | Was passiert ist |
|---|---|
| 00:44 | SMB-Zugriff über eine Gruppe funktioniert: ksmbd-tools 3.5.2 gab die Zusatzgruppen eines Benutzers nicht an den Kernel weiter, eine nur für `@family` freigegebene Freigabe wurde abgelehnt (#57). Die Firmware bringt jetzt ein eigenes Paket ksmbd-tools 3.5.3 mit (#66). |
| 08:36 | Jans DNS-325 startete den Spiegel nach jedem Neustart mit nur einer Platte – der zweite Schacht kommt etwa 10 s später. `shareos-storage boot` wartet jetzt bis zu 40 s auf die Mitglieder der bekannten Verbünde (#65, #67). |
| 13:02 | Jan: „Kannst du dir die gesamte Firmware nochmal ansehen – Optimierungen, ein Tool zum Prüfen von Festplatten und SSDs und was in Buildroot aktualisiert werden kann.“ Buildroot 2026.08.1, Kernel 6.18.58, GCC 15.3, Tailscale 1.104.1, autobrr 1.89 (#69, auf Jans Box geprüft: 216 MB von 247 MB RAM frei); die Seite Gesundheit mit SMART-Bewertung und Selbsttests (#68). Von Jans Ideenliste waren Protokolle im RAM und `noatime` schon da; zwei echte Probleme wurden behoben: eine bleibende Meldung schrieb alle 10 Minuten den Flash neu, und die Paperless-Eingänge weckten schlafende Platten alle 2 Minuten. |
| 15:17 | Jan wählt den Rest seiner Liste: Papierkorb im Dateibrowser (#70 – Sambas Papierkorb gibt es für ksmbd nicht), die USB-Taste kopiert USB-Laufwerke in einen Ordner mit Datum (#71), und Apps dürfen über die Benachrichtigungen der Box melden (#72). Alles kommt in `v0.2.0-beta.12`. |

## Bemerkenswerte Problemlösungen

- **3-MB-Grenze des Bootloaders:** Der Kernel ist von 4,2 auf 2,4 MB geschrumpft, Treiber wurden in Module ausgelagert. Das Start-System umfasst nur 0,9 MB.
- **Kein Flashen ohne Rückweg:** Erst lief ShareOS im RAM, dann vom Netzwerk, dann stand das System im Flash und erst zuletzt der Kernel. Jeder Schritt hatte einen Rückweg (Alt-F-Sicherung, D-Link-Rettungssystem, Rettungsmodus).
- **U-Boot ohne Doku:** Die Abbruchsequenz und der Rückfall auf das Rettungssystem bei defektem Image hat Claude aus dem Verhalten und dem Speicherabbild erschlossen.
- **Hardware-Detail im Device Tree:** Alt-F schaltete die SATA-Stromversorgung über den falschen GPIO-Controller. Claude hat das beim Portieren erkannt, die Platten haben es bestätigt.
- **Netzwerk ändern ohne Aussperren:** Eine neue IP gilt sofort, die Box wartet aber 2 Minuten auf eine Bestätigung von der neuen Adresse. Kommt keine, stellt sie die alten Einstellungen wieder her (wie bei OpenWrt). Die Oberfläche öffnet die neue Adresse selbst und bestätigt.
- **Absturz, der nur im echten Browser auftritt:** Die Absicherung (automatischer Neustart von uhttpd, Protokoll) kam zuerst. Die eigentliche Ursache war ein Fehler in der C-Bibliothek, den Claude im Emulator nachgestellt und gezielt umgangen hat.

## Die Oberfläche

Standard ist das dunkelblaue Design mit Logo. Hell, Dunkel oder „wie das
Betriebssystem“ sowie die Akzentfarben Blau, Grün, Rot und Weiß gelten für alle
Nutzer. Logo und Browser-Symbol nehmen die Akzentfarbe an, das Logo lässt sich
abschalten. Jeder Bereich mit Kacheln hat rechts in der Kopfzeile einen
Schalter für die Tabellenansicht. Die Oberfläche gibt es auf Deutsch und
Englisch.

| Anmeldung | Übersicht |
|---|---|
| ![Anmeldung](images/gui-login.png) | ![Übersicht](images/gui-uebersicht.png) |

| Speicher (Spiegel in der Erst-Synchronisierung) | Speicher-Assistent |
|---|---|
| ![Speicher](images/gui-speicher.png) | ![Assistent](images/gui-assistent.png) |

| Firmware-Update | Darstellung, Sprache, Logo |
|---|---|
| ![Firmware](images/gui-firmware.png) | ![Darstellung](images/gui-darstellung.png) |

| Netzwerk mit Rückfall, HTTPS | Dienste → Autostart |
|---|---|
| ![Netzwerk](images/gui-netzwerk.png) | ![Autostart](images/gui-autostart.png) |

| Tabellenansicht | Akzentfarben, Hell und Dunkel |
|---|---|
| ![Tabellenansicht](images/gui-tabelle.png) | ![Farben](images/gui-farben.png) |

| Freigaben | Rechte je Benutzer und Gruppe |
|---|---|
| ![Freigaben](images/gui-freigaben.png) | ![Rechte](images/gui-freigabe-rechte.png) |

| Benutzer | „Mein ShareOS“ für Benutzer |
|---|---|
| ![Benutzer](images/gui-benutzer.png) | ![Mein ShareOS](images/gui-mein-shareos.png) |

| Sichern & Wiederherstellen | |
|---|---|
| ![Sichern](images/gui-sichern.png) | |

| Update mit Fortschritt | Englisch |
|---|---|
| ![Update](images/gui-update-progress.png) | ![Englisch](images/gui-en-overview.png) |

| Paperless | Cloud-Sync |
|---|---|
| ![Paperless](images/gui-paperless.png) | ![Cloud](images/gui-cloud.png) |

| „Mein ShareOS“: Paperless und Cloud | App & Widgets |
|---|---|
| ![Mein ShareOS mit Paperless und Cloud](images/gui-mein-paperless-cloud.png) | ![App und Widgets](images/gui-app-widgets.png) |

| Dateibrowser (Admin) | Dateibrowser (Benutzer) |
|---|---|
| ![Dateien](images/gui-dateien.png) | ![Dateien Benutzer](images/gui-dateien-benutzer.png) |

| Eigene Darstellung (Benutzer) | Benutzer anlegen |
|---|---|
| ![Darstellung Benutzer](images/gui-darstellung-benutzer.png) | ![Benutzer anlegen](images/gui-benutzer-editor.png) |

| App-Store | Installierte Apps |
|---|---|
| ![Store](images/gui-apps-store.png) | ![Installiert](images/gui-apps-installiert.png) |

| Handy | |
|---|---|
| ![Handy](images/gui-handy.png) | |

*Screenshots mit Beispieldaten (`tests/mock-ubus.py`): zwei 4-TB-Platten als
Spiegel und ein verfügbares Update.*

## Zahlen (Stand 17.10.2026, 16 Uhr)

- Reine Arbeitszeit: etwa 6 Stunden am Freitag und 5 Stunden am Samstag
- 27 Commits, davon 26 von Claude
- rund 5 500 neue Zeilen: Build/Board 1 300, Backend + GUI 2 900, Tests 370, Doku 500
- 18 Tests für den Updater (inklusive kompletter Installation auf einer simulierter Box), 21 Prüfungen der Schnittstelle im ARM-Emulator, Speicher-Tests mit virtuellen Platten
- 3 Lötstellen (die serielle Konsole), 0 unbrauchbare Boxen

## Wie gearbeitet wurde

Jan schrieb in einem Chat auf Deutsch, was er möchte oder was er gerade sieht.
Oft war das nur ein eingefügtes Konsolen-Log. Claude arbeitete in einer
Cloud-Umgebung mit dem Repo, baute die Firmware, testete sie im Emulator,
pushte auf GitHub und schickte Jan die fertigen Images mit einer genauen
Schritt-für-Schritt-Anleitung. Alles, was die Box veränderte (Flashen,
Platten löschen), passierte nur nach Jans ausdrücklichem OK.
