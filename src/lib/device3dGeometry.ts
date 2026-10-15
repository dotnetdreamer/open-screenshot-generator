/**
 * Shapes of a measured phone (device3dModels.ts), in millimetres, with no
 * three.js: the outline with its real corner, the outlines inset from it (the
 * display, the back window, the camera plateau), the edge cross-section, and
 * the points on the outside that the box fit projects.
 *
 * Model coordinates: the phone's centre is the origin, X to the right seen
 * from the front, Y up, Z toward the screen.
 */

import type { EdgePoint, IslandPad, LoftPad, PhoneModel, PlateauPad, Point2 } from './device3dModels';

export interface OutlinePoint {
  x: number;
  y: number;
  /** Outward normal. */
  nx: number;
  ny: number;
}

/** A sample of the edge cross-section, with its normal split into outward and +z parts. */
export interface EdgeSample {
  inset: number;
  z: number;
  out: number;
  nz: number;
}

// ---------------------------------------------------------------------------
// Smooth curves through measured points
// ---------------------------------------------------------------------------

/**
 * Slopes for a monotone cubic through (t, v) (Fritsch and Butland): wherever
 * the values turn round the slope is zero, so the curve never overshoots a
 * measured point, and the two end slopes are given.
 */
function monotoneSlopes(t: number[], v: number[], startSlope: number, endSlope: number): number[] {
  const n = t.length;
  const secant = (k: number) => (v[k + 1] - v[k]) / (t[k + 1] - t[k]);
  const slopes = new Array<number>(n).fill(0);
  slopes[0] = startSlope;
  slopes[n - 1] = endSlope;
  for (let k = 1; k < n - 1; k++) {
    const a = secant(k - 1);
    const b = secant(k);
    if (a * b <= 0) continue;
    const ha = t[k] - t[k - 1];
    const hb = t[k + 1] - t[k];
    const w1 = 2 * hb + ha;
    const w2 = hb + 2 * ha;
    slopes[k] = (w1 + w2) / (w1 / a + w2 / b);
  }
  // Keep the given end slopes from pushing the first and last pieces past
  // their neighbours.
  const clamp = (k: number, s: number, edge: number) => {
    const d = secant(edge);
    if (d === 0) return 0;
    if (Math.sign(s) !== Math.sign(d) && s !== 0) return 0;
    return Math.sign(s) * Math.min(Math.abs(s), 3 * Math.abs(d));
  };
  slopes[0] = clamp(0, slopes[0], 0);
  slopes[n - 1] = clamp(n - 1, slopes[n - 1], n - 2);
  return slopes;
}

/**
 * A curve through every one of `points`, as a monotone cubic in each
 * coordinate over the chord length, leaving the first point along `start` and
 * arriving at the last along `end` (unit directions). It cannot overshoot a
 * measured point, so a corner never pokes past the straight edge it meets.
 */
