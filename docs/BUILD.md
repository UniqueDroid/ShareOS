# Building ShareOS

ShareOS is a buildroot `BR2_EXTERNAL` tree. The top-level `Makefile`
downloads the pinned buildroot release (checksum-verified) and drives it.

## Requirements

A Linux host (Debian/Ubuntu tested) with:

```sh
sudo apt-get install build-essential bc bison flex cpio rsync unzip file wget \
                     libssl-dev libncurses-dev python3
```

About 10 GB disk. A first build takes roughly 1 hour on 4 cores (most of
it is the cross toolchain).

## Commands

```sh
make dns320l                    # full build
make dns320l-menuconfig         # buildroot options
make dns320l-linux-menuconfig   # kernel options
make dns320l-savedefconfig      # write changes back to configs/
make sysapps-pack               # system apps (nano, htop …) as .sapp – after make dns320l
make octeon                     # devtest image of the Cavium OCTEON boxes (DNS-1200-05)
make clean                      # drop output/, keep downloads in dl/
```

Output in `output/dns320l/images/`:

| File | Content |
|---|---|
| `ShareOS-<ver>-<model>.bin` | firmware in the D-Link container format (kernel + initramfs), one per model: `DNS-320L-rev-Ax`, `DNS-320-rev-Bx`, `DNS-320-rev-Ax`, `DNS-325-rev-Ax` ([DEVICES.md](DEVICES.md)) |
| `….bin.sha256` | checksum |
| `uImage`, `urootfs` | the two parts on their own |
| `zImage.kirkwood-dns320l` | kernel with appended device tree |
| `modules.tar.xz` | kernel modules (not part of the phase-1 image) |

`make octeon` (`configs/shareos_octeon_defconfig`, MIPS64 big endian) writes
`ShareOS-<ver>-DNS-1200-05-rev-Ax-devtest.elf`, `.uImage` and `.uRamdisk` to
`output/octeon/images/`: the kernel with the whole system as its initramfs, for
the `bootoctlinux` of that box's U-Boot – see
[DEVICES.md](DEVICES.md#cavium-octeon-d-link-dns-1200-05-being-added).

System apps: `make sysapps-pack` runs a second buildroot in `output/sysapps`
(`configs/shareos_sysapps_defconfig`) that uses the toolchain of
`output/dns320l/host` as an external toolchain, and packs every recipe in
`sysapps/` into `output/sysapps/sapp/<id>-<version>.sapp` – see
[sysapps/README.md](../sysapps/README.md).

## Size limits

The stock U-Boot reads only 3 MB of the `uImage` and of the `ramdisk`
flash partition. `post-image.sh` fails the build if either part is larger.

## CI

`.github/workflows/build.yml` builds every push. Pushing a tag `v*`
publishes the images as a GitHub Release (tags containing `-` are marked
as pre-release) — this is what the future in-GUI updater will consume.
