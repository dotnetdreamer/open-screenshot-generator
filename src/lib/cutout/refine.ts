// The maths of a cut-out after a model has said where the subject is: resizing,
// the edge refinement, the colours along the edge, the edge controls, the trim
// and the brush. Typed arrays in, typed arrays out, no DOM, so the worker runs
// it and the unit tests run it in node.
//
// A picture here is RGBA bytes (`Uint8ClampedArray`, the layout ImageData
// uses). A mask is one byte per pixel, 0 for background and 255 for subject,
// or one float per pixel between 0 and 1 while it is being worked on.

/** One channel of floats, row by row. */
export interface Plane {
  data: Float32Array;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * The mean over a (2r+1) square around each pixel, with the edge pixels
 * repeated outward. Two passes of running sums, so the cost does not grow with
 * the radius.
 */
export function boxFilter(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  out: Float32Array = new Float32Array(src.length),
  scratch: Float32Array = new Float32Array(src.length)
): Float32Array {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) {
    out.set(src);
    return out;
  }
  const span = 2 * r + 1;
  const lastX = width - 1;
  const lastY = height - 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = src[row] * (r + 1);
    for (let i = 1; i <= r; i++) sum += src[row + (i < lastX ? i : lastX)];
    for (let x = 0; x < width; x++) {
      scratch[row + x] = sum / span;
      const add = x + r + 1;
      const drop = x - r;
      sum += src[row + (add < lastX ? add : lastX)] - src[row + (drop > 0 ? drop : 0)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = scratch[x] * (r + 1);
    for (let i = 1; i <= r; i++) sum += scratch[(i < lastY ? i : lastY) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      const add = y + r + 1;
      const drop = y - r;
      sum += scratch[(add < lastY ? add : lastY) * width + x] - scratch[(drop > 0 ? drop : 0) * width + x];
    }
  }
  return out;
}

/** Bilinear sample of a plane at a fractional position, pixel centres at .5. */
function sample(plane: Float32Array, width: number, height: number, fx: number, fy: number): number {
  const x = fx < 0 ? 0 : fx > width - 1 ? width - 1 : fx;
  const y = fy < 0 ? 0 : fy > height - 1 ? height - 1 : fy;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < width ? x0 + 1 : x0;
  const y1 = y0 + 1 < height ? y0 + 1 : y0;
  const tx = x - x0;
  const ty = y - y0;
  const top = plane[y0 * width + x0] * (1 - tx) + plane[y0 * width + x1] * tx;
  const bottom = plane[y1 * width + x0] * (1 - tx) + plane[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** A plane resized with bilinear sampling. Right for making a plane larger. */
export function resizePlane(src: Plane, width: number, height: number): Plane {
  const out = new Float32Array(width * height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < width; x++) {
      out[y * width + x] = sample(src.data, src.width, src.height, (x + 0.5) * sx - 0.5, fy);
    }
  }
  return { data: out, width, height };
}

/**
 * Which source pixels feed each output pixel, and by how much, when a row of
 * `from` pixels is averaged down to `to`. Each output pixel covers an equal
 * share of the source and a source pixel cut by a boundary counts in part.
 * Making a row longer falls back to the two nearest source pixels.
 */
function areaWeights(from: number, to: number): { start: Int32Array; count: Int32Array; weights: Float32Array; stride: number } {
  const scale = from / to;
  if (scale <= 1) {
    const start = new Int32Array(to);
    const count = new Int32Array(to).fill(2);
    const weights = new Float32Array(to * 2);
    for (let i = 0; i < to; i++) {
      const f = Math.min(from - 1, Math.max(0, (i + 0.5) * scale - 0.5));
      const i0 = Math.floor(f);
      const t = f - i0;
      start[i] = i0;
      weights[i * 2] = 1 - t;
      weights[i * 2 + 1] = i0 + 1 < from ? t : 0;
    }
    return { start, count, weights, stride: 2 };
  }
  const stride = Math.ceil(scale) + 2;
  const start = new Int32Array(to);
  const count = new Int32Array(to);
  const weights = new Float32Array(to * stride);
  for (let i = 0; i < to; i++) {
    const a = i * scale;
    const b = Math.min(from, (i + 1) * scale);
    const first = Math.floor(a);
    const last = Math.min(from - 1, Math.ceil(b) - 1);
    start[i] = first;
    count[i] = last - first + 1;
    for (let k = first; k <= last; k++) {
      const cover = Math.min(b, k + 1) - Math.max(a, k);
      weights[i * stride + (k - first)] = cover / (b - a);
    }
  }
  return { start, count, weights, stride };
}

/**
 * RGBA bytes resized into three float planes (red, green, blue, 0 to 1), by
 * averaging the area each output pixel covers, so a 4000 pixel photo shrunk to
 * a model's 1024 keeps its fine lines instead of aliasing them away.
 */
export function resizeRgbToPlanes(rgba: Uint8ClampedArray, width: number, height: number, toWidth: number, toHeight: number): [Float32Array, Float32Array, Float32Array] {
  const hx = areaWeights(width, toWidth);
  const vy = areaWeights(height, toHeight);
  const rows = [new Float32Array(toWidth * height), new Float32Array(toWidth * height), new Float32Array(toWidth * height)];
  for (let y = 0; y < height; y++) {
    const srcRow = y * width;
    const dstRow = y * toWidth;
    for (let x = 0; x < toWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      const first = hx.start[x];
      const base = x * hx.stride;
      for (let k = 0; k < hx.count[x]; k++) {
        const w = hx.weights[base + k];
        if (w === 0) continue;
        const p = (srcRow + first + k) * 4;
        r += rgba[p] * w;
        g += rgba[p + 1] * w;
        b += rgba[p + 2] * w;
      }
      rows[0][dstRow + x] = r / 255;
      rows[1][dstRow + x] = g / 255;
      rows[2][dstRow + x] = b / 255;
    }
  }
  const out: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(toWidth * toHeight),
    new Float32Array(toWidth * toHeight),
    new Float32Array(toWidth * toHeight),
  ];
  for (let y = 0; y < toHeight; y++) {
    const first = vy.start[y];
    const base = y * vy.stride;
    for (let x = 0; x < toWidth; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < vy.count[y]; k++) {
          const w = vy.weights[base + k];
          if (w !== 0) sum += rows[c][(first + k) * toWidth + x] * w;
        }
        out[c][y * toWidth + x] = sum;
      }
    }
  }
  return out;
}

