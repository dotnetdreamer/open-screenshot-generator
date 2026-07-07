---
name: app-screenshots
description: Drive Artboard Studio headlessly (puppeteer-core + Edge) to take UI screenshots, add palette elements, upload device screenshots, export artboard PNGs, and regenerate the 3D device thumbnails. Use when asked to visually verify UI changes, capture the palette or canvas, test PNG exports, check rendering quality, or refresh public/elements/device-3d thumbs.
---

# App Screenshots & Browser Verification

Drives the real app in headless Edge to verify changes end-to-end: screenshots, element adds, screenshot uploads, PNG exports, and pixel-level quality checks.

## Prerequisites

- Dev server on **http://localhost:9002** — usually already running (`npm run dev`; `EADDRINUSE` means reuse it, Next.js hot-reloads your edits).
- Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` — headless Edge via puppeteer uses the **real GPU** (verified: ANGLE D3D11), so WebGL renders match what the user sees. No swiftshader flags needed.
- ffmpeg/ffprobe at `C:/ffmpeg-2026-02-04-git-627da1111c-essentials_build/bin/`.
- One-time: `cd .claude/skills/app-screenshots/scripts && npm install` (installs puppeteer-core).

## Golden rules (each one cost real debugging time — do not skip)

1. **Never use `page.screenshot({ clip })`.** Clipped captures briefly resize the emulated viewport, which trips the responsive sidebar breakpoint and **remounts the palette, wiping tab/drill-in state**. Always take full-page screenshots and crop afterwards with ffmpeg.
2. **Radix tabs ignore synthetic `.click()`** — switch tabs with a real mouse click at the trigger's bounding-box center (`page.mouse.click`). Plain buttons/tiles are fine with DOM `.click()` via `page.evaluate` (also bypasses overlays).
3. **`waitForFunction` needs `polling: 500`** — the default rAF polling starves on static headless pages. Prefer string-expression predicates (`"document.querySelectorAll(...).length > 3"`) over function+args.
4. **After clicking "Start Blank", wait for `?projectId=` in the URL** before interacting — project creation settles asynchronously.
5. **File uploads:** start `page.waitForFileChooser()` *before* clicking the app's "Upload Screenshot" button, then `chooser.accept([path])`.
6. **Exports:** set `Browser.setDownloadBehavior` (CDP) to a download dir, click the export button, poll the dir until the expected number of `.png` files appears, then wait ~3s for writes to finish.

## App selectors

- Start screen: button with exact text `Start Blank`.
- Tabs: `[role="tab"]` containing `Elements` / `Devices` / `Layers`.
- Palette categories: `button[title="Browse <Category>"]` (e.g. `Browse 3D iPhone 17 Pro Max`, `Browse Colored iPhone`, `Browse Basic`); close with the `Back` button.
- Tiles: `button[title="Add <label>"]` (e.g. `Add iPhone 17 Pro Max 3D — tilted right (black)`, `Add Transparent device`).
- Toolbar by `title` attr: `New Artboard` (new artboard becomes active), `Export Artboards as Images`, `Zoom In`, `Zoom Out`.
- Canvas elements: `[data-element-id]` (count them to detect adds).
- **Export dialog:** `Export Artboards as Images` opens the "Export Screenshots" dialog (it no longer downloads directly). Checkboxes by id: `#export-as-is` (checked by default), `#gen-ios`, `#gen-ipad-pro-13`, `#gen-ipad-11` (App Store sizes to generate; disabled when the current canvas already covers that format). Confirm with the dialog button whose text is `Export`. `lib.js exportArtboards` handles all of this and takes an optional `extraFormats` array of those ids.
- Exported files are named `<NN>_<Artboard_Name>[_<Device_Format>].png` with spaces → underscores; `NN` is the zero-padded canvas order and the device-format suffix (iPhone/Android/iPad_13-inch/iPad_11-inch/7-inch_tablet/10-inch_tablet) appears when the artboard's mockups resolve to one format (e.g. `01_Blank_Artboard.png`, `01_Blank_Artboard_iPhone.png`). Generated App Store formats download extra files per artboard (e.g. `01_Blank_Artboard_iPad_13-inch.png` at exactly 2064×2752).

## Scripts (in `scripts/`)

