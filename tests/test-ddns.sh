#!/bin/sh
#
# Tests shareos-ddns (dynamic DNS) with a fake curl: the update URL of every
# provider, nothing sent while the address stays the same, a failure retried
# after 30 minutes, Cloudflare records created or changed, the TXT records
# for Let's Encrypt, secrets not on the command line.
#
#   tests/test-ddns.sh [dir with ucode]      (LD_LIBRARY_PATH for its libraries)
#
TOP=$(cd "$(dirname "$0")/.." && pwd)
BIN=${1:-}
UCODE=${BIN:+$BIN/}ucode
P="$TOP/src/shareos-core/usr/sbin/shareos-ddns"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p $T/etc/config $T/tmp
# fake curl: logs the URL (last argument) and the config from stdin, answers by URL
cat > $T/curl <<'C'
#!/bin/sh
D=$(dirname "$0")
cfg=$(cat)
for a; do url=$a; done
args="$*"
echo "URL $url" >> $D/curl.log
echo "ARGS $args" >> $D/curl.log
[ -n "$cfg" ] && echo "CFG $cfg" >> $D/curl.log
ip=$(cat $D/ip 2>/dev/null || echo 203.0.113.7)
ans() { printf '%s\n%s' "$2" "$1"; exit 0; }
case "$url" in
	https://api.ipify.org) ans 200 "$ip" ;;
	https://www.duckdns.org/update*) [ -f $D/duck-ko ] && ans 200 KO; ans 200 OK ;;
	https://dynv6.com/api/update*) ans 200 "addresses updated" ;;
	https://dynupdate.no-ip.com/*) ans 200 "good $ip" ;;
	https://dyn.example.net/*) ans 200 "badauth" ;;
	*/zones\?name=example.org) ans 200 '{"success":true,"result":[{"id":"Z1"}]}' ;;
	*/zones\?name=*) ans 200 '{"success":true,"result":[]}' ;;
	*/zones/Z1/dns_records\?type=A*) [ -f $D/cf-has ] && ans 200 '{"success":true,"result":[{"id":"R1","content":"198.51.100.1"}]}'; ans 200 '{"success":true,"result":[]}' ;;
	*/zones/Z1/dns_records\?type=TXT*) ans 200 '{"success":true,"result":[{"id":"T1","content":"\"abc\""}]}' ;;
	*/zones/Z1/dns_records*) ans 200 '{"success":true,"result":{}}' ;;
esac
ans 404 "not found"
C
chmod 755 $T/curl
export SHAREOS_ROOT=$T SHAREOS_DDNS_CURL=$T/curl SHAREOS_DDNS_IP6=
run() { "$UCODE" -L "${BIN:+$BIN/../lib/ucode}" "$P" "$@"; }
js() { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; }
conf() { printf "config ddns 'ddns'\n\toption enabled '1'\n" > $T/etc/config/shareos; for kv; do printf "\toption %s '%s'\n" "${kv%%=*}" "${kv#*=}" >> $T/etc/config/shareos; done; rm -f $T/tmp/shareos-ddns.json $T/curl.log; }
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failed=$((failed+1)); fi; }
export SHAREOS_DDNS_NOW=1800000000

conf provider=duckdns host=mybox.duckdns.org token='t0k&en'
check "duckdns: update with the public address" "run update | js \"d.get('ok') and d['ip4']=='203.0.113.7'\""
check "duckdns: sub-domain and token encoded in the URL" "grep -q 'URL https://www.duckdns.org/update?domains=mybox&token=t0k%26en&ip=203.0.113.7' $T/curl.log"
: > $T/curl.log
check "same address: nothing sent" "run update | js \"d.get('skipped')=='unchanged'\" && ! grep -q duckdns $T/curl.log"
echo 198.51.100.9 > $T/ip
check "new address: sent again" "run update | js \"d.get('ok') and d['ip4']=='198.51.100.9'\" && grep -q 'ip=198.51.100.9' $T/curl.log"
check "status: no token in the answer" "run status | js \"d['token_set'] and 'token' not in d and d['last']['ip4']=='198.51.100.9'\""
SHAREOS_DDNS_NOW=$((1800000000 + 90000)) check "after a day: sent again" "run update | js \"d.get('ok')\""
rm -f $T/ip

