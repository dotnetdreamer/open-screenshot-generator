# Desktop app (Tauri)

Open Screenshot Generator ships as a native desktop app for Windows and macOS using
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
| `.github/workflows/desktop.yml` | Manually triggered release build (Windows + macOS + Linux); owns the version bump and tag |
| `scripts/set-version.mjs` | Sets the version across the four files that carry it |

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

- Windows: `msi/Open.Screenshot.Generator_<version>_x64_en-US.msi` and `nsis/Open.Screenshot.Generator_<version>_x64-setup.exe` (Tauri replaces the spaces in the product name with dots for these two)
- macOS: `macos/Open Screenshot Generator.app` and `dmg/Open Screenshot Generator_<version>_<arch>.dmg`

Both installers are immediately usable for direct distribution (download from a
website, GitHub Releases, etc.). Store submission needs signing, below.

Do NOT set `NEXT_PUBLIC_BASE_PATH` when building for desktop. That variable is
only for the GitHub Pages deploy; with it set, every asset in the bundle 404s.

**Developer tools.** Toggle **Settings ▸ Developer tools** (or press `F12`) to
open the webview inspector on the main window. The choice is persisted
(`devtoolsOpen` in `settings.json`) and the inspector reopens at the next launch.

`src-tauri/src/devtools.rs` owns this, and it is fussier than it looks:

- WebView2 only lets us *open* the inspector. wry's `close_devtools` is an empty
  function on Windows and `is_devtools_open` always returns `false` (tauri
  documents both as "Windows: Unsupported"), so a check menu item wired straight
  to those APIs lies: unchecking it closes nothing, and the check stays on after
  the user closes the inspector with its own X. On Windows we therefore find the
  inspector's OS window inside our own process tree, close it with `WM_CLOSE`,
  and poll for its disappearance so the menu check follows a close we did not
  initiate. macOS and Linux use wry's real implementations.
- `open_devtools()` during `setup` is silently dropped - `main` is still hidden
  behind the splash and has not navigated - so the launch-time restore runs from
  the splash handoff (`splash.rs` calls `devtools::restore`), not from `setup`.
- The `devtools` feature (needed outside debug builds) is enabled **for Windows
  only** in `Cargo.toml`, because it is a *private* API on macOS and would put
  the Mac App Store build at risk. Release builds on macOS/Linux hide the menu
  item rather than offer a dead one; debug builds there still have it.

## Versioning and cutting a release

The version lives in four files that must agree: `src-tauri/tauri.conf.json`
(what installers display, and what stores require to increase on every update),
`package.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`. Never edit
them by hand. `scripts/set-version.mjs` sets all four at once:

```sh
node scripts/set-version.mjs patch      # 0.1.0 -> 0.1.1
node scripts/set-version.mjs minor      # 0.1.0 -> 0.2.0
node scripts/set-version.mjs 1.4.0      # exact
node scripts/set-version.mjs patch --dry-run   # just print the next version
```

It refuses a version that is not newer than the current one, because neither
Cargo nor the Windows installer will downgrade in place.

Releases are cut by hand, never automatically: nothing builds on a push or a
tag. Go to **Actions > Release desktop app (Tauri) > Run workflow** and pick:

| Input | Effect |
| --- | --- |
| `bump` | `patch` (default), `minor` or `major`, applied to the current version |
| `version` | An exact version, e.g. `1.2.0`. Overrides `bump` when set. |
| `dry_run` | Build the installers and attach them to the run as artifacts. No version bump, no tag, no release. |

A real run bumps the four files, commits that as `release: v<version>` on the
default branch, tags it, builds Windows, macOS and Linux, and publishes a
GitHub release with the installers attached. Use `dry_run` first when you have
changed anything that could affect the build.

The bundles are unsigned, so users get a SmartScreen or Gatekeeper prompt on
first launch (the release notes tell them how to get past it). See the store
sections below for signing.

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
4. In Partner Center, create a new app, reserve the name "Open Screenshot Generator",
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
   - an App ID matching `com.dotnetdreamer.openscreenshotgenerator` (the
     identifier changed completely with the rename, so an account set up before
     it needs a new App ID and a new provisioning profile),
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
     --component "src-tauri/target/universal-apple-darwin/release/bundle/macos/Open Screenshot Generator.app" \
     /Applications "Open Screenshot Generator.pkg"
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

## Any OpenAI-compatible endpoint, with your own key

