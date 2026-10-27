#!/usr/bin/env python3
"""
A minimal Zabbix server for tests: answers the active checks of an agent and
writes the values it sends to a JSON file.

    tests/zabbix-fake-server.py <port> <out.json> <key> [<key> ...]

Every key becomes an active item (delay 2s). The output file holds
{"requests": [<request names>], "hosts": [...], "values": {<key>: <last value>}}
and is rewritten after every message. With ZBX_PSK_IDENTITY and ZBX_PSK (hex)
in the environment it takes TLS connections with that pre-shared key only
(Python 3.13+); "tls" then lists the TLS version of every connection.
"""
import json, os, socketserver, ssl, struct, sys, zlib

PORT, OUT, KEYS = int(sys.argv[1]), sys.argv[2], sys.argv[3:]
ITEMS = {i + 1: k for i, k in enumerate(KEYS)}
state = {'requests': [], 'hosts': [], 'metadata': [], 'values': {}, 'errors': {}, 'tls': []}
PSK_ID, PSK = os.environ.get('ZBX_PSK_IDENTITY'), os.environ.get('ZBX_PSK')
CTX = None
if PSK_ID and PSK:
    CTX = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    CTX.maximum_version = ssl.TLSVersion.TLSv1_2
    CTX.set_ciphers('PSK')
    CTX.set_psk_server_callback(lambda ident: bytes.fromhex(PSK) if ident == PSK_ID else b'', None)


def save():
    with open(OUT + '.tmp', 'w') as f:
        json.dump(state, f, indent=1)
    os.replace(OUT + '.tmp', OUT)


def recv_exact(sock, n):
    b = b''
    while len(b) < n:
        c = sock.recv(n - len(b))
        if not c:
            raise EOFError
        b += c
    return b


def read_msg(sock):
    h = recv_exact(sock, 5)
    if h[:4] != b'ZBXD':
        raise ValueError('no ZBXD header')
    flags = h[4]
    if flags & 0x04:                      # large packet: 64-bit lengths
        datalen, reserved = struct.unpack('<QQ', recv_exact(sock, 16))
    else:
        datalen, reserved = struct.unpack('<II', recv_exact(sock, 8))
    data = recv_exact(sock, datalen)
    if flags & 0x02:                      # compressed
        data = zlib.decompress(data)
    return json.loads(data.decode())


def send_msg(sock, obj):
    d = json.dumps(obj).encode()
    sock.sendall(b'ZBXD\x01' + struct.pack('<II', len(d), 0) + d)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        if CTX:
            try:
                self.request = CTX.wrap_socket(self.request, server_side=True)
                state['tls'].append(self.request.version())
            except Exception as e:
                state['tls'].append('failed: %s' % e)
                save()
                return
        try:
            m = read_msg(self.request)
        except Exception:
            return
        req = m.get('request')
        state['requests'].append(req)
        if req == 'active checks':
            if m.get('host') not in state['hosts']:
                state['hosts'].append(m.get('host'))
            if m.get('host_metadata') is not None and m.get('host_metadata') not in state['metadata']:
                state['metadata'].append(m.get('host_metadata'))
            send_msg(self.request, {'response': 'success', 'config_revision': 1,
                                    'data': [{'key': k, 'itemid': i, 'delay': '2s', 'lastlogsize': 0, 'mtime': 0}
                                             for i, k in ITEMS.items()]})
        elif req == 'agent data':
            for v in m.get('data', []):
                k = ITEMS.get(v.get('itemid'))
                if k is None:
                    continue
                if v.get('state') == 1:       # not supported
                    state['errors'][k] = v.get('value')
                else:
                    state['values'][k] = v.get('value')
            send_msg(self.request, {'response': 'success', 'info': 'processed: %d' % len(m.get('data', []))})
        else:
            send_msg(self.request, {'response': 'success'})
        save()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


save()
Server(('127.0.0.1', PORT), Handler).serve_forever()
