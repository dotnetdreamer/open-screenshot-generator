/**
 * Second pass for the PromoVs footage: the shots capture-vs.js got wrong.
 * Opens a template whose phones carry real screens, zooms the canvas out so
 * whole artboards are visible, and grabs the export dialog (the "every store
 * size in one pass" beat). Writes public/vs/1x-*.png.
 *
 * Run from promo/: node scripts/capture-vs2.js
 */
const path = require('path');
const fs = require('fs');
const lib = require(path.join(__dirname, '../../.claude/skills/app-screenshots/scripts/lib.js'));

const OUT = path.join(__dirname, '../public/vs');
const VW = 1600, VH = 1000, DPR = 2;
const TEMPLATE = process.env.VS_TEMPLATE || 'Cinevault Stream';

const save = async (page, name) => {
  await lib.shot(page, path.join(OUT, `${name}.png`));
  console.log(`  -> ${name}.png`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });

  try {
    await page.goto(lib.APP_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await lib.sleep(8000);
    await page.evaluate(() => {
      const tips = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => /TIP \d+ OF/i.test(d.textContent || ''));
      const b = tips && [...tips.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Close');
      if (b) b.click();
    });
    await lib.sleep(2000);
    if (!(await page.evaluate(() => /Start blank/i.test(document.body.innerText)))) {
      await page.evaluate(() => document.querySelector('button[title="Select Template"]')?.click());
      await lib.sleep(2000);
    }
    await page.waitForFunction("!!document.body.innerText.match(/Start blank/i)", { polling: 500, timeout: 60000 });
    await lib.sleep(2000);

    // The start dialog opens on the community feed now; the template gallery
    // (and its search box) only exist under the App Screenshots tab. Radix tabs
    // ignore synthetic clicks, so use a real mouse click at the trigger center.
    const tab = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="tab"]')]
        .find((n) => n.textContent.trim().startsWith('App Screenshots') && n.offsetParent !== null);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!tab) throw new Error('App Screenshots tab not found');
    await page.mouse.click(tab.x, tab.y);
    await lib.sleep(2500);

    console.log(`opening ${TEMPLATE}`);
    // Most cards are below the fold, so filter the gallery down first. The
    // search box is a controlled React input: set it through the native setter
    // and fire `input`, since page.click on it trips protocolTimeout.
    await page.evaluate((n) => {
      const el = [...document.querySelectorAll('input')]
        .find((i) => /Search templates/i.test(i.placeholder || ''));
      if (!el) return;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, n);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, TEMPLATE);
    await lib.sleep(2500);

    const ok = await page.evaluate((n) => {
      const img = [...document.querySelectorAll(`img[alt="${n}"]`)].find((i) => i.offsetParent !== null);
      if (!img) return false;
      (img.closest('button') || img.parentElement).click();
      return true;
    }, TEMPLATE);
    if (!ok) throw new Error('template card not found: ' + TEMPLATE);
    await page.waitForFunction("location.search.includes('projectId=')", { polling: 500, timeout: 60000 });
    await lib.sleep(9000);

    // Collapse the right dock so the canvas gets the width, then zoom out until
    // whole artboards fit. Zoom Out steps in fixed increments, so click and read.
    await page.evaluate(() => document.querySelector('button[aria-label="Collapse right panel"]')?.click());
    await lib.sleep(1200);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => document.querySelector('button[title="Zoom Out"]')?.click());
      await lib.sleep(700);
    }
    await lib.sleep(2500);
    const zoom = await page.evaluate(() => (document.body.innerText.match(/(\d+)%/) || [])[0]);
    console.log('  zoom ' + zoom);
    await save(page, '1x-editor-fit');

    // Export dialog. Radix opens the menu on pointerdown, so mouse-click both.
    console.log('export dialog');
    await lib.clickMenuItem(page, 'Export', 'Artboards as images');
    await lib.sleep(4500);
    const dlg = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const cs = getComputedStyle(d);
      return {
        text: d.innerText.slice(0, 400),
        box: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        opacity: cs.opacity, transform: cs.transform,
      };
    });
    console.log('  dialog: ' + JSON.stringify(dlg));
    await save(page, '1x-export');

    fs.writeFileSync(path.join(OUT, 'export-dialog.json'), JSON.stringify(dlg, null, 2));
    console.log('done');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
