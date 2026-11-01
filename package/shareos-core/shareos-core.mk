################################################################################
#
# shareos-core
#
################################################################################

SHAREOS_CORE_VERSION = 0.1
SHAREOS_CORE_SITE = $(BR2_EXTERNAL_SHAREOS_PATH)/src/shareos-core
SHAREOS_CORE_SITE_METHOD = local
SHAREOS_CORE_LICENSE = GPL-2.0+
SHAREOS_CORE_DEPENDENCIES = uci ubus ucode rpcd uhttpd libcurl alt-f-utils mbedtls
# our S40network replaces the one from ifupdown-scripts, so install after it
ifeq ($(BR2_PACKAGE_IFUPDOWN_SCRIPTS),y)
SHAREOS_CORE_DEPENDENCIES += ifupdown-scripts
endif
# our avahi-daemon.conf replaces the default one
ifeq ($(BR2_PACKAGE_AVAHI_DAEMON),y)
SHAREOS_CORE_DEPENDENCIES += avahi
endif
# same for rcS (skips services with autostart off)
ifeq ($(BR2_PACKAGE_INITSCRIPTS),y)
SHAREOS_CORE_DEPENDENCIES += initscripts
endif

# password encryption for settings backups (AES-256-GCM via mbedTLS)
define SHAREOS_CORE_BUILD_CMDS
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -o $(@D)/shareos-crypt $(@D)/src/shareos-crypt.c -lmbedcrypto
endef

