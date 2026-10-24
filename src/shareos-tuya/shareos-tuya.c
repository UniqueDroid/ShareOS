/*
 * shareos-tuya – talk to Tuya smart-home devices in the local network
 * (protocol 3.3/3.4, no cloud). Used by the app permission "tuya"
 * (/www-apps/_shareos/cgi/tuya); prints one JSON object.
 *
 *   shareos-tuya discover [seconds]                  devices announcing themselves (UDP 6666/6667)
 *   shareos-tuya status <ip> <id> <key> <version>    data points (dps) of a device
 *   shareos-tuya set <ip> <id> <key> <version> <dps-json>   e.g. '{"1":true}'
 *
 * Frames: 0x000055AA seq cmd len payload (crc32 | hmac-sha256) 0x0000AA55;
 * payload AES-128-ECB with the device's local key (3.3) or a session key
 * negotiated with it (3.4). Protocol 3.5 (0x6699, AES-GCM) is not supported.
 *
 * Copyright (C) 2026 ShareOS contributors, GPL-2.0-only.
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>
#include <mbedtls/aes.h>
#include <mbedtls/md.h>
#include <mbedtls/md5.h>

#define PREFIX 0x000055AAu
#define SUFFIX 0x0000AA55u
enum { SESS_START = 3, SESS_RESP = 4, SESS_FINISH = 5, CONTROL = 7, STATUS = 8, HEART_BEAT = 9,
	DP_QUERY = 10, CONTROL_NEW = 13, DP_QUERY_NEW = 16 };
#define MAXMSG 4096

static int fail(const char *msg)
{
	printf("{\"ok\":false,\"error\":\"%s\"}\n", msg);
	return 1;
}

/* ---------- small helpers ---------- */

static uint32_t crc32(const uint8_t *p, size_t n)
{
	uint32_t c = 0xFFFFFFFFu;
	for (size_t i = 0; i < n; i++) {
		c ^= p[i];
		for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & -(c & 1));
	}
	return ~c;
}

static void put32(uint8_t *p, uint32_t v) { p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v; }
static uint32_t get32(const uint8_t *p) { return (uint32_t)p[0] << 24 | p[1] << 16 | p[2] << 8 | p[3]; }

/* AES-128-ECB with PKCS#7 padding (pad = 1) or without (whole blocks) */
static int aes_ecb(const uint8_t key[16], int enc, const uint8_t *in, size_t n, uint8_t *out, int pad)
{
	mbedtls_aes_context a;
	size_t len = n;
	uint8_t buf[MAXMSG + 16];
	if (n > MAXMSG) return -1;
	memcpy(buf, in, n);
	if (enc && pad) {
		uint8_t p = 16 - n % 16;
		memset(buf + n, p, p);
		len = n + p;
	}
	if (len % 16) return -1;
	mbedtls_aes_init(&a);
	if (enc) mbedtls_aes_setkey_enc(&a, key, 128); else mbedtls_aes_setkey_dec(&a, key, 128);
	for (size_t i = 0; i < len; i += 16) mbedtls_aes_crypt_ecb(&a, enc ? MBEDTLS_AES_ENCRYPT : MBEDTLS_AES_DECRYPT, buf + i, out + i);
	mbedtls_aes_free(&a);
	if (!enc && pad) {
		uint8_t p = len ? out[len - 1] : 0;
		if (p < 1 || p > 16 || p > len) return -1;
		for (size_t i = len - p; i < len; i++) if (out[i] != p) return -1;
		len -= p;
	}
	return (int)len;
}

static void hmac256(const uint8_t *key, size_t kl, const uint8_t *msg, size_t n, uint8_t out[32])
{
	mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, kl, msg, n, out);
}

/* print a decrypted answer: JSON as it is, anything else as a string */
static void print_payload(const char *name, const uint8_t *p, int n)
{
	int json = n > 0 && p[0] == '{';
	for (int i = 0; json && i < n; i++) if (p[i] < 0x20 && p[i] != '\n' && p[i] != '\r' && p[i] != '\t') json = 0;
	if (json) { printf("\"%s\":%.*s", name, n, (const char *)p); return; }
	printf("\"%s\":\"", name);
	for (int i = 0; i < n; i++) {
		if (p[i] == '"' || p[i] == '\\') printf("\\%c", p[i]);
		else if (p[i] >= 0x20 && p[i] < 0x7f) putchar(p[i]);
		else printf("\\u%04x", p[i]);
	}
	putchar('"');
}

/* ---------- discovery ---------- */