export function throughPoints(points: Point2[], start: Point2, end: Point2, perSegment: number): Point2[] {
  const t = [0];
  for (let i = 1; i < points.length; i++) {
    t.push(t[i - 1] + Math.max(1e-6, Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])));
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const mx = monotoneSlopes(t, xs, start[0], end[0]);
  const my = monotoneSlopes(t, ys, start[1], end[1]);
  const out: Point2[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const h = t[k + 1] - t[k];
    for (let s = 0; s < perSegment; s++) {
      const u = s / perSegment;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      out.push([
        h00 * xs[k] + h10 * h * mx[k] + h01 * xs[k + 1] + h11 * h * mx[k + 1],
        h00 * ys[k] + h10 * h * my[k] + h01 * ys[k + 1] + h11 * h * my[k + 1],
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * A corner as a dense curve: [distance in from the side edge, distance down
 * from the top edge], from the top tangent to the side tangent, through the
 * measured points, leaving along the top edge and arriving along the side.
 */
export function smoothCorner(corner: Point2[], perSegment = 6): Point2[] {
  return throughPoints(corner, [-1, 0], [0, 1], perSegment);
}

/** A corner moved in by `inset` along its normal, re-measured from the new rectangle's corner. */
export function insetCorner(corner: Point2[], inset: number): Point2[] {
  return corner.map((point, i) => {
    const prev = corner[Math.max(0, i - 1)];
    const next = corner[Math.min(corner.length - 1, i + 1)];
    // The curve runs from the top tangent toward the side, so the inward
    // normal is (ty, -tx): straight down at the top tangent, straight in at
    // the side tangent.
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    return [Math.max(0, point[0] + ty * inset - inset), Math.max(0, point[1] - tx * inset - inset)];
  });
}

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

/** Outward normals for a closed counter-clockwise polyline. */
function withNormals(points: Point2[]): OutlinePoint[] {
  const n = points.length;
  return points.map(([x, y], i) => {
    const [px, py] = points[(i - 1 + n) % n];
    const [qx, qy] = points[(i + 1) % n];
    let tx = qx - px;
    let ty = qy - py;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    return { x, y, nx: ty, ny: -tx };
  });
}

/**
 * A rectangle in model coordinates, [x0, x1] x [y0, y1] (y up), with `corner`
 * (as smoothCorner gives it) at all four corners, counter-clockwise from the
 * top of the right side. Straight edges are implied between the corners.
 */
export function cornerRect(corner: Point2[], x0: number, y0: number, x1: number, y1: number): OutlinePoint[] {
  const points: Point2[] = [];
  const reversed = [...corner].reverse();
  for (const [dx, dy] of reversed) points.push([x1 - dx, y1 - dy]); // top right, side to top
  for (const [dx, dy] of corner) points.push([x0 + dx, y1 - dy]); // top left, top to side
  for (const [dx, dy] of reversed) points.push([x0 + dx, y0 + dy]); // bottom left, side to bottom
  for (const [dx, dy] of corner) points.push([x1 - dx, y0 + dy]); // bottom right, bottom to side
  return withNormals(dedupe(points));
}

/** A rectangle with circular corners of `radius`, counter-clockwise from the top of the right side. */
export function roundRect(x0: number, y0: number, x1: number, y1: number, radius: number, perCorner = 10): OutlinePoint[] {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  // From the top tangent (r, 0) to the side tangent (0, r), measured in from the corner.
  const corner: Point2[] = [];
  for (let i = 0; i <= perCorner; i++) {
    const a = (i / perCorner) * (Math.PI / 2);
    corner.push([r * (1 - Math.sin(a)), r * (1 - Math.cos(a))]);
  }
  return cornerRect(corner, x0, y0, x1, y1);
}

function dedupe(points: Point2[]): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-4) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-4) out.pop();
  return out;
}

/** The phone's outline at its widest, in model coordinates. */
export function phoneOutline(model: PhoneModel): OutlinePoint[] {
  const w = model.width / 2;
  const h = model.height / 2;
  return cornerRect(smoothCorner(model.corner), -w, -h, w, h);
}

/** The phone's outline moved in by `inset` all round, the way the display and the flat glass sit in it. */
export function insetOutline(model: PhoneModel, inset: number): OutlinePoint[] {
  const w = model.width / 2 - inset;
  const h = model.height / 2 - inset;
  return cornerRect(insetCorner(smoothCorner(model.corner), inset), -w, -h, w, h);
}

/** Back-view coordinates to model coordinates: the back view's left edge is the phone's right side. */
export function fromBackView(model: PhoneModel, x: number, y: number): Point2 {
  return [model.width / 2 - x, model.height / 2 - y];
}

/** Front-view coordinates to model coordinates. */
export function fromFrontView(model: PhoneModel, x: number, y: number): Point2 {
  return [x - model.width / 2, model.height / 2 - y];
}

/** The glass window of a unibody back, in model coordinates (x mirrored does not matter: it is symmetric). */
export function windowOutline(model: PhoneModel): OutlinePoint[] | null {
  if (model.back.kind !== 'metal') return null;
  const { side, top, bottom } = model.back.window;
  const w = model.width / 2 - side;
  return cornerRect(insetCorner(smoothCorner(model.corner), side), -w, model.height / 2 - bottom, w, model.height / 2 - top);
}

/**
 * The flat top of the full-width plateau, in model coordinates: `deckInset`
 * in from the sides and top, down to `deckBottom`, with the outline's corner
 * scaled down to `deckCorner` at all four corners.
 */
export function plateauDeck(model: PhoneModel, pad: PlateauPad): OutlinePoint[] {
  const scale = pad.deckCorner / model.corner[0][0];
  const corner = smoothCorner(model.corner.map(([a, b]) => [a * scale, b * scale] as Point2));
  const w = model.width / 2 - pad.deckInset;
  return cornerRect(corner, -w, model.height / 2 - pad.deckBottom, w, model.height / 2 - pad.deckInset);
}

/**
 * A measured wall (a pad's `wall`) as a dense curve: [distance out from the
 * top's edge, height above the back]. Level where it lies down on the back.
 */
export function wallCurve(wall: Point2[], perSegment = 4): Point2[] {
  return throughPoints(wall, [1, 0], [1, 0], perSegment);
}

/** A wall curve's height at a distance out from the top's edge. */
export function wallRiseAt(curve: Point2[], d: number): number {
  if (d <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (curve[i][0] < d) continue;
    const [d0, r0] = curve[i - 1];
    const [d1, r1] = curve[i];
    return r0 + ((d - d0) / Math.max(1e-9, d1 - d0)) * (r1 - r0);
  }
  return curve[curve.length - 1][1];
}

/** How far a point (model coordinates) is in from a closed outline: its distance to the nearest edge. */
export function insetAt(outline: OutlinePoint[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x + t * dx - x, p.y + t * dy - y));
  }
  return best;
}

