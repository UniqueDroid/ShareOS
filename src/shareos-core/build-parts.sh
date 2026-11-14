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
	[ -f "$1/ORDER" ] || { echo "build-parts: $1/ORDER is missing" >&2; exit 1; }
	# every part is in ORDER and every name in ORDER is a part
	for f in "$1"/*.js "$1"/*.uc; do
		[ -e "$f" ] || continue
		grep -qxF "${f##*/}" "$1/ORDER" || { echo "build-parts: ${f##*/} is not in $1/ORDER" >&2; exit 1; }
	done
	: > "$2.new"
	while IFS= read -r name; do
		case "$name" in ''|'#'*) continue ;; esac
		[ -f "$1/$name" ] || { echo "build-parts: $1/ORDER names $name, which is not there" >&2; exit 1; }
		cat "$1/$name" >> "$2.new"
	done < "$1/ORDER"
	# an unchanged result keeps its time stamp
	if cmp -s "$2.new" "$2" 2>/dev/null; then rm -f "$2.new"; else mv -f "$2.new" "$2"; fi
}

mkdir -p "$D/www" "$D/usr/share/rpcd/ucode"
join_parts "$D/parts/web" "$D/www/app.js"
join_parts "$D/parts/rpc" "$D/usr/share/rpcd/ucode/shareos.uc"