/** One channel resized by averaging the area each output pixel covers. */
export function resizePlaneArea(src: Float32Array, width: number, height: number, toWidth: number, toHeight: number): Float32Array {
  const hx = areaWeights(width, toWidth);
  const vy = areaWeights(height, toHeight);
  const rows = new Float32Array(toWidth * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < toWidth; x++) {
      let sum = 0;
      const first = hx.start[x];
      const base = x * hx.stride;
      for (let k = 0; k < hx.count[x]; k++) {
        const w = hx.weights[base + k];
        if (w !== 0) sum += src[y * width + first + k] * w;
      }
      rows[y * toWidth + x] = sum;
    }
  }
  const out = new Float32Array(toWidth * toHeight);
  for (let y = 0; y < toHeight; y++) {
    const first = vy.start[y];
    const base = y * vy.stride;
    for (let x = 0; x < toWidth; x++) {
      let sum = 0;
      for (let k = 0; k < vy.count[y]; k++) {
        const w = vy.weights[base + k];
        if (w !== 0) sum += rows[(first + k) * toWidth + x] * w;
      }
      out[y * toWidth + x] = sum;
    }
  }
  return out;
}

/** RGBA bytes shrunk (or grown) to a new size, alpha included. */
export function resizeRgba(rgba: Uint8ClampedArray, width: number, height: number, toWidth: number, toHeight: number): Uint8ClampedArray {
  const [r, g, b] = resizeRgbToPlanes(rgba, width, height, toWidth, toHeight);
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3] / 255;
  const a = resizePlaneArea(alpha, width, height, toWidth, toHeight);
  const out = new Uint8ClampedArray(toWidth * toHeight * 4);
  for (let i = 0; i < a.length; i++) {
    out[i * 4] = r[i] * 255 + 0.5;
    out[i * 4 + 1] = g[i] * 255 + 0.5;
    out[i * 4 + 2] = b[i] * 255 + 0.5;
    out[i * 4 + 3] = a[i] * 255 + 0.5;
  }
  return out;
}

