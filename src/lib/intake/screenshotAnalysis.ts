/**
 * Offline analysis of a raw app screenshot.
 *
 * Everything the fast intake flow knows about an uploaded image is derived
 * here, on the client, with no model call and no network: which device shot it,
 * what its colours are, whether its UI is dark, and whether the user has
 * uploaded something that already has a device frame baked into it (the one
 * mistake that makes every store screenshot look amateur, and the one the
 * competitor can only warn about in prose).
 *
 * The reads happen on a 64px canvas drawn from a data: URL, so nothing here
 * taints a canvas or costs more than a millisecond per image.
 */

import type { DeviceType } from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';

/**
 * A module-scope alias for the registry accessor, and it has to stay one.
 *
 * Turbopack's dev transform miscompiled a reference to this import when it sat
 * inside `for (const id of family)`: the identical import used a few lines
 * above was rewritten to the module binding and the one in the loop was left
 * bare, so `detectDevice` threw "is not defined" the first time a screenshot's
 * dimensions missed the exact-size table and fell through to aspect matching.
 * Every earlier test happened to hit an exact size, which is why it stayed
 * hidden until a store-imported screenshot arrived at 1125 by 2000.
 *
 * Binding it once here, at module scope, is compiled correctly, and everything
 * below then refers to a genuinely local name that no transform can drop.
 */
const descriptorOf = getDeviceDescriptor;

export interface ShotAnalysis {
  /** width / height of the source image. */
  aspect: number;
  /** Dominant colours, most prominent first, as #rrggbb. Up to 5. */
  palette: string[];
  /** The single most usable accent colour, or null when the shot is greyscale. */
  accent: string | null;
  /** Mean perceived luminance, 0 (black) to 1 (white). */
  luminance: number;
  /** A dark-mode UI. Drives which template backgrounds are ranked first. */
  isDark: boolean;
  /** Best matching device for these pixel dimensions. */
  device: DeviceType;
  /** 0 to 1. Above 0.9 the dimensions matched a known store size exactly. */
  deviceConfidence: number;
  /** The image looks like it already sits in a mockup or has a padded border. */
  looksFramed: boolean;
  /**
   * A content signature: a 64-bit luminance average hash, then a colour
   * signature over four quadrants.
   *
   * This is what "is this the same picture" means. File size is not: two
   * different screens of the same app at the same resolution routinely
   * compress to the same number of bytes, and treating that as a duplicate
   * silently throws away one of the user's screenshots, which is far worse
   * than occasionally letting a real duplicate through.
   *
   * The colour half is not decoration. An average hash is computed on
   * luminance alone, so two screens whose only real difference is hue, the
   * same layout in a different accent, hash identically. That is exactly the
   * shape of an onboarding flow or a themed feature tour.
   */
  fingerprint: string;
}

/**
 * Exact pixel sizes the stores and the common simulators produce, mapped to the
 * frame that matches them. Checked before any aspect-ratio guessing, and both
 * orientations are accepted so a landscape capture still resolves.
 *
 * Sizes are grouped by what they are, not by how many there are: an entry here
 * is worth more than a hundred lines of ratio tolerance, because a 1290 x 2796
 * file is an iPhone 6.9-inch capture and nothing else.
 */
