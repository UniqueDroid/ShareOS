#!/usr/bin/env python3
"""
Serves the web interface (src/shareos-core/www) with a fake /ubus endpoint,
for UI work, screenshots and translation checks without a box or emulator.

    python3 tests/mock-ubus.py [port]      -> http://127.0.0.1:8200/  (root / shareos)

The data imitates a DNS-320L with two disks, a mirror in initial sync and an
update available.
"""
import json
import os
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WWW = Path(__file__).resolve().parent.parent / 'src/shareos-core/www'
SID = 'c0ffee00c0ffee00c0ffee00c0ffee00'
T0 = time.time()
STATE = {'setup_done': False, 'fan': {'preset': 'balanced', 'off_temp': 0, 'full_temp': 50, 'half_temp': 45}, 'led': {'status': 'heartbeat', 'power': 'on', 'disks': 'off'}, 'logo': True, 'lang': 'en', 'channel': 'beta', 'job': None, 'https': True, 'redirect': False, 'theme': 'dark', 'accent': 'blue', 'autostart_off': ['crond'],
         'users': {'jan': {'role': 'admin', 'fullname': 'Jan', 'groups': ['familie'], 'home': 'daten', 'quota': 0, 'web': True, 'pw': 'shareos'},
                   'anna': {'role': 'user', 'fullname': 'Anna', 'groups': ['familie'], 'home': 'daten', 'quota': 200000, 'web': True, 'cloud': True, 'files': True, 'pw': 'anna123'},
                   'tv': {'role': 'share', 'fullname': 'Fernseher', 'groups': ['medien'], 'home': '', 'quota': 0, 'web': True, 'pw': 'tv1234'}},
         'groups': {'familie': 'Familie', 'medien': 'Mediengeräte'},
         'shares': {'fotos': {'volume': 'daten', 'path': 'Fotos', 'comment': 'Familienfotos', 'smb': True, 'nfs': False, 'guest': False, 'rw': ['jan'], 'ro': ['@familie'], 'nfs_rw': False, 'nfs_hosts': []},
                    'medien': {'volume': 'daten', 'path': 'Medien', 'comment': 'Filme und Musik', 'smb': True, 'nfs': True, 'guest': True, 'rw': ['jan'], 'ro': ['@medien'], 'nfs_rw': False, 'nfs_hosts': ['10.241.1.0/24']}},
         'sessions': {},
         'widget': {'enabled': False, 'token': ''},
         'pl': {'url': 'http://10.241.1.20:8000', 'enabled': True, 'interval': 2, 'after': 'delete',
                'inboxes': {'u_jan': {'owner': 'jan', 'share': '', 'tags': [3], 'enabled': True},
                            'scanner': {'owner': '', 'share': 'fotos', 'tags': [], 'enabled': True}}},
         'cloud': {'installed': True, 'remotes': {'-': [{'name': 'nextcloud', 'type': 'webdav'}, {'name': 'b2backup', 'type': 'b2'}],
                                                  'anna': [{'name': 'gdrive', 'type': 'drive'}]},
                   'jobs': {'fotos_b2': {'owner': '', 'remote': 'b2backup', 'remote_path': 'nas/fotos', 'local': 'share:fotos', 'mode': 'upload', 'schedule': '0 3 * * *', 'bwlimit': '2M', 'enabled': True, 'state': 'ok', 'summary': '1.2 GiB / 1.2 GiB, 100%, 312 files'},
                            'nc_dokumente': {'owner': '', 'remote': 'nextcloud', 'remote_path': 'Dokumente', 'local': 'share:fotos/Scans', 'mode': 'mirror', 'schedule': '30 * * * *', 'bwlimit': '', 'enabled': True, 'state': 'running', 'summary': '45 MiB / 120 MiB, 37%'},
                            'anna_handy': {'owner': 'anna', 'remote': 'gdrive', 'remote_path': 'Handy', 'local': 'home', 'mode': 'download', 'schedule': '0 */6 * * *', 'bwlimit': '', 'enabled': True, 'state': 'error', 'error': 'token expired – log in again', 'summary': ''}}},
         'net': {'proto': 'dhcp', 'ipaddr': '', 'netmask': '255.255.255.0', 'gateway': '', 'dns': []}, 'net_pending': None}

DISK = lambda n, model, serial: {
    'name': n, 'type': 'disk', 'size': 4000787030016, 'model': model, 'serial': serial, 'tran': 'sata', 'rm': False, 'rota': True,
    'children': [
        {'name': n + '1', 'type': 'part', 'size': 1073741824, 'fstype': 'swap', 'label': 'shareos-swap'},
        {'name': n + '2', 'type': 'part', 'size': 3999713288192, 'fstype': 'linux_raid_member', 'label': 'shareos:daten',
         'children': [{'name': 'md0', 'type': 'raid1', 'fstype': 'ext4', 'label': 'daten', 'mountpoint': '/mnt/daten'}]}],
    'smart': {'passed': True, 'temperature': 38, 'power_on_hours': 18234, 'reallocated': 0, 'pending': 0, 'uncorrectable': 0}}


def info():
    up = time.time() - T0 + 5 * 86400
    return {
        'model': 'D-Link DNS-320L-rev-Ax NAS', 'hostname': 'skynet-nas', 'kernel': '6.18.57', 'boot': 'flash',
        'release': {'version': '0.1.0-beta.1', 'board': 'dns320l', 'fwname': 'DNS-320L-rev-Ax', 'stage': 'beta'},
        'board': {'id': 'dns320l', 'name': 'D-Link DNS-320L rev A', 'fwname': 'DNS-320L-rev-Ax', 'tested': True},
        'time': int(time.time()), 'uptime': up, 'load': [0.42, 0.38, 0.35],
        'cpu': {'total': int(up * 100), 'idle': int(up * 85)},
        'memory': {'memtotal': 253092 * 1024, 'memavailable': 160000 * 1024},
        'temperature': 41000, 'fan_pwm': 100,
        'network': {'eth0': {'ipv4': {'address': '10.241.1.106', 'prefix': 24}, 'gateway': '10.241.1.1', 'dns': ['10.243.1.100'],
                             'speed': 1000, 'mac': 'c4:a8:1d:81:f3:c2', 'rx_bytes': int(up * 2_000_000), 'tx_bytes': int(up * 150_000)}},
        'filesystems': [
            {'source': 'ubi0:rootfs_data', 'mount': '/overlay', 'size': 46 << 20, 'used': 3 << 20, 'avail': 43 << 20},
            {'source': '/dev/ubiblock0_0', 'mount': '/rom', 'size': 9 << 20, 'used': 9 << 20, 'avail': 0},
            {'source': 'tmpfs', 'mount': '/tmp', 'size': 123 << 20, 'used': 1 << 20, 'avail': 122 << 20}],
        'disks': [{'name': 'sda', 'model': 'WDC WD40EFPX', 'size': 4000787030016, 'removable': False},
                  {'name': 'sdb', 'model': 'WDC WD40EFPX', 'size': 4000787030016, 'removable': False}]}


