/**
 * Checks the 3D Studio Pixels (src/lib/device3dModels.ts) against Google's
 * own device frames: the Android Studio device art in AOSP
 * (platform/tools/adt/idea, artwork/resources/device-art-resources), which
 * draws each phone's front at its display's pixel pitch.
 *
 * For each model it fetches the frame, finds the phone's edges in it, scales
 * it to the size on Google's spec page (the model's width and height), and
 * measures how far the model's computed outline, display corners and camera
 * hole sit from the frame's. The Pixel 3 XL's notch is compared with the
 * cutout path in its AOSP device config instead. Each model also gets an
 * overlay PNG: the model in red (outline), cyan (display), yellow (cutout and
 * front parts), and the AOSP notch path in green.
 *
 * Run from the repo root:
 *   node .claude/skills/app-screenshots/scripts/check-pixel-frames.js [model ...]
 *
 * OUT=<dir> sets where the overlays and the downloaded frames go (default
 * %TEMP%/pixel-frame-check). Prints one line per check, in millimetres, and
 * writes sources.json with the pinned revisions and SHA-256 of each input.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { createHash } = require('crypto');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { EDGE } = require('./lib');

const REPO = path.resolve(__dirname, '../../../..');
const OUT_DIR = process.env.OUT ? path.resolve(process.env.OUT) : path.join(os.tmpdir(), 'pixel-frame-check');
const ART_REVISION = 'dc1eb17d39caa792c3779cca828930047d380bbb';
const CROSSHATCH_REVISION = 'b5ead9091ccc0e686e8afd1bffe7a1d596bab8f3';
const ART = `https://android.googlesource.com/platform/tools/adt/idea/+/${ART_REVISION}/artwork/resources/device-art-resources`;
const CROSSHATCH = `https://android.googlesource.com/device/google/crosshatch/+/${CROSSHATCH_REVISION}/crosshatch/overlay/frameworks/base/core/res/res/values/config.xml`;
const sources = new Map();

/** Where each model's frame lives, and the file that masks its display corners when the frame draws the screen opaque. */
const FRAMES = {
  'pixel-10-pro': { dir: 'pixel_10_pro', image: 'back.webp' },
  'pixel-10a': { dir: 'pixel_10a', image: 'back.webp' },
  'pixel-4': { dir: 'pixel_4', image: 'back.webp', mask: 'mask.webp' },
  'pixel-3-xl': { dir: 'pixel_3_xl', image: 'port_back.webp', mask: 'round_corners.webp' },
};

const HARNESS_TS = `
import { measuredModelFor, displayInsetsOf } from './src/lib/device3dModels';
import { cutoutPolygons, phoneOutline, displayShape } from './src/lib/device3dGeometry';
const ids = ${JSON.stringify(Object.keys(FRAMES))};
(window as any).models = Object.fromEntries(ids.map((id) => {
  const m = measuredModelFor(id as never)!;
  return [id, {
    width: m.width,
    height: m.height,
    outline: phoneOutline(m).map((p) => [p.x, p.y, p.nx, p.ny]),
    display: displayShape(m).outline.map((p) => [p.x, p.y, p.nx, p.ny]),
    insets: displayInsetsOf(m),
    cutout: m.cutout,
    front: m.front ?? [],
    buttons: m.buttons,
    // The notch the renderer draws from the model's cutout path: mm, y down from the display's top.
    notchPath: m.cutout.kind === 'notch' && m.cutout.path ? cutoutPolygons(m.cutout.path.d, m.cutout.path.pixel) : null,
  }];
}));
`;

/** One file from a gitiles tree, as bytes. */
function fetchGitiles(url) {
  return new Promise((resolve, reject) => {
    https
      .get(`${url}?format=TEXT`, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.from(Buffer.concat(chunks).toString('ascii'), 'base64')));
      })
      .on('error', reject);
  });
}

async function cached(name, url) {
  const revision = /\/\+\/([a-f0-9]{40})\//.exec(url)?.[1];
  if (!revision) throw new Error(`Source URL must name a commit: ${url}`);
  const file = path.join(OUT_DIR, 'cache', revision, name);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await fetchGitiles(url));
  }
  const bytes = fs.readFileSync(file);
  sources.set(url, {
    name,
    url,
    revision,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    cachePath: path.relative(OUT_DIR, file).replace(/\\/g, '/'),
  });
  return bytes;
}

