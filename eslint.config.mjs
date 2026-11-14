// Static analysis of the web interface (ESLint, see tests/static-analysis.sh
// and the "static-analysis" job in .github/workflows/build.yml).
// app.js (joined from src/shareos-core/parts/web by build-parts.sh, which
// tests/static-analysis.sh calls), desktop.js and i18n.js are classic scripts of one page: they share
// their top-level names. Those are read from the files themselves, so a name
// that exists in none of them is still reported (no-undef).
import fs from 'node:fs';
import globals from 'globals';
import js from '@eslint/js';

const WWW = 'src/shareos-core/www/';
const PAGE = ['app.js', 'desktop.js', 'i18n.js'].map((f) => WWW + f);
const shared = {};
for (const f of PAGE) {
	const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
	for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?\s+|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/gm)) shared[m[1]] = 'writable';
	for (const m of src.matchAll(/^(?:const|let|var)\s+\{([^}=]+)\}\s*=/gm)) for (const n of m[1].split(',')) { const k = n.split(':').pop().trim(); if (k) shared[k] = 'writable'; }
}

const rules = {
	...js.configs.recommended.rules,
	// names defined at the top of one script are used by the others
	'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
	// `try { … } catch (e) { }` is used on purpose (storage, postMessage)
	'no-empty': ['error', { allowEmptyCatch: true }],
	'no-redeclare': 'off',            // the shared names above are their own declarations
	'no-control-regex': 'off',        // filters of control characters are deliberate
	'no-cond-assign': ['error', 'except-parens'],
	eqeqeq: ['error', 'smart'],
	'no-implicit-globals': 'error',
	'no-eval': 'error',
	'no-implied-eval': 'error',
	'no-new-func': 'error',
	'no-script-url': 'error'
};

export default [
	{ ignores: ['**/i18n/*.json', 'buildroot/**', 'output/**', 'website/**', 'tests/**'] },
	{
		files: PAGE,
		languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...shared } },
		rules: { ...rules, 'no-implicit-globals': 'off' }
	},
	{
		files: [WWW + 'sw.js'],
		languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: globals.serviceworker },
		rules: { ...rules, 'no-implicit-globals': 'off' }   // a service worker has its own global scope
	},
	{
		files: ['src/shareos-core/www-apps/_shareos/app.js'],
		languageOptions: { ecmaVersion: 2018, sourceType: 'script', globals: globals.browser },
		rules
	}
];