def storage():
    pct = min(99.9, 12.4 + (time.time() - T0) / 60)
    return {
        'disks': [DISK('sda', 'WDC WD40EFPX-68C6CN0', 'WD-WX12A3456789'), DISK('sdb', 'WDC WD40EFPX-68C6CN0', 'WD-WX98B7654321')]
        + ([] if STATE.get('usb_gone') else [{'name': 'sdc', 'type': 'disk', 'size': 32 * 10**9, 'model': 'SanDisk Ultra', 'tran': 'usb', 'rm': True, 'usb': True,
              'children': [{'name': 'sdc1', 'type': 'part', 'fstype': 'exfat', 'label': 'STICK', 'mountpoint': '/mnt/usb-stick'}]}]),
        'usb': [] if STATE.get('usb_gone') else [{'dev': '/dev/sdc1', 'path': '/mnt/usb-stick', 'fs': 'exfat'}],
        'swaps': [{'device': '/dev/sda1', 'size': 1 << 30, 'used': 12 << 20}, {'device': '/dev/sdb1', 'size': 1 << 30, 'used': 11 << 20}],
        'apps': 'daten',
        # MOCK_DEGRADED=1: sdb is new/empty, the mirror runs on sda only
        'arrays': {'md0': {'name': 'md0', 'state': 'active', 'level': 'raid1', 'members': ['sda2'], 'disks': 2, 'active': 1, 'health': 'U_'}
                   if os.environ.get('MOCK_DEGRADED') and not STATE.get('repair_t') else
                   {'name': 'md0', 'state': 'active', 'level': 'raid1', 'members': ['sdb2', 'sda2'], 'disks': 2, 'active': 2,
                    'health': 'UU', 'sync': {'action': 'recovery' if STATE.get('repair_t') else 'resync', 'percent': pct, 'finish': '412.5min'}}},
        'volumes': [{'name': 'daten', 'uuid': '1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'fstype': 'ext4', 'layout': 'mirror', 'enabled': True,
                     'device': '/dev/md0', 'mountpoint': '/mnt/daten', 'mounted': True, 'size': 3936 << 30, 'used': 1210 << 30, 'avail': 2726 << 30}],
        'spindown': 20, 'job': STATE['job']}


SERVICES = [('board', 'Gerätesteuerung', 'Lüfter, Temperatur, Taster, MCU-Uhr', True), ('crond', 'Zeitplaner', 'cron', False),
            ('dropbear', 'SSH / SFTP', 'Dropbear, Port 22', False), ('ntpd', 'Zeit (NTP)', 'stellt die Uhr, gleicht die MCU-Uhr ab', False),
            ('rpcd', 'API (rpcd)', 'Schnittstelle für diese Oberfläche', True), ('syslogd', 'Systemprotokoll', 'syslogd, im RAM', False),
            ('ubus', 'Systembus (ubus)', 'Nachrichten zwischen den Diensten', True), ('uhttpd', 'Weboberfläche', 'uhttpd, Port 80', True)]

RELEASES = [{'tag': 'v0.2.0-beta.1', 'version': '0.2.0-beta.1', 'prerelease': True, 'date': '2026-10-24T10:00:00Z', 'size': 8396800,
             'url': 'https://github.com/UniqueDroid/ShareOS/releases', 'notes': '- Freigaben (SMB, NFS)\n- Benutzer und Gruppen\n- Speicher-Assistent'},
            {'tag': 'v0.1.0-beta.1', 'version': '0.1.0-beta.1', 'prerelease': True, 'date': '2026-10-17T16:00:00Z', 'size': 8392704,
             'url': 'https://github.com/UniqueDroid/ShareOS/releases', 'notes': 'Erste Testversion'}]


def accounts():
    u = STATE['users']
    users = [{'name': n, 'role': x['role'], 'fullname': x['fullname'], 'uid': 1000 + k, 'groups': x['groups'], 'home': x['home'],
              'quota': x['quota'], 'web': x['web'],
              'usage': [{'volume': 'daten', 'used': (k + 1) * 37_000_000_000, 'limit': x['quota'] * 1000000}] if x['home'] else []}
             for k, (n, x) in enumerate(sorted(u.items()))]
    groups = [{'name': g, 'desc': d, 'members': [n for n, x in u.items() if g in x['groups']]} for g, d in sorted(STATE['groups'].items())]
    return {'users': users, 'groups': groups}


def shares():
    return {'shares': [{'name': n, **x, 'fullpath': f"/mnt/{x['volume']}/{x['path']}", 'mounted': True} for n, x in sorted(STATE['shares'].items())],
            'workgroup': 'WORKGROUP', 'smb_enabled': True, 'nfs_enabled': True, 'smb_running': True, 'nfs_running': True}


def me(user):
    if user == 'root':
        return {'name': 'root', 'role': 'admin', 'fullname': 'Administrator', 'groups': [], 'quota': 0, 'home': None, 'usage': [], 'shares': [], 'host': 'skynet-nas'}
    x = STATE['users'][user]
    mine = []
    for n, sh in sorted(STATE['shares'].items()):
        tags = [user] + ['@' + g for g in x['groups']]
        acc = 'rw' if any(t in sh['rw'] for t in tags) else 'ro' if any(t in sh['ro'] for t in tags) or sh['guest'] else None
        if acc:
            mine.append({'name': n, 'access': acc, 'comment': sh['comment']})
    return {'name': user, 'role': x['role'], 'fullname': x['fullname'], 'groups': x['groups'], 'quota': x['quota'],
            'home': {'volume': x['home'], 'path': f"/mnt/{x['home']}/home/{user}", 'smb': user} if x['home'] else None,
            'usage': [{'volume': 'daten', 'used': 61_500_000_000, 'limit': x['quota'] * 1000000}], 'shares': mine, 'host': 'skynet-nas',
            'cloud': x.get('cloud', False), 'paperless': bool(x['home']), 'files': x.get('files', False) and x['role'] == 'user',
            'ui': x.get('ui', {'theme': None, 'accent': None}),
            'apps': [{'id': a['id'], 'name': a['name'], 'entry': a['entry'], 'icon': a['icon'], 'description': a['description']}
                     for a in APPS['installed'].values() if a.get('type') != 'system' and ('*' in a['users'] or user in a['users'])],
            'apps_server': {'port': 8081, 'https_port': 8444, 'https': True}}


