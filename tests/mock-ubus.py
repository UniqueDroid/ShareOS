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


def mock_folder(fid):
    """name of a folder the box creates, in the language of the box (i18n/<lang>.json "folders")"""
    en = {'shared': 'Shared', 'usb': 'USB copies'}
    try:
        with open(os.path.join(WWW, 'i18n', STATE['lang'] + '.json'), encoding='utf-8') as f:
            return json.load(f).get('folders', {}).get(fid) or en[fid]
    except (OSError, ValueError, KeyError):
        return en[fid]


STATE = {'setup_done': False, 'fan': {'preset': 'balanced', 'off_temp': 0, 'full_temp': 50, 'half_temp': 45}, 'led': {'status': 'heartbeat', 'power': 'on', 'disks': 'off'}, 'logo': True, 'lang': 'en', 'channel': 'beta', 'job': None, 'https': True, 'redirect': False, 'theme': 'dark', 'accent': 'blue', 'autostart_off': ['crond'],
         'users': {'jan': {'role': 'admin', 'fullname': 'Jan', 'groups': ['family'], 'home': 'data', 'quota': 0, 'web': True, 'pw': 'shareos'},
                   'anna': {'role': 'user', 'fullname': 'Anna', 'groups': ['family'], 'home': 'data', 'quota': 200000, 'web': True, 'cloud': True, 'files': True, 'pw': 'anna123'},
                   'tv': {'role': 'share', 'fullname': 'TV', 'groups': ['media'], 'home': '', 'quota': 0, 'web': True, 'pw': 'tv1234'}},
         'groups': {'family': 'Family', 'media': 'Media devices'},
         'shares': {'photos': {'volume': 'data', 'path': 'Photos', 'comment': 'Family photos', 'smb': True, 'nfs': False, 'guest': False, 'rw': ['jan'], 'ro': ['@family'], 'nfs_rw': False, 'nfs_hosts': []},
                    'media': {'volume': 'data', 'path': 'Media', 'comment': 'Films and music', 'smb': True, 'nfs': True, 'guest': True, 'rw': ['jan'], 'ro': ['@media'], 'nfs_rw': False, 'nfs_hosts': ['10.241.1.0/24']},
                    'vault': {'volume': 'data', 'path': 'Vault', 'comment': 'Contracts and IDs', 'smb': True, 'nfs': False, 'guest': False, 'rw': ['jan', 'anna'], 'ro': [], 'nfs_rw': False, 'nfs_hosts': [], 'vault': True, 'vault_ttl': 30}},
         'sessions': {},
         'widget': {'enabled': False, 'token': ''},
         'pl': {'url': 'http://10.241.1.20:8000', 'enabled': True, 'interval': 2, 'after': 'delete',
                'inboxes': {'u_jan': {'owner': 'jan', 'share': '', 'tags': [3], 'enabled': True},
                            'scanner': {'owner': '', 'share': 'photos', 'tags': [], 'enabled': True}}},
         'cloud': {'installed': True, 'remotes': {'-': [{'name': 'nextcloud', 'type': 'webdav'}, {'name': 'b2backup', 'type': 'b2'}],
                                                  'anna': [{'name': 'gdrive', 'type': 'drive'}]},
                   'jobs': {'photos_b2': {'owner': '', 'remote': 'b2backup', 'remote_path': 'nas/photos', 'local': 'share:photos', 'mode': 'upload', 'schedule': '0 3 * * *', 'bwlimit': '2M', 'enabled': True, 'state': 'ok', 'summary': '1.2 GiB / 1.2 GiB, 100%, 312 files'},
                            'nc_documents': {'owner': '', 'remote': 'nextcloud', 'remote_path': 'Documents', 'local': 'share:photos/Scans', 'mode': 'mirror', 'schedule': '30 * * * *', 'bwlimit': '', 'enabled': True, 'state': 'running', 'summary': '45 MiB / 120 MiB, 37%'},
                            'anna_phone': {'owner': 'anna', 'remote': 'gdrive', 'remote_path': 'Phone', 'local': 'home', 'mode': 'download', 'schedule': '0 */6 * * *', 'bwlimit': '', 'enabled': True, 'state': 'error', 'error': 'token expired – log in again', 'summary': ''}}},
         'net': {'proto': 'dhcp', 'ipaddr': '', 'netmask': '255.255.255.0', 'gateway': '', 'dns': []}, 'net_pending': None}

DISK = lambda n, model, serial: {
    'name': n, 'type': 'disk', 'size': 4000787030016, 'model': model, 'serial': serial, 'tran': 'sata', 'rm': False, 'rota': True,
    'children': [
        {'name': n + '1', 'type': 'part', 'size': 1073741824, 'fstype': 'swap', 'label': 'shareos-swap'},
        {'name': n + '2', 'type': 'part', 'size': 3999713288192, 'fstype': 'linux_raid_member', 'label': 'shareos:data',
         'children': [{'name': 'md0', 'type': 'raid1', 'fstype': 'ext4', 'label': 'data', 'mountpoint': '/mnt/data'}]}],
    'smart': SMART.get(n), 'standby': n == 'sdb'}

ATTR = lambda i, name, v, w, t, raw, wf='': {'id': i, 'name': name, 'value': v, 'worst': w, 'thresh': t, 'raw': raw, 'when_failed': wf, 'prefail': i in (1, 5)}
# SMART values as the rpcd plugin gives them (smart_parse): sda healthy, sdb with warnings
SMART = {
    'sda': {'time': int(time.time()) - 600, 'passed': True, 'temperature': 38, 'temperature_max': 47, 'power_on_hours': 18234, 'power_cycles': 61,
            'start_stops': 412, 'reallocated': 0, 'pending': 0, 'uncorrectable': 0, 'crc_errors': 0, 'error_count': 0, 'model': 'WDC WD40EFPX-68C6CN0',
            'serial': 'WD-WX12A3456789', 'firmware': '81.00A81', 'rpm': 5400, 'ssd': False, 'life_left': None, 'written': None,
            'test_running': None, 'test_minutes': {'short': 2, 'long': 461},
            'last_test': {'type': 'Short offline', 'status': 'Completed without error', 'passed': True, 'hours': 18100},
            'attributes': [ATTR(1, 'Raw_Read_Error_Rate', 200, 200, 51, '0'), ATTR(5, 'Reallocated_Sector_Ct', 200, 200, 140, '0'),
                           ATTR(9, 'Power_On_Hours', 76, 76, 0, '18234'), ATTR(194, 'Temperature_Celsius', 112, 103, 0, '38 (Min/Max 18/47)'),
                           ATTR(197, 'Current_Pending_Sector', 200, 200, 0, '0'), ATTR(199, 'UDMA_CRC_Error_Count', 200, 200, 0, '0')],
            'rating': 'good', 'reasons': []},
    'sdb': {'time': int(time.time()) - 600, 'passed': True, 'temperature': 41, 'temperature_max': 52, 'power_on_hours': 18190, 'power_cycles': 60,
            'start_stops': 409, 'reallocated': 8, 'pending': 2, 'uncorrectable': 0, 'crc_errors': 14, 'error_count': 3, 'model': 'WDC WD40EFPX-68C6CN0',
            'serial': 'WD-WX98B7654321', 'firmware': '81.00A81', 'rpm': 5400, 'ssd': False, 'life_left': None, 'written': None,
            'test_running': None, 'test_minutes': {'short': 2, 'long': 461}, 'last_test': None,
            'attributes': [ATTR(5, 'Reallocated_Sector_Ct', 199, 199, 140, '8'), ATTR(197, 'Current_Pending_Sector', 200, 200, 0, '2'),
                           ATTR(199, 'UDMA_CRC_Error_Count', 200, 200, 0, '14'), ATTR(200, 'Multi_Zone_Error_Rate', 100, 1, 51, '0', 'past')],
            'rating': 'warn', 'reasons': ['attr_past:Multi_Zone_Error_Rate', 'reallocated', 'pending', 'crc', 'errors']},
}


