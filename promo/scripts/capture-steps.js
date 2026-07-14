/**
 * Captures the 3-step flow (pick template -> add screenshot -> preview) for the
 * PromoSteps mobile video: public/steps/01..05 + upload-screen.png + rects.json
 * with CSS-px bounding boxes of everything the video highlights. If the shots
 * change, mirror the new rects.json numbers into src/steps/style.ts (RECTS).
 * Needs the dev server on :9002 and the app-screenshots skill deps installed.
 */
const path = require('path');
const fs = require('fs');
const SKILL = path.join(__dirname, '../../.claude/skills/app-screenshots/scripts');
const puppeteer = require(path.join(SKILL, 'node_modules/puppeteer-core'));
const lib = require(path.join(SKILL, 'lib.js'));

const OUT = path.join(__dirname, '../public/steps');
const SCRATCH = __dirname;
const VW = 1600, VH = 1200, DPR = 2;

const rects = { dpr: DPR, viewport: { width: VW, height: VH }, shots: {} };

async function rect(page, fn, label, shotKey) {
  const r = await page.evaluate(fn);
  if (!r) throw new Error('rect not found: ' + label);
  rects.shots[shotKey] = rects.shots[shotKey] || {};
  rects.shots[shotKey][label] = r;
  return r;
}

const getRect = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: lib.EDGE,
    headless: true,
    args: ['--no-sandbox', `--window-size=${VW},${VH}`],
    defaultViewport: { width: VW, height: VH, deviceScaleFactor: DPR },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

  // ---- 0. The "your screenshot" art (846x1710 @DPR2) --------------------
  const artPage = await browser.newPage();
  await artPage.setViewport({ width: 846, height: 1710, deviceScaleFactor: DPR });
  await artPage.goto('file:///' + path.join(SCRATCH, 'fitness-screen.html').replace(/\\/g, '/'));
  await artPage.evaluate('document.fonts.ready.then(() => true)');
  await lib.sleep(400);
  await artPage.screenshot({ path: path.join(OUT, 'upload-screen.png') });
  await artPage.close();
  console.log('upload-screen.png done');

  // ---- 1. Start dialog with the template gallery ------------------------
  await page.goto(lib.APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    "[...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Start blank'))",
    { timeout: 90000, polling: 500 }
  );
  // Zenfit card preview image fully loaded
  await page.waitForFunction(
    "(() => { const i = document.querySelector('img[alt=\\'Zenfit Yoga\\']'); return !!i && i.complete && i.naturalWidth > 0; })()",
    { timeout: 60000, polling: 500 }
  );
  await page.evaluate('document.fonts.ready.then(() => true)');
  await lib.sleep(1200);
  await rect(page, getRect("img[alt='Zenfit Yoga']"), 'zenfitImg', 'start');
  await page.evaluate(`(() => {
    const img = document.querySelector("img[alt='Zenfit Yoga']");
    const card = img && img.closest('.group');
    if (card) card.setAttribute('data-zenfit-card', '1');
  })()`);
  await rect(page, getRect('[data-zenfit-card]'), 'zenfitCard', 'start');
  await rect(page, getRect('[role="dialog"]'), 'dialog', 'start');
  const tabRect = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || '').includes('App Screenshots'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  rects.shots.start.appScreenshotsTab = tabRect;
  await page.screenshot({ path: path.join(OUT, '01-start.png') });
  console.log('01-start.png done', JSON.stringify(rects.shots.start));

  // ---- 2. Open the template ---------------------------------------------
  await page.evaluate(`document.querySelector('[data-zenfit-card]').click()`);
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 60000, polling: 500 });
  await page.waitForFunction(
    "document.querySelectorAll('[data-element-id]').length > 40",
    { timeout: 60000, polling: 500 }
  );
  await page.evaluate('document.fonts.ready.then(() => true)');
  await lib.sleep(4000); // template images settle
  await rect(page, getRect('[data-element-id="zf_b3_phone"]'), 'phoneFit', 'editor');
  const previewBtn = await page.evaluate(`(() => {
    const el = document.querySelector('button[title="Preview final result"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  rects.shots.editor = rects.shots.editor || {};
  rects.shots.editor.previewButton = previewBtn;
  await page.screenshot({ path: path.join(OUT, '02-editor.png') });
  console.log('02-editor.png done', JSON.stringify(rects.shots.editor));

  // ---- 3. Zoom in and select the straight phone on 'Find Class' ---------
  for (let i = 0; i < 6; i++) {
    const r = await page.evaluate(getRect('[data-element-id="zf_b3_phone"]'));
    if (r && r.h >= 640) break;
    await lib.clickByTitle(page, 'Zoom In');
    await lib.sleep(350);
  }
  await page.evaluate(`document.querySelector('[data-element-id="zf_b3_phone"]').scrollIntoView({ block: 'center', inline: 'center' })`);
  await lib.sleep(600);
  const phoneR = await rect(page, getRect('[data-element-id="zf_b3_phone"]'), 'phone', 'selected');
  await page.mouse.click(phoneR.x + phoneR.w / 2, phoneR.y + phoneR.h / 2);
  await page.waitForFunction(
    "[...document.querySelectorAll('button')].some((b) => /^(Upload|Change) Screenshot$/.test((b.textContent || '').trim()))",
    { timeout: 20000, polling: 500 }
  );
  await lib.sleep(800);
  // phone rect may have shifted after selection re-render
  await rect(page, getRect('[data-element-id="zf_b3_phone"]'), 'phone', 'selected');
  const uploadBtn = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => /^(Upload|Change) Screenshot$/.test((b.textContent || '').trim()));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, label: (el.textContent || '').trim() };
  })()`);
  rects.shots.selected.uploadButton = uploadBtn;
  await lib.sleep(400);
  await page.screenshot({ path: path.join(OUT, '03-selected.png') });
  console.log('03-selected.png done', JSON.stringify(rects.shots.selected));

  // ---- 4. Upload the screenshot ------------------------------------------
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 20000 }),
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /^(Upload|Change) Screenshot$/.test((b.textContent || '').trim())
      );
      if (!btn) throw new Error('Upload/Change Screenshot button not found');
      btn.click();
    }),
  ]);
  await chooser.accept([path.join(OUT, 'upload-screen.png')]);
  await lib.sleep(2500);
  await rect(page, getRect('[data-element-id="zf_b3_phone"]'), 'phone', 'uploaded');
  rects.shots.uploaded.uploadButton = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => /^(Upload|Change) Screenshot$/.test((b.textContent || '').trim()));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  await page.screenshot({ path: path.join(OUT, '04-uploaded.png') });
  console.log('04-uploaded.png done', JSON.stringify(rects.shots.uploaded));

  // ---- 5. Preview mode -----------------------------------------------------
  rects.shots.preview = {};
  rects.shots.preview.previewButton = await page.evaluate(`(() => {
    const el = document.querySelector('button[title="Preview final result"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  await lib.clickByTitle(page, 'Preview final result');
  await page.waitForFunction(
    "!!document.querySelector('[aria-label=\\'Preview\\']')",
    { timeout: 20000, polling: 500 }
  );
  await lib.sleep(2500);
  await rect(page, getRect('[aria-label="Preview"] .shadow-2xl'), 'artboard', 'preview');
  const strip = await page.evaluate(`(() => {
    const btns = [...document.querySelectorAll('[aria-label="Preview"] button[title]')].filter((b) => b.querySelector('div'));
    if (!btns.length) return null;
    const first = btns[0].getBoundingClientRect();
    const last = btns[btns.length - 1].getBoundingClientRect();
    return { x: first.x, y: first.y, w: last.x + last.width - first.x, h: first.height, count: btns.length };
  })()`);
  rects.shots.preview.filmstrip = strip;
  await page.screenshot({ path: path.join(OUT, '05-preview.png') });
  console.log('05-preview.png done', JSON.stringify(rects.shots.preview));

  fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 2));
  console.log('rects.json written');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
