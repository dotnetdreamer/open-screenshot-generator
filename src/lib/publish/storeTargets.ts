// Which slot a rendered artboard belongs in, on each store.
//
// Apple is strict: every screenshot lives in an "app screenshot set" tagged
// with a ScreenshotDisplayType, and the pixel dimensions have to be one of the
// sizes that display type accepts, exactly. Getting this wrong does not fail
// the upload, it fails asynchronously during asset processing hours later, so
// we resolve the display type from the real pixel size and refuse to guess.
//
// Google Play is loose: the image type is a slot name, not a size contract,
// and any image inside the size bounds is accepted in any screenshot slot. So
// Apple gets a lookup table and Play gets a suggestion plus an override.
//
// Sizes are Apple's published screenshot specifications:
// https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/

import { LOCALES } from '@/lib/i18n/locales';

export interface AppleDisplayTarget {
  /** ScreenshotDisplayType, the value the API stores on the set. */
  displayType: string;
  label: string;
  /** Accepted sizes in the target's natural orientation. */
  sizes: Array<{ width: number; height: number }>;
  /**
   * Whether the same set also accepts the rotated size. True for iPhone and
   * iPad (both orientations are allowed); false for Mac, TV, Vision and Watch,
   * which are one orientation only.
   */
  allowRotated: boolean;
  /** Shown next to the picker so the user knows what Apple does with it. */
  note?: string;
}

/**
 * Order matters: the first entry whose sizes match wins, and 2048x2732 is
 * valid for two iPad types. The modern one is listed first on purpose.
 */
export const APPLE_DISPLAY_TARGETS: AppleDisplayTarget[] = [
  {
    displayType: 'APP_IPHONE_67',
    label: 'iPhone 6.9-inch and 6.7-inch',
    sizes: [
      { width: 1290, height: 2796 },
      { width: 1320, height: 2868 },
    ],
    allowRotated: true,
    note: 'Required for every iPhone app',
  },
  {
    displayType: 'APP_IPHONE_65',
    label: 'iPhone 6.5-inch',
    sizes: [
      { width: 1242, height: 2688 },
      { width: 1284, height: 2778 },
    ],
    allowRotated: true,
  },
  {
    displayType: 'APP_IPHONE_61',
    label: 'iPhone 6.3-inch and 6.1-inch',
    sizes: [
      { width: 1206, height: 2622 },
      { width: 1179, height: 2556 },
    ],
    allowRotated: true,
  },
  {
    displayType: 'APP_IPHONE_55',
    label: 'iPhone 5.5-inch',
    sizes: [{ width: 1242, height: 2208 }],
    allowRotated: true,
  },
  {
    displayType: 'APP_IPHONE_47',
    label: 'iPhone 4.7-inch',
    sizes: [{ width: 750, height: 1334 }],
    allowRotated: true,
  },
  {
    displayType: 'APP_IPHONE_40',
    label: 'iPhone 4-inch',
    sizes: [
      { width: 640, height: 1096 },
      { width: 640, height: 1136 },
    ],
    allowRotated: true,
  },
  {
    displayType: 'APP_IPHONE_35',
    label: 'iPhone 3.5-inch',
    sizes: [
      { width: 640, height: 920 },
      { width: 640, height: 960 },
    ],
    allowRotated: true,
  },
  {
    displayType: 'APP_IPAD_PRO_3GEN_129',
    label: 'iPad 13-inch',
    sizes: [
      { width: 2064, height: 2752 },
      { width: 2048, height: 2732 },
    ],
    allowRotated: true,
    note: 'Required if the app runs on iPad',
  },
  {
    displayType: 'APP_IPAD_PRO_3GEN_11',
    label: 'iPad 11-inch',
    sizes: [
      { width: 1668, height: 2420 },
      { width: 1668, height: 2388 },
    ],
    allowRotated: true,
    note: 'Optional, Apple scales the 13-inch shots down when this is empty',
  },
  {
    displayType: 'APP_IPAD_105',
    label: 'iPad 10.5-inch',
    sizes: [{ width: 1668, height: 2224 }],
    allowRotated: true,
  },
  {
    displayType: 'APP_IPAD_97',
    label: 'iPad 9.7-inch',
    sizes: [{ width: 1536, height: 2048 }],
    allowRotated: true,
  },
  {
    displayType: 'APP_DESKTOP',
    label: 'Mac',
    sizes: [
      { width: 2560, height: 1600 },
      { width: 2880, height: 1800 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
    ],
    allowRotated: false,
  },
  {
    displayType: 'APP_WATCH_ULTRA',
    label: 'Apple Watch Ultra',
    sizes: [{ width: 410, height: 502 }],
    allowRotated: false,
  },
  {
    displayType: 'APP_WATCH_SERIES_10',
    label: 'Apple Watch Series 10',
    sizes: [{ width: 416, height: 496 }],
    allowRotated: false,
  },
  {
    displayType: 'APP_WATCH_SERIES_7',
    label: 'Apple Watch Series 7',
    sizes: [{ width: 396, height: 484 }],
    allowRotated: false,
  },
  {
    displayType: 'APP_WATCH_SERIES_4',
    label: 'Apple Watch Series 4',
    sizes: [{ width: 368, height: 448 }],
    allowRotated: false,
  },
  {
    displayType: 'APP_WATCH_SERIES_3',
    label: 'Apple Watch Series 3',
    sizes: [{ width: 312, height: 390 }],
    allowRotated: false,
  },
  {
    displayType: 'APP_APPLE_TV',
    label: 'Apple TV',
    sizes: [
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
    ],
    allowRotated: false,
  },
  {
    displayType: 'APP_APPLE_VISION_PRO',
    label: 'Apple Vision Pro',
    sizes: [{ width: 3840, height: 2160 }],
    allowRotated: false,
  },
];

/** The display type a given pixel size belongs to, or null when Apple takes none. */
export function appleTargetForSize(width: number, height: number): AppleDisplayTarget | null {
  for (const target of APPLE_DISPLAY_TARGETS) {
    for (const size of target.sizes) {
      if (size.width === width && size.height === height) return target;
      if (target.allowRotated && size.width === height && size.height === width) return target;
    }
  }
  return null;
}

/** Every size Apple would have accepted, for the "this will not upload" hint. */
export function nearestAppleSizes(width: number, height: number): string {
  const portrait = height >= width;
  const candidates = APPLE_DISPLAY_TARGETS.flatMap((target) =>
    target.sizes.map((size) => {
      const rotate = target.allowRotated && portrait !== size.height >= size.width;
      return rotate
        ? { width: size.height, height: size.width, label: target.label }
        : { width: size.width, height: size.height, label: target.label };
    })
  );
  const ratio = width / height;
  return candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.width / candidate.height - ratio),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2)
    .map((candidate) => `${candidate.width}x${candidate.height} (${candidate.label})`)
    .join(' or ');
}

