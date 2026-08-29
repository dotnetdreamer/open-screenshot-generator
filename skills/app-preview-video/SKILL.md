---
name: app-preview-video
description: >-
  Builds an App Store App Preview video (and a Play Store or landing page promo cut) from a screen
  recording of the app, using the open-screenshot-generator CLI (`osg video`): it starts from one of
  20 ready made preview scenes, drops real captured footage into the phone mockup, times the text and
  gesture overlays, checks the timeline against Apple Review Guideline 2.3.4, and renders H.264 MP4s
  at 886x1920. Use this whenever someone asks for an app preview, a preview video, a store video, an
  App Store trailer, a demo video for the listing, or says things like "make a video for the App
  Store", "turn this screen recording into a store preview" or "my listing needs a video". Also use
  it for follow ups: a different story, different overlay copy, retiming, a longer or shorter cut, or
  a version without the frame.
license: MIT
metadata:
  package: open-screenshot-generator
  homepage: https://openscrgen.app
---

# App Preview video for the app in this repository

**The end state**: one MP4 per preview board under `osg/out/`, 886x1920, H.264, no audio track,
between 15 and 30 seconds, built from real captured footage of the app, listed in
`osg/osg.manifest.json` and accepted by App Store Connect.

## The rule that governs everything here

Apple Review Guideline 2.3.4: an App Preview may only use video screen captures of the app itself.
Not a mockup, not an animated design, not a montage of stills. The same guideline explicitly allows
narration and video or textual overlays to explain what the footage does not.

That is why this pipeline has three modes and only two of them can be uploaded to the App Store.

| `video.mode` | What renders | Where it is allowed |
| --- | --- | --- |
| `store-raw` | the recording, full bleed, nothing else | App Store, the safest submission |
| `store-text` | the recording, full bleed, plus the board's text and gesture layers with their animations | App Store, and the better of the two for most apps |
| `styled` | the whole designed board: background, device frame, every layer | a landing page, social, a Play promo video on YouTube. Not an App Store preview |

`styled` is a good asset and a bad submission. If the user asks for "a video for the store", produce
`store-text` and say why. If they ask for "a video for the website", produce `styled`.

## Step 0: doctor first, because of one trap

```bash
npx -y open-screenshot-generator@0 doctor
```

**MP4 export needs a branded browser.** The encoder is WebCodecs with an `avc1` (H.264) profile, and
H.264 is a proprietary codec that plain Chromium and Chrome for Testing do not ship. PNG export, the
49 design tools and the AI agent work on any Chromium. Video does not. So:

- Chrome, Edge or Brave: works.
- Chromium from a distro package, or the build `osg doctor --install-browser` fetches: `VideoEncoder`
  reports no supported H.264 config and the render fails with a "use Chrome or Edge" message. There
  is no fallback encoder.
- Point at a branded build with `--browser "C:/Program Files/Google/Chrome/Application/chrome.exe"`
  or `--browser /usr/bin/google-chrome-stable`, or set `browser` in `osg/osg.config.ts`.

`doctor` probes this per browser and says so, rather than assuming. Do not start a capture session
before it passes.

## Step 1: get real footage

`osg` does not record your app. Capture it with the platform's own tooling:

```bash
xcrun simctl io booted recordVideo --codec h264 osg/media/demo.mov
adb shell screenrecord /sdcard/demo.mp4 && adb pull /sdcard/demo.mp4 osg/media/demo.mp4
```

Rules that come from the compositor, not from taste:

- Record the **Release** build. A dev banner in the footage is a rejection and a bad ad.
- Record one continuous journey, not a montage: open the app, start the core action, finish it, see
  the result. The cut has to read on its own without narration.
- A phone records at 1290x2796 and that is fine. The export cover scales and centers to 886x1920, so
  a portrait recording fills the frame edge to edge.
- Record 20 to 40 seconds and trim, rather than recording exactly 18 and finding a stumble in it.
- No audio is used. The MP4 has a video track only, so nothing you say into the recording survives.

Put the file path in `video.recording` in the config. The CLI serves it to the page over the local
origin, so a large file never has to travel as base64.

