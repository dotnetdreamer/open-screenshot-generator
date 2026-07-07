/**
 * One-off: renders the Gmail-inspired skeleton inbox screen used by the
 * Inboxly template and saves it to public/data/projects/inboxly-screen-inbox.png.
 * Screen designed at 846x1710 CSS px (iphone-15 screen area at the centered
 * phone recipe: 600x1200 @1.5 minus bezel padding), captured at DPR 2.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 846;
const H = 1710;
const OUT = path.resolve(__dirname, '../../../../public/data/projects/inboxly-screen-inbox.png');

const GRAY = '#dfe3f0';      // avatar / primary skeleton line
const GRAY_LIGHT = '#e9ecf6'; // secondary skeleton line
const PURPLE = '#8b95f5';    // accent (unread dots, compose, active nav)
const ICON = '#9aa1b5';      // inactive nav icons

function magnifier(cx, cy) {
  return `<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="#b0b7cc" stroke-width="6"/>
          <line x1="${cx + 11}" y1="${cy + 11}" x2="${cx + 22}" y2="${cy + 22}" stroke="#b0b7cc" stroke-width="6" stroke-linecap="round"/>`;
}

function pencil(x, y, s, color) {
  // filled diagonal pencil in a 100x100 box scaled by s
  return `<g transform="translate(${x},${y}) scale(${s / 100})">
    <path d="M12 88 L18 64 L64 18 L82 36 L36 82 Z" fill="${color}"/>
    <path d="M68 14 L79 3 L97 21 L86 32 Z" fill="${color}"/>
  </g>`;
}

function chatBubble(cx, cy) {
  return `<g>
    <rect x="${cx - 32}" y="${cy - 28}" width="64" height="48" rx="14" fill="${PURPLE}"/>
    <path d="M${cx - 18} ${cy + 16} L${cx - 26} ${cy + 34} L${cx - 2} ${cy + 20} Z" fill="${PURPLE}"/>
  </g>`;
}

function people(cx, cy) {
  return `<g fill="none" stroke="${ICON}" stroke-width="6" stroke-linecap="round">
    <circle cx="${cx - 8}" cy="${cy - 12}" r="11"/>
    <path d="M${cx - 28} ${cy + 26} a 20 16 0 0 1 40 0"/>
    <path d="M${cx + 16} ${cy - 22} a 10 10 0 0 1 6 18"/>
    <path d="M${cx + 22} ${cy + 6} a 16 14 0 0 1 12 18"/>
  </g>`;
}

function grid(cx, cy) {
  const s = 22, g = 8;
  const cells = [
    [cx - s - g / 2, cy - s - g / 2], [cx + g / 2, cy - s - g / 2],
    [cx - s - g / 2, cy + g / 2], [cx + g / 2, cy + g / 2],
  ];
  return cells.map(([x, y]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="5" fill="${ICON}"/>`).join('');
}

function buildSvg() {
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#f8f9fd"/>`);

  // ---- top row: avatar, search pill, compose pencil ----
  const topY = 140;
  parts.push(`<circle cx="82" cy="${topY + 50}" r="42" fill="${GRAY}"/>`);
  parts.push(`<rect x="148" y="${topY}" width="560" height="100" rx="50" fill="#e9edf8"/>`);
  parts.push(magnifier(206, topY + 46));
  parts.push(`<rect x="262" y="${topY + 40}" width="300" height="20" rx="10" fill="${GRAY}"/>`);
  parts.push(pencil(742, topY + 22, 56, PURPLE));

  // ---- avatar chip row ----
  const rowY = 330;
  for (let i = 0; i < 6; i++) {
    const cx = 86 + i * 136;
    parts.push(`<circle cx="${cx}" cy="${rowY}" r="46" fill="${GRAY}"/>`);
    if (i === 0 || i === 3) {
      parts.push(`<circle cx="${cx - 34}" cy="${rowY + 34}" r="10" fill="${PURPLE}"/>`);
    }
  }

  // ---- inbox list rows ----
  const line1Widths = [430, 350, 470, 390, 300, 450, 360, 420, 330];
  const line2Widths = [280, 220, 300, 240, 190, 280, 230, 260, 200];
  const unread = new Set([0, 3, 5]);
  const listTop = 470;
  const rowH = 132;
  for (let i = 0; i < 9; i++) {
    const y = listTop + i * rowH;
    parts.push(`<circle cx="86" cy="${y + 46}" r="46" fill="${GRAY}"/>`);
    parts.push(`<rect x="168" y="${y + 18}" width="${line1Widths[i]}" height="22" rx="11" fill="${GRAY}"/>`);
    parts.push(`<rect x="168" y="${y + 58}" width="${line2Widths[i]}" height="18" rx="9" fill="${GRAY_LIGHT}"/>`);
    if (unread.has(i)) {
      parts.push(`<circle cx="782" cy="${y + 46}" r="9" fill="${PURPLE}"/>`);
    }
  }

  // ---- bottom nav ----
  const navTop = H - 150;
  parts.push(`<rect x="0" y="${navTop}" width="${W}" height="150" fill="#f1f3fb"/>`);
  const navCy = navTop + 66;
  parts.push(chatBubble(120, navCy));
  parts.push(people(322, navCy));
  parts.push(grid(524, navCy));
  parts.push(`<circle cx="726" cy="${navCy}" r="24" fill="none" stroke="${ICON}" stroke-width="6"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('\n')}</svg>`;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox'],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0">${buildSvg()}</body></html>`);
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log('written', OUT);
})();