PL_LOG = [
    {'file': 'Rechnung-Stadtwerke.pdf', 'task': 'a1b2', 'state': 'SUCCESS', 'message': 'Success. New document id 412 created'},
    {'file': 'Kontoauszug-09.pdf', 'task': 'c3d4', 'state': 'PENDING', 'message': 'uploaded'},
    {'file': 'scan_0042.tif', 'task': '', 'state': 'FAILURE', 'message': 'Not consuming scan_0042.tif: It is a duplicate of Steuer 2025 (#388)'}]


def pl_inbox(name):
    x = STATE['pl']['inboxes'][name]
    path = f"/mnt/daten/home/{x['owner']}/Paperless" if x['owner'] else '/mnt/daten/Fotos'
    now = int(time.time())
    return {'name': name, 'owner': x['owner'], 'share': x['share'], 'path': path, 'token_set': True, 'token_hint': '…9f2c',
            'tags': x['tags'], 'enabled': x['enabled'], 'waiting': 1 if x['owner'] else 0,
            'recent': [dict(e, time=now - 300 * (i + 1)) for i, e in enumerate(PL_LOG)]}


def pl_global():
    g = STATE['pl']
    return {'url': g['url'], 'enabled': g['enabled'], 'interval': g['interval'], 'after': g['after'], 'last': int(time.time()) - 70}


def cloud_jobs(owner):
    now = int(time.time())
    out = []
    for n, j in sorted(STATE['cloud']['jobs'].items()):
        if owner is not None and j['owner'] != owner:
            continue
        out.append(dict({'name': n, 'started': now - 4000, 'ended': 0 if j['state'] == 'running' else now - 3500, 'error': ''}, **j))
    return out


T0F = int(time.time())
FS = {   # root -> path -> list of (name, type, size)
    'daten': {'': [('Fotos', 'dir', 0), ('Medien', 'dir', 0), ('home', 'dir', 0), ('Rechnungen 2026', 'dir', 0), ('notizen.txt', 'file', 2310), ('backup-router.tar.gz', 'file', 48_200_000)],
              'Fotos': [('2025', 'dir', 0), ('2026', 'dir', 0), ('Urlaub_Ostsee_001.jpg', 'file', 4_812_000), ('Urlaub_Ostsee_002.jpg', 'file', 5_120_400)],
              'Fotos/2025': [], 'Fotos/2026': [], 'Medien': [('Filme', 'dir', 0), ('Musik', 'dir', 0)], 'Medien/Filme': [], 'Medien/Musik': [], 'home': [],
              'Rechnungen 2026': [('Stadtwerke-09.pdf', 'file', 182_000), ('Telekom-09.pdf', 'file', 95_400)]},
    'home': {'': [('Paperless', 'dir', 0), ('Dokumente', 'dir', 0), ('Handy-Fotos', 'dir', 0), ('Lebenslauf.pdf', 'file', 310_220), ('Einkaufsliste.txt', 'file', 412)],
             'Paperless': [], 'Dokumente': [('Steuer 2025.pdf', 'file', 1_204_000)], 'Handy-Fotos': [('IMG_2041.jpg', 'file', 3_400_000)]},
}
TICKETS = {}


def fs_entries(root, path):
    out = []
    for i, (n, t, sz) in enumerate(FS[root].get(path, [])):
        out.append({'name': n, 'type': t, 'size': sz, 'mtime': T0F - 3600 * (i + 1) * 7})
    return sorted(out, key=lambda e: (e['type'] != 'dir', e['name'].lower()))


def files_call(user, method, args):
    roots = [{'name': 'daten', 'home': False}] if user == 'root' or STATE['users'].get(user, {}).get('role') == 'admin' else [{'name': 'home', 'home': True}]
    if method == 'roots':
        return {'roots': roots}
    root, path = args.get('root'), (args.get('path') or '').strip('/')
    if root not in [r['name'] for r in roots] or path not in FS[root]:
        return {'error': 'not found'}
    d = FS[root][path]
    if method == 'list':
        e = [x for x in fs_entries(root, path) if args.get('hidden') or not x['name'].startswith('.')]
        return {'root': root, 'path': path, 'entries': e, 'truncated': False, 'free': 3_120_000_000_000, 'size': 3_936_000_000_000}
    if method == 'mkdir':
        d.append((args['name'], 'dir', 0)); FS[root][(path + '/' if path else '') + args['name']] = []
        return {'ok': True}
    if method == 'rename':
        FS[root][path] = [(args['to'] if n == args['name'] else n, t, sz) for n, t, sz in d]
        return {'ok': True}
    if method == 'delete':
        FS[root][path] = [x for x in d if x[0] not in args['names']]
        return {'ok': True}
    if method == 'move':
        dest = (args.get('dest') or '').strip('/')
        if dest not in FS[root]:
            return {'error': 'not found'}
        moved = [x for x in d if x[0] in args['names']]
        FS[root][dest] += moved
        if not args.get('copy'):
            FS[root][path] = [x for x in d if x[0] not in args['names']]
        return {'ok': True}
    if method == 'ticket':
        t = os.urandom(16).hex()
        TICKETS[t] = (root, path, args['name'], args.get('mode'))
        if args.get('mode') == 'put' and any(n == args['name'] for n, _, _ in d) and not args.get('overwrite'):
            return {'error': 'already exists'}
        return {'url': '/cgi-bin/files?t=' + t}
    return {'error': 'unknown'}