/** ImageNet's colour statistics, which BiRefNet was trained to expect. */
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * The model's input: the picture squashed to `size` by `size` and normalised,
 * planar (all red, then all green, then all blue), batch of one.
 */
export function modelInput(rgba: Uint8ClampedArray, width: number, height: number, size: number): Float32Array {
  const planes = resizeRgbToPlanes(rgba, width, height, size, size);
  const plane = size * size;
  const input = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) {
    const src = planes[c];
    const offset = c * plane;
    const mean = MEAN[c];
    const std = STD[c];
    for (let i = 0; i < plane; i++) input[offset + i] = (src[i] - mean) / std;
  }
  return input;
}

/** The model's raw scores turned into a 0 to 1 mask. */
export function sigmoidPlane(logits: Float32Array, size: number): Plane {
  const data = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) data[i] = 1 / (1 + Math.exp(-logits[i]));
  return { data, width: size, height: size };
}

/** Solves (S + eps I) a = v for a symmetric 3x3 S, written out (Cramer's rule). */
function solve3(
  s00: number, s01: number, s02: number, s11: number, s12: number, s22: number,
  v0: number, v1: number, v2: number,
  out: Float32Array, at: number
): void {
  const c00 = s11 * s22 - s12 * s12;
  const c01 = s02 * s12 - s01 * s22;
  const c02 = s01 * s12 - s02 * s11;
  const det = s00 * c00 + s01 * c01 + s02 * c02;
  if (Math.abs(det) < 1e-12) {
    out[at] = 0;
    out[at + 1] = 0;
    out[at + 2] = 0;
    return;
  }
  const c11 = s00 * s22 - s02 * s02;
  const c12 = s01 * s02 - s00 * s12;
  const c22 = s00 * s11 - s01 * s01;
  const inv = 1 / det;
  out[at] = (c00 * v0 + c01 * v1 + c02 * v2) * inv;
  out[at + 1] = (c01 * v0 + c11 * v1 + c12 * v2) * inv;
  out[at + 2] = (c02 * v0 + c12 * v1 + c22 * v2) * inv;
}

export interface RefineOptions {
  /** Window radius in full size pixels. Defaults to the short side over 256. */
  radius?: number;
  /** How far the result may stray from the picture's own edges. */
  epsilon?: number;
  /** Long side of the grid the filter is worked out on. */
  grid?: number;
}

/**
 * The model's mask at full size, with its edges pulled onto the picture's own.
 *
 * A guided filter (He, Sun and Tang) with the colour photo as the guide, worked
 * out on a grid about 1024 pixels long and applied at full size (He and Sun's
 * fast version). It is blended in only where the model was unsure, so a crisp
 * edge the model got right stays crisp while a strand of hair the model drew as
 * a smudge gets the photo's detail. Measured on 30 DIS5K and 20 PPM-100 images
 * (November 2026), this blend improved every score the plain filter made worse
 * on sharp objects.
 */
