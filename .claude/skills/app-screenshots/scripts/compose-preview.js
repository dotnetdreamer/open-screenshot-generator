/**
 * Composes a wide 3:1 "phone carousel" card preview from a template's exported
 * artboard PNGs, matching the App Screenshots category (previewAspect '3 / 1',
 * previewFit 'contain'). Screens sit as rounded, shadowed cards on the
 * template's own background, App-Store-listing style.
 *
 * CLI:  node compose-preview.js <artboardDir> <bgCss> <outFile> [maxScreens]
 * Lib:  renderOnPage(page, dir, bgCss, outFile, max)  // reuse one browser page
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CW = 1500, CH = 500, PAD = 46, GAP = 26, RATIO = 1290 / 2796;

// `ratio` is the artboard aspect (width/height): phones ~0.46, Apple Watch
// ~0.82. It sets how tall the cards can be before N of them overflow the strip
// width, so a wider aspect (watch) is sized down to fit instead of clipping.
function buildHTML(dir, bg, max, ratio = RATIO) {
  const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort();
  const pick = files.slice(0, max);
  const n = pick.length || 1;
  const availW = CW - 2 * PAD - (n - 1) * GAP;
  const hByWidth = (availW / n) / ratio;
  const imgH = Math.min(CH - 2 * PAD, hByWidth);
  const imgs = pick.map((f) => {
    const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    return `<img src="data:image/png;base64,${b64}" style="height:${imgH}px;width:auto;border-radius:${imgH * 0.055}px;box-shadow:0 ${imgH * 0.03}px ${imgH * 0.06}px rgba(0,0,0,0.28);outline:1px solid rgba(127,127,127,0.14);outline-offset:-1px"/>`;
  }).join('');
  return { html: `<!doctype html><html><body style="margin:0"><div style="width:${CW}px;height:${CH}px;background:${bg};display:flex;align-items:center;justify-content:center;gap:${GAP}px;overflow:hidden">${imgs}</div></body></html>`, n: pick.length };
}

async function renderOnPage(page, dir, bg, out, max = 6, ratio = RATIO) {
  const { html, n } = buildHTML(dir, bg, max, ratio);
  await page.setContent(html);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: CW, height: CH } });
  return n;
}

async function compose(dir, bg, out, max = 6) {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, args: ['--no-sandbox'],
    defaultViewport: { width: CW, height: CH, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const n = await renderOnPage(page, dir, bg, out, max);
  await browser.close();
  console.log('written', out, `(${n} screens)`);
}

if (require.main === module) {
  const [dir, bg, out, max] = process.argv.slice(2);
  if (!dir || !bg || !out) throw new Error('usage: node compose-preview.js <artboardDir> <bgCss> <outFile> [maxScreens]');
  compose(dir, bg, out, max ? parseInt(max, 10) : 6);
}
module.exports = { compose, renderOnPage, EDGE, CW, CH };
