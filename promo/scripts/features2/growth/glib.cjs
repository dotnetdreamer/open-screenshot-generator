// Helpers for the Growth captures: headless Edge on the frozen build with the
// e2e Tauri mock (its HTTP rules answer App Store Connect and Apple's public
// lookup), Apple's image CDN answered from local files, every other outside
// host refused, and the growth database seeded the way the e2e helpers do it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRATCH = require('path').join(__dirname, '..', 'rig');
const REPO = require('path').resolve(__dirname, '..', '..', '..', '..');
const capLib = require(require('path').join(__dirname, '..', 'rig', 'cap-lib.cjs'));
const tauriInit = require(require('path').join(__dirname, '..', 'rig', 'tauri-init.cjs'));
const lib = capLib.lib;
const puppeteer = require(`${REPO}/.claude/skills/app-screenshots/scripts/node_modules/puppeteer-core`);

const BASE = process.env.EDITOR_URL || 'http://127.0.0.1:9311';
const HERE = __dirname;
const ASSETS = path.join(HERE, 'assets');
const JUNIPER_SET = `${REPO}/promo/public/features2/juniper-set`;
const OUT = `${REPO}/promo/public/features2/growth`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The local file behind one of the fake mzstatic addresses (seed.mjs shotUrl/iconUrl). */
function assetFor(requestUrl) {
  const match = /\/v4\/osg\/([^/]+)\.png\//.exec(requestUrl);
  if (!match) return null;
  const name = match[1];
  const juniper = /^juniper-(en|de)-(\d)$/.exec(name);
  if (juniper) return path.join(JUNIPER_SET, juniper[1], `b${juniper[2]}.png`);
  const file = path.join(ASSETS, `${name}.png`);
  return fs.existsSync(file) ? file : null;
}

