---
name: osg-design
description: >-
  How to build and edit App Store and Google Play screenshot designs in the project that is open
  in Open Screenshot Generator, using the osg-editor design tools. Load it before the first
  design tool call of every conversation in this chat. It covers every design request: a first
  design from the user's screenshots, templates, headlines and copy, fonts, colours, backgrounds,
  device frames, layout fixes, adding, removing or reordering artboards, translations and App
  Preview videos.
---

# Designing in the open project

You drive the live editor. Each tool call runs the same code a click in the editor runs, so the
user sees every change land on the canvas, and every mutating call is one undo step.

## The working loop

1. Inspect. list_artboards for ids, sizes and the active board, then get_artboard on each board
   you will touch for its element ids and current values.
2. Plan the whole change before the first edit: which boards, which layers, what copy.
3. Edit in batches. add_elements for new layers (one call per board, listed back to front),
   update_element for each changed layer, apply_template to fill a template, set_localized_texts
   for translations.
4. Measure every text you added or rewrote with measure_element.
5. Look. export_png with scale 0.3 on each board you changed. A design that reads right as data
   often looks wrong as a picture.
6. Fix what looks off and look again. Two rounds per board is normally enough.
7. Reply in a few plain lines.

One design tool call at a time, always: each call reads the canvas the previous one committed.

## Rules that otherwise fail silently

- Pairs. Pass x with y, and width with height. An x alone also moves the element to y 0, and a
  width alone is dropped without an error.
- null clears. An explicit null removes a property (shadow, fillGradient, an animation's enter
  or exit). Leaving a key out leaves it as it is.
- Fonts. fontFamily must be a family list_fonts returns, or the call is rejected with the nearest
  names. Loaded families include Poppins, Outfit, Space Grotesk, Bricolage Grotesque, Roboto Flex,
  Noto Sans, Oswald, Fredoka, Unbounded, DM Serif Display, Playfair Display, Anton and Bebas
  Neue. Inter, Montserrat, SF Pro, Roboto, Lato and Open Sans are not loaded.
- Stacking. Elements paint in list order: the first is at the back and a new one lands on top.
  Fix the order with reorder_element (action front, back, forward or backward, or an index)
  instead of rebuilding a board.
- Atomic batches. add_elements adds all of its elements or none. The error names the entry
  ("elements[2]: ..."); fix that one and send the batch again.
- Boards. Where a board sits on the canvas is derived; change the order with update_artboard
  index (0 is leftmost). Rename every board you make, because the name becomes the export file
  name. delete_artboard refuses the last board.
- Text boxes do not grow. update_element changes only what you pass, so new copy in an old box
  can clip. Measure it.
- Video content. A video-device, video or gesture element, or any set_animation, switches the
  whole project's Export button to the video dialog. Never put them on a screenshot board.
- Languages. Every editing tool writes the base design that all languages share. See Languages.
- Errors are data. A rejected call returns isError and a sentence saying what to fix, often which
  tool to use instead. Fix the argument and retry once.
- Keep reads small. A text result over about 25k tokens is cut short or swapped for a file path
  you cannot open, not even with Read. Narrow list_templates with category or query, list_library
  with kind, group or query, and page list_translations with limit and offset.

## Artboard sizes

Store sizes, with the preset id that create_artboard and update_artboard accept:
- iPhone 6.9 inch: 1290x2796, ios-6-9. The required App Store tier; Apple scales it down for
  smaller iPhones. 1320x2868 (ios-6-9-promax) fills the same slot.
- iPad 13 inch: 2064x2752, ipad-13.
- Google Play phone: 1080x1920, play-phone. 1080x2160 is play-phone-tall. Play needs at least 2
  screenshots.
- Google Play tablets: 1200x1920 play-7, 1600x2560 play-10.
- Apple Watch Ultra 3: 422x514, watch-ultra-3.
- Mac: 2560x1600, mac-2560.
- Google Play feature graphic: 1024x500, play-feature-graphic.