APPS = {'installed': {'notes-backup': {'id': 'notes-backup', 'name': 'Notes Backup', 'version': '0.3.0', 'publisher': 'Jan', 'description': {'de': 'Sichert Notizen jede Nacht', 'en': 'backs up notes every night'},
                       'type': 'webapp', 'entry': 'index.html', 'icon': None, 'category': 'tools', 'permissions': ['cron'], 'verified': False, 'source': 'upload',
                       'installed': 0, 'users': ['*'],
                       'jobs': [{'id': 'nightly', 'name': 'Nightly backup', 'command': 'jobs/backup.sh', 'timeout': 300, 'schedule': '30 3 * * *', 'default_schedule': '30 3 * * *',
                                 'enabled': True, 'running': False, 'last': {'time': 1792290600, 'duration': 4, 'rc': 0, 'timeout': False}},
                                {'id': 'cleanup', 'name': 'Clean up old backups', 'command': 'jobs/cleanup.sh', 'timeout': 120, 'schedule': '0 5 * * 0', 'default_schedule': '0 4 * * 0',
                                 'enabled': False, 'running': False, 'last': None}]},
                       'webpad': {'id': 'webpad', 'name': 'Webpad', 'version': '1.3.0', 'publisher': 'UniqueDroid', 'description': {'de': 'Texteditor im Stil von Notepad++', 'en': 'text editor'},
                                  'type': 'webapp', 'entry': 'index.html', 'icon': None, 'category': 'tools', 'permissions': ['files'], 'verified': True, 'source': 'store',
                                  'installed': 0, 'users': ['*'], 'jobs': [], 'window': {'width': 1000, 'height': 700},
                                  'opens': [{'ext': ['.txt', '.md', '.log', '.json', '.conf'], 'mode': 'edit', 'label': None}]},
                       'fan-tuner': {'id': 'fan-tuner', 'name': 'Fan Tuner', 'version': '0.1.0', 'publisher': 'Jan', 'description': {'de': 'Nur Einstellungen – wird in ShareOS angezeigt', 'en': 'settings only'},
                                     'type': 'webapp', 'entry': 'index.html', 'icon': None, 'category': 'system', 'permissions': ['embed'], 'verified': False, 'source': 'upload',
                                     'installed': 0, 'users': ['*'], 'jobs': [], 'window': None, 'opens': []},
                       'nano': {'id': 'nano', 'name': 'nano', 'version': '8.7.0', 'publisher': 'UniqueDroid', 'description': {'de': 'Einfacher Texteditor für das Terminal (System → Terminal oder SSH): „nano datei“. Mit Rückgängig, Suchen und Ersetzen und UTF-8.', 'en': 'text editor for the terminal'},
                                'type': 'system', 'commands': ['nano'], 'entry': 'index.html', 'icon': None, 'category': 'tools', 'permissions': [], 'verified': True, 'source': 'store',
                                'installed': 0, 'users': [], 'jobs': [], 'window': None, 'opens': []}},
        'job': None, 'channel': 'stable',
        'sources': ['https://github.com/UniqueDroid/ShareOS-Apps/releases/download/catalog/index.json'], 'refreshed': 0}
CATALOG = [
    {'id': 'webpad', 'name': 'Webpad', 'publisher': 'UniqueDroid', 'category': 'tools', 'type': 'webapp',
     'description': {'de': 'Texteditor im Browser im Stil von Notepad++: Syntaxhervorhebung, Tabs, Suchen und Ersetzen. Läuft komplett offline.',
                     'en': 'Text editor in the browser in the style of Notepad++. Works fully offline.'},
     'icon_url': None, 'entry': 'index.html', 'icon': 'icon.svg',
     'versions': [{'version': '1.0.0', 'date': '2026-10-18T10:28:46Z', 'prerelease': False, 'url': 'https://example/webpad.sapp', 'sha256': '0' * 64,
                   'size': 513577, 'min_shareos': '0.1.0', 'notes_url': 'https://github.com/UniqueDroid/ShareOS-Apps/releases/tag/webpad-v1.0.0'}]},
    {'id': 'htop', 'name': 'htop', 'publisher': 'UniqueDroid', 'category': 'system', 'type': 'system',
     'description': {'de': 'Zeigt im Terminal (System → Terminal oder SSH) laufende Prozesse, CPU- und Speicherauslastung live an: „htop“. Beenden mit F10 oder q.',
                     'en': 'Shows running processes, CPU and memory use live in the terminal.'},
     'icon_url': None, 'entry': 'index.html',
     'versions': [{'version': '3.4.1', 'date': '2026-10-20T08:30:00Z', 'prerelease': False, 'url': 'https://example/htop.sapp', 'sha256': '0' * 64,
                   'size': 263644, 'min_shareos': '0.2.0-beta.1', 'notes_url': ''}]},
    {'id': 'mediathek', 'name': 'Mediathek', 'publisher': 'Beispiel', 'category': 'media', 'type': 'webapp',
     'description': {'de': 'Fotos und Videos der Freigaben im Browser ansehen (Beispiel-Eintrag).', 'en': 'Browse photos and videos (sample entry).'},
     'icon_url': None, 'entry': 'index.html',
     'versions': [{'version': '0.3.0-beta.1', 'date': '2026-10-16T09:00:00Z', 'prerelease': True, 'url': 'https://example/m.sapp', 'sha256': '0' * 64,
                   'size': 182000, 'min_shareos': '0.1.0', 'notes_url': ''}]},
]


def apps_catalog():
    out = []
    # SHAREOS_MOCK_CATALOG=<index.json>: a real catalog (e.g. the release asset of ShareOS-Apps)
    cat = CATALOG
    if os.environ.get('SHAREOS_MOCK_CATALOG'):
        cat = json.load(open(os.environ['SHAREOS_MOCK_CATALOG'], encoding='utf-8'))['apps']
        for a in cat:
            for v in a['versions']:
                v.setdefault('prerelease', False)
    for a in cat:
        vs = [v for v in a['versions'] if APPS['channel'] == 'beta' or not v['prerelease']]
        if not vs:
            continue
        i = APPS['installed'].get(a['id'])
        out.append(dict(a, versions=vs, latest=vs[0]['version'], installed=i['version'] if i else None,
                        update_available=bool(i) and i['version'] != vs[0]['version'], compatible=True, source=APPS['sources'][0]))
    return {'time': APPS['refreshed'], 'channel': APPS['channel'], 'sources': APPS['sources'], 'errors': [], 'apps': out}


