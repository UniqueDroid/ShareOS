/*
 * dns1200-mcu – talk to the microcontroller of the D-Link DNS-1200-05
 *
 * The microcontroller on /dev/ttyS1 (19200 8N1) drives the OLED display,
 * the clock, the fans, power-off and the buttons. Frames start with 0xFA
 * and end with 0xFB, without a checksum. Every frame the box sends is
 * acknowledged with "FA 30 .. FB"; answers (clock values, version) and
 * button events are 7 bytes long.
 *
 * This first version knows only commands that read something or can be
 * undone right away. It does not switch the box off, reset the
 * microcontroller, set alarms or touch its firmware.
 *
 *   dns1200-mcu version             version of the microcontroller
 *   dns1200-mcu time                read its clock (UTC)
 *   dns1200-mcu name <text>         host name on the display
 *   dns1200-mcu ip <1|2> <a.b.c.d>  IP address of LAN port 1 or 2 on the display
 *   dns1200-mcu fan <half|full>     fan speed
 *   dns1200-mcu listen [seconds]    print what the microcontroller sends
 *   -v                              print every frame sent and received
 *
 * Copyright (C) 2026 ShareOS contributors
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/time.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define PORT      "/dev/ttyS1"
#define LOCKFILE  "/tmp/dns1200-mcu.lock"
#define F_START   0xFA
#define F_END     0xFB
#define ACK       0x30
#define RETRIES   10
#define WAIT_MS   300
#define NAME_MAX_LEN 20

static int verbose;

static long now_ms(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

static void dump(const char *dir, const unsigned char *b, int n)
{
	int i;

	if (!verbose)
		return;
	fprintf(stderr, "%s", dir);
	for (i = 0; i < n; i++)
		fprintf(stderr, " %02x", b[i]);
	fprintf(stderr, "\n");
}

static int open_port(void)
{
	struct termios t;
	/* DNS1200_MCU_PORT: only for tests/test-dns1200-mcu.sh (a pseudo terminal) */
	const char *port = getenv("DNS1200_MCU_PORT") ? getenv("DNS1200_MCU_PORT") : PORT;
	int fd = open(port, O_RDWR | O_NOCTTY);

	if (fd < 0) {
		perror(port);
		return -1;
	}
	if (tcgetattr(fd, &t) < 0) {
		perror("tcgetattr");
		close(fd);
		return -1;
	}
	cfmakeraw(&t);
	cfsetispeed(&t, B19200);
	cfsetospeed(&t, B19200);
	t.c_cflag &= ~(PARENB | CSTOPB | CSIZE | CRTSCTS);
	t.c_cflag |= CS8 | CLOCAL | CREAD;
	t.c_cc[VMIN] = 0;
	t.c_cc[VTIME] = 1;	/* read() returns after 0.1 s without data */
	if (tcsetattr(fd, TCSANOW, &t) < 0) {
		perror("tcsetattr");
		close(fd);
		return -1;
	}
	tcflush(fd, TCIOFLUSH);
	return fd;
}

/* Read one frame (FA .. FB) within ms milliseconds; returns its length or 0. */
static int read_frame(int fd, unsigned char *f, int size, int ms)
{
	long end = now_ms() + ms;
	int n = 0;
	unsigned char c;

	while (now_ms() < end) {
		if (read(fd, &c, 1) != 1)
			continue;
		if (n == 0 && c != F_START)
			continue;	/* wait for the start of a frame */
		if (n < size)
			f[n++] = c;
		if (c == F_END && n >= 2) {
			dump("<", f, n);
			return n;
		}
		if (n == size)
			n = 0;	/* too long: not a frame, start again */
	}
	return 0;
}

/*
 * Send a frame and wait for the acknowledgement; frames other than the
 * acknowledgement that arrive meanwhile are kept in answer (the last one).
 */
