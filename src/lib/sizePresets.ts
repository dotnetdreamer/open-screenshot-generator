import type { Size } from '@/types/artboard';

// The working-canvas size picker's catalog. These presets drive the "Canvas
// Size" dialog launched from the toolbar. Picking one performs the SAME raw
// resize the old Width/Height/Apply inputs did (handleUpdateArtboardSize) — it
// sets every artboard's canvas size, it does NOT scale content or swap mockups
// (that is the separate "Devices" format-conversion menu).
//
// The catalog is verified/enriched by the `canvas-size-preset-catalog`
// workflow; keep dimensions accurate to the current App Store / Play Store
// screenshot specifications. Every side MUST stay within
// [CANVAS_SIZE_MIN, CANVAS_SIZE_MAX] — the resize handler clamps to this range.

export const CANVAS_SIZE_MIN = 100;
export const CANVAS_SIZE_MAX = 5000;

export interface CanvasSizePreset {
  // Stable kebab-case id, unique across the whole catalog.
  id: string;
  label: string;
  width: number;
  height: number;
  // Human aspect hint, e.g. "9:19.5", "16:9", "1024:500".
  aspectLabel?: string;
  // One-line note: what it's for / accepted-alternative sizes.
  note?: string;
  // True only for store-required screenshot tiers.
  required?: boolean;
}

export interface CanvasSizePresetGroup {
  key: string;
  label: string;
  presets: CanvasSizePreset[];
}

