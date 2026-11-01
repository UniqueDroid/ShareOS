################################################################################
#
# shareos-ipp-usb – IPP over USB proxy for the system app "printer"
#
################################################################################

SHAREOS_IPP_USB_VERSION = 0.9.34
SHAREOS_IPP_USB_SITE = https://github.com/OpenPrinting/ipp-usb.git
SHAREOS_IPP_USB_SITE_METHOD = git
SHAREOS_IPP_USB_LICENSE = BSD-2-Clause
SHAREOS_IPP_USB_LICENSE_FILES = LICENSE
SHAREOS_IPP_USB_GOMOD = github.com/OpenPrinting/ipp-usb
SHAREOS_IPP_USB_DEPENDENCIES = libusb host-pkgconf
SHAREOS_IPP_USB_GO_ENV = GOPROXY=https://proxy.golang.org,direct
SHAREOS_IPP_USB_BUILD_TARGETS = .
# no symbol tables: about a third smaller
SHAREOS_IPP_USB_LDFLAGS = -s -w
SHAREOS_IPP_USB_BIN_NAME = ipp-usb

# the quirks of known devices (the box keeps them with the program)
define SHAREOS_IPP_USB_INSTALL_QUIRKS
	mkdir -p $(TARGET_DIR)/usr/share/ipp-usb/quirks
	cp $(@D)/ipp-usb-quirks/*.conf $(TARGET_DIR)/usr/share/ipp-usb/quirks/
endef
SHAREOS_IPP_USB_POST_INSTALL_TARGET_HOOKS += SHAREOS_IPP_USB_INSTALL_QUIRKS

$(eval $(golang-package))
