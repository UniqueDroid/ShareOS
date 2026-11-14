/*
 * shareos-crypt – password encryption for settings backups
 *
 *   shareos-crypt enc < input > output
 *   shareos-crypt dec < input > output
 *
 * The first line of stdin is the password, the rest is the data.
 * Format of an encrypted file:
 *   "SOS1" | iterations (4 bytes, big endian) | salt (16) | iv (12) |
 *   ciphertext | GCM tag (16)
 * Key: PBKDF2-HMAC-SHA256(password, salt, iterations) -> AES-256-GCM.
 * Exit code 2 = wrong password or damaged file.
 *
 * Part of ShareOS, GPL-2.0-or-later.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <mbedtls/gcm.h>
#include <mbedtls/pkcs5.h>
#include <mbedtls/md.h>
#include <mbedtls/platform_util.h>

#define ITERATIONS 100000
#define ITERATIONS_MAX (10 * ITERATIONS)
#define MAX_INPUT (8 * 1024 * 1024)

static unsigned char *read_all(size_t *len)
{
	size_t cap = 65536, n = 0;
	unsigned char *b = malloc(cap);
	ssize_t r;

	if (!b)
		return NULL;
	while ((r = read(0, b + n, cap - n)) > 0) {
		n += r;
		if (n == cap) {
			if (cap >= MAX_INPUT) {
				free(b);
				return NULL;
			}
			cap *= 2;
			b = realloc(b, cap);
			if (!b)
				return NULL;
		}
	}
	*len = n;
	return b;
}

static int random_bytes(unsigned char *p, size_t n)
{
	int fd = open("/dev/urandom", O_RDONLY);
	size_t got = 0;

	if (fd < 0)
		return -1;
	while (got < n) {
		ssize_t r = read(fd, p + got, n - got);
		if (r <= 0) {
			close(fd);
			return -1;
		}
		got += r;
	}
	close(fd);
	return 0;
}

static int derive(const unsigned char *pw, size_t pwlen, const unsigned char *salt,
		  unsigned int iter, unsigned char key[32])
{
	return mbedtls_pkcs5_pbkdf2_hmac_ext(MBEDTLS_MD_SHA256, pw, pwlen, salt, 16, iter, 32, key);
}

static int write_all(const unsigned char *p, size_t n)
{
	while (n) {
		ssize_t w = write(1, p, n);
		if (w <= 0)
			return -1;
		p += w;
		n -= w;
	}
	return 0;
}

int main(int argc, char **argv)
{
	unsigned char *in, *nl, *data, *out, key[32], salt[16], iv[12], tag[16];
	size_t len, pwlen, dlen;
	mbedtls_gcm_context gcm;
	int enc, rc = 1;

	if (argc != 2 || (strcmp(argv[1], "enc") && strcmp(argv[1], "dec"))) {
		fprintf(stderr, "usage: shareos-crypt enc|dec  (password = first line of stdin)\n");
		return 1;
	}
	enc = !strcmp(argv[1], "enc");
	in = read_all(&len);
	if (!in)
		return 1;
	nl = memchr(in, '\n', len);
	if (!nl || nl == in) {
		fprintf(stderr, "shareos-crypt: no password\n");
		return 1;
	}
	pwlen = nl - in;
	data = nl + 1;
	dlen = len - pwlen - 1;
	mbedtls_gcm_init(&gcm);

	if (enc) {
		unsigned char hdr[8] = { 'S', 'O', 'S', '1',
			(ITERATIONS >> 24) & 255, (ITERATIONS >> 16) & 255, (ITERATIONS >> 8) & 255, ITERATIONS & 255 };
		out = malloc(dlen ? dlen : 1);
		if (!out || random_bytes(salt, sizeof(salt)) || random_bytes(iv, sizeof(iv))
		    || derive(in, pwlen, salt, ITERATIONS, key)
		    || mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 256)
		    || mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, dlen, iv, sizeof(iv), NULL, 0,
						 data, out, sizeof(tag), tag))
			goto done;
		if (write_all(hdr, 8) || write_all(salt, 16) || write_all(iv, 12)
		    || write_all(out, dlen) || write_all(tag, 16))
			goto done;
		rc = 0;
	} else {
		unsigned int iter;
		size_t clen;

		if (dlen < 8 + 16 + 12 + 16 || memcmp(data, "SOS1", 4)) {
			fprintf(stderr, "shareos-crypt: not an encrypted ShareOS backup\n");
			rc = 2;
			goto done;
		}
		iter = (unsigned)data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7];
		/* the count comes from the file: a prepared backup must not keep
		   the box (and rpcd, which waits for this) busy for minutes */
		if (iter < 1000 || iter > ITERATIONS_MAX) {
			rc = 2;
			goto done;
		}
		memcpy(salt, data + 8, 16);
		memcpy(iv, data + 24, 12);
		clen = dlen - 8 - 16 - 12 - 16;
		memcpy(tag, data + dlen - 16, 16);
		out = malloc(clen ? clen : 1);
		if (!out || derive(in, pwlen, salt, iter, key)
		    || mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 256))
			goto done;
		if (mbedtls_gcm_auth_decrypt(&gcm, clen, iv, sizeof(iv), NULL, 0, tag, sizeof(tag),
					     data + 36, out)) {
			fprintf(stderr, "shareos-crypt: wrong password or damaged file\n");
			rc = 2;
			goto done;
		}
		if (write_all(out, clen))
			goto done;
		rc = 0;
	}
done:
	mbedtls_platform_zeroize(key, sizeof(key));
	mbedtls_platform_zeroize(in, len);
	mbedtls_gcm_free(&gcm);
	return rc;
}