## Step 2: start from a preview scene, not from an empty board

There are 20 finished App Preview scenes, each a whole board: background, phone mockup playing the
recording, timed copy, gesture hints and a call to action, arriving 18 seconds long, already inside
Apple's 15 to 30 second window. Building the same thing from `add_elements` plus `set_animation` is
several times the work and rarely as good.

```bash
npx -y open-screenshot-generator@0 edit --script osg/preview.json
```

```json
[
  { "tool": "list_preview_scenes", "args": { "query": "finance" } },
  { "tool": "add_preview_scene", "args": { "sceneId": "spotlight-launch" } },
  { "tool": "get_artboard", "args": {} }
]
```

Scene ids include `spotlight-launch`, `feature-rush`, `headline-punch`, `five-star-proof`,
`three-taps`, `money-mode`, `sweat-session`, `calm-hour`, `night-feed`, `order-up`, `trip-ready`,
`beat-drop`, `learn-streak`, `shop-drop`, `focus-block`, `snap-fix`, `team-sync`, `health-check`,
`play-now` and `home-control`. `list_preview_scenes` is the live list.

Preview scenes are **not** in `osg templates` or in `list_templates`: that catalog deliberately hides
the app-preview category, because those boards play a recording. `list_preview_scenes` is the door.

The `get_artboard` call at the end is not optional. It returns the layer ids and names you need next,
and a model cannot see the canvas.

## Step 3: put the footage in the phone

The recording is not an image asset. `upload_asset` probes bytes with an `<img>` and refuses a video,
and its `asset:` references get expanded into data URLs, which would inline tens of megabytes into
the saved project. Recordings stay blobs and elements carry only a media id.

```json
[
  { "tool": "upload_recording", "args": { "source": "https://example.com/demo.mp4", "name": "demo" } },
  { "tool": "update_element", "args": { "elementId": "phone", "mediaId": "<the id it returned>" } }
]
```

`source` takes an http(s) URL the page can fetch, a `data:video/...` URL, or bare base64. Prefer a URL
for anything large: a request body is capped at 32 MiB. The layer to target is the one named "Phone
(drop your recording here)".

**Use the config for a local file.** `osg video` reads `video.recording`, publishes that file on the
CLI's own local origin, and hands the page a URL, so a 90 MB `.mov` on disk never has to be encoded
into a JSON body. Reach for `upload_recording` by hand only when you need two different clips on two
boards.

Trim inside the element rather than re-recording: `trimStart` and `trimEnd` are seconds into the
source, on the `video-device` layer.

## Step 4: rewrite the overlays and check the timeline

Rewrite every placeholder string with `update_element`. Overlay copy is not the same as screenshot
copy: it has to be readable in under two seconds, over moving footage, at phone size. Three to five
words. One idea per overlay.

Timing lives in `set_animation`:

- Presets are `fade`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `scale-up`, `pop`.
- `enterDelay` is the second the entrance starts, `enterDuration` defaults to 0.6.
- An exit needs `exitStart`, an absolute second. Without it the layer never leaves, and an `exitStart`
  before the entrance lands is rejected rather than stored.
- Animations only play in the exported MP4 and in the timeline player. On the canvas and in a PNG
  every layer is drawn at rest, all at once, so two layers must never share a position and take turns
  in time. That looks right in the video and like a smear everywhere else.
- `set_animation` refuses recordings and gestures on purpose. A recording always starts the board
  (trim it), and a gesture is timed by `triggerTime` and `gestureDuration`.

Gesture hints are their own element type: `tap`, `double-tap`, `swipe-left`, `swipe-right`,
`swipe-up`, `swipe-down`, placed over the point in the footage where the finger goes, with
`triggerTime` matched to the moment the recording shows the interaction. `gestureRepeat` loops it for
the whole board.

Then read the board back as data before you spend minutes on a render:

```json
[{ "tool": "get_preview_timeline", "args": {} }]
```

It returns the board length, one clip per layer, and a list of what will bite at export: a board
under Apple's 15 second floor, a layer animating past the end, or no recording in the phone yet.
`set_preview_duration` sets the board length explicitly, 15 to 30 for the App Store, and
`seconds: null` hands it back to whatever the content works out to.

