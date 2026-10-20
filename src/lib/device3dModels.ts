/**
 * The phones the 3D Studio draws, in millimetres.
 *
 * The iPhones are measured from Apple's dimensional drawings for accessory
 * makers (https://developer.apple.com/accessories/dimensional-drawings/),
 * from the drawings' labels and vector geometry, with estimates marked where
 * the drawings omit a detail. `drawing` is the date printed on the source
 * sheet.
 *
 * Google publishes no such drawings, so the Pixels come from Google's own
 * material instead, scaled to the size on Google's tech specs page:
 *
 *   front    the Android Studio device frame (AOSP
 *            platform/tools/adt/idea, artwork/resources/device-art-resources),
 *            drawn at the display's own pixel pitch; the
 *            outline, display, corners, camera hole and buttons are measured
 *            off it, and the Pixel 3 XL notch is the cutout path in its AOSP
 *            device config
 *   back     Google's hardware diagrams (support.google.com/pixelphone,
 *            answer 7157629), the dimension drawing on the Pixel 3 spec page
 *            of the Google Store (archived), and the Google Store's
 *            straight-on renders
 *   side     the Google Store side renders where there is one; the edge
 *            section and the camera heights are estimates
 *
 * For a Pixel, `drawing` is the day those sources were read. Finish colours
 * are matched to product photos for both makers. The renderer
 * (elements/DeviceStudioRenderer.tsx) and the box fit (device3dStudio.ts)
 * build from these entries.
 *
 * Coordinates follow the drawings:
 *
 *   front view  x from the left edge seen from the front, y down from the top
 *   back view   x from the left edge of the back view, which is the phone's
 *               RIGHT side seen from the front (the cameras sit at small x),
 *               y down from the top
 *   z           from the middle of the thickness, positive toward the screen
 */

import type { DeviceType } from '@/types/artboard';

/** [x, y] in mm. */
export type Point2 = [number, number];

/** A point on the edge cross-section: [inset from the outermost line, z]. */
export type EdgePoint = [number, number];

export interface PhoneFinish {
  id: string;
  label: string;
  /** The frame (and the metal back of a unibody), #rrggbb. */
  frame: string;
  /** The back glass, or the glass window on a metal back, #rrggbb. */
  back: string;
  /** A power button in a colour of its own, #rrggbb. Unset is the frame's. */
  accent?: string;
}

export interface PhoneButton {
  /**
   * Seen from the front. An iPhone's Action and volume buttons are on the
   * left, a Pixel's all on the right; the iPhone Duo's volume buttons are on
   * its top edge.
   */
  side: 'left' | 'right' | 'top';
  /** From the top edge to the button's centre; for a button on the top edge, from the left edge. */
  center: number;
  length: number;
  /** Across the edge, front to back. */
  width: number;
  /** How far it stands off the frame; 0 is flush. */
  proud: number;
  /** 'control' is the flush sapphire Camera Control. */
  kind: 'button' | 'control';
  /** From the front face to the button's centre, when it is not centred. */
  z?: number;
  /** Takes the finish's accent colour (the power button of a Pixel 4 or 3 XL). */
  accent?: boolean;
}

export interface PhoneLens {
  /** Centre, back view. */
  x: number;
  y: number;
  /** Outer diameter of the metal ring round the lens. */
  ring: number;
  /** Diameter of the ring's top face, inside which it steps down. */
  ringInner?: number;
  /** Diameter of the cover glass. */
  glass: number;
  /** A rectangular camera window, when its surround is not circular. */
  window?: { width: number; height: number; radius: number };
  /**
   * How far the ring's top face sits below the top of the cover glass, which
   * is at lensTop; negative when the ring stands proud of the glass. Unset is
   * flush.
   */
  ringDrop?: number;
}

export interface PhoneDisc {
  x: number;
  y: number;
  d: number;
  /** A pill this long across the back instead of a circle (the iPhone Duo's mic grille). */
  length?: number;
}

/**
 * The full-width camera plateau of the aluminium Pro models: a flat top that
 * rises out of the back on a concave wall and ends at a crisp edge. The
 * frame keeps its usual rounded rim round the top and sides; the wall starts
 * inside it.
 */
export interface PlateauPad {
  shape: 'plateau';
  /** Its top above the back. */
  height: number;
  /**
   * The flat top: its inset from the sides and top, the y of its bottom
   * edge, and its corners, which are the outline's corner scaled down to
   * this size (not the outline's corner moved in).
   */
  deckInset: number;
  deckBottom: number;
  deckCorner: number;
  /**
   * The wall, from the drawing's sections along the length: [distance out
   * from the flat top's edge, height above the back], from that edge out to
   * where the wall lies flat on the back. Round the top and sides it runs on
   * over the frame's rounded edge.
   */
  wall: Point2[];
}

/** Any other raised camera area, a rounded rectangle or a stadium, back view. */
export interface IslandPad {
  shape: 'rounded' | 'stadium';
  /** The footprint where it meets the back. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Corner radius of the footprint. A stadium's ends are half circles and ignore it. */
  radius: number;
  /** Its top above the back. */
  height: number;
  /** How far in from the footprint its flat top starts. */
  round: number;
  /**
   * How it rises to that top: 'round' rolls over convexly at the top edge,
   * 'cove' leaves the back tangentially on a concave curve and meets the top
   * at an angle (the glass camera bumps). Unset is 'round'.
   */
  edge?: 'round' | 'cove';
  /**
   * The cove as the drawing's section draws it: [distance out from the top's
   * edge, height above the back], ending on the back at `round`. Without it a
   * cove is a circular arc.
   */
  wall?: Point2[];
  /** 'back' is the back glass raised, 'frame' metal in the frame colour, 'satin' the same metal not polished, 'glass' dark camera glass. */
  material: 'back' | 'frame' | 'satin' | 'glass';
}

/**
 * A raised bar whose flat top and base differ in shape, joined by a concave
 * skirt that is wider in some places than others (the iPhone Air's plateau).
 * Its base follows the outline `inset` in from the edge down to a straight
 * line at baseBottom, turning up on a quarter ellipse that leaves that line
 * `baseCurve` in from each side and meets the sides at baseSide. Its top is a
 * stadium. Back-view coordinates.
 */
export interface LoftPad {
  shape: 'loft';
  inset: number;
  baseBottom: number;
  baseCurve: number;
  baseSide: number;
  top: { x0: number; y0: number; x1: number; y1: number };
  height: number;
  /**
   * The skirt as the drawing's sections draw it, [distance out from the top's
   * edge, height above the back]: `wall` where it is widest (below the top),
   * `wallNarrow` where it is narrowest (above it and at its ends). Between
   * the two, the skirt takes a shape between theirs by its width.
   */
  wall: Point2[];
  wallNarrow: Point2[];
  material: IslandPad['material'];
}

export type PhonePad = PlateauPad | IslandPad | LoftPad;

export type PhoneCutout =
  | { kind: 'none' }
  | { kind: 'island'; width: number; height: number; /** From the top edge to the island's centre line. */ center: number }
  | { kind: 'punch'; d: number; /** From the top edge to the hole's centre. */ center: number }
  | {
      kind: 'notch';
      /** Across the top of the active area. */
      width: number;
      /** Down from the top of the active area. */
      depth: number;
      /** Its two bottom corners. */
      radius: number;
      /** Where it meets the top edge. */
      shoulder: number;
      /**
       * The outline exactly, where the phone's own display config gives it
       * (Android's config_mainBuiltInDisplayCutout): an SVG path in display
       * pixels from the top centre of the display, y down, and the size of a
       * pixel in mm. The renderer and the flat frame draw the path when there
       * is one; the rounds above are its nearest circles.
       */
      path?: { d: string; pixel: number };
    };

/**
 * A phone that opens like a book (the iPhone Duo). Its model describes it
 * open flat, the way Apple's tech specs measure it: the hinge runs top to
 * bottom down the middle, the half on the right (seen from the front) carries
 * the cameras and the buttons, and the half on the left folds over onto it,
 * so closed, the left half's back, which holds the outer display, faces you
 * with the hinge on the left. Each half is the model's `thickness` thick.
 */
export interface PhoneFold {
  /** Closed, from the tech specs: the halves leave the rest of this thickness as a gap between their displays. */
  closedThickness: number;
  /** Closed, from the tech specs: half the open width, plus the spine standing out past the halves. */
  closedWidth: number;
  /** Each half's corners at the hinge, in the form of `corner`. */
  hingeCorner: Point2[];
  /**
   * Where the glass on each half's back meets its frame. On the free side,
   * top and bottom the edge profile ends `inset` in from the outline, its
   * round-over done `round` in. Along the hinge the frame is narrower
   * (`hinge`): its round-over `round` wide, the glass `inset` in from the
   * hinge line behind a seal `seal` wide, and the glass's corners there, in
   * the form of `corner`, rounder than the outline's.
   */
  back: { inset: number; round: number; hinge: { inset: number; round: number; seal: number; corner: Point2[] } };
  /**
   * The spine that covers the hinge once the phone starts to fold: how far
   * its ends stop short of the top and bottom edges, how far behind each
   * half's middle it meets that half's hinge side, and the round on its edges.
   */
  spine: { endInset: number; seam: number; round: number };
  /** The outer display, on the back of the left half, as it faces you on the closed phone. */
  outer: {
    width: number;
    height: number;
    /** From the hinge line to the display. It is centred top to bottom. */
    hinge: number;
    /** Its corners on the hinge side. On the free side they follow the outline, like an iPhone's display. */
    hingeCorner: Point2[];
    /** The camera hole: its diameter, and its centre in from the free edge and down from the top. */
    camera: { d: number; x: number; y: number };
    /**
     * The earpiece slot at its top, where the glass meets the frame: from
     * and to, measured out from the hinge line, and how far it cuts down
     * into the glass.
     */
    receiver: { from: number; to: number; depth: number };
    /** The display in points, as iOS reports it (its screenshot proportions). */
    screenPoints: [number, number];
  };
  /** How far open a new device starts, in degrees between the halves: 0 is closed, 180 flat. */
  opening: number;
}

