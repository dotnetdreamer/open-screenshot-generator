# Director: research and hand-over

Director turns a screen recording of an app into a video of a 3D phone, with the camera moves worked out from the recording. It can also take its moves from a phone the user holds. This file says why it's built the way it is, what was checked and how, and what's still open. The guide for users is [DIRECTOR.md](DIRECTOR.md), and the rules for the code are 89 to 95 in [.agents/AGENTS.md](../.agents/AGENTS.md).

Built on branch `feat/director` from `main` at `ccf9913`, 2026-11-24. The first round is commit `56e66cc`, pushed on 2026-11-24. The later rounds and the audit's fixes (below) aren't committed yet.

## The research

The starting point was a Reddit post in r/SideProject, "I got tired of keyframing phone mockups so now my...". Reddit refuses requests from this machine, so the post itself was never read. What's below comes from web searches and from the products' own pages, read on 2026-11-24.

- **Ultramock** (ultramock.io, made by ULTRAFORM LTD) runs in the browser on WebGL. "Set two or more camera poses and it eases between them, or mark focus areas and auto-motion composes the move for you." The user draws the focus areas on a shot and presses Compose, and the move comes out as ordinary keyframes. It has 19 devices, MP4 export through WebCodecs, and a free tier capped at 1280 by 720, 30 seconds, one video a week and a watermark. Pro is $20 a month. Its site forbids using its materials "to create a clone or competing implementation". Nothing of theirs was copied: their pages were read for facts only, and Director works differently (below). It also has preset moves ("Enter, Move and Exit moves", its changelog for 4 November 2026).
- **Matte** (matte.app) is a Mac app that records the iOS Simulator or a device and puts the recording on a 3D iPhone. Camera moves can be keyframed, picked from presets, or planned by "an AI director". When Matte makes the recording itself, it can also add zooms that follow the taps ("Create Clips After Recording adds zoom clips that follow your taps", its help page for recording the Simulator, read on 2026-11-25). Its help lists its automatic camera moves under the name Director.
- **Mockupreel**, **Device Frames** and **AppLaunchFlow** are keyframe editors, AppLaunchFlow with presets too.
- No product found lets the user move a real phone to move the phone in the video. The closest ideas are outside mockups: Adtile's motion ads and GoPro's MotionFrame, both reading a phone's gyroscope.

So most of them ask for keyframes or presets, or ask the user to say where to look. Matte comes closest: it follows the taps in recordings it makes itself. Director reads where to look from any screen recording, whatever made it: the taps, the typing, the scrolls and the new screens are in its frames.

## What Director does differently

1. **It reads the recording.** No focus areas to draw. [analyze.ts](../src/lib/director/analyze.ts) compares small grey frames (160 pixels on the long side) and finds taps, typing (changes above the keyboard and on it at once), scrolls and swipes (the shift that best fits one frame onto the next), new screens and animations. [plan.ts](../src/lib/director/plan.ts) turns them into camera moves the way a person would: a close-up arrives a little before the moment so nobody misses it, close-ups that are near each other join into one pan, the share of close-ups depends on the style (Calm, Lively, Bold), a tap that opens a new screen stays wide so the new screen is seen whole, and a close-up shows either the screen's whole width or a clear part of it, never all of it but a sliver at one side. Every moment can still be changed, moved, left out or added by hand. A moment left out gets no close-up, caption or tap ring, and the camera doesn't move for it.
2. **The user's own phone is the camera rig.** A QR code opens a web page on the phone (`/remote`); the phone's motion sensor turns the 3D phone live, and a take records the moves. Nothing to install on iPhone or Android: the browser's `deviceorientation` events are enough, and Safari on iPhone asks for motion permission after a tap. The phone and the computer talk over WebRTC when they can reach each other, and through the app's live editing server (the relay in `infra/vps/mcp-relay`) when they can't. Native apps were considered and left out, because they'd add nothing the page can't do: both phones record their own screen, and the page reads the same sensors.
3. **It's light.** It draws only while the video plays or something changes, every other frame on a 120 Hz screen, with fewer pixels when frames come late, and gives the GPU back 20 seconds after the view is left. The film pauses when the view is left, and nothing plays it again until the view is back. The numbers are below.
4. **It runs everywhere the app runs.** Web on computers and phones, and the desktop app. The MP4 is made in the page with WebCodecs, the same muxer the existing video export uses.

## How it fits together