Keep one size across a set. Resizing a board with update_artboard (width and height, or preset)
scales its content with it unless you pass scaleContent false. The editor's Export dialog can
also generate the other App Store device sizes from one design, so do not rebuild a set per
device unless the user asks.

## A first design from the user's screenshots

The screenshots arrive as asset refs (asset:asset_...) with their pixel sizes, and as images you
can read. list_assets lists every uploaded image if you need a ref again. Copy refs exactly.

1. Read the screenshots: the app's name, what each screen does, real feature names and numbers,
   the brand colour, light or dark UI. The shape tells the device: about 1:2.2 is a phone, 3:4 an
   iPad, near square a watch, 16:10 a Mac.
2. Order the set: lead with the screen that shows the app doing its core job with real content,
   then the differentiator, then proof or results, then breadth. The first two boards are the
   ones most people see. Use every screenshot unless the user said otherwise; 3 to 5 boards is a
   strong set.
3. Choose a route.

### Route A: a template, when one fits

- list_templates with category screenshots, apple-watch, mac or play-feature-graphic, plus a
  query for the app type or mood ("finance", "dark", "playful"). Each entry has artboardCount and
  deviceSlotCount. Pick one whose deviceSlotCount is close to the number of screenshots and whose
  description suits the app. Copy each id exactly from list_templates (for example
  template_somnia_sleep); never build one from a template's name.
- get_template gives, per board, deviceSlots (elementId, deviceType) and textSlots (elementId,
  content).
- apply_template with templateId, texts (elementId, content), screenshots (elementId, and src set
  to an asset ref), and projectName when the project still has a placeholder name. It replaces
  every board of the open project with a filled copy in one undo step, keeps the project and its
  languages, and returns the new boards.
- Rewrite every headline and subline in texts, because template copy describes a made up app.
  Its ratings, review quotes and award lines are samples too. Keep them only if the user gave you
  real ones; otherwise replace them, remove them with delete_element, or point them out in your
  reply.
- Read the warnings it returns: they name fills that missed and frames still showing a sample
  screen. Rename each board after its new headline with update_artboard name, and call
  get_artboard before you edit a board's elements.
- More slots than screenshots: a board where no frame holds one of the user's screenshots (every
  screenshotSrc there still starts with /data/ or /elements/, not asset:) is a leftover, so
  remove it with delete_artboard unless the user wants that many boards. A sample frame beside a
  filled one gets another screenshot, or goes with delete_element.
- No screenshots at all: when the user's app folder is attached, look there first
  (fastlane/screenshots/<language>, fastlane/metadata/android/<language>/images/phoneScreenshots,
  a screenshots or store folder, images the README shows), import the plain screens you find
  with import_project_image (never a finished store image, which has its own frame or caption)
  and put the refs in the frames. Otherwise keep every sample screen, and tell the user they can
  drop their screenshot files onto the canvas, which fills the device frames.
- Measure the rewritten texts, then look at every board.
- There are no iPad templates, and the screenshots templates are 1290x2796 with iPhone frames.
  Build iPad and Google Play boards from scratch.

Use create_project_from_template only when the user asks for a separate project: it opens a new
one and leaves this one.

### Route B: from scratch

Build the first board completely and check it, then duplicate_artboard (with name) for each
further screen and change only its headline, subline and screenshotSrc. A copy lands right after
its source and becomes the active board, so always duplicate the board you made last (or pass
index with the current number of boards). Duplicating the first board every time reverses the
set. Check the order with list_artboards before you reply. Vary the layout a little across the
set so it does not read as one board five times.

A proven phone layout on 1290x2796, from the proportions the app's own generator uses:
- background: set_background with gradient color1, color2 and angle.
- headline: x 77, y 154, width 1135, height 391; fontSize 43, fontWeight "700", lineHeight
  1.15, textAlign "center".
- subline: x 129, y 559, width 1032, height 196; fontSize 18, fontWeight "400", lineHeight 1.35.
- device: subType iphone-17-pro-max, x 272, y 1118, width 746, height 1622, screenshotSrc the
  asset ref, screenshotObjectFit "cover".

