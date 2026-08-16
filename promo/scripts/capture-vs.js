/**
 * Captures the feature surfaces the "old way vs new way" promo (PromoVs) needs:
 * start gallery, editor, device poses, export sizes, languages, store preview,
 * AI agent and the app preview video tab. Writes public/vs/*.png at DPR2 plus
 * rects.json with CSS-px boxes for anything the video zooms into.
 *
 * Needs the dev server on :9002. Run from promo/: node scripts/capture-vs.js
 */
const path = require('path');
const fs = require('fs');
const SKILL = path.join(__dirname, '../../.claude/skills/app-screenshots/scripts');
const lib = require(path.join(SKILL, 'lib.js'));

const OUT = path.join(__dirname, '../public/vs');
const VW = 1600, VH = 1000, DPR = 2;
const only = process.argv.slice(2);
const want = (k) => only.length === 0 || only.includes(k);

const rects = { dpr: DPR, viewport: { width: VW, height: VH }, shots: {} };

const boxOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
}, sel);

async function rect(page, shotKey, label, sel) {
  const r = await boxOf(page, sel);
  if (!r) { console.warn(`  ! rect missing: ${shotKey}.${label} (${sel})`); return null; }
  rects.shots[shotKey] = rects.shots[shotKey] || {};
  rects.shots[shotKey][label] = r;
  return r;
}

async function save(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await lib.shot(page, file);
  console.log(`  -> ${name}.png`);
}

/** Clicks a start-dialog tab (Radix: needs a real mouse click at the box center). */
async function startTab(page, label) {
  const box = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('[role="tab"]')]
      .find((n) => n.textContent.trim().startsWith(t) && n.offsetParent !== null);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!box) throw new Error(`start tab not found: ${label}`);
  await page.mouse.click(box.x, box.y);
  await lib.sleep(1200);
}

/** Opens a template card by its visible preview image alt text. */
async function openTemplate(page, name) {
  const ok = await page.evaluate((n) => {
    const img = [...document.querySelectorAll(`img[alt="${n}"]`)].find((i) => i.offsetParent !== null);
    if (!img) return false;
    const card = img.closest('button') || img.closest('[role="button"]') || img.parentElement;
    card.click();
    return true;
  }, name);
  if (!ok) throw new Error(`template card not found: ${name}`);
  await page.waitForFunction("location.search.includes('projectId=')", { polling: 500, timeout: 60000 });
  await lib.sleep(6000);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });

  try {
    await page.goto(lib.APP_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await lib.sleep(8000);

    // The Tips dialog opens over the start dialog on a first visit. Its Close
    // button and the start dialog's share a label, so only close the tips one,
    // then reopen the start dialog from the toolbar if it went with it.
    await page.evaluate(() => {
      const tips = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => /TIP \d+ OF/i.test(d.textContent || ''));
      const b = tips && [...tips.querySelectorAll('button')]
        .find((n) => n.textContent.trim() === 'Close');
      if (b) b.click();
    });
    await lib.sleep(2000);
    const hasStart = await page.evaluate(() => /Start blank/i.test(document.body.innerText));
    if (!hasStart) {
      await page.evaluate(() => {
        const b = document.querySelector('button[title="Select Template"]');
        if (b) b.click();
      });
      await lib.sleep(2000);
    }
    await page.waitForFunction("!!document.body.innerText.match(/Start blank/i)", { polling: 500, timeout: 60000 });
    await lib.sleep(2500);

    // ---- 01 start gallery -------------------------------------------------
    if (want('start')) {
      console.log('start gallery');
      try { await startTab(page, 'App Screenshots'); } catch (e) { console.warn('  ! ' + e.message); }
      await lib.sleep(1500);
      await save(page, '01-start');
      await rect(page, 'start', 'dialog', '[role="dialog"]');
    }

    // ---- 02 agent screen --------------------------------------------------
    if (want('agent')) {
      console.log('agent screen');
      try {
        await lib.openAgentScreen(page);
        await lib.sleep(2500);
        await save(page, '02-agent');
        await page.evaluate(() => {
          const b = document.querySelector('button[aria-label="Back"]');
          if (b) b.click();
        });
        await lib.sleep(1800);
      } catch (e) { console.warn('  ! agent: ' + e.message); }
    }

    // ---- 03 app preview video tab ----------------------------------------
    if (want('video')) {
      console.log('app preview video tab');
      try {
        await startTab(page, 'App Preview Videos');
        await save(page, '03-video-tab');
        await startTab(page, 'App Screenshots');
      } catch (e) { console.warn('  ! video tab: ' + e.message); }
    }

    // ---- open a template --------------------------------------------------
    console.log('opening template');
    const TEMPLATE = process.env.VS_TEMPLATE || 'Nutrio Fitness';
    await openTemplate(page, TEMPLATE);
    await save(page, '04-editor');
    await rect(page, 'editor', 'canvas', '[data-artboard-id], .artboard, main');

    // ---- 05 device palette ------------------------------------------------
    if (want('devices')) {
      console.log('device palette');
      try {
        await lib.clickTab(page, 'Devices');
        await lib.sleep(1500);
        await save(page, '05-devices');
        const opened = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button[title^="Browse 3D"]')].find((n) => n.offsetParent !== null);
          if (!b) return null;
          b.click();
          return b.getAttribute('title');
        });
        if (opened) {
          await lib.sleep(2500);
          console.log('  opened ' + opened);
          await save(page, '06-devices-3d');
        }
      } catch (e) { console.warn('  ! devices: ' + e.message); }
    }

    // ---- 07 language menu -------------------------------------------------
    if (want('lang')) {
      console.log('language menu');
      try {
        const b = await page.evaluate(() => {
          const el = document.querySelector('button[title="Add a language, or translate this project"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (b) {
          await page.mouse.click(b.x, b.y);
          await lib.sleep(1200);
          await save(page, '07-languages');
        } else console.warn('  ! language button missing');
        await page.keyboard.press('Escape');
        await lib.sleep(800);
      } catch (e) { console.warn('  ! lang: ' + e.message); }
    }

    // ---- 08 export dialog -------------------------------------------------
    if (want('export')) {
      console.log('export dialog');
      try {
        await lib.clickMenuItem(page, 'Export', 'Artboards as images');
        await lib.sleep(2000);
        await save(page, '08-export');
        await rect(page, 'export', 'dialog', '[role="dialog"]');
        await page.keyboard.press('Escape');
        await lib.sleep(1000);
      } catch (e) { console.warn('  ! export: ' + e.message); }
    }

    // ---- 09 store preview -------------------------------------------------
    if (want('preview')) {
      console.log('store preview');
      try {
        await lib.clickMenuItem(page, 'Preview the project', 'Store listing');
        await lib.sleep(4000);
        await save(page, '09-store-preview');
        await page.keyboard.press('Escape');
        await lib.sleep(1000);
      } catch (e) {
        console.warn('  ! store preview: ' + e.message);
        try {
          await lib.clickMenuItem(page, 'Preview the project', 'Full screen');
          await lib.sleep(4000);
          await save(page, '09-store-preview');
          await page.keyboard.press('Escape');
        } catch (e2) { console.warn('  ! preview fallback: ' + e2.message); }
      }
    }

    fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 2));
    console.log('done');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