def apps_call(method, args):
    srv = {'port': 8081, 'https_port': 8444, 'https': True, 'host': STATE.get('web_host') or None, 'host_auto': False}
    ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzNkYTVmZiIvPjwvc3ZnPg=='
    if method == 'installed':
        return dict(srv, apps=[dict(a, icon_data=ICON if a['id'] == 'webpad' else None) for a in APPS['installed'].values()])
    if method == 'catalog':
        if args.get('refresh'):
            APPS['refreshed'] = int(time.time())
        return apps_catalog()
    if method == 'store_get':
        return dict(srv, channel=APPS['channel'], sources=APPS['sources'])
    if method == 'store_set':
        if args.get('channel'):
            APPS['channel'] = args['channel']
        if args.get('sources') is not None:
            APPS['sources'] = args['sources']
        return {'ok': True}
    if method == 'install':
        a = next(x for x in CATALOG if x['id'] == args['id'])
        APPS['job'] = {'state': 'downloading', 'id': a['id'], 'version': args.get('version') or a['versions'][0]['version'], 't': time.time()}
        return {'started': True}
    if method == 'status':
        j = APPS['job']
        if not j:
            return {'state': 'idle'}
        dt = time.time() - j['t']
        if dt < 1.2:
            return {'state': 'downloading', 'id': j['id']}
        if dt < 2:
            return {'state': 'verifying', 'id': j['id']}
        a = next(x for x in CATALOG if x['id'] == j['id'])
        APPS['installed'][a['id']] = {'id': a['id'], 'name': a['name'], 'version': j['version'], 'publisher': a['publisher'], 'description': a['description'],
                                      'type': a['type'], 'entry': 'index.html', 'icon': a.get('icon'), 'category': a['category'], 'permissions': [],
                                      'commands': [a['id']] if a['type'] == 'system' else [],
                                      'verified': True, 'source': APPS['sources'][0], 'installed': int(time.time()), 'users': [] if a['type'] == 'system' else ['*']}
        APPS['job'] = None
        return {'state': 'done', 'id': a['id'], 'version': j['version']}
    if method == 'remove':
        APPS['installed'].pop(args['id'], None)
        return {'ok': True}
    if method == 'set':
        APPS['installed'][args['id']]['users'] = args['users']
        return {'ok': True}
    if method == 'job_set':
        for j in APPS['installed'][args['id']]['jobs']:
            if j['id'] == args['job']:
                if args.get('schedule'):
                    j['schedule'] = args['schedule']
                if args.get('enabled') is not None:
                    j['enabled'] = args['enabled']
        return {'ok': True}
    if method == 'job_run':
        for j in APPS['installed'][args['id']]['jobs']:
            if j['id'] == args['job']:
                j['last'] = {'time': int(time.time()), 'duration': 3, 'rc': 0, 'timeout': False}
        return {'started': True}
    if method == 'job_log':
        return {'log': 'backup of 12 notes written to backups/2026-10-18.zip\n', 'last': None}
    if method == 'upload_ticket':
        return {'url': '/cgi-bin/files?t=upload'}
    if method == 'install_upload':
        APPS['installed']['meine-app'] = {'id': 'meine-app', 'name': 'Meine App', 'version': '0.1.0', 'publisher': 'Jan', 'description': 'Eigene Test-App',
                                          'type': 'webapp', 'entry': 'index.html', 'icon': None, 'category': 'tools', 'permissions': [],
                                          'verified': False, 'source': 'upload', 'installed': int(time.time()), 'users': []}
        return {'ok': True, 'id': 'meine-app', 'version': '0.1.0', 'verified': False}
    return {'error': 'unknown'}


