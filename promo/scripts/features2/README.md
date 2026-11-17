# Footage for the feature reel

Everything in `promo/public/features2/` is the real editor, captured from a frozen
static build in headless Edge. The e2e Tauri IPC mock is injected first, so the desktop
only surfaces (Capture, Growth's numbers, the upload dialog, Claude Code) render in a plain
browser. Nothing here reaches a real backend: Apple, Google, GitHub, the AI CLIs and
`pb.openscrgen.app` are answered by the mock's `http` rules or by puppeteer interception.

The film follows **Juniper: Habit Tracker**, an app that does not exist. Its competitors
(Dayline, Tally, Brightly), the people in the live session and in the community feed, and
every review are made up too. Their screenshots are cut from the repo's own template
previews.

## Rebuild

1. **A static build of the repo.** `git archive HEAD` into a temp folder, junction
   `node_modules` to the repo's, then `npx next build` there. Leave the user's dev server
   on :9002 alone.
2. **Serve it** on 127.0.0.1:9311: `node rig/serve.mjs <build>/out 9311`. Point the
   scripts somewhere else with `EDITOR_URL`.
3. **Bundle the mock:** `node rig/make-tauri-mock.mjs` (writes `rig/tauri-init.cjs`).
4. **Juniper's screens:** `node ../juniper/render-juniper.js` (five screens in English,
   German, Japanese and Arabic, to `public/juniper/`).
5. **Juniper's store set:** `node rig/juniper.cjs` builds it in the editor from the Droply
   Habits template and exports every board in every language to `public/features2/juniper-set/`.
   Other scripts call its `buildJuniper(page)` to start from the same project.
6. **The shots**, each folder on its own:
   - `design/`: `node design/make-media.cjs` once (the sound and recording the video
     shot uses), then `cap-quickstart.cjs`, `cap-editor.cjs` (`--only editor` or
     `--only languages`), `cap-studio3d.cjs` (the 48 frame turntable and the finishes),
     `cap-panorama.cjs`, `cap-video.cjs`.
   - `flows/`: `cap-capture.cjs`, `cap-agent.cjs`, `cap-publish.cjs`, `cap-website.cjs`,
     `cap-export.cjs`.
   - `growth/`: `python -I growth/make_assets.py` once (icons and competitor screenshots;
     it needs numpy and Pillow), then `node growth/capture.cjs`, or name the shots:
     `overview impact competitors alert keywords health reviews reply summary`. The seed
     also stores Apple Ads popularity for the keywords (with a saved Apple Ads connection),
     sixty days of rating history and the crash numbers `health` films on Ratings.
   - `more/`: `social.cjs`, `header.cjs`, `editor.cjs`, `panels.cjs`.
7. **Compile the rects:** `npm run rects:features` in `promo/`.

## Things that cost time

- **Headless Edge stops painting on Windows** after a few minutes: the window counts as
  occluded, `document.hidden` turns true and `__osg.capture` never returns. The launchers
  disable `CalculateNativeWinOcclusion`, turn on focus emulation and bring the page to the
  front. If a whole layer comes out black at 2x or 3x, add
  `EDGE_ARGS="--force-gpu-mem-available-mb=8192 --disable-gpu-rasterization"`.
- **Rename the project.** A template opens as "<name> Copy", and that name shows in the tab
  and the bottom bar of every editor shot. `renameProject()` in `rig/juniper.cjs` does it
  the way a person does, which is the only way that sticks.
- **Some states need a tall window or a scroll.** At 900 px the agent screen cannot show
  the prompt and Start together (`agent-start-scrolled.png`), and Capture's grid shows three
  of its four language rows (`capture-done-tall.png` has all four).
- **Growth's Overview needs history for both halves of a period.** The sample has 180 days,
  so "Last 90 days" has no full previous period and every tile says there is nothing to
  compare. "Last 28 days" fills every tile.
- **On a Mac the scripts use Chrome**, which the app-screenshots skill finds on its own.
  Chrome resizes the page for a moment on every screenshot, and the "kicker" in
  `growth/glib.cjs` takes one every two seconds, which closes any open Radix Select, so
  `pickSelect` pauses it. `make_assets.py` falls back to Arial Bold and Impact when the
  Windows fonts are not there. Remotion brings its own ffmpeg: put a small `ffmpeg` script
  that runs `node_modules/@remotion/compositor-darwin-arm64/ffmpeg` on the PATH for
  `mux-features.js` and `arrange-music-features.js`.
- **Nothing with a code in it goes in a video.** The live session's link is rewritten in the
  DOM before the shutter, and the store key shows only its masked form.
