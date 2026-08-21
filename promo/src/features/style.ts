/**
 * Timing, palette and copy for the feature reel (composition PromoFeatures).
 *
 * The brand tokens and easing helpers are shared with the hero cut so the two
 * films read as one product; everything below them is this cut's own.
 *
 * The whole edit is built on a 72 frame bar (2.4s at 30fps, 100 BPM), and every
 * scene boundary is a multiple of it, so the music generator can key its risers
 * and impacts to the cuts without a table of odd numbers. 2376 frames is 33 bars.
 */
export { V, clamp, outExpo, outQuint, inOutQuint, ramp, rise, holdFade, rnd } from "../vs/style";
export { F_HEAD, F_BODY, F_MONO } from "../vs/style";

export const FPS = 30;
/** One bar of the music bed, in frames. Every scene is a whole number of these. */
export const BAR = 72;

/**
 * Scene boundaries in global frames.
 *
 * Act one (TPL through AGENT) is what the editor already did. RAIL turns the
 * film over, and the N_ beats are the release notes in order, each one carrying
 * the date it shipped on. SCORE is the only place another tool is alluded to,
 * and it names none.
 */
export const T = {
  HOOK: [0, 144],
  A_TPL: [144, 288],
  A_CANVAS: [288, 432],
  A_EXPORT: [432, 576],
  A_VIDEO: [576, 720],
  A_AGENT: [720, 864],
  RAIL: [864, 936],
  N_LANG: [936, 1080],
  N_FONTS: [1080, 1224],
  N_SAVE: [1224, 1368],
  N_CLOUD: [1368, 1512],
  N_VERSIONS: [1512, 1656],
  N_COLLAB: [1656, 1800],
  N_DISCOVER: [1800, 1944],
  N_PANELS: [1944, 2088],
  SCORE: [2088, 2232],
  OUTRO: [2232, 2376],
} as const;

export type SceneKey = keyof typeof T;
export const TOTAL = T.OUTRO[1];
export const dur = (k: SceneKey) => T[k][1] - T[k][0];

/** Frames the music bed should hit. Mirrored in scripts/gen-music-features.js. */
export const CUTS = Object.values(T).map(([from]) => from);

/**
 * The release rail: what shipped, and when. Order is the order it happened in,
 * which is also the order the second act runs in. `key` ties a date to the beat
 * that shows it, so the marker lands on the right node without a magic index.
 */
export const RELEASES: { date: string; label: string; key?: SceneKey }[] = [
  { date: "25 Jul", label: "Your own storage", key: "N_SAVE" },
  { date: "30 Jul", label: "Translation" },
  { date: "6 Aug", label: "Store upload" },
  { date: "11 Aug", label: "Your own fonts", key: "N_FONTS" },
  { date: "12 Aug", label: "Every language", key: "N_LANG" },
  { date: "14 Aug", label: "Discover", key: "N_DISCOVER" },
  { date: "17 Aug", label: "Cloud projects", key: "N_CLOUD" },
  { date: "19 Aug", label: "Versions and live editing", key: "N_VERSIONS" },
  { date: "20 Aug", label: "Operator dashboard" },
  { date: "21 Aug", label: "Panels on another screen", key: "N_PANELS" },
];

/** Which rail node each second-act beat lights up. */
export const RAIL_INDEX: Partial<Record<SceneKey, number>> = {
  N_LANG: 4,
  N_FONTS: 3,
  N_SAVE: 0,
  N_CLOUD: 6,
  N_VERSIONS: 7,
  N_COLLAB: 7,
  N_DISCOVER: 5,
  N_PANELS: 9,
};

/** The four numbers the hook counts up to. */
export const HOOK_STATS = [
  { value: 101, suffix: "", label: "templates" },
  { value: 57, suffix: "", label: "languages" },
  { value: 42, suffix: "", label: "tools for your AI client" },
  { value: 0, suffix: "", label: "accounts required" },
];

/**
 * The scoreboard. Left is what anybody would expect of a screenshot tool, right
 * is the part that is usually a paid tier or simply missing. No competitor is
 * named, shown, or counted against: the claim is only about what this does.
 */
export const SCORE_LEFT = [
  "Templates for every store size",
  "Device frames, 3D poses, custom mockups",
  "Text, shapes, images, layers",
  "Every artboard exported in one pass",
  "App Store preview videos",
];

export const SCORE_RIGHT = [
  "Runs in your browser, works offline",
  "Your files stay on your machine",
  "Live editing together, browser to browser",
  "Your AI client can drive the whole editor",
  "No account, no subscription, no watermark",
];
