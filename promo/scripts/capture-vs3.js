/**
 * Third pass for the PromoVs footage: the Languages dialog (the 57 locale list
 * behind the translate beat) and the translation table. Writes public/vs/2x-*.
 *
 * Run from promo/: node scripts/capture-vs3.js
 */
const path = require('path');
const fs = require('fs');
const lib = require(path.join(__dirname, '../../.claude/skills/app-screenshots/scripts/lib.js'));

const OUT = path.join(__dirname, '../public/vs');
const VW = 1600, VH = 1000, DPR = 2;
const TEMPLATE = process.env.VS_TEMPLATE || 'Cinevault';

const save = async (page, name) => {
  await lib.shot(page, path.join(OUT, `${name}.png`));
  console.log(`  -> ${name}.png`);
};

const box = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null).pop();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
}, sel);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });
  const boxes = {};

  try {
    await page.goto(lib.APP_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await lib.sleep(8000);
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => /TIP \d+ OF/i.test(d.textContent || ''));
      const b = t && [...t.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Close');
      if (b) b.click();
    });
    await lib.sleep(2000);
    if (!(await page.evaluate(() => /Start blank/i.test(document.body.innerText)))) {
      await page.evaluate(() => document.querySelector('button[title="Select Template"]')?.click());
      await lib.sleep(2500);
    }

    const tab = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="tab"]')]
        .find((n) => n.textContent.trim().startsWith('App Screenshots') && n.offsetParent !== null);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(tab.x, tab.y);
    await lib.sleep(2500);

    await page.evaluate((n) => {
      const el = [...document.querySelectorAll('input')].find((i) => /Search templates/i.test(i.placeholder || ''));
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, n);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, TEMPLATE);
    await lib.sleep(2500);
    await page.evaluate((n) => {
      const img = [...document.querySelectorAll(`img[alt="${n}"]`)].find((i) => i.offsetParent !== null);
      (img.closest('button') || img.parentElement).click();
    }, TEMPLATE);
    await page.waitForFunction("location.search.includes('projectId=')", { polling: 500, timeout: 60000 });
    await lib.sleep(9000);

    // Language menu -> "Add language" opens the Languages dialog (57 locales).
    console.log('languages dialog');
    const btn = await box(page, 'button[title="Add a language, or translate this project"]');
    await page.mouse.click(btn.x + btn.w / 2, btn.y + btn.h / 2);
    await lib.sleep(1200);
    const item = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="menuitem"]')]
        .find((n) => /Add language/i.test(n.textContent));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!item) throw new Error('Add language menu item not found');
    await page.mouse.click(item.x, item.y);
    await lib.sleep(3500);
    boxes.languages = await box(page, '[role="dialog"]');
    console.log('  ' + JSON.stringify(boxes.languages));
    await save(page, '2x-languages');

    fs.writeFileSync(path.join(OUT, 'boxes.json'), JSON.stringify(boxes, null, 2));
    console.log('done');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