def info():
    up = time.time() - T0 + 5 * 86400
    return {
        'model': 'D-Link DNS-320L-rev-Ax NAS', 'hostname': 'skynet-nas', 'kernel': '6.18.58', 'boot': 'flash',
        'release': {'version': '0.1.0-beta.1', 'board': 'dns320l', 'fwname': 'DNS-320L-rev-Ax', 'stage': 'beta'},
        'board': {'id': 'dns320l', 'name': 'D-Link DNS-320L rev A', 'fwname': 'DNS-320L-rev-Ax', 'tested': True},
        'time': int(time.time()), 'uptime': up, 'load': [0.42, 0.38, 0.35],
        'cpu': {'total': int(up * 100), 'idle': int(up * 85)},
        'memory': {'memtotal': 253092 * 1024, 'memavailable': 160000 * 1024},
        'temperature': 41000, 'fan_pwm': 100, 'board_control': {'control': 'mcu', 'running': True, 'sensor': True},
        'network': {'eth0': {'ipv4': {'address': '10.241.1.106', 'prefix': 24}, 'gateway': '10.241.1.1', 'dns': ['10.243.1.100'],
                             'speed': 1000, 'mac': 'c4:a8:1d:81:f3:c2', 'rx_bytes': int(up * 2_000_000), 'tx_bytes': int(up * 150_000)}},
        'filesystems': [
            {'source': 'ubi0:rootfs_data', 'mount': '/overlay', 'size': 46 << 20, 'used': 3 << 20, 'avail': 43 << 20},
            {'source': '/dev/ubiblock0_0', 'mount': '/rom', 'size': 9 << 20, 'used': 9 << 20, 'avail': 0},
            {'source': 'tmpfs', 'mount': '/tmp', 'size': 123 << 20, 'used': 1 << 20, 'avail': 122 << 20}],
        'disks': [{'name': 'sda', 'model': 'WDC WD40EFPX', 'size': 4000787030016, 'removable': False, 'usb': False, 'standby': False, 'smart': 'good'},
                  {'name': 'sdb', 'model': 'WDC WD40EFPX', 'size': 4000787030016, 'removable': False, 'usb': False, 'standby': True, 'smart': 'good'}]}


def storage():
    pct = min(99.9, 12.4 + (time.time() - T0) / 60)
    return {
        'disks': [DISK('sda', 'WDC WD40EFPX-68C6CN0', 'WD-WX12A3456789'), DISK('sdb', 'WDC WD40EFPX-68C6CN0', 'WD-WX98B7654321')]
        + ([] if STATE.get('usb_gone') else [{'name': 'sdc', 'type': 'disk', 'size': 32 * 10**9, 'model': 'SanDisk Ultra', 'tran': 'usb', 'rm': True, 'usb': True,
              'children': [{'name': 'sdc1', 'type': 'part', 'fstype': 'exfat', 'label': 'STICK', 'mountpoint': '/mnt/usb-stick'}]}]),
        'usb': [] if STATE.get('usb_gone') else [{'dev': '/dev/sdc1', 'path': '/mnt/usb-stick', 'fs': 'exfat'}],
        'swaps': [{'device': '/dev/sda1', 'size': 1 << 30, 'used': 12 << 20}, {'device': '/dev/sdb1', 'size': 1 << 30, 'used': 11 << 20}],
        'apps': 'data',
        # MOCK_DEGRADED=1: sdb is new/empty, the mirror runs on sda only
        'arrays': {'md0': {'name': 'md0', 'state': 'active', 'level': 'raid1', 'members': ['sda2'], 'disks': 2, 'active': 1, 'health': 'U_'}
                   if os.environ.get('MOCK_DEGRADED') and not STATE.get('repair_t') else
                   {'name': 'md0', 'state': 'active', 'level': 'raid1', 'members': ['sdb2', 'sda2'], 'disks': 2, 'active': 2,
                    'health': 'UU', 'sync': {'action': 'recovery' if STATE.get('repair_t') else 'resync', 'percent': pct, 'finish': '412.5min'}}},
        'volumes': [{'name': 'data', 'uuid': '1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'fstype': 'ext4', 'layout': 'mirror', 'enabled': True,
                     'device': '/dev/md0', 'mountpoint': '/mnt/data', 'mounted': True, 'size': 3936 << 30, 'used': 1210 << 30, 'avail': 2726 << 30}],
        'spindown': 20, 'smart_schedule': STATE.get('smart_schedule', ''), 'job': STATE['job'], 'usb_copy': STATE.setdefault('usb_copy', {'enabled': False, 'volume': '', 'path': mock_folder('usb'), 'last': None})}


SERVICES = [('board', 'Board control', 'fan, temperature, buttons, MCU clock', True), ('crond', 'Scheduler', 'cron', False),
            ('dropbear', 'SSH / SFTP', 'Dropbear, port 22', False), ('ntpd', 'Time (NTP)', 'sets the clock, keeps the MCU clock in sync', False),
            ('rpcd', 'API (rpcd)', 'interface for this web UI', True), ('syslogd', 'System log', 'syslogd, in RAM', False),
            ('ubus', 'System bus (ubus)', 'messages between the services', True), ('uhttpd', 'Web interface', 'uhttpd, port 80', True)]