const EXACT_SIZES: Array<{ w: number; h: number; device: DeviceType }> = [
  // iPhone, App Store display sizes and current simulators
  { w: 1320, h: 2868, device: 'iphone-17-pro-max' },
  { w: 1290, h: 2796, device: 'iphone-17-pro-max' },
  { w: 1206, h: 2622, device: 'iphone-15-pro' },
  { w: 1179, h: 2556, device: 'iphone-15' },
  { w: 1284, h: 2778, device: 'iphone-14' },
  { w: 1170, h: 2532, device: 'iphone-13' },
  { w: 1125, h: 2436, device: 'iphone-x' },
  { w: 1242, h: 2688, device: 'iphone-x' },
  { w: 828, h: 1792, device: 'iphone-x' },
  { w: 750, h: 1334, device: 'iphone' },
  { w: 640, h: 1136, device: 'iphone' },
  { w: 1242, h: 2208, device: 'iphone' },
  // Android, Play Store and common flagships
  { w: 1080, h: 1920, device: 'android-bar' },
  { w: 1080, h: 2160, device: 'android-notch' },
  { w: 1080, h: 2280, device: 'android-notch' },
  { w: 1080, h: 2340, device: 'android-punch-hole' },
  { w: 1080, h: 2400, device: 'android-punch-hole' },
  { w: 1080, h: 2412, device: 'android-punch-hole' },
  { w: 1080, h: 2424, device: 'android-punch-hole' },
  { w: 1344, h: 2992, device: 'android-punch-hole' },
  { w: 1440, h: 3040, device: 'android-punch-hole' },
  { w: 1440, h: 3120, device: 'android-punch-hole' },
  { w: 1440, h: 3200, device: 'android-punch-hole' },
  // 16:9 QHD, the Galaxy S6 to S8 era and still all over the Play Store.
  { w: 1440, h: 2560, device: 'android-bar' },
  { w: 1440, h: 2960, device: 'android-punch-hole' },
  { w: 720, h: 1280, device: 'android-bar' },
  // iPad
  { w: 2064, h: 2752, device: 'ipad-pro-13' },
  { w: 2048, h: 2732, device: 'ipad-pro-13' },
  { w: 1668, h: 2420, device: 'ipad-11' },
  { w: 1640, h: 2360, device: 'ipad-11' },
  { w: 1620, h: 2160, device: 'ipad-11' },
  { w: 1536, h: 2048, device: 'ipad-11' },
  // Android tablets
  { w: 1600, h: 2560, device: 'tablet-10' },
  { w: 1200, h: 1920, device: 'tablet-7' },
  { w: 800, h: 1280, device: 'tablet-7' },
  // Mac
  { w: 2560, h: 1600, device: 'macbook' },
  { w: 2880, h: 1800, device: 'macbook' },
  { w: 3024, h: 1964, device: 'macbook' },
  { w: 3456, h: 2234, device: 'macbook' },
  { w: 1440, h: 900, device: 'macbook' },
  { w: 1680, h: 1050, device: 'macbook' },
  { w: 4480, h: 2520, device: 'imac' },
  { w: 5120, h: 2880, device: 'imac' },
  { w: 3840, h: 2160, device: 'desktop' },
  { w: 2560, h: 1440, device: 'desktop' },
  { w: 1920, h: 1080, device: 'desktop' },
  // Apple Watch
  { w: 416, h: 496, device: 'apple-watch' },
  { w: 410, h: 502, device: 'apple-watch' },
  { w: 396, h: 484, device: 'apple-watch' },
  { w: 448, h: 552, device: 'apple-watch' },
  { w: 368, h: 448, device: 'apple-watch' },
  { w: 352, h: 430, device: 'apple-watch' },
];

/**
 * Which frame a screenshot of these pixel dimensions belongs in.
 *
 * An exact store size wins outright. Otherwise the aspect ratio is matched
 * against the registry's own `nativeAspect` values within the device family the
 * shape implies, so an unusual Android height still lands on an Android frame
 * rather than the nearest iPhone.
 */
export function detectDevice(width: number, height: number): { device: DeviceType; confidence: number } {
  if (!(width > 0) || !(height > 0)) return { device: 'iphone-15', confidence: 0 };

  // Two passes, and the order is load-bearing. A 2560 x 1600 capture is a
  // MacBook; a 1600 x 2560 one is a 10-inch tablet. Accepting either
  // orientation in a single pass lets the tablet entry claim the laptop,
  // because it happens to sit earlier in the table.
  for (const size of EXACT_SIZES) {
    if (width === size.w && height === size.h) return { device: size.device, confidence: 1 };
  }
  for (const size of EXACT_SIZES) {
    if (width !== size.h || height !== size.w) continue;
    // Phones and tablets are genuinely held both ways, so a landscape capture
    // of one is a real thing. A monitor or a laptop is not: accepting the
    // reversed match there turns a portrait 1440 x 2560 Android capture into a
    // rotated 2560 x 1440 desktop.
    const category = descriptorOf(size.device).category;
    if (category === 'desktop') continue;
    return { device: size.device, confidence: 0.9 };
  }

  const portrait = height >= width;
  const aspect = portrait ? width / height : height / width;

  // Shape decides the family; the registry decides the member.
  //
  // The phone boundary is 0.59, not 0.55. Phone screens run from 0.462 (a
  // 19.5:9 iPhone) all the way to 0.5625 (16:9, which is every older Android
  // and the 5.5-inch iPhone the App Store still serves), while the narrowest
  // tablet in the registry is 0.625. Cutting at 0.55 puts every 16:9 phone
  // capture in the tablet family, which then ranks phone layouts below tablet
  // ones for a phone app. There is real space between the two families; the
  // boundary belongs in it.
  let family: DeviceType[];
  if (!portrait && aspect < 0.72) {
    family = ['macbook', 'desktop', 'imac'];
  } else if (aspect < 0.59) {
    family = ['iphone-17-pro-max', 'iphone-15', 'android-punch-hole', 'android-bar'];
  } else if (aspect < 0.79) {
    family = ['ipad-pro-13', 'ipad-11', 'tablet-10', 'tablet-7'];
  } else {
    family = ['apple-watch', 'tablet'];
  }

  let best: DeviceType = family[0];
  let bestGap = Number.POSITIVE_INFINITY;
  for (const id of family) {
    // nativeAspect is stored as width / height, so it is above 1 for the
    // landscape devices (Mac, monitor). Both sides are normalised to
    // short-over-long before they are compared, or every laptop screenshot
    // would look like a catastrophic mismatch to its own frame.
    const native = descriptorOf(id).nativeAspect;
    const normalized = native > 1 ? 1 / native : native;
    const gap = Math.abs(normalized - aspect);
    if (gap < bestGap) {
      bestGap = gap;
      best = id;
    }
  }
  // A 2% ratio error is a match; a 20% error is a shrug.
  const confidence = Math.max(0.15, Math.min(0.85, 1 - bestGap * 5));
  return { device: best, confidence };
}

