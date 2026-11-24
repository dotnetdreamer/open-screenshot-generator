# Director: research and hand-over

Director turns a screen recording of an app into a video of a 3D phone, with the camera moves worked out from the recording. It can also take its moves from a phone the user holds. This file says why it's built the way it is, what was checked and how, and what's still open. The guide for users is [DIRECTOR.md](DIRECTOR.md), and the rules for the code are 89 to 94 in [.agents/AGENTS.md](../.agents/AGENTS.md).

Built on branch `feat/director` from `main` at `ccf9913`, 2026-11-24. Nothing is committed yet.

## The research

The starting point was a Reddit post in r/SideProject, "I got tired of keyframing phone mockups so now my...". Reddit refuses requests from this machine, so the post itself was never read. What's below comes from web searches and from the products' own pages, read on 2026-11-24.

- **Ultramock** (ultramock.io, made by ULTRAFORM LTD) runs in the browser on WebGL. "Set two or more camera poses and it eases between them, or mark focus areas and auto-motion composes the move for you." The user draws the focus areas on a shot and presses Compose, and the move comes out as ordinary keyframes. It has 19 devices, MP4 export through WebCodecs, and a free tier capped at 1280 by 720, 30 seconds, one video a week and a watermark. Pro is $20 a month. Its site forbids using its materials "to create a clone or competing implementation". Nothing of theirs was copied: their pages were read for facts only, and Director works differently (below).
- **Matte** (matte.app) is a Mac app that records the iOS Simulator or a device and puts the recording on a 3D iPhone. Camera moves can be keyframed, picked from presets, or planned by "an AI director".
- **Mockupreel**, **Device Frames** and **AppLaunchFlow** are keyframe editors, AppLaunchFlow with presets too.
- No product found lets the user move a real phone to move the phone in the video. The closest ideas are outside mockups: Adtile's motion ads and GoPro's MotionFrame, both reading a phone's gyroscope.

So everyone either asks for keyframes, or asks the user to say where to look. A screen recording already says where to look: the taps, the typing, the scrolls and the new screens are in its frames.

## What Director does differently

1. **It reads the recording.** No focus areas to draw. [analyze.ts](../src/lib/director/analyze.ts) compares small grey frames (160 pixels on the long side) and finds taps, typing (changes above the keyboard and on it at once), scrolls and swipes (the shift that best fits one frame onto the next), new screens and animations. [plan.ts](../src/lib/director/plan.ts) turns them into camera moves the way a person would: a close-up arrives a little before the moment so nobody misses it, close-ups that are near each other join into one pan, the share of close-ups depends on the style (Calm, Lively, Bold), a tap that opens a new screen stays wide so the new screen is seen whole, and a close-up shows either the screen's whole width or a clear part of it, never all of it but a sliver at one side. Every moment can still be changed, moved, left out or added by hand.
2. **The user's own phone is the camera rig.** A QR code opens a web page on the phone (`/remote`); the phone's motion sensor turns the 3D phone live, and a take records the moves. Nothing to install on iPhone or Android: the browser's `deviceorientation` events are enough, and Safari on iPhone asks for motion permission after a tap. The phone and the computer talk over WebRTC when they can reach each other, and through the app's live editing server (the relay in `infra/vps/mcp-relay`) when they can't. Native apps were considered and left out, because they'd add nothing the page can't do: both phones record their own screen, and the page reads the same sensors.
3. **It's light.** It draws only while the video plays or something changes, every other frame on a 120 Hz screen, with fewer pixels when frames come late, and gives the GPU back 20 seconds after the view is left. The numbers are below.
4. **It runs everywhere the app runs.** Web on computers and phones, and the desktop app. The MP4 is made in the page with WebCodecs, the same muxer the existing video export uses.

## How it fits together

- [types.ts](../src/lib/director/types.ts): the film (recording, moments, look, phone, words, sound, take).
- [sample.ts](../src/lib/director/sample.ts) and [video.ts](../src/lib/director/video.ts): read frames from the recording. Where seeking is quick (WebKit: about 6 ms a seek), it seeks to every sample; where it's slow (Chromium starts from a keyframe each time), it plays the recording at four times its speed and keeps a frame per sample, slowing down when the browser hands over too few frames.
- [analyze.ts](../src/lib/director/analyze.ts) then [plan.ts](../src/lib/director/plan.ts): moments, then camera keys. Both are pure and unit tested.
- [stage.ts](../src/lib/director/stage.ts): the three.js scene (the app's own 3D phones from `DeviceStudioRenderer`, the backdrop, two soft shadows, tap rings). [frame.ts](../src/lib/director/frame.ts) says what the stage shows at a time, for the preview and the export alike.
- [player.ts](../src/lib/director/player.ts): the hidden video is the clock while the recording plays.
- [exportFilm.ts](../src/lib/director/exportFilm.ts): its own stage at the export size, VideoEncoder, the recording's sound, mp4-muxer. It sends two test frames first and stops with a plain message if the encoder gives nothing back.
- [link.ts](../src/lib/director/link.ts), [sensors.ts](../src/lib/director/sensors.ts), [motion.ts](../src/lib/director/motion.ts): the phone link, the sensor, and the turns (quaternions, a one euro filter, the turn measured from where the user pressed Center).
- [store.ts](../src/lib/director/store.ts): films in their own Dexie database. The start screen lists every film on the device, whichever project was open when it was made.
- [project.ts](../src/lib/director/project.ts): what Director reads of the open project: its recordings, its colors for the Your colors backdrop, and the app's name for the title (the name typed for the app icon, else the project's name unless the editor made it up, such as "Blank Canvas Copy").