/** A camera, sensor or speaker grille on the front, outside the display. */
export interface FrontPart {
  kind: 'camera' | 'sensor' | 'grille';
  /** Centre, front view: x from the left edge, y down from the top. */
  x: number;
  y: number;
  /** A circle when the two are equal, a pill otherwise. */
  width: number;
  height: number;
}

export interface PhoneModel {
  id: DeviceType;
  label: string;
  /** Apple's iPhones are measured from Apple's drawings (the Duo from Apple's product bezels), Google's Pixels from Google's device art. */
  maker: 'apple' | 'google';
  /** Date of the drawing the numbers come from (for a Pixel or the iPhone Duo, the day its sources were read). */
  drawing: string;
  width: number;
  height: number;
  thickness: number;
  /** The display in points as iOS reports it, or in pixels on Android (the screenshot proportions). */
  screenPoints: [number, number];
  /**
   * The frame, which sets how it shines: satin anodised aluminium, polished
   * aluminium, titanium, or aluminium under a matte coating.
   */
  metal: 'aluminium' | 'polished' | 'titanium' | 'coated';
  /**
   * The outline's corner (all four are the same), from where the top edge
   * stops being straight to where the side edge starts: [x from the side
   * edge, y from the top edge].
   */
  corner: Point2[];
  /** The edge cross-section from where the front is flat, round the outside, to where the back is flat. */
  edge: EdgePoint[];
  glass: { width: number; height: number };
  /**
   * The display's active area, centred across. Unless `top` is set it is
   * centred down too, and unless `radius` is set its corners follow the
   * outline at the same inset.
   */
  display: {
    width: number;
    height: number;
    /** From the top edge down to the display, when the bezel above it is not the one below. */
    top?: number;
    /** Round corners of their own (Android draws its display corners as circles). */
    radius?: number;
    /** The bottom corners, when they are rounder or squarer than the top ones. */
    radiusBottom?: number;
  };
  /** From the outside edge to where the front glass is flat. */
  flatInset: number;
  cutout: PhoneCutout;
  /** The earpiece slot at the top edge, y from the top. */
  receiver: { width: number; top: number; bottom: number };
  /** Cameras, sensors and grilles in the bezel or the notch. */
  front?: FrontPart[];
  /**
   * A glass back in a frame, or an aluminium back with a glass window (the
   * window's inset from the sides and the y of its top and bottom). A glass
   * back can carry a matte panel on otherwise glossy glass (the Pixel 3 XL):
   * its inset from the sides, the y of its top and bottom, and its corners.
   */
  back:
    | { kind: 'glass'; panel?: { side: number; top: number; bottom: number; radius: number } }
    | { kind: 'metal'; window: { side: number; top: number; bottom: number } };
  /** Raised camera areas, the one under the others first. */
  pads: PhonePad[];
  lenses: PhoneLens[];
  /**
   * How the lenses sit: 'ring' each in a metal ring standing off the back
   * (iPhone), 'window' behind the camera glass, flush with it (Pixel), where
   * `ring` is the dark surround each one shows through the glass. Unset is
   * 'ring'.
   */
  lensStyle?: 'ring' | 'window';
  /** The lens cover glass above the back. */
  lensTop: number;
  flash?: PhoneDisc;
  mic?: PhoneDisc;
  sensor?: PhoneDisc;
  /** A fingerprint sensor set into the back. */
  fingerprint?: PhoneDisc;
  buttons: PhoneButton[];
  /** The USB-C opening in the bottom edge: centred, unless `x` (front view) says where. */
  port: { width: number; height: number; x?: number };
  /** Speaker and microphone holes in the bottom edge, front view x. */
  holes: { x: number[]; d: number };
  /** Speaker holes in the top edge, front view x (the iPhone Duo's). */
  topHoles?: { x: number[]; d: number };
  screws: { x: number[]; d: number };
  finishes: PhoneFinish[];
  /** The finish a new device starts in. */
  defaultFinish: string;
  /** Set on a phone that folds: the model then describes it open flat. */
  fold?: PhoneFold;
}

// ---------------------------------------------------------------------------
// Finishes. Names are Apple's; the colours are matched to product photos.
// ---------------------------------------------------------------------------

const FINISHES_18_PRO: PhoneFinish[] = [
  { id: 'black', label: 'Black', frame: '#3b3b3e', back: '#36363a' },
  { id: 'silver', label: 'Silver', frame: '#dcdddf', back: '#e7e8ea' },
  { id: 'glacier', label: 'Glacier', frame: '#bccfdc', back: '#cddce6' },
  { id: 'burgundy', label: 'Burgundy', frame: '#4a1a24', back: '#55212b' },
];

const FINISHES_17_PRO: PhoneFinish[] = [
  { id: 'cosmic-orange', label: 'Cosmic Orange', frame: '#e8692b', back: '#ea7a3c' },
  { id: 'deep-blue', label: 'Deep Blue', frame: '#323d55', back: '#3a465f' },
  { id: 'silver', label: 'Silver', frame: '#dcdddf', back: '#e8e9eb' },
];

const FINISHES_AIR: PhoneFinish[] = [
  { id: 'space-black', label: 'Space Black', frame: '#2c2c2f', back: '#2a2a2d' },
  { id: 'cloud-white', label: 'Cloud White', frame: '#ecebe6', back: '#f2f1ec' },
  { id: 'light-gold', label: 'Light Gold', frame: '#e3d3b4', back: '#ebdfc8' },
  { id: 'sky-blue', label: 'Sky Blue', frame: '#c4d8e8', back: '#d3e3ef' },
];

const FINISHES_17: PhoneFinish[] = [
  { id: 'black', label: 'Black', frame: '#2f2f32', back: '#2b2b2e' },
  { id: 'white', label: 'White', frame: '#ecece9', back: '#f3f3f0' },
  { id: 'mist-blue', label: 'Mist Blue', frame: '#9fb3c8', back: '#b3c3d4' },
  { id: 'sage', label: 'Sage', frame: '#a3b094', back: '#b7c2a9' },
  { id: 'lavender', label: 'Lavender', frame: '#c2b2da', back: '#d2c5e5' },
];

const FINISHES_17E: PhoneFinish[] = [
  { id: 'black', label: 'Black', frame: '#2d2d30', back: '#2a2a2d' },
  { id: 'white', label: 'White', frame: '#eeeeeb', back: '#f3f3f1' },
  { id: 'soft-pink', label: 'Soft Pink', frame: '#efcfd1', back: '#f3dadb' },
];

const FINISHES_16_PRO: PhoneFinish[] = [
  { id: 'black-titanium', label: 'Black Titanium', frame: '#3c3c3e', back: '#3a3a3d' },
  { id: 'white-titanium', label: 'White Titanium', frame: '#e6e4df', back: '#efede9' },
  { id: 'natural-titanium', label: 'Natural Titanium', frame: '#bdb7ac', back: '#c9c4bb' },
  { id: 'desert-titanium', label: 'Desert Titanium', frame: '#b49a80', back: '#bfa891' },
];

const FINISHES_16: PhoneFinish[] = [
  { id: 'black', label: 'Black', frame: '#38383b', back: '#333336' },
  { id: 'white', label: 'White', frame: '#f0f0ec', back: '#f5f5f2' },
  { id: 'pink', label: 'Pink', frame: '#f08bc4', back: '#f3b3d8' },
  { id: 'teal', label: 'Teal', frame: '#6fb8b3', back: '#a9d3cf' },
  { id: 'ultramarine', label: 'Ultramarine', frame: '#4f62d9', back: '#8193ef' },
];

const FINISHES_16E: PhoneFinish[] = [
  { id: 'black', label: 'Black', frame: '#2e2e31', back: '#2b2b2e' },
  { id: 'white', label: 'White', frame: '#efefec', back: '#f4f4f1' },
];

const FINISHES_DUO: PhoneFinish[] = [
  { id: 'star-white', label: 'Star White', frame: '#d9d6cf', back: '#eeede9' },
  { id: 'night-sky', label: 'Night Sky', frame: '#3b4558', back: '#333c4b' },
];

// ---------------------------------------------------------------------------
// Plateau walls
// ---------------------------------------------------------------------------

// The Pro plateaus' wall, read off sections S-S, V-V and T-T on sheet 3: the
// curve through these points stays within 0.012 mm of the drawn one, and the
// Pro Max sheets draw the same wall to within 0.03 mm.
const PLATEAU_WALL_18: Point2[] = [
  [0, 2.78], [0.06, 2.731], [0.1, 2.498], [0.15, 2.295], [0.2, 2.134], [0.25, 1.997], [0.35, 1.771], [0.5, 1.501], [0.7, 1.216],
  [0.95, 0.939], [1.25, 0.687], [1.6, 0.464], [2, 0.285], [2.5, 0.138], [3, 0.054], [3.6, 0.011], [4.3, 0.001], [5.11, 0],
];
const PLATEAU_WALL_17: Point2[] = [
  [0, 2.55], [0.06, 2.502], [0.1, 2.347], [0.15, 2.175], [0.2, 2.037], [0.25, 1.915], [0.35, 1.729], [0.5, 1.451], [0.7, 1.195],
  [0.95, 0.901], [1.25, 0.667], [1.6, 0.436], [2, 0.269], [2.5, 0.131], [3, 0.05], [3.6, 0.011], [4.3, 0.002], [5.07, 0],
];

