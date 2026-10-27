#!/usr/bin/env python3
"""
Writes the Zabbix template for the ShareOS items of the system app
"zabbix-agent" (shareos.box, shareos.disk, shareos.raid – see
src/shareos-core/usr/sbin/shareos-zabbix):

    tools/zabbix/make-template.py > docs/zabbix/shareos_template.yaml

The UUIDs (v4 form, as Zabbix wants) are derived from the names, so the file stays the same between runs
and a newer version updates an imported template instead of adding a second
one. Format: Zabbix 7.0 export (YAML).
"""
import sys, uuid
import yaml

T = 'ShareOS by Zabbix agent active'
NS = uuid.UUID('0d3f8a62-5b8e-4c51-9a35-5e2c0a6f7d11')


def uid(*parts):
    # Zabbix accepts UUIDv4 only: the hash of the name with the v4 bits set
    return uuid.UUID(bytes=uuid.uuid5(NS, '|'.join(parts)).bytes, version=4).hex


def ref(key):
    return '/%s/%s' % (T, key)


def item(key, name, value_type='UNSIGNED', delay='5m', units=None, tags=(), triggers=(), valuemap=None,
         description=None, history=None, proto=False):
    i = {'uuid': uid('item', key), 'name': name, 'type': 'ZABBIX_ACTIVE', 'key': key, 'delay': delay}
    if history:
        i['history'] = history
    if value_type != 'UNSIGNED':
        i['value_type'] = value_type
    if value_type in ('CHAR', 'TEXT'):
        i['trends'] = '0'
    if units:
        i['units'] = units
    if description:
        i['description'] = description
    if valuemap:
        i['valuemap'] = {'name': valuemap}
    if tags:
        i['tags'] = [{'tag': k, 'value': v} for k, v in tags]
    if triggers:
        i['trigger_prototypes' if proto else 'triggers'] = list(triggers)
    return i


def trigger(expr, name, priority, description=None, manual_close=False):
    t = {'uuid': uid('trigger', expr), 'expression': expr, 'name': name, 'priority': priority}
    if manual_close:
        t['manual_close'] = 'YES'
    if description:
        t['description'] = description
    return t


box = [
    item('shareos.box[temperature]', 'Box: temperature', 'FLOAT', '1m', '°C', [('component', 'environment')], [
        trigger('min(%s,5m)>={$SHAREOS.BOX.TEMP.WARN}' % ref('shareos.box[temperature]'),
                'ShareOS: box is hot (over {$SHAREOS.BOX.TEMP.WARN} °C for 5 minutes)', 'WARNING',
                'The temperature of the box (board sensor). Check the fan and the place of the box.'),
    ]),
    item('shareos.box[fan_rpm]', 'Box: fan speed', 'UNSIGNED', '1m', 'rpm', [('component', 'environment')]),
    item('shareos.box[fan_pwm]', 'Box: fan level (PWM 0-255)', 'UNSIGNED', '1m', None, [('component', 'environment')]),
    item('shareos.box[version]', 'ShareOS version', 'CHAR', '1h', None, [('component', 'system')], [
        trigger('change(%s)=1' % ref('shareos.box[version]'),
                'ShareOS: firmware updated to {ITEM.LASTVALUE1}', 'INFO', manual_close=True),
    ]),
    item('shareos.box[board]', 'Box model', 'CHAR', '1d', None, [('component', 'system')]),
]


def dk(k):
    return 'shareos.disk[{#DISK},%s]' % k


