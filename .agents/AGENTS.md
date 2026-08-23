# Agent guide: Open Screenshot Generator

Editor for App Store and Play Store screenshots and preview videos. Next.js 15 **static export** (no server, no API routes) plus a Tauri v2 desktop shell running the same bundle. Projects live in IndexedDB. Desktop adds the MCP server, the embedded-webview AI mode, local AI providers, and loopback OAuth.

## Map

| What | Where |
| --- | --- |
| Data model, read this first | [src/types/artboard.ts](../src/types/artboard.ts) |
| All state, export, MCP api | [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) |
| Canvas and element renderers | [CanvasArea.tsx](../src/components/open-screenshot-generator/CanvasArea.tsx), [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx), [elements/](../src/components/open-screenshot-generator/elements/) |
| Templates (101 JSON files) | [public/data/projects/](../public/data/projects/), registered in [templateCategories.ts](../src/lib/templateCategories.ts) |
| Screenshots in, finished designs out | [src/lib/intake/](../src/lib/intake/) + [start/quickstart/](../src/components/open-screenshot-generator/start/quickstart/) |
| AI agent | [src/lib/ai/](../src/lib/ai/) |
| MCP server | [src/lib/mcp/](../src/lib/mcp/) + [src-tauri/src/mcp_server.rs](../src-tauri/src/mcp_server.rs) |
| Translate and fonts | [translation.ts](../src/services/translation.ts), [fontService.ts](../src/services/fontService.ts), [customFonts.ts](../src/services/customFonts.ts), [fontLanguageMatcher.ts](../src/lib/fontLanguageMatcher.ts) |
| Devices, palette, 3D | [deviceRegistry.ts](../src/lib/deviceRegistry.ts), [elementLibrary.ts](../src/lib/elementLibrary.ts), [device3dPresets.ts](../src/lib/device3dPresets.ts) |
| App Preview scenes (whole boards, palette tab 4) | [previewScenes.ts](../src/lib/previewScenes.ts) |
| Video export | [src/lib/video/](../src/lib/video/) |
| Store upload (desktop only) | [src/lib/publish/](../src/lib/publish/) + [publish/PublishDialog.tsx](../src/components/open-screenshot-generator/publish/PublishDialog.tsx) |
| Panels out of the window, and displays | [src/lib/panels/](../src/lib/panels/) + [panels/](../src/components/open-screenshot-generator/panels/) + [panels.rs](../src-tauri/src/panels.rs) |
| Where a project can be saved | [src/lib/account/](../src/lib/account) (the user's own Drive/gists), [src/lib/cloud/](../src/lib/cloud) (ours, the only one that yields a share link, and the one that saves itself: [autoSave.ts](../src/lib/cloud/autoSave.ts)) |
| Editing together, live | [src/lib/collab/](../src/lib/collab) (Yjs over WebRTC), signalling in [mcp-relay/src/collab.js](../infra/vps/mcp-relay/src/collab.js) |
| Versions of a project | [src/lib/versions/store.ts](../src/lib/versions/store.ts) + the Dexie `projectVersions` table |
| Dexie, 7 tables | [src/database.ts](../src/database.ts): `projects`, `media`, `operations`, `fonts`, `discoverPosts`, `cloudLinks`, `projectVersions` |

## Rules

**Mutating**

1. `handleArtboardsUpdate(next)` is the only door. It repositions boards, writes Dexie, pushes undo. A raw `setArtboards` skips persistence and history. It writes **only** `{ id, name, timestamp, projectData }`, so a new top-level field on `Project` survives until the next keystroke and then vanishes: that is why `ProjectLocalization` is mirrored onto every artboard, and why the cloud-save link lives in its own Dexie table ([src/lib/cloud/links.ts](../src/lib/cloud/links.ts)).
2. Elements render in **two** places: [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx) and `StaticArtboard` in [PreviewDialog.tsx](../src/components/open-screenshot-generator/PreviewDialog.tsx). Miss one and the element vanishes there.
3. Text renders at `fontSize / 0.3` px and ignores `element.scale`. Resize text via `fontSize`. The box clips, so every place a **user** edits text content, family, size, weight or line height folds `fitTextBox` ([textFit.ts](../src/lib/textFit.ts)) into the same update. Template data is never re-fitted.
4. `ArtboardState.position` is derived and overwritten every update. Authoring it does nothing.

**Verifying**

5. `npm run typecheck` is the gate. `npm run build` ignores type and lint errors, so a green build proves nothing.
6. Typecheck already fails on 3 files under `promo/` (8 `csstype` duplicate-package errors). Nothing under `src/` fails. Diff against that, do not chase them.
7. **Never run `npm run lint`.** No ESLint config exists, so it hangs on an interactive prompt.
8. No test suite. Verify by driving the running app, headlessly via the `app-screenshots` skill.

**Codegen you must re-run**

9. Changed a template or [templateCategories.ts](../src/lib/templateCategories.ts)? Run `npm run gen:ai-catalog`. Stale catalog silently downgrades the AI agent.
10. Changed `webAdapters.ts` / `webDriverCore.ts` / `webAssistantAgent.ts`? Run `npm run build:assistant-agent`, then rebuild Rust and relaunch. The bundle is `include_str!`'d into the exe, so a running `tauri dev` never picks it up.

**Paths and platform**

11. Wrap every `public/` asset src in `withBasePath()` from [basePath.ts](../src/lib/basePath.ts) **at render time**. Store paths canonical. `next/image` and `<img>` ignore `basePath` on a string src.
12. All file saves go through [src/lib/desktop.ts](../src/lib/desktop.ts). macOS WKWebView ignores `<a download>`, and WebViews ignore `target="_blank"` (use `openExternal()`).
13. Tauri allows nothing by default. A new command needs a line in `generate_handler![...]`; a new outbound host needs one in [capabilities/default.json](../src-tauri/capabilities/default.json). Missing entries look like network errors but are permission errors. `core:window:default` is **read only**: it answers `availableMonitors` and `outerPosition` but not one setter, and `onCloseRequested` needs `core:window:allow-destroy`, because Tauri prevents the native close whenever a window has a JS close-requested listener and the API's own handler calls `destroy()` to finish it. A new window label needs its own capability file, matched by a glob such as `panel-*`.
14. `isTauri()` is false during SSR and first client render. Gate desktop-only UI on a `mounted` flag too.

**UI**

15. Never a bare `flex` on Radix `TabsContent` (it defeats `[hidden]`). Never a Radix `ScrollArea` under `flex-1` or `max-h` (it stops scrolling). Use `data-[state=active]:flex` and a native `overflow-y-auto` div.
16. Inactive tab panels stay **mounted**. Scope any `querySelector` to `[role="tabpanel"][data-state="active"]`.
17. shadcn/Radix + Tailwind, `lucide-react` icons, semantic tokens from [globals.css](../src/app/globals.css), not raw colors.
18. Dark mode is **live**, and it stops at the artboard edge. The preference is system/light/dark ([theme.ts](../src/lib/theme.ts), [ThemeContext.tsx](../src/contexts/ThemeContext.tsx), picked in [SettingsDialog.tsx](../src/components/open-screenshot-generator/SettingsDialog.tsx)); a blocking script in [layout.tsx](../src/app/layout.tsx) puts the class on `<html>` before first paint. `globals.css` re-declares the **light** palette on `.artboard` and `[data-artboard-surface]`, so nothing inside a board ever sees a dark token and an export is byte-identical in either theme. A new artboard render site needs one of those two markers or it will go dark. A raw colour that only reads on one ground needs a `dark:` variant.
19. **No em dashes and no en dashes** in anything a user reads. Use a comma, a period, a colon, or "to". No trailing period on short UI copy.

**Input**

20. Canvas interactions are **pointer** events, never mouse events: phones and iPads are supported and a finger fires no `mousedown`. That includes the guards, `onPointerDown={e => e.stopPropagation()}` on a control inside an element, never `onMouseDown`. Anything that must survive a drag needs `touch-action: none` on the thing being dragged, or the browser cancels the gesture to scroll.
21. A finger never hovers and never right-clicks. Hover-only affordances get `data-touch-reveal` (shown outright on a coarse pointer, see globals.css); the context menu also opens on a long press ([OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx)); double-click is replayed from a double-tap by [DraggableElement.tsx](../src/components/open-screenshot-generator/elements/DraggableElement.tsx).
22. HTML5 drag and drop (`draggable`, `dataTransfer`) does not fire for touch at all. Palette tiles carry both: the native drag for a mouse, and a long-press drag ([use-touch-drag.tsx](../src/hooks/use-touch-drag.tsx)) for a finger. A new draggable source needs both.
23. The canvas scroll extents are stated in pixels in [CanvasArea.tsx](../src/components/open-screenshot-generator/CanvasArea.tsx), because the board layer is sized by a CSS transform and a transform contributes nothing to a scroll extent. Change how boards are laid out and `contentExtent` has to follow, or the canvas silently stops scrolling to the last board.
24. **A wheel is not a trackpad.** The canvas zooms on a mouse wheel and lets two fingers scroll, told apart by `isMouseWheel` in [CanvasArea.tsx](../src/components/open-screenshot-generator/CanvasArea.tsx) (`deltaMode`, then the legacy `wheelDeltaY` ratio). Ctrl or Cmd with a wheel always zooms, and the listener is registered by hand with `passive: false`, because React attaches wheel listeners passively and a passive listener cannot stop the browser zooming the page.
25. A user-facing switch that more than one place reads goes in [editorPreferences.ts](../src/lib/editorPreferences.ts): one cache, one listener set, live across the app. localStorage alone would leave an already mounted canvas on the old value until reload.

**Live editing**

26. A remote change NEVER goes through `handleArtboardsUpdate` (it would republish and fill the author's undo stack with other people's edits); every local write into the CRDT is one transaction tagged `LOCAL_ORIGIN` (or it bounces back forever); nothing large may enter the document (a WebRTC message over ~256KB fails, so media travels as a reference and is fetched from the cloud copy). Full rules in [reference.md](reference.md).
27. The room key lives in the invite's URL **fragment** and is read at module load in [collab/links.ts](../src/lib/collab/links.ts), because Next's router `replaceState`s the fragment away during hydration. Never move that read into a component, and never put the key in a query string or a log.

**Versions**

28. The undo stack is never persisted (a hundred project snapshots on disk is issue #19 again). Crossing a reload is what [versions/store.ts](../src/lib/versions/store.ts) is for, and it is coarse on purpose: five triggers, a thinning curve, and a document that carries media by reference. A restore goes through `handleArtboardsUpdate` like any other edit, after keeping the state it replaces.

**More than one window**

29. The right dock can leave the editor and live on another display, so **the editor window is the only writer**. A detached panel renders a snapshot it was sent and answers clicks with a named intent; the editor replays that intent against the same handler the docked panel calls. A panel window must never write the project, join a live session, run auto save or start the MCP bridge. It renders [RightDockPanels](../src/components/open-screenshot-generator/panels/RightDockPanels.tsx), the same component the dock does, so the two cannot drift.
30. What crosses a window boundary goes through the projection in [protocol.ts](../src/lib/panels/protocol.ts), and that projection is the maintenance cost of the feature: a new PropertiesPanel field it drops will work docked and fail **silently** detached. Media never crosses (elements carry `asset:<id>` and `mediaId`, and IndexedDB is shared by every window on the origin); a `blob:` URL means nothing outside the document that made it.
31. Display geometry is in **physical** pixels, always. A 4K display at 150% next to a 1080p at 100% has no shared logical origin, so a position computed in logical units on one lands somewhere else on the other.

**Screenshot intake**

32. An uploaded screenshot is stored **once** and travels as `asset:<id>` ([intakeAssets.ts](../src/lib/intake/intakeAssets.ts)). The results deck renders the same shots inside a dozen templates at once, and `getMediaUrl` caches one object URL per id, so every card shares one decoded image. Pass a `data:` URL around instead and each card decodes its own copy of a 2796px PNG.
33. Ranking and filling are **pure and offline**: [templateIndex.ts](../src/lib/intake/templateIndex.ts) derives its index from `projectData` (never a hand-authored tag file, which `gen:ai-catalog` would then have to track), and [autoFill.ts](../src/lib/intake/autoFill.ts) is a pure transform over a deep copy, so a preview can be rebuilt on every keystroke. `fillTemplate` keeps the template's own `id` because `handleSelectTemplate` reports it to analytics.
34. Duplicate screenshots are matched on the analysis **fingerprint** plus dimensions plus byte length, never on byte length alone: two different screens of one app routinely compress to the same size, and the user's set silently arrives short.
35. Every device frame in the catalog ships with placeholder art, so "is this frame empty" is never `!screenshotSrc`. A shipped placeholder is a public path; the user's own content is `asset:`, `data:` or `blob:`.
36. A card that would overspend the WebGL budget renders **flattened** (`flattenBoard3d`), never as the shipped preview PNG: the whole point of the deck is that the boards hold the user's screenshots.

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
- **Preview scene** (a whole App Preview board, dropped from the palette's Previews tab): one entry in `PREVIEW_SCENE_LIST` in [previewScenes.ts](../src/lib/previewScenes.ts). That is the only registration site; the tab, the tile and the drop all read it
- **Device**: `DeviceType`, `DEVICE_REGISTRY`, `getFlatDeviceChrome`, `DEVICE_METRICS`, palette tile, MCP `DEVICE_TYPES`
- **Web AI provider**: `WEB_ADAPTERS`, `PROVIDERS` in `web_session.rs`, extension adapter + manifest + the `build:extension` entry list, `remote.urls` in `capabilities/assistant.json`
- **MCP tool**: `McpDesignApi`, the `TOOLS` array, `mcpApi` in the layout, both `SLOW_TOOLS` lists if it is slow
- **Font**: `GOOGLE_FONTS`, plus `AGENT_FONTS` and a `<SelectGroup>` in [FontFamilySelect.tsx](../src/components/open-screenshot-generator/FontFamilySelect.tsx) if it is a new script. That one component is every picker. Fonts the **user** imports are separate: Dexie `fonts` table, see [customFonts.ts](../src/services/customFonts.ts)
- **Panel prop**: the field on `DockData` in [protocol.ts](../src/lib/panels/protocol.ts), the value in the layout's `dockData` memo, the prop in `RightDockPanels`, and, if it is a callback, an arm in the `DockIntent` union plus `dispatch` in [useDockHost](../src/lib/panels/useDockHost.ts) and `handlers` in [useDockClient](../src/lib/panels/useDockClient.ts)
- **Store slot** (App Store display type, Play image type): `APPLE_DISPLAY_TARGETS` / `PLAY_IMAGE_TARGETS` in [storeTargets.ts](../src/lib/publish/storeTargets.ts), the only registration site. A new outbound host also needs `capabilities/default.json`

## Deeper detail

[reference.md](reference.md) has the per-subsystem breakdown: exact type fields, the AI prompt pipeline and plan schema, the MCP tool list and transport, the 3D pose tables, the video compositor, account sync, and the traps for each. Read only the section you need.


## Testing
- After you are done with testing, kill all process you have launched
