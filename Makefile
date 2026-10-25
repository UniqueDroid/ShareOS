# ShareOS – top-level build wrapper around buildroot (BR2_EXTERNAL tree)
#
#   make dns320l            build the DNS-320L firmware
#   make dns320l-menuconfig change buildroot options of that board
#   make dns320l-linux-menuconfig
#   make sysapps-pack       build the system apps (nano, htop …) as .sapp
#   make clean              remove build output (keeps downloads)
#
# Variables:
#   BR_VERSION  buildroot release (current stable)
#   O           build directory   (default: output/<board>)
#   DL          download cache    (default: dl/, or $BR2_DL_DIR)

BR_VERSION ?= 2026.08.1
BR_SHA256  ?= 38a6c152490096018720a9ade379ee1e571c9bf5f93a3657a166566945a98b0d
BR_URL     := https://buildroot.org/downloads/buildroot-$(BR_VERSION).tar.gz

TOP   := $(CURDIR)
BR    := $(TOP)/buildroot/buildroot-$(BR_VERSION)
DL    ?= $(if $(BR2_DL_DIR),$(BR2_DL_DIR),$(TOP)/dl)
BOARDS := dns320l
# not a board: native programs packed as system apps (see tools/sysapps)
EXTRA := sysapps

.PHONY: all clean distclean $(BOARDS) sysapps sysapps-pack buildroot

all: $(BOARDS)

$(BR)/Makefile:
	mkdir -p $(TOP)/buildroot $(DL)
	cd $(TOP)/buildroot && curl -fL -o buildroot-$(BR_VERSION).tar.gz $(BR_URL)
	cd $(TOP)/buildroot && echo "$(BR_SHA256)  buildroot-$(BR_VERSION).tar.gz" | sha256sum -c -
	cd $(TOP)/buildroot && tar xzf buildroot-$(BR_VERSION).tar.gz && rm buildroot-$(BR_VERSION).tar.gz

buildroot: $(BR)/Makefile

define board_rules
$(1)_O := $$(if $$(O),$$(O),$$(TOP)/output/$(1))

$$($(1)_O)/.config: $$(BR)/Makefile $$(TOP)/configs/shareos_$(1)_defconfig
	$$(MAKE) -C $$(BR) O=$$($(1)_O) BR2_EXTERNAL=$$(TOP) BR2_DL_DIR=$$(DL) shareos_$(1)_defconfig

$(1): $$($(1)_O)/.config
	$$(MAKE) -C $$(BR) O=$$($(1)_O) BR2_DL_DIR=$$(DL)

$(1)-%: $$($(1)_O)/.config
	$$(MAKE) -C $$(BR) O=$$($(1)_O) BR2_DL_DIR=$$(DL) $$*
endef
$(foreach b,$(BOARDS) $(EXTRA),$(eval $(call board_rules,$(b))))

# system apps (.sapp) for the app store: needs the toolchain of make dns320l
sysapps-pack: sysapps
	python3 $(TOP)/tools/sysapps/pack.py $(sysapps_O)/target $(sysapps_O)/sapp

clean:
	rm -rf $(TOP)/output

distclean: clean
	rm -rf $(TOP)/buildroot
