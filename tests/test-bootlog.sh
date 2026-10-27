#!/bin/sh
#
# Tests shareos-bootlog (snapshots of the last starts, kept on the flash):
# save, keep the newest 3, list as JSON, show, refuse other names.
#
#   tests/test-bootlog.sh
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
B="$TOP/src/shareos-core/usr/sbin/shareos-bootlog"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export SHAREOS_ROOT=$T
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }

for i in 1 2 3 4; do sh "$B" save >/dev/null; sleep 1.1; done
check "four saves, the newest three kept" "[ \$(ls $T/etc/shareos/bootlog/*.txt.gz | wc -l) = 3 ]"
L=$(sh "$B" list)
check "list: JSON, newest first" "echo '$L' | python3 -c 'import json,sys; l=json.load(sys.stdin)[\"logs\"]; n=[x[\"name\"] for x in l]; sys.exit(0 if len(l)==3 and n==sorted(n, reverse=True) and all(x[\"size\"]>0 for x in l) else 1)'"
N=$(echo "$L" | python3 -c 'import json,sys; print(json.load(sys.stdin)["logs"][0]["name"])')
check "show: the sections are there" "sh '$B' show $N | grep -q '^===== system log' && sh '$B' show $N | grep -q '^===== addresses'"
check "show: other names refused" "! sh '$B' show ../../etc/passwd 2>/dev/null && ! sh '$B' show 20990101-000000 2>/dev/null"
check "no temporary files left" "[ -z \"\$(ls -A $T/etc/shareos/bootlog | grep -v '\\.txt\\.gz\$')\" ]"

echo
echo "test-bootlog: $pass passed, $failed failed"
[ $failed -eq 0 ]
