# Agent guide: Open Screenshot Generator

Editor for App Store and Play Store screenshots and preview videos. Next.js 15 **static export** (no server, no API routes) plus a Tauri v2 desktop shell running the same bundle. Projects live in IndexedDB. Desktop adds the MCP server, the embedded-webview AI mode, local AI providers, and loopback OAuth.

## Map

| What | Where |
| --- | --- |
| Data model, read this first | [src/types/artboard.ts](../src/types/artboard.ts) |
| All state, export, MCP api | [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) |
| Canvas and element renderers | [CanvasArea.tsx](../src/components/open-screenshot-generator/CanvasArea.tsx), [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx), [elements/](../src/components/open-screenshot-generator/elements/) |
| Templates (96 JSON files) | [public/data/projects/](../public/data/projects/), registered in [templateCategories.ts](../src/lib/templateCategories.ts) |
| AI agent | [src/lib/ai/](../src/lib/ai/) |
| MCP server | [src/lib/mcp/](../src/lib/mcp/) + [src-tauri/src/mcp_server.rs](../src-tauri/src/mcp_server.rs) |
| Translate and fonts | [translation.ts](../src/services/translation.ts), [fontService.ts](../src/services/fontService.ts), [fontLanguageMatcher.ts](../src/lib/fontLanguageMatcher.ts) |
| Devices, palette, 3D | [deviceRegistry.ts](../src/lib/deviceRegistry.ts), [elementLibrary.ts](../src/lib/elementLibrary.ts), [device3dPresets.ts](../src/lib/device3dPresets.ts) |
| Video export | [src/lib/video/](../src/lib/video/) |
| Dexie, 3 tables | [src/database.ts](../src/database.ts): `projects`, `media`, `operations` |

## Rules

**Mutating**

1. `handleArtboardsUpdate(next)` is the only door. It repositions boards, writes Dexie, pushes undo. A raw `setArtboards` skips persistence and history.
2. Elements render in **two** places: [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx) and `StaticArtboard` in [PreviewDialog.tsx](../src/components/open-screenshot-generator/PreviewDialog.tsx). Miss one and the element vanishes there.
3. Text renders at `fontSize / 0.3` px and ignores `element.scale`. Resize text via `fontSize`.
4. `ArtboardState.position` is derived and overwritten every update. Authoring it does nothing.

**Verifying**

5. `npm run typecheck` is the gate. `npm run build` ignores type and lint errors, so a green build proves nothing.
6. Typecheck already fails on 4 files: 3 under `promo/`, plus `src/lib/fontLanguageMatcher.ts`. Diff against that, do not chase them.
7. **Never run `npm run lint`.** No ESLint config exists, so it hangs on an interactive prompt.
8. No test suite. Verify by driving the running app, headlessly via the `app-screenshots` skill.

**Codegen you must re-run**

9. Changed a template or [templateCategories.ts](../src/lib/templateCategories.ts)? Run `npm run gen:ai-catalog`. Stale catalog silently downgrades the AI agent.
10. Changed `webAdapters.ts` / `webDriverCore.ts` / `webAssistantAgent.ts`? Run `npm run build:assistant-agent`, then rebuild Rust and relaunch. The bundle is `include_str!`'d into the exe, so a running `tauri dev` never picks it up.

**Paths and platform**

11. Wrap every `public/` asset src in `withBasePath()` from [basePath.ts](../src/lib/basePath.ts) **at render time**. Store paths canonical. `next/image` and `<img>` ignore `basePath` on a string src.
12. All file saves go through [src/lib/desktop.ts](../src/lib/desktop.ts). macOS WKWebView ignores `<a download>`, and WebViews ignore `target="_blank"` (use `openExternal()`).
13. Tauri allows nothing by default. A new command needs a line in `generate_handler![...]`; a new outbound host needs one in [capabilities/default.json](../src-tauri/capabilities/default.json). Missing entries look like network errors but are permission errors.
14. `isTauri()` is false during SSR and first client render. Gate desktop-only UI on a `mounted` flag too.

**UI**

15. Never a bare `flex` on Radix `TabsContent` (it defeats `[hidden]`). Never a Radix `ScrollArea` under `flex-1` or `max-h` (it stops scrolling). Use `data-[state=active]:flex` and a native `overflow-y-auto` div.
16. Inactive tab panels stay **mounted**. Scope any `querySelector` to `[role="tabpanel"][data-state="active"]`.
17. shadcn/Radix + Tailwind, `lucide-react` icons, semantic tokens from [globals.css](../src/app/globals.css), not raw colors. Dark mode is configured but never activated.
18. **No em dashes and no en dashes** in anything a user reads. Use a comma, a period, a colon, or "to". No trailing period on short UI copy.

## Commands

| Command | Note |
| --- | --- |
| `npm run dev` | port 9002, hard-coded in Tauri devUrl, the extension, and the harness |
| `npm run typecheck` | the real safety net |
| `npm run gen:ai-catalog` | after any template change |
| `npm run build:assistant-agent` | after any web-adapter change |
| `npm run tauri:dev` / `tauri:build` | desktop |
| `npm run build` | `gen:ai-catalog` then `next build` into `out/` |
| `npm start` | **not** a prod server, it just re-runs dev |
| `npm run lint` | broken, do not run |

Version lives in 4 files. Only `node scripts/set-version.mjs <patch|minor|major|X.Y.Z>` may change it.

## Adding things

Full recipes with every registration site are in [reference.md](reference.md). The steps people miss:

- **Element type**: type union, renderer, `Artboard.addElement` branch **and** its render branch, `PreviewDialog`, PropertiesPanel, LayersPanel, ElementPalette
- **Template**: the JSON, then its filename in `TEMPLATE_CATEGORIES[].files`. Nothing else discovers it
- **Device**: `DeviceType`, `DEVICE_REGISTRY`, `getFlatDeviceChrome`, `DEVICE_METRICS`, palette tile, MCP `DEVICE_TYPES`
- **Web AI provider**: `WEB_ADAPTERS`, `PROVIDERS` in `web_session.rs`, extension adapter + manifest + the `build:extension` entry list, `remote.urls` in `capabilities/assistant.json`
- **MCP tool**: `McpDesignApi`, the `TOOLS` array, `mcpApi` in the layout, both `SLOW_TOOLS` lists if it is slow
- **Font**: `GOOGLE_FONTS`, plus `AGENT_FONTS` and a `<SelectGroup>` in both pickers if it is a new script

## Deeper detail

[reference.md](reference.md) has the per-subsystem breakdown: exact type fields, the AI prompt pipeline and plan schema, the MCP tool list and transport, the 3D pose tables, the video compositor, account sync, and the traps for each. Read only the section you need.
