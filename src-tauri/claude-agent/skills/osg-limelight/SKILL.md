---
name: osg-limelight
description: Limelight, the promo videos of the user's app filmed on 3D phones and tablets with a real camera. Load it when the user asks for a promo video, an App Store preview, a 3D or camera move video, or anything in Limelight.
---

# Limelight

Limelight is the editor's view for promo videos: the user's screenshots on 3D phones and tablets
at their real sizes, lit like a product shoot, filmed by a camera that moves between shots. A
scene is plain data the tools read and change. The Limelight view does not have to be open, and
the tools never switch the user's screen to it. When it is open on the scene you change, the user
watches it change and can undo your change there.

## The tools

- list_limelight_scenes and get_limelight_scene read. Read a scene before you change it.
- list_limelight_templates gives the ready camera moves (hero-orbit, push-in, side-by-side,
  spin-reveal, low-hero, floating-stack, flyover, phone-and-tablet, title-opener, turntable),
  the user's own templates, the sizes and the devices.
- create_limelight_scene makes a scene, from a template or as one phone. Pass fromProject true
  to put the open project's own screenshots on the screens, or pictures with an artboardId or an
  asset: src.
- add_limelight_actor adds a device (kind device) or a 3D title (kind title).
  update_limelight_actor changes one; remove_limelight_actor takes one off.
- set_limelight_camera replaces the shots. set_limelight_look changes the light, the backdrop,
  the size and the length. update_limelight_scene replaces a whole scene, for big rewrites only.
- render_limelight_frame draws a moment and gives you the picture. It is how you look.
- delete_limelight_scene only when the user asks, and never the scene open in the view.

## Units and directions

Lengths are centimetres, angles degrees, times seconds. The floor is y 0. A phone is about 7 cm
wide and 15 cm tall and stands with its centre near y 9.5, 2 cm above the floor; an iPad Pro is
about 22 by 28 cm. A device with no turn shows its screen toward +z, which is where a camera at
azimuth 0 stands. Positive yaw shows the device's left side, positive pitch leans its top toward
the camera, roll turns it in the picture.

## The camera

Each shot is a time, an ease, and a camera: target (what it looks at), azimuth (degrees round the
target: 0 in front, positive to the right), elevation (degrees above; negative looks up from
below), distance (cm), roll, lens (mm across the picture's short side: 24 wide, 50 normal, 85 to
135 the flat look of product photos), aperture (the f-number: 8 keeps a whole phone sharp, 2.8
blurs what is behind) and focus (cm behind the target).

- Let fit do the framing. A shot with fit true frames every device from its angle and lens, and
  pull then moves in (0.8 is closer) or out (1.2 is wider). Give azimuth, elevation, lens and fit,
  not distances you worked out.
- The ease says how the camera leaves a shot for the next one: smooth stops at each shot, glide
  keeps moving through them on one curve (use glide for one long move), steady keeps one speed,
  snappy starts fast and settles slowly, bounce goes a little past, cut jumps.
- Angles are never wrapped: shots at azimuth 0 and 360 make a full turn round the subject.
- Two to four shots make most moves. Keep the turn between neighbouring shots under about 60
  degrees unless the user wants a spin.
- shake 0.1 to 0.2 gives a gentle handheld feel; 0 is a tripod.

## Devices, screens and titles

- A device with one pose stays still. Give poses (a list of time, ease, position, turn, scale and
  opacity) to move it; float (cm) and spin (degrees a second) are movement on top.
- A device's screens show pictures from given times on, coming in by slide, scroll, fade, zoom or
  cut. update_limelight_actor with pictures spreads new screenshots over the whole video.
- A title is 3D text with a pose like a device. Keep it short: the app's name or a few words.
- Put several devices side by side with a gap of 2 to 4 cm, or one behind another with z offsets
  of 5 to 10 cm for depth.

## Sizes and the App Store

app-store-iphone is 886 x 1920 and what App Store Connect takes for iPhone app previews;
app-store-ipad is 1200 x 1600 and app-store-mac 1920 x 1080. The App Store takes previews of 15
to 30 seconds at up to 30 frames a second. story, square and portrait are for social posts.

## How to work

1. list_limelight_scenes, then get_limelight_scene for the one the user means (often the one
   with open true), or create_limelight_scene from a fitting template with fromProject true.
2. Make the change with the narrowest tool.
3. render_limelight_frame at the start, the middle and the end, look at each picture, and fix
   what is off: a device cut off at an edge, a title over a screen, a camera that sees the side
   of a phone when the screen matters.
4. Reply in a sentence or two about what the video does now.