## What was checked

All on a MacBook Pro with macOS 26 (Darwin 25.6), 2026-11-24.

**Analysis against a known script.** Two made-up apps were drawn frame by frame (an iPhone habits app, 22 s, and an Android expenses app, 15 s), with the true time of every tap, key, scroll and screen change written to JSON beside them ([tests/e2e/fixtures/director/](../tests/e2e/fixtures/director/)). Director found 17 of the 18 scripted events in each.

**Tests.** 39 Director unit tests and 14 QR tests in [director.test.ts](../tests/unit/director.test.ts) and [qr.test.ts](../tests/unit/qr.test.ts); the whole unit suite, 1040 tests, passes. [director.spec.ts](../tests/e2e/specs/director.spec.ts) has six tests: all pass on `web` and `desktop-chromium`, and on `desktop` (WebKit) one passes and five skip, because Playwright's WebKit can't keep a Blob in IndexedDB. Three checks were run with their fix taken out, and each failed, as it should: the e2e list check (films of the open project only), and the unit tests for the title (a made-up name such as "Blank Canvas Copy" kept) and for the close-up width.

**Exports.** In Chrome with the GPU, a 23.8 s film at 1080 by 1920 took 34.1 s. In the desktop app (WKWebView), a 22.7 s film at 1080 by 1920 took 69.4 s: H.264 High, 30 fps, 681 frames, AAC sound, and the frames match the preview. In the iOS Simulator, Safari's VideoEncoder takes frames and gives nothing back, so the export stops after about 12 s with "This device stopped making the video partway. Try again, or export on a computer." On a real iPhone 14 Pro Max (iOS 26.6.2, Safari 26.6.1, driven over WebDriver from a production build served over HTTPS on the local network), Director read the 22 s recording in 6.7 s (21 moments, 5 close-ups), played at 60 frames a second, and exported the 22.7 s film at 1080 by 1920 in 141 s: H.264 High, 30 fps, 681 frames, AAC sound, frames matching the Mac's, and the dialog offered Share or save.

**The phone link.**
- A Pixel 7 page in Chrome and the desk in Chrome: the direct WebRTC path opened, the 3D phone followed, a take was recorded.
- Safari on the iOS Simulator: the page connected, and the direct path opened after about 10 s. The motion prompt needs a real tap, which no driver can give, so the sensor itself wasn't tried there.
- Chrome 133 on the Android emulator: connected through the relay, and the emulator's own accelerometer (set with `adb emu sensor set acceleration`) turned the 3D phone; a take was recorded.
- The desktop app as the desk, with a Pixel 7 page in Chrome: connected, the 3D phone followed, a 3 second take was recorded.

All of these used the repo's relay run locally on 127.0.0.1 with sign-in off.

**The desktop app.** A renamed copy of the app built from this branch, driven through its page: WebGL2, VideoEncoder, AudioEncoder and `requestVideoFrameCallback` are there; the test recording read in 5.9 s with 20 moments and 5 close-ups.

**Load, in the desktop app with its window on screen.** CPU time of the app and its WebKit helpers, over 10 second windows:

| Director | Frames drawn a second | CPU, share of one core |
| --- | --- | --- |
| Open, paused | 0 | about 5% (the same as the editor alone) |
| Playing | 72 (the web view's own rate here) | about 30% |
| Left for the editor | 0 | about 4% |

22 seconds after leaving, the canvas was marked spent and its WebGL context lost, so the GPU memory was given back.

## Not checked, and still open

- **A real phone as the rig.** Export on a real iPhone works (above), but the phone link with a real iPhone moving the 3D phone is untried: WebDriver's taps on a real iPhone arrive as touch events in the wrong order (`touchend` before `touchstart`) and never become a click, so Start can't be pressed by a script, and nobody has tapped it by hand yet. No real Android phone was tried.
- **The hosted phone page.** On the desktop app the QR code points at `https://editor.openscrgen.app/remote`, which exists only once this branch is deployed. Pairing through the hosted relay needs the user signed in (the ticket call answers 401 otherwise, and the panel offers Sign in). No TURN server is set, so phones on networks that block a direct path go through the relay, at most 30 readings a second.
- **Skipping frames on fast screens** (a frame that comes less than 12 ms after the last one drawn is skipped, so a 120 Hz screen draws at 60) hasn't been measured on a 120 Hz screen: the web view here ran at 72 Hz, where nothing is skipped.
- **Windows and Linux** desktop apps (WebView2, WebKitGTK) weren't run.
- **No trim yet.** A film has `trim` in its data, but there's no control for it: Director uses the first 90 seconds.
- **Safari on iPhone warns about hydration** on the editor's first load. It comes from `ProjectTabBar`, which this branch doesn't touch, and was there before.
- **Limelight** (`feat/limelight`) makes the same `export` keywords change to [DeviceStudioRenderer.tsx](../src/components/open-screenshot-generator/elements/DeviceStudioRenderer.tsx) as this branch, line for line, so whichever merges second should merge clean there.

## Ideas for next

- A trim control on the timeline, and more than 90 seconds for films with a long hold.
- Reading a recording's own touches: Android's "Show touches" and the Simulator's touch dots would give exact tap points.
- Several recordings in one film, cut together on screen changes.
- Music with beats the camera moves land on.