RELEASES = [{'tag': 'v0.2.0-beta.%d' % n, 'version': '0.2.0-beta.%d' % n, 'prerelease': True, 'date': '2026-11-0%dT10:00:00Z' % (n - 1), 'size': 8400000 + n * 4096,
             'url': 'https://github.com/UniqueDroid/ShareOS/releases', 'notes': '- Beta %d' % n} for n in (5, 4, 3, 2)] + [{'tag': 'v0.2.0-beta.1', 'version': '0.2.0-beta.1', 'prerelease': True, 'date': '2026-10-24T10:00:00Z', 'size': 8396800,
             'url': 'https://github.com/UniqueDroid/ShareOS/releases', 'notes': '- Shares (SMB, NFS)\n- Users and groups\n- Storage wizard'},
            {'tag': 'v0.1.0-beta.1', 'version': '0.1.0-beta.1', 'prerelease': True, 'date': '2026-10-17T16:00:00Z', 'size': 8392704,
             'url': 'https://github.com/UniqueDroid/ShareOS/releases', 'notes': 'First test version'}]


def accounts():
    u = STATE['users']
    users = [{'name': n, 'role': x['role'], 'fullname': x['fullname'], 'uid': 1000 + k, 'groups': x['groups'], 'home': x['home'],
              'quota': x['quota'], 'web': x['web'],
              'usage': [{'volume': 'data', 'used': (k + 1) * 37_000_000_000, 'limit': x['quota'] * 1000000}] if x['home'] else []}
             for k, (n, x) in enumerate(sorted(u.items()))]
    groups = [{'name': g, 'desc': d, 'members': [n for n, x in u.items() if g in x['groups']]} for g, d in sorted(STATE['groups'].items())]
    return {'users': users, 'groups': groups}


VAULT = {}   # share -> {user: until} (mock of /tmp/shareos-vault)


def vault_open(n):
    return [{'user': u, 'until': t} for u, t in sorted(VAULT.get(n, {}).items()) if t > time.time()]


def shares():
    return {'shares': [{'name': n, 'vault': False, 'vault_ttl': 15, **x, 'vault_open': vault_open(n) if x.get('vault') else [],
                        'fullpath': f"/mnt/{x['volume']}/{x['path']}", 'mounted': True} for n, x in sorted(STATE['shares'].items())],
            'workgroup': 'WORKGROUP', 'smb_enabled': True, 'smb_compat': False, 'nfs_enabled': True, 'smb_running': True, 'nfs_running': True}


def me(user):
    if user == 'root':
        return {'name': 'root', 'role': 'admin', 'fullname': 'Administrator', 'groups': [], 'quota': 0, 'home': None, 'usage': [], 'shares': [], 'host': 'skynet-nas',
                'fav': FAV.setdefault('root', {'apps': [], 'bar': True, 'text': True})}
    x = STATE['users'][user]
    mine = []
    for n, sh in sorted(STATE['shares'].items()):
        tags = [user] + ['@' + g for g in x['groups']]
        acc = 'rw' if any(t in sh['rw'] for t in tags) else 'ro' if any(t in sh['ro'] for t in tags) or sh['guest'] else None
        if acc:
            mine.append({'name': n, 'access': acc, 'comment': sh['comment'], 'volume': sh['volume'], 'vault': bool(sh.get('vault')),
                         'vault_ttl': sh.get('vault_ttl', 15), 'vault_until': VAULT.get(n, {}).get(user, 0) if sh.get('vault') else 0})
    return {'name': user, 'role': x['role'], 'fullname': x['fullname'], 'groups': x['groups'], 'quota': x['quota'],
            'home': {'volume': x['home'], 'path': f"/mnt/{x['home']}/home/{user}", 'smb': user} if x['home'] else None,
            'usage': [{'volume': 'data', 'used': 61_500_000_000, 'limit': x['quota'] * 1000000}], 'shares': mine, 'host': 'skynet-nas',
            'volumes': [{'name': 'data', 'size': 3_936_000_000_000, 'used': 1_412_000_000_000, 'avail': 2_524_000_000_000}],
            'cloud': x.get('cloud', False), 'paperless': bool(x['home']), 'files': x.get('files', False) and x['role'] == 'user',
            'ui': x.get('ui', {'theme': None, 'accent': None}),
            'apps': [{'id': a['id'], 'name': a['name'], 'entry': a['entry'], 'icon': a['icon'], 'description': a['description']}
                     for a in APPS['installed'].values() if a.get('type') != 'system' and ('*' in a['users'] or user in a['users'])],
            'apps_server': {'port': 8081, 'https_port': 8444, 'https': True},
            'fav': FAV.setdefault(user, {'apps': [], 'bar': True, 'text': True})}


FAV = {}


PL_LOG = [
    {'file': 'Invoice-utilities.pdf', 'task': 'a1b2', 'state': 'SUCCESS', 'message': 'Success. New document id 412 created'},
    {'file': 'Kontoauszug-09.pdf', 'task': 'c3d4', 'state': 'PENDING', 'message': 'uploaded'},
    {'file': 'scan_0042.tif', 'task': '', 'state': 'FAILURE', 'message': 'Not consuming scan_0042.tif: It is a duplicate of Steuer 2025 (#388)'}]


def pl_inbox(name):
    x = STATE['pl']['inboxes'][name]
    path = f"/mnt/data/home/{x['owner']}/Paperless" if x['owner'] else '/mnt/data/Photos'
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
    'data': {'': [('Photos', 'dir', 0), ('Media', 'dir', 0), ('home', 'dir', 0), ('Invoices 2026', 'dir', 0), ('notes.txt', 'file', 2310), ('backup-router.tar.gz', 'file', 48_200_000)],
              'Photos': [('2025', 'dir', 0), ('2026', 'dir', 0), ('Urlaub_Ostsee_001.jpg', 'file', 4_812_000), ('Urlaub_Ostsee_002.jpg', 'file', 5_120_400)],
              'Photos/2025': [], 'Photos/2026': [], 'Media': [('Films', 'dir', 0), ('Music', 'dir', 0)], 'Media/Films': [], 'Media/Music': [], 'home': [],
              'Invoices 2026': [('Stadtwerke-09.pdf', 'file', 182_000), ('Telekom-09.pdf', 'file', 95_400)]},
    'home': {'': [('Paperless', 'dir', 0), ('Documents', 'dir', 0), ('Phone photos', 'dir', 0), ('Lebenslauf.pdf', 'file', 310_220), ('Einkaufsliste.txt', 'file', 412)],
             'Paperless': [], 'Documents': [('Steuer 2025.pdf', 'file', 1_204_000)], 'Phone photos': [('IMG_2041.jpg', 'file', 3_400_000)]},
}
TICKETS = {}
TRASH_CONF = {'enabled': True, 'days': 30}
TRASH = {}   # root -> trash entries (file browser)
SHARED = []   # names given out by shareos.me share_ticket
DESK = {}     # desktop layouts per account (shareos.me desk_get/desk_set)


