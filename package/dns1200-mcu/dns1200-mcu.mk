################################################################################
#
# dns1200-mcu
#
################################################################################

DNS1200_MCU_VERSION = 0.1
DNS1200_MCU_SITE = $(BR2_EXTERNAL_SHAREOS_PATH)/src/dns1200-mcu
DNS1200_MCU_SITE_METHOD = local
DNS1200_MCU_LICENSE = GPL-2.0+

define DNS1200_MCU_BUILD_CMDS
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -Wall -Wextra \
		-o $(@D)/dns1200-mcu $(@D)/dns1200-mcu.c
endef

define DNS1200_MCU_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/dns1200-mcu $(TARGET_DIR)/usr/sbin/dns1200-mcu
endef

$(eval $(generic-package))
