#!/bin/bash
#
# Tests the SMART evaluation of the rpcd plugin (smart_parse/smart_assess in
# shareos.uc) with smartctl JSON of a healthy disk, a worn SSD and a failing
# disk (tests/smart/*.json), on the host ucode.
#
#   LD_LIBRARY_PATH=<hostroot>/lib tests/test-smart.sh <hostroot>/bin/ucode
#
set -u
UC=${1:?path to the host ucode binary}
TOP=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; failed=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; echo "      $(cat $T/out)"; failed=$((failed+1)); fi; }
# the SMART part of the plugin, between its first constant and smart_read
sed -n '/^\/\/ SSD wear from the vendor attributes/,/^function smart_read(/p' "$TOP/src/shareos-core/usr/share/rpcd/ucode/shareos.uc" | sed '$d' > $T/smart.uc
grep -q '^function smart_parse' $T/smart.uc || { echo "smart_parse not found in shareos.uc"; exit 1; }
cat >> $T/smart.uc <<'UC'
import { readfile } from 'fs';
print(sprintf('%J\n', smart_parse(json(readfile(ARGV[0])))));
UC
# "import" must come first in ucode
{ grep '^import' $T/smart.uc; grep -v '^import' $T/smart.uc; } > $T/run.uc
p() { "$UC" -L "$(dirname "$(dirname "$UC")")/lib/ucode" $T/run.uc "$1" > $T/out 2>&1; }
F=$TOP/tests/smart
js() { python3 -c "import json,sys; d=json.load(open('$T/out')); sys.exit(0 if ($1) else 1)"; }

p $F/hdd-ok.json
check "healthy HDD: good, no reasons" "js \"d['rating']=='good' and d['reasons']==[] and d['ssd'] is False\""
check "healthy HDD: values (hours, starts, max temperature, last test, test minutes)" "js \"d['power_on_hours']==4321 and d['start_stops']==412 and d['temperature_max']==47 and d['last_test']['passed'] and d['test_minutes']=={'short':2,'long':461} and d['test_running'] is None\""
check "healthy HDD: attribute table" "js \"len(d['attributes'])==8 and d['attributes'][0]['name']=='Raw_Read_Error_Rate' and d['attributes'][0]['prefail']\""
p $F/ssd-wear.json
check "worn SSD: life left from Wear_Leveling_Count, written bytes, CRC" "js \"d['ssd'] and d['life_left']==15 and d['written']==195312500000*512 and d['crc_errors']==3\""
check "worn SSD: warn with wearing and crc" "js \"d['rating']=='warn' and sorted(d['reasons'])==['crc','wearing']\""
p $F/hdd-failing.json
check "failing HDD: bad with all reasons" "js \"d['rating']=='bad' and d['reasons'][:4]==['failed','attr_now:Reallocated_Sector_Ct','test_failed','reallocated'] and {'pending','attr_past:Reported_Uncorrect','uncorrectable','errors','warm'} <= set(d['reasons'])\""
check "failing HDD: running self-test shows" "js \"d['test_running']['remaining']==70 and d['error_count']==731\""
# endurance indicator of the device statistics wins over the vendor attribute
python3 - "$TOP/tests/smart/ssd-wear.json" > $T/devstat.json <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d['ata_device_statistics'] = {'pages': [{'number': 7, 'table': [{'name': 'Percentage Used Endurance Indicator', 'value': 4}]}]}
print(json.dumps(d))
PY
p $T/devstat.json
check "SSD: device statistics (4 % used) give 96 % left" "js \"d['life_left']==96 and d['rating']=='warn' and d['reasons']==['crc']\""

echo "$pass passed, $failed failed"
[ $failed = 0 ]
