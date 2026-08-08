# Reference: subsystem detail

Deep detail behind [AGENTS.md](AGENTS.md). Read only the section you need.

## Core architecture and the artboard data model

Static-export Next 15 app router (`output: 'export'` in [next.config.ts](../next.config.ts)). There is exactly one route, [src/app/page.tsx](../src/app/page.tsx), and it is `"use client"`. There is no server: no API routes, no server actions, no middleware, no `next/image` optimizer (`images.unoptimized: true`). Anything needing a backend must go through the Tauri desktop side or a user-supplied third-party key.

### Type spine: [src/types/artboard.ts](../src/types/artboard.ts)

`Project` -> `projectData: ArtboardState[]` -> `elements: ArtboardElement[]`. Read this file first, everything else is downstream of it.

`ArtboardState`: `id`, `name`, `position` (derived, see traps), `size: Size`, `elements`, `backgroundColor`, `backgroundType?: 'solid' | 'gradient'`, `backgroundGradient?: {color1, color2, angle}`, `zoom`, `exportScale?`, `language?`.

`BaseElement` (every element has these): `id`, `type`, `name?`, `position: Point`, `size: Size`, `rotation` (deg), `scale` (multiplier), `opacity?`, `shadow?: ElementShadow`, `blur?`, `animation?: ElementAnimation`, `groupId?`. `opacity`/`shadow`/`blur` are rendered generically by `elementVisualStyle()` in [src/lib/elementStyle.ts](../src/lib/elementStyle.ts) on a wrapper inside `DraggableElement` (and on the same wrapper in `PreviewDialog`), so a new element type gets them for free in both render sites.

`ElementType` is a 7-way discriminator; each variant's required extras:

| `type` | interface | required beyond BaseElement | notable optionals |
| --- | --- | --- | --- |
| `text` | `TextElementProps` | `content`, `fontSize`, `color`, `fontFamily` | `fontWeight/fontStyle/textDecoration/textAlign/lineHeight/letterSpacing` |
| `shape` | `ShapeElementProps` | `shapeType: ShapeType` (11 values incl. `custom-polygon`, `custom-svg`), `fillColor`, `strokeColor`, `strokeWidth` | `borderRadius*`, `customPath`, `clipPath`, `innerRadius`, `fillOpacity`, `fillGradient` |
| `device` | `DeviceFrameElementProps` | `deviceType: DeviceType` (20 values) | `screenshotSrc`, `screenshotRect {left,top,width,height}` in percent, `styleType: DeviceStyleType`, `pose3d: Device3DPose`, `frameColor3d`, flat-frame `frameColor/frameOpacity/frameStyle/notchColor` |
| `image` | `ImageElementProps` | none | `imageSrc`, `objectFit`, `borderRadius`, `skewX/skewY/perspectiveX/perspectiveY/matrix3d` |
| `video` | `VideoElementProps` | none | `mediaId` (Dexie row) or `videoSrc` (URL) as the source, `trimStart/trimEnd`, `durationSeconds` |
| `video-device` | `VideoDeviceElementProps` | `deviceType` | `mediaId`, `posterSrc`, `trimStart/trimEnd`, `objectFit` |
| `gesture` | `GestureElementProps` | `gestureType: GestureType`, `color` | `triggerTime`, `gestureDuration`, `gestureRepeat` |

`device` and `video-device` deliberately do NOT share props: a video device has no `screenshotRect`, no `pose3d`, no `matrix3d`.

### State ownership and the single mutation entry point

[src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) (~3400 lines) owns everything: `artboards`, `activeArtboardId`, `selectedElementIdOnActiveArtboard`, `canvasZoom`, `history`, `historyIndex`, `activeProjectId`, `currentProjectName`.

**`handleArtboardsUpdate(updatedArtboards: ArtboardState[])` is the one door.** It (1) runs `calculateArtboardPositions`, (2) `setArtboards`, (3) drops selection if the selected board/element vanished, (4) `db.projects.put(...)` (creating a project id + random name when there is none), (5) `pushToHistory` (deep JSON clone). Every mutation must be a whole new `ArtboardState[]` passed to it. [CanvasArea.tsx](../src/components/open-screenshot-generator/CanvasArea.tsx) receives it as `onUpdateArtboards` and just maps ids.

Undo/redo (`handleUndo`/`handleRedo`) is a plain snapshot stack: `history: ArtboardState[][]`, index moves, `setArtboards(deep clone)`, selection cleared. One `handleArtboardsUpdate` call equals one undo step, so batch multi-element edits into one array (see `convertArtboardsToFormat` in [src/lib/deviceRegistry.ts](../src/lib/deviceRegistry.ts)).

Element creation goes through an imperative ref, not props: `artboardRefs.current[artboardId].addElement(type, subType, dropPosition, styleProps)`. The ref interface is `ArtboardRef` in [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx) (`addElement` + `deleteElementByIdG`); the refs map itself is typed `Record<string, any>`, so TypeScript will not catch a typo there. Palette drags carry `application/artboard-element-type` / `-subtype` / `-styleprops` (JSON) on the DataTransfer.

Copy/paste lives in [src/contexts/ClipboardContext.tsx](../src/contexts/ClipboardContext.tsx) (one element, deep-cloned, in-memory only). Paste mints a new `el_...` id.

### Persistence

Dexie v3 in [src/database.ts](../src/database.ts), db name `ProjectDatabase`, three tables: `projects: 'id, name, timestamp'` (whole `Project`, artboards inlined as JSON), `operations: 'id, startedAt, status, provider'` (AI run log), `media: 'id, createdAt'` (`MediaAsset` blobs). Large binaries never go in the project row: recordings are `Blob`s in `media`, elements store only `mediaId`, and object URLs are minted/cached per id by [src/lib/mediaStore.ts](../src/lib/mediaStore.ts) (`saveMedia`, `getMediaUrl`, `useMediaUrl`).

Templates are static JSON fetched from `public/data/projects/*.json` by [src/services/projectService.ts](../src/services/projectService.ts), catalogued in [src/lib/templateCategories.ts](../src/lib/templateCategories.ts) (`TEMPLATE_CATEGORIES`, one entry per start-dialog tab, each listing its `files`). Portable export/import (local `.json`, Drive, gists) is [src/lib/account/projectBundle.ts](../src/lib/account/projectBundle.ts): `collectMediaIds` walks `MEDIA_ID_KEYS = ['mediaId', 'screenVideoMediaId']` generically (so legacy fields are picked up too), `serializeProject` pulls those rows out of Dexie as raw `Blob`s, `bundleToJson` is what base64-inlines them for the single-file local export, and `importBundle` restores them under their original ids so element references resolve without rewriting the document.

Three localStorage keys carry the `open-screenshot-generator.` prefix (`.account` in [src/lib/account/store.ts](../src/lib/account/store.ts), `.ai-settings` in [src/lib/ai/providers.ts](../src/lib/ai/providers.ts), `.free-ai-settings` in [src/lib/ai/freeProviders.ts](../src/lib/ai/freeProviders.ts)) and must be read through `readWithLegacyFallback` / `removeWithLegacy` in [src/lib/legacyStorage.ts](../src/lib/legacyStorage.ts) so pre-rename `artboard-studio.` values migrate. Editor-chrome keys keep the `abs-` prefix (e.g. `abs-right-dock-open`) and are read with plain localStorage.

### Adding a NEW element type, end to end

1. [src/types/artboard.ts](../src/types/artboard.ts): add the literal to `ElementType`, add `XxxElementProps extends BaseElement`, add it to the `ArtboardElement` union.
2. `src/components/open-screenshot-generator/elements/XxxElement.tsx`: the renderer. Props follow `{ element, onUpdate, isSelected }` (only the ones you need; `ShapeElement` takes just `element`, `TextElement` also takes `artboardZoom`). Tag editor-only chrome with `data-export-exclude`.
3. [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx): a branch in `useImperativeHandle`'s `addElement` (defaults, size, `styleProps` merge, position clamping) AND a `{element.type === 'xxx' && <XxxElement .../>}` line in the `elements.map` render.
4. [PreviewDialog.tsx](../src/components/open-screenshot-generator/PreviewDialog.tsx): mirror the same render branch in `StaticArtboard` or the element disappears in the preview. This is a second, independent render site, not the export path.
5. [PropertiesPanel.tsx](../src/components/open-screenshot-generator/PropertiesPanel.tsx): a `renderXxxProperties()` plus its line in the `selectedElement.type === ...` block near the bottom, plus a `ELEMENT_PANEL_TITLES` entry if the derived name reads badly.
6. [LayersPanel.tsx](../src/components/open-screenshot-generator/LayersPanel.tsx): a `case` in `getElementIcon` and a branch in `getElementLabel`.
7. [ElementPalette.tsx](../src/components/open-screenshot-generator/ElementPalette.tsx): a `DraggableItem` with `type`/`subType`/`styleProps` so it can be dragged or clicked in.
8. [src/lib/video/videoExport.ts](../src/lib/video/videoExport.ts): if it animates or holds media, extend `analyzeArtboardForVideo`, `projectHasVideoContent` and the `Layer` union; otherwise it still rasterizes fine through the default `sprite` branch.
9. `buildMcpElement` in the layout file and `McpDesignApi` in [src/lib/mcp/desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts): only needed for agent-created elements, and the `add_element` / `add_elements` `inputSchema` enums have to be widened too.

### Traps

- **`ArtboardState.position` is derived, never authored.** `calculateArtboardPositions` overwrites it on every `handleArtboardsUpdate`, laying boards left to right at `ARTBOARD_MARGIN = 15` using `DISPLAY_SCALE_FACTOR = 0.3`. Setting it in a template JSON does nothing.
- **`Artboard` keeps a local mirror `const [elements, setElements] = useState(artboard.elements)`**, resynced by an effect on `artboard.elements`. Mutating only the local copy without calling `onUpdateArtboardElements` loses the change on the next parent render, and skips history and the Dexie write.
- **The artboard renders at native px and is CSS-scaled by 0.3.** Sizes, positions, shadows and blur are all in artboard px. Text is the exception: [TextElement.tsx](../src/components/open-screenshot-generator/elements/TextElement.tsx) renders at `fontSize / 0.3` and ignores `element.scale` (scale is only used by the inline editing textarea), while `DraggableElement` still scales the box (`displaySize = size * scale`). Change `fontSize`, keep text `scale` at 1.
- **Mutating without `handleArtboardsUpdate` silently skips the save.** `handleUpdateArtboardSize` pushes history but never writes Dexie; `handleUpdateArtboardDetails` writes Dexie but skips repositioning. Any new handler should call `handleArtboardsUpdate` unless it deliberately wants one of those holes.
- **`handleArtboardsUpdate` auto-creates a project** (`Date.now()` id + random name from `generateRandomProjectName()`) when `activeProjectId` is null, so a stray call from a background effect can persist a junk project.
- **Deliberate bypass during export**: `handleConfirmExport` does a raw `setArtboards` to swap converted formats in and out so history and the saved project stay clean. Copy that pattern for temporary canvas states.
- **PNG export reads the live canvas DOM**, `document.querySelector('[data-artboard-dom-id="..."]')` (the node `Artboard.tsx` renders), in both `captureArtboards` (Export dialog) and `captureArtboardForMcp`. Both unscale the node, run `html-to-image`'s `toPng` with a filter that drops nodes carrying `data-export-exclude` or `data-interaction-handle`, then restore the inline styles. An element that renders only off-DOM (portal, canvas-less) will not export, and an artboard that is not currently mounted cannot be captured at all.
- **Root-absolute public asset paths must go through `withBasePath()`** from [src/lib/basePath.ts](../src/lib/basePath.ts) at render time. Stored/library paths stay canonical without the prefix; `next/image` and `<img>` do not apply `basePath` to a string `src`, so sub-path deploys 404.
- **`useSearchParams` forces the Suspense boundary** in `page.tsx` under `output: 'export'`. Do not remove it, and note `getInitialProjectIdFromUrl()` seeds `isTemplateSelectorOpen` synchronously so the start dialog does not flash on refresh.
- **`migrateVideoDevices()`** ([src/lib/video/migrateVideoDevices.ts](../src/lib/video/migrateVideoDevices.ts)) converts legacy `screenVideoMediaId`-on-device rows and is called from three places: the Dexie project load and the template/data load in the layout, and `importBundle`'s caller in [src/lib/account/index.ts](../src/lib/account/index.ts). Any new load path must call it too.
- **`buildMcpElement` only handles `text`, `image`, `shape`, `device`** and returns `null` otherwise (which `McpDesignApi.addElement` turns into a thrown error), so the desktop MCP `add_element` / `add_elements` tools cannot create `video`, `video-device` or `gesture` elements today. Their `inputSchema` already restricts `type` to those four.

---

## Template system

Templates are plain JSON project files under [public/data/projects/](../public/data/projects/) (96 of them), fetched at runtime by the start dialog. There is **no glob and no manifest file**: a template is discovered only if its filename appears in the `files` array of a category in [templateCategories.ts](../src/lib/templateCategories.ts).

### Where things live

- [public/data/projects/](../public/data/projects/) `<slug>.json` template files, plus loose per-template art PNGs (no enforced naming: `calora-macros-screen-1.png`, `cvcraft-screen-home.png`, `breathora-bottom-fade.png` all coexist)
- [public/data/projects/previews/](../public/data/projects/previews/) card thumbnails, always `<slug>.png`, one per template
- `app-screens/`, `watch-screens/`, `mac-screens/`, `fg-screens/` reusable skeleton UI screens baked into device mockups
- [templateCategories.ts](../src/lib/templateCategories.ts) the registry: `TEMPLATE_CATEGORIES: TemplateCategory[]` and `ALL_TEMPLATE_FILES`
- [projectService.ts](../src/services/projectService.ts) `loadProjectTemplates()` fetches `${BASE_PATH}/data/projects/<file>` for every catalog entry in parallel and tags each `Project` with `category`
- [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) owns the picker: `TemplateGallery` (~line 229), the Radix tabs (~line 2340), and `createProjectFromTemplateData` (~line 1001)
- [templateCatalog.ts](../src/lib/ai/templateCatalog.ts) compresses templates into the AI agent's index; [hostedCatalog.ts](../src/lib/ai/hostedCatalog.ts) assembles the published file and its token; [gen-ai-catalog.mjs](../scripts/gen-ai-catalog.mjs) writes `public/data/ai/catalog.txt`
- Authoring/verification scripts live in [.claude/skills/app-screenshots/scripts/](../.claude/skills/app-screenshots/scripts/): `export-templates.js`, `gen-previews.js`, `compose-preview.js`, `gen-app-skeletons.js`, `gen-watch-skeletons.js`, `gen-mac-skeletons.js`, `wire-app-skeletons.js`

### Template JSON shape

Top level: `{ id, name, description, previewImage, timestamp, projectData }`. **`id` and `timestamp` are dead fields**: `projectService` overwrites them with `template_${filenameWithoutExtension}` and `new Date()`. Only `name`, `description`, `previewImage` and `projectData` are read. `projectData` is `ArtboardState[]` (a bare top-level array is also accepted, legacy shape).

Every element type is defined in [artboard.ts](../src/types/artboard.ts). Base fields on all: `id`, `type`, `name?`, `position {x,y}`, `size {width,height}`, `rotation` (degrees), `scale`, plus optional `opacity`, `shadow {x,y,blur,color}`, `blur`, `groupId`, `animation`. Per type: `text` adds `content/fontSize/color/fontFamily/fontWeight/textAlign/lineHeight/letterSpacing`; `shape` adds `shapeType/fillColor/strokeColor/strokeWidth/customPath/specialProps/fillOpacity/fillGradient/innerRadius`; `device` adds `deviceType/styleType/pose3d/frameColor3d/frameColor/screenshotSrc/screenshotObjectFit/screenshotRect/naturalScreenshotWidth/naturalScreenshotHeight`; `video-device` adds `deviceType/posterSrc/mediaId/objectFit/naturalVideoWidth/naturalVideoHeight`; `gesture` adds `gestureType/color/triggerTime/gestureDuration/gestureRepeat`; `image` adds `imageSrc/objectFit/borderRadius`.

Minimal real example, one board of [watch-lavender.json](../public/data/projects/watch-lavender.json):