/** Relative luminance of an 8-bit sRGB triple, cheap approximation. */
function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Saturation in the HSL sense, 0 to 1. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2 / 255;
  const d = (max - min) / 255;
  return l > 0.5 ? d / (2 - max / 255 - min / 255) : d / (max / 255 + min / 255);
}

const ANALYSIS_EDGE = 64;

/**
 * Draw a data: URL onto a small canvas and hand back its pixels.
 * Same-origin data, so `getImageData` never throws a security error.
 */
async function samplePixels(dataUrl: string): Promise<ImageData | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(ANALYSIS_EDGE / bitmap.width, ANALYSIS_EDGE / bitmap.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

/**
 * Dominant colours by 4-bits-per-channel histogram.
 *
 * Bins are weighted by saturation, because the eye reads a screenshot's brand
 * colour off its buttons and its artwork, not off the grey chrome that occupies
 * most of the pixels. Near-black and near-white are kept in the running (a
 * pure black dark-mode UI has no other answer) but heavily discounted.
 */
function dominantColors(pixels: ImageData, limit: number): string[] {
  const bins = new Map<number, { weight: number; r: number; g: number; b: number; n: number }>();
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const sat = saturation(r, g, b);
    const light = lum(r, g, b);
    const extreme = light < 0.08 || light > 0.94;
    const weight = (0.15 + sat * 1.85) * (extreme ? 0.25 : 1);
    const bin = bins.get(key);
    if (bin) {
      bin.weight += weight;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.n += 1;
    } else {
      bins.set(key, { weight, r, g, b, n: 1 });
    }
  }

  const ranked = [...bins.values()].sort((a, b) => b.weight - a.weight);
  const out: string[] = [];
  const picked: Array<[number, number, number]> = [];
  for (const bin of ranked) {
    const r = bin.r / bin.n;
    const g = bin.g / bin.n;
    const b = bin.b / bin.n;
    // Skip anything within a short distance of a colour already taken, so the
    // palette is five different colours and not five shades of one.
    const tooClose = picked.some(
      ([pr, pg, pb]) => Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < 60
    );
    if (tooClose) continue;
    picked.push([r, g, b]);
    out.push(toHex(r, g, b));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Average hash: downsample to 8 by 8 grey, then one bit per cell for whether it
 * is above the mean. Two captures of the same screen agree; two different
 * screens of the same app do not.
 */
function averageHash(pixels: ImageData): string {
  const { width: w, height: h, data } = pixels;
  const cells = new Array<number>(64).fill(0);
  const counts = new Array<number>(64).fill(0);
  for (let y = 0; y < h; y++) {
    const row = Math.min(7, Math.floor((y / h) * 8));
    for (let x = 0; x < w; x++) {
      const column = Math.min(7, Math.floor((x / w) * 8));
      const i = (y * w + x) * 4;
      cells[row * 8 + column] += lum(data[i], data[i + 1], data[i + 2]);
      counts[row * 8 + column] += 1;
    }
  }
  let total = 0;
  for (let i = 0; i < 64; i++) {
    cells[i] = counts[i] > 0 ? cells[i] / counts[i] : 0;
    total += cells[i];
  }
  const mean = total / 64;
  let hex = '';
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (cells[nibble * 4 + bit] > mean) value |= 1 << (3 - bit);
    }
    hex += value.toString(16);
  }
  return hex + quadrantColors(pixels);
}

