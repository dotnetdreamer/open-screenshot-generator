/**
 * Reusable helpers for driving Open Screenshot Generator in headless Edge.
 * See ../SKILL.md for the rules these encode (clip screenshots, Radix tabs,
 * rAF-starved waits, project-creation settling, download capture).
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP_URL = 'http://localhost:9002';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Edge 150 broke puppeteer.launch: the process it starts hands off to a child and
 * exits 0, so puppeteer reports "Failed to launch the browser process: Code: 0".
 * Start Edge ourselves with a debug port and connect to it instead. Kept as a
 * fallback rather than the only path, so this keeps working if Edge fixes it.
 */
async function startBrowser({ width, height, dpr }) {
  const args = [
    '--no-sandbox',
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`,
    // Headless Edge 150 defers image loads ("lazy placeholders"), which hangs
    // the in-app html-to-image export; it also throttles backgrounded pages,
    // stalling long exports. Both bite hardest in the spawn+connect fallback.
    '--disable-features=LazyImageLoading,AutomaticLazyImageLoading,LazyFrameLoading',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ];
  const defaultViewport = { width, height, deviceScaleFactor: dpr };
  try {
    return await puppeteer.launch({ executablePath: EDGE, headless: true, args, defaultViewport });
  } catch (err) {
    const port = 9200 + Math.floor(Math.random() * 500);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-edge-'));
    const child = spawn(
      EDGE,
      ['--headless', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args, 'about:blank'],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();
    const browserURL = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 40; i++) {
      try {
        const b = await puppeteer.connect({ browserURL, defaultViewport });
        return b;
      } catch {
        await sleep(250);
      }
    }
    throw new Error(`Edge did not expose a debug port on ${port}: ${err.message}`);
  }
}

async function launch({ width = 1720, height = 1400, dpr = 1, downloadDir } = {}) {
  const browser = await startBrowser({ width, height, dpr });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  if (downloadDir) {
    fs.mkdirSync(downloadDir, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
  }
  return { browser, page };
}

/** Click a button by exact trimmed text (DOM click — fine for plain buttons). */
async function clickByText(page, text) {
  const ok = await page.evaluate((text) => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === text);
    if (el) { el.click(); return true; }
    return false;
  }, text);
  if (!ok) throw new Error('button not found: ' + text);
}

/**
 * Click the Nth button by its title (category cards, toolbar) or accessible name
 * (palette tiles). Tiles dropped `title` when they gained the hover card that
 * shows their library id, so their name now reads `Add <label> (<libraryId>)` —
 * pass just `Add <label>` and the id suffix is matched for you.
 */
async function clickByTitle(page, title, index = 0) {
  const ok = await page.evaluate((title, index) => {
    const els = [...document.querySelectorAll('button')].filter((b) => {
      if (b.getAttribute('title') === title) return true;
      const aria = b.getAttribute('aria-label');
      return aria === title || (aria || '').startsWith(`${title} (`);
    });
    if (!els[index]) return false;
    els[index].click();
    return true;
  }, title, index);
  if (!ok) throw new Error('tile not found: ' + title);
}

/** Click a button whose text CONTAINS the given fragment (e.g. the AI agent banner). */
async function clickByTextContains(page, text) {
  const ok = await page.evaluate((text) => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(text));
    if (el) { el.click(); return true; }
    return false;
  }, text);
  if (!ok) throw new Error('button not found (contains): ' + text);
}

/**
 * Step from the template gallery into the AI agent screen (the banner above the
 * tabs). Back out again with the header's `button[aria-label="Back"]`.
 */
async function openAgentScreen(page) {
  await clickByTextContains(page, 'Open the agent');
  await page.waitForFunction(
    "[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Choose files')",
    { timeout: 30000, polling: 500 }
  );
  await sleep(500);
}

/** Open the app and start a blank project; resolves once the app has settled. */
async function startBlankProject(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // The blank-canvas card's button reads "Start blank" (inside the
  // "Start with a blank canvas" card), so match by fragment, not exact text.
  await page.waitForFunction(
    "[...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Start blank'))",
    { timeout: 90000, polling: 500 }
  );
  await clickByTextContains(page, 'Start blank');
  // Project creation lands asynchronously; interacting earlier races a re-render.
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 30000, polling: 500 });
  await sleep(1500);
}

/**
 * Open a Radix dropdown by its trigger's title (or aria-label) and click the
 * menu item whose text contains `itemText`. Both clicks go through the real
 * mouse: the trigger opens on pointerdown, which a DOM `.click()` never fires,
 * and the item lives in a portal that only exists once the menu is open.
 */
async function clickMenuItem(page, triggerTitle, itemText) {
  const trigger = await page.evaluate((title) => {
    const el = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('title') === title || b.getAttribute('aria-label') === title
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, triggerTitle);
  if (!trigger) throw new Error('menu trigger not found: ' + triggerTitle);
  await page.mouse.click(trigger.x, trigger.y);
  await page.waitForFunction(
    `[...document.querySelectorAll('[role="menuitem"]')].some((i) => (i.textContent || '').includes(${JSON.stringify(itemText)}))`,
    { timeout: 15000, polling: 500 }
  );
  const item = await page.evaluate((text) => {
    const el = [...document.querySelectorAll('[role="menuitem"]')].find((i) =>
      (i.textContent || '').includes(text)
    );
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, itemText);
  await page.mouse.click(item.x, item.y);
  await sleep(400);
}

/** Radix tabs need a real mouse click at the trigger's center. */
async function clickTab(page, name) {
  const box = await page.evaluate((name) => {
    const el = [...document.querySelectorAll('[role="tab"]')].find((b) => (b.textContent || '').includes(name));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  if (!box) throw new Error('tab not found: ' + name);
  await page.mouse.click(box.x, box.y);
  await sleep(700);
}

/** Click a palette tile and wait until a new element exists on the canvas. */
async function addTileAndCount(page, tileTitle, { settleMs = 1500 } = {}) {
  const before = await page.$$eval('[data-element-id]', (els) => els.length);
  await clickByTitle(page, tileTitle);
  await page.waitForFunction(
    `document.querySelectorAll('[data-element-id]').length > ${before}`,
    { timeout: 30000, polling: 500 }
  );
  await sleep(settleMs); // 3D geometry build + first render
}

/** Upload an image into the currently selected element's screenshot slot. */
async function uploadScreenshotToSelected(page, filePath) {
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 20000 }),
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent || '').trim() === 'Upload Screenshot'
      );
      if (!btn) throw new Error('Upload Screenshot button not found (is the element selected?)');
      btn.click();
    }),
  ]);
  await chooser.accept([filePath]);
  await sleep(1800); // FileReader + texture upload + render
}

/**
 * Trigger the app's PNG export and wait for the files to download.
 *
 * The toolbar button opens ONE OF TWO dialogs, depending on the project:
 * - Screenshot projects get "Export Screenshots" (#export-as-is + optional
 *   App Store size checkboxes). extraFormats ('gen-ios', 'gen-ipad-pro-13',
 *   'gen-ipad-11') tick those; each adds one download per artboard.
 * - App Preview VIDEO projects get "Export App Preview Video" (#apv-styled),
 *   whose PNG path is the "Export PNG stills instead" button. extraFormats
 *   does not apply there (a video board has no App Store screenshot tiers).
 */
async function exportArtboards(page, downloadDir, expectedCount, timeoutMs = 180000, extraFormats = []) {
  // The toolbar's export button is a menu, and the render item is labelled for
  // the project: "Artboards as images" for screenshots, "App preview video" for
  // App Preview projects. Both open the dialog this helper drives.
  try {
    await clickMenuItem(page, 'Export', 'Artboards as images');
  } catch {
    await clickMenuItem(page, 'Export', 'App preview video');
  }
  await page.waitForFunction(
    "!!document.querySelector('#export-as-is') || !!document.querySelector('#apv-styled')",
    { timeout: 15000, polling: 500 }
  );
  await sleep(300);
  const isVideoDialog = await page.evaluate(() => !!document.querySelector('#apv-styled'));
  if (isVideoDialog) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
        (b.textContent || '').includes('Export PNG stills')
      );
      if (!btn) throw new Error('App Preview dialog: PNG stills button not found');
      btn.click();
    });
  } else {
    for (const id of extraFormats) {
      await page.evaluate((id) => document.getElementById(id)?.click(), id);
    }
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="dialog"] button')].find(
        (b) => (b.textContent || '').trim() === 'Export'
      );
      if (!btn) throw new Error('dialog Export button not found');
      btn.click();
    });
  }
  const deadline = Date.now() + timeoutMs;
  let files = [];
  while (Date.now() < deadline) {
    files = fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir).filter((f) => f.endsWith('.png')) : [];
    if (files.length >= expectedCount) break;
    await sleep(1000);
  }
  await sleep(3000); // let the last write finish
  return fs.readdirSync(downloadDir).filter((f) => f.endsWith('.png'));
}

/** Full-page screenshot ONLY — clip-based captures remount the palette. */
async function shot(page, file) {
  await page.screenshot({ path: file });
}

/**
 * Wait until every font spec the mounted artboard elements actually use passes
 * document.fonts.check. A fixed sleep is not enough: if Google Fonts is slow
 * (Unbounded is a heavy family), the export captures a fallback whose different
 * glyph widths re-space and re-wrap every headline. Tolerant: times out quietly
 * rather than failing the export, since a missing decorative font still beats
 * no export at all.
 */
async function waitForProjectFonts(page, { timeout = 60000 } = {}) {
  try {
    await page.waitForFunction(
      () => {
        const specs = new Set();
        for (const el of document.querySelectorAll('[data-element-id]')) {
          for (const n of el.querySelectorAll('*')) {
            if (!n.textContent || !n.textContent.trim()) continue;
            const cs = getComputedStyle(n);
            specs.add(`${cs.fontStyle} ${cs.fontWeight} 40px ${cs.fontFamily}`);
          }
        }
        return document.fonts.status === 'loaded' && [...specs].every((s) => document.fonts.check(s));
      },
      { timeout, polling: 500 }
    );
  } catch {
    // Timed out; the export proceeds with whatever is loaded.
  }
}

/**
 * A fresh headless profile gets the first-run Tips dialog, which sits above the
 * start dialog and hides every template card (each launch() uses a new profile,
 * so this happens on EVERY harness run). Its shadcn X carries an sr-only
 * "Close", so an exact-text match finds it on either tip page. Tolerant: if no
 * tips dialog shows up quickly, there is nothing to dismiss.
 */
async function dismissTipsDialog(page, { timeout = 20000 } = {}) {
  try {
    await page.waitForFunction(
      "[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Close')",
      { timeout, polling: 400 }
    );
  } catch {
    return false; // no tips dialog, nothing to do
  }
  await sleep(500);
  await page.evaluate(
    "[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Close').click()"
  );
  await sleep(500);
  return true;
}

module.exports = {
  APP_URL,
  EDGE,
  sleep,
  launch,
  clickByText,
  clickByTextContains,
  clickByTitle,
  clickMenuItem,
  openAgentScreen,
  startBlankProject,
  clickTab,
  addTileAndCount,
  uploadScreenshotToSelected,
  exportArtboards,
  shot,
  dismissTipsDialog,
  waitForProjectFonts,
};
