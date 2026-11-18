// The maths behind exporting a perspective element in a browser that cannot
// paint one into a capture (see perspectiveCapture.ts for why WebKit cannot).
//
// A matrix here is a CSS 4x4 in matrix3d() order: column-major, so m[c * 4 + r]
// is row r, column c, and a point is a column vector (x, y, z, w). Everything
// is pure so the node unit tests cover it.

export type Matrix4 = number[];

export const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A computed `transform` value as a matrix, null for `none` or anything unreadable. */
export function parseCssTransform(value: string | null | undefined): Matrix4 | null {
  if (!value) return null;
  const match = /^\s*(matrix3d|matrix)\(([^)]*)\)\s*$/.exec(value);
  if (!match) return null;
  const numbers = match[2].split(',').map((part) => Number(part.trim()));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  if (match[1] === 'matrix3d') return numbers.length === 16 ? numbers : null;
  if (numbers.length !== 6) return null;
  const [a, b, c, d, e, f] = numbers;
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

export function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

export function translation(x: number, y: number, z = 0): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** CSS perspective(d): a point's w falls by z / d. */
export function perspectiveMatrix(distance: number): Matrix4 {
  const m = IDENTITY.slice();
  m[11] = -1 / distance;
  return m;
}

/** `transform` applied about `transform-origin`, as CSS does. */
export function aboutOrigin(m: Matrix4, ox: number, oy: number, oz = 0): Matrix4 {
  return multiply(multiply(translation(ox, oy, oz), m), translation(-ox, -oy, -oz));
}

export interface ParentPerspective {
  /** The parent's computed `perspective`, in px. */
  distance: number;
  /** The parent's perspective-origin, in the parent's px. */
  originX: number;
  originY: number;
  /** Where the element's border box sits in the parent's border box. */
  offsetX: number;
  offsetY: number;
}

/**
 * Where an element's own pixels land, in its own untransformed coordinates:
 * its transform about its origin, then the parent's `perspective` if it has
 * one. The parent's perspective is what turns an image's rotateY() into a
 * foreshortened picture, so leaving it out would warp those flat.
 */
export function elementPlaneTransform(
  transform: Matrix4,
  origin: { x: number; y: number; z?: number },
  parent?: ParentPerspective | null
): Matrix4 {
  const own = aboutOrigin(transform, origin.x, origin.y, origin.z || 0);
  if (!parent || !(parent.distance > 0)) return own;
  // The parent's perspective origin, moved into the element's coordinates.
  const px = parent.originX - parent.offsetX;
  const py = parent.originY - parent.offsetY;
  return multiply(aboutOrigin(perspectiveMatrix(parent.distance), px, py), own);
}

/** A point of the element's z = 0 plane through m, before the divide. */
export function projectPlanePoint(m: Matrix4, x: number, y: number): { x: number; y: number; w: number } {
  return {
    x: m[0] * x + m[4] * y + m[12],
    y: m[1] * x + m[5] * y + m[13],
    w: m[3] * x + m[7] * y + m[15],
  };
}

/**
 * True when m bends the element's plane, which is the one case a renderer that
 * drops the perspective row gets wrong. A 3D rotation with no perspective still
 * maps the plane by an affine transform, and that much every engine paints.
 */
export function bendsPlane(m: Matrix4, epsilon = 1e-9): boolean {
  return Math.abs(m[3]) > epsilon || Math.abs(m[7]) > epsilon || Math.abs(m[15] - 1) > epsilon;
}

export interface WarpQuad {
  /** The rectangle's corners top-left, top-right, bottom-right, bottom-left, each with its w. */
  corners: { x: number; y: number; w: number }[];
  /** The bounding box of the divided corners, in the element's coordinates. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the rectangle (x, y, width, height) of the element's plane lands. Null
 * when any corner reaches the viewer's plane or passes behind it (w <= 0):
 * there is no finite picture to draw then, and the caller leaves the element
 * as it is rather than export something wrong.
 */
export function warpQuad(m: Matrix4, x: number, y: number, width: number, height: number): WarpQuad | null {
  const points = [
    projectPlanePoint(m, x, y),
    projectPlanePoint(m, x + width, y),
    projectPlanePoint(m, x + width, y + height),
    projectPlanePoint(m, x, y + height),
  ];
  if (points.some((p) => !(p.w > 1e-6))) return null;
  const xs = points.map((p) => p.x / p.w);
  const ys = points.map((p) => p.y / p.w);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { corners: points, left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** How much a 2D-or-3D transform scales the plane, for choosing raster sizes. */
export function planeScale(m: Matrix4): number {
  return Math.sqrt(Math.abs(m[0] * m[5] - m[1] * m[4])) || 1;
}