/** Mean colour of each quadrant, 4 bits per channel: 12 hex characters. */
function quadrantColors(pixels: ImageData): string {
  const { width: w, height: h, data } = pixels;
  const sums = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (let y = 0; y < h; y++) {
    const half = y < h / 2 ? 0 : 2;
    for (let x = 0; x < w; x++) {
      const q = half + (x < w / 2 ? 0 : 1);
      const i = (y * w + x) * 4;
      sums[q][0] += data[i];
      sums[q][1] += data[i + 1];
      sums[q][2] += data[i + 2];
      sums[q][3] += 1;
    }
  }
  return sums
    .map(([r, g, b, n]) => {
      if (n === 0) return '000';
      const nibble = (v: number) => Math.min(15, Math.round(v / n / 17)).toString(16);
      return `${nibble(r)}${nibble(g)}${nibble(b)}`;
    })
    .join('');
}

/**
 * Does this image already look like a mockup?
 *
 * Two tells, both cheap: a uniform margin on all four sides (the image was
 * exported with padding, or sits on a background plate), and corners that are
 * transparent or match each other while differing sharply from the centre (a
 * rounded device body cut out of the canvas). Deliberately conservative: this
 * only ever raises a dismissible hint, so a false positive costs the user a
 * glance and a false negative costs nothing.
 */
function detectFrame(pixels: ImageData): boolean {
  const { width: w, height: h, data } = pixels;
  if (w < 8 || h < 8) return false;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
  };

  // Transparent corners: nothing but a cut-out mockup produces those.
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (corners.every((c) => c[3] < 32)) return true;

  // A uniform border ring that differs from the middle of the image.
  const inset = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  const ring: Array<readonly [number, number, number, number]> = [];
  for (let x = 0; x < w; x += 2) {
    ring.push(at(x, 0), at(x, h - 1));
  }
  for (let y = 0; y < h; y += 2) {
    ring.push(at(0, y), at(w - 1, y));
  }
  let rr = 0;
  let rg = 0;
  let rb = 0;
  for (const [r, g, b] of ring) {
    rr += r;
    rg += g;
    rb += b;
  }
  rr /= ring.length;
  rg /= ring.length;
  rb /= ring.length;
  const spread =
    ring.reduce((acc, [r, g, b]) => acc + Math.abs(r - rr) + Math.abs(g - rg) + Math.abs(b - rb), 0) /
    ring.length;
  if (spread > 24) return false; // A real screenshot's edges are not one colour.

  const [cr, cg, cb] = at(Math.round(w / 2), Math.round(h / 2));
  const contrast = Math.abs(cr - rr) + Math.abs(cg - rg) + Math.abs(cb - rb);
  if (contrast < 60) return false; // Uniform edge that matches the middle: a flat design, not a frame.

  // The border has to be thick enough to be a plate rather than a status bar.
  let uniformRows = 0;
  for (let y = 0; y < Math.min(inset * 4, Math.floor(h / 3)); y++) {
    const [r, g, b] = at(Math.round(w / 2), y);
    if (Math.abs(r - rr) + Math.abs(g - rg) + Math.abs(b - rb) < 30) uniformRows++;
    else break;
  }
  return uniformRows >= inset * 2;
}

/** Everything the intake flow derives from one uploaded image. */
export async function analyzeScreenshot(
  dataUrl: string,
  width: number,
  height: number
): Promise<ShotAnalysis> {
  const { device, confidence } = detectDevice(width, height);
  const base: ShotAnalysis = {
    aspect: height > 0 ? width / height : 0.5,
    palette: [],
    accent: null,
    luminance: 0.5,
    isDark: false,
    device,
    deviceConfidence: confidence,
    looksFramed: false,
    fingerprint: '',
  };

  const pixels = await samplePixels(dataUrl);
  if (!pixels) return base;

  const data = pixels.data;
  let total = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    total += lum(data[i], data[i + 1], data[i + 2]);
    count++;
  }
  const luminance = count > 0 ? total / count : 0.5;
  const palette = dominantColors(pixels, 5);

  // The accent is the first palette entry with real colour in it. A greyscale
  // screenshot has none, and saying so is more useful than offering a grey.
  const accent =
    palette.find((hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return saturation(r, g, b) > 0.25 && lum(r, g, b) > 0.12 && lum(r, g, b) < 0.92;
    }) ?? null;

  return {
    ...base,
    palette,
    accent,
    luminance,
    isDark: luminance < 0.42,
    looksFramed: detectFrame(pixels),
    fingerprint: averageHash(pixels),
  };
}

/**
 * One palette for a whole upload set: each shot's colours in order, interleaved
 * so the first shot leads, then deduplicated. What the theming row offers.
 */
export function mergePalettes(analyses: ShotAnalysis[], limit = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...analyses.map((a) => a.palette.length));
  for (let rank = 0; rank < depth; rank++) {
    for (const analysis of analyses) {
      const hex = analysis.palette[rank];
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      out.push(hex);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