// The glass camera bumps' coves, from the sections through each bump on
// sheet 3 (17 G-G, 16 and 16 Plus L-L, 16 Pro and Pro Max G-G and J-J, which
// agree). Each curve stays within 0.002 mm of the drawn one.
const BUMP_WALL_17: Point2[] = [
  [0, 1.78], [0.04, 1.682], [0.08, 1.587], [0.12, 1.492], [0.17, 1.378], [0.26, 1.188], [0.37, 0.995], [0.49, 0.814], [0.63, 0.648],
  [0.78, 0.498], [0.95, 0.365], [1.14, 0.25], [1.33, 0.162], [1.54, 0.092], [1.75, 0.045], [1.97, 0.016], [2.19, 0.005], [2.62, 0],
];
const BUMP_WALL_16: Point2[] = [
  [0, 1.85], [0.04, 1.749], [0.09, 1.631], [0.13, 1.539], [0.17, 1.445], [0.22, 1.334], [0.27, 1.235], [0.33, 1.124], [0.39, 1.024],
  [0.51, 0.845], [0.65, 0.675], [0.81, 0.519], [0.99, 0.378], [1.18, 0.26], [1.39, 0.164], [1.6, 0.093], [1.82, 0.044], [2.04, 0.016],
  [2.27, 0.004], [2.71, 0],
];
const BUMP_WALL_16_PRO: Point2[] = [
  [0, 2.05], [0.25, 1.538], [0.58, 1.098], [1, 0.716], [1.48, 0.414], [2, 0.2], [2.55, 0.068], [3.1, 0.013], [3.66, 0],
];

/** A measured wall stretched to another width and height. */
function scaledWall(wall: Point2[], width: number, height: number): Point2[] {
  const [, h] = wall[0];
  const w = wall[wall.length - 1][0];
  return wall.map(([d, rise]) => [Math.round((d / w) * width * 1e4) / 1e4, Math.round((rise / h) * height * 1e4) / 1e4]);
}

// The iPhone Duo's camera island has no published section. Apple's bezel
// shows its glossy cove as a band about 1 mm wide round a flat top; the height
// is an estimate. Its shape is the iPhone 17's measured cove, stretched to fit.
const BUMP_WALL_DUO: Point2[] = scaledWall(BUMP_WALL_17, 1, 1.5);

// The iPhone Air bar's skirt: sections S-S and T-T draw the same 6.1 mm
// skirt below the bar, and the top of S-S a 3.5 mm one above it.
const AIR_WALL: Point2[] = [
  [0, 3.03], [0.1, 2.825], [0.21, 2.622], [0.33, 2.423], [0.46, 2.232], [0.59, 2.053], [0.74, 1.87], [0.89, 1.702], [1.05, 1.539],
  [1.39, 1.234], [1.75, 0.967], [2.14, 0.727], [2.55, 0.522], [2.98, 0.353], [3.41, 0.226], [3.86, 0.129], [4.31, 0.066], [4.76, 0.027],
  [5.22, 0.009], [6.11, 0],
];
const AIR_WALL_NARROW: Point2[] = [
  [0, 3.03], [0.12, 2.749], [0.25, 2.475], [0.4, 2.213], [0.56, 1.958], [0.74, 1.713], [0.94, 1.479], [1.15, 1.257], [1.37, 1.05],
  [1.6, 0.854], [1.85, 0.674], [2.1, 0.508], [2.37, 0.359], [2.92, 0.124], [3.5, 0],
];

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

// The iPhone Duo, Apple's foldable. Apple has published no dimensional drawing
// for it yet (the accessory index lists none on 16 Oct 2026), so it comes from
// Apple's own material instead:
//
//   size      the tech specs page: 164.6 x 117.8 x 5.2 open, 84.1 x 117.8 x 11.3
//             closed, the two displays' resolutions and diagonals
//   faces     Apple's product bezels (developer.apple.com/design/resources,
//             Bezel-iPhone-Duo), drawn at the outer display's pixel pitch and
//             scaled here by the 117.8 mm height (the open body then measures
//             164.57 wide): the outline and its corners, the hinge notch, both
//             displays and their corners, the outer camera hole and earpiece
//             slot, where each back's glass meets the frame, the camera
//             island, lenses, flash, mic and the side and volume buttons. The
//             bezels are only measured, never shipped.
//   edges     the tech specs page's external buttons diagram: which half each
//             hole, port and button is on, and where along the edge
//
// Estimated, because nothing Apple publishes shows them: the edge section,
// the camera heights, the Camera Control's size, the hole sizes, and how the
// halves and the spine move between open and closed.
export const IPHONE_DUO: PhoneModel = {
  id: 'iphone-duo',
  label: 'iPhone Duo',
  maker: 'apple',
  drawing: '2026-10-16',
  width: 164.6,
  height: 117.8,
  thickness: 5.2,
  // The inner display's screenshot, 2853 x 2007 at 3x.
  screenPoints: [951, 669],
  metal: 'titanium',
  // The open body's four corners agree to 0.02 mm; the corner leaves each edge 16 mm out.
  corner: [[16, 0], [13, 0.042], [11, 0.207], [9, 0.593], [7, 1.319], [5, 2.484], [3.648, 3.648], [2.484, 5], [1.319, 7], [0.593, 9], [0.207, 11], [0.042, 13], [0, 16]],
  // Estimated: a frame lip round the inner display that the bezel shows 0.65 mm
  // wide, flat sides, and a rounder back edge that it shows 1.31 mm wide.
  edge: [[0.65, 2.6], [0.45, 2.585], [0.3, 2.52], [0.17, 2.42], [0.08, 2.29], [0.02, 2.13], [0, 2], [0, -1.3], [0.04, -1.62], [0.17, -1.95], [0.38, -2.24], [0.65, -2.43], [0.95, -2.55], [1.31, -2.6]],
  glass: { width: 163.3, height: 116.5 },
  // The inner display: the bezel's 2853 x 2007 opening is 157.75 x 110.97 at
  // this scale, inside a bezel of 3.41 to 3.42 all round. One bezel of 3.415
  // all round, as on every iPhone sheet, gives these.
  display: { width: 157.77, height: 110.97 },
  flatInset: 0.65,
  // The inner camera sits under the display.
  cutout: { kind: 'none' },
  receiver: { width: 0, top: 0, bottom: 0 },
  back: { kind: 'glass' },
  pads: [
    // The glossy island, where the matte back's grain stops: a stadium whose
    // ends are nearly concentric with the first lens and the flash.
    { shape: 'stadium', x0: 4.9, y0: 4.69, x1: 60.39, y1: 25.64, radius: 10.47, height: 1.5, round: 1, material: 'back', edge: 'cove', wall: BUMP_WALL_DUO },
  ],
  lenses: [
    { x: 15.15, y: 15.19, ring: 16.14, ringInner: 14.32, glass: 14.1, ringDrop: 0.18 },
    { x: 32.92, y: 15.19, ring: 16.14, ringInner: 14.32, glass: 14.1, ringDrop: 0.18 },
  ],
  // Estimated: the rings stand about as far off the island as an iPhone 17's off its bump.
  lensTop: 3.3,
  flash: { x: 49.59, y: 19.67, d: 3.81 },
  mic: { x: 49.57, y: 10.9, d: 1.45, length: 3.12 },
  // The side button holds Touch ID. The Camera Control is flush, so the bezel
  // cannot show it: its centre is where Apple's diagram labels it, its size an estimate.
  buttons: [
    { side: 'top', center: 124.86, length: 10.87, width: 2.2, proud: 0.465, kind: 'button' },
    { side: 'top', center: 138.25, length: 10.87, width: 2.2, proud: 0.465, kind: 'button' },
    { side: 'right', center: 42.9, length: 18.66, width: 2.5, proud: 0.458, kind: 'button' },
    { side: 'right', center: 69.33, length: 17.1, width: 2.2, proud: 0, kind: 'control' },
  ],
  // From Apple's diagram of the closed edges: the USB-C port and two mics on
  // the left half, the speaker and mics on the right half's bottom edge, the
  // other speaker on the left half's top edge. Hole sizes are estimates.
  port: { width: 8.6, height: 2.6, x: 41.4 },
  holes: { x: [34, 48.8, 98.22, 100.45, 102.75, 105.06, 115.8, 130.6, 141.43, 143.73, 145.96, 148.19], d: 1.1 },
  topHoles: { x: [33.51, 36.16, 38.81, 41.47, 44.12, 46.77], d: 1.2 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_DUO,
  defaultFinish: 'star-white',
  fold: {
    closedThickness: 11.3,
    closedWidth: 84.1,
    hingeCorner: [[0.94, 0], [0.72, 0.029], [0.5, 0.087], [0.33, 0.17], [0.245, 0.245], [0.17, 0.33], [0.087, 0.5], [0.029, 0.72], [0, 0.94]],
    // Both backs' glass, read off the open back bezel where it meets the
    // frame: 1.31 in on the free side, top and bottom (the round-over's end,
    // 0.65 in, is the edge profile's estimate). Along the hinge the glass
    // starts 0.97 from the hinge line (the back glass reads 0.976, the outer
    // display's 0.957) behind a seal the bezel draws as a hairline, and the
    // frame's round-over there is 0.28 wide. The glass turns each hinge
    // corner over 2.5 mm each way, 0.657 in on the diagonal: the mean of
    // both corners of both backs, which agree within 0.02 mm.
    back: {
      inset: 1.31,
      round: 0.65,
      hinge: {
        inset: 0.97,
        round: 0.28,
        seal: 0.06,
        corner: [[2.5, 0], [2.25, 0.017], [2, 0.036], [1.75, 0.08], [1.5, 0.147], [1.25, 0.246], [1, 0.373], [0.8, 0.521], [0.657, 0.657], [0.521, 0.8], [0.373, 1], [0.246, 1.25], [0.147, 1.5], [0.08, 1.75], [0.036, 2], [0.017, 2.25], [0, 2.5]],
      },
    },
    // The spine's ends are 1.43 mm in from the top and bottom on the closed
    // bezel; Apple's diagram draws it over the middle 70% of the closed
    // thickness with rounded edges, which puts its seams 0.9 mm behind each
    // half's middle.
    spine: { endInset: 1.43, seam: 0.9, round: 0.8 },
    outer: {
      // The bezel's 1398 x 2034 opening.
      width: 77.3,
      height: 112.47,
      hinge: 2.34,
      hingeCorner: [[1.5, 0], [1, 0.056], [0.75, 0.147], [0.5, 0.272], [0.394, 0.394], [0.272, 0.5], [0.147, 0.75], [0.056, 1], [0, 1.5]],
      camera: { d: 6.01, x: 10.57, y: 10.59 },
      // A pill the closed bezel draws over the top edge's speaker holes,
      // where the glass edge steps 0.18 mm lower for 12.6 mm.
      receiver: { from: 34.6, to: 47.25, depth: 0.18 },
      // The outer display's screenshot, 1398 x 2034 at 3x.
      screenPoints: [466, 678],
    },
    opening: 180,
  },
};

export const IPHONE_18_PRO_MAX: PhoneModel = {
  id: 'iphone-18-pro-max',
  label: 'iPhone 18 Pro Max',
  maker: 'apple',
  drawing: '2026-09-09',
  width: 77.98,
  height: 163.43,
  thickness: 8.75,
  screenPoints: [440, 956],
  metal: 'aluminium',
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 75.58, height: 161.03 },
  display: { width: 72.86, height: 158.31 },
  // The sheet labels this 2.56, but its Detail A and B draw the flat glass starting at 2.61, as every other Pro sheet does.
  flatInset: 2.61,
  cutout: { kind: 'island', width: 15.68, height: 6.07, center: 7.91 },
  receiver: { width: 26.58, top: 1.14, bottom: 1.6 },
  back: { kind: 'metal', window: { side: 3.84, top: 48.81, bottom: 159.59 } },
  pads: [
    { shape: 'plateau', height: 2.78, deckInset: 5.12, deckBottom: 42.85, deckCorner: 13.95, wall: PLATEAU_WALL_18 },
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 14.37, y: 33.61, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 32.49, y: 23.99, ring: 16.58, ringInner: 14.23, glass: 12.86 },
  ],
  lensTop: 4.89,
  flash: { x: 64.16, y: 13.82, d: 6.9 },
  mic: { x: 64.16, y: 23.99, d: 1.15 },
  sensor: { x: 64.16, y: 34.16, d: 6.9 },
  buttons: [
    { side: 'left', center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 111.82, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.4, 17.65, 19.91, 22.16, 24.42, 26.67, 51.3, 53.56, 55.81, 58.07, 60.32, 62.58], d: 1.35 },
  screws: { x: [32.06, 45.91], d: 1.5 },
  finishes: FINISHES_18_PRO,
  defaultFinish: 'glacier',
};

