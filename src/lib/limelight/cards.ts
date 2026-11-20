/**
 * Finding a card in a screenshot: the part of an app's screen worth lifting
 * off the phone, a chart or a panel, with the screen's own background all
 * round it.
 *
 * Most app screens are cards and rows on one plain background colour, so a
 * card is a run of rows that aren't all background, between rows that are.
 * Of those runs, the one picked is a good size (a sixth to a third of the
 * screen), clear of the status bar and the tab bar, and the most colourful:
 * a chart beats a list of grey text. A screen without a plain background (a
 * photo, a gradient) has no card, and nothing lifts.
 *
 * `findCard` is plain arithmetic on pixels, so it is tested without a
 * browser; `findCardInPicture` reads a picture for it in the browser.
 */

import type { PictureCrop } from './types';

/** A card, as shares of the picture, and the picture's width over its height. */
export interface FoundCard {
  crop: PictureCrop;
  aspect: number;
}

/** How far a colour may be from the background, summed over red, green and blue, and still be it. */
const SAME = 10;

function quantize(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

/** The colour most of the picture's left and right edges are, over its middle, as [r, g, b]. */
function background(data: Uint8ClampedArray, w: number, h: number): [number, number, number] | null {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = Math.floor(h * 0.12); y < Math.floor(h * 0.88); y++) {
    for (const x of [1, 2, w - 3, w - 2]) {
      const i = (y * w + x) * 4;
      const key = quantize(data[i], data[i + 1], data[i + 2]);
      const entry = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      entry.n++;
      entry.r += data[i];
      entry.g += data[i + 1];
      entry.b += data[i + 2];
      counts.set(key, entry);
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  if (!best) return null;
  // Half the edge or more has to be one colour, or the screen has no plain background.
  const total = 4 * (Math.floor(h * 0.88) - Math.floor(h * 0.12));
  if (best.n < total * 0.5) return null;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

/**
 * The best card in an RGBA picture `w` pixels wide, or null when it has none.
 * About 160 pixels across is plenty: a card is tens of rows tall at that size.
 */
export function findCard(data: Uint8ClampedArray, w: number, h: number): FoundCard | null {
  if (w < 16 || h < 16 || data.length < w * h * 4) return null;
  const bg = background(data, w, h);
  if (!bg) return null;
  const off = (i: number) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > SAME;
  // A row is background when nearly every pixel across it is.
  const plain: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let busy = 0;
    for (let x = 0; x < w; x++) if (off((y * w + x) * 4)) busy++;
    plain.push(busy <= w * 0.02);
  }
  let best: { score: number; y0: number; y1: number; x0: number; x1: number } | null = null;
  for (let y = 0; y < h; ) {
    if (plain[y]) {
      y++;
      continue;
    }
    const y0 = y;
    while (y < h && !plain[y]) y++;
    const y1 = y;
    const share = (y1 - y0) / h;
    // A good size, between the status bar and the tab bar.
    if (share < 0.1 || share > 0.36 || y0 < h * 0.08 || y1 > h * 0.9) continue;
    let x0 = w;
    let x1 = 0;
    let busy = 0;
    let colour = 0;
    for (let yy = y0; yy < y1; yy++) {
      for (let x = 0; x < w; x++) {
        const i = (yy * w + x) * 4;
        if (!off(i)) continue;
        busy++;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
        colour += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      }
    }
    // Wide enough to be a card, not a lone button.
    if (x1 - x0 < w * 0.5 || busy === 0) continue;
    const chroma = colour / busy / 255;
    // Colour counts most, then a size near a quarter of the screen.
    const score = (0.15 + chroma) * (1 - Math.abs(share - 0.22) * 1.5);
    if (!best || score > best.score) best = { score, y0, y1, x0, x1 };
  }
  if (!best) return null;
  // A little of the background round it, so its rounded corners show whole.
  const pad = Math.round(w * 0.02);
  const x0 = Math.max(0, best.x0 - pad);
  const x1 = Math.min(w, best.x1 + pad);
  const y0 = Math.max(0, best.y0 - pad);
  const y1 = Math.min(h, best.y1 + pad);
  return { crop: { x: x0 / w, y: y0 / h, width: (x1 - x0) / w, height: (y1 - y0) / h }, aspect: w / h };
}

/** The best card in a picture file, read small in the browser, or null when it has none. */
export async function findCardInPicture(blob: Blob): Promise<FoundCard | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const w = 160;
    const h = Math.max(16, Math.round((bitmap.height / bitmap.width) * w));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const found = findCard(ctx.getImageData(0, 0, w, h).data, w, h);
    return found ? { ...found, aspect: bitmap.width / bitmap.height } : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