export function refineMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Plane,
  options: RefineOptions = {}
): Float32Array {
  const radius = options.radius ?? Math.max(2, Math.round(Math.min(width, height) / 256));
  const epsilon = options.epsilon ?? 1e-3;
  const gridLong = options.grid ?? 1024;
  const scale = Math.max(1, Math.max(width, height) / gridLong);
  const gw = Math.max(1, Math.round(width / scale));
  const gh = Math.max(1, Math.round(height / scale));
  const r = Math.max(1, Math.round(radius / scale));
  const n = gw * gh;

  const [ir, ig, ib] = resizeRgbToPlanes(rgba, width, height, gw, gh);
  const p = mask.width === gw && mask.height === gh ? mask.data : resizePlane(mask, gw, gh).data;

  const scratch = new Float32Array(n);
  const box = (src: Float32Array) => boxFilter(src, gw, gh, r, new Float32Array(n), scratch);
  const product = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
    return out;
  };

  const mR = box(ir);
  const mG = box(ig);
  const mB = box(ib);
  const mP = box(p);
  const mRP = box(product(ir, p));
  const mGP = box(product(ig, p));
  const mBP = box(product(ib, p));
  const mRR = box(product(ir, ir));
  const mRG = box(product(ir, ig));
  const mRB = box(product(ir, ib));
  const mGG = box(product(ig, ig));
  const mGB = box(product(ig, ib));
  const mBB = box(product(ib, ib));

  const a = new Float32Array(n * 3);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r0 = mR[i];
    const g0 = mG[i];
    const b0 = mB[i];
    solve3(
      mRR[i] - r0 * r0 + epsilon, mRG[i] - r0 * g0, mRB[i] - r0 * b0,
      mGG[i] - g0 * g0 + epsilon, mGB[i] - g0 * b0,
      mBB[i] - b0 * b0 + epsilon,
      mRP[i] - r0 * mP[i], mGP[i] - g0 * mP[i], mBP[i] - b0 * mP[i],
      a, i * 3
    );
    b[i] = mP[i] - a[i * 3] * r0 - a[i * 3 + 1] * g0 - a[i * 3 + 2] * b0;
  }
  const aR = new Float32Array(n);
  const aG = new Float32Array(n);
  const aB = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    aR[i] = a[i * 3];
    aG[i] = a[i * 3 + 1];
    aB[i] = a[i * 3 + 2];
  }
  const mAR = box(aR);
  const mAG = box(aG);
  const mAB = box(aB);
  const mBb = box(b);

  const out = new Float32Array(width * height);
  const sx = gw / width;
  const sy = gh / height;
  const mx = mask.width / width;
  const my = mask.height / height;
  for (let y = 0; y < height; y++) {
    const gy = (y + 0.5) * sy - 0.5;
    const py = (y + 0.5) * my - 0.5;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const coarse = sample(mask.data, mask.width, mask.height, (x + 0.5) * mx - 0.5, py);
      const unsure = 1 - Math.abs(2 * coarse - 1);
      const weight = unsure * 1.5 > 1 ? 1 : unsure * 1.5;
      if (weight < 0.01) {
        out[i] = coarse;
        continue;
      }
      const gx = (x + 0.5) * sx - 0.5;
      const p4 = i * 4;
      const q =
        sample(mAR, gw, gh, gx, gy) * (rgba[p4] / 255) +
        sample(mAG, gw, gh, gx, gy) * (rgba[p4 + 1] / 255) +
        sample(mAB, gw, gh, gx, gy) * (rgba[p4 + 2] / 255) +
        sample(mBb, gw, gh, gx, gy);
      out[i] = clamp01(coarse * (1 - weight) + clamp01(q) * weight);
    }
  }
  return out;
}

/** Floats 0 to 1 to bytes 0 to 255. */
export function toBytes(mask: Float32Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

/** Bytes 0 to 255 to floats 0 to 1. */
export function toFloats(mask: Uint8Array): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] / 255;
  return out;
}

/** Where each of `to` output positions falls between two of `from`, for linear upsampling. */
function linearTaps(from: number, to: number): { i0: Int32Array; i1: Int32Array; t: Float32Array } {
  const i0 = new Int32Array(to);
  const i1 = new Int32Array(to);
  const t = new Float32Array(to);
  const scale = from / to;
  for (let k = 0; k < to; k++) {
    const f = Math.min(from - 1, Math.max(0, (k + 0.5) * scale - 0.5));
    i0[k] = Math.floor(f);
    i1[k] = Math.min(from - 1, i0[k] + 1);
    t[k] = f - i0[k];
  }
  return { i0, i1, t };
}

/** Rows of the narrow pass worked on at once, so memory stays a few MB at any size. */
const STRIP_ROWS = 256;
const NARROW = 6;

/**
 * The colours along the edge without the old background in them.
 *
 * A half transparent pixel of hair is part hair, part whatever was behind it,
 * and shown on a new background it keeps a fringe of the old one. This works
 * out the subject's own colour there with Forte and Pitie's blur fusion
 * ("Approximate Fast Foreground Colour Estimation", ICIP 2021): a wide round of
 * box blurs, then a narrow one. Returns RGB bytes, three a pixel, worth using
 * only where the mask is part way (see `composeCutout`).
 *
 * The wide round's blurs are smooth, so it is worked out on a grid about an
 * eighth the size and read back by linear interpolation. The narrow round is
 * done in strips of rows, and a strip with no part way pixel is skipped. At the
 * 3072 pixel working size the whole picture at once held about 16 float planes,
 * some 400 MB, against the 500 MB at which the macOS web view was killed.
 */