```json
{
  "id": "template_watch_lavender", "name": "Lavender",
  "description": "App Store Apple Watch screenshots on a soft lavender gradient...",
  "previewImage": "/data/projects/previews/watch-lavender.png",
  "timestamp": "2026-07-07T00:00:00.000Z",
  "projectData": [{
    "id": "tpl_watch_lavender_0", "name": "Move",
    "position": { "x": 15, "y": 15 }, "size": { "width": 422, "height": 514 },
    "backgroundColor": "#B9A7F0", "zoom": 1,
    "backgroundType": "gradient",
    "backgroundGradient": { "color1": "#8E86F0", "color2": "#D8B7EA", "angle": 160 },
    "elements": [
      { "id": "b0_w", "type": "device", "name": "Apple Watch",
        "position": { "x": 86, "y": 48 }, "size": { "width": 250, "height": 517 },
        "rotation": -5, "scale": 1,
        "deviceType": "apple-watch", "styleType": "3d-right", "pose3d": "front",
        "frameColor3d": "white",
        "screenshotSrc": "/data/projects/watch-screens/watch-rings-purple.png",
        "naturalScreenshotWidth": 960, "naturalScreenshotHeight": 1176,
        "screenshotObjectFit": "cover",
        "screenshotRect": { "left": 0, "top": 0, "width": 100, "height": 100 } },
      { "id": "b0_h", "type": "text", "name": "Headline",
        "position": { "x": 24, "y": 34 }, "size": { "width": 380, "height": 100 },
        "rotation": 0, "scale": 1, "content": "Move.", "fontSize": 23,
        "color": "#FFFFFF", "fontFamily": "Bricolage Grotesque",
        "fontWeight": "700", "textAlign": "center", "lineHeight": 1.08 }
    ]
  }]
}
```

### Categories, tabs and canvas sizes

Each `TemplateCategory` is one tab. `defaultSize` is what "Start blank" produces on that tab; `previewAspect`/`previewFit`/`gridClassName` drive the card grid.

| id | Tab label | Filename prefix | defaultSize | Files |
|---|---|---|---|---|
| `screenshots` | App Screenshots | none (`tunio-music.json`) | 1290 x 2796 | 57 |
| `apple-watch` | Apple Watch | `watch-*` | 422 x 514 | 6 |
| `mac` | Mac | `mac-*` | 2560 x 1600 | 12 |
| `app-preview` | App Preview Videos | `pv-*` | 886 x 1920 | 6 |
| `play-feature-graphic` | Google Feature Graphic | `fg-*` | 1024 x 500 | 15 |

Canvas-size presets shown in the toolbar's Canvas Size dialog are a separate catalog, [sizePresets.ts](../src/lib/sizePresets.ts) (`CANVAS_SIZE_PRESET_GROUPS`, clamped to `[CANVAS_SIZE_MIN, CANVAS_SIZE_MAX]` = 100 to 5000).

### Recipe: add a new template

1. Author `public/data/projects/<slug>.json` with the prefix for its tab. Include a `"previewImage"` key (step 4 rewrites it in place, but only if the key already exists). Description convention: app-screenshot templates start `"App Store & Play Store screenshots for ..."` (the picker searches name + description, so "App Store" alone made "play store" searches miss).
2. Register the filename in the matching `TEMPLATE_CATEGORIES[].files` array in [templateCategories.ts](../src/lib/templateCategories.ts). This is the only step that makes it appear.
3. Add `{ slug, card, boards, tab? }` to `TEMPLATES` in [export-templates.js](../.claude/skills/app-screenshots/scripts/export-templates.js) if you want the headless export QA loop (`node export-templates.js <outRoot> [slug ...]` with `npm run dev` on :9002), then review the exported PNGs. `card` is the card's visible title text, `tab` the tab label to click first.
4. Add the slug to `SLUGS` (and `SLUG_TAB` for non-first tabs) in [gen-previews.js](../.claude/skills/app-screenshots/scripts/gen-previews.js), run it, and it writes `previews/<slug>.png` (a 3000x1000 phone-carousel strip) and rewrites `previewImage` in the JSON for you. This script does **not** cover the Feature Graphic tab: `fg-*` previews are 1024x683, the 1024x500 board letterboxed onto a blurred fill with ffmpeg, and must be produced separately.
5. Run `npm run gen:ai-catalog` to refresh `public/data/ai/catalog.txt`.

### Coordinate and sizing rules

- Coordinates are artboard pixels, origin top-left of the board. Element z-order equals array order, later equals on top.
- Text renders at **`fontSize / 0.3` px** ([TextElement.tsx](../src/components/open-screenshot-generator/elements/TextElement.tsx) `displayScaleFactor = 0.3`). A 150px headline is `fontSize: 45`. `letterSpacing` uses the same units.
- `element.scale` multiplies `size` **anchored at the top-left** (`DraggableElement` sets `left/top` from `position` and `width/height` from `size * scale`); only `rotation` is center-origin.
- Screen content goes in the device's `screenshotSrc` with `screenshotObjectFit: "cover"` and `screenshotRect: {0,0,100,100}`, never as an overlay rect. The device clips to the real screen radius and draws the notch above it, and platform swaps then just work.
- 3D devices (`styleType: "3d-left" | "3d-right"` plus `pose3d`, `frameColor3d`) should take the element `size` from the pose's row in [device3dPresets.ts](../src/lib/device3dPresets.ts) (`IPHONE_3D_SIZES`, `ANDROID_3D_SIZES`, `WATCH_3D_SIZES`, `MACBOOK_3D_SIZES`, `IMAC_3D_SIZES`). Those boxes match each pose's projected aspect so the device fills the box instead of letterboxing; keep that aspect (a uniform multiple is fine) and use `scale` for final size.
- `fontFamily` must be a family listed in [fontService.ts](../src/services/fontService.ts) (`GOOGLE_FONTS` + `SYSTEM_FONTS`). Templates in practice use Bricolage Grotesque, DM Serif Display, Oswald.

### Traps

- **Artboard `position` in the JSON is ignored.** `calculateArtboardPositions` re-lays every board at `x = 15 + sum(width * 0.3 + 15)`, `y = 15`. Do not tune it; do not rely on it.
- **Top-level `id` / `timestamp` are ignored** (see above). Templates whose JSON `id` disagrees with the filename, e.g. `mac-terra.json` declaring `"mac-terra-template"`, still load as `template_mac-terra`.
- **Text boxes clip at both top and bottom** because content is a vertically centered flex with `overflow: hidden`. An oversized box also pushes glyphs down into the block below. Size each box to hug its lines: `h ≈ lines * (fontSize/0.3) * lineHeight + 0.32 * (fontSize/0.3)`. A silent horizontal wrap creating one extra clipped line is the single most common template defect; prefer explicit `\n`.
- **The text renderer ignores `element.scale`**, so scaling a text element shrinks the box but not the glyphs. Scale text by multiplying `fontSize` and `size` together.
- **Any `animation` field, `gesture` element, `video-device`, or sourced `video` element flips the whole project to the App Preview video export dialog** (`projectHasVideoContent` in [videoExport.ts](../src/lib/video/videoExport.ts)). Do not sprinkle `animation` onto a screenshot template.
- **The `app-preview` category is hidden from the AI agent and from MCP `list_templates`** via `AGENT_EXCLUDED_CATEGORIES` in [templateCatalog.ts](../src/lib/ai/templateCatalog.ts), because those mockups need a user-supplied recording. Every catalog path goes through `agentUsableTemplates`, so the filter cannot be bypassed by calling `buildTemplateCatalog` or `buildHostedCatalog` directly.
- **After any template or `previewImage` edit, run `npm run gen:ai-catalog`.** The first line of `catalog.txt` is `VERIFICATION-TOKEN: abs-<fnv1a of the body>`, recomputed in the browser from the client's own templates; a stale file silently drops the agent's URL mode back to inline prompts.
- **Element ids in template JSON are a public API.** The AI agent plan, MCP `create_project_from_template`, and `buildTemplateCatalog` address text and device slots by these hand-authored ids. Renaming an id breaks fills silently (they degrade into warnings, not errors).
- **`previewImage` containing `placehold.co` (or being absent) switches the card to `object-cover`**; real strip previews render `object-contain`. Paths are root-relative and routed through `withBasePath` for the GitHub Pages sub-path deploy, so never hardcode a basePath in the JSON.
- **Radix keeps inactive tab panels mounted.** Any headless harness that searches for a template card must scope to `[role="tabpanel"][data-state="active"]`, or it opens a hidden card from another tab.

---

## The AI design agent: prompt pipeline

Turns "put my screenshots in a dark template and write copy for Droply" into a real `Project`. The model **only fills slots**: it never emits element trees, SVG, or coordinates, so a hallucinated answer degrades into an odd project instead of a broken canvas. Everything lives in [src/lib/ai/](../src/lib/ai/). Design rationale is in [docs/AI-AGENT.md](../docs/AI-AGENT.md); read it before touching prompts (its `PROMPT_BUDGETS` troubleshooting entry is stale, see below).

### End to end flow

1. User uploads screenshots in [ScreenshotUploader.tsx](../src/components/open-screenshot-generator/start/ScreenshotUploader.tsx); [imageUtils.ts](../src/lib/ai/imageUtils.ts) makes each one an `UploadedScreenshot` with two data URLs: `dataUrl` (long edge 2796, stored in the project) and `aiDataUrl` (long edge 1024, JPEG q0.8, sent to the model).
2. [AgentStartScreen.tsx](../src/components/open-screenshot-generator/start/AgentStartScreen.tsx) is the orchestrator. It builds the catalog and picks a strategy per mode.
3. Catalog: [templateCatalog.ts](../src/lib/ai/templateCatalog.ts) `buildTemplateCatalog()` -> `CatalogEntry[]`, then [aliasCatalog.ts](../src/lib/ai/aliasCatalog.ts) `buildCatalogArtifacts()` -> `{ catalogText, aliasMap, shortlistIds, hasDetail }`.
4. Prompt: [promptBuilder.ts](../src/lib/ai/promptBuilder.ts) is one builder, `buildUnifiedPrompt`, behind thin wrappers: `buildSystemPrompt` + `buildUserPrompt` (API mode), `buildRelayPrompt` (inline catalog, used by web-session and free modes), `buildUrlRelayPrompt` (hosted URL: adds the `sourceToken` field and the `CANNOT_FETCH` sentinel). `buildCompactRelayPrompt` still exists but nothing calls it.
5. Model call: `generateObject` in [generatePlan.ts](../src/lib/ai/generatePlan.ts) (API), `runFreeProvider` in [freeProviders.ts](../src/lib/ai/freeProviders.ts), or `runViaEmbeddedWebview` in [webSessionDesktop.ts](../src/lib/ai/webSessionDesktop.ts).
6. Reply: `extractJsonCandidates` ([jsonExtract.ts](../src/lib/ai/jsonExtract.ts)) -> `resolveAliases(raw, aliasMap)` -> `AgentPlanSchema.safeParse` -> `buildProjectFromPlan` ([buildProjectFromPlan.ts](../src/lib/ai/buildProjectFromPlan.ts)) -> `BuildResult { project, warnings, summary }` -> `PlanSummary` card -> `onCreateProject`.

### The plan schema, field by field

[agentPlanSchema.ts](../src/lib/ai/agentPlanSchema.ts). `AgentPlanObjectSchema` is what goes to the provider as JSON Schema; `AgentPlanSchema` adds `.superRefine` cross-field rules and is what validates every reply. Top level: `action: 'use-template' | 'generate-new'`, `reasoning: string|null`, `projectName: string`, `templateId: string|null`, `screenshotPlacements[]`, `textOverrides[]`, `newDesign: object|null`.

- `screenshotPlacements[]`: `{ screenshotIndex: int, artboardIndex: int, deviceElementId: string|null }`. `null` means "first unclaimed device frame".
- `textOverrides[]`: `{ artboardIndex: int, elementId: string, text: string }`.
- `newDesign`: `{ themeName, canvas: AGENT_CANVASES, deviceType: NEW_DESIGN_DEVICE_TYPES, fontFamily: AGENT_FONTS, artboards[] }`.
- `newDesign.artboards[]`: `{ name, headline, subheadline: string|null, layout: LAYOUT_VARIANTS, screenshotIndex: int|null, backgroundType: 'solid'|'gradient', backgroundColor1, backgroundColor2: string|null, backgroundAngle: number|null, textColor }`.
- Refinements reject only three things: `use-template` with no `templateId`, `generate-new` with no `newDesign`, and `newDesign.artboards` empty.
- Enum sources: `AGENT_CANVASES` (must be `TEMPLATE_CATEGORIES` ids), `NEW_DESIGN_DEVICE_TYPES` (must be real `DeviceType`s), `LAYOUT_VARIANTS`, `AGENT_FONTS` (must be families [fontService](../src/services/fontService.ts) actually loads), and `AGENT_LIMITS = { maxScreenshots: 20, maxNewDesignArtboards: 6, maxTextLength: 200 }`.

**Hard schema constraints (OpenAI strict structured output is the strictest consumer):** every key must be present, optionality via `.nullable()` never `.optional()`, no `.min()/.max()/.regex()`, no `z.record`, no `z.discriminatedUnion`. Bounds live in the builder instead (`clampText`, `clampName`, `safeHex`, `clamp`), which has to sanitize pasted chat JSON anyway.

### Keeping the prompt small

The naive full catalog is ~62k chars and fails silently three ways: ChatGPT free bounces messages over ~4k chars, Ollama/LM Studio truncate at their `num_ctx`, and paid APIs pay ~16k input tokens per run. Mitigations, all in [aliasCatalog.ts](../src/lib/ai/aliasCatalog.ts):

- **Positional refs.** Real element ids never appear in a prompt. Templates are `t<n>` (index over the *filtered* entry list), device slots `d<k>`, text slots `x<k>`, both numbered from 0. `AliasMap` holds `templates`, `refsByTemplateId`, `devices["t3.d0"]`, `texts["t3.x0"]`. `resolveAliases()` rewrites the reply back to real ids **before** zod. Slot numbers run **across the whole template**, not per artboard, so a ref survives a miscounted `artboardIndex`.
- **Prefilter.** `rankTemplates()` scores every template with no model call: category inferred from upload aspect ratio (`inferCategory`, mac band is deliberately narrow at 1.4 to 1.7), `|deviceSlots - screenshotCount|` penalty, keyword overlap minus `STOPWORDS`, and `+100` when the instruction names the template. Top 8 get full slot detail, everything else gets one summary line and cannot have its text rewritten.
- **Degradation ladder, currently dormant.** `SERIALIZE_LEVELS` (6 rungs) shrinks shortlist size, text snippet length, and descriptions until `budgetChars` is met; the last rung is a terse index only (`t12|Droply Habits|scr|3/3`) and sets `hasDetail: false`. No caller passes `budgetChars` today, so every run serializes at rung 0 (shortlist 8). `hasDetail` is likewise inert: `buildCompactRelayPrompt` takes it as `_hasDetail` and ignores it, and the "leave textOverrides empty for it" instruction is emitted by the catalog text itself, not the prompt.

There is no per-provider prompt cap in the code: `PROMPT_BUDGETS` and `buildBudgetedRelay` were removed from AgentStartScreen, and only [docs/AI-AGENT.md](../docs/AI-AGENT.md) and the gpt4free-provider-sync skill still mention them.

### Provider tiers

| Mode | Entry point | Catalog delivery | Notes |
|---|---|---|---|
| "Free, use my account" (web session) | `runWebSession` -> [webSessionDesktop.ts](../src/lib/ai/webSessionDesktop.ts), sites in [webAdapters.ts](../src/lib/ai/webAdapters.ts) | hosted URL first, inline compact on fallback | Desktop only (Tauri webviews) |
| "Free, built in" (keyless) | `runFreeMode` -> [freeProviders.ts](../src/lib/ai/freeProviders.ts): `pollinations`, `ollama`, `lmstudio` | inline compact always | Desktop only, needs `tauri-plugin-http` to dodge CORS |
| "Use my API key" | `runApiMode` -> [generatePlan.ts](../src/lib/ai/generatePlan.ts), registry in [providers.ts](../src/lib/ai/providers.ts) | inline compact always, plus a real JSON Schema | `anthropic` needs `anthropic-dangerous-direct-browser-access`; `openrouter` must use `.chat()` |

**Hosted catalog (URL mode).** [hostedCatalog.ts](../src/lib/ai/hostedCatalog.ts) builds `public/data/ai/catalog.txt` whose first line is `VERIFICATION-TOKEN: abs-<fnv1a of body>`. The prompt tells the model to echo it as `sourceToken`; the client rebuilds the same file in the browser to know the expected token. `verifyHostedCatalog()` preflights (6s) so "provider cannot browse" is never confused with "catalog not deployed / stale". Verdicts cache in `localStorage` under `agent-url-fetch:<provider>` as `<capability>|<token>|<epochMs>`, `fail` expires after 7 days, and only an explicit `CANNOT_FETCH_SENTINEL` reply caches `fail`.

**Regenerating the catalog.** [scripts/gen-ai-catalog.mjs](../scripts/gen-ai-catalog.mjs) esbuild-bundles the real `src/lib/ai` serializers and re-implements `projectService.loadProjectTemplates` (same `TEMPLATE_CATEGORIES` order, `template_<basename>` ids, name/description/previewImage fallbacks). Run `npm run gen:ai-catalog` after **any** change to template JSON, [templateCategories.ts](../src/lib/templateCategories.ts), `AGENT_EXCLUDED_CATEGORIES`, or the serializers. `npm run build` runs it; `npm run dev` and `npm run tauri:dev` do **not**.

### JSON recovery and validation

