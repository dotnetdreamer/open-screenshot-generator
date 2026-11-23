import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

/**
 * The rack cut (composition PromoRack): every feature that is not about making
 * the screenshots, patched one by one into a modular synth rack, 4:5 at 60 fps.
 *
 * Everything is timed on the beat of the music, public/intro.mp3 at 120 BPM:
 * a beat is 0.5 s, exactly 30 frames, and a bar of four is 2 s.
 * scripts/arrange-music-rack.cjs lays bars of the track under the film's bars
 * and builds the sound effects from LAND_BEATS, SHOT, STEP and TYPE in this
 * file. Edit the two together or the modules stop landing on the beat.
 *
 *   film bars 0-3   the track's quiet build: column one, a module a half bar
 *   film bar 4      the track's crash, on the cut to column two
 *   film bars 5-6   the lift and the rise
 *   film bar 7      the drop, just as column two's last module is patched
 *   film bars 7-12  the groove: column three, the pull back, the whole rack
 *                   through the fill
 *   film bar 13     the track's final hit, on the card, then its own fade
 */

const inter = loadInter("normal", { weights: ["500", "600", "700", "800"], subsets: ["latin"] });
const serif = loadSerif("italic", { weights: ["400"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["500", "700"], subsets: ["latin"] });

export const F_SANS = inter.fontFamily;
export const F_SERIF = serif.fontFamily;
export const F_MONO = mono.fontFamily;

export const FPS = 60;
export const W = 1080;
export const H = 1350;
/** One beat in frames (0.5 s at 120 BPM). */
export const BEAT = 30;
export const beat = (b: number) => Math.round(b * BEAT);

// ---------------------------------------------------------------------------
// Rack geometry, in world px. The rack face is the plane z = 0, x to the right,
// y down, origin at the rack's top left corner (outside the wood).
// ---------------------------------------------------------------------------

export const G = {
  /** Module face. */
  MW: 880,
  MH: 484,
  /** Horizontal rail between rows, with its row of holes. */
  RAIL: 34,
  /** Vertical rail between columns. */
  CGAP: 26,
  /** Cream inner rail against each wood upright. */
  SIDE: 26,
  /** Top lid above the header unit. */
  CAP: 46,
  /** The black header unit with the terminal. */
  HEAD: 300,
  /** Plinth under the last row. */
  BASE: 62,
  /** Wood upright: front face width and depth. */
  WOOD: 96,
  WOOD_D: 170,
  /** Feet under the uprights. */
  LEG: 118,
};

export const COLS = 3;
export const ROWS = 6;
export const RACK_W = 2 * G.WOOD + 2 * G.SIDE + COLS * G.MW + (COLS - 1) * G.CGAP;
export const ROW0 = G.CAP + G.HEAD + G.RAIL;
export const RACK_H = ROW0 + ROWS * (G.MH + G.RAIL) + G.BASE;
export const FLOOR_Y = RACK_H + G.LEG;

export const colX = (c: number) => G.WOOD + G.SIDE + c * (G.MW + G.CGAP);
export const rowY = (r: number) => ROW0 + r * (G.MH + G.RAIL);

// ---------------------------------------------------------------------------
// Palette, sampled from the reference: warm pastel faces on cream rails, a
// walnut frame, a peach to lilac room. Two cable colours lean on the brand:
// gold (#D4AF37) and teal (#6FB3B5) from the app icon.
// ---------------------------------------------------------------------------

export const C = {
  wallTop: "#F4BFA6",
  wallMid: "#EBADB0",
  wallLow: "#D6ADC6",
  floor: "#D9B2C3",
  floorFar: "#CFA6BC",
  woodA: "#B26A3A",
  woodB: "#C98049",
  woodDark: "#7A3F1F",
  rail: "#F3EDE1",
  railShade: "#DDD4C4",
  hole: "#A39886",
  vent: "#DAD7D3",
  ventLine: "#C7C3BE",
  unit: "#1F1E1D",
  screen: "#141413",
  term: "#EEEAE2",
  termDim: "#8E8981",
  green: "#86D9A0",
  coral: "#EC7352",
  ink: "#282624",
  inkSub: "#46423E",
  paper: "#FAF7F1",
};

export type Face = { a: string; b: string; dark?: boolean };

const peach: Face = { a: "#F8D2BC", b: "#F2BEA2" };
const cream: Face = { a: "#F8F3E8", b: "#EEE7D7" };
const mint: Face = { a: "#E2F0CB", b: "#D1E5B5" };
const charcoal: Face = { a: "#2B2927", b: "#201E1D", dark: true };
const lavender: Face = { a: "#E7DAF4", b: "#D8C7EC" };
const butter: Face = { a: "#F8F0B7", b: "#F0E39A" };
const apricot: Face = { a: "#F8DDC6", b: "#F1CCAF" };
const taupe: Face = { a: "#E7DFD5", b: "#D9CEC1" };
const sage: Face = { a: "#E8F0D1", b: "#D8E6BA" };
const lemon: Face = { a: "#F7EB92", b: "#EEDD6E" };
const lime: Face = { a: "#ECF2C9", b: "#DDE8B3" };
const sand: Face = { a: "#EFE5D8", b: "#E2D5C3" };

/** Faces in the order the modules arrive, as in the reference. */
export const FACES: Face[] = [
  peach, cream, mint, charcoal, lavender, butter,
  apricot, butter, taupe, peach, charcoal, sage,
  lemon, lime, sand, peach, charcoal, lavender,
];

export const CABLE = {
  coral: "#EE9C8B",
  sage: "#A8D3A2",
  lilac: "#C2A7E9",
  gold: "#E5C24E",
  teal: "#86CFC6",
};

/** Accent of each module: the colour of the cable that patches it in. */
export const ACCENTS: string[] = [
  CABLE.coral,
  CABLE.sage, CABLE.sage, CABLE.sage, CABLE.sage, CABLE.sage, CABLE.sage,
  CABLE.lilac, CABLE.lilac, CABLE.lilac,
  CABLE.gold, CABLE.gold, CABLE.gold,
  CABLE.teal, CABLE.teal, CABLE.teal, CABLE.teal, CABLE.teal,
];

// ---------------------------------------------------------------------------
// Timeline. Module k (0 based) lands on LAND_BEATS[k], a module every two
// beats: it slides in over the quarter second before, boots, and is patched
// three quarters of a beat after. The next command starts typing a beat after
// the landing. Column one fills top to bottom, column two bottom to top,
// column three top to bottom, so the patch cable snakes through the rack.
// ---------------------------------------------------------------------------

export const LAND_BEATS = [
  2, 4, 6, 8, 10, 12,
  17, 19, 21, 23, 25, 27,
  31, 33, 35, 37, 39, 41,
];

export const SHOT = {
  /** Cut to column two on the crash, then to column three in the groove. */
  COL2: 16,
  COL3: 30,
  /** The pull back to the whole rack, on a bar of the groove. */
  PULL: 44,
  WIDE: 45.5,
  /** A pulse runs down the patch cable, a cable a sixteenth, into the card. */
  SIGNAL: 47.5,
  /** The card comes down over the rack on the track's final hit. */
  CARD: 52,
  END: 60,
};

export const TOTAL = beat(SHOT.END);

/** Frames, relative to the landing, of each step of a module's arrival. */
export const STEP = {
  typeFrom: -BEAT,
  slideFrom: -15,
  boot: 4,
  patched: Math.round(BEAT * 0.75),
};

/**
 * Typing speed: at most 1.6 frames a letter, faster for long commands, so
 * every command is typed in TYPE.within frames, before its module lands.
 */
export const TYPE = { maxPerChar: 1.6, within: 26 };
export const perChar = (text: string) => Math.min(TYPE.maxPerChar, TYPE.within / Math.max(1, text.length));

/** The frame the patch signal passes through cable k, a sixteenth note apart. */
export const signalFrame = (k: number) => beat(SHOT.SIGNAL + k / 4);

export type Slot = { col: number; row: number };

/** Where module k sits. */
export const slotOf = (k: number): Slot => {
  const col = Math.floor(k / ROWS);
  const i = k % ROWS;
  return { col, row: col === 1 ? ROWS - 1 - i : i };
};

export const landFrame = (k: number) => beat(LAND_BEATS[k]);
export const patchedFrame = (k: number) => landFrame(k) + STEP.patched;

/** How many modules are patched at a frame. */
export const patchedCount = (frame: number) =>
  LAND_BEATS.reduce((n, _, k) => n + (frame >= patchedFrame(k) ? 1 : 0), 0);

// ---------------------------------------------------------------------------
// Easing helpers. Everything is a pure function of the frame, so any frame
// renders the same way on its own and motion blur can sample between frames.
// ---------------------------------------------------------------------------

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const outCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const outQuint = (t: number) => 1 - Math.pow(1 - clamp(t), 5);
export const inOutCubic = (t: number) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const inOutSine = (t: number) => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
/** Expo out with a small overshoot that settles, for things that seat. */
export const seat = (t: number) => {
  const x = clamp(t);
  const c = 1.35;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
/** 0 to 1 over `len` frames from `from`. */
export const ramp = (f: number, from: number, len: number, ease: (t: number) => number = outCubic) =>
  ease(clamp((f - from) / len));

/** Deterministic noise in [0, 1). */
export const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
