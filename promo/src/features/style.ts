/**
 * Timing, chapters and every word on screen for the feature reel
 * (composition PromoFeatures).
 *
 * The film follows one made-up app, Juniper: Habit Tracker, from an empty store
 * page to its first reviews, in three chapters: make the screenshots, get the
 * app out there, see how it is doing. Its screens are scripts/juniper/, its
 * store set was built and exported by the editor itself, and the Growth sample
 * data in tests/fixtures/growthSample.ts is the same app, so the numbers in
 * chapter three belong to the screenshots in chapter one.
 *
 * The music is public/intro.mp3 at 120 BPM, arranged by
 * scripts/arrange-music-features.js into 92 seconds. One bar is 2.0 s, which
 * is 60 frames, and a beat is a quarter bar. The opening is quick: two bars of
 * hook, the reveal on the crash and chapter one's card on the rise. Chapter one
 * gives each feature a bar and a quarter, so its cuts walk round the four beats;
 * chapter two gives a bar and a half (cuts on the downbeat or beat 3); chapter
 * three keeps two bars a feature. Each chapter opens on the track's crash (bars
 * 2, 14, 23), the break bars (16, 26) are the quiet beat before chapters two
 * and three's drops, and the logo lands on the final hit (bar 43). Edit the
 * two files together: the arranger's SEGMENTS say which bar of the track plays
 * under each bar here.
 */
export { V, clamp, outExpo, outQuint, inOutQuint, ramp, rise, rnd } from "../vs/style";
export { F_HEAD, F_BODY, F_MONO } from "../vs/style";

export const FPS = 30;
/** One bar of the music, in frames. */
export const BAR = 60;
/** One beat. */
export const BEAT = 15;

const b = (from: number, to: number) => [from * BAR, to * BAR] as const;

/** Scene boundaries in global frames, written in bars (a quarter bar is one beat). */
export const T = {
  // The open: an app with no reason to be downloaded, then the crash fills it.
  HOOK_A: b(0, 0.75),
  HOOK_B: b(0.75, 2),
  REVEAL: b(2, 3),
  // Chapter one's card sits on the rise, which goes straight into the drop.
  BREAK1: b(3, 4),
  // Chapter 1, make your screenshots, a bar and a quarter each, from the drop.
  M_TPL: b(4, 5.25),
  M_DROP: b(5.25, 6.5),
  M_3D: b(6.5, 7.75),
  M_PANO: b(7.75, 9),
  M_LANG: b(9, 10.25),
  M_VIDEO: b(10.25, 11.5),
  M_CAPTURE: b(11.5, 12.75),
  M_AGENT: b(12.75, 14),
  // Chapter 2, get it out there. The upload starts in the middle of the break bar and lands on the drop (bar 17).
  L_TITLE: b(14, 15),
  L_EXPORT: b(15, 16.5),
  L_UPLOAD: b(16.5, 18),
  L_SITE: b(18, 19.5),
  L_SOCIAL: b(19.5, 21),
  L_HEADER: b(21, 23),
  // Chapter 3, see how it is doing. The question sits on the break, the answer on the drop.
  G_TITLE: b(23, 24),
  G_STATS: b(24, 26),
  G_ASK: b(26, 27),
  G_ANSWER: b(27, 29),
  G_RIVALS: b(29, 31),
  G_KEYS: b(31, 33),
  G_REVIEWS: b(33, 35),
  G_MORE1: b(35, 37),
  G_MORE2: b(37, 39),
  G_SCORE: b(39, 41),
  G_RECAP: b(41, 43),
  OUTRO: b(43, 46),
} as const;

export type SceneKey = keyof typeof T;
export const TOTAL = T.OUTRO[1];
export const dur = (k: SceneKey) => T[k][1] - T[k][0];

/**
 * How long a scene was made to run, in frames, where the film now gives it
 * less. Its animation plays that much faster (PromoFeatures' Scene), so the
 * camera keys, rings, cursor and copy timings written inside it stay as they
 * are. The upload was made for three bars with its drop one bar in; at a bar
 * and a half from the middle of the break bar, its drop still lands on bar 17.
 * The reveal does all its moving in its first 100 frames and holds after, so
 * three times faster still shows the name for about a second.
 */
export const MADE_FOR: Partial<Record<SceneKey, number>> = {
  HOOK_A: 2 * BAR,
  HOOK_B: 2 * BAR,
  REVEAL: 3 * BAR,
  M_TPL: 2 * BAR,
  M_DROP: 2 * BAR,
  M_3D: 2 * BAR,
  M_PANO: 2 * BAR,
  M_LANG: 2 * BAR,
  M_VIDEO: 2 * BAR,
  M_CAPTURE: 2 * BAR,
  M_AGENT: 2 * BAR,
  L_EXPORT: 2 * BAR,
  L_UPLOAD: 3 * BAR,
  L_SITE: 2 * BAR,
  L_SOCIAL: 2 * BAR,
};

/** Where the groove comes in after each chapter's break, for the backdrop's pulse. */
export const DROPS = [T.M_TPL[0], 17 * BAR, T.G_ANSWER[0]] as const;

