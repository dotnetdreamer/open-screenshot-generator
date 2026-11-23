# "16 features. One take." (screenshot features promo)

A 40 second, 4:5 (1440 x 1800, 60 fps) promo of everything Open Screenshot
Generator does to make the screenshots themselves, as one unbroken camera move
past sixteen LED screens in a film studio, ending on a clapperboard that lists
all sixteen. Its sister cut, `PromoRack` in `promo/`, covers everything else the
app does.

Built with [HyperFrames](https://github.com/heygen-com/hyperframes) (HTML
rendered to video). The look and the camera grammar are taken from
[this post's video](https://x.com/woodxbt/status/2124482580896498142), measured
frame by frame (`SPEC.md`); the content is ours. The music is
`promo/public/intro.mp3`, the track the PromoFeatures reel uses (a supplied
track: check its licence before publishing), and the film is cut to its bars.

## Commands

Run from this folder. `npx hyperframes` here means the HyperFrames CLI (the
pinned `hyperframes@0.9.81` in `package.json`).

```bash
npx hyperframes preview                    # Studio preview
npx hyperframes render -o renders/open-screenshot-generator-one-take.mp4 --quality delivery   # the film (~8 min here)
npx hyperframes render --quality draft --variables-file .draft-vars.json -o renders/draft.mp4   # half size stage, ~5 min
npx hyperframes lint && npx hyperframes check
node scripts/arrange-music.cjs             # the music: intro.mp3 arranged to the film's bars
node scripts/build-vendor.mjs              # three.js bundle (repo node_modules: three 0.185.1, esbuild)
node scripts/fetch-fonts.mjs               # Space Grotesk, Inter, JetBrains Mono, Instrument Serif
node scripts/prep-shots.mjs                # the product pictures, cut from promo/public
```

The finished film for posting is `promo/out/open-screenshot-generator-promo-one-take.mp4`
(the delivery render re-encoded at CRF 19; the command is in `REVIEW.md`).

## How it is put together

- `index.html` is the root: one `<canvas>` for the stage, the end card pill
  (`compositions/endcard.html`) and the music. The stage is three.js, drawn for
  every seek from the time alone (`assets/film/main.js`, an `hf-seek` listener
  with `waitUntil`), so any frame renders on its own and renders use every core.
- `assets/film/timing.js` is the clock, on the track's bars: 120 BPM, a bar is
  2.0 s, bar k starts at 0.5 + 2 k. The track's crash lands on bar 0 as the
  camera reaches screen 1, its drop on bar 2; pans start on bars 1 to 15, the
  whip on bar 16 and the clap on the track's final hit, bar 18.
  `scripts/arrange-music.cjs` lays the track out on the same bars (two cuts, both
  where the track allows one). Edit the two together.
- `world.js` holds the set's measurements (a ring of 16 screens, 8.8 m radius;
  the camera 5.6 m from a screen; props 2.5 m in front of it), `camera.js` the
  one camera move, `set.js` the studio (blurred planar reflection on the floor,
  truss and spot cans, LED band, softboxes, haze cones, the round stage),
  `props.js` the sixteen props, `slate.js` the clapperboard and its end card face.
- `screens.js` + `demos.js`: each screen is a 1024 x 1280 canvas texture, a
  static header (accent bar, name, line, the app's own label in mono) over a
  live demo drawn in 2D. The demos only use the app's own pictures (`shots.js`):
  editor captures from the PromoFeatures rig, the Juniper set the editor
  exported, template previews, 3D Studio renders, the Every device view
  (`scripts/capture-every-device.cjs`), and the in-house 3D objects, stickers and
  mascots. Drawn parts are only cursors, ticks and highlights. No Adobe Stock
  photo is copied here (see THIRD-PARTY-ASSETS.md).
- `post.js`: the camera's motion blur (the scene drawn at up to 14 moments in a
  180 degree shutter and averaged while it moves), a NaN scrub (one NaN pixel
  blacks out a bloomed frame), depth of field for the end card, bloom on the bulbs
  only, a grade (vignette, grain, a hair of lateral colour), neutral tone mapping.
- `_demo-sheet.html` is a dev page, not part of the film: serve the folder and
  open `_demo-sheet.html?s=0,1&t=-0.5,0,0.5,1.4` to see screens at chosen moments.

## Copy and facts

Every word on screen is in `assets/film/copy.js` (house style: plain words, no
dashes, no full stops). Numbers were checked in the code on 22 November 2026:
122 templates (`src/lib/templateCategories.ts`; README and website still say 103),
57 languages (`src/lib/i18n/locales.ts`), 17 phones in 3D Studio
(`src/lib/device3dModels.ts`), 276 pictures (`src/lib/imageLibrary.ts`). The
terminal lines on the CLI screen were printed by a real `fill`, `render` and
`verify` run on Juniper's five screenshots. The `mono` line on each screen is the
label the app itself uses for that feature.

## Gotchas

- Fonts in canvas text must be loaded first (`assets.js` loads each face).
- HTML in Canvas (`drawElementImage`) was tried for the screens and dropped: in
  Chrome 158 it needs `content="drawable"` on the canvas and `drawable` on the
  element, it reads the previous frame's paint, and it pins renders to one worker.
- A cone or any ShaderMaterial that writes depth breaks the depth of field;
  the haze cones do not write depth.
- The bloom threshold (1.35) sits above anything a screen or the slate can reach,
  so text never glows; bulbs, the ring light and lenses are the only things over it.
