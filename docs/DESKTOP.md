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
| `src-tauri/tauri.microsoftstore.conf.json` | Overlay config for Microsoft Store builds (offline WebView2 installer) |
| `src-tauri/Entitlements.plist` | macOS sandbox entitlements (required by the Mac App Store) |
| `src-tauri/capabilities/default.json` | Permissions granted to the main webview (save/open dialogs, fs write, opener, scoped http for free AI providers) |
| `src-tauri/capabilities/assistant.json` | Permissions for the hidden `assistant-*` windows: event emit from the signed-in provider origins only |
| `src-tauri/src/splash.rs` | Splash window lifecycle: reveals the main window once the frontend signals ready |
| `public/splash.html` | The splash screen itself: one self-contained file, no network and no IPC |
| `src-tauri/src/web_session.rs` | Embedded-webview assistant sessions ("the chromium part"): open/drive/relay the provider windows |
| `src-tauri/assistant/agent.js` | Built bundle of `src/lib/ai/webAssistantAgent.ts`, injected into the provider windows (run `build:assistant-agent`) |
| `src/lib/desktop.ts` | Frontend helper: native save dialogs in Tauri, anchor downloads on the web |
| `src/lib/ai/freeProviders.ts` | Keyless AI providers for the desktop free mode (Pollinations, Ollama, LM Studio) |
| `src/lib/ai/webAdapters.ts` | One registry (identity + DOM selectors) shared by the desktop agent, the extension, and the UI |
| `src/lib/ai/webDriverCore.ts` | Transport-agnostic DOM driver shared by the desktop agent and the extension |
| `.github/workflows/desktop.yml` | CI matrix build (Windows + macOS) on version tags |

## Prerequisites

- Node 20+, `npm ci`
- Rust stable (`winget install Rustlang.Rustup` on Windows, `rustup` on macOS)
- Windows: Visual Studio 2022 with the "Desktop development with C++" workload
- macOS: Xcode command line tools. For universal builds also run
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
  (rustup installs only the host target by default)

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

1. Build with the Store overlay config:

   ```sh
   npm run tauri:build -- --config src-tauri/tauri.microsoftstore.conf.json
   ```

   The overlay switches the WebView2 install mode to `offlineInstaller`, which
   the Store requires (the default `downloadBootstrapper` needs internet during
   install and can fail certification). Use the NSIS `.exe` (silent install via
   `/S`) or the MSI (silent via `/quiet`); the Store requires installers to
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
     `src-tauri/embedded.provisionprofile` (already gitignored via
     `*.provisionprofile`; do not commit it).
2. Edit `src-tauri/Entitlements.plist` and replace both `YOURTEAMID`
   placeholders with your Apple Developer Team ID. Uploads are rejected when
   the `com.apple.application-identifier` entitlement does not match the
   provisioning profile.
