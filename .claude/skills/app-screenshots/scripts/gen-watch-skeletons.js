/**
 * Generates the neutral "watch skeleton screen" library used to fill the 3D
 * Apple Watch mockups in the Apple Watch templates (the watchOS counterpart to
 * gen-app-skeletons.js). watchOS is a black-OLED surface with bold, sparse
 * rounded blocks and one accent colour, so these read at tiny watch scale.
 *
 * Output: public/data/projects/watch-screens/watch-<archetype>-<theme>.png
 * Archetypes: rings, list, workout, nowplaying, map, detail  × { default,
 *   green, orange, blue, pink, purple }
 * Canvas 480x588 @ DPR 2 (== 0.816 aspect, the apple-watch 3D screen area, so
 * the device textures it with objectFit:cover and virtually no cropping).
 *
 * Run from repo root:
 *   node .claude/skills/app-screenshots/scripts/gen-watch-skeletons.js
 *   node .claude/skills/app-screenshots/scripts/gen-watch-skeletons.js green   # one theme
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 480;
const H = 588;
const OUT_DIR = path.resolve(__dirname, '../../../../public/data/projects/watch-screens');

// Neutral watchOS greys are shared; only the accent pair changes per theme.
const BASE = {
  bg: '#000000',
  surface: '#161618',
  surfaceAlt: '#232326',
  block: '#48484a',
  blockSoft: '#38383b',
  icon: '#8e8e93',
  textStrong: '#f2f2f7',
};
const ACCENTS = {
  default: { accent: '#6E76F1', accentSoft: '#2b2e63' },
  green: { accent: '#30D158', accentSoft: '#173a22' },
  orange: { accent: '#FF9F0A', accentSoft: '#442b06' },
  blue: { accent: '#0A84FF', accentSoft: '#0c2c4d' },
  pink: { accent: '#FF375F', accentSoft: '#451220' },
  purple: { accent: '#BF5AF2', accentSoft: '#331447' },
  // Warm coral for wedding/event templates (watch-vowly) — the watchOS-bright
  // cousin of the phone skeletons' coral accent (#e2574a).
  coral: { accent: '#FF6F5E', accentSoft: '#48170f' },
};
// Activity rings keep the recognizable Apple tricolour regardless of theme.
const RING = { move: '#FA114F', exercise: '#A0FF03', stand: '#04D3E5' };

const THEME_NAMES = Object.keys(ACCENTS);
const theme = (name) => ({ ...BASE, ...ACCENTS[name] });

// ---- primitives -----------------------------------------------------------
const rr = (x, y, w, h, r, fill, op = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${op !== 1 ? ` fill-opacity="${op}"` : ''}/>`;
const circle = (cx, cy, r, fill, op = 1) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${op !== 1 ? ` fill-opacity="${op}"` : ''}/>`;
const ring = (cx, cy, r, stroke, w, op = 1) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}"${op !== 1 ? ` stroke-opacity="${op}"` : ''}/>`;
const pill = (x, y, w, h, fill, op = 1) => rr(x, y, w, h, h / 2, fill, op);

// 12 o'clock = 0deg, clockwise. An open activity arc, round caps.
const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function arc(cx, cy, r, startDeg, endDeg, stroke, w) {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = (endDeg - startDeg) % 360 > 180 ? 1 : 0;
  return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
}

// small top status chip (stands in for the watchOS time)
const statusChip = (t) => pill(W / 2 - 44, 40, 88, 16, t.blockSoft);

// ---- archetypes -----------------------------------------------------------
function rings(t) {
  const p = [statusChip(t)];
  const cx = 240, cy = 288;
  const specs = [
    { r: 150, col: RING.move, end: 312 },
    { r: 112, col: RING.exercise, end: 256 },
    { r: 74, col: RING.stand, end: 214 },
  ];
  const rw = 30;
  for (const s of specs) p.push(ring(cx, cy, s.r, t.surfaceAlt, rw));
  for (const s of specs) p.push(arc(cx, cy, s.r, 0, s.end, s.col, rw));
  // three stat columns under the rings
  const cols = [96, 240, 384];
  const dot = [RING.move, RING.exercise, RING.stand];
  cols.forEach((x, i) => {
    p.push(circle(x, 476, 8, dot[i]));
    p.push(pill(x - 34, 494, 68, 20, t.block));
    p.push(pill(x - 22, 524, 44, 12, t.blockSoft));
  });
  return p.join('');
}

function list(t) {
  const p = [statusChip(t)];
  const top = 96, rowH = 96, x = 44, w = 392, h = 78, r = 24;
  const line1 = [220, 180, 240, 200];
  const accentRow = new Set([0, 2]);
  for (let i = 0; i < 4; i++) {
    const y = top + i * rowH;
    p.push(rr(x, y, w, h, r, t.surfaceAlt));
    const lead = accentRow.has(i) ? t.accent : t.block;
    p.push(circle(x + 46, y + h / 2, 24, lead));
    p.push(pill(x + 92, y + 22, line1[i], 18, t.block));
    p.push(pill(x + 92, y + 48, line1[i] - 70, 13, t.blockSoft));
    if (accentRow.has(i)) p.push(circle(x + w - 32, y + h / 2, 8, t.accent));
  }
  return p.join('');
}

function workout(t) {
  const p = [statusChip(t)];
  // big primary metric (accent), centered
  p.push(pill(W / 2 - 120, 104, 240, 76, t.accent));
  p.push(pill(W / 2 - 60, 196, 120, 16, t.icon, 0.9));
  // two secondary metrics
  const secY = [268, 372];
  for (const y of secY) {
    p.push(pill(W / 2 - 100, y, 200, 52, t.block));
    p.push(pill(W / 2 - 55, y + 66, 110, 13, t.blockSoft));
  }
  // pause / end control row
  p.push(circle(184, 520, 40, t.surfaceAlt));
  p.push(rr(176, 512, 16, 16, 3, t.icon));
  p.push(circle(296, 520, 40, t.accent));
  return p.join('');
}

function nowplaying(t) {
  const p = [statusChip(t)];
  // album art
  p.push(rr(130, 72, 220, 220, 34, t.surfaceAlt));
  p.push(circle(240, 182, 62, t.block, 0.5));
  p.push(circle(240, 182, 20, t.bg, 0.9));
  // title / artist
  p.push(pill(140, 316, 200, 22, t.block));
  p.push(pill(165, 352, 150, 15, t.blockSoft));
  // scrubber
  const sy = 410;
  p.push(pill(84, sy, 312, 10, t.surfaceAlt));
  p.push(pill(84, sy, 150, 10, t.accent));
  p.push(circle(234, sy + 5, 12, t.accent));
  // transport controls
  const cy = 500;
  p.push(`<path d="M168 ${cy - 20} l-30 20 l30 20 Z" fill="${t.block}"/>`);
  p.push(circle(240, cy, 40, t.accent));
  p.push(`<path d="M228 ${cy - 18} l26 18 l-26 18 Z" fill="${t.bg}"/>`);
  p.push(`<path d="M312 ${cy - 20} l30 20 l-30 20 Z" fill="${t.block}"/>`);
  return p.join('');
}

function map(t) {
  const p = [rr(0, 0, W, H, 0, t.surface)];
  // faint roads
  p.push(`<path d="M-20 180 L500 260" stroke="${t.surfaceAlt}" stroke-width="14"/>`);
  p.push(`<path d="M120 -20 L260 620" stroke="${t.surfaceAlt}" stroke-width="14"/>`);
  p.push(`<path d="M-20 420 L520 380" stroke="${t.surfaceAlt}" stroke-width="10"/>`);
  // route
  p.push(`<path d="M120 140 C 220 180, 180 300, 300 340 S 360 400, 372 430" fill="none" stroke="${t.accent}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`);
  p.push(circle(120, 140, 16, t.accent));
  p.push(circle(120, 140, 6, t.bg));
  // destination pin (teardrop = disc + point)
  p.push(`<path d="M350 400 L394 400 L372 436 Z" fill="${t.accent}"/>`);
  p.push(circle(372, 400, 22, t.accent));
  p.push(circle(372, 398, 9, t.bg));
  // bottom info card
  p.push(rr(40, 470, 400, 92, 26, t.bg, 0.85));
  p.push(pill(68, 494, 190, 18, t.block));
  p.push(pill(68, 524, 120, 13, t.blockSoft));
  p.push(circle(392, 516, 30, t.accent));
  return p.join('');
}

function detail(t) {
  const p = [];
  // header
  p.push(pill(52, 84, 250, 26, t.block));
  p.push(pill(52, 122, 170, 15, t.blockSoft));
  // 2x2 stat tiles
  const tiles = [[44, 168], [256, 168], [44, 300], [256, 300]];
  const tw = 180, th = 120, tr = 26;
  tiles.forEach(([tx, ty], i) => {
    p.push(rr(tx, ty, tw, th, tr, t.surfaceAlt));
    p.push(circle(tx + 34, ty + 38, 16, t.accentSoft));
    p.push(circle(tx + 34, ty + 38, 7, t.accent));
    p.push(pill(tx + 22, ty + 64, 116, 20, t.block));
    p.push(pill(tx + 22, ty + 92, 72, 12, t.blockSoft));
  });
  // primary button
  p.push(pill(80, 466, 320, 58, t.accent));
  p.push(pill(190, 486, 100, 18, t.bg, 0.55));
  return p.join('');
}

const ARCHETYPES = { rings, list, workout, nowplaying, map, detail };

function buildSvg(archetype, t) {
  const body = ARCHETYPES[archetype](t);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${t.bg}"/>${body}</svg>`;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, args: ['--no-sandbox'],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const only = process.argv.slice(2); // archetype, theme, or "list-green"
  for (const name of Object.keys(ARCHETYPES)) {
    for (const themeName of THEME_NAMES) {
      const key = `${name}-${themeName}`;
      if (only.length && !only.includes(name) && !only.includes(themeName) && !only.includes(key)) continue;
      const svg = buildSvg(name, theme(themeName));
      await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
      const out = path.join(OUT_DIR, `watch-${key}.png`);
      await page.screenshot({ path: out });
      console.log('written', path.relative(process.cwd(), out));
    }
  }
  await browser.close();
})();
