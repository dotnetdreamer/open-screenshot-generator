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
- list_limelight_templates gives the ready camera moves (app-intro, hero-orbit, push-in,
  side-by-side, spin-reveal, low-hero, floating-stack, flyover, phone-and-tablet, title-opener,
  turntable), the user's own templates, the sizes and the devices. app-intro is a whole 15
  second launch film with its own music: the app's name big with the phone sweeping up in front
  of it, three cuts each with a screen, its artboard's headline as a caption and a card of the
  screen lifting toward the camera, three phones together, and the app's icon as a glossy tile
  with the name. With fromProject true it takes the project's screenshots, headlines, colour,
  font and App icon artboard, so use it when the user asks for an intro, a trailer or a launch
  video.
- create_limelight_scene makes a scene, from a template or as one phone. Pass fromProject true
  to put the open project's own screenshots on the screens, or pictures with an artboardId or an
  asset: src.
- add_limelight_actor adds a device (kind device), a 3D title (kind title) or a picture card
  (kind picture: a logo, or a part of a screenshot with crop). update_limelight_actor changes
  one; remove_limelight_actor takes one off.
- set_limelight_camera replaces the shots. set_limelight_look changes the light, the backdrop,
  the music, the size and the length. update_limelight_scene replaces a whole scene, for big
  rewrites only.
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
  reveal brings its words in one after another: style rise (each comes up from behind its line),
  fade or pop, by word or letter, from time for duration seconds. A name reads well by letter
  over 0.6 to 1 second, a caption by word over 0.5 to 1. Before its time a word isn't there, so
  render a moment after the reveal ends to see the whole title. highlight { color, words } puts
  a title's last words in a colour of their own: a light tint of the app's colour reads on a
  dark stage.
- A picture card stands on its own: width and height in cm, corner (0.225 for an app icon),
  depth (cm thick; an icon tile looks right at about 0.8), glare, crop (the part of the picture,
  as shares from its top left) and shine (the second a light sweeps across it). It fades with
  its pose's opacity, unlike a device.
- Put several devices side by side with a gap of 2 to 4 cm, or one behind another with z offsets
  of 5 to 10 cm for depth.

## Look and music

- backdrop style glow is soft lights of top (a mid colour, such as the app's colour at 30%
  lightness) on bottom (near black); they shift as the camera moves round, which gives depth.
- music { track pulse or calm, volume 0 to 1 } is made by the app at the video's length:
  nothing to license, and every camera cut gets a cymbal. Its tempo is 128 beats a minute, a
  beat every 0.469 s and a bar every 1.875 s: put cuts (a shot with ease cut, then the next
  shot) on beats, and the close on a bar, and the music lands with the picture. music null
  takes it off.

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