// Verified catalog — triangulated by the canvas-size-preset-catalog workflow
// (3 independent researchers cross-checked against the current App Store /
// Play Store specs, reconciled by a synthesizer). Dimensions in px; every
// side is within [CANVAS_SIZE_MIN, CANVAS_SIZE_MAX]. Within each group, order
// is importance-descending (required tiers first). Some sizes intentionally
// repeat across groups (e.g. 1080×1920 is both a Play phone and a Story) —
// findMatchingPreset() resolves duplicates to the first, most on-topic entry.
export const CANVAS_SIZE_PRESET_GROUPS: CanvasSizePresetGroup[] = [
  {
    key: 'appstore-iphone',
    label: 'App Store iPhone',
    presets: [
      { id: 'ios-6-9', label: 'iPhone 6.9" (Portrait)', width: 1290, height: 2796, aspectLabel: '9:19.5', note: 'Required App Store baseline. Covers 6.9"/6.7" class (iPhone 15/16 Pro Max, Plus). Store auto-scales down to smaller iPhones.', required: true },
      { id: 'ios-6-9-promax', label: 'iPhone 6.9" Pro Max (Portrait)', width: 1320, height: 2868, aspectLabel: '9:19.5', note: 'iPhone 16/17 Pro Max native res; an accepted alternative that also satisfies the required 6.9" slot.' },
      { id: 'ios-6-5', label: 'iPhone 6.5" (Portrait)', width: 1242, height: 2688, aspectLabel: '9:19.5', note: 'Legacy 6.5" class (Xs Max, 11 Pro Max, XR). Optional; also accepted at 1284×2778.' },
      { id: 'ios-6-1', label: 'iPhone 6.1" (Portrait)', width: 1179, height: 2556, aspectLabel: '9:19.5', note: 'iPhone 14 Pro / 15 / 16 class. Optional; auto-scaled from a larger tier.' },
      { id: 'ios-5-5', label: 'iPhone 5.5" (Portrait)', width: 1242, height: 2208, aspectLabel: '9:16', note: 'Legacy 5.5" class (iPhone 6s to 8 Plus). Optional.' },
      { id: 'ios-4-7', label: 'iPhone 4.7" (Portrait)', width: 750, height: 1334, aspectLabel: '9:16', note: 'Legacy 4.7" class (iPhone SE 2/3, 6 to 8). Optional; rarely needed.' },
      { id: 'ios-6-9-landscape', label: 'iPhone 6.9" (Landscape)', width: 2796, height: 1290, aspectLabel: '19.5:9', note: 'Landscape of the required 6.9" tier; only needed for landscape-oriented apps.' },
    ],
  },
  {
    key: 'appstore-ipad',
    label: 'App Store iPad',
    presets: [
      { id: 'ipad-13', label: 'iPad 13" (Portrait)', width: 2064, height: 2752, aspectLabel: '3:4', note: 'Required baseline for iPad apps (iPad Pro/Air 13"). Store auto-scales down to smaller iPads.', required: true },
      { id: 'ipad-12-9', label: 'iPad 12.9" (Portrait)', width: 2048, height: 2732, aspectLabel: '3:4', note: 'Older iPad Pro 12.9" panel; an accepted alternative for the required 13" slot.' },
      { id: 'ipad-11', label: 'iPad 11" (Portrait)', width: 1668, height: 2420, aspectLabel: '~9:13', note: 'iPad Pro 11" / iPad Air. Optional; auto-scaled from 13".' },
      { id: 'ipad-10-5', label: 'iPad 10.5" (Portrait)', width: 1668, height: 2224, aspectLabel: '3:4', note: 'Legacy 10.5" class (Pro 10.5", Air 3, iPad 7 to 9). Optional.' },
      { id: 'ipad-9-7', label: 'iPad 9.7" (Portrait)', width: 1536, height: 2048, aspectLabel: '3:4', note: 'Classic 9.7" iPad class. Optional.' },
      { id: 'ipad-13-landscape', label: 'iPad 13" (Landscape)', width: 2752, height: 2064, aspectLabel: '4:3', note: 'Landscape of the required 13" tier; only for landscape-oriented iPad apps.' },
    ],
  },
  {
    key: 'appstore-watch',
    label: 'App Store Apple Watch',
    presets: [
      { id: 'watch-ultra-3', label: 'Apple Watch Ultra 3 (49mm)', width: 422, height: 514, aspectLabel: '~13:16', note: 'Required baseline for Apple Watch apps. Newest, largest tier (Ultra 3, 49mm); the App Store auto-scales it down to smaller watch sizes.', required: true },
      { id: 'watch-ultra-2', label: 'Apple Watch Ultra 2 / Ultra (49mm)', width: 410, height: 502, aspectLabel: '~13:16', note: 'Ultra 2 and first-gen Ultra (49mm). Optional; an accepted alternative for the required watch slot.' },
      { id: 'watch-series-11', label: 'Apple Watch Series 11 / 10 (46mm)', width: 416, height: 496, aspectLabel: '26:31', note: 'Series 11 and Series 10 (46mm). Optional; auto-scaled from the Ultra tier.' },
      { id: 'watch-series-9', label: 'Apple Watch Series 7 to 9 (45mm)', width: 396, height: 484, aspectLabel: '9:11', note: 'Series 7, 8 and 9 (45mm). Optional.' },
      { id: 'watch-series-6', label: 'Apple Watch Series 4 to 6 / SE (44mm)', width: 368, height: 448, aspectLabel: '23:28', note: 'Series 4, 5, 6, SE 3 and SE (44mm). Optional.' },
      { id: 'watch-series-3', label: 'Apple Watch Series 3 (42mm)', width: 312, height: 390, aspectLabel: '4:5', note: 'Legacy Series 3 (42mm). Optional; rarely needed.' },
    ],
  },
  {
    key: 'play-phone',
    label: 'Google Play Phone',
    presets: [
      { id: 'play-phone', label: 'Phone (Portrait)', width: 1080, height: 1920, aspectLabel: '9:16', note: 'Recommended Play phone screenshot. Any 320 to 3840px side, max 2:1 aspect; min 2 shots to publish.', required: true },
      { id: 'play-phone-tall', label: 'Phone Tall (Portrait)', width: 1080, height: 2160, aspectLabel: '1:2', note: "18:9, exactly Google Play's maximum 2:1 aspect ratio." },
      { id: 'play-phone-landscape', label: 'Phone (Landscape)', width: 1920, height: 1080, aspectLabel: '16:9', note: '16:9 landscape variant for landscape apps/games.' },
    ],
  },
  {
    key: 'play-tablet',
    label: 'Google Play Tablet',
    presets: [
      { id: 'play-7', label: '7" Tablet (Portrait)', width: 1200, height: 1920, aspectLabel: '5:8', note: "Google's recommended 7\" tablet size. 1080×1920 is also accepted." },
      { id: 'play-10', label: '10" Tablet (Portrait)', width: 1600, height: 2560, aspectLabel: '5:8', note: "Google's recommended 10\" tablet size. 1440×2560 also accepted." },
      { id: 'play-10-hd', label: '10" Tablet (1440p, Portrait)', width: 1440, height: 2560, aspectLabel: '9:16', note: "9:16 hi-res 10\" tablet variant (matches the app's built-in 10\" size)." },
      { id: 'play-tablet-landscape', label: 'Tablet (Landscape)', width: 2560, height: 1600, aspectLabel: '8:5', note: 'Landscape tablet / Chromebook screenshots.' },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing & Graphics',
    presets: [
      { id: 'play-feature-graphic', label: 'Play Feature Graphic', width: 1024, height: 500, aspectLabel: '1024:500', note: 'REQUIRED on every Google Play listing; must be exactly 1024×500, no transparency.', required: true },
      { id: 'app-icon', label: 'App Icon', width: 512, height: 512, aspectLabel: '1:1', note: 'REQUIRED to publish on Play; 512×512 32-bit PNG.' },
      { id: 'social-story', label: 'Story / Reel / TikTok', width: 1080, height: 1920, aspectLabel: '9:16', note: '9:16 full-screen vertical (IG/FB Stories, Reels, TikTok, Shorts).' },
      { id: 'social-og', label: 'Link Preview (Open Graph)', width: 1200, height: 630, aspectLabel: '1.91:1', note: 'Shared-link / Open Graph preview image for Facebook, LinkedIn, etc.' },
      { id: 'youtube-thumb', label: 'YouTube Thumbnail', width: 1280, height: 720, aspectLabel: '16:9', note: '16:9 video thumbnail; also a handy 720p export size.' },
    ],
  },
  {
    key: 'web-social',
    label: 'Web & Social',
    presets: [
      { id: 'full-hd', label: 'Full HD (16:9)', width: 1920, height: 1080, aspectLabel: '16:9', note: 'Slide, website hero, video frame; also the Android TV / tvOS screenshot size.' },
      { id: 'uhd-4k', label: '4K UHD (16:9)', width: 3840, height: 2160, aspectLabel: '16:9', note: 'Ultra-HD hero/video; also the tvOS & visionOS screenshot size.' },
      { id: 'ig-square', label: 'Instagram Square', width: 1080, height: 1080, aspectLabel: '1:1', note: '1:1 feed post; the most universally compatible single size.' },
      { id: 'ig-portrait', label: 'Instagram Portrait', width: 1080, height: 1350, aspectLabel: '4:5', note: '4:5 feed post. Maximum vertical feed real estate.' },
    ],
  },
];

// Flat view of every preset, computed once.
export const ALL_CANVAS_SIZE_PRESETS: CanvasSizePreset[] =
  CANVAS_SIZE_PRESET_GROUPS.flatMap((g) => g.presets);

export function isValidCanvasSize(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= CANVAS_SIZE_MIN &&
    width <= CANVAS_SIZE_MAX &&
    height >= CANVAS_SIZE_MIN &&
    height <= CANVAS_SIZE_MAX
  );
}

// The preset whose exact dimensions match the given size, if any — used to
// highlight the active preset and label the toolbar button.
export function findMatchingPreset(size: Size | undefined): CanvasSizePreset | undefined {
  if (!size) return undefined;
  return ALL_CANVAS_SIZE_PRESETS.find(
    (p) => p.width === size.width && p.height === size.height
  );
}
