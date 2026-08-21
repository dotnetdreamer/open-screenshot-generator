/**
 * Footage for the feature-reel cut (`src/features/`, composition PromoFeatures).
 *
 * Drives the real app on the dev server (:9002) and writes DPR2 plates into
 * public/features/, plus rects.json with the bounding boxes the edit crops to.
 * Every step is wrapped, so one surface that has moved does not cost the run:
 * whatever it manages to grab is written and the rest is reported at the end.
 *
 * Run from promo/: node scripts/capture-features.js
 */
const path = require('path');
const fs = require('fs');
const lib = require(path.join(__dirname, '../../.claude/skills/app-screenshots/scripts/lib.js'));

const OUT = path.join(__dirname, '../public/features');
const VW = 1600, VH = 1000, DPR = 2;
const TEMPLATE = process.env.FEAT_TEMPLATE || 'Cinevault Stream';

const rects = {};
const done = [];
const failed = [];

const save = async (page, name) => {
  await lib.shot(page, path.join(OUT, `${name}.png`));
  done.push(name);
  console.log(`  -> ${name}.png`);
};

/** Records a CSS-px box under `key` so crop-features.js can cut to it. */
const rect = async (page, key, selector) => {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);
  if (box) rects[key] = box;
  return box;
};

const step = async (name, fn) => {
  try {
    console.log(name);
    await fn();
  } catch (err) {
    failed.push(`${name}: ${String(err.message || err).slice(0, 160)}`);
    console.log(`  !! ${name}: ${String(err.message || err).slice(0, 160)}`);
  }
};

/** Real mouse click at the centre of the first element matching `pick`. */
const clickEl = async (page, pick, args = []) => {
  const box = await page.evaluate(pick, ...args);
  if (!box) throw new Error('element not found');
  await page.mouse.click(box.x, box.y);
};

const centreOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });

  try {
    await page.goto(lib.APP_URL, { waitUntil: 'networkidle2', timeout: 120000 });
    await lib.sleep(9000);

    // Close ONLY the tips wizard: the start dialog behind it has a button with
    // the same label, and closing twice dismisses both.
    await page.evaluate(() => {
      const tips = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => /TIP \d+ OF/i.test(d.textContent || ''));
      const b = tips && [...tips.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Close');
      if (b) b.click();
    });
    await lib.sleep(2500);
    if (!(await page.evaluate(() => /Start blank/i.test(document.body.innerText)))) {
      await page.evaluate(() => document.querySelector('button[title="Select Template"]')?.click());
      await lib.sleep(2500);
    }
    await page.waitForFunction("!!document.body.innerText.match(/Start blank/i)", { polling: 500, timeout: 60000 });
    await lib.sleep(1500);

    // ---- start dialog surfaces -------------------------------------------
    await step('community feed', async () => {
      await lib.clickTab(page, 'Community');
      await lib.sleep(6000); // the feed is a live fetch
      await rect(page, 'startDialog', '[role="dialog"]');
      await save(page, '01-discover');
    });

    await step('template gallery', async () => {
      await lib.clickTab(page, 'App Screenshots');
      await lib.sleep(3000);
      await rect(page, 'startTabs', '[role="tablist"]');
      await save(page, '02-templates');
    });

    await step('preview video templates', async () => {
      await lib.clickTab(page, 'App Preview Videos');
      await lib.sleep(3000);
      await save(page, '03-video-templates');
      await lib.clickTab(page, 'App Screenshots');
      await lib.sleep(2000);
    });

    // ---- into the editor --------------------------------------------------
    console.log(`opening ${TEMPLATE}`);
    await page.evaluate((name) => {
      const input = document.querySelector('input[placeholder^="Search templates"]');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, name.split(' ')[0]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, TEMPLATE);
    await lib.sleep(2500);
    // The card's alt is the template's `name`, which is not always the slug
    // ("Cinevault", not "Cinevault Stream"), so match on the first word.
    await clickEl(page, (word) => {
      const img = [...document.querySelectorAll('img[alt]')].find(
        (n) => n.offsetParent !== null && n.getAttribute('alt').includes(word)
      );
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, [TEMPLATE.split(' ')[0]]);
    await page.waitForFunction("location.search.includes('projectId')", { polling: 500, timeout: 60000 });
    await lib.sleep(9000);

    // Zoom out first: at 100% the artboards come out cropped.
    await step('zoom to fit', async () => {
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(
            (n) => /zoom out/i.test(n.getAttribute('title') || n.getAttribute('aria-label') || '')
          );
          if (b) b.click();
        });
        await lib.sleep(400);
      }
      await lib.sleep(1500);
    });

    await step('editor canvas', async () => {
      await rect(page, 'canvas', '[data-canvas-area], main');
      await save(page, '04-editor');
    });

    // ---- right dock -------------------------------------------------------
    await step('right dock rect', async () => {
      const box = await page.evaluate(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find(
          (n) => n.textContent.trim() === 'Properties' && n.offsetParent !== null
        );
        if (!tab) return null;
        const dock = tab.closest('div[class*="flex"]')?.parentElement?.parentElement;
        const r = (dock || tab).getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
      if (box) rects.dock = box;
    });

    await step('select a phone', async () => {
      await clickEl(page, () => {
        const nodes = [...document.querySelectorAll('[data-element-id]')];
        const el = nodes.find((n) => n.querySelector('img, canvas'));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(2500);
      await save(page, '05-properties');
    });

    await step('versions panel', async () => {
      await lib.clickTab(page, 'Versions');
      await lib.sleep(2000);
      await save(page, '06-versions');
    });

    await step('history panel', async () => {
      await lib.clickTab(page, 'History');
      await lib.sleep(1500);
      await save(page, '07-history');
      await lib.clickTab(page, 'Properties');
      await lib.sleep(1000);
    });

    // ---- toolbar menus ----------------------------------------------------
    const openMenu = async (title) => {
      await clickEl(page, (t) => {
        const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === t);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, [title]);
      await lib.sleep(1200);
    };
    const closeMenu = async () => {
      await page.keyboard.press('Escape');
      await lib.sleep(800);
    };

    await step('share menu', async () => {
      await openMenu('Share this project');
      await rect(page, 'menu', '[role="menu"]');
      await save(page, '08-share-menu');
      await closeMenu();
    });

    await step('save menu', async () => {
      await openMenu('Save this project, or upload it to a store');
      await rect(page, 'saveMenu', '[role="menu"]');
      await save(page, '09-save-menu');
      await closeMenu();
    });

    await step('panel and display options', async () => {
      await openMenu('Panel and display options');
      await rect(page, 'panelMenu', '[role="menu"]');
      await save(page, '10-panels-menu');
      await closeMenu();
    });

    // ---- dialogs ----------------------------------------------------------
    await step('export dialog', async () => {
      await lib.clickMenuItem(page, 'Export', 'Artboards as images');
      await page.waitForFunction("!!document.querySelector('#export-as-is')", { polling: 400, timeout: 20000 });
      await lib.sleep(1500);
      await rect(page, 'exportDialog', '[role="dialog"]');
      await save(page, '11-export');
      await closeMenu();
    });

    await step('languages dialog', async () => {
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('button')].find((b) =>
          /language/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || '')
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(2500);
      await rect(page, 'langDialog', '[role="dialog"]');
      await save(page, '12-languages');
      await closeMenu();
    });

    // ---- text: fonts ------------------------------------------------------
    await step('font list', async () => {
      await clickEl(page, () => {
        const nodes = [...document.querySelectorAll('[data-element-id]')];
        const el = nodes.find(
          (n) => !n.querySelector('img, canvas') && (n.innerText || '').trim().length > 2
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(2000);
      await save(page, '13-text-selected');
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('button[role="combobox"], button')].find((b) =>
          /font/i.test(b.getAttribute('aria-label') || '') ||
          /Inter|Roboto|Poppins|Montserrat|Space Grotesk/.test((b.textContent || '').trim())
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(2000);
      await save(page, '14-fonts');
      await closeMenu();
    });

    fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 2));
    console.log('\ncaptured:', done.join(', '));
    if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
  } finally {
    await browser.close();
  }
})();
