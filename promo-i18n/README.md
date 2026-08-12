# Multi-language promo video

A sixty second [Remotion](https://www.remotion.dev/) cut on one feature: a project that ships in
more than one language, and the properties panel that writes each one.

- `Languages` — 1920x1080, 30fps, 1800 frames, rendered to
  `out/open-screenshot-generator-languages.mp4`

Separate from `../promo/`, which covers the product as a whole. This one has its own shots, its own
palette and its own music, and nothing is shared between them but the idea of a plate under a
camera.

## Commands

```bash
cd promo-i18n
npm install
npm run capture    # drive the real editor and rewrite public/shots (dev server on :9002)
npm run studio     # scrub the timeline in Remotion Studio
npm run gen:music  # regenerate public/music.wav
npm run render     # render the cut
```

## What is in it

Five acts, cut on `BEATS` in `src/style.ts`:

| Frames | Act | What is on screen |
| --- | --- | --- |
| 0-110 | Hook | One project, every language |
| 110-560 | Add | The Add language button, the Languages dialog, German ticked, then Japanese and Spanish, then Add 3 languages |
| 560-850 | Switch | The language menu with its 12/12 counts, and the whole canvas turning German on one click |
| 850-1370 | Write | The headline selected, the Content box with its DE badge, a German headline typed over the machine draft, the board following on blur |
| 1370-1640 | Keep | Four cuts pinned on the same headline: Deutsch, English, 日本語, Español, English again |
| 1640-1800 | Outro | Wordmark and address |

## Everything on screen is real

`scripts/capture-i18n.js` drives the running editor in headless Edge and writes
`public/shots/*.png` plus `rects.json`, the CSS-px box of every control the camera flies to. It
opens the Zenfit Yoga template, adds German, Japanese and Spanish through the Languages dialog,
switches to German, selects the headline, retypes it, fixes a word the machine translation doubled,
tours the other two languages and comes back to English. Nothing in the video is a mockup of the UI:
the ticks, the `12/12` counts, the `DE` badge, the `English (US): Health` line under the Content
box and the German on the boards were all photographed doing the thing.

Two consequences worth knowing before you re-cut it:

- **Adding a language machine translates the project on the spot.** The board is already German by
  the time the properties panel opens, so the edit the video films is a rewrite of a machine string
  rather than a blank being filled. That is the honest version of the feature and the video says so
  ("machine translation is a draft, not a decision").
- **The canvas commits text on blur, not per keystroke.** The board holds the old word through the
  whole typing run and flips on one frame at the end. The cut is built on that gap.

If the editor's chrome moves, rerun `npm run capture` and mirror the new numbers from
`public/shots/rects.json` into `RECTS` in `src/style.ts`.

## How it is drawn

- `src/components/Cam.tsx` — the only camera. Keys are "put scene point (x, y) in the middle of the
  frame at zoom s", eased between, with a handheld sway. Scenes move the camera and swap the plate
  under it rather than cutting, which is what makes a stack of screenshots read as one session.
- `src/components/Plate.tsx` — one screenshot as a glass card in scene space. `SHOT`/`K` in
  `src/style.ts` put one CSS pixel of the app on 1.2 scene pixels.
- `src/components/Focus.tsx` — the spotlight, in scene space so it magnifies with the control.
- `src/components/Pointer.tsx` — an arrow, not a fingertip: this is a desktop app.
- `src/components/Backdrop.tsx` — carries the act colour (violet while languages are added, cyan
  while one is read, green while a string is written, amber when the base language comes back) and
  drifts "stay healthy" in ten languages behind everything.
- `scripts/gen-music.js` — the track, synthesized rather than licensed. Its risers and impacts sit
  on the same `BEATS` the acts cut on, and the drums drop out for the two bars where the typing
  happens.
