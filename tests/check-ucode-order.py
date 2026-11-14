#!/usr/bin/env python3
"""
ucode resolves names when a function is compiled: a top-level function that
uses a function or constant declared further down fails at run time with
"access to undeclared variable". This finds such forward references.

    tests/check-ucode-order.py src/shareos-core/usr/share/rpcd/ucode/shareos.uc
"""
# app.js and shareos.uc are put together from their parts (src/shareos-core/parts)
import subprocess, pathlib
subprocess.run([str(pathlib.Path(__file__).resolve().parent.parent / 'src/shareos-core/build-parts.sh')], check=True)
import re
import sys

src = open(sys.argv[1]).read()
code = re.sub(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"", lambda m: ' ' * len(m.group(0)), src)
code = re.sub(r'//[^\n]*|/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), code, flags=re.S)
decl = {}
for m in re.finditer(r'^(?:function|const|let)\s+([A-Za-z_]\w*)', code, re.M):
    decl.setdefault(m.group(1), m.start())
bad = 0
for m in re.finditer(r'^function\s+([A-Za-z_]\w*)\s*\(', code, re.M):
    start = m.start()
    # top-level functions end with a "}" in the first column
    # (or on the same line, for one-liners)
    eol = code.find('\n', m.end())
    line = code[m.end():eol]
    if line.rstrip().endswith('}') and line.count('{') == line.count('}'):
        body = line
    else:
        e = re.compile(r'^}', re.M).search(code, m.end())
        body = code[m.end():e.start() if e else len(code)]
    for name in set(re.findall(r'(?<![\w.])([A-Za-z_]\w*)\b(?!\s*:(?!:))', body)):
        if name in decl and decl[name] > start:
            line = code.count('\n', 0, start) + 1
            print(f'{sys.argv[1]}:{line}: {m.group(1)}() uses {name}, declared later (line {code.count(chr(10), 0, decl[name]) + 1})')
            bad += 1
sys.exit(1 if bad else 0)
