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
# home does not use, so it fits the flash and the 256 MB – also netstack and
# iptables: the box uses the kernel TUN device, without firewall rules
SHAREOS_TAILSCALE_TAGS = ts_include_cli ts_omit_ace ts_omit_acme ts_omit_appconnectors ts_omit_aws ts_omit_advertiseexitnode ts_omit_bird ts_omit_captiveportal ts_omit_capture ts_omit_clientupdate ts_omit_completion ts_omit_conn25 ts_omit_cloud ts_omit_dbus ts_omit_debugeventbus ts_omit_debugportmapper ts_omit_doctor ts_omit_drive ts_omit_identityfederation ts_omit_kube ts_omit_networkmanager ts_omit_oauthkey ts_omit_outboundproxy ts_omit_posture ts_omit_portlist ts_omit_qrcodes ts_omit_relayserver ts_omit_resolved ts_omit_sdnotify ts_omit_serve ts_omit_ssh ts_omit_synology ts_omit_syspolicy ts_omit_systray ts_omit_taildrop ts_omit_tap ts_omit_tpm ts_omit_wakeonlan ts_omit_webbrowser ts_omit_webclient ts_omit_netstack ts_omit_gro ts_omit_iptables ts_omit_tundevstats ts_omit_linuxdnsfight
SHAREOS_TAILSCALE_LDFLAGS = \
	-X tailscale.com/version.longStamp=$(patsubst v%,%,$(SHAREOS_TAILSCALE_VERSION)) \
	-X tailscale.com/version.shortStamp=$(patsubst v%,%,$(SHAREOS_TAILSCALE_VERSION))

define SHAREOS_TAILSCALE_INSTALL_CLI
	ln -sf tailscaled $(TARGET_DIR)/usr/bin/tailscale
endef
SHAREOS_TAILSCALE_POST_INSTALL_TARGET_HOOKS += SHAREOS_TAILSCALE_INSTALL_CLI

$(eval $(golang-package))