define SHAREOS_CORE_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/shareos-crypt $(TARGET_DIR)/usr/sbin/shareos-crypt
	$(INSTALL) -D -m 0644 $(@D)/etc/config/shareos $(TARGET_DIR)/etc/config/shareos
	$(INSTALL) -D -m 0600 $(@D)/etc/config/rpcd $(TARGET_DIR)/etc/config/rpcd
	$(INSTALL) -D -m 0644 $(@D)/etc/config/storage $(TARGET_DIR)/etc/config/storage
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S20storage $(TARGET_DIR)/etc/init.d/S20storage
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-storage $(TARGET_DIR)/usr/sbin/shareos-storage
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-usb $(TARGET_DIR)/usr/sbin/shareos-usb
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-app-notify $(TARGET_DIR)/usr/sbin/shareos-app-notify
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S12ubus $(TARGET_DIR)/etc/init.d/S12ubus
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S13rpcd $(TARGET_DIR)/etc/init.d/S13rpcd
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S50uhttpd $(TARGET_DIR)/etc/init.d/S50uhttpd
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-update $(TARGET_DIR)/usr/sbin/shareos-update
	$(INSTALL) -D -m 0644 $(@D)/usr/share/rpcd/ucode/shareos.uc $(TARGET_DIR)/usr/share/rpcd/ucode/shareos.uc
	$(INSTALL) -D -m 0644 $(@D)/usr/share/rpcd/acl.d/shareos.json $(TARGET_DIR)/usr/share/rpcd/acl.d/shareos.json
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-uhttpd $(TARGET_DIR)/usr/sbin/shareos-uhttpd
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-cert $(TARGET_DIR)/usr/sbin/shareos-cert
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-altf $(TARGET_DIR)/usr/sbin/shareos-altf
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-factory-reset $(TARGET_DIR)/usr/sbin/shareos-factory-reset
	$(INSTALL) -D -m 0644 $(@D)/www-apps/_shareos/theme.css $(TARGET_DIR)/www-apps/_shareos/theme.css
	$(INSTALL) -D -m 0644 $(@D)/www-apps/_shareos/app.js $(TARGET_DIR)/www-apps/_shareos/app.js
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/file $(TARGET_DIR)/www-apps/_shareos/cgi/file
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/fs $(TARGET_DIR)/www-apps/_shareos/cgi/fs
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/transmission $(TARGET_DIR)/www-apps/_shareos/cgi/transmission
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/media $(TARGET_DIR)/www-apps/_shareos/cgi/media
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-media $(TARGET_DIR)/usr/sbin/shareos-media
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-snapshot $(TARGET_DIR)/usr/sbin/shareos-snapshot
	$(INSTALL) -D -m 0644 $(@D)/etc/config/snapshots $(TARGET_DIR)/etc/config/snapshots
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-transmission $(TARGET_DIR)/usr/sbin/shareos-transmission
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S90services $(TARGET_DIR)/etc/init.d/S90services
	# before 0.2.0-beta.9 every service had its own init script and removal hook
	rm -rf $(TARGET_DIR)/etc/init.d/S93tailscale $(TARGET_DIR)/etc/init.d/S94vpn $(TARGET_DIR)/etc/init.d/S95transmission $(TARGET_DIR)/etc/init.d/S96dlna $(TARGET_DIR)/usr/lib/shareos/apphooks
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-vpn $(TARGET_DIR)/usr/sbin/shareos-vpn
	$(INSTALL) -D -m 0644 $(@D)/etc/config/vpn $(TARGET_DIR)/etc/config/vpn
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/vpn $(TARGET_DIR)/www-apps/_shareos/cgi/vpn
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-tailscale $(TARGET_DIR)/usr/sbin/shareos-tailscale
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-autobrr $(TARGET_DIR)/usr/sbin/shareos-autobrr
	$(INSTALL) -D -m 0644 $(@D)/etc/config/autobrr $(TARGET_DIR)/etc/config/autobrr
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/autobrr $(TARGET_DIR)/www-apps/_shareos/cgi/autobrr
	$(INSTALL) -D -m 0644 $(@D)/etc/config/tailscale $(TARGET_DIR)/etc/config/tailscale
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/tailscale $(TARGET_DIR)/www-apps/_shareos/cgi/tailscale
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/status $(TARGET_DIR)/www-apps/_shareos/cgi/status
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/sysinfo $(TARGET_DIR)/www-apps/_shareos/cgi/sysinfo
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/netcheck $(TARGET_DIR)/www-apps/_shareos/cgi/netcheck
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/notify $(TARGET_DIR)/www-apps/_shareos/cgi/notify
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/docker $(TARGET_DIR)/www-apps/_shareos/cgi/docker
	$(INSTALL) -D -m 0755 $(@D)/www-apps/_shareos/cgi/tuya $(TARGET_DIR)/www-apps/_shareos/cgi/tuya
	$(INSTALL) -D -m 0644 $(@D)/etc/config/dockerhosts $(TARGET_DIR)/etc/config/dockerhosts
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-dlna $(TARGET_DIR)/usr/sbin/shareos-dlna
	$(INSTALL) -D -m 0644 $(@D)/etc/config/dlna $(TARGET_DIR)/etc/config/dlna
	$(INSTALL) -D -m 0644 $(@D)/etc/config/ups $(TARGET_DIR)/etc/config/ups
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-zabbix $(TARGET_DIR)/usr/sbin/shareos-zabbix
	$(INSTALL) -D -m 0644 $(@D)/etc/config/zabbix $(TARGET_DIR)/etc/config/zabbix
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-reset-access $(TARGET_DIR)/usr/sbin/shareos-reset-access
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-terminal $(TARGET_DIR)/usr/sbin/shareos-terminal
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-buttons $(TARGET_DIR)/usr/sbin/shareos-buttons
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-notify $(TARGET_DIR)/usr/sbin/shareos-notify
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-net $(TARGET_DIR)/usr/sbin/shareos-net
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S40network $(TARGET_DIR)/etc/init.d/S40network
	$(INSTALL) -D -m 0644 $(@D)/etc/config/network $(TARGET_DIR)/etc/config/network
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/rcS $(TARGET_DIR)/etc/init.d/rcS
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-bootlog $(TARGET_DIR)/usr/sbin/shareos-bootlog
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-power $(TARGET_DIR)/usr/sbin/shareos-power
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-ups $(TARGET_DIR)/usr/sbin/shareos-ups
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-ddns $(TARGET_DIR)/usr/sbin/shareos-ddns
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-ca $(TARGET_DIR)/usr/sbin/shareos-ca
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-acme $(TARGET_DIR)/usr/sbin/shareos-acme
	$(INSTALL) -D -m 0755 $(@D)/usr/libexec/shareos-acme-hook $(TARGET_DIR)/usr/libexec/shareos-acme-hook
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-users $(TARGET_DIR)/usr/sbin/shareos-users
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-shares $(TARGET_DIR)/usr/sbin/shareos-shares
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-quota $(TARGET_DIR)/usr/sbin/shareos-quota
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S70shares $(TARGET_DIR)/etc/init.d/S70shares
	$(INSTALL) -D -m 0644 $(@D)/etc/config/accounts $(TARGET_DIR)/etc/config/accounts
	$(INSTALL) -D -m 0644 $(@D)/etc/config/shares $(TARGET_DIR)/etc/config/shares
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-paperless $(TARGET_DIR)/usr/sbin/shareos-paperless
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-cloud $(TARGET_DIR)/usr/sbin/shareos-cloud
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-cron $(TARGET_DIR)/usr/sbin/shareos-cron
	$(INSTALL) -D -m 0644 $(@D)/etc/config/paperless $(TARGET_DIR)/etc/config/paperless
	$(INSTALL) -D -m 0644 $(@D)/etc/config/cloud $(TARGET_DIR)/etc/config/cloud
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S50avahi-daemon $(TARGET_DIR)/etc/init.d/S50avahi-daemon
	$(INSTALL) -D -m 0644 $(@D)/etc/avahi/avahi-daemon.conf $(TARGET_DIR)/etc/avahi/avahi-daemon.conf
	$(INSTALL) -D -m 0644 $(@D)/etc/avahi/services/shareos-web.service $(TARGET_DIR)/etc/avahi/services/shareos-web.service
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-flash-bin $(TARGET_DIR)/usr/sbin/shareos-flash-bin
	$(INSTALL) -D -m 0755 $(@D)/usr/sbin/shareos-apps $(TARGET_DIR)/usr/sbin/shareos-apps
	$(INSTALL) -D -m 0755 $(@D)/etc/init.d/S51apps $(TARGET_DIR)/etc/init.d/S51apps
	$(INSTALL) -D -m 0644 $(@D)/etc/config/apps $(TARGET_DIR)/etc/config/apps
	rm -rf $(TARGET_DIR)/www
	cp -a $(@D)/www $(TARGET_DIR)/www
endef

$(eval $(generic-package))
