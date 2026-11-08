# In-app updates

The desktop app updates itself from our own update server on the VPS. A release goes out through the usual desktop workflow, and every installed copy that can update itself finds it, downloads it in the background, checks its signature, and offers a restart. This page covers how that works, the one-time setup, releasing, steering a rollout, testing, and what to look at when something goes wrong.

## How it works

```
GitHub Actions                          VPS                                 Installed app
desktop.yml                             openscreengen-updates               src-tauri/src/updater.rs
                                        updates.openscrgen.app
build legs: build, sign each update
payload, collect it               ──►   releases/<version>/<files>
updates job: after all three legs ──►   releases/<version>/manifest.json
publish, then move the channel    ──►   channels/stable.json, beta.json
                                                                   ◄──  GET /v1/desktop/{os}/{arch}/{installer}/{version}
                                        204, or the one file that       ?channel=stable&bucket=37
                                        fits, with its signature   ──►  download, verify, wait for Restart
```

Three things keep it safe:

- **Every update is signed.** The release workflow signs each payload with a private key that exists only in the GitHub secrets. The public half is built into the app, and the updater plugin refuses any download that key did not sign. The server never sees the private key, so a broken-into server can withhold updates but cannot make an installed copy run anything we did not build.
- **Nothing installs without the user.** The app downloads in the background, then waits. The restart is the user's to choose, and before it every editor window writes its unsaved edits; if one cannot, the restart is called off.
- **A release reaches installs in steps.** Each install draws a number from 0 to 99 once and keeps it. A channel offers its release to the installs whose number is below its rollout percentage, so 10% means the same tenth of installs every time, and widening it adds installs without reshuffling. The number identifies nobody: every install shares one of a hundred values.

### What each build does

| Build | Updates |
| --- | --- |
| Windows `.exe` (NSIS) and `.msi`, the macOS app from the `.dmg`, Linux `.AppImage` and `.deb` | Downloads, verifies and installs, each with its own kind of installer |
| Windows portable `.zip` | Says a new version is out and links to the download. The updater would run a full installer beside the portable exe, so it never installs |
| Microsoft Store (MSIX) | Never checks. The Store updates it |
| Mac App Store | Never checks. Apple allows no other way to update |
| A local build, a fork, `tauri dev` | Never checks: the update server and key are only in builds the release workflow made |

The app tells them apart in `updater.rs`: the bundler marks the binary inside each installer with its kind, the portable exe carries no mark, an MSIX install runs with a package identity, and the Mac App Store build runs in the app sandbox.

### In the app

- **When it checks.** 20 seconds after the editor opens, then every 6 hours, again when the window comes back to the front with a check overdue, and straight away when the user switches channel. A failed check is tried again after an hour. **Help > Check for updates** checks on demand and says what it found.
- **Settings > Updates.** The version, where updates stand, and two switches: check automatically (on by default), and get beta versions (off by default).
- **About.** Under the version, where updates stand (with when the server last answered) and the one button that acts on it: Check for updates, Restart now, or Download for the portable copy. A store build says which store keeps it current.
- **The prompt.** When an update is downloaded, "Restart to update" appears at the top of the sidebar footer. It opens the version, the release notes and two buttons, Restart now and Later. Later keeps the item there. A release marked critical opens its prompt by itself, once per session.
- **The restart.** Every editor window writes its edits, the Claude Code and Codex processes stop, and the update goes in. On Windows the installer runs with a progress bar and reopens the app. On macOS and Linux the app restarts into the new version. A `.deb` update asks for the administrator password, and so does a macOS app in a folder the user cannot write to.
- **A rollout that stops.** If a channel is paused, or its rollout narrowed, after an install downloaded the update but before it restarted, the next check drops the download.
- **What an update leaves behind.** On Windows the plugin runs the installer from a folder of its own in `%TEMP%` (`Open Screenshot Generator-<version>-updater-<random>`), which has to outlive the app it replaces. The next start of the app removes it, so an update never leaves a copy of the installer behind for good.

## One-time setup

1. **Make the keys.** Run `npm run updates:keygen` on your own computer. It makes the signing key with a long random password, writes the key to `~/.tauri/open-screenshot-generator-updater.key`, and prints every value the next step needs, including a fresh admin token for the server. GitHub never shows a secret again once it is saved, so copy the printed values into a password manager, and back up the key file somewhere other than this computer. Losing the key or its password means no installed copy can ever be updated again.
2. **Tell GitHub.** In the repository, under Settings, then Secrets and variables, then Actions:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `UPDATES_URL` | `https://updates.openscrgen.app` |
   | Variable | `UPDATER_PUBKEY` | the content of the `.key.pub` file |
   | Secret | `TAURI_SIGNING_PRIVATE_KEY` | the content of the `.key` file |
   | Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

   Then create an environment called `updates` (Settings, then Environments) with one secret, `UPDATES_ADMIN_TOKEN`, set to the token the script printed. Only the jobs that publish and steer releases run in that environment, so no other job can read it. Add required reviewers to it if every publish should wait for an approval.