The "Use my API key" tab ends with **OpenAI compatible**, where the endpoint is
yours to name: a MiniMax, DeepSeek, Groq, Together, Mistral, xAI, Moonshot,
Z.ai or Qwen subscription, a gateway such as the Vercel AI Gateway, or a vLLM
or LiteLLM server on this machine. `COMPATIBLE_PRESETS` in
`src/lib/ai/providers.ts` only fills the URL in for you; anything else works by
pasting its base URL, and "Load" asks the endpoint itself what models it serves.

This is a desktop-first feature for the same reason the store upload is: the
calls go through `tauri-plugin-http` (`src/lib/ai/httpBridge.ts`) rather than the
webview, so CORS never enters into it and a `127.0.0.1` server is reachable.

That is also why `capabilities/default.json` allows `https://*` in the
`http:default` scope. The host of a user-named endpoint cannot be listed ahead of
time, and the named hosts in that file are documentation rather than the boundary.
Plain http stays limited to `localhost` and `127.0.0.1`, so nothing new leaves the
machine in cleartext. A host the scope does refuse is retried through the webview,
which then only succeeds if that host allows direct calls from a web page.

A key belongs to an endpoint, not to the provider slot: custom-endpoint keys are
stored per host in `AiSettings.compatibleKeys`, and the panel swaps the field
whenever the endpoint changes, so a key pasted for one service is never sent to
the next one the user tries.

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
drive Open Screenshot Generator: start a project from a template, open a saved
one, list/create artboards, add and edit elements (including palette assets), set
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
claude mcp add --transport http open-screenshot-generator http://127.0.0.1:8722/mcp
```

**Tools.**

- *Canvas* — `list_artboards`, `get_artboard`, `create_artboard`,
  `set_active_artboard`, `update_artboard` (rename / resize / reorder; a resize
  scales the elements with the canvas unless `scaleContent:false`),
  `delete_artboard` (refused on the last one — a project with zero artboards is
  a state the UI cannot produce and the canvas would read as stuck loading),
  `duplicate_artboard` (deep copy with fresh element ids — the way to build a
  set of screenshots that share a base), `set_background`.
- *Elements* — `add_element`, `add_elements` (a whole board in one atomic
  update: one round trip, one undo step, and a rejected entry adds nothing),
  `update_element`, `delete_element`, `reorder_element` (z-order is array
  order, so this is how a background slides behind existing work instead of
  rebuilding the board), `measure_element`, `group_elements` +
  `transform_elements` (move or scale a set about its shared bounding box).
  Beyond position/size/colour, elements take `opacity`, `shadow`
  (`{x, y, blur, color}`, cast by the real silhouette), `blur`, plus
  `fillGradient` on shapes and `letterSpacing` / `lineHeight` on text — passing
  `null` clears one. See `src/lib/elementStyle.ts`.
- *Measuring* — `measure_element` returns the rendered box in artboard pixels,
  and for text the actual glyph bounds (`textBox`) plus a `clipped` flag.
  Necessary because text lays out at `fontSize / 0.3` and wraps inside its box,
  so nothing about the real bounds is predictable from the stored props.
- *Fonts* — `list_fonts` returns the families the app actually loads (from
  `src/services/fontService.ts`). `add_element` / `update_element` now **reject**
  an unknown `fontFamily` with the nearest matches, instead of letting the
  browser fall back to a default serif and silently ship the wrong typeface.
- *Images* — `upload_asset` stores an image once (Dexie `media` table) and
  returns an `asset:<id>` reference accepted by `imageSrc` / `screenshotSrc`,
  so an icon reused across five boards is sent once rather than five times;
  `list_assets` / `delete_asset` manage them. The reference is expanded to the
  bytes when the element is built, so the saved project is identical to a
  hand-made one — the saving is on the wire, not on disk.
- *Export* — `export_png` takes a `scale` (0.1–4; `0.25` gives a readable proof
  for a sixteenth of the base64) and `save:true` to write the file and return
  its **path** instead of the image. `export_all` renders every board in canvas
  order into one folder as `01_<name>.png`. Files are written by the
  `abs_mcp_write_png` Rust command, defaulting to
  *Downloads/Open Screenshot Generator*, because the JS `fs` plugin only unlocks
  paths the user picked in a dialog and an MCP export is unattended.
- *Templates and projects* — `list_templates`, `get_template` (the fillable
  device/text slots and their stable element ids), `create_project_from_template`
  (copies the template, applies optional text/screenshot fills, opens it and
  lands it in **Recent projects**), `list_projects`, `open_project`.
- *Palette assets* — `list_library` browses the Elements, Devices and Images
  libraries the same way the palette does (groups first, then items). Every
  entry has a `libraryId` that `add_element` accepts in place of `type`/`subType`
  and expands into exactly what clicking that tile would drop:
  `element:shape-octagon`, `image:app-store`, `device:iphone-15-pro`,
  `device3d:iphone-tilted-left-black`, `devicecolor:iphone-outline-sky`.
- *App Preview videos* — `list_preview_scenes` / `add_preview_scene` drop a
  whole finished preview **board** (background, phone mockup, timed copy,
  gesture hints, call to action), already animated and 18 seconds long, inside
  the 15 to 30 second window App Store Connect accepts. That is the cheap path;
  the parts are there too: `add_element` builds `video-device` (a phone playing
  a recording), `video` and `gesture` layers, `set_animation` gives any other
  layer an enter/exit, and `set_preview_duration` sets the board length.
  `upload_recording` is what puts real footage in — `upload_asset` refuses a
  video, and its `asset:` refs expand into data URLs, which would inline tens of
  megabytes into the project; a recording stays a blob and the element holds
  only its `mediaId`. `list_recordings` lists what is stored.
  `get_preview_timeline` reads a board back as clips plus a list of what will
  bite (a board under Apple's floor, a layer animating past the end, no
  recording in the phone yet), because the model cannot see the canvas. Note
  these scenes are **not** in `list_templates`, which deliberately hides the
  `app-preview` category.
  The rule that governs authoring: on the canvas and in a PNG still every layer
  is drawn at rest, all at once, so two layers must never share a position and
  take turns in time. It looks right in the MP4 and like a smear everywhere
  else. Use time to bring layers IN.
- *Languages, the set-up* — `list_supported_locales` is the catalog (the store
  locale to add a language by, whether a machine engine covers it, what App
  Store Connect and Google Play call it, and the font its script needs);
  `add_locales` / `remove_locales` / `set_base_locale` manage the project's own
  list, `list_locales` reads it, and `set_locale` chooses what the canvas shows.
  A language is an **overlay**, not a copy: one set of artboards and one layout,
  with per-language overrides on top, so a design fix reaches every language.
- *Languages, the copy* — `list_translations` returns the translation table as
  data, including where each string came from (`inherited` / `manual` / `auto`,
  and a `stale-` prefix once the base copy has been edited under it), and
  `set_localized_texts` writes a whole batch back in one commit, one undo step.
  That pairing is the point: the client is itself a translator, and its copy
  beats the built-in engine's. `translate_locales` runs that engine anyway for a
  first draft or a `stale` refresh, and `export_translations_csv` /
  `import_translations_csv` are the round trip for a human translation agency.
- *Languages, the design* — `set_locale_override` gives one element its own
  screenshot, typeface, box, position or colour in ONE language, or hides it
  there (`hidden: true`); `reset_locale_overrides` hands an element, an artboard
  or a whole language back to the shared design. `export_png` / `export_all`
  take a `locale`, so a per-language delivery is one call each and the editor is
  left on the language the user had it on.

A model should normally *start from a template* — `list_templates` →
`get_template` → `create_project_from_template` — and only build from bare
artboards when nothing fits. Building from scratch, the cheap path is
`add_elements` for the first board, `duplicate_artboard` per screen, then
`update_element` for the copy that differs; `upload_asset` for anything reused;
`export_png` at `scale: 0.25` while iterating and `export_all` at the end.
Localising an existing project is `add_locales` → `list_translations` with
`filter: "untranslated"` → translate the strings yourself →
`set_localized_texts` → `export_all` once per language.

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
  through the `abs_mcp_respond` command, which unblocks the waiting HTTP
  handler. Notifications (no id) are acknowledged `202` without bridging.
- **Timeouts are what keep the server self-healing.** A client keeps one HTTP
  connection alive and tiny_http will not read the next request on a connection
  until the current one has been answered, so a single tool call the webview
  never answers stalls everything queued behind it — `initialize` included. The
  budget is therefore 12s for ordinary calls and 180s only for the handful that
  render, write a file or rebuild the project (`SLOW_TOOLS` in `mcp_server.rs`,
  mirrored in `desktopMcpServer.ts`). On expiry the pending entry is dropped, a
  JSON-RPC error goes back, a late reply is discarded, and the connection is
  free again. The frontend runs the same watchdog a couple of seconds earlier so
  the error names the tool that hung rather than just reporting silence.
- The tool implementations are the `McpDesignApi` built in
  `OpenScreenshotGeneratorLayout.tsx` (assigned to a ref each render so the
  bridge always sees fresh state). They mutate through `handleArtboardsUpdate` —
  the same path `CanvasArea` uses — so history, DB persistence and the
  per-artboard element sync all keep working. `export_png` reuses the Export
  dialog's `html-to-image` capture recipe, through the shared
  `artboardCaptureBackground` helper: `html-to-image`'s `backgroundColor` option
  only paints the colour layer, so a gradient background has to be re-declared
  through the `style` option (applied to the clone last) or the export comes out
  flat white while the canvas looks correct.
- `create_project_from_template` and `open_project` go through
  `createProjectFromTemplateData` / `loadProjectFromData`, the same functions the
  template gallery and the Recent-projects list call, so an AI-created project is
  indistinguishable from a clicked one (same Dexie row, same Recent entry, same
  `?projectId` URL). `open_project` waits two animation frames before returning
  so a follow-up `export_png` finds the artboards in the DOM.
- The `McpDesignApi` closes over the state of the render that built it, which is
  fine because a client sends its next tool call only after the previous
  response has travelled back through Rust — React has re-rendered by then and
  the bridge re-reads the ref. Two mutations dispatched inside a *single* tick
  would both start from the same artboard array and the second would win, so
  don't "optimise" the bridge into batching them. `list_projects` sidesteps this
  entirely by reading the open project from the URL.
- `list_library` and `add_element`'s `libraryId` resolve through
  `src/lib/mcp/assetLibrary.ts`, a pure index over `elementLibrary.ts`,
  `imageLibrary.ts`, `deviceRegistry.ts` and `device3dPresets.ts`. The palette
  reads the same pose/preset tables (`device3dPresets.ts`), so the two can't
  drift: adding a pose or a coloured preset exposes it in both at once.

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

## Linux AppImage and WebKitGTK

The AppImage bundles the WebKitGTK it was built against. That build is pinned to
`ubuntu-22.04` (see `.github/workflows/desktop.yml`) so the binary links the
oldest glibc we support, which also means the bundled WebKit is a 2022 one.

On distros whose Mesa has moved past it, that WebKit cannot create an EGL
display. Both of its helper processes abort with

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

the main process survives, and the splash fallback timer then reveals a main
window that never painted. That is issues #25 and #28: a white window with a working
native menu bar and nothing under it. None of the usual workarounds apply.
`WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` were
both measured against it and neither changes anything, because the failure is in
EGL display creation and happens before any renderer is chosen.

So `scripts/patch-appimage.sh` injects `src-tauri/appimage/osg-host-webkit.sh`
into the AppImage's `AppRun` after Tauri has bundled it. The hook checks whether
the host has a complete WebKitGTK 4.1 stack of its own and, if so, runs against
that instead. `LD_LIBRARY_PATH` is searched before the binary's
`RUNPATH` (`$ORIGIN/../lib`), so pointing it at the system library directories is
enough to win without patching the ELF. A host missing any one of the five
libraries the check names is rejected outright, because a half-host stack is
worse than either whole one.

Finding the host's WebKit helper processes is the part that needs care, and
getting it wrong is what issue #28 was. `WebKitWebProcess` and
`WebKitNetworkProcess` live at a path fixed when WebKit is compiled, and distros
disagree: Debian and Arch keep it beside the library
(`/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1`, `/usr/lib/webkit2gtk-4.1`), Fedora
and openSUSE put it under `/usr/libexec/webkit2gtk-4.1`, Nix puts it in the
store. The first version of the hook only looked beside the library, so it
rejected every Fedora host and quietly left it on the bundled WebKit, which is
the same white window the hook exists to prevent. `WEBKIT_EXEC_PATH` would
settle it, but current WebKitGTK no longer reads it. So the hook greps the
compiled-in path out of the library itself and only falls back to guessing when
that turns up nothing.

`OSG_APPIMAGE_STACK` overrides the probe: `bundled` always uses the copy inside
the AppImage, `host` always uses the system one.

Two things worth knowing if you touch this:

- The patch has to run after `tauri-action`, since linuxdeploy writes `AppRun`
  itself and leaves no earlier hook point. That is also why the workflow
  re-uploads the AppImage with `--clobber`.
- The hook holds `GDK_BACKEND=x11` on the host path too, matching what
  linuxdeploy's GTK hook does for the bundled path. That keeps the change to one
  variable, which WebKit runs, rather than also changing the display protocol.

To reproduce the original failure without an affected machine, run the AppImage
in an `archlinux` container under Xvfb with `OSG_APPIMAGE_STACK=bundled`.

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
