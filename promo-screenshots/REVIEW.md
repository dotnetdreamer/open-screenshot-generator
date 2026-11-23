# Review notes

## Creative calls

- The reference's grammar is copied on purpose (the person asked for "similar, maybe an
  exact copy"): a ring of LED screens in a dark studio, one item per screen with a prop in
  front, the camera trucking from screen to screen on the bar, a whip out to a wide of the
  ring, a push into a clapperboard that lists everything, a pill under it. The content is
  ours: sixteen screenshot features, each shown with the app's own pictures.
- The title on the slate keeps the reference's "One take." ("16 features. One take.")
  because the film is one take; the product is named on the slate's PROD. line and the pill
  carries the address.
- Order of the screens follows a set being made: start (templates, your screenshots), design
  (edit, fonts, 3D phones, one picture, library, community), reach (languages, every device,
  preview videos), the helpers (Capture, AI agent, CLI), and the way out (store listing,
  every size), as the reference ends on FFmpeg delivering the file.
- Not built: a voiceover (none asked), the reference's people or car (our props are our own
  objects), HeyGen re-shoots (Pro, not needed: nobody is on camera).

## Measured, not only looked at

- Camera: frame-to-frame image shift of the draft against the reference (flow.js): pans
  start on the same downbeats with the same travel; the whip is on bar 16 (26.4 s), about
  0.35 s before the reference's.
- Music (23 November): `promo/public/intro.mp3`, as asked, arranged to the film by
  `scripts/arrange-music.cjs` with two cuts at points the track allows (into its crash, and
  from its rise into its drop), then played straight on to its final hit. The film was re-cut
  to the track's 120 BPM (a screen a bar, 2.0 s) rather than stretching the track to the
  reference's 150 BPM: the pans still start on downbeats, the demos hold 1.25 s instead of
  0.85 s, and the film runs 40 s instead of 34.4 s. The bed measures -15.1 LUFS with the
  peak at -1.7 dBFS. **Measured, not heard.**
- Copy: numbers checked in the code (README.md "Copy and facts"); CLI lines from a real run.

## Weakest parts, and what more time would buy

- Some demos are dense UI at a distance (the agent's step list, the export dialog's small
  print): they read as the real product working, not as text to read. Larger crops of a
  single control would read better on a phone.
- The props are built from primitives; a modelled set (Blender) would light better.
- intro.mp3 is a supplied track; its licence was not checked here (promo/README.md says to).
- The wide shot's ceiling (softboxes, cones) is quieter than the reference's.

## Warnings kept on purpose

- `npx hyperframes check` passes. It warns `dead_stretch` ("nothing changes for 31 s"): a
  false positive, because it watches the DOM and the whole film is drawn on one canvas that
  changes every frame (the frame-shift measurement above shows the motion).
- `_demo-sheet.html` is a dev page in the project root; it is not mounted by `index.html`.
- Fixed after the first check: the end card note was 28 px (now 37 px, the reading floor),
  and the palette sampling canvas now sets `willReadFrequently`.

## Delivery

- `renders/open-screenshot-generator-one-take.mp4`: the delivery render (git-ignored,
  around 220 MB at 46 Mbps).
- `../promo/out/open-screenshot-generator-promo-one-take.mp4`: the same film encoded for
  posting (H.264 high, CRF 19, 60 fps, AAC 192 kbps, faststart), next to the other cuts.
  Command:
  `ffmpeg -i renders/open-screenshot-generator-one-take.mp4 -c:v libx264 -preset slow -crf 19 -profile:v high -level 5.1 -pix_fmt yuv420p -r 60 -movflags +faststart -c:a aac -b:a 192k ../promo/out/open-screenshot-generator-promo-one-take.mp4`
