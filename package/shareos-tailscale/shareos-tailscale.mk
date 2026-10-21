################################################################################
#
# shareos-tailscale – newer than buildroot's tailscale, one combined binary
#
################################################################################

# newest release that builds with the Go of buildroot 2026.02 (1.26.3)
SHAREOS_TAILSCALE_VERSION = v1.98.8
SHAREOS_TAILSCALE_SITE = https://github.com/tailscale/tailscale.git
SHAREOS_TAILSCALE_SITE_METHOD = git
SHAREOS_TAILSCALE_LICENSE = BSD-3-Clause
SHAREOS_TAILSCALE_LICENSE_FILES = LICENSE
SHAREOS_TAILSCALE_GOMOD = tailscale.com
# modules through the Go module proxy (buildroot fetches each from its own
# repository, which fails behind restricted proxies)
SHAREOS_TAILSCALE_GO_ENV = GOPROXY=https://proxy.golang.org,direct
SHAREOS_TAILSCALE_BUILD_TARGETS = cmd/tailscaled
# "tailscale" is the same binary (ts_include_cli); left out: what a NAS in a
# home does not use, so it fits the flash and the 256 MB
SHAREOS_TAILSCALE_TAGS = ts_include_cli ts_omit_aws ts_omit_bird ts_omit_tap ts_omit_kube \
	ts_omit_completion ts_omit_ssh ts_omit_wakeonlan ts_omit_capture ts_omit_relayserver \
	ts_omit_taildrop ts_omit_tpm ts_omit_syspolicy ts_omit_debugeventbus ts_omit_webclient \
	ts_omit_systray ts_omit_drive ts_omit_portmapper_upnp ts_omit_logtail ts_omit_desktop_sessions
SHAREOS_TAILSCALE_LDFLAGS = \
	-X tailscale.com/version.longStamp=$(patsubst v%,%,$(SHAREOS_TAILSCALE_VERSION)) \
	-X tailscale.com/version.shortStamp=$(patsubst v%,%,$(SHAREOS_TAILSCALE_VERSION))

define SHAREOS_TAILSCALE_INSTALL_CLI
	ln -sf tailscaled $(TARGET_DIR)/usr/bin/tailscale
endef
SHAREOS_TAILSCALE_POST_INSTALL_TARGET_HOOKS += SHAREOS_TAILSCALE_INSTALL_CLI

$(eval $(golang-package))
