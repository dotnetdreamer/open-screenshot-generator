# Desktop app (Tauri)

Artboard Studio ships as a native desktop app for Windows and macOS using
[Tauri v2](https://v2.tauri.app). The same Next.js static export that powers the
web app is embedded in a native shell (WebView2 on Windows, WKWebView on macOS),
so there is one codebase for web and desktop.

## Layout

| Path | Purpose |
| --- | --- |
| `src-tauri/` | Rust shell, config, icons, capabilities |
| `src-tauri/tauri.conf.json` | App identity, window, bundling targets |
| `src-tauri/tauri.appstore.conf.json` | Overlay config for Mac App Store builds |
| `src-tauri/Entitlements.plist` | macOS sandbox entitlements (required by the Mac App Store) |
| `src-tauri/capabilities/default.json` | Permissions granted to the webview (save/open dialogs, fs write, opener) |
| `src/lib/desktop.ts` | Frontend helper: native save dialogs in Tauri, anchor downloads on the web |
| `.github/workflows/desktop.yml` | CI matrix build (Windows + macOS) on version tags |

## Prerequisites

- Node 20+, `npm ci`
- Rust stable (`winget install Rustlang.Rustup` on Windows, `rustup` on macOS)
- Windows: Visual Studio 2022 with the "Desktop development with C++" workload
- macOS: Xcode command line tools

## Develop and build

```sh
npm run tauri:dev     # dev server on :9002 inside a native window, hot reload
npm run tauri:build   # release bundles
```

Build artifacts land in `src-tauri/target/release/bundle/`:

- Windows: `msi/Artboard Studio_<version>_x64_en-US.msi` and `nsis/Artboard Studio_<version>_x64-setup.exe`
- macOS: `macos/Artboard Studio.app` and `dmg/Artboard Studio_<version>_<arch>.dmg`

Both installers are immediately usable for direct distribution (download from a
website, GitHub Releases, etc.). Store submission needs signing, below.

Do NOT set `NEXT_PUBLIC_BASE_PATH` when building for desktop. That variable is
only for the GitHub Pages deploy; with it set, every asset in the bundle 404s.

## Versioning

Bump `version` in `src-tauri/tauri.conf.json` (this is the version shown in
installers and required to increase for store updates). Tag the commit
`v<version>` and push the tag; CI builds Windows and macOS bundles and attaches
them to a draft GitHub release.

## Icons

Icons are generated from the canonical brand SVG. To regenerate after a logo
change:

```sh
npx tauri icon src/app/icon.svg
```

This refreshes `src-tauri/icons/` including the ICO (Windows), ICNS (macOS),
and the `Square*Logo.png` tiles used by the Microsoft Store.

## Microsoft Store (Windows)

You need a [Partner Center](https://partner.microsoft.com/dashboard) developer
account (one-time fee, ~19 USD for individuals).

The Store accepts classic Win32 installers (EXE/MSI), which is the path of
least resistance for Tauri apps:

1. Build: `npm run tauri:build`. Use the NSIS `.exe` (supports silent install
   via `/S`) or the MSI (silent via `/quiet`). The Store requires installers to
   install silently with no UAC prompt escalation beyond the manifest.
2. Sign the installer with a certificate trusted by Windows. The cheapest
   sustainable option is
   [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/);
   traditional OV/EV code-signing certs also work. Wire it into the bundle step
   with `bundle.windows.signCommand` in `tauri.conf.json` so `tauri build`
   produces signed artifacts.
3. Host the signed installer at a stable HTTPS URL (a GitHub Release asset URL
   works).
4. In Partner Center, create a new app, reserve the name "Artboard Studio",
   choose the EXE/MSI app type, and point the submission at the installer URL.
   Fill in the silent install switch (`/S` for NSIS), listing assets (the
   `src-tauri/icons/Square*Logo.png` and `StoreLogo.png` tiles fit the required
   sizes), privacy policy URL, and submit for certification.
5. Updates: upload a new installer version and update the submission. The Store
   re-downloads from your URL, so a versioned URL per release is safest.

Alternative: package as MSIX with the
[MSIX Packaging Tool](https://learn.microsoft.com/windows/msix/packaging-tool/tool-overview)
for Store-managed installs and automatic updates. Store-delivered MSIX is
signed by Microsoft, so no code-signing certificate is needed, at the cost of
an extra packaging step per release.

## Mac App Store (macOS)

Requires an [Apple Developer Program](https://developer.apple.com/programs/)
membership (99 USD/year) and a Mac (or the macOS CI job) to build and sign.

1. In your Apple Developer account, create:
   - an App ID matching `com.ccrstech.artboardstudio`,
   - an "Apple Distribution" certificate and a "Mac Installer Distribution"
     certificate,
   - a Mac App Store provisioning profile for the App ID. Download it as
     `src-tauri/embedded.provisionprofile` (gitignored by `*.provisionprofile`
     if you add that; do not commit it).
2. Create the app record in [App Store Connect](https://appstoreconnect.apple.com).
3. Build with the App Store overlay config (sandbox entitlements + embedded
   profile, `.app` bundle only):

   ```sh
   npm run tauri:build -- --target universal-apple-darwin \
     --config src-tauri/tauri.appstore.conf.json \
     --bundles app
   ```

   Set `APPLE_SIGNING_IDENTITY="Apple Distribution: <Team Name> (<TeamID>)"` in
   the environment so Tauri signs the bundle. `Entitlements.plist` already
   enables the App Sandbox (mandatory for the Mac App Store), user-selected
   read/write (save/open dialogs), and outbound network (Google Fonts).
4. Wrap the signed `.app` in an installer package:

   ```sh
   xcrun productbuild --sign "3rd Party Mac Developer Installer: <Team Name> (<TeamID>)" \
     --component "src-tauri/target/universal-apple-darwin/release/bundle/macos/Artboard Studio.app" \
     /Applications "Artboard Studio.pkg"
   ```

5. Upload with the Transporter app (or `xcrun altool --upload-app`), then
   complete the listing in App Store Connect and submit for review.

For distribution OUTSIDE the Mac App Store (direct .dmg download), use a
"Developer ID Application" certificate instead, skip the sandbox overlay, and
notarize: set `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), and
`APPLE_TEAM_ID` env vars and Tauri notarizes during `tauri build`. Unsigned
dmgs show a Gatekeeper warning and macOS 15+ makes them very hard to open.

## Desktop-specific behavior notes

- File saves: WKWebView on macOS ignores `<a download>`, so all export paths
  (PNG artboards, JSON projects) go through `src/lib/desktop.ts`, which uses the
  native save dialog + fs plugin inside Tauri and falls back to normal browser
  downloads on the web. Any new export feature must use this helper.
- Drag and drop: `dragDropEnabled: false` in `tauri.conf.json` is REQUIRED.
  Tauri's native drag-drop handler swallows HTML5 drag events on Windows, which
  would break dragging elements from the palette onto the canvas.
- External links: WebViews ignore `target="_blank"`; use `openExternal()` from
  `src/lib/desktop.ts` (About dialog GitHub link already does).
- Storage: projects live in IndexedDB inside the webview profile
  (per-user, per-app). Uninstalling the app can delete them; the JSON
  export/import flow is the backup story.
- The Firebase/Genkit packages in package.json are vestigial scaffold (nothing
  imports them); the desktop app is fully offline except Google Fonts and
  placeholder thumbnails.