// --- Google Play ------------------------------------------------------------

export interface PlayImageTarget {
  /** AppImageType, the last path segment of the upload URL. */
  imageType: string;
  label: string;
  /** How many images Play keeps in this slot. Extras are rejected. */
  max: number;
  /** Feature graphic and icon are a single fixed size; screenshots are a range. */
  exactSize?: { width: number; height: number };
  note?: string;
}

export const PLAY_IMAGE_TARGETS: PlayImageTarget[] = [
  { imageType: 'phoneScreenshots', label: 'Phone screenshots', max: 8, note: 'At least 2 required' },
  { imageType: 'sevenInchScreenshots', label: '7-inch tablet screenshots', max: 8 },
  { imageType: 'tenInchScreenshots', label: '10-inch tablet screenshots', max: 8 },
  { imageType: 'wearScreenshots', label: 'Wear OS screenshots', max: 8 },
  { imageType: 'tvScreenshots', label: 'Android TV screenshots', max: 8 },
  {
    imageType: 'featureGraphic',
    label: 'Feature graphic',
    max: 1,
    exactSize: { width: 1024, height: 500 },
  },
  {
    imageType: 'icon',
    label: 'App icon',
    max: 1,
    exactSize: { width: 512, height: 512 },
  },
  {
    imageType: 'tvBanner',
    label: 'Android TV banner',
    max: 1,
    exactSize: { width: 1280, height: 720 },
  },
];

/**
 * A sensible default slot for a size, always overridable in the dialog. Play
 * does not tie sizes to slots, so this is a convenience, not a rule.
 */
