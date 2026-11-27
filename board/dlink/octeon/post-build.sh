#!/bin/bash
#
# ShareOS post-build (Cavium OCTEON boxes): the steps of the other boxes with
# the names of this platform. $1 = TARGET_DIR
#
set -e
BOARD_DIR="$(dirname "$0")"
SHAREOS_BOARD=octeon SHAREOS_FWNAME=DNS-1200-05-rev-Ax \
	"$BOARD_DIR/../dns320l/post-build.sh" "$@"
