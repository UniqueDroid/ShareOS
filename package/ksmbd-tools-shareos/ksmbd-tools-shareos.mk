################################################################################
#
# ksmbd-tools-shareos
#
################################################################################

# Same as buildroot's ksmbd-tools, in version 3.5.3 (buildroot has 3.5.2, which
# does not pass the supplementary groups of a user to the kernel). Drop this
# package when buildroot has caught up.

KSMBD_TOOLS_SHAREOS_VERSION = 3.5.3
KSMBD_TOOLS_SHAREOS_SOURCE = ksmbd-tools-$(KSMBD_TOOLS_SHAREOS_VERSION).tar.gz
KSMBD_TOOLS_SHAREOS_SITE = https://github.com/cifsd-team/ksmbd-tools/releases/download/$(KSMBD_TOOLS_SHAREOS_VERSION)
KSMBD_TOOLS_SHAREOS_LICENSE = GPL-2.0+
KSMBD_TOOLS_SHAREOS_LICENSE_FILES = COPYING
KSMBD_TOOLS_SHAREOS_DEPENDENCIES = host-pkgconf libglib2 libnl

ifeq ($(BR2_PACKAGE_LIBKRB5),y)
KSMBD_TOOLS_SHAREOS_CONF_OPTS += --enable-krb5
KSMBD_TOOLS_SHAREOS_DEPENDENCIES += libkrb5
else
KSMBD_TOOLS_SHAREOS_CONF_OPTS += --disable-krb5
endif

$(eval $(autotools-package))
