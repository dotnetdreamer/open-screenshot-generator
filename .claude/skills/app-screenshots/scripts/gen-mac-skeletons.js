/**
 * Generates the neutral "macOS skeleton screen" library used to fill the Mac
 * mockups (MacBook / iMac) in the Mac templates — the desktop counterpart to
 * gen-app-skeletons.js / gen-watch-skeletons.js. Each screen is a full-bleed
 * desktop app window in the same soft-block visual language: grey structure
 * blocks, one accent colour, macOS traffic lights top-left.
 *
 * Output: public/data/projects/mac-screens/mac-<archetype>-<theme>.png
 * Archetypes: mail, dashboard, kanban, editor, music, chat
 * Themes: light, dark (indigo accent), amber (light + warm yellow accent),
 *         lime (dark + lime accent), blue (dark + blue accent)
 * Canvas 1280x800 @ DPR 2 (= 2560×1600, 16:10 — the exact macbook/imac 3D
 * screen aspect, so the device textures it with objectFit:cover and no crop).
 *
 * Run from repo root:
 *   node .claude/skills/app-screenshots/scripts/gen-mac-skeletons.js
 *   node .claude/skills/app-screenshots/scripts/gen-mac-skeletons.js lime      # one theme
 *   node .claude/skills/app-screenshots/scripts/gen-mac-skeletons.js kanban    # one archetype
 *   node .claude/skills/app-screenshots/scripts/gen-mac-skeletons.js mail-amber
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 1280;
const H = 800;
const OUT_DIR = path.resolve(__dirname, '../../../../public/data/projects/mac-screens');

const LIGHT = {
  bg: '#f3f3f5',
  sidebar: '#e9e9ee',
  surface: '#ffffff',
  surfaceAlt: '#f7f7f9',
  block: '#d6d6dc',
  blockSoft: '#e6e6eb',
  icon: '#9a9aa2',
  textStrong: '#2a2a2e',
  line: '#e2e2e8',
};
const DARK = {
  bg: '#1c1c1f',
  sidebar: '#232326',
  surface: '#2a2a2e',
  surfaceAlt: '#242428',
  block: '#4a4a52',
  blockSoft: '#39393f',
  icon: '#8e8e93',
  textStrong: '#f2f2f7',
  line: '#333338',
};
const THEMES = {
  light: { base: LIGHT, accent: '#6366f1', accentSoft: '#e0e3fd' },
  dark: { base: DARK, accent: '#7c86ff', accentSoft: '#2c3060' },
  amber: { base: LIGHT, accent: '#e8a413', accentSoft: '#fbeecb' },
  lime: { base: DARK, accent: '#c8f04a', accentSoft: '#3a4218' },
  blue: { base: DARK, accent: '#4c8dff', accentSoft: '#1c3560' },
};
const THEME_NAMES = Object.keys(THEMES);
const theme = (name) => ({ ...THEMES[name].base, accent: THEMES[name].accent, accentSoft: THEMES[name].accentSoft });

// ---- primitives -----------------------------------------------------------
const rr = (x, y, w, h, r, fill, op = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${op !== 1 ? ` fill-opacity="${op}"` : ''}/>`;
const circle = (cx, cy, r, fill, op = 1) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${op !== 1 ? ` fill-opacity="${op}"` : ''}/>`;
const pill = (x, y, w, h, fill, op = 1) => rr(x, y, w, h, h / 2, fill, op);
const vline = (x, y1, y2, stroke, w = 1) =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`;

// macOS window controls (close / minimise / zoom).
const trafficLights = (x = 24, y = 27) =>
  circle(x, y, 6.5, '#ff5f57') + circle(x + 22, y, 6.5, '#febc2e') + circle(x + 44, y, 6.5, '#28c840');

/** Left sidebar with traffic lights, search, nav rows (one active). */
function sidebar(t, w, activeRow = 1, rows = 7) {
  const p = [rr(0, 0, w, H, 0, t.sidebar), trafficLights()];
  p.push(rr(20, 54, w - 40, 30, 8, t.blockSoft)); // search field
  p.push(circle(36, 69, 6, t.icon, 0.7));
  const top = 112;
  for (let i = 0; i < rows; i++) {
    const y = top + i * 44;
    if (i === activeRow) {
      p.push(rr(12, y - 8, w - 24, 36, 9, t.accentSoft));
      p.push(circle(34, y + 10, 8, t.accent));
      p.push(pill(52, y + 4, w * 0.42, 12, t.accent, 0.85));
    } else {
      p.push(circle(34, y + 10, 8, t.block));
      p.push(pill(52, y + 4, w * (0.3 + (i % 3) * 0.08), 12, t.block));
    }
  }
  // section label + secondary rows
  const secTop = top + rows * 44 + 26;
  p.push(pill(22, secTop, w * 0.3, 9, t.icon, 0.5));
  for (let i = 0; i < 3; i++) {
    const y = secTop + 32 + i * 40;
    p.push(circle(34, y + 6, 7, t.blockSoft));
    p.push(pill(52, y, w * (0.34 + (i % 2) * 0.1), 12, t.blockSoft));
  }
  // user chip pinned to the bottom
  p.push(circle(36, H - 44, 14, t.block));
  p.push(pill(60, H - 52, w * 0.4, 12, t.block));
  p.push(pill(60, H - 34, w * 0.28, 9, t.blockSoft));
  return p.join('');
}

