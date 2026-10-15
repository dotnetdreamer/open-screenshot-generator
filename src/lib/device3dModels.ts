/**
 * The iPhones the 3D Studio draws, in millimetres, as Apple's dimensional
 * drawings for accessory makers give them
 * (https://developer.apple.com/accessories/dimensional-drawings/).
 *
 * Measurements come from the drawings' labels and vector geometry, with
 * estimates marked where the drawings omit a detail. Finish colours are
 * matched to product photos. `drawing` is the date printed on the source
 * sheet. The renderer (elements/DeviceStudioRenderer.tsx) and the box fit
 * (device3dStudio.ts) build from these entries.
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
}

export interface PhoneButton {
  /** Seen from the front. The Action and volume buttons are on the left. */
  side: 'left' | 'right';
  /** From the top edge to the button's centre. */
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
  /** 'back' is the back glass raised, 'frame' metal in the frame colour, 'glass' dark camera glass. */
  material: 'back' | 'frame' | 'glass';
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
  material: 'back' | 'frame' | 'glass';
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
    };

export interface PhoneModel {
  id: DeviceType;
  label: string;
  /** Date of the drawing the numbers come from. */
  drawing: string;
  width: number;
  height: number;
  thickness: number;
  /** The display in points, as iOS reports it (the screenshot proportions). */
  screenPoints: [number, number];
  /** What the frame is made of, which sets how it shines. */
  metal: 'aluminium' | 'titanium';
  /**
   * The outline's corner (all four are the same), from where the top edge
   * stops being straight to where the side edge starts: [x from the side
   * edge, y from the top edge].
   */
  corner: Point2[];
  /** The edge cross-section from where the front is flat, round the outside, to where the back is flat. */
  edge: EdgePoint[];
  glass: { width: number; height: number };
  /** The display's active area, centred. Its corners follow the outline at the same inset. */
  display: { width: number; height: number };
  /** From the outside edge to where the front glass is flat. */
  flatInset: number;
  cutout: PhoneCutout;
  /** The earpiece slot at the top edge, y from the top. */
  receiver: { width: number; top: number; bottom: number };
  /**
   * A glass back in a frame, or an aluminium back with a glass window (the
   * window's inset from the sides and the y of its top and bottom).
   */
  back: { kind: 'glass' } | { kind: 'metal'; window: { side: number; top: number; bottom: number } };
  /** Raised camera areas, the one under the others first. */
  pads: PhonePad[];
  lenses: PhoneLens[];
  /** The lens cover glass above the back. */
  lensTop: number;
  flash?: PhoneDisc;
  mic?: PhoneDisc;
  sensor?: PhoneDisc;
  buttons: PhoneButton[];
  /** The USB-C opening in the bottom edge, centred. */
  port: { width: number; height: number };
  /** Speaker and microphone holes in the bottom edge, front view x. */
  holes: { x: number[]; d: number };
  screws: { x: number[]; d: number };
  finishes: PhoneFinish[];
  /** The finish a new device starts in. */
  defaultFinish: string;
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

export const IPHONE_18_PRO_MAX: PhoneModel = {
  id: 'iphone-18-pro-max',
  label: 'iPhone 18 Pro Max',
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

/** Every model the 3D Studio draws from a drawing, newest first: the palette order. */
export const PHONE_MODELS: PhoneModel[] = [
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

/** From the outside edge to the display's active area, all round. */
export function bezelOf(model: PhoneModel): number {
  return (model.width - model.display.width) / 2;
}

export function finishOf(model: PhoneModel, id: string | undefined): PhoneFinish {
  return model.finishes.find((finish) => finish.id === id) ?? model.finishes.find((finish) => finish.id === model.defaultFinish) ?? model.finishes[0];
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
