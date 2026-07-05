/**
 * Library of complex vector elements for the Elements palette.
 *
 * Every element is a `custom-svg` shape: a path (or set of subpaths) defined in a
 * 100x100 viewBox. Paths are generated deterministically at module load so server
 * and client renders always match. Multi-part artwork (wreaths, patterns, clusters)
 * is grouped into a single path string with multiple subpaths, so it behaves as one
 * element on the canvas.
 */

export interface LibraryElementStyleProps {
  name: string;
  customPath: string;
  specialProps?: {
    viewBox?: string;
    strokeOnly?: boolean;
    baseStrokeWidth?: number;
    fillRule?: 'evenodd' | 'nonzero';
  };
  defaultSize?: { width: number; height: number };
  [key: string]: any;
}

export interface LibraryElementDef {
  id: string;
  label: string;
  styleProps: LibraryElementStyleProps;
}

export interface ElementCategory {
  id: string;
  label: string;
  items: LibraryElementDef[];
}

/* ------------------------------ path helpers ------------------------------ */

const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

type Pt = [number, number];

const polar = (cx: number, cy: number, r: number, angleDeg: number): Pt => {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

const polarPts = (
  count: number,
  cx: number,
  cy: number,
  radius: (i: number) => number,
  startDeg = -90
): Pt[] => {
  const pts: Pt[] = [];
  const step = 360 / count;
  for (let i = 0; i < count; i++) {
    pts.push(polar(cx, cy, radius(i), startDeg + i * step));
  }
  return pts;
};

const polyPath = (pts: Pt[]): string =>
  'M' + pts.map(p => `${fmt(p[0])} ${fmt(p[1])}`).join(' L') + ' Z';

const polygonSub = (cx: number, cy: number, sides: number, r: number, rot = -90): string =>
  polyPath(polarPts(sides, cx, cy, () => r, rot));

const starSub = (cx: number, cy: number, points: number, outer: number, innerRatio: number, rot = -90): string =>
  polyPath(polarPts(points * 2, cx, cy, i => (i % 2 === 0 ? outer : outer * innerRatio), rot));

/** Four-point (or n-point) sparkle with concave sides. */
const sparkleSub = (cx: number, cy: number, tips: number, r: number, waist = 0.16, rot = -90): string => {
  const tipPts = polarPts(tips, cx, cy, () => r, rot);
  const ctrls = polarPts(tips, cx, cy, () => r * waist, rot + 180 / tips);
  let d = `M${fmt(tipPts[0][0])} ${fmt(tipPts[0][1])}`;
  for (let i = 0; i < tips; i++) {
    const c = ctrls[i];
    const nxt = tipPts[(i + 1) % tips];
    d += ` Q${fmt(c[0])} ${fmt(c[1])} ${fmt(nxt[0])} ${fmt(nxt[1])}`;
  }
  return d + ' Z';
};

/** Four-point sparkle stretched onto an ellipse (tall/wide sparkles). */
const sparkleStretchSub = (cx: number, cy: number, rx: number, ry: number, waist = 0.16): string => {
  const tips: Pt[] = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
  const ctrls: Pt[] = [
    [cx + rx * waist, cy - ry * waist],
    [cx + rx * waist, cy + ry * waist],
    [cx - rx * waist, cy + ry * waist],
    [cx - rx * waist, cy - ry * waist],
  ];
  let d = `M${fmt(tips[0][0])} ${fmt(tips[0][1])}`;
  for (let i = 0; i < 4; i++) {
    const c = ctrls[i];
    const nxt = tips[(i + 1) % 4];
    d += ` Q${fmt(c[0])} ${fmt(c[1])} ${fmt(nxt[0])} ${fmt(nxt[1])}`;
  }
  return d + ' Z';
};

const circleSub = (cx: number, cy: number, r: number): string =>
  `M${fmt(cx - r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)} Z`;

const rectSub = (x: number, y: number, w: number, h: number): string =>
  `M${fmt(x)} ${fmt(y)} H${fmt(x + w)} V${fmt(y + h)} H${fmt(x)} Z`;

const roundedRectSub = (x: number, y: number, w: number, h: number, r: number): string =>
  `M${fmt(x + r)} ${fmt(y)} H${fmt(x + w - r)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w)} ${fmt(y + r)} ` +
  `V${fmt(y + h - r)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w - r)} ${fmt(y + h)} H${fmt(x + r)} ` +
  `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y + h - r)} V${fmt(y + r)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(y)} Z`;

/** Closed Catmull-Rom spline through the points, as cubic beziers (organic blobs). */
const smoothClosedSub = (pts: Pt[]): string => {
  const n = pts.length;
  let d = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d + ' Z';
};

const blobSub = (radii: number[], rot = -90): string =>
  smoothClosedSub(polarPts(radii.length, 50, 50, i => radii[i % radii.length], rot));

const scallopSquareSub = (bumps: number, inset: number): string => {
  const len = 100 - 2 * inset;
  const seg = len / bumps;
  const r = seg / 2;
  const arc = (x: number, y: number) => ` A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y)}`;
  let d = `M${fmt(inset)} ${fmt(inset)}`;
  for (let i = 1; i <= bumps; i++) d += arc(inset + i * seg, inset);
  for (let i = 1; i <= bumps; i++) d += arc(100 - inset, inset + i * seg);
  for (let i = 1; i <= bumps; i++) d += arc(100 - inset - i * seg, 100 - inset);
  for (let i = 1; i <= bumps; i++) d += arc(inset, 100 - inset - i * seg);
  return d + ' Z';
};

const gearSub = (teeth: number, outer: number, inner: number, hole: number): string => {
  const step = 360 / teeth;
  const pts: Pt[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = -90 + i * step;
    pts.push(polar(50, 50, outer, a));
    pts.push(polar(50, 50, outer, a + step * 0.38));
    pts.push(polar(50, 50, inner, a + step * 0.5));
    pts.push(polar(50, 50, inner, a + step * 0.88));
  }
  return polyPath(pts) + ' ' + circleSub(50, 50, hole);
};

const flowerSub = (petals: number, tipR: number, valleyR: number, rot = -90): string => {
  const valleys = polarPts(petals, 50, 50, () => valleyR, rot);
  const step = 360 / petals;
  const ctrlR = tipR * 1.25;
  let d = `M${fmt(valleys[0][0])} ${fmt(valleys[0][1])}`;
  for (let i = 0; i < petals; i++) {
    const tipA = rot + i * step + step / 2;
    const spread = step * 0.4;
    const c1 = polar(50, 50, ctrlR, tipA - spread);
    const c2 = polar(50, 50, ctrlR, tipA + spread);
    const nxt = valleys[(i + 1) % petals];
    d += ` C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(nxt[0])} ${fmt(nxt[1])}`;
  }
  return d + ' Z';
};

/** Polygon with rounded corners (soft diamond, play button, ...). */
const roundedPolySub = (pts: Pt[], r: number): string => {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const inV: Pt = [cur[0] - prev[0], cur[1] - prev[1]];
    const outV: Pt = [next[0] - cur[0], next[1] - cur[1]];
    const inLen = Math.hypot(inV[0], inV[1]) || 1;
    const outLen = Math.hypot(outV[0], outV[1]) || 1;
    const rIn = Math.min(r, inLen / 2);
    const rOut = Math.min(r, outLen / 2);
    const p1: Pt = [cur[0] - (inV[0] / inLen) * rIn, cur[1] - (inV[1] / inLen) * rIn];
    const p2: Pt = [cur[0] + (outV[0] / outLen) * rOut, cur[1] + (outV[1] / outLen) * rOut];
    d += i === 0 ? `M${fmt(p1[0])} ${fmt(p1[1])}` : ` L${fmt(p1[0])} ${fmt(p1[1])}`;
    d += ` Q${fmt(cur[0])} ${fmt(cur[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d + ' Z';
};

/** Star with points laid on an ellipse (zigzag-edged oval). */
const ellipseStarSub = (points: number, cx: number, cy: number, rx: number, ry: number, innerRatio: number): string => {
  const pts: Pt[] = [];
  const step = 360 / (points * 2);
  for (let i = 0; i < points * 2; i++) {
    const a = ((-90 + i * step) * Math.PI) / 180;
    const k = i % 2 === 0 ? 1 : innerRatio;
    pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
  }
  return polyPath(pts);
};

/** Circle whose edge is a ring of outward semicircular bumps (scalloped circle). */
const scallopCircleSub = (bumps: number, R: number): string => {
  const pts = polarPts(bumps, 50, 50, () => R);
  const r = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) / 2;
  let d = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 1; i <= bumps; i++) {
    const p = pts[i % bumps];
    d += ` A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(p[0])} ${fmt(p[1])}`;
  }
  return d + ' Z';
};

/** Crescent opening to the right ("C"); backR > r controls the bite depth. */
const crescentSub = (cx: number, cy: number, r: number, backR: number): string =>
  `M${fmt(cx)} ${fmt(cy - r)} A${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(cx)} ${fmt(cy + r)} ` +
  `A${fmt(backR)} ${fmt(backR)} 0 0 1 ${fmt(cx)} ${fmt(cy - r)} Z`;

/** Comic "pow" burst: jagged explosion with concave curved sides and uneven tips. */
const powSub = (): string => {
  const outer = [47, 39, 46, 37, 44, 40, 47, 38, 45, 41];
  const tips = outer.length;
  const step = 360 / tips;
  const tipPts: Pt[] = outer.map((r, i) => polar(50, 50, r, -90 + i * step));
  const ctrls: Pt[] = outer.map((r, i) => polar(50, 50, r * 0.5, -90 + (i + 0.5) * step));
  let d = `M${fmt(tipPts[0][0])} ${fmt(tipPts[0][1])}`;
  for (let i = 0; i < tips; i++) {
    const c = ctrls[i];
    const nxt = tipPts[(i + 1) % tips];
    d += ` Q${fmt(c[0])} ${fmt(c[1])} ${fmt(nxt[0])} ${fmt(nxt[1])}`;
  }
  return d + ' Z';
};

/* ------------------------------ waves & lines ------------------------------ */

const sineStrokeSub = (cycles: number, amp: number, y: number): string => {
  const half = cycles * 2;
  const seg = 100 / half;
  let d = `M0 ${fmt(y)}`;
  for (let i = 0; i < half; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` Q${fmt(i * seg + seg / 2)} ${fmt(y + dir * amp * 2)} ${fmt((i + 1) * seg)} ${fmt(y)}`;
  }
  return d;
};

const waveBlockSub = (cycles: number, amp: number, y: number, invert = false): string => {
  const half = cycles * 2;
  const seg = 100 / half;
  let d = `M0 ${fmt(y)}`;
  for (let i = 0; i < half; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` Q${fmt(i * seg + seg / 2)} ${fmt(y + dir * amp * 2)} ${fmt((i + 1) * seg)} ${fmt(y)}`;
  }
  return d + (invert ? ' V0 H0 Z' : ' V100 H0 Z');
};

const waveRibbonSub = (cycles: number, amp: number, yTop: number, thickness: number): string => {
  const half = cycles * 2;
  const seg = 100 / half;
  let d = `M0 ${fmt(yTop)}`;
  for (let i = 0; i < half; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` Q${fmt(i * seg + seg / 2)} ${fmt(yTop + dir * amp * 2)} ${fmt((i + 1) * seg)} ${fmt(yTop)}`;
  }
  const yBot = yTop + thickness;
  d += ` L100 ${fmt(yBot)}`;
  for (let i = half - 1; i >= 0; i--) {
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` Q${fmt(i * seg + seg / 2)} ${fmt(yBot + dir * amp * 2)} ${fmt(i * seg)} ${fmt(yBot)}`;
  }
  return d + ' Z';
};

const zigzagStrokeSub = (cycles: number, amp: number, y: number): string => {
  const half = cycles * 2;
  const seg = 100 / half;
  let d = `M0 ${fmt(y + amp)}`;
  for (let i = 1; i <= half; i++) {
    d += ` L${fmt(i * seg)} ${fmt(i % 2 === 1 ? y - amp : y + amp)}`;
  }
  return d;
};

const zigzagPts = (cycles: number, amp: number, y: number): Pt[] => {
  const half = cycles * 2;
  const seg = 100 / half;
  const pts: Pt[] = [[0, y + amp]];
  for (let i = 1; i <= half; i++) {
    pts.push([i * seg, i % 2 === 1 ? y - amp : y + amp]);
  }
  return pts;
};

const zigzagRibbonSub = (cycles: number, amp: number, yTop: number, thickness: number): string => {
  const top = zigzagPts(cycles, amp, yTop);
  const bottom = zigzagPts(cycles, amp, yTop + thickness).reverse();
  return polyPath([...top, ...bottom]);
};

/** Open Catmull-Rom spline segments (C commands only, no leading M). */
const splineSegs = (pts: Pt[]): string => {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
};

/** Open smooth stroke through points (hand-drawn squiggles). */
const smoothOpenSub = (pts: Pt[]): string => `M${fmt(pts[0][0])} ${fmt(pts[0][1])}` + splineSegs(pts);

/** Filled band: smooth top edge (left→right) closed by a smooth bottom edge (given left→right). */
const bandSub = (top: Pt[], bottom: Pt[]): string => {
  const rev = [...bottom].reverse();
  return smoothOpenSub(top) + ` L${fmt(rev[0][0])} ${fmt(rev[0][1])}` + splineSegs(rev) + ' Z';
};

/** Filled strip: smooth top edge running x=0→100, closed by a straight baseline. */
const stripSub = (top: Pt[], baseY: number): string =>
  smoothOpenSub(top) + ` L100 ${fmt(baseY)} L0 ${fmt(baseY)} Z`;

/** Sample an open Catmull-Rom spline through pts (`per` samples per segment). */
const sampleSpline = (pts: Pt[], per = 10): Pt[] => {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[n - 1]);
  return out;
};

/** Filled brush stroke along a spline; halfWidth(t) varies thickness for calligraphic tapers. */
const brushStrokeSub = (pts: Pt[], halfWidth: (t: number) => number): string => {
  const line = sampleSpline(pts);
  const n = line.length;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const hw = halfWidth(i / (n - 1));
    left.push([line[i][0] - (dy / len) * hw, line[i][1] + (dx / len) * hw]);
    right.push([line[i][0] + (dy / len) * hw, line[i][1] - (dx / len) * hw]);
  }
  right.reverse();
  const cap = (r: number, to: Pt): string =>
    r > 0.7 ? ` A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(to[0])} ${fmt(to[1])}` : ` L${fmt(to[0])} ${fmt(to[1])}`;
  let d = `M${fmt(left[0][0])} ${fmt(left[0][1])}`;
  for (let i = 1; i < n; i++) d += ` L${fmt(left[i][0])} ${fmt(left[i][1])}`;
  d += cap(halfWidth(1), right[0]);
  for (let i = 1; i < n; i++) d += ` L${fmt(right[i][0])} ${fmt(right[i][1])}`;
  d += cap(halfWidth(0), left[0]);
  return d + ' Z';
};

const dashedLineSub = (y: number, dash: number, gap: number): string => {
  let d = '';
  for (let x = 2; x < 98; x += dash + gap) {
    d += ` M${fmt(x)} ${fmt(y)} H${fmt(Math.min(x + dash, 98))}`;
  }
  return d.trim();
};

const dottedLineSub = (y: number, r: number, step: number, x0 = 6, x1 = 94): string => {
  let d = '';
  for (let x = x0; x <= x1; x += step) d += circleSub(x, y, r);
  return d;
};

/** Dash-dot-dash divider (round linecaps render the h0.01 stubs as dots). */
const dashDotLineSub = (y: number): string => {
  let d = '';
  for (let x = 4; x <= 64; x += 20) {
    d += ` M${fmt(x)} ${fmt(y)} H${fmt(x + 11)} M${fmt(x + 15.5)} ${fmt(y)} h0.01`;
  }
  return (d + ` M85 ${fmt(y)} H96`).trim();
};

/** Cursive loop-the-loop flourish: prolate cycloid sampled as a dense polyline,
 *  extended half a turn each side so the stroke leads in and out along arch bottoms. */
const curlLineSub = (loops: number, y: number, rx: number, ry: number, x0 = 6, x1 = 94): string => {
  const T = loops * 2 * Math.PI;
  const drift = (x1 - x0 - 2 * rx) / T;
  const steps = (loops + 1) * 28;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI + (i / steps) * (T + 2 * Math.PI);
    d += (i === 0 ? 'M' : ' L') + `${fmt(x0 + rx + drift * t - rx * Math.sin(t))} ${fmt(y - ry * Math.cos(t))}`;
  }
  return d;
};

/* ------------------------------ laurel wreaths ------------------------------ */

const leafSub = (bx: number, by: number, tx: number, ty: number, w: number): string => {
  const mx = (bx + tx) / 2;
  const my = (by + ty) / 2;
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * w;
  const py = (dx / len) * w;
  return (
    `M${fmt(bx)} ${fmt(by)} Q${fmt(mx + px)} ${fmt(my + py)} ${fmt(tx)} ${fmt(ty)} ` +
    `Q${fmt(mx - px)} ${fmt(my - py)} ${fmt(bx)} ${fmt(by)} Z`
  );
};

const arcBandSub = (cx: number, cy: number, r: number, startA: number, endA: number, w: number, steps = 22): string => {
  const outPts: Pt[] = [];
  const inPts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = startA + ((endA - startA) * i) / steps;
    outPts.push(polar(cx, cy, r + w / 2, a));
    inPts.push(polar(cx, cy, r - w / 2, a));
  }
  inPts.reverse();
  return polyPath([...outPts, ...inPts]);
};

/** A laurel branch: stem along an arc with leaves splayed to both sides. */
const laurelBranchSub = (
  cx: number,
  cy: number,
  r: number,
  startA: number,
  endA: number,
  leaves: number,
  leafLen: number,
  leafW: number
): string => {
  let d = arcBandSub(cx, cy, r, startA, endA, 1.8);
  const sweep = Math.sign(endA - startA) || 1;
  for (let i = 0; i < leaves; i++) {
    const t = (i + 0.55) / (leaves + 0.55);
    const a = startA + (endA - startA) * t;
    const base = polar(cx, cy, r, a);
    const side = i % 2 === 0 ? 1 : -1;
    const dir = a + 90 * sweep + side * 42;
    const len = leafLen * (1 - 0.35 * t); // leaves taper toward the branch tip
    const tip = polar(base[0], base[1], len, dir);
    d += ' ' + leafSub(base[0], base[1], tip[0], tip[1], leafW * (1 - 0.25 * t));
  }
  return d;
};

/* ------------------------------ patterns ------------------------------ */

const dotGridSub = (cols: number, rows: number, r: number, inset = 10): string => {
  const sx = (100 - 2 * inset) / (cols - 1);
  const sy = (100 - 2 * inset) / (rows - 1);
  let d = '';
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) d += circleSub(inset + ci * sx, inset + ri * sy, r);
  }
  return d;
};

const gridLinesSub = (cells: number, t: number): string => {
  const step = 100 / cells;
  let d = '';
  for (let i = 0; i <= cells; i++) {
    const p = Math.min(Math.max(i * step - t / 2, 0), 100 - t);
    d += rectSub(p, 0, t, 100) + rectSub(0, p, 100, t);
  }
  return d;
};

const diagLinesSub = (step: number): string => {
  let d = '';
  for (let s = step; s < 200; s += step) {
    d += s <= 100
      ? ` M${fmt(s)} 0 L0 ${fmt(s)}`
      : ` M100 ${fmt(s - 100)} L${fmt(s - 100)} 100`;
  }
  return d.trim();
};

const antiDiagLinesSub = (step: number): string => {
  let d = '';
  for (let s = step; s < 200; s += step) {
    d += s <= 100
      ? ` M${fmt(100 - s)} 0 L100 ${fmt(s)}`
      : ` M0 ${fmt(s - 100)} L${fmt(200 - s)} 100`;
  }
  return d.trim();
};

const verticalLinesSub = (count: number): string => {
  const step = 100 / (count + 1);
  let d = '';
  for (let i = 1; i <= count; i++) d += ` M${fmt(i * step)} 4 V96`;
  return d.trim();
};

const checkerSub = (cells: number): string => {
  const s = 100 / cells;
  let d = '';
  for (let ri = 0; ri < cells; ri++) {
    for (let ci = 0; ci < cells; ci++) {
      if ((ri + ci) % 2 === 0) d += rectSub(ci * s, ri * s, s, s);
    }
  }
  return d;
};

const plusSub = (cx: number, cy: number, s: number): string => {
  const a = s / 3;
  return (
    `M${fmt(cx - a / 2)} ${fmt(cy - a * 1.5)} h${fmt(a)} v${fmt(a)} h${fmt(a)} v${fmt(a)} h${fmt(-a)} v${fmt(a)} ` +
    `h${fmt(-a)} v${fmt(-a)} h${fmt(-a)} v${fmt(-a)} h${fmt(a)} Z`
  );
};

const plusGridSub = (): string => {
  let d = '';
  for (const cx of [20, 50, 80]) for (const cy of [20, 50, 80]) d += plusSub(cx, cy, 15);
  return d;
};

const xMarksSub = (): string => {
  let d = '';
  const step = 100 / 4;
  for (let ri = 0; ri < 4; ri++) {
    for (let ci = 0; ci < 4; ci++) {
      const cx = step / 2 + ci * step;
      const cy = step / 2 + ri * step;
      d += ` M${fmt(cx - 5)} ${fmt(cy - 5)} L${fmt(cx + 5)} ${fmt(cy + 5)} M${fmt(cx + 5)} ${fmt(cy - 5)} L${fmt(cx - 5)} ${fmt(cy + 5)}`;
    }
  }
  return d.trim();
};

const scalesSub = (rows: number, cols: number): string => {
  const w = 100 / cols;
  const r = w / 2;
  const h = 100 / rows;
  let d = '';
  for (let ri = 0; ri <= rows; ri++) {
    const y = ri * h;
    const offset = ri % 2 === 0 ? 0 : -r;
    for (let x = offset; x < 100; x += w) {
      d += ` M${fmt(x)} ${fmt(y)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w)} ${fmt(y)}`;
    }
  }
  return d.trim();
};

const sprinkleSub = (cx: number, cy: number, angleDeg: number, len: number, w: number): string => {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  const hl = len / 2;
  const hw = w / 2;
  return polyPath([
    [cx - dx * hl + px * hw, cy - dy * hl + py * hw],
    [cx + dx * hl + px * hw, cy + dy * hl + py * hw],
    [cx + dx * hl - px * hw, cy + dy * hl - py * hw],
    [cx - dx * hl - px * hw, cy - dy * hl - py * hw],
  ]);
};

const memphisSprinklesSub = (): string => {
  const bars: Array<[number, number, number]> = [
    [14, 16, 30], [46, 10, -20], [80, 18, 65], [22, 46, -55], [58, 40, 15],
    [88, 48, -35], [12, 78, 70], [42, 72, -10], [70, 82, 40], [90, 76, -60],
  ];
  let d = '';
  for (const [cx, cy, ang] of bars) d += sprinkleSub(cx, cy, ang, 16, 5);
  for (const [cx, cy] of [[32, 26], [66, 60], [50, 90], [86, 30], [10, 60]] as Pt[]) {
    d += circleSub(cx, cy, 3.2);
  }
  return d;
};

const triangleTileSub = (): string => {
  const step = 25;
  let d = '';
  for (let ri = 0; ri < 4; ri++) {
    for (let ci = 0; ci < 4; ci++) {
      const x = ci * step;
      const y = ri * step;
      const up = (ri + ci) % 2 === 0;
      d += up
        ? polyPath([[x + step / 2, y + 4], [x + step - 4, y + step - 4], [x + 4, y + step - 4]])
        : polyPath([[x + 4, y + 4], [x + step - 4, y + 4], [x + step / 2, y + step - 4]]);
    }
  }
  return d;
};

/* ------------------------------ pattern extras ------------------------------ */

/** Deterministic pseudo-random in [0,1) from an integer key (keeps SSR renders stable). */
const prand = (n: number): number => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/** Chunky open lattice: rounded-end bars inset from the tile edges. */
const boldGridSub = (lines: number, t: number): string => {
  const step = 100 / (lines + 1);
  let d = '';
  for (let i = 1; i <= lines; i++) {
    const p = i * step - t / 2;
    d += roundedRectSub(p, 4, t, 92, t / 2) + roundedRectSub(4, p, 92, t, t / 2);
  }
  return d;
};

/** Grid drawn with short dashes (stitched graph paper). */
const dashedGridSub = (cells: number, dash: number, gap: number): string => {
  const step = 92 / cells;
  let d = '';
  for (let i = 0; i <= cells; i++) {
    const p = 4 + i * step;
    for (let q = 4; q < 96; q += dash + gap) {
      const e = Math.min(q + dash, 96);
      d += ` M${fmt(q)} ${fmt(p)} H${fmt(e)} M${fmt(p)} ${fmt(q)} V${fmt(e)}`;
    }
  }
  return d.trim();
};

/** Filled quarter ring centered on a tile corner, sweeping a0..a0+90 (truchet maze). */
const quarterRingSub = (cx: number, cy: number, rMid: number, w: number, a0: number): string => {
  const ro = rMid + w / 2;
  const ri = rMid - w / 2;
  const o0 = polar(cx, cy, ro, a0);
  const o1 = polar(cx, cy, ro, a0 + 90);
  const i1 = polar(cx, cy, ri, a0 + 90);
  const i0 = polar(cx, cy, ri, a0);
  return (
    `M${fmt(o0[0])} ${fmt(o0[1])} A${fmt(ro)} ${fmt(ro)} 0 0 1 ${fmt(o1[0])} ${fmt(o1[1])} ` +
    `L${fmt(i1[0])} ${fmt(i1[1])} A${fmt(ri)} ${fmt(ri)} 0 0 0 ${fmt(i0[0])} ${fmt(i0[1])} Z`
  );
};

/** Deterministic truchet coin flip for cell (ri, ci). */
const truchetFlip = (ri: number, ci: number): boolean => prand(ri * 97 + ci * 13 + 7) < 0.5;

/** Bold rounded maze: filled quarter-ring truchet tiles. */
const truchetSub = (cells: number, w: number): string => {
  const s = 100 / cells;
  let d = '';
  for (let ri = 0; ri < cells; ri++) {
    for (let ci = 0; ci < cells; ci++) {
      const x = ci * s;
      const y = ri * s;
      d += truchetFlip(ri, ci)
        ? quarterRingSub(x, y, s / 2, w, 0) + quarterRingSub(x + s, y + s, s / 2, w, 180)
        : quarterRingSub(x + s, y, s / 2, w, 90) + quarterRingSub(x, y + s, s / 2, w, 270);
    }
  }
  return d;
};

/** Thin truchet: stroked quarter-circle arcs on a grid (circuit loops). */
const truchetArcsSub = (cells: number): string => {
  const s = 100 / cells;
  const arc = (cx: number, cy: number, a0: number): string => {
    const p1 = polar(cx, cy, s / 2, a0);
    const p2 = polar(cx, cy, s / 2, a0 + 90);
    return ` M${fmt(p1[0])} ${fmt(p1[1])} A${fmt(s / 2)} ${fmt(s / 2)} 0 0 1 ${fmt(p2[0])} ${fmt(p2[1])}`;
  };
  let d = '';
  for (let ri = 0; ri < cells; ri++) {
    for (let ci = 0; ci < cells; ci++) {
      const x = ci * s;
      const y = ri * s;
      d += truchetFlip(ri + 3, ci + 5)
        ? arc(x, y, 0) + arc(x + s, y + s, 180)
        : arc(x + s, y, 90) + arc(x, y + s, 270);
    }
  }
  return d.trim();
};

/** Thick wavy stripes running diagonally up the tile (filled brush strokes). */
const waveDiagSub = (count: number, amp: number, wavelength: number, hw: number): string => {
  const sig = Math.SQRT1_2;
  let d = '';
  for (let k = 0; k < count; k++) {
    const c = -46 + (92 * k) / (count - 1);
    const uLo = 5 + amp + hw + Math.abs(c);
    const uHi = 136.4 - amp - hw - Math.abs(c);
    if (uHi - uLo < 14) continue;
    const pts: Pt[] = [];
    for (let i = 0; i <= 14; i++) {
      const u = uLo + ((uHi - uLo) * i) / 14;
      const v = c + amp * Math.sin((u / wavelength) * Math.PI * 2 + k * 1.9);
      pts.push([sig * (u + v), 100 - sig * (u - v)]);
    }
    d += ' ' + brushStrokeSub(pts, () => hw);
  }
  return d.trim();
};

/** Loose overlapping scribble rows (etched texture). */
const scribbleSub = (rows: number, amp: number, seed: number): string => {
  let d = '';
  for (let r = 0; r < rows; r++) {
    const y = 9 + (82 * r) / (rows - 1);
    const pts: Pt[] = [];
    for (let i = 0; i < 9; i++) {
      const x = 5 + (90 * i) / 8 + (prand(seed + r * 31 + i * 7) - 0.5) * 6;
      pts.push([x, y + (prand(seed + r * 17 + i * 13) - 0.5) * 2 * amp]);
    }
    d += ' ' + smoothOpenSub(pts);
  }
  return d.trim();
};

/** Rows of tight jittery zigzag scratches. */
const scratchRowsSub = (rows: number): string => {
  let d = '';
  for (let r = 0; r < rows; r++) {
    const y = 11 + (78 * r) / (rows - 1);
    const x0 = 5 + prand(r * 5 + 1) * 9;
    const x1 = 95 - prand(r * 9 + 2) * 9;
    const amp = 2.4 + prand(r * 3 + 4) * 1.8;
    const segs = 11 + Math.floor(prand(r * 7 + 3) * 5);
    let p = `M${fmt(x0)} ${fmt(y + amp)}`;
    for (let i = 1; i <= segs; i++) {
      p += ` L${fmt(x0 + ((x1 - x0) * i) / segs)} ${fmt(i % 2 === 1 ? y - amp : y + amp)}`;
    }
    d += ' ' + p;
  }
  return d.trim();
};

/** Vertical strokes of varied lengths (rhythm bars). */
const barcodeSub = (count: number): string => {
  const step = 100 / (count + 1);
  let d = '';
  for (let i = 1; i <= count; i++) {
    const x = i * step;
    d += ` M${fmt(x)} ${fmt(5 + prand(i * 11 + 5) * 34)} V${fmt(95 - prand(i * 23 + 9) * 34)}`;
  }
  return d.trim();
};

/** Nested flowing contour lines (topographic / marbled texture). */
const contourSub = (linesN: number): string => {
  let d = '';
  for (let k = 0; k < linesN; k++) {
    const f = k / (linesN - 1);
    const y0 = 7 + 86 * f;
    const pts: Pt[] = [];
    for (let i = 0; i < 9; i++) {
      const g = i / 8;
      const y =
        y0 +
        Math.sin(g * Math.PI * 2 + f * 3.1) * 6.5 * Math.sin(Math.PI * f + 0.35) +
        Math.sin(g * Math.PI * 3.6 + 1.4 + f * 4.6) * 3;
      pts.push([2 + 96 * g, Math.min(97.5, Math.max(2.5, y))]);
    }
    d += ' ' + smoothOpenSub(pts);
  }
  return d.trim();
};

/** Irregular blob spot at any position (animal-print patterns). */
const spotSub = (cx: number, cy: number, r: number, wob: number[]): string =>
  smoothClosedSub(polarPts(wob.length, cx, cy, i => r * wob[i]));

/** Grid of small filled diamonds. */
const diamondGridSub = (cols: number, rows: number, rx: number, ry: number): string => {
  const sx = (100 - 16) / (cols - 1);
  const sy = (100 - 16) / (rows - 1);
  let d = '';
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const x = 8 + ci * sx;
      const y = 8 + ri * sy;
      d += polyPath([[x, y - ry], [x + rx, y], [x, y + ry], [x - rx, y]]);
    }
  }
  return d;
};

/** Vertical sine stroke (top to bottom) at a given x. */
const vSineStrokeSub = (cycles: number, amp: number, x: number): string => {
  const half = cycles * 2;
  const seg = 100 / half;
  let d = `M${fmt(x)} 0`;
  for (let i = 0; i < half; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` Q${fmt(x + dir * amp * 2)} ${fmt(i * seg + seg / 2)} ${fmt(x)} ${fmt((i + 1) * seg)}`;
  }
  return d;
};

/** Grid of six-ray asterisks. */
const asteriskGridSub = (cells: number, r: number): string => {
  const step = 100 / cells;
  let d = '';
  for (let ri = 0; ri < cells; ri++) {
    for (let ci = 0; ci < cells; ci++) {
      const cx = step / 2 + ci * step;
      const cy = step / 2 + ri * step;
      for (let a = 0; a < 3; a++) {
        const p1 = polar(cx, cy, r, -90 + a * 60);
        const p2 = polar(cx, cy, r, 90 + a * 60);
        d += ` M${fmt(p1[0])} ${fmt(p1[1])} L${fmt(p2[0])} ${fmt(p2[1])}`;
      }
    }
  }
  return d.trim();
};

/* ------------------------------ decor extras ------------------------------ */

/** Straight stroke dashes radiating from a center (burst / rising rays). */
const radialDashesSub = (
  cx: number,
  cy: number,
  count: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  sweepDeg: number
): string => {
  const full = Math.abs(sweepDeg) >= 360;
  const step = full ? sweepDeg / count : sweepDeg / (count - 1);
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = startDeg + i * step;
    const p1 = polar(cx, cy, rInner, a);
    const p2 = polar(cx, cy, rOuter, a);
    d += ` M${fmt(p1[0])} ${fmt(p1[1])} L${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d.trim();
};