`extractJson` / `extractJsonCandidates` try, in order: every fenced code block (` ```json ` or bare ` ``` `), each brace-balanced top-level `{..}` span (string-aware, so braces inside strings do not confuse it), first `{` through last `}`, then the raw text. Duplicates are deduped by `JSON.stringify`. Callers iterate candidates and keep the first that validates *and* builds, because Gemini sometimes returns two drafts and reasoning models (GLM) prefix an empty skeleton plan. Failure surfaces through `formatPlanIssues(error, n)` as `screenshotPlacements[2].screenshotIndex: Expected number, received string`.

The builder throws only on an unresolvable template id or an empty template list (templates still loading). `resolveTemplate` matches by normalized id, then exact name, then prefix either way. Bad indices, missing frames, and unknown text ids become `warnings[]` strings shown on the confirmation card. Unplaced screenshots are auto-dropped into remaining free frames in reading order; `findTextElement` falls back to searching every artboard.

### Operation tracing

Every run creates an `OperationRecorder` ([operationLog.ts](../src/lib/ai/operationLog.ts)) persisted to Dexie table `operations` (`id, startedAt, status, provider`, added in [src/database.ts](../src/database.ts) v2, unchanged through v3). `TimelineEntry.kind` is `stage | message | screenshot | note | error`; `detail` is clamped to 200k chars, rows pruned to the newest 60. Surfaced by the info icon on the error alert and "Recent runs" ([OperationTimelineDialog.tsx](../src/components/open-screenshot-generator/start/OperationTimelineDialog.tsx), [RunHistoryDialog.tsx](../src/components/open-screenshot-generator/start/RunHistoryDialog.tsx)); `renderOperationReportHtml` ([operationReport.ts](../src/lib/ai/operationReport.ts)) exports one self-contained HTML file.

### Recipe: add a field to the plan

1. [agentPlanSchema.ts](../src/lib/ai/agentPlanSchema.ts): add it with `.nullable()`, no `.min/.max/.regex`. Add any new enum as a `as const` array so prompts can `.join()` it.
2. [promptBuilder.ts](../src/lib/ai/promptBuilder.ts): add it to the JSON literal at the end of `buildUnifiedPrompt`, and to the Rules block if it needs explaining. One builder serves every mode, so that is the only edit; API mode additionally gets the shape enforced by the JSON Schema `generateObject` derives from `AgentPlanObjectSchema`.
3. [buildProjectFromPlan.ts](../src/lib/ai/buildProjectFromPlan.ts): consume it, clamp/repair it, push a `warnings` entry when the model got it wrong. Update `mockPlan()` fixtures.
4. A new `LAYOUT_VARIANTS` entry also needs a row in **both** `PORTRAIT_RECIPES` and `LANDSCAPE_RECIPES` in buildProjectFromPlan.ts (they are `Record<LayoutVariant, Recipe>`, so `npm run typecheck` catches a missing one).
5. If it touches slot naming or serialization, rerun `npm run gen:ai-catalog` and redeploy.
6. `npm run typecheck` and exercise both `use-template` and `generate-new`.

### Gotchas

- `resolveAliases` must run **before** `safeParse`. Running it after leaves refs in the plan: `resolveTemplate` throws `No template called "t12"` and the whole run fails, and every `textOverride` still pointing at an `x<k>` ref is dropped with a warning.
- `t<n>` refs index `agentUsableTemplates(templates)`, which filters `AGENT_EXCLUDED_CATEGORIES` (`app-preview`). Adding or removing an excluded category renumbers every ref and invalidates the deployed `catalog.txt` token.
- The token hashes the file body, which includes preview URLs built from `PUBLIC_SITE_URL` (`NEXT_PUBLIC_SITE_URL`). A client built with a different site URL than the build that wrote `catalog.txt` computes a different token, the preflight reports `stale`, and URL mode silently falls back to inline.
- `public/data/ai/catalog.txt` is pinned `text eol=lf` in [.gitattributes](../.gitattributes) because it is compared byte-for-byte against a browser rebuild. `core.autocrlf` silently kills URL mode.
- If `buildCatalogArtifacts` throws, both AgentStartScreen and generatePlan fall back to `serializeCatalog`, which prints **real** element ids and leaves the alias map undefined. Refs stop existing for that run; replies quoting real ids still work.
- Send `shot.aiDataUrl` to models, never `shot.dataUrl`. Twenty full-res uploads (2796px long edge) blow every provider's request cap.
- In web-session mode images attach on the **first** send only (`imagesSent` flag): the URL to inline fallback reuses the same conversation, so re-attaching duplicates the uploads.
- `applyScreenshot` deliberately leaves `screenshotRect` alone. Overwriting it undoes the template author's crop.
- `canvasSize()` looks a canvas id up in `TEMPLATE_CATEGORIES` and silently falls back to `TEMPLATE_CATEGORIES[0]` (`screenshots`). An `AGENT_CANVASES` value with no matching category id produces a wrong-size artboard with no error.
- A font added to `AGENT_FONTS` that [fontService.ts](../src/services/fontService.ts) does not load renders as a system fallback with no warning.
- `getDeviceDescriptor` falls back to the `custom` descriptor (`nativeAspect: 9/16`) for an unknown id, so a `NEW_DESIGN_DEVICE_TYPES` entry with no [deviceRegistry.ts](../src/lib/deviceRegistry.ts) row is sized at the wrong aspect instead of failing loudly.
- Generated text uses `fontSize = clamp(round(canvasWidth * 0.033), 12, 48)` because `TextElement` renders glyphs at `fontSize / 0.3` px. Do not "fix" that ratio.
- [src/ai/genkit.ts](../src/ai/genkit.ts) and [src/ai/dev.ts](../src/ai/dev.ts) are dead starter scaffolding (only the unused `genkit:dev` / `genkit:watch` npm scripts reference them). Nothing in the app imports them; the agent does not use Genkit. Do not add flows there.

---

## Web session mode: driving a logged-in Claude/ChatGPT/Gemini account

The free "use my own account" AI path. The desktop app opens each provider site in its own hidden Tauri window, the user signs in there once, and an injected agent drives the page DOM on-device. No API key, no server, no cookies leaving the machine. Same idea as gpt4free's nodriver providers, except the Chromium is the one the app already ships. A companion MV3 extension does the same for the web build and shares the exact same driver and selectors.

### Who does what

| Layer | File | Role |
| --- | --- | --- |
| Selector registry | [webAdapters.ts](../src/lib/ai/webAdapters.ts) | Single source of truth: `WebProviderId` union, `WEB_ADAPTERS`, `WEB_PROVIDERS`, `WEB_PROVIDER_IDS`, `adapterForHost()`, `extensionMatchPatterns()`, `WEB_EVENT_CHANNEL = 'abs-web-event'` |
| DOM driver | [webDriverCore.ts](../src/lib/ai/webDriverCore.ts) | Transport-free: `runSession(config, {prompt, images}, hooks)`, `detectLoginState()`, `DriverError`. Runs inside the provider page |
| Desktop agent | [webAssistantAgent.ts](../src/lib/ai/webAssistantAgent.ts) | Wraps the driver in Tauri events, installs `window.__absAgent = {dispatch, cancel}`. Bundled to `src-tauri/assistant/agent.js` |
| Rust shell | [web_session.rs](../src-tauri/src/web_session.rs) | Owns the `assistant-<id>` windows, the per-provider job queue, `abs_web_start/cancel/login/close/clear_sessions/capture` |
| Desktop client | [webSessionDesktop.ts](../src/lib/ai/webSessionDesktop.ts) | `runViaEmbeddedWebview()`, `loginToProvider()`, `closeProviderWindow()`, `clearWebSessions()`, `BridgeStage`, `BridgeError` |
| UI | [WebSessionModePanel.tsx](../src/components/open-screenshot-generator/start/WebSessionModePanel.tsx), [AgentStartScreen.tsx](../src/components/open-screenshot-generator/start/AgentStartScreen.tsx) | Panel renders straight from `WEB_PROVIDER_IDS`; `runWebSession()` orchestrates the run |
| Extension | [extension/](../extension/) | `src/bridge.ts` (content script in the app page), `src/background.ts` (tab routing, derives its site table from `WEB_ADAPTERS`), `src/adapters/<id>.ts` (one-line `registerAdapter('<id>')`) |

Two channels, and the page gets no Tauri commands (the assistant capability grants `core:event:allow-emit` and nothing else). Rust to page: `window.eval("window.__absAgent && window.__absAgent.dispatch({...})")`. Page to Rust and to the frontend: Tauri events on `abs-web-event`, payload `{type, requestId, provider, stage?, text?, code?, message?, loggedIn?}` where `type` is `ready | progress | result | error` (Rust additionally synthesises `need-login`). The agent is injected as an `initialization_script`, so it runs before the site's own scripts on every navigation.

Flow: `abs_web_start` always inserts a `PendingJob` into `WebSessionState.pending` (keyed by provider, one at a time), creates the window hidden unless `settings.show_assistant_window`, and evals immediately only if the window already existed. Each agent `ready{loggedIn:true}` re-dispatches the queued job; `ready{loggedIn:false}` makes Rust `show()` the window and emit `need-login`. The entry is cleared only by a `result`/`error` whose code is not `not-logged-in`, by `abs_web_cancel`, by `abs_web_clear_sessions` (which drains every provider), or by `WindowEvent::Destroyed`. The last two emit a synthetic `cancelled` error so the frontend stops waiting.

### Adapter contract

`WebAdapter`'s selector fields are **lists of CSS selectors tried in order, first match wins**, so a redesign is normally one new entry rather than new code. Required: `composer`, `fileInput` (an empty list means "no attachments"), `send`, `streaming`, `assistantMessage`. Optional selector lists: `attachMenu` (clicked before hunting for the file input) and `loggedOut` (matched with `pickVisible`, so a hidden sign-in anchor never counts as signed out). Two optional fields are functions that run in the page instead of matching selectors: `probeAuth?: () => 'in' | 'out' | null` (authoritative in-page auth read that beats every DOM race; ChatGPT parses `script#client-bootstrap`'s `authStatus`) and `isGenerating?: () => boolean` (text-based in-progress probe for reasoning models, OR'd into `waitForReply`'s streaming check). `id`, `label`, `url`, `host`, `hosts` and `tested` are plain identity fields.

### Adding a new web provider

Six places. Miss one and it half-breaks, usually silently.

1. [webAdapters.ts](../src/lib/ai/webAdapters.ts): add the id to `WebProviderId` and an entry to `WEB_ADAPTERS`, with `tested: false`. Everything else derives from this file.
2. [web_session.rs](../src-tauri/src/web_session.rs): add `("<id>", "<fresh-chat-url>")` to the `PROVIDERS` array. **The desktop window opens from this map, not from webAdapters**; omit it and `abs_web_start` fails with `unknown provider <id>`.
3. `extension/src/adapters/<id>.ts`: one line, `registerAdapter('<id>');` (copy [claude.ts](../extension/src/adapters/claude.ts)).
4. [extension/manifest.json](../extension/manifest.json): add `https://<host>/*` to both `host_permissions` and `web_accessible_resources[0].matches`, and add the provider to the `description` list.
5. [package.json](../package.json) `build:extension`: append `extension/src/adapters/<id>.ts`. The esbuild input list is explicit, not a glob, so a new adapter file is otherwise never built.
6. [src-tauri/capabilities/assistant.json](../src-tauri/capabilities/assistant.json): add `https://<host>/*` to `remote.urls`. See the trap below.

Then run `npm run build:assistant-agent`, `npm run build:extension`, `npm run typecheck`. Nothing in the UI needs touching: the panel maps over `WEB_PROVIDER_IDS` and shows a "beta" badge for `tested: false`, and every provider receives the same prompt (`buildUnifiedPrompt` in [promptBuilder.ts](../src/lib/ai/promptBuilder.ts)), with no per-provider prompt cap.

### Traps

- **agent.js is `include_str!`'d into the exe at compile time** ([web_session.rs](../src-tauri/src/web_session.rs) `const AGENT_JS`). Editing webAssistantAgent/webDriverCore/webAdapters does nothing until `npm run build:assistant-agent` **and** a Rust rebuild. `src-tauri/assistant/agent.js` is gitignored and listed in [.taurignore](../src-tauri/.taurignore) precisely so regenerating it does not restart `tauri dev`, which means a running dev session never picks it up: restart it.
- **A missing `remote.urls` entry fails with zero symptoms.** Tauri only allows `core:event:allow-emit` from whitelisted remote origins, and the agent's `send()` swallows the emit rejection. The agent installs, boots and drives the page, but no event reaches the shell, so no `ready` fires, the queued job never dispatches, and the run hangs. Capabilities are compiled in by tauri-build, so this needs a rebuild too.
- **Any Tauri command that builds a window must be `async fn`.** Sync commands run on the main thread and `WebviewWindowBuilder::build()` deadlocks there on Windows: blank window, dead X button, frozen app.
- **Login detection is tri-state on purpose** (`LoginState = 'in' | 'out' | 'unknown'`). Reporting `unknown` as signed-out makes a slow-but-signed-in cold start flash the hidden window open then closed, so the agent's boot loop emits `ready{loggedIn:false}` only on a definite `out`, or once after a 30 s stall (`REVEAL_AFTER_STALL_MS`, so a genuinely stuck page still gets a window), and never while a dispatch is `running`. `detectLoginState` checks `probeAuth` first, then `loggedOut`, then `composer`, because several sites serve a working composer while signed out (claude.ai's `/logout` decoy, ChatGPT's anonymous page); when `loggedOut` is set it also gives those markers a 1500 ms grace after finding a composer.
- **Never use a generic `a[href*="login"]`-style `loggedOut` marker.** It false-positives and locks signed-in users out. (claude is the deliberate exception: `a[href*="/login"]` is the only thing marking its logged-out decoy composer, and `pickVisible` keeps hidden anchors from counting.) Leaving `loggedOut` unset is the correct choice for guest-capable sites (glm does exactly that; perplexity keeps only the transient `login-modal`, where presence means out and absence proves nothing): a real wall then surfaces as a composer timeout instead.
- **The initialization script runs in child iframes too.** `boot()` returns unless `window.top === window`; without that the agent booted inside Gemini's same-origin `/_/bscframe` helper, stalled, and emitted a bogus `need-login` mid-run.
- **Progress must not clear the queued job**, and a `not-logged-in` error must not either. Both are what let a run survive a mid-run redirect to a login wall and resume after the manual sign-in.
- **A finished run re-dispatches a *different* queued job itself.** The agent's one-run-at-a-time guard silently drops a dispatch while it is busy, so cancel-then-immediate-retry would otherwise wait forever on a logged-in SPA page that never fires another `ready`. The `result`/`error` arm of `on_agent_event` evals the pending job whenever its `request_id` differs from the run that just ended.
- **Re-dispatch on `ready` means sites that hard-navigate mid-run get the prompt re-sent** (Copilot does this after its first anonymous message). Accepted, bounded by the frontend timeout.
- `abs_web_cancel` is sequenced after the `abs_web_start` invoke settles (`startInvoked` in webSessionDesktop.ts). A cancel that overtakes the start finds nothing to remove and the job later runs as a ghost, posting into the user's real account.
- **Screenshots and cookie clearing are Windows-only.** `abs_web_capture` uses WebView2 `CapturePreview` (renders even while the window is hidden) and `abs_web_clear_sessions` uses `ICoreWebView2_2::CookieManager().DeleteAllCookies()`; both return an error elsewhere. `captureProviderScreenshot()` swallows that into `null` (a screenshot is never load-bearing), but `clearWebSessions()` rejects and the caller has to surface it. Clearing is deliberately cookies-only, never `clear_all_browsing_data`, which would wipe the IndexedDB holding the user's projects and run history.
- `extension/src/protocol.ts` claims to mirror `src/lib/ai/extensionBridge.ts`; that file no longer exists. The extension is the web-only fallback path and is not currently wired into the app UI (nothing in `src/` references its message protocol).

### Debugging without disturbing a running `tauri dev`

