import { loadFont as loadSora } from "@remotion/google-fonts/Sora";
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";

const sora = loadSora("normal", { weights: ["600", "700", "800"] });
const manrope = loadManrope("normal", { weights: ["500", "600", "700"] });

export const F_DISPLAY = sora.fontFamily;
export const F_BODY = manrope.fontFamily;

/**
 * The palette. One accent per act, in the order the acts run, so a viewer can
 * tell where they are in the video from the colour alone: violet while
 * languages are being added, cyan while one is being read, green while a
 * string is being written, amber when the base language comes back.
 */
export const P = {
  bg: "#04060E",
  ink: "#F5F7FF",
  sub: "#98A2C7",
  glass: "rgba(255,255,255,0.06)",
  stroke: "rgba(255,255,255,0.15)",
  add: "#8B5CF6",
  read: "#22D3EE",
  write: "#4ADE80",
  base: "#FBBF24",
  hot: "#F471B5",
};

/** Act boundaries in global frames at 30fps. The music risers crest here. */
export const BEATS = { hook: 0, add: 110, read: 560, write: 850, keep: 1370, out: 1640 };
export const DURATION = 1800;

export type R = { x: number; y: number; w: number; h: number };

/**
 * UI rects in CSS px, measured by scripts/capture-i18n.js against a 1600x1000
 * viewport (the shots themselves are 3200x2000 @DPR2). Rerun the capture and
 * mirror public/shots/rects.json here if the editor's chrome moves.
 *
 * Two numbers matter more than the rest: the board sits 47px lower once the
 * locale strip is up (headline y 182 -> 229), and the properties Content field
 * is the same box in every language.
 */
export const RECTS = {
  addLanguage: { x: 634.9, y: 11.5, w: 124.4, h: 32 },
  switcher: { x: 634.9, y: 11.5, w: 86, h: 32 },
  dialog: { x: 464, y: 40, w: 672, h: 920 },
  search: { x: 489, y: 196, w: 622, h: 36 },
  /** The dialog is height-fit and centred, so one search result sits lower. */
  searchFiltered: { x: 489, y: 429.75, w: 622, h: 36 },
  germanRow: { x: 489, y: 494.75, w: 308, h: 74.5 },
  applyOne: { x: 980.9, y: 669.25, w: 130.1, h: 40 },
  applyThree: { x: 973.9, y: 903, w: 137.1, h: 40 },
  /**
   * The "Fill in machine translations to start from" row in the dialog footer,
   * measured off 04-picked.png rather than captured: it is a label, not a
   * control the script clicks, so the capture never asked the page for it.
   */
  machineSwitch: { x: 484, y: 826, w: 590, h: 52 },
  menu: { x: 433, y: 47.5, w: 288, h: 280 },
  menuGerman: { x: 438, y: 121.5, w: 278, h: 32 },
  menuBase: { x: 438, y: 89.5, w: 278, h: 32 },
  notice: { x: 288, y: 56, w: 1312, h: 47 },
  backToBase: { x: 1455.3, y: 64, w: 128.7, h: 28 },
  /** The properties panel Content field, with its DE chip just above it. */
  content: { x: 1297, y: 248, w: 241, h: 60 },
  contentLabel: { x: 1297, y: 220, w: 160, h: 26 },
  /** The board headline: base language, then 47px lower under the strip. */
  headlineBase: { x: 333, y: 182, w: 351, h: 66 },
  headline: { x: 333, y: 229, w: 351, h: 66 },
  subtitleBase: { x: 333, y: 254, w: 351, h: 30 },
  subtitle: { x: 333, y: 301, w: 351, h: 30 },
  /** The whole first board, worked out from the headline column. */
  board: { x: 195, y: 110, w: 245, h: 530 },
} as const;

/**
 * Where a shot lives in scene space, and the CSS px -> scene px factor.
 * The card is full bleed at 1:1 camera, so K is just 1920/1600.
 */
export const SHOT = { x: 0, y: -60, w: 1920, h: 1200 };
export const K = SHOT.w / 1600;

/** CSS-px rect (RECTS) -> scene-space rect. */
export const sr = (r: R): R => ({
  x: SHOT.x + r.x * K,
  y: SHOT.y + r.y * K,
  w: r.w * K,
  h: r.h * K,
});

export const mid = (r: R) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Scene-space centre of a CSS rect, in one step. */
export const c = (r: R) => mid(sr(r));

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const lerpHex = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp01(t)));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