static int udp_listen(int port)
{
	int s = socket(AF_INET, SOCK_DGRAM, 0), on = 1;
	struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(port), .sin_addr.s_addr = htonl(INADDR_ANY) };
	if (s < 0) return -1;
	setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
	setsockopt(s, SOL_SOCKET, SO_BROADCAST, &on, sizeof on);
	if (bind(s, (struct sockaddr *)&a, sizeof a) < 0) { close(s); return -1; }
	return s;
}

static int discover(int secs)
{
	uint8_t udpkey[16], buf[MAXMSG], out[MAXMSG + 16];
	char seen[64][16];
	int nseen = 0, first = 1;
	struct pollfd pf[2];
	mbedtls_md5((const uint8_t *)"yGAdlopoPVldABfn", 16, udpkey);
	pf[0].fd = udp_listen(6666);
	pf[1].fd = udp_listen(6667);
	if (pf[0].fd < 0 && pf[1].fd < 0) return fail("cannot listen on UDP 6666/6667");
	pf[0].events = pf[1].events = POLLIN;
	printf("{\"ok\":true,\"devices\":[");
	time_t end = time(NULL) + secs;
	while (time(NULL) < end) {
		if (poll(pf, 2, 500) <= 0) continue;
		for (int i = 0; i < 2; i++) {
			if (pf[i].fd < 0 || !(pf[i].revents & POLLIN)) continue;
			struct sockaddr_in from;
			socklen_t fl = sizeof from;
			ssize_t n = recvfrom(pf[i].fd, buf, sizeof buf, 0, (struct sockaddr *)&from, &fl);
			if (n < 28 || get32(buf) != PREFIX) continue;          /* 3.5 (0x6699) is skipped */
			char ip[16];
			inet_ntop(AF_INET, &from.sin_addr, ip, sizeof ip);
			int dup = 0;
			for (int k = 0; k < nseen; k++) if (!strcmp(seen[k], ip)) dup = 1;
			if (dup || nseen >= 64) continue;
			const uint8_t *p = buf + 20;                            /* header 16 + return code 4 */
			int len = (int)n - 28, m;
			if (i == 1) m = aes_ecb(udpkey, 0, p, len - len % 16, out, 1);
			else { memcpy(out, p, len); m = len; }
			if (m <= 0 || out[0] != '{') continue;
			strcpy(seen[nseen++], ip);
			printf("%s{\"from\":\"%s\",", first ? "" : ",", ip);
			print_payload("info", out, m);
			putchar('}');
			first = 0;
		}
	}
	printf("]}\n");
	return 0;
}

/* ---------- TCP 6668 ---------- */

struct dev {
	int fd, v34;
	uint32_t seq;
	uint8_t key[16];       /* local key, after negotiation the session key (3.4) */
	char ver[4];
};

static int tcp_connect(const char *ip)
{
	struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(6668) };
	int s, fl;
	struct pollfd pf;
	if (inet_pton(AF_INET, ip, &a.sin_addr) != 1) return -1;
	s = socket(AF_INET, SOCK_STREAM, 0);
	if (s < 0) return -1;
	fl = fcntl(s, F_GETFL);
	fcntl(s, F_SETFL, fl | O_NONBLOCK);
	if (connect(s, (struct sockaddr *)&a, sizeof a) < 0 && errno != EINPROGRESS) { close(s); return -1; }
	pf.fd = s; pf.events = POLLOUT;
	int err = 0;
	socklen_t el = sizeof err;
	if (poll(&pf, 1, 4000) <= 0 || getsockopt(s, SOL_SOCKET, SO_ERROR, &err, &el) < 0 || err) { close(s); return -1; }
	fcntl(s, F_SETFL, fl);
	struct timeval tv = { 5, 0 };
	setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
	return s;
}

/* 3.4: everything but these gets the version header inside the encryption;
   3.3: only CONTROL-like commands get "3.3"+12 zero bytes in front of the cipher text */
static int no_header(int cmd) { return cmd == DP_QUERY || cmd == DP_QUERY_NEW || cmd == HEART_BEAT || cmd == SESS_START || cmd == SESS_FINISH || cmd == SESS_RESP; }

