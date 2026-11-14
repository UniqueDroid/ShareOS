#!/usr/bin/env python3
"""Top-level names of the web interface that nothing uses (dead code).

app.js, desktop.js and i18n.js are classic scripts of one page, so ESLint
cannot see whether a top-level function of one is used by another. This
counts every top-level function/const/let/class name over all three files
(and index.html): a name that appears only where it is declared is unused.
Exit code 1 when there is one.
"""
# app.js and shareos.uc are put together from their parts (src/shareos-core/parts)
import subprocess, pathlib
subprocess.run([str(pathlib.Path(__file__).resolve().parent.parent / 'src/shareos-core/build-parts.sh')], check=True)
import pathlib
import re
import sys

WWW = pathlib.Path(__file__).resolve().parent.parent / 'src/shareos-core/www'
FILES = ['app.js', 'desktop.js', 'i18n.js']
src = {f: (WWW / f).read_text(encoding='utf-8') for f in FILES}
everything = '\n'.join(src.values()) + (WWW / 'index.html').read_text(encoding='utf-8')
# a use: the name not preceded by a word character or by a single "." (but
# "...name" – a spread – is a use)
DECL = re.compile(r'^(?:async\s+)?(?:function\*?\s+|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)', re.M)

dead = []
for f, s in src.items():
    for m in DECL.finditer(s):
        n = m.group(1)
        uses = re.findall(r'(?:(?<![\w$.])|(?<=\.\.\.))' + re.escape(n) + r'(?![\w$])', everything)
        if len(uses) <= 1:
            dead.append(f'{f}:{s.count(chr(10), 0, m.start()) + 1}: {n}')
for d in dead:
    print('unused top-level name', d)
print(f'{len(dead)} unused top-level names')
sys.exit(1 if dead else 0)