DT = [('component', 'storage'), ('disk', '{#DISK}')]
disk_protos = [
    item(dk('rating'), 'Disk {#DISK}: health rating', valuemap='ShareOS disk rating', tags=DT, proto=True,
         description='The rating of Storage → Health: 0 good, 1 warning, 2 critical (from SMART values, self-tests, temperature, wear).',
         triggers=[
             trigger('last(%s)=2' % ref(dk('rating')), 'Disk {#DISK} ({#MODEL}): critical – replace soon', 'HIGH',
                     'See Storage → Health on the box for the reasons.'),
             trigger('last(%s)=1' % ref(dk('rating')), 'Disk {#DISK} ({#MODEL}): SMART warning', 'WARNING',
                     'See Storage → Health on the box for the reasons.'),
         ]),
    item(dk('passed'), 'Disk {#DISK}: SMART overall health passed', tags=DT, proto=True, triggers=[
        trigger('last(%s)=0' % ref(dk('passed')), 'Disk {#DISK} ({#MODEL}): SMART health check failed', 'HIGH'),
    ]),
    item(dk('temperature'), 'Disk {#DISK}: temperature', 'FLOAT', units='°C', tags=DT, proto=True, triggers=[
        trigger('last(%s)>={$SHAREOS.DISK.TEMP.WARN}' % ref(dk('temperature')),
                'Disk {#DISK} ({#MODEL}): hot (over {$SHAREOS.DISK.TEMP.WARN} °C)', 'WARNING'),
    ]),
    item(dk('temperature_max'), 'Disk {#DISK}: highest temperature (lifetime)', 'FLOAT', '1h', '°C', DT, proto=True),
    item(dk('reallocated'), 'Disk {#DISK}: reallocated sectors', tags=DT, proto=True, triggers=[
        trigger('change(%s)>0' % ref(dk('reallocated')), 'Disk {#DISK} ({#MODEL}): new reallocated sectors', 'WARNING',
                manual_close=True),
    ]),
    item(dk('pending'), 'Disk {#DISK}: pending sectors', tags=DT, proto=True, triggers=[
        trigger('last(%s)>0' % ref(dk('pending')), 'Disk {#DISK} ({#MODEL}): pending sectors ({ITEM.LASTVALUE1})', 'WARNING'),
    ]),
    item(dk('uncorrectable'), 'Disk {#DISK}: uncorrectable sectors', tags=DT, proto=True),
    item(dk('crc_errors'), 'Disk {#DISK}: interface CRC errors', tags=DT, proto=True,
         description='Usually the cable or the connector, not the disk.', triggers=[
             trigger('change(%s)>0' % ref(dk('crc_errors')), 'Disk {#DISK} ({#MODEL}): new CRC errors (connector?)', 'INFO',
                     manual_close=True),
         ]),
    item(dk('error_count'), 'Disk {#DISK}: entries in the SMART error log', tags=DT, proto=True),
    item(dk('life_left'), 'Disk {#DISK}: life left (SSD)', units='%', tags=DT, proto=True,
         description='Only for SSDs – unsupported for hard disks.', triggers=[
             trigger('last(%s)<={$SHAREOS.SSD.LIFE.WARN}' % ref(dk('life_left')),
                     'Disk {#DISK} ({#MODEL}): SSD worn ({ITEM.LASTVALUE1} left)', 'WARNING'),
         ]),
    item(dk('power_on_hours'), 'Disk {#DISK}: running time', delay='1h', units='h', tags=DT, proto=True),
    item(dk('power_cycles'), 'Disk {#DISK}: power cycles', delay='1h', tags=DT, proto=True),
    item(dk('standby'), 'Disk {#DISK}: asleep', valuemap='ShareOS standby', tags=DT, proto=True,
         description='1: the disk was asleep at the last read – the values are the last ones before.'),
    item(dk('age'), 'Disk {#DISK}: age of the values', units='s', tags=DT, proto=True),
    item(dk('model'), 'Disk {#DISK}: model', 'CHAR', '1d', tags=DT, proto=True),
    item(dk('serial'), 'Disk {#DISK}: serial number', 'CHAR', '1d', tags=DT, proto=True, triggers=[
        trigger('change(%s)=1' % ref(dk('serial')), 'Disk {#DISK}: replaced (new serial number {ITEM.LASTVALUE1})', 'INFO',
                manual_close=True),
    ]),
]


def rk(k):
    return 'shareos.raid[{#RAID},%s]' % k