/** Archimedean spiral as a polyline (10-degree steps render smooth at stroke width). */
const spiralSub = (cx: number, cy: number, turns: number, maxR: number): string => {
  const steps = Math.round(turns * 36);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = polar(cx, cy, maxR * t, -90 + t * turns * 360);
    d += (i === 0 ? 'M' : ' L') + `${fmt(p[0])} ${fmt(p[1])}`;
  }
  return d;
};

/** Circle drawn as evenly spaced arc dashes (orbit ring). */
const dashedCircleSub = (cx: number, cy: number, r: number, dashes: number, fill: number): string => {
  const step = 360 / dashes;
  let d = '';
  for (let i = 0; i < dashes; i++) {
    const p1 = polar(cx, cy, r, -90 + i * step);
    const p2 = polar(cx, cy, r, -90 + i * step + step * fill);
    d += ` M${fmt(p1[0])} ${fmt(p1[1])} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d.trim();
};

/** Ellipse outline rotated about its center (atom orbits). */
const rotatedEllipseSub = (cx: number, cy: number, rx: number, ry: number, rotDeg: number): string => {
  const p1 = polar(cx, cy, rx, rotDeg + 180);
  const p2 = polar(cx, cy, rx, rotDeg);
  return (
    `M${fmt(p1[0])} ${fmt(p1[1])} A${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} 1 0 ${fmt(p2[0])} ${fmt(p2[1])} ` +
    `A${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} 1 0 ${fmt(p1[0])} ${fmt(p1[1])} Z`
  );
};

/** Disc built from concentric rings of dots (halftone disc). */
const dotDiscSub = (): string => {
  let d = circleSub(50, 50, 4.6);
  const rings: Array<[number, number]> = [[13.5, 7], [25.5, 13], [37.5, 19]];
  for (const [r, n] of rings) {
    for (let i = 0; i < n; i++) {
      const p = polar(50, 50, r, -90 + (i * 360) / n);
      d += circleSub(p[0], p[1], 4.6);
    }
  }
  return d;
};

/** Curved blades swirling out of the center (pinwheel). */
const swirlSub = (blades: number, r: number): string => {
  const step = 360 / blades;
  let d = '';
  for (let i = 0; i < blades; i++) {
    const a = -90 + i * step;
    const tip = polar(50, 50, r, a);
    const c1 = polar(50, 50, r * 0.62, a - step * 0.55);
    const c2 = polar(50, 50, r * 0.48, a + step * 0.32);
    d += ` M50 50 Q${fmt(c1[0])} ${fmt(c1[1])} ${fmt(tip[0])} ${fmt(tip[1])} Q${fmt(c2[0])} ${fmt(c2[1])} 50 50 Z`;
  }
  return d.trim();
};

/** Vertically centered rounded bars of varying heights (sound wave). */
const soundBarsSub = (heights: number[]): string => {
  const w = 8;
  const gap = (100 - heights.length * w) / (heights.length + 1);
  let d = '';
  heights.forEach((h, i) => {
    d += roundedRectSub(gap + i * (w + gap), 50 - h / 2, w, h, w / 2);
  });
  return d;
};

const cloudSub = (): string =>
  'M16 74 A13 13 0 0 1 12 49 A17 17 0 0 1 41 33 A18 18 0 0 1 74 36 A14 14 0 0 1 89 58 A9 9 0 0 1 85 74 Z';

/** Diagonal stem with splayed leaves and berries at the tip. */
const berrySprigSub = (): string => {
  let d = sprinkleSub(49, 50, -42, 84, 2.6);
  const leaves: Array<[number, number, number, number, number]> = [
    [28, 70, 12, 60, 4.2], [35, 63, 46, 76, 4.2],
    [45, 54, 30, 43, 4], [52, 48, 63, 61, 4],
    [61, 40, 47, 29, 3.6], [68, 33, 78, 45, 3.4],
  ];
  for (const [bx, by, tx, ty, w] of leaves) d += leafSub(bx, by, tx, ty, w);
  return d + circleSub(80, 21, 3.4) + circleSub(87, 27, 2.8) + circleSub(86, 14, 2.6);
};

/* ------------------------------ item builder ------------------------------ */

interface ItemOpts {
  /** Render as stroked (not filled) artwork; value = default stroke width in px. */
  stroke?: number;
  /** Use even-odd fill rule (for frames, rings, cut-outs). */
  evenodd?: boolean;
  /** Default size on the canvas (defaults to 300x300). */
  size?: { width: number; height: number };
}

const el = (id: string, label: string, path: string, opts: ItemOpts = {}): LibraryElementDef => ({
  id,
  label,
  styleProps: {
    name: label,
    customPath: path,
    specialProps: {
      viewBox: '0 0 100 100',
      ...(opts.stroke ? { strokeOnly: true, baseStrokeWidth: opts.stroke } : {}),
      ...(opts.evenodd ? { fillRule: 'evenodd' as const } : {}),
    },
    ...(opts.size ? { defaultSize: opts.size } : {}),
  },
});

/* ------------------------------ categories ------------------------------ */

const shapes: LibraryElementDef[] = [
  el('shape-seal-16', 'Seal', starSub(50, 50, 16, 48, 0.82)),
  el('shape-octagon', 'Octagon', polygonSub(50, 50, 8, 48, -67.5)),
  el('shape-cross', 'Cross', 'M35 6 H65 V35 H94 V65 H65 V94 H35 V65 H6 V35 H35 Z'),
  el('shape-hexagon', 'Hexagon', polygonSub(50, 50, 6, 48)),
  el('shape-scallop-square', 'Scalloped Square', scallopSquareSub(5, 9)),
  el('shape-squircle', 'Squircle', 'M50 6 C82 6 94 18 94 50 C94 82 82 94 50 94 C18 94 6 82 6 50 C6 18 18 6 50 6 Z'),
  el('shape-bevel-square', 'Bevel Square', 'M30 8 H70 L92 30 V70 L70 92 H30 L8 70 V30 Z'),
  el('shape-arch', 'Arch', 'M10 92 V48 A40 40 0 0 1 90 48 V92 Z'),
  el('shape-semicircle', 'Semicircle', 'M4 74 A46 46 0 0 1 96 74 Z'),
  el('shape-frame', 'Square Frame', rectSub(6, 6, 88, 88) + ' ' + rectSub(20, 20, 60, 60), { evenodd: true }),
  el('shape-rounded-frame', 'Rounded Frame', roundedRectSub(6, 6, 88, 88, 16) + ' ' + roundedRectSub(18, 18, 64, 64, 9), { evenodd: true }),
  el('shape-star8', '8-Point Star', starSub(50, 50, 8, 48, 0.62)),
  el('shape-double-triangle', 'Double Triangle', 'M50 6 L84 44 H16 Z M50 46 L92 94 H8 Z'),
  el('shape-parallelogram', 'Parallelogram', 'M26 16 H94 L74 84 H6 Z'),
  el('shape-pillow', 'Pillow', 'M14 14 Q50 6 86 14 Q94 50 86 86 Q50 94 14 86 Q6 50 14 14 Z'),
  el('shape-ticket', 'Ticket', 'M10 10 H90 Q83 50 90 90 H10 Q17 50 10 10 Z'),
  el('shape-peanut', 'Peanut', circleSub(31, 50, 25) + ' ' + circleSub(69, 50, 25)),
  el('shape-burst-20', 'Sunburst', starSub(50, 50, 20, 48, 0.85)),
  el('shape-pentagon', 'Pentagon', polygonSub(50, 50, 5, 48)),
  el('shape-heptagon', 'Heptagon', polygonSub(50, 50, 7, 48)),
  el('shape-ring', 'Ring', circleSub(50, 50, 46) + ' ' + circleSub(50, 50, 30), { evenodd: true }),
  el('shape-kite', 'Kite', 'M50 4 L70 50 L50 96 L30 50 Z'),
  el('shape-chevron', 'Chevron', 'M6 6 H60 L94 50 L60 94 H6 L36 50 Z'),
  el('shape-rainbow', 'Rainbow', 'M6 84 A44 44 0 0 1 94 84 H74 A24 24 0 0 0 26 84 Z'),
  el('shape-trapezoid', 'Trapezoid', 'M24 16 H76 L95 84 H5 Z'),
  el('shape-scallop-oval', 'Scalloped Oval', ellipseStarSub(14, 50, 50, 46, 30, 0.82), { size: { width: 380, height: 250 } }),
  el('shape-rounded-square', 'Rounded Square', roundedRectSub(8, 8, 84, 84, 20)),
  el('shape-podium', 'Podium', 'M6 82 V74 Q6 64 16 64 H30 V52 Q30 44 38 44 H62 Q70 44 70 52 V64 H84 Q94 64 94 74 V82 Q94 88 88 88 H12 Q6 88 6 82 Z', { size: { width: 400, height: 220 } }),
  el('shape-pointer', 'Pointer', 'M6 28 H68 L94 50 L68 72 H6 Z', { size: { width: 400, height: 200 } }),
  el('shape-double-diamond', 'Double Diamond', polygonSub(31, 50, 4, 28) + ' ' + polygonSub(69, 50, 4, 28)),
  el('shape-double-square', 'Double Square', roundedRectSub(6, 28, 44, 44, 14) + ' ' + roundedRectSub(50, 28, 44, 44, 14)),
  el('shape-double-hexagon', 'Double Hexagon', polygonSub(31, 50, 6, 27) + ' ' + polygonSub(69, 50, 6, 27)),
  el('shape-soft-star', 'Soft Star', sparkleSub(50, 50, 8, 48, 0.6)),
  el('shape-ornament', 'Ornament', 'M50 4 C58 22 88 30 88 50 C88 70 58 78 50 96 C42 78 12 70 12 50 C12 30 42 22 50 4 Z'),
  el('shape-nonagon', 'Nonagon', polygonSub(50, 50, 9, 48)),
  el('shape-plaque', 'Plaque', 'M20 8 H80 A12 12 0 0 0 92 20 V80 A12 12 0 0 0 80 92 H20 A12 12 0 0 0 8 80 V20 A12 12 0 0 0 20 8 Z'),
  el('shape-label', 'Label', 'M20 24 H80 L94 38 V62 L80 76 H20 L6 62 V38 Z', { size: { width: 420, height: 250 } }),
  el('shape-wavy-flag', 'Wavy Flag', 'M6 32 C30 18 70 46 94 32 V68 C70 82 30 54 6 68 Z', { size: { width: 440, height: 240 } }),
  el('shape-spool', 'Spool', 'M6 30 Q50 44 94 30 V70 Q50 56 6 70 Z', { size: { width: 440, height: 240 } }),
  el('shape-hill', 'Hill', 'M4 76 C26 46 74 46 96 76 Z', { size: { width: 440, height: 200 } }),
  el('shape-wedge', 'Wedge', 'M6 30 L94 42 V62 L6 74 Z', { size: { width: 440, height: 220 } }),
  el('shape-curved-ribbon', 'Curved Ribbon', 'M6 62 C34 50 66 32 94 18 V46 C66 60 34 78 6 90 Z', { size: { width: 420, height: 300 } }),
  el('shape-hourglass', 'Hourglass', 'M24 6 H76 V16 C76 34 60 42 55 50 C60 58 76 66 76 84 V94 H24 V84 C24 66 40 58 45 50 C40 42 24 34 24 16 Z', { size: { width: 260, height: 320 } }),
  el('shape-long-hexagon', 'Long Hexagon', 'M6 50 L24 26 H76 L94 50 L76 74 H24 Z', { size: { width: 420, height: 230 } }),
  el('shape-pill', 'Pill', roundedRectSub(4, 31, 92, 38, 19), { size: { width: 420, height: 175 } }),
  el('shape-bookmark', 'Bookmark', 'M24 6 H76 V94 L50 72 L24 94 Z', { size: { width: 240, height: 340 } }),
  el('shape-raindrop', 'Raindrop', 'M8 92 V40 Q8 8 40 8 H60 Q92 8 92 40 V60 Q92 92 60 92 Z'),
  el('shape-leaf', 'Leaf', 'M8 92 V42 Q8 8 42 8 H92 V58 Q92 92 58 92 Z'),
  el('shape-crescents', 'Crescents', crescentSub(46, 50, 44, 66) + ' ' + crescentSub(70, 50, 31, 47) + ' ' + crescentSub(88, 50, 20, 30)),
  el('shape-pow', 'Pow Burst', powSub(), { stroke: 5 }),
  el('shape-quatrefoil', 'Quatrefoil', flowerSub(4, 48, 26, -45)),
  el('shape-tooth', 'Tooth', 'M50 8 C30 8 16 22 16 46 C16 64 20 92 32 92 C44 92 40 72 50 72 C60 72 56 92 68 92 C80 92 84 64 84 46 C84 22 70 8 50 8 Z'),
  el('shape-ribbon-flag', 'Ribbon Flag', 'M6 30 H94 L78 50 L94 70 H6 Z', { size: { width: 440, height: 220 } }),
  el('shape-perspective', 'Perspective', 'M12 26 L88 10 V90 L12 74 Z'),
  el('shape-pick', 'Pick', 'M50 94 C32 76 12 60 12 40 A38 38 0 0 1 88 40 C88 60 68 76 50 94 Z'),
  el('shape-quarter-circle', 'Quarter Circle', 'M12 88 V12 A76 76 0 0 1 88 88 Z'),
  el('shape-quarter-ring', 'Quarter Ring', 'M12 12 A76 76 0 0 1 88 88 H62 A50 50 0 0 0 12 38 Z'),
  el('shape-seal-outline', 'Seal Outline', starSub(50, 50, 16, 46, 0.86), { stroke: 4 }),
  el('shape-circle-outline', 'Circle Outline', circleSub(50, 50, 45), { stroke: 4 }),
  el('shape-sketch-square', 'Sketch Square', 'M14 16 C38 11 64 13 87 13 C89 36 87 60 88 87 C62 90 38 87 13 88 C11 62 13 38 14 16 Z', { stroke: 4 }),
  el('shape-sketch-triangle', 'Sketch Triangle', 'M52 12 C62 34 76 62 89 87 C63 84 37 87 11 89 C25 62 39 35 52 12 Z', { stroke: 4 }),
  el('shape-spikes', 'Spikes', polyPath([[12, 94], [12, 8], [30, 94]]) + ' ' + polyPath([[34, 94], [34, 16], [52, 94]]) + ' ' + polyPath([[56, 94], [56, 10], [74, 94]]) + ' ' + polyPath([[78, 94], [78, 20], [94, 94]])),
  el('shape-teardrop', 'Teardrop', 'M50 4 C56 22 84 40 84 62 A34 34 0 0 1 16 62 C16 40 44 22 50 4 Z', { size: { width: 280, height: 330 } }),
  el('shape-shield', 'Shield', 'M8 8 H92 V50 L50 94 L8 50 Z'),
  el('shape-starburst', 'Starburst', starSub(50, 50, 12, 48, 0.6)),
  el('shape-spark', 'Spark', sparkleSub(50, 50, 8, 48, 0.38)),
  el('shape-ticket-stub', 'Ticket Stub', 'M14 34 H86 A9 9 0 0 0 95 43 V57 A9 9 0 0 0 86 66 H14 A9 9 0 0 0 5 57 V43 A9 9 0 0 0 14 34 Z', { size: { width: 440, height: 165 } }),
  el('shape-daisy-bloom', 'Daisy Bloom', flowerSub(12, 48, 30)),
  el('shape-scallop-circle', 'Scalloped Circle', scallopCircleSub(12, 40)),
  el('shape-scallop-seal', 'Scalloped Seal', scallopCircleSub(18, 42)),
  el('shape-soft-diamond', 'Soft Diamond', roundedPolySub([[50, 6], [94, 50], [50, 94], [6, 50]], 14)),
  el('shape-play', 'Rounded Triangle', roundedPolySub([[22, 8], [90, 50], [22, 92]], 14)),
  el('shape-lens', 'Lens', 'M4 50 C24 20 76 20 96 50 C76 80 24 80 4 50 Z', { size: { width: 400, height: 240 } }),
  el('shape-bloom', 'Bloom', flowerSub(6, 48, 28)),
  el('shape-puff', 'Puff', flowerSub(7, 48, 36)),
  el('shape-blossom', 'Blossom', flowerSub(8, 48, 25)),
];

const arrows: LibraryElementDef[] = [
  el('arrow-right', 'Arrow Right', 'M6 35 H58 V15 L94 50 L58 85 V65 H6 Z'),
  el('arrow-left', 'Arrow Left', 'M94 35 H42 V15 L6 50 L42 85 V65 H94 Z'),
  el('arrow-up', 'Arrow Up', 'M35 94 V42 H15 L50 6 L85 42 H65 V94 Z'),
  el('arrow-down', 'Arrow Down', 'M35 6 V58 H15 L50 94 L85 58 H65 V6 Z'),
  el('arrow-double-h', 'Double Arrow', 'M28 15 L4 50 L28 85 V66 H72 V85 L96 50 L72 15 V34 H28 Z'),
  el('arrow-swoosh', 'Swoosh Arrow', 'M8 90 C14 56 36 32 68 24 L62 8 L94 15 L83 44 L76 28 C50 36 28 58 20 92 Z'),
  el('arrow-sketch-curve', 'Sketch Arrow', 'M10 78 C28 34 58 24 84 40 M70 28 L86 41 L68 52', { stroke: 10 }),
  el('arrow-loop', 'Loop Arrow', 'M10 64 C4 32 36 12 50 32 C60 46 42 62 32 50 C22 38 44 22 66 30 C76 34 82 40 86 48 M84 32 L88 50 L70 46', { stroke: 9 }),
  el('arrow-zigzag', 'Zigzag Arrow', 'M8 84 L32 52 L52 68 L84 30 M68 26 L86 27 L80 46', { stroke: 10 }),
  el('arrow-wavy', 'Wavy Arrow', 'M6 58 C16 38 28 74 40 54 C52 34 64 72 76 50 M64 40 L78 48 L68 62', { stroke: 9 }),
  el('arrow-corner', 'Corner Arrow', 'M20 8 C48 14 56 34 56 62 M40 50 L56 68 L70 48', { stroke: 10 }),
  el('arrow-rising', 'Trend Arrow', 'M6 78 L34 54 L52 66 L74 34 L62 26 L94 12 L88 46 L78 40 L54 74 L34 62 L12 84 Z'),
  el('arrow-scribble', 'Scribble Arrow', 'M90 40 C62 36 38 40 14 48 M32 36 L10 50 L32 60 M92 52 C68 50 48 53 28 58 M84 64 C66 62 52 64 40 67', { stroke: 6 }),
  el('arrow-curl', 'Curl Arrow', 'M84 18 C50 2 18 16 20 46 C22 66 38 78 60 76 M48 62 L68 76 L50 90', { stroke: 8 }),
  el('arrow-spiral', 'Spiral Arrow', 'M58 52 C58 60 42 62 38 52 C34 40 50 28 62 34 C76 41 76 60 62 68 C42 78 22 62 26 42 C29 28 42 16 60 18 M54 8 L74 19 L58 34', { stroke: 7 }),
  el('arrow-arc-down', 'Arc Arrow', 'M10 28 C40 12 74 26 84 60 M68 52 L86 64 L92 40', { stroke: 9 }),
  el('arrow-pointer', 'Pointer', 'M94 50 L10 12 L28 50 L10 88 Z'),
  el('arrow-elbow', 'Elbow Arrow', 'M14 84 H58 Q70 84 70 72 V24 M54 36 L70 16 L86 36', { stroke: 8 }),
  el('arrow-curved-solid', 'Bold Curved Arrow', 'M8 72 C6 34 34 10 64 16 L70 2 L94 26 L66 40 L60 28 C38 24 22 42 24 72 Z'),
  el('arrow-folded', 'Folded Arrow', 'M8 26 L46 38 V24 L92 54 L46 82 V66 L8 56 Z'),
  el('arrow-loop-line', 'Loop-de-Loop', 'M6 84 C22 70 34 64 46 66 C60 68 62 82 52 86 C42 90 34 78 44 66 C54 52 70 40 86 30 M70 20 L90 27 L80 46', { stroke: 7 }),
  el('arrow-curly', 'Curly Arrow', 'M8 44 C18 26 34 26 36 40 C38 54 22 58 20 46 C18 34 34 24 48 32 C60 40 58 54 70 60 M58 48 L76 62 L54 72', { stroke: 7 }),
  el('arrow-branch', 'Branch Arrow', 'M44 94 C44 72 44 46 44 22 M32 36 L44 18 L56 36 M44 62 C56 56 66 46 72 36 M58 28 L76 30 L70 50', { stroke: 7 }),
];

const icons: LibraryElementDef[] = [
  el('icon-heart', 'Heart', 'M50 88 C20 65 8 45 8 30 C8 16 19 8 30 8 C40 8 47 14 50 20 C53 14 60 8 70 8 C81 8 92 16 92 30 C92 45 80 65 50 88 Z'),
  el('icon-bolt', 'Bolt', 'M55 2 L20 55 L42 55 L35 98 L78 40 L52 40 Z'),
  el('icon-pin', 'Location Pin', 'M50 6 C31 6 17 20 17 38 C17 62 50 94 50 94 C50 94 83 62 83 38 C83 20 69 6 50 6 Z ' + circleSub(50, 38, 12), { evenodd: true }),
  el('icon-play', 'Play', 'M28 14 L84 50 L28 86 Z'),
  el('icon-chat', 'Chat Bubble', 'M12 20 Q12 12 20 12 H80 Q88 12 88 20 V60 Q88 68 80 68 H46 L28 88 L32 68 H20 Q12 68 12 60 Z'),
  el('icon-bell', 'Bell', 'M50 10 C34 10 26 22 26 38 V56 L16 70 H84 L74 56 V38 C74 22 66 10 50 10 Z M42 78 A8 8 0 0 0 58 78 Z'),
  el('icon-magnifier', 'Magnifier', circleSub(42, 42, 26) + ' ' + circleSub(42, 42, 16) + ' M60 68 L68 60 L92 84 L84 92 Z', { evenodd: true }),
  el('icon-envelope', 'Envelope', rectSub(8, 22, 84, 56) + ' M14 27 L50 55 L86 27 L86 33 L50 61 L14 33 Z', { evenodd: true }),
  el('icon-user', 'User', circleSub(50, 30, 16) + ' M18 88 C18 66 32 56 50 56 C68 56 82 66 82 88 Z'),
  el('icon-check-circle', 'Check Circle', circleSub(50, 50, 44) + ' M30 52 L44 66 L72 34 L64 27 L44 50 L37 45 Z', { evenodd: true }),
  el('icon-camera', 'Camera', 'M10 30 Q10 24 16 24 H32 L40 14 H60 L68 24 H84 Q90 24 90 30 V78 Q90 84 84 84 H16 Q10 84 10 78 Z ' + circleSub(50, 54, 16), { evenodd: true }),
  el('icon-note', 'Music Note', 'M40 16 L84 8 V62 A12 9 0 1 1 76 54 V22 L48 27 V74 A12 9 0 1 1 40 66 Z'),
  // essentials
  el('icon-check', 'Checkmark', 'M8 56 L20 44 L38 62 L80 16 L92 27 L38 86 Z'),
  el('icon-plus', 'Plus', 'M42 10 H58 V42 H90 V58 H58 V90 H42 V58 H10 V42 H42 Z'),
  el('icon-key', 'Key', circleSub(26, 50, 20) + ' ' + circleSub(26, 50, 9) + ' M44 44 H94 V56 H88 V68 H78 V56 H72 V68 H62 V56 H44 Z', { evenodd: true }),
  el('icon-lock', 'Lock', 'M50 8 C35 8 26 19 26 32 V42 H36 V32 C36 24 41 16 50 16 C59 16 64 24 64 32 V42 H74 V32 C74 19 65 8 50 8 Z ' + roundedRectSub(22, 42, 56, 46, 8) + ' ' + circleSub(50, 60, 7) + ' M46 64 H54 L57 78 H43 Z', { evenodd: true }),
  el('icon-unlock', 'Unlock', 'M50 8 C35 8 26 19 26 32 V42 H36 V32 C36 24 41 16 50 16 C59 16 64 24 64 32 H74 C74 19 65 8 50 8 Z ' + roundedRectSub(22, 42, 56, 46, 8) + ' ' + circleSub(50, 60, 7) + ' M46 64 H54 L57 78 H43 Z', { evenodd: true }),
  el('icon-flag', 'Flag', 'M18 6 H26 V94 H18 Z M26 12 C40 4 56 22 84 10 V52 C56 64 40 46 26 54 Z'),
  el('icon-tag', 'Tag', 'M10 10 H48 L92 54 L54 92 L10 48 Z ' + circleSub(30, 30, 8), { evenodd: true }),
  el('icon-home', 'Home', 'M50 8 L94 44 H84 V92 H60 V64 H40 V92 H16 V44 H6 Z'),
  el('icon-building', 'Building', rectSub(26, 8, 48, 86) + rectSub(34, 18, 8, 8) + rectSub(46, 18, 8, 8) + rectSub(58, 18, 8, 8) + rectSub(34, 32, 8, 8) + rectSub(46, 32, 8, 8) + rectSub(58, 32, 8, 8) + rectSub(34, 46, 8, 8) + rectSub(46, 46, 8, 8) + rectSub(58, 46, 8, 8) + rectSub(34, 60, 8, 8) + rectSub(46, 60, 8, 8) + rectSub(58, 60, 8, 8) + rectSub(43, 76, 14, 18), { evenodd: true }),
  el('icon-store', 'Storefront', 'M10 36 V20 H90 V36 A10 8 0 0 1 70 36 A10 8 0 0 1 50 36 A10 8 0 0 1 30 36 A10 8 0 0 1 10 36 Z ' + rectSub(16, 46, 68, 46) + rectSub(58, 60, 16, 32) + rectSub(26, 60, 20, 16), { evenodd: true }),
  el('icon-gift', 'Gift', 'M50 26 C42 10 24 10 24 19 C24 26 38 26 50 26 C62 26 76 26 76 19 C76 10 58 10 50 26 Z ' + roundedRectSub(8, 28, 84, 16, 4) + rectSub(14, 48, 72, 44) + rectSub(44, 28, 3, 64) + rectSub(53, 28, 3, 64), { evenodd: true }),
  // commerce
  el('icon-cart', 'Shopping Cart', 'M6 8 H22 L27 22 H94 L82 60 H34 L37 70 H82 V80 H30 L16 16 H6 Z ' + circleSub(38, 89, 7) + circleSub(72, 89, 7)),
  el('icon-bag', 'Shopping Bag', 'M50 8 C40 8 34 16 34 26 V34 H40 V26 C40 19 44 14 50 14 C56 14 60 19 60 26 V34 H66 V26 C66 16 60 8 50 8 Z ' + roundedRectSub(16, 30, 68, 62, 8)),
  el('icon-credit-card', 'Credit Card', roundedRectSub(6, 22, 88, 56, 8) + rectSub(6, 34, 88, 10) + rectSub(16, 62, 26, 7), { evenodd: true }),
  el('icon-wallet', 'Wallet', roundedRectSub(6, 26, 88, 60, 8) + roundedRectSub(60, 46, 34, 20, 4) + circleSub(76, 56, 5), { evenodd: true }),
  el('icon-coin', 'Dollar Coin', circleSub(50, 50, 44) + ' M46 18 H54 V26 C62 27 68 32 69 40 H60 C59 36 55 33 50 33 C45 33 41 36 41 40 C41 45 46 46 52 48 C60 50 70 52 70 61 C70 69 63 74 54 75 V82 H46 V75 C37 74 31 68 30 60 H39 C40 65 44 68 50 68 C56 68 61 65 61 61 C61 56 56 54 49 52 C41 50 32 48 32 40 C32 33 38 27 46 26 Z', { evenodd: true }),
  el('icon-banknote', 'Banknote', roundedRectSub(4, 26, 92, 48, 6) + roundedRectSub(12, 34, 76, 32, 3) + circleSub(50, 50, 10), { evenodd: true }),
  el('icon-truck', 'Truck', 'M4 22 H60 V70 H4 Z M60 34 H78 L92 50 V70 H60 Z ' + circleSub(22, 78, 8) + circleSub(74, 78, 8) + circleSub(22, 78, 3.5) + circleSub(74, 78, 3.5), { evenodd: true }),
  // communication
  el('icon-send', 'Paper Plane', 'M92 8 L8 44 L38 56 L82 20 L46 62 L58 90 Z'),
  el('icon-at', 'At Sign', circleSub(50, 50, 16) + ' M66 34 V54 C66 62 70 66 76 64 C85 60 88 53 88 46 C88 25 71 10 50 10 C28 10 10 27 10 50 C10 73 28 90 50 90 C58 90 66 88 72 84', { stroke: 7 }),
  el('icon-phone', 'Phone', 'M20 8 C14 8 8 14 8 20 C8 58 42 92 80 92 C86 92 92 86 92 80 V66 C92 62 90 60 86 59 L68 54 C65 53 62 54 60 57 L54 64 C44 59 41 56 36 46 L43 40 C46 38 47 35 46 32 L41 14 C40 10 38 8 34 8 Z'),
  el('icon-envelope-open', 'Open Envelope', 'M50 8 L94 36 V92 H6 V36 Z M50 16 L84 38 L50 62 L16 38 Z', { evenodd: true }),
  el('icon-megaphone', 'Megaphone', 'M90 10 V70 L38 56 H22 C13 56 8 50 8 40 C8 30 13 24 22 24 H38 Z M26 62 H38 L44 90 H32 Z'),
  el('icon-rss', 'RSS', circleSub(20, 80, 6) + ' M16 52 C34 52 48 66 48 84 M16 24 C50 24 76 50 76 84', { stroke: 9 }),
  el('icon-share', 'Share', circleSub(26, 50, 10) + circleSub(74, 24, 10) + circleSub(74, 76, 10) + ' M35 45 L65 29 M35 55 L65 71', { stroke: 7 }),
  el('icon-wifi', 'Wifi', 'M10 42 C32 22 68 22 90 42 M24 58 C40 44 60 44 76 58 M38 72 C45 66 55 66 62 72 ' + circleSub(50, 85, 3), { stroke: 8 }),
  el('icon-translate', 'Translate', 'M14 20 H50 M32 12 V20 C30 34 22 44 10 50 M18 28 C24 40 34 48 46 52 M54 88 L72 44 L90 88 M60 74 H84', { stroke: 7 }),
  // people
  el('icon-users', 'Users', circleSub(34, 30, 14) + ' M8 82 C8 62 20 52 34 52 C48 52 60 62 60 82 Z ' + circleSub(70, 34, 11) + ' M66 82 C66 66 62 58 56 52 C60 49 65 48 70 48 C82 48 92 58 92 76 V82 Z'),
  el('icon-user-circle', 'User Circle', circleSub(50, 50, 44) + circleSub(50, 38, 14) + ' M22 78 C24 62 34 56 50 56 C66 56 76 62 78 78 C70 86 60 90 50 90 C40 90 30 86 22 78 Z', { evenodd: true }),
  el('icon-id-card', 'ID Card', roundedRectSub(6, 22, 88, 56, 8) + circleSub(28, 42, 9) + ' M14 66 C14 56 20 52 28 52 C36 52 42 56 42 66 Z ' + rectSub(52, 38, 34, 6) + rectSub(52, 52, 26, 6), { evenodd: true }),
  el('icon-smile', 'Smiley', circleSub(50, 50, 44) + circleSub(35, 40, 6) + circleSub(65, 40, 6) + ' M30 58 C36 70 64 70 70 58 L63 53 C58 61 42 61 37 53 Z', { evenodd: true }),
  el('icon-hand', 'Hand', 'M30 54 V20 C30 16 33 13 37 13 C41 13 44 16 44 20 V44 H48 V12 C48 8 51 5 55 5 C59 5 62 8 62 12 V44 H66 V18 C66 14 69 11 73 11 C77 11 80 14 80 18 V60 C80 80 68 94 52 94 C38 94 30 86 22 70 L14 54 C12 50 14 46 18 45 C21 44 24 46 26 49 L30 56 Z'),
  el('icon-thumbs-up', 'Thumbs Up', 'M8 44 H22 V90 H8 Z M28 90 V46 L46 10 C52 10 57 15 57 21 C57 26 55 33 53 39 H85 C90 39 93 43 93 47 C93 50 91 53 89 54 C91 56 92 59 92 61 C92 64 90 67 87 68 C88 70 88 72 88 74 C88 77 86 80 83 81 C83 83 83 85 82 87 C81 89 78 90 75 90 Z'),
  el('icon-thumbs-down', 'Thumbs Down', 'M8 56 H22 V10 H8 Z M28 10 V54 L46 90 C52 90 57 85 57 79 C57 74 55 67 53 61 H85 C90 61 93 57 93 53 C93 50 91 47 89 46 C91 44 92 41 92 39 C92 36 90 33 87 32 C88 30 88 28 88 26 C88 23 86 20 83 19 C83 17 83 15 82 13 C81 11 78 10 75 10 Z'),
  // media
  el('icon-play-circle', 'Play Circle', circleSub(50, 50, 44) + circleSub(50, 50, 36) + ' M40 32 L72 50 L40 68 Z', { evenodd: true }),
  el('icon-pause-circle', 'Pause Circle', circleSub(50, 50, 44) + circleSub(50, 50, 36) + rectSub(38, 33, 9, 34) + rectSub(53, 33, 9, 34), { evenodd: true }),
  el('icon-stop-circle', 'Stop Circle', circleSub(50, 50, 44) + circleSub(50, 50, 36) + rectSub(36, 36, 28, 28), { evenodd: true }),
  el('icon-forward', 'Fast Forward', 'M8 20 L48 50 L8 80 Z M52 20 L92 50 L52 80 Z'),
  el('icon-rewind', 'Rewind', 'M92 20 L52 50 L92 80 Z M48 20 L8 50 L48 80 Z'),
  el('icon-video', 'Video Camera', roundedRectSub(6, 26, 56, 48, 8) + ' M66 42 L94 28 V72 L66 58 Z'),
  el('icon-video-off', 'Video Off', roundedRectSub(6, 26, 56, 48, 8) + ' M66 42 L94 28 V72 L66 58 Z M12 6 L94 88 L86 94 L4 12 Z', { evenodd: true }),
  el('icon-volume', 'Speaker', 'M10 38 H26 L46 20 V80 L26 62 H10 Z M56 34 C62 42 62 58 56 66 L62 70 C70 60 70 40 62 30 Z M68 22 C78 36 78 64 68 78 L74 82 C86 66 86 34 74 18 Z'),
  el('icon-mute', 'Mute', 'M8 38 H24 L44 20 V80 L24 62 H8 Z M58 42 L64 36 L72 44 L80 36 L86 42 L78 50 L86 58 L80 64 L72 56 L64 64 L58 58 L66 50 Z'),
  el('icon-mic', 'Microphone', roundedRectSub(38, 6, 24, 44, 12) + ' M22 40 V46 C22 62 34 72 46 73 V84 H34 V92 H66 V84 H54 V73 C66 72 78 62 78 46 V40 H70 V46 C70 58 61 66 50 66 C39 66 30 58 30 46 V40 Z'),
  el('icon-image', 'Image', roundedRectSub(6, 14, 88, 72, 8) + roundedRectSub(14, 22, 72, 56, 4) + ' M20 70 L38 46 L50 60 L64 40 L80 70 Z ' + circleSub(32, 34, 6), { evenodd: true }),
  el('icon-radio', 'Radio', roundedRectSub(8, 34, 84, 54, 8) + ' M22 34 L72 8 L76 14 L30 34 Z ' + circleSub(30, 61, 12) + rectSub(52, 48, 30, 6) + rectSub(52, 62, 30, 6), { evenodd: true }),
  // interface
  el('icon-settings', 'Settings', gearSub(8, 46, 34, 13), { evenodd: true }),
  el('icon-sliders', 'Sliders', 'M25 10 V90 M50 10 V90 M75 10 V90 ' + circleSub(25, 34, 8) + circleSub(50, 64, 8) + circleSub(75, 28, 8), { stroke: 6 }),
  el('icon-eye', 'Eye', 'M50 22 C26 22 10 40 4 50 C10 60 26 78 50 78 C74 78 90 60 96 50 C90 40 74 22 50 22 Z ' + circleSub(50, 50, 14), { evenodd: true }),
  el('icon-eye-off', 'Eye Off', 'M50 22 C26 22 10 40 4 50 C10 60 26 78 50 78 C74 78 90 60 96 50 C90 40 74 22 50 22 Z ' + circleSub(50, 50, 14) + ' M14 4 L96 86 L88 94 L6 12 Z', { evenodd: true }),
  el('icon-ban', 'Ban', circleSub(50, 50, 40) + ' M23 23 L77 77', { stroke: 9 }),
  el('icon-expand', 'Expand', 'M56 10 H90 V44 H82 V24 L24 82 H44 V90 H10 V56 H18 V76 L76 18 H56 Z'),
  el('icon-collapse', 'Collapse', 'M84 8 L92 16 L68 40 H84 V48 H52 V16 H60 V32 Z M16 92 L8 84 L32 60 H16 V52 H48 V84 H40 V68 Z'),
  el('icon-external-link', 'External Link', 'M14 22 H46 V30 H22 V78 H70 V54 H78 V86 H14 Z M54 14 H86 V46 H78 V28 L52 54 L46 48 L72 22 H54 Z'),
  el('icon-refresh', 'Refresh', 'M86 42 C80 26 66 14 50 14 C32 14 18 26 14 42 M14 58 C20 74 34 86 50 86 C68 86 82 74 86 58 M70 40 L88 46 L92 28 M30 60 L12 54 L8 72', { stroke: 8 }),
  el('icon-undo', 'Undo', 'M18 38 C26 24 39 16 53 16 C73 16 89 32 89 52 C89 72 73 87 53 87 C39 87 27 79 19 66 M32 14 L14 38 L40 46', { stroke: 8 }),
  el('icon-redo', 'Redo', 'M82 38 C74 24 61 16 47 16 C27 16 11 32 11 52 C11 72 27 87 47 87 C61 87 73 79 81 66 M68 14 L86 38 L60 46', { stroke: 8 }),
  el('icon-grid', 'App Grid', roundedRectSub(12, 12, 32, 32, 8) + roundedRectSub(56, 12, 32, 32, 8) + roundedRectSub(12, 56, 32, 32, 8) + roundedRectSub(56, 56, 32, 32, 8)),
  el('icon-columns', 'Columns', rectSub(14, 14, 20, 72) + rectSub(40, 14, 20, 72) + rectSub(66, 14, 20, 72)),
  el('icon-layers', 'Layers', 'M50 6 L94 28 L50 50 L6 28 Z M14 44 L6 48 L50 70 L94 48 L86 44 L50 62 Z M14 64 L6 68 L50 90 L94 68 L86 64 L50 82 Z'),
  el('icon-copy', 'Copy', roundedRectSub(34, 34, 56, 56, 10) + ' M22 66 H16 C12 66 10 64 10 60 V16 C10 12 12 10 16 10 H60 C64 10 66 12 66 16 V22', { stroke: 7 }),
  el('icon-click', 'Cursor Click', 'M40 40 L82 55 L62 62 L76 76 L68 84 L54 70 L47 88 Z M24 8 V22 M8 24 H22 M12 12 L21 21 M44 8 V22 M8 44 H22', { stroke: 6 }),
  el('icon-power', 'Power', 'M32 20 A30 30 0 1 0 68 20 M50 6 V44', { stroke: 9 }),
  el('icon-terminal', 'Terminal', roundedRectSub(6, 14, 88, 72, 8) + ' M20 34 L34 48 L20 62 L26 68 L46 48 L26 28 Z ' + rectSub(50, 62, 24, 7), { evenodd: true }),
  el('icon-browser', 'Browser', roundedRectSub(6, 14, 88, 72, 8) + rectSub(6, 28, 88, 4) + circleSub(16, 21, 3) + circleSub(26, 21, 3), { evenodd: true }),
  el('icon-monitor', 'Monitor', roundedRectSub(8, 14, 84, 56, 6) + roundedRectSub(16, 22, 68, 40, 3) + ' M44 70 H56 V80 H70 V88 H30 V80 H44 Z', { evenodd: true }),
  // objects
  el('icon-trash', 'Trash', 'M40 6 H60 V12 H84 V20 H16 V12 H40 Z M22 26 H78 L74 94 H26 Z ' + rectSub(38, 36, 6, 44) + rectSub(56, 36, 6, 44), { evenodd: true }),
  el('icon-folder', 'Folder', 'M8 20 H38 L48 30 H92 V84 H8 Z'),
  el('icon-bookmark', 'Bookmark', 'M22 6 H78 V94 L50 72 L22 94 Z'),
  el('icon-clipboard', 'Clipboard', roundedRectSub(16, 12, 68, 82, 8) + roundedRectSub(36, 4, 28, 16, 4), { evenodd: true }),
  el('icon-calendar', 'Calendar', roundedRectSub(8, 16, 84, 76, 8) + rectSub(28, 6, 8, 16) + rectSub(64, 6, 8, 16) + rectSub(14, 36, 72, 6) + rectSub(22, 52, 8, 8) + rectSub(38, 52, 8, 8) + rectSub(54, 52, 8, 8) + rectSub(70, 52, 8, 8) + rectSub(22, 68, 8, 8) + rectSub(38, 68, 8, 8), { evenodd: true }),
  el('icon-clock', 'Clock', circleSub(50, 50, 44) + circleSub(50, 50, 36) + rectSub(47, 26, 6, 27) + rectSub(47, 47, 22, 6), { evenodd: true }),
  el('icon-hourglass', 'Hourglass', 'M22 6 H78 V14 C78 30 64 38 56 44 V56 C64 62 78 70 78 86 V94 H22 V86 C22 70 36 62 44 56 V44 C36 38 22 30 22 14 Z'),
  el('icon-book', 'Open Book', 'M50 22 C40 12 24 10 8 12 V78 C24 76 40 78 50 88 C60 78 76 76 92 78 V12 C76 10 60 12 50 22 Z ' + rectSub(48, 24, 4, 58), { evenodd: true }),
  el('icon-printer', 'Printer', rectSub(28, 8, 44, 16) + roundedRectSub(12, 28, 76, 36, 6) + rectSub(28, 52, 44, 40) + circleSub(80, 38, 3), { evenodd: true }),
  el('icon-calculator', 'Calculator', roundedRectSub(20, 6, 60, 88, 8) + rectSub(30, 16, 40, 16) + rectSub(30, 42, 8, 8) + rectSub(46, 42, 8, 8) + rectSub(62, 42, 8, 8) + rectSub(30, 58, 8, 8) + rectSub(46, 58, 8, 8) + rectSub(62, 58, 8, 8) + rectSub(30, 74, 8, 8) + rectSub(46, 74, 8, 8) + rectSub(62, 74, 8, 8), { evenodd: true }),
  el('icon-newspaper', 'Newspaper', roundedRectSub(8, 18, 84, 64, 6) + rectSub(18, 28, 32, 20) + rectSub(58, 28, 18, 4) + rectSub(58, 36, 18, 4) + rectSub(58, 44, 18, 4) + rectSub(18, 56, 58, 4) + rectSub(18, 66, 58, 4), { evenodd: true }),
  el('icon-archive', 'Archive Box', roundedRectSub(6, 10, 88, 20, 4) + rectSub(14, 34, 72, 58) + rectSub(38, 44, 24, 8), { evenodd: true }),
  el('icon-inbox', 'Inbox', 'M8 54 L20 16 H80 L92 54 V86 H8 Z M30 54 C32 64 40 70 50 70 C60 70 68 64 70 54 H84 L76 24 H24 L16 54 Z', { evenodd: true }),
  el('icon-database', 'Database', 'M14 22 A36 14 0 1 0 86 22 A36 14 0 1 0 14 22 Z M14 50 A36 14 0 1 0 86 50 A36 14 0 1 0 14 50 Z M14 78 A36 14 0 1 0 86 78 A36 14 0 1 0 14 78 Z'),
  el('icon-battery', 'Battery', roundedRectSub(6, 32, 78, 36, 8) + rectSub(88, 42, 8, 16) + roundedRectSub(13, 39, 64, 22, 4) + rectSub(19, 45, 28, 10), { evenodd: true }),
  el('icon-ticket', 'Ticket', 'M6 30 H94 V42 A8 8 0 0 0 94 58 V70 H6 V58 A8 8 0 0 0 6 42 Z ' + rectSub(47, 34, 6, 8) + rectSub(47, 46, 6, 8) + rectSub(47, 58, 6, 8), { evenodd: true }),
  el('icon-map', 'Map', 'M6 18 L36 8 L64 18 L94 8 V82 L64 92 L36 82 L6 92 Z ' + rectSub(34, 9, 4, 76) + rectSub(62, 10, 4, 76), { evenodd: true }),
  el('icon-briefcase', 'Briefcase', 'M36 30 V22 C36 17 40 14 44 14 H56 C60 14 64 17 64 22 V30 H56 V22 H44 V30 Z ' + roundedRectSub(8, 30, 84, 58, 8) + rectSub(44, 52, 12, 12), { evenodd: true }),
  // tools & misc
  el('icon-pencil', 'Pencil', 'M62 14 L86 38 L38 86 L10 90 L14 62 Z M70 6 L94 30 L86 38 L62 14 Z'),
  el('icon-edit', 'Edit', roundedRectSub(8, 16, 70, 76, 8) + roundedRectSub(16, 24, 54, 60, 4) + ' M84 8 L94 18 L60 52 L46 56 L50 42 Z', { evenodd: true }),
  el('icon-brush', 'Paintbrush', 'M58 10 L90 42 L52 74 L26 48 Z M22 52 L48 78 C44 88 30 96 8 92 C16 82 12 62 22 52 Z'),
  el('icon-dropper', 'Eyedropper', 'M62 10 C68 2 80 2 86 10 C93 16 93 27 86 33 L76 43 L57 24 Z M52 30 L70 48 L34 84 C30 88 24 88 22 86 L14 94 L6 88 L14 80 C12 76 12 72 16 68 Z'),
  el('icon-swatches', 'Swatches', roundedRectSub(14, 8, 24, 74, 6) + circleSub(26, 72, 5) + ' M46 16 L68 28 L38 84 L26 76 Z M74 44 L88 62 L44 90 L36 78 Z', { evenodd: true }),
  el('icon-wrench', 'Wrench', 'M62 6 C50 6 40 16 40 28 C40 30 40 33 41 35 L8 68 C4 72 4 78 8 82 L18 92 C22 96 28 96 32 92 L65 59 C67 60 70 60 72 60 C84 60 94 50 94 38 C94 35 93 32 92 29 L76 45 L55 24 L71 8 C68 7 65 6 62 6 Z'),
  el('icon-bug', 'Bug', 'M50 22 C64 22 74 36 74 54 C74 72 64 84 50 84 C36 84 26 72 26 54 C26 36 36 22 50 22 Z M40 24 L32 8 M60 24 L68 8 M26 42 L10 34 M26 58 H8 M30 72 L14 82 M74 42 L90 34 M74 58 H92 M70 72 L86 82 M50 24 V84', { stroke: 6 }),
  el('icon-rocket', 'Rocket', 'M50 4 C64 14 72 32 72 52 L82 66 V84 L64 74 C60 78 56 80 50 80 C44 80 40 78 36 74 L18 84 V66 L28 52 C28 32 36 14 50 4 Z ' + circleSub(50, 36, 8) + ' M44 84 C44 92 48 96 50 98 C52 96 56 92 56 84 Z', { evenodd: true }),
  el('icon-bulb', 'Lightbulb', 'M50 6 C31 6 18 20 18 36 C18 47 24 54 30 60 C34 64 36 68 37 72 H63 C64 68 66 64 70 60 C76 54 82 47 82 36 C82 20 69 6 50 6 Z ' + rectSub(38, 78, 24, 6) + rectSub(40, 88, 20, 6)),
  el('icon-flame', 'Flame', 'M50 4 C56 18 70 26 76 42 C82 58 76 76 60 86 C64 78 62 68 54 62 C56 72 50 80 42 84 C30 78 24 64 30 52 C24 58 22 66 24 74 C14 62 14 44 24 32 C32 22 44 16 50 4 Z'),
  el('icon-flask', 'Flask', 'M38 6 H62 V12 H58 V34 L84 74 C90 84 84 94 74 94 H26 C16 94 10 84 16 74 L42 34 V12 H38 Z'),
  el('icon-fingerprint', 'Fingerprint', 'M20 50 C20 32 33 20 50 20 C67 20 80 32 80 50 C80 62 78 74 74 84 M34 84 C31 73 30 61 30 50 C30 39 39 32 50 32 C61 32 70 39 70 50 C70 60 69 70 66 80 M50 46 C53 46 56 48 56 52 C56 62 55 72 52 82', { stroke: 6 }),
  el('icon-moon', 'Moon', 'M62 10 C40 14 26 32 26 52 C26 74 44 90 64 90 C70 90 76 88 80 86 C60 82 46 66 46 46 C46 31 52 18 62 10 Z'),
  el('icon-globe', 'Globe', circleSub(50, 50, 42) + ' M8 50 H92 M50 8 C36 20 30 34 30 50 C30 66 36 80 50 92 M50 8 C64 20 70 34 70 50 C70 66 64 80 50 92', { stroke: 6 }),
  el('icon-badge-check', 'Verified Badge', scallopCircleSub(12, 46) + ' M32 50 L44 62 L68 36 L74 42 L44 74 L26 56 Z', { evenodd: true }),
  el('icon-trophy', 'Trophy', 'M30 8 H70 V12 H88 V22 C88 36 78 46 66 48 C62 54 57 58 54 60 V70 H68 V80 H32 V70 H46 V60 C43 58 38 54 34 48 C22 46 12 36 12 22 V12 H30 Z M20 20 V22 C20 31 26 37 32 39 L31 20 Z M80 20 H69 L68 39 C74 37 80 31 80 22 Z', { evenodd: true }),
  el('icon-scales', 'Scales', rectSub(47, 12, 6, 66) + rectSub(18, 22, 64, 6) + rectSub(32, 78, 36, 8) + ' M22 25 L8 54 H36 Z M78 25 L64 54 H92 Z M4 54 A18 12 0 0 0 40 54 Z M60 54 A18 12 0 0 0 96 54 Z'),
  el('icon-hashtag', 'Hashtag', 'M38 12 L30 88 M70 12 L62 88 M16 36 H88 M12 64 H84', { stroke: 8 }),
  el('icon-question-circle', 'Question Circle', circleSub(50, 50, 44) + ' M50 22 C38 22 31 30 31 40 H41 C41 35 44 31 50 31 C56 31 59 34 59 39 C59 43 56 46 51 49 C46 52 45 55 45 62 H55 C55 58 56 56 61 53 C66 49 69 45 69 39 C69 29 61 22 50 22 Z ' + circleSub(50, 72, 6), { evenodd: true }),
  el('icon-info-circle', 'Info Circle', circleSub(50, 50, 44) + circleSub(50, 29, 6) + rectSub(44, 42, 12, 32), { evenodd: true }),
  el('icon-chart-bar', 'Bar Chart', rectSub(14, 56, 16, 34) + rectSub(42, 36, 16, 54) + rectSub(70, 14, 16, 76)),
  el('icon-chart-pie', 'Pie Chart', 'M50 6 A44 44 0 1 0 94 50 H50 Z M58 10 A40 40 0 0 1 90 42 H58 Z'),
  el('icon-cake', 'Birthday Cake', roundedRectSub(8, 58, 84, 34, 6) + rectSub(16, 40, 68, 18) + rectSub(31, 22, 6, 18) + rectSub(47, 22, 6, 18) + rectSub(63, 22, 6, 18) + circleSub(34, 15, 4) + circleSub(50, 15, 4) + circleSub(66, 15, 4)),
  el('icon-cloud', 'Cloud', 'M28 78 C15 78 6 69 6 57 C6 46 14 38 24 37 C27 24 38 14 52 14 C68 14 80 26 81 41 C89 43 94 50 94 59 C94 70 85 78 74 78 Z'),
  el('icon-cloud-upload', 'Cloud Upload', 'M28 78 C15 78 6 69 6 57 C6 46 14 38 24 37 C27 24 38 14 52 14 C68 14 80 26 81 41 C89 43 94 50 94 59 C94 70 85 78 74 78 Z M50 30 L64 48 H56 V68 H44 V48 H36 Z', { evenodd: true }),
  el('icon-cloud-download', 'Cloud Download', 'M28 78 C15 78 6 69 6 57 C6 46 14 38 24 37 C27 24 38 14 52 14 C68 14 80 26 81 41 C89 43 94 50 94 59 C94 70 85 78 74 78 Z M44 28 H56 V48 H64 L50 66 L36 48 H44 Z', { evenodd: true }),
  el('icon-upload', 'Upload', 'M46 30 V72 H54 V30 H66 L50 8 L34 30 Z M14 58 H26 V84 H74 V58 H86 V92 H14 Z'),
  el('icon-download', 'Download', 'M46 8 V50 H34 L50 72 L66 50 H54 V8 Z M14 58 H26 V84 H74 V58 H86 V92 H14 Z'),
];

const decor: LibraryElementDef[] = [
  el('decor-gear', 'Gear', gearSub(8, 48, 36, 14), { evenodd: true }),
  el('decor-flower', 'Flower', flowerSub(5, 48, 20)),
  el('decor-daisy', 'Daisy', flowerSub(8, 48, 24) + ' ' + circleSub(50, 50, 12), { evenodd: true }),
  el('decor-clover', 'Clover', flowerSub(4, 48, 16)),
  el('decor-asterisk', 'Asterisk', 'M50 10 V90 M15 30 L85 70 M85 30 L15 70', { stroke: 12 }),
  el('decor-heart-sketch', 'Sketch Heart', 'M50 84 C24 64 12 46 14 32 C16 20 28 14 38 20 C44 23 48 28 50 34 C52 28 56 23 62 20 C72 14 84 20 86 32 C88 46 76 64 50 84 Z', { stroke: 8 }),
  el('decor-drip', 'Drip', 'M6 6 H94 V18 Q94 30 88 30 Q82 30 82 20 Q82 14 76 14 Q70 14 70 34 Q70 48 63 48 Q56 48 56 24 Q56 16 50 16 Q44 16 44 60 Q44 74 36 74 Q28 74 28 28 Q28 18 22 18 Q16 18 16 40 Q16 52 10 52 Q6 52 6 44 Z'),
  el('decor-quote', 'Quote', 'M12 66 H36 V42 H24 Q24 30 36 28 V14 Q12 18 12 44 Z M52 66 H76 V42 H64 Q64 30 76 28 V14 Q52 18 52 44 Z'),
  el('decor-swoosh', 'Swoosh', 'M4 76 C28 40 66 26 96 32 C68 40 38 56 12 84 Z'),
  el('decor-crescent', 'Crescent', 'M50 2 A48 48 0 1 0 50 98 A60 60 0 0 1 50 2 Z'),
  el('decor-sun', 'Sun', starSub(50, 50, 12, 48, 0.58)),
  el('decor-banner', 'Banner', 'M4 26 H96 L84 50 L96 74 H4 L16 50 Z'),
  el('decor-squiggle', 'Squiggle', 'M8 60 C20 20 32 90 44 50 C52 24 60 76 72 44 C78 28 86 40 92 30', { stroke: 9 }),
  el('decor-branch', 'Leaf Branch',
    rectSub(48.8, 12, 2.4, 82) +
    leafSub(50, 22, 26, 10, 6) + leafSub(50, 30, 74, 18, 6) +
    leafSub(50, 42, 28, 30, 6) + leafSub(50, 50, 72, 38, 6) +
    leafSub(50, 62, 30, 50, 5.5) + leafSub(50, 70, 70, 58, 5.5) +
    leafSub(50, 82, 34, 72, 5) + leafSub(50, 88, 66, 78, 5)
  ),
  el('decor-cloud', 'Cloud', cloudSub(), { size: { width: 400, height: 280 } }),
  el('decor-cloud-outline', 'Cloud Outline', cloudSub(), { stroke: 5, size: { width: 400, height: 280 } }),
  el('decor-rings', 'Rings',
    circleSub(50, 50, 46) + circleSub(50, 50, 36) + circleSub(50, 50, 26) + circleSub(50, 50, 16) + circleSub(50, 50, 6),
    { evenodd: true }
  ),
  el('decor-spiral', 'Spiral', spiralSub(50, 50, 2.5, 44), { stroke: 6 }),
  el('decor-orbit', 'Orbit Ring', dashedCircleSub(50, 50, 42, 7, 0.6), { stroke: 5 }),
  el('decor-atom', 'Atom', rotatedEllipseSub(50, 50, 46, 17, 0) + ' ' + rotatedEllipseSub(50, 50, 46, 17, 60) + ' ' + rotatedEllipseSub(50, 50, 46, 17, 120), { stroke: 4 }),
  el('decor-burst-lines', 'Burst Lines', radialDashesSub(50, 50, 8, 20, 46, -90, 360), { stroke: 8 }),
  el('decor-rays', 'Rising Rays', radialDashesSub(50, 82, 7, 26, 50, -152, 124), { stroke: 6, size: { width: 420, height: 260 } }),
  el('decor-radiant-sun', 'Radiant Sun',
    circleSub(50, 50, 17) +
    [0, 45, 90, 135, 180, 225, 270, 315]
      .map(a => { const c = polar(50, 50, 34, a - 90); return sprinkleSub(c[0], c[1], a - 90, 15, 7); })
      .join('')
  ),
  el('decor-halftone', 'Halftone Disc', dotDiscSub()),
  el('decor-pinwheel', 'Pinwheel', swirlSub(6, 48)),
  el('decor-posy', 'Posy', flowerSub(5, 48, 22) + ' ' + circleSub(50, 50, 11), { evenodd: true }),
  el('decor-sprig', 'Berry Sprig', berrySprigSub()),
  el('decor-soundwave', 'Sound Wave', soundBarsSub([28, 52, 88, 64, 40, 20]), { size: { width: 380, height: 300 } }),
  el('decor-stairs', 'Stairs', 'M8 92 V68 H36 V44 H64 V20 H92 V92 Z'),
  el('decor-bold-asterisk', 'Bold Asterisk', sprinkleSub(50, 50, 90, 88, 18) + sprinkleSub(50, 50, 30, 88, 18) + sprinkleSub(50, 50, 150, 88, 18)),
  el('decor-crown', 'Sketch Crown', 'M14 76 L10 32 L34 50 L50 18 L66 50 L90 32 L86 76 Z M18 86 H82', { stroke: 5 }),
  el('decor-smiley', 'Smiley', 'M32 26 L30 42 M66 24 L64 40 M20 56 Q50 84 80 54', { stroke: 8 }),
  el('decor-scribble', 'Scribble', 'M12 36 C40 24 68 24 86 30 C60 34 30 42 16 50 C44 42 74 44 88 48 C60 54 32 60 20 66 C46 62 72 64 84 68', { stroke: 5 }),
  el('decor-sketch-circle', 'Sketch Circle', 'M50 12 C26 12 12 28 13 50 C14 73 31 88 53 87 C76 86 89 68 88 47 C87 27 70 13 50 14 C36 15 24 24 19 36', { stroke: 4 }),
  el('decor-check', 'Sketch Check', 'M50 10 C28 10 12 27 12 50 C12 73 29 90 52 90 C74 90 89 74 89 52 C89 34 78 18 60 12 M32 50 L46 64 L78 30', { stroke: 6 }),
  el('decor-wind', 'Wind', 'M6 36 H50 Q64 36 64 25 Q64 15 54 15 M6 52 H82 Q94 52 94 41 M6 68 H44 Q58 68 58 79 Q58 88 48 88', { stroke: 7 }),
];

const blobs: LibraryElementDef[] = [
  el('blob-1', 'Blob', blobSub([46, 34, 44, 30, 46, 36])),
  el('blob-2', 'Blob', blobSub([40, 47, 30, 45, 33, 46])),
  el('blob-3', 'Blob', blobSub([45, 29, 46, 39, 31, 47, 35])),
  el('blob-4', 'Blob', blobSub([38, 46, 33, 47, 36, 44, 30])),
  el('blob-5', 'Blob', blobSub([47, 36, 29, 45, 31, 42])),
  el('blob-6', 'Blob', blobSub([44, 41, 30, 46, 29, 39, 45, 31])),
  el('blob-7', 'Blob', blobSub([46, 31, 45, 34, 46, 30])),
  el('blob-8', 'Blob', blobSub([36, 44, 46, 31, 42, 35])),
  el('blob-soft', 'Soft Blob', blobSub([44, 40, 45, 41, 43, 39])),
  el('blob-wavy', 'Wavy Blob', blobSub([47, 27, 43, 29, 45, 31])),
  el('blob-splat', 'Splat',
    blobSub([38, 28, 36, 25, 37, 27]) + circleSub(88, 28, 5) + circleSub(82, 76, 4) + circleSub(14, 18, 3.5) + circleSub(20, 82, 3)
  ),
  el('blob-clover', 'Clover Blob', circleSub(50, 30, 23) + circleSub(31, 63, 22) + circleSub(69, 62, 23)),
  el('blob-quad', 'Lobed Blob', circleSub(34, 33, 23) + circleSub(67, 35, 21) + circleSub(33, 67, 21) + circleSub(66, 66, 23)),
  el('blob-bumpy', 'Bumpy Blob', blobSub([44, 37, 45, 36, 43, 38, 46, 36, 44, 37, 45, 36])),
  el('blob-amoeba', 'Amoeba', blobSub([45, 36, 42, 38, 46, 35, 41, 37, 44, 34, 42, 37, 46, 36]), { size: { width: 420, height: 260 } }),
  el('blob-diamond', 'Soft Diamond', blobSub([38, 47, 38, 47])),
  el('blob-bite', 'Bite Blob', blobSub([45, 46, 18, 45, 46, 44])),
  el('blob-drip', 'Drip Blob', blobSub([42, 36, 26, 49, 26, 38])),
  el('blob-pebble', 'Pebble', blobSub([30, 40, 46, 47, 45, 38])),
  el('blob-starfish', 'Starfish Splat', blobSub([44, 44, 22, 42, 43, 21, 45, 45, 23, 41, 43, 22, 44, 44, 21])),
  el('blob-burst', 'Splat Burst', blobSub([45, 26, 43, 25, 46, 27, 44, 25, 45, 26, 43, 25])),
  el('blob-peanut', 'Peanut', smoothClosedSub([[6, 50], [16, 33], [33, 25], [46, 38], [54, 38], [67, 25], [84, 33], [94, 50], [84, 67], [67, 75], [54, 62], [46, 62], [33, 75], [16, 67]])),
  el('blob-molar', 'Molar Blob', smoothClosedSub([[22, 16], [50, 42], [78, 16], [92, 46], [78, 84], [50, 60], [22, 84], [8, 46]])),
  el('blob-horned', 'Horned Blob', smoothClosedSub([[30, 18], [50, 46], [70, 18], [88, 40], [80, 80], [50, 90], [20, 80], [12, 40]])),
  el('blob-lens', 'Lens Blob', smoothClosedSub([[4, 52], [28, 39], [52, 36], [76, 40], [96, 50], [72, 62], [46, 64], [22, 60]]), { size: { width: 440, height: 170 } }),
  el('blob-bean', 'Bean', smoothClosedSub([[26, 26], [46, 42], [72, 24], [90, 46], [78, 76], [48, 86], [18, 72], [8, 44]])),
  el('blob-cloud', 'Cloud Blob', smoothClosedSub([[12, 58], [20, 38], [36, 44], [50, 28], [66, 42], [84, 34], [92, 56], [72, 74], [46, 78], [22, 72]]), { size: { width: 420, height: 260 } }),
  el('blob-step', 'Step Blob', smoothClosedSub([[16, 22], [50, 18], [60, 38], [84, 44], [86, 76], [50, 80], [38, 60], [14, 54]])),
  el('blob-drift', 'Drift Blob', smoothClosedSub([[12, 80], [20, 58], [38, 46], [56, 38], [76, 20], [92, 24], [84, 46], [64, 58], [46, 70], [28, 90]])),
  el('blob-pinched', 'Pinched Blob', smoothClosedSub([[30, 14], [68, 12], [80, 30], [58, 50], [78, 72], [66, 88], [32, 90], [20, 70], [40, 50], [22, 28]])),
  el('blob-boulder', 'Boulder', smoothClosedSub([[14, 18], [50, 10], [86, 16], [92, 52], [84, 84], [50, 92], [16, 86], [8, 50]])),
  el('blob-ink-splat', 'Ink Splat',
    polyPath(polarPts(20, 50, 50, i => [36, 16, 28, 14, 44, 18, 30, 12, 40, 20, 26, 15, 46, 14, 34, 18, 42, 13, 31, 17][i])) +
    circleSub(90, 22, 4) + circleSub(84, 80, 3) + circleSub(13, 76, 3.5) + circleSub(16, 20, 2.5)
  ),
  el('blob-rough', 'Rough Blob', polyPath(polarPts(26, 50, 50, i => [44, 39, 42, 37, 45, 40, 41, 38, 43, 36, 44, 40, 42][i % 13]))),
];

const stars: LibraryElementDef[] = [
  el('star-sparkle4', 'Sparkle', sparkleSub(50, 50, 4, 48, 0.13)),
  el('star-sparkle4-fat', 'Bold Sparkle', sparkleSub(50, 50, 4, 48, 0.24)),
  el('star-sparkle6', 'Six Sparkle', sparkleSub(50, 50, 6, 48, 0.18)),
  el('star-5', 'Star', starSub(50, 50, 5, 48, 0.48)),
  el('star-6', '6-Point Star', starSub(50, 50, 6, 48, 0.55)),
  el('star-7', '7-Point Star', starSub(50, 50, 7, 48, 0.55)),
  el('star-8', '8-Point Star', starSub(50, 50, 8, 48, 0.5)),
  el('star-burst12', 'Burst', starSub(50, 50, 12, 48, 0.78)),
  el('star-outline', 'Star Outline', starSub(50, 50, 5, 48, 0.48) + ' ' + starSub(50, 50, 5, 30, 0.48), { evenodd: true }),
  el('star-twinkle', 'Twinkle Cluster', sparkleSub(42, 56, 4, 36, 0.14) + ' ' + sparkleSub(76, 24, 4, 15, 0.16) + ' ' + sparkleSub(82, 68, 4, 10, 0.18)),
  el('star-shooting', 'Shooting Star',
    starSub(70, 32, 5, 24, 0.48, -80) +
    ' M4 78 C22 68 38 60 52 52 C38 64 24 74 8 86 Z M14 92 C28 84 40 78 50 72 C40 82 30 90 18 98 Z'
  ),
  el('star-thin4', 'Thin Star', starSub(50, 50, 4, 48, 0.18)),
  el('star-rounded5', 'Rounded Star', roundedPolySub(polarPts(10, 50, 50, i => (i % 2 === 0 ? 48 : 22)), 6)),
  el('star-puffy', 'Puffy Star', roundedPolySub(polarPts(10, 50, 50, i => (i % 2 === 0 ? 47 : 27)), 13)),
  el('star-doodle', 'Doodle Star', polyPath(polarPts(10, 50, 50, i => (i % 2 === 0 ? [48, 44, 47, 43, 46][i / 2] : 15)))),
  el('star-doodle-outline', 'Star Doodle Outline',
    polyPath(polarPts(10, 50, 50, i => (i % 2 === 0 ? [45, 43, 46, 42, 44][i / 2] : [19, 18, 20, 17, 19][(i - 1) / 2]))),
    { stroke: 4 }
  ),
  el('star-sparkle-outline', 'Sparkle Outline', sparkleSub(50, 50, 4, 45, 0.16), { stroke: 4 }),
  el('star-sketch-burst', 'Sketch Burst',
    polyPath(polarPts(24, 50, 50, i => (i % 2 === 0 ? [46, 40, 44, 38, 47, 41, 43, 39, 45, 42, 46, 40][i / 2] : 20)))
  ),
  el('star-cluster-outline', 'Sparkle Cluster Outline',
    sparkleSub(40, 58, 4, 34, 0.15) + ' ' + sparkleSub(72, 26, 4, 16, 0.17) + ' ' + sparkleSub(82, 62, 4, 9, 0.2),
    { stroke: 3.5 }
  ),
  el('star-glint', 'Glint', polyPath(polarPts(16, 50, 50, i => (i % 2 === 0 ? (i % 4 === 0 ? 48 : 28) : 4)))),
  el('star-sparkle-tall', 'Tall Sparkle', sparkleStretchSub(50, 50, 26, 48, 0.2), { size: { width: 180, height: 320 } }),
  el('star-burst-outline', 'Burst Outline', starSub(50, 50, 10, 45, 0.6), { stroke: 4 }),
  el('star-comet', 'Comet Star', polyPath(polarPts(10, 62, 50, i => (i === 0 ? 58 : i % 2 === 0 ? 25 : 12), 180))),
  el('star-sunburst16', 'Sunburst Star', starSub(50, 50, 16, 48, 0.55)),
  el('star-north', 'North Star',
    starSub(50, 50, 4, 48, 0.05) + ' ' + sparkleSub(50, 50, 4, 32, 0.2) + ' ' +
    sparkleSub(79, 27, 4, 10, 0.2) + ' ' + sparkleSub(24, 76, 4, 8, 0.2)
  ),
  el('star-thin6', 'Thin 6-Point Star', starSub(50, 50, 6, 48, 0.28)),
  el('star-glint-cluster', 'Glint Cluster',
    sparkleSub(40, 44, 4, 34, 0.15) + ' ' + sparkleSub(74, 70, 4, 16, 0.18) +
    circleSub(80, 26, 3.5) + circleSub(22, 82, 3) + circleSub(88, 46, 2.5)
  ),
  el('star-compass', 'Compass Star', polyPath(polarPts(16, 50, 50, i => (i % 2 === 0 ? (i % 4 === 0 ? 48 : 26) : 9)))),
  el('star-wavy', 'Wavy Star', roundedPolySub(polarPts(12, 50, 50, i => (i % 2 === 0 ? 47 : 29)), 9)),
];

/** Symmetric seismic-pulse profile: spiky top edge mirrored around y=50. */
const pulseTop: Pt[] = [[0, 50], [10, 44], [18, 52], [26, 30], [34, 54], [42, 10], [50, 46], [58, 18], [66, 52], [74, 34], [82, 52], [90, 45], [100, 50]];

/** Tapered filled zigzag ribbon (thick head → thin tail). */
const zigTaperSub = (): string => {
  const spine: Pt[] = [[94, 26], [26, 38], [72, 50], [18, 62], [60, 74], [6, 86]];
  const w = [6.5, 5.5, 4.5, 3.5, 2.5, 1.8];
  const top = spine.map(([x, y], i): Pt => [x, y - w[i]]);
  const bot = spine.map(([x, y], i): Pt => [x, y + w[i]]).reverse();
  return polyPath([...top, ...bot]);
};

/** One thin vertical zigzag stroke centered at x. */
const vZigSub = (x: number): string => {
  let d = `M${fmt(x - 5)} 6`;
  for (let i = 1; i <= 8; i++) d += ` L${fmt(i % 2 === 1 ? x + 5 : x - 5)} ${fmt(6 + i * 11)}`;
  return d;
};

const waves: LibraryElementDef[] = [
  el('wave-line', 'Wave Line', sineStrokeSub(2.5, 16, 50), { stroke: 12, size: { width: 460, height: 150 } }),
  el('wave-squiggle', 'Squiggle Line', sineStrokeSub(4, 10, 50), { stroke: 10, size: { width: 460, height: 150 } }),
  el('wave-ribbon', 'Wave Ribbon', waveRibbonSub(2, 10, 36, 26), { size: { width: 480, height: 160 } }),
  el('wave-block', 'Wave Fill', waveBlockSub(2.5, 10, 40), { size: { width: 420, height: 280 } }),
  el('wave-block-top', 'Wave Fill Top', waveBlockSub(2, 12, 55, true), { size: { width: 420, height: 280 } }),
  el('wave-double', 'Double Wave', sineStrokeSub(3, 9, 32) + ' ' + sineStrokeSub(3, 9, 68), { stroke: 10, size: { width: 460, height: 180 } }),
  el('wave-zigzag', 'Zigzag', zigzagStrokeSub(4, 16, 50), { stroke: 10, size: { width: 460, height: 150 } }),
  el('wave-zigzag-ribbon', 'Zigzag Ribbon', zigzagRibbonSub(3, 14, 32, 24), { size: { width: 460, height: 170 } }),
  el('wave-loops', 'Loop Squiggle', 'M4 60 C10 30 26 30 30 52 C34 74 20 78 18 62 C16 44 40 30 52 48 C62 64 48 76 44 60 C40 44 62 28 78 44 C88 54 84 66 96 60', { stroke: 9, size: { width: 440, height: 170 } }),
  el('wave-bars', 'Wave Bars', waveRibbonSub(2, 7, 10, 14) + ' ' + waveRibbonSub(2, 7, 44, 14) + ' ' + waveRibbonSub(2, 7, 78, 14), { size: { width: 420, height: 260 } }),

  /* thin filled strips */
  el('wave-strip', 'Soft Strip', stripSub([[0, 50], [16, 42], [34, 54], [52, 42], [70, 54], [86, 44], [100, 50]], 66), { size: { width: 480, height: 110 } }),
  el('wave-hill', 'Hill Band', stripSub([[0, 60], [28, 42], [58, 52], [100, 46]], 66), { size: { width: 480, height: 110 } }),
  el('wave-lens', 'Lens Band', bandSub([[0, 54], [48, 40], [100, 50]], [[0, 56], [52, 62], [100, 52]]), { size: { width: 480, height: 110 } }),
  el('wave-ramp', 'Ramp Band', stripSub([[0, 62], [40, 58], [72, 46], [100, 38]], 66), { size: { width: 480, height: 110 } }),
  el('wave-scoop-strip', 'Scoop Band', stripSub([[0, 34], [18, 42], [50, 58], [82, 42], [100, 34]], 70), { size: { width: 480, height: 130 } }),
  el('wave-rough-band', 'Rough Band', polyPath([[0, 72], [0, 56], [8, 46], [16, 56], [26, 42], [34, 58], [44, 44], [52, 60], [62, 42], [70, 56], [80, 44], [88, 58], [100, 48], [100, 72]]), { size: { width: 460, height: 140 } }),

  /* filled blocks */
  el('wave-crest-block', 'Crest Fill', stripSub([[0, 52], [18, 26], [38, 54], [60, 22], [82, 50], [100, 36]], 100), { size: { width: 420, height: 280 } }),
  el('wave-scoop-block', 'Scoop Fill', stripSub([[0, 26], [28, 22], [52, 56], [78, 28], [100, 18]], 100), { size: { width: 420, height: 280 } }),
  el('wave-wavy-block', 'Wavy Block', bandSub([[0, 20], [26, 10], [52, 24], [78, 10], [100, 18]], [[0, 84], [26, 78], [52, 92], [78, 78], [100, 86]]), { size: { width: 440, height: 300 } }),
  el('wave-flag', 'Waving Flag', bandSub([[0, 22], [34, 8], [68, 22], [100, 10]], [[0, 92], [34, 78], [68, 94], [100, 80]]), { size: { width: 440, height: 300 } }),
  el('wave-swoop-block', 'Swoop Fill', 'M0 84 C36 82 58 34 100 26 V100 H0 Z', { size: { width: 420, height: 280 } }),
  el('wave-corner-block', 'Corner Wave', 'M0 12 C8 48 34 70 100 76 V100 H0 Z', { size: { width: 420, height: 280 } }),
  el('wave-terrace', 'Terrace Fill', roundedPolySub([[0, 100], [0, 92], [12, 88], [18, 72], [36, 66], [42, 50], [60, 44], [66, 28], [84, 22], [90, 8], [100, 6], [100, 100]], 7), { size: { width: 420, height: 300 } }),
  el('wave-scallop-block', 'Scallop Fill', 'M0 16 H100 V54 A16.67 16.67 0 0 1 66.66 54 A16.67 16.67 0 0 1 33.33 54 A16.67 16.67 0 0 1 0 54 Z', { size: { width: 420, height: 240 } }),
  el('wave-cloud-block', 'Cloud Fill', 'M0 14 H100 V64 C90 64 92 86 74 86 C60 86 64 66 50 66 C40 66 44 92 26 92 C12 92 16 70 0 74 Z', { size: { width: 420, height: 280 } }),
  el('wave-cornice', 'Cornice', 'M2 20 H98 V38 C82 38 76 60 56 58 C40 56 34 42 18 46 C8 48 2 56 2 58 Z', { size: { width: 420, height: 220 } }),
  el('wave-audio', 'Waveform Fill', polyPath([[0, 100], [0, 66], [5, 50], [10, 62], [15, 34], [20, 56], [25, 22], [30, 52], [35, 30], [40, 58], [45, 14], [50, 48], [55, 28], [60, 56], [65, 38], [70, 60], [75, 46], [82, 62], [100, 64], [100, 100]]), { size: { width: 420, height: 260 } }),
  el('wave-pulse', 'Sound Pulse', polyPath([...pulseTop, ...[...pulseTop].reverse().map(([x, y]): Pt => [x, 100 - y])]), { size: { width: 440, height: 240 } }),

  /* calligraphic brush strokes */
  el('wave-brush', 'Brush Wave', brushStrokeSub([[4, 34], [28, 22], [52, 62], [76, 28], [96, 40]], t => 1.5 + 7 * Math.sin(Math.PI * t)), { size: { width: 420, height: 180 } }),
  el('wave-swoosh', 'Swoosh', brushStrokeSub([[6, 52], [32, 68], [60, 58], [94, 16]], t => 1.2 + 8.5 * (1 - t)), { size: { width: 380, height: 200 } }),
  el('wave-calligraphic', 'Calligraphic Wave', brushStrokeSub([[4, 68], [30, 42], [62, 36], [96, 46]], t => 1 + 8 * Math.sin(Math.PI * t)), { size: { width: 420, height: 160 } }),
  el('wave-s-brush', 'S Swoosh', brushStrokeSub([[6, 78], [34, 82], [52, 50], [68, 18], [94, 24]], t => 1.2 + 8 * Math.sin(Math.PI * t)), { size: { width: 360, height: 260 } }),
  el('wave-brush-vertical', 'Brush Curve', brushStrokeSub([[64, 8], [42, 24], [56, 52], [38, 90]], t => 10.5 - 6 * t), { size: { width: 220, height: 340 } }),
  el('wave-double-swoosh', 'Double Swoosh',
    brushStrokeSub([[8, 88], [16, 42], [28, 12], [38, 46], [44, 86]], t => 2 + 2.5 * Math.sin(Math.PI * t)) + ' ' +
    brushStrokeSub([[40, 88], [48, 42], [60, 12], [70, 46], [76, 86]], t => 2 + 2.5 * Math.sin(Math.PI * t)) + ' ' +
    brushStrokeSub([[72, 88], [80, 46], [92, 24]], t => 2 + 2 * Math.sin(Math.PI * t)),
    { size: { width: 300, height: 300 } }),
  el('wave-zig-taper', 'Taper Zigzag', zigTaperSub(), { size: { width: 360, height: 240 } }),

  /* worms & squiggles */
  el('wave-worm', 'Worm Squiggle', brushStrokeSub([[22, 16], [58, 10], [74, 26], [54, 42], [26, 50], [24, 72], [50, 84], [78, 74]], () => 6.5), { size: { width: 320, height: 320 } }),
  el('wave-blob-worm', 'Blob Worm', circleSub(26, 86, 9.5) + circleSub(36, 74, 9) + circleSub(38, 58, 9.5) + circleSub(50, 48, 9) + circleSub(60, 36, 9.5) + circleSub(56, 20, 9) + circleSub(70, 12, 9), { size: { width: 300, height: 320 } }),
  el('wave-coil', 'Snake Coil', brushStrokeSub([[24, 14], [68, 10], [84, 22], [70, 34], [28, 30], [14, 44], [28, 58], [72, 54], [86, 66], [72, 80], [26, 76], [14, 88]], () => 5), { size: { width: 340, height: 340 } }),
  el('wave-squiggle-thin', 'Thin Squiggle', smoothOpenSub([[6, 36], [20, 20], [32, 38], [18, 54], [30, 72], [50, 60], [46, 40], [64, 26], [80, 44], [70, 64], [86, 80], [94, 66]]), { stroke: 4, size: { width: 320, height: 320 } }),
  el('wave-loop-wave', 'Loop Wave', smoothOpenSub([[4, 72], [24, 64], [38, 40], [32, 18], [50, 14], [60, 32], [46, 54], [56, 70], [80, 68], [96, 58]]), { stroke: 8, size: { width: 380, height: 240 } }),
  el('wave-curls', 'Curl Wave', smoothOpenSub([[64, 6], [44, 10], [52, 24], [66, 20], [48, 34], [38, 46], [54, 54], [68, 48], [50, 62], [40, 76], [56, 84], [72, 78]]), { stroke: 5, size: { width: 200, height: 340 } }),
  el('wave-wiggle-vertical', 'Wiggle Down', smoothOpenSub([[44, 4], [34, 14], [58, 22], [34, 34], [58, 46], [34, 58], [58, 70], [34, 82], [52, 92]]), { stroke: 6, size: { width: 170, height: 340 } }),
  el('wave-worm-vertical', 'Dancing Worm', brushStrokeSub([[38, 12], [58, 22], [52, 40], [32, 48], [38, 66], [60, 64], [64, 84], [42, 92]], () => 7), { size: { width: 200, height: 340 } }),
  el('wave-cursive', 'Cursive Squiggle', smoothOpenSub([[6, 78], [12, 48], [22, 28], [28, 48], [22, 72], [18, 86], [30, 64], [40, 34], [48, 50], [42, 74], [38, 88], [52, 62], [62, 36], [72, 46], [66, 70], [70, 84], [84, 66], [94, 52]]), { stroke: 6.5, size: { width: 340, height: 260 } }),
  el('wave-sketch-zigzag', 'Sketch Zigzag', smoothOpenSub([[6, 64], [20, 44], [26, 58], [40, 38], [46, 56], [58, 34], [62, 52], [74, 30], [78, 48], [90, 26], [94, 40]]), { stroke: 3, size: { width: 380, height: 220 } }),

  /* line sets */
  el('wave-lines', 'Wave Lines', sineStrokeSub(2.5, 6, 14) + ' ' + sineStrokeSub(2.5, 6, 38) + ' ' + sineStrokeSub(2.5, 6, 62) + ' ' + sineStrokeSub(2.5, 6, 86), { stroke: 6, size: { width: 380, height: 300 } }),
  el('wave-zigzag-vertical', 'Vertical Zigzags', vZigSub(26) + ' ' + vZigSub(50) + ' ' + vZigSub(74), { stroke: 3.5, size: { width: 300, height: 340 } }),
];

const laurels: LibraryElementDef[] = [
  el('laurel-wreath', 'Laurel Wreath',
    laurelBranchSub(50, 50, 40, 88, 252, 12, 14, 3.8) + ' ' + laurelBranchSub(50, 50, 40, 92, -72, 12, 14, 3.8),
    { size: { width: 340, height: 340 } }
  ),
  el('laurel-wreath-dense', 'Dense Wreath',
    laurelBranchSub(50, 50, 42, 86, 258, 16, 12, 3.2) + ' ' + laurelBranchSub(50, 50, 42, 94, -78, 16, 12, 3.2),
    { size: { width: 340, height: 340 } }
  ),
  el('laurel-half', 'Half Wreath',
    laurelBranchSub(50, 50, 42, 120, 244, 11, 14, 3.8) + ' ' + laurelBranchSub(50, 50, 42, 60, -64, 11, 14, 3.8),
    { size: { width: 360, height: 320 } }
  ),
  el('laurel-bottom', 'Bottom Wreath',
    laurelBranchSub(50, 46, 42, 88, 186, 10, 13, 3.6) + ' ' + laurelBranchSub(50, 46, 42, 92, -6, 10, 13, 3.6),
    { size: { width: 380, height: 300 } }
  ),
  el('laurel-branch-left', 'Branch Left', laurelBranchSub(96, 50, 62, 128, 218, 12, 13, 3.6), { size: { width: 260, height: 340 } }),
  el('laurel-branch-right', 'Branch Right', laurelBranchSub(4, 50, 62, 52, -38, 12, 13, 3.6), { size: { width: 260, height: 340 } }),
  el('laurel-diagonal', 'Laurel Branch', laurelBranchSub(110, 110, 102, 192, 258, 11, 13, 3.8), { size: { width: 340, height: 340 } }),
  el('laurel-sprigs', 'Crossed Sprigs',
    laurelBranchSub(88, 108, 78, 218, 268, 8, 12, 3.4) + ' ' + laurelBranchSub(12, 108, 78, 322, 272, 8, 12, 3.4),
    { size: { width: 360, height: 300 } }
  ),
  el('laurel-feather', 'Curved Branch', laurelBranchSub(-10, 110, 102, -12, -78, 11, 13, 3.8), { size: { width: 340, height: 340 } }),
  el('laurel-circle', 'Circle Wreath',
    laurelBranchSub(50, 50, 41, 92, 262, 15, 12, 3.2) + ' ' + laurelBranchSub(50, 50, 41, 88, -82, 15, 12, 3.2),
    { size: { width: 340, height: 340 } }
  ),
  el('laurel-delicate', 'Delicate Wreath',
    laurelBranchSub(50, 50, 42, 90, 258, 19, 8, 2.2) + ' ' + laurelBranchSub(50, 50, 42, 90, -78, 19, 8, 2.2),
    { size: { width: 340, height: 340 } }
  ),
  el('laurel-thin', 'Thin Wreath',
    laurelBranchSub(50, 50, 42, 90, 256, 12, 9.5, 2.4) + ' ' + laurelBranchSub(50, 50, 42, 90, -76, 12, 9.5, 2.4),
    { size: { width: 340, height: 340 } }
  ),
  el('laurel-award', 'Award Wreath',
    laurelBranchSub(50, 44, 36, 70, 248, 11, 12, 3.2) + ' ' + laurelBranchSub(50, 44, 36, 110, -68, 11, 12, 3.2) +
    rectSub(48.3, 81.5, 3.4, 13) + rectSub(43.5, 86.3, 13, 3.4),
    { size: { width: 340, height: 340 } }
  ),
  el('laurel-round-open', 'Round Branches',
    laurelBranchSub(50, 50, 43, 108, 252, 12, 12, 3.2) + ' ' + laurelBranchSub(50, 50, 43, 72, -72, 12, 12, 3.2),
    { size: { width: 340, height: 340 } }
  ),
  el('laurel-open', 'Open Wreath',
    laurelBranchSub(50, 50, 32, 126, 234, 6, 10, 2.8) + ' ' + laurelBranchSub(50, 50, 32, 54, -54, 6, 10, 2.8),
    { size: { width: 280, height: 280 } }
  ),
  el('laurel-columns', 'Facing Branches',
    laurelBranchSub(120, 50, 88, 158, 202, 12, 11, 3) + ' ' + laurelBranchSub(-20, 50, 88, 22, -22, 12, 11, 3),
    { size: { width: 300, height: 360 } }
  ),
  el('laurel-columns-sparse', 'Sparse Branches',
    laurelBranchSub(120, 50, 88, 160, 200, 7, 9, 2.5) + ' ' + laurelBranchSub(-20, 50, 88, 20, -20, 7, 9, 2.5),
    { size: { width: 300, height: 360 } }
  ),
  el('laurel-sprig-pair', 'Sprig Pair',
    laurelBranchSub(112, 50, 82, 162, 197, 7, 11, 3) + ' ' + laurelBranchSub(-12, 50, 82, 18, -17, 7, 11, 3),
    { size: { width: 300, height: 300 } }
  ),
  el('laurel-sprig-pair-small', 'Small Sprigs',
    laurelBranchSub(110, 55, 78, 165, 193, 5, 10, 2.8) + ' ' + laurelBranchSub(-10, 55, 78, 15, -13, 5, 10, 2.8),
    { size: { width: 260, height: 240 } }
  ),
  el('laurel-sprig-pair-tiny', 'Tiny Sprigs',
    laurelBranchSub(108, 58, 74, 168, 190, 4, 8, 2.4) + ' ' + laurelBranchSub(-8, 58, 74, 12, -10, 4, 8, 2.4),
    { size: { width: 220, height: 200 } }
  ),
  el('laurel-flare', 'Flared Sprigs',
    laurelBranchSub(55, 20, 55, 103, 163, 8, 12, 3.2) + ' ' + laurelBranchSub(45, 20, 55, 77, 17, 8, 12, 3.2),
    { size: { width: 380, height: 280 } }
  ),
  el('laurel-wings', 'Laurel Wings',
    laurelBranchSub(50, -30, 84, 93, 124, 8, 11, 3) + ' ' + laurelBranchSub(50, -30, 84, 87, 56, 8, 11, 3),
    { size: { width: 420, height: 220 } }
  ),
  el('laurel-bottom-dense', 'Dense Bottom Wreath',
    laurelBranchSub(50, 44, 44, 88, 196, 13, 13, 3.4) + ' ' + laurelBranchSub(50, 44, 44, 92, -16, 13, 13, 3.4),
    { size: { width: 380, height: 300 } }
  ),
];

const lines: LibraryElementDef[] = [
  el('line-solid', 'Line', 'M4 50 H96', { stroke: 6, size: { width: 420, height: 60 } }),
  el('line-thin', 'Thin Line', 'M4 50 H96', { stroke: 3, size: { width: 420, height: 60 } }),
  el('line-hairline', 'Hairline', 'M4 50 H96', { stroke: 1.5, size: { width: 420, height: 60 } }),
  el('line-dashed', 'Dashed Line', dashedLineSub(50, 12, 8), { stroke: 5, size: { width: 420, height: 60 } }),
  el('line-dash-dot', 'Dash-Dot Line', dashDotLineSub(50), { stroke: 4, size: { width: 420, height: 60 } }),
  el('line-dotted', 'Dotted Line', dottedLineSub(50, 2.8, 8.8), { size: { width: 420, height: 60 } }),
  el('line-arrow', 'Arrow Line', 'M4 50 H90 M78 38 L92 50 L78 62', { stroke: 5, size: { width: 420, height: 60 } }),
  el('line-arrow-thin', 'Thin Arrow', 'M4 50 H92 M82 42 L94 50 L82 58', { stroke: 2.5, size: { width: 420, height: 60 } }),
  el('line-double-arrow', 'Double Arrow Line', 'M10 50 H90 M78 38 L92 50 L78 62 M22 38 L8 50 L22 62', { stroke: 5, size: { width: 420, height: 60 } }),
  el('line-double-arrow-thin', 'Thin Double Arrow', 'M8 50 H92 M82 42 L94 50 L82 58 M18 42 L6 50 L18 58', { stroke: 2.5, size: { width: 420, height: 60 } }),
  el('line-dotted-arrow', 'Dotted Arrow', dottedLineSub(50, 2.4, 8.6, 6, 80) + polyPath([[85, 41.5], [96, 50], [85, 58.5]]), { size: { width: 420, height: 60 } }),
  el('line-dotted-double-arrow', 'Dotted Double Arrow', polyPath([[15, 41.5], [4, 50], [15, 58.5]]) + dottedLineSub(50, 2.4, 8.6, 22, 78) + polyPath([[85, 41.5], [96, 50], [85, 58.5]]), { size: { width: 420, height: 60 } }),
  el('line-dots-ends', 'Dot Ends', rectSub(12, 47.5, 76, 5) + circleSub(9, 50, 5.5) + circleSub(91, 50, 5.5), { size: { width: 420, height: 60 } }),
  el('line-square-ends', 'Square Ends', rectSub(16, 47.8, 68, 4.4) + rectSub(6, 43, 10, 14) + rectSub(84, 43, 10, 14), { size: { width: 420, height: 70 } }),
  el('line-double', 'Double Line', rectSub(4, 40, 92, 5) + rectSub(4, 55, 92, 5), { size: { width: 420, height: 60 } }),
  el('line-bars-bold', 'Bold Bars', rectSub(8, 28, 84, 16) + rectSub(8, 56, 84, 16), { size: { width: 340, height: 180 } }),
  el('line-needle', 'Tapered Line', brushStrokeSub([[4, 50], [50, 50], [96, 50]], t => 0.5 + 2.8 * Math.sin(Math.PI * t)), { size: { width: 420, height: 50 } }),
  el('line-marker', 'Marker Stroke', brushStrokeSub([[5, 52], [50, 48], [95, 51]], t => 3.6 + Math.sin(Math.PI * t)), { size: { width: 420, height: 70 } }),
  el('line-brush-swoosh', 'Brush Swoosh', brushStrokeSub([[4, 74], [34, 64], [68, 44], [96, 22]], t => 0.7 + 4.2 * Math.sin(Math.PI * t)), { size: { width: 420, height: 150 } }),
  el('line-brush-arc', 'Brush Arc', brushStrokeSub([[6, 66], [36, 38], [68, 32], [94, 42]], t => 0.6 + 3.8 * Math.sin(Math.PI * t)), { size: { width: 420, height: 140 } }),
  el('line-double-arc', 'Double Arc', brushStrokeSub([[10, 88], [18, 52], [40, 24], [72, 12]], t => 3.5 - 2.7 * t) + ' ' + brushStrokeSub([[32, 92], [40, 64], [58, 44], [82, 36]], t => 3.1 - 2.3 * t), { size: { width: 320, height: 320 } }),
  el('line-cross', 'Crossed Lines', 'M6 63 L94 37 M36 8 L64 92', { stroke: 2, size: { width: 320, height: 320 } }),
  el('line-curls', 'Curl Line', curlLineSub(3, 50, 10, 14, 8, 92), { stroke: 2.5, size: { width: 420, height: 110 } }),
  el('line-ribbon-scribble', 'Ribbon Scribble', smoothOpenSub([[6, 66], [18, 44], [32, 42], [38, 56], [28, 68], [16, 60], [24, 42], [44, 30], [58, 40], [54, 58], [40, 58], [42, 42], [62, 30], [80, 34], [94, 26]]), { stroke: 2.5, size: { width: 420, height: 160 } }),
  el('line-underline', 'Underline Swoosh', 'M4 58 C30 44 68 42 96 48 C70 50 34 56 10 68 Z', { size: { width: 420, height: 80 } }),
  el('line-flourish', 'Flourish', 'M8 52 C34 38 66 36 92 42 C66 44 36 50 14 60 Z M22 68 C42 60 62 58 82 62 C62 64 44 68 28 74 Z', { size: { width: 420, height: 90 } }),
];

const patterns: LibraryElementDef[] = [
  el('pattern-grid', 'Grid', gridLinesSub(6, 1.6), { size: { width: 380, height: 380 } }),
  el('pattern-grid-fine', 'Fine Grid', gridLinesSub(12, 0.7), { size: { width: 380, height: 380 } }),
  el('pattern-grid-wide', 'Open Grid', gridLinesSub(4, 1), { size: { width: 380, height: 380 } }),
  el('pattern-grid-bold', 'Bold Grid', boldGridSub(3, 7), { size: { width: 380, height: 380 } }),
  el('pattern-grid-dashed', 'Stitch Grid', dashedGridSub(5, 4, 3.6), { stroke: 1.6, size: { width: 380, height: 380 } }),
  el('pattern-dots', 'Dot Grid', dotGridSub(6, 6, 2.6), { size: { width: 380, height: 380 } }),
  el('pattern-dots-big', 'Big Dots', dotGridSub(4, 4, 6, 14), { size: { width: 380, height: 380 } }),
  el('pattern-dots-fine', 'Halftone Dots', dotGridSub(10, 10, 1.7, 6), { size: { width: 380, height: 380 } }),
  el('pattern-diamonds', 'Diamond Grid', diamondGridSub(5, 5, 3.6, 5), { size: { width: 380, height: 380 } }),
  el('pattern-checker', 'Checker', checkerSub(6), { size: { width: 380, height: 380 } }),
  el('pattern-plus', 'Plus Grid', plusGridSub(), { size: { width: 380, height: 380 } }),
  el('pattern-x', 'X Marks', xMarksSub(), { stroke: 3.5, size: { width: 380, height: 380 } }),
  el('pattern-asterisks', 'Asterisk Grid', asteriskGridSub(4, 7), { stroke: 2.2, size: { width: 380, height: 380 } }),
  el('pattern-diagonal', 'Diagonal Lines', diagLinesSub(13), { stroke: 3, size: { width: 380, height: 380 } }),
  el('pattern-crosshatch', 'Crosshatch', diagLinesSub(16) + ' ' + antiDiagLinesSub(16), { stroke: 2.5, size: { width: 380, height: 380 } }),
  el('pattern-vlines', 'Vertical Lines', verticalLinesSub(9), { stroke: 3, size: { width: 380, height: 380 } }),
  el('pattern-barcode', 'Line Rhythm', barcodeSub(15), { stroke: 2.4, size: { width: 380, height: 380 } }),
  el('pattern-waves', 'Waves', sineStrokeSub(3, 6, 14) + ' ' + sineStrokeSub(3, 6, 38) + ' ' + sineStrokeSub(3, 6, 62) + ' ' + sineStrokeSub(3, 6, 86), { stroke: 4, size: { width: 380, height: 380 } }),
  el('pattern-ripples', 'Ripples', [10, 26, 42, 58, 74, 90].map(y => sineStrokeSub(4, 3, y)).join(' '), { stroke: 2.2, size: { width: 380, height: 380 } }),
  el('pattern-vwaves', 'Vertical Waves', [10, 20, 30, 40, 50, 60, 70, 80, 90].map(x => vSineStrokeSub(3, 2.6, x)).join(' '), { stroke: 2.2, size: { width: 380, height: 380 } }),
  el('pattern-diag-waves', 'Wavy Stripes', waveDiagSub(7, 3, 26, 3.3), { size: { width: 380, height: 380 } }),
  el('pattern-flag', 'Wave Bands', waveRibbonSub(1.5, 5.5, 10, 15) + ' ' + waveRibbonSub(1.5, 5.5, 42, 15) + ' ' + waveRibbonSub(1.5, 5.5, 74, 15), { size: { width: 380, height: 380 } }),
  el('pattern-zigzag', 'Zigzag Rows', zigzagStrokeSub(4, 7, 14) + ' ' + zigzagStrokeSub(4, 7, 38) + ' ' + zigzagStrokeSub(4, 7, 62) + ' ' + zigzagStrokeSub(4, 7, 86), { stroke: 4, size: { width: 380, height: 380 } }),
  el('pattern-scratches', 'Scratch Rows', scratchRowsSub(6), { stroke: 1.6, size: { width: 380, height: 380 } }),
  el('pattern-scribble', 'Scribble Texture', scribbleSub(8, 6.5, 3), { stroke: 1.8, size: { width: 380, height: 380 } }),
  el('pattern-contour', 'Flow Contours', contourSub(9), { stroke: 1.8, size: { width: 380, height: 380 } }),
  el('pattern-maze-round', 'Round Maze', truchetSub(5, 4.6), { size: { width: 380, height: 380 } }),
  el('pattern-maze-thin', 'Loop Maze', truchetArcsSub(7), { stroke: 2, size: { width: 380, height: 380 } }),
  el('pattern-worm-maze', 'Worm Maze', brushStrokeSub([[14, 14], [56, 10], [78, 12], [86, 22], [78, 32], [56, 34], [22, 32], [13, 42], [20, 52], [52, 50], [80, 52], [87, 62], [80, 72], [50, 70], [20, 74], [13, 84], [24, 92], [64, 88], [86, 86]], () => 4.5), { size: { width: 380, height: 380 } }),
  el('pattern-scales', 'Scales', scalesSub(5, 5), { stroke: 3, size: { width: 380, height: 380 } }),
  el('pattern-triangles', 'Triangles', triangleTileSub(), { size: { width: 380, height: 380 } }),
  el('pattern-spots', 'Organic Spots', spotSub(20, 20, 13, [1, 0.82, 1.12, 0.78, 1.05, 0.9]) + spotSub(60, 13, 9, [0.9, 1.1, 0.8, 1.05, 0.95]) + spotSub(87, 40, 9.5, [1.05, 0.85, 1.1, 0.8, 1, 0.92]) + spotSub(38, 54, 13, [0.85, 1.1, 0.9, 1.08, 0.8, 1]) + spotSub(13, 78, 8, [1, 0.85, 1.1, 0.9, 1.02]) + spotSub(58, 84, 11, [0.92, 1.08, 0.82, 1.06, 0.95, 1.02]) + spotSub(87, 79, 6, [1, 0.9, 1.08, 0.88, 1.02]) + circleSub(45, 30, 2.6) + circleSub(79, 15, 2.4) + circleSub(70, 40, 2.2) + circleSub(16, 47, 2.4) + circleSub(84, 60, 2.4) + circleSub(33, 92, 2.3), { size: { width: 380, height: 380 } }),
  el('pattern-noodles', 'Squiggle Noodles', brushStrokeSub([[8, 16], [20, 9], [32, 19], [42, 11]], () => 2.8) + ' ' + brushStrokeSub([[56, 22], [68, 12], [80, 22], [92, 13]], () => 2.8) + ' ' + brushStrokeSub([[12, 45], [24, 36], [36, 46], [46, 37]], () => 2.8) + ' ' + brushStrokeSub([[60, 54], [72, 44], [84, 54], [94, 45]], () => 2.8) + ' ' + brushStrokeSub([[8, 78], [20, 68], [32, 78], [44, 69]], () => 2.8) + ' ' + brushStrokeSub([[56, 88], [68, 78], [80, 88], [92, 79]], () => 2.8), { size: { width: 380, height: 380 } }),
  el('pattern-doodles', 'Bold Doodles', brushStrokeSub([[12, 26], [30, 10], [44, 26], [28, 38], [16, 26]], () => 4.2) + ' ' + brushStrokeSub([[58, 12], [76, 24], [90, 10]], () => 4.2) + ' ' + brushStrokeSub([[10, 66], [26, 52], [44, 66], [62, 52], [78, 66]], () => 4.2) + ' ' + brushStrokeSub([[52, 86], [68, 72], [84, 88], [94, 76]], () => 4.2), { size: { width: 380, height: 380 } }),
  el('pattern-curls', 'Doodle Curls', spiralSub(22, 24, 1.75, 14) + ' ' + spiralSub(66, 16, 1.4, 10) + ' ' + spiralSub(44, 58, 1.75, 15) + ' ' + spiralSub(86, 52, 1.4, 10) + ' ' + spiralSub(18, 82, 1.4, 10) + ' ' + spiralSub(70, 86, 1.6, 12), { stroke: 2, size: { width: 380, height: 380 } }),
  el('pattern-memphis', 'Sprinkles', memphisSprinklesSub(), { size: { width: 380, height: 380 } }),
  el('pattern-sparkle-flow', 'Sparkle Stream', brushStrokeSub([[44, 4], [56, 22], [40, 44], [58, 68], [44, 88], [50, 97]], () => 1.3) + brushStrokeSub([[53, 4], [65, 22], [49, 44], [67, 68], [53, 88], [59, 97]], () => 1.3) + sparkleSub(20, 16, 4, 7) + sparkleSub(78, 30, 4, 5) + sparkleSub(18, 56, 4, 5.5) + sparkleSub(80, 72, 4, 7) + circleSub(26, 80, 2) + circleSub(72, 12, 2), { size: { width: 380, height: 380 } }),
  el('pattern-liquid', 'Liquid Flow', brushStrokeSub([[18, 8], [62, 14], [80, 30], [52, 42], [20, 52], [34, 74], [74, 80], [88, 68]], t => 4.5 + 4.5 * Math.sin(Math.PI * t)), { size: { width: 380, height: 380 } }),
];

export const ELEMENT_CATEGORIES: ElementCategory[] = [
  { id: 'shapes', label: 'Shapes', items: shapes },
  { id: 'arrows', label: 'Arrows', items: arrows },
  { id: 'icons', label: 'Icons', items: icons },
  { id: 'decor', label: 'Decor', items: decor },
  { id: 'blobs', label: 'Blobs', items: blobs },
  { id: 'stars', label: 'Stars', items: stars },
  { id: 'waves', label: 'Waves', items: waves },
  { id: 'laurels', label: 'Laurel Wreath', items: laurels },
  { id: 'lines', label: 'Lines', items: lines },
  { id: 'patterns', label: 'Background Patterns', items: patterns },
];
