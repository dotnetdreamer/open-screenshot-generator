// The background remover's pure maths (src/lib/cutout): the streamed SHA-256
// the model download is checked with, the filters, the edge controls, the
// brush and its undo, and the plain colour cut with its rules for putting the
// colour and the model's mask together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from '@/lib/cutout/sha256';
import {
  BrushStroke,
  boxFilter,
  composeCutout,
  estimateForeground,
  featherEdge,
  modelInput,
  refineMask,
  resizePlaneArea,
  shiftEdge,
  swapPatch,
  trimBounds,
} from '@/lib/cutout/refine';
import { colorKey, detectFlatBackground, fuseWithModel, hasTransparentBorder } from '@/lib/cutout/colorKey';
import { CUTOUT_MODELS, modelFor } from '@/lib/cutout/models';

/** A width x height RGBA picture filled by `paint(x, y)`. */
function picture(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number?]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

test('sha256: matches the standard vectors and node, fed in any pieces', () => {
  assert.equal(new Sha256().hex(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(new Sha256().update(new TextEncoder().encode('abc')).hex(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const data = new Uint8Array(randomBytes(200_003));
  const expected = createHash('sha256').update(data).digest('hex');
  for (const piece of [1, 63, 64, 65, 4096, 77_777]) {
    const hash = new Sha256();
    for (let at = 0; at < data.length; at += piece) hash.update(data.subarray(at, at + piece));
    assert.equal(hash.hex(), expected, `pieces of ${piece}`);
  }
});

test('models: the GPU gets the 1024 model and the CPU the 512 one, each pinned and hashed', () => {
  assert.equal(modelFor(true).size, 1024);
  assert.equal(modelFor(false).size, 512);
  for (const spec of Object.values(CUTOUT_MODELS)) {
    assert.match(spec.sha256, /^[0-9a-f]{64}$/);
    for (const url of spec.urls) assert.match(url, /\/resolve\/[0-9a-f]{40}\//, `${url} is pinned to a commit`);
  }
});

test('boxFilter: the mean over the window, edges repeated, whatever the radius', () => {
  const width = 9;
  const height = 7;
  const src = new Float32Array(width * height).map((_, i) => (i * 37) % 11);
  for (const r of [1, 2, 4]) {
    const out = boxFilter(src, width, height, r);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const sx = Math.min(width - 1, Math.max(0, x + dx));
            const sy = Math.min(height - 1, Math.max(0, y + dy));
            sum += src[sy * width + sx];
          }
        }
        assert.ok(Math.abs(out[y * width + x] - sum / ((2 * r + 1) ** 2)) < 1e-4);
      }
    }
  }
});

test('resizePlaneArea: averages what each output pixel covers', () => {
  const src = new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]);
  const out = resizePlaneArea(src, 4, 2, 2, 1);
  assert.deepEqual(Array.from(out), [1, 0]);
});

test('shiftEdge and featherEdge: grow, shrink and soften a square', () => {
  const width = 21;
  const height = 21;
  const mask = new Float32Array(width * height);
  for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) mask[y * width + x] = 1;
  const count = (plane: Float32Array) => plane.reduce((sum, v) => sum + (v > 0.5 ? 1 : 0), 0);
  assert.equal(count(mask), 25);
  assert.equal(count(shiftEdge(mask, width, height, 2)), 81);
  assert.equal(count(shiftEdge(mask, width, height, -1)), 9);
  const soft = featherEdge(mask, width, height, 4);
  assert.ok(soft[10 * width + 10] > 0.5 && soft[10 * width + 10] < 1);
  assert.ok(soft[10 * width + 14] > 0 && soft[10 * width + 14] < 0.5);
});

test('trimBounds: the subject with a margin, null for an empty mask', () => {
  const width = 10;
  const mask = new Uint8Array(width * 8);
  mask[3 * width + 4] = 255;
  mask[5 * width + 6] = 200;
  assert.deepEqual(trimBounds(mask, width, 8, 3, 1), { x: 3, y: 2, width: 5, height: 5 });
  assert.equal(trimBounds(new Uint8Array(80), width, 8), null);
});

test('composeCutout: the photo with the mask as alpha, cut to the rectangle', () => {
  const rgba = picture(4, 2, (x) => [x * 60, 10, 20]);
  const mask = new Uint8Array([0, 255, 128, 0, 0, 255, 255, 0]);
  const out = composeCutout(rgba, 4, mask, { x: 1, y: 0, width: 2, height: 2 });
  assert.deepEqual(Array.from(out), [60, 10, 20, 255, 120, 10, 20, 128, 60, 10, 20, 255, 120, 10, 20, 255]);
});

test('estimateForeground: a soft edge loses the old background colour, a whole pixel keeps its own', () => {
  // Red hair over blue, half and half along a soft band, in a picture tall
  // enough to need more than one strip.
  const width = 120;
  const height = 600;
  const alpha = new Float32Array(width * height);
  const rgba = picture(width, height, (x, y) => {
    const a = Math.min(1, Math.max(0, (60 - x) / 20 + 0.5));
    alpha[y * width + x] = a;
    // What a camera sees: red mixed with the blue behind by the alpha.
    return [Math.round(220 * a + 20 * (1 - a)), 20, Math.round(20 * a + 220 * (1 - a))];
  });
  const fg = estimateForeground(rgba, width, height, alpha);
  assert.equal(fg.length, width * height * 3);
  for (const y of [5, 300, 595]) {
    const edge = (y * width + 60) * 3;
    // At half cover the photo shows purple; the subject's own colour is red.
    assert.ok(fg[edge] > 170, `red stays at row ${y}: ${fg[edge]}`);
    assert.ok(fg[edge + 2] < 90, `blue is taken out at row ${y}: ${fg[edge + 2]}`);
  }
  const solid = (300 * width + 5) * 3;
  assert.deepEqual([fg[solid], fg[solid + 1], fg[solid + 2]], [220, 20, 20]);
});

