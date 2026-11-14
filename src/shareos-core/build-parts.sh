#!/bin/sh
#
# Puts the web interface (www/app.js) and the rpcd plugin
# (usr/share/rpcd/ucode/shareos.uc) together from their parts. The parts are
# the source: one file per area under parts/web and parts/rpc, joined in the
# order of the file ORDER next to them. The two results are not in the
# repository.
#
#   src/shareos-core/build-parts.sh [directory of shareos-core]
#
set -e
D=${1:-$(dirname "$0")}

join_parts() {  # directory of the parts, result
	rm -f "$2.methods"
	[ -f "$1/ORDER" ] || { echo "build-parts: $1/ORDER is missing" >&2; exit 1; }
	# every part is in ORDER and every name in ORDER is a part
	for f in "$1"/*.js "$1"/*.uc; do
		[ -e "$f" ] || continue
		grep -qxF "${f##*/}" "$1/ORDER" || { echo "build-parts: ${f##*/} is not in $1/ORDER" >&2; exit 1; }
	done
	: > "$2.new"; : > "$2.late"
	while IFS= read -r name; do
		case "$name" in ''|'#'*) continue ;; esac
		[ -f "$1/$name" ] || { echo "build-parts: $1/ORDER names $name, which is not there" >&2; exit 1; }
		# A part of the plugin has its helper functions first and, below the
		# line "methods", its ubus methods. ucode knows a function only after
		# its definition, and methods use helpers of other parts: all helpers
		# are joined first, all methods after them.
		awk -v late="$2.late" '/^\/\* =+ methods / { m = 1 } { if (m) print > late; else print }' "$1/$name" >> "$2.new"
		[ -s "$2.late" ] && cat "$2.late" >> "$2.methods"
		: > "$2.late"
	done < "$1/ORDER"
	[ -f "$2.methods" ] && cat "$2.methods" >> "$2.new"
	rm -f "$2.late" "$2.methods"
	# an unchanged result keeps its time stamp
	if cmp -s "$2.new" "$2" 2>/dev/null; then rm -f "$2.new"; else mv -f "$2.new" "$2"; fi
}

mkdir -p "$D/www" "$D/usr/share/rpcd/ucode"
join_parts "$D/parts/web" "$D/www/app.js"
join_parts "$D/parts/rpc" "$D/usr/share/rpcd/ucode/shareos.uc"
