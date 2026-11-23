# SPEC: "16 features. One take."

GOAL:    someone scrolling X watches a single unbroken camera move past sixteen LED screens, each one
         a screenshot feature of Open Screenshot Generator doing its thing, and ends on a slate that
         lists all sixteen with the address. They should come away thinking "that one free app does all of that".

REFERENCE: x.com/woodxbt/status/2124482580896498142 (33.8 s, 1440x1800, 60 fps). Its grammar is copied
         on purpose, its content is not: a ring of LED screens in a dark film studio, one screen per item,
         a prop in front of each, the camera trucking from screen to screen on the bar, a whip out to a
         wide shot of the whole ring, a push into a clapperboard that lists every item.
         Measured from the reference (flow.js, tempo.js on its frames and audio):
         - music 150 BPM, one bar = 1.6 s; every pan starts on a bar downbeat
         - a pan travels ~1100 px of a 1440 px frame in ~0.75 s, ease in and out, peak ~35 px/frame,
           now and then a small overshoot that settles back (~120 px over 0.5 s) and a vertical drift
         - the first screen holds 2 s, the other fifteen ~0.85 s each between pans
         - at the hold the screen is ~69% of the frame width, its top ~13% from the top, the prop covers
           the bottom ~20%, 5% slivers of both neighbours show at the edges
         - 26.6 s whip out (0.7 s, bright smear), slow push to the slate 27.3 to 30 s, approach 30 to 31 s,
           clap and end card 31 to 31.7 s, end card held still to the end
         - screens: dark header, a 6 px accent bar, heavy sans name, medium sans line under it, a mono
           line in the accent colour, then the live demo; audio -17.9 LUFS, LRA 2.5 LU

OUTPUT:  HyperFrames, 1440 x 1800 (4:5, as the reference and the PromoRack cut), 60 fps
TIME:    40.0 s x 60 = 2400 frames, on the music: promo/public/intro.mp3 at 120 BPM, bar = 2.0 s =
         120 frames, beat = 30 frames (the person asked for this track on 23 November; the reference's
         150 BPM, 1.6 s grid was used before that). Bar k starts at 0.5 + 2 k s. The track's crash is
         on bar 0 (the camera lands on screen 1), its rise on bar 1, its drop on bar 2; pans start on
         bars 1..15, the whip on bar 16, the clap on the track's final hit, bar 18 (36.5 s).

LOOK:    a dark film studio lit by its own screens.
         ground: studio black #0B0907 with warm haze #3A2414 at 15-25%; glossy floor, reflections blurred
         ~6 px at 1440, fading by 2 m from the screens
         practicals: warm tungsten bulbs #FFD27A, a few cool ones #CFF3F5, bloom only on bulbs and screen highlights
         brand: teal #6FB3B5 (truss line, floor ring, accents), deep teal #457E80, gold #D4AF37 (slate, pill)
         screens: content #0E1013 to accent glow at the bottom, accent bar 6 px, 16 accents from one palette
         type on screens: Space Grotesk 700 82 px (names), Inter 600 40 px (lines), JetBrains Mono 500 30 px
         (mono line) on a 1024 x 1280 screen; end card: Instrument Serif 400 + italic (title), Space Grotesk 700
         (names), Inter 500 (lines), JetBrains Mono 700 (numbers)
         grade: 6% vignette, 3% grain, ACES tone map

OBJECTS: LED screen = a flat panel with a 3 cm dark bezel on a black riser, emissive, sharp text.
         clapperboard = striped clapper sticks (black and cream), a dark slate with a cream inset line, on a stand.
         every prop is a real thing a film set or a desk would hold (easel, tripod phone, paint cans,
         wood type, turntable, slider camera, 3D objects on plinths, cinema seats, globe, desk of devices,
         film camera, ring light, box robot, terminal, GET sign, stacked boxes with store sizes).
         Product content is the product's own captures (promo/public/features2, vs, juniper-set), never redrawn UI.

MOTION:  camera pans: sine in-out over 0.75 s (45 frames) from the downbeat, 5% of pans overshoot and settle
         over 0.5 s; a handheld float of 0.15 deg at 0.3 Hz, zero during the whip
         screen demos: arrivals expo.out 0.35-0.5 s, exits 0.2 s, staggers 0.06 s; every demo finishes
         its action inside its hold and then holds still
         whip: 0.7 s, power3 in-out, shutter blur 12 samples
         clap: sticks close in 5 frames on 31.2 s with a 2 frame shake
         motion blur: camera sub-frame accumulation, 180 deg shutter, 8-12 samples while the camera moves

SHOTS:   0.0-0.5    crane up from the easel prop to screen 01 (the pickup into the crash)
         0.5-2.5    01 Templates holds, its demo plays (wall of templates, one is picked)
         2.5-31.25  pans to 02..16 on bars 1..15 (the drop under the pan to 03), each demo plays as
                    its screen lands and holds 1.25 s
         31.25-32.5 16 Every size holds (boxes ship)
         32.5-33.2  whip out and round to the wide shot
         33.2-35.5  wide: the whole ring, the slate in the middle, push in under the fill
         35.0-36.3  the slate's list writes on; 35.5-36.5 the push into it
         36.5       clap on the final hit, end card: title, 16 lines, pill
         36.5-40.0  end card held still while the hit rings out

BANNED:  a slideshow of screenshots with captions; tilted product UI floating in a void; corner labels or
         HUD decoration; glow on text; particles; dashes and full stops in on-screen copy; any number not
         verified in the code (122 templates, 57 languages, 17 phones, 276 pictures are verified);
         the logo docked in a corner

QA:      at 0.6, 2.4, 4.8, 21.5, 32.85, 34.3, 35.9, 36.7, 39.2 s: header readable at 360 px wide, prop
         covers only the bottom, neighbours show as slivers, the cut points of the music on the bars