- `lib.js` — reusable helpers implementing all rules above: `launch`, `startBlankProject`, `clickTab`, `clickByText`, `clickByTitle`, `addTileAndCount`, `uploadScreenshotToSelected`, `exportArtboards`, `shot` (full-page only).
- `example-flow.js` — complete worked example: blank project → Devices tab → open a 3D category → add a tile → upload a screenshot → export → download. Run: `node example-flow.js`.
- `regen-3d-thumbs.js` — regenerates all 40 thumbnails in `public/elements/device-3d/` by bundling the real `Device3DRenderer` with esbuild and screenshotting each pose/side/finish at 640px with a transparent background. Run it whenever poses, finishes, or materials change in `Device3DRenderer.tsx`. Run from the repo root: `node .claude/skills/app-screenshots/scripts/regen-3d-thumbs.js`.
- `gen-app-skeletons.js` — regenerates the neutral **skeleton-screen library** in `public/data/projects/app-screens/` used to fill empty phone mockups in the App Screenshots templates (the full-height counterpart to `fg-screens/`, in the inboxly-screen-inbox.png visual language: soft grey blocks, one soft accent). Outputs 6 archetypes × {light,dark,eco} — `app-<list|feed|grid|player|dashboard|chat>-<light|dark|eco>.png` — at 846×1710 @ DPR2 (== the iphone-15 screen aspect, so `objectFit:cover` never crops). `light`/`dark` use an indigo accent; `eco` is the light greys with a soft green accent (for green/nature templates like verda-eco). Themes live in the `THEMES` map — add one there and it renders automatically. Edit the archetype builders / palettes, then rerun from repo root: `node .claude/skills/app-screenshots/scripts/gen-app-skeletons.js` (all) · `... eco` (one theme) · `... grid player` (archetypes) · `... grid-eco` (one key).
- `wire-app-skeletons.js` — assigns those skeletons to the App Screenshots templates. Holds the per-app `{theme, cycle}` MAP and surgically inserts `screenshotSrc` + natural dims after each device's `deviceType` line (every device already carries `screenshotObjectFit:"cover"` + a full `screenshotRect`), cycling archetypes so adjacent phones differ. Formatting-preserving and idempotent (skips templates already wired or holding real screenshots). `node wire-app-skeletons.js` (all mapped) · `... <slug ...>` (subset) · `... --report` (dry run). Feature-graphic (`fg-*`), connectly-chat, listly-tasks, inboxly-mail and darzi-studio are intentionally not in the MAP.
- `gen-previews.js` — generates the **card-thumbnail previews** for the App Screenshots gallery (the counterpart to the `fg-*` previews the feature-graphic tab already had). Per template: Pass A opens it and exports its artboards (clean, chrome-free), Pass B composes a wide **3:1 phone-carousel strip** on the template's own background and rewrites `previewImage` to `/data/projects/previews/<slug>.png`. Matches the App Screenshots category (`previewAspect '3 / 1'`, `previewFit 'contain'`; the gallery treats any non-`placehold.co` previewImage as a real strip and renders it `object-contain`). Needs the dev server up. `node gen-previews.js` (all 41) · `... <slug ...>` (subset) · `... --compose-only` (reuse cached exports in `%TEMP%/artboard-previews-src/`). Caps the strip at 6 screens.
- `compose-preview.js` — the strip compositor used by `gen-previews.js`: lays exported artboard PNGs as rounded, shadowed cards centered on a background at 1500×500 @ DPR2. `renderOnPage(page, dir, bgCss, out, max)` reuses one browser; CLI `node compose-preview.js <artboardDir> <bgCss> <outFile> [maxScreens]` for one-offs.

## Verifying image quality

- Crop 1:1 regions with ffmpeg and view them: `ffmpeg -i export.png -vf "crop=W:H:X:Y" out.png`.
- Zoom for pixel inspection: add `,scale=iw*3:ih*3:flags=neighbor`.
- Measure (e.g. prove a shadow/halo is gone — background must be pure 255):
  `ffmpeg -i export.png -vf "crop=10:10:X:Y,format=gray,signalstats,metadata=print:file=-" -frames:v 1 -f null -` then read `YMIN`/`YAVG`.
- Test screen for pixelation checks (gradient + 2px grid shows blur/aliasing immediately):
  `ffmpeg -f lavfi -i "gradients=s=1080x2400:c0=0x4F46E5:c1=0x06B6D4:x0=0:y0=0:x1=1080:y1=2400" -vf "drawgrid=w=120:h=120:t=2:color=white@0.55" -frames:v 1 screen-test.png`

## Workflow

1. Make code changes; the running dev server hot-reloads them.
2. Write a small driver on top of `lib.js` (or extend `example-flow.js`) for the flow under test.
3. Screenshot full pages, crop with ffmpeg, Read the crops to visually confirm.
4. For exports, always open the downloaded PNGs and check 1:1 crops — don't trust the on-screen look alone (exports take a different rendering path).
5. Put temp output in the session scratchpad; stage anything the user should review in `C:/Users/ik/Downloads/artboard-3d-verification/`.
