#!/usr/bin/env python3
"""Build i18n/<code>.json from the catalog and a translation list.

  tools/i18n/build-lang.py <code> <name> <translations.tsv>
  tools/i18n/build-lang.py --all          every tools/i18n/<code>.tsv (name from its first line)
  tools/i18n/build-lang.py --list         the catalog with numbers

The interface is written in English. tools/i18n/catalog.json lists its texts:
"exact" (whole texts), "patterns" ([regular expression on the whole English
text, the English text with $1 …]) for texts with values, "words" ([regular
expression, English, flags]) applied to what is left. The TSV has one line per
translated entry: "E<n>\\ttext", "P<n>\\ttext" (with the same $1 … as the
English), "W<n>\\ttext"; numbers as printed by --list. Missing entries stay
English.
"""
import glob
import json
import os
import re
import sys
from collections import OrderedDict

D = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(D, '..', '..', 'src/shareos-core/www/i18n/')


def load_cat():
    return json.load(open(os.path.join(D, 'catalog.json'), encoding='utf-8'), object_pairs_hook=OrderedDict)


ph = re.compile(r'\$\d')


def literal_len(rx):
    """how much fixed text a pattern has: the more, the more specific"""
    return len(re.sub(r'\\.', 'x', re.sub(r'\((?:[^()\\]|\\.)*\)', '', rx)))


def generality(rx):
    """with the same fixed text: groups that take anything ((.*), (.+)) after narrower ones"""
    return sum({'(.*)': 3, '(.+)': 2, r'(\S+)': 1}.get(g, 0) for g in re.findall(r'\((?:[^()\\]|\\.)*\)', rx))


def build(code, name, tsv):
    cat = load_cat()
    tr = {}
    for line in open(tsv, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'):
            continue
        k, _, v = line.partition('\t')
        tr[k] = v.split('\t')[0]       # a third column (the pattern, as --list prints it) is ignored
    errors = []

    def pick(key, english):
        v = tr.get(key)
        if v is not None and sorted(ph.findall(v)) != sorted(ph.findall(english)):
            errors.append(f'{code} {key}: placeholders differ: {english!r} -> {v!r}')
            return None
        return v

    out = OrderedDict(language=code, name=name, source='en')
    exact = OrderedDict()
    for i, e in enumerate(cat['exact']):
        v = pick(f'E{i}', e)
        if v is not None and e not in exact:
            exact[e] = v
    out['exact'] = exact
    pats = []
    for i, (rx, en) in enumerate(cat['patterns']):
        v = pick(f'P{i}', en)
        if v is not None:
            pats.append([rx, v])
    # the most specific pattern first: the first one that matches is used
    pats.sort(key=lambda p: (-literal_len(p[0]), generality(p[0])))
    out['patterns'] = pats
    words = []
    for i, w in enumerate(cat['words']):
        v = pick(f'W{i}', w[1])
        if v is not None:
            words.append([w[0], v] + ([w[2]] if len(w) > 2 and w[2] else []))
    out['words'] = words
    if errors:
        print('\n'.join(errors))
        return False
    open(os.path.join(WWW, code + '.json'), 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent='\t') + '\n')
    missing = sum(1 for i in range(len(cat['exact'])) if f'E{i}' not in tr)
    print(f'{code}: {len(tr)} entries, {missing} texts stay English')
    return True


if sys.argv[1:2] == ['--list']:
    cat = load_cat()
    for i, v in enumerate(cat['exact']):
        print(f'E{i}\t{v}')
    for i, p in enumerate(cat['patterns']):
        print(f'P{i}\t{p[1]}\t[{p[0]}]')
    for i, w in enumerate(cat['words']):
        print(f'W{i}\t{w[1]}\t[{w[0]}]')
    sys.exit(0)
if sys.argv[1:2] == ['--all']:
    ok = True
    for t in sorted(glob.glob(os.path.join(D, '*.tsv'))):
        name = open(t, encoding='utf-8').readline().lstrip('#').strip()
        ok = build(os.path.basename(t)[:-4], name, t) and ok
    sys.exit(0 if ok else 1)
code, name, tsv = sys.argv[1:4]
sys.exit(0 if build(code, name, tsv) else 1)