/**
 * How far in front of the back the phone's edge has curved at a given inset
 * from the outline: 0 on the back's flat, rising toward the side as the back
 * rounds over into it.
 */
export function backEdgeLift(model: PhoneModel): (inset: number) => number {
  const back = model.edge[model.edge.length - 1][1];
  const bandEnd = Math.min(0, ...model.edge.filter(([inset, z]) => inset <= 0.02 && z <= 0).map(([, z]) => z));
  // The round-over alone, from the bottom of the side band to the back's flat.
  const part = edgeCurve(model.edge).filter((s) => s.z <= bandEnd + 1e-6);
  return (inset) => {
    if (inset <= part[0].inset) return part[0].z - back;
    for (let i = 1; i < part.length; i++) {
      if (part[i].inset < inset) continue;
      const a = part[i - 1];
      const b = part[i];
      const t = (inset - a.inset) / Math.max(1e-9, b.inset - a.inset);
      return a.z + t * (b.z - a.z) - back;
    }
    return 0;
  };
}

/** The base of a lofted bar (LoftPad), in model coordinates, counter-clockwise. */
export function loftBase(model: PhoneModel, pad: LoftPad): OutlinePoint[] {
  const corner = insetCorner(smoothCorner(model.corner), pad.inset);
  const w = model.width / 2 - pad.inset;
  const top = model.height / 2 - pad.inset;
  const base = model.height / 2 - pad.baseBottom;
  // Quarter ellipse tangent to the base line, meeting the side vertically.
  const a = pad.baseCurve - pad.inset;
  const b = pad.baseBottom - pad.baseSide;
  const points: Point2[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    points.push([w - a + a * Math.sin(t), base + b - b * Math.cos(t)]);
  }
  for (const [dx, dy] of [...corner].reverse()) points.push([w - dx, top - dy]);
  for (const [dx, dy] of corner) points.push([-w + dx, top - dy]);
  for (let i = steps; i >= 0; i--) {
    const t = (i / steps) * (Math.PI / 2);
    points.push([-w + a - a * Math.sin(t), base + b - b * Math.cos(t)]);
  }
  return withNormals(dedupe(points));
}

/** The flat top of a lofted bar: a stadium, in model coordinates. */
export function loftTop(model: PhoneModel, pad: LoftPad): OutlinePoint[] {
  const [ax, ay] = fromBackView(model, pad.top.x0, pad.top.y0);
  const [bx, by] = fromBackView(model, pad.top.x1, pad.top.y1);
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  return roundRect(x0, y0, x1, y1, Math.min(x1 - x0, y1 - y0) / 2, 16);
}

/** Where a ray from `c` along angle `a` leaves a convex outline. */
export function rayExit(outline: OutlinePoint[], c: Point2, a: number): Point2 {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let best = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - c[0]) * ey - (p.y - c[1]) * ex) / den;
    const u = ((p.x - c[0]) * dy - (p.y - c[1]) * dx) / den;
    if (t > best && u >= -1e-9 && u <= 1 + 1e-9) best = t;
  }
  return [c[0] + dx * best, c[1] + dy * best];
}

/** The footprint of a raised island, in model coordinates. */
export function islandFootprint(model: PhoneModel, pad: IslandPad, inset = 0): OutlinePoint[] {
  const [ax, ay] = fromBackView(model, pad.x0, pad.y0);
  const [bx, by] = fromBackView(model, pad.x1, pad.y1);
  const x0 = Math.min(ax, bx) + inset;
  const x1 = Math.max(ax, bx) - inset;
  const y0 = Math.min(ay, by) + inset;
  const y1 = Math.max(ay, by) - inset;
  const radius = pad.shape === 'stadium' ? Math.min(x1 - x0, y1 - y0) / 2 : Math.max(0, pad.radius - inset);
  return roundRect(x0, y0, x1, y1, radius, 12);
}

// ---------------------------------------------------------------------------
// The edge cross-section
// ---------------------------------------------------------------------------

/**
 * The edge as a smooth curve from the front flat round to the back flat,
 * through every measured point, with normals.
 */