The user usually has one running, holding port 9002 and `target/debug/*.exe`. Never kill it. Build to a scratch `CARGO_TARGET_DIR` and run `npx tauri dev --no-watch --config <json>` with `beforeDevCommand: ""` plus `devUrl: http://localhost:9002` to reuse their dev server, and set `WEBVIEW2_USER_DATA_FOLDER` to a scratch dir (both instances otherwise contend over one WebView2 profile and `build()` fails intermittently). Enumerate windows by PID or by `ExecutablePath -like "<scratch dir>*"`, never by process name: both instances share one exe name. Launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<free high port>` and every webview (main plus each `assistant-<id>`) appears as a CDP target on one endpoint; drive commands from the main target with `window.__TAURI_INTERNALS__.invoke(...)`. Note that `settings.json` in `app_config_dir` is shared with the user's real install, so the scratch instance inherits their `showAssistantWindow`. Per-run timelines with per-stage screenshots land in IndexedDB via [operationLog.ts](../src/lib/ai/operationLog.ts) and are readable from the start screen's Recent runs dialog, which is usually faster than live-driving anything.

---

## Local MCP server (desktop only)

The Tauri build can host a Model Context Protocol server so an external client (Claude Code, Claude Desktop, Cursor, VS Code Copilot) drives the real editor: create artboards, add elements, fill templates, export PNGs. Web builds have none of this, every entry point is behind `isTauri()`.

### Transport and opt-in

- Streamable HTTP, JSON only, at `http://127.0.0.1:<port>/mcp`. `DEFAULT_PORT = 8722`, scanning upward `PORT_SCAN = 20` ports if busy ([mcp_server.rs](../src-tauri/src/mcp_server.rs)).
- **Off by default.** The only switch is the native menu item **Settings > "Run MCP server for external AI tools"** (`MENU_ID_MCP_SERVER` in [settings.rs](../src-tauri/src/settings.rs)). It persists `mcpServerEnabled` in the shared `settings.json` and `mcp_server::register` restores it at launch. There is no in-app toggle: [McpServerStatus.tsx](../src/components/open-screenshot-generator/McpServerStatus.tsx) is a read-only pill plus a setup dialog.
- `POST` is the only real verb: `GET /mcp` returns 405 (no server to client SSE stream is ever opened), `DELETE` 200, `OPTIONS` 204, JSON-RPC notifications (method, no id) get 202 without being bridged. Body cap `MAX_BODY = 32 MiB`.

### Rust owns the socket, the frontend owns the tools

A webview cannot listen on a port, and all design state lives in React, so each JSON-RPC **request** is relayed:

1. `bridge_request` emits `abs-mcp-request` to the `main` window with `{ callId, message }`, then blocks on an `mpsc` receiver registered in `McpState.pending`.
2. [desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts) `startDesktopMcpBridge(getApi)` listens on that event, runs `handleMcpMessage`, and calls the `abs_mcp_respond` command with `{ callId, response }`, which unblocks the HTTP handler.
3. Server on/off changes are broadcast as `abs-mcp-status` (`{ running, port, url }`); commands are `abs_mcp_start`, `abs_mcp_stop`, `abs_mcp_status`, `abs_mcp_respond`, `abs_mcp_write_png`. All five are registered in [lib.rs](../src-tauri/src/lib.rs).

Rust never sees a tool schema. `handleMcpMessage` answers `initialize` / `ping` / `tools/list` / `tools/call` only.

### Tools (28, all in the `TOOLS` array)

- Artboards: `list_artboards`, `get_artboard`, `create_artboard`, `set_active_artboard`, `update_artboard` (rename/resize/reorder), `delete_artboard`, `duplicate_artboard`, `set_background`
- Elements: `add_element`, `add_elements` (atomic batch), `update_element`, `delete_element`, `reorder_element`, `measure_element`, `group_elements`, `transform_elements`
- Templates and projects: `list_templates`, `get_template`, `create_project_from_template`, `list_projects`, `open_project`
- Assets and fonts: `list_library`, `list_fonts`, `upload_asset`, `list_assets`, `delete_asset`
- Export: `export_png`, `export_all`

Every element-shaped tool shares `ELEMENT_PROP_SCHEMA` (flat `x`, `y`, `width`, `height`, `rotation`, `scale`, `content`, `fontSize`, `fontFamily`, `letterSpacing`, `fillColor`, `fillGradient`, `imageSrc`, `screenshotSrc`, `styleType`, `pose3d`, `shadow`, `blur`, `opacity`, ...). `collectElementProps` folds `x/y` into `position` and `width/height` into `size`; an explicit `null` becomes `undefined`, which is the only way to clear a shadow or gradient.

### Contracts

- `McpDesignApi` in [desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts) is the interface the app layout must satisfy; result shapes are `McpArtboardSummary`, `McpTemplateSummary` / `McpTemplateDetail`, `McpProjectSummary` / `McpProjectResult`, `McpElementMeasurement`, `McpExportResult`, `McpBox`, `McpElementSpec`.
- The implementation is the `mcpApi` object in [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx), rebuilt every render and stored via `mcpApiRef.current = mcpApi` so the bridge reads fresh state per request.
- **All mutations must go through `handleArtboardsUpdate(nextArtboards)`**, the same path `CanvasArea` uses. It repositions boards, writes the Dexie `projects` row, and calls `pushToHistory`. Writing `setArtboards` directly skips undo/redo and persistence.
- Elements are constructed by the module-level `buildMcpElement(type, subType, props, board)` factory, not by `artboardRefs.addElement` (that imperative ref has a stale `elements` closure, so create-then-patch in one call loses the patch).
- `list_library` and `add_element`'s `libraryId` resolve through [assetLibrary.ts](../src/lib/mcp/assetLibrary.ts), a pure index over `elementLibrary.ts`, `imageLibrary.ts`, `deviceRegistry.ts`, `device3dPresets.ts`. Id prefixes: `element:`, `image:`, `device:`, `device3d:`, `devicecolor:`.
- `upload_asset` stores blobs in the Dexie `media` table ([assetStore.ts](../src/lib/mcp/assetStore.ts)) and hands back `asset:<id>`. `resolveAssetProps` expands the ref to a data URL **when the element is built**, over `IMAGE_SOURCE_PROPS = ['imageSrc','screenshotSrc','customFrameSrc','posterSrc','src']`, so the saved project never contains a ref.

### Adding a new MCP tool

1. If the tool needs live design state, add the method to the `McpDesignApi` interface in [desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts) with the result type it returns. Tools backed only by pure modules (`list_fonts`, `upload_asset`, `list_assets`, `delete_asset`) ignore the `api` argument, so they skip this step and step 3 entirely.
2. Append a `ToolDef` to `TOOLS`: `name` (snake_case), `description` (the model reads only this, so state the trap, not just the action), `inputSchema` (plain JSON Schema object, spread `ELEMENT_PROP_SCHEMA` if it touches elements), and `run(args, api)` returning `textResult(...)` or `{ ...textResult(msg), isError: true }`.
3. Implement it in the `mcpApi` literal in [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx), resolving the board with `resolveBoardId(artboardId)` and committing via `handleArtboardsUpdate`.
4. If it can take more than ~10 seconds (renders, disk writes, project rebuilds), add the name to **both** `SLOW_TOOLS` lists: the Rust one in [mcp_server.rs](../src-tauri/src/mcp_server.rs) and the JS one in [desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts).
5. Update the hand-written tool list under "**Tools.**" in [DESKTOP.md](../docs/DESKTOP.md). Nothing derives it, so it is the one place that silently goes stale.
6. Nothing to register in Rust or in the status dialog: `getMcpToolSummaries()` derives the "Exposed tools" list from `TOOLS`.

### Traps

