import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const grotesk = loadGrotesk("normal", { weights: ["500", "700"] });
const inter = loadInter("normal", { weights: ["400", "500", "600"] });
const mono = loadMono("normal", { weights: ["400", "700"] });

export const F_HEAD = grotesk.fontFamily;
export const F_BODY = inter.fontFamily;
export const F_MONO = mono.fontFamily;

/**
 * Palette matches the marketing site (Space Grotesk on near-black with gold and
 * teal accents) so the hero video and the page under it read as one thing. The
 * `old` ramp is the drained grey the "old way" half is graded into.
 */
export const V = {
  bg: "#05090A",
  bgLift: "#0A1213",
  ink: "#F4F8F7",
  sub: "#93A8A8",
  dim: "#5C6E6E",
  gold: "#D4AF37",
  goldSoft: "#E8CE7A",
  teal: "#6FB3B5",
  tealDeep: "#3E7375",
  red: "#C4574C",
  stroke: "rgba(255,255,255,0.10)",
  strokeSoft: "rgba(255,255,255,0.055)",
  glass: "rgba(255,255,255,0.04)",
  // Lifted off pure black on purpose: the drained grade already pulls a lot of
  // life out, and at the original values the old act read as an empty frame.
  old: {
    bg: "#0E1011",
    panel: "#1F2223",
    line: "rgba(255,255,255,0.14)",
    ink: "#D2D7D7",
    sub: "#8B9292",
  },
};

export const FPS = 30;

/**
 * Scene boundaries in global frames. The music bed (scripts/gen-music-vs.js)
 * risers and impacts are keyed to TURN, and to the first frame of every "new
 * way" beat, so edit them together or the cuts stop landing on the hits.
 */
export const T = {
  HOOK: [0, 126],
  OLD_TOOL: [126, 264],
  OLD_SIZES: [264, 408],
  OLD_LANGS: [408, 528],
  OLD_PAY: [528, 666],
  TURN: [666, 780],
  N_TPL: [780, 894],
  N_CANVAS: [894, 1008],
  N_EXPORT: [1008, 1122],
  N_LANGS: [1122, 1236],
  N_VIDEO: [1236, 1350],
  N_AGENT: [1350, 1464],
  N_PRIV: [1464, 1578],
  OUTRO: [1578, 1740],
} as const;

export type SceneKey = keyof typeof T;

export const TOTAL = T.OUTRO[1];
export const dur = (k: SceneKey) => T[k][1] - T[k][0];

/** The frame every "new way" beat starts on, for the music generator. */
export const NEW_BEATS = [
  T.TURN[0], T.N_TPL[0], T.N_CANVAS[0], T.N_EXPORT[0],
  T.N_LANGS[0], T.N_VIDEO[0], T.N_AGENT[0], T.N_PRIV[0], T.OUTRO[0],
];

// ---------------------------------------------------------------------------
// Easing and reveal helpers. Everything is a pure function of the local frame
// so a render is deterministic and seekable.
// ---------------------------------------------------------------------------

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Cubic bezier, the standard "expo out" feel used for every entrance. */
export const outExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const outQuint = (t: number) => 1 - Math.pow(1 - clamp(t), 5);
export const inOutQuint = (t: number) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

/** 0 -> 1 over `len` frames starting at `delay`, eased. */
export const ramp = (local: number, delay: number, len: number, ease = outQuint) =>
  ease(clamp((local - delay) / len));

/** Entrance transform: lifts up and settles, with a touch of scale. */
export const rise = (local: number, delay = 0, len = 26, dist = 34) => {
  const p = ramp(local, delay, len);
  return {
    opacity: p,
    transform: `translateY(${(1 - p) * dist}px)`,
  };
};

/** Fades a scene's contents in at the head and out at the tail. */
export const holdFade = (local: number, len: number, inF = 12, outF = 12) =>
  Math.min(ramp(local, 0, inF, outQuint), 1 - ramp(local, len - outF, outF, outQuint));

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Layout unit: scales type and spacing between the 16:9 and 9:16 cuts. */
export const scaleFor = (tall: boolean) => (tall ? 0.84 : 1);