3. Create the app record in [App Store Connect](https://appstoreconnect.apple.com).
4. Build with the App Store overlay config (sandbox entitlements + embedded
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
5. Wrap the signed `.app` in an installer package:

   ```sh
   xcrun productbuild --sign "3rd Party Mac Developer Installer: <Team Name> (<TeamID>)" \
     --component "src-tauri/target/universal-apple-darwin/release/bundle/macos/Artboard Studio.app" \
     /Applications "Artboard Studio.pkg"
   ```

6. Upload with the Transporter app (or `xcrun altool --upload-app`), then
   complete the listing in App Store Connect and submit for review.

For distribution OUTSIDE the Mac App Store (direct .dmg download), use a
"Developer ID Application" certificate instead, skip the sandbox overlay, and
notarize: set `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), and
`APPLE_TEAM_ID` env vars and Tauri notarizes during `tauri build`. Unsigned
dmgs show a Gatekeeper warning and macOS 15+ makes them very hard to open.

## Built-in free AI providers (desktop only)

The AI agent's "Free, built in" tab exists only in the desktop app. It needs no
API key, no account, and no server of ours; every request goes straight from
the user's machine to the provider (the gpt4free idea, but restricted to
endpoints that are free on purpose so they do not rot):

- **Pollinations**: free public cloud endpoint (`text.pollinations.ai`), zero
  setup. Its anonymous tier decides which models are available (exactly one,
  text-only, as of July 2026); the UI badges the ones that can see images.
- **Ollama**: local models via its OpenAI-compatible server on `127.0.0.1:11434`.
  Vision needs a vision model (`ollama pull llama3.2-vision`).
- **LM Studio**: local models via its server on `127.0.0.1:1234`.

All three speak the OpenAI chat-completions dialect, so
`src/lib/ai/freeProviders.ts` drives them with one transport. Requests go
through `tauri-plugin-http` (registered in `lib.rs`, scoped in
`capabilities/default.json`), which bypasses CORS; that is what makes the
localhost runtimes reachable from the webview. The web build never shows this
tab; browser users use the extension/manual relay or the API-key mode
(OpenRouter's free-tier models are the zero-cost key there).

Adding a provider is one registry entry in `freeProviders.ts` plus, for a new
cloud host, a scope entry in `capabilities/default.json`.

## Use-my-account mode via an embedded browser (desktop only)

The AI agent's "Free, use my account" tab lets the user run on the Claude,
ChatGPT, Gemini, Copilot, DeepSeek, Qwen or Perplexity account they are already
signed into, with no API key. This is gpt4free's browser approach, but the real
Chromium doing the work is the one the app already ships (WebView2 / WKWebView),
so there is no server, no bundled browser, and no companion extension:

1. The shell opens the provider in its own hidden window (`assistant-<id>`,
   created by `web_session.rs`). Every window shares the app's browser profile,
   so the login persists across runs and restarts.
2. `assistant/agent.js` is injected as an initialization script. It recognises
   the site from `location.host`, and drives the page (types the prompt,
   attaches screenshots, waits for the reply) using the same selectors and DOM
   logic the extension uses (`webAdapters.ts` + `webDriverCore.ts`).
3. Two channels connect the shell and the page: the shell calls
   `window.__absAgent.dispatch/.cancel` with `webview.eval`; the agent reports
   `progress` / `result` / `error` / `ready` back over a Tauri event
   (`abs-web-event`). The main window's frontend
   (`src/lib/ai/webSessionDesktop.ts`) listens for that event.
4. The agent may emit only that event, and only from the provider origins listed
   in `capabilities/assistant.json` (`core:event:allow-emit` + `remote.urls`).
   The provider's cookies never leave its window; only `{prompt, images} ->
   replyText` crosses back.
5. If the user is not signed in, the agent reports `not-logged-in`, the shell
   reveals the window for a manual login, and the queued job runs once the page
   reloads signed in.

What gets typed into the provider is deliberately small: the first attempt is a
~2k character URL-mode prompt pointing at the repo-hosted template catalog, with
a verification-token handshake and an automatic inline fallback (shrunk to the
provider's message cap, e.g. ChatGPT free's ~4k character limit). That whole
scheme is documented in [AI-AGENT.md](AI-AGENT.md).

Claude, ChatGPT and Gemini are the exercised adapters; Copilot, DeepSeek, Qwen
and Perplexity are best-effort (`tested: false` in `webAdapters.ts`, badged
"beta" in the UI) and will need selector tuning as those sites change. Adding or
fixing a provider is one entry in `webAdapters.ts`, plus its host in
`capabilities/assistant.json` and `PROVIDERS` in `web_session.rs`, then rebuild
the agent bundle. The web build has no embedded browser, so browser users fall
back to the companion extension or the manual copy/paste relay.

Login detection is tri-state (`detectLoginState` in `webDriverCore.ts`:
`in` / `out` / `unknown`). A hidden background run only reveals its window on a
*definite* signed-out marker or a long stall, never on the `unknown` of a still
booting SPA. Collapsing the two (the old boolean) is what made an
already-signed-in Gemini run flash its window open then closed on a cold start.

## MCP server for external AI tools (desktop only)

The desktop app can host a local [Model Context Protocol](https://modelcontextprotocol.io)
server so an external AI client (Claude Code, Claude Desktop, Cursor, ...) can
drive Artboard Studio: list/create artboards, add and edit elements, set
backgrounds, and render an artboard to PNG.

**Turning it on.** It is **off by default** and manual: toggle **Settings ▸ Run
MCP server for external AI tools** in the app's menu bar. The choice is
persisted (`mcpServerEnabled` in the shared `settings.json`) and restored on the
next launch. When it flips on, a toast shows the connection URL; the server also
restarts automatically at startup if it was left on. A **status pill** floats at
the bottom-right of the canvas (`McpServerStatus.tsx`, desktop only): green + the
port while running, muted "off" otherwise. Clicking it opens a dialog with the
server URL (copyable) and a collapsible accordion of per-client setup
instructions — **Claude Code**, **Claude Desktop**, **VS Code (Copilot)**,
**Cursor** — plus the list of exposed tools with their parameters.

**Connecting a client.** The server speaks MCP over **Streamable HTTP** at
`http://127.0.0.1:8722/mcp` (localhost only; the port scans upward from 8722 if
busy, and the real URL is shown in the toast / `console.info`). For Claude Code:

```
claude mcp add --transport http artboard-studio http://127.0.0.1:8722/mcp
```

**Tools.** `list_artboards`, `get_artboard`, `create_artboard`,
`set_active_artboard`, `add_element`, `update_element`, `delete_element`,
`set_background`, `export_png` (returns the PNG as an image result).

**Architecture.** Rust owns only the *transport*; the tools live in the
frontend, where the design state is.

- `src-tauri/src/mcp_server.rs` binds the socket with `tiny_http` on a dedicated
  accept thread (one thread per request), handles the HTTP/JSON-RPC framing and
  the `Mcp-Session-Id` header, and always answers with `application/json` (it
  never opens a server→client SSE stream, so `GET /mcp` is `405`). A webview
  cannot listen on a port, so this has to be native. `abs_mcp_start` /
  `abs_mcp_stop` / `abs_mcp_status` / `abs_mcp_respond` are its commands; the
  Settings toggle calls `apply_enabled`, and `register` handles startup restore.
- Each JSON-RPC **request** is bridged to the main window over the
  `abs-mcp-request` event; the frontend (`src/lib/mcp/desktopMcpServer.ts`)
  answers `initialize` / `tools/list` / `tools/call` and returns the response
  through the `abs_mcp_respond` command, which unblocks the waiting HTTP handler
  (180s timeout). Notifications (no id) are acknowledged `202` without bridging.
- The tool implementations are the `McpDesignApi` built in
  `ArtboardStudioLayout.tsx` (assigned to a ref each render so the bridge always
  sees fresh state). They mutate through `handleArtboardsUpdate` — the same path
  `CanvasArea` uses — so history, DB persistence and the per-artboard element
  sync all keep working. `export_png` reuses the Export dialog's `html-to-image`
  capture recipe.

Because it drives the real app, keep it off unless you are using it; it is
localhost-bound and starts disabled.

## Operation tracing (timeline, screenshots, HTML report)

Every AI generate request, in all three modes ("use my account", built-in free,
API key), is recorded as one **operation** (`src/lib/ai/operationLog.ts`,
persisted in the `operations` Dexie table, IndexedDB). An `OperationRecorder`
collects a timeline as the run goes: each stage, the messages exchanged with the
provider (the prompt sent and the raw reply), any error, and, for the embedded
webview mode, a screenshot of the provider window at each step. The info icon on
a failed run's "That did not work" alert (and the "Recent runs" browser) opens
the timeline; it can be downloaded as a self-contained HTML report
(`operationReport.ts`, everything HTML-escaped, screenshots inlined as data
URLs). Only the newest ~60 runs are kept (`pruneOperations`).

Screenshots are captured natively: `abs_web_capture` in `web_session.rs` calls
WebView2's `CapturePreview` through the controller from `window.with_webview`,
writing a PNG the frontend downscales to a compact JPEG. It is a `#[cfg(windows)]`
path (the `webview2-com` / `windows` deps are windows-target-gated and must match
the versions wry resolves); it no-ops on macOS/Linux, and a failed capture just
means no screenshot for that step, never a failed run. Capture works while the
window is hidden; if a purely-hidden run ever yields blank frames on some
machine, nudging the controller's `IsVisible` before the capture is the fix.

## Splash screen and first paint

A window exists on screen before its webview has painted anything, and that
empty client area is the black rectangle you see when launching an unprepared
Tauri app. The sequence that avoids it:

1. `main` is declared `"visible": false` in `tauri.conf.json` and loads Next.js
   off-screen.
2. `splash.rs` builds the `splashscreen` window **hidden**, pointing at
   `splash.html`, and shows it from `on_page_load(Finished)`, so the first
   frame the user sees is already painted.
3. `signalAppReady()` (`src/lib/desktop.ts`) runs from a React effect in
   `AppReadySignal`, mounted last in `src/app/page.tsx` so React's bottom-up
   effect order guarantees the studio has committed. It waits on
   `document.fonts.ready`, then invokes `abs_app_ready`.
4. `splash.rs` shows `main`, focuses it, then closes the splash.

Measured on Windows against a warm dev server: splash visible at ~700ms, main
window revealed at ~1.8s, and main's first visible frame is the fully painted
studio.

Rules for anyone touching this:

- **Never declare the splash in `tauri.conf.json`.** A config window is mapped
  the instant it is created, so it shows black for the ~600ms WebView2 needs to
  start up. That just relocates the bug. It must be built hidden and shown on
  page load. Showing nothing for half a second beats showing black.
- **`backgroundColor` is not sufficient on Windows.** It colors the window
  layer, but WebView2 composites its own layer on top and that layer is black
  until first paint. (Confirmed: `PrintWindow` captures the teal window layer
  while a screen capture of the same window shows black.) It is still worth
  setting for macOS and Linux, and for resize/expose.
- **Do not use `requestAnimationFrame` to detect readiness.** A hidden window
  produces no compositor frames, so rAF never fires and the splash would hang
  until the fallback. Timers and promises still run (Chromium throttles
  background timers to ~1Hz, which is why the fonts race has a 2.5s cap).
- **Keep the fallback.** `splash.rs` reveals `main` after 12s no matter what, so
  a JS exception before hydration cannot leave a user staring at a splash. It
  also reveals `main` if the splash is destroyed some other way (Alt+F4), or if
  the splash webview fails to build at all, which really happens, e.g. when a
  dying instance still holds the WebView2 user-data folder.
- **`MIN_VISIBLE` keeps the splash up 800ms** once shown. Without it a warm
  start paints and tears down the splash inside ~300ms, which reads as a flicker.
- **`splash.html` must stay self-contained** (inline CSS + inline SVG, system
  fonts). It has no capability entry, so it cannot call Tauri commands, and it
  must render on a cold offline start before anything else is available.
- The splash window is opaque and square-cornered on purpose: transparent
  windows need `macos-private-api` and a compositor on Linux, and degrade to
  black corners without one.
- Keep `main`'s `backgroundColor` in sync with `--background` in
  `src/app/globals.css`.

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
  imports them); the desktop app is fully offline except Google Fonts,
  placeholder thumbnails, and whichever AI provider the user picks (the local
  Ollama / LM Studio providers work offline too).
