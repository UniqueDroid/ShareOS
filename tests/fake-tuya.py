#!/usr/bin/env python3
"""
A fake Tuya device for tests of shareos-tuya, built from tinytuya's own
frame and cipher helpers (pip install tinytuya): protocol 3.3 or 3.4 on
TCP 6668 (DP query, control, 3.4 session-key negotiation) and its UDP
announcement on 6667.

    fake-tuya.py <version 3.3|3.4> <device id> <local key> [ip to bind, default 127.0.0.1]
"""
import hmac, json, os, socket, struct, sys, threading, time
from hashlib import md5, sha256
from tinytuya.core.crypto_helper import AESCipher
from tinytuya.core.message_helper import pack_message, unpack_message, parse_header, TuyaMessage
from tinytuya.core.header import PREFIX_55AA_VALUE

VER, DEVID, KEY = sys.argv[1], sys.argv[2], sys.argv[3].encode()
IP = sys.argv[4] if len(sys.argv) > 4 else '127.0.0.1'
STATE = {'1': False, '18': 0, '19': 1234, '20': 2301}
HDR = VER.encode() + b'\0' * 12
NOHDR = {3, 4, 5, 9, 10, 16, 18}

def frame(seq, cmd, payload, key):
    # device -> client: 4-byte return code in front of the payload
    msg = TuyaMessage(seq, cmd, None, struct.pack('>I', 0) + payload, 0, True, PREFIX_55AA_VALUE, False)
    return pack_message(msg, hmac_key=key if VER == '3.4' else None)

def enc(key, data, cmd):
    if VER == '3.4':
        if cmd not in NOHDR: data = HDR + data
        return AESCipher(key).encrypt(data, False)
    out = AESCipher(key).encrypt(data, False)
    return out if cmd in NOHDR else HDR + out

def dec(key, payload):
    if VER == '3.3' and payload[:3] == b'3.3': payload = payload[15:]
    data = AESCipher(key).decrypt(payload, False, decode_text=False)
    if data[:3] == VER.encode(): data = data[15:]
    return data

def serve(conn):
    key = KEY
    nonce = None
    buf = b''
    while True:
        try: d = conn.recv(4096)
        except OSError: return
        if not d: return
        buf += d
        while len(buf) >= 16:
            h = parse_header(buf)
            if len(buf) < h.total_length: break
            raw, buf = buf[:h.total_length], buf[h.total_length:]
            m = unpack_message(raw, hmac_key=key if VER == '3.4' else None, no_retcode=True)
            if not m.crc_good: print('bad crc/hmac', file=sys.stderr); return
            if VER == '3.4' and m.cmd == 3:
                lnonce = dec(KEY, m.payload)
                nonce = os.urandom(16)
                conn.send(frame(m.seqno, 4, enc(KEY, nonce + hmac.new(KEY, lnonce, sha256).digest(), 4), KEY))
                continue
            if VER == '3.4' and m.cmd == 5:
                if dec(KEY, m.payload) != hmac.new(KEY, nonce, sha256).digest(): print('bad finish', file=sys.stderr); return
                key = AESCipher(KEY).encrypt(bytes(a ^ b for a, b in zip(lnonce, nonce)), False, pad=False)
                continue
            body = json.loads(dec(key, m.payload) or b'{}')
            if m.cmd in (10, 16):
                if VER == '3.3' and body.get('gwId') != DEVID:
                    conn.send(frame(m.seqno, m.cmd, enc(key, b'json obj data unvalid', m.cmd), key)); continue
                out = {'devId': DEVID, 'dps': STATE} if VER == '3.3' else {'protocol': 4, 't': int(time.time()), 'data': {'dps': STATE}}
                conn.send(frame(m.seqno, m.cmd, enc(key, json.dumps(out).encode(), m.cmd), key))
            elif m.cmd in (7, 13):
                dps = body['dps'] if VER == '3.3' else body['data']['dps']
                STATE.update(dps)
                conn.send(frame(m.seqno, m.cmd, b'', key))
                out = {'devId': DEVID, 'dps': dps, 't': int(time.time())} if VER == '3.3' else {'protocol': 4, 't': int(time.time()), 'data': {'dps': dps}}
                conn.send(frame(0, 8, enc(key, json.dumps(out).encode(), 8), key))

def announce():
    udpkey = md5(b'yGAdlopoPVldABfn').digest()
    info = {'ip': IP, 'gwId': DEVID, 'active': 2, 'ability': 0, 'mode': 0, 'encrypt': True, 'productKey': 'keyfake123', 'version': VER}
    pkt = pack_message(TuyaMessage(0, 0x13, None, struct.pack('>I', 0) + AESCipher(udpkey).encrypt(json.dumps(info).encode(), False), 0, True, PREFIX_55AA_VALUE, False))
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    while True:
        s.sendto(pkt, ('127.0.0.1', 6667))
        time.sleep(1)

srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind((IP, 6668)); srv.listen(4)
threading.Thread(target=announce, daemon=True).start()
while True:
    c, _ = srv.accept()
    threading.Thread(target=serve, args=(c,), daemon=True).start()
