# Open Screenshot Generator promo video

A product promo built with [Remotion](https://www.remotion.dev/), three.js and GSAP. Three cuts from the same scenes:

- `Promo` — the full 52-second cut (`out/open-screenshot-generator-promo.mp4`), 1920x1080
- `PromoFast` — a tighter 36-second cut (`out/open-screenshot-generator-promo-fast.mp4`), 1920x1080
- `PromoMobile` — a portrait 36-second cut for phones, Shorts and Reels (`out/open-screenshot-generator-promo-mobile.mp4`), 1080x1920
- `PromoAI` — a 10-second cut on the AI features (`out/open-screenshot-generator-promo-ai.mp4`), 1920x1080: the AI agent dialog and the desktop MCP server, shown screen-recording style with an animated cursor and camera zooms onto the UI
- `PromoAIMobile` — the same 10-second AI cut in portrait for phones, Shorts and Reels (`out/open-screenshot-generator-promo-ai-mobile.mp4`), 1080x1920: deeper zooms since the wide dialog does not fit a phone frame, captions raised above the Shorts UI overlay
- `PromoFeatures` — the 92-second feature reel (`out/open-screenshot-generator-promo-features.mp4`), 1920x1080: one made-up app, Juniper, from an empty store page to its first reviews, in three chapters (make the screenshots, get the app out there, see how it is doing), on `intro.mp3` arranged to length. This is the cut to update when something ships
- `PromoVs` — the 58-second "old way vs new way" hero cut for the top of openscrgen.app (`out/open-screenshot-generator-promo-vs.mp4`), 1920x1080
- `PromoVsMobile` — the same 58-second edit in portrait (`out/open-screenshot-generator-promo-vs-mobile.mp4`), 1080x1920. One implementation, not two: every scene reads `useVideoConfig()` and reflows
- `PromoSteps` — a 30-second portrait cut (`out/open-screenshot-generator-promo-steps.mp4`), 1080x1920, walking the three steps to store-ready screenshots: pick a template, drop in your screenshot, preview. Its own visual system under `src/steps/` (not shared with the other cuts): a GLSL aurora + drifting-motes three.js backdrop whose palette and energy pulse follow the step beats, deep camera dives with a touch-ripple pointer and a spotlight highlight over the real UI, and its own music bed (`music-steps.m4a`)

- `PromoRack` — a 30-second 4:5 cut for X and Instagram (`out/open-screenshot-generator-promo-rack.mp4`), 1440x1800 at 60 fps: the eighteen features that are not about making screenshots, patched one by one into a modular synth rack, on `intro.mp3` cut to its beat. See [the rack cut](#the-rack-cut-srcrack)

All are 30 fps, except the rack cut at 60 fps. Most have an original synthesized music bed; the feature reel and the rack cut use the supplied `intro.mp3`.

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
npm run render:features   # render the 92-second feature reel
npm run music:features    # arrange public/intro.mp3 into public/music-features-intro.m4a
npm run rects:features    # compile public/features2/*/rects.json for the film's cameras
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
  the toolbar + if needed (`button[aria-label="Create"]`, then
  `button[aria-label="Start from a template"]`), mouse-click the App Screenshots
  tab, then filter with the template search before clicking a card, because most
  cards sit below the fold. Zoom the canvas out before capturing the editor or
  the artboards come out cropped at 100%.
- **Timing.** `style.ts` `T` holds every scene boundary in frames. The music
  (`scripts/gen-music-vs.js`) is keyed to it: the turn lands at 22.2s, and the
  groove runs at 126.3158 BPM so a bar is exactly 1.90s and each 3.8s beat starts
  on a downbeat. Edit the two together.
- **No three.js in this cut**, by choice. It is a typographic motion-graphics
  piece, which renders fast, stays deterministic, and keeps both files near 17MB.

## The feature reel (`src/features/`)

The film that answers "what does this do", told as one app's story. It follows
**Juniper: Habit Tracker**, an app that does not exist, from a store page with
no screenshots to its first reviews, in three chapters over 92 seconds:

1. **Make your screenshots**: templates, dropping screenshots in, the 3D
   phones, one picture across several screenshots, every language, preview
   videos with music, Capture taking the screenshots, the AI agent.
2. **Get your app out there**: every store size, the upload (it runs through
   the quiet bar and lands on the drop), the website with its support and
   privacy pages, launch graphics, the iOS 27 header art.
3. **See how it's doing**: Growth's numbers and the update that crashes more,
   "did the new screenshots work?" (asked on the break, answered on the drop),
   competitors, keywords with how popular each word is, reviews, then a quick
   montage of the smaller features, what it costs, and the address.

- **The music is `public/intro.mp3`**, a supplied track (the only asset here
  that was not made in this repo; check its licence before publishing).
  `scripts/arrange-music-features.js` lays bars of it end to end under the
  film's bars (its `SEGMENTS`): the track has one lift with a crash (its bar 4),
  and each chapter opens on that crash. Inside the groove it only cuts from an
  odd bar to a later even bar, because the groove is a two bar loop whose even
  bars, and odd bars, sound over 0.99 alike. It writes
  `public/music-features-intro.m4a`, exactly 92.0 s, at -15 LUFS with the true
  peak under -1 dBTP. The old
  synthesized bed (`gen-music-features.js`, `music-features.m4a`) is unused.
- **The picture renders muted and the bed is copied in after**
  (`scripts/mux-features.js`, part of `npm run render:features`). Remotion's own
  AAC re-encode came out 58 ms longer than the video with nothing in the file to
  correct for it, so every hit landed about 45 ms late and the music was encoded
  twice. Copied in, the downbeats land about 10 ms after their cuts.
- **Everything is built on a 60 frame bar.** The track is 120 BPM, so a bar is
  2.0 s, and every boundary in `style.ts` `T` is written in bars. The opening
  is eight seconds: the hook, the reveal on the crash, chapter one's card on the
  rise. Chapter one gives a feature a bar and a quarter, so its cuts walk round
  the four beats; chapter two gives a bar and a half; chapter three keeps two
  bars. A scene made for more time
  than it now has plays faster to fit (`MADE_FOR` in `style.ts`), so the camera
  keys and rings written inside it stay as they are. The arranger places every
  piece of the track so its downbeat lands about 10 ms after its frame. The
  break bars (16, 26) are where the film holds its breath; the logo lands on
  the final hit (bar 43). Edit `style.ts` and the arranger together.
- **Every word on screen is in `COPY` in `style.ts`**, so the copy can be read
  and checked in one place: plain words, no dashes, no full stops, nothing a
  person who has never shipped an app would need to look up. `New` marks what
  arrived after the previous cut of this film (21 August), and `In the desktop
  app` marks what the web build cannot do.
- **Juniper is one app all the way through.** Its five screens are HTML in
  `scripts/juniper/juniper.html` (English, German, Japanese, Arabic), rendered
  by `render-juniper.js` to `public/juniper/`. Its store set was built and
  exported by the editor itself from the Droply Habits template. The Growth
  numbers in chapter three are the e2e suite's sample app of the same name
  (`tests/fixtures/growthSample.ts`), so the lift Growth reports is the lift
  from the screenshots chapter one made.
- **The footage is the app, never a drawing of it.** `public/features2/` holds
  captures of a frozen static build with the e2e Tauri IPC mock injected, so
  desktop only surfaces (Capture, Growth, the upload dialog, Claude Code)
  render in a plain browser. `scripts/features2/` has the rig and every capture
  script; its README says how to rebuild the footage. Each folder has a
  `rects.json` naming the controls a camera, ring or cursor points at, and
  `scripts/gather-rects.js` compiles them into `src/features/rects.generated.ts`,
  so a re-capture that moves a button moves everything aimed at it.
- **The window has a camera inside it.** `AppWindow` keeps the frame still and
  moves the capture under it, so a push into one button reads like a screen
  recording zooming in. Overlays (rings, the cursor) are drawn in the capture's
  own CSS px and stay glued to the UI while it moves.
- **No three.js.** Every 3D phone on screen is the app's own 3D Studio render,
  exported frame by frame; the rest is CSS. Renders are fast and deterministic.
- **Left from the August cut:** `public/features/`, `scripts/capture-features*.js`,
  `crop-features.js` and `gen-music-features.js` made the previous version of this
  film. Nothing in `src/features/` reads them now.

## The rack cut (`src/rack/`)

`PromoRack`, 30 seconds at 1440x1800 and 60 fps, made for X and Instagram
(`out/open-screenshot-generator-promo-rack.mp4`). It shows everything the app
does that is not about making the screenshots themselves. A terminal types
`/add App icon`, the module slides into its slot on the beat, boots and is
patched in with a cable. Eighteen modules go down the first column, up the
second and down the third. Then the camera pulls back to the whole rack, and a
frosted card drops over it: "18 tools, one app". The look and the moves follow
a modular synth rack film that was shared on X; the words, the screens and the
score are ours.

```bash
npm run music:rack       # arrange public/intro.mp3 and the effects into public/rack/score.m4a
npm run render:rack      # render muted at 1440x1800, then copy the score in
npx remotion render PromoRack out/rack-review.mp4 --muted --scale=0.75   # quick look
```

- **Everything sits on the beat of the music**, `intro.mp3` at 120 BPM: a beat
  is 30 frames and a bar is 2 s. `style.ts` has `LAND_BEATS` (a module every
  two beats), `SHOT` (the cuts, the pull back, the signal, the card) and `STEP`
  (when a module types, slides, boots and is patched, counted from its
  landing). The cut to column two is on the track's crash, the groove drops as
  column two's last module is patched, and the card lands on the final hit.
- **The music is arranged, not edited by hand.** `scripts/arrange-music-rack.cjs`
  lays bars of `intro.mp3` under the film's bars, joining them only where
  `arrange-music-features.js` found the joins cannot be heard, and checks that the
  crash, the pull back and the final hit sit where the film expects them. It
  reads the timing out of `style.ts` and the names out of `copy.ts`, and adds
  quiet effects with no pitch: key clicks, a sweep as a module slides in, a clack
  as it lands, the plug, a tick per module as the signal runs down the cable,
  the pull back and the card. `RACK_SFX_DB=off` leaves the music alone. Change
  the timing in `style.ts`, then run `npm run music:rack` again. `intro.mp3` is
  a supplied track: check its licence before publishing.
- **The rack is CSS in one 3D context**, not three.js. `camera.ts` turns a key
  (where the camera looks, how big the rack is, yaw, pitch, roll) into one
  transform on the world, glides through a key per module on a Catmull-Rom
  curve, and adds a hand-held drift and a small jolt when a module lands.
- **Depth of field** is two `backdrop-filter` bands at the top and bottom of the
  frame. **Motion blur** on a sliding module or the falling card is copies along
  its path, averaged by giving copy i an opacity of 1/(i+1). The pull back gets
  a cheaper camera blur: an even one for the travel and one that grows towards
  the edges for the zoom. Rendering the whole rack a dozen times a frame, the
  honest way, stalled the render on the office PC.
- **Every word on screen is in `copy.ts`**, written to the house style. The card
  notes that Upload, Growth and Reviews need the free desktop app.
- **The screens** (`demos/`) show Juniper, the made-up app from the feature reel,
  with the app's own labels where it has them. Juniper's numbers are made up.
  The cut-outs in Remove background are copies of the editor's product
  illustrations (`public/elements/images/products/`, original work).
- The scenes are laid out at 1080x1350 and scaled to the composition, so a
  `--scale=0.75` render is the same film at 1080x1350.