export function edgeCurve(edge: EdgePoint[], perSegment = 6): EdgeSample[] {
  // Work in (outward, z): outward = -inset. The front flat heads outward and
  // the back flat comes back in, both level.
  const pts: Point2[] = edge.map(([inset, z]) => [-inset, z]);
  const curve = throughPoints(pts, [1, 0], [-1, 0], perSegment);
  return curve.map(([u, z], i) => {
    const [pu, pz] = curve[Math.max(0, i - 1)];
    const [qu, qz] = curve[Math.min(curve.length - 1, i + 1)];
    let tu = qu - pu;
    let tz = qz - pz;
    // At the two ends the flats continue straight on.
    if (i === 0) [tu, tz] = [1, 0];
    if (i === curve.length - 1) [tu, tz] = [-1, 0];
    const len = Math.hypot(tu, tz) || 1;
    tu /= len;
    tz /= len;
    return { inset: -u, z, out: -tz, nz: tu };
  });
}

/** Where along the edge curve the inset first falls to `inset` (front side) or last rises past it (back side). */
export function edgeSplit(curve: EdgeSample[], inset: number, side: 'front' | 'back'): number {
  if (side === 'front') {
    for (let i = 0; i < curve.length; i++) if (curve[i].inset <= inset) return i;
    return curve.length - 1;
  }
  for (let i = curve.length - 1; i >= 0; i--) if (curve[i].inset <= inset) return i;
  return 0;
}

/** The z of the front and back faces. */
export function faceDepths(model: PhoneModel): { front: number; back: number } {
  return { front: model.edge[0][1], back: model.edge[model.edge.length - 1][1] };
}

// ---------------------------------------------------------------------------
// Camera hardware heights
// ---------------------------------------------------------------------------

/** How far the surface under a back-view point stands off the back: on a pad's top, or 0. */
export function surfaceHeightAt(model: PhoneModel, x: number, y: number): number {
  let height = 0;
  for (const pad of model.pads) {
    if (pad.shape === 'plateau') {
      if (y <= pad.deckBottom) height = Math.max(height, pad.height);
      continue;
    }
    if (pad.shape === 'loft') {
      const t = pad.top;
      if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) height = Math.max(height, pad.height);
      continue;
    }
    const inside = x >= pad.x0 + pad.round && x <= pad.x1 - pad.round && y >= pad.y0 + pad.round && y <= pad.y1 - pad.round;
    if (inside) height = Math.max(height, pad.height);
  }
  return height;
}

// ---------------------------------------------------------------------------
// Hull, for fitting the box
// ---------------------------------------------------------------------------

/** Points on the outside of the phone, in mm, dense enough that its silhouette through them is right to a fraction of a pixel. */
export function hullPoints(model: PhoneModel): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  const outline = phoneOutline(model);
  const step = Math.max(1, Math.floor(outline.length / 64));
  const ring = (inset: number, z: number) => {
    for (let i = 0; i < outline.length; i += step) {
      const p = outline[i];
      points.push([p.x - p.nx * inset, p.y - p.ny * inset, z]);
    }
  };
  for (const [inset, z] of model.edge) ring(inset, z);
  const { back } = faceDepths(model);
  for (const pad of model.pads) {
    const top = back - pad.height;
    if (pad.shape === 'plateau') {
      // Its wall is concave, so the flat top's edge is all of it that can
      // reach the silhouette.
      for (const p of plateauDeck(model, pad)) points.push([p.x, p.y, top]);
    } else if (pad.shape === 'loft') {
      for (const p of loftTop(model, pad)) points.push([p.x, p.y, top]);
    } else {
      const foot = islandFootprint(model, pad);
      for (let i = 0; i < foot.length; i += 2) points.push([foot[i].x, foot[i].y, top]);
    }
  }
  for (const lens of model.lenses) {
    const [cx, cy] = fromBackView(model, lens.x, lens.y);
    // The ring's top, which a proud ring lifts above the glass.
    const top = model.lensTop + Math.max(0, -(lens.ringDrop ?? 0));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      points.push([cx + (lens.ring / 2) * Math.cos(a), cy + (lens.ring / 2) * Math.sin(a), back - top]);
    }
  }
  for (const button of model.buttons) {
    const x = (button.side === 'left' ? -1 : 1) * (model.width / 2 + button.proud);
    const y = model.height / 2 - button.center;
    const z = button.z === undefined ? 0 : model.thickness / 2 - button.z;
    for (const dy of [-button.length / 2, button.length / 2]) {
      for (const dz of [-button.width / 2, button.width / 2]) points.push([x, y + dy, z + dz]);
    }
  }
  return points;
}
