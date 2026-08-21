/**
 * Fourth footage pass for the feature-reel cut.
 *
 * Two shots the other passes cannot take:
 *
 * 1. The MCP dialog with its private link masked. The link carries a per tab
 *    code, and nothing with a code in it belongs in a video, so the text is
 *    replaced in the DOM before the shutter rather than blurred afterwards.
 * 2. A real detached panel window. `?panel=dock` is the same bundle in panel
 *    mode, and on the web the editor projects the dock over a BroadcastChannel,
 *    which two tabs of one browser share, so a second page renders the live
 *    panels of the first.
 *
 * Run from promo/ with the dev server on :9002: node scripts/capture-features4.js
 */
const path = require('path');
const fs = require('fs');
const lib = require(path.join(__dirname, '../../.claude/skills/app-screenshots/scripts/lib.js'));

const OUT = path.join(__dirname, '../public/features');
const VW = 1600, VH = 1000, DPR = 2;
const TEMPLATE = process.env.FEAT_TEMPLATE || 'Cinevault';

const done = [];
const failed = [];

const save = async (page, name) => {
  await lib.shot(page, path.join(OUT, `${name}.png`));
  done.push(name);
  console.log(`  -> ${name}.png`);
};

const step = async (name, fn) => {
  try {
    console.log(name);
    await fn();
  } catch (err) {
    failed.push(`${name}: ${String(err.message || err).slice(0, 200)}`);
    console.log(`  !! ${name}: ${String(err.message || err).slice(0, 200)}`);
  }
};

const clickEl = async (page, pick, args = []) => {
  const box = await page.evaluate(pick, ...args);
  if (!box) throw new Error('element not found');
  await page.mouse.click(box.x, box.y);
};

const enterEditor = async (page) => {
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
  }, TEMPLATE);
  await lib.sleep(2500);
  await clickEl(page, (word) => {
    const img = [...document.querySelectorAll('img[alt]')].find(
      (n) => n.offsetParent !== null && n.getAttribute('alt').includes(word)
    );
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [TEMPLATE]);
  await page.waitForFunction("location.search.includes('projectId')", { polling: 500, timeout: 60000 });
  await lib.sleep(10000);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });

  try {
    await enterEditor(page);

    await step('MCP dialog, link masked', async () => {
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('button')].find((b) => /MCP/.test(b.textContent || ''));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(3000);
      // The code is the last path segment of every mcp.openscrgen.app URL on
      // screen, in the link field, the CLI line and the two JSON blocks.
      await page.evaluate(() => {
        const MASK = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
        const swap = (text) => text.replace(/(mcp\.openscrgen\.app\/mcp\/)[0-9a-f]{8,}/g, `$1${MASK}`);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          if (node.nodeValue && node.nodeValue.includes('mcp.openscrgen.app')) node.nodeValue = swap(node.nodeValue);
        }
        for (const input of document.querySelectorAll('input')) {
          if (input.value && input.value.includes('mcp.openscrgen.app')) input.value = swap(input.value);
        }
      });
      await lib.sleep(600);
      await save(page, '34-mcp');
      await page.keyboard.press('Escape');
      await lib.sleep(800);
    });

    // ---- the detached dock, in a window of its own -------------------------
    await step('detached panel window', async () => {
      // Select something first, so the Properties panel in the other window has
      // an element to describe rather than the artboard defaults.
      await clickEl(page, () => {
        const el = [...document.querySelectorAll('[data-element-id]')].find((n) => n.querySelector('img, canvas'));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await lib.sleep(2500);

      const panel = await browser.newPage();
      await panel.setViewport({ width: 460, height: 900, deviceScaleFactor: DPR });
      await panel.goto(`${lib.APP_URL}/?panel=dock`, { waitUntil: 'networkidle2', timeout: 120000 });
      await lib.sleep(9000);
      // Nudge the editor so the host projects a fresh state to the channel.
      await page.keyboard.press('ArrowRight');
      await lib.sleep(2500);
      await panel.bringToFront();
      await lib.sleep(1500);
      await lib.shot(panel, path.join(OUT, '35-detached-panel.png'));
      done.push('35-detached-panel');
      console.log('  -> 35-detached-panel.png');
      const text = await panel.evaluate(() => document.body.innerText.slice(0, 240));
      console.log('     panel says:', JSON.stringify(text));
      await panel.close();
      await page.bringToFront();
    });

    console.log('\ncaptured:', done.join(', '));
    if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
  } finally {
    await browser.close();
  }
})();
