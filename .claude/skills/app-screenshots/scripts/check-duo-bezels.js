/**
 * Checks the 3D Studio iPhone Duo (src/lib/device3dModels.ts) against Apple's
 * product bezels for it, which draw the phone's faces at the outer display's
 * pixel pitch: open from the front (the inner display), closed from the front
 * (the outer display), and open from the back (the cameras and the outer
 * display).
 *
 * Apple has published no dimensional drawing for the Duo yet. Get the bezels
 * the way a designer would, under Apple's licence: developer.apple.com/design
 * /resources, Product Bezels, iPhone Duo (Bezel-iPhone-Duo.dmg). Open the disk
 * image and point this script at its PNG folder. Nothing from it is copied
 * into the repo; the overlays it writes stay in OUT.
 *
 * Run from the repo root:
 *   BEZELS="<the PNG folder>" node .claude/skills/app-screenshots/scripts/check-duo-bezels.js
 *
 * Each face is scaled by the 117.8 mm height on Apple's tech specs page, and
 * the model's outlines are measured against the bezel's edges along their
 * normals: the body and the hinge notch, both displays, the outer camera hole
 * and earpiece slot, the closed spine, the camera island (where the matte
 * back's grain stops), the lenses, the flash, and where each back's glass
 * meets its frame. It prints one line per check in millimetres, writes an
 * overlay PNG per face (red outline, cyan displays, yellow cameras and slot,
 * magenta glass) and sources.json with each input's SHA-256. OUT=<dir> sets
 * where they go (default %TEMP%/duo-bezel-check).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHash } = require('crypto');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { EDGE } = require('./lib');

const REPO = path.resolve(__dirname, '../../../..');
const OUT_DIR = process.env.OUT ? path.resolve(process.env.OUT) : path.join(os.tmpdir(), 'duo-bezel-check');
const BEZELS = process.env.BEZELS || process.argv[2];

const FACES = {
  inner: 'iPhone Duo - Night Sky - Inner Open Landscape.png',
  closed: 'iPhone Duo - Night Sky - Outer Closed Portrait.png',
  back: 'iPhone Duo - Star White - Outer Open.png',
  backDark: 'iPhone Duo - Night Sky - Outer Open.png',
};

const HARNESS_TS = `
import { measuredModelFor } from './src/lib/device3dModels';
import { cornerRectEach, displayShape, insetCorner, islandFootprint, leafBack, leafOutline, smoothCorner } from './src/lib/device3dGeometry';
const m = measuredModelFor('iphone-duo')!;
const fold = m.fold!;
const outer = fold.outer;
const pts = (o: { x: number; y: number; nx: number; ny: number }[]) => o.map((p) => [p.x, p.y, p.nx, p.ny]);
const free = insetCorner(smoothCorner(m.corner), m.width / 2 - outer.hinge - outer.width);
const hinge = smoothCorner(outer.hingeCorner);
// The outer display as the closed phone shows it: x from the hinge line, y up from the middle.
const outerScreen = cornerRectEach(outer.hinge, -outer.height / 2, outer.hinge + outer.width, outer.height / 2, {
  topLeft: hinge, bottomLeft: hinge, topRight: free, bottomRight: free,
});
const island = m.pads.find((p) => p.shape === 'stadium' || p.shape === 'rounded');
(window as any).duo = {
  width: m.width,
  height: m.height,
  closedWidth: fold.closedWidth,
  right: pts(leafOutline(m, 'right')),
  left: pts(leafOutline(m, 'left')),
  rightGlass: pts(leafBack(m, 'right').glass),
  leftGlass: pts(leafBack(m, 'left').glass),
  display: pts(displayShape(m).outline),
  outerScreen: pts(outerScreen),
  camera: outer.camera,
  receiver: outer.receiver,
  backInset: fold.back.inset,
  island: island ? pts(islandFootprint(m, island as never)) : [],
  lenses: m.lenses,
  flash: m.flash,
  buttons: m.buttons,
};
`;

(async () => {
  if (!BEZELS || !fs.existsSync(path.join(BEZELS, FACES.inner))) {
    console.error(
      'Point BEZELS at the PNG folder of Apple\'s iPhone Duo product bezels (developer.apple.com/design/resources,\n' +
        'Product Bezels, iPhone Duo: open Bezel-iPhone-Duo.dmg and use its PNG folder).'
    );
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const inputs = {};
  const files = [];
  for (const [face, name] of Object.entries(FACES)) {
    const bytes = fs.readFileSync(path.join(BEZELS, name));
    files.push({ face, name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    inputs[face] = `data:image/png;base64,${bytes.toString('base64')}`;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'sources.json'), JSON.stringify({ schemaVersion: 1, source: 'Apple Design Resources, Bezel-iPhone-Duo', files }, null, 2) + '\n');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-bezels-'));
  const harnessPath = path.join(REPO, '__tmp_duo_bezels.ts');
  const bundlePath = path.join(work, 'bundle.js');
  fs.writeFileSync(harnessPath, HARNESS_TS);
  try {
    execSync(`npx esbuild __tmp_duo_bezels.ts --bundle --alias:@=./src --outfile="${bundlePath}"`, { cwd: REPO, stdio: 'pipe' });
  } finally {
    fs.rmSync(harnessPath, { force: true });
  }
  const htmlPath = path.join(work, 'check.html');
  fs.writeFileSync(htmlPath, `<!doctype html><html><body><script>${fs.readFileSync(bundlePath, 'utf8')}</script></body></html>`);

  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  const page = (await browser.pages())[0] ?? await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  const result = await page.evaluate(checkInPage, inputs);
  for (const face of Object.keys(result.overlays)) {
    fs.writeFileSync(path.join(OUT_DIR, `${face}.png`), Buffer.from(result.overlays[face].split(',')[1], 'base64'));
  }
  for (const line of result.lines) console.log(line);
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\nOverlays in ${OUT_DIR}`);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

/** Runs in the page: measure the model against the three faces and draw the overlays. */
async function checkInPage(inputs) {
  const duo = window.duo;
  const lines = [];
  const overlays = {};
  const load = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  /** An image's pixels, with sampling helpers. */
  async function face(src) {
    const image = await load(src);
    const W = image.naturalWidth;
    const H = image.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, W, H).data;
    const at = (x, y, channel) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + channel]);
    const lumAt = (x, y) => 0.2126 * at(x, y, 0) + 0.7152 * at(x, y, 1) + 0.0722 * at(x, y, 2);
    const bilinear = (fn) => (x, y) => {
      const x0 = Math.floor(x - 0.5);
      const y0 = Math.floor(y - 0.5);
      const fx = x - 0.5 - x0;
      const fy = y - 0.5 - y0;
      return fn(x0, y0) * (1 - fx) * (1 - fy) + fn(x0 + 1, y0) * fx * (1 - fy) + fn(x0, y0 + 1) * (1 - fx) * fy + fn(x0 + 1, y0 + 1) * fx * fy;
    };
    const alpha = bilinear((x, y) => at(x, y, 3) / 255);
    const lum = bilinear(lumAt);
    // How much bluer than red: the outer display's glass edge is a bluish ring, the seal and frame are neutral.
    const blue = bilinear((x, y) => at(x, y, 2) - at(x, y, 0));
    // The matte back's grain: the spread of luminance left after a 3 x 3 mean, over 5 x 5.
    const grain = (x, y) => {
      const cx = Math.round(x);
      const cy = Math.round(y);
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          let mean = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) mean += lumAt(cx + dx + i, cy + dy + j);
          const hp = lumAt(cx + dx, cy + dy) - mean / 9;
          sum += hp * hp;
        }
      }
      return Math.sqrt(sum / 25);
    };
    /** The edge by alpha coverage along a row or column, from outside. */
    const cover = (fixed, along, fromStart) => {
      const n = along === 'row' ? W : H;
      const read = (k) => (along === 'row' ? at(k, fixed, 3) : at(fixed, k, 3));
      let k = fromStart ? 0 : n - 1;
      const step = fromStart ? 1 : -1;
      while (k >= 0 && k < n && read(k) < 1) k += step;
      let cov = 0;
      while (k >= 0 && k < n && read(k) < 254) {
        cov += read(k) / 255;
        k += step;
      }
      return fromStart ? k - cov : k + 1 + cov;
    };
    return { image, W, H, alpha, lum, blue, grain, cover, canvas, ctx };
  }

  const median = (v) => {
    const s = [...v].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  const range = (a, b, step) => {
    const out = [];
    for (let v = Math.round(a); v < Math.round(b); v += step) out.push(v);
    return out;
  };
  /** Statistics of signed offsets; with `near`, offsets past it count as no edge there (and are reported as such). */
  const stats = (label, d, near = Infinity) => {
    const v = d.filter((x) => x !== null && Math.abs(x) <= near);
    const missed = d.length - v.length;
    if (!v.length) {
      lines.push(`  ${label}: no edge found`);
      return;
    }
    const abs = v.map(Math.abs);
    const rms = Math.sqrt(abs.reduce((s, x) => s + x * x, 0) / abs.length);
    const note = missed && Number.isFinite(near) ? `; ${missed} more show no edge within ${near} mm` : '';
    lines.push(`  ${label}: max ${Math.max(...abs).toFixed(3)}  rms ${rms.toFixed(3)}  mean ${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(3)} mm (${v.length} points${note})`);
  };
  /** An outline with points added along its long straight runs, each with its run's normal. */
  const densify = (outline, step = 0.5) => {
    const out = [];
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length];
      out.push(p);
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const nx = (q[1] - p[1]) / len;
      const ny = -(q[0] - p[0]) / len;
      for (let k = 1; k < Math.floor(len / step); k++) {
        const t = (k * step) / len;
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, nx, ny]);
      }
    });
    return out;
  };

  /**
   * Signed distance in mm (+ outward along the normal) from a model point to
   * where `field` crosses `level` going outward: from above it when
   * `insideHigh`, from below otherwise. toPx maps model mm to image pixels.
   */
  const edgeOffset = (field, toPx, s, [x, y, nx, ny], insideHigh, level = 0.5, reach = 30) => {
    const [px, py] = toPx(x, y);
    const [qx, qy] = toPx(x + nx * 0.01, y + ny * 0.01);
    const len = Math.hypot(qx - px, qy - py);
    const ux = (qx - px) / len;
    const uy = (qy - py) / len;
    let best = null;
    for (let t = -reach; t <= reach; t += 0.25) {
      const v0 = field(px + ux * (t - 0.25), py + uy * (t - 0.25));
      const v1 = field(px + ux * t, py + uy * t);
      const crosses = insideHigh ? v0 >= level && v1 < level : v0 < level && v1 >= level;
      if (crosses) {
        const tc = t - 0.25 + (0.25 * (v0 - level)) / (v0 - v1);
        if (best === null || Math.abs(tc) < Math.abs(best)) best = tc;
      }
    }
    return best === null ? null : best * s;
  };
  /** A circle fitted (least squares) through where `field` crosses `level` on rays out from a centre. */
  const circleAt = (field, cx, cy, r0, r1, level, rising) => {
    const pts = [];
    for (let k = 0; k < 360; k++) {
      const t = (k / 360) * Math.PI * 2;
      let prev = field(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0);
      for (let r = r0 + 0.25; r <= r1; r += 0.25) {
        const v = field(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
        if (rising ? prev < level && v >= level : prev > level && v <= level) {
          const rr = r - 0.25 + (0.25 * (level - prev)) / (v - prev);
          pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
          break;
        }
        prev = v;
      }
    }
    // Kasa fit.
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
    for (const [x, y] of pts) {
      const z = x * x + y * y;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
    }
    const n = pts.length;
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    const b = [sxz, syz, sz];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const solve = (i) => det(A.map((row, r) => row.map((v, c) => (c === i ? b[r] : v))));
    const D = det(A);
    const a = solve(0) / D;
    const bb = solve(1) / D;
    const c = solve(2) / D;
    const fx = a / 2;
    const fy = bb / 2;
    return { x: fx, y: fy, r: Math.sqrt(c + fx * fx + fy * fy), n };
  };
  const draw = (f, toPx, outline, color, closed = true) => {
    const { ctx } = f;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    outline.forEach(([x, y], i) => {
      const [px, py] = toPx(x, y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (closed) ctx.closePath();
    ctx.stroke();
  };
  /** A pill from (x0, y0) to (x1, y1) with ends of radius r, as outline points. */
  const roundRectPts = (x0, y0, x1, y1, r) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      pts.push([x1 - r + r * Math.cos(a), (y0 + y1) / 2 + r * Math.sin(a)]);
    }
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI / 2 + (i / 12) * Math.PI;
      pts.push([x0 + r + r * Math.cos(a), (y0 + y1) / 2 + r * Math.sin(a)]);
    }
    return pts;
  };
  const ring = (cx, cy, r, steps = 72) => Array.from({ length: steps }, (_, i) => [cx + r * Math.cos((i / steps) * 2 * Math.PI), cy + r * Math.sin((i / steps) * 2 * Math.PI), Math.cos((i / steps) * 2 * Math.PI), Math.sin((i / steps) * 2 * Math.PI)]);
  const W = duo.width;
  const H = duo.height;

  // ---- open, from the front ------------------------------------------------
  {
    const f = await face(inputs.inner);
    // Clear of the side button, the volume buttons and the hinge.
    const rows = range(f.H * 0.62, f.H * 0.82, 3);
    const cols = range(f.W * 0.15, f.W * 0.3, 3);
    const left = median(rows.map((y) => f.cover(y, 'row', true)));
    const right = median(rows.map((y) => f.cover(y, 'row', false)));
    const top = median(cols.map((x) => f.cover(x, 'col', true)));
    const bottom = median(cols.map((x) => f.cover(x, 'col', false)));
    const s = H / (bottom - top);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const toPx = (x, y) => [cx + x / s, cy - y / s];
    lines.push(`\nopen, front (${(s * 1000).toFixed(4)} um a pixel from the 117.8 mm height)`);
    lines.push(`  body ${((right - left) * s).toFixed(3)} x ${H.toFixed(3)} mm; the spec page has 164.6 x 117.8`);
    const onButton = (x, y) =>
      duo.buttons.some((b) =>
        b.side === 'top'
          ? y > H / 2 - 1 && Math.abs(x - (b.center - W / 2)) < b.length / 2 + 1.5
          : b.side === 'right' && x > W / 2 - 1 && Math.abs(H / 2 - b.center - y) < b.length / 2 + 1.5
      );
    // Where the halves meet down the middle is no edge, only the notch at each end is.
    const seam = (x, y) => Math.abs(x) < 1.2 && Math.abs(y) < H / 2 - 1.2;
    const outline = [...duo.right, ...duo.left].filter(([x, y]) => !onButton(x, y) && !seam(x, y));
    stats('outline, both halves and the hinge notch', outline.map((p) => edgeOffset(f.alpha, toPx, s, p, true)));
    stats('hinge notch only', outline.filter(([x]) => Math.abs(x) < 1.2).map((p) => edgeOffset(f.alpha, toPx, s, p, true)));
    stats('inner display vs the screen opening', duo.display.map((p) => edgeOffset(f.alpha, toPx, s, p, false)));
    draw(f, toPx, duo.right, '#ff2a2a');
    draw(f, toPx, duo.left, '#ff2a2a');
    draw(f, toPx, duo.display, '#00e5ff');
    overlays.inner = f.canvas.toDataURL('image/png');
  }

  // ---- closed, from the front: the left half's back ---------------------------
  {
    const f = await face(inputs.closed);
    const rows = range(f.H * 0.62, f.H * 0.85, 3);
    const cols = range(f.W * 0.25, f.W * 0.4, 3);
    const right = median(rows.map((y) => f.cover(y, 'row', false)));
    const spineEdge = median(rows.map((y) => f.cover(y, 'row', true)));
    const top = median(cols.map((x) => f.cover(x, 'col', true)));
    const bottom = median(cols.map((x) => f.cover(x, 'col', false)));
    const s = H / (bottom - top);
    const hingeLine = right - W / 2 / s;
    const cy = (top + bottom) / 2;
    // Closed-view x runs out from the hinge line to the free edge.
    const toPx = (x, y) => [hingeLine + x / s, cy - y / s];
    lines.push(`\nclosed, front (${(s * 1000).toFixed(4)} um a pixel)`);
    lines.push(`  body ${((right - spineEdge) * s).toFixed(3)} x ${H.toFixed(3)} mm; the spec page has ${duo.closedWidth} x 117.8`);
    lines.push(`  spine stands ${((hingeLine - spineEdge) * s).toFixed(3)} mm past the halves here; the model takes the spec page's ${(duo.closedWidth - W / 2).toFixed(3)}`);
    // The left half seen closed: its x mirrored. The right half's buttons peek out round it.
    const half = duo.left.map(([x, y, nx, ny]) => [-x, y, -nx, ny]);
    const hidden = (x, y) =>
      x < 2 ||
      duo.buttons.some((b) =>
        b.side === 'top'
          ? y > H / 2 - 1 && Math.abs(x - (b.center - W / 2)) < b.length / 2 + 1.5
          : b.side === 'right' && x > W / 2 - 1 && Math.abs(H / 2 - b.center - y) < b.length / 2 + 1.5
      );
    stats('outline of the half, free side, top and bottom', half.filter(([x, y]) => !hidden(x, y)).map((p) => edgeOffset(f.alpha, toPx, s, p, true)));
    stats('outer display vs the screen opening', duo.outerScreen.map((p) => edgeOffset(f.alpha, toPx, s, p, false)));
    const cam = duo.camera;
    const [ex, ey] = toPx(W / 2 - cam.x, H / 2 - cam.y);
    const fit = circleAt(f.alpha, ex, ey, 0, (cam.d / s) * 0.8, 0.5, false);
    lines.push(
      `  camera hole: diameter ${(2 * fit.r * s).toFixed(3)} (model ${cam.d}), centre off by ${((fit.x - ex) * s).toFixed(3)}, ${((ey - fit.y) * s).toFixed(3)} mm (x, y up)`
    );
    // The earpiece slot: along the top, where the glass's edge (its bluish
    // ring) steps down past the straight edge by more than half the slot.
    {
      const slot = duo.receiver;
      const glassTop = H / 2 - duo.backInset;
      const along = [];
      for (let x = slot.from - 3; x <= slot.to + 3; x += 0.05) {
        along.push([x, edgeOffset(f.blue, toPx, s, [x, glassTop, 0, 1], true, 6, 12)]);
      }
      const level = median(along.filter(([x]) => x < slot.from - 1 || x > slot.to + 1).map(([, o]) => o ?? 0));
      const inside = along.filter(([, o]) => o !== null && o < level - slot.depth / 2);
      const depth = median(inside.filter(([x]) => x > slot.from + 1 && x < slot.to - 1).map(([, o]) => level - o));
      lines.push(
        `  earpiece slot: ${inside[0][0].toFixed(2)} to ${inside[inside.length - 1][0].toFixed(2)} from the hinge line, ${depth.toFixed(3)} deep (model ${slot.from} to ${slot.to}, ${slot.depth})`
      );
      draw(f, toPx, roundRectPts(slot.from, glassTop - slot.depth, slot.to, glassTop, slot.depth / 2), '#ffd400');
    }
    draw(f, toPx, half, '#ff2a2a');
    draw(f, toPx, duo.outerScreen, '#00e5ff');
    draw(f, toPx, ring(W / 2 - cam.x, H / 2 - cam.y, cam.d / 2), '#ffd400');
    overlays.closed = f.canvas.toDataURL('image/png');
  }

  // ---- open, from the back --------------------------------------------------
  for (const which of ['back', 'backDark']) {
    const f = await face(inputs[which]);
    const rows = range(f.H * 0.62, f.H * 0.85, 3);
    const cols = range(f.W * 0.58, f.W * 0.72, 3);
    const left = median(rows.map((y) => f.cover(y, 'row', true)));
    const right = median(rows.map((y) => f.cover(y, 'row', false)));
    const top = median(cols.map((x) => f.cover(x, 'col', true)));
    const bottom = median(cols.map((x) => f.cover(x, 'col', false)));
    const s = H / (bottom - top);
    // Seen from the back, the image's left edge is the right half's free side.
    const toPx = (x, y) => [left + (W / 2 - x) / s, top + (H / 2 - y) / s];
    const fromBack = (bx, by) => [W / 2 - bx, H / 2 - by];
    if (which === 'back') {
      lines.push(`\nopen, back (${(s * 1000).toFixed(4)} um a pixel)`);
      lines.push(`  body ${((right - left) * s).toFixed(3)} x ${H.toFixed(3)} mm`);
      const screen = duo.outerScreen.map(([x, y, nx, ny]) => [-x, y, -nx, ny]);
      stats('outer display vs the screen opening', screen.map((p) => edgeOffset(f.alpha, toPx, s, p, false)));
      // The island's footprint is where the matte back's grain starts.
      stats('camera island footprint vs the grain edge', duo.island.map((p) => edgeOffset(f.grain, toPx, s, p, false, 2, 12)));
      for (const [i, lens] of duo.lenses.entries()) {
        const [mx, my] = fromBack(lens.x, lens.y);
        const [ex, ey] = toPx(mx, my);
        // The dark lens glass inside the bright ring.
        const fit = circleAt(f.lum, ex, ey, (lens.glass / s) * 0.35, (lens.ring / s) * 0.6, 120, true);
        lines.push(
          `  lens ${i + 1}: glass ${(2 * fit.r * s).toFixed(3)} (model ${lens.glass}), centre off by ${((ex - fit.x) * s).toFixed(3)}, ${((fit.y - ey) * s).toFixed(3)} mm (back view x, y down)`
        );
        draw(f, toPx, ring(mx, my, lens.ring / 2), '#ffd400');
        draw(f, toPx, ring(mx, my, lens.glass / 2), '#ffd400');
      }
      // Where each back's glass meets its frame. The frosted back glass stops
      // at a dark seal line, and the outer display's black glass ends in a
      // bluish ring that the neutral seal and frame do not have. Round the
      // free corners' diagonals the frame's highlight washes the seal out,
      // so an edge further off than 0.3 mm counts as none found there.
      stats('back glass vs where the bezel draws it', densify(duo.rightGlass).map((p) => edgeOffset(f.lum, toPx, s, p, true, 150, 12)), 0.3);
      // The earpiece slot steps the outer glass's top edge down; it is checked on the closed face.
      const overSlot = ([x, y]) => y > H / 2 - 2 && -x > duo.receiver.from - 0.5 && -x < duo.receiver.to + 0.5;
      stats(
        "outer display's glass vs where the bezel draws it",
        densify(duo.leftGlass)
          .filter((p) => !overSlot(p))
          .map((p) => edgeOffset(f.blue, toPx, s, p, true, 6, 12)),
        0.3
      );
      draw(f, toPx, screen, '#00e5ff');
      draw(f, toPx, duo.island, '#ffd400');
      draw(f, toPx, duo.right, '#ff2a2a');
      draw(f, toPx, duo.left, '#ff2a2a');
      draw(f, toPx, duo.rightGlass, '#ff3df2');
      draw(f, toPx, duo.leftGlass, '#ff3df2');
      overlays.back = f.canvas.toDataURL('image/png');
    } else if (duo.flash) {
      // The flash shows best bright on the dark finish.
      const [mx, my] = fromBack(duo.flash.x, duo.flash.y);
      const [ex, ey] = toPx(mx, my);
      const fit = circleAt(f.lum, ex, ey, 0, (duo.flash.d / s) * 0.8, 90, false);
      lines.push(
        `  flash: diameter ${(2 * fit.r * s).toFixed(3)} (model ${duo.flash.d}), centre off by ${((ex - fit.x) * s).toFixed(3)}, ${((fit.y - ey) * s).toFixed(3)} mm (back view x, y down)`
      );
    }
  }
  return { lines, overlays };
}
