/**
 * Third footage pass for the feature-reel cut: the surfaces that need a
 * different project open than the screenshot one.
 *
 * The AI agent screen, an App Preview Video project with its timeline, and the
 * 3D device poses in the palette. Same conventions as the other passes; every
 * step is wrapped so one miss does not cost the run.
 *
 * Run from promo/ with the dev server on :9002: node scripts/capture-features3.js
 */
const path = require('path');
const fs = require('fs');
const lib = require(path.join(__dirname, '../../.claude/skills/app-screenshots/scripts/lib.js'));

const OUT = path.join(__dirname, '../public/features');
const VW = 1600, VH = 1000, DPR = 2;

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

const openStartDialog = async (page) => {
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
  await lib.sleep(1500);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });

  try {
    await openStartDialog(page);

    await step('AI agent screen', async () => {
      await lib.openAgentScreen(page);
      await lib.sleep(2500);
      await rect(page, 'agent', '[role="dialog"]');
      await save(page, '30-agent');
    });

    // ---- an App Preview Video project, for the timeline --------------------
    await step('preview video project', async () => {
      await openStartDialog(page);
      await lib.clickTab(page, 'App Preview Videos');
      await lib.sleep(3000);
      await clickEl(page, () => {
        const img = [...document.querySelectorAll('img[alt]')].find((n) => n.offsetParent !== null);
        if (!img) return null;
        const r = img.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.waitForFunction("location.search.includes('projectId')", { polling: 500, timeout: 60000 });
      await lib.sleep(12000);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(
            (n) => /zoom out/i.test(n.getAttribute('title') || n.getAttribute('aria-label') || '')
          );
          if (b) b.click();
        });
        await lib.sleep(400);
      }
      await lib.sleep(2000);
      await save(page, '31-video-timeline');
    });

    await step('3D device poses', async () => {
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('button, [role="tab"]')].find(
          (b) => (b.textContent || '').trim() === 'Devices' && b.offsetParent !== null
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(4000);
      await rect(page, 'palette', 'aside, [data-sidebar]');
      await save(page, '32-devices-palette');
    });

    // The MCP dialog is capture-features4.js's job, not this pass's: it shows a
    // per tab private link, and that has to be masked in the DOM before the
    // shutter rather than blurred after it.

    const merged = { ...(fs.existsSync(path.join(OUT, 'rects.json'))
      ? JSON.parse(fs.readFileSync(path.join(OUT, 'rects.json'), 'utf8')) : {}), ...rects };
    fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(merged, null, 2));
    console.log('\ncaptured:', done.join(', '));
    if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
  } finally {
    await browser.close();
  }
})();