export const IPHONE_18_PRO: PhoneModel = {
  id: 'iphone-18-pro',
  label: 'iPhone 18 Pro',
  maker: 'apple',
  drawing: '2026-09-09',
  width: 71.85,
  height: 150.01,
  thickness: 8.75,
  screenPoints: [402, 874],
  metal: 'aluminium',
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 69.45, height: 147.61 },
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.61,
  cutout: { kind: 'island', width: 15.66, height: 6.07, center: 7.99 },
  receiver: { width: 26.58, top: 1.14, bottom: 1.6 },
  back: { kind: 'metal', window: { side: 3.84, top: 48.81, bottom: 146.17 } },
  pads: [
    { shape: 'plateau', height: 2.78, deckInset: 5.12, deckBottom: 42.85, deckCorner: 14.06, wall: PLATEAU_WALL_18 },
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 14.37, y: 33.61, ring: 16.58, ringInner: 14.23, glass: 12.86 },
    { x: 32.49, y: 23.99, ring: 16.58, ringInner: 14.23, glass: 12.86 },
  ],
  lensTop: 4.89,
  flash: { x: 58.03, y: 13.82, d: 6.9 },
  mic: { x: 58.03, y: 23.99, d: 1.15 },
  sensor: { x: 58.03, y: 34.16, d: 6.9 },
  buttons: [
    { side: 'left', center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 98.4, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.4, 17.65, 19.91, 22.16, 24.42, 47.43, 49.69, 51.94, 54.2, 56.45], d: 1.35 },
  screws: { x: [29, 42.85], d: 1.5 },
  finishes: FINISHES_18_PRO,
  defaultFinish: 'burgundy',
};

export const IPHONE_17_PRO_MAX: PhoneModel = {
  id: 'iphone-17-pro-max',
  label: 'iPhone 17 Pro Max',
  maker: 'apple',
  drawing: '2025-09-09',
  width: 77.98,
  height: 163.43,
  thickness: 8.75,
  screenPoints: [440, 956],
  metal: 'aluminium',
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 75.58, height: 161.03 },
  display: { width: 72.86, height: 158.31 },
  flatInset: 2.61,
  cutout: { kind: 'island', width: 20.76, height: 6.07, center: 7.91 },
  receiver: { width: 27.38, top: 0.9, bottom: 1.6 },
  back: { kind: 'metal', window: { side: 3.84, top: 48.81, bottom: 159.58 } },
  pads: [
    // The flat top's edge is the innermost of the three nested lines the back view draws there (5.09, 5.03, 4.86 in from the side).
    { shape: 'plateau', height: 2.55, deckInset: 5.09, deckBottom: 42.89, deckCorner: 13.9, wall: PLATEAU_WALL_17 },
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 14.37, y: 33.61, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 32.36, y: 23.99, ring: 16.2, ringInner: 13.85, glass: 12.48 },
  ],
  lensTop: 4.43,
  flash: { x: 64.16, y: 13.82, d: 6.8 },
  mic: { x: 64.16, y: 23.99, d: 1.15 },
  sensor: { x: 64.16, y: 34.16, d: 6.65 },
  buttons: [
    { side: 'left', center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 111.82, length: 17.1, width: 3.13, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.12 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.41, 17.65, 19.91, 22.16, 24.42, 26.67, 51.3, 53.56, 55.81, 58.07, 60.32, 62.57], d: 1.35 },
  screws: { x: [32.06, 45.91], d: 1.5 },
  finishes: FINISHES_17_PRO,
  defaultFinish: 'cosmic-orange',
};

