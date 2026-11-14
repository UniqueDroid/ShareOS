#!/bin/sh
# Static analysis of ShareOS (no program is run):
#   - ShellCheck over the shell scripts of the firmware
#   - ESLint over the web interface and the app SDK (eslint.config.mjs)
#   - tests/check-dead-code.py (top-level names of the page nobody uses)
#   - complexity of the functions of the web interface (ESLint "complexity")
# The ucode checks (compile, check-ucode-order/-regex), check-acl and the
# i18n checks run in the "backend-tests" job; CodeQL (security analysis of
# JavaScript and Python) in .github/workflows/codeql.yml.
#
#   tests/static-analysis.sh          CI: fails on ShellCheck errors and ESLint/dead-code findings
#   tests/static-analysis.sh --report  plus all ShellCheck warnings and the most complex functions
#                                      (for the monthly audit; never fails because of them)
#
# Needs shellcheck and node; ESLint is installed into node_modules/ (git-ignored)
# in the pinned version when it is missing.
set -u
cd "$(dirname "$0")/.." || exit 1
# app.js and shareos.uc are put together from their parts
src/shareos-core/build-parts.sh || exit 1
REPORT=0
[ "${1:-}" = --report ] && REPORT=1
ESLINT_VER=9.39.1
GLOBALS_VER=15.15.0
fail=0

# the shell scripts: everything below src/ and board/ that starts with #!/bin/sh
SH=$(grep -rlI '^#!/bin/sh' src board tools tests 2>/dev/null | grep -v '/node_modules/' | sort)
echo "== ShellCheck ($(echo "$SH" | wc -l) scripts)"
if command -v shellcheck >/dev/null; then
	# BusyBox ash: "local" exists (SC3043)
	# shellcheck disable=SC2086
	shellcheck -s sh -e SC3043 -S error -f gcc $SH || fail=1
	if [ $REPORT = 1 ]; then
		echo "-- warnings (not failing):"
		# shellcheck disable=SC2086
		shellcheck -s sh -e SC3043 -S warning -f gcc $SH | sed 's/^/   /'
		# shellcheck disable=SC2086
		echo "   $(shellcheck -s sh -e SC3043 -S warning -f gcc $SH | wc -l) warnings; by code:"
		# shellcheck disable=SC2086
		shellcheck -s sh -e SC3043 -S warning -f gcc $SH | grep -o 'SC[0-9]*' | sort | uniq -c | sort -rn | sed 's/^/   /'
	fi
else
	echo "shellcheck missing"; fail=1
fi

echo "== ESLint"
if [ ! -x node_modules/.bin/eslint ]; then
	npm install --no-save --no-audit --no-fund --silent "eslint@$ESLINT_VER" "globals@$GLOBALS_VER" "@eslint/js@$ESLINT_VER" || { echo "npm install failed"; exit 1; }
fi
WEB="src/shareos-core/www src/shareos-core/www-apps/_shareos/app.js"
# shellcheck disable=SC2086
node_modules/.bin/eslint --max-warnings 0 $WEB || fail=1

echo "== Dead code"
python3 tests/check-dead-code.py || fail=1

if [ $REPORT = 1 ]; then
	echo "== Complexity (cyclomatic, the 20 most complex functions)"
	# shellcheck disable=SC2086
	node_modules/.bin/eslint --no-config-lookup --rule '{"complexity":["warn",1]}' \
		--parser-options ecmaVersion:2022 -f json $WEB 2>/dev/null | node -e '
		let d = ""; process.stdin.on("data", (c) => d += c).on("end", () => {
			const L = [];
			for (const f of JSON.parse(d)) for (const m of f.messages) {
				const n = /complexity of (\d+)/.exec(m.message);
				if (n) L.push([+n[1], f.filePath.replace(process.cwd() + "/", "") + ":" + m.line, (/^(.*?) has a complexity/.exec(m.message) || [])[1]]);
			}
			L.sort((a, b) => b[0] - a[0]);
			for (const [c, at, what] of L.slice(0, 20)) console.log(String(c).padStart(5), at, what);
			const over = L.filter((x) => x[0] > 20).length;
			console.log(`   ${L.length} functions, ${over} with a complexity over 20`);
		});'
fi

[ $fail = 0 ] && echo "static analysis: OK" || echo "static analysis: FAILED"
exit $fail
