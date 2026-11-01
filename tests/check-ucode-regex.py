#!/usr/bin/env python3
"""ucode regex literals are POSIX ERE: inside [...] a backslash class like
\\s, \\d or \\w is NOT a class but the letters s, d, w (so [^\\s]+ stops at
every "s"). Use [:space:], [:digit:], [:alnum:] there.

  tests/check-ucode-regex.py [files...]
"""
import re
import sys

FILES = sys.argv[1:] or ['src/shareos-core/usr/share/rpcd/ucode/shareos.uc', 'src/shareos-core/usr/sbin/shareos-apps',
                         'src/shareos-core/usr/sbin/shareos-notify', 'src/shareos-core/usr/sbin/shareos-buttons', 'src/shareos-core/usr/sbin/shareos-ddns',
                         'src/shareos-core/www-apps/_shareos/cgi/fs']
bad = []
for f in FILES:
    for n, line in enumerate(open(f, encoding='utf-8'), 1):
        if line.lstrip().startswith('//'):
            continue
        for m in re.finditer(r'(?<![A-Za-z0-9_)\]\'"])/(\^?(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n])+)/[gis]*', line):
            for cls in re.finditer(r'\[(?:\\.|[^\]])*\]', m.group(1)):
                if re.search(r'\\[sSdDwW]', cls.group(0)):
                    bad.append(f'{f}:{n}: {cls.group(0)} in /{m.group(1)}/')
for b in bad:
    print(b)
sys.exit(1 if bad else 0)
