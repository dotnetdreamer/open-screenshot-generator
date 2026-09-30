---
name: osg-app-preview
description: >-
  How App Preview video boards work in Open Screenshot Generator: preview scenes, the user's
  screen recording, animation timing and the App Store rules for previews. Load it before
  adding or editing a preview board, or when the user asks for a video or an App Preview.
---
# App Preview video in depth

## The rule behind it

Apple Review Guideline 2.3.4: an App Preview may only use video captured from the app itself.
Text overlays and gesture hints that explain the footage are allowed; an animated mockup or a
montage of stills is not. So a preview board is built around the user's real screen recording.

## What you can and cannot do

- You have no files, so you cannot supply the recording. The user adds it: they select the phone
  layer (named "Phone (drop your recording here)" on a scene) and use Upload Recording in the
  Properties panel.
- list_recordings lists the recordings already stored, newest first, with mediaId and duration.
  Put one in with update_element mediaId on the video-device layer.
- upload_recording takes source as an http(s) URL the app can fetch. Use it only when the user
  gives you such a link; never paste video data into a tool call.
- posterSrc on a video-device shows a still (an asset ref, for example one of the user's
  screenshots) until the recording arrives.
- The MP4 is rendered from the editor's Export dialog. No tool renders it.

## Building a board

1. list_preview_scenes with a query ("finance", "fitness", "social", "proof"). Each scene is a
   whole finished board: a phone playing the recording, timed copy, gesture hints and a call to
   action, 18 seconds long. Ids include spotlight-launch, feature-rush, headline-punch,
   five-star-proof, three-taps, money-mode, sweat-session, calm-hour, night-feed, order-up,
   trip-ready, beat-drop, learn-streak, shop-drop, focus-block, snap-fix, team-sync,
   health-check, play-now and home-control.
2. add_preview_scene with sceneId (and a name) adds it as a new board after the active one. It
   takes the project's size when that is a portrait phone canvas; the MP4 is 886x1920 either way.
3. get_artboard for the layer ids and names.
4. Rewrite every text layer with update_element: 3 to 5 words, one idea each, readable in under
   two seconds over moving footage.
5. get_preview_timeline to check the board before telling the user it is ready.

Building from scratch is several times the work. add_elements takes type video-device (a phone
or tablet playing a recording, with the frame as subType), video (a frameless recording) and
gesture (gestureType tap, double-tap, swipe-left, swipe-right, swipe-up or swipe-down, with
triggerTime, gestureDuration and gestureRepeat).

## Timing

- set_animation takes elementId with enter (fade, slide-up, slide-down, slide-left, slide-right,
  scale-up, pop), enterDelay (the second it starts), enterDuration (default 0.6), exit, exitStart
  (an absolute second; without it the layer never leaves) and exitDuration, or clear true. null
  removes an enter or an exit.
- An exitStart before the entrance has landed is rejected.
- set_animation refuses recordings and gestures. A recording always starts the board (trim it
  with trimStart and trimEnd on update_element), and a gesture is timed by triggerTime and
  gestureDuration.
- On the canvas and in a PNG every layer is drawn at rest, all at once. Never stack two layers in
  one place to take turns in time: that works in the MP4 and looks like a smear everywhere else.
- set_preview_duration with seconds: 15 to 30 for the App Store (1 to 60 is allowed). null goes
  back to the length the content needs.
- get_preview_timeline reports the length, one clip per layer, and what will cause trouble at
  export: a board under 15 seconds, a layer animating past the end, no recording in the phone yet.

## Export constraints

The MP4 is 886x1920 portrait (1920x886 landscape), H.264, one file per board, and the App Store
takes 15 to 30 seconds. Only flat frames play the footage: a 3D or perspective device exports as
a still, so keep the phone flat. The recording's own sound is kept only when keepAudio is true.

## Keep it apart from screenshots

A video-device, video or gesture layer, or any animation, switches the whole project's Export to
the video dialog. If the open project is a screenshot set, confirm before adding a preview board,
and suggest a separate project for it.