## Step 5: render

```bash
npx -y open-screenshot-generator@0 video
```

Reads `video.mode`, `video.fps`, `video.duration` and `video.recording` from `osg/osg.config.ts`.
One MP4 per preview board, rendered sequentially. Expect minutes, not seconds: every layer is
rasterized once and then composited frame by frame.

Constraints, all of them real and none of them worth trying to work around:

- **886x1920** portrait, or 1920x886 landscape. Output dimensions are forced even for H.264.
- **15 to 30 seconds.** App Store Connect rejects anything shorter or longer.
- **30 fps.** 60 renders, and Apple's spec is 30. Leave `fps` at 30 unless the user insists.
- **H.264, roughly 12 Mbps**, `avc1`, faststart.
- **No audio track.**
- **Flat frames only.** A 3D or perspective device pose exports as a static sprite. Only a
  `video-device` layer composites live footage, so keep the mockup flat on a preview board.
- **One MP4 per artboard.** A three scene preview is three boards and three files, and Apple takes up
  to three previews per localization anyway.

Then:

```bash
npx -y open-screenshot-generator@0 manifest
npx -y open-screenshot-generator@0 verify
```

`verify` checks duration, dimensions, codec and file size against the store rules and exits 3 on a
failure. See the **store-compliance** skill.

## Keep video content off the screenshot boards

Adding a `video-device`, a `video`, a `gesture` or any animation switches the **whole project** to
the video export path. A screenshot board that picked up a stray gesture layer stops exporting as a
PNG set. Keep preview boards in their own project, or at minimum know that this is why the export
suddenly asks about frame rates.

## Follow up dispatch

| The user asks for | Edit | Then run |
| --- | --- | --- |
| Different overlay copy | `update_element` `content` on the text layers | `video` |
| A longer or shorter cut | `set_preview_duration`, or `video.duration` | `video` |
| Retiming, "the text comes in too late" | `set_animation` `enterDelay` / `exitStart` | `video` |
| A different story or look | a different `sceneId` via `add_preview_scene` | `video` |
| New footage | `video.recording`, or `upload_recording` plus `mediaId` | `video` |
| Trim the clip | `trimStart` / `trimEnd` on the video layer | `video` |
| "Apple rejected the preview" | `video.mode` to `store-raw` or `store-text` | `video` |
| A version for the website | `video.mode` to `styled` | `video` |
| A still for the listing instead | nothing | `render` |

## Troubleshooting

**"No H.264 profile" or "use the desktop app, Chrome or Edge".** The browser is a plain Chromium
build. See Step 0. This is the single most common failure on CI runners and on Linux.

**The MP4 is a still image under the overlays.** No recording reached the phone layer, and the poster
fallback stood in so the layout could be proofed. Check `get_preview_timeline`, it says so, then
`upload_recording` and set `mediaId`.

**The video is 4 seconds long.** The board length follows the content when nothing overrides it. Set
`set_preview_duration` to 15 or more, or lengthen the animations.

**A layer is on screen the whole time.** It has no `exitStart`, so it never leaves. That is the
default and often correct.

**A layer never appears.** Its `enterDelay` is past the end of the board, or an `exitStart` sits
before the entrance lands.

**The device frame is a static picture while the screen plays.** Correct and expected for a
`video-device`: the chrome is a sprite drawn under the footage with the notch drawn back over it.

**A 3D posed phone does not play.** 3D and perspective poses export as static sprites. Switch the
layer to a flat frame.

**The render died part way on a big board.** Re-run with `--verbose` to see the page console. On a
container add nothing: the CLI already passes the sandbox and shared memory flags a runner needs.

**App Store Connect took the file and failed it hours later.** That is Apple's asynchronous asset
processing, and it is almost always duration or dimensions. Run `osg verify` before uploading, every
time.

## Related skills

- **store-screenshots** for the PNG set, which is the required half of a listing
- **store-compliance** for what `verify` checks and for `osg upload`
- **editor-tools** for the tool by tool detail behind every call on this page
