################################################################################
#
# shareos-autobrr – autobrr (download automation) for the system app "autobrr"
#
################################################################################

# needs Go 1.27 (buildroot 2026.08.1 has 1.27.2)
SHAREOS_AUTOBRR_VERSION = v1.89.0
SHAREOS_AUTOBRR_SITE = https://github.com/autobrr/autobrr.git
SHAREOS_AUTOBRR_SITE_METHOD = git
SHAREOS_AUTOBRR_LICENSE = GPL-2.0-or-later
SHAREOS_AUTOBRR_LICENSE_FILES = LICENSE
SHAREOS_AUTOBRR_GOMOD = github.com/autobrr/autobrr
# modules through the Go module proxy (see shareos-tailscale); SQLite is pure
# Go (modernc), so no cgo
SHAREOS_AUTOBRR_GO_ENV = GOPROXY=https://proxy.golang.org,direct CGO_ENABLED=0
SHAREOS_AUTOBRR_BUILD_TARGETS = cmd/autobrr
SHAREOS_AUTOBRR_LDFLAGS = -s -w -X main.version=$(patsubst v%,%,$(SHAREOS_AUTOBRR_VERSION))

# the web interface: built by autobrr's release (it needs Node 24 to build),
# embedded into the binary from web/dist
SHAREOS_AUTOBRR_EXTRA_DOWNLOADS = \
	https://github.com/autobrr/autobrr/releases/download/$(SHAREOS_AUTOBRR_VERSION)/web-dist.tar.gz

define SHAREOS_AUTOBRR_WEB_DIST
	rm -rf $(@D)/web/dist
	$(TAR) -xzf $(SHAREOS_AUTOBRR_DL_DIR)/web-dist.tar.gz -C $(@D)
	test -f $(@D)/web/dist/index.html
	# source maps are 9 of the 12 MB and only help developers
	find $(@D)/web/dist -name '*.map' -delete
endef
SHAREOS_AUTOBRR_POST_EXTRACT_HOOKS += SHAREOS_AUTOBRR_WEB_DIST

$(eval $(golang-package))