static int send_frame(int fd, const unsigned char *f, int n, unsigned char *answer, int *alen)
{
	unsigned char r[32];
	int try, len, acked = 0;
	long end;

	if (alen)
		*alen = 0;
	for (try = 0; try < RETRIES && !acked; try++) {
		dump(">", f, n);
		if (write(fd, f, n) != n) {
			perror("write");
			return -1;
		}
		tcdrain(fd);
		end = now_ms() + WAIT_MS;
		while (now_ms() < end) {
			len = read_frame(fd, r, sizeof(r), (int)(end - now_ms()));
			if (len == 0)
				break;
			if (r[1] == ACK)
				acked = 1;
			else if (answer && alen) {
				memcpy(answer, r, len);
				*alen = len;
			}
		}
	}
	/* an answer may follow the acknowledgement */
	if (acked && answer && alen && *alen == 0) {
		len = read_frame(fd, r, sizeof(r), WAIT_MS);
		if (len && r[1] != ACK) {
			memcpy(answer, r, len);
			*alen = len;
		}
	}
	if (!acked) {
		fprintf(stderr, "no acknowledgement from the microcontroller\n");
		return -1;
	}
	return 0;
}

static int simple(int fd, unsigned char g, unsigned char c, unsigned char p,
		  unsigned char l, unsigned char x, unsigned char *answer, int *alen)
{
	unsigned char f[7] = { F_START, g, c, p, l, x, F_END };

	return send_frame(fd, f, sizeof(f), answer, alen);
}

static int bcd(unsigned char b)
{
	return (b >> 4) * 10 + (b & 0x0f);
}

static int cmd_version(int fd)
{
	unsigned char a[32];
	int alen;

	if (simple(fd, 0x03, 0x05, 0x00, 0x00, 0x00, a, &alen) < 0)
		return 1;
	if (alen == 7 && a[1] == 0x03 && a[2] == 0x05) {
		/* D-Link prints the high and the low half of byte 5 */
		printf("%d.00b%02d\n", a[5] >> 4, a[5] & 0x0f);
		return 0;
	}
	fprintf(stderr, "no version answer\n");
	return 1;
}

static int cmd_time(int fd)
{
	/* registers: 1 second, 2 minute, 3 hour, 5 day, 6 month, 7 year */
	static const unsigned char reg[] = { 7, 6, 5, 3, 2, 1 };
	int v[6], i, alen;
	unsigned char a[32];

	for (i = 0; i < 6; i++) {
		if (simple(fd, 0x01, reg[i], 0x01, 0x01, 0x00, a, &alen) < 0)
			return 1;
		if (alen != 7 || a[1] != 0x01 || a[2] != reg[i]) {
			fprintf(stderr, "no clock answer for register %d\n", reg[i]);
			return 1;
		}
		v[i] = bcd(a[5]);
	}
	printf("20%02d-%02d-%02d %02d:%02d:%02d UTC\n", v[0], v[1], v[2], v[3], v[4], v[5]);
	return 0;
}

static int cmd_name(int fd, const char *name)
{
	unsigned char f[NAME_MAX_LEN + 6];
	int len = strlen(name), i;

	if (len < 1 || len > NAME_MAX_LEN) {
		fprintf(stderr, "name: 1 to %d characters\n", NAME_MAX_LEN);
		return 1;
	}
	for (i = 0; i < len; i++)
		if (name[i] < 0x20 || name[i] > 0x7e) {
			fprintf(stderr, "name: printable ASCII only\n");
			return 1;
		}
	f[0] = F_START;
	f[1] = 0x04;
	f[2] = 0x01;
	f[3] = 0x00;
	f[4] = len;
	memcpy(f + 5, name, len);
	f[5 + len] = F_END;
	return send_frame(fd, f, len + 6, NULL, NULL) < 0;
}

