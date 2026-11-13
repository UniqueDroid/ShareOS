#!/usr/bin/env python3
"""Language files: the interface is written in English; tools/i18n/catalog.json
lists its texts and every i18n/<code>.json is built from it with
tools/i18n/build-lang.py. Checks that

  - every language in languages.json (except the source "en") has a file,
    built from the current catalog (no stale or foreign keys),
  - placeholders ($1 …) are kept and every regular expression compiles,
  - no pattern is hidden: an earlier pattern in the file that matches every
    example text of a later one would take all its texts,
  - the catalog has no regular expression twice.

  tests/check-i18n.py
"""
import json
import re
import sys

D = 'src/shareos-core/www/i18n/'
ph = re.compile(r'\$\d')
errors = []
cat = json.load(open('tools/i18n/catalog.json', encoding='utf-8'))
langs = json.load(open(D + 'languages.json', encoding='utf-8'))

exact = set(cat['exact'])
pat_en = {}
for rx, en in cat['patterns']:
    if rx in pat_en:
        errors.append(f'catalog: pattern twice: {rx!r}')
    pat_en[rx] = en
    try:
        n = re.compile(rx).groups
    except re.error as e:
        errors.append(f'catalog: bad pattern {rx!r}: {e}')
        continue
    used = {int(x[1:]) for x in ph.findall(en)}
    if used and max(used) > n:
        errors.append(f'catalog: {en!r} uses a group that {rx!r} does not have')
for w in cat['words']:
    try:
        re.compile(w[0])
    except re.error as e:
        errors.append(f'catalog: bad word pattern {w[0]!r}: {e}')


def examples(rx, en):
    """the English text of a pattern with sample values filled in (those it matches)"""
    out = []
    for v in ['7', '12:30', '0.1 0.2 0.3', 'abc', 'a b', '3 MB', '']:
        t = re.sub(r'\$(\d)', lambda m: v, en)
        if re.search(rx, t):
            out.append(t)
    return out


for l in langs:
    code = l['code']
    if code == 'en':
        continue
    try:
        j = json.load(open(D + code + '.json', encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        errors.append(f'{code}: {e}')
        continue
    if j.get('language') != code or j.get('source') != 'en':
        errors.append(f'{code}: "language" is {j.get("language")!r}, "source" {j.get("source")!r}')
    foreign = set(j['exact']) - exact
    if foreign:
        errors.append(f'{code}: {len(foreign)} texts not in the catalog (rebuild with tools/i18n/build-lang.py --all), e.g. {sorted(foreign)[:3]}')
    for (rx, rep) in j['patterns']:
        if rx not in pat_en:
            errors.append(f'{code}: pattern not in the catalog: {rx!r}')
            continue
        if sorted(ph.findall(rep)) != sorted(ph.findall(pat_en[rx])):
            errors.append(f'{code}: placeholders differ in pattern {rx!r}')
    pats = [(re.compile(rx), rx) for rx, _ in j['patterns'] if rx in pat_en]
    for i, (r, rx) in enumerate(pats):
        ex = [t for t in examples(rx, pat_en[rx]) if t not in j['exact']]
        if not ex:
            continue
        for r2, rx2 in pats[:i]:
            if all(r2.search(t) for t in ex):     # never reached: an earlier pattern takes all its texts
                errors.append(f'{code}: pattern {rx2!r} hides {rx!r} (e.g. {ex[0]!r})')
                break
    for w in j['words']:
        try:
            re.compile(w[0])
        except re.error as e:
            errors.append(f'{code}: bad word pattern {w[0]!r}: {e}')
print('\n'.join(errors) if errors else f'{len(langs) - 1} languages OK (catalog: {len(cat["exact"])} texts, {len(cat["patterns"])} patterns, {len(cat["words"])} words)')
sys.exit(1 if errors else 0)
