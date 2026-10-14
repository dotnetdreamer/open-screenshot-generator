# Editor and agent promo

`PromoLaunch` is a 32 second film at 1920 × 1080 and 30 fps. `HeroLaunch` is a silent 10 second loop at 1920 × 840 and 30 fps. Both use current editor captures and a teal, gold and ink backdrop

The Agent dock is the actual desktop component with a seeded transcript through the repository's Tauri test runtime. Its prompt, working and completed states show supported editor tools. The film and loop mark this sequence as an example workflow. Capturing and rendering do not call an AI provider

The Kassa Money project is a shipped template. Three app screenshots appear in intake, followed by five store artboards. The languages and export dialogs are real editor captures. Camera moves and cuts condense the sequence

## Refresh the captures

Start the editor from the repository root

```sh
npm run dev
```

In another terminal, also from the repository root

```sh
node promo/scripts/capture-launch.cjs
```

The capture script uses a separate headless browser and closes it when finished. It writes screenshots and geometry to `promo/public/launch/`. Stop the dev server when finished

## Render the film and loop

From `promo/`

```sh
npm run gen:launch-score
npm run render:launch
npm run render:hero
npm run encode:launch
npx remotion still src/index.ts PromoLaunch ../website/assets/video/launch-promo-poster.jpg --frame=350 --image-format=jpeg --jpeg-quality=90
npx remotion still src/index.ts HeroLaunch ../website/assets/video/hero-editor-poster.jpg --frame=0 --image-format=jpeg --jpeg-quality=90
```

The score is synthesized by `scripts/gen-launch-score.cjs` and encoded to AAC. Its temporary WAV goes in the ignored test artifacts directory. The script uses Remotion's bundled FFmpeg where available. Set `LAUNCH_FFMPEG` to a local FFmpeg executable to override it

The outputs are `website/assets/video/launch-promo.mp4`, `hero-editor-loop.mp4`, `launch-promo-poster.jpg` and `hero-editor-poster.jpg`. The encoding pass compresses the hero loop and converts both films to standard limited-range H264 with fast start for playback on the website. The hero composition returns its camera and backdrop to the opening state at the loop boundary

## Check a render

```sh
npx tsc --noEmit
ffprobe -v error -show_streams -show_format ../website/assets/video/launch-promo.mp4
ffprobe -v error -show_streams -show_format ../website/assets/video/hero-editor-loop.mp4
```

The full film has H264 video and stereo AAC audio. The hero loop has one H264 video stream and no audio stream. Both use the `yuv420p` pixel format
