import { loadFont as loadSora } from "@remotion/google-fonts/Sora";
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";

const sora = loadSora("normal", { weights: ["600", "700", "800"] });
const manrope = loadManrope("normal", { weights: ["500", "600", "700"] });

export const F_DISPLAY = sora.fontFamily;
export const F_BODY = manrope.fontFamily;

/** Palette for the Steps promo. Deliberately different from theme.ts (C.*). */
export const P = {
  bg: "#05070F",
  ink: "#F4F6FF",
  sub: "#98A2C7",
  glass: "rgba(255,255,255,0.06)",
  stroke: "rgba(255,255,255,0.15)",
  step1: "#8B5CF6",
  step2: "#22D3EE",
  step3: "#4ADE80",
  hot: "#F471B5",
};

/** Step transition beats (global frames @30fps). Music risers crest here. */
export const BEATS = [2, 75, 330, 615, 790];

/** Aurora color acts, keyed to the beats. [ribbonA, ribbonB, glow] */
export const ACTS: { at: number; cols: [string, string, string] }[] = [
  { at: 0, cols: ["#8B5CF6", "#F471B5", "#22D3EE"] },
  { at: 75, cols: ["#8B5CF6", "#6366F1", "#22D3EE"] },
  { at: 330, cols: ["#22D3EE", "#38BDF8", "#8B5CF6"] },
  { at: 615, cols: ["#4ADE80", "#22D3EE", "#A3E635"] },
  { at: 790, cols: ["#8B5CF6", "#22D3EE", "#F471B5"] },
];

export type R = { x: number; y: number; w: number; h: number };

/**
 * UI rects measured by scratchpad/capture-steps.js in CSS px at a 1600x1200
 * viewport (shots are 3200x2400 @DPR2). Recapture regenerates these.
 */
export const RECTS = {
  start: {
    card: { x: 141, y: 275, w: 649, h: 317.7 },
    // just the preview-strip image inside the card (no title/description)
    strip: { x: 141, y: 275, w: 649, h: 215.7 },
    dialog: { x: 100, y: 48, w: 1400, h: 1104 },
    tab: { x: 133, y: 174, w: 158.9, h: 34 },
  },
  editor: {
    phone: { x: 1168.5, y: 341, w: 288, h: 576 },
    previewBtn: { x: 1278.2, y: 11.5, w: 113.8, h: 32 },
  },
  selected: {
    phone: { x: 577.04, y: 212.8, w: 414.72, h: 829.44 },
    uploadBtn: { x: 1297, y: 221, w: 162.1, h: 32 },
  },
  preview: {
    artboard: { x: 577.63, y: 80, w: 444.75, h: 964 },
    filmstrip: { x: 665.3, y: 1086, w: 269.4, h: 96 },
  },
} as const;

/** Where every shot card sits in scene space, and the CSS px -> scene px factor. */
export const SHOT = { x: -240, y: 470, w: 1560, h: 1170 };
export const K = SHOT.w / 1600;

/** CSS-px rect (from RECTS) -> scene-space rect. */
export const sr = (r: R): R => ({
  x: SHOT.x + r.x * K,
  y: SHOT.y + r.y * K,
  w: r.w * K,
  h: r.h * K,
});

export const mid = (r: R) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const lerpHex = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.min(1, Math.max(0, t))));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