// ---- archetypes -----------------------------------------------------------

function mail(t) {
  const sb = 250;
  const list = 360;
  const p = [rr(0, 0, W, H, 0, t.bg), sidebar(t, sb, 0, 5)];
  // message list pane
  p.push(rr(sb, 0, list, H, 0, t.surfaceAlt));
  p.push(vline(sb + list, 0, H, t.line, 1.5));
  p.push(pill(sb + 24, 26, 120, 16, t.block));
  p.push(circle(sb + list - 40, 34, 16, t.accent)); // compose
  p.push(rr(sb + list - 46, 28, 12, 12, 2, t.bg, 0.9));
  const rowTop = 74;
  for (let i = 0; i < 8; i++) {
    const y = rowTop + i * 90;
    if (i === 1) p.push(rr(sb + 10, y - 10, list - 20, 84, 10, t.accentSoft));
    p.push(circle(sb + 40, y + 18, 17, i === 1 ? t.accent : t.block));
    p.push(pill(sb + 68, y, list * 0.45, 13, t.block));
    p.push(pill(sb + list - 70, y, 44, 10, t.blockSoft));
    p.push(pill(sb + 68, y + 22, list * 0.62, 11, t.blockSoft));
    p.push(pill(sb + 68, y + 42, list * 0.52, 11, t.blockSoft));
    if (i % 3 === 0) p.push(circle(sb + 20, y + 18, 4.5, t.accent));
  }
  // reading pane
  const rx = sb + list + 32;
  const rw = W - rx - 32;
  p.push(pill(rx, 40, rw * 0.55, 20, t.block));
  p.push(circle(rx + 22, 104, 20, t.block));
  p.push(pill(rx + 56, 90, rw * 0.3, 13, t.block));
  p.push(pill(rx + 56, 112, rw * 0.2, 10, t.blockSoft));
  p.push(pill(rx + rw - 120, 96, 120, 26, t.blockSoft));
  const bodyTop = 170;
  const widths = [0.95, 0.9, 0.97, 0.6, 0, 0.92, 0.96, 0.88, 0.5, 0, 0.93, 0.7];
  let y = bodyTop;
  for (const wl of widths) {
    if (wl) p.push(pill(rx, y, rw * wl, 12, t.blockSoft));
    y += 30;
  }
  // attachment chips
  p.push(rr(rx, y + 6, 170, 48, 10, t.surfaceAlt === LIGHT.surfaceAlt ? t.blockSoft : t.surface));
  p.push(circle(rx + 26, y + 30, 11, t.accent, 0.8));
  p.push(pill(rx + 46, y + 24, 96, 11, t.block));
  p.push(rr(rx + 186, y + 6, 170, 48, 10, t.surfaceAlt === LIGHT.surfaceAlt ? t.blockSoft : t.surface));
  p.push(circle(rx + 212, y + 30, 11, t.icon, 0.8));
  p.push(pill(rx + 232, y + 24, 96, 11, t.block));
  return p.join('');
}

