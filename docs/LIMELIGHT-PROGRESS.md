# Limelight: progress and plan

Limelight is the activity bar's view for filming the user's app on real 3D phones and tablets with a real camera, for App Store previews and promo videos. This file is the hand-over between sessions: what is built, how it fits together, what was checked, and what comes next. Update it at the end of every step.

- Branch and worktree: `feat/limelight` in `.claude/worktrees/limelight` (made from `main` at 5efbe6d on 2026-11-19). Committed on the branch on 2026-11-20, not merged into `main` or pushed.
- Code: `src/lib/limelight/` (the model, the maths, the stage) and `src/components/open-screenshot-generator/limelight/` (the view).
- User guide, in plain words: `docs/LIMELIGHT.md`.

## Status

| Step | What | State |
| --- | --- | --- |
| 1 | The stage: data model, animation maths, three.js stage, the view (scenes, viewport, timeline, inspector), saving on the device, a still picture | Done 2026-11-19 |
| 2 | Templates: a gallery of ready scenes that fill with the user's screenshots, saving a scene as one's own template, the director's view of the camera path | Done 2026-11-19 (titles' word reveal moved to the polish list) |
| 3 | AI agents: MCP tools for scenes, the agents' brief and skill, the agent looking at a frame, Ask AI in the view | Done 2026-11-19 (Ask AI not yet run with a real agent) |
| 4 | Google Drive: save and open scenes with their pictures in the user's Drive, resumable uploads ready for video | Done 2026-11-19 (against a fake Drive; no real account used) |
| 5 | Video: MP4 export at App Store sizes, then every language, recordings and video on the screens, music and beats | Export done 2026-11-20; the rest next |
| Audit | An outside audit's findings: black frames with the effects off, more than 12 pictures, undo after a delete, the sound track, agent edits during an export, device sizes, Drive's uploads and opening | Fixed 2026-11-20, each with a test that fails on the old code (see the audit section) |
| Audit 2 | The same reviewer on the fixes: an undo back past a save to Drive, an agent's edit while the export gets ready, eight phones changing picture at once, a hidden Range looping an upload, the session start not retried, a stage made again mid-play | Fixed 2026-11-20, each with a test that fails on the old code (see the second audit section) |
| Intro | The App intro template in its first tone, titles whose words come in one after another, and Limelight holding GPU memory only while it is on screen | Done 2026-11-20, not committed (see "The App intro") |
| Intro 2 | The App intro made again after the user found it plain: the name huge with the phone sweeping up, cards lifting off the screens, three phones, the icon as a tile, the glow backdrop, highlighted words, and music made for the scene | Done 2026-11-20, not committed (see "The App intro, second design") |

## The competitor, and where Limelight stands

SmoothCapture (smoothcapture.app), read 2026-11-19 and checked again page by page on 2026-11-20 after an outside audit found the first write-up wrong in places. What its own site says:

- A Mac editor ("a desktop app exclusively for macOS", macOS 15.2 or later). On the Mac, recording and editing are free and exporting needs a licence ($49, $79 or $149 once, or $10 a month).
- A separate iOS app that edits a screen recording made with iOS's own recorder. Its App Store listing says "SmoothCapture is an editor, not a recorder", and its iOS terms "It does not record your screen". Its own pages disagree on exporting: the listing (version 1.0, read 2026-11-20) gives three free exports with no watermark, then $29 once; the iOS terms say a free export carries a small watermark that Pro (monthly or yearly) removes.
- A real 3D camera: camera shots on the timeline "with angle, distance, lens and easing", five easing curves, the camera swinging round the device on an arc, twelve named camera moves (Orbit, Rise Up, Settle and others, 1.4.0), depth of field with a Focus tool. No lens in millimetres, no f-stop, no view of the camera's path from outside the shot found on the site.
- Devices: iPhone 17, 17 Pro, 18 Pro, Air and Duo, an iPad, MacBook Air, Pro and Neo, iMac, Studio Display XDR, Apple Watch Series 11 and Ultra 3, and two Android phones (Galaxy S26 Ultra, Pixel 7 Pro). Devices nest inside each other's screens, up to eight deep. Its own Rotato comparison: "Rotato can place several devices side by side in one scene; SmoothCapture can nest a device inside another device's screen." Nothing about devices at their real sizes next to each other.
- An MCP server and a CLI for Claude Code, Codex, Cursor or any MCP client: edits land in the open project while the user watches, each batch one undo step, and the agent can render single frames, contact sheets and GIFs to check its work. An agent sidebar in the app (1.3.0).
- Records the Mac screen, an iPhone or iPad over USB and the iOS Simulator; auto zoom, cursor effects, keystrokes, captions and editing by transcript, music with beat markers and ducking, AI narration, a webcam overlay, privacy masking.
- Exports MP4 (H.264 or HEVC), ProRes 422 and transparent 4444, GIF; up to 4K at 60 (the 1.4.0 changelog says 8K and 120 fps); App Store presets 886 x 1920, 1080 x 1920 and 1200 x 1600 with stereo AAC at 256 kbps. A share link after export (it lasts 30 days) and publishing to Cloudflare R2 or AWS S3. No sync or backup of projects to any cloud found.
- Built-in camera-move templates, saving one's own, and publishing to its template gallery.

