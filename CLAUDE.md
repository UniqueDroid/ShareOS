# Notes for Claude sessions working on ShareOS

- Talk to Jan (the owner) in **German only**. Repository files (code, comments, docs in English, docs/*.md German counterparts) stay as they are.
- Give complete step-by-step procedures (all commands) instead of pointing to earlier messages.
- Hardware rules: no soldering, never run `saveenv` in U-Boot, never flash or erase disks on Jan's box without his explicit OK, do not use Alt-F's FlashIt for test images.
- Tags/releases are created by Jan; prepare the release text and the `CHANGELOG.md` section.
- **Every release updates the docs** – see `docs/RELEASE.md` (CHANGELOG, README status/features, TESTEN/TESTING, ENTWICKLUNG/DEVELOPMENT).
- Photos for the docs: strip EXIF/GPS and blur serial-number stickers before committing.
- Tests: `tests/` (host: test-update, test-net, test-flash-bin, test-boards, check-acl.py, check-i18n.py; ARM emulator with sudo: run-stack-qemu --check, test-users, test-storage, test-cloud-paperless, test-apps, test-firstinstall, test-transmission, test-media, test-dlna – these three need `make sysapps-pack`). UI work: `tests/mock-ubus.py`; app SDK in Chromium: `node tests/sdk-storage.js` (Playwright). ucode plugin: `tests/check-ucode-order.py` (no hoisting in ucode).
- Never `rm -rf` a chroot that still has mounts below it (it would delete the host's /dev).
- Apps live in the separate repository UniqueDroid/ShareOS-Apps.
- New UI texts: add them to `i18n/en.json` and to every `tools/i18n/<code>.tsv` (new numbers at the end), then `tools/i18n/build-lang.py`; `tests/check-i18n.py` must pass.
- Code is English: page names/URLs (`#/storage`, `#/system/time`), identifiers, comments. Only the visible UI texts are German (the source language of the translations).
