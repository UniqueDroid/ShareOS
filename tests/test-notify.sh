#!/bin/bash
#
# Tests shareos-notify (messages, dedup, checks, delivery commands) on a
# fake root with the host ucode; deliveries are printed (SHAREOS_NOTIFY_DRY).
#
#   LD_LIBRARY_PATH=<hostroot>/lib tests/test-notify.sh <hostroot>/bin
#
set -u
BIN=${1:?path to the host ucode/uci binaries}
TOP=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
R=$T/root; mkdir -p "$R/etc/config" "$R/proc" "$R/tmp/sys" "$R/tmp/shareos-storage" "$R/tmp/shareos-update"
cp "$TOP/src/shareos-core/etc/config/shareos" "$TOP/src/shareos-core/etc/config/storage" "$R/etc/config/"
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; echo "      ${3:-}"; failed=$((failed+1)); fi; }
N() { SHAREOS_ROOT=$R SHAREOS_NOTIFY_DRY=1 "$BIN/ucode" -L "$(dirname "$BIN")/lib/ucode" -S "$TOP/src/shareos-core/usr/sbin/shareos-notify" "$@" 2>&1; }
U="$BIN/uci -c $R/etc/config"
js() { python3 -c "import json,sys; d=json.loads(sys.stdin.read().strip().splitlines()[-1]); sys.exit(0 if ($1) else 1)"; }

o=$(N send warn storage test-1 'Titel' 'Title' 'Text' 'Text en'); check "send stores a message" "echo '$o' | js \"d['ok'] and d['sent']\"" "$o"
o=$(N send warn storage test-1 'Titel' 'Title'); check "same key again: counted, not sent again" "echo '$o' | js \"d['ok'] and not d['sent']\" && N list | js \"len(d['items'])==1 and d['items'][0]['count']==2 and d['unread']==1\"" "$o"
m1=$(stat -c %Y.%s "$R/etc/shareos/notifications.json"); sleep 1
o=$(N send warn storage test-1 'Titel' 'Title'); check "same message again within an hour: the list in the flash is not rewritten" "[ \"\$(stat -c %Y.%s $R/etc/shareos/notifications.json)\" = '$m1' ] && N list | js \"d['items'][0]['count']==2\"" "$o"
o=$(N send oops storage x T T); check "invalid level rejected" "echo '$o' | grep -q usage" "$o"
N clear test-1 >/dev/null
o=$(N send warn storage test-1 'Titel' 'Title'); check "after clear: a new message" "N list | js \"len(d['items'])==2 and d['unread']==1\"" "$o"
id=$(N list | python3 -c 'import json,sys; print(json.load(sys.stdin)["items"][0]["id"])')
N read "$id" >/dev/null; check "read marks it" "N list | js \"d['unread']==0\""
N delete all >/dev/null; check "delete all" "N list | js \"d['items']==[]\""

# delivery: nothing configured -> nothing sent; e-mail and ntfy
o=$(N send error storage k1 'A' 'A'); check "no channel switched on: nothing delivered" "! echo '$o' | grep -q '^deliver:'" "$o"
$U set shareos.notify=notify; $U set shareos.notify.email=1; $U set shareos.notify.smtp_host=mail.example.org; $U set shareos.notify.smtp_user=jan; $U set shareos.notify.smtp_pass=geheim
$U set shareos.notify.mail_to='a@example.org, b@example.org'; $U set shareos.notify.push=1; $U set shareos.notify.push_type=ntfy; $U set shareos.notify.push_url=https://ntfy.example.org/nas; $U commit shareos
o=$(N send error storage k2 'Äpfel' 'Apples' 'Text' 'Text'); check "e-mail over SMTP with STARTTLS to both recipients" "echo \"\$o\" | grep -q 'smtp://mail.example.org:587' && echo \"\$o\" | grep -q -- '--ssl-reqd' && echo \"\$o\" | grep -q 'mail-rcpt b@example.org' && echo \"\$o\" | grep -q 'Subject: =?UTF-8?B?' && echo \"\$o\" | grep -q -- '--netrc-file' && ! echo \"\$o\" | grep -q geheim" "$o"
check "ntfy push as JSON to the server with topic" "echo \"\$o\" | grep -q 'https://ntfy.example.org' && echo \"\$o\" | grep -q '\"topic\": \"nas\"' && echo \"\$o\" | grep -q '\"priority\": 5'" "$o"
o=$(N send info storage k3 'Info' 'Info'); check "info is below the default level warn: kept, not delivered" "! echo '$o' | grep -q '^deliver:'" "$o"
$U set shareos.notify.push_type=gotify; $U set shareos.notify.push_url=https://gotify.example.org; $U set shareos.notify.push_token=tok; $U set shareos.notify.email=0; $U commit shareos
o=$(N test); check "test message: Gotify with its key" "echo \"\$o\" | grep -q 'https://gotify.example.org/message' && echo \"\$o\" | grep -q 'X-Gotify-Key: tok'" "$o"
$U set shareos.notify.push_type=telegram; $U set shareos.notify.push_token=123456789:AAH-telegram_secret_token_abcdefgh; $U set shareos.notify.push_chat=-100123; $U commit shareos
o=$(N test); check "test message: Telegram bot, token not on the command line" "echo \"\$o\" | grep -q 'api.telegram.org/bot<token>/sendMessage' && echo \"\$o\" | grep -q '\"chat_id\": \"-100123\"' && ! echo \"\$o\" | grep -q 'telegram_secret'" "$o"
$U set shareos.notify.push_chat=; $U commit shareos
o=$(N test); check "Telegram without chat ID reported" "echo '$o' | grep -q 'chat ID missing'" "$o"
$U set shareos.notify.push_chat=-100123; $U set shareos.notify.push_token=kaputt; $U commit shareos
o=$(N test); check "invalid Telegram token reported" "echo '$o' | grep -q 'invalid bot token'" "$o"
o=$(N telegram-chats); check "telegram-chats answers JSON" "echo '$o' | grep -q 'invalid bot token'" "$o"
$U set shareos.notify.push_type=gotify; $U set shareos.notify.push_url='ftp://x'; $U commit shareos
o=$(N test); check "invalid push address reported" "echo '$o' | grep -q 'invalid address'" "$o"
$U set shareos.notify.push=0; $U commit shareos
N delete all >/dev/null