static int send_msg(struct dev *d, int cmd, const uint8_t *plain, size_t n)
{
	uint8_t pay[MAXMSG + 64], msg[MAXMSG + 128];
	size_t pl = 0;
	int m;
	if (n > MAXMSG - 32) return -1;
	if (d->v34) {
		uint8_t tmp[MAXMSG + 32];
		size_t tl = 0;
		if (!no_header(cmd)) { memcpy(tmp, "3.4", 3); memset(tmp + 3, 0, 12); tl = 15; }
		memcpy(tmp + tl, plain, n); tl += n;
		if ((m = aes_ecb(d->key, 1, tmp, tl, pay, 1)) < 0) return -1;
		pl = m;
	} else {
		if (!no_header(cmd)) { memcpy(pay, d->ver, 3); memset(pay + 3, 0, 12); pl = 15; }
		if ((m = aes_ecb(d->key, 1, plain, n, pay + pl, 1)) < 0) return -1;
		pl += m;
	}
	size_t tail = d->v34 ? 32 : 4;
	put32(msg, PREFIX); put32(msg + 4, ++d->seq); put32(msg + 8, cmd); put32(msg + 12, pl + tail + 4);
	memcpy(msg + 16, pay, pl);
	if (d->v34) hmac256(d->key, 16, msg, 16 + pl, msg + 16 + pl);
	else put32(msg + 16 + pl, crc32(msg, 16 + pl));
	put32(msg + 16 + pl + tail, SUFFIX);
	size_t total = 16 + pl + tail + 4;
	return write(d->fd, msg, total) == (ssize_t)total ? 0 : -1;
}

static int read_full(int fd, uint8_t *p, size_t n)
{
	size_t got = 0;
	while (got < n) {
		ssize_t r = read(fd, p + got, n - got);
		if (r <= 0) return -1;
		got += r;
	}
	return 0;
}

/* one frame: cmd, decrypted payload (version header and return code removed) */
static int recv_msg(struct dev *d, int *cmd, uint8_t *out, int *rc)
{
	uint8_t h[16], body[MAXMSG + 64];
	if (read_full(d->fd, h, 16) < 0) return -2;
	if (get32(h) != PREFIX) return -3;
	uint32_t len = get32(h + 12);
	if (len < 8 || len > MAXMSG + 48) return -3;
	if (read_full(d->fd, body, len) < 0) return -2;
	*cmd = get32(h + 8);
	size_t tail = d->v34 ? 36 : 8;
	if (len < tail) return -3;
	int n = len - tail;
	const uint8_t *p = body;
	*rc = 0;
	/* device -> client frames usually start with a 4-byte return code; the
	   cipher text is whole blocks, so it is there when 4 bytes stick out
	   (3.3: plus the 15-byte version header) */
	if (n >= 4 && (n % 16 == 4 || (!d->v34 && n % 16 == 3))) { *rc = (int)get32(p); p += 4; n -= 4; }
	if (n >= 15 && !memcmp(p, d->ver, 3)) { p += 15; n -= 15; }
	if (n == 0) return 0;
	int m = aes_ecb(d->key, 0, p, n - n % 16, out, 1);
	if (m < 0) return -4;
	if (m >= 15 && !memcmp(out, d->ver, 3)) { memmove(out, out + 15, m - 15); m -= 15; }
	out[m] = 0;
	return m;
}

/* 3.4: session key from two nonces (local key encrypts their XOR) */
static int negotiate(struct dev *d)
{
	uint8_t lnonce[16], out[MAXMSG + 16], mac[32], x[16];
	int cmd, rc, n;
	FILE *u = fopen("/dev/urandom", "r");
	if (!u || fread(lnonce, 1, 16, u) != 16) { if (u) fclose(u); return -1; }
	fclose(u);
	if (send_msg(d, SESS_START, lnonce, 16) < 0) return -1;
	for (int tries = 0; tries < 5; tries++) {
		if ((n = recv_msg(d, &cmd, out, &rc)) < 0) return -1;
		if (cmd == SESS_RESP) break;
	}
	if (cmd != SESS_RESP || n < 48) return -1;
	hmac256(d->key, 16, lnonce, 16, mac);
	if (memcmp(out + 16, mac, 32)) return -2;                     /* wrong local key */
	hmac256(d->key, 16, out, 16, mac);
	if (send_msg(d, SESS_FINISH, mac, 32) < 0) return -1;
	for (int i = 0; i < 16; i++) x[i] = lnonce[i] ^ out[i];
	uint8_t sk[16];
	if (aes_ecb(d->key, 1, x, 16, sk, 0) != 16) return -1;
	memcpy(d->key, sk, 16);
	return 0;
}

