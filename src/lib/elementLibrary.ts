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

const dashedLineSub = (y: number, dash: number, gap: number): string => {
  let d = '';
  for (let x = 2; x < 98; x += dash + gap) {
    d += ` M${fmt(x)} ${fmt(y)} H${fmt(Math.min(x + dash, 98))}`;
  }
  return d.trim();
};

const dottedLineSub = (y: number, r: number, step: number): string => {
  let d = '';
  for (let x = 6; x <= 94; x += step) d += circleSub(x, y, r);
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
];

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
];

const lines: LibraryElementDef[] = [
  el('line-solid', 'Line', 'M4 50 H96', { stroke: 6, size: { width: 420, height: 60 } }),
  el('line-thin', 'Thin Line', 'M4 50 H96', { stroke: 3, size: { width: 420, height: 60 } }),
  el('line-dashed', 'Dashed Line', dashedLineSub(50, 12, 8), { stroke: 5, size: { width: 420, height: 60 } }),
  el('line-dotted', 'Dotted Line', dottedLineSub(50, 2.8, 8.8), { size: { width: 420, height: 60 } }),
  el('line-arrow', 'Arrow Line', 'M4 50 H90 M78 38 L92 50 L78 62', { stroke: 5, size: { width: 420, height: 60 } }),
  el('line-double-arrow', 'Double Arrow Line', 'M10 50 H90 M78 38 L92 50 L78 62 M22 38 L8 50 L22 62', { stroke: 5, size: { width: 420, height: 60 } }),
  el('line-dots-ends', 'Dot Ends', rectSub(12, 47.5, 76, 5) + circleSub(9, 50, 5.5) + circleSub(91, 50, 5.5), { size: { width: 420, height: 60 } }),
  el('line-double', 'Double Line', rectSub(4, 40, 92, 5) + rectSub(4, 55, 92, 5), { size: { width: 420, height: 60 } }),
  el('line-underline', 'Underline Swoosh', 'M4 58 C30 44 68 42 96 48 C70 50 34 56 10 68 Z', { size: { width: 420, height: 80 } }),
  el('line-flourish', 'Flourish', 'M8 52 C34 38 66 36 92 42 C66 44 36 50 14 60 Z M22 68 C42 60 62 58 82 62 C62 64 44 68 28 74 Z', { size: { width: 420, height: 90 } }),
];

const patterns: LibraryElementDef[] = [
  el('pattern-grid', 'Grid', gridLinesSub(6, 1.6), { size: { width: 380, height: 380 } }),
  el('pattern-dots', 'Dot Grid', dotGridSub(6, 6, 2.6), { size: { width: 380, height: 380 } }),
  el('pattern-dots-big', 'Big Dots', dotGridSub(4, 4, 6, 14), { size: { width: 380, height: 380 } }),
  el('pattern-diagonal', 'Diagonal Lines', diagLinesSub(13), { stroke: 3, size: { width: 380, height: 380 } }),
  el('pattern-crosshatch', 'Crosshatch', diagLinesSub(16) + ' ' + antiDiagLinesSub(16), { stroke: 2.5, size: { width: 380, height: 380 } }),
  el('pattern-vlines', 'Vertical Lines', verticalLinesSub(9), { stroke: 3, size: { width: 380, height: 380 } }),
  el('pattern-waves', 'Waves', sineStrokeSub(3, 6, 14) + ' ' + sineStrokeSub(3, 6, 38) + ' ' + sineStrokeSub(3, 6, 62) + ' ' + sineStrokeSub(3, 6, 86), { stroke: 4, size: { width: 380, height: 380 } }),
  el('pattern-zigzag', 'Zigzag Rows', zigzagStrokeSub(4, 7, 14) + ' ' + zigzagStrokeSub(4, 7, 38) + ' ' + zigzagStrokeSub(4, 7, 62) + ' ' + zigzagStrokeSub(4, 7, 86), { stroke: 4, size: { width: 380, height: 380 } }),
  el('pattern-checker', 'Checker', checkerSub(6), { size: { width: 380, height: 380 } }),
  el('pattern-plus', 'Plus Grid', plusGridSub(), { size: { width: 380, height: 380 } }),
  el('pattern-x', 'X Marks', xMarksSub(), { stroke: 3.5, size: { width: 380, height: 380 } }),
  el('pattern-scales', 'Scales', scalesSub(5, 5), { stroke: 3, size: { width: 380, height: 380 } }),
  el('pattern-triangles', 'Triangles', triangleTileSub(), { size: { width: 380, height: 380 } }),
  el('pattern-memphis', 'Sprinkles', memphisSprinklesSub(), { size: { width: 380, height: 380 } }),
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
