################################################################################
#
# shareos-zabbix-agent – the classic Zabbix agent (C) only, built with musl
#
################################################################################

# 7.0 LTS (buildroot's "zabbix" is 7.2 and needs glibc)
SHAREOS_ZABBIX_AGENT_VERSION_MAJOR = 7.0
SHAREOS_ZABBIX_AGENT_VERSION = $(SHAREOS_ZABBIX_AGENT_VERSION_MAJOR).32
SHAREOS_ZABBIX_AGENT_SOURCE = zabbix-$(SHAREOS_ZABBIX_AGENT_VERSION).tar.gz
SHAREOS_ZABBIX_AGENT_SITE = https://cdn.zabbix.com/zabbix/sources/stable/$(SHAREOS_ZABBIX_AGENT_VERSION_MAJOR)
SHAREOS_ZABBIX_AGENT_LICENSE = AGPL-3.0
SHAREOS_ZABBIX_AGENT_LICENSE_FILES = COPYING
SHAREOS_ZABBIX_AGENT_CPE_ID_VENDOR = zabbix
SHAREOS_ZABBIX_AGENT_CPE_ID_PRODUCT = zabbix

SHAREOS_ZABBIX_AGENT_DEPENDENCIES = host-pkgconf pcre2 openssl
# only zabbix_agentd: no server, proxy, Java gateway, web service, Go agent 2;
# nothing optional (curl, XML, LDAP, SSH, SNMP, IPMI) – the agent's items for
# web pages and the like are not needed on the NAS
SHAREOS_ZABBIX_AGENT_CONF_OPTS = \
	--enable-agent \
	--disable-agent2 \
	--disable-server \
	--disable-proxy \
	--disable-java \
	--disable-webservice \
	--enable-ipv6 \
	--with-libpcre2 \
	--with-openssl=$(STAGING_DIR)/usr \
	--without-gnutls \
	--without-libcurl \
	--without-libxml2 \
	--without-ldap \
	--without-ssh2 \
	--without-net-snmp \
	--without-openipmi \
	--without-sqlite3 \
	--without-mysql \
	--without-postgresql

# only the program – the configuration is written by shareos-zabbix; named
# zabbix-agentd, as commands of system apps have no "_"
define SHAREOS_ZABBIX_AGENT_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/src/zabbix_agent/zabbix_agentd $(TARGET_DIR)/usr/sbin/zabbix-agentd
endef

$(eval $(autotools-package))