export function estimateForeground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alpha: Float32Array
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    out[i] = rgba[j];
    out[i + 1] = rgba[j + 1];
    out[i + 2] = rgba[j + 2];
  }

  // The wide round, on a grid whose blur radius stays at least 8 pixels.
  const wide = Math.max(8, Math.round((90 * Math.max(width, height)) / 2048));
  const factor = Math.max(1, Math.floor(wide / 8));
  const gw = Math.max(1, Math.round(width / factor));
  const gh = Math.max(1, Math.round(height / factor));
  const gn = gw * gh;
  const rg = Math.max(1, Math.round(wide / factor));
  const gImage = resizeRgbToPlanes(rgba, width, height, gw, gh);
  const gAlpha = resizePlaneArea(alpha, width, height, gw, gh);
  const gScratch = new Float32Array(gn);
  const gTmp = new Float32Array(gn);
  const gBlurA = boxFilter(gAlpha, gw, gh, rg, new Float32Array(gn), gScratch);
  const gF: Float32Array[] = [];
  const gB: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < gn; i++) gTmp[i] = gImage[c][i] * gAlpha[i];
    const fa = boxFilter(gTmp, gw, gh, rg, new Float32Array(gn), gScratch);
    for (let i = 0; i < gn; i++) gTmp[i] = gImage[c][i] * (1 - gAlpha[i]);
    const ba = boxFilter(gTmp, gw, gh, rg, new Float32Array(gn), gScratch);
    for (let i = 0; i < gn; i++) {
      fa[i] /= gBlurA[i] + 1e-5;
      ba[i] /= 1 - gBlurA[i] + 1e-5;
    }
    gF.push(fa);
    gB.push(ba);
  }
  const tx = linearTaps(gw, width);
  const ty = linearTaps(gh, height);
  const upsampled = (grid: Float32Array, y: number, x: number) => {
    const r0 = ty.i0[y] * gw;
    const r1 = ty.i1[y] * gw;
    const u = ty.t[y];
    const t = tx.t[x];
    const top = grid[r0 + tx.i0[x]] * (1 - t) + grid[r0 + tx.i1[x]] * t;
    const bottom = grid[r1 + tx.i0[x]] * (1 - t) + grid[r1 + tx.i1[x]] * t;
    return top * (1 - u) + bottom * u;
  };

  // The narrow round, a strip of rows at a time with NARROW rows either side.
  const capacity = (STRIP_ROWS + 2 * NARROW) * width;
  const a = new Float32Array(capacity);
  const prodF = new Float32Array(capacity);
  const prodB = new Float32Array(capacity);
  const boxA = new Float32Array(capacity);
  const boxF = new Float32Array(capacity);
  const boxB = new Float32Array(capacity);
  const scratch = new Float32Array(capacity);
  for (let y0 = 0; y0 < height; y0 += STRIP_ROWS) {
    const y1 = Math.min(height, y0 + STRIP_ROWS);
    let partWay = false;
    for (let i = y0 * width; i < y1 * width && !partWay; i++) partWay = alpha[i] > 0.004 && alpha[i] < 0.996;
    if (!partWay) continue;
    const e0 = Math.max(0, y0 - NARROW);
    const e1 = Math.min(height, y1 + NARROW);
    const rows = e1 - e0;
    const count = rows * width;
    const sub = (plane: Float32Array) => plane.subarray(0, count);
    a.set(alpha.subarray(e0 * width, e1 * width));
    boxFilter(sub(a), width, rows, NARROW, sub(boxA), sub(scratch));
    for (let c = 0; c < 3; c++) {
      // The wide round's answer for these rows: the subject's colour and the backdrop's.
      for (let y = e0; y < e1; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const k = (y - e0) * width + x;
          const av = alpha[i];
          const fb = upsampled(gF[c], y, x);
          const bb = upsampled(gB[c], y, x);
          const f1 = clamp01(fb + av * (rgba[i * 4 + c] / 255 - av * fb - (1 - av) * bb));
          prodF[k] = f1 * av;
          prodB[k] = bb * (1 - av);
        }
      }
      boxFilter(sub(prodF), width, rows, NARROW, sub(boxF), sub(scratch));
      boxFilter(sub(prodB), width, rows, NARROW, sub(boxB), sub(scratch));
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const av = alpha[i];
          if (av <= 0.004 || av >= 0.996) continue;
          const k = (y - e0) * width + x;
          const fb = boxF[k] / (boxA[k] + 1e-5);
          const bb = boxB[k] / (1 - boxA[k] + 1e-5);
          const f2 = clamp01(fb + av * (rgba[i * 4 + c] / 255 - av * fb - (1 - av) * bb));
          out[i * 3 + c] = f2 * 255 + 0.5;
        }
      }
    }
  }
  return out;
}