static int cmd_ip(int fd, const char *port, const char *ip)
{
	unsigned char f[14];
	unsigned int a[4];
	int i;
	char end;

	if (strcmp(port, "1") && strcmp(port, "2")) {
		fprintf(stderr, "ip: port 1 or 2\n");
		return 1;
	}
	if (sscanf(ip, "%u.%u.%u.%u%c", &a[0], &a[1], &a[2], &a[3], &end) != 4 ||
	    a[0] > 255 || a[1] > 255 || a[2] > 255 || a[3] > 255) {
		fprintf(stderr, "ip: address a.b.c.d\n");
		return 1;
	}
	f[0] = F_START;
	f[1] = 0x04;
	f[2] = 0x02;
	f[3] = port[0] == '1' ? 0x01 : 0x02;
	f[4] = 0x08;
	for (i = 0; i < 4; i++) {
		f[5 + 2 * i] = a[i] >> 4;	/* high half of the byte first */
		f[6 + 2 * i] = a[i] & 0x0f;
	}
	f[13] = F_END;
	return send_frame(fd, f, sizeof(f), NULL, NULL) < 0;
}

static int cmd_fan(int fd, const char *speed)
{
	unsigned char p;

	/* no "off": nothing in ShareOS watches the temperature yet */
	if (!strcmp(speed, "half"))
		p = 0x01;
	else if (!strcmp(speed, "full"))
		p = 0x02;
	else {
		fprintf(stderr, "fan: half or full\n");
		return 1;
	}
	return simple(fd, 0x02, 0x00, p, 0x00, 0x00, NULL, NULL) < 0;
}

static const char *event_name(unsigned char t)
{
	switch (t) {
	case 0x20: return "alarm";
	case 0x21: return "power";
	case 0x22: return "reset";
	case 0x23: return "power-push";
	case 0x24: return "reset-push";
	case 0x25: return "function-push";
	case ACK: return "ack";
	default: return "unknown";
	}
}

static int cmd_listen(int fd, int seconds)
{
	unsigned char f[32];
	long end = now_ms() + seconds * 1000L;
	int n, i;

	while (now_ms() < end) {
		n = read_frame(fd, f, sizeof(f), 1000);
		if (!n)
			continue;
		printf("%s:", event_name(f[1]));
		for (i = 0; i < n; i++)
			printf(" %02x", f[i]);
		printf("\n");
		fflush(stdout);
	}
	return 0;
}

static void usage(void)
{
	fprintf(stderr,
		"usage: dns1200-mcu [-v] version | time | name <text> | ip <1|2> <a.b.c.d>\n"
		"                        | fan <half|full> | listen [seconds]\n");
	exit(2);
}

int main(int argc, char **argv)
{
	int fd, lock, rc;

	if (argc > 1 && !strcmp(argv[1], "-v")) {
		verbose = 1;
		argv++;
		argc--;
	}
	if (argc < 2)
		usage();

	/* one user of the serial port at a time */
	lock = open(LOCKFILE, O_RDWR | O_CREAT, 0600);
	if (lock < 0 || flock(lock, LOCK_EX) < 0) {
		perror(LOCKFILE);
		return 1;
	}
	fd = open_port();
	if (fd < 0)
		return 1;

	if (!strcmp(argv[1], "version") && argc == 2)
		rc = cmd_version(fd);
	else if (!strcmp(argv[1], "time") && argc == 2)
		rc = cmd_time(fd);
	else if (!strcmp(argv[1], "name") && argc == 3)
		rc = cmd_name(fd, argv[2]);
	else if (!strcmp(argv[1], "ip") && argc == 4)
		rc = cmd_ip(fd, argv[2], argv[3]);
	else if (!strcmp(argv[1], "fan") && argc == 3)
		rc = cmd_fan(fd, argv[2]);
	else if (!strcmp(argv[1], "listen") && argc <= 3)
		rc = cmd_listen(fd, argc == 3 ? atoi(argv[2]) : 30);
	else
		usage();

	close(fd);
	return rc;
}
