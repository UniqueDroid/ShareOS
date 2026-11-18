#!/bin/sh
#
# Tests the background file jobs of the plugin (parts/rpc/files-jobs.uc):
# a short command answers at once, a long one goes on as a job that reports
# how far a copy is (total_kb, done_kb), and it can be stopped – with
# everything it started. Runs the part with the host's ucode and
# start-stop-daemon; the helpers of other parts are stand-ins here.
#
#   tests/test-file-jobs.sh [dir with ucode]      (LD_LIBRARY_PATH for its libraries)
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
BIN=${1:-}
UCODE=${BIN:+$BIN/}ucode
PART="$TOP/src/shareos-core/parts/rpc/files-jobs.uc"
PATH=$PATH:/usr/sbin:/sbin; export PATH
T=$(mktemp -d); trap 'pkill -f "$T" 2>/dev/null; pkill -x -f "sleep 6[78]" 2>/dev/null; rm -rf "$T"' EXIT
mkdir -p $T/src/dir $T/dst
dd if=/dev/zero of=$T/src/big bs=1024 count=3000 2>/dev/null
dd if=/dev/zero of=$T/src/dir/more bs=1024 count=1000 2>/dev/null
{
	cat <<'UC'
import { readfile, writefile, stat, lsdir } from 'fs';
function shq(s) { return "'" + replace(s, "'", "'\\''") + "'"; }
function read_trim(path) { let d = readfile(path); return d != null ? trim(d) : null; }
function new_token() { let r = readfile('/dev/urandom', 16) ?? '', t = ''; for (let i = 0; i < length(r); i++) t += sprintf('%02x', ord(r, i)); return t; }
function acc_role(u) { return 'admin'; }
function files_err(r) { return r.out || 'failed'; }
UC
	sed "s|'/tmp/shareos-filejobs'|'$T/jobs'|" "$PART"
	cat <<'UC'
let a = ARGV, r;
if (a[0] == 'bg') r = files_bg(a[1], a[2], false, a[3] ? { src: split(a[3], ':'), dst: split(a[4], ':') } : null);
else if (a[0] == 'job') r = files_job(a[1], a[2]);
else if (a[0] == 'cancel') r = files_job_cancel(a[1], a[2]);
printf('%J\n', r);
UC
} > $T/t.uc
run() { "$UCODE" -L "${BIN:+$BIN/../lib/ucode}" $T/t.uc "$@"; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }
jv() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }

check "a short command answers at once" "run bg jan 'cp -a -- $T/src/dir $T/dst/' | js \"d=={'ok':True}\" && [ -f $T/dst/dir/more ] && [ -z \"\$(ls $T/jobs)\" ]"
check "a failing command reports what the tool said" "run bg jan 'cp -a -- $T/src/nothing $T/dst/' | js \"'nothing' in d['error']\" && [ -z \"\$(ls $T/jobs)\" ]"

# a copy that takes long: the files are there, the command goes on
R=$(run bg jan "cp -a -- $T/src/big $T/src/dir $T/dst/new/ 2>/dev/null; mkdir -p $T/dst/new && cp -a -- $T/src/big $T/dst/new/ && cp -a -- $T/src/dir $T/dst/new/ && sleep 67" "$T/src/big:$T/src/dir" "$T/dst/new/big:$T/dst/new/dir")
ID=$(echo "$R" | jv job)
check "a long one goes on as a job" "echo '$R' | js \"d['ok'] and d['running'] and len(d['job'])==16\""
sleep 3
P=$(run job jan "$ID")
check "the job tells what the sources take" "echo '$P' | js \"d['running'] and 3900 <= d['total_kb'] <= 4200\""
check "… and what is copied so far" "echo '$P' | js \"3900 <= d['done_kb'] <= d['total_kb']\""
check "another account does not see the job" "run job lisa $ID | js \"d['error']=='unknown job'\" && run cancel lisa $ID | js \"d['error']=='unknown job'\""
PG=$(ps -o pgid= -p "$(cat $T/jobs/$ID/pid)" | tr -d ' ')
check "cancel stops it" "run cancel jan $ID | js \"d=={'ok':True}\""
sleep 1
# what is left of the job's process group (ended processes that nobody collected yet do not count)
left() { ps -eo pgid=,stat=,args= | awk -v g="$PG" '$1 == g && $2 !~ /^Z/'; }
check "… with everything it started (the command, the counting)" "[ -n \"$PG\" ] && [ -z \"\$(left)\" ]"
left | sed 's/^/      still running: /'
check "the job reports cancelled, what was copied stays" "run job jan $ID | js \"d=={'ok':True,'cancelled':True}\" && [ -f $T/dst/new/big ]"
check "afterwards the job is gone" "run job jan $ID | js \"d['error']=='unknown job'\" && [ -z \"\$(ls $T/jobs)\" ]"

# the shell of the job killed from outside: not "cancelled"
R=$(run bg jan "sleep 68"); ID=$(echo "$R" | jv job)
kill -KILL "$(cat $T/jobs/$ID/pid)"; sleep 1
check "a job killed from outside is reported as interrupted" "run job jan $ID | js \"'interrupted' in d['error']\""
# a job without progress (delete) has no numbers
R=$(run bg jan "sleep 4"); ID=$(echo "$R" | jv job)
check "a job without counting has no numbers" "run job jan $ID | js \"d['running'] and 'total_kb' not in d and 'done_kb' not in d\""
sleep 5
check "… and ends with its result" "run job jan $ID | js \"d=={'ok':True}\""
check "cancel of an unknown or malformed job is refused" "run cancel jan 0123456789abcdef | js \"d['error']=='unknown job'\" && run cancel jan '../x' | js \"d['error']=='unknown job'\""

echo
echo "test-file-jobs: $pass passed, $failed failed"
[ $failed -eq 0 ]