3. **Run the server.** Follow "Desktop updates" in [infra/vps/README.md](../infra/vps/README.md#desktop-updates), and "The update server is a different loop again" under its deploy steps: the `updates` A record, the Caddy block in the neighbour's repository, the same admin token in `/opt/openscreengen/.env`, and the `updates-data` folder owned by uid 1000. Then check it answers:

   ```bash
   curl https://updates.openscrgen.app/healthz
   ```

4. **Release.** The next desktop release is the first with the updater in it. Copies installed from earlier releases have no updater, so their users update once by hand, and from then on the app does it.

The setup is all or nothing. With none of `UPDATES_URL`, `UPDATER_PUBKEY` and `TAURI_SIGNING_PRIVATE_KEY` set, a release ships without in-app updates and the run says so. With some but not all of them, the release stops before anything is tagged, rather than ship a build that can never be updated.

## Releasing

Run **Release desktop app (Tauri)** from the Actions tab as before. Four inputs decide how the release reaches installed copies:

| Input | Default | What it does |
| --- | --- | --- |
| `update_channel` | `stable` | The channel that gets this release. A beta release reaches only installs that opted into beta versions |
| `update_rollout` | `100` | The percentage of installs offered it now. Widen it later with **Desktop updates** |
| `update_notes` | empty | What is new, shown in the update prompt. Plain text; each line is a line |
| `update_critical` | off | The release fixes something serious: the prompt opens by itself and says so |

What happens on the way:

1. The version job checks the setup before it tags anything.
2. Each build leg writes `src-tauri/tauri.updater.conf.json` (the server's address, the public key, and the switch that makes the build sign its update payloads) and builds with it.
3. The Linux leg signs the AppImage again after `scripts/patch-appimage.sh` repacks it, because the repack changes the file the first signature was made for.
4. Each leg collects its signed payloads with `scripts/updates/collect.mjs` and attaches them to the run.
5. Once all three legs have built, the `updates` job merges what they collected into one manifest, uploads the files, publishes the manifest, and only then moves the channel to the new version. An installed copy never sees half a release, and a release that failed on one platform reaches none.

A dry run builds and signs everything and attaches the collected files to the run, but publishes nothing. The Microsoft Store and Mac App Store builds are unaffected: the Store takes the MSIX as before, and the App Store build is made by hand without the updater.

## Steering a rollout

Run **Desktop updates** from the Actions tab:

| Action | What it does |
| --- | --- |
| `status` | What each channel offers, recent releases, and how many checks each installed version made since the server started |
| `rollout` | Offer the channel's release to `percent` of installs |
| `pause` | Stop offering the channel's release |
| `resume` | Offer it again |
| `promote` | Point the channel at a published `version`, at `percent` |

The same from a terminal, with the URL and token in the environment:

```bash
export UPDATES_URL=https://updates.openscrgen.app
export UPDATES_ADMIN_TOKEN=...
npm run updates -- status
npm run updates -- rollout --channel stable --percent 50
npm run updates -- promote --channel stable --version 1.2.0
```

**A staged release:** release with `update_rollout` at 10. Watch the issue tracker and the `status` numbers for a day, then widen to 50, then 100.

**A beta:** release with `update_channel` set to `beta`. When it holds up, `promote` it to `stable`. Beta installs get whichever of the two channels is newer, so they are never behind stable.

**A bad release:** `pause` the channel straight away. Installs that downloaded it but had not restarted drop it at their next check. Then release the fix as a new version, which moves the channel and unpauses it. A channel cannot be pointed back at an older version: installed copies only update forward, so everyone already on the bad release would stay there.

## Testing an update end to end

A real install needs two release builds signed with the same key and an update server. A throwaway key and a local server keep your real ones out of it.

1. Make a test key: `npx tauri signer generate --ci --write-keys "<a temp folder>/osg-test.key"`.
2. Start a local server from `infra/vps/update-server` (its README has the command) with `UPDATES_ADMIN_TOKEN` set to any 32 or more characters.
3. Write `src-tauri/tauri.updater.conf.json` by hand. The release workflow refuses plain http, and so does a release build unless the overlay allows it, which is why this one says so and CI never would:

   ```json
   {
     "bundle": { "createUpdaterArtifacts": true },
     "plugins": {
       "updater": {
         "pubkey": "<the content of osg-test.key.pub>",
         "endpoints": ["http://localhost:8730/v1/desktop/{{target}}/{{arch}}/{{bundle_type}}/{{current_version}}"],
         "dangerousInsecureTransportProtocol": true
       }
     }
   }
   ```

4. With `TAURI_SIGNING_PRIVATE_KEY` set to the test key's content and its password in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, run `npm run tauri:build -- --config src-tauri/tauri.updater.conf.json` and install what it built.
5. Raise the version without committing it (`node scripts/set-version.mjs patch`) and build again the same way. Then publish that build to the local server:

   ```bash
   node scripts/updates/collect.mjs --out test-updates
   node scripts/updates/release.mjs manifest --in test-updates --out test-updates/manifest.json
   UPDATES_URL=http://localhost:8730 UPDATES_ADMIN_TOKEN=<the same token> \
     node scripts/updates/release.mjs publish --dir test-updates --manifest test-updates/manifest.json
   ```

   `release.mjs` takes plain http only for a server on this machine.
6. Open the installed first build and pick Help > Check for updates.

Put the version back (`git checkout -- package.json cli/package.json src-tauri`) and delete the overlay when you are done.

## When something goes wrong

**A release run says in-app updates are not set up.** None of `UPDATES_URL`, `UPDATER_PUBKEY` and the `TAURI_SIGNING_PRIVATE_KEY` secret is set. See the setup above.

**A release stops with "half set up".** Some of the values are set and some are not. The message names the missing ones.

**An installed copy never offers an update.** Ask the server what it would answer that copy:

```bash
curl -i "https://updates.openscrgen.app/v1/desktop/windows/x86_64/nsis/1.0.6?channel=stable&bucket=0"
```

A `204` means nothing newer is on offer for that platform and bucket: run `status` to see whether the channel is paused, its rollout too low for the copy's bucket, or the platform missing from the release. The copy's own bucket is in `updates.json` in its app config folder; delete that file to draw a new one. The app also writes `[updates]` lines to its standard error.

**Downloads fail their signature check.** `UPDATER_PUBKEY` is not the public half of `TAURI_SIGNING_PRIVATE_KEY`, or a payload changed after it was signed. Builds made before a key change can only take updates signed with the key they were built with, so never replace the key while copies built with it are in use.

**The AppImage fails and the others work.** The re-sign step after the AppImage patch did not run, or ran on a different file than the one collected.

## Security notes

- **The signing key, its password and the admin token are GitHub secrets.** This repository's run logs are public, and GitHub masks secrets in them. Nothing in the workflows prints them: the build overlay holds only the public key and the server's address, and what is collected and published is installers and their signatures, which are public by design. Keep them secrets. With the key and its password anyone could sign an update every installed copy accepts, and installed copies trust only the key they were built with, so a leaked key can only be replaced by everyone reinstalling once.
- The page cannot call the updater plugin: no capability grants its commands. Only `updater.rs` drives it, and only for the `main` window.
- The update server holds no signing key. Its admin API needs a token of at least 32 characters, compared in constant time, and a published release can never be changed.
- The Tauri CLI this app builds with (2.11) does not write the version into a signature. A server that was broken into could therefore offer an older genuine release under a newer version number, and the app would install it. The plugin can refuse that (`requireSignedVersion`), but only for signatures that carry their version. When the app moves to Tauri 2.12 or later, add `"requireSignedVersion": true` to the overlay in `scripts/updates/lib.mjs` once every release users can still update from was signed by the newer CLI.

## Files

| File | What it is |
| --- | --- |
| [src-tauri/src/updater.rs](../src-tauri/src/updater.rs) | Which builds update, the check, the download, the restart |
| [src/lib/updates/](../src/lib/updates/) | The page's copy of the state, the schedule, and the copy it shows |
| [src/components/open-screenshot-generator/updates/UpdateSidebarItem.tsx](../src/components/open-screenshot-generator/updates/UpdateSidebarItem.tsx) | The sidebar prompt |
| [infra/vps/update-server/](../infra/vps/update-server/) | The update server |
| [scripts/updates/](../scripts/updates/) | Build overlay, collecting payloads, publishing and steering, key setup |
| [.github/workflows/desktop.yml](../.github/workflows/desktop.yml) | Signs, collects and publishes with each release |
| [.github/workflows/desktop-updates.yml](../.github/workflows/desktop-updates.yml) | Steers releases already published |