function dashboard(t) {
  const sb = 240;
  const p = [rr(0, 0, W, H, 0, t.bg), sidebar(t, sb, 2)];
  const cx = sb + 30;
  const cw = W - cx - 30;
  p.push(pill(cx, 32, 220, 20, t.block));
  p.push(pill(cx, 62, 140, 11, t.blockSoft));
  p.push(rr(cx + cw - 130, 34, 130, 34, 9, t.accent));
  p.push(pill(cx + cw - 106, 46, 82, 10, t.bg, 0.85));
  // stat cards
  const cardW = (cw - 3 * 20) / 4;
  for (let i = 0; i < 4; i++) {
    const x = cx + i * (cardW + 20);
    p.push(rr(x, 100, cardW, 108, 14, i === 0 ? t.accentSoft : t.surface));
    p.push(circle(x + 26, 130, 13, i === 0 ? t.accent : t.blockSoft));
    p.push(pill(x + 18, 156, cardW * 0.52, 17, i === 0 ? t.accent : t.block, i === 0 ? 0.9 : 1));
    p.push(pill(x + 18, 182, cardW * 0.4, 10, t.blockSoft));
  }
  // big line chart card, running to the bottom edge
  const chY = 232;
  const chH = H - chY - 32;
  p.push(rr(cx, chY, cw * 0.62, chH, 14, t.surface));
  p.push(pill(cx + 22, chY + 20, 150, 13, t.block));
  p.push(pill(cx + cw * 0.62 - 150, chY + 20, 60, 22, t.blockSoft));
  p.push(pill(cx + cw * 0.62 - 82, chY + 20, 60, 22, t.accentSoft));
  const gx = cx + 24;
  const gw = cw * 0.62 - 48;
  const gy = chY + 62;
  const gh = chH - 100;
  for (let i = 0; i < 4; i++) p.push(rr(gx, gy + (i * gh) / 3, gw, 1.5, 0, t.line));
  const pts = [0.72, 0.55, 0.62, 0.4, 0.5, 0.28, 0.36, 0.18].map(
    (v, i) => [gx + (gw * i) / 7, gy + gh * v]
  );
  const d = pts.map((pt, i) => (i ? `L${pt[0]} ${pt[1]}` : `M${pt[0]} ${pt[1]}`)).join(' ');
  p.push(`<path d="${d} L${gx + gw} ${gy + gh} L${gx} ${gy + gh} Z" fill="${t.accent}" fill-opacity="0.16"/>`);
  p.push(`<path d="${d}" fill="none" stroke="${t.accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  p.push(circle(pts[5][0], pts[5][1], 7, t.accent));
  for (let i = 0; i < 8; i++) p.push(pill(gx + (gw * i) / 7 - 14, gy + gh + 16, 28, 8, t.blockSoft));
  // bars card
  const bx = cx + cw * 0.62 + 20;
  const bw = cw - cw * 0.62 - 20;
  p.push(rr(bx, chY, bw, chH, 14, t.surface));
  p.push(pill(bx + 22, chY + 20, bw * 0.5, 13, t.block));
  const barVals = [0.45, 0.7, 0.35, 0.85, 0.55, 0.95, 0.62];
  const bGap = 14;
  const bW = (bw - 44 - 6 * bGap) / 7;
  for (let i = 0; i < 7; i++) {
    const bh = (chH - 120) * barVals[i];
    p.push(rr(bx + 22 + i * (bW + bGap), chY + chH - 46 - bh, bW, bh, 5, i === 5 ? t.accent : t.blockSoft));
  }
  return p.join('');
}

function kanban(t) {
  const p = [rr(0, 0, W, H, 0, t.bg)];
  // top toolbar
  p.push(rr(0, 0, W, 56, 0, t.sidebar));
  p.push(trafficLights(24, 28));
  p.push(pill(96, 21, 170, 15, t.block));
  for (let i = 0; i < 3; i++) p.push(circle(W - 250 + i * 26, 28, 12, i ? t.block : t.accent));
  p.push(rr(W - 160, 14, 130, 30, 8, t.accent));
  p.push(pill(W - 138, 24, 86, 10, t.bg, 0.85));
  // filter row
  p.push(pill(28, 78, 130, 24, t.blockSoft));
  p.push(pill(170, 78, 100, 24, t.blockSoft));
  p.push(pill(282, 78, 100, 24, t.accentSoft));
  // columns
  const cols = 4;
  const gap = 22;
  const colW = (W - 56 - (cols - 1) * gap) / cols;
  const cardCounts = [3, 4, 2, 3];
  const accentCard = [0, 2, -1, 1];
  for (let c = 0; c < cols; c++) {
    const x = 28 + c * (colW + gap);
    p.push(rr(x, 122, colW, H - 150, 14, t.surfaceAlt));
    p.push(pill(x + 16, 142, colW * 0.42, 13, t.block));
    p.push(circle(x + colW - 26, 148, 11, t.blockSoft));
    let y = 176;
    for (let k = 0; k < cardCounts[c]; k++) {
      const tall = (c + k) % 3 === 0;
      const cardH = tall ? 132 : 104;
      p.push(rr(x + 12, y, colW - 24, cardH, 11, t.surface));
      const isAccent = k === accentCard[c];
      p.push(pill(x + 26, y + 16, 64, 14, isAccent ? t.accent : t.accentSoft));
      p.push(pill(x + 26, y + 42, (colW - 24) * 0.72, 12, t.block));
      p.push(pill(x + 26, y + 62, (colW - 24) * 0.5, 12, t.blockSoft));
      if (tall) p.push(rr(x + 26, y + 84, colW - 52, 26, 6, t.blockSoft, 0.7));
      p.push(circle(x + 32, y + cardH - 18, 9, t.block));
      p.push(circle(x + 48, y + cardH - 18, 9, t.blockSoft));
      p.push(pill(x + colW - 74, y + cardH - 24, 40, 10, t.blockSoft));
      y += cardH + 14;
    }
    // "add card" ghost
    p.push(rr(x + 12, y, colW - 24, 34, 9, t.blockSoft, 0.45));
  }
  return p.join('');
}

function editor(t) {
  const p = [rr(0, 0, W, H, 0, t.bg)];
  p.push(rr(0, 0, W, 56, 0, t.sidebar));
  p.push(trafficLights(24, 28));
  p.push(pill(96, 21, 150, 15, t.block));
  // formatting toolbar chips
  for (let i = 0; i < 8; i++) p.push(rr(330 + i * 38, 17, 26, 24, 6, i === 2 ? t.accentSoft : t.blockSoft));
  p.push(rr(W - 150, 14, 120, 30, 8, t.accent));
  p.push(pill(W - 128, 24, 76, 10, t.bg, 0.85));
  // document page
  const pw = 720;
  const px = (W - pw) / 2;
  p.push(rr(px, 86, pw, H - 86, 4, t.surface));
  p.push(pill(px + 70, 140, pw * 0.62, 26, t.block));
  p.push(pill(px + 70, 186, pw * 0.34, 12, t.blockSoft));
  const widths = [0.8, 0.84, 0.78, 0.5, 0, 0.82, 0.8, 0.84, 0.62, 0, 0.78, 0.82, 0.44];
  let y = 236;
  for (let i = 0; i < widths.length; i++) {
    const wl = widths[i];
    if (wl) {
      p.push(pill(px + 70, y, pw * wl, 12, t.blockSoft));
      if (i === 6) p.push(pill(px + 70 + pw * 0.28, y, pw * 0.22, 12, t.accent, 0.55));
    }
    y += 30;
  }
  // blockquote
  p.push(rr(px + 70, y + 4, 5, 66, 2.5, t.accent));
  p.push(pill(px + 92, y + 10, pw * 0.6, 11, t.blockSoft));
  p.push(pill(px + 92, y + 36, pw * 0.5, 11, t.blockSoft));
  // floating comment card
  p.push(rr(px + pw - 64, 250, 200, 96, 12, t.surfaceAlt));
  p.push(circle(px + pw - 40, 276, 12, t.accent));
  p.push(pill(px + pw - 22, 270, 120, 11, t.block));
  p.push(pill(px + pw - 44, 300, 150, 10, t.blockSoft));
  p.push(pill(px + pw - 44, 318, 110, 10, t.blockSoft));
  return p.join('');
}

function music(t) {
  const sb = 230;
  const p = [rr(0, 0, W, H, 0, t.bg), sidebar(t, sb, 3, 6)];
  const cx = sb + 30;
  const cw = W - cx - 30;
  // hero banner
  p.push(rr(cx, 28, cw, 150, 16, t.accentSoft));
  p.push(rr(cx, 28, cw * 0.55, 150, 16, t.accent, 0.25));
  p.push(pill(cx + 30, 62, cw * 0.3, 22, t.block));
  p.push(pill(cx + 30, 96, cw * 0.2, 12, t.blockSoft));
  p.push(circle(cx + cw - 60, 103, 30, t.accent));
  p.push(`<path d="M${cx + cw - 70} ${88} l24 15 l-24 15 Z" fill="${t.bg}"/>`);
  // album grid 4 x 2 (tiles are 0.78 aspect, so row pitch uses tile HEIGHT —
  // using the width here once pushed row 2 past the guard and left a void)
  const gTop = 210;
  const gGap = 24;
  const tile = (cw - 3 * gGap) / 4;
  const tileH = tile * 0.78;
  const rowPitch = tileH + 58;
  const tileShades = [t.block, t.blockSoft, t.accentSoft, t.block, t.blockSoft, t.block, t.accentSoft, t.blockSoft];
  for (let i = 0; i < 8; i++) {
    const x = cx + (i % 4) * (tile + gGap);
    const y = gTop + Math.floor(i / 4) * rowPitch;
    if (y + tileH + 42 > H - 84) continue;
    p.push(rr(x, y, tile, tileH, 12, tileShades[i]));
    p.push(circle(x + tile / 2, y + tileH / 2, tile * 0.16, t.surface, 0.5));
    p.push(pill(x, y + tileH + 12, tile * 0.7, 11, t.block));
    p.push(pill(x, y + tileH + 31, tile * 0.45, 9, t.blockSoft));
  }
  // player bar
  p.push(rr(0, H - 74, W, 74, 0, t.sidebar));
  p.push(rr(20, H - 60, 46, 46, 9, t.block));
  p.push(pill(80, H - 52, 130, 12, t.block));
  p.push(pill(80, H - 32, 90, 9, t.blockSoft));
  const pcx = W / 2;
  p.push(`<path d="M${pcx - 74} ${H - 44} l-16 11 l16 11 Z" fill="${t.icon}"/>`);
  p.push(circle(pcx, H - 33, 22, t.accent));
  p.push(`<path d="M${pcx - 6} ${H - 43} l14 10 l-14 10 Z" fill="${t.bg}"/>`);
  p.push(`<path d="M${pcx + 74} ${H - 44} l16 11 l-16 11 Z" fill="${t.icon}"/>`);
  p.push(pill(W - 340, H - 40, 300, 8, t.blockSoft));
  p.push(pill(W - 340, H - 40, 140, 8, t.accent));
  return p.join('');
}

function chat(t) {
  const sb = 300;
  const p = [rr(0, 0, W, H, 0, t.bg)];
  // conversation list doubles as the sidebar
  p.push(rr(0, 0, sb, H, 0, t.sidebar));
  p.push(trafficLights());
  p.push(rr(20, 54, sb - 40, 30, 8, t.blockSoft));
  p.push(circle(36, 69, 6, t.icon, 0.7));
  const rowTop = 112;
  for (let i = 0; i < 7; i++) {
    const y = rowTop + i * 82;
    if (i === 1) p.push(rr(10, y - 12, sb - 20, 74, 12, t.accentSoft));
    p.push(circle(40, y + 14, 19, i === 1 ? t.accent : t.block));
    p.push(pill(72, y, sb * 0.42, 13, t.block));
    p.push(pill(72, y + 22, sb * 0.55, 10, t.blockSoft));
    p.push(pill(sb - 62, y, 34, 9, t.blockSoft));
    if (i === 0 || i === 3) p.push(circle(sb - 34, y + 24, 9, t.accent));
  }
  p.push(vline(sb, 0, H, t.line, 1.5));
  // thread header
  const cx = sb + 28;
  p.push(circle(cx + 16, 38, 17, t.block));
  p.push(pill(cx + 46, 24, 150, 13, t.block));
  p.push(pill(cx + 46, 46, 90, 9, t.accent, 0.8));
  p.push(circle(W - 56, 38, 13, t.blockSoft));
  p.push(circle(W - 96, 38, 13, t.blockSoft));
  p.push(rr(sb, 76, W - sb, 1.5, 0, t.line));
  // bubbles
  const bubbles = [
    { mine: false, w: 0.42, lines: 2 },
    { mine: false, w: 0.3, lines: 1 },
    { mine: true, w: 0.38, lines: 2 },
    { mine: false, w: 0.5, lines: 3 },
    { mine: true, w: 0.3, lines: 1 },
    { mine: true, w: 0.44, lines: 2 },
    { mine: false, w: 0.36, lines: 1 },
  ];
  let y = 108;
  for (const b of bubbles) {
    const bw = (W - sb - 120) * b.w + 60;
    const bh = 26 + b.lines * 20;
    const x = b.mine ? W - 40 - bw : cx + 44;
    p.push(rr(x, y, bw, bh, 14, b.mine ? t.accent : t.surfaceAlt === LIGHT.surfaceAlt ? t.blockSoft : t.surface));
    for (let l = 0; l < b.lines; l++) {
      p.push(pill(x + 18, y + 14 + l * 20, bw - 36 - (l === b.lines - 1 ? bw * 0.25 : 0), 10, b.mine ? t.bg : t.block, b.mine ? 0.5 : 1));
    }
    if (!b.mine) p.push(circle(cx + 16, y + bh - 14, 13, t.block));
    y += bh + 18;
  }
  // composer
  p.push(rr(cx, H - 64, W - cx - 96, 40, 20, t.surfaceAlt === LIGHT.surfaceAlt ? t.blockSoft : t.surface));
  p.push(pill(cx + 22, H - 49, 140, 10, t.blockSoft === LIGHT.blockSoft ? t.block : t.blockSoft, 0.8));
  p.push(circle(W - 60, H - 44, 20, t.accent));
  p.push(`<path d="M${W - 67} ${H - 51} l17 7 l-17 7 l4 -7 Z" fill="${t.bg}"/>`);
  return p.join('');
}

const ARCHETYPES = { mail, dashboard, kanban, editor, music, chat };

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
  const only = process.argv.slice(2); // archetype, theme, or "mail-amber"
  for (const name of Object.keys(ARCHETYPES)) {
    for (const themeName of THEME_NAMES) {
      const key = `${name}-${themeName}`;
      if (only.length && !only.includes(name) && !only.includes(themeName) && !only.includes(key)) continue;
      const svg = buildSvg(name, theme(themeName));
      await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
      const out = path.join(OUT_DIR, `mac-${key}.png`);
      await page.screenshot({ path: out });
      console.log('written', path.relative(process.cwd(), out));
    }
  }
  await browser.close();
})();