def call(obj, method, args):
    if obj == 'session' and method == 'login':
        user, pw = args.get('username'), args.get('password')
        if user == 'root' and pw == 'shareos':
            return {'ubus_rpc_session': SID}
        x = STATE['users'].get(user)
        if x and x['pw'] == pw and (x['role'] == 'admin' or (x['role'] == 'user' and x['web'])):
            return {'ubus_rpc_session': SID}
        return 6
    if obj == 'shareos.me':
        if method == 'bind':
            STATE['sessions'][SID] = args['username']
        u = STATE['sessions'].get(SID, 'root')
        if method == 'passwd':
            return {'ok': True}
        if method == 'ui_set':
            ui = STATE['users'][u].setdefault('ui', {'theme': None, 'accent': None})
            for k in ('theme', 'accent'):
                if k in args:
                    ui[k] = args[k] or None
            return ui
        if method in ('paperless', 'paperless_set'):
            ib = 'u_' + u
            if method == 'paperless_set':
                if args.get('test'):
                    return {'ok': True, 'documents': '96'}
                STATE['pl']['inboxes'][ib] = {'owner': u, 'share': '', 'tags': args.get('tags', []), 'enabled': args.get('enabled', True)}
            return {'url': STATE['pl']['url'], 'available': True, 'inbox': pl_inbox(ib) if ib in STATE['pl']['inboxes'] else None,
                    'folder': f'\\\\skynet-nas\\{u}\\Paperless', 'ok': True}
        if method.startswith('cloud'):
            c = STATE['cloud']
            mine = c['remotes'].setdefault(u, [])
            if method == 'cloud_remote_add':
                mine.append({'name': args['name'], 'type': args['type'] or 'raw'})
            if method == 'cloud_remote_del':
                c['remotes'][u] = mine = [r for r in mine if r['name'] != args['name']]
            if method == 'cloud_job_set':
                old = c['jobs'].get(args['name'], {'state': None, 'summary': ''})
                c['jobs'][args['name']] = dict(old, owner=u, **{k: v for k, v in args.items() if k != 'name'})
            if method == 'cloud_job_del':
                c['jobs'].pop(args['name'], None)
            if method == 'cloud_job_run':
                return {'started': True}
            return {'allowed': True, 'installed': c['installed'], 'remotes': mine, 'jobs': cloud_jobs(u), 'shares': ['fotos'], 'ok': True}
        return me(u)
    if obj == 'shareos.apps':
        return apps_call(method, args)
    if obj == 'shareos.files' and method == 'openers':
        return {'port': 8081, 'https_port': 8444, 'https': False,
                'apps': [{k: a[k] for k in ('id', 'name', 'entry', 'icon', 'window', 'opens')} for a in APPS['installed'].values() if a.get('opens')]}
    if obj == 'shareos.files' and method == 'app_ticket':
        a = APPS['installed'].get(args['app'], {})
        return {'ticket': '0123456789abcdef0123456789abcdef', 'mode': 'edit', 'app': args['app'], 'entry': 'index.html',
                'window': {'width': 1000, 'height': 700}, 'port': 8081, 'https_port': 8444, 'https': False,
                'grant': 'fedcba9876543210fedcba9876543210' if 'files' in a.get('permissions', []) else None}
    if obj == 'shareos.files' and method == 'app_grant':
        a = APPS['installed'].get(args.get('app'))
        if not a:
            return {'error': 'app not available'}
        if 'files' not in a.get('permissions', []):
            return {'error': 'the app has no access to files'}
        return {'grant': 'fedcba9876543210fedcba9876543210'}
    if obj == 'shareos.files':
        return files_call(STATE['sessions'].get(SID, 'root'), method, args)
    if obj == 'shareos.notify':
        N = STATE.setdefault('notes', [
            {'id': 'a1', 'key': 'raid-md0', 'level': 'error', 'source': 'storage', 'title_de': 'RAID md0 unvollständig', 'title_en': 'RAID md0 degraded',
             'text_de': 'Eine Platte fehlt oder ist ausgefallen (U_). Neue Platte einsetzen und unter Speicher „Spiegel reparieren“ wählen.',
             'text_en': 'A disk is missing or failed (U_). Put in a new disk and choose “Repair mirror” under Storage.', 'time': int(time.time()) - 3600, 'last': int(time.time()) - 600, 'count': 7, 'read': False, 'resolved': False},
            {'id': 'a2', 'key': 'update-0.1.0-beta.9', 'level': 'info', 'source': 'update', 'title_de': 'Update verfügbar: 0.1.0-beta.9', 'title_en': 'Update available: 0.1.0-beta.9',
             'text_de': 'Unter System → Firmware installieren.', 'text_en': 'Install it under System → Firmware.', 'time': int(time.time()) - 7200, 'last': int(time.time()) - 7200, 'count': 1, 'read': True, 'resolved': False},
            {'id': 'a3', 'key': 'temp', 'level': 'warn', 'source': 'system', 'title_de': 'Box zu warm: 57 °C', 'title_en': 'Box too warm: 57 °C', 'text_de': '', 'text_en': '',
             'time': int(time.time()) - 86400, 'last': int(time.time()) - 86000, 'count': 2, 'read': True, 'resolved': True}])
        C = STATE.setdefault('notecfg', {'email': False, 'smtp_host': '', 'smtp_tls': 'starttls', 'smtp_port': '', 'smtp_user': '', 'mail_from': '', 'mail_to': '',
                                          'email_level': 'warn', 'push': True, 'push_type': 'ntfy', 'push_url': 'https://ntfy.sh/skynet-nas', 'push_level': 'warn',
                                          'temp_max': 55, 'disk_full': 90, 'has_pass': False, 'has_token': False})
        if method == 'list':
            return {'items': N, 'unread': len([x for x in N if not x['read'] and not x['resolved']])}
        if method == 'read':
            for x in N:
                if args.get('id') in ('all', x['id']): x['read'] = True
        if method == 'delete':
            STATE['notes'] = [] if args.get('id') == 'all' else [x for x in N if x['id'] != args.get('id')]
        if method == 'get':
            return C
        if method == 'set':
            C.update({k: v for k, v in args.items() if k not in ('smtp_pass', 'push_token')})
            return C
        return {'ok': True}
    if obj == 'shareos.widget':
        if method == 'set':
            if args.get('enabled') is not None:
                STATE['widget']['enabled'] = args['enabled']
            if args.get('renew') or not STATE['widget']['token']:
                STATE['widget']['token'] = os.urandom(16).hex()
        return STATE['widget']
    if obj == 'shareos.paperless':
        if method == 'get':
            return dict(pl_global(), inboxes=[pl_inbox(n) for n in STATE['pl']['inboxes']])
        if method == 'set_global':
            STATE['pl'].update({k: v for k, v in args.items() if v is not None and v != ''})
            return pl_global()
        if method == 'test':
            return {'ok': True, 'documents': '1287'}
        if method == 'inbox_set':
            STATE['pl']['inboxes'][args['name']] = {'owner': args.get('owner', ''), 'share': args.get('share', ''), 'tags': args.get('tags', []), 'enabled': args.get('enabled', True)}
            return {'ok': True, 'inbox': pl_inbox(args['name'])}
        if method == 'inbox_del':
            STATE['pl']['inboxes'].pop(args['name'], None)
            return {'ok': True}
        if method == 'tags':
            return {'tags': [{'id': 1, 'name': 'Rechnung'}, {'id': 2, 'name': 'Steuer'}, {'id': 3, 'name': 'Posteingang'}, {'id': 4, 'name': 'Versicherung'}]}
        if method == 'log':
            return {'entries': pl_inbox(args['inbox'])['recent']}
        return {'started': True}
    if obj == 'shareos.dlna':
        d = STATE.setdefault('dlna', {'installed': True, 'enabled': True, 'running': True, 'scanning': False, 'audio': 4218, 'video': 312, 'image': 15873,
                                      'db': '/mnt/daten/.shareos/minidlna', 'clients': [{'type': 'Samsung Series [CDEFJ]', 'ip': '10.241.1.40'}, {'type': 'Generic DLNA 1.5', 'ip': '10.241.1.52'}],
                                      'name': '', 'hostname': 'skynet-nas', 'media': [{'type': 'A', 'share': 'musik'}, {'type': 'V', 'share': 'filme'}],
                                      'shares': ['backup', 'filme', 'fotos', 'musik']})
        if method == 'set':
            d.update(enabled=args['enabled'], running=args['enabled'], name=args['name'], media=args['media'])
        if method == 'rescan':
            d['scanning'] = True
        return d
    if obj == 'shareos.cloud':
        c = STATE['cloud']
        if method == 'status':
            return {'installed': c['installed'], 'version': 'v1.75.2' if c['installed'] else None, 'apps': 'daten', 'installing': False, 'install_error': None}
        if method in ('remotes', 'remote_add', 'remote_del'):
            if method == 'remote_add':
                c['remotes']['-'].append({'name': args['name'], 'type': args['type'] or 'raw'})
            if method == 'remote_del':
                c['remotes']['-'] = [r for r in c['remotes']['-'] if r['name'] != args['name']]
            return {'ok': True, 'remotes': c['remotes']['-']}
        if method == 'remote_test':
            return {'ok': True, 'folders': 14}
        if method in ('jobs', 'job_set', 'job_del'):
            if method == 'job_set':
                old = c['jobs'].get(args['name'], {'owner': '', 'state': None, 'summary': ''})
                c['jobs'][args['name']] = dict(old, **{k: v for k, v in args.items() if k != 'name'})
            if method == 'job_del':
                c['jobs'].pop(args['name'], None)
            return {'ok': True, 'jobs': cloud_jobs(None)}
        if method == 'job_log':
            return {'lines': ['2026/10/18 03:00:01 INFO  : Starting upload to b2backup:nas/fotos', '2026/10/18 03:01:01 INFO  : 312 / 312 files, 1.2 GiB, 100%', '2026/10/18 03:01:05 INFO  : done']}
        return {'started': True}
    if obj == 'shareos.accounts':
        if method == 'add':
            STATE['users'][args['name']] = {'role': args['role'], 'fullname': args.get('fullname', ''), 'groups': args.get('groups', []),
                                            'home': args.get('home', ''), 'quota': args.get('quota', 0), 'web': args.get('web', True), 'pw': args.get('password')}
        if method == 'set':
            STATE['users'][args['name']].update({k: v for k, v in args.items() if k != 'name'})
        if method == 'del':
            STATE['users'].pop(args['name'], None)
        if method == 'group_add':
            STATE['groups'][args['name']] = args.get('desc', '')
        if method == 'group_del':
            STATE['groups'].pop(args['name'], None)
        if method == 'import_altf':
            return {'ok': True, 'imported': [], 'skipped': [], **accounts()}
        return accounts() if method != 'passwd' else {'ok': True}
    if obj == 'shareos.backup':
        summary = {'version': '0.1.0-beta.2', 'host': 'skynet-nas', 'created': int(time.time()), 'users': sorted(STATE['users']),
                   'shares': sorted(STATE['shares']), 'configs': ['shareos', 'storage', 'network', 'accounts', 'shares'], 'certificate': True}
        if method == 'export':
            enc = bool(args.get('password'))
            return {'filename': 'shareos-skynet-nas-20261017-2330.json', 'encrypted': enc,
                    'content': json.dumps({'shareos_backup': 1, 'encrypted': True, 'data': 'U09TMQ=='} if enc else {'shareos_backup': 1, **summary}), **summary}
        try:
            d = json.loads(args.get('content') or '')
        except ValueError:
            return {'error': 'not a ShareOS settings backup'}
        if d.get('encrypted') and not args.get('password'):
            return {'error': 'password required', 'encrypted': True}
        return {'ok': True, 'reboot': True} if args.get('apply') else {'ok': True, 'preview': True, **summary}
    if obj == 'shareos.shares':
        if method == 'set':
            STATE['shares'][args['name']] = {k: v for k, v in args.items() if k != 'name'}
        if method == 'del':
            STATE['shares'].pop(args['name'], None)
        return shares()
    if obj == 'session':
        return {}
    if obj == 'shareos.ui':
        if method == 'set':
            if args.get('lang'):
                STATE['lang'] = args['lang']
            if 'logo' in args:
                STATE['logo'] = bool(args['logo'])
            for k in ('theme', 'accent'):
                if args.get(k):
                    STATE[k] = args[k]
            for k, v in (args.get('areas') or {}).items():
                STATE.setdefault('areas', {'apps': True, 'cloud': True, 'paperless': True})[k] = bool(v)
        return {'lang': STATE['lang'], 'logo': STATE['logo'], 'theme': STATE['theme'], 'accent': STATE['accent'],
                'areas': STATE.get('areas', {'apps': True, 'cloud': True, 'paperless': True}), 'default_password': True}
    if obj == 'shareos.net':
        if method == 'set':
            STATE['net'] = {k: args.get(k, STATE['net'][k]) for k in STATE['net']}
            STATE['net_pending'] = time.time() + 120
            return {'ok': True, 'timeout': 120}
        if method == 'confirm':
            STATE['net_pending'] = None
            return {'ok': True}
        p = STATE['net_pending']
        return {**STATE['net'], 'timeout': 120, 'result': None,
                'pending': {'until': int(p), 'left': max(0, int(p - time.time()))} if p else None}
    if obj == 'shareos.time':
        t = STATE.setdefault('time', {'timezone': 'Europe/Berlin', 'ntp': True, 'servers': ['0.pool.ntp.org', '1.pool.ntp.org', '2.pool.ntp.org'],
                                      'last_sync': int(time.time()) - 1800, 'offset': 0})
        if method == 'set':
            for k in ('timezone', 'ntp', 'servers'):
                if args.get(k) is not None: t[k] = args[k]
        if method == 'sync':
            t['last_sync'] = int(time.time())
        if method == 'set_clock':
            t['offset'] = int(args['time']) - int(time.time())
        return {'now': int(time.time()) + t['offset'], 'timezone': t['timezone'], 'ntp': t['ntp'], 'servers': t['servers'],
                'last_sync': t['last_sync'], 'ntp_running': t['ntp'], 'rtc': True}
    if obj == 'shareos.setup':
        if method == 'status':
            return {'done': STATE['setup_done'], 'hostname': 'shareos', 'timezone': 'Europe/Berlin', 'lang': STATE['lang'], 'channel': 'stable'}
        if method == 'zones':
            return {'zones': ['Europe/Berlin', 'Europe/London', 'Europe/Vienna', 'Europe/Zurich', 'America/New_York', 'UTC'], 'current': 'Europe/Berlin'}
        if method == 'altf':
            return {'found': True, 'file': 'set_2026-07-23_15:20:02.tgz', 'date': '2026-07-23 15:20:02', 'hostname': 'skynet-nas',
                    'timezone': 'Europe/Berlin', 'users': ['jan:Jan', 'media:Medien'], 'shares': ['Fotos', 'Musik', 'Backup'], 'nfs': ['/mnt/md0/proxmox'], 'fan_lo_temp': '45'}
        if method in ('apply',):
            STATE['setup_done'] = True
            return {'ok': True, 'done': []}
        if method == 'reset':
            STATE['setup_done'] = False
        return {'ok': True}
    if obj == 'shareos.hw':
        if method == 'set_fan':
            STATE['fan'].update(args)
        if method == 'set_led':
            STATE['led'].update({k: v for k, v in args.items() if v})
        return {'fan': STATE['fan'], 'led': STATE['led'], 'temperature': 41000, 'fan_pwm': 100,
                'presets': {'quiet': {'off_temp': 40, 'full_temp': 55, 'half_temp': 50}}}
    if obj == 'shareos.web':
        if method == 'set':
            STATE.update({k: v for k, v in args.items() if k in ('https', 'redirect')})
            if 'host' in args:
                STATE['web_host'] = args['host']
        return {'https': STATE['https'], 'redirect': STATE['redirect'], 'host': STATE.get('web_host', ''), 'cert_host': 'skynet-nas.skynet.lan', 'cert': {
            'subject': 'CN=skynet-nas, O=ShareOS', 'issuer': 'CN=skynet-nas, O=ShareOS', 'from': '2026-10-17 00:00:00',
            'until': '2036-10-17 23:59:59', 'san': ['dNSName:skynet-nas', 'dNSName:skynet-nas.local', 'iPAddress:10.241.1.106'], 'selfsigned': True}}
    if obj == 'shareos.system':
        if method == 'terminal':
            return {'port': 7681, 'path': '0123456789abcdef0123456789abcdef'}
        if method == 'info':
            return info()
        if method == 'log':
            return {'lines': ['Oct 17 16:00:01 skynet-nas syslog.info syslogd started', 'Oct 17 16:00:05 skynet-nas user.notice shareos: ready']}
        return {'ok': True}
    if obj == 'shareos.service':
        if method == 'list':
            return {'services': [{'name': n, 'label': l, 'desc': d, 'running': n not in STATE['autostart_off'], 'essential': e,
                                  'autostart': n not in STATE['autostart_off']} for n, l, d, e in SERVICES]}
        if method == 'autostart':
            off = set(STATE['autostart_off'])
            (off.discard if args.get('enabled') else off.add)(args['name'])
            STATE['autostart_off'] = sorted(off)
            return {'ok': True, 'name': args['name'], 'autostart': bool(args.get('enabled'))}
        return {'ok': True}
    if obj == 'shareos.storage':
        if method == 'status':
            return storage()
        if method == 'usb_eject':
            STATE['usb_gone'] = True
        if method == 'repair':
            STATE['repair_t'] = time.time()
        return {'ok': True}
    if obj == 'shareos.update':
        if method == 'apply':
            STATE['apply_t'] = time.time()
            return {'started': True}
        if method == 'ack':
            STATE['acked'] = True
        if method in ('bin_ticket', 'local_ticket'):
            return {'url': '/cgi-bin/files?t=upload'}
        if method == 'local':
            STATE['local_t'] = time.time(); STATE['local_sha'] = bool(args.get('sha256'))
            return {'started': True}
        if method == 'status' and STATE.get('local_t') and not STATE.get('apply_t'):
            lrel = {'tag': 'local', 'version': '0.1.0-beta.8', 'local': True, **({'sha_checked': True} if STATE['local_sha'] else {})}
            if time.time() - STATE['local_t'] < 5:
                return {'state': 'verifying', 'current': '0.1.0-beta.7', 'release': {**lrel, 'version': '?'}}
            return {'state': 'ready', 'current': '0.1.0-beta.7', 'release': lrel}
        if method == 'cancel':
            STATE.pop('local_t', None)
        if method == 'bin_info':
            return {'kind': 'altf', 'kernel': 'Alt-F-1.0, kernel 4.4.86', 'initramfs': 'Alt-F-1.0, initrd',
                    'kernel_size': '2410000', 'initramfs_size': '3100000', 'sqimage_size': '0'}
        if method == 'bin_write':
            time.sleep(2)
            return {'ok': True, 'kind': 'altf'}
        rel = {'tag': 'v0.2.0-beta.1', 'version': '0.2.0-beta.1'}
        if method == 'status' and STATE.get('apply_t') and time.time() - STATE['apply_t'] < 2:
            # like the real updater: just after the click it may still report 'ready'
            return {'state': 'ready', 'current': '0.1.0-beta.1', 'release': rel}
        if method == 'status' and STATE.get('apply_t'):
            # walk through the flashing steps, 3 s each
            steps = ['check bundle', 'stage rootfs', 'erase ramdisk', 'write ramdisk', 'verify ramdisk', 'erase uImage', 'write uImage', 'verify uImage']
            i = int((time.time() - STATE['apply_t'] - 2) / 3)
            if i < len(steps):
                return {'state': 'flashing', 'step': steps[i], 'current': '0.1.0-beta.1', 'release': rel}
            return {'state': 'flashed', 'current': '0.1.0-beta.1', 'release': rel, 'pending_reboot': True}
        if method == 'status' and os.environ.get('MOCK_UPDATE_READY'):
            return {'state': 'ready', 'current': '0.1.0-beta.1', 'release': rel}
        check = {'time': int(time.time()), 'channel': STATE['channel'], 'repo': 'UniqueDroid/ShareOS', 'releases': RELEASES,
                 'latest': 'v0.2.0-beta.1', 'update_available': True}
        if method == 'check':
            return {'current': '0.1.0-beta.1', 'fwname': 'DNS-320L-rev-Ax', **check}
        r = {'state': 'idle', 'current': '0.1.0-beta.1', 'check': check, 'last_upgrade': 'ok 0.1.0-beta.1'}
        if STATE.get('acked'):
            del r['last_upgrade']
        return r
    if obj == 'uci':
        if method == 'get':
            return {'values': {}}
        if method == 'set' and args.get('section') == 'update':
            STATE['channel'] = args['values'].get('channel', STATE['channel'])
        return {}
    return 3


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WWW), **kw)

    def log_message(self, *a):
        pass

    def files_cgi(self):
        t = self.path.split('t=')[-1]
        if t == 'upload':
            n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n)
            return self.reply(200, {'ok': True})
        tk = TICKETS.pop(t, None)
        if not tk:
            return self.reply(403, {'error': 'invalid ticket'})
        root, path, name, mode = tk
        if mode == 'get' and self.command == 'GET':
            data = (f'ShareOS mock file {name}\n').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', f'attachment; filename="{name}"')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if mode == 'put' and self.command == 'POST':
            n = int(self.headers.get('Content-Length') or 0)
            left = n
            while left:
                chunk = self.rfile.read(min(left, 65536)); left -= len(chunk)
                time.sleep(0.02)
            d = FS[root][path]
            FS[root][path] = [x for x in d if x[0] != name] + [(name, 'file', n)]
            return self.reply(200, {'ok': True})
        return self.reply(405, {'error': 'method not allowed'})

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith('/cgi-bin/files'):
            return self.files_cgi()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/cgi-bin/files'):
            return self.files_cgi()
        req = json.loads(self.rfile.read(int(self.headers['Content-Length'])) or b'{}')
        params = req.get('params', [])
        if req.get('method') == 'call':
            sid, obj, method, args = params
            if obj not in ('session',) and not (obj == 'shareos.ui' and method == 'get') and sid != SID:
                body = {'jsonrpc': '2.0', 'id': req.get('id'), 'error': {'code': -32002, 'message': 'Access denied'}}
            else:
                r = call(obj, method, args)
                body = {'jsonrpc': '2.0', 'id': req.get('id'), 'result': [r] if isinstance(r, int) else [0, r]}
        else:
            body = {'jsonrpc': '2.0', 'id': req.get('id'), 'result': {}}
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8200
    print(f'http://127.0.0.1:{port}/  (root / shareos)')
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