RT = [('component', 'storage'), ('raid', '{#RAID}')]
raid_protos = [
    item(rk('active'), 'RAID {#RAID}: active', delay='1m', tags=RT, proto=True, triggers=[
        trigger('last(%s)=0' % ref(rk('active')), 'RAID {#RAID}: not active', 'HIGH'),
    ]),
    item(rk('missing'), 'RAID {#RAID}: missing disks', delay='1m', tags=RT, proto=True, triggers=[
        trigger('last(%s)>0' % ref(rk('missing')), 'RAID {#RAID} ({#LEVEL}): degraded, {ITEM.LASTVALUE1} disk(s) missing', 'HIGH'),
    ]),
    item(rk('disks'), 'RAID {#RAID}: disks', delay='1h', tags=RT, proto=True),
    item(rk('working'), 'RAID {#RAID}: working disks', delay='1m', tags=RT, proto=True),
    item(rk('health'), 'RAID {#RAID}: state of the members', 'CHAR', '1m', tags=RT, proto=True,
         description='One letter per member: U up, _ missing.'),
    item(rk('syncing'), 'RAID {#RAID}: rebuild or check running', delay='1m', tags=RT, proto=True),
    item(rk('sync_percent'), 'RAID {#RAID}: rebuild/check progress', 'FLOAT', '1m', '%', RT, proto=True),
    item(rk('sync_action'), 'RAID {#RAID}: rebuild/check action', 'CHAR', '1m', tags=RT, proto=True),
    item(rk('level'), 'RAID {#RAID}: level', 'CHAR', '1d', tags=RT, proto=True),
]

tpl = {
    'uuid': uid('template', T),
    'template': T,
    'name': T,
    'description': ('Disks, RAID and temperature of a ShareOS NAS (D-Link DNS-320L and family) through the '
                    'classic Zabbix agent in active mode (system app "zabbix-agent"). Link it together with '
                    '"Linux by Zabbix agent active" for CPU, memory, network and file systems.\n\n'
                    'Generated by tools/zabbix/make-template.py in the ShareOS repository.'),
    'vendor': {'name': 'ShareOS', 'version': '7.0-1'},
    'groups': [{'name': 'Templates/Storage devices'}],
    'items': box,
    'discovery_rules': [
        {'uuid': uid('lld', 'disk'), 'name': 'Disks in the bays', 'type': 'ZABBIX_ACTIVE',
         'key': 'shareos.disk.discovery', 'delay': '1h',
         'description': 'The SATA disks of the box (no USB drives), with model and serial number.',
         'item_prototypes': disk_protos},
        {'uuid': uid('lld', 'raid'), 'name': 'RAID arrays', 'type': 'ZABBIX_ACTIVE',
         'key': 'shareos.raid.discovery', 'delay': '1h',
         'item_prototypes': raid_protos},
    ],
    'tags': [{'tag': 'class', 'value': 'hardware'}, {'tag': 'target', 'value': 'shareos'}],
    'macros': [
        {'macro': '{$SHAREOS.BOX.TEMP.WARN}', 'value': '55', 'description': 'Box temperature (°C) for a warning'},
        {'macro': '{$SHAREOS.DISK.TEMP.WARN}', 'value': '55', 'description': 'Disk temperature (°C) for a warning'},
        {'macro': '{$SHAREOS.SSD.LIFE.WARN}', 'value': '20', 'description': 'SSD life left (%) for a warning'},
    ],
    'valuemaps': [
        {'uuid': uid('valuemap', 'rating'), 'name': 'ShareOS disk rating',
         'mappings': [{'value': '0', 'newvalue': 'good'}, {'value': '1', 'newvalue': 'warning'},
                      {'value': '2', 'newvalue': 'critical'}]},
        {'uuid': uid('valuemap', 'standby'), 'name': 'ShareOS standby',
         'mappings': [{'value': '0', 'newvalue': 'active'}, {'value': '1', 'newvalue': 'asleep'}]},
    ],
}

doc = {'zabbix_export': {
    'version': '7.0',
    'template_groups': [{'uuid': uid('group', 'Templates/Storage devices'), 'name': 'Templates/Storage devices'}],
    'templates': [tpl],
}}


class Dumper(yaml.SafeDumper):
    pass


def str_rep(d, s):
    return d.represent_scalar('tag:yaml.org,2002:str', s, style="'" if (':' in s or '{' in s or s[:1] in '!&*%@`|>' or s.isdigit()) else None)


Dumper.add_representer(str, str_rep)
sys.stdout.write(yaml.dump(doc, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=1000, default_flow_style=False))