async function launchEdge({ width = 1440, height = 900, dpr = 2 } = {}) {
  const args = [
    '--no-sandbox',
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`,
    // One --disable-features: a second one would replace the first. Windows occlusion
    // and the intensive timer throttling are off so an idle headless page keeps its
    // frames and timers; GPU rasterization is off as a 2x capture left whole layers blank.
    '--disable-features=LazyImageLoading,AutomaticLazyImageLoading,LazyFrameLoading,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    '--force-gpu-mem-available-mb=8192',
    '--disable-gpu-rasterization',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--lang=en-US',
    ...(process.env.EDGE_ARGS ? process.env.EDGE_ARGS.split(' ').filter(Boolean) : []),
  ];
  const defaultViewport = { width, height, deviceScaleFactor: dpr };
  const port = 9700 + Math.floor(Math.random() * 250);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-growth-edge-'));
  const child = spawn(lib.EDGE, ['--headless', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args, 'about:blank'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let browser = null;
  for (let i = 0; i < 80 && !browser; i++) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport, protocolTimeout: 600000 });
    } catch {
      await sleep(250);
    }
  }
  if (!browser) throw new Error(`Edge did not expose a debug port on ${port}`);
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 300));
  });
  // The page counts as focused and active the whole time, as the one window on a desk would.
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  return { browser, page, profile };
}

/**
 * The editor with the desktop mock, `rules` answering tauri-plugin-http, and
 * Apple's CDN served from disk. Nothing else leaves the machine.
 */
async function openEditor({ rules = [], theme = 'dark', width = 1440, height = 900, dpr = 2 } = {}) {
  const { browser, page, profile } = await launchEdge({ width, height, dpr });
  const blocked = new Set();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return req.continue();
    if (/^https:\/\/is\d-ssl\.mzstatic\.com\//.test(u)) {
      const file = assetFor(u);
      if (file) return req.respond({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' }, body: fs.readFileSync(file) });
      blocked.add(u);
      return req.respond({ status: 404, body: '' });
    }
    blocked.add(u.slice(0, 120));
    return req.abort();
  });
  const cfg = {
    ...tauriInit.DEFAULT,
    os: 'macos',
    responses: {
      abs_mcp_status: capLib.MCP_RUNNING,
      abs_get_settings: { show_assistant_window: false, mcp_server_enabled: true, devtools_open: false },
      abs_claude_detect: capLib.CLAUDE_READY,
      abs_codex_detect: capLib.CODEX_READY,
    },
    http: rules,
  };
  await page.evaluateOnNewDocument(tauriInit(cfg));
  // Claude Code's one-shot prompts answered by a function the script puts in the page.
  await page.evaluateOnNewDocument(() => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals) return;
    const original = internals.invoke;
    window.__osgPrompts = [];
    internals.invoke = (cmd, args, options) => {
      if ((cmd === 'abs_claude_prompt' || cmd === 'abs_codex_prompt') && typeof window.__osgPrompt === 'function') {
        window.__osgPrompts.push(args);
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            try {
              resolve(window.__osgPrompt(args));
            } catch (error) {
              reject(error);
            }
          }, window.__osgPromptDelay ?? 900);
        });
      }
      return original(cmd, args, options);
    };
  });
  await page.evaluateOnNewDocument((theme) => {
    try {
      localStorage.setItem('open-screenshot-generator.theme', theme);
    } catch {}
  }, theme);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await lib.dismissTipsDialog(page);
  startKicker(page);
  return { browser, page, blocked, profile };
}

/**
 * Headless Edge can stop producing frames on an idle page: a click that waits
 * on one, or a requestAnimationFrame poll, then hangs until something asks for
 * a frame (seen here: Keywords sat for four minutes until a screenshot came).
 * A 2 x 2 px screenshot every two seconds keeps frames coming.
 */
const kickers = new WeakMap();
function startKicker(page) {
  const state = { on: true };
  kickers.set(page, state);
  (async () => {
    while (state.on && !page.isClosed()) {
      await sleep(2000);
      if (!state.on) break;
      await page.screenshot({ clip: { x: 0, y: 0, width: 2, height: 2 }, type: 'png' }).catch(() => {});
    }
  })();
}
function stopKicker(page) {
  const state = kickers.get(page);
  if (state) state.on = false;
}

/** Rows straight into the growth database, as tests/e2e/helpers/growth.ts putGrowthRows does. */
async function putGrowthRows(page, rows) {
  await page.evaluate(async (rows) => {
    const exists = (await indexedDB.databases()).some((database) => database.name === 'OpenScreenshotGeneratorGrowth');
    const open = exists ? indexedDB.open('OpenScreenshotGeneratorGrowth') : indexedDB.open('OpenScreenshotGeneratorGrowth', 30);
    open.onupgradeneeded = () => {
      const db = open.result;
      const store = (name, keyPath, indexes) => {
        const created = db.createObjectStore(name, { keyPath });
        for (const [index, p] of indexes) created.createIndex(index, p);
      };
      store('days', 'key', [['appId', 'appId'], ['[appId+date]', ['appId', 'date']]]);
      store('reviews', 'id', [['appId', 'appId'], ['[appId+createdDate]', ['appId', 'createdDate']]]);
      store('ratings', 'key', [['appId', 'appId']]);
      store('events', 'id', [['appId', 'appId'], ['[appId+date]', ['appId', 'date']]]);
      store('listings', 'appId', []);
      store('meta', 'key', []);
      store('ratingDays', 'key', [['appId', 'appId'], ['[appId+date]', ['appId', 'date']]]);
      store('reviewMarks', 'id', [['appId', 'appId']]);
      store('keywordDays', 'key', [['appId', 'appId'], ['[appId+country+date]', ['appId', 'country', 'date']]]);
    };
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const names = Object.keys(rows);
    const tx = db.transaction(names, 'readwrite');
    for (const name of names) for (const row of rows[name] ?? []) tx.objectStore(name).put(row);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, rows);
}

async function readMeta(page, key) {
  return page.evaluate(async (key) => {
    const open = indexedDB.open('OpenScreenshotGeneratorGrowth');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const request = db.transaction('meta').objectStore('meta').get(key);
      const row = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return row ? row.value : undefined;
    } finally {
      db.close();
    }
  }, key);
}

/** Seed, reload, and land on an empty editor with Growth one click away. */
async function seedAndReload(page, seed) {
  await page.evaluate((storage) => {
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  }, seed.storage);
  await putGrowthRows(page, seed.rows);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await lib.dismissTipsDialog(page);
  await dismissStartDialog(page);
}

async function dismissStartDialog(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const open = await page
      .waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /Start a new project|blank canvas/i.test(d.textContent || '')), { timeout: 15000, polling: 300 })
      .then(() => true)
      .catch(() => false);
    if (!open) return;
    await sleep(800);
    await page.keyboard.press('Escape');
    await sleep(1200);
    const still = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /Start a new project|blank canvas/i.test(d.textContent || '')));
    if (!still) return;
  }
}

const GROWTH_BUTTON = 'Growth: downloads, reviews and your store page';

async function openGrowth(page) {
  await page.waitForFunction((label) => !!document.querySelector(`nav[aria-label="Views"] button[aria-label="${label}"], nav[aria-label="Views"] button[title="${label}"]`), { timeout: 60000, polling: 300 }, GROWTH_BUTTON);
  await page.evaluate((label) => {
    const nav = document.querySelector('nav[aria-label="Views"]');
    const button = [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.title === label);
    button.click();
  }, GROWTH_BUTTON);
  await page.waitForSelector('[data-testid="growth-view"]', { visible: true, timeout: 60000 });
  await page.waitForFunction(() => (document.querySelector('[data-testid="growth-view"] [aria-label="App"]')?.textContent || '').includes('Juniper'), { timeout: 60000, polling: 300 });
}

async function goSection(page, name) {
  const ok = await page.evaluate((name) => {
    const nav = document.querySelector('[data-testid="growth-view"] nav[aria-label="Growth sections"]');
    const button = [...nav.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(name));
    if (!button) return false;
    button.click();
    return true;
  }, name);
  if (!ok) throw new Error('No Growth section ' + name);
  await sleep(600);
}

/**
 * Click the first element matching `selector` whose text includes `text`: a
 * DOM click for plain buttons, or with `real` a pointer click through the
 * input pipeline, which Radix menus and selects need (they open on pointerdown).
 */
async function clickReal(page, selector, text = null, { scope = '[data-testid="growth-view"]', exact = false, real = false } = {}) {
  const handle = await page.evaluateHandle(
    (selector, text, scope, exact) => {
      const root = (scope && document.querySelector(scope)) || document;
      return [...root.querySelectorAll(selector)].find((el) => {
        if (text === null) return true;
        const t = (el.textContent || '').trim();
        return exact ? t === text : t.includes(text);
      }) || null;
    },
    selector,
    text,
    scope,
    exact
  );
  const element = handle.asElement();
  if (!element) throw new Error(`Nothing to click: ${selector} ${text ?? ''}`);
  await element.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
  if (real) await element.click();
  else await element.evaluate((el) => el.click());
  return element;
}

/** Pick an option of a Radix Select by its trigger's aria-label. */
async function pickSelect(page, label, option) {
  // Showing it already: nothing to pick.
  const shown = await page.evaluate((label) => (document.querySelector(`[aria-label="${label}"]`)?.textContent || '').trim(), label);
  if (shown === option) return;
  // The kicker's screenshot resizes the page for a moment in Chrome, and a Radix Select closes on resize.
  const kicking = Boolean(kickers.get(page)?.on);
  stopKicker(page);
  await sleep(300);
  try {
    await clickReal(page, `[aria-label="${label}"]`, null, { real: true });
    await page.waitForSelector('[role="option"]', { visible: true, timeout: 10000 });
    await sleep(250);
    const handle = await page.evaluateHandle((option) => [...document.querySelectorAll('[role="option"]')].find((el) => (el.textContent || '').trim() === option) || null, option);
    const element = handle.asElement();
    if (!element) throw new Error(`No option ${option} in ${label}`);
    await element.click();
    await sleep(500);
  } finally {
    if (kicking) startKicker(page);
  }
}

/** Every image on screen loaded, each wait capped (a lazy one off screen never decodes). */
async function settleImages(page, ms = 1200) {
  await page.evaluate(() =>
    Promise.all(
      [...document.images].map((img) =>
        Promise.race([img.complete ? Promise.resolve() : new Promise((r) => img.addEventListener('load', r, { once: true })), img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 6000))])
      )
    )
  );
  await sleep(ms);
}

/** Open toasts, by text. */
async function toasts(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="region"] li')].filter((li) => li.getAttribute('data-state') === 'open').map((li) => (li.textContent || '').trim().slice(0, 120)));
}

/** Wait for toasts to go, closing them when they linger. */
async function clearToasts(page, timeout = 9000) {
  const until = Date.now() + timeout;
  let list = await toasts(page);
  if (list.length) console.log('toasts:', list);
  while (list.length && Date.now() < until) {
    await sleep(500);
    list = await toasts(page);
  }
  if (list.length) {
    await page.evaluate(() => {
      for (const li of document.querySelectorAll('[role="region"] li[data-state="open"]')) {
        const close = li.querySelector('button[toast-close], button[aria-label="Close"]') || [...li.querySelectorAll('button')].pop();
        close?.click();
      }
    });
    await sleep(800);
  }
}

/** A rect in CSS px of the 1440 x 900 viewport, rounded to tenths. */
/**
 * The part of an element the picture shows, in CSS px of the viewport: its box
 * cut to every scrolling ancestor and to the window. Null when none of it shows
 * (scrolled away under the header, say).
 */
async function rectOf(page, find, ...args) {
  const rect = await page.evaluate((source, args) => {
    // eslint-disable-next-line no-new-func
    const el = new Function('args', `return (${source})(...args)`)(args);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = node.getBoundingClientRect();
      left = Math.max(left, clip.left);
      top = Math.max(top, clip.top);
      right = Math.min(right, clip.right);
      bottom = Math.min(bottom, clip.bottom);
    }
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, window.innerWidth);
    bottom = Math.min(bottom, window.innerHeight);
    if (right - left < 1 || bottom - top < 1) return null;
    const cut = left > r.left + 0.5 || top > r.top + 0.5 || right < r.right - 0.5 || bottom < r.bottom - 0.5;
    return { x: left, y: top, w: right - left, h: bottom - top, cut };
  }, find.toString(), args);
  if (!rect) return null;
  const round = (v) => Math.round(v * 10) / 10;
  const out = { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) };
  // Kept off the JSON: saveRects names the rects the picture cuts, for the report.
  if (rect.cut) Object.defineProperty(out, 'cut', { value: true, enumerable: false });
  return out;
}

/**
 * The window as a PNG. A full 2880 x 1800 frame of Growth runs to hundreds of
 * kilobytes; a few dozen means a layer came out blank (the GPU path does that
 * now and then), so the frame is taken again.
 */
async function shot(page, name, { blur = true } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  // A control the script used keeps the keyboard focus and its focus ring (the
  // page counts as focused here); nobody's keyboard is on it in the picture.
  if (blur) {
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active && active !== document.body) active.blur();
    });
    await sleep(300);
  }
  let buffer = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    buffer = await page.screenshot({ type: 'png' });
    if (buffer.length > 120_000) break;
    console.log(`shot ${name} came out blank (${buffer.length} bytes), taking it again`);
    await page.evaluate(() => window.dispatchEvent(new Event('resize'))).catch(() => {});
    await sleep(1500);
  }
  fs.writeFileSync(file, buffer);
  console.log('shot', file, buffer.length, 'bytes');
  return file;
}

const RECTS = path.join(OUT, 'rects.json');
function saveRects(file, rects) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(RECTS, 'utf8'));
  } catch {}
  // Only what the picture shows: rectOf cuts each rect to what is on screen and
  // gives null for one scrolled out of sight, which is left out here.
  const onScreen = ([, r]) => r && r.w > 0 && r.h > 0;
  const clean = Object.fromEntries(Object.entries(rects).filter(onScreen));
  const missing = Object.entries(rects).filter((entry) => !onScreen(entry)).map(([key]) => key);
  const cut = Object.entries(clean).filter(([, r]) => r.cut).map(([key]) => key);
  if (missing.length) console.log('rects not on screen in', file, missing);
  if (cut.length) console.log('rects cut to the visible part in', file, cut);
  all[file] = clean;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(RECTS, JSON.stringify(all, null, 2) + '\n');
}

async function closeBrowser(browser, profile) {
  for (const page of await browser.pages().catch(() => [])) stopKicker(page);
  await sleep(2200);
  try {
    await browser.close();
  } catch {}
  await sleep(800);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}

module.exports = {
  SCRATCH,
  REPO,
  OUT,
  BASE,
  sleep,
  lib,
  openEditor,
  putGrowthRows,
  readMeta,
  seedAndReload,
  openGrowth,
  goSection,
  clickReal,
  pickSelect,
  settleImages,
  toasts,
  clearToasts,
  rectOf,
  shot,
  saveRects,
  closeBrowser,
};
