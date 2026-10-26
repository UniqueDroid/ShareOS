#!/usr/bin/env python3
"""Every method of the ShareOS rpcd plugin must be granted by an ACL group,
otherwise the web interface gets "access denied" and logs the user out.

  tests/check-acl.py [shareos.uc] [acl.d/shareos.json]
"""
import json
import re
import sys

UC = sys.argv[1] if len(sys.argv) > 1 else 'src/shareos-core/usr/share/rpcd/ucode/shareos.uc'
ACL = sys.argv[2] if len(sys.argv) > 2 else 'src/shareos-core/usr/share/rpcd/acl.d/shareos.json'
# called only as root (CGIs, CLI), never from a web session
INTERNAL = {('shareos.widget', 'status')} | {('shareos.appfs', m) for m in ('roots', 'list', 'mkdir', 'rename', 'move', 'delete', 'open', 'grant_app')} | {('shareos.apptorrent', m) for m in ('session', 'path')} | {('shareos.appmedia', m) for m in ('probe', 'start', 'jobs', 'cancel', 'remove')} | {('shareos.appvpn', m) for m in ('list', 'status', 'log', 'disconnect', 'import', 'set', 'remove', 'connect', 'server_status', 'server_log', 'server_set', 'device_add', 'device_profile', 'device_remove')} | {('shareos.appstatus', m) for m in ('set', 'clear')} | {('shareos.apptailscale', m) for m in ('status', 'log', 'up', 'login', 'down', 'logout', 'ping')} | {('shareos.appautobrr', m) for m in ('status', 'log', 'start', 'set', 'password', 'api', 'accounts')} | {('shareos.appsys', m) for m in ('info', 'processes', 'kill')} | {('shareos.appnet', 'allowed')} | {('shareos.apptuya', 'allowed')} | {('shareos.appnotify', m) for m in ('send', 'clear')} | {('shareos.appdocker', m) for m in ('hosts', 'host_set', 'host_del', 'target')}

objs, cur = {}, None
for line in open(UC, encoding='utf-8'):
    m = re.match(r"^\t'(shareos\.[a-z_]+)': \{", line)
    if m:
        cur = m.group(1)
        objs[cur] = []
        continue
    m = re.match(r'^\t\t([a-z_]+): \{', line)
    if m and cur:
        objs[cur].append(m.group(1))
    if re.match(r'^\t\},?$', line):
        cur = None

granted = {}
for group in json.load(open(ACL, encoding='utf-8')).values():
    for rw in ('read', 'write'):
        for obj, methods in group.get(rw, {}).get('ubus', {}).items():
            granted.setdefault(obj, set()).update(methods)

bad = [f'{o}.{m}' for o, ms in objs.items() for m in ms
       if m not in granted.get(o, set()) and (o, m) not in INTERNAL]
unknown = [f'{o}.{m}' for o, ms in granted.items() if o.startswith('shareos.')
           for m in ms if o not in objs or m not in objs[o]]
if not objs:
    sys.exit('no ubus objects found in ' + UC)
if bad:
    print('methods without ACL (web sessions get "access denied"):', ', '.join(bad))
if unknown:
    print('ACL grants methods that do not exist:', ', '.join(unknown))
sys.exit(1 if bad or unknown else 0)
