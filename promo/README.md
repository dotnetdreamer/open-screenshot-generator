# Open Screenshot Generator promo video

A product promo built with [Remotion](https://www.remotion.dev/), three.js and GSAP. Three cuts from the same scenes:

- `Promo` — the full 52-second cut (`out/open-screenshot-generator-promo.mp4`), 1920x1080
- `PromoFast` — a tighter 36-second cut (`out/open-screenshot-generator-promo-fast.mp4`), 1920x1080
- `PromoMobile` — a portrait 36-second cut for phones, Shorts and Reels (`out/open-screenshot-generator-promo-mobile.mp4`), 1080x1920
- `PromoAI` — a 10-second cut on the AI features (`out/open-screenshot-generator-promo-ai.mp4`), 1920x1080: the AI agent dialog and the desktop MCP server, shown screen-recording style with an animated cursor and camera zooms onto the UI
- `PromoAIMobile` — the same 10-second AI cut in portrait for phones, Shorts and Reels (`out/open-screenshot-generator-promo-ai-mobile.mp4`), 1080x1920: deeper zooms since the wide dialog does not fit a phone frame, captions raised above the Shorts UI overlay
- `PromoVs` — the 58-second "old way vs new way" hero cut for the top of openscrgen.app (`out/open-screenshot-generator-promo-vs.mp4`), 1920x1080
- `PromoVsMobile` — the same 58-second edit in portrait (`out/open-screenshot-generator-promo-vs-mobile.mp4`), 1080x1920. One implementation, not two: every scene reads `useVideoConfig()` and reflows
- `PromoSteps` — a 30-second portrait cut (`out/open-screenshot-generator-promo-steps.mp4`), 1080x1920, walking the three steps to store-ready screenshots: pick a template, drop in your screenshot, preview. Its own visual system under `src/steps/` (not shared with the other cuts): a GLSL aurora + drifting-motes three.js backdrop whose palette and energy pulse follow the step beats, deep camera dives with a touch-ripple pointer and a spotlight highlight over the real UI, and its own music bed (`music-steps.m4a`)

All are 30 fps with an original synthesized music bed.

## Commands

```bash
cd promo
npm install
npm run studio         # open Remotion Studio to preview and scrub the timeline
npm run render         # render the full cut
npm run render:fast    # render the fast cut
npm run render:mobile  # render the portrait cut
npm run render:ai      # render the 10-second AI cut
npm run render:ai-mobile  # render the portrait 10-second AI cut
npm run render:steps   # render the 30-second portrait 3-steps cut
npm run render:vs         # render the 58-second landscape hero cut
npm run render:vs-mobile  # render the 58-second portrait hero cut
npm run capture:vs        # re-capture and re-crop the app footage the hero cut uses
npm run gen:music-vs      # regenerate public/music-vs.wav (then convert to music-vs.m4a with ffmpeg)
npm run gen:music      # regenerate public/music.wav (then convert to music.m4a with ffmpeg)
npm run gen:music-steps  # regenerate public/music-steps.wav (then convert to music-steps.m4a with ffmpeg)
```

## How it is put together

- `src/Promo.tsx` holds the timelines (FULL, FAST and MOBILE) over shared scenes; each scene is a `Sequence` with a crossfade overlap, wrapped by `components/Scene.tsx`. The music `<Audio>` fades in and out based on the composition length.
- The mobile cut (1080x1920) reuses the centered scenes (Intro, LocalScene, Outro) unchanged and swaps in `*Mobile.tsx` portrait layouts for the rest: copy on top, visual below. `Devices3D` takes `layout="tall"` to restack the phones for the narrow canvas.
- `src/theme.ts` has the brand tokens (teal `#6FB3B5` / deep teal `#457E80` / gold `#D4AF37` from `public/logo.svg`) and loads Space Grotesk + Inter via `@remotion/google-fonts` (network needed at render time).
- **three.js**: `components/Devices3D.tsx` is a real 3D scene (`@remotion/three`), lit rotating phone models with the skeleton screenshots as screen textures. The backdrop behind every scene is also three.js: `components/WaveField3D.tsx`, a rolling ocean of glowing dots displaced by layered sine waves in a custom vertex shader (teal by height, rare gold crests, distance fade), plus the `components/Particles3D.tsx` dust field, both inside one canvas with a slow scene sway. All motion derives from the frame number, so renders are deterministic. `remotion.config.ts` sets the OpenGL renderer to `angle`; the default software renderer hangs on WebGL.
- **GSAP**: the intro wordmark letters (back.out overshoot) and the outro URL pill (elastic pop) are GSAP timelines, paused and scrubbed to the current frame so rendering stays deterministic.
- **Music**: `scripts/gen-music.js` synthesizes the track from scratch in Node (88 BPM, Am7/Fmaj7/Cmaj7/G pad, sidechained kick, hats, FM-pluck arp through a ping-pong delay). It is original output, so there is nothing to license.
- `components/Logo.tsx` rebuilds the app icon as animatable parts; `SelectionFrame.tsx` is the gold-handles/marching-ants motif around screenshots.
- `public/` holds the assets: fresh 2x editor screenshots (captured headlessly via `.claude/skills/app-screenshots`), `shots/agent-dialog.png` (a 2830x1410 ffmpeg crop of the agent dialog), template preview strips, and skeleton screens.

## Conventions and gotchas

- On-screen copy avoids em/en dashes and does not end sentences with periods.
- `npx remotion still` is flaky with the WebGL scenes (occasional empty canvas or seek timeout); video renders are reliable. Verify with short segment renders (`--frames=a-b`) instead of stills.
- To refresh the editor screenshots after UI changes, re-run the capture flow from the app-screenshots skill and replace the files in `public/shots/`.

## The 3-steps cut (`src/steps/`)

- Screenshots come from `scripts/capture-steps.js` (dev server on :9002 required): it drives the real app through the flow (start dialog with the Zenfit Yoga template first, open it, select the straight phone on Find Class, upload `public/steps/upload-screen.png` rendered from `scripts/fitness-screen.html`, open Preview) and writes `public/steps/01..05` at DPR2 plus `rects.json` with the UI bounding boxes. If you recapture, mirror the fresh `rects.json` numbers into `RECTS` in `src/steps/style.ts` — camera keyframes, taps and highlights all derive from them.
- `Cam.tsx` focuses scene points at a zoom with a handheld micro sway; `Tap.tsx` is the touch-ripple pointer; `Focus.tsx` dims everything but a target rect (plain divs on purpose — SVG mask/filter overlays rendered unreliably here).
- `Aurora.tsx` is the three.js backdrop: a domain-warped fbm silk shader on a fullscreen quad plus additive drifting motes; palette acts and an energy pulse are keyed to the step beats in `style.ts` (`BEATS`/`ACTS`), which line up with the risers in `scripts/gen-music-steps.js` (104 BPM, D minor, risers at 2.5s/11s/20.5s).
- Music: `npm run gen:music-steps`, then `ffmpeg -i public/music-steps.wav -c:a aac -b:a 192k public/music-steps.m4a`.

## The hero cut (`src/vs/`)

The film at the top of the marketing site. Two acts: an "old way" montage graded
grey (a design tool being nudged by hand, the store size matrix, the language
grid, a rejection and a paywall) and a "new way" run of seven product beats
(templates, the editor canvas, one-pass export, 57 languages, preview videos,
the AI agent, and nothing leaving your machine).

- **One implementation, two aspects.** There are no `*Mobile.tsx` variants.
  `ui.tsx` exposes `useTall()` / `usePad()`, and each scene picks its stack
  direction and type scale from those. Portrait type is deliberately *larger*
  relative to the frame than landscape, not smaller.
- **The old act is drawn, not screenshotted.** Imitating a competitor's chrome
  would be both wrong and unnecessary; the gag is about the shape of the work.
- **The new act is all real output.** `public/vs/wall/*` are exported template
  previews, and the UI panels are crops of live captures. `scripts/capture-vs.js`
  (surfaces), `capture-vs2.js` (editor at fit zoom + the export dialog),
  `capture-vs3.js` (the Languages dialog) and `crop-vs.js` (the crop table)
  regenerate them against the dev server on :9002. Re-run `npm run capture:vs`
  after any UI change.
- **Capture gotchas.** The start dialog opens behind the Tips dialog and on the
  community feed, so the flow is: close *only* the tips dialog (both share a
  Close label, and closing twice dismisses the start dialog too), reopen from
  `button[title="Select Template"]` if needed, mouse-click the App Screenshots
  tab, then filter with the template search before clicking a card, because most
  cards sit below the fold. Zoom the canvas out before capturing the editor or
  the artboards come out cropped at 100%.
- **Timing.** `style.ts` `T` holds every scene boundary in frames. The music
  (`scripts/gen-music-vs.js`) is keyed to it: the turn lands at 22.2s, and the
  groove runs at 126.3158 BPM so a bar is exactly 1.90s and each 3.8s beat starts
  on a downbeat. Edit the two together.
- **No three.js in this cut**, by choice. It is a typographic motion-graphics
  piece, which renders fast, stays deterministic, and keeps both files near 17MB.
