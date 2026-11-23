/**
 * Captures the real Every device view for the promo: a template opened, then
 * Convert the project to another device format > Every device, with the iPad
 * 13-inch, Mac and Android phone layouts. Dev server on :9002 required.
 * node scripts/capture-every-device.cjs [outDir], then the every-* crops in prep-shots.mjs
 */
const path = require('path');
const fs = require('fs');
const lib = require(path.resolve(__dirname, '../../.claude/skills/app-screenshots/scripts/lib.js'));

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '.captures', 'every'));
const TEMPLATE = process.env.TEMPLATE || 'Droply Habits';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: 1600, height: 1000, dpr: 2 });
  try {
    await page.goto(lib.APP_URL, { waitUntil: 'networkidle2', timeout: 180000 });
    await lib.sleep(8000);
    await page.evaluate(() => {
      const tips = [...document.querySelectorAll('[role="dialog"]')].find((d) => /TIP \d+ OF/i.test(d.textContent || ''));
      const b = tips && [...tips.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Close');
      if (b) b.click();
    });
    await lib.sleep(2000);
    if (!(await page.evaluate(() => /Start blank/i.test(document.body.innerText)))) {
      await page.evaluate(async () => {
        document.querySelector('button[aria-label="Create"]')?.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        document.querySelector('button[aria-label="Start from a template"]')?.click();
      });
      await lib.sleep(2000);
    }
    await page.waitForFunction("!!document.body.innerText.match(/Start blank/i)", { polling: 500, timeout: 60000 });
    await lib.sleep(1500);
    const tab = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="tab"]')].find((n) => n.textContent.trim().startsWith('App Screenshots') && n.offsetParent !== null);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!tab) throw new Error('App Screenshots tab not found');
    await page.mouse.click(tab.x, tab.y);
    await lib.sleep(2500);
    await page.evaluate((n) => {
      const el = [...document.querySelectorAll('input')].find((i) => /Search templates/i.test(i.placeholder || ''));
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
    await page.waitForFunction("location.search.includes('projectId=')", { polling: 500, timeout: 90000 });
    await lib.sleep(9000);

    // Convert the project to another device format > Every device (Radix: real mouse clicks)
    const trig = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((n) => /^Convert the project to another device format/.test(n.getAttribute('title') || ''));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!trig) throw new Error('device format button not found');
    await page.mouse.click(trig.x, trig.y);
    await lib.sleep(1200);
    const item = await page.evaluate(() => {
      const m = [...document.querySelectorAll('[role="menuitem"]')].find((n) => /^Every device/.test(n.textContent.trim()));
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!item) throw new Error('Every device menu item not found');
    await page.mouse.click(item.x, item.y);
    await page.waitForSelector('[data-every-device]', { timeout: 30000 });
    await lib.sleep(5000);

    const shotDialog = async (name) => {
      const box = await page.evaluate(() => {
        const d = document.querySelector('[data-every-device]');
        const r = d.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      await page.screenshot({ path: path.join(OUT, name + '.png'), clip: box });
      fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(box));
      console.log('  -> ' + name, JSON.stringify(box));
    };
    await lib.sleep(6000);
    await page.screenshot({ path: path.join(OUT, 'full-first.png') });
    // All devices: every layout side by side
    const all = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-every-device] button, [data-every-device] [role="radio"], [data-every-device] [role="tab"]')].find((n) => /All devices/.test(n.textContent));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (all) {
      await page.mouse.click(all.x, all.y);
      await lib.sleep(9000);
      await page.screenshot({ path: path.join(OUT, 'all-devices.png') });
      // scroll the view down in steps and keep each
      for (let k = 1; k <= 3; k++) {
        await page.evaluate(() => {
          const d = document.querySelector('[data-every-device]');
          const sc = [...d.querySelectorAll('*')].filter((n) => n.scrollHeight > n.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(n).overflowY));
          for (const s of sc) s.scrollBy(0, 700);
        });
        await lib.sleep(3500);
        await page.screenshot({ path: path.join(OUT, `all-devices-${k}.png`) });
      }
      await page.mouse.click(all.x - 110, all.y);
      await lib.sleep(4000);
    }
    for (const device of ['iPad 13-inch', 'Mac', 'Android phone']) {
      const pos = await page.evaluate((name) => {
        const c = [...document.querySelectorAll('[data-every-device] [data-device-choice]')].find((n) => n.textContent.includes(name));
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, device);
      if (!pos) { console.log('no choice for ' + device); continue; }
      await page.mouse.click(pos.x, pos.y);
      await lib.sleep(9000);
      await shotDialog('every-' + device.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    }
    console.log('done');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
