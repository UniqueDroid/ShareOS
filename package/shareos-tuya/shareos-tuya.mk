################################################################################
#
# shareos-tuya
#
################################################################################

SHAREOS_TUYA_VERSION = 1.0.0
SHAREOS_TUYA_SITE = $(BR2_EXTERNAL_SHAREOS_PATH)/src/shareos-tuya
SHAREOS_TUYA_SITE_METHOD = local
SHAREOS_TUYA_LICENSE = GPL-2.0-only
SHAREOS_TUYA_DEPENDENCIES = mbedtls

define SHAREOS_TUYA_BUILD_CMDS
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -Wall -o $(@D)/shareos-tuya $(@D)/shareos-tuya.c -lmbedcrypto
endef

define SHAREOS_TUYA_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/shareos-tuya $(TARGET_DIR)/usr/sbin/shareos-tuya
endef

$(eval $(generic-package))
