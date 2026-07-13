/**
 * Reusable helpers for driving Artboard Studio in headless Edge.
 * See ../SKILL.md for the rules these encode (clip screenshots, Radix tabs,
 * rAF-starved waits, project-creation settling, download capture).
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP_URL = 'http://localhost:9002';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ width = 1720, height = 1400, downloadDir } = {}) {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', `--window-size=${width},${height}`, '--force-device-scale-factor=1'],
    defaultViewport: { width, height },
  });
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

/** Click the Nth button with an exact title attribute (palette tiles, toolbar). */
async function clickByTitle(page, title, index = 0) {
  const ok = await page.evaluate((title, index) => {
    const els = [...document.querySelectorAll(`button[title="${title}"]`)];
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
  await page.waitForFunction(
    "[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Start Blank')",
    { timeout: 90000, polling: 500 }
  );
  await clickByText(page, 'Start Blank');
  // Project creation lands asynchronously; interacting earlier races a re-render.
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 30000, polling: 500 });
  await sleep(1500);
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
  await clickByTitle(page, 'Export Artboards as Images');
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

module.exports = {
  APP_URL,
  EDGE,
  sleep,
  launch,
  clickByText,
  clickByTextContains,
  clickByTitle,
  openAgentScreen,
  startBlankProject,
  clickTab,
  addTileAndCount,
  uploadScreenshotToSelected,
  exportArtboards,
  shot,
};
