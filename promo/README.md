# Artboard Studio promo video

A product promo built with [Remotion](https://www.remotion.dev/), three.js and GSAP. Two cuts from the same scenes:

- `Promo` — the full 52-second cut (`out/artboard-studio-promo.mp4`)
- `PromoFast` — a tighter 36-second cut (`out/artboard-studio-promo-fast.mp4`)

Both are 1920x1080 at 30 fps with an original synthesized music bed.

## Commands

```bash
cd promo
npm install
npm run studio       # open Remotion Studio to preview and scrub the timeline
npm run render       # render the full cut
npm run render:fast  # render the fast cut
npm run gen:music    # regenerate public/music.wav (then convert to music.m4a with ffmpeg)
```

## How it is put together

- `src/Promo.tsx` holds both timelines (FULL and FAST) over shared scenes; each scene is a `Sequence` with a crossfade overlap, wrapped by `components/Scene.tsx`. The music `<Audio>` fades in and out based on the composition length.
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
