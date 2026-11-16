---
name: mac-app-store-build
description: Build, sign, validate and upload the Mac App Store edition of Open Screenshot Generator from a clean checkout of one commit. Use when asked to push, upload or make a new App Store build for the Mac, to check that App Store signing still works, or to find out the next build number. Keeps keys, the provisioning profile and the build itself out of this public repo.
metadata:
  # Contributor tooling for this repository, not a skill anyone installs.
  # `npx skills add` walks .claude/skills as a priority container, so without
  # this flag every person installing the published skills would be offered
  # our internal harnesses too. Set INSTALL_INTERNAL_SKILLS=1 to see them anyway.
  internal: true
---

# Mac App Store build

`build.mjs` beside this file does the whole job: it checks out one commit into a separate folder, builds the universal app with the App Store settings, signs it, wraps it in an installer package and has Apple validate it. With `--upload` it also sends the package to App Store Connect. It does not create the version in App Store Connect or submit anything for review.

## This repo is public

Nothing secret goes into a file here, a commit, a PR, an issue or a doc. That covers:

- the App Store Connect API key (`AuthKey_<id>.p8`), its key ID and the issuer ID
- the certificates and their `.p12` exports, and certificate hashes
- `src-tauri/embedded.provisionprofile`
- `.env.local`
- the `.pkg` and `.app` the script builds

The script reads all of these at run time from places git ignores, and it refuses an `--out` folder inside the repo. Its own lines mask the key ID and never print the issuer or the `.env.local` values, but Tauri's build output does print the signing certificate's hash. Read a log before you paste any of it somewhere public. If you change the script, keep it that way: look values up, don't write them in.

## Where things live

| What | Where |
| --- | --- |
| API key | `~/.appstoreconnect/private_keys/AuthKey_<id>.p8`, then `private/AuthKey_<id>.p8`. `ASC_KEY_ID` picks one by ID. Any team key can upload, including a Developer one |
| Issuer ID | `ASC_ISSUER_ID`, or the `Issuer ID:` line in `private/app-store-connect-values.txt` |
| Provisioning profile | `src-tauri/embedded.provisionprofile` in the main checkout (ignored). Mac App Store distribution profile |
| Certificates | Login keychain: "Apple Distribution" and "Mac Installer Distribution" (shows as "3rd Party Mac Developer Installer") |
| Build settings | `.env.local` in the main checkout, copied into the clean checkout |
| Team ID, bundle ID, version | Read from `src-tauri/Entitlements.plist` and `src-tauri/tauri.conf.json` at the commit being built |

## Steps

1. **Check first.** This takes a few seconds and builds nothing:

   ```sh
   node .claude/skills/mac-app-store-build/build.mjs --check
   ```

   It confirms the profile, both certificates and the API key, then asks App Store Connect for the latest approved version and the highest build number. Fix anything it reports before building.

2. **Build and validate.** Use your scratchpad folder for `--out`. The build takes about 8 minutes, so run it in the background with the output going to a log:

   ```sh
   node .claude/skills/mac-app-store-build/build.mjs --out <scratchpad>/mas
   ```

   `--ref` builds something other than `main`. The script builds a commit, never the working tree, so work that isn't committed can't get into the build. Don't build a feature branch unless the user names it.

3. **Upload** only when the user asked for it. Run the same command with `--upload`, or upload the `.pkg` that step 2 produced with Transporter. The script picks the build number from App Store Connect, so there's nothing to bump or commit. `src-tauri/tauri.appstore.conf.json` can stay at `"1"`.

4. **Hand over** what's left in App Store Connect: add the macOS version if it isn't there yet, write What's New, choose the build, answer the encryption question, then Add for Review. Don't do these through the API unless the user asks.

## Version rules

- The version comes from `tauri.conf.json` at the commit. It has to be higher than the last version Apple approved, or the upload is rejected. The script stops early when it isn't. `scripts/set-version.mjs` raises the version, and normally a desktop release has done that already.
- Every upload needs a higher build number than any build before it, across all versions. The script uses the highest build plus one. `--build <n>` overrides it.
- Uploading to a version that is waiting for review is allowed, but the new build doesn't replace the one in review. Someone has to choose it in App Store Connect.

## Known issues

- **Private WebKit names.** Since wry 0.56 (Tauri 2.12), the binary contains `drawsBackground` and `fullScreenEnabled`, and the script warns about them. Apple's validation accepts the build. If review rejects it for non-public API (guideline 2.5.1), this is the likely cause, and the fix belongs in wry or in how the app sets webview background colors.
- **One certificate, two entries.** The Apple Distribution certificate can be listed once per keychain. codesign refuses an ambiguous name, so the script signs with the SHA-1 hash of the certificate the profile names.
- **Test through TestFlight for Mac.** A store-signed build isn't meant to run straight from the build folder, so try a new build from TestFlight before submitting it.
- **The store edition turns some things off when it runs.** `APP_SANDBOX_CONTAINER_ID` is set inside the sandbox, and Claude Code, Codex and the in-app updater check it (`sandboxed()` in `src-tauri/src/claude_code.rs`). No build flag does this.
- `npm ci` prints `install-scripts` warnings under npm 11. The build doesn't need those scripts, and it works anyway.

## When it fails

| Message | What to do |
| --- | --- |
| Profile missing, expired or for another app | Make a Mac App Store profile on developer.apple.com (Certificates, Identifiers & Profiles), save it as `src-tauri/embedded.provisionprofile`, `chmod 644` it |
| Certificate not in the keychain | The user has to install it. A new Apple Distribution certificate also needs a new profile |
| App Store Connect answered 401 | The key was revoked or the issuer ID is wrong. A new key comes from Users and Access, Integrations, App Store Connect API |
| Version not higher than the approved one | Raise the version and commit it, or build a newer commit |
| `altool` validation errors | Read the ITMS code in the output. Most of them point at Info.plist or entitlements |

Leftover clean checkouts show in `git worktree list`. Remove one with `git worktree remove --force <path>`. After a successful run the script removes its own unless you pass `--keep-source`.