test('brush: a stroke does not build up over itself, and undo puts back what was there', () => {
  const width = 40;
  const height = 30;
  const mask = new Uint8Array(width * height).fill(255);
  const stroke = new BrushStroke(mask, width, height, 'erase', 5, 0.9);
  stroke.to(10, 10);
  stroke.to(20, 10);
  stroke.to(10, 10);
  assert.equal(mask[10 * width + 15], 0);
  assert.equal(mask[25 * width + 35], 255);
  const patch = stroke.finish();
  assert.ok(patch);
  const redo = swapPatch(mask, width, patch!);
  assert.ok(mask.every((v) => v === 255), 'undo restored the mask');
  swapPatch(mask, width, redo);
  assert.equal(mask[10 * width + 15], 0, 'redo erased it again');
});

test('modelInput: planar, normalised the way ImageNet models expect', () => {
  const rgba = picture(8, 8, () => [255, 0, 128]);
  const input = modelInput(rgba, 8, 8, 4);
  assert.equal(input.length, 3 * 16);
  assert.ok(Math.abs(input[0] - (1 - 0.485) / 0.229) < 1e-4);
  assert.ok(Math.abs(input[16] - (0 - 0.456) / 0.224) < 1e-4);
});

test('refineMask: stays in range, and leaves what the model was sure of alone', () => {
  const width = 64;
  const height = 48;
  const rgba = picture(width, height, (x) => (x < 32 ? [250, 250, 250] : [20, 60, 200]));
  const coarse = new Float32Array(16 * 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) coarse[y * 16 + x] = x < 7 ? 0 : x > 8 ? 1 : 0.5;
  const out = refineMask(rgba, width, height, { data: coarse, width: 16, height: 12 });
  assert.equal(out.length, width * height);
  assert.ok(out.every((v) => v >= 0 && v <= 1));
  assert.equal(out[10 * width + 2], 0);
  assert.equal(out[10 * width + 60], 1);
});

test('detectFlatBackground: a plain backdrop is one, a busy photo is not', () => {
  const flat = picture(60, 40, (x, y) => (x > 20 && x < 40 && y > 10 && y < 30 ? [200, 30, 30] : [255, 255, 255]));
  const found = detectFlatBackground(flat, 60, 40);
  assert.ok(found);
  assert.deepEqual(found!.color, [255, 255, 255]);
  const busy = picture(60, 40, (x, y) => [(x * 47) % 256, (y * 91) % 256, ((x + y) * 13) % 256]);
  assert.equal(detectFlatBackground(busy, 60, 40), null);
});

test('hasTransparentBorder: a picture that is already cut out', () => {
  const cut = picture(20, 20, (x, y) => (x > 5 && x < 15 && y > 5 && y < 15 ? [10, 10, 10, 255] : [0, 0, 0, 0]));
  assert.equal(hasTransparentBorder(cut, 20, 20), true);
  assert.equal(hasTransparentBorder(picture(20, 20, () => [255, 255, 255]), 20, 20), false);
});

/** A red ring on white: its middle is white too, but shut inside the ring. */
function ring(): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = 80;
  const height = 80;
  const rgba = picture(width, height, (x, y) => {
    const d = Math.hypot(x - 40, y - 40);
    return d > 12 && d < 24 ? [220, 20, 20] : [255, 255, 255];
  });
  return { rgba, width, height };
}

test('colorKey: the backdrop goes where it reaches from the border; a shut-in patch stays without a model', () => {
  const { rgba, width, height } = ring();
  const bg = detectFlatBackground(rgba, width, height)!;
  const key = colorKey(rgba, width, height, bg);
  assert.equal(key.alpha[0], 0, 'corner is background');
  assert.equal(key.alpha[40 * width + 40 - 18], 255, 'the ring stays');
  assert.equal(key.alpha[40 * width + 40], 255, 'the middle is shut in, so it stays');
});

test('colorKey with a model: a shut-in patch the model calls background goes', () => {
  const { rgba, width, height } = ring();
  const bg = detectFlatBackground(rgba, width, height)!;
  const model = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - 40, y - 40);
      model[y * width + x] = d > 12 && d < 24 ? 1 : 0;
    }
  }
  const key = colorKey(rgba, width, height, bg, { model });
  assert.equal(key.alpha[40 * width + 40], 0, 'the middle went');
  assert.equal(key.alpha[40 * width + 22], 255, 'the ring stayed');
});

test('fuseWithModel: when the model misses most of what the colour keeps, the colour stands', () => {
  // A pale card on white with a small mark on it; the model sees only the mark.
  const width = 60;
  const height = 60;
  const rgba = picture(width, height, (x, y) => {
    if (x > 27 && x < 33 && y > 27 && y < 33) return [20, 20, 20];
    return x > 10 && x < 50 && y > 10 && y < 50 ? [235, 228, 215] : [255, 255, 255];
  });
  const bg = detectFlatBackground(rgba, width, height)!;
  const model = new Float32Array(width * height);
  for (let y = 28; y < 33; y++) for (let x = 28; x < 33; x++) model[y * width + x] = 1;
  const key = colorKey(rgba, width, height, bg);
  const distance = new Uint8Array(width * height).fill(10);
  const fused = fuseWithModel(key, model, distance);
  assert.equal(fused[15 * width + 15], 255, 'the card is kept');
  assert.equal(fused[2 * width + 2], 0, 'the backdrop is not');
});
