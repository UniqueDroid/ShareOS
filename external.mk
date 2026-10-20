include $(sort $(wildcard $(BR2_EXTERNAL_SHAREOS_PATH)/package/*/*.mk))

# libwebsockets is only there for ttyd (System -> Terminal):
# - no HTTP/2: over HTTPS the browser would speak h2, which has no Host header,
#   and ttyd's origin check (-O) then refuses the terminal's WebSocket
# - no secure streams / connection monitor (and no HTML parser, which pulls
#   secure streams in): they ask
#   connectivitycheck.android.com in the background (captive portal check)
LIBWEBSOCKETS_CONF_OPTS += -DLWS_WITH_HTTP2=OFF -DLWS_WITH_SECURE_STREAMS=OFF -DLWS_WITH_CONMON=OFF \
	-DLWS_WITH_LHP=OFF

# TLS of ttyd through mbedtls, like curl and uhttpd – ttyd selects OpenSSL,
# whose 4.5 MB of libraries post-build.sh then removes (nothing else uses them)
LIBWEBSOCKETS_DEPENDENCIES += mbedtls
LIBWEBSOCKETS_CONF_OPTS += -DLWS_WITH_SSL=ON -DLWS_WITH_MBEDTLS=ON
# libevent (libevent_core for NFS' fsidd) without its OpenSSL part
LIBEVENT_CONF_OPTS += --disable-openssl
