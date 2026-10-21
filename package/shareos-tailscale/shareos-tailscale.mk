################################################################################
#
# shareos-tailscale – newer than buildroot's tailscale, one combined binary
#
################################################################################

SHAREOS_TAILSCALE_VERSION = 1.104.2
SHAREOS_TAILSCALE_SITE = $(call github,tailscale,tailscale,v$(SHAREOS_TAILSCALE_VERSION))
SHAREOS_TAILSCALE_LICENSE = BSD-3-Clause
SHAREOS_TAILSCALE_LICENSE_FILES = LICENSE
SHAREOS_TAILSCALE_GOMOD = tailscale.com
SHAREOS_TAILSCALE_BUILD_TARGETS = cmd/tailscaled
# "tailscale" is the same binary (ts_include_cli); left out: what a NAS in a
# home does not use, so it fits the flash and the 256 MB
SHAREOS_TAILSCALE_TAGS = ts_include_cli ts_omit_aws ts_omit_bird ts_omit_tap ts_omit_kube \
	ts_omit_completion ts_omit_ssh ts_omit_wakeonlan ts_omit_capture ts_omit_relayserver \
	ts_omit_taildrop ts_omit_tpm ts_omit_syspolicy ts_omit_debugeventbus ts_omit_webclient \
	ts_omit_systray ts_omit_drive ts_omit_portmapper_upnp ts_omit_logtail ts_omit_desktop_sessions
SHAREOS_TAILSCALE_LDFLAGS = \
	-X tailscale.com/version.longStamp=$(SHAREOS_TAILSCALE_VERSION) \
	-X tailscale.com/version.shortStamp=$(SHAREOS_TAILSCALE_VERSION)

define SHAREOS_TAILSCALE_INSTALL_CLI
	ln -sf tailscaled $(TARGET_DIR)/usr/bin/tailscale
endef
SHAREOS_TAILSCALE_POST_INSTALL_TARGET_HOOKS += SHAREOS_TAILSCALE_INSTALL_CLI

$(eval $(golang-package))