conf provider=duckdns host=mybox token=x; touch $T/duck-ko
check "duckdns KO: error" "run update | js \"'wrong' in d.get('error','')\""
rm $T/duck-ko; : > $T/curl.log
SHAREOS_DDNS_NOW=$((1800000000 + 600)) check "failure: not asked again within 30 minutes" "run update | js \"d.get('skipped')\" && ! grep -q duckdns $T/curl.log"
SHAREOS_DDNS_NOW=$((1800000000 + 1900)) check "failure: asked again after 30 minutes" "run update | js \"d.get('ok')\""
check "force: always sent" "run update force | js \"d.get('ok')\""

conf provider=dynv6 host=box.dynv6.net token=abc ipv6=1; export SHAREOS_DDNS_IP6=2001:db8::5
check "dynv6: IPv4 and IPv6" "run update | js \"d.get('ok') and d['ip6']=='2001:db8::5'\" && grep -q 'URL https://dynv6.com/api/update?hostname=box.dynv6.net&token=abc&ipv4=203.0.113.7&ipv6=2001:db8::5' $T/curl.log"
conf provider=dynv6 host=box.dynv6.net token=abc ipv4=0 ipv6=1
check "dynv6: IPv6 only" "run update | js \"d.get('ok') and d['ip4'] is None\" && ! grep -q ipify $T/curl.log"
export SHAREOS_DDNS_IP6=

conf provider=noip host=box.ddns.net user=jan token='geh eim'
check "no-ip: dyndns2 answer good" "run update | js \"d.get('ok')\""
check "no-ip: password not on the command line, through the config" "! grep '^ARGS' $T/curl.log | grep -q 'geh eim' && grep -q 'CFG user = \"jan:geh eim\"' $T/curl.log"

conf provider=custom host=box.example.net user=jan token=pw url='https://dyn.example.net/nic/update?hostname={host}&myip={ip}'
check "custom: placeholders and dyndns2 error badauth" "run update | js \"'password wrong' in d.get('error','')\" && grep -q 'URL https://dyn.example.net/nic/update?hostname=box.example.net&myip=203.0.113.7' $T/curl.log"

conf provider=cloudflare host=nas.home.example.org token=cftoken
check "cloudflare: zone found, A record created" "run update | js \"d.get('ok')\" && grep -q 'URL https://api.cloudflare.com/client/v4/zones/Z1/dns_records\$' $T/curl.log && grep -q 'ARGS.*-X POST' $T/curl.log"
check "cloudflare: token through the config" "grep -q 'CFG header = \"Authorization: Bearer cftoken\"' $T/curl.log && ! grep '^ARGS' $T/curl.log | grep -q cftoken"
conf provider=cloudflare host=nas.home.example.org token=cftoken; touch $T/cf-has
check "cloudflare: existing record changed (PUT)" "run update | js \"d.get('ok')\" && grep -q 'URL https://api.cloudflare.com/client/v4/zones/Z1/dns_records/R1' $T/curl.log && grep -q 'ARGS.*-X PUT' $T/curl.log"
rm $T/cf-has
check "cloudflare: TXT for Let's Encrypt" "run txt-set _acme-challenge.nas.home.example.org abc | js \"d.get('ok')\""
: > $T/curl.log
check "cloudflare: TXT removed again" "run txt-clear _acme-challenge.nas.home.example.org abc | js \"d.get('ok')\" && grep -q 'URL .*/dns_records/T1' $T/curl.log"

conf provider=duckdns host=mybox token=x
check "duckdns: TXT set and cleared" "run txt-set _acme-challenge.mybox.duckdns.org v1 | js \"d.get('ok')\" && grep -q 'txt=v1' $T/curl.log && run txt-clear _acme-challenge.mybox.duckdns.org v1 | js \"d.get('ok')\" && grep -q 'clear=true' $T/curl.log"
conf provider=noip host=a.ddns.net user=u token=p
check "no-ip: no TXT records (error)" "! run txt-set _acme-challenge.a.ddns.net v >/dev/null"

conf provider=noip host=box token=p user=u
check "host name without domain refused" "run update | js \"'domain' in d.get('error','')\""
printf "config ddns 'ddns'\n\toption enabled '0'\n" > $T/etc/config/shareos
check "switched off: nothing" "run update | js \"d.get('skipped')=='off'\""

echo "test-ddns: $pass passed, $failed failed"
[ $failed = 0 ]