- [types.ts](../src/lib/director/types.ts): the film: its clips (each a part of one recording, with that recording's moments, activity and pictures in its own seconds), look, phone, words, sound and take.
- [timeline.ts](../src/lib/director/timeline.ts): everything about clips: where each sits in the film, film seconds to recording seconds and back, the film's moments worked out from its clips, and every edit (add, split, trim, move, take out, change a clip's recording, change the recording from a point), each a pure function with unit tests. It also upgrades films saved before clips.
- [templates.ts](../src/lib/director/templates.ts): the starting points (eight since the fourth round), and [DirectorStart.tsx](../src/components/open-screenshot-generator/director/DirectorStart.tsx) the steps into a new film. [placeholder.ts](../src/lib/director/placeholder.ts) draws the stand-in screen for a film whose moves come first.
- [sample.ts](../src/lib/director/sample.ts) and [video.ts](../src/lib/director/video.ts): read frames from the recording. Where seeking is quick (WebKit: about 6 ms a seek), it seeks to every sample; where it's slow (Chromium starts from a keyframe each time), it plays the recording at four times its speed and keeps a frame per sample, slowing down when the browser hands over too few frames. Which one is judged by the middle of the first six seeks, the seeks alone (`seeksAreQuick`); see the audit section for why.
- [analyze.ts](../src/lib/director/analyze.ts) then [plan.ts](../src/lib/director/plan.ts): moments, then camera keys. Both are pure and unit tested.
- [stage.ts](../src/lib/director/stage.ts): the three.js scene (the app's own 3D phones from `DeviceStudioRenderer`, the backdrop, two soft shadows, tap rings). [frame.ts](../src/lib/director/frame.ts) says what the stage shows at a time, for the preview and the export alike.
- [player.ts](../src/lib/director/player.ts): a hidden video for each recording; the playing clip's video is the clock, and the next clip's video waits at its first frame, so a cut is instant.
- [exportFilm.ts](../src/lib/director/exportFilm.ts): its own stage at the export size, VideoEncoder, the recording's sound, mp4-muxer. It sends two test frames first and stops with a plain message if the encoder gives nothing back.
- [link.ts](../src/lib/director/link.ts), [sensors.ts](../src/lib/director/sensors.ts), [motion.ts](../src/lib/director/motion.ts): the phone link, the sensor, and the turns (quaternions, a one euro filter, the turn measured from where the user pressed Center).
- [store.ts](../src/lib/director/store.ts): films in their own Dexie database. The start screen lists every film on the device, whichever project was open when it was made.
- [project.ts](../src/lib/director/project.ts): what Director reads of the open project: its recordings, its colors for the Your colors backdrop, and the app's name for the title (the name typed for the app icon, else the project's name unless the editor made it up, such as "Blank Canvas Copy").

## The second round: templates, moves first, and the timeline editor

The user asked, on 2026-11-24, for a start that picks a template first, then lets the user choose between adding the recording first or recording the moves first (adding the recording later), and for a timeline that can change the recording at any point, from the panel too. Then: the code for the phone should show as soon as a film made moves first opens.

