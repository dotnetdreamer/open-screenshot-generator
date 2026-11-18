// The maths of exporting a perspective element where the engine cannot paint
// one into a capture (src/lib/perspectiveCapture.ts): reading computed
// transforms, which ones bend the plane, where the corners land, and the
// parent's `perspective` that tilted pictures depend on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY,
  aboutOrigin,
  bendsPlane,
  elementPlaneTransform,
  multiply,
  parseCssTransform,
  perspectiveMatrix,
  planeScale,
  projectPlanePoint,
  translation,
  warpQuad,
  type Matrix4,
} from '@/lib/perspectiveWarp';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// rotateY(deg) as CSS builds it (column-major).
function rotateY(deg: number): Matrix4 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

// Full 4x4 times a column vector, the slow way, to check the plane shortcut.
function apply(m: Matrix4, v: number[]): number[] {
  return [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
}

// Roamo's spanning phone, the template that showed the bug.
const ROAMO =
  'matrix3d(1.2572286, 0.0086818166, 0, 0.00010513031, 0.30065085, 1.0673001, 0, -0.00023582359, 0, 0, 1, 0, -45.81079, -28.200486, 0, 1)';

test('parses computed transforms and rejects the rest', () => {
  assert.equal(parseCssTransform('none'), null);
  assert.equal(parseCssTransform(''), null);
  assert.equal(parseCssTransform('rotate(10deg)'), null);
  assert.equal(parseCssTransform('matrix(1, 0, 0)'), null);
  assert.equal(parseCssTransform('matrix3d(1, 0, 0, 0)'), null);
  assert.equal(parseCssTransform('matrix(1, 0, 0, 1, x, 0)'), null);
  assert.deepEqual(parseCssTransform('matrix(2, 0, 0, 3, 10, 20)'), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1]);
  const m = parseCssTransform(ROAMO)!;
  assert.equal(m.length, 16);
  close(m[3], 0.00010513031, 1e-15);
  close(m[7], -0.00023582359, 1e-15);
  // Exponent notation, which engines use for small perspective terms.
  close(parseCssTransform('matrix3d(1, 0, 0, 3.13e-05, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)')![3], 3.13e-5, 1e-15);
});

test('a 2D transform or a 3D rotation without perspective keeps the plane flat', () => {
  assert.equal(bendsPlane(IDENTITY), false);
  assert.equal(bendsPlane(parseCssTransform('matrix(0.8, 0.6, -0.6, 0.8, 40, 10)')!), false);
  // rotateY squashes the plane but maps it affinely: every engine paints that.
  assert.equal(bendsPlane(aboutOrigin(rotateY(40), 150, 300)), false);
});

test('a homography bends the plane, and so does a parent perspective over a rotation', () => {
  assert.equal(bendsPlane(aboutOrigin(parseCssTransform(ROAMO)!, 600, 1300)), true);
  const parent = { distance: 1000, originX: 150, originY: 300, offsetX: 0, offsetY: 0 };
  assert.equal(bendsPlane(elementPlaneTransform(rotateY(25), { x: 150, y: 300 }, parent)), true);
  // A parent perspective over a flat child changes nothing: z stays 0.
  assert.equal(bendsPlane(elementPlaneTransform(IDENTITY, { x: 150, y: 300 }, parent)), false);
});

test('the plane shortcut agrees with the full 4x4 product', () => {
  const m = elementPlaneTransform(rotateY(30), { x: 100, y: 50 }, { distance: 800, originX: 120, originY: 60, offsetX: 20, offsetY: 10 });
  for (const [x, y] of [
    [0, 0],
    [200, 0],
    [200, 100],
    [37, 81],
  ]) {
    const full = apply(m, [x, y, 0, 1]);
    const p = projectPlanePoint(m, x, y);
    close(p.x, full[0]);
    close(p.y, full[1]);
    close(p.w, full[3]);
  }
});

test('the parent perspective is taken about its origin, in the child coordinates', () => {
  const distance = 900;
  const origin = { x: 100, y: 200 };
  const parent = { distance, originX: 130, originY: 240, offsetX: 30, offsetY: 40 };
  const m = elementPlaneTransform(rotateY(35), origin, parent);
  // The same thing built step by step in the parent's coordinates: the child's
  // own transform, its offset, the parent's perspective about its origin,
  // then back into the child's coordinates.
  const own = aboutOrigin(rotateY(35), origin.x, origin.y);
  const inParent = multiply(
    aboutOrigin(perspectiveMatrix(distance), parent.originX, parent.originY),
    multiply(translation(parent.offsetX, parent.offsetY), own)
  );
  const expected = multiply(translation(-parent.offsetX, -parent.offsetY), inParent);
  for (let i = 0; i < 16; i++) close(m[i], expected[i], 1e-12);
});

test('corners land where CSS puts them, with the perspective divide', () => {
  const plane = aboutOrigin(parseCssTransform(ROAMO)!, 400, 800);
  const quad = warpQuad(plane, 0, 0, 800, 1600)!;
  assert.ok(quad);
  // Top-left corner by hand: (x, y) relative to the origin through the matrix.
  const m = parseCssTransform(ROAMO)!;
  const [dx, dy] = [-400, -800];
  const w = m[3] * dx + m[7] * dy + m[15];
  const x = (m[0] * dx + m[4] * dy + m[12]) / w + 400;
  const y = (m[1] * dx + m[5] * dy + m[13]) / w + 800;
  close(quad.corners[0].x / quad.corners[0].w, x, 1e-9);
  close(quad.corners[0].y / quad.corners[0].w, y, 1e-9);
  // The box is the corners' bounds.
  const xs = quad.corners.map((c) => c.x / c.w);
  const ys = quad.corners.map((c) => c.y / c.w);
  close(quad.left, Math.min(...xs));
  close(quad.top, Math.min(...ys));
  close(quad.width, Math.max(...xs) - Math.min(...xs));
  close(quad.height, Math.max(...ys) - Math.min(...ys));
  // A real perspective: the two vertical sides are not the same length.
  const left = Math.hypot(xs[3] - xs[0], ys[3] - ys[0]);
  const right = Math.hypot(xs[2] - xs[1], ys[2] - ys[1]);
  assert.ok(Math.abs(left - right) > 50, `${left} vs ${right}`);
});

test('a corner at or behind the viewer has no picture to draw', () => {
  // perspective(100px) with the plane tipped so its far side passes the eye.
  const plane = multiply(aboutOrigin(perspectiveMatrix(100), 100, 100), aboutOrigin(rotateY(80), 100, 100));
  assert.equal(warpQuad(plane, -400, 0, 1200, 200), null);
  assert.ok(warpQuad(plane, 90, 0, 20, 200));
});

test('plane scale reads the 2D part', () => {
  close(planeScale(parseCssTransform('matrix(2, 0, 0, 2, 5, 5)')!), 2);
  close(planeScale(parseCssTransform('matrix(0.6, 0.8, -0.8, 0.6, 0, 0)')!), 1);
  close(planeScale(IDENTITY), 1);
});
