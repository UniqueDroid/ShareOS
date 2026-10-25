#!/bin/bash
# Builds libubox, uci and ucode for the build host at the same commits the
# firmware uses (taken from package/*/*.mk), into <prefix>. Used by CI tests.
set -euo pipefail
PREFIX=${1:?install prefix}
TOP=$(cd "$(dirname "$0")/.." && pwd)
BR=${BR:-$TOP/buildroot/buildroot-2026.08.1}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT

ver() { sed -n "s/^$2_VERSION = //p" "$1"; }
LIBUBOX=$(ver "$BR/package/libubox/libubox.mk" LIBUBOX 2>/dev/null || true)
UCI=$(ver "$TOP/package/uci/uci.mk" UCI)
UCODE=$(ver "$TOP/package/ucode/ucode.mk" UCODE)

build() { # name url commit [cmake args]
	local n=$1 url=$2 c=$3; shift 3
	git clone -q "$url" "$W/$n"
	[ -n "$c" ] && git -C "$W/$n" checkout -q "$c"
	cmake -S "$W/$n" -B "$W/b-$n" -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX" \
		-DCMAKE_C_FLAGS="-I$PREFIX/include" -DCMAKE_EXE_LINKER_FLAGS="-L$PREFIX/lib" \
		-DCMAKE_SHARED_LINKER_FLAGS="-L$PREFIX/lib" "$@" >/dev/null
	make -C "$W/b-$n" -j"$(nproc)" >/dev/null
	make -C "$W/b-$n" install >/dev/null
	echo "built $n ${c:-HEAD}"
}
build libubox https://github.com/openwrt/libubox "$LIBUBOX" -DBUILD_LUA=OFF -DBUILD_EXAMPLES=OFF
build uci     https://github.com/openwrt/uci     "$UCI"     -DBUILD_LUA=OFF
build ucode   https://github.com/jow-/ucode      "$UCODE"   -DUBUS_SUPPORT=OFF -DNL80211_SUPPORT=OFF \
	-DRTNL_SUPPORT=OFF -DDIGEST_SUPPORT=OFF -DZLIB_SUPPORT=OFF