export const IPHONE_17_PRO: PhoneModel = {
  id: 'iphone-17-pro',
  label: 'iPhone 17 Pro',
  maker: 'apple',
  drawing: '2025-09-09',
  width: 71.85,
  height: 150.01,
  thickness: 8.75,
  screenPoints: [402, 874],
  metal: 'aluminium',
  corner: [[19.43, 0], [13.9, 0.04], [8.46, 0.92], [3.8, 3.8], [0.92, 8.46], [0.04, 13.9], [0, 19.43]],
  edge: [[2.61, 4.38], [1.2, 4.29], [0.9, 4.24], [0.15, 2.99], [0.01, 1.5], [0, 0], [0, -1.44], [0.17, -2.86], [0.97, -4.01], [2.35, -4.35], [3.79, -4.38]],
  glass: { width: 69.45, height: 147.61 },
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.61,
  cutout: { kind: 'island', width: 20.76, height: 6.07, center: 7.99 },
  receiver: { width: 27.38, top: 0.9, bottom: 1.6 },
  back: { kind: 'metal', window: { side: 3.84, top: 48.81, bottom: 146.17 } },
  pads: [
    { shape: 'plateau', height: 2.55, deckInset: 5.09, deckBottom: 42.89, deckCorner: 13.89, wall: PLATEAU_WALL_17 },
  ],
  lenses: [
    { x: 14.37, y: 14.37, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 14.37, y: 33.61, ring: 16.2, ringInner: 13.85, glass: 12.48 },
    { x: 32.36, y: 23.99, ring: 16.2, ringInner: 13.85, glass: 12.48 },
  ],
  lensTop: 4.43,
  flash: { x: 58.03, y: 13.82, d: 6.8 },
  mic: { x: 58.03, y: 23.99, d: 1.05 },
  sensor: { x: 58.03, y: 34.16, d: 6.65 },
  buttons: [
    { side: 'left', center: 34.28, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.63, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.53, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 98.4, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  // The sheet's hole label disagrees with its own drawing; every Pro sheet draws these holes at 1.35, the size the 16 Pro sheet prints.
  holes: { x: [15.4, 17.65, 19.91, 22.16, 24.42, 47.43, 49.69, 51.94, 54.2, 56.45], d: 1.35 },
  screws: { x: [29, 42.85], d: 1.5 },
  finishes: FINISHES_17_PRO,
  defaultFinish: 'deep-blue',
};

export const IPHONE_AIR: PhoneModel = {
  id: 'iphone-air',
  label: 'iPhone Air',
  maker: 'apple',
  drawing: '2025-09-09',
  width: 74.7,
  height: 156.18,
  thickness: 5.64,
  screenPoints: [420, 912],
  metal: 'titanium',
  corner: [[19.36, 0], [13.85, 0.04], [8.43, 0.91], [3.78, 3.78], [0.91, 8.43], [0.04, 13.85], [0, 19.36]],
  edge: [[2.58, 2.82], [1.49, 2.79], [0.47, 2.44], [0.02, 1.47], [0, 0.38], [0, -0.38], [0.02, -1.47], [0.47, -2.44], [1.49, -2.79], [2.58, -2.82]],
  glass: { width: 72.42, height: 153.9 },
  display: { width: 69.55, height: 151.03 },
  flatInset: 2.58,
  cutout: { kind: 'island', width: 20.76, height: 6.07, center: 8.92 },
  receiver: { width: 14.02, top: 1.09, bottom: 1.54 },
  back: { kind: 'glass' },
  // The plateau is a stadium on top and follows the 1.14 glass seam at its base, so its skirt is wider at the bottom (6.12) than at the top (3.38).
  pads: [
    { shape: 'loft', inset: 1.14, baseBottom: 34.17, baseCurve: 22.87, baseSide: 29.01, top: { x0: 4.77, y0: 4.52, x1: 69.94, y1: 28.06 }, height: 3.03, wall: AIR_WALL, wallNarrow: AIR_WALL_NARROW, material: 'back' },
  ],
  lenses: [
    { x: 16.29, y: 16.29, ring: 15.82, ringInner: 13.46, glass: 12.52, ringDrop: 0.55 },
  ],
  lensTop: 5.68,
  flash: { x: 58.42, y: 16.29, d: 6.3 },
  mic: { x: 51.34, y: 16.29, d: 2.3 },
  buttons: [
    { side: 'left', center: 34.08, length: 6.9, width: 2.35, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.23, length: 11.2, width: 2.35, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.43, length: 11.2, width: 2.35, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.33, length: 17.69, width: 2.35, proud: 0.45, kind: 'button' },
    { side: 'right', center: 104.77, length: 17.1, width: 2.53, proud: 0, kind: 'control' },
  ],
  port: { width: 8.6, height: 2.7 },
  holes: { x: [24.34, 26.33, 48.38, 50.36], d: 1.1 },
  screws: { x: [30.01, 44.7], d: 1.5 },
  finishes: FINISHES_AIR,
  defaultFinish: 'sky-blue',
};

export const IPHONE_17: PhoneModel = {
  id: 'iphone-17',
  label: 'iPhone 17',
  maker: 'apple',
  drawing: '2025-09-09',
  width: 71.45,
  height: 149.61,
  thickness: 7.95,
  screenPoints: [402, 874],
  metal: 'aluminium',
  corner: [[19.23, 0], [14.53, 0.02], [9.87, 0.48], [5.56, 2.26], [2.26, 5.56], [0.48, 9.87], [0.02, 14.53], [0, 19.23]],
  edge: [[2.41, 3.975], [1.27, 3.93], [0.7, 3.78], [0.27, 3.39], [0.05, 2.85], [0, 2.27], [0, 1.69], [0, 0], [0, -1.69], [0, -2.28], [0.05, -2.86], [0.27, -3.4], [0.7, -3.79], [1.27, -3.93], [2.44, -3.975]],
  glass: { width: 69.45, height: 147.61 },
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.41,
  cutout: { kind: 'island', width: 20.74, height: 6.07, center: 7.79 },
  receiver: { width: 14.46, top: 0.95, bottom: 1.4 },
  back: { kind: 'glass' },
  pads: [
    { shape: 'stadium', x0: 1.18, y0: 1.34, x1: 26.06, y1: 43.62, radius: 12.44, height: 1.78, round: 2.62, material: 'back', edge: 'cove', wall: BUMP_WALL_17 },
  ],
  lenses: [
    { x: 13.62, y: 13.62, ring: 16, ringInner: 13.85, glass: 13.05, ringDrop: 0.185 },
    { x: 13.62, y: 31.34, ring: 16, ringInner: 13.85, glass: 13.05, ringDrop: 0.185 },
  ],
  lensTop: 3.45,
  flash: { x: 30.41, y: 22.48, d: 6.28 },
  mic: { x: 20.54, y: 22.48, d: 1 },
  buttons: [
    { side: 'left', center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.32, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 98.2, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.71, 21.96, 24.22, 47.23, 49.48, 51.74, 53.99, 56.25], d: 1.35 },
  screws: { x: [28.8, 42.65], d: 1.5 },
  finishes: FINISHES_17,
  defaultFinish: 'mist-blue',
};

export const IPHONE_17E: PhoneModel = {
  id: 'iphone-17e',
  label: 'iPhone 17e',
  maker: 'apple',
  drawing: '2026-03-09',
  width: 71.52,
  height: 146.71,
  thickness: 7.8,
  screenPoints: [390, 844],
  metal: 'aluminium',
  corner: [[15.89, 0], [11.38, 0.07], [6.97, 0.95], [3.22, 3.4], [0.86, 7.2], [0.06, 11.63], [0, 16.14]],
  edge: [[1.15, 3.9], [0.91, 3.82], [0.49, 3.79], [0.14, 3.54], [0.01, 3.14], [0, 2.71], [0, -2.71], [0.01, -3.14], [0.14, -3.54], [0.49, -3.79], [0.91, -3.82], [1.15, -3.9]],
  glass: { width: 69.42, height: 144.61 },
  display: { width: 64.58, height: 139.77 },
  flatInset: 1.15,
  cutout: { kind: 'notch', width: 26.79, depth: 5.58, radius: 3.72, shoulder: 0.82 },
  receiver: { width: 11.95, top: 1.05, bottom: 2.42 },
  back: { kind: 'glass' },
  pads: [
  ],
  lenses: [
    { x: 13.32, y: 13.32, ring: 14.97, ringInner: 12.97, glass: 11.92, ringDrop: 0.28 },
  ],
  lensTop: 1.68,
  flash: { x: 29.68, y: 13.32, d: 3.75 },
  mic: { x: 24.3, y: 13.32, d: 1.3 },
  // The sheet's button labels measure the outermost outline round each button; these are the parts that stand proud, as on the other sheets.
  buttons: [
    { side: 'left', center: 31.28, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 45.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 59.63, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 52.53, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.56, 21.82, 24.07, 47.46, 49.71, 51.97, 54.22, 56.48], d: 1.53 },
  screws: { x: [28.84, 42.69], d: 1.5 },
  finishes: FINISHES_17E,
  defaultFinish: 'soft-pink',
};

export const IPHONE_16_PRO_MAX: PhoneModel = {
  id: 'iphone-16-pro-max',
  label: 'iPhone 16 Pro Max',
  maker: 'apple',
  drawing: '2024-09-19',
  width: 77.58,
  height: 163.03,
  thickness: 8.25,
  screenPoints: [440, 956],
  metal: 'titanium',
  corner: [[19.23, 0], [13.75, 0.04], [8.36, 0.89], [3.74, 3.74], [0.89, 8.36], [0.04, 13.75], [0, 19.23]],
  edge: [[2.41, 4.12], [1.39, 4.1], [0.45, 3.76], [0.02, 2.86], [0, 1.84], [0, 0], [0, -1.84], [0.02, -2.86], [0.45, -3.76], [1.39, -4.1], [2.41, -4.12]],
  glass: { width: 75.58, height: 161.03 },
  display: { width: 72.86, height: 158.31 },
  flatInset: 2.41,
  cutout: { kind: 'island', width: 20.76, height: 6.07, center: 7.71 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: 'glass' },
  pads: [
    { shape: 'rounded', x0: 1.04, y0: 1.04, x1: 45.22, y1: 46.54, radius: 13.4, height: 2.05, round: 3.66, material: 'back', edge: 'cove', wall: BUMP_WALL_16_PRO },
  ],
  lenses: [
    { x: 14.17, y: 14.17, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 14.17, y: 33.41, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 32.16, y: 23.79, ring: 16.2, ringInner: 15.26, glass: 13.55 },
  ],
  lensTop: 4.28,
  flash: { x: 32.16, y: 10.22, d: 6.92 },
  mic: { x: 38, y: 34.14, d: 0.75 },
  // The LiDAR diameter is estimated; the sheet omits its visible outline.
  sensor: { x: 32.16, y: 38.14, d: 6.5 },
  buttons: [
    { side: 'left', center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 111.62, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [20.11, 22.37, 24.62, 26.88, 50.7, 52.95, 55.21, 57.46, 59.72, 61.97], d: 1.35 },
  screws: { x: [31.86, 45.71], d: 1.5 },
  finishes: FINISHES_16_PRO,
  defaultFinish: 'desert-titanium',
};

export const IPHONE_16_PRO: PhoneModel = {
  id: 'iphone-16-pro',
  label: 'iPhone 16 Pro',
  maker: 'apple',
  drawing: '2024-09-19',
  width: 71.45,
  height: 149.61,
  thickness: 8.25,
  screenPoints: [402, 874],
  metal: 'titanium',
  corner: [[19.23, 0], [13.75, 0.04], [8.36, 0.89], [3.74, 3.74], [0.89, 8.36], [0.04, 13.75], [0, 19.23]],
  edge: [[2.41, 4.12], [1.39, 4.1], [0.45, 3.76], [0.02, 2.86], [0, 1.84], [0, 0], [0, -1.84], [0.02, -2.86], [0.45, -3.76], [1.39, -4.1], [2.41, -4.12]],
  glass: { width: 69.45, height: 147.61 },
  // The sheet prints 144.79; its vector outline and 2.44 mm bezel give 144.73.
  display: { width: 66.57, height: 144.73 },
  flatInset: 2.41,
  cutout: { kind: 'island', width: 20.73, height: 6.07, center: 7.71 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: 'glass' },
  pads: [
    { shape: 'rounded', x0: 1.04, y0: 1.04, x1: 45.22, y1: 46.54, radius: 13.4, height: 2.05, round: 3.66, material: 'back', edge: 'cove', wall: BUMP_WALL_16_PRO },
  ],
  lenses: [
    { x: 14.17, y: 14.17, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 14.17, y: 33.41, ring: 16.2, ringInner: 15.26, glass: 13.55 },
    { x: 32.16, y: 23.79, ring: 16.2, ringInner: 15.26, glass: 13.55 },
  ],
  lensTop: 4.28,
  flash: { x: 32.16, y: 10.22, d: 6.92 },
  mic: { x: 38, y: 34.14, d: 0.75 },
  // The LiDAR diameter is estimated; the sheet omits its visible outline.
  sensor: { x: 32.16, y: 38.14, d: 6.5 },
  buttons: [
    { side: 'left', center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 98.19, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.7, 21.96, 24.21, 47.23, 49.49, 51.74, 54, 56.25], d: 1.35 },
  screws: { x: [28.79, 42.64], d: 1.5 },
  finishes: FINISHES_16_PRO,
  defaultFinish: 'natural-titanium',
};

export const IPHONE_16_PLUS: PhoneModel = {
  id: 'iphone-16-plus',
  label: 'iPhone 16 Plus',
  maker: 'apple',
  drawing: '2024-09-19',
  width: 77.76,
  height: 160.89,
  thickness: 7.81,
  screenPoints: [430, 932],
  metal: 'aluminium',
  corner: [[17.4, 0], [13.21, 0.04], [9.06, 0.59], [5.25, 2.29], [2.3, 5.24], [0.59, 9.06], [0.04, 13.21], [0, 17.4]],
  edge: [[2.41, 3.905], [1.6, 3.89], [1.27, 3.86], [1, 3.82], [1, 3.77], [0.81, 3.77], [0.4, 3.5], [0.13, 3.09], [0.02, 2.61], [0, 2.12], [0, 1.62], [0, -1.62], [0, -2.12], [0.02, -2.61], [0.13, -3.09], [0.4, -3.5], [0.81, -3.77], [1, -3.77], [1, -3.82], [1.27, -3.86], [1.6, -3.89], [2.41, -3.905]],
  glass: { width: 75.76, height: 158.89 },
  display: { width: 71.21, height: 154.34 },
  flatInset: 2.41,
  cutout: { kind: 'island', width: 20.76, height: 6.07, center: 8.19 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: 'glass' },
  pads: [
    { shape: 'stadium', x0: 1.09, y0: 1.25, x1: 26.16, y1: 43.72, radius: 12.535, height: 1.85, round: 2.71, material: 'back', edge: 'cove', wall: BUMP_WALL_16 },
  ],
  lenses: [
    { x: 13.62, y: 13.62, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 },
    { x: 13.62, y: 31.34, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 },
  ],
  lensTop: 3.48,
  flash: { x: 30.01, y: 22.48, d: 6.28 },
  mic: { x: 20.55, y: 22.48, d: 1 },
  buttons: [
    { side: 'left', center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 109.48, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [20.16, 22.41, 24.67, 26.92, 50.83, 53.09, 55.34, 57.6, 59.85, 62.11], d: 1.35 },
  screws: { x: [31.95, 45.8], d: 1.5 },
  finishes: FINISHES_16,
  defaultFinish: 'teal',
};

export const IPHONE_16: PhoneModel = {
  id: 'iphone-16',
  label: 'iPhone 16',
  maker: 'apple',
  drawing: '2024-09-19',
  width: 71.63,
  height: 147.64,
  thickness: 7.81,
  screenPoints: [393, 852],
  metal: 'aluminium',
  corner: [[17.4, 0], [13.21, 0.04], [9.06, 0.59], [5.24, 2.29], [2.29, 5.24], [0.59, 9.06], [0.04, 13.21], [0, 17.4]],
  edge: [[2.41, 3.905], [1.6, 3.89], [1.27, 3.86], [1, 3.82], [1, 3.77], [0.81, 3.77], [0.4, 3.5], [0.13, 3.09], [0.02, 2.61], [0, 2.12], [0, 1.62], [0, -1.62], [0, -2.12], [0.02, -2.61], [0.13, -3.09], [0.4, -3.5], [0.81, -3.77], [1, -3.77], [1, -3.82], [1.27, -3.86], [1.6, -3.89], [2.41, -3.905]],
  glass: { width: 69.63, height: 145.64 },
  display: { width: 65.08, height: 141.09 },
  flatInset: 2.41,
  cutout: { kind: 'island', width: 20.69, height: 6.07, center: 8.18 },
  receiver: { width: 14.02, top: 0.95, bottom: 1.4 },
  back: { kind: 'glass' },
  pads: [
    { shape: 'stadium', x0: 1.09, y0: 1.25, x1: 26.16, y1: 43.72, radius: 12.535, height: 1.85, round: 2.71, material: 'back', edge: 'cove', wall: BUMP_WALL_16 },
  ],
  lenses: [
    { x: 13.62, y: 13.62, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 },
    { x: 13.62, y: 31.34, ring: 16, ringInner: 13.85, glass: 13.55, ringDrop: 0.18 },
  ],
  lensTop: 3.48,
  flash: { x: 30.01, y: 22.48, d: 6.28 },
  mic: { x: 20.54, y: 22.48, d: 1 },
  buttons: [
    { side: 'left', center: 34.08, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 48.23, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 62.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 55.33, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 96.23, length: 17.1, width: 3.03, proud: 0, kind: 'control' },
  ],
  port: { width: 9, height: 3.14 },
  holes: { x: [19.75, 22.01, 24.26, 47.37, 49.62, 51.88, 54.13, 56.39], d: 1.35 },
  screws: { x: [28.89, 42.74], d: 1.5 },
  finishes: FINISHES_16,
  defaultFinish: 'ultramarine',
};

export const IPHONE_16E: PhoneModel = {
  id: 'iphone-16e',
  label: 'iPhone 16e',
  maker: 'apple',
  drawing: '2025-03-17',
  width: 71.52,
  height: 146.71,
  thickness: 7.8,
  screenPoints: [390, 844],
  metal: 'aluminium',
  corner: [[15.89, 0], [11.38, 0.07], [6.97, 0.95], [3.22, 3.4], [0.86, 7.2], [0.06, 11.63], [0, 16.14]],
  edge: [[1.15, 3.9], [1.07, 3.82], [0.91, 3.82], [0.49, 3.79], [0.14, 3.54], [0.01, 3.14], [0, 2.71], [0, -2.71], [0.01, -3.14], [0.14, -3.54], [0.49, -3.79], [0.91, -3.82], [1.07, -3.82], [1.15, -3.9]],
  glass: { width: 69.42, height: 144.61 },
  display: { width: 64.58, height: 139.77 },
  flatInset: 1.15,
  cutout: { kind: 'notch', width: 26.79, depth: 5.58, radius: 3.72, shoulder: 0.82 },
  receiver: { width: 11.95, top: 1.05, bottom: 2.43 },
  back: { kind: 'glass' },
  pads: [
  ],
  lenses: [
    { x: 13.32, y: 13.32, ring: 14.97, ringInner: 12.97, glass: 12.33, ringDrop: 0.28 },
  ],
  lensTop: 1.68,
  flash: { x: 29.68, y: 13.32, d: 3.75 },
  mic: { x: 24.3, y: 13.32, d: 1.3 },
  // The sheet's button labels measure the outermost outline round each button; these are the parts that stand proud, as on the other sheets.
  buttons: [
    { side: 'left', center: 31.28, length: 6.9, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 45.43, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'left', center: 59.63, length: 11.2, width: 2.66, proud: 0.45, kind: 'button' },
    { side: 'right', center: 52.53, length: 17.7, width: 2.66, proud: 0.45, kind: 'button' },
  ],
  port: { width: 8.99, height: 3.14 },
  holes: { x: [19.56, 21.81, 24.07, 47.45, 49.71, 51.96, 54.22, 56.47], d: 1.53 },
  screws: { x: [28.84, 42.69], d: 1.5 },
  finishes: FINISHES_16E,
  defaultFinish: 'white',
};

// ---------------------------------------------------------------------------
// Pixels, covering the kinds of display Android phones have: a camera hole in
// the screen (10 Pro, 10a), a notch (3 XL), and none, with the front camera in
// a bezel above the screen (Pixel 4). Names and finishes are Google's.
// ---------------------------------------------------------------------------

const FINISHES_PIXEL_10_PRO: PhoneFinish[] = [
  { id: 'moonstone', label: 'Moonstone', frame: '#a2a8b7', back: '#787e8e' },
  { id: 'jade', label: 'Jade', frame: '#dacebc', back: '#c8d8b8' },
  { id: 'porcelain', label: 'Porcelain', frame: '#e6dbcb', back: '#f0eae3' },
  { id: 'obsidian', label: 'Obsidian', frame: '#606464', back: '#3c4040' },
];

const FINISHES_PIXEL_10A: PhoneFinish[] = [
  { id: 'lavender', label: 'Lavender', frame: '#7f9be6', back: '#81a2f3' },
  { id: 'berry', label: 'Berry', frame: '#e64852', back: '#f44c57' },
  { id: 'fog', label: 'Fog', frame: '#c4cec4', back: '#d2dad1' },
  { id: 'obsidian', label: 'Obsidian', frame: '#3a3e3d', back: '#3b3f3e' },
];

// Every Pixel 4 has a matte black frame. Google's device frame draws a coral
// power button, which reports agree is the Clearly White one's; they disagree
// about the other two, so theirs stays the frame's black.
const FINISHES_PIXEL_4: PhoneFinish[] = [
  { id: 'clearly-white', label: 'Clearly White', frame: '#1f1f21', back: '#eceeec', accent: '#ec8b70' },
  { id: 'just-black', label: 'Just Black', frame: '#1f1f21', back: '#151517' },
  { id: 'oh-so-orange', label: 'Oh So Orange', frame: '#1f1f21', back: '#f4895f' },
];

const FINISHES_PIXEL_3_XL: PhoneFinish[] = [
  { id: 'just-black', label: 'Just Black', frame: '#2a2a2c', back: '#1c1c1e' },
  { id: 'clearly-white', label: 'Clearly White', frame: '#ececea', back: '#f4f4f4', accent: '#79d1b3' },
  { id: 'not-pink', label: 'Not Pink', frame: '#ecd5cc', back: '#f2ddd5', accent: '#f37b52' },
];

export const PIXEL_10_PRO: PhoneModel = {
  id: 'pixel-10-pro',
  label: 'Pixel 10 Pro',
  maker: 'google',
  drawing: '2026-10-16',
  width: 72.0,
  height: 152.8,
  thickness: 8.6,
  screenPoints: [1280, 2856],
  metal: 'polished',
  // The four corners of the device frame agree to 0.03 mm. The corner is no
  // circle: it leaves each straight edge about 15 mm from the corner.
  corner: [[15, 0], [12, 0.07], [10, 0.29], [8, 0.81], [6, 1.74], [4, 3.2], [3.59, 3.59], [3.2, 4], [1.74, 6], [0.81, 8], [0.29, 10], [0.07, 12], [0, 15]],
  // Estimated from Google's side render: flat sides, the glass and the back each meeting the frame on a round of about a millimetre.
  edge: [[1.6, 4.3], [1.34, 4.24], [1.2, 4.14], [0.75, 3.98], [0.35, 3.7], [0.1, 3.3], [0.02, 2.9], [0, 2.5], [0, -2.5], [0.02, -2.9], [0.1, -3.3], [0.35, -3.7], [0.75, -3.98], [1.2, -4.14], [1.34, -4.24], [1.6, -4.3]],
  glass: { width: 69.32, height: 150.12 },
  // The device frame's screen opening: its bezel is 0.4 mm deeper above the screen than below, and its corners are circles (9.22, rms 0.005).
  display: { width: 65.85, height: 147.06, top: 3.06, radius: 9.22 },
  flatInset: 1.6,
  cutout: { kind: 'punch', d: 4.7, center: 8.37 },
  receiver: { width: 12, top: 1.05, bottom: 1.3 },
  back: { kind: 'glass' },
  // The camera bar from the Google Store render, which Google's side render
  // agrees with to 0.1 mm at its top: a metal stadium standing 3.4 mm off the
  // back, the camera glass set into it 0.8 mm in from its edge.
  pads: [
    { shape: 'stadium', x0: 3.57, y0: 13.85, x1: 68.29, y1: 35.81, radius: 10.98, height: 3.4, round: 0.45, material: 'satin' },
    { shape: 'stadium', x0: 4.46, y0: 14.66, x1: 52.06, y1: 35.0, radius: 10.17, height: 3.42, round: 0.05, material: 'glass' },
  ],
  lensStyle: 'window',
  lenses: [
    { x: 13.78, y: 25.0, ring: 6.85, glass: 5.4 },
    { x: 29.98, y: 25.0, ring: 11.39, glass: 9.6 },
    // The 5x periscope sits in a vertical rounded window, 7.45 by 10.05 mm
    // with 1.9 mm corners, measured on Google's Store close-up of the camera
    // bar and scaled by the phone's 72.0 mm width.
    { x: 41.9, y: 25.0, ring: 7.0, glass: 5.6, window: { width: 7.45, height: 10.05, radius: 1.9 } },
  ],
  lensTop: 3.44,
  flash: { x: 58.61, y: 20.81, d: 6.03 },
  // The temperature sensor.
  sensor: { x: 58.61, y: 29.81, d: 6.2 },
  buttons: [
    { side: 'right', center: 48.71, length: 12.1, width: 3.4, proud: 0.53, kind: 'button' },
    { side: 'right', center: 72.19, length: 21.06, width: 3.4, proud: 0.53, kind: 'button' },
  ],
  // The bottom edge is estimated from the hardware diagram's labels: the speaker on the right, a microphone on the left.
  port: { width: 8.7, height: 3.0 },
  holes: { x: [18.3, 50, 52, 54, 56, 58], d: 1.1 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_10_PRO,
  defaultFinish: 'moonstone',
};

export const PIXEL_10A: PhoneModel = {
  id: 'pixel-10a',
  label: 'Pixel 10a',
  maker: 'google',
  drawing: '2026-10-16',
  width: 73.0,
  height: 153.9,
  thickness: 9.0,
  screenPoints: [1080, 2424],
  metal: 'aluminium',
  corner: [[15, 0], [12, 0.08], [10, 0.355], [8, 0.94], [6, 1.92], [4, 3.43], [3.71, 3.71], [3.43, 4], [1.92, 6], [0.94, 8], [0.355, 10], [0.08, 12], [0, 15]],
  // Estimated, as on the 10 Pro.
  edge: [[1.45, 4.5], [1.18, 4.44], [1.05, 4.34], [0.65, 4.18], [0.3, 3.9], [0.08, 3.5], [0.02, 3.1], [0, 2.7], [0, -2.7], [0.02, -3.1], [0.08, -3.5], [0.3, -3.9], [0.65, -4.18], [1.05, -4.34], [1.18, -4.44], [1.45, -4.5]],
  glass: { width: 70.64, height: 151.54 },
  display: { width: 65.26, height: 146.26, radius: 8.83 },
  flatInset: 1.45,
  cutout: { kind: 'punch', d: 4.71, center: 9.08 },
  receiver: { width: 12, top: 0.95, bottom: 1.2 },
  back: { kind: 'glass' },
  // From the hardware diagram. The camera glass is level with the back:
  // Google's side render shows nothing standing off it.
  pads: [
    { shape: 'stadium', x0: 7.08, y0: 11.96, x1: 37.47, y1: 31.29, radius: 9.67, height: 0.12, round: 0.08, material: 'glass' },
  ],
  lensStyle: 'window',
  lenses: [
    { x: 15.62, y: 21.63, ring: 4.2, glass: 2.6 },
    { x: 28.9, y: 21.63, ring: 5.4, glass: 3.4 },
  ],
  lensTop: 0.14,
  flash: { x: 46.1, y: 21.63, d: 5.94 },
  buttons: [
    { side: 'right', center: 49.22, length: 12.01, width: 3.4, proud: 0.475, kind: 'button' },
    { side: 'right', center: 72.72, length: 21.0, width: 3.4, proud: 0.475, kind: 'button' },
  ],
  // Estimated from the hardware diagram's labels, as on the 10 Pro.
  port: { width: 8.7, height: 3.0 },
  holes: { x: [18.3, 50.5, 52.5, 54.5, 56.5, 58.5], d: 1.1 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_10A,
  defaultFinish: 'lavender',
};

export const PIXEL_4: PhoneModel = {
  id: 'pixel-4',
  label: 'Pixel 4',
  maker: 'google',
  drawing: '2026-10-16',
  width: 68.8,
  height: 147.1,
  thickness: 8.2,
  screenPoints: [1080, 2280],
  metal: 'coated',
  // Close to a circle of 8.9; the device frame's corners agree to 0.15 mm.
  corner: [[10.5, 0], [8, 0.1], [7.23, 0.25], [6.11, 0.5], [4.84, 1], [3.3, 2], [2.61, 2.61], [2, 3.3], [1, 4.84], [0.5, 6.11], [0.25, 7.23], [0.1, 8], [0, 10.5]],
  // Estimated: rounded glass on a narrow matte frame.
  edge: [[1.0, 4.1], [0.7, 4.05], [0.5, 3.95], [0.35, 3.8], [0.15, 3.4], [0.04, 2.9], [0, 2.3], [0, -2.3], [0.04, -2.9], [0.15, -3.4], [0.35, -3.8], [0.5, -3.95], [0.7, -4.05], [1.0, -4.1]],
  glass: { width: 67.8, height: 146.1 },
  // No cutout: the front camera and the face unlock sensors sit in the bezel above the screen, twice as deep as the one below it.
  display: { width: 63.59, height: 134.37, top: 8.55, radius: 6.1 },
  flatInset: 1.0,
  cutout: { kind: 'none' },
  receiver: { width: 0, top: 0, bottom: 0 },
  front: [
    { kind: 'camera', x: 19.03, y: 5.57, width: 3.5, height: 3.5 },
    { kind: 'sensor', x: 23.27, y: 5.57, width: 1.5, height: 3.4 },
    { kind: 'grille', x: 34.46, y: 5.43, width: 7.07, height: 0.94 },
  ],
  back: { kind: 'glass' },
  // The camera square from the hardware diagram; its height off the back is estimated.
  pads: [
    { shape: 'rounded', x0: 5.49, y0: 5.49, x1: 28.59, y1: 28.6, radius: 4.6, height: 1.1, round: 0.5, material: 'glass' },
  ],
  lensStyle: 'window',
  lenses: [
    { x: 11.02, y: 16.94, ring: 5.6, glass: 2.4 },
    { x: 23.0, y: 16.94, ring: 5.6, glass: 2.4 },
  ],
  lensTop: 1.12,
  flash: { x: 17.04, y: 23.9, d: 4.25 },
  mic: { x: 23.0, y: 23.9, d: 1.2 },
  // The spectral and flicker sensor.
  sensor: { x: 17.04, y: 9.85, d: 1.6 },
  buttons: [
    { side: 'right', center: 40.32, length: 9.19, width: 2.6, proud: 0.37, kind: 'button', accent: true },
    { side: 'right', center: 63.27, length: 18.21, width: 2.6, proud: 0.46, kind: 'button' },
  ],
  // Estimated from the hardware diagram's labels: speaker and microphone either side of the port.
  port: { width: 8.7, height: 3.0 },
  holes: { x: [19.4, 21.4, 23.4, 45.4, 47.4, 49.4], d: 1.0 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_4,
  defaultFinish: 'clearly-white',
};

export const PIXEL_3_XL: PhoneModel = {
  id: 'pixel-3-xl',
  label: 'Pixel 3 XL',
  maker: 'google',
  drawing: '2026-10-16',
  width: 76.7,
  height: 158.0,
  thickness: 7.9,
  screenPoints: [1440, 2960],
  metal: 'coated',
  corner: [[10, 0], [8.05, 0.05], [6.68, 0.25], [5.76, 0.5], [4.56, 1], [3.05, 2], [2.5, 2.5], [2, 3.05], [1, 4.56], [0.5, 5.76], [0.25, 6.68], [0.05, 8.05], [0, 10]],
  // Estimated: rounded glass front and back on an aluminium band.
  edge: [[2.0, 3.95], [1.4, 3.88], [0.95, 3.75], [0.7, 3.6], [0.35, 3.3], [0.12, 2.9], [0.02, 2.3], [0, 1.6], [0, -1.6], [0.02, -2.3], [0.12, -2.9], [0.35, -3.3], [0.7, -3.6], [0.95, -3.75], [1.4, -3.88], [2.0, -3.95]],
  glass: { width: 75.3, height: 156.6 },
  // The chin holds the front speaker; the top corners are twice as round as the bottom ones.
  display: { width: 70.23, height: 144.2, top: 3.465, radius: 5.41, radiusBottom: 2.8 },
  flatInset: 2.0,
  // The cutout path in the phone's AOSP device config (device/google/crosshatch,
  // config_mainBuiltInDisplayCutout), at the display's 0.04877 mm a pixel. The
  // rounds are its nearest circles, within 0.4 mm of it.
  cutout: {
    kind: 'notch',
    width: 25.17,
    depth: 8.34,
    radius: 4.5,
    shoulder: 3.7,
    path: {
      d: 'M -338,0 q 86,-4 80,71.5 v 8 q 4,90 95,91.5 h 163 v -171 z M 338,0 q -86,-4 -80,71.5 v 8 q -4,90 -95,91.5 h -163 v -171 z',
      pixel: 0.04877,
    },
  },
  receiver: { width: 0, top: 0, bottom: 0 },
  front: [
    { kind: 'camera', x: 30.25, y: 7.34, width: 4.02, height: 4.02 },
    { kind: 'camera', x: 46.45, y: 7.34, width: 4.02, height: 4.02 },
    { kind: 'grille', x: 38.35, y: 8.76, width: 8.03, height: 1.51 },
    { kind: 'grille', x: 38.34, y: 153.17, width: 22.39, height: 1.36 },
  ],
  // From the dimension drawing on Google's Pixel 3 spec page: glossy glass round the camera, etched matte below.
  // The drawing takes the panel to 1.9 mm from the bottom edge; it stops where the back starts to curve.
  back: { kind: 'glass', panel: { side: 2.77, top: 29.47, bottom: 155.7, radius: 5.4 } },
  pads: [],
  lensStyle: 'window',
  lenses: [
    { x: 14.76, y: 14.78, ring: 10.2, glass: 7.0 },
  ],
  lensTop: 0.3,
  flash: { x: 28.18, y: 14.78, d: 4.6 },
  sensor: { x: 22.73, y: 14.78, d: 2.1 },
  fingerprint: { x: 38.35, y: 41.6, d: 12.2 },
  buttons: [
    { side: 'right', center: 41.61, length: 10.04, width: 2.6, proud: 0.51, kind: 'button', accent: true },
    { side: 'right', center: 66.63, length: 20.02, width: 2.6, proud: 0.51, kind: 'button' },
  ],
  // Both speakers face the front.
  port: { width: 8.7, height: 3.0 },
  holes: { x: [], d: 0 },
  screws: { x: [], d: 0 },
  finishes: FINISHES_PIXEL_3_XL,
  defaultFinish: 'clearly-white',
};

/** Every model the 3D Studio draws from a drawing or from device art, the newest generation first: the palette order. */
export const PHONE_MODELS: PhoneModel[] = [
  IPHONE_DUO,
  IPHONE_18_PRO_MAX,
  IPHONE_18_PRO,
  IPHONE_17_PRO_MAX,
  IPHONE_17_PRO,
  IPHONE_AIR,
  IPHONE_17,
  IPHONE_17E,
  IPHONE_16_PRO_MAX,
  IPHONE_16_PRO,
  IPHONE_16_PLUS,
  IPHONE_16,
  IPHONE_16E,
  PIXEL_10_PRO,
  PIXEL_10A,
  PIXEL_4,
  PIXEL_3_XL,
];

const BY_ID = new Map<DeviceType, PhoneModel>(PHONE_MODELS.map((model) => [model.id, model]));

/** The measured model for a device type, if there is one. */
export function measuredModelFor(deviceType: DeviceType): PhoneModel | undefined {
  return BY_ID.get(deviceType);
}

/**
 * The radius of the circle that stands in for the outline's corner where only
 * a circle will do (a CSS border-radius on a flat frame): the one through the
 * corner's point on the diagonal.
 */
export function cornerRadiusOf(model: PhoneModel): number {
  let best = model.corner[0];
  for (const p of model.corner) if (Math.abs(p[0] - p[1]) < Math.abs(best[0] - best[1])) best = p;
  return (best[0] + best[1]) / 2 / (1 - Math.SQRT1_2);
}

/** From the outside edge to the display's active area at the sides (and all round, unless the display sets `top`). */
export function bezelOf(model: PhoneModel): number {
  return (model.width - model.display.width) / 2;
}

/** From the outline to the display's active area at the sides, top and bottom. */
export function displayInsetsOf(model: PhoneModel): { side: number; top: number; bottom: number } {
  const side = bezelOf(model);
  const top = model.display.top ?? (model.height - model.display.height) / 2;
  return { side, top, bottom: model.height - model.display.height - top };
}

/**
 * The display's corner radius at the top and the bottom: its own, or, where
 * it follows the outline, the circle standing in for the outline's corner
 * moved in by the bezel.
 */
export function displayRadiiOf(model: PhoneModel): { top: number; bottom: number } {
  const own = model.display.radius;
  if (own !== undefined) return { top: own, bottom: model.display.radiusBottom ?? own };
  const r = Math.max(0, cornerRadiusOf(model) - bezelOf(model));
  return { top: r, bottom: r };
}

export function finishOf(model: PhoneModel, id: string | undefined): PhoneFinish {
  return model.finishes.find((finish) => finish.id === id) ?? model.finishes.find((finish) => finish.id === model.defaultFinish) ?? model.finishes[0];
}

const FLAT_FACES = new WeakMap<PhoneModel, PhoneModel>();

/**
 * The face a flat frame draws. A phone's front, or for a foldable the inner
 * display held tall with the hinge across, the way Apple's portrait bezel
 * shows it: a phone-shaped frame for portrait screenshots of the big screen.
 * Its corners are the same all round, so only the sides swap.
 */
export function flatFaceOf(model: PhoneModel): PhoneModel {
  if (!model.fold) return model;
  let face = FLAT_FACES.get(model);
  if (!face) {
    face = {
      ...model,
      fold: undefined,
      width: model.height,
      height: model.width,
      glass: { width: model.glass.height, height: model.glass.width },
      display: { width: model.display.height, height: model.display.width },
      screenPoints: [model.screenPoints[1], model.screenPoints[0]],
    };
    FLAT_FACES.set(model, face);
  }
  return face;
}


// ---------------------------------------------------------------------------
// Plain stand-ins for devices without a drawing here
// ---------------------------------------------------------------------------

const GENERIC_FINISHES: PhoneFinish[] = [
  { id: 'black', label: 'Black', frame: '#2f2f33', back: '#2b2b2f' },
  { id: 'silver', label: 'Silver', frame: '#d9dadc', back: '#e6e7e9' },
  { id: 'white', label: 'White', frame: '#efefec', back: '#f4f4f1' },
];

/** Points on a circular corner of radius r, top tangent to side tangent. */
function circleCorner(r: number): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    points.push([r * (1 - Math.sin(a)), r * (1 - Math.cos(a))]);
  }
  return points;
}

/** A symmetric rounded edge for a body `thickness` thick. */
function roundEdge(thickness: number, round: number): EdgePoint[] {
  const t = thickness / 2;
  return [
    [round + 1, t],
    [round * 0.55, t - round * 0.1],
    [round * 0.12, t - round * 0.55],
    [0, 0],
    [round * 0.12, -t + round * 0.55],
    [round * 0.55, -t + round * 0.1],
    [round + 1, -t],
  ];
}

/**
 * A plain phone or tablet shaped from a device's screen proportions, so a
 * device type without a drawing (an older iPhone, Android, a tablet) still
 * turns to any angle. It makes no claim to be any real product.
 */
export function genericPhoneModel(
  deviceType: DeviceType,
  label: string,
  kind: 'phone' | 'tablet',
  platform: 'ios' | 'android' | 'neutral',
  screenAspect: number,
  cutout: PhoneCutout
): PhoneModel {
  const tablet = kind === 'tablet';
  const width = tablet ? 180 : 72;
  const bezel = tablet ? 6 : platform === 'android' ? 2.2 : 2.6;
  const height = (width - 2 * bezel) / screenAspect + 2 * bezel;
  const thickness = tablet ? 6.1 : 8.2;
  const cornerRadius = tablet ? 14 : platform === 'android' ? 8 : 12;
  const lensRing = tablet ? 7 : 13;
  const backX = tablet ? 14 : 13;
  const lenses = tablet
    ? [{ x: backX, y: 14, ring: lensRing, glass: lensRing * 0.7 }]
    : platform === 'android'
      ? [0, 1, 2].map((i) => ({ x: backX, y: 14 + i * 14, ring: lensRing, glass: lensRing * 0.72 }))
      : [
          { x: backX, y: 13, ring: lensRing, glass: lensRing * 0.75 },
          { x: backX + 13, y: 26, ring: lensRing, glass: lensRing * 0.75 },
        ];
  return {
    id: deviceType,
    label,
    // Only which platform's conventions it follows; the stand-in is nobody's phone.
    maker: platform === 'android' ? 'google' : 'apple',
    drawing: '',
    width,
    height,
    thickness,
    screenPoints: [Math.round(1000 * screenAspect), 1000],
    metal: 'aluminium',
    corner: circleCorner(cornerRadius),
    edge: roundEdge(thickness, tablet ? 1.4 : 2.2),
    glass: { width: width - 2, height: height - 2 },
    display: { width: width - 2 * bezel, height: height - 2 * bezel },
    flatInset: tablet ? 2 : 3,
    cutout,
    receiver: { width: tablet ? 0 : 10, top: 0.7, bottom: 1.2 },
    back: { kind: 'glass' },
    pads: tablet || platform === 'android'
      ? []
      : [{ shape: 'rounded', x0: 2.5, y0: 2.5, x1: 37.5, y1: 37, radius: 8, height: 1.6, round: 1.6, material: 'back' }],
    lenses,
    lensTop: tablet ? 0.9 : platform === 'android' ? 1.4 : 3.2,
    flash: tablet ? undefined : { x: platform === 'android' ? backX + 12 : backX + 13, y: platform === 'android' ? 14 : 12, d: 4.5 },
    buttons: tablet
      ? [{ side: 'right', center: 30, length: 14, width: 2.2, proud: 0.4, kind: 'button' }]
      : platform === 'android'
        ? [
            { side: 'right', center: 52, length: 22, width: 2.4, proud: 0.45, kind: 'button' },
            { side: 'right', center: 80, length: 11, width: 2.4, proud: 0.45, kind: 'button' },
          ]
        : [
            { side: 'left', center: 40, length: 10, width: 2.5, proud: 0.45, kind: 'button' },
            { side: 'left', center: 54, length: 10, width: 2.5, proud: 0.45, kind: 'button' },
            { side: 'right', center: 48, length: 16, width: 2.5, proud: 0.45, kind: 'button' },
          ],
    port: tablet ? { width: 0, height: 0 } : { width: 8.9, height: 3.1 },
    holes: tablet ? { x: [], d: 0 } : { x: [12, 14.2, 16.4, 18.6, width - 18.6, width - 16.4, width - 14.2, width - 12], d: 1.4 },
    screws: tablet ? { x: [], d: 0 } : { x: [width / 2 - 7, width / 2 + 7], d: 1.4 },
    finishes: GENERIC_FINISHES,
    defaultFinish: 'black',
  };
}
