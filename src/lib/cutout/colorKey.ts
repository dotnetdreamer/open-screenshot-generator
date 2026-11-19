// The cut for a picture on one plain colour: a logo, an icon, a drawing, a
// product shot on a white sweep. A model is the wrong tool there on its own.
// Measured on ten bundled illustrations put on flat colours (November 2026),
// BiRefNet kept the birds and dropped the card they were printed on (0.14 of
// the right area), while the plain colour cut got it to 0.99. The model wins
// the other way when the subject is the background's colour at its edge: a
// white sticker outline on white, a white plane on white.
//
// So the colour cut decides what is plainly background, the model decides the
// cases the colour cannot, and `fuseWithModel` puts the two together. Pure
// typed array maths, like refine.ts.

/** sRGB byte to linear light. */
const LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return table;
})();

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

/** CIE Lab (D65) of an sRGB colour given as bytes. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = LINEAR[r];
  const lg = LINEAR[g];
  const lb = LINEAR[b];
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export interface FlatBackground {
  /** The background's colour, as bytes. */
  color: [number, number, number];
  lab: [number, number, number];
  /** Share of the border within a just noticeable difference of that colour. */
  share: number;
  /** How far the border strays from it (90th percentile, in Lab units). */
  noise: number;
}

/** Border pixel indices, a ring a few pixels deep. */
function borderIndices(width: number, height: number): Int32Array {
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.004));
  const list: number[] = [];
  for (let y = 0; y < height; y++) {
    const edgeRow = y < ring || y >= height - ring;
    for (let x = 0; x < width; x++) {
      if (edgeRow || x < ring || x >= width - ring) list.push(y * width + x);
      else if (x === ring) x = width - ring - 1;
    }
  }
  return Int32Array.from(list);
}

function median(values: Float32Array): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Whether the picture already has a transparent background, judged from its
 * border: then its own alpha is the cut, and nothing needs working out.
 */
export function hasTransparentBorder(rgba: Uint8ClampedArray, width: number, height: number): boolean {
  const border = borderIndices(width, height);
  let clear = 0;
  for (let k = 0; k < border.length; k++) if (rgba[border[k] * 4 + 3] < 8) clear++;
  return clear / border.length >= 0.9;
}

/**
 * The plain colour the picture sits on, or null when its border is not one
 * colour. Measured on the same test pictures: every illustration on a flat
 * colour counted as one, and none of 20 portraits or 30 photos of objects did.
 */
export function detectFlatBackground(rgba: Uint8ClampedArray, width: number, height: number): FlatBackground | null {
  if (width < 8 || height < 8) return null;
  const border = borderIndices(width, height);
  const n = border.length;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const Bl = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const p = border[k] * 4;
    const lab = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    L[k] = lab[0];
    A[k] = lab[1];
    B[k] = lab[2];
    R[k] = rgba[p];
    G[k] = rgba[p + 1];
    Bl[k] = rgba[p + 2];
  }
  const lab: [number, number, number] = [median(L), median(A), median(B)];
  const distances = new Float32Array(n);
  let close = 0;
  for (let k = 0; k < n; k++) {
    const d = Math.hypot(L[k] - lab[0], A[k] - lab[1], B[k] - lab[2]);
    distances[k] = d;
    if (d < 6) close++;
  }
  const share = close / n;
  if (share < 0.9) return null;
  const sorted = distances.sort();
  const noise = sorted[Math.floor(n * 0.9)];
  return {
    color: [Math.round(median(R)), Math.round(median(G)), Math.round(median(Bl))],
    lab,
    share,
    noise,
  };
}

export interface ColorKeyResult {
  /** 0 to 255 per pixel. */
  alpha: Uint8Array;
  /** 1 where the background colour reaches from the border. */
  background: Uint8Array;
  /** How close to the background colour a pixel had to be (Lab units). */
  tolerance: number;
}

/** Lab distance from `lab` for every pixel, in half units, capped at 255. */
function distanceMap(rgba: Uint8ClampedArray, n: number, lab: [number, number, number]): Uint8Array {
  const out = new Uint8Array(n);
  // Neighbouring pixels usually share a colour, so the last answer is reused.
  let lastKey = -1;
  let lastValue = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    if (key !== lastKey) {
      const c = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
      const d = Math.hypot(c[0] - lab[0], c[1] - lab[1], c[2] - lab[2]) * 2;
      lastValue = d > 255 ? 255 : Math.round(d);
      lastKey = key;
    }
    out[i] = lastValue;
  }
  return out;
}

/**
 * Marks with `mark` every pixel of `state` still 0 that is joined to `start`
 * through pixels of the background colour (scanline fill), and returns how
 * many it marked. `visit` hears each one.
 */
function fill(
  start: number,
  width: number,
  height: number,
  distance: Uint8Array,
  limit: number,
  state: Uint8Array,
  mark: number,
  visit?: (index: number) => void
): number {
  const open = (i: number) => state[i] === 0 && distance[i] <= limit;
  if (!open(start)) return 0;
  const stack: number[] = [start];
  let count = 0;
  while (stack.length) {
    const seed = stack.pop() as number;
    if (!open(seed)) continue;
    const y = Math.floor(seed / width);
    const row = y * width;
    let left = seed - row;
    while (left > 0 && open(row + left - 1)) left--;
    let right = seed - row;
    while (right < width - 1 && open(row + right + 1)) right++;
    let upOpen = false;
    let downOpen = false;
    for (let x = left; x <= right; x++) {
      const i = row + x;
      state[i] = mark;
      count++;
      visit?.(i);
      if (y > 0) {
        const up = i - width;
        const now = open(up);
        if (now && !upOpen) stack.push(up);
        upOpen = now;
      }
      if (y < height - 1) {
        const down = i + width;
        const now = open(down);
        if (now && !downOpen) stack.push(down);
        downOpen = now;
      }
    }
  }
  return count;
}

