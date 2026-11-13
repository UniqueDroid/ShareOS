/*
 * ShareOS web interface – translations.
 *
 * The interface is written in English (the source language). For any other
 * language, i18n/<code>.json is loaded and every text node plus the
 * attributes placeholder/aria-label/title/alt are translated after rendering:
 *
 *   exact     "English text": "translation"
 *   patterns  [ "regular expression on the whole text", "replacement with $1" ]
 *             for texts that contain values (sizes, names, versions)
 *   words     [ "regular expression", "replacement", "flags" ] applied to what
 *             is left (and to pattern results)
 *
 * Available languages are listed in i18n/languages.json. How to add one:
 * docs/TRANSLATING.md.
 */
'use strict';

let I18N = null;

async function i18nLoad(code) {
	if (!code || code === 'en') return false;
	try {
		const r = await fetch('i18n/' + code + '.json', { cache: 'no-cache' });
		if (!r.ok) return false;
		const j = await r.json();
		I18N = {
			exact: j.exact || {},
			patterns: (j.patterns || []).map(([re, rep]) => [new RegExp(re), rep]),
			words: (j.words || []).map(([re, rep, fl]) => [new RegExp(re, fl || ''), rep])
		};
		return true;
	} catch (e) {
		console.warn('i18n: cannot load ' + code, e);
		return false;
	}
}

async function i18nLanguages() {
	try {
		const r = await fetch('i18n/languages.json', { cache: 'no-cache' });
		return r.ok ? await r.json() : [];
	} catch (e) { return []; }
}

function i18nWords(t) {
	let r = t;
	for (const [re, rep] of I18N.words) r = r.replace(re, rep);
	return r;
}

function i18nText(s) {
	if (!I18N) return s;
	const t = s.trim();
	if (!t) return s;
	const at = s.indexOf(t), pre = s.slice(0, at), post = s.slice(at + t.length);
	if (I18N.exact[t] != null) return pre + I18N.exact[t] + post;
	for (const [re, rep] of I18N.patterns)
		if (re.test(t)) return pre + i18nWords(t.replace(re, rep)) + post;
	const r = i18nWords(t);
	return r === t ? s : pre + r + post;
}

// node -> text we wrote; keeps already translated text from being translated twice
const I18N_DONE = new WeakMap();
const I18N_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

function i18nNode(n) {
	if (I18N_DONE.get(n) === n.nodeValue) return;
	if (n.parentElement && n.parentElement.closest('pre.logbox, pre.notes, code, [data-i18n-skip]')) return;
	const v = i18nText(n.nodeValue);
	if (v !== n.nodeValue) n.nodeValue = v;
	I18N_DONE.set(n, v);
}

function i18nAttrs(e) {
	for (const a of I18N_ATTRS) {
		const v = e.getAttribute(a), key = 'i18n' + a.replace('-', '');
		if (v && e.dataset[key] !== v) {
			const t = i18nText(v);
			e.dataset[key] = t;
			if (t !== v) e.setAttribute(a, t);
		}
	}
}

function i18nApply(root) {
	if (!root || !I18N) return;
	if (root.nodeType === 3) { i18nNode(root); return; }
	if (root.nodeType !== 1) return;
	const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let n;
	while ((n = w.nextNode())) i18nNode(n);
	i18nAttrs(root);
	root.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach(i18nAttrs);
}

function i18nStart(target) {
	if (!I18N) return;
	i18nApply(target);
	new MutationObserver((muts) => {
		for (const m of muts) {
			if (m.type === 'characterData') i18nApply(m.target);
			// a title or label set later (e.g. el.title = '…'): translate it too
			else if (m.type === 'attributes') i18nAttrs(m.target);
			else m.addedNodes.forEach(i18nApply);
		}
	}).observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
}