- **Templates.** Six starting points (Launch, Feature tour, Social ad, Website hero, Just the phone, and Your colors when the project has colors), each a shape, a camera, a backdrop and words. Each card shows a still and plays a 5.5 s loop while pointed at, except Your colors: it's made from the project's own colors, so it shows a still phone in them. The loops and stills in `public/director/templates/` (0.44 MB together) were made from a film of each template, through Director's own flow in Chrome with the GPU (template, recording first, a made-up app's recording, a title, Export), its first 5.5 s cut to 416 pixels high with libx264 at CRF 30, and a still at 2.4 s saved as WebP at quality 74. The script lived in a session scratchpad: a changed template needs its loop made again the same way.
- **Clips.** A film is a row of clips. Splitting, trimming (drag a clip's ends, or the range in the panel), moving (drag, or the arrows), taking one out, changing a clip's recording, and changing the recording from the playhead (split there, then the new recording from there on; at the end it's added) are all on the timeline's toolbar or the clip's panel, with the keyboard (S splits, Delete takes out what's picked, the arrows step), and all undo. The recordings together stay within 90 seconds.
- **Cuts.** Where one recording gives way to the next, the planner sees a new screen, so the camera swings to the other side, and no close-up (nor a pan joining two) runs across a cut. A unit test checks every style, and it fails when the planner is given no cuts.
- **Moves first.** The film runs a chosen length (10 to 60 seconds, 15 to begin with) against a stand-in screen, the code for the phone shows at once (on a computer), and a take stopped early sets the length. The recording added later takes over the length and plays inside the moves.

Found and fixed on the way:
- **Short taps disappeared.** The first version of the film's moments left out anything under 0.2 s, and most taps are shorter: 20 moments became 14 or 15. Now only a moment a clip's end cuts into needs 0.2 s to stay.
- **Reading starved by its own progress bar.** Each reading update drew the whole editor again, about 40 times a second, and the reader lost frames: 10.7 to 12.9 s and 18 to 20 moments for the 22 s recording, against 5.3 to 6.5 s and 20 moments every time once updates were held to five a second. Reading also waits until the film's videos have loaded, and the film pauses while a recording is read.
- **The code didn't show in development.** React runs effects twice there, with the panel's own disconnect between the runs, so a one-time "connect now" from the view was spent on the first run. The panel now connects from an effect of its own, and a connect that a newer one overtook closes its link.

Measured on 2026-11-24 in Chrome with the GPU: a film of two recordings (8.8 s of the habits app, then the 15 s expenses app, with words) exported in 38.2 s, 1080 by 1920, 767 frames (25.6 s: 8.8 + 15 + the 1.8 s end), AAC sound, the habits app before the cut and the expenses app right after it. The code showed 0.5 s after Record the moves first (measured once, with the relay run locally).

## The third round: moving the phone closer

Asked on 2026-11-24, after the user tried the phone link on their own iPhone ("the left right etc is working fine"): forward and back too. Bring the phone toward you and the phone in the video comes toward the camera; take it away and it goes back.

- **How.** The motion sensor's acceleration along the screen's axis ([depth.ts](../src/lib/director/depth.ts)), with no camera and no new permission (iPhone asks for motion and orientation in the one question). Adding acceleration up drifts, so: the speed goes to zero whenever the phone is still, the sensor's resting reading is learned and taken off, tiny readings are ignored, nothing counts while the phone turns fast, and the reach is 40 cm either way. 20 cm closer is about 1.6 times; pinch still works on top, Center starts both again, and a switch on the phone page turns it off.
- **iPhone's signs.** Safari on iPhone reports acceleration with the opposite signs to the standard (lying flat face up it reads -9.81 where Chrome on Android reads +9.81); taken as it comes, a push toward you would have moved the phone in the video away. `AxisSense` works out which way a phone counts from its own readings at rest, against the up its orientation gives.
- **Checked.** Unit tests: a 20 cm push reads 13 to 23 cm and stays put while held (under 1 cm in 2 s), a push away reads back, four shakes end within 5 cm of the start, 20 s held still with a noisy, offset sensor drifts under 2 cm, a fast turn adds nothing, and the sign is read right flat, upright and tipped, for both kinds of phone. An e2e test sends a push to the phone page and the 3D phone on the computer zooms in (it fails with the distance taken out). The whole path the user's iPhone takes was run with a stand-in phone page: over HTTPS on the local network, through the relay, to the desk: 1.5 times after a 20 cm push.
- **Not checked.** On a real phone's real sensor: how a real hand's push reads, and whether iPhone's sign is read right in practice.

### Forward and back, on or off

The user, after trying it: "give a user choice to turn on/off forward and back. because sometimes its not perfect and causing disturbance". So it's a choice now, and off unless turned on.

- **Where.** **Forward and back** under **Move it by hand** on the computer (with the phone connected or a take kept), and the same switch on the phone page. The computer's setting is the one that counts (`handDepth` on the film, saved with it); the phone shows it and can ask to change it.
- **What off means.** The phone doesn't send the distance at all, and a take recorded with it on plays without it. Turning it on starts the distance from where the phone is, so the picture doesn't jump.
- **Fixed on the way.** While a phone moved the film live with an older take in use, the preview multiplied the take's zoom by the phone's, so what you saw while recording wasn't what the new take played. The live phone now replaces the take in `stageFrameAt`, through the same limits.
- **Checked.** Unit tests: a take held 20 cm closer plays at the planned distance with it off and `depthZoom(0.2)` closer with it on, a pinch still counts with it off, a live phone shows exactly what a take of the same moves would (on and off, with an older take in use), the limits, and the distance kept per sample. Each fails when its rule is broken. An e2e test runs the whole path: off at first on both screens, a push does nothing, on at the computer shows on the phone with no jump, a push moves in, a take keeps it, off on the phone turns the computer's switch off and the take goes back to the planned framing. Five deliberate breaks each fail it: the phone ignoring the computer, the computer ignoring the phone, no restart of the distance, the take ignoring the switch, the distance not sent.

## The fourth round: templates after two app ads

Asked on 2026-11-24: watch two YouTube Shorts frame by frame and make an award winning template like them, then "allow the user flexibility to change things easily even if functionality is missing, add it".

**What the two Shorts do** (downloaded with yt-dlp; all 708 and 322 frames taken out at 30 fps, and read as contact sheets of every third frame):
- An e-book app's ad, 10.7 s, 1080x1920. Black. It opens on an extreme close-up of the screen at a steep angle, drifting, then pulls back fast with motion blur to a small phone in the middle. Then another close-up, another fast pull-back, and a big two-line headline in warm cream at the top left over the phone lying at an angle. The phone spins in from side on under a second headline, big and cut off by the bottom edge. It ends by fading to white on the logo, the name and the two store badges.
- An ad for a video maker's app template, 23.6 s. A pale grey room with big violet circles growing in from the corners, the app's icon in a badge with rings going out from it, and a wall of tilted phones sliding in. Bold capitals sit at the bottom with one word in yellow, changing every second or so. A single phone stands beside a word that changes (Modern, Creative, Intuitive) as its screen slides to the next one, and it pulls back to a fan of three phones. It ends on the icon, the name and the badges over the phones.

**What was built**, so a Director film can look like either, with every part a setting you can change:
- **Cinematic camera** ([plan.ts](../src/lib/director/plan.ts)): opens close at a steep angle with a wider lens (a pose has a `lens` now), drifts, then whips back. Close-ups are steeper and push in while they hold. Wide shots go big and low under words, and stay whole and centred without them. Each new recording cuts to the phone side on, and it spins in. No close-up while words show, so words never sit over the screen. The title waits for the pull-back, and early captions wait their turn.
- **Motion blur** in the exported video ([frame.ts](../src/lib/director/frame.ts) `blurTimes`): a fast move averages up to 8 pictures across half a frame, a held shot is one picture, and nothing blurs across a cut.
- **Words styles** ([overlay.ts](../src/lib/director/overlay.ts)): Soft (as before), Headline, Bold captions; `*stars*` mark the highlight in all three (the end card's line is drawn in one colour); Words and Highlight colours of the user's own.
- **Icon and end card**: the user's icon (made square, at most 384 pixels, kept on the film); the icon in the top corner with rings in wide shots; an end card on white or over the backdrop with the icon, the name, the end words and Apple's and Google's own badges ([public/director/badges/](../public/director/badges/), downloaded from developer.apple.com and play.google.com on 2026-11-24). The badges are never animated, App Store first, the same height, with a quarter of their height clear between them. They are the English badges only. Over the backdrop, the phone goes down under the card and the backdrop's discs shrink away.
- **Backdrops**: Noir (black, lit from above) and Bloom (pale, with two violet discs that grow in). A backdrop's glow can be a solid disc now. Its colour is passed to the shader as written, since the backdrop shader shows its numbers as they are; the soft glows keep the converted colours the older backdrops were tuned with.
- **Templates**: Cinematic (Noir, Headline, white card) and Pop promo (Bold camera, Bloom, Bold captions, the icon at the top, a card over the backdrop), first in the gallery.

**Left out**: the second Short's wall of phones, its fan of three and its strip of screens sliding behind the phone all need more than one phone on the stage, which Director doesn't have yet. Its circle wipes between scenes are left out too.

**Checked**:
- Unit tests:
  - the stars
  - each style's colours and the user's own
  - both templates' films
  - Cinematic's opening, close-ups, words-aware wide shots, queued captions and the spin at a cut
  - blur times
  - the card's timing, the room it makes and the discs clearing
  - the badges' rules, through a recording 2D context
  - bold captions' capitals, outline and highlight
- Breaking the code on purpose: 12 breaks, 11 failed a test. The twelfth was a filter that the later "no close-up under words" rule made dead, so it was removed.
- E2e: Cinematic (its settings, the icon, the white card's brightness at the end, Noir's black with the card over it, yellow only with Bold captions and in the bottom band, a green highlight set by hand) and Pop promo (violet discs and yellow words partway, the discs gone at the card, kept when the card is off). The export test now ends on a white card and checks the file's last frame for white, the icon's orange and the badges' black. It passed, and four breaks each failed their e2e test:
  - the white card not drawn
  - bold captions drawn as Soft
  - the discs kept for the card
  - the export drawing the card without its pictures
- In the desktop app (WKWebView, driven through the test bridge), both templates ran from the gallery with the small habits recording and the icon:
  - Cinematic's steep opening close-up and its cream title
  - Cinematic's white card, with Apple's SVG badge and Google's PNG badge drawn crisp on the canvas (the overlay 90% white and 3% dark)
  - Pop promo's bold title with the starred word in yellow, the corner icon and violet discs
  - Pop promo's card over the pale room, with the discs gone and the phone under it
- Both templates were exported in Chrome with the GPU from the made-up habits app and read as contact sheets at 4 frames a second, three times over, fixing what looked wrong each time:
  - the title over the bright opening close-up
  - the end card too small
  - white words on a pale card
  - badges on the phone
  - the icon on the phone's screen
  - a violet disc behind the name
  - captions out of order
  - a close-up under a queued caption

## The audit, 2026-11-25

An outside audit of the hand-over read the code and the saved evidence, and used the editor in Chrome. It found four things that didn't hold, all fixed the same day:
- **A left-out moment still moved the camera.** Leave out took away the close-up, the caption and the tap ring. But the wide shot still swung for a left-out new screen, leaned in for a left-out scroll and pushed in for a left-out pause. Cinematic could also open close on a left-out tap. The planner now passes over them (`holdWide` and `openingPlace` in [plan.ts](../src/lib/director/plan.ts)).
- **A film could play out of sight.** Reading a recording again pauses the film, then plays it again after. If Director was left meanwhile, the film played behind the editor, sound and all, after the stage had been given back. Now the player is `hidden` while Director is out of sight: it pauses, and nothing plays it until Director shows again. That covers a reading that ends, a film that starts once it's read, and a phone's Record.
- **Sign in was behind Cancel.** Signed out, the hosted ticket call answers 401, and the panel said "Not connected" with Cancel. Sign in showed only after Cancel. Now the note and its button show at once, and the moves-first card stops saying to scan a code that isn't there.
- **Forward and back waited for a tilt.** The distance went to the computer only with a turn reading. Browsers send one only when the phone's angle changes, so a straight push could show late and then jump. The distance now goes out from the motion readings too, once it has moved a millimetre, at most once every 15 ms. This may be the jumpiness the user saw. It hasn't been tried on a real phone yet.

Found while checking the fixes in the desktop app (the test copy, driven through the bridge):
- **Reading in the desktop app found only new screens.** With Director on screen, reading the habits recording again gave 7 moments, all new screens, where it had given 17 to 20. The reader times its first six samples to choose between seeking and playing. The first picture it drew took 1003 ms there (then 3 to 15 ms), and that was counted in, so the average came to about 190 ms and it played instead. Playing in that web view drew the same picture over and over: 177 of 186 frames were identical, so only the big jumps showed. Now only the seeks are timed, and the middle one counts (`seeksAreQuick` in [sample.ts](../src/lib/director/sample.ts)). Two re-reads in view then found 18 moments each (5 new screens, 5 taps, 5 scrolls, typing, 2 animations), in 6.0 to 6.4 s instead of 7.7 to 8.2 s. Chrome still plays (its seeks are slow), and its reading tests pass. Not re-checked on an iPhone, where the same rule now decides.

Also corrected here: the research (Matte follows taps in its own recordings, Ultramock has presets), the stale "no trim yet" (clips have been trimmed since the second round), the review of the Shorts (every third frame), the Your colors card (a still, no loop) and the badges (English only).

Checked:
- **Unit tests:** both planner rules in every style, and a straight push through a stand-in window with no orientation event. The push test checks at most one reading a frame, and nothing sent while held still. Five deliberate breaks each failed one of them. The reader's choice is tested with the seek times measured in the desktop app, and two more breaks failed it: the average for the middle, and seeking always quick.
- **The desktop app** (the test copy loading this worktree, the real hosted server for the sign-in, the local relay for the push):
  - A film playing, Read again, then the editor while it read: the reading ended out of sight, and the film stayed paused. Back in Director it was paused, and one press of Play played it.
  - Leave out on the new screen at 1.7 s: the picture at 2.7 s changed by 23 levels (the swing gone), and Undo brought it back exactly.
  - Signed out, moves first: the sign-in note and its button showed 1.2 s after the click, with no Cancel or "Not connected", and the card said to connect.
  - A 20 cm push with no orientation event during it: the picture on the computer moved in (80 levels of change), and the phone page showed 1.5 times.
- **E2e tests:**
  - a film left playing during a reading stays paused out of sight, and plays when asked once Director is back
  - signed out, moves first shows the sign-in at once and asks the server no more
  - the forward and back test now pushes with no tilt after it
- **E2e breaks:** five deliberate breaks each failed its test at the step meant to catch it.

Not changed: in a very busy stretch the timeline's pills can still overlap once both rows are full, and the end card's line ignores stars.

## The second audit, 2026-11-25

The same auditor re-checked the fixes, in Chrome and in a native macOS WKWebView of its own. It found:
- **The reader still failed with the window covered.** Read again gave 7 new screens once out of three, with the window covered. Reproduced in the desktop app with the app hidden: 1 read in 5 came out as 6 new screens. Each of that read's first seeks waited the full 1.5 s and got no 'seeked' (1579 to 1700 ms), so the reader took them for slow seeking and played instead. Playing gave stale pictures (179 of 186 frames the same). Covering the window with another app's window, the page stayed "visible", and 5 of 5 reads were right. Hiding the app made it "hidden". **Fix:** nothing is read while the page is hidden (`whenSeen` in [sample.ts](../src/lib/director/sample.ts)). The reader waits before loading, before each seek, and when playing stops because the page hid. A seek cut short by hiding is done again, and its time isn't counted. In the desktop app, every reading hidden at the start or partway came out right (17 or 18 moments of every kind, as in view), and all but one held their progress while hidden. That one finished during the 10 s it was meant to be hidden, for a reason not found. The times I gave then (0.8 to 3.4 s after the app came back) were measured from too late; the third audit's section has them measured properly.
- **A left-out new screen still kept the tap before it wide.** The rule "a tap that opens a new screen stays wide" still saw the left-out screen. **Fix:** the planner drops left-out moments where it starts (`planFilm`), so a left-out moment is as if Director never found it, everywhere at once.
- **A play still on its way could run on muted.** When Director was hidden while `video.play()` was pending, the pause cut that play short. The player then took the rejection for "no sound allowed" and played the video muted, unseen, while the film said paused. **Fix:** it plays muted only for that refusal (`NotAllowedError`), and only while the film still plays. A video whose play lands after a pause is paused again.
- **The moves-first card said "Scan the code" after the phone had connected.** It now says the phone is connected (`onConnectedChange` from the panel).
- **Read again brought back moments the user had deleted.** A deleted found moment now stays on its clip, marked `removed`, so a new reading doesn't bring it back. A found moment of another kind there still comes in. A moment the user added just goes.
- **My report:** the typecheck had 139 errors (121 in promo/ and 18 in promo-i18n/), not 121. My count's pattern skipped the folder with digits in its name. The evidence index lacked the final WebKit log.
- **The guide** still said every template plays a sample and the code always comes up; and this file still called a real iPhone as the rig untried, though the user had used theirs.

Checked:
- **Unit tests:**
  - the auditor's Leave out case
  - a deleted moment through a new reading (it stays gone; a tap inside its stretch stays)
  - `whenSeen` with a stand-in page
  - the playing path with a stand-in video: it stops the moment the page hides, and never starts on a hidden page

  Eight deliberate breaks each failed one of them.
- **E2e tests:**
  - a reading hidden at the start and partway, which holds its progress and finishes with taps, scrolls and typing once seen
  - a play still on its way when Director is left
  - the moves-first card after a phone connects

  Breaks of the card, of the reading's wait, and of the player taken back to its old code each failed their test. Two partial breaks passed, for reasons that hold: one of the player's two guards alone still stops the video, and Chrome now reads the test recording by seeking, so the playing path is covered by the unit test instead.
- **The desktop app:**
  - 12 of 12 readings with the app hidden came out right; one of them finished while the app was meant to be hidden.
  - Lively: the tap at 5.3 s, kept wide by the new screen at 5.5 s, got its close-up when that screen was left out, and Undo took it back.
  - The scroll deleted at 3 s stayed deleted through Read again and through an automatic reading.
  - A play held on its way, then the editor: nothing played. Back in Director, one press of Play played it.
  - The card said the phone was connected, with no Use your phone, once a phone page connected through the local relay.

  With the window on another desktop, the page was suspended outright: the reading waited, and the bridge got no answer. The app was then relaunched, so that reading carrying on after switching back wasn't seen.

## The third audit, 2026-11-25

The auditor checked the second round's fixes, in Chrome and in a native WKWebView of its own, and found:
- **Read again still lost edits.** The second round matched a new reading to the user's moments by where those moments were now. So in the auditor's three cases:
  - A scroll moved onto another scroll, then deleted: after Read again, the deleted one came back and the untouched one went.
  - A close-up the user added at 5.2 s and left out: it hid the tap and the new screen it covered.
  - A close-up the user added, moved across a cut, then deleted: it became `c2-u2_2` and was taken for a found moment, so the tap under it went on reading again.

  **Fix:** a moment Director finds now keeps where it found it (`found`: the recording, the kind and the time), however the user moves or changes it. A new reading leaves out only its own copy of each moment the user edited, moved or deleted, wherever that moment is now, in any clip. A moment the user added has no `found` and hides nothing. Delete keeps a found moment as `removed`, with its `found`. An added one just goes, whatever its id became.
- **The reader kept a frame drawn after the window hid.** WebKit answered a seek 136 ms after the page hid, and the reader kept that frame. Now a sample whose seek ends with the page hidden is read again once the page is seen, even if it landed. A frame that comes while the page is hidden, before its `visibilitychange`, ends playing.
- **The moves-first card said "Scan the code" with no code on screen,** after Disconnect, or after a failed try and Cancel. The panel now reports where the link stands (off, sign-in needed, code up, failed, connected), and the card's words and buttons follow it: Sign in, Try again, Use your phone.
- **A phone's Record with Director hidden sent the film back to the start.** The take seeked to 0 before finding it couldn't play. It now does nothing while Director is hidden.
- **My report:** the recovery times were measured from too late and included a 0.8 s wait. One "held" reading had finished while hidden. The other-desktop reading carrying on after switching back wasn't seen. The evidence index lacked `guard.log` and `runs.log`.

Checked:
- **Unit tests:** the auditor's three cases with the real timeline functions, a moment moved and found again (shown once), a found moment moved into the next clip with the first clip read again, a seek that lands after the page hid, and a frame before `visibilitychange`. Seven deliberate breaks each failed one of them, after two of my tests were fixed: one deleted the split's hidden copy instead of the moved close-up, and one counted the user's own close-up as the tap.
- **E2e tests:** the card after Disconnect, a failed try (Try again asks the server again, Cancel, then the code), the signed-out card with its own Sign in, and a phone's Record with Director hidden (the time stays at 2 s). Four deliberate breaks each failed their test at the step meant to catch it.
- **The desktop app:**
  - The auditor's three cases on new films of the habits recording, with real drags on the timeline: the deleted 3.0 s scroll stayed gone and the 6.9 s one stayed; the tap at 5.3 s and the screen at 5.5 s stayed beside the left-out close-up; the close-up dragged across the cut (`c2-u1_2`) and deleted left the tap at 10.4 s through Read again.
  - The card in every state: Couldn't connect with Try again, Connect after Cancel, the code, connected, and Connect after Disconnect, with no code on screen.
  - A phone's Record with Director hidden left the film paused at 2 s.
  - Readings hidden at the start or partway, 12 rounds: each held its progress for the 8 s it was hidden, and finished 2.7 to 6.9 s after the page was seen again, measured in the page, with every kind of moment.

## The fourth audit, 2026-11-25

The auditor confirmed the third round's fixes, including Record from the phone with Director hidden. It found:
- **Read again could still remove the wrong moment.**
  - Two taps 0.1 s apart: deleting one removed both on reading again, since one decision could stand for every moment within its 0.2 s allowance.
  - Two clips showing the same part of a recording: a delete in one removed the other's untouched moment, since decisions were collected from every clip.
  - A film read before today, its first edit made today: the moved and deleted tap came back, and the tap it was moved onto went, since that moment had no record of where it was found.
  - A moment moved into a clip that was then taken out came back where it was found.

  **Fix:**
  - Each decision stands for one moment of a new reading, the closest one found again.
  - Only the clip being read counts: a moment moved into another clip leaves a deleted copy in its own clip, which stands for it even once the other clip is gone, and the moved one (`movedIn`) stands for nothing where it lands.
  - The first edit of a moment read before today writes down where it was found, from where it still is.
- **Delete straight after dragging across a cut did nothing:** the moved moment had a new id and the picked one was the old. `retimeMoment` gives back the new id, and what's picked follows it.
- **Two wrong card states:**
  - While the ticket was on its way the card said "Scan the code" with no code on screen; it now says it's getting the code ready.
  - A late refusal of an older try took over a connected phone (Sign in shown, Disconnect gone). An answer to a try that a newer one overtook is now ignored.
- **Slow seeks while visible could still give stale pictures.** Seeks slower than 25 ms make the reader play, and playing in WKWebView hands over old pictures. Now when most frames that playing gave are the same as the one before, six are drawn again by seeking. If two or more differ, that part is read again by seeking (`playedTrue`).
- The evidence index lacked the dev server logs.

Checked:
- **Unit tests:** each of the auditor's cases with the real timeline functions (close taps, clips sharing a part, an older film, a clip taken out), a moved moment standing for nothing where it lands and giving its new id, and the check on playing (old pictures caught, a recording that holds still passes). Six deliberate breaks each failed one of them.
- **E2e tests:** Delete straight after a real mouse drag across a cut; the card while the code is on its way; a late 401 after a phone connected. Three deliberate breaks each failed their test at the step meant to catch it.
- **The desktop app:**
  - Clips sharing a part: the second clip stretched back to 0, so the scroll showed at 3.0 s and 9.8 s. Deleting the first left the second through its own Read again.
  - A film from yesterday: its 1.5 s tap dragged onto 5.3 s and deleted stayed deleted, and the 5.3 s tap stayed.
  - A tap dragged into the next clip, that clip taken out: the first clip read again didn't bring it back.
  - Delete straight after a drag across the cut removed the close-up.
  - With every seek answered 40 ms late, the reader played: 173 of 180 frames were the same, and 6 of 6 checks were wrong. It read that part again by seeking and found all 17 moments of every kind, in 20.1 s.
  - With the page's ticket requests held: "Getting the code for your phone ready." and no code. After a phone connected, the held requests refused late changed nothing.

  The two taps 0.1 s apart weren't tried in the app: the habits recording has no two moments of one kind that close, so the unit test holds that case.

## What was checked

All on a MacBook Pro with macOS 26 (Darwin 25.6), 2026-11-24.

**Analysis against a known script.** Two made-up apps were drawn frame by frame (an iPhone habits app, 22 s, and an Android expenses app, 15 s), with the true time of every tap, key, scroll and screen change written to JSON beside them ([tests/e2e/fixtures/director/](../tests/e2e/fixtures/director/)). Director found 17 of the 18 scripted events in each.

**Tests.** 50 Director unit tests and 14 QR tests in [director.test.ts](../tests/unit/director.test.ts) and [qr.test.ts](../tests/unit/qr.test.ts); the whole unit suite, 1051 tests, passes. [director.spec.ts](../tests/e2e/specs/director.spec.ts) has nine tests (the second round added a template with the recording first, two recordings edited on the timeline, and moves first); WebKit skips all but the phone page's own test, because Playwright's WebKit can't keep a Blob in IndexedDB. All nine pass on `web` and `desktop-chromium` (18 runs, 13.8 minutes on 2026-11-24). The moves-first test was run with the code's automatic start taken out, and failed, as it should; so were the unit tests for cuts (the planner given none) and for a take's length (the rule before its fix). Three checks were run with their fix taken out, and each failed, as it should: the e2e list check (films of the open project only), and the unit tests for the title (a made-up name such as "Blank Canvas Copy" kept) and for the close-up width.

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

22 seconds after leaving, the canvas was marked spent and its WebGL context lost, so the GPU memory was given back. The audit (below) found a way the film itself could start playing again out of sight, since fixed.

## Not checked, and still open

- **A real phone as the rig.** The user moved the 3D phone with their own iPhone through the code on 2026-11-24 ("the left right etc is working fine"), before forward and back existed. No script can do it: WebDriver's taps on a real iPhone arrive as touch events in the wrong order (`touchend` before `touchstart`) and never become a click, so Start can't be pressed. Still untried with a real hand: a take recorded on a real phone, and forward and back on a real sensor, the second audit's fix included. No real Android phone was tried.
- **The hosted phone page.** On the desktop app the QR code points at `https://editor.openscrgen.app/remote`, which exists only once this branch is deployed. Pairing through the hosted relay needs the user signed in (the ticket call answers 401 otherwise, and the panel offers Sign in). On 2026-11-25 the audit found the hosted page answering 404 and the hosted ticket call 401 when signed out, as expected before a deploy. No TURN server is set, so phones on networks that block a direct path go through the relay, at most 30 readings a second.
- **Skipping frames on fast screens** (a frame that comes less than 12 ms after the last one drawn is skipped, so a 120 Hz screen draws at 60) hasn't been measured on a 120 Hz screen: the web view here ran at 72 Hz, where nothing is skipped.
- **Windows and Linux** desktop apps (WebView2, WebKitGTK) weren't run.
- **Apple's rules for its products.** The App Store badge is drawn as Apple asks. But Apple's marketing guidelines also list "Rendering in 3D or creating any simulation of an Apple product" among the uses they don't allow, and Director's phone is a 3D iPhone, like the editor's 3D frames and other 3D mockup tools.
- **Badges in other languages.** Google asks for the badge in the campaign's own language when it isn't English. Director has the English badges only.
- **Safari on iPhone warns about hydration** on the editor's first load. It comes from `ProjectTabBar`, which this branch doesn't touch, and was there before.
- **Limelight** (`feat/limelight`) makes the same `export` keywords change to [DeviceStudioRenderer.tsx](../src/components/open-screenshot-generator/elements/DeviceStudioRenderer.tsx) as this branch, line for line, so whichever merges second should merge clean there.

**Since the second round, also open:**
- **A phone for each recording.** The phone follows the first recording, so an Android recording after an iPhone one plays on the iPhone.
- **No speed change or fades** between recordings: the camera's swing is the only way a cut is marked.
- **The previews' maker isn't in the repo** (above): it took the app's own export through Playwright, then ffmpeg and sharp.
- **The second round on a real iPhone.** It was checked in Chrome (GPU and Playwright's software WebGL) and in the desktop app (WKWebView, dark theme, 1512 by 823 window, driven through the bridge on 2026-11-24: the templates, the start choice, moves first with the code up at once, adding a recording, the recording changed from 8 s, the export dialog), not on a real iPhone. The desktop pass found and fixed: a range in the clip panel with one handle (the app's shared slider draws one, so Director has its own with two), moment pills piling up in busy stretches (now pills only for what the camera does and markers for the rest, in two rows; in a very busy stretch they can still overlap once both rows are full), a wide template preview with bands, and a film made moves first opening on its cropped first frame.

## Ideas for next

- More than 90 seconds for films with a long hold.
- Reading a recording's own touches: Android's "Show touches" and the Simulator's touch dots would give exact tap points.
- Several recordings in one film, cut together on screen changes.
- Music with beats the camera moves land on.
