#!/usr/bin/env node
// The web interface is written in English; the translations are in
// i18n/<code>.json (built from tools/i18n/catalog.json). This finds
//   1. German text in the sources (there must be none: German is a translation),
//   2. English texts with no entry in the catalog (they would stay English in
//      every other language) – checked against the German translation, which
//      covers the whole catalog.
//
//   node tests/check-i18n-coverage.js [--list]     exit 1 when something is found
//
// Candidates: text between tags in html`` templates, the attributes
// placeholder/title/aria-label/alt, and string literals that look like text.
// ${…} counts as a value "X".
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src/shareos-core/www');
const FILES = ['app.js', 'desktop.js'];
const de = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/de.json'), 'utf8'));
const exact = de.exact, patterns = de.patterns.map(([r, x]) => [new RegExp(r), x]), words = de.words.map(([r, x, f]) => [new RegExp(r, f || ''), x]);

// German in the source: umlauts or common German words
const GERMAN = /[äöüÄÖÜß]|\b(der|die|das|und|nicht|mit|für|ist|ein|eine|einen|wird|werden|auf|von|zum|zur|dem|des|bei|noch|nur|oder|wenn|kein|keine|sich|auch|dann|bitte|jetzt|hier|wie|nach|ohne|alle|neu|Datei|Dateien|Ordner|Freigabe|Freigaben|Benutzer|Gruppe|Gerät|Laufwerk|Platte|Einstellungen|Speichern|Abbrechen|Löschen|Hinzufügen|Passwort|Fehler|gespeichert|Konto|Auftrag|Zeitplan|Sprache|Netzwerk|Adresse|Neustart|Lade|Minuten|Stunden|Tage|aus)\b/;

function words_(t) { let r = t; for (const [re, x] of words) r = r.replace(re, x); return r; }
function translate(t) {
	if (exact[t] != null) return exact[t];
	for (const [re, x] of patterns) if (re.test(t)) return words_(t.replace(re, x));
	return words_(t);
}

// class names (from the style sheets and class="…" in the sources): a string
// made only of them is a class list, not text
const CLASSES = new Set();
for (const f of ['shareos.css', 'desktop.css']) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)) CLASSES.add(m[1]);
for (const f of FILES) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/class="([^"$]*)/g)) for (const c of m[1].split(/\s+/)) CLASSES.add(c);
const isCode = (t) => t.split(/\s+/).every((w) => CLASSES.has(w) || w === 'X' || !w)
	|| /[{}\[\]]|\$\{|^[\w-]+:[^ ]|;\s*[\w-]+:|^[a-z-]+(, ?[a-z-]+)+$|^[a-z]+(-[a-z]+)+( [a-z]+(-[a-z]+)*)*$/.test(t);
// template literals of a source (nested ones too): [text with every ${…} as X, position]
// – a small scanner instead of a regular expression (no backtracking)
function templates(src) {
	const out = [];
	const skipString = (i) => { const q = src[i]; i++; while (i < src.length && src[i] !== q && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1; return i + 1; };
	function template(i) {           // src[i] is the opening backtick; returns the index after the closing one
		const at = i;
		let flat = '';
		i++;
		while (i < src.length && src[i] !== '`') {
			if (src[i] === '\\') { flat += src.slice(i, i + 2); i += 2; continue; }
			if (src[i] === '$' && src[i + 1] === '{') { i = expression(i + 2); flat += 'X'; continue; }
			flat += src[i++];
		}
		out.push([flat, at]);
		return i + 1;
	}
	function expression(i) {         // after "${"; returns the index after the matching "}"
		let depth = 0;
		while (i < src.length) {
			const c = src[i];
			if (c === '`') { i = template(i); continue; }
			if (c === '"' || c === "'") { i = skipString(i); continue; }
			if (c === '{') depth++;
			else if (c === '}') { if (!depth) return i + 1; depth--; }
			i++;
		}
		return i;
	}
	for (let i = 0; i < src.length;) {
		const c = src[i];
		if (c === '`') i = template(i);
		else if (c === '"' || c === "'") i = skipString(i);
		else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
		else if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; }
		else i++;
	}
	return out;
}
const found = new Map();      // text -> file:line
const add = (t, where) => {
	t = t.replace(/\s+/g, ' ').trim().replace(/^X(?=[A-Za-z])/, '').replace(/([.!?:)…])X$/, '$1').trim();
	if (/^[:'"]|['"];|\}\)|=>|^\W*$/.test(t) || isCode(t)) return;     // code, not text
	if (!/[A-Za-zÄÖÜäöüß]{2}/.test(t)) return;
	if (/^(https?:|\/|#|\.[a-z0-9]|[a-z_]+\(|[a-z-]+=|[a-z0-9_.:\/-]+$)/.test(t)) return;   // urls, paths, identifiers
	if (!found.has(t)) found.set(t, where);
};
for (const f of FILES) {
	const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
	const lineOf = (i) => f + ':' + src.slice(0, i).split('\n').length;
	const bodies = templates(src);
	for (const [flat, at] of bodies) {
		if (!/[<>]/.test(flat)) { if (/ /.test(flat) || /^[A-Z]/.test(flat)) add(flat, lineOf(at)); continue; }
		for (const part of flat.split(/<[^>]*>/)) add(part, lineOf(at));
		for (const a of flat.matchAll(/(placeholder|title|aria-label|alt)="([^"]+)"/g)) add(a[2], lineOf(at));
	}
	const str = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"/g;
	let m;
	while ((m = str.exec(src))) {
		const t = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ');
		if (/[<>]/.test(t) || !/[a-z]/.test(t) || !/ |^[A-Z][a-z]+$|^[A-Z][A-Z ]+$/.test(t)) continue;   // text has a space, or is a Word / WORD
		add(t, lineOf(m.index));
	}
}
// English pieces that only exist inside a longer text at runtime, and names
// that are the same in every language (checked by hand)
const PIECES = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-pieces.json'), 'utf8')));
const german = [], missing = [];
for (const [t, where] of found) {
	if (GERMAN.test(t)) { german.push([where, t]); continue; }
	if (PIECES.has(t)) continue;
	const ok = ['5', '1.2 MB', 'photos'].some((x) => { const s = t.replace(/\bX\b/g, x); return translate(s) !== s || translate(s + ' x') !== s + ' x'; });
	if (!ok) missing.push([where, t]);
}
for (const [w, t] of german) console.log(`${w}: German text: ${t}`);
if (process.argv.includes('--list')) for (const [w, t] of missing) console.log(`${w}: no translation: ${t}`);
console.error(`${german.length} German texts in the source, ${missing.length} texts without translation (of ${found.size} candidates)`);
process.exit(german.length || missing.length ? 1 : 0);