/* wait for a frame with data points, print it */
static int answer(struct dev *d, const char *what)
{
	uint8_t out[MAXMSG + 16];
	int cmd, rc, n;
	for (int tries = 0; tries < 8; tries++) {
		n = recv_msg(d, &cmd, out, &rc);
		if (n == -2) return fail("no answer from the device – wrong local key or protocol version?");
		if (n == -4) return fail("cannot decrypt the answer – wrong local key or protocol version");
		if (n < 0) return fail("unexpected answer from the device");
		if (n > 0 && strstr((char *)out, "\"dps\"")) {
			printf("{\"ok\":true,\"op\":\"%s\",\"cmd\":%d,", what, cmd);
			print_payload("data", out, n);
			printf("}\n");
			return 0;
		}
		if (n > 0 && strstr((char *)out, "data unvalid")) {
			if (!strcmp(what, "status") && !d->v34) return 3;        /* try again as "device22" */
			return fail("the device refused the request (device id or key)");
		}
		if (rc && cmd != HEART_BEAT) { printf("{\"ok\":false,\"error\":\"the device answered with error %d\"}\n", rc); return 1; }
	}
	return fail("no data points in the answer");
}

static int device(char **argv, int set)
{
	struct dev d = { .seq = 0 };
	const char *ip = argv[2], *id = argv[3], *key = argv[4], *ver = argv[5];
	char json[MAXMSG];
	if (strlen(key) != 16) return fail("the local key has 16 characters");
	if (strlen(id) < 6 || strlen(id) > 32 || strspn(id, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") != strlen(id)) return fail("invalid device id");
	if (strcmp(ver, "3.3") && strcmp(ver, "3.4")) return fail("protocol version 3.3 or 3.4 (3.1 and 3.5 are not supported)");
	memcpy(d.key, key, 16);
	memcpy(d.ver, ver, 3); d.ver[3] = 0;
	d.v34 = !strcmp(ver, "3.4");
	if ((d.fd = tcp_connect(ip)) < 0) return fail("device not reachable (TCP 6668)");
	if (d.v34) {
		int r = negotiate(&d);
		if (r == -2) return fail("wrong local key (session negotiation)");
		if (r < 0) return fail("session negotiation failed – wrong local key, or the device does not speak protocol 3.4");
	}
	long t = (long)time(NULL);
	int n;
	if (!set) {
		if (d.v34) n = snprintf(json, sizeof json, "{}");
		else n = snprintf(json, sizeof json, "{\"gwId\":\"%s\",\"devId\":\"%s\",\"uid\":\"%s\",\"t\":\"%ld\"}", id, id, id, t);
		if (send_msg(&d, d.v34 ? DP_QUERY_NEW : DP_QUERY, (uint8_t *)json, n) < 0) return fail("send failed");
		int r = answer(&d, "status");
		if (r != 3 || d.v34) return r;
		/* "device22" (3.3 with 22-character ids): asks with CONTROL_NEW and the dps it wants */
		close(d.fd);
		if ((d.fd = tcp_connect(ip)) < 0) return fail("device not reachable (TCP 6668)");
		n = snprintf(json, sizeof json, "{\"devId\":\"%s\",\"uid\":\"%s\",\"t\":\"%ld\",\"dps\":{\"1\":null}}", id, id, t);
		if (send_msg(&d, CONTROL_NEW, (uint8_t *)json, n) < 0) return fail("send failed");
		r = answer(&d, "status");
		return r == 3 ? fail("the device refused the request (device id or key)") : r;
	}
	const char *dps = argv[6];
	if (strlen(dps) > 1024 || dps[0] != '{') return fail("invalid dps (JSON object)");
	if (d.v34) n = snprintf(json, sizeof json, "{\"protocol\":5,\"t\":%ld,\"data\":{\"dps\":%s}}", t, dps);
	else n = snprintf(json, sizeof json, "{\"devId\":\"%s\",\"uid\":\"%s\",\"t\":\"%ld\",\"dps\":%s}", id, id, t, dps);
	if (send_msg(&d, d.v34 ? CONTROL_NEW : CONTROL, (uint8_t *)json, n) < 0) return fail("send failed");
	return answer(&d, "set");
}

int main(int argc, char **argv)
{
	if (argc >= 2 && !strcmp(argv[1], "discover")) {
		int s = argc > 2 ? atoi(argv[2]) : 6;
		return discover(s < 1 ? 1 : s > 20 ? 20 : s);
	}
	if (argc == 6 && !strcmp(argv[1], "status")) return device(argv, 0);
	if (argc == 7 && !strcmp(argv[1], "set")) return device(argv, 1);
	fprintf(stderr, "usage: shareos-tuya discover [seconds] | status <ip> <id> <key> <version> | set <ip> <id> <key> <version> <dps-json>\n");
	return 2;
}