As one add_elements call:

    {"elements":[
     {"type":"text","name":"Headline","content":"Track every drop","x":77,"y":154,"width":1135,"height":391,"fontSize":43,"fontFamily":"Poppins","fontWeight":"700","lineHeight":1.15,"textAlign":"center","color":"#FFFFFF"},
     {"type":"text","name":"Subline","content":"Gentle reminders that fit your day","x":129,"y":559,"width":1032,"height":196,"fontSize":18,"fontFamily":"Poppins","fontWeight":"400","lineHeight":1.35,"textAlign":"center","color":"#E8ECFF"},
     {"type":"device","subType":"iphone-17-pro-max","name":"Phone","x":272,"y":1118,"width":746,"height":1622,"screenshotSrc":"asset:asset_1727_ab12cd","screenshotObjectFit":"cover"}
    ]}

Other canvases keep the proportions. The headline box sits 6% from the left and 5.5% from the
top, 88% wide and 14% tall; the subline sits 10% in and 20% down, 80% wide; the device is centred
in an area 62% wide and 58% tall that starts 40% down, at the frame's own ratio. The headline
fontSize is about the board width x 0.033 (48 at most) and the subline about 0.42 of that.
Worked out:
- Google Play 1080x1920: headline 36, subline 15, android-punch-hole at x 289, y 768, 501x1114.
- iPad 2064x2752: headline 48, subline 20, ipad-pro-13 at x 433, y 1101, 1197x1596.

Variations that read well: the device at the top with the text under it; a tilted 3D phone; a
soft glow behind the device (a circle in a lighter tint with opacity 0.4 and blur 120, sent back
with reorder_element); two overlapping devices on one board; a big number or a short real quote
on a proof board.

## Text

- Glyphs render at about 3.3x fontSize (fontSize / 0.3). On a 1290 wide phone board a headline
  is 36 to 48, a subline 14 to 20 and small print 10 to 12; scale with the board width. The
  templates use about 15 to 23 for a watch headline, 20 to 34 on a Mac board and 15 to 20 on the
  feature graphic.
- Text wraps inside its box, sits centred vertically in it, and the box clips. A newline in
  content starts a new line.
- measure_element returns box, textBox (where the glyphs really are), renderedFontSize and
  clipped. When clipped is true, shorten the copy, lower fontSize, or make the box taller (width
  and height together).
- Resize text through fontSize and its box, never scale. transform_elements with scale changes
  both for you.