The first write-up said its camera only tilts the device, that it saves nothing to the cloud and that agent tools set Limelight apart, and the second called its iOS app a recorder (from the site's iOS page: "you'll be recording within a minute"). All four were wrong and are corrected above.

Where Limelight is level with it: an orbiting camera with lens, easing and depth of field; agent tools whose edits the user watches and can undo, with frames the agent can see; templates and the user's own; App Store sizes with a silent AAC track.

Where Limelight is ahead, as far as its site shows:

- Runs in the browser and on Windows and Linux as well as the Mac, and is free, export included.
- Several devices side by side on one floor at their real sizes: a phone beside an iPad Pro 13-inch is the right size against it (Apple's measurements, rule 91).
- A camera described like a real one: the lens in millimetres and an f-number, and a view from outside the shot that shows the camera's path (not found on its site).
- Scenes saved, pictures and all, to the user's own Google Drive, and opened on another computer.
- Screens filled straight from the screenshots the user designed in the editor, each remembering its artboard, so one scene can become a video per language (the record is kept; the per-language export is still to do).

Where it is behind: no recording of any screen yet, no Macs or watches, no nesting, no captions, music, narration, cursor or zoom effects, no HEVC, ProRes, GIF or transparent video, no share links.

## How step 1 is built

### The model (`src/lib/limelight/types.ts`)

A scene is plain JSON: `format` (size, frame rate, length), `look` (environment, backdrop, light, exposure, shadow, depth of field, vignette, grain), `camera` (`shots`, `shake`) and `actors` (devices and titles). Lengths are centimetres, angles degrees, times seconds; the floor is y = 0 and a device with no turn faces +z.

- A camera key is a `CameraShot` with a whole `CameraState`: `target`, `azimuth`, `elevation`, `distance`, `roll`, `lens` (mm, full frame across the picture's short side), `aperture` (f-number), `focus` (cm behind the target).
- An actor key is an `ActorPose`: `position`, `turn` (yaw, pitch, roll in the 3D Studio's order), `scale`, `opacity`. One pose means the actor stays still.
- `motion` is movement worked out from the time alone: `float` (cm of bob with a sway) and `spin` (degrees a second).
- A device's display is a list of `ScreenChange`s: from `time` on it shows a `media` id, coming in by `cut`, `fade`, `slide`, `scroll` or `zoom`.
- Pictures are `LimelightMedia` rows in Limelight's own database, never in a scene.

### The maths (pure, no three.js, all unit tested)

- `animate.ts`: `sceneAt(scene, t)` gives the camera, every actor and every screen at a moment. Each number of a key is sampled on its own: smooth, snappy and bounce start and end at rest on their own curves along a straight line; steady is constant speed; cut holds; glide is a cubic Hermite whose slopes are shared at each key (Fritsch and Carlson, so it never swings past a key), and where a glide meets another kind it takes that segment's speed at the key, so there is never a jerk. Angles are never wrapped, so 0 to 360 is a full turn. The handheld shake is a sum of sines, so a frame drawn twice is the same frame.
- `camera.ts`: the orbit, `verticalFov` (the lens across the short side), `orbitBy`, `panBy`, `dollyBy`, `dollyZoomTo`, `nearestAngle`.
- `scene.ts`: `newScene` (a phone turned to the light and a camera that swings round it, so a new scene already moves), `normalizeScene` (anything in, a drawable scene out: clamps, drops unknown kinds, swaps unknown devices, sorts keys, makes ids unique; it never throws), device sizes from the 3D Studio's models.
- `edit.ts`: every change the view makes, and the agent tools will make, as a pure function: `setShotAt` (the shot at that moment changes, or one is added, turning the short way), `setPoseAt` (a still actor's only pose moves; an animated one gets a pose at the playhead), screens, looks, `setFormat` (a new length stretches every key), `cameraToFitAll` (projects every device's measured hull through the camera and backs off until all of it is inside 80% of the picture).
- `presets.ts`: App Store preview sizes and rules (886 x 1920, 1200 x 1600, 1920 x 1080, 15 to 30 s, 30 fps at most), social sizes, and the five looks.
- `history.ts`: undo and redo, whole scenes as steps, a drag's run of changes merged into one. The scene a step gives back is stamped later than the one it replaces (second audit).

### The stage (`src/lib/limelight/stage/`, three.js, loaded only when the view opens)

- `stage.ts` `LimelightStage`: one WebGL context, its own canvas. It draws only when told (`invalidate`): a still scene costs nothing per frame. While something moves it draws drafts (pixel ratio 1.25, a lighter depth of field) and a governor drops the pixels when frames come late; a settled frame is drawn at full quality 140 ms after the movement stops. `renderStill` draws any moment into an offscreen target at any size up to 4096 and gives a PNG or JPEG.
- `actors.ts`: devices are the 3D Studio's own builders (`buildPhone`, `buildFoldable`, `createMaterials` exported from `DeviceStudioRenderer.tsx`, nothing moved) scaled to their real width in centimetres, built from `stageModelFor` (`models.ts`): measured phones as they are, the plain stand-ins at their real size (rule 91). Titles are canvas text on a plane.
- `screen.ts`: each display is a canvas texture drawn again only when its picture or a transition changes.
- `media.ts`: pictures decoded once, scaled to 2048 at most, a dozen kept. A still or a video frame holds the pictures its moment shows (`hold` with `frameMediaIds`) until it is read back, and the cache never lets go of a held one, so a scene can show more pictures than it keeps. The canvas says what its frame shows too (`show`), kept the same way, so eight phones changing picture at once, sixteen pictures, don't push each other out (second audit).
- `environment.ts`: each look is a small room of glowing panels baked into a PMREM map (a few ms, the last four kept); the key panel follows the light. The backdrop is a full screen triangle in the exact colours picked.
- `shadow.ts`: the actors drawn from under the floor into a 512 x 512 target, blurred, shown by a plane that darkens the backdrop only; drawn again only when something moved.
- `post.ts`: depth of field (a one pass gather with thin lens circles of confusion), vignette, grain, the sRGB step and dither.

### The view (`src/components/open-screenshot-generator/limelight/`)

`LimelightWorkspace.tsx` (scenes list, header, undo, saving, playback, keys), `LimelightViewport.tsx` (the stage and its gestures), `LimelightTimeline.tsx`, `LimelightInspector.tsx`, `controls.tsx`, `time.ts` (the playhead's time outside React). The layout mounts it on the first visit (`limelightMounted`) with `next/dynamic`, gives it `readProjectForCompliance` to read the open project's screenshots, and calls its `flushRef` from `beforeWindowCloseRef`.

Gestures: drag swings the camera, Shift or right drag slides it, the wheel or a pinch moves it in, two fingers on a trackpad swing it; a click picks a device, and only a picked device moves when dragged (Option turns it), so a drag that happens to start on a phone still moves the camera. A camera gesture ends by `setShotAt` at the playhead: move the playhead, frame the view, and that is a camera move. Keys: Space, K (shot here), Delete, the arrows (a frame, Shift a second), Home, End, Cmd or Ctrl Z.

## Rules learned in step 1 (also in .agents/AGENTS.md)

1. A browser can take a WebGL context away for good (a background tab under memory pressure, a GPU reset, too many contexts). The stage then draws nothing while the clock goes on, which the user saw: the video kept looping with an empty frame after switching tabs. The viewport makes a new stage on a new canvas when the context comes back, 1.2 s after it went when it does not, and when the tab comes back; four times in 30 s and it shows Try again instead. A canvas is never handed to a second stage, since `forceContextLoss` gives its context back for good, and objects made in a lost context are not deleted afterwards (WebGL refuses, and the console fills).
2. The shadow pass lends the actors' group to its own scene. It is handed back in a `finally`; left there, every device vanishes from the stage.
3. A device's screen keeps its exact colours: unlit, `toneMapped: false`. With post effects on, the scene is drawn into a half float, 4 sample target flagged `isXRRenderTarget`, which is how three.js lets each material tone map into a target as it would onto the screen; the target is linear, so the blur mixes light and the post pass does the sRGB step itself. The e2e spec reads a screen pixel of a solid #3366cc picture and checks it within 3 levels.
4. A view that is not on screen has no size. The viewport keeps its frame while hidden instead of shrinking the stage to 40 pixels and back.
5. Pictures are ArrayBuffers in IndexedDB, never Blobs (Playwright's WebKit, rule 63).

## What was checked in step 1

- `npm run typecheck`: nothing under `src/` or `tests/` (133 errors, all in `promo/` and `promo-i18n/`, the worktree's baseline).
- `npm run test:unit -- limelight`: 32 of 32. Ten source mutations (glide slopes, the monotone check, steady speed beside a glide, the roll sign, the short way round, unique ids, sorting, still actors, the lens side, the outgoing picture of a transition) each made a test fail.
- `tests/e2e/specs/limelight.spec.ts`, 2 tests, against a webpack dev server on :9014 with `E2E_NO_SERVER=1 E2E_BASE_URL=http://127.0.0.1:9014`: pass on `web` (Chromium) and `desktop` (WebKit). With the context rebuild taken out, the first test fails at "after the context was dropped for good"; with it back, it passes.
- Scripts in the session's scratchpad (not in the repo) drove the view in Chromium and WebKit: a hidden and a frozen background tab, the editor in front and back, a context given back, one kept, one dropped while the tab was in the back, a resize while playing (11 of 11 on both engines); the iPhone Duo, iPad Pro 13-inch and Pixel 10 Pro models, Save picture (an 886 x 1920 PNG), K, dragging a shot on the timeline, Delete, the arrows and Space (10 of 10). Playback ran at the display's 120 frames a second on an M1 Pro (ANGLE Metal).
- Not checked: the real Mac app (WKWebView inside Tauri), Windows (WebView2), Linux (WebKitGTK), Safari and Firefox, phones and tablets with touch, scenes with eight devices (cost of the depth of field and the shadow per device), WebGL1-only or software GPUs (the post pass is off without `EXT_color_buffer_float`, untested).

## How step 2 is built

- `templates.ts`: ten built-in templates (Hero orbit, Push in, Side by side, Spin reveal, Low hero, Floating stack, Flyover, Phone and tablet, Title opener, Turntable). A template is a pure builder, not stored JSON: it places its devices, spreads the pictures over their screens (`share` gives device k of n every nth picture), and frames each shot for the video's size with `cameraToFitAll` from its own angle, then pulls in or out (`pull`); `fitAt` frames a shot for a later moment (Title opener's phone rises into a shot framed for where it ends). `fromMyTemplate` makes a scene from one the user kept, the new pictures taking the old ones' places device after device.
- `edit.ts`: `cameraToFitAll` projects every device's measured hull (`hullPoints`, which follows a foldable's posture) through the camera and backs off until all of it is inside 80% of the picture; `cameraToFitPoints` is the same for any points, and `directorCamera` fits the actors and the camera's whole path for the director's view.
- `store.ts`: Dexie version 2 adds `templates` (the user's own); deleting a scene or a template keeps every picture another scene or template shows.
- `LimelightGallery.tsx`: the Start a scene dialog (One phone, the ten templates, Your templates). The previews are stills from one stage made for the gallery (`renderStill`, 560 pixels tall, about 1.7 s for all ten on an M1 Pro), with the project's own screenshots, or its sample ones, or a plain app screen drawn on a canvas; the loop yields to the page between stills and stops when a card is picked, since each still's pixel read holds the page on a slow GPU. Creating takes the same pictures the previews showed.
- `stage/guides.ts` and the viewport's From outside toggle: the director's view. The stage draws through an override camera with the post effects off, and shows the video camera's path, a dot per shot with a line to its target, and an orange pyramid for the camera at the playhead; `viewCamera()` returns the video's camera while it shows, and gestures there move only the director's camera, so nothing it does ends up in a shot.
- Titles write their depth (opaque with alpha to coverage, blending only while they fade): drawn with blending and no depth, depth of field took the backdrop's depth behind a title and blurred it like the backdrop.

## What was checked in step 2

- `npm run test:unit -- limelight`: 35 of 35, including every template at all 8 sizes with 0, 1, 3 and 6 pictures (each reads back unchanged, shows every picture, has its number of devices), every template shot keeps its devices in the picture, the turntable loops, and Fit fills 75 to 80% of the picture with an iPad and the opened iPhone Duo beside a phone.
- `tests/e2e/specs/limelight.spec.ts`: 3 of 3 on `web` and on `desktop`. The new test waits for the ten previews, builds Side by side (three phones), drags in the director's view (no shot added), saves the scene as a template and starts a new scene from it.
- Looked at in Chromium: the gallery with a project's sample screens, five templates on the stage, the director's view before and after a drag. Two bugs found that way and fixed: the created scene's screens were empty when the project had only sample screenshots (the previews showed them), and Title opener framed its first shots on the phone before it rose.

## Polish list (any time)

- Titles: a card behind the words. (The word by word reveal is done, with the App intro.)
- A model change that alters the size a lot offers Fit in a toast; adding a device does too. Shots could keep the subject framed through a model change instead.
- Shots as small cameras that can be dragged in the director's view.
- With software WebGL, a thin dark streak shows at one phone's edge in Flyover: the 3D Studio's shared device model shades to NaN there (the post pass now keeps it from spreading). Look at the model's normals.

## How step 3 is built

- Twelve tools in `desktopMcpServer.ts` (`limelightTools()`): list_limelight_scenes, get_limelight_scene, list_limelight_templates, create_limelight_scene, add_limelight_actor, update_limelight_actor, remove_limelight_actor, set_limelight_camera, set_limelight_look, update_limelight_scene, render_limelight_frame, delete_limelight_scene. They all call one api method, `McpDesignApi.limelight({ tool, args })`, which the layout answers with `runLimelightTool` from `src/lib/limelight/mcp.ts`, so the MCP module imports nothing new (rule 81). render_limelight_frame answers with an image block (a JPEG, 360 pixels wide unless asked, under the 256 KB the Agent panel shows) and then its summary.
- All twelve are on `READ_ONLY_TOOLS`: they touch Limelight's own database, which no editor render reads, so a call never waits for the canvas to settle. create, add_actor, update_actor and render are on all three `SLOW_TOOLS` lists (desktopMcpServer.ts, mcp_server.rs, cli/src/driver/session.ts).
- The view registers a host (`setLimelightHost`): before any tool runs the view writes its unsaved changes; a scene open in the view is read from it and changed through it, as one undo step, so the user watches the agent's change and can take it back, and the view never saves its older copy over the agent's. A tool never switches the user's screen, and the scene open in the view cannot be deleted by a tool.
- set_limelight_camera lets an agent frame instead of computing distances: a shot with `fit: true` is `cameraToFitAll` from its angle and lens, `pull` moves in or out from there, `lookAt` aims at an actor, and fields left out carry over from the shot before.
- Pictures for the screens come as `{ artboardId }` (that artboard's device screenshot in the open project) or `{ src }` (an asset: reference or a data: URL), or `fromProject: true` for all of the project's own screenshots; the `src` key keeps them under the web link guard (`hasWebLink`) when a chat has read a code folder.
- The skill `src-tauri/claude-agent/skills/osg-limelight/SKILL.md` (units, the camera, eases, sizes, how to work: read, change, render at start, middle and end, fix, reply), compiled in through `SKILLS` in claude_code.rs, and named in both agents' prompts.
- Ask AI in the view's header: the request goes to the agent with the scene's id and a note to load the skill, read, change and render; the user stays on the stage and watches it change, with "The AI is working" and See the chat while the agent answers. Off, with the reason, in the web build or without Claude Code or Codex, and in a tab window.

## What was checked in step 3

- `npm run test:unit -- agentBrief`: 3 of 3 (every snake_case word in the briefs and skills is a tool).
- `cargo test --locked -- claude_code mcp_server codex` in src-tauri, with its own target folder in the scratchpad: 58 of 58, including every_skill_folder_is_compiled_in, built_in_skills_stay_plain, prompt_names_the_server_and_every_skill and the_image_import_gets_the_long_budget.
- `node cli/scripts/build.mjs`: tools.json has 79 tools (67 before, the 12 Limelight tools added).
- `tests/e2e/specs/limelight.spec.ts`: 4 of 4 on `web` and `desktop`. The new test runs the tools through the CLI's headless bridge (the same tools the desktop agents call): a Hero orbit scene from the project's screenshot, a title and a new camera added while the view shows the scene (the timeline follows), undo in the view takes the camera back, a rendered frame comes back as a JPEG image block under 256 KB, and deleting the open scene is refused.
- Not checked: Ask AI with a real Claude Code or Codex session in the desktop app (the tools it uses are the ones tested; the send is the same call Growth and Remove background make).

## How step 4 is built

- `googleDriveLimelight` at the end of `src/lib/account/providers/googleDrive.ts`, beside `googleDriveLibrary`, to use the file's private helpers (rule 80). A folder at the top of My Drive, `Open Screenshot Generator Limelight`, found by the app property `absLimelight`, never inside the projects' folder and never made by a read; inside it one folder per scene, found by `absLimelightScene` = the scene's id, renamed with the scene, holding `scene.json` and `file__<mediaId>` per picture. A picture's id names its bytes for good, so a picture already there is never sent again; `scene.json` is replaced in place.
- `uploadResumable`: files over 5 MB go up in 8 MiB pieces with `uploadType=resumable`, each piece its own request with a fresh token, so a video never has to pass the desktop HTTP plugin's body copy whole. The protocol is `sendResumable` in `src/lib/account/resumable.ts` (after the audit): a 308 without a Range means Drive has nothing; a dropped connection or a 408, 429 or 5xx is waited out (1 to 16 s, six times) and Drive is asked what it has; an expired session starts over; a Range header the browser hides takes the piece as received, and the finished file's size is checked (a short one is deleted). Starting the session is waited out the same way and a refusal isn't; starting over from the first byte is allowed three times per upload, a count nothing resets, and a cap on requests (60 per 256 KiB) ends any upload whatever Drive answers (second audit). Screenshots are under 5 MB and go up multipart.
- `src/lib/limelight/drive.ts`: Google Drive only (a GitHub sign-in is told that videos are too big for gists and to switch); saves only when the user presses Save to Drive (rule 25a); everything under the Web Lock `osg-limelight-drive`. Opening from Drive brings only the pictures this device lacks, with their names, types, sizes and the artboards they came from (`scene.json` lists them, `driveFormat.ts`). It writes over the copy here only when that copy holds what it held when it last met Drive and Drive's is no older (`driveOpenPlan`); the record keeps a fingerprint of the contents (`sceneFingerprint`), since an undo once set `updatedAt` back past a save; otherwise the Drive scene comes in as a copy named "... from Drive". The last save or open is recorded in meta (`drive:<sceneId>`), and `updatedAt` only goes up (`laterThan`).
- The view: Save to Drive in the header (sign in first when signed out, "Saving 2 of 4" while it runs) and Open from Google Drive under the scenes list.

## What was checked in step 4

- `npm run test:unit -- limelight`: 36 of 36, including the resumable pieces (whole 256 KiB multiples, Drive's Range header read back, a file walked to its end in exactly its pieces).
- `tests/e2e/specs/limelight.spec.ts` on `web`: a fake Drive in the test answers Google's v3 API (folders by app property, children, multipart uploads, downloads, CORS). The test saves a scene with its picture (the folder at the top of the Drive, the scene's folder inside it, scene.json with the scene's id, the picture's bytes unchanged), saves again (scene.json written twice, the picture once), deletes the Limelight database, reloads, opens the scene from Drive and checks a screen pixel. With the "already there" check taken out of the save, the test fails on the second copy of the picture.
- Not checked: a real Google account (the requests match Google's documented API but were answered by the fake), the resumable path against Drive itself, the desktop app's HTTP plugin with Drive (the desktop project skips this test), and whether Drive lists Range as readable on its 308 answers to a web page (on a 404 it doesn't, checked with curl; when it doesn't, the size check at the end is what catches a short file).

## How step 5 (the export) is built

- `src/lib/limelight/exportVideo.ts`: frame n is drawn by the stage at the video's own size at exactly n / fps seconds (`renderPixels`, top row first, with `keepView` so the canvas isn't drawn between frames), handed to WebCodecs as an RGBA `VideoFrame`, encoded to H.264 and muxed by mp4-muxer, with a key frame every two seconds. It reuses `pickEncoderConfig` and `storeCodecCandidatesFor` (High profile for the App Store sizes) from `src/lib/video/videoExport.ts`, and `silentAudioTrack` from there, which writes the silent AAC track App Store Connect asks a preview for from one fixed frame, with no AudioEncoder (after the audit; before, a browser without an AAC encoder made video only). The stage holds the scene for the length of the export (`hold`, `release`), so an agent's edit waits, and it keeps the newest scene the view gave apart from the one it films, so an edit that came while the export was still getting ready shows after it (second audit). 0.12 bits a pixel a frame, 6 to 40 Mbit/s.
- `stage.ts`: `renderStill` is `renderPixels` plus a PNG or JPEG; one render target is kept between frames of the same size (`outputFor`) and let go after (`releaseOutput`).
- The view: Export video in the header, and a dialog that shows the frame count with Stop while the video is made. The dialog keeps the user's hands off the scene; an agent's change waits on the stage, and the saved toast says the video shows the scene as it was. The App Store's 15 to 30 seconds rule is repeated in the saved toast when the size is an App Store one and the length is outside it. The three Add buttons became one Add menu (Device, Title, Camera shot at the playhead).

## What was checked in step 5 (the export)

- `tests/e2e/specs/limelight.spec.ts`, the export test on `desktop` (WebKit, as the Mac app): a 2 second App Store iPhone scene exported and read back box by box: ftyp, moov and mdat, a length of about 2 s, a video track of 886 x 1920 with 60 samples in avc1, and the silent mp4a track where the browser can encode AAC. It skips on `web`: Playwright's Chromium has no H.264 encoder. The whole spec: 10 passed and 2 skipped (that one, and Drive on `desktop`).
- A Hero orbit scene with an editor template's screens, exported for 4 seconds in WebKit in about 7 seconds (about 58 ms a frame at 886 x 1920 on an M1 Pro), opened with ffmpeg (H.264 886 x 1920 at 30 fps, AAC 48 kHz stereo) and five frames looked at: the camera's glide, a screen sliding in, the float and the shadow.
- `npm run test:unit`: 895 of 895.
- Not checked: the export in the real Mac app (WKWebView inside Tauri) and its save dialog, Chrome or Edge (they have H.264 but were not run), App Store Connect taking one of these files, a 4K export's memory.

## The audit of 2026-11-20, and what changed

An outside review (GPT, run by the user) read the code, used the view, decoded exported MP4s and reran the tests. Every finding below was real. Each now has a test, and each test was shown to fail with the old code put back (the mutation list under "What was checked").

| Finding | Why it happened | Fix | Test |
| --- | --- | --- | --- |
| With depth of field, vignette and grain all off, stills and videos came out black, with WebGL INVALID_OPERATION | The 8 bit target for those frames had an sRGB texture and the `isXRRenderTarget` flag: three.js made the texture SRGB8_ALPHA8 and the multisampled buffer RGBA8, and WebGL won't resolve one into the other | The texture's `internalFormat` is `'RGBA8'`; the materials still encode sRGB ([stage.ts](../src/lib/limelight/stage/stage.ts) `outputFor`, rule 85) | e2e "with depth of field, vignette and grain all off": three looks, the screen's colour, and no WebGL error in the console |
| A scene with more than 12 pictures drew screens black, then blue, at the same moment | A still waited for every picture in the scene while the cache let go of all but 12 as they arrived | A frame holds only its moment's pictures (`frameMediaIds`) with `StageMedia.hold`, and the cache never lets go of a held one ([media.ts](../src/lib/limelight/stage/media.ts)) | unit tests on the cache (13 pictures, two frames at once, a missing picture); e2e "more pictures than the stage keeps": 13 colours, each moment twice, in two orders |
| Undo could bring back a phone whose picture had gone with another scene | Deleting a scene kept pictures other scenes showed, not ones an undo step showed | A scene row keeps `held` (what only its undo steps show) at each save, and the open view answers `holdPictures` with its undo steps right now ([store.ts](../src/lib/limelight/store.ts), rule 87) | unit test on `picturesToDelete`; e2e "undo brings a phone back": the audit's steps, then a reload, so the picture is read from the database, not the stage's memory |
| The silent sound track wasn't certain: Chrome with H.264 but no AAC wrote video only | The track needed an AudioEncoder, a missing one was allowed, and the test let it off | `silentAudioTrack` writes one fixed AAC-LC frame of stereo silence (21 10 04 60 8c 1c, what ffmpeg's own encoder writes for silence) with no encoder at all, rounded down to whole frames so it is never longer than the picture. Every Limelight video has it; the editor's export uses it when there is nothing to mix and no AAC encoder ([videoExport.ts](../src/lib/video/videoExport.ts), rule 90) | e2e export test with `AudioEncoder` taken away: an mp4a track of 93 frames that the browser decodes to 2 channels of zeros |
| An agent's edit during an export changed the rest of the video | The dialog stopped the user, not the agent, and the stage drew its newest scene | The export holds the scene on the stage (`hold`, `release`); a change waits, then shows, and the saved toast says the video doesn't have it ([exportVideo.ts](../src/lib/limelight/exportVideo.ts)) | e2e "an agent's change made while a video is made": the backdrop turned red a quarter of the way in; three frames read back through the browser's video player are the starting blue, and the stage is red after |
| "Devices at their true sizes" was false for tablets: every plain tablet was 180 mm wide, the 7-inch one 180 x 281 mm | The editor's stand-in models only need a shape | `stageModelFor` ([models.ts](../src/lib/limelight/models.ts), rule 91): Apple's tech specs for the iPads and older iPhones, the named screen size for the plain tablets; the editor's models unchanged | unit test: every size, the screens' diagonals (7.00, 10.00 and 13.01 in), the editor's models as they were |
| Drive: a 308 without a Range moved past the piece sent; no recovery from a dropped upload | The page couldn't tell a missing Range from one the browser hides, and took both as "all received" | `sendResumable` ([resumable.ts](../src/lib/account/resumable.ts), rule 89): no Range means nothing (Google's rule); drops and 5xx are waited out (1 to 16 s) and Drive is asked what it has; an expired session starts over; a Range the browser hides takes the piece as received, and the file's size is checked at the end | 13 unit tests against a Drive in memory, one of them 200 random mixes of drops, server errors, part pieces and missing Ranges; the e2e Drive test sends a 5.9 MB picture resumably through a fake Drive that loses its first piece |
| Drive: opening could write over a change made here within a second of the Drive copy | The rule was "newer by more than a second" | `driveOpenPlan` ([driveFormat.ts](../src/lib/limelight/driveFormat.ts)): it writes over the copy here only when that copy hasn't changed since it last met Drive and Drive's is no older; `updatedAt` only goes up (`laterThan`) | unit test with a change half a second after the save; e2e: a rename after a save, then Open from Google Drive keeps both |
| Drive: a scene opened on another computer lost which artboard each picture came from | The picture files hold only bytes, and nothing else was saved | `scene.json` holds the scene and each picture's name, type, size and `from`; an older scene.json still reads | unit round trip, with an odd list dropped; e2e: the pictures come back named blue.png and noise.png |
| The lifecycle test checked one pixel and the clock, not that the picture moved again; the resize check lived in a scratch script | | After each event the e2e test checks that the stage's picture changes while it plays (and holds still while paused); a resize while playing is in the spec | mutation E9: a rebuilt stage that never follows the clock fails "the picture on the stage moves after the context came back" |
| Two tests timed out when the spec ran four at a time | Four WebGL stages at once; Playwright's Chromium draws WebGL on the CPU here, about four cores a stage | The spec runs one test at a time (`mode: 'default'`); the gallery's ten previews get 180 s | |

Found while checking, not in the audit: with software WebGL (Chromium without a GPU, as in these tests), the Flyover preview had a black disc beside a phone. A pixel of the 3D device model shades to NaN there, and the depth of field spread it over its whole blur circle. The post pass now leaves such samples out of the blur, and a pixel that is itself unusable takes a neighbour's colour when there is no blur ([post.ts](../src/lib/limelight/stage/post.ts)). Checked by eye on a software render: the disc is gone, and a thin dark streak a few pixels wide stays at that phone's edge, where the model itself shades wrong (in the 3D Studio's shared model, not looked into).

The comparison with SmoothCapture was corrected too: see the competitor section.

## What was checked after the audit

- `npm run test:unit`: 916 of 916 (21 new: 9 in limelight.test.ts, 13 in the new resumable.test.ts, one old resumable test moved there).
- Mutations, each fix taken out in turn (a script in the session's scratchpad, every file put back after): 14 of 14 caught by the unit tests (the cache's holds, the delete's held pictures, the undo history's pictures, real sizes, the fitted bezel, a 308 without a Range, 5xx waits, an expired session, a hidden Range after a drop, the old one-second Drive rule, a picture's origin, `laterThan`, a transition's outgoing picture) and 8 of 8 by the e2e tests: the sRGB texture (the effects-off frame doesn't show the picture), every picture preloaded with holds ignored (a moment shows the wrong colour), undo holding nothing (no picture after undo and a reload), scene.json without the pictures list, the Range always taken as hidden (the Drive save fails), a rebuilt stage that never follows the clock ("the picture on the stage moves after the context came back", 0 changes), the sound track needing an AudioEncoder, and the export without its hold ("frame 2's backdrop is the blue it started with: 206,32,31").
- `tests/e2e/specs/limelight.spec.ts` on `web` (Chromium, one worker): 8 passed, 2 skipped (the two export tests: Playwright's Chromium has no H.264 encoder), exit 0. The lifecycle test alone, three times in a row: 3 of 3.
- The same spec on `desktop` (WebKit, as the Mac app): 9 passed, 1 skipped (Drive: the fake answers the web build only), exit 0, with WebKit at 1,125 MB at most (a guard stopped any run past 2 GB). Both export tests ran here: the silent track decoded by the browser, and the agent's change kept out of the video.
- The audit's own export case in real Google Chrome 142, which here encodes H.264 but not AAC: a 2 s App Store iPhone export came out as H.264 High 886 x 1920 at 30 fps (60 frames, all decoded by ffprobe) and AAC-LC 48 kHz stereo (93 frames, 1.984 s), 2.000 s long; ffmpeg decoded its sound to 95,232 samples a channel, every one zero.
- The silent frame on its own: ffmpeg decoded 47 copies with `-xerror` to 48,128 samples of zero.
- `npm run typecheck`: 133 errors, all in `promo/` and `promo-i18n/`, none elsewhere.
- Not checked: a real Google account (the fake Drive answers as Google documents; whether Google lists Range as readable on a 308 to a web page is unknown, and on a 404 it doesn't), App Store Connect taking a file with this silent track, the editor's own export using the silent track (one line in videoExport.ts, not run in the editor), the real Mac app (WKWebView inside Tauri), Windows and Linux, Ask AI with a real agent.

Testing notes for whoever runs these next: on this Mac Playwright's Chromium draws WebGL on the CPU, about four cores a stage, and the Mac had a load average of 20 to 40 while these ran. A screenshot of a playing stage takes seconds then, so the stage checks take their first look before polling and allow 30 s, the gallery's ten previews get 180 s, and the lifecycle test 400 s. `--repeat-each` needs `--workers=1`, or the repeats run side by side and run out of time, which is what the audit's four-worker run saw.

## The second audit of 2026-11-20, and what changed

The same reviewer checked the first round's fixes, reran the tests and the mutations in a copy of their own, and found the cases below. Every one was real. Each now has a test, and each test was shown to fail with the old code put back.

| Finding | Why it happened | Fix | Test |
| --- | --- | --- | --- |
| Rename, Save to Drive, Undo, then Open from Google Drive: the Drive copy replaced the undone scene | Undo gave back the old scene with its old `updatedAt`, earlier than the save, and "unchanged since it met Drive" compared times | Undo and redo stamp the scene they give back later than the one on screen ([history.ts](../src/lib/limelight/history.ts)). The Drive record keeps a fingerprint of the scene's contents (`sceneFingerprint`: a 53-bit cyrb53 of the scene without `updatedAt`), and `driveOpenPlan` replaces only when the contents here are what they were then; a record without one keeps both | unit: the audit's steps on `SceneHistory` and `driveOpenPlan`; e2e Drive test: the audit's steps in the view, then both scenes in the list |
| An agent's edit while the export was still getting ready: the controls and the saved scene had it, the preview didn't, after the export | The hold began after the encoder check, put the export's scene on the stage and forgot the newer one the view had given | The stage keeps the newest scene the view gave apart from the one it films, and `release` puts it back ([stage.ts](../src/lib/limelight/stage/stage.ts)) | e2e (WebKit): the encoder check waits until the agent has turned the backdrop red and the stage shows it; the video is the blue of the moment Export video was pressed, and the stage is red after |
| Eight phones changing picture at once (sixteen pictures): wrong or black screens in the preview, and 736 more decodes in two seconds | Stills and video frames held their pictures; the canvas's own frame didn't, so each picture read pushed another out of the dozen kept | The canvas tells the cache what its frame shows (`StageMedia.show`) before asking for the pictures, and those are kept like a held frame's ([media.ts](../src/lib/limelight/stage/media.ts)) | unit: sixteen pictures over six frames, each read once; e2e: eight phones halfway through a fade between two colours each, every phone's mix on screen, and no picture read again in two still seconds |
| With the Range hidden and Drive keeping part of the first piece each time, one upload made 100,000 requests and 33,334 sessions | A 308 taken on trust counted as progress and reset the limit on starting over | Starting over is allowed three times per upload, a count nothing resets; trust resets only the failure count; every request counts against `requestLimit`, 60 per 256 KiB ([resumable.ts](../src/lib/account/resumable.ts)) | unit: the audit's case gives up after 4 sessions and 8 requests; a Drive that takes one byte at a time stops at the cap; the random walk now has 100 runs with the Range hidden and checks every run's sessions and requests |
| The request that starts an upload session was never tried again | `begin` ran outside the waits | `begin` is waited out like a piece: a dropped connection, a 408, 429 or 5xx (`ResumableHttpError`, thrown by googleDrive.ts) is tried again, a refusal isn't | unit: a drop, then a 503, then a start; a 403 tried once; a 503 every time fails after seven tries |
| A stage made again during playback drew full frames until playback was toggled | The new stage started at rest; the playing flag reached a stage only when it changed | The viewport tells a new stage whether it plays ([LimelightViewport.tsx](../src/components/open-screenshot-generator/limelight/LimelightViewport.tsx)) | e2e at twice the pixels: the canvas's pixels per CSS pixel while playing (under 1.3) and paused (2), before and after the context is lost for good |
| The progress doc called SmoothCapture's iOS app a recorder | Taken from the site's iOS page | Corrected from its App Store listing and its iOS terms, which both say it edits (competitor section) | |

## What was checked after the second audit

- `npm run test:unit`: 921 of 921 (5 new: the canvas keeping sixteen pictures, an undo back past a save to Drive, the audit's hidden-Range upload, a Drive that takes one byte at a time, the session start; the Drive plan and random walk tests grew). In the walk, all 200 runs with Drive's Range readable finished with the exact file; with it hidden, 61 of 100 finished and the other 39 gave up within 4 sessions and the request cap.
- Mutations, each fix taken out in turn (a script in the session's scratchpad, every file put back after): 6 of 6 caught by the unit tests (undo keeping its old time, the Drive plan going by the clock, the canvas's frame not kept, trust resetting the restarts, no request cap, the session start not tried again) and 6 of 6 by the e2e tests: the canvas's frame not kept, in Chromium and in WebKit ("every phone shows both its pictures halfway through the fade": 0 pixels for one phone); a new stage not told it plays, in both ("the new stage draws light frames while it plays": 2 pixels per CSS pixel); undo keeping its time with the Drive plan by the clock together (no "Opened as a copy" after the undo); and the hold as it was before this round, in WebKit ("the stage shows the red backdrop after the export": still blue, the audit's own finding).
- `tests/e2e/specs/limelight.spec.ts` on `web` (Chromium, one worker): 10 passed, 3 skipped (the three export tests: Playwright's Chromium has no H.264 encoder), exit 0, 9.9 min.
- The same spec on `desktop` (WebKit, as the Mac app): 12 passed, 1 skipped (Drive: the fake answers the web build only), exit 0, 5.2 min, with WebKit at 1,331 MB at most (a guard stops any run past 2 GB). All three export tests ran here, the new one included.
- `npm run typecheck`: 133 errors, all in `promo/` and `promo-i18n/`, none elsewhere.
- SmoothCapture's iOS app, read 2026-11-20 from its App Store listing (through Apple's search API, version 1.0) and its iOS terms page.
- Not checked: a real Google account (whether Google lets a page read the Range header of a 308 is still unknown, so how often the hidden-Range path runs is unknown too), App Store Connect taking a file with the silent track, the editor's own export using it, the real Mac app (WKWebView inside Tauri), Windows and Linux, Ask AI with a real agent.

## The App intro (2026-11-20)

Asked for: an award winning app intro template for this screen, the first tone now and more later, loaded only on this screen and without overloading memory.

### What it is

`app-intro`, first in the gallery: fifteen seconds cut on a beat of 2.4 seconds ([introTemplate.ts](../src/lib/limelight/introTemplate.ts)).

| Time | What happens |
| --- | --- |
| 0 to 2.8 s | A dark stage. "Meet" rises in, then the app's name letter by letter, on an 85 mm lens at f/2.8 easing in; the words lift away and fade. |
| 2.3 to 4.6 s | The phone comes up from below, turning from its back (yaw 200) to face the camera, quick then a long settle, out of focus behind the words until the camera turns to it. Until then it isn't on the stage at all. |
| 4.6 to 12 s | Three beats. On each a hard cut to a new angle (high, low on a 50 mm, high from the other side), the phone turns on the cut, the screen slides or scrolls to the next screenshot, and that screenshot's headline rises in word by word over the phone (beside it in a wide video), then fades before the next cut. |
| 12 to 15 s | The phone turns to the front, the screen goes back to the first screenshot (or shows a fourth), and the name comes in again with "Available on the App Store" or "Get it on Google Play" under it, left out at the App Store's own preview sizes. |

What it takes from the project (`TemplateInput`, filled by the gallery, the view and the agents' create tool alike):

- `captions`: each picture's headline, `artboardHeadline` in [projectShots.ts](../src/lib/limelight/projectShots.ts). The biggest text on the artboard with the same-size lines stacked with it (a headline set as several boxes), never the app's own name, text without letters (stars, prices), turned text, or anything over nine words or sixty characters (a review). A picture without one gets no caption rather than filler.
- `title`: `projectAppName`, the name the App icon studio keeps, or the project's name without the " Copy" the layout gives a template's copy.
- `accent`: `projectAccent`, the most colourful (by chroma, so royal blue beats the light blue it fades into) of the backgrounds and big shapes, pastels counting by their hue; none for a white or grey project. The tone makes it a dark glow; yellows and yellow greens lean to amber and green, since they go brown and olive near black.
- `font`: `projectFont`, the family most of the headlines are set in, when it is one the app ships; otherwise the tone's own, Plus Jakarta Sans.

The layout follows the picture's shape: in a tall or square video the words go over the phone and a long name goes on two lines (`balanceLines`: as few even lines as fit); in a wide one they go beside it, left aligned. How many letters fill a line grows with the width (8, 10, 14), so the title card is about as far away as the phone's first shot and the camera moves in to the phone rather than out past it. Every shot is framed with `cameraToFitPoints` on the actors that part shows, at a moment they show it.

A tone (`IntroTone`) is the look: the environment, the backdrop made from the accent, the light, vignette, grain, shake, the fallback font and the words' colours. `CINEMATIC` is the first; a second tone is a second `IntroTone` and a template entry that builds with it.

### Titles that come in

`TextActor.reveal` ([types.ts](../src/lib/limelight/types.ts)): `style` rise, fade or pop, `by` word or letter, `time` and `duration`. `revealProgress` staggers the words so they overlap and the last lands at `time + duration`; `revealLook` turns progress into opacity, a drop below the line, a mask and a scale. Rise is cut at its line's bottom, so a word comes up from behind it. A longer video stretches a reveal with its keys. The inspector has **Words come in** (At once, Rise, Fade, Pop; Word by word, Letter by letter; Starts at; Takes), and add_limelight_actor and update_limelight_actor take `reveal`.

The stage draws a title once on a canvas and shows it as a quad per word or letter over that one texture ([actors.ts](../src/lib/limelight/stage/actors.ts) `TextView`), so a reveal moves corners and sends no pixels. Letters are graphemes (`Intl.Segmenter`); more than 64 parts come in as one.

### Loaded only here, and light

- The intro's builder is in its own file that `templates.ts` brings in with `import()`; the list the editor carries holds only its name and card. `buildTemplate` is async. Nothing else in src/ imports the file.
- A title's canvas is drawn at the smallest capital height that is sharp at the size it shows (32 to 160 pixels; it was always 160, sharp at 4K), and the canvas's own copy is let go once the texture is on the GPU. A two line caption at 64 pixels instead of 160 is about a sixth of the pixels.
- The viewport lets its stage go five seconds after Limelight goes behind another view and makes a new one when it comes back, never mid export: the WebGL context and every texture and render target go with it (the post pass alone allocates 60 bytes a pixel of the canvas).
- One phone, not three: the intro shows four screens on one device.

### Fixed on the way

- Titles were drawn in the font "Inter", which the app doesn't ship, so they came out in the browser's default face, a serif one on a Mac; a family the page never loaded now falls back to sans-serif.
- The size `titleBox` gives a title for framing was 0.62 of a capital per letter; measured in Chrome on six of the app's faces at four weights the averages run 0.68 to 0.81, so Fit cut a bold title's ends off. It is now 0.84 bold, 0.8 medium, 0.78 regular.
- With no scene open, the gallery was given a new size object on every render and started its previews again each time ("The stage was closed" in the console).
- A title fading now keeps writing its depth (before, it took the backdrop's depth while it faded, so depth of field blurred it like the backdrop).
- A blank project's name, "Untitled Project", no longer becomes the app's name in a template; the template's stand-in ("Your app") shows instead.
- A title picked before its words come in showed a dot for its outline; each word now has its place from the start and is only hidden.
- A title drawn again at another size kept its old texture. three.js gives a texture its storage on the first upload and only copies into it after that, so a bigger canvas was `GL_INVALID_VALUE: glTexSubImage2D: Offset overflows texture dimensions` and the words stayed as they were. Before this work that happened whenever a title's words got longer; with titles drawn at the size they show it happened whenever the camera came closer or a picture or video was made bigger. Each size of canvas now gets its own texture, as the screens already did.

### What was checked

- `npm run test:unit`: 935 of 935. The 14 new ones are in [limelight-intro.test.ts](../tests/unit/limelight-intro.test.ts): the reveal's timing and looks, reading a reveal back and stretching it, every part of the intro framed and filling at least 60% of the picture at all eight sizes, captions per picture, the store line, the colour, the font, two line names, balanced captions, `titleBox` against the measured widths, headlines from made-up boards and from the Budgetly, Paylark and Coinly templates, the project's colour and name, and that nothing in src/ imports introTemplate.ts statically.
- Mutations, each fix taken out in turn: 12 of 12 caught by the unit tests (the " Copy" left on, the phone under the title card, captions on the most lines, the colour by saturation, 0.62 a letter, the app's name taken for a headline, reveals not stretched, the last word a rounding error short, a reveal dropped when read back, stacked lines not joined, a long name on one line, the store line in a store preview) and 5 of 5 by the e2e test (the stage never let go, the intro imported statically, every word there from the start, no captions from the project, one texture whatever the canvas size).
- [limelight.spec.ts](../tests/e2e/specs/limelight.spec.ts), the new test: Budgetly Finance's template project; no request for the intro's file until the gallery opens, then one; the intro's preview; the titles on the timeline; "Budgetly / Finance" and "Manage budget / without stress" in the inspector, coming in by Rise, word by word; nothing light on the stage at 0.1 s, part of the name at 0.8 s, all of it at 1.6 s; Save picture at 886 x 1920 with the name in it and no WebGL error; no canvas five seconds after going to the editor, and the title card back on a new stage after coming back.
- The whole spec on `web` (Chromium): 11 passed, 3 skipped (the exports: no H.264 in Playwright's Chromium), exit 0, 11.0 min; then, after two changes to the spec's helpers and the new test's card click, the new test 3 times in a row, 3 passed. On `desktop` (WebKit, as the Mac app) with the final code: 13 passed, 1 skipped (Drive answers the web build only), exit 0, 4.5 min, WebKit at 1,536 MB at most.
- Looked at, frame by frame, in Chrome on the GPU: Budgetly in tall, wide and square and Coinly in tall, at the moments of every cut and transition. What looking found and changed: the phone showing as a dark blur under the title card, long names making the title card and the close small, captions blurred at f/4 in the high shot, a backdrop as bright as a green screen (the radial backdrop reaches its edge colour only past a tall frame's top), the camera moving out past the phone in a wide video, three line captions where two fit, and " Copy" in the name.
- The intro exported in Chrome on the GPU: an 11 MB MP4, 886 x 1920, 15.000 s, made in 16.1 s, no console errors; thirteen frames read back from the file show every part in order.
- `npm run typecheck`: 133 errors, all in `promo/` and `promo-i18n/`. `node cli/scripts/build.mjs`: 79 tools, `reveal` on add_limelight_actor. The skill file passes what `built_in_skills_stay_plain` checks (frontmatter, no shell lines, no CR), read by eye; the Rust tests weren't built.
- A trap on the way: after an e2e mutation, `next dev` kept compiling the mutated title code although the file was put back, and a full run then failed on the fixed bug. The server was restarted with `.next/cache/webpack` cleared, the compiled chunk was checked for the fix, and every run above after that is on that server.
- Not checked: the real Mac app (WKWebView inside Tauri), Windows and Linux, Ask AI asking for an intro, App Store Connect taking an intro, a project in a right-to-left language (by the code, a line's words come in from its left end, which there is the last word, not the first).

### The audit of the App intro, and what changed

The same outside reviewer checked the intro: they confirmed the unit tests (935), the 12 unit mutations, the new e2e test on both engines, and played and exported the intro in the real Mac app (450 H.264 frames, 886 x 1920, exactly 15 s, AAC decoding to silence). Five findings, all real:

| Finding | Why it happened | Fix | Test |
| --- | --- | --- | --- |
| A name of wide letters ran off both sides: "WWW" lost both ends at 1.6 s | Framing used one average letter width (0.84 of a capital) for every letter; W is up to 1.54 | `titleBox` measures each line on a canvas in the title's own face (advance or ink, whichever is wider, [fonts.ts](../src/lib/limelight/fonts.ts) `measureLineWidth`); with no canvas (Node), or before the face has loaded, a table of every ASCII letter's widest width in eight of the app's faces stands in. The intro sizes its name by that measure too | unit: "WWW" is 4.62 capitals and "iii" 1.35, and three wide names stay inside the title card and the close at every size; e2e: an intro for a project called WWW, as the agent's picture at 1.6 s, the name clear of both edges and wider than 40 of 96 columns |
| The first picture of a title in a face nobody had used yet was in the fallback, the next in the face | `renderPixels` waited on `document.fonts.ready`, which only waits for loads already started, and a title asks for its face when it is first drawn: for a new stage, that same frame | `renderPixels` loads its titles' faces first (`loadTitleFaces`, waiting at most 4 s for each face once per page, so a face that never comes doesn't hold every frame of a video); a title's drawing also notes whether its face had loaded, and draws again once it has; the intro loads its faces before it frames anything | e2e: a Bungee title (served 1.5 s late, 40% wider than the fallback) rendered twice through render_limelight_frame: the two pictures differ in fewer than 10 of 9,216 sampled pixels (400 without the fix) |
| "Carbon Copy" became "Carbon" | The " Copy" the layout adds to a template's copy was taken off any name | The layout lends Limelight the start dialog's template names (`templateNames` in `readProjectForCompliance`), and only "<template name> Copy" loses the word | unit: Budgetly Finance Copy, Carbon Copy, Copy, a name with Copy 2, and no template list; e2e: the Budgetly test's intro is titled "Budgetly / Finance", which only the layout's list makes so |
| "Plan" wasn't a headline for an app called Planner, and the small "SMART FINANCE" badge became the caption | A text inside the app's name counted as its logo | Only the whole name, or one whole word of it standing alone, is the logo (`headlineTexts`) | unit: the audit's Plan and Planner, the name alone, one word of a longer name, a headline holding a word of it |
| A see-through Poppins headline and a see-through red shape chose the intro's font and glow | Only the headline picker looked at opacity | Both the font and the colour go by what a person sees: the font by the headline's own text, the colour by shapes at 5% opacity or more, weighed by their opacity; a background under a picture counts for a quarter | unit: the audit's board (Outfit, no colour), a faint pure red against a solid blue, a 3% red alone on white, and the logo not choosing the font |

Checked after:

- `npm run test:unit`: 939 of 939 (4 new, one rewritten). `npm run typecheck`: 133, all in `promo/` and `promo-i18n/`.
- `tests/e2e/specs/limelight.spec.ts` with the new test: `web` (Chromium) 12 passed, 3 skipped (the exports), exit 0, 10.8 min; `desktop` (WebKit) 14 passed, 1 skipped (Drive), exit 0, 4.7 min, WebKit at 1,747 MB at most.

### The second audit of the App intro, and what changed

The reviewer confirmed the five fixes (in the real Mac app, "WWW" fits and the first and second Bungee pictures match) and found four gaps beside them:

| Finding | Why it happened | Fix | Test |
| --- | --- | --- | --- |
| A stalled font download held a frame for 42.9 s, stills and video alike | After the 4 s wait for the titles' faces, `renderPixels` still waited on `document.fonts.ready`, which has no limit | `fonts.ready` isn't waited on at all; `loadTitleFaces` is the only wait, 4 s once per face and letters per page | unit: a font set that never loads: the first wait ends at its limit, the next is skipped, new letters get their own; e2e: a Bungee download held for the whole test, and two agent pictures both drawn (with the old wait: "still waiting" at 20 s) |
| A Japanese title's first frame drew its kanji in the fallback while the face's Latin piece was already in | `document.fonts.load` and `check` were asked without text, which means a space: a face split by unicode-range (Noto Sans JP) loaded only the piece for a space | A face is loaded and checked for the letters its titles draw (`TitleFace.text`), in `renderPixels`, a title's own drawing, the framing's measure and the intro's build | unit: asked once, with every letter; e2e: Noto Sans JP served as a Latin piece and a kanji piece 1.5 s late (Arial Unicode, macOS), the Latin piece warmed first: the first and next pictures of 日本語 differ in fewer than 10 of 9,216 sampled pixels (460 without the letters) |
| A red fill at 3% `fillOpacity` chose red on white; a shape painting a blue gradient chose its old red `fillColor` | The colour read `fillColor` and the layer's opacity only | `shapeFills` reads a shape the way ShapeElement paints it: a valid two-stop gradient instead of `fillColor`, `fillOpacity` in place of a colour's alpha when it is set and isn't 1 (0 paints solid there, so it counts as solid), and an rgba colour's own alpha | unit: the audit's two shapes, an rgba fill at 3%, a half-strength fill, a gradient's two stops |
| With two texts the same size, the headline above gave the caption and a button below gave the font | The caption took the higher of two equal texts, the font the first stored | One rule for both, `headlineTop`: the biggest, then the higher, then the further left | unit: the audit's board in both orders |

Checked after:

- `npm run test:unit`: 942 of 942. `npm run typecheck`: 133, all in `promo/` and `promo-i18n/`.
- `tests/e2e/specs/limelight.spec.ts`: `web` (Chromium) 14 passed, 3 skipped (the exports), exit 0, 11.2 min; `desktop` (WebKit) 16 passed, 1 skipped (Drive), exit 0, 5.3 min, WebKit at 1,177 MB at most.
- Mutations: 6 of 6 caught by the unit tests (a stalled face waited for every frame, a face asked for without letters, fill opacity, gradients and a colour's own alpha ignored, the font picked by size alone) and 2 of 2 by the e2e tests (the unlimited `fonts.ready` back: the first picture "still waiting" at 20 s; letters dropped: 460 pixels apart), each checked in the compiled chunks before and after.
- A check left out of the e2e test: that the second picture after a stalled download skips the wait. In Playwright's Chromium the two pictures took 7.6 s and 6.7 s: each makes a new stage, drawn on the CPU, whose own time swings by more than the 4 s wait, so the skip is the unit test's to show.
- Mutations: 7 of 7 caught by the unit tests (the average letter, every Copy, a word inside the name, the see-through text, the see-through shape, the faint shape, the logo's font) and 2 of 2 by the e2e test (stills not waiting for their faces: "Received: 400" pixels apart; the average letter: the name touching the left edge). Each e2e mutation was checked in the compiled chunk on disk before the run and the fix after it (`mutate-served.sh` in the session's scratchpad), since webpack once kept serving a mutation.

## The App intro, second design (2026-11-20)

The user looked at the first design and called it plain, and they were right: frames from it showed one small phone on a dark green backdrop, small white captions, no icon and no sound. Two audit rounds had gone into fonts and colours a viewer never notices. This design is judged by its frames and its exported video first.

### What it is

Fifteen seconds, eight bars at 128 beats a minute (`AT` in introTemplate.ts), every cut on a beat:

- 0 to 1.9 s: the app's name, sized to about twice the phone's width, rises letter by letter; the phone sweeps up from below in front of its foot, in a light finish (`lightFinish`) that stands out on the dark.
- Three features from 1.9 s, each a new angle cut on the beat with the screen's headline over the phone (its last line, or last word, in a light tint of the app's colour: `TextActor.highlight`). Where `findCard` finds a colourful panel in the screenshot, that panel lifts 2.4 cm off the glass toward the camera and settles back before the screen changes (`cardOnScreen` puts it exactly over that part of the display).
- 8.9 s: the camera pulls back as two more phones slide in, a fan in a tall video and a row in a wide one.
- 11.25 s, on a bar: the phones are gone on the cut and the music's hit, and the project's icon (the App icon artboard, captured by the layout's `captureIconForLimelight`) pops in as a glossy tile with a light sweeping across it, the name and the store under it. Without an icon it closes on the phone with the name.
- The backdrop is the new `glow` style: near black with soft lights of the app's colour, which drift and shift against the camera's angle. The music is `pulse`.

### What the engine gained

- `PictureActor` (kind `picture`): a rounded tile with a picture, its crop, depth, glare and `shine`, in the inspector, the agents' tools (`add_limelight_actor` kind picture, `update_limelight_actor`), Drive and undo (its picture counts in `sceneMediaIds`).
- `BackdropStyle` `glow`, shown as Lights under Backdrop.
- `TextActor.highlight`, shown as "Last words in another colour".
- `LimelightScene.music`: `pulse` or `calm`, made by the app at the video's length, with a cymbal on each camera cut, played in the preview (the sound's clock drives the playhead, with a mute button) and encoded into the export's AAC track; `set_limelight_look` takes `music`.

### What was checked

- Frames on the GPU (Chrome, ANGLE Metal) at the App Store, wide and tall sizes, with and without an icon, and frames read back out of an exported MP4 (886 x 1920, 450 frames, 15.000 s of picture, AAC stereo 48 kHz). The first frames of this design showed a backdrop bright enough to be a green wall, the phone hiding the name's second line, the three phones small in a row, the wide name losing its last letter behind the phone, and a messy exit to the icon; each was changed and looked at again.
- The music, rendered in headless Chrome and measured with numpy (nobody here can listen to it): peak -1 dBFS, about -17.7 dBFS RMS, energy 14% under 60 Hz, 49% to 250 Hz, 28% to 2 kHz, 9% above, stereo width 0.12; the first mix was 95% bass and was rebalanced. The biggest sample to sample jumps all fall within 4% of a beat, on the drum hits.
- An exported track ran 15.061 s for 15 s of picture (the encoder's tail); `createAudioTrack` now drops the frames past the picture, which the editor's own export uses too.
- `npm run test:unit`: 954 of 954, 12 of them new in [limelight-film.test.ts](../tests/unit/limelight-film.test.ts) and the intro's tests rewritten for the new timeline. Mutations: 23 of 23 caught (two only after their tests were changed so that the guard alone decided: a chart beating a list by colour rather than size, and a photo with plain stripes).
- `tests/e2e/specs/limelight.spec.ts`, with a new test that exports a scene with music: `web` (Chromium) 14 passed, 4 skipped (the exports, which skip in that browser as they did before), exit 0, 15.4 min; `desktop` (WebKit) 17 passed, 1 skipped (Drive), exit 0, 8.5 min, WebKit at 1,142 MB at most. E2E mutations, each checked in the compiled chunk before and after: the music left out of the export (the test read a peak of 0 where it wants over 0.2) and the captions in early (1,274 light pixels over the phone where it allows 2), both caught.
- The final export: 450 frames, 15.000 s of picture and 14.997 s of sound, AAC stereo 48 kHz, made in 19.5 s in Chrome with no console errors.
- `npm run typecheck`: 133, all in `promo/` and `promo-i18n/`. The copy checker: nothing to fix. The CLI build: 79 tools.
- A scene kept as the user's own template drops the cards cut from its old screenshots when new pictures go in (they would show the old screen's part), and keeps the icon.

### Not checked

- How the music sounds to a person.
- The music in the desktop app's own export: Playwright's WebKit reports an AAC encoder, the Mac app's web view was not tried.

## Next: the rest of step 5

1. Every language: render the scene once per project language with each screen's `ScreenOrigin` resolved to that language's screenshot (`projectArtboards(base, locale)`), one MP4 per language.
2. Recordings on the screens: a `ScreenChange` with a video media kind, decoded with WebCodecs or a video element per screen and drawn into the screen canvas per frame; media kept in pieces (Blobs fail in Playwright's WebKit), saved to Drive through the resumable upload already there.
3. More intro tones (a light one), the user's own music file with its beats found, and motion blur in the export.
4. A README line and a row in its web and desktop table (the user guide is written).

### For step 3: adding the agent tools

The pattern Remove background set (rule 81): tool definitions in `TOOLS` in `src/lib/mcp/desktopMcpServer.ts` that call new `McpDesignApi` methods; the work in `src/lib/limelight/mcp.ts`, imported only by the layout's `mcpApi` (the CLI build loads desktopMcpServer.ts in Node, so nothing it imports may touch the DOM or three.js at import time). Slow tools go on all three `SLOW_TOOLS` lists (desktopMcpServer.ts, src-tauri/src/mcp_server.rs, cli/src/driver/session.ts); reads that no render depends on go on `READ_ONLY_TOOLS`. A new skill is `src-tauri/claude-agent/skills/<name>/SKILL.md` (frontmatter of name and description only), its tuple in `SKILLS` in claude_code.rs, and `osg-agent:<name>` in both agents' prompts; `tests/unit/agentBrief.test.ts` refuses any snake_case word in a brief that is not a tool name. A frame for the agent to see is an `image` content block (base64 PNG without the data: prefix) first, then a text summary; keep it under 256 KB of base64, since the Agent panel blanks bigger images. Every edit goes through `edit.ts`, so the agent's changes follow the view's rules.

### For step 4: Drive

The Drive helpers are private to `src/lib/account/providers/googleDrive.ts`, so the adapter goes at its end, as `googleDriveLibrary` does (rule 80): a folder at the top of My Drive found by an app property (never inside the projects folder, never created by a read), one subfolder per scene with `scene.json` and `file__<mediaId>` files that never change. Save only when the user presses it (rule 25a). There is no resumable upload yet, and on the desktop every request body goes through the HTTP plugin as an array of numbers, so videos need a resumable upload in 8 MB pieces (`uploadType=resumable`, `Content-Range`, a 308 means send the next piece), calling `withFreshSession` between pieces.

## How to run it

- A dev server from the worktree: `./node_modules/.bin/next dev -p 9014 -H 127.0.0.1` (webpack; Turbopack does not follow the linked node_modules). The worktree's `node_modules` is a link to the main checkout's.
- Unit tests: `npm run test:unit -- limelight`.
- E2E: `E2E_NO_SERVER=1 E2E_BASE_URL=http://127.0.0.1:9014 npx playwright test --project=web tests/e2e/specs/limelight.spec.ts`, and again with `--project=desktop`. The spec runs one test at a time; on this Mac Playwright's Chromium draws WebGL on the CPU (about four cores a stage), so a full run takes 5 to 9 minutes. Watch WebKit's memory on long runs (its GPU process once grew past 30 GB).