/** The display's size and where the frame puts it, from the frame's layout file. */
function parseLayout(text) {
  const display = /display\s*\{[^}]*?width\s+(\d+)[^}]*?height\s+(\d+)/.exec(text);
  const device = /part2\s*\{[^}]*?name\s+device[^}]*?x\s+(-?\d+)[^}]*?y\s+(-?\d+)/.exec(text);
  if (!display || !device) throw new Error('Could not read the layout file');
  return { width: Number(display[1]), height: Number(display[2]), x: Number(device[1]), y: Number(device[2]) };
}

/** The AOSP notch path (display pixels, origin top centre), from the device config. */
function parseCutout(xml) {
  const m = /name="config_mainBuiltInDisplayCutout">([\s\S]*?)<\/string>/.exec(xml);
  if (!m) throw new Error('No config_mainBuiltInDisplayCutout');
  return m[1].trim();
}

(async () => {
  const only = process.argv.slice(2);
  const ids = only.length ? only : Object.keys(FRAMES);
  for (const id of ids) if (!FRAMES[id]) throw new Error(`No frame for ${id}; known: ${Object.keys(FRAMES).join(', ')}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const inputs = {};
  for (const id of ids) {
    const f = FRAMES[id];
    const layout = parseLayout((await cached(`${f.dir}/layout`, `${ART}/${f.dir}/layout`)).toString('utf8'));
    const image = (await cached(`${f.dir}/${f.image}`, `${ART}/${f.dir}/${f.image}`)).toString('base64');
    const mask = f.mask ? (await cached(`${f.dir}/${f.mask}`, `${ART}/${f.dir}/${f.mask}`)).toString('base64') : null;
    inputs[id] = { layout, image: `data:image/webp;base64,${image}`, mask: mask && `data:image/webp;base64,${mask}` };
  }
  const notchPath = ids.includes('pixel-3-xl') ? parseCutout((await cached('crosshatch-config.xml', CROSSHATCH)).toString('utf8')) : null;
  fs.writeFileSync(path.join(OUT_DIR, 'sources.json'), JSON.stringify({
    schemaVersion: 1,
    models: ids,
    revisions: { artwork: ART_REVISION, cutout: CROSSHATCH_REVISION },
    files: [...sources.values()],
  }, null, 2) + '\n');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-frames-'));
  const harnessPath = path.join(REPO, '__tmp_pixel_frames.ts');
  const bundlePath = path.join(work, 'bundle.js');
  fs.writeFileSync(harnessPath, HARNESS_TS);
  try {
    execSync(`npx esbuild __tmp_pixel_frames.ts --bundle --alias:@=./src --outfile="${bundlePath}"`, { cwd: REPO, stdio: 'pipe' });
  } finally {
    fs.rmSync(harnessPath, { force: true });
  }
  const htmlPath = path.join(work, 'check.html');
  fs.writeFileSync(htmlPath, `<!doctype html><html><body><script>${fs.readFileSync(bundlePath, 'utf8')}</script></body></html>`);

  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  const page = (await browser.pages())[0] ?? await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });

  for (const id of ids) {
    const result = await page.evaluate(checkInPage, id, inputs[id], id === 'pixel-3-xl' ? notchPath : null);
    fs.writeFileSync(path.join(OUT_DIR, `${id}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${id}-top.png`), Buffer.from(result.top.split(',')[1], 'base64'));
    console.log(`\n${id}  (frame ${result.scale})`);
    for (const line of result.lines) console.log(`  ${line}`);
  }
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\nOverlays in ${OUT_DIR}`);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

/** Runs in the page: measure one model against its frame and draw the overlay. */
async function checkInPage(id, input, notchPath) {
  const model = window.models[id];
  const load = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  const image = await load(input.image);
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const alpha = ctx.getImageData(0, 0, W, H).data;
  const a = (x, y) => {
    // Bilinear alpha, 0..1.
    const x0 = Math.floor(x - 0.5);
    const y0 = Math.floor(y - 0.5);
    const fx = x - 0.5 - x0;
    const fy = y - 0.5 - y0;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : alpha[(yy * W + xx) * 4 + 3] / 255);
    return (
      at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
    );
  };

  // The body's edges by alpha coverage, away from the corners and the buttons
  // (which stand out of the right side).
  const coverRow = (y, fromLeft) => {
    let x = fromLeft ? 0 : W - 1;
    const step = fromLeft ? 1 : -1;
    while (x >= 0 && x < W && alpha[(y * W + x) * 4 + 3] < 1) x += step;
    let cov = 0;
    let k = x;
    while (k >= 0 && k < W && alpha[(y * W + k) * 4 + 3] < 254) {
      cov += alpha[(y * W + k) * 4 + 3] / 255;
      k += step;
    }
    return fromLeft ? k - cov : k + 1 + cov;
  };
  const coverCol = (x, fromTop) => {
    let y = fromTop ? 0 : H - 1;
    const step = fromTop ? 1 : -1;
    while (y >= 0 && y < H && alpha[(y * W + x) * 4 + 3] < 1) y += step;
    let cov = 0;
    let k = y;
    while (k >= 0 && k < H && alpha[(k * W + x) * 4 + 3] < 254) {
      cov += alpha[(k * W + x) * 4 + 3] / 255;
      k += step;
    }
    return fromTop ? k - cov : k + 1 + cov;
  };
  const median = (v) => {
    const s = [...v].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  const rows = [];
  for (let y = Math.round(H * 0.62); y < Math.round(H * 0.82); y += 3) rows.push(y);
  const left = median(rows.map((y) => coverRow(y, true)));
  const right = median(rows.map((y) => coverRow(y, false)));
  const cols = [];
  for (let x = Math.round(W * 0.3); x < Math.round(W * 0.45); x += 3) cols.push(x);
  const top = median(cols.map((x) => coverCol(x, true)));
  const bottom = median(cols.map((x) => coverCol(x, false)));
  const sx = model.width / (right - left);
  const sy = model.height / (bottom - top);
  // Model millimetres (centre origin, y up) to frame pixels.
  const toPx = (x, y) => [left + (x + model.width / 2) / sx, top + (model.height / 2 - y) / sy];
  const lines = [];
  const stats = (label, d) => {
    if (!d.length) return;
    const abs = d.map(Math.abs);
    const rms = Math.sqrt(abs.reduce((s, v) => s + v * v, 0) / abs.length);
    lines.push(`${label}: max ${Math.max(...abs).toFixed(3)}  rms ${rms.toFixed(3)}  (${d.length} points)`);
  };

  /** Signed distance (mm, + outward) from a model point to where `field` crosses 0.5 along its normal. */
  const edgeOffset = (field, x, y, nx, ny, insideHigh, reach = 30) => {
    const [px, py] = toPx(x, y);
    const nxp = nx / sx;
    const nyp = -ny / sy;
    const len = Math.hypot(nxp, nyp);
    const ux = nxp / len;
    const uy = nyp / len;
    let best = null;
    for (let t = -reach; t <= reach; t += 0.25) {
      const v0 = field(px + ux * (t - 0.25), py + uy * (t - 0.25));
      const v1 = field(px + ux * t, py + uy * t);
      const crosses = insideHigh ? v0 >= 0.5 && v1 < 0.5 : v0 < 0.5 && v1 >= 0.5;
      if (crosses) {
        const tc = t - 0.25 + (0.25 * (v0 - 0.5)) / (v0 - v1);
        if (best === null || Math.abs(tc) < Math.abs(best)) best = tc;
      }
    }
    return best === null ? null : best * Math.sqrt(sx * sy);
  };

  // ---- the outline, skipping where a button stands out of the side
  const onButton = (x, y) =>
    model.buttons.some((b) => (b.side === 'right' ? x > 0 : x < 0) && Math.abs(model.height / 2 - b.center - y) < b.length / 2 + 1.5);
  const outlineD = [];
  for (const [x, y, nx, ny] of model.outline) {
    if (onButton(x, y)) continue;
    const d = edgeOffset(a, x, y, nx, ny, true);
    if (d !== null) outlineD.push(d);
  }
  stats('outline vs frame edge', outlineD);

  // ---- the display: the frame's transparent screen opening, or its corner mask
  const lay = input.layout;
  let field;
  if (input.mask) {
    const mask = await load(input.mask);
    const mc = document.createElement('canvas');
    mc.width = mask.naturalWidth;
    mc.height = mask.naturalHeight;
    const mctx = mc.getContext('2d');
    mctx.drawImage(mask, 0, 0);
    const md = mctx.getImageData(0, 0, mc.width, mc.height).data;
    // Opaque mask is outside the display; past the mask's own edge is outside too.
    field = (x, y) => {
      const mx = Math.floor(x - lay.x);
      const my = Math.floor(y - lay.y);
      if (mx < 0 || my < 0 || mx >= mc.width || my >= mc.height) return 1;
      return md[(my * mc.width + mx) * 4 + 3] / 255;
    };
  } else {
    field = a;
  }
  const insideDisplay = (x, y) => {
    const [px, py] = toPx(x, y);
    return px > lay.x + 2 && px < lay.x + lay.width - 2 && py > lay.y + 2 && py < lay.y + lay.height - 2;
  };
  const displayD = [];
  const cornerD = [];
  for (const [x, y, nx, ny] of model.display) {
    // Only where the frame draws the screen's boundary: everywhere for an open
    // screen, at the masked corners otherwise.
    const [px, py] = toPx(x, y);
    const nearCorner =
      Math.min(Math.abs(px - lay.x), Math.abs(px - lay.x - lay.width)) < 200 &&
      Math.min(Math.abs(py - lay.y), Math.abs(py - lay.y - lay.height)) < 200;
    if (input.mask && !nearCorner) continue;
    const d = edgeOffset((qx, qy) => 1 - field(qx, qy), x, y, nx, ny, true, 20);
    if (d === null) continue;
    (nearCorner ? cornerD : displayD).push(d);
  }
  stats('display edges vs frame', displayD);
  stats('display corners vs frame', cornerD);
  lines.push(
    `display rect: layout puts it at x ${((lay.x - left) * sx).toFixed(3)}..${((lay.x + lay.width - left) * sx).toFixed(3)}, ` +
      `y ${((lay.y - top) * sy).toFixed(3)}..${((lay.y + lay.height - top) * sy).toFixed(3)}; model has top ${model.insets.top.toFixed(3)}, side ${model.insets.side.toFixed(3)}`
  );

  // ---- a camera hole: the opaque blob the frame draws inside the screen opening
  if (model.cutout.kind === 'punch' && !input.mask) {
    let n = 0;
    let cx = 0;
    let cy = 0;
    const x0 = lay.x + lay.width / 2 - 120;
    const y0 = lay.y;
    for (let y = y0; y < y0 + 260; y++) {
      for (let x = x0; x < x0 + 240; x++) {
        const v = alpha[(y * W + x) * 4 + 3] / 255;
        n += v;
        cx += v * (x + 0.5);
        cy += v * (y + 0.5);
      }
    }
    const d = 2 * Math.sqrt(n / Math.PI) * Math.sqrt(sx * sy);
    const centre = (cy / n - top) * sy;
    lines.push(
      `camera hole: frame d ${d.toFixed(3)} centre ${centre.toFixed(3)} (x ${((cx / n - left) * sx - model.width / 2).toFixed(3)} off centre); ` +
        `model d ${model.cutout.d} centre ${model.cutout.center}`
    );
  }

  // ---- the notch, against the AOSP cutout path
  const notchPts = [];
  if (model.notchPath) {
    // The model draws its own copy of a cutout path: compare that, side and bottom only.
    const t = model.height / 2 - model.insets.top;
    for (const polygon of model.notchPath) {
      for (const [x, y] of polygon) if (y > 1e-6 && Math.abs(x) > 1e-6) notchPts.push([x, t - y]);
    }
  } else if (model.cutout.kind === 'notch') {
    const { width, depth, radius, shoulder } = model.cutout;
    const t = model.height / 2 - model.insets.top;
    const l = -width / 2;
    const r = width / 2;
    const arc = (cx, cy, rad, a0, a1, n = 24) => {
      for (let i = 0; i <= n; i++) {
        const ang = a0 + ((a1 - a0) * i) / n;
        notchPts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
      }
    };
    // Same shape as the renderer draws, left to right along its lower boundary.
    arc(l - shoulder, t - shoulder, shoulder, Math.PI / 2, 0);
    arc(l + radius, t - depth + radius, radius, Math.PI, Math.PI * 1.5);
    arc(r - radius, t - depth + radius, radius, Math.PI * 1.5, Math.PI * 2);
    arc(r + shoulder, t - shoulder, shoulder, Math.PI, Math.PI / 2);
  }
  let aospPx = [];
  if (notchPath) {
    // Sample the path (M, q, v, h, z; relative after the first M) in display pixels.
    const tokens = notchPath.replace(/,/g, ' ').match(/[a-zA-Z]|-?\d*\.?\d+/g);
    let i = 0;
    let x = 0;
    let y = 0;
    let cmd = '';
    const num = () => Number(tokens[i++]);
    const out = [];
    let start = [0, 0];
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
      if (cmd === 'M') {
        x = num();
        y = num();
        start = [x, y];
        out.push(null, [x, y]);
      } else if (cmd === 'q') {
        const c = [x + num(), y + num()];
        const e = [x + num(), y + num()];
        for (let s = 1; s <= 24; s++) {
          const u = s / 24;
          out.push([(1 - u) ** 2 * x + 2 * (1 - u) * u * c[0] + u * u * e[0], (1 - u) ** 2 * y + 2 * (1 - u) * u * c[1] + u * u * e[1]]);
        }
        [x, y] = e;
      } else if (cmd === 'v') {
        y += num();
        out.push([x, y]);
      } else if (cmd === 'h') {
        x += num();
        out.push([x, y]);
      } else if (cmd === 'z') {
        [x, y] = start;
        out.push([x, y]);
      } else {
        i++;
      }
    }
    // Display pixels (origin top centre) to model millimetres.
    const ppm = lay.width / (model.width - 2 * model.insets.side);
    aospPx = out.map((p) => (p ? [p[0] / ppm, model.height / 2 - model.insets.top - p[1] / ppm] : null));
    // How far each point of the model's notch is from the AOSP outline's lower boundary.
    const segs = [];
    for (let k = 1; k < aospPx.length; k++) if (aospPx[k - 1] && aospPx[k]) segs.push([aospPx[k - 1], aospPx[k]]);
    const dist = (p) =>
      Math.min(
        ...segs
          // Its sides and bottom, not the closing edges along the display's top and centre line.
          .filter(([s, e]) => !(Math.abs(s[1] - e[1]) < 1e-6 && Math.abs(s[1] - (model.height / 2 - model.insets.top)) < 1e-6))
          .filter(([s, e]) => !(Math.abs(s[0]) < 1e-6 && Math.abs(e[0]) < 1e-6))
          .map(([s, e]) => {
            const dx = e[0] - s[0];
            const dy = e[1] - s[1];
            const tt = Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(s[0] + tt * dx - p[0], s[1] + tt * dy - p[1]);
          })
      );
    stats('notch vs AOSP cutout path', notchPts.map(dist));
  }

  // ---- the overlay
  ctx.lineWidth = 2;
  const poly = (pts, color, close = true) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      if (!p) {
        started = false;
        continue;
      }
      const [px, py] = toPx(p[0], p[1]);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else ctx.lineTo(px, py);
    }
    if (close) ctx.closePath();
    ctx.stroke();
  };
  poly(model.outline, 'rgba(255,0,0,0.9)');
  poly(model.display, 'rgba(0,220,255,0.9)');
  if (model.cutout.kind === 'punch') {
    const pts = [];
    for (let k = 0; k < 64; k++) {
      const ang = (k / 64) * Math.PI * 2;
      pts.push([(model.cutout.d / 2) * Math.cos(ang), model.height / 2 - model.cutout.center + (model.cutout.d / 2) * Math.sin(ang)]);
    }
    poly(pts, 'rgba(255,220,0,0.95)');
  }
  if (notchPts.length && model.notchPath) {
    const t = model.height / 2 - model.insets.top;
    for (const polygon of model.notchPath) poly(polygon.map(([x, y]) => [x, t - y]), 'rgba(255,220,0,0.95)');
  } else if (notchPts.length) {
    poly(notchPts, 'rgba(255,220,0,0.95)', false);
  }
  if (aospPx.length) poly(aospPx, 'rgba(0,255,0,0.9)', false);
  for (const f of model.front) {
    const pts = [];
    for (let k = 0; k < 48; k++) {
      const ang = (k / 48) * Math.PI * 2;
      pts.push([f.x - model.width / 2 + (f.width / 2) * Math.cos(ang), model.height / 2 - f.y + (f.height / 2) * Math.sin(ang)]);
    }
    poly(pts, 'rgba(255,220,0,0.95)');
  }
  const topCanvas = document.createElement('canvas');
  const cropH = Math.round(H * 0.16);
  topCanvas.width = W;
  topCanvas.height = cropH;
  topCanvas.getContext('2d').drawImage(canvas, 0, 0, W, cropH, 0, 0, W, cropH);
  return {
    lines,
    scale: `${(1 / sx).toFixed(2)} x ${(1 / sy).toFixed(2)} px/mm`,
    png: canvas.toDataURL('image/png'),
    top: topCanvas.toDataURL('image/png'),
  };
}
