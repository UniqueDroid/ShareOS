# Translating the ShareOS web interface

*Kurz auf Deutsch: Neue Sprache = eine Liste `tools/i18n/<code>.tsv`, daraus
baut `tools/i18n/build-lang.py` die Datei `i18n/<code>.json`. Details unten.*

The interface is written in English, the source language. Every other
language – German included – is a translation: one JSON file that maps the
English texts to that language. No code changes are needed.

## How it fits together

| File | What it is |
|---|---|
| `tools/i18n/catalog.json` | All English texts of the interface: `exact` (whole texts), `patterns` (texts with values), `words` (words left over in composed texts) and `folders` (names of folders the box creates) |
| `tools/i18n/<code>.tsv` | The translation of one language, one line per entry: `E<n>`, `P<n>` or `W<n>`, a tab, the translated text |
| `src/shareos-core/www/i18n/<code>.json` | Built from the two with `tools/i18n/build-lang.py` – this is what the box loads |
| `src/shareos-core/www/i18n/languages.json` | The languages offered under System → Appearance → Language |

The `.json` files are generated: change the `.tsv` and build again, never edit
the `.json` by hand.

## Add a language

```sh
python3 tools/i18n/build-lang.py --list > /tmp/nl.tsv   # E<n>/P<n>/W<n>, the English text, [the pattern]
```

1. Put the language's name in the first line as a comment (`# Nederlands`),
   then translate the text after the first tab of every line (a third
   column, the `[pattern]`, is only for reference and is ignored). Keep `$1`, `$2` … as they are; their order may
   change. Lines you leave out stay English.
2. Save the list as `tools/i18n/<code>.tsv`, using an ISO 639-1 code
   (`nl.tsv`), and build: `python3 tools/i18n/build-lang.py --all`.
3. Add the language to `i18n/languages.json`:
   ```json
   { "code": "nl", "name": "Nederlands" }
   ```
4. Choose it under **System → Appearance → Language**. The setting applies to
   the whole box, including the login page.

You can try a translation without building the firmware:
```sh
python3 tests/mock-ubus.py        # http://127.0.0.1:8200/  (root / shareos)
```
To test directly on a box, copy the `.json` to `/www/i18n/` and add it to
`/www/i18n/languages.json` there. Both files live in the overlay, so they
survive a reboot.

## New texts in the interface

Every visible text in `app.js` and `desktop.js` is English. A new text needs
an entry in `tools/i18n/catalog.json` (at the end of `exact` or `patterns`,
so the numbers of the existing entries stay the same) and a line with the new
number in every `tools/i18n/<code>.tsv`; then `build-lang.py --all`.

Checks (also in CI):
- `python3 tests/check-i18n.py` – every language built from the current
  catalog, placeholders kept, regular expressions valid, no pattern hidden by
  an earlier one;
- `node tests/check-i18n-coverage.js --list` – no German text in the sources,
  and every English text has a translation (pieces that only exist inside a
  longer text at runtime, and names that are the same in every language, are
  listed in `tests/i18n-pieces.json`).

## Languages shipped

English (source), German, Chinese (simplified), Hindi, Spanish, French,
Arabic (right to left), Bengali, Portuguese (Brazil) and Russian – the most
spoken languages. The translations other than German were made by an AI
(Claude) from the English texts; corrections by native speakers are very
welcome.

## Right-to-left languages

A language with `"dir": "rtl"` in `languages.json` and its code in `RTL` in
`app.js` (ar, he, fa, ur) switches the page to right-to-left.

## The three sections

| Section | Used for | Example (catalog → German) |
|---|---|---|
| `exact` | Whole texts | `"Unmount"` → `"Aushängen"` |
| `patterns` | Texts that contain values (sizes, names, versions). A regular expression on the whole English text; `$1`, `$2` … insert the captured parts | `["^Channel (\\S+)$", "Channel $1"]` → `"Kanal $1"` |
| `words` | Words left over in composed texts, applied in order after the other two | `["\\brunning\\b", "running", "g"]` → `"läuft"` |
| `folders` | Names of folders the box creates on the disks (`F<n>` in the `.tsv`): the shared folder in the personal folder, the default folder of the USB copy. Only used when the folder is created; an existing folder keeps its name | `["shared", "Shared"]` → `"Geteilt"` |

Order of evaluation: `exact`, then the first matching `pattern` (whose result
also goes through `words`), then `words` alone. Patterns are sorted so that
the most specific one comes first. Anything that matches nothing stays
English, which never breaks the page.

## Finding untranslated texts

`tests/mock-ubus.py` together with a browser is the quickest check: click
through all pages, the wizard and the dialogs in your language and look for
English words. Log contents and release notes are shown as they are and are
never translated.

## Numbers and dates

They follow the language automatically (`LOCALES` in `app.js`). For a
language that is not listed there, the language code itself is used as the
locale, which works for most languages.
