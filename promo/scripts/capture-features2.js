/**
 * Second footage pass for the feature-reel cut: the surfaces that only look
 * right once somebody is signed in and has actually worked in the project.
 *
 * Pass one (capture-features.js) grabs the signed-out surfaces and the live
 * community feed. This pass seeds a local sign-in, makes a few real edits so
 * History and Versions have rows in them, and grabs the Save and Share menus
 * without their "sign in" hints. Nothing here writes to the backend: the token
 * is local, and every shot is of a menu or panel that renders from local state.
 *
 * Run from promo/ with the dev server on :9002: node scripts/capture-features2.js
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

const clickEl = async (page, pick, args = []) => {
  const box = await page.evaluate(pick, ...args);
  if (!box) throw new Error('element not found');
  await page.mouse.click(box.x, box.y);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });

  try {
    // Answer the backend locally. Without this the seeded token reaches the
    // real box, comes back 401, and src/lib/cloud/api.ts signs the session out
    // mid-run, which is how the first pass ended up shooting a "sign in" chip
    // on every cloud row. Nothing is ever sent to the live box.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (!/pb\.openscrgen\.app/.test(url)) return req.continue();
      const json = (body) =>
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(body),
        });
      if (url.includes('/auth/methods')) {
        return json({
          enabled: true, writes: true, signin: true,
          google: true, github: true, githubPat: false, cloudProjects: true,
        });
      }
      if (/\/auth\/(google|github)$/.test(url)) {
        return json({
          token: 'promo-local-token',
          record: { id: 'promo-viewer', handle: 'samrivera', name: 'Sam Rivera', followers: 0 },
        });
      }
      return json({ items: [], page: 1, perPage: 30, totalItems: 0 });
    });

    // Both halves of the sign-in, or it evaporates: reconcileDiscoverSession
    // drops the community session whenever the storage account disagrees with
    // it or is missing entirely.
    await page.evaluateOnNewDocument(() => {
      const id = 'promo-viewer';
      localStorage.setItem(
        'open-screenshot-generator.account',
        JSON.stringify({
          provider: 'google',
          accessToken: 'promo-local-token',
          account: { id, name: 'Sam Rivera', email: 'sam@example.com' },
        })
      );
      localStorage.setItem(
        'open-screenshot-generator.discover.session',
        JSON.stringify({
          token: 'promo-local-token',
          provider: 'google',
          accountId: id,
          viewer: { id, handle: 'samrivera', name: 'Sam Rivera', followers: 0, isViewer: true },
        })
      );
    });

    await page.goto(lib.APP_URL, { waitUntil: 'networkidle2', timeout: 120000 });
    await lib.sleep(9000);

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
    await lib.clickTab(page, 'App Screenshots');
    await lib.sleep(2500);

    await page.evaluate((name) => {
      const input = document.querySelector('input[placeholder^="Search templates"]');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, name);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, TEMPLATE.split(' ')[0]);
    await lib.sleep(2500);
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

    // ---- make the session look worked in ----------------------------------
    // Nudging a headline with the keyboard is the cheapest edit that lands a
    // named row in History; four of them fill the panel without changing the
    // design enough to notice between shots.
    await step('a few real edits', async () => {
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('[data-element-id]')].find(
          (n) => !n.querySelector('img, canvas') && (n.innerText || '').trim().length > 2
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(1500);
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
        await page.keyboard.press(key);
        await lib.sleep(700);
      }
    });

    const dockTab = async (name) => {
      await lib.clickTab(page, name);
      await lib.sleep(1200);
    };

    await step('named versions', async () => {
      await dockTab('Versions');
      for (const label of ['Before the rewrite', 'Gold headlines']) {
        await clickEl(page, () => {
          const el = [...document.querySelectorAll('button')].find(
            (b) => (b.textContent || '').trim() === 'Save this state'
          );
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await lib.sleep(900);
        await page.evaluate(() => {
          const input = [...document.querySelectorAll('input')].find((n) => /^Version \d+$/.test(n.value));
          if (input) input.select();
        });
        await page.keyboard.type(label, { delay: 25 });
        await page.keyboard.press('Enter');
        await lib.sleep(2500);
      }
      await lib.sleep(1500);
      await save(page, '20-versions');
    });

    await step('history rows', async () => {
      await dockTab('History');
      await save(page, '21-history');
      await dockTab('Properties');
    });

    // ---- toolbar, signed in ------------------------------------------------
    const openMenu = async (title) => {
      await clickEl(page, (t) => {
        const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === t);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, [title]);
      await lib.sleep(1300);
    };
    const closeMenu = async () => {
      await page.keyboard.press('Escape');
      await lib.sleep(800);
    };

    await step('share menu, signed in', async () => {
      await openMenu('Share this project');
      await rect(page, 'shareMenu', '[role="menu"]');
      await save(page, '22-share-menu');
      await closeMenu();
    });

    await step('save menu, signed in', async () => {
      await openMenu('Save this project, or upload it to a store');
      await rect(page, 'saveMenu', '[role="menu"]');
      await save(page, '23-save-menu');
      await closeMenu();
    });

    // ---- languages ---------------------------------------------------------
    await step('add language dialog', async () => {
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('button')].find((b) =>
          /language/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || '') ||
          (b.textContent || '').trim() === 'Language'
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(1500);
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('[role="menuitem"]')].find((i) =>
          (i.textContent || '').includes('Add language')
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(3000);
      await rect(page, 'langDialog', '[role="dialog"]');
      await save(page, '24-languages');
      await closeMenu();
    });

    // ---- fonts -------------------------------------------------------------
    await step('font list with import', async () => {
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('[data-element-id]')].find(
          (n) => !n.querySelector('img, canvas') && (n.innerText || '').trim().length > 2
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(2000);
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('button')].find(
          (b) => /font/i.test(b.getAttribute('aria-label') || '') ||
            (b.getAttribute('role') === 'combobox' && /[A-Z]/.test((b.textContent || '').trim()))
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(2500);
      await rect(page, 'fontList', '[role="listbox"], [role="dialog"]');
      await save(page, '25-fonts');
      await closeMenu();
    });

    // ---- panels on another screen -----------------------------------------
    await step('panel and display menu', async () => {
      await openMenu('Panel and display options');
      await rect(page, 'panelMenu', '[role="menu"]');
      await save(page, '26-panels-menu');
      await closeMenu();
    });

    const merged = { ...(fs.existsSync(path.join(OUT, 'rects.json'))
      ? JSON.parse(fs.readFileSync(path.join(OUT, 'rects.json'), 'utf8')) : {}), ...rects };
    fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(merged, null, 2));
    console.log('\ncaptured:', done.join(', '));
    if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
  } finally {
    await browser.close();
  }
})();