/**
 * Grows (positive) or shrinks (negative) the subject by `pixels`, with a
 * running maximum or minimum over a square (van Herk and Gil-Werman), so a
 * wide shift costs what a narrow one does.
 */
export function shiftEdge(mask: Float32Array, width: number, height: number, pixels: number): Float32Array {
  const r = Math.round(Math.abs(pixels));
  if (r === 0) return mask.slice();
  const grow = pixels > 0;
  const pick = grow ? Math.max : Math.min;
  const span = 2 * r + 1;
  const run = (src: Float32Array, length: number, count: number, stride: number, step: number, out: Float32Array) => {
    const fwd = new Float32Array(length + 2 * r);
    const bwd = new Float32Array(length + 2 * r);
    const line = new Float32Array(length + 2 * r);
    for (let k = 0; k < count; k++) {
      const base = k * stride;
      for (let i = 0; i < line.length; i++) {
        const j = i - r < 0 ? 0 : i - r >= length ? length - 1 : i - r;
        line[i] = src[base + j * step];
      }
      for (let i = 0; i < line.length; i++) fwd[i] = i % span === 0 ? line[i] : pick(fwd[i - 1], line[i]);
      for (let i = line.length - 1; i >= 0; i--) {
        bwd[i] = i === line.length - 1 || (i + 1) % span === 0 ? line[i] : pick(bwd[i + 1], line[i]);
      }
      for (let i = 0; i < length; i++) out[base + i * step] = pick(bwd[i], fwd[i + 2 * r]);
    }
  };
  const tmp = new Float32Array(mask.length);
  const out = new Float32Array(mask.length);
  run(mask, width, height, width, 1, tmp);
  run(tmp, height, width, 1, width, out);
  return out;
}

/** Softens the edge by `pixels` (two box blurs, close to a Gaussian). */
export function featherEdge(mask: Float32Array, width: number, height: number, pixels: number): Float32Array {
  const r = Math.round(pixels / 2);
  if (r <= 0) return mask.slice();
  const once = boxFilter(mask, width, height, r);
  return boxFilter(once, width, height, r);
}

/**
 * The smallest rectangle holding everything the mask keeps above `threshold`
 * (0 to 255), grown by `pad` pixels and kept inside the picture. Null when the
 * mask keeps nothing.
 */
export function trimBounds(mask: Uint8Array, width: number, height: number, threshold = 3, pad = 2): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] > threshold) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (first < minX) minX = first;
    if (last > maxX) maxX = last;
    if (y < minY) minY = y;
    maxY = y;
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return { x, y, width: Math.min(width, maxX + pad + 1) - x, height: Math.min(height, maxY + pad + 1) - y };
}

/**
 * The finished picture: the photo's pixels with the mask as their alpha,
 * cut to `rect`. Along the edge the colours come from `foreground` (see
 * `estimateForeground`) when one is given, and the photo's own colour is kept
 * wherever the mask keeps the pixel whole.
 */
export function composeCutout(
  rgba: Uint8ClampedArray,
  width: number,
  mask: Uint8Array,
  rect: Rect,
  foreground?: Uint8ClampedArray | null
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const srcRow = (rect.y + y) * width;
    const dstRow = y * rect.width;
    for (let x = 0; x < rect.width; x++) {
      const i = srcRow + rect.x + x;
      const o = (dstRow + x) * 4;
      const a = mask[i];
      if (foreground && a > 0 && a < 253) {
        out[o] = foreground[i * 3];
        out[o + 1] = foreground[i * 3 + 1];
        out[o + 2] = foreground[i * 3 + 2];
      } else {
        out[o] = rgba[i * 4];
        out[o + 1] = rgba[i * 4 + 1];
        out[o + 2] = rgba[i * 4 + 2];
      }
      out[o + 3] = a;
    }
  }
  return out;
}

// --- the brush ---------------------------------------------------------------

export type BrushMode = 'erase' | 'keep';