export function suggestPlayImageType(width: number, height: number): string {
  const exact = PLAY_IMAGE_TARGETS.find(
    (target) =>
      target.exactSize && target.exactSize.width === width && target.exactSize.height === height
  );
  if (exact) return exact.imageType;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long <= 600) return 'wearScreenshots';
  if (width > height && long / short > 1.5) return 'tvScreenshots';
  if (short >= 1200 || long >= 2400) return 'tenInchScreenshots';
  return 'phoneScreenshots';
}

/**
 * Play's published limits: PNG or JPEG, every side 320 to 3840 px, and no side
 * more than twice the other. Returns a sentence when something is off, null
 * when the image is fine.
 */
export function validatePlayImage(
  width: number,
  height: number,
  imageType: string
): string | null {
  const target = PLAY_IMAGE_TARGETS.find((entry) => entry.imageType === imageType);
  if (target?.exactSize) {
    if (width !== target.exactSize.width || height !== target.exactSize.height) {
      return `${target.label} has to be exactly ${target.exactSize.width}x${target.exactSize.height}`;
    }
    return null;
  }
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (short < 320) return 'Play needs every side to be at least 320 px';
  if (long > 3840) return 'Play needs every side to be at most 3840 px';
  if (long > short * 2) return 'Play needs the long side to be at most twice the short side';
  return null;
}

// --- Languages --------------------------------------------------------------

// A language is a store slot too: Apple keys a screenshot set by (version,
// locale, display type) and Play puts the language in the upload path, so a
// project locale that reaches an upload unmapped lands in whichever listing
// happened to be selected. That failure is invisible until Apple finishes
// processing hours later, which is exactly the reason the display type table
// above refuses to guess, so the language lookups live here beside it: one
// registration site for every store slot this app knows about.
//
// The three vocabularies differ on purpose (see src/lib/i18n/locales.ts): our
// key is 'zh-Hans', Apple says 'zh-Hans', Play says 'zh-CN'. Nothing here
// derives one from the other.

export interface LocaleTarget {
  /** Our editor locale code, the key the rest of the project uses. */
  code: string;
  /** What speakers call it, for the row label. */
  name: string;
  /** AppStoreLocalization.locale. Absent means Apple has no such localization. */
  appleLocale?: string;
  /** Play listing path segment. Absent means Play has no such listing. */
  playLanguage?: string;
}

export const LOCALE_TARGETS: LocaleTarget[] = LOCALES.map((locale) => ({
  code: locale.code,
  name: locale.nativeName,
  appleLocale: locale.appleLocale,
  playLanguage: locale.playLanguage,
}));

// Both stores return their codes in whatever case they feel like, and 'zh-hans'
// missing 'zh-Hans' would read to the user as "that language does not exist in
// App Store Connect". Matching is case-insensitive in both directions; the
// stored value is always the canonical one from the table.
const localeByCode = new Map(LOCALE_TARGETS.map((target) => [target.code.toLowerCase(), target]));
const localeByApple = new Map(
  LOCALE_TARGETS.filter((target) => target.appleLocale).map((target) => [
    target.appleLocale!.toLowerCase(),
    target,
  ])
);
const localeByPlay = new Map(
  LOCALE_TARGETS.filter((target) => target.playLanguage).map((target) => [
    target.playLanguage!.toLowerCase(),
    target,
  ])
);

export function localeTargetFor(code: string): LocaleTarget | null {
  return localeByCode.get(code.trim().toLowerCase()) ?? null;
}

/** Our code to Apple's. Null means Apple has no localization for it. */
export function appleLocaleFor(code: string): string | null {
  return localeTargetFor(code)?.appleLocale ?? null;
}

/** Our code to Play's. Null means Play has no listing language for it. */
export function playLanguageFor(code: string): string | null {
  return localeTargetFor(code)?.playLanguage ?? null;
}

/** Apple's code back to ours, so picking a localization can retarget the render. */
export function localeForAppleLocale(appleLocale: string): string | null {
  return localeByApple.get(appleLocale.trim().toLowerCase())?.code ?? null;
}

/** Play's code back to ours. 'iw-IL' and 'fil' only resolve through this table. */
export function localeForPlayLanguage(playLanguage: string): string | null {
  return localeByPlay.get(playLanguage.trim().toLowerCase())?.code ?? null;
}
