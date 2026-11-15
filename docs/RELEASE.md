# Releasing ShareOS

1. Everything for the release is merged into `main` (CI green).
2. **Docs are up to date in the same merge:**
   - `CHANGELOG.md`: section `## <version>` with the changes (it is attached to the GitHub release automatically)
   - `README.md`: status and feature list
   - `docs/TESTEN.md` / `docs/TESTING.md`: test steps for new functions
   - `docs/ENTWICKLUNG.md` / `docs/DEVELOPMENT.md`: timeline, screenshots
3. On GitHub: *Releases → Draft a new release*, tag `v<version>` (new) on `main`,
   tick **pre-release** for test versions, publish. A short text is enough –
   the CHANGELOG section is appended by the build.
4. GitHub Actions builds the firmware and tests it in the emulator (about
   75 minutes); the job `release` then signs the `.sysupgrade.tar` and `.bin`
   files and attaches them with their `.sig` and checksums. Boxes see the
   release on their next check (every 6 hours) or with *Check now*.

## Signing

Boxes install a release from GitHub only when its `.sysupgrade.tar.sig` fits
the public key in the firmware (`src/shareos-core/etc/shareos/release.pub`).

- The private key is the secret `RELEASE_SIGNING_KEY` of the environment
  `release` (*Settings → Environments*), which is limited to tags `v*`. Only
  the job `release` uses that environment; builds of pull requests never see
  the key. Keep a copy of the key offline – it is not in the repository.
- If the secret is empty or does not fit the public key, the job fails and
  nothing is published. Fix the secret, then *Re-run failed jobs*.
- Check a download by hand:
  `openssl dgst -sha256 -verify release.pub -signature <file>.sig <file>`
- **Reserve key:** the firmware also knows `release-reserve.pub`. Its private
  part is kept offline only (not on GitHub). If the release key is lost or
  exposed: put the reserve private key into the secret `RELEASE_SIGNING_KEY`
  – boxes from 0.3.0-beta.11 on accept releases signed with it at once. Then
  create a new pair, replace the lost key's `.pub` in the repository with it
  (it becomes the new reserve) and release.
- **New key without a reserve** (both lost, or boxes before 0.3.0-beta.11): create it, put the public key into
  `release.pub`, and publish that firmware **signed with the old key** – boxes
  only take the new public key from a release they accept. With the old key
  lost, boxes need the file upload (*Install firmware file*, confirmed as
  unsigned). Then replace the secret.

      openssl ecparam -name prime256v1 -genkey -noout -out shareos-release.key
      openssl ec -in shareos-release.key -pubout -out shareos-release.pub

The website ([uniquedroid.github.io/ShareOS](https://uniquedroid.github.io/ShareOS/),
built from `website/` and the docs) rebuilds itself when the release build has finished;
nothing to do by hand.

Apps are released from [ShareOS-Apps](https://github.com/UniqueDroid/ShareOS-Apps)
by raising `version` in `apps/<id>/app.json` (see its README).