- Headlines read best heavy, with lineHeight 1.05 to 1.2, at a weight the family has (list_fonts
  gives each family's weights): "700" or "800" on Poppins, Outfit or Noto Sans, while Anton,
  Bebas Neue and DM Serif Display only come in "400" and are heavy already. Keep contrast high:
  white or near white on dark grounds, near black on light ones.
- Game titles: outlineColor and outlineWidth draw an outline round every letter, outside the
  glyph so the fill keeps its weight. About 0.075 x fontSize in a dark ink, plus a shadow
  straight down ({x: 0, y: fontSize / 6, blur: 0}), gives the chunky lettering of a mobile game,
  and Lilita One, Titan One and Luckiest Guy are the families drawn for it. Both fields are
  needed; null on either removes the outline.

## Devices and screenshots

- A frame is type device with a subType: iphone-17-pro-max (current iPhone), iphone-15-pro,
  iphone-15, android-punch-hole (current Android), android-notch, ipad-pro-13, ipad-11,
  tablet-7, tablet-10, apple-watch, macbook, imac or desktop.
- screenshotSrc takes the asset ref. screenshotObjectFit "cover" fills the screen and trims the
  edges; "contain" shows all of it.
- A flat frame stretches to its box, so keep the box at the device's ratio (width / height):
  about 0.46 for a phone, 0.75 for an iPad. A box can also keep a base size and grow with scale;
  it then covers width x scale by height x scale from x, y. rotation turns it about its centre.
- 3D: styleType "3d-left" or "3d-right", with pose3d and frameColor3d ("titanium", "black" or
  "white"). Phone poses: upright, side, tilted, reclined, laying, floating, drifting, leaning,
  soaring, isometric. The watch adds front; a MacBook takes front, upright, side, tilted and
  reclined; an iMac front, upright and side. The easy way is a ready made one: list_library with
  kind "devices" and a group such as 3d-iphone or 3d-android, then pass its libraryId, for
  example device3d:iphone-tilted-left-black. It arrives at the right box size for its pose.
- Coloured and outline frames: a devicecolor: libraryId from the same list, or frameColor,
  frameOpacity, frameStyle "outline" and notchColor on a flat frame.
- To change a frame's model, add the new device in the same box with the same screenshotSrc,
  remove the old one with delete_element, then reorder_element if the new one covers something.
- A screenshotSrc starting with /data/ or /elements/ is sample art, not the user's screenshot.
  Theirs are asset: refs.

## Backgrounds, shapes and decoration

- set_background with backgroundColor for a solid colour, or gradient with all three of color1,
  color2 and angle (a partial gradient is refused). 180 runs color1 at the top to color2 at the
  bottom; 90 runs left to right.
- Shapes: type shape with subType rectangle, circle, triangle, star, hexagon, pentagon, diamond,
  message or speech-bubble. They take fillColor, fillGradient, fillOpacity, borderRadius,
  strokeColor, strokeWidth and innerRadius (a ring).
- Any element takes opacity, blur (for soft glows) and shadow {x, y, blur, color}.
- list_library: kind "elements" has the groups shapes, arrows, icons, decor, blobs, stars, waves,
  laurels, lines and patterns; kind "images" has photos of hands and people holding phones, and
  store badges such as image:app-store and image:google-play. Call it with kind alone to see the
  groups, then with kind and group for item ids to pass as libraryId.
- An image element is type image with imageSrc (an asset ref) and objectFit. upload_asset stores
  an image from an http(s) link the user gives you and returns its ref. When the user's app
  folder is attached, import_project_image does the same for a picture in it, by its absolute
  path, and web links are refused.
- Arrangements: group_elements tags layers as one group. transform_elements moves (dx and dy, or
  x and y for the top left corner) or scales (about the centre) a group or a list of elementIds.
  align_elements lines two or more up on one edge (left, center-h, right, top, middle-v, bottom).
  distribute_elements evens the gaps between three or more (horizontal or vertical).

## Copy for store screenshots

- One benefit per board in 2 to 6 words, in the app's voice. Say what the user gets, not what the
  screen is called: "Sleep through the night" beats "Sleep tab".
- Use the real product name, feature names and numbers you can read in the screenshots, or in
  the user's app folder when one is attached. Never invent ratings, awards, download counts or
  quotes. The ones in code, mocks, fixtures or tests are samples, not facts.
- A subline is optional. One clear line beats two cramped ones.
- Sentence case, no period at the end of a headline, and no em or en dashes (use a comma or a
  colon). Keep a template's capitals if its headlines are written in capitals.
- A headline usually takes one or two lines. Break it where the phrase breaks.

## Follow ups

Change what the user asked about and keep the rest of the set consistent with it.
- "This" or "it": the selection in the editor context, normally on the active board. Pass
  artboardId when you know it.
- Bigger or smaller: transform_elements with elementIds and scale (about 1.15 or 0.87) resizes
  around the centre, and for text it scales fontSize and the box together. Measure and look.
- Move: update_element with x and y together, or transform_elements with dx and dy.
- Darker, lighter, another colour: set_background on every board of the set unless one was named,
  then check the text contrast.
- Another font: list_fonts, then update_element fontFamily on every headline and subline of the
  set, then measure, since widths change.
- New words: update_element content, then measure.
- Another template: confirm first if the boards hold work the user made. Then apply_template with
  copy written for the new slots and the same asset refs. It is one undo step.
- Add a board: duplicate_artboard on the closest board with a name, then change its headline and
  screenshot. Remove one: delete_artboard. Reorder: update_artboard index. Remove a layer:
  delete_element.
- Another screenshot in a frame: update_element screenshotSrc.
- Undo: the user can press Ctrl+Z (Cmd+Z on a Mac), one step per tool call. You can also write
  back the values you read before the change.
- Export or save: only when asked. export_all writes every board into the Open Screenshot
  Generator folder in Downloads and returns the paths; export_png with save true writes one board.
  Tell the user where the files went.
- Translate or add a language: Languages below. A preview video: App Preview video below.

## Languages

A language is an overlay on one design: one set of boards and one layout, with per language copy,
fonts, screenshots and positions on top.
- add_locales with store codes from list_supported_locales: de-DE, fr-FR, es-ES, es-MX, it,
  nl-NL, pt-BR, ja, ko, zh-Hans, zh-Hant, ar-SA, he and more. The first call may also pass
  baseLocale, the language the design is written in (for example en-US); after that it is locked.
  Leave machineTranslate off.
- Translate yourself: you write better store copy than the built-in engine. list_translations
  with filter "untranslated" gives the element ids and base strings. Send every string back in one
  set_localized_texts call whose writes each hold elementId, locale and text. Translate the
  benefit, not the words, keep product names, and follow the same copy rules.
- translate_locales runs the machine engine. Use it only when the user asks for it.
- set_locale with a locale shows that language on the canvas so the user can see it; without a
  locale it returns to the base. export_png also takes locale, renders that language and switches
  back.
- update_element changes the base copy for every language. For one language, use
  set_localized_texts for the words and set_locale_override for its fontSize, size, position,
  fontFamily, screenshotSrc or hidden. A fontSize override turns off auto shrink for that element.
- When language in the editor context is a code rather than null, the canvas shows that
  translation, so a request about the visible text means that language: write it with
  set_localized_texts, not update_element.
- A German headline that no longer fits: set_locale_override with a smaller fontSize, or a wider
  size, for de-DE only.
- For anything past these basics, load the osg-agent:osg-languages skill.

## App Preview video

A preview board plays a screen recording of the app, and you cannot supply one, not even from the
user's app folder: import_project_image takes pictures only.
- list_preview_scenes (query by app type), then add_preview_scene with sceneId adds a finished,
  animated 18 second board after the active one. get_artboard gives its layer ids; rewrite the
  text layers with update_element, 3 to 5 words each.
- The recording goes into the layer named "Phone (drop your recording here)". The user adds it:
  select that phone, then Upload Recording in the Properties panel. list_recordings shows
  recordings already stored; put one in with update_element mediaId. upload_recording only helps
  when the user gives you an http(s) link to a video.
- Until then, posterSrc on that phone can show one of the user's screenshots (an asset ref).
- Timing: set_animation (enter, enterDelay, exit, exitStart), get_preview_timeline to check it,
  and set_preview_duration with seconds between 15 and 30 for the App Store.
- A preview board switches the project's Export to the video dialog. If the project is a set of
  screenshots, confirm first.
- Before building a preview board, load the osg-agent:osg-app-preview skill.

## When something goes wrong

- "No such element": the id is from another board or an earlier turn. get_artboard on the right
  board, and pass artboardId.
- "No asset ...": the ref is wrong. Copy it from the first message or from list_assets; never
  retype an id from memory.
- "Unknown fontFamily": pick one of the families the error lists.
- "gradient needs color1, color2 and angle": send all three.
- A call returned ok and nothing changed: a lone x or width, or an edit that went to the base copy
  while the canvas shows another language.
- A gradient board exports flat white: set the gradient again with all three values.
- A call timed out: a dialog is probably open in the editor. Ask the user to close it.
- measure_element says the element is not on screen: call list_artboards, then retry once.
- When a retry fails too, stop and tell the user plainly what could not be done.