- **Never dispatch two mutations in one tick.** `mcpApi` closes over its render's `artboards`; that is safe only because a client awaits each response through the full Rust round trip. Batching bridged requests makes the second write clobber the first.
- **The two timeout tables must stay in sync.** Ordinary calls get `RESPONSE_TIMEOUT` 12s, `SLOW_TOOLS` get 180s; the frontend watchdog is deliberately just under (10s / 170s) so the error names the hung tool. The short default is not conservatism: MCP clients keep one HTTP connection and `tiny_http` will not read the next request until the current one is answered, so a single unanswered call stalls everything behind it, `initialize` included.
- **`x`/`y` and `width`/`height` are not symmetric.** `collectElementProps` writes `position` if *either* `x` or `y` is present and fills the missing one with `0`, so `update_element` with only `x` also slams the element to y=0. It writes `size` only when *both* `width` and `height` are present (`buildMcpElement`'s `sizeOr` likewise), so a lone `width` is dropped with no error. Always pass the pairs together.
- **Never byte-slice a `&str` in a Tauri command.** `abs_mcp_write_png` guards its `.png` strip with `is_char_boundary`; `[profile.release] panic = "abort"` means one non-ASCII artboard name would otherwise kill the app.
- `export_png` / `export_all` / `measure_element` read the live DOM (`[data-artboard-dom-id]`, `[data-element-id]`), so they fail when the project is not open on screen. `open_project` waits two `requestAnimationFrame`s before returning for exactly this reason.
- Exports write through the `abs_mcp_write_png` Rust command, defaulting to `Downloads/Open Screenshot Generator`, because the JS `fs` plugin scope only unlocks dialog-picked paths and MCP exports are unattended.
- `delete_artboard` refuses the last board: zero artboards leaves `CanvasArea` stuck in `isLoading` and Dexie already persisted `projectData: []`.
- `add_element` / `add_elements` / `update_element` **reject** an unknown `fontFamily` (with near matches from `similarFonts`) instead of falling back to a browser serif. Both add paths share `buildElementSpec`, so a batch validates exactly like a single call. Check `list_fonts` first.
- `list_templates` filters through `agentUsableTemplates` ([templateCatalog.ts](../src/lib/ai/templateCatalog.ts)), which drops the `app-preview` category: those mockups play a recording no MCP client can supply.
- The status pill must stay behind a `mounted` state gate. The static export is built without Tauri, but `isTauri()` is true in WebView2 at hydration, so rendering on the first client pass is a hydration mismatch. Do not import `@tauri-apps/plugin-clipboard-manager` there, it is not installed and breaks the Next build; `navigator.clipboard` works.
- A white PNG export means a half-filled gradient (`linear-gradient(undefineddeg, ...)`), not a capture bug. Go through `artboardBackground` in [artboardBackground.ts](../src/lib/artboardBackground.ts); `html-to-image`'s `backgroundColor` paints only the colour layer, so the gradient is re-stated through its `style` option. Ignore [DESKTOP.md](../docs/DESKTOP.md)'s reference to an `artboardCaptureBackground` helper, no such symbol exists.

### Status and local testing

The Rust transport has **not** been live-verified against a real MCP client end to end; the frontend halves have. Two verification paths that work:

- Pure modules in node: `npx esbuild <script>.ts --bundle --platform=node --format=cjs --alias:@=./src`, then drive `handleMcpMessage` against a stub `McpDesignApi`. Covers dispatch, schemas and every library id.
- Layout side: temporarily add `if (typeof window !== 'undefined') (window as any).__mcpApi = mcpApi;` after `mcpApiRef.current = mcpApi`, drive it from the puppeteer/Edge harness on localhost:9002, then delete it (grep `__mcpApi` before committing).

For Rust changes, `cargo check` in a scratch `CARGO_TARGET_DIR` so a running `tauri dev` is not disturbed. `settings.json` is shared with the user's live app, so back it up before flipping `mcpServerEnabled` by hand.

---

## Translation and the font system

Translation rewrites the `content` of existing text elements **in place**. It never creates per-language artboards and never duplicates a project.

### Wiring chain

1. [Toolbar.tsx](../src/components/open-screenshot-generator/Toolbar.tsx) renders the Globe "Translate" button (line ~360), gated twice: the whole block is `{onTranslate && (...)}` and the button itself is `disabled={!isTranslationEnabled}`.
2. [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) owns `isTranslateDialogOpen` (line ~470) and defines `currentProjectLanguage` (line ~1782) and `handleTranslateProject` (line ~1792). The Toolbar's `onTranslate` prop (line ~3145) only opens the dialog; the real handler is wired on the dialog itself (lines ~3381 to ~3385).
3. [TranslateDialog.tsx](../src/components/open-screenshot-generator/TranslateDialog.tsx) collects source, target, font, "all artboards" and calls `onTranslate(targetLanguage, allArtboards, sourceLanguage, targetFont?)`.
4. `handleTranslateProject` calls [translation.ts](../src/services/translation.ts) per element and commits with `handleArtboardsUpdate(newArtboards)` (line ~670), which repositions boards, writes the project to Dexie, and calls `pushToHistory`. One Ctrl+Z undoes an entire translation run.

### Backend: self-hosted LibreTranslate

`NEXT_PUBLIC_TRANSLATION_PRIMARY_URL` / `NEXT_PUBLIC_TRANSLATION_FALLBACK_URL` (see [.env.example](../.env.example), both CI workflows). `isTranslationEnabled = !!PRIMARY_URL || !!FALLBACK_URL`, evaluated at module load, so the whole feature is compiled off in a build without those vars. `getTranslationUrl()` GETs `${PRIMARY_URL}/health` with a 3s `AbortController` timeout and caches the winner for `CACHE_DURATION = 60 * 1000`. API surface: `POST /detect {q}` via `detectLanguage()` (returns `DetectedLanguage | null`, never throws) and `POST /translate {q, source, target, format:"text"}` via `translateText()` returning `TranslationResult { text, detectedLanguage? }`. `AUTO_DETECT = 'auto'`.

### Run semantics in `handleTranslateProject`

- Scope: all artboards, or only `activeArtboardId` when `allArtboards` is false. The filter is `if (!allArtboards && activeArtboardId)`, so with no active artboard an unchecked "all artboards" still translates **every** artboard. That is the usual way to blow the rate limit by accident.
- Source is resolved **once per run**: the 10 longest text samples, joined, truncated to 1000 chars, sent to `/detect`. Deliberate, since detecting from one label like "Avg. rating" guesses wrong.
- Two same-language guards. `handleTranslateProject` aborts with a "Nothing to translate" toast when the resolved source equals `targetLanguage`, `translateText` returns the input unchanged for the same case, and the dialog disables the Translate button (`sameLanguage`). A run that "did nothing" is usually one of these, not a failure.
- Then **one serial HTTP request per text element**. There is no batching (LibreTranslate accepts an array `q`; this code does not use it) and no concurrency. When the run started on auto, `effectiveSource` is overwritten by the first response's `detectedLanguage` and reused for the rest of the run.
- Error handling: a 429 sets `(error as any).status = 429` in `translateText`, which sets `rateLimitHit` and short-circuits the remaining elements (they are pushed unchanged). A 429 does **not** increment `failCount`. Other failures do, and keep the original text. Partial results are still committed when `successCount > 0`.
- `ArtboardState.language` ([artboard.ts](../src/types/artboard.ts) line ~309) is stamped with the target **only if `fullyTranslated`**, otherwise it is set back to `undefined`.
- `currentProjectLanguage` returns a code only when every text-bearing artboard agrees (`Set.size === 1`), otherwise `undefined` and the dialog reseeds to auto detect.

### Font data model

[fonts.ts](../src/types/fonts.ts): `interface GoogleFont { family; variants?: string[]; category?: string; fallback?: string; script?: 'latin' | 'arabic' | 'urdu' | 'multilingual' }`.
[fontService.ts](../src/services/fontService.ts) is the single source of truth: `GOOGLE_FONTS`, `SYSTEM_FONTS`, `ALL_FONTS = [...SYSTEM_FONTS, ...GOOGLE_FONTS]`, `createGoogleFontsUrl()`, `preloadGoogleFonts()`, `getFontOptions()`, `getFontsByScript()`, `getGroupedFontOptions()`.
Fonts are **not** loaded with `next/font`. `preloadGoogleFonts()` runs in a `useEffect` on layout mount and appends a `<link rel="stylesheet">` built from `createGoogleFontsUrl()` (`css2?family=...:wght@...&display=swap`). Only `Geist`/`Geist_Mono` in [layout.tsx](../src/app/layout.tsx) use `next/font`, and they are app chrome, not artboard fonts.
Consumers of `ALL_FONTS`: [PropertiesPanel.tsx](../src/components/open-screenshot-generator/PropertiesPanel.tsx) font picker, [TranslateDialog.tsx](../src/components/open-screenshot-generator/TranslateDialog.tsx) font picker, `list_fonts` / `resolveFontFamily` in [desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts), and the separate hardcoded `AGENT_FONTS` allowlist in [agentPlanSchema.ts](../src/lib/ai/agentPlanSchema.ts).

### Font language matching

[fontLanguageMatcher.ts](../src/lib/fontLanguageMatcher.ts) is a flat `languageFontPreferences: Record<string, string[]>` with entries only for `ar, fa, ur, hi, bn, zh-Hans, zh-Hant, ja, ko, th, en`. `getRecommendedFontForLanguage(code)` looks up the ordered chain, returns the first family present in `ALL_FONTS.map(f => f.family)`, else `undefined`. There is no script/subset inference and no per-element detection: the dialog turns the result into a single `targetFont` applied to every text element that translates successfully (`...(targetFont ? { fontFamily: targetFont } : {})`); failed and post-429 elements keep their old font. `undefined` becomes the sentinel `'keep_current'`, which the dialog converts back to `undefined` so fonts are left alone.

### Add a font

1. Append a `GoogleFont` to `GOOGLE_FONTS` in [fontService.ts](../src/services/fontService.ts) with `variants` matching the weights Google actually serves.
2. Verify the family exists on Google Fonts. Unknown families in a multi-family `css2` request are **silently dropped** (a lone unknown family 400s, but mixed with valid ones the response is 200 minus that `@font-face`).
3. If the AI agent or MCP should be able to pick it, add it to `AGENT_FONTS` in [agentPlanSchema.ts](../src/lib/ai/agentPlanSchema.ts). `list_fonts` and `resolveFontFamily` pick it up from `ALL_FONTS` automatically.
4. If it belongs to a new script, four more edits, and missing any one hides the font: widen the `script` union in [fonts.ts](../src/types/fonts.ts), widen the parameter union of `getFontsByScript()` and add a key in `getGroupedFontOptions()` in [fontService.ts](../src/services/fontService.ts), widen the `script` enum on the `list_fonts` tool in [desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts) (line ~1067), **and** add a `<SelectGroup>` in both [TranslateDialog.tsx](../src/components/open-screenshot-generator/TranslateDialog.tsx) and [PropertiesPanel.tsx](../src/components/open-screenshot-generator/PropertiesPanel.tsx). Both render five hardcoded groups; a font in an ungrouped script is invisible in every picker.

### Add a language

1. Add `{ code, name }` to `LANGUAGES` in [TranslateDialog.tsx](../src/components/open-screenshot-generator/TranslateDialog.tsx). That is the only registration site (`getLanguageName` and both pickers read it). The code must be one the LibreTranslate instance returns from `/languages`, and must match what `/detect` returns, since detection output is fed straight back as `source` and compared against `targetLanguage`.
2. Add a preference chain in `languageFontPreferences` only if a font in `ALL_FONTS` truly covers the script. Add the font first.

### Traps

- Translating **to English** silently restyles the design. `'en'` maps to `['Inter', 'Roboto Flex', 'Arial']`, `Inter` is not in `ALL_FONTS`, so `Roboto Flex` wins, the dialog preselects it, and every text element's `fontFamily` is overwritten. Choose "Keep current fonts" to preserve template typography.
- `Noto Sans Urdu` and `Jameel Noori Nastaleeq` in `GOOGLE_FONTS` are not real Google Fonts families. They appear in the pickers and never load. `Noto Nastaliq Urdu` (first in the `ur` chain) is real, so the auto-match path works, manual selection does not.
- `Noto Sans` (the only `multilingual` entry) serves latin, latin-ext, cyrillic(-ext), greek(-ext), devanagari, vietnamese. It has **no** Bengali, Thai, Hebrew, or CJK glyphs, so the `bn`/`th`/`ja`/`ko`/`zh-Hans`/`zh-Hant` mappings are cosmetic and those scripts render from an OS fallback.
- No RTL support anywhere. [TextElement.tsx](../src/components/open-screenshot-generator/elements/TextElement.tsx) sets no `dir` or `direction`, only `textAlign`. Arabic, Urdu, Hebrew, and Persian inherit the artboard LTR context, so mixed content and trailing punctuation reorder incorrectly. Nothing flips the layout.
- Text overflow after translation is silent. `TextElement` fills the fixed pixel box sized by its [DraggableElement.tsx](../src/components/open-screenshot-generator/elements/DraggableElement.tsx) wrapper (`width`/`height` 100%) with `overflow: 'hidden'`, `wordBreak: 'break-word'` and `fontSize / 0.3`. Longer target strings just clip. There is no autofit or reflow pass.
- `fontFamily` is applied bare (`fontFamily: element.fontFamily`) with no CSS fallback stack, so an unloaded family drops straight to the browser default serif.
- Export vs font timing: PNG export uses `toPng` from `html-to-image` with no `fontEmbedCSS` or `skipFonts`, and does not await `document.fonts.ready` (only `signalAppReady()` in [desktop.ts](../src/lib/desktop.ts) does, for the Tauri splash). Translate then immediately export and a still-downloading webfont can rasterize as fallback. Artboard fonts also require network, including in the desktop build, since none of them is bundled locally (only `next/font`'s Geist is self-hosted).
- Rate limit is real: the dialog advertises 20 requests / 5000 chars per minute, and the loop issues one request per text element. "Translate all artboards" on a normal project exceeds it, which is why the checkbox defaults to off.
- Only `PRIMARY_URL` is health checked. With only the fallback configured the probe fetches a relative `/health` on the app's own origin. A 404 there falls through to the fallback correctly, but a host that answers `/health` with a 200 catch-all caches `''` as the winner and sends every `/translate` to the app's own origin.
- The comment in [.env.example](../.env.example) claiming defaults of trybooks.org / ludowala.app is stale. The code defaults both to `''`, which disables the button.

---

## Element palette, device registry, and 3D device rendering

### Where things live

| Concern | File |
| --- | --- |
| Palette UI (3 tabs, category cards, drill-in) | [ElementPalette.tsx](../src/components/open-screenshot-generator/ElementPalette.tsx) |
| Vector element library (SVG paths) | [elementLibrary.ts](../src/lib/elementLibrary.ts) |
| Photo / badge library | [imageLibrary.ts](../src/lib/imageLibrary.ts) |
| Device declarations, swap + format conversion | [deviceRegistry.ts](../src/lib/deviceRegistry.ts) |
| 3D pose tables, colored flat presets | [device3dPresets.ts](../src/lib/device3dPresets.ts) |
| Flat frame chrome shared by screenshot + video mockups | [deviceChrome.tsx](../src/components/open-screenshot-generator/elements/deviceChrome.tsx) |
| three.js renderer | [Device3DRenderer.tsx](../src/components/open-screenshot-generator/elements/Device3DRenderer.tsx) |
| Palette item to canvas element | `addElement` in [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx) (line ~133) |
| Shared opacity / shadow / blur CSS | [elementStyle.ts](../src/lib/elementStyle.ts), applied by [DraggableElement.tsx](../src/components/open-screenshot-generator/elements/DraggableElement.tsx) |
| MCP mirror of all three libraries | [assetLibrary.ts](../src/lib/mcp/assetLibrary.ts) |

### Palette data model

Every palette tile calls one `handleDragStart(e, type, subType, styleProps)`. Drag stores three `dataTransfer` keys (`application/artboard-element-type`, `application/artboard-element-subtype`, `application/artboard-element-styleprops`); click calls the same function with `e === null`, which goes straight to `onAddElement`. In the SHAPE branch, `Artboard.addElement` pulls `styleProps.defaultSize` and `styleProps.name` out first and `Object.assign`s the rest onto the element. The image, video, video-device, gesture and device branches instead copy a fixed set of known fields, so any other key in `styleProps` is silently dropped there.

- `ELEMENT_CATEGORIES: ElementCategory[]` = `{ id, label, items: LibraryElementDef[] }`. Each item is `{ id, label, styleProps }` where `styleProps: LibraryElementStyleProps` = `{ name, customPath, specialProps?: { viewBox, strokeOnly, baseStrokeWidth, fillRule }, defaultSize? }`. Categories: `shapes, arrows, icons, decor, blobs, stars, waves, laurels, lines, patterns`.
- Items are built by `el(id, label, path, opts)` (elementLibrary.ts ~line 970) with `ItemOpts { stroke?: number; evenodd?: boolean; size?: {width,height} }`. `stroke` sets `strokeOnly: true` + `baseStrokeWidth`; `evenodd` sets `fillRule: 'evenodd'`.
- Every path is authored in a `0 0 100 100` viewBox and generated deterministically at module load from helpers (`polygonSub`, `starSub`, `sparkleSub`, `blobSub`, `smoothClosedSub`, `brushStrokeSub`, `laurelBranchSub`, ...). Multi-part artwork is one concatenated path string so it stays one element.
- Element tiles drop `type: 'shape'`, `subType: 'custom-svg'`; [ShapeElement.tsx](../src/components/open-screenshot-generator/elements/ShapeElement.tsx) renders `customPath` with `preserveAspectRatio="none"` and `vectorEffect="non-scaling-stroke"`.
- `IMAGE_CATEGORIES: ImageCategory[]` with `LibraryImageDef { id, label, src, defaultSize }`. Tiles drop `type: 'image'` and `Artboard.addElement` forces `objectFit: 'contain'` whenever `imageSrc` is present.
- Two categories are NOT data driven: `openCategoryId === 'basic'` (text, image, rectangle/circle/triangle/star/hexagon/diamond/message/speech-bubble/pentagon) and `'app-preview'` (`video-device`, `video`, `gesture` tiles). They are hardcoded JSX in ElementPalette.tsx.
- The active tab is persisted in `sessionStorage['palette-active-tab']`, restored in an effect (not in `useState`) to avoid an SSR hydration mismatch. The restore explicitly rejects a saved `'layers'` value: that tab moved to the floating layers card, and selecting it would blank the palette.

### Device registry

`DEVICE_REGISTRY: Record<DeviceType, DeviceDescriptor>` declares each device once:

```ts
interface DeviceDescriptor {
  id: DeviceType; label: string;
  platform: 'ios' | 'android' | 'neutral';
  category: 'phone' | 'tablet' | 'watch' | 'desktop' | 'custom';
  nativeAspect: number;                       // width / height of the real device
  screen?: { paddingPercent: { top; right; bottom; left }, radiusFactor: number };
  counterpart?: Partial<Record<'ios' | 'android', DeviceType>>;
}
```

`paddingPercent` values are percentages of the element's EFFECTIVE WIDTH (`size.width * scale`) for all four sides, including top and bottom, matching `bezelPx()` in the renderers. `radiusFactor` is also a fraction of width. `getDeviceScreenRect(el)` turns that into an artboard-space rect and is what `swapDeviceInElements` uses to re-fit screen-conforming overlays (image or `rectangle` shapes sitting within `SCREEN_MATCH_TOLERANCE` of the screen rect). `custom` has no `screen` (user-uploaded frame image).

Consumers: `DEVICE_PICKER_GROUPS` (computed once, excludes `custom`), `swapTargetFor`, `buildSwapUpdates` (same-category swaps keep the box, cross-category swaps preserve AREA and re-derive from `nativeAspect`), `detectArtboardsFormat`, `DEVICE_FORMAT_PRESETS` / `APP_STORE_FORMAT_IDS`, `convertArtboardsToFormat`, `scaleElementsToCanvas`.

Flat rendering: `getFlatDeviceChrome(deviceType, effectiveWidth)` returns `FlatDeviceChrome { outerBorderRadius, bodyColor, notch, screenBorderRadius, paddingPercent, label, chassis? }`. `macbook` and `imac` set `chassis` (absolutely positioned lid/base/scoop or slab/leg/foot divs); only the MacBook `lid` and the iMac `slab` read `var(--frame-bg)` so recolour presets tint the display shell, while base, scoop, leg and foot are fixed aluminium gradients. Everything else paints the frame div's own background. Notches are `islandNotch` / `classicNotch` / `punchHoleNotch`, all rendered INSIDE the screen div with percentage offsets and `zIndex: 3` so they stay glued to the screen's top edge at any aspect.

3D rendering has its own metric table: `DEVICE_METRICS: Partial<Record<DeviceType, DeviceMetrics>>` in Device3DRenderer.tsx, with `{ cornerRadius, screenRadius, bezel, thickness, notch: 'island'|'notch'|'punch'|'none' }` as fractions of body width (world width = 1), falling back to `DEFAULT_METRICS`.

### The 3D pipeline

`styleType: '3d-left' | '3d-right'` on a `DeviceFrameElementProps` switches [DeviceFrameElement.tsx](../src/components/open-screenshot-generator/elements/DeviceFrameElement.tsx) to `Device3DRenderer`, which is loaded through `next/dynamic({ ssr: false })` so three.js (~145 KB gz) never enters the first-paint path of a 2D-only project.

- `POSES: Record<Device3DPose, { yaw; pitch; roll?; bodyAspect? }>`. Applied as roll(Z) * pitch(X) * yaw(Y); `yaw` and `roll` are multiplied by `-sideSign`, so side `right` mirrors them. Without `bodyAspect` the body's proportions follow the element box; the rolled poses pin `bodyAspect: 2.05`.
- `FRAME_COLORS` (`titanium | black | white`) drive rail color/roughness/env intensity; watch bands use `WATCH_BAND_COLORS`, Macs use `MAC_BODY_COLORS`.
- Body is an `ExtrudeGeometry` rounded rect passed through `toCreasedNormals(geo, 30deg)` (raw extrude is flat shaded and the bevel facets sparkle). Material array is `[capMat, railMat]` (index 0 = front/back caps, 1 = rail). Lighting is `RoomEnvironment` through `PMREMGenerator` at blur 0.35 plus key/fill/ambient lights.
- The screenshot is a `MeshBasicMaterial({ toneMapped: false })` plane at `screenSize.z + 0.001`. `objectFit: 'contain'` shrinks the plane; `'cover'` crops via `texture.repeat/offset`; `ShapeGeometry` UVs must go through `normalizeShapeUVs`.
- Rendering is on demand (no rAF loop) because PNG export can snapshot the canvas at any moment. `applySize()` rebuilds geometry only when the aspect changes by more than 0.005 and is debounced 110 ms during resize. Layering uses `renderOrder` (shot = 1, notch = 2) plus small z offsets, not depth tricks.
- The `artboard:export` CustomEvent (`detail.phase: 'begin' | 'end'`, dispatched from [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) and [videoExport.ts](../src/lib/video/videoExport.ts)) forces pixel ratio >= 2 during capture and restores afterwards. Cleanup calls `renderer.forceContextLoss()` so a batch swap cannot hold 2N WebGL contexts.
- Thumbnails live at `public/elements/device-3d/<prefix>-<pose>-<side>-<color>.png` (156 files; prefixes `iphone, android, watch, macbook, imac`). The palette renders them via `<img src={withBasePath(...)}>`, never a live canvas.
- Pose sets and element sizes come from device3dPresets.ts: `POSE_ORDER` (10), `WATCH_POSE_ORDER` (= `front` + POSE_ORDER), `MACBOOK_POSE_ORDER` (`front, upright, side, tilted, reclined`), `IMAC_POSE_ORDER` (`front, upright, side`), plus `IPHONE_3D_SIZES`, `ANDROID_3D_SIZES`, `WATCH_3D_SIZES`, `MACBOOK_3D_SIZES`, `IMAC_3D_SIZES`.

### Recipe: add a vector element to the Elements palette

1. In [elementLibrary.ts](../src/lib/elementLibrary.ts), add a path helper if the shape is not expressible with the existing ones. Keep it deterministic (no `Math.random`, no `Date`): server and client must produce identical strings.
2. Add `el('<category>-<slug>', 'Label', pathString, { stroke?, evenodd?, size? })` to the right category array. Author in the `0 0 100 100` viewBox. Omit `size` only if 300x300 is right.
3. If it is a new category, append `{ id, label, items }` to `ELEMENT_CATEGORIES`; the palette overview grid and the MCP `elementItems()` index pick it up with no other change.
4. Verify with the `app-screenshots` skill: open the category, screenshot the grid, click `button[title="Add <Label>"]`, confirm a new `[data-element-id]` renders.

### Recipe: add a device

1. Add the id to `DeviceType` in [artboard.ts](../src/types/artboard.ts).
2. Add a `DeviceDescriptor` to `DEVICE_REGISTRY`, including `counterpart` entries in BOTH directions if the device should take part in platform swaps.
3. Add a `case` to `getFlatDeviceChrome` for outer radius, body color, notch, and (non-slab bodies only) `chassis`.
4. Add a `DEVICE_METRICS` entry in Device3DRenderer.tsx if it can render in 3D; devices with custom geometry (`macbook`, `imac`, `apple-watch`) also need branches in `buildDevice` / `buildMacDevice` and fit points in `layoutCamera`.
5. Add a `DraggableItem` to the `mockups` branch of ElementPalette.tsx with a `defaultSize` matching `nativeAspect`. Do not copy the `borderRadius: '28px'` styleProps from the older tiles: the device branch of `addElement` never reads it and the outer radius always comes from `getFlatDeviceChrome`.
6. Add the id to the `DEVICE_TYPES` list in [desktopMcpServer.ts](../src/lib/mcp/desktopMcpServer.ts) (hand-maintained; it is what tells an MCP caller the device exists in `add_element`).
7. For a 3D group: add pose order + size map + a `DEVICE_3D_GROUPS` entry in device3dPresets.ts, AND a `DeviceCategoryId` + `DEVICE_CATEGORY_LABELS` entry + previews array + a `DeviceCategoryCard` in the Device Library overview grid + a `Device3DThumbTile` block in the drill-in, all in ElementPalette.tsx, AND a device row in `regen-3d-thumbs.js`. Then regenerate thumbnails.

### Recipe: add an image asset group

1. Use the `stock-image-assets` skill. Assets must be Adobe Stock free-collection photos licensed through the owner's account, background-removed, trimmed, longest side <= 1000 px, named `<group>-as<StockID>.png` under `public/elements/images/<group>/`.
2. Append an `ImageCategory` to `IMAGE_CATEGORIES` with `defaultSize` scaled so the longest side is about 430 canvas units, preserving the PNG aspect. The Images tab overview and drill-in both iterate `IMAGE_CATEGORIES`, so there is no second registration site.
3. Append license rows to [image-asset-licenses.md](../docs/image-asset-licenses.md) in the same change.

### Traps

- Bezel insets derive from WIDTH on all four sides. Never reintroduce percentage margins: the old margin-based layout resolved CSS `%` margins against the WIDTH even for top/bottom while the height calc used the HEIGHT, so the bottom bezel grew as the element got taller (the Android bar issue).
- `getFlatFrameStyles` is used only by `VideoDeviceElement`; `DeviceFrameElement` imports it but never calls it, still carrying an inline copy of the same frame/screen CSS. A chrome fix must land in both or the two element types drift.
- Chassis devices (`macbook`, `imac`) force `borderRadius: 0`, a transparent frame background, and IGNORE the `outline` preset. `frameOpacity` still works because `renderChassis` wraps the nodes in an opacity div.
- `ElementPalette.tsx` shares the pose orders and size maps with device3dPresets.ts by import, but it does NOT iterate `DEVICE_3D_GROUPS` and does not call `device3dStyleProps` (each group is a hardcoded JSX block that rebuilds the props inline). `DEVICE_3D_GROUPS` is read only by the MCP asset library, and the id sets already disagree: the palette has one `3d-mac` category where the presets have `3d-macbook` and `3d-imac`. A group added in one place is invisible in the other.
- `regen-3d-thumbs.js` duplicates the per-pose size maps as local `IP`, `AND`, `WATCH`, `MACBOOK`, `IMAC` consts. If they drift from device3dPresets.ts the thumbnails no longer match the dropped element's aspect.
- Regenerate thumbnails after ANY pose, finish, geometry or material change: `node .claude/skills/app-screenshots/scripts/regen-3d-thumbs.js [iphone android watch macbook imac]`. It needs Edge and ffmpeg at the hardcoded Windows paths and bundles the real renderer via esbuild. Filenames never change, so hard-refresh the browser afterwards.
- `isometric` is an exact decomposition of the 2D isometric projection and always renders phone proportions (`bodyAspect: 2.05`). It is deliberately absent from `MACBOOK_POSE_ORDER` / `IMAC_POSE_ORDER` along with the tossed-phone poses (`floating, drifting, leaning, soaring`), which tumble a laptop.
- The watch and both Macs keep native proportions regardless of the element box (`WATCH_BODY_ASPECT`, `buildMacDevice`), and their camera fit runs 4 fixed-point iterations to re-center the asymmetric projection. Phones use 1.
- Every `public/` asset src must go through `withBasePath` from [basePath.ts](../src/lib/basePath.ts). Neither `next/image` nor a plain `<img>` applies `basePath` to a string src, and the app deploys under a GitHub Pages sub-path.
- Device tiles that pass `defaultSize` get centered by their real size on click and clamped inside the artboard on drop. Without `defaultSize` a device falls back to 600x1200, an image to 400x300, a shape to 300x300.
- Image assets must never be cropped out of reference screenshots or downloaded from the web (Wikimedia, brand SVG pages). Store badges are the exception and must be official vendor badge-program artwork.

---

## Exporting: PNG images and App Preview video

Both export paths live in [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) (3400+ lines, holds the state). [src/components/toolbar/ExportButton.jsx](../src/components/toolbar/ExportButton.jsx) is a tracked **0-byte dead file**. Do not put export code there.

### Entry point and dialog routing

Toolbar button `title="Export Artboards as Images"` sets `isExportDialogOpen`. Which dialog opens is decided by `projectHasVideoContent(artboards)` from [videoExport.ts](../src/lib/video/videoExport.ts): true when any element is `video-device`, a `video` with `mediaId`/`videoSrc`, a `gesture`, or carries `animation`.

- false: [ExportDialog.tsx](../src/components/open-screenshot-generator/ExportDialog.tsx), returns `ExportSelection { asIs: boolean; generateFormats: DeviceFormat[] }`
- true: [AppPreviewExportDialog.tsx](../src/components/open-screenshot-generator/AppPreviewExportDialog.tsx), returns `VideoExportRequest { fps; durationSeconds; sizeMode; rawRecordingOnly }` where `VideoSizeMode = 'appstore-portrait' | 'appstore-landscape' | 'artboard'` (886x1920 / 1920x886 / board size). Its "Export PNG stills instead" button just calls `handleConfirmExport({ asIs: true, generateFormats: [] })`.

`ExportSelection`, `VideoExportRequest`, `VideoSizeMode` and `VideoExportProgress` are all declared in [ExportDialog.tsx](../src/components/open-screenshot-generator/ExportDialog.tsx); the video dialog imports them from there.

### PNG path

`handleConfirmExport` -> `captureArtboards(list, exportDir)`. Per board it calls `captureArtboardDataUrl(artboard)`, the single rasterizer shared with the store upload (`handlePublishCapture`): find `[data-artboard-dom-id="<id>"]`, force `style.transform = 'scale(1)'`, call `toPng` from `html-to-image` (^1.11.13, run **unpatched**: there is no `patches/` dir and no postinstall patch step, even though `patch-package` sits in dependencies) with `width/height = artboard.size`, `pixelRatio: 1`, `cacheBust: true`, `backgroundColor` + `style.backgroundImage` from `artboardBackground()` in [artboardBackground.ts](../src/lib/artboardBackground.ts), and a `filter` dropping `data-export-exclude` / `data-interaction-handle`. PNG is the only format; `ArtboardState.exportScale` exists in the type but nothing reads it.

Filenames: `<NN>_<Artboard_Name>[_<Device_Label>].png`, `NN` zero-padded to `Math.max(2, String(list.length).length)`, spaces to `_`, suffix from `detectArtboardsFormat([artboard])`.

Generated App Store sizes convert in memory: `convertArtboardsToFormat` -> `calculateArtboardPositions` -> plain `setArtboards` (deliberately not `handleArtboardsUpdate`, so history and the saved project stay clean) -> `waitForCanvasToSettle(400)` (two rAFs plus 400ms) -> capture -> `setArtboards(original)` in `finally`.

Every capture pass is wrapped in `window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'begin' | 'end' } }))` plus a 100ms wait. [Device3DRenderer.tsx](../src/components/open-screenshot-generator/elements/Device3DRenderer.tsx) `handleExportPhase` listens and re-renders at `setPixelRatio(Math.max(2, lastPixelRatio))` so three.js devices are supersampled. Always pair begin/end in a `try/finally` or the renderers stay at 2x forever.

### Desktop (Tauri) vs web saving

Every save goes through [src/lib/desktop.ts](../src/lib/desktop.ts). `<a download>` works in browsers and WebView2 but **WKWebView on macOS silently ignores it**, so never hand-roll an anchor download. Contract: `saveDataUrlToDisk` / `saveBlobToDisk` return the path in Tauri, `null` when the user cancelled the dialog, `undefined` on web. When `isTauri() && totalFiles > 1`, `pickExportDirectory()` is called once and files go through `saveDataUrlToPath` / `saveBlobToPath`; `open({ directory: true, recursive: true })` is what widens the fs scope enough for the later `writeFile` calls. `sanitizeFileName` strips `\/:*?"<>|` because native dialogs reject them (browsers sanitize themselves).

The MCP tool path is separate: `captureArtboardForMcp` uses the same recipe but with `pixelRatio: scale` (clamped 0.1 to 4) and writes via the Rust command `abs_mcp_write_png`, because the JS fs plugin only unlocks dialog-picked paths and MCP exports are unattended.

### Video path

`exportArtboardVideo(artboard, settings: VideoExportSettings)` in [videoExport.ts](../src/lib/video/videoExport.ts) returns an MP4 `Blob`. Two phases:

1. **Rasterize once.** Each element becomes a `Layer`: `{kind:'sprite'|'video'|'device-video'|'gesture'}`. Sprites come from `captureSprite` (`toPng` at `pixelRatio: 1`, `SPRITE_FILTER` drops `data-export-exclude`, `data-interaction-handle`, `data-screen-video`). This whole phase dispatches its own `artboard:export` begin/end pair (same 100ms wait), so 3D devices supersample for the sprite pass too.
2. **Composite per frame.** 2D canvas, `VideoFrame` -> `VideoEncoder` (WebCodecs) -> `Muxer`/`ArrayBufferTarget` from `mp4-muxer` (^5.2.2), `codec: 'avc'`, `fastStart: 'in-memory'`, `firstTimestampBehavior: 'offset'`. Codec picked by walking `H264_CODEC_CANDIDATES` through `VideoEncoder.isConfigSupported`. Output dims forced even (`Math.max(2, Math.floor(n/2)*2)`), bitrate default `12_000_000`, keyframe every `fps * 2` frames, backpressure at `encodeQueueSize > 4`.

Positioning conventions: artboard space is the drawing space. `coverScale = Math.max(outW/w, outH/h)` with centering offsets, so a 1290x2796 board fills an 886x1920 export edge to edge. `withElementTransform` re-applies `position + boxW/2 + anim.dx`, `rotation`, `anim.scale` around the box center. `slideDistance = artboard.size.height * 0.05`.

Timing helpers: [animation.ts](../src/lib/video/animation.ts) `animationStateAt(anim, t, slideDistance) -> { visible, opacity, dx, dy, scale }` (exit wins once `t >= exitStart`; `ENTER_DURATION_DEFAULT`/`EXIT_DURATION_DEFAULT` are 0.6). [gestures.ts](../src/lib/video/gestures.ts) `gesturePhaseAt` / `drawGesture` / `gestureEndTime` (`GESTURE_DURATION_DEFAULT` 1.2, `GESTURE_TRIGGER_DEFAULT` 0.5). The canvas preview loops gestures forever via CSS; the export plays once at `triggerTime` unless `gestureRepeat`.

Media lives in Dexie, not in the project: [mediaStore.ts](../src/lib/mediaStore.ts) `db.media` holds `MediaAsset { id, blob, name, mimeType, width, height, duration, createdAt }`; elements store only `mediaId`. `getMediaUrl(id)` caches one objectURL per id for the session. [migrateVideoDevices.ts](../src/lib/video/migrateVideoDevices.ts) runs on every project load and converts legacy `device` elements carrying `screenVideoMediaId` into `video-device`.

### Video export limits (state these plainly, do not "fix" them casually)

- **No audio.** The MP4 has a video track only.
- **Flat frames only.** 3D and perspective device poses export as static sprites (their screenshot, or an empty screen). Only `video-device` composites a live recording.
- **WebCodecs required.** Without `VideoEncoder` or an H.264 profile, `pickEncoderConfig` throws with a "use the desktop app, Chrome or Edge" message. There is no fallback encoder. PNG export is unaffected.
- One MP4 per artboard, rendered sequentially (encoder and sprite captures both want the main thread).
- Duration clamped 1 to 30s in the UI; Apple wants 15 to 30.

### Traps

- **The sprite left/top gotcha.** `html-to-image` keeps `left`/`top`/`transform` on the cloned root, so capturing an element wrapper as-is shifts the artwork out of the sprite by its canvas position. `captureSprite` sets `left`/`top` to `${pad}px` and `transform: 'none'`, captures, then restores in a `finally`. Any new capture-a-single-element code must do the same.
- **Shadow/blur overspill.** `spriteOverspill(el)` returns `max(|shadow.x|,|shadow.y|) + shadow.blur`, and `blur * 3` for gaussian blur. The capture grows by `pad` on every side and `drawSprite` draws back at `-pad` with `w + pad*2`. Mirrors the CSS filters in [elementStyle.ts](../src/lib/elementStyle.ts); change one and change the other.
- **Notch overlay.** A "transparent screen" chrome capture cannot work (the frame background paints behind the screen inset), so `captureNotchOverlay` captures the full chrome as one sprite drawn UNDER the video and a notch-only sprite drawn OVER it. It temporarily transparents `[data-device-frame="<id>"]` (background, boxShadow, border) and `[data-device-screen="<id>"]`, filters to the `[data-device-notch]` subtree, and restores in `finally`.
- **Gradients need `backgroundImage` restated.** `html-to-image`'s `backgroundColor` only paints the colour layer and `style` is applied to the clone last, so a gradient board exports flat white unless you go through `artboardBackground()`. A half-filled `backgroundGradient` produces invalid CSS and silently flattens, which is why `normalizeGradient()` exists.
- **basePath.** Public asset srcs (`posterSrc`, `videoSrc`, `screenshotSrc`) are stored canonical and must be wrapped in `withBasePath()` from [basePath.ts](../src/lib/basePath.ts) **at render time only**. `loadVideoSource` does `withBasePath(el.videoSrc)`. Never store a prefixed path.
- **Cross-origin taint.** Nothing in `src/` sets `crossOrigin`. `html-to-image` inlines images by fetching them, so a remote image without CORS headers drops out of the capture with no error. Keep assets under `public/`.
- **Fonts and images are not gated.** There is no `document.fonts.ready` await before capture (only in `signalAppReady`). The only settling is `cacheBust: true`, the 100ms `artboard:export` wait, and `waitForCanvasToSettle(400)` on format swaps. Late-loading web fonts export as fallback type.
- **The unscale/restore now lives in `captureArtboardDataUrl`, inside a `finally`.** It used to be inlined in `captureArtboards` with the restore inside the `try`, which left a board stuck at `scale(1)` whenever `toPng` threw. Any new single-board capture should call `captureArtboardDataUrl` rather than re-inline the recipe.
- Any editor-only UI added inside an element renderer needs `data-export-exclude` (see the upload buttons in [VideoDeviceElement.tsx](../src/components/open-screenshot-generator/elements/VideoDeviceElement.tsx)) or it bakes into both the PNG and the video sprites.

### Adding a new element type so it exports correctly

1. Add the props interface to the `ArtboardElement` union in [src/types/artboard.ts](../src/types/artboard.ts).
2. Write the renderer in [src/components/open-screenshot-generator/elements/](../src/components/open-screenshot-generator/elements/); tag any editor-only chrome `data-export-exclude`.
3. Render it on the canvas: add the `element.type === '<new>'` branch to the element map in [Artboard.tsx](../src/components/open-screenshot-generator/Artboard.tsx). Both PNG and video capture read the live canvas DOM, so nothing exports at all until this branch exists.
4. Add the same branch to `StaticArtboard` in [PreviewDialog.tsx](../src/components/open-screenshot-generator/PreviewDialog.tsx), the second render site. Miss this and the element vanishes from Preview while still exporting.
5. PNG export needs nothing further: it captures the live DOM.
6. Video export falls through to the generic `captureSprite` branch (static sprite) automatically. Only add a `Layer` kind if it must animate per frame.
7. If it paints outside its box, extend `spriteOverspill`.
8. If it should route the project to the video dialog, add it to `projectHasVideoContent` and `analyzeArtboardForVideo`.
9. Editor plumbing outside the export path, both of which fall back to a generic default so they degrade rather than break: the per-type icon and label switches in [LayersPanel.tsx](../src/components/open-screenshot-generator/LayersPanel.tsx), and the per-type properties branch in [PropertiesPanel.tsx](../src/components/open-screenshot-generator/PropertiesPanel.tsx).

### Verifying an export actually works

Use the `app-screenshots` skill ([.claude/skills/app-screenshots/](../.claude/skills/app-screenshots/)): puppeteer-core driving real Edge (real GPU, so WebGL matches) against the dev server on `http://localhost:9002`. `scripts/lib.js` `exportArtboards(page, downloadDir, expectedCount, timeoutMs, extraFormats)` detects which dialog opened and handles both. Hard-won rules: set CDP `Browser.setDownloadBehavior` before clicking, poll the dir until the file count lands then wait ~3s for writes; never `page.screenshot({ clip })` (it resizes the viewport and remounts the palette); `waitForFunction` needs `polling: 500`. Dialog ids: `#export-as-is`, `#gen-ios`, `#gen-ipad-pro-13`, `#gen-ipad-11`, and `#apv-styled` / `#apv-raw` for video. Then crop the downloaded PNGs 1:1 with ffmpeg and Read the crops: exports take a different rendering path from the screen, so on-screen correctness proves nothing.

---

## Desktop app (Tauri) and bring-your-own-storage account sync

One Next.js static export runs in both places: a browser tab, and a Tauri v2 native shell (WebView2 on Windows, WKWebView on macOS). Full narrative docs: [DESKTOP.md](../docs/DESKTOP.md) and [ACCOUNT-SYNC.md](../docs/ACCOUNT-SYNC.md).

### Where things live

| Path | What |
| --- | --- |
| [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) | identity `com.dotnetdreamer.openscreenshotgenerator`, `main` window (`visible:false`, `dragDropEnabled:false`), bundle targets |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | `mod` list, plugin registration, `.manage(...)` state, the single `invoke_handler![...]` list |
| [src-tauri/capabilities/default.json](../src-tauri/capabilities/default.json) | permissions + HTTP host allowlist for the `main` window |
| [src-tauri/capabilities/assistant.json](../src-tauri/capabilities/assistant.json) | `assistant-*` windows: `core:event:allow-emit` only, restricted by `remote.urls` |
| [src-tauri/src/oauth.rs](../src-tauri/src/oauth.rs) | one-shot loopback listener for desktop OAuth (`abs_oauth_start` / `abs_oauth_await` / `abs_oauth_cancel`) |
| [src-tauri/src/migrate.rs](../src-tauri/src/migrate.rs) | pre-rename identifier dir move, runs *before* `tauri::Builder`, do not move it into `setup` |
| [src-tauri/src/settings.rs](../src-tauri/src/settings.rs) | `AppSettings { show_assistant_window, mcp_server_enabled, devtools_open }` in `app_config_dir()/settings.json`, plus the native menu bar |
| [src-tauri/src/splash.rs](../src-tauri/src/splash.rs) | builds the `splashscreen` window in Rust (never declare it in `tauri.conf.json`) and reveals `main` on `abs_app_ready`, or after 12s regardless |
| [src/lib/desktop.ts](../src/lib/desktop.ts) | `isTauri()`, save/open helpers, `openExternal()`, `signalAppReady()` |
| [src/lib/account/](../src/lib/account) | BYOS layer: `types.ts`, `store.ts`, `transport.ts`, `projectBundle.ts`, `providers/googleDrive.ts`, `providers/github.ts`, `index.ts` |
| [workers/github-oauth/src/index.js](../workers/github-oauth/src/index.js) | the only server we deploy: holds the GitHub client secret and does the code-for-token swap, stores nothing |

### Build and run

```sh
npm run tauri:dev     # build:assistant-agent, then tauri dev on :9002
npm run tauri:build   # release bundles in src-tauri/target/release/bundle/
```

- `cargo` resolves from `%USERPROFILE%\.cargo\bin`, which is on the user PATH (the workspace `.vscode/settings.json` also appends it for VS Code terminals). `tauri` is *not* a global binary: always go through `npm run tauri` / `npx tauri`.
- `src-tauri/assistant/agent.js` is generated by `npm run build:assistant-agent` and is `include_str!`-baked into the exe at **compile** time ([web_session.rs](../src-tauri/src/web_session.rs) `AGENT_JS`). Editing `webAssistantAgent.ts` / `webDriverCore.ts` / `webAdapters.ts` needs a rebuild *and* relaunch; a running instance never picks it up. It is listed in [.taurignore](../src-tauri/.taurignore), so regenerating it does not restart `tauri dev`.
- **Never set `NEXT_PUBLIC_BASE_PATH` for a desktop build.** That is only for the GitHub Pages deploy; with it set every asset in the bundle 404s.
- Version lives in four files that must agree (`tauri.conf.json`, `package.json`, `Cargo.toml`, `Cargo.lock`). Use `node scripts/set-version.mjs patch|minor|major|<exact>` (`--dry-run` computes the next version without writing), never hand-edit.
- Releases are manual only: Actions > "Release desktop app (Tauri)" > Run workflow. The workflow has `workflow_dispatch` and nothing else, so nothing builds on push or tag. Store overlays are `--config src-tauri/tauri.microsoftstore.conf.json` / `tauri.appstore.conf.json`.

### Web vs desktop split

`isTauri()` is `'__TAURI_INTERNALS__' in window`, so it is **false during SSR and during the first client render**. Any component that renders differently on desktop must gate on a `mounted` state flag as well or hydration mismatches: see `if (!mounted || !isTauri()) return null;` in [McpServerStatus.tsx](../src/components/open-screenshot-generator/McpServerStatus.tsx).

Always `await import('@tauri-apps/...')` inside the branch, never a top-level import, or the web bundle pulls the plugin in at module-evaluation time.

Desktop-only: native save/open dialogs, folder-target multi-file export, `tauri-plugin-http` (CORS-free fetch), the local MCP server, the embedded-webview "use my account" AI mode, the free/local AI providers, the loopback OAuth flow.

**WKWebView on macOS ignores `<a download>`.** Every new export or download path must go through `saveBlobToDisk` / `saveDataUrlToDisk` from [desktop.ts](../src/lib/desktop.ts), or, for a multi-file export, `pickExportDirectory()` followed by `saveBlobToPath` / `saveDataUrlToPath` (that dialog's `recursive: true` is what widens the runtime fs scope enough for the writes that follow). Likewise external links: WebViews ignore `target="_blank"`, use `openExternal()`.

### Tauri permissions (this bites every time)

Nothing is allowed by default. Two edits are required for most new native work:

1. A new `#[tauri::command]` must be added to the `tauri::generate_handler![...]` list in [lib.rs](../src-tauri/src/lib.rs), or `invoke()` fails at runtime with an unknown-command error. A new Rust file also needs its `mod` line at the top of the same file.
2. A new outbound host reached through `tauri-plugin-http` must be added to the `http:default` `allow` array in [capabilities/default.json](../src-tauri/capabilities/default.json). The current list is `text.pollinations.ai`, `localhost:*`/`127.0.0.1:*`, `oauth2.googleapis.com`, `openidconnect.googleapis.com`, `www.googleapis.com`, `github.com`, `api.github.com`, `gist.githubusercontent.com`, `api.appstoreconnect.apple.com`, `*.apple.com`, `androidpublisher.googleapis.com`. A host not listed fails with a permission error, not a network error, which reads misleadingly. The `*.apple.com` wildcard is load-bearing, not lazy: App Store Connect hands back pre-signed upload URLs on Apple storage hosts that are not the API host.

Adding an AI provider window means four edits, not one: its origin in `remote.urls` in [capabilities/assistant.json](../src-tauri/capabilities/assistant.json), an entry in `PROVIDERS` in `web_session.rs`, an adapter in `WEB_ADAPTERS` plus its member in the `WebProviderId` union in [webAdapters.ts](../src/lib/ai/webAdapters.ts), and a rebuild of the agent bundle (it is compiled into the exe).

Custom commands are invocable from any app window including the splash; `plugin:event|listen` is capability-gated to `main`. `public/splash.html` has no capability entry, so it gets no plugin or core-event permissions, and it must stay fully self-contained (inline CSS and SVG, system fonts, no network).

### Account sync (BYOS)

Two providers implement `CloudProvider` from [types.ts](../src/lib/account/types.ts) and are registered in `CLOUD_PROVIDERS` in [index.ts](../src/lib/account/index.ts). The save/load/list/delete paths in `index.ts` never branch on which provider is connected; the sign-in UI ([AccountDialog.tsx](../src/components/open-screenshot-generator/account/AccountDialog.tsx)) does, for the GitHub-only PAT field and device-code panel, and it reads `isConfigured()` / `configHint` / `supportsMedia` off the provider.

| | `google` (Drive) | `github` (gists) |
| --- | --- | --- |
| `supportsMedia` | `true` | `false` |
| Layout | `Open Screenshot Generator/<name>/project.json` + `media__<mediaId>` files | one **secret** gist, description tagged `[open-screenshot-generator]#<projectId>` |
| Scope | `drive.file` plus `openid email profile` (stay non-sensitive, do not widen to `drive`) | `gist` |
| Web auth | Google Identity Services token client, no refresh token | popup via the Cloudflare Worker; a pasted PAT always works too, and is the only option when `NEXT_PUBLIC_GITHUB_OAUTH_PROXY` is unset |
| Desktop auth | loopback + PKCE in the system browser under `NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID` **and** `..._SECRET` (Google requires the installed-app secret in the exchange even with PKCE), returns a refresh token | GitHub **device flow**, no secret, no Worker |

Desktop signs in differently because of **origin**, not engine: a packaged app is served from `tauri://localhost`, which Google will not accept as a JavaScript origin. `runLoopbackFlow()` in [transport.ts](../src/lib/account/transport.ts) binds the Rust port *first*, then opens the browser, so there is no redirect race; the `finally` always calls `abs_oauth_cancel`.

`AccountSession` (`provider`, `account`, `accessToken`, optional `refreshToken` / `expiresAt`) is stored **unencrypted** in `localStorage` under `open-screenshot-generator.account` by [store.ts](../src/lib/account/store.ts). Reads go through `readWithLegacyFallback` and clears through `removeWithLegacy` ([legacyStorage.ts](../src/lib/legacyStorage.ts)) so the pre-rename `artboard-studio.account` key migrates on first read; a plain `removeItem` on the new key would let the legacy value come back. Only public client ids are compiled in, plus one deliberate exception: the desktop build carries the Google **Desktop-app** client secret, because Google's token endpoint rejects the installed-app exchange without it. That value is public by construction (it ships in every binary, as Google's own docs expect) and is not interchangeable with the Web client's secret, which must never be compiled in. `AccountAuthError` clears the stored session, `AccountCancelledError` is a user backing out and must not be toasted as a failure.

### Project bundle format

`ProjectBundle = { manifest: ProjectManifest, media: BundledMedia[] }`, built by `serializeProject()` in [projectBundle.ts](../src/lib/account/projectBundle.ts). The historical bug this exists to fix: **screen recordings live in the separate Dexie `media` table and elements reference them by id**, so saving the project row alone shipped dead video elements. `collectMediaIds()` walks every element for `mediaId` and the legacy `screenVideoMediaId` generically, on purpose, do not narrow it to a type check.

- Drive save writes `project.json` plus one file per blob, skips blobs already uploaded by id, and deletes `media__*` files the project no longer references.
- Local single-file `.json` export goes through `bundleToJson()` (blobs base64-inlined, no zip dependency); import goes through `bundleFromJson()`, which still accepts the pre-bundle `{ id, timestamp, projectData }` shape.
- GitHub **refuses** a bundle with `bundle.media.length` and points at Drive. Do not "fix" that by dropping the blobs.
- `importBundle()` restores blobs under their original ids and keeps an existing same-id row rather than rewriting a large blob.

### Testing without disturbing a running `tauri dev`

The user usually has one running; it holds port 9002 and `target/debug/*.exe`, and it rebuilds and relaunches when you touch Rust. Never kill their processes.

- Build to a scratch `CARGO_TARGET_DIR` and run `npx tauri dev --no-watch --config <json>` with `beforeDevCommand: ""` and `devUrl: http://localhost:9002` to reuse their dev server.
- Set `WEBVIEW2_USER_DATA_FOLDER` to a scratch dir. Both instances otherwise share one WebView2 profile under `%LOCALAPPDATA%\com.dotnetdreamer.openscreenshotgenerator\EBWebView` and `WebviewWindowBuilder::build()` fails intermittently.
- **Enumerate processes by PID or `ExecutablePath`, not process name.** Both instances share an exe name, and name matching silently measures the user's window instead. Stopping the `npx tauri dev` wrapper does not kill the exe it spawned, and the survivor then blocks the next build with an access-denied file lock.
- `settings.json` is **shared** with the user's real install (`app_config_dir`, on Windows `%APPDATA%\com.dotnetdreamer.openscreenshotgenerator\settings.json`, read once at startup), so a scratch instance inherits their `showAssistantWindow` / `mcpServerEnabled`. Back up, flip, test, restore.
- Headless harness: launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<free high port>`; all webviews appear on one CDP endpoint. Check the port is actually free first, match the main target by URL excluding `splash.html`, and filter `type === 'page'`.

---

## Direct-to-store upload (desktop only)

Hands rendered artboards to App Store Connect and Google Play with the user's own developer
credentials. No server of ours is involved, matching the account layer's stance. User-facing setup
guide: [docs/STORE-UPLOAD.md](../docs/STORE-UPLOAD.md).

### Where things live

| Path | What |
| --- | --- |
| [src/lib/publish/types.ts](../src/lib/publish/types.ts) | `StoreId`, credential shapes, `PublishImage`, `PublishProgress`, `StoreAuthError` / `StoreRejectedError` |
| [jwt.ts](../src/lib/publish/jwt.ts) | ES256 (Apple) and RS256 (Google) JWT signing over WebCrypto, one PKCS#8 PEM parser for both |
| [md5.ts](../src/lib/publish/md5.ts) | RFC 1321 MD5. Apple's commit needs one and WebCrypto does not implement it |
| [storeTargets.ts](../src/lib/publish/storeTargets.ts) | `APPLE_DISPLAY_TARGETS` (size -> ScreenshotDisplayType), `PLAY_IMAGE_TARGETS`, `validatePlayImage` |
| [appStoreConnect.ts](../src/lib/publish/appStoreConnect.ts) | app/version/localization listing, set creation, reserve + chunk PUT + commit, delivery polling |
| [googlePlay.ts](../src/lib/publish/googlePlay.ts) | service-account token, edit lifecycle, image upload, validate/commit |
| [credentials.ts](../src/lib/publish/credentials.ts) | localStorage store + `useStoreCredentials()`, key `open-screenshot-generator.store-credentials` |
| [PublishDialog.tsx](../src/components/open-screenshot-generator/publish/PublishDialog.tsx) | the whole UI; [StoreCredentialsForms.tsx](../src/components/open-screenshot-generator/publish/StoreCredentialsForms.tsx) holds the two key forms |
| `handlePublishCapture` in the layout | renders the chosen boards to bytes, with the same in-memory format conversion as the export |

There is deliberately **no provider abstraction** (unlike `CLOUD_PROVIDERS` in the account layer):
Apple needs app + version + locale + a per-size set, Play needs package + language + one slot, and
forcing a common interface over that only hides the difference.

### Apple's asset upload, which is not guessable

1. `POST /v1/appScreenshots` with `fileSize` + `fileName` **reserves** the asset and returns
   `uploadOperations`: chunk instructions, each with its own `method`, `url`, `offset`, `length`,
   `requestHeaders`.
2. Each chunk is PUT to **Apple's URL, not the API host**, with the operation's headers and **no
   Authorization header** (those URLs are pre-signed). This is why `capabilities/default.json`
   needs `*.apple.com`, not just `api.appstoreconnect.apple.com`.
3. `PATCH /v1/appScreenshots/{id}` with `uploaded: true` and `sourceFileChecksum` (MD5 hex of the
   exact bytes) is what makes the upload count.
4. Apple then processes the asset **asynchronously**. Every call above returns 2xx for a wrong-sized
   image; it fails minutes later as `assetDeliveryState.state = FAILED`. `waitForDelivery` polls for
   this and turns it into warnings, which is the only reason the dialog can be trusted when it says
   the upload worked.

Screenshots hang off a set scoped to (version localization, display type), so a mixed project is
grouped by resolved display type and each group gets its own set, created if absent. Order inside a
set is not implied by upload order, so it is stated with a `PATCH .../relationships/appScreenshots`;
that failing is cosmetic and downgrades to a warning.

### Play's edit transaction

`POST .../edits` opens a staged transaction, images are uploaded into
`listings/{language}/{imageType}` at the `/upload/` base with `uploadType=media`, then `:validate`
and `:commit`. Nothing is public until the commit and a thrown error discards the edit, so a failed
run cannot leave a half-updated listing. Some accounts refuse automatic review submission and say so
in the commit error; the client retries with `changesNotSentForReview=true` and reports that it did.

### Traps

- **Desktop only, and not as a product decision.** `api.appstoreconnect.apple.com` sends no CORS
  headers, so a browser tab cannot call it at all. Everything goes through `bridgeFetch()` from
  [account/transport.ts](../src/lib/account/transport.ts), whose Tauri branch is `tauri-plugin-http`.
  `isStorePublishingAvailable()` is `isTauri()`, and the dialog explains itself on the web build.
- **`fields[]` on appStoreVersions is a trap.** Apple renamed `appStoreState` to `appVersionState`;
  asking for a field the account's API version does not know is a 400. The client requests no
  `fields[]` there and reads whichever attribute comes back.
- **`EDITABLE_VERSION_STATES` is narrower than fastlane's edit-version filter on purpose.** Fastlane
  includes `WAITING_FOR_REVIEW` because it answers "which version am I working on"; screenshots are
  frozen the moment a version is submitted, so writing to one comes back 409. Non-editable versions
  are listed but disabled, nothing is preselected (a `?? list[0]` fallback would arm Upload against a
  frozen version), and the dialog explains that the version has to leave review first. Play has no
  equivalent lock: its listing is one live document and the change queues for review.
- **A 401 and a 403 from Apple are indistinguishable in practice** (bad key vs a key without the App
  Manager role), so one message covers both. Do not "improve" it into a guess.
- **Play 403 is almost always setup, not code**: the service account was never invited in Play
  Console, or the Android Developer API is not enabled. Play 404 means a package typo or an app that
  has never been published, since Play refuses API edits before the first release.
- **Play's size rule blocks the iPhone canvas.** Every side 320 to 3840 px, long side at most twice
  the short side, 8 MB max. 1290x2796 is 2.17:1 and Play rejects it, so the dialog flags the board
  and the Size dropdown converts to 1080x1920. That rule is Google's, verified in their docs, not a
  guess to relax.
- **Credentials are localStorage, unencrypted**, like the AI keys and the account session. The key is
  new, so unlike the three keys in `legacyStorage.ts` it needs no `readWithLegacyFallback`. The
  dialog copy says where the keys live without using the word "unencrypted"; that detail stays in
  [docs/STORE-UPLOAD.md](../docs/STORE-UPLOAD.md).
- **The key file is read with a plain `<input type="file">`, never the fs plugin.** `readTextFile` is
  gated by `fs:allow-read-text-file`, which the capability does NOT grant (it has
  `fs:allow-read-file`, a *different* permission), and the denial surfaces as a file-read error, so
  it reads like a broken picker. A file input needs no permission, no Rust rebuild to change, and
  behaves the same in the browser. The screenshot uploader already works this way. Rule 13 in
  [AGENTS.md](AGENTS.md) in its purest form: this cost a real bug report.
- **The capture goes through the layout, not the dialog**, because only the layout can reach the
  live canvas DOM and swap converted boards in. `handlePublishCapture` uses a raw `setArtboards`
  and restores in a `finally`, exactly like `handleConfirmExport`, so history and the saved project
  stay clean.

---

## House rules: build, verify, UI conventions

### Repo layout at a glance

| Path | What lives there |
| --- | --- |
| [src/](../src/) | The Next.js 15 editor. One route ([src/app/page.tsx](../src/app/page.tsx)) mounting [src/components/open-screenshot-generator/](../src/components/open-screenshot-generator/). Also `src/lib/`, `src/services/`, `src/types/`, `src/hooks/`, `src/contexts/`, [src/database.ts](../src/database.ts) (Dexie) |
| [src/ai/](../src/ai/) | Genkit scaffolding only, no flows wired up. The real AI agent is [src/lib/ai/](../src/lib/ai/) and runs client side. Do not add agent code here |
| [public/](../public/) | Templates in [public/data/projects/](../public/data/projects/), generated [public/data/ai/catalog.txt](../public/data/ai/catalog.txt), element art in `public/elements/`, `public/CNAME` (editor.openscrgen.app) |
| [src-tauri/](../src-tauri/) | Rust desktop shell. `tauri.conf.json` `beforeDevCommand` runs `npm run build:assistant-agent && npm run dev`, `beforeBuildCommand` runs `npm run build:assistant-agent && npm run build`, `frontendDist` is `../out` |
| [extension/](../extension/) | MV3 companion extension, esbuild bundled to `extension/dist` (gitignored). Excluded from root `tsconfig.json` |
| [website/](../website/) | Static marketing site for openscrgen.app. No build step, no deps, Vercel root dir `website` |
| [promo/](../promo/) | Remotion promo videos. Separate `package.json` and `node_modules`, run `npm install` inside `promo/` |
| [workers/github-oauth/](../workers/github-oauth/) | Cloudflare Worker doing the GitHub OAuth token exchange for the web build |
| [scripts/](../scripts/) | [gen-ai-catalog.mjs](../scripts/gen-ai-catalog.mjs), [set-version.mjs](../scripts/set-version.mjs) |
| `out/` | `next build` static export output (gitignored) |

### Command table

| Command | Effect | Run after |
| --- | --- | --- |
| `npm run dev` | `next dev --turbopack -p 9002`. Always port 9002, Tauri's `devUrl` hardcodes it | any editor change |
| `npm run typecheck` | `tsc --noEmit` | every TS/TSX change, this is the real safety net |
| `npm run build` | `node scripts/gen-ai-catalog.mjs && next build` into `out/` | before a Tauri build or a Pages deploy |
| `npm run gen:ai-catalog` | Regenerates `public/data/ai/catalog.txt` | after adding/editing anything in `public/data/projects/`, `src/lib/templateCategories.ts`, or the serializers in `src/lib/ai/hostedCatalog.ts` |
| `npm run build:extension` | esbuild bundles an explicit list of entry points under `extension/src/` (background, bridge, and each adapter) to `extension/dist`. A new adapter file must be added to the script in `package.json` or it is never bundled | after editing `extension/src/` |
| `npm run build:assistant-agent` | esbuild bundles [src/lib/ai/webAssistantAgent.ts](../src/lib/ai/webAssistantAgent.ts) to `src-tauri/assistant/agent.js` | after editing `webAssistantAgent.ts`, `webAdapters.ts`, or `webDriverCore.ts` |
| `npm run tauri:dev` / `npm run tauri:build` | assistant-agent bundle, then `tauri dev` / `tauri build` | desktop shell work |
| `npm start` | **Not a production server.** It just re-runs `npm run dev`. There is no production server at all: `output: 'export'` makes `next start` refuse to run ("next start" does not work with "output: export" configuration). To serve a real build, `npm run build` then serve `out/` statically, e.g. `npx serve@latest out` | never, basically |

### Verification traps

- **`npm run typecheck` has pre-existing failures. Do not chase them.** Known bad files: [promo/src/scenes/McpZoomScene.tsx](../promo/src/scenes/McpZoomScene.tsx), [promo/src/scenes/McpZoomSceneMobile.tsx](../promo/src/scenes/McpZoomSceneMobile.tsx), [promo/src/steps/Focus.tsx](../promo/src/steps/Focus.tsx) (duplicate `csstype` between root and `promo/node_modules`, since root `tsconfig.json` excludes only `node_modules` and `extension`, so `promo/src` gets type checked against the wrong React types), and [src/lib/fontLanguageMatcher.ts](../src/lib/fontLanguageMatcher.ts) line 1 (`GoogleFont` is not exported by [src/services/fontService.ts](../src/services/fontService.ts)). Diff the error list against this set, only new entries are yours.
- **`npm run lint` does not work out of the box.** There is no ESLint config and `eslint` is not in `node_modules`, so `next lint` drops into an interactive "How would you like to configure ESLint?" prompt and hangs a non-interactive agent. [CONTRIBUTING.md](../CONTRIBUTING.md) still lists it in the PR checklist, which is stale. Do not run it unattended, and do not "fix" it by accepting the prompt.
- [next.config.ts](../next.config.ts) sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`. A green `npm run build` proves nothing about types.
- There is no test suite. Verification is `typecheck` plus clicking through the flow in the running app (the `app-screenshots` skill drives it headlessly).
- [scripts/gen-ai-catalog.mjs](../scripts/gen-ai-catalog.mjs) must stay in lockstep with [src/services/projectService.ts](../src/services/projectService.ts): both walk `TEMPLATE_CATEGORIES` in the same order with the same filename-derived ids and fallbacks, and the client rebuilds the catalog in the browser to check the expected `VERIFICATION-TOKEN`. Any drift makes the app silently fall back to inline prompts rather than fail loudly.

### UI conventions

- shadcn/ui on Radix, config in [components.json](../components.json): style `default`, base color `neutral`, CSS variables on, alias `@/components/ui`, icon library `lucide`. The 33 files in [src/components/ui/](../src/components/ui/) (`accordion`, `alert-dialog`, `button`, `dialog`, `menubar`, `scroll-area`, `select`, `sidebar`, `tabs`, `toast`, `tooltip`, and so on) are generated primitives: prefer composing them over editing them, and never hand-write a new primitive that shadcn already ships.
- Icons: `lucide-react` only (38 files import it). No other icon package is installed.
- Class merging goes through `cn()` in [src/lib/utils.ts](../src/lib/utils.ts) (`twMerge(clsx(...))`).
- **Use the semantic tokens, not raw colors.** Defined in [src/app/globals.css](../src/app/globals.css) and mapped in [tailwind.config.ts](../tailwind.config.ts): `background`, `foreground`, `card`, `popover`, `primary` (slate blue `#5F9EA0`), `secondary`, `muted`, `accent` (warm gold `#D4AF37`), `destructive`, `border`, `input`, `ring`, `chart-1..5`, and the `sidebar-*` family. Radii come from `--radius: 0.5rem` via `rounded-lg/md/sm`. Palette rationale is [docs/blueprint.md](../docs/blueprint.md).
- **Dark mode is configured but never activated.** `darkMode: ["class"]` and a full `.dark` block exist, but nothing in `src/` ever adds `dark` to `<html>`, and there is no theme provider. Only 11 `dark:` variants exist in the codebase. Treat the app as light only unless you are deliberately building the toggle.
- Tailwind `content` globs include `./src/lib/**` on purpose: catalog data such as `templateCategories.ts` ships literal class strings (`gridClassName`) that would otherwise be purged. New directories that ship class strings need their own glob entry.
- [src/components/toolbar/ExportButton.jsx](../src/components/toolbar/ExportButton.jsx) is a 0-byte dead stub. Do not import it.

### globals.css bites back

[src/app/globals.css](../src/app/globals.css) applies Tailwind to bare element selectors, so these are global and unavoidable without an explicit override:

- `input { @apply p-2 rounded-md }`, `textarea { @apply p-2 rounded-md font-mono }`, `select { @apply p-2 rounded-md }`. Compact inputs need explicit padding resets, which is why `input[type="text"].h-7 { padding-top: 0; padding-bottom: 0 }` exists.
- `a { @apply text-primary no-underline }`, `table`/`thead`/`tbody tr:nth-child(even)` get colors and zebra stripes, `pre` gets `bg-gray-900`.
- `::-webkit-scrollbar { display: none }` hides every scrollbar app wide. To get a visible one back, add the `show-scrollbar` class (defined below that rule in the same file) to the scroll container.

### Known framework quirks that have already broken this repo

- **Radix `ScrollArea` under a `flex-1` or `max-h` parent silently stops scrolling.** Its viewport `h-full` cannot resolve against a max-height-capped ancestor. Use a native `<div className="min-h-0 flex-1 overflow-y-auto">` instead. See [LayersPanel.tsx](../src/components/open-screenshot-generator/LayersPanel.tsx) line 142 and [CanvasSizeDialog.tsx](../src/components/open-screenshot-generator/CanvasSizeDialog.tsx) line 165 for the in-repo precedent.
- **Never put a bare `flex` on Radix `TabsContent`.** Inactive panels stay mounted with the `hidden` attribute, and `display:flex` outranks `[hidden]{display:none}`, so every ghost panel leaks its margins as dead space. Use `className="... flex-col data-[state=active]:flex"`, as in [OpenScreenshotGeneratorLayout.tsx](../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx) line 2358.
- **Inactive tab panels are mounted, not unmounted.** Any DOM query, screenshot harness, or `querySelector` must scope itself to the active panel, or it will act on a hidden duplicate.
- **The Next app router drops inline `<script>` from the root layout during static export.** [src/app/layout.tsx](../src/app/layout.tsx) carries none. When you need pre-hydration script (the anti-flash gate), render it from a client component next to the markup it guards, the way [MobileNotice.tsx](../src/components/open-screenshot-generator/MobileNotice.tsx) does with `dangerouslySetInnerHTML`.
- **`next/image` and `<img>` do not apply `basePath` to a string `src`.** Keep stored paths canonical and wrap at render time with `withBasePath()` from [src/lib/basePath.ts](../src/lib/basePath.ts), or every `/elements/...` asset 404s on a sub-path deploy.
- **Anchor downloads do not work in WKWebView on macOS.** Every "save a file" path must go through `saveBlobToDisk()` / `saveDataUrlToDisk()` in [src/lib/desktop.ts](../src/lib/desktop.ts).

### Copy rules for user-visible strings

- **No em dashes and no en dashes anywhere a user can read them**: UI strings, README prose, website copy, commit-visible docs. The maintainer treats them as AI slop. Use a comma, a period, a colon, or the word "to". Codified in [CONTRIBUTING.md](../CONTRIBUTING.md) and [website/README.md](../website/README.md).
- No trailing period on short UI copy: headings, list items, buttons, and the last line of a marketing block. Sentences inside a multi-sentence paragraph keep theirs.
- `website/` additionally bans hyphenated compounds inside sentences ("store ready", not the hyphenated form). Hyphens in URLs, filenames, and code are fine.

### Analytics

- GA4, one property `G-8LQTR1SPDK` (the default, overridable with `NEXT_PUBLIC_GA_ID`) shared with the marketing site and split by hostname. Loader: [src/components/Analytics.tsx](../src/components/Analytics.tsx). Events: [src/lib/analytics.ts](../src/lib/analytics.ts).
- The gate is duplicated in both files and both copies must agree: skip when `__TAURI_INTERNALS__` is in `window` (desktop) and when hostname is `localhost`, `127.0.0.1`, or empty (dev). `Analytics.tsx` decides after mount so the static export does not hydrate-mismatch.
- Only coarse signals ship, via `track()` and the named wrappers `trackTemplateSelected`, `trackDeviceFormatSelected`, `trackExportPng`, `trackExportVideo`, `trackExportJson`. **Never send project content, screenshots, file names, text the user typed, API keys, or anything loaded from disk.** The product promise is that designs never leave the machine. `track()` no-ops silently when disabled, so call sites need no guard.

### Releasing

Version lives in four files and [scripts/set-version.mjs](../scripts/set-version.mjs) is the only sanctioned way to change it: `node scripts/set-version.mjs <major|minor|patch|X.Y.Z> [--dry-run]` reads the current version from `src-tauri/tauri.conf.json` and rewrites `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `open-screenshot-generator` entry in `src-tauri/Cargo.lock`, each by anchored single-line regex (never JSON reserialize, that reflows `tauri.conf.json`). It refuses to downgrade. Do not bump by hand. Releases are started manually from the "Release desktop app (Tauri)" workflow ([.github/workflows/desktop.yml](../.github/workflows/desktop.yml)), which does the bump, commit, tag, and publish. `NEXT_PUBLIC_BASE_PATH` must stay unset there and in [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), since both targets serve from a root.

---

## Build, deploy and satellite projects

### Deploys

- **Web.** [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) builds on every push to `main` and publishes `out/` to GitHub Pages at `editor.openscrgen.app` via [public/CNAME](../public/CNAME). `NEXT_PUBLIC_BASE_PATH` stays unset there on purpose (the custom domain serves from a root); it exists only for the `dotnetdreamer.github.io/open-screenshot-generator` sub-path deploy.
- **Desktop.** [.github/workflows/desktop.yml](../.github/workflows/desktop.yml) is `workflow_dispatch` only, never on push or tag. It does the version bump, commit, tag and publish itself.
- Every `NEXT_PUBLIC_*` value comes from repo **variables**, not secrets, and each workflow lists them separately. Adding a new public env var means editing **both** `deploy.yml` and `desktop.yml`, or it silently ships as an empty string in one of the two targets.
- The dev port **9002 is hard-coded** in more than one place: Tauri's `devUrl`, the companion extension's content-script matches, and the puppeteer harness scripts. Do not move it.

### Satellite toolchains

A root `npm install` only covers the Next app. Five sibling projects live in this repo with their own `package.json` and `node_modules`, and none are built, linted or CI-checked by the root scripts:

| Path | Toolchain | Notes |
| --- | --- | --- |
| [promo/](../promo/) | Remotion promo videos | `render`, `render:fast`, `render:mobile`, `render:ai`, `render:steps`, `gen:music`. **Not** excluded from the root tsconfig, so its type errors surface in root `npm run typecheck` |
| [website/](../website/) | Marketing site for openscrgen.app | Plain static HTML/CSS/JS, no build step, Vercel with [website/vercel.json](../website/vercel.json). Independent of the editor's Pages deploy |
| [workers/github-oauth/](../workers/github-oauth/) | Cloudflare Worker | Deployed by hand: `wrangler deploy` plus `wrangler secret put GITHUB_CLIENT_SECRET`. Wired in through `NEXT_PUBLIC_GITHUB_OAUTH_PROXY` |
| [extension/](../extension/) | MV3 companion extension | Built from the root with `npm run build:extension` into the gitignored `extension/dist/`. Excluded from the root tsconfig, carries its own `chrome.d.ts` |
| [.claude/skills/app-screenshots/scripts/](../.claude/skills/app-screenshots/scripts/) | puppeteer-core harness | Needs a one-time `npm install` inside that folder |

### Dexie schema changes

[src/database.ts](../src/database.ts) is at `version(3)`. Adding a table or an index means appending a **new** `this.version(n).stores({...})` block that restates every existing table. Never edit an existing version block: Dexie replays them in order and an edited block corrupts upgrades for anyone already on that version. Never put large blobs on the project row either, recordings go in the `media` table through [mediaStore.ts](../src/lib/mediaStore.ts) and are referenced by id.

### Dead scaffold, do not build on it

The repo started from a Firebase Studio template and the husk was never removed. None of the following is wired into anything:

- [src/ai/genkit.ts](../src/ai/genkit.ts) and [src/ai/dev.ts](../src/ai/dev.ts), with the `genkit:dev` / `genkit:watch` scripts. Nothing imports them, and a static export cannot run Genkit at all. All real model work goes through [src/lib/ai/](../src/lib/ai/)
- The `firebase`, `@genkit-ai/*`, `@tanstack/react-query` and `@tanstack-query-firebase/react` dependencies: zero usages in `src/`
- [src/components/toolbar/ExportButton.jsx](../src/components/toolbar/ExportButton.jsx), a tracked 0-byte file
- [docs/blueprint.md](../docs/blueprint.md), the original generation prompt. Its stated color palette is not what the app actually uses, so do not treat it as a spec