/**
 * Cuts away the background colour wherever it reaches from the border.
 *
 * Only what touches the border goes for certain, so a white face inside a
 * sticker on white stays. A patch of the background colour shut inside the
 * subject (the middle of an O, the loop of a cable) goes only when a model's
 * mask is given and says so. Along the cut the subject's outermost pixels
 * keep the share of them that is not background (GIMP's colour to alpha),
 * which keeps a logo's anti-aliased edge smooth instead of stair-stepped.
 *
 * With `model` (0 to 1 per pixel) the result is already put together with it,
 * as `fuseWithModel` describes.
 */
export function colorKey(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  bg: FlatBackground,
  options: { tolerance?: number; model?: Float32Array } = {}
): ColorKeyResult {
  const n = width * height;
  const tolerance = options.tolerance ?? Math.max(6, Math.min(18, bg.noise * 2.5 + 3));
  const limit = Math.round(tolerance * 2);
  const distance = distanceMap(rgba, n, bg.lab);
  // 0 not reached, 1 background, 2 an enclosed patch the model kept.
  const state = new Uint8Array(n);

  for (let x = 0; x < width; x++) {
    fill(x, width, height, distance, limit, state, 1);
    fill((height - 1) * width + x, width, height, distance, limit, state, 1);
  }
  for (let y = 0; y < height; y++) {
    fill(y * width, width, height, distance, limit, state, 1);
    fill(y * width + width - 1, width, height, distance, limit, state, 1);
  }

  const model = options.model;
  if (model) {
    const members: number[] = [];
    for (let i = 0; i < n; i++) {
      if (state[i] !== 0 || distance[i] > limit) continue;
      members.length = 0;
      let sum = 0;
      fill(i, width, height, distance, limit, state, 2, (index) => {
        members.push(index);
        sum += model[index];
      });
      if (members.length && sum / members.length < 0.25) for (const index of members) state[index] = 1;
    }
  }

  const background = new Uint8Array(n);
  for (let i = 0; i < n; i++) background[i] = state[i] === 1 ? 1 : 0;

  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = background[i] ? 0 : 255;

  // The rim: subject pixels next to the background, a pixel or two deep.
  const depth = Math.max(1, Math.round(Math.min(width, height) / 600));
  let ring = new Uint8Array(background);
  const rim = new Uint8Array(n);
  for (let pass = 0; pass < depth; pass++) {
    const next = new Uint8Array(ring);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (ring[i]) continue;
        if ((x > 0 && ring[i - 1]) || (x < width - 1 && ring[i + 1]) || (y > 0 && ring[i - width]) || (y < height - 1 && ring[i + width])) {
          next[i] = 1;
          rim[i] = 1;
        }
      }
    }
    ring = next;
  }
  const base = bg.color.map((v) => v / 255);
  for (let i = 0; i < n; i++) {
    if (!rim[i]) continue;
    const p = i * 4;
    let a = 0;
    for (let c = 0; c < 3; c++) {
      const delta = rgba[p + c] / 255 - base[c];
      const room = delta > 0 ? 1 - base[c] : base[c];
      if (room > 1e-3) a = Math.max(a, Math.abs(delta) / room);
    }
    alpha[i] = Math.round(Math.min(1, a) * 255);
  }
  const result = { alpha, background, tolerance };
  return model ? { ...result, alpha: fuseWithModel(result, model, distance) } : result;
}

/**
 * The colour cut and the model's mask together.
 *
 * - Where the background colour reached, the colour cut stands unless the
 *   model is sure the pixel is subject (a white outline on white), and then
 *   the model's value is used.
 * - A pixel the colour cut kept but the model calls background is the colour
 *   cut's when its colour is far from the backdrop's (a badge the model
 *   missed), and the model's when it is close (a soft shadow or glow, which
 *   the colour alone would keep as a hard ring). Unless the model missed most
 *   of what the colour cut keeps: then the model failed on this picture (it
 *   kept the birds printed on a card and dropped the card) and the colour cut
 *   stands everywhere outside the backdrop.
 * - Along the rim the higher of the two counts, so a pale part of the subject
 *   next to a white outline is not thinned.
 *
 * `distance` is the Lab distance from the backdrop in half units, as
 * `colorKey` works it out. On the ten test illustrations this took the share
 * of the right area kept from 0.88 (the model alone) to 0.98 on average.
 */
export function fuseWithModel(key: ColorKeyResult, model: Float32Array, distance: Uint8Array): Uint8Array {
  const n = key.alpha.length;
  const out = new Uint8Array(n);
  let kept = 0;
  let agreed = 0;
  for (let i = 0; i < n; i++) {
    if (key.alpha[i] < 128) continue;
    kept++;
    if (model[i] >= 0.5) agreed++;
  }
  const modelMissedIt = kept > 0 && agreed / kept < 0.6;
  const near = modelMissedIt ? -1 : Math.round(key.tolerance * 3 * 2);
  for (let i = 0; i < n; i++) {
    const m = model[i];
    const sure = m >= 0.5 ? Math.round(m * 255) : 0;
    const k = key.alpha[i];
    if (key.background[i]) out[i] = sure;
    else if (m < 0.5 && distance[i] < near) out[i] = Math.round(m * 255);
    else out[i] = k < 255 && sure > k ? sure : k;
  }
  return out;
}