# checks
printf 'md0 : active raid1 sda2[0]\n      3906886464 blocks super 1.2 [2/1] [U_]\n' > "$R/proc/mdstat"
echo 61000 > "$R/tmp/sys/temp1_input"
echo '{"time":1,"passed":true,"reallocated":8,"pending":0}' > "$R/tmp/shareos-storage/smart-sdb.json"
echo '{"check":{"update_available":true,"latest":"0.1.0-beta.9"}}' > "$R/tmp/shareos-update/state.json"
$U set storage.daten=volume; $U set storage.daten.enabled=1; $U commit storage
: > "$R/proc/mounts"
N check >/dev/null
L=$(N list)
check "check: degraded RAID is an error" "echo '$L' | js \"any(x['key']=='raid-md0' and x['level']=='error' for x in d['items'])\"" "$L"
check "check: missing volume, temperature, SMART, update" "echo '$L' | js \"{'vol-missing-daten','temp','smart-sdb','update-0.1.0-beta.9'} <= {x['key'] for x in d['items']}\"" "$L"
N check >/dev/null
check "check again: no duplicates" "N list | js \"len(d['items'])==5\""
printf 'md0 : active raid1 sdb2[1] sda2[0]\n      3906886464 blocks super 1.2 [2/2] [UU]\n' > "$R/proc/mdstat"
echo 40000 > "$R/tmp/sys/temp1_input"
N check >/dev/null
check "check: RAID complete and cool again -> resolved" "N list | js \"all(x['resolved'] for x in d['items'] if x['key'] in ('raid-md0','temp'))\""
# SMART values with a rating (0.2.0-beta.12): reasons in the text, bad = error
echo '{"time":1,"passed":false,"reallocated":3920,"pending":24,"crc_errors":0,"life_left":null,"rating":"bad","reasons":["failed","attr_now:Reallocated_Sector_Ct","reallocated","pending"]}' > "$R/tmp/shareos-storage/smart-sdc.json"
echo '{"time":1,"passed":true,"ssd":true,"life_left":15,"crc_errors":3,"rating":"warn","reasons":["crc","wearing"]}' > "$R/tmp/shareos-storage/smart-sdd.json"
echo '{"time":1,"passed":true,"rating":"good","reasons":[]}' > "$R/tmp/shareos-storage/smart-sdb.json"
N check >/dev/null
L=$(N list)
check "SMART rating bad: error with the reasons" "echo '$L' | js \"any(x['key']=='smart-sdc' and x['level']=='error' and 'umgelagerte Sektoren: 3920' in x['text_de'] and 'Reallocated_Sector_Ct' in x['text_en'] for x in d['items'])\"" "$L"
check "SMART rating warn: SSD wear and CRC" "echo '$L' | js \"any(x['key']=='smart-sdd' and x['level']=='warn' and 'noch 15 %' in x['text_de'] and 'CRC' in x['text_en'] for x in d['items'])\"" "$L"
check "SMART good again: resolved" "echo '$L' | js \"all(x['resolved'] for x in d['items'] if x['key']=='smart-sdb')\"" "$L"

echo; echo "$pass passed, $failed failed"
[ $failed -eq 0 ]