/** Frames where the track hits hardest: the reveal, the two chapter crashes, the final hit. */
export const CRASHES = [T.REVEAL[0], T.L_TITLE[0], T.G_TITLE[0], T.OUTRO[0]];
/** Every cut, for the light sweep. */
export const CUTS = Object.values(T).map(([from]) => from);

export const CHAPTERS = [
  { n: "1", title: "Make your screenshots", from: T.BREAK1[0], to: T.L_TITLE[0], hue: "teal" as const },
  { n: "2", title: "Get your app out there", from: T.L_TITLE[0], to: T.G_TITLE[0], hue: "gold" as const },
  { n: "3", title: "See how it's doing", from: T.G_TITLE[0], to: T.G_MORE1[0], hue: "green" as const },
];

/**
 * Every line of copy. Plain words, no dashes, no full stops at the end of a
 * line, and nothing a person who has never shipped an app would have to look
 * up. Where a beat has two sentences they go on two lines rather than behind a
 * full stop. `isNew` marks what arrived after the last cut of this film
 * (21 August); `desktop` marks what needs the desktop app.
 */
export type Beat = {
  head: string;
  /** Words in the headline to set in the accent colour. */
  accent?: string;
  sub: string[];
  isNew?: boolean;
  desktop?: boolean;
};

export const COPY = {
  hookA: "You made an app",
  hookB: "Now give people a reason to download it",
  brand: "Open Screenshot Generator",
  brandSub: "The free way to make App Store and Google Play screenshots",

  tpl: { head: "Start from one of 103 designs", accent: "103 designs", sub: ["For iPhone, iPad, Android, Apple Watch and Mac"] },
  drop: { head: "Drop in your screenshots", accent: "your screenshots", sub: ["Every design shows your own screens", "Pick one, then change any word or color"] },
  studio: { head: "Real phones in 3D", accent: "in 3D", sub: ["Built to their real sizes", "Turn them any way you like"], isNew: true },
  pano: { head: "One picture across your screenshots", accent: "One picture", sub: ["As people swipe, the picture carries on"], isNew: true },
  lang: { head: "Every language from one design", accent: "Every language", sub: ["Pick from 57 languages and let your AI translate"], isNew: true },
  video: { head: "Make the preview video too", accent: "preview video", sub: ["Your screen recording in a phone, with your words and music"], isNew: true },
  capture: { head: "It can take the screenshots for you", accent: "for you", sub: ["Straight from your app on a virtual iPhone or an Android phone, in every language"], isNew: true, desktop: true },
  agent: { head: "Or just say what you want", accent: "say what you want", sub: ["Claude or ChatGPT builds the whole set on the plan you already pay for"], isNew: true, desktop: true },

  exportSizes: { head: "Every size the stores ask for", accent: "Every size", sub: ["All in one click, and the size Apple requires is ticked for you"] },
  upload: { head: "Sent straight to the stores", accent: "straight to the stores", sub: ["Upload to the App Store and Google Play without leaving the app"], desktop: true },
  site: { head: "A website for your app", accent: "website", sub: ["With the support page and privacy policy the stores ask for, online for free"], isNew: true },
  social: { head: "Graphics for launch day", accent: "launch day", sub: ["Posts, stories and banners made from your screenshots in one click"], isNew: true },
  header: { head: "Ready for the new App Store", accent: "new App Store", sub: ["Header and search art for iOS 27, made from your design"], isNew: true },

  stats: { head: "See how your app is doing", accent: "how your app is doing", sub: ["Downloads, ratings and reviews from both stores, next to your designs", "And when an update makes your app crash more"], isNew: true, desktop: true },
  ask: "Did the new screenshots work?",
  answer: { head: "Before and after, in real numbers", accent: "real numbers", sub: ["It tells you when a change is real and when it's just luck"], isNew: true, desktop: true },
  rivals: { head: "Keep an eye on competitors", accent: "competitors", sub: ["See their screenshots next to yours, and know when they change"], isNew: true },
  keys: { head: "Know where you show up in search", accent: "in search", sub: ["Your App Store rank for the words you pick, checked every day", "The desktop app also shows how popular each word is"], isNew: true },
  reviews: { head: "Answer every review", accent: "every review", sub: ["AI drafts your replies and finds the complaints that keep coming up"], isNew: true, desktop: true },

  more: [
    "Many apps open at once",
    "Edit together, live",
    "Every version kept",
    "Saved to your Google Drive or GitHub",
    "Text with an outline",
    "A photo behind your design",
    "Panels on a second screen",
    "Designs from the community",
  ],
  score: ["Free and open source", "Use it without an account", "Nothing you export gets a watermark"],
  platforms: "Windows, Mac, Linux and your browser",
  url: "openscrgen.app",
  outroSub: "Free on Windows, Mac, Linux and in your browser",
} satisfies Record<string, unknown>;

/** The four numbers on the template beat, as the start dialog's tabs count them. */
export const TEMPLATE_COUNTS = [
  { n: 64, label: "for phones" },
  { n: 6, label: "for Apple Watch" },
  { n: 12, label: "for Mac" },
  { n: 6, label: "preview videos" },
  { n: 15, label: "Google Play banners" },
];
