/**
 * Generates the neutral "skeleton screen" library used to fill empty phone
 * mockups in the App Screenshots templates (the same idea as fg-screens, but
 * full-height for a whole phone screen, in the inboxly-screen-inbox.png visual
 * language: soft rounded blocks, generous spacing, one soft indigo accent).
 *
 * Output: public/data/projects/app-screens/app-<archetype>-<theme>.png
 * Archetypes: list, feed, grid, player, dashboard, chat   × { light, dark }
 * Canvas 846x1710 @ DPR 2 (== 0.4947 aspect, the iphone-15 screen area, so the
 * device renders it with objectFit:cover and no cropping).
 *
 * Run from repo root:
 *   node .claude/skills/app-screenshots/scripts/gen-app-skeletons.js
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 846;
const H = 1710;
const OUT_DIR = path.resolve(__dirname, '../../../../public/data/projects/app-screens');

const THEMES = {
  light: {
    bg: '#f6f7fb',
    surface: '#ffffff',
    surfaceAlt: '#eaeef6',
    block: '#d9dfec',      // primary skeleton line / avatar
    blockSoft: '#e6eaf3',  // secondary line
    icon: '#aab0c4',
    navBg: '#ffffff',
    hairline: '#eef1f7',
    accent: '#8b95f5',
    accentSoft: '#e6e8fd',
  },
  dark: {
    bg: '#12141c',
    surface: '#1d2130',
    surfaceAlt: '#232838',
    block: '#2f3547',
    blockSoft: '#262b3a',
    icon: '#5b6280',
    navBg: '#171a24',
    hairline: '#20242f',
    accent: '#8b95f5',
    accentSoft: '#2a2e50',
  },
  // Deep-green dark skeleton (for forest/wellness templates such as
  // breathora-breathing) — the `dark` structure re-toned onto green.
  forest: {
    bg: '#1c3a26',
    surface: '#284c33',
    surfaceAlt: '#2f573c',
    block: '#43684f',
    blockSoft: '#375c44',
    icon: '#84a892',
    navBg: '#20422b',
    hairline: '#2b5037',
    accent: '#9fdfae',
    accentSoft: '#3c684a',
  },
  // Warm blush skeleton with a coral accent (for wedding/event templates such
  // as vowly-wedding) — same neutral structure as `light`, warmed up.
  coral: {
    bg: '#fdf4f1',
    surface: '#ffffff',
    surfaceAlt: '#f8e7e2',
    block: '#ebd5cd',
    blockSoft: '#f4e3dd',
    icon: '#c8a094',
    navBg: '#ffffff',
    hairline: '#f6eae6',
    accent: '#e2574a',
    accentSoft: '#fbdfd9',
  },
  // Light skeleton with a soft eco-green accent (for green/nature templates such
  // as verda-eco) — same neutral greys as `light`, accent swapped indigo→green.
  eco: {
    bg: '#f4faf6',
    surface: '#ffffff',
    surfaceAlt: '#e7f2ec',
    block: '#d3e2d9',
    blockSoft: '#e4efe9',
    icon: '#9fb4a8',
    navBg: '#ffffff',
    hairline: '#ecf4ef',
    accent: '#2fa96a',
    accentSoft: '#d7efe0',
  },
};

// Themes to render when no explicit theme filter is passed on the CLI.
const THEME_NAMES = Object.keys(THEMES);

// ---- primitives -----------------------------------------------------------
const rr = (x, y, w, h, r, fill, op = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${op !== 1 ? ` fill-opacity="${op}"` : ''}/>`;
const circle = (cx, cy, r, fill, op = 1) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${op !== 1 ? ` fill-opacity="${op}"` : ''}/>`;
const pill = (x, y, w, h, fill, op = 1) => rr(x, y, w, h, h / 2, fill, op);

// bottom tab bar with 4 dots, first active (accent)
function bottomNav(t) {
  const navTop = H - 150;
  const cy = navTop + 66;
  const xs = [150, 348, 546, 744];
  let s = rr(0, navTop, W, 150, 0, t.navBg);
  s += rr(0, navTop, W, 2, 0, t.hairline);
  xs.forEach((x, i) => { s += circle(x, cy, i === 0 ? 26 : 22, i === 0 ? t.accent : t.icon, i === 0 ? 1 : 0.9); });
  return s;
}

// a search pill with a magnifier glyph
function searchPill(t, x, y, w, h) {
  let s = rr(x, y, w, h, h / 2, t.surfaceAlt);
  const cx = x + h * 0.62, cy = y + h / 2;
  s += `<circle cx="${cx}" cy="${cy - 2}" r="${h * 0.16}" fill="none" stroke="${t.icon}" stroke-width="5"/>`;
  s += `<line x1="${cx + h * 0.13}" y1="${cy + h * 0.11}" x2="${cx + h * 0.24}" y2="${cy + h * 0.22}" stroke="${t.icon}" stroke-width="5" stroke-linecap="round"/>`;
  s += pill(x + h * 1.05, y + h / 2 - 9, w * 0.5, 18, t.block);
  return s;
}

// ---- archetypes -----------------------------------------------------------
function list(t) {
  const p = [];
  const topY = 150;
  p.push(circle(82, topY + 50, 42, t.block));
  p.push(searchPill(t, 150, topY, 546, 100));
  // compose pencil
  p.push(`<g transform="translate(730,${topY + 22}) scale(0.56)"><path d="M12 88 L18 64 L64 18 L82 36 L36 82 Z" fill="${t.accent}"/><path d="M68 14 L79 3 L97 21 L86 32 Z" fill="${t.accent}"/></g>`);
  // avatar chip row
  const rowY = 342;
  for (let i = 0; i < 6; i++) {
    const cx = 86 + i * 136;
    p.push(circle(cx, rowY, 46, t.block));
    if (i === 0 || i === 3) p.push(circle(cx - 34, rowY + 34, 10, t.accent));
  }
  // list rows
  const l1 = [430, 350, 470, 390, 300, 450, 360, 420];
  const l2 = [280, 220, 300, 240, 190, 280, 230, 260];
  const unread = new Set([0, 3, 5]);
  const top = 486, rowH = 132;
  for (let i = 0; i < 8; i++) {
    const y = top + i * rowH;
    p.push(circle(86, y + 46, 46, t.block));
    p.push(pill(168, y + 18, l1[i], 22, t.block));
    p.push(pill(168, y + 58, l2[i], 18, t.blockSoft));
    if (unread.has(i)) p.push(circle(782, y + 46, 9, t.accent));
  }
  p.push(bottomNav(t));
  return p.join('');
}

function feed(t) {
  const p = [];
  const topY = 150;
  p.push(pill(60, topY + 14, 240, 30, t.block));        // title
  p.push(circle(784, topY + 30, 40, t.block));          // avatar
  p.push(circle(690, topY + 30, 24, t.icon, 0.9));      // bell/icon
  // hero post card
  let y = 300;
  p.push(circle(90, y + 34, 40, t.block));
  p.push(pill(150, y + 16, 300, 22, t.block));
  p.push(pill(150, y + 52, 190, 16, t.blockSoft));
  y += 100;
  p.push(rr(60, y, 726, 470, 34, t.surfaceAlt));        // image block
  p.push(circle(423, y + 235, 60, t.block, 0.6));       // faux focal
  y += 500;
  // action row
  p.push(circle(84, y, 20, t.icon, 0.9));
  p.push(circle(150, y, 20, t.icon, 0.9));
  p.push(circle(216, y, 20, t.icon, 0.9));
  p.push(circle(760, y, 20, t.accent));
  y += 44;
  p.push(pill(64, y, 520, 20, t.block));
  p.push(pill(64, y + 34, 380, 16, t.blockSoft));
  // second partial post
  y += 96;
  p.push(circle(90, y + 34, 40, t.block));
  p.push(pill(150, y + 16, 260, 22, t.block));
  p.push(pill(150, y + 52, 160, 16, t.blockSoft));
  p.push(rr(60, y + 100, 726, 300, 34, t.surfaceAlt));
  p.push(bottomNav(t));
  return p.join('');
}

function grid(t) {
  const p = [];
  const topY = 150;
  p.push(pill(60, topY + 12, 260, 30, t.block));
  p.push(searchPill(t, 60, topY + 70, 726, 92));
  // category chips
  let y = topY + 200;
  let x = 60;
  const chips = [130, 100, 150, 110];
  chips.forEach((w, i) => { p.push(pill(x, y, w, 54, i === 0 ? t.accentSoft : t.surfaceAlt)); if (i === 0) p.push(pill(x + 24, y + 20, w - 48, 14, t.accent)); x += w + 26; });
  // 2-col grid of product cards
  y += 96;
  const colX = [60, 443];
  const cardW = 343, imgH = 300, cardH = 430;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const cx = colX[c], cy = y + r * (cardH + 34);
      p.push(rr(cx, cy, cardW, imgH, 28, t.surfaceAlt));
      p.push(circle(cx + cardW - 44, cy + 44, 22, t.surface, t.bg === '#f6f7fb' ? 1 : 0.5)); // fav bubble
      p.push(pill(cx + 20, cy + imgH + 26, 220, 20, t.block));
      p.push(pill(cx + 20, cy + imgH + 60, 140, 16, t.blockSoft));
      p.push(pill(cx + 20, cy + imgH + 96, 90, 26, t.accent, 0.85));
    }
  }
  p.push(bottomNav(t));
  return p.join('');
}

function player(t) {
  const p = [];
  // top bar
  p.push(`<path d="M74 168 l28 -26 M74 168 l28 26" stroke="${t.icon}" stroke-width="8" fill="none" stroke-linecap="round"/>`); // chevron down
  p.push(pill(333, 156, 180, 24, t.block));
  p.push(circle(772, 168, 6, t.icon)); p.push(circle(772, 190, 6, t.icon)); p.push(circle(772, 146, 6, t.icon));
  // album art
  const artY = 300, artS = 646;
  p.push(rr(100, artY, artS, artS, 44, t.surfaceAlt));
  p.push(circle(423, artY + artS / 2, 130, t.block, 0.5));
  p.push(circle(423, artY + artS / 2, 44, t.bg, 0.9));
  // title + subtitle
  let y = artY + artS + 80;
  p.push(pill(233, y, 380, 34, t.block));
  p.push(pill(303, y + 58, 240, 22, t.blockSoft));
  // scrubber
  y += 150;
  p.push(pill(100, y, 646, 12, t.blockSoft));
  p.push(pill(100, y, 300, 12, t.accent));
  p.push(circle(400, y + 6, 18, t.accent));
  p.push(pill(100, y + 34, 70, 16, t.blockSoft));
  p.push(pill(676, y + 34, 70, 16, t.blockSoft));
  // controls
  y += 130;
  p.push(circle(150, y, 20, t.icon)); // shuffle-ish
  p.push(`<path d="M300 ${y - 26} l-40 26 l40 26 Z" fill="${t.block}"/><rect x="252" y="${y - 26}" width="10" height="52" rx="4" fill="${t.block}"/>`); // prev
  p.push(circle(423, y, 66, t.accent));
  p.push(`<path d="M406 ${y - 26} l40 26 l-40 26 Z" fill="${t.bg}"/>`); // play triangle
  p.push(`<path d="M546 ${y - 26} l40 26 l-40 26 Z" fill="${t.block}"/><rect x="584" y="${y - 26}" width="10" height="52" rx="4" fill="${t.block}"/>`); // next
  p.push(circle(696, y, 20, t.icon)); // repeat-ish
  // up-next rows
  y += 120;
  p.push(pill(100, y, 200, 20, t.block));
  y += 50;
  for (let i = 0; i < 2; i++) {
    const ry = y + i * 96;
    p.push(rr(100, ry, 72, 72, 16, t.surfaceAlt));
    p.push(pill(196, ry + 14, 360, 20, t.block));
    p.push(pill(196, ry + 46, 240, 16, t.blockSoft));
  }
  return p.join('');
}

function dashboard(t) {
  const p = [];
  const topY = 150;
  p.push(pill(60, topY + 6, 150, 18, t.blockSoft));
  p.push(pill(60, topY + 34, 280, 28, t.block));
  p.push(circle(784, topY + 34, 40, t.block));
  // balance card
  let y = topY + 108;
  p.push(rr(60, y, 726, 300, 34, t.surface));
  p.push(pill(96, y + 44, 170, 18, t.blockSoft));
  p.push(pill(96, y + 82, 340, 44, t.block));           // big number
  p.push(pill(96, y + 150, 110, 30, t.accent, 0.85));   // +% pill
  // sparkline inside card
  p.push(`<path d="M96 ${y + 250} C 200 ${y + 210}, 300 ${y + 270}, 400 ${y + 230} S 600 ${y + 250}, 726 ${y + 205}" stroke="${t.accent}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
  // stat tiles
  y += 340;
  const tileX = [60, 443];
  for (let c = 0; c < 2; c++) {
    p.push(rr(tileX[c], y, 343, 180, 28, t.surface));
    p.push(circle(tileX[c] + 44, y + 46, 24, t.accentSoft));
    p.push(circle(tileX[c] + 44, y + 46, 11, t.accent));
    p.push(pill(tileX[c] + 30, y + 92, 180, 24, t.block));
    p.push(pill(tileX[c] + 30, y + 130, 120, 16, t.blockSoft));
  }
  // bar chart card
  y += 220;
  p.push(rr(60, y, 726, 320, 34, t.surface));
  p.push(pill(96, y + 40, 180, 20, t.block));
  const bh = [120, 180, 90, 210, 150, 200, 110];
  bh.forEach((h, i) => {
    const bx = 110 + i * 92;
    p.push(rr(bx, y + 280 - h, 52, h, 14, i === 3 ? t.accent : t.blockSoft));
  });
  // rows
  y += 360;
  for (let i = 0; i < 2; i++) {
    const ry = y + i * 96;
    p.push(circle(96, ry + 34, 34, t.surfaceAlt));
    p.push(circle(96, ry + 34, 15, t.accent, 0.6));
    p.push(pill(154, ry + 14, 300, 20, t.block));
    p.push(pill(154, ry + 46, 180, 16, t.blockSoft));
    p.push(pill(620, ry + 22, 130, 22, t.block));
  }
  p.push(bottomNav(t));
  return p.join('');
}

function chat(t) {
  const p = [];
  const topY = 150;
  p.push(circle(84, topY + 20, 30, t.block));           // avatar
  p.push(pill(140, topY + 4, 250, 24, t.block));
  p.push(pill(140, topY + 40, 150, 16, t.blockSoft));
  p.push(circle(784, topY + 20, 24, t.icon, 0.9));
  // bubbles: left neutral, right accent
  let y = topY + 110;
  const bub = (x, w, h, right) => {
    const fill = right ? t.accent : t.surfaceAlt;
    const line = right ? '#ffffff' : t.block;
    let s = rr(x, y, w, h, 30, fill, right ? 0.9 : 1);
    s += pill(x + 30, y + 30, w - 90, 18, line, right ? 0.5 : 1);
    if (h > 90) s += pill(x + 30, y + 66, w - 150, 18, line, right ? 0.4 : 0.8);
    return s;
  };
  p.push(bub(60, 470, 130, false)); y += 160;
  p.push(bub(316, 470, 100, true)); y += 130;
  p.push(bub(60, 360, 100, false)); y += 130;
  p.push(bub(226, 560, 160, true)); y += 190;
  p.push(bub(60, 520, 130, false)); y += 160;
  // input bar
  const iy = H - 220;
  p.push(rr(60, iy, 640, 96, 48, t.surfaceAlt));
  p.push(pill(110, iy + 40, 360, 18, t.block));
  p.push(circle(732, iy + 48, 48, t.accent));
  p.push(`<path d="M714 ${iy + 48} l40 -18 l-14 18 l14 18 Z" fill="${t.bg}"/>`); // send
  return p.join('');
}

const ARCHETYPES = { list, feed, grid, player, dashboard, chat };

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
  // optional CLI filters: archetype ("grid"), theme ("eco"), or key ("grid-eco")
  const only = process.argv.slice(2);
  for (const name of Object.keys(ARCHETYPES)) {
    for (const theme of THEME_NAMES) {
      const key = `${name}-${theme}`;
      if (only.length && !only.includes(name) && !only.includes(theme) && !only.includes(key)) continue;
      const svg = buildSvg(name, THEMES[theme]);
      await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
      const out = path.join(OUT_DIR, `app-${key}.png`);
      await page.screenshot({ path: out });
      console.log('written', path.relative(process.cwd(), out));
    }
  }
  await browser.close();
})();