def mock_png(w=160, h=90):
    # a blue gradient as stand-in for photos (wallpaper of the desktop view)
    import struct
    import zlib
    rows = b''.join(b'\0' + b''.join(bytes((20 + x // 3, 40 + y, 90 + x // 2)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def fs_entries(root, path):
    out = []
    for i, (n, t, sz) in enumerate(FS[root].get(path, [])):
        out.append({'name': n, 'type': t, 'size': sz, 'mtime': T0F - 3600 * (i + 1) * 7})
    return sorted(out, key=lambda e: (e['type'] != 'dir', e['name'].lower()))


def files_call(user, method, args):
    roots = [{'name': 'data', 'home': False}] if user == 'root' or STATE['users'].get(user, {}).get('role') == 'admin' else [{'name': 'home', 'home': True}]
    if method == 'roots':
        return {'roots': roots, 'trash': dict(TRASH_CONF)}
    if method == 'trash_config':
        TRASH_CONF.update(enabled=bool(args.get('enabled')), days=int(args.get('days', 30)))
        return dict(TRASH_CONF)
    if method.startswith('trash_'):
        root = args.get('root')
        items = TRASH.setdefault(root, [])
        if method == 'trash_list':
            return {**TRASH_CONF, 'items': [{k: v for k, v in x.items() if k != 'entry'} for x in items], 'ro': False}
        sel = [x for x in items if not args.get('ids') or x['id'] in args['ids']]
        if method == 'trash_restore':
            for x in sel:
                FS[root].setdefault(x['path'], FS[root].get(x['path'], [])).append(x['entry'])
            TRASH[root] = [x for x in items if x not in sel]
            return {'ok': True, 'restored': [{'name': x['name'], 'path': x['path']} for x in sel]}
        if method == 'trash_empty':
            TRASH[root] = [x for x in items if x not in sel]
            return {'ok': True, 'removed': len(sel)}
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
        gone = [x for x in d if x[0] in args['names']]
        FS[root][path] = [x for x in d if x[0] not in args['names']]
        if TRASH_CONF['enabled'] and not args.get('permanent'):
            for x in gone:
                TRASH.setdefault(root, []).insert(0, {'id': f'{int(time.time())}-{os.urandom(4).hex()}', 'name': x[0], 'path': path, 'time': int(time.time()),
                                                      'user': user, 'type': x[1], 'size': x[2] if x[1] == 'file' else None, 'entry': x})
            return {'ok': True, 'trash': True}
        return {'ok': True}
    if method == 'move':
        dest, droot = (args.get('dest') or '').strip('/'), args.get('dest_root') or root
        if droot not in FS or dest not in FS[droot]:
            return {'error': 'not found'}
        moved = [x for x in d if x[0] in args['names']]
        if any(x[0] == m[0] for x in FS[droot][dest] for m in moved):
            return {'error': 'already exists: ' + moved[0][0]}
        FS[droot][dest] += moved
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
                                'installed': 0, 'users': [], 'jobs': [], 'window': None, 'opens': []},
                       'dnsfilter': {'id': 'dnsfilter', 'name': 'DNS filter', 'version': '0.107.80', 'publisher': 'UniqueDroid', 'description': {'de': 'DNS-Filter mit AdGuard Home (Modul)', 'en': 'DNS filter with AdGuard Home (module)'},
                                     'type': 'system', 'module': 'dnsfilter', 'commands': [], 'entry': 'index.html', 'icon': None, 'category': 'network', 'permissions': [], 'verified': True, 'source': 'store',
                                     'installed': 0, 'users': [], 'jobs': [], 'window': None, 'opens': []},
                       'cloud': {'id': 'cloud', 'name': 'Cloud', 'version': '1.0.0', 'publisher': 'UniqueDroid', 'description': {'de': 'Abgleich mit Cloud-Speichern (Modul)', 'en': 'Cloud sync (module)'},
                                 'type': 'system', 'module': 'cloud', 'commands': [], 'entry': 'index.html', 'icon': None, 'category': 'network', 'permissions': [], 'verified': True, 'source': 'store',
                                 'installed': 0, 'users': [], 'jobs': [], 'window': None, 'opens': []},
                       'desktop': {'id': 'desktop', 'name': 'Desktop view', 'version': '1.0.0', 'publisher': 'UniqueDroid', 'description': {'de': 'Die Weboberfläche als Desktop (Modul)', 'en': 'The web interface as a desktop (module)'},
                                   'type': 'system', 'module': 'desktop', 'commands': [], 'entry': 'index.html', 'icon': None, 'category': 'system', 'permissions': [], 'verified': True, 'source': 'store',
                                   'installed': 0, 'users': [], 'jobs': [], 'window': None, 'opens': []},
                       'paperless': {'id': 'paperless', 'name': 'Paperless', 'version': '1.0.0', 'publisher': 'UniqueDroid', 'description': {'de': 'Anbindung an Paperless-ngx (Modul)', 'en': 'Paperless-ngx connection (module)'},
                                     'type': 'system', 'module': 'paperless', 'commands': [], 'entry': 'index.html', 'icon': None, 'category': 'office', 'permissions': [], 'verified': True, 'source': 'store',
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
    {'id': 'mediathek', 'name': 'Mediathek', 'publisher': 'Example', 'category': 'media', 'type': 'webapp',
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
        if 'users' in args: APPS['installed'][args['id']]['users'] = args['users']
        if 'display' in args: APPS['installed'][args['id']]['display'] = args['display']
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
        APPS['installed']['my-app'] = {'id': 'my-app', 'name': 'My App', 'version': '0.1.0', 'publisher': 'Jan', 'description': 'Own test app',
                                          'type': 'webapp', 'entry': 'index.html', 'icon': None, 'category': 'tools', 'permissions': [],
                                          'verified': False, 'source': 'upload', 'installed': int(time.time()), 'users': []}
        return {'ok': True, 'id': 'my-app', 'version': '0.1.0', 'verified': False}
    return {'error': 'unknown'}


def call(obj, method, args):
    if obj == 'session' and method == 'login':
        user, pw = args.get('username'), args.get('password')
        if user == 'root' and pw == STATE.setdefault('root_pw', '' if os.environ.get('MOCK_UNCLAIMED') == '1' else 'shareos') and pw:
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
        if method == 'vault_unlock':
            if args.get('password') != STATE['users'].get(u, {}).get('pw'):
                return {'error': 'wrong password'}
            until = int(time.time()) + 60 * int(args.get('minutes') or 15)
            VAULT.setdefault(args['share'], {})[u] = until
            return {'ok': True, 'share': args['share'], 'until': until, **me(u)}
        if method == 'vault_lock':
            VAULT.get(args['share'], {}).pop(u, None)
            return {'ok': True, **me(u)}
        if method == 'share_ticket':
            sh = mock_folder('shared')
            d = FS['home'].setdefault(sh, [])
            if not any(n == sh for n, _, _ in FS['home']['']):
                FS['home'][''].insert(0, (sh, 'dir', 0))
            base, dot, ext = args['name'].rpartition('.')
            if not dot or not base:
                base, ext = args['name'], ''
            else:
                ext = '.' + ext
            n, i = args['name'], 2
            while any(x[0] == n for x in d):
                n = f'{base} ({i}){ext}'; i += 1
            t = os.urandom(16).hex()
            TICKETS[t] = ('home', sh, n, 'put')
            SHARED.append(n)
            return {'url': '/cgi-bin/files?t=' + t, 'name': n, 'folder': sh}
        if method in ('desk_get', 'desk_set'):
            if 'desktop' not in APPS['installed']:
                return {'error': 'not installed'}
            if method == 'desk_set':
                if not isinstance(args.get('desk'), dict) or len(json.dumps(args['desk'])) > 16384:
                    return {'error': 'invalid desk'}
                DESK[u] = args['desk']
                return {'ok': True}
            return {'desk': DESK.get(u, {})}
        if method == 'fav_set':
            f = FAV.setdefault(u, {'apps': [], 'bar': True, 'text': True})
            if 'apps' in args:
                f['apps'] = list(dict.fromkeys(args['apps']))
            for k in ('bar', 'text'):
                if k in args:
                    f[k] = bool(args[k])
            return f
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
            return {'allowed': True, 'installed': c['installed'], 'remotes': mine, 'jobs': cloud_jobs(u), 'shares': ['photos'], 'ok': True}
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
    if obj == 'shareos.status':
        return {'chips': [{'id': 'svc:vpn', 'label': 'VPN', 'detail': '10.8.0.6', 'state': 'ok', 'app': 'nettunnel'},
                          {'id': 'svc:torrent', 'label': 'TORRENT', 'detail': '↓ 2 ↑ 1', 'state': 'ok', 'app': 'transmission'},
                          {'id': 'app:webpad', 'label': '2 ungespeichert', 'state': 'warn', 'app': 'webpad', 'name': 'Webpad'}]}
    if obj == 'shareos.dlna':
        d = STATE.setdefault('dlna', {'installed': True, 'enabled': True, 'running': True, 'scanning': False, 'audio': 4218, 'video': 312, 'image': 15873,
                                      'db': '/mnt/data/.shareos/minidlna', 'clients': [{'type': 'Samsung Series [CDEFJ]', 'ip': '10.241.1.40'}, {'type': 'Generic DLNA 1.5', 'ip': '10.241.1.52'}],
                                      'name': '', 'hostname': 'skynet-nas', 'media': [{'type': 'A', 'share': 'music'}, {'type': 'V', 'share': 'filme'}],
                                      'shares': ['backup', 'filme', 'photos', 'music']})
        if method == 'set':
            d.update(enabled=args['enabled'], running=args['enabled'], name=args['name'],
                     media=[{k: v for k, v in m.items() if k != 'path' or v} for m in args['media']])
        d['share_dirs'] = [{'name': n, 'volume': x['volume'], 'path': x['path']} for n, x in sorted(STATE['shares'].items())]
        d['shares'] = [x['name'] for x in d['share_dirs']]
        if method == 'rescan':
            d['scanning'] = True
        return d
    if obj == 'shareos.snapshots':
        sn = STATE.setdefault('snap', {'photos': {
            'name': 'photos', 'source': 'share:photos', 'target': 'usb', 'every': 'day', 'time': '03:15', 'exclude': ['*.tmp'], 'enabled': True,
            'keep_last': 3, 'keep_daily': 7, 'keep_weekly': 4, 'keep_monthly': 6, 'running': False, 'mounted': True, 'path': '/mnt/usb/Snapshots/photos',
            'last': {'state': 'ok', 'started': int(T0) - 3700, 'ended': int(T0) - 3600, 'files': 18342, 'changed': 27, 'bytes': 81234567, 'removed': 1},
            'snapshots': [{'name': 'snap%d' % k, 'time': int(T0) - 3600 - k * 86400} for k in range(9)]}})
        vols = [{'name': 'data', 'fstype': 'ext4', 'links': True}, {'name': 'usb', 'fstype': 'ext4', 'links': True}, {'name': 'stick', 'fstype': 'vfat', 'links': False}]
        srcs = [{'id': 'share:photos', 'kind': 'share', 'name': 'photos', 'volume': 'data'}, {'id': 'share:music', 'kind': 'share', 'name': 'music', 'volume': 'data'},
                {'id': 'homes:data', 'kind': 'homes', 'name': 'data'}, {'id': 'volume:data', 'kind': 'volume', 'name': 'data'}]
        jobs = lambda: sorted(sn.values(), key=lambda j: j['name'])
        if method == 'status':
            return {'jobs': jobs(), 'volumes': vols, 'sources': srcs, 'rsync': True}
        if method == 'job_set':
            j = sn.get(args['name'], {'running': False, 'mounted': True, 'last': None, 'snapshots': []})
            j.update({k: args[k] for k in ('name', 'source', 'target', 'every', 'time', 'exclude', 'enabled', 'keep_last', 'keep_daily', 'keep_weekly', 'keep_monthly')})
            sn[args['name']] = j
            return {'ok': True, 'jobs': jobs()}
        if method == 'job_del':
            sn.pop(args['name'], None)
            return {'ok': True, 'jobs': jobs()}
        if method == 'run':
            sn[args['name']]['running'] = True
            return {'started': True}
        if method == 'stop':
            sn[args['name']]['running'] = False
            return {'ok': True}
        if method == 'remove':
            j = sn[args['name']]; j['snapshots'] = [x for x in j['snapshots'] if x['name'] != args['snapshot']]
            return {'ok': True, 'jobs': jobs()}
        if method == 'log':
            return {'log': '=== 2026-10-21_031500 share:photos, rsync 0\nNumber of files: 18,342\nNumber of regular files transferred: 27\n'}
    if obj == 'shareos.cloud':
        c = STATE['cloud']
        if method == 'status':
            return {'installed': c['installed'], 'version': 'v1.75.2' if c['installed'] else None, 'apps': 'data', 'installing': False, 'install_error': None}
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
            return {'lines': ['2026/10/18 03:00:01 INFO  : Starting upload to b2backup:nas/photos', '2026/10/18 03:01:01 INFO  : 312 / 312 files, 1.2 GiB, 100%', '2026/10/18 03:01:05 INFO  : done']}
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
        summary = {'version': '0.1.0-beta.2', 'host': 'skynet-nas', 'created': int(time.time()) - 86400, 'users': sorted(STATE['users']),
                   'groups': sorted(STATE['groups']), 'shares': sorted(STATE['shares']), 'services': ['paperless', 'cloud', 'zabbix'],
                   'apps': [{'id': 'webpad', 'name': 'Webpad', 'version': '1.2.0'}, {'id': 'transmission', 'name': 'Transmission', 'version': '1.3.1'}],
                   'configs': ['shareos', 'storage', 'network', 'accounts', 'shares'], 'certificate': True, 'cert_source': 'ca',
                   'ca': True, 'ca_certs': ['printer', 'proxmox']}
        if method == 'offer':
            return {'certificate': True, 'source': 'ca', 'ca': True, 'ca_certs': 2}
        if method == 'export':
            enc = bool(args.get('password'))
            if not enc and (args.get('certificate') or args.get('ca')):
                return {'error': 'certificate and CA keys need an encrypted backup'}
            s = dict(summary, created=int(time.time()), certificate=bool(args.get('certificate')), ca=bool(args.get('ca')),
                     ca_certs=summary['ca_certs'] if args.get('ca') else [])
            return {'filename': 'shareos-skynet-nas-20261017-2330.json', 'encrypted': enc,
                    'content': json.dumps({'shareos_backup': 2, 'encrypted': True, 'host': 'skynet-nas', 'created': s['created'],
                                           'version': s['version'], 'data': 'U09TMQ=='} if enc else {'shareos_backup': 2, **s}), **s}
        try:
            d = json.loads(args.get('content') or '')
        except ValueError:
            return {'error': 'not a ShareOS settings backup'}
        if d.get('encrypted') and not args.get('password'):
            return {'error': 'password required', 'encrypted': True}
        if args.get('apply'):
            STATE['recovery'] = summary
            return {'ok': True, 'reboot': True, 'recovery': True, 'essentials': ['root', 'network', 'hostname', 'timezone', 'storage', 'web']}
        return {'ok': True, 'preview': True, **summary}
    if obj == 'shareos.recovery':
        rec = STATE.get('recovery')
        if method == 'status':
            base = {'pending_apps': STATE.get('rec_apps', []), 'apps_running': False}
            return {'active': True, **rec, **base} if rec else {'active': False, **base}
        if method == 'apply':
            if not rec:
                return {'error': 'not in recovery mode'}
            STATE['recovery'] = None
            STATE['rec_apps'] = [a for a in args.get('apps', []) if a != 'webpad']
            return {'ok': True, 'done': ['users'], 'apps': args.get('apps', []), 'reboot': True}
        if method == 'discard':
            STATE['recovery'] = None
            return {'ok': True}
        if method == 'apps_install':
            STATE['rec_apps'] = []
            return {'started': True}
        if method == 'apps_dismiss':
            STATE['rec_apps'] = []
            return {'ok': True}
    if obj == 'shareos.shares':
        if method == 'set':
            STATE['shares'][args['name']] = {k: v for k, v in args.items() if k != 'name'}
        if method == 'del':
            STATE['shares'].pop(args['name'], None)
        if method == 'vault_lock':
            VAULT.pop(args['name'], None)
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
                if k == 'apps':
                    STATE.setdefault('areas', {'apps': True})[k] = bool(v)
        # modules (Paperless): on while the system app is installed
        return {'lang': STATE['lang'], 'logo': STATE['logo'], 'theme': STATE['theme'], 'accent': STATE['accent'],
                'areas': {**STATE.get('areas', {'apps': True}), **{m: m in APPS['installed'] for m in ('paperless', 'cloud', 'dnsfilter', 'desktop')}}, 'default_password': True}
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
        # MOCK_UNCLAIMED=1: a new box, root locked; the "USB button" counts as
        # pressed from the third state query on
        cl = STATE.setdefault('claim', {'unclaimed': os.environ.get('MOCK_UNCLAIMED') == '1', 'polls': 0})
        if method == 'claim_state':
            cl['polls'] += 1
            return {'unclaimed': cl['unclaimed'], 'window': cl['unclaimed'] and cl['polls'] >= 3, 'seconds': 120}
        if method == 'claim':
            if not cl['unclaimed']:
                return {'error': 'already claimed'}
            if cl['polls'] < 3:
                return {'error': 'press the USB button first'}
            if len(args.get('password', '')) < 8:
                return {'error': 'password too short (min. 8)'}
            cl['unclaimed'] = False
            STATE['root_pw'] = args['password']
            return {'ok': True}
        if method == 'status':
            return {'done': STATE['setup_done'], 'default_password': STATE.get('root_pw', 'shareos') == 'shareos', 'hostname': 'shareos', 'timezone': 'Europe/Berlin', 'lang': STATE['lang'], 'channel': 'stable'}
        if method == 'zones':
            return {'zones': ['Europe/Berlin', 'Europe/London', 'Europe/Vienna', 'Europe/Zurich', 'America/New_York', 'UTC'], 'current': 'Europe/Berlin'}
        if method == 'altf':
            return {'found': True, 'file': 'set_2026-07-23_15:20:02.tgz', 'date': '2026-07-23 15:20:02', 'hostname': 'skynet-nas',
                    'timezone': 'Europe/Berlin', 'users': ['jan:Jan', 'media:Media'], 'shares': ['Photos', 'Music', 'Backup'], 'nfs': ['/mnt/md0/proxmox'], 'fan_lo_temp': '45'}
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
                'presets': {'quiet': {'off_temp': 40, 'full_temp': 55, 'half_temp': 50}, 'balanced': {'off_temp': 0, 'full_temp': 50, 'half_temp': 45},
                            'cool': {'off_temp': 0, 'full_temp': 45, 'half_temp': 42}},
                'board_control': {'control': 'mcu', 'running': True, 'sensor': True}}
    if obj == 'shareos.printer':
        pr = STATE.setdefault('printer', {'installed': True, 'enabled': False, 'mode': 'auto', 'ippusb': False, 'hostname': 'skynet-nas', 'printers': [
            {'id': '03f0:5c11', 'ipp': True, 'lp': 'lp0', 'via': 'ipp-usb', 'port': None, 'maker': 'HP', 'model': 'Smart Tank 5100 series'},
            {'id': '04a9:2676', 'ipp': False, 'lp': 'lp1', 'via': 'p910nd', 'port': None, 'maker': 'Canon', 'model': 'LBP2900'}]})
        if method == 'set':
            pr['enabled'] = bool(args.get('enabled')); pr['mode'] = args.get('mode') or pr['mode']
            for x in pr['printers']:
                x['via'] = 'ipp-usb' if x['ipp'] and pr['mode'] == 'auto' else 'p910nd'
                x['port'] = (60000 if x['via'] == 'ipp-usb' else 9100 + int(x['lp'][2:])) if pr['enabled'] else None
        if method == 'test':
            return {'ok': True}
        return pr
    if obj == 'shareos.dnsfilter':
        d = STATE.setdefault('dnsfilter', {'installed': True, 'enabled': False, 'running': False, 'ready': False, 'starting': False, 'web_port': 8053, 'https_port': 8054, 'https': True, 'https_forced': False, 'memlimit': 32,
            'local': {'ip': '10.241.1.106', 'names': ['skynet-nas', 'skynet-nas.skynet.lan'], 'domains': ['skynet.lan']},
            'drive': True, 'version': 'v0.107.80', 'protection': True, 'rss_mb': None, 'rules': 0, 'lists': 0, 'queries': 0, 'blocked': 0,
            'upstream': ['https://dns10.quad9.net/dns-query'], 'estimate_mb': 25, 'warn': False,
            'filters': [{'name': 'AdGuard DNS filter', 'url': 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt', 'enabled': True, 'rules': 188364, 'updated': None},
                        {'name': 'AdAway Default Blocklist', 'url': 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_2.txt', 'enabled': False, 'rules': 6540, 'updated': None}]})
        fl = d['filters']
        if d.get('_start'):
            t = time.time() - d['_start']
            d.update({'running': t > 2, 'starting': 2 < t <= 8, 'dns': t > 8, 'ready': t > 8})
            if t > 8:
                d.pop('_start'); d.update({'rss_mb': 41.5, 'queries': 12873, 'blocked': 2214}); d['rules'] = sum(f['rules'] for f in fl if f['enabled']); d['lists'] = len(fl)
        rw = STATE.setdefault('dnsfilter_rw', [{'domain': 'printer.skynet.lan', 'answer': '10.241.1.50'}])
        if method == 'rewrites':
            return {'rewrites': rw}
        if method == 'rewrite_add':
            if not args.get('domain') or not args.get('answer'):
                return {'error': 'name: a host name such as printer.home.lan (*.name for all below it)'}
            rw.append({'domain': args['domain'].lower(), 'answer': args['answer']}); return {'rewrites': rw}
        if method == 'rewrite_remove':
            rw[:] = [w for w in rw if not (w['domain'] == args.get('domain') and w['answer'] == args.get('answer'))]; return {'rewrites': rw}
        def upd():
            d['rules'] = sum(f['rules'] for f in fl if f['enabled']); d['lists'] = len(fl)
            d['estimate_mb'] = 25 + d['rules'] // 10000; d['warn'] = d['rules'] > 300000
        if method == 'set':
            if args.get('enabled') is True and not d['running']:
                # starts in the background: running after 2 s, ready (DNS) after 8 s
                d.update({'enabled': True, 'running': False, 'ready': False, 'starting': False, 'dns': False}); d['_start'] = time.time(); return {'ok': True}
            if args.get('enabled') is False: d.update({'enabled': False, 'running': False, 'ready': False, 'rss_mb': None})
            for k in ('web_port', 'https_port', 'upstream', 'protection'):
                if k in args: d[k] = args[k]
        if method == 'filter_add':
            fl.append({'name': args.get('name') or args['url'], 'url': args['url'], 'enabled': True, 'rules': 250000, 'updated': None})
        if method == 'filter_remove':
            fl[:] = [f for f in fl if f['url'] != args.get('url')]
        if method == 'filter_enable':
            for f in fl:
                if f['url'] == args.get('url'): f['enabled'] = bool(args.get('enabled'))
        if method == 'password':
            return {'user': 'admin', 'password': 'Kq3vT9mZ2pLx8RbN4wYe', 'port': d['web_port']}
        upd()
        if method in ('filters', 'filter_add', 'filter_remove', 'filter_enable', 'refresh'):
            return {'filters': fl, 'rules': d['rules'], 'filtering': True}
        return {k: v for k, v in d.items() if k != 'filters'}
    if obj == 'shareos.tremote':
        d = STATE.setdefault('tremote', {'enabled': False, 'port': 9091, 'https_port': 9092, 'https': True, 'installed': True, 'running': False,
            'accounts': ['anna', 'root'], 'host': 'shareos.lan', 'path': '/transmission/rpc'})
        if method == 'set':
            if args.get('port') == args.get('https_port') and args.get('port'):
                return {'error': 'HTTP and HTTPS need two different ports'}
            d.update({'enabled': bool(args.get('enabled')), 'port': args.get('port') or d['port'], 'https_port': args.get('https_port') or d['https_port']})
            d['running'] = d['enabled']
        if method == 'revoke':
            d['accounts'] = [a for a in d['accounts'] if a != args.get('user')]
        return d
    if obj == 'shareos.ups':
        u = STATE.setdefault('ups', {'installed': True, 'enabled': False, 'running': False, 'detected': '051d:0002', 'driver': 'usbhid-ups',
            'status': None, 'charge': None, 'runtime': None, 'load': None, 'voltage': None, 'mfr': None, 'model': None, 'charge_low': None, 'battery_date': None,
            'events': [], 'settings': {'driver': 'auto', 'shutdown': 'low', 'percent': 30, 'minutes': 5, 'killpower': True, 'server': False, 'password_set': False}})
        if method == 'set':
            u['enabled'] = bool(args.get('enabled'))
            for k in ('driver', 'shutdown', 'percent', 'minutes', 'killpower', 'server'):
                if args.get(k) not in (None, '', 0): u['settings'][k] = args[k]
            u['settings']['killpower'] = bool(args.get('killpower')); u['settings']['server'] = bool(args.get('server'))
            if args.get('password'): u['settings']['password_set'] = True
            if u['enabled']:
                u.update({'running': True, 'status': 'OB DISCHRG', 'charge': 87, 'runtime': 1260, 'load': 18, 'voltage': 0, 'mfr': 'APC', 'model': 'Back-UPS ES 700G', 'battery_date': '2024/03/11',
                          'events': [{'time': 1793530000, 'type': 'ONBATT'}, {'time': 1793520000, 'type': 'ONLINE'}, {'time': 1793519000, 'type': 'ONBATT'}]})
            else:
                u.update({'running': False, 'status': None})
        return u
    if obj == 'shareos.web' and method.startswith(('ddns', 'ca_', 'acme')):
        d = STATE.setdefault('ddns', {'enabled': False, 'provider': '', 'host': '', 'user': '', 'url': '', 'token_set': False, 'ipv4': True, 'ipv6': False, 'last': None})
        ca = STATE.setdefault('ca', {'exists': False, 'certs': [], 'web': False})
        if method == 'ddns_get':
            return d
        if method == 'ddns_set':
            d.update({k: v for k, v in args.items() if k != 'token'})
            d['token_set'] = d['token_set'] or bool(args.get('token'))
            d['last'] = {'provider': d['provider'], 'host': d['host'], 'ip4': '203.0.113.7', 'ip6': None, 'checked': 1793530000, 'sent': 1793530000, 'ok': True, 'error': None} if d['enabled'] else None
            return {'ok': True, 'pending': d['enabled']}
        if method == 'ddns_update':
            return {'ok': True, 'pending': True}
        if method == 'ca_get':
            return ca
        if method == 'ca_init':
            ca.update({'exists': True, 'subject': 'CN=ShareOS CA skynet-nas, O=ShareOS', 'until': '2036-11-01 12:00:00', 'fingerprint': ':'.join(['A1'] * 32), 'count': 0})
            return {'ok': True}
        if method == 'ca_issue':
            ca['certs'].append({'name': args['name'], 'hosts': args['hosts'], 'until': '2029-02-04 12:00:00', 'expires': 1864816233})
            return {'ok': True}
        if method == 'ca_delete':
            ca['certs'] = [c for c in ca['certs'] if c['name'] != args['name']]
            return {'ok': True}
        if method == 'ca_pem':
            return {'pem': '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'}
        if method == 'ca_web':
            ca['web'] = True
            return {'ok': True}
        if method == 'acme_get':
            return STATE.setdefault('acme', {'active': False, 'name': '', 'until': '', 'staging': False, 'email': '', 'error': '', 'running': False})
        if method == 'acme_issue':
            STATE['acme'] = {'active': True, 'name': d['host'], 'until': '2027-01-30 10:00:00', 'staging': bool(args.get('staging')), 'email': args.get('email', ''), 'error': '', 'running': False}
            return {'ok': True}
        if method == 'acme_off':
            STATE['acme']['active'] = False
            return {'ok': True}
    if obj == 'shareos.web':
        if method == 'set':
            STATE.update({k: v for k, v in args.items() if k in ('https', 'redirect')})
            if 'host' in args:
                STATE['web_host'] = args['host']
        return {'https': STATE['https'], 'redirect': STATE['redirect'], 'host': STATE.get('web_host', ''), 'cert_host': 'skynet-nas.skynet.lan', 'cert': {
            'subject': 'CN=skynet-nas, O=ShareOS', 'issuer': 'CN=skynet-nas, O=ShareOS', 'from': '2026-10-17 00:00:00',
            'until': '2036-10-17 23:59:59', 'san': ['dNSName:skynet-nas', 'dNSName:skynet-nas.local', 'iPAddress:10.241.1.106'], 'selfsigned': True}}
    if obj == 'shareos.system':
        if method == 'power_schedule':
            return STATE.setdefault('power', {'supported': True, 'enabled': False, 'days': {d: {'on': '', 'off': ''} for d in ('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')}, 'next_on': None, 'next_off': None, 'alarm': 'Wakeup alarm disabled'})
        if method == 'power_schedule_set':
            p = STATE['power']
            p['enabled'] = bool(args.get('enabled')); p['days'].update(args.get('days') or {})
            p['next_on'] = '2026-10-31 09:15' if p['enabled'] else None; p['next_off'] = '2026-10-30 22:00' if p['enabled'] else None
            return p
        if method == 'terminal':
            return {'port': 7681, 'path': '0123456789abcdef0123456789abcdef'}
        if method == 'info':
            return info()
        if method == 'bootlogs':
            return {'logs': [{'name': '20261027-071900', 'size': 14210}, {'name': '20261026-220500', 'size': 13980}]}
        if method == 'log' and str(args.get('source', '')).startswith('boot:'):
            return {'lines': ['ShareOS start snapshot ' + args['source'][5:], '', '===== addresses', '2: eth0: <BROADCAST,MULTICAST,UP> mtu 1500', '    inet 192.168.0.32/24 scope global eth0:fb']}
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
        if method == 'smart_test':
            sm = SMART.get(args.get('disk'))
            if not sm:
                return {'error': 'unknown disk'}
            sm['test_running'] = None if args.get('type') == 'abort' else {'remaining': 90, 'text': 'in progress'}
            return sm
        if method == 'smart_schedule':
            STATE['smart_schedule'] = args.get('mode', '')
            return {'ok': True, 'mode': STATE['smart_schedule']}
        if method == 'smart':
            sm = SMART.get(args.get('disk'))
            if sm and sm['test_running']:
                sm['test_running']['remaining'] = max(0, sm['test_running']['remaining'] - 10)
            return sm or {'error': 'no SMART data'}
        if method == 'usb_copy_config':
            u = STATE.setdefault('usb_copy', {'enabled': False, 'volume': '', 'path': mock_folder('usb'), 'last': None})
            u.update(enabled=bool(args.get('enabled')), volume=args.get('volume', ''), path=args.get('path') or mock_folder('usb'))
            return u
        if method == 'usb_copy':
            u = STATE.setdefault('usb_copy', {'enabled': False, 'volume': '', 'path': mock_folder('usb'), 'last': None})
            if not u['volume']:
                return {'error': 'no target set'}
            u['last'] = {'state': 'done', 'time': int(time.time()), 'files': 128, 'bytes': 734_003_200, 'dest': f"/mnt/{u['volume']}/{u['path']}/2026-10-25_1130-stick"}
            return {'started': True}
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
            data = mock_png() if name.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')) else (f'ShareOS mock file {name}\n').encode()
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
            public = (obj == 'shareos.ui' and method == 'get') or (obj == 'shareos.setup' and method in ('claim_state', 'claim'))
            if obj not in ('session',) and not public and sid != SID:
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