/** The mask under part of a stroke as it was before the stroke, for undo. */
export interface MaskPatch {
  rect: Rect;
  before: Uint8Array;
}

const TILE = 64;

/**
 * One stroke of the brush on a mask, painted as it is drawn.
 *
 * Dabs along the stroke overlap, and the stroke keeps the highest cover each
 * pixel has had, so going back over a spot in the same stroke does not make it
 * stronger, as in an image editor. What each touched tile held before is kept
 * in 64 pixel tiles, which is what undo puts back.
 */
export class BrushStroke {
  private readonly tiles = new Map<number, { before: Uint8Array; cover: Uint8Array }>();
  private readonly tilesWide: number;
  private last: { x: number; y: number } | null = null;
  readonly dirty: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    private readonly mask: Uint8Array,
    private readonly width: number,
    private readonly height: number,
    private readonly mode: BrushMode,
    /** Radius in mask pixels. */
    private readonly radius: number,
    /** 0 is a soft brush, 1 a hard one. */
    private readonly hardness = 0.5
  ) {
    this.tilesWide = Math.ceil(width / TILE);
  }

  /** Paints a dab at every step between the last point and this one. */
  to(x: number, y: number): Rect | null {
    const from = this.last ?? { x, y };
    const distance = Math.hypot(x - from.x, y - from.y);
    const step = Math.max(1, this.radius * 0.25);
    const count = Math.max(1, Math.ceil(distance / step));
    let changed: Rect | null = null;
    for (let i = this.last ? 1 : 0; i <= count; i++) {
      const t = i / count;
      const rect = this.dab(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
      if (rect) changed = changed ? union(changed, rect) : rect;
    }
    this.last = { x, y };
    return changed;
  }

  private tile(index: number) {
    let entry = this.tiles.get(index);
    if (!entry) {
      const tx = index % this.tilesWide;
      const ty = Math.floor(index / this.tilesWide);
      const before = new Uint8Array(TILE * TILE);
      for (let y = 0; y < TILE; y++) {
        const my = ty * TILE + y;
        if (my >= this.height) break;
        const start = my * this.width + tx * TILE;
        const end = Math.min(start + TILE, my * this.width + this.width);
        before.set(this.mask.subarray(start, end), y * TILE);
      }
      entry = { before, cover: new Uint8Array(TILE * TILE) };
      this.tiles.set(index, entry);
    }
    return entry;
  }

  private dab(cx: number, cy: number): Rect | null {
    const r = this.radius;
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return null;
    const inner = r * Math.min(0.98, this.hardness);
    const target = this.mode === 'keep' ? 255 : 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const t = d <= inner ? 1 : 1 - (d - inner) / (r - inner);
        const cover = Math.round(t * t * (3 - 2 * t) * 255);
        const index = Math.floor(y / TILE) * this.tilesWide + Math.floor(x / TILE);
        const tile = this.tile(index);
        const k = (y % TILE) * TILE + (x % TILE);
        if (cover <= tile.cover[k]) continue;
        tile.cover[k] = cover;
        const base = tile.before[k];
        this.mask[y * this.width + x] = Math.round(base + ((target - base) * cover) / 255);
      }
    }
    const rect = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    Object.assign(this.dirty, this.dirty.width ? union(this.dirty, rect) : rect);
    return rect;
  }

  /** What the stroke changed, as it was before, for undo. Null when it changed nothing. */
  finish(): MaskPatch | null {
    if (!this.dirty.width) return null;
    const rect = { ...this.dirty };
    const before = new Uint8Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const mx = rect.x + x;
        const my = rect.y + y;
        const tile = this.tiles.get(Math.floor(my / TILE) * this.tilesWide + Math.floor(mx / TILE));
        before[y * rect.width + x] = tile ? tile.before[(my % TILE) * TILE + (mx % TILE)] : this.mask[my * this.width + mx];
      }
    }
    return { rect, before };
  }
}

/** Puts a patch back and returns what was there, so the same call redoes it. */
export function swapPatch(mask: Uint8Array, width: number, patch: MaskPatch): MaskPatch {
  const { rect } = patch;
  const now = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const row = (rect.y + y) * width + rect.x;
    now.set(mask.subarray(row, row + rect.width), y * rect.width);
    mask.set(patch.before.subarray(y * rect.width, (y + 1) * rect.width), row);
  }
  return { rect, before: now };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
