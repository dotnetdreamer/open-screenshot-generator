// Shared helpers for the "design" captures (chapter one of the feature reel: make your
// screenshots). Same rig as ../rig/cap-lib.cjs (frozen build on :9311, headless Edge, the e2e
// Tauri IPC mock), with two differences:
//   - every request that is not the frozen build or Google Fonts is answered locally or
//     dropped, so nothing reaches a real backend (pb.openscrgen.app, Apple, Google APIs, AI);
//   - the browser's temp profile is removed when it closes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CAP = path.join(__dirname, '..', 'rig');
const capLib = require(path.join(CAP, 'cap-lib.cjs'));
const tauriInit = require(path.join(CAP, 'tauri-init.cjs'));
const juniper = require(path.join(CAP, 'juniper.cjs'));
const { lib, MCP_RUNNING, CLAUDE_READY, CODEX_READY } = capLib;

const REPO = require('path').resolve(__dirname, '..', '..', '..', '..');
const PROMO = REPO + '/promo';
const OUT = PROMO + '/public/features2/design';
const SCREENS = PROMO + '/public/juniper';
const BASE = process.env.EDITOR_URL || 'http://127.0.0.1:9311';
const sleep = lib.sleep;

const blockedHosts = new Set();

async function launchEdge({ width, height, dpr }) {
  const puppeteer = require(REPO + '/.claude/skills/app-screenshots/scripts/node_modules/puppeteer-core');
  const args = [
    '--no-sandbox',
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`,
    // CalculateNativeWinOcclusion: Windows reports a headless window as occluded once the
    // session's screen is covered or idle, the page turns hidden and stops painting frames,
    // and every capture that waits on a frame stalls.
    '--disable-features=LazyImageLoading,AutomaticLazyImageLoading,LazyFrameLoading,CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--hide-scrollbars',
    ...(process.env.EDGE_ARGS ? process.env.EDGE_ARGS.split(' ').filter(Boolean) : []),
  ];
  const defaultViewport = { width, height, deviceScaleFactor: dpr };
  const port = 9700 + Math.floor(Math.random() * 250);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-design-edge-'));
  const child = spawn(lib.EDGE, ['--headless', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args, 'about:blank'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let browser = null;
  for (let i = 0; i < 80 && !browser; i++) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport, protocolTimeout: 900000 });
    } catch {
      await sleep(250);
    }
  }
  if (!browser) {
    try { process.kill(child.pid); } catch {}
    throw new Error(`Edge did not expose a debug port on ${port}`);
  }
  const page = await browser.newPage();
  // Keep the page focused and in front, so it never reads as a background tab.
  try {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    page.__cdp = cdp;
  } catch {}
  await page.bringToFront().catch(() => {});
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (process.env.CONSOLE && ['error', 'warning'].includes(m.type())) console.log(`[console.${m.type()}]`, m.text().slice(0, 300));
  });
  const close = async () => {
    try { await browser.close(); } catch {}
    try { process.kill(child.pid); } catch {}
    for (let i = 0; i < 20; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(300);
      }
    }
  };
  return { browser, page, close };
}

/** Answer or drop everything that is not the frozen build or Google Fonts. */
async function interceptNetwork(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      return req.continue();
    }
    if (host === new URL(BASE).host) return req.continue();
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return req.continue();
    if (/(^|\.)openscrgen\.app$/.test(host)) {
      blockedHosts.add(host + ' (answered locally)');
      return req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ items: [], page: 1, perPage: 30, totalItems: 0 }),
      });
    }
    blockedHosts.add(host);
    return req.abort();
  });
}

/**
 * The editor in desktop mode (Tauri IPC mock), dark, 1440x900 at 2x unless told otherwise,
 * with window.__osg installed. Returns { browser, page, close }.
 */
async function openEditor({
  width = 1440,
  height = 900,
  dpr = 2,
  osName = 'macos',
  theme = 'dark',
  responses = {},
  storage = {},
  tauri = true,
  headless = true,
} = {}) {
  const { browser, page, close } = await launchEdge({ width, height, dpr });
  await interceptNetwork(page);
  if (tauri) {
    const cfg = {
      ...tauriInit.DEFAULT,
      os: osName,
      responses: {
        abs_mcp_status: MCP_RUNNING,
        abs_get_settings: { show_assistant_window: false, mcp_server_enabled: true, devtools_open: false },
        abs_claude_detect: CLAUDE_READY,
        abs_codex_detect: CODEX_READY,
        ...responses,
      },
    };
    await page.evaluateOnNewDocument(tauriInit(cfg));
  }
  if (headless) await page.evaluateOnNewDocument(() => { window.__OSG_HEADLESS = true; });
  await page.evaluateOnNewDocument(
    (theme, storage) => {
      try {
        localStorage.setItem('open-screenshot-generator.theme', theme);
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
      } catch {}
    },
    theme,
    storage
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await lib.dismissTipsDialog(page);
  return { browser, page, close };
}

/** Bring the page back to the front if it has gone hidden; returns whether it was hidden. */
async function ensureVisible(page) {
  const hidden = await page.evaluate(() => document.hidden).catch(() => false);
  if (hidden) {
    await page.bringToFront().catch(() => {});
    await sleep(300);
  }
  return hidden;
}

async function settle(page, ms = 2500) {
  return capLib.settle(page, ms);
}

/** Wait for the start dialog's catalogue (numeric counts on the tabs). */
async function waitStartDialog(page) {
  await page.waitForFunction(
    `[...document.querySelectorAll('[role="tab"]')].some((b) => /App Screenshots\\s*\\d+/.test(b.textContent || ''))`,
    { timeout: 120000, polling: 500 }
  );
}

/** A rect in CSS px of the viewport, from a function run in the page that returns the element. */
async function rect(page, finder, ...args) {
  const r = await page.evaluate(
    (src, args) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('return (' + src + ')')();
      const el = fn(...args);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    },
    finder.toString(),
    args
  );
  if (!r) throw new Error('rect: element not found for ' + finder.toString().slice(0, 160));
  const round = (v) => Math.round(v * 10) / 10;
  return { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
}

/** Like rect, but null when the element is not there. */
async function rectOpt(page, finder, ...args) {
  try {
    return await rect(page, finder, ...args);
  } catch {
    return null;
  }
}

/** Clip a rect to the viewport, so a ring never asks for pixels the frame does not have. */
function clipRect(r, width = 1440, height = 900) {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const x2 = Math.min(width, r.x + r.w);
  const y2 = Math.min(height, r.y + r.h);
  return { x, y, w: Math.max(0, Math.round((x2 - x) * 10) / 10), h: Math.max(0, Math.round((y2 - y) * 10) / 10) };
}

/** Merge one file's rects into OUT/<sub>/rects.json (or OUT/rects.json). */
function writeRects(dir, file, rects) {
  const target = path.join(dir, 'rects.json');
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {}
  all[file] = rects;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(all, null, 2) + '\n');
  console.log('rects', path.basename(dir) + '/' + file, Object.keys(rects).join(', '));
}

/** Texts of open toasts. */
async function openToasts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('li[role="status"][data-state="open"], [toast-close]')]
      .map((n) => (n.closest('li') || n).textContent.trim())
      .filter(Boolean)
  );
}

/** Wait for toasts to go away by themselves, then close any that are left. */
async function clearToasts(page, waitMs = 7000) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if ((await openToasts(page)).length === 0) return;
    await sleep(400);
  }
  await page.evaluate(() => document.querySelectorAll('[toast-close]').forEach((b) => b.click()));
  await sleep(600);
}

/** Everything that should never be in a frame: spinners, skeletons, toasts, the Tips dialog. */
async function frameProblems(page) {
  const toasts = await openToasts(page);
  const other = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const out = [];
    const describe = (el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    const spinners = [...document.querySelectorAll('.animate-spin')].filter(visible);
    if (spinners.length) out.push(`${spinners.length} spinner(s): ${spinners.map(describe).join('; ')}`);
    // A pulsing status dot (the MCP pill) is a live indicator, not a skeleton.
    const skeletons = [...document.querySelectorAll('.animate-pulse')].filter(visible).filter((el) => el.getBoundingClientRect().width > 12);
    if (skeletons.length) out.push(`${skeletons.length} skeleton(s): ${skeletons.map(describe).join('; ')}`);
    const tips = [...document.querySelectorAll('[role="dialog"]')].filter((d) => /tips/i.test(d.getAttribute('aria-labelledby') || '') || /^Tips/.test((d.textContent || '').trim()));
    if (tips.length) out.push('tips dialog');
    return out;
  });
  return [...toasts.map((t) => 'toast: ' + t.slice(0, 80)), ...other];
}

async function shot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const problems = await frameProblems(page);
  if (problems.length) console.log('  !! frame problems before', path.basename(file), problems.join(' | '));
  await page.screenshot({ path: file });
  console.log('shot', path.relative(OUT, file));
}

/** Move the mouse somewhere neutral so no hover state or tooltip lingers. */
async function parkMouse(page, x = 1439, y = 450) {
  await page.mouse.move(x, y);
  await sleep(300);
}

/** Click the centre of a rect with the real mouse (pointer events). */
async function clickRect(page, r) {
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

/** Set a React-controlled input's value the way typing would. */
async function setInputValue(page, selector, value) {
  await page.evaluate(
    (selector, value) => {
      const input = document.querySelector(selector);
      if (!input) throw new Error('no input ' + selector);
      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    selector,
    value
  );
}

/** The canvas's current zoom, from the zoom pill. */
async function zoomLevel(page) {
  return page.evaluate(() => {
    const b = document.querySelector('button[title="Reset zoom to 100%"]');
    return b ? parseInt(b.textContent, 10) / 100 : null;
  });
}

/**
 * Zoom the canvas to `target` with Ctrl+wheel events (the canvas answers them exactly:
 * factor = exp(-deltaY * 0.0022), at most 120px a step), anchored at a canvas point.
 */
async function zoomTo(page, target, anchor) {
  for (let i = 0; i < 12; i++) {
    const exact = await page.evaluate(() => {
      // Read the zoom off the board layer itself: the pill rounds to a whole percent.
      const board = document.querySelector('[data-artboard-dom-id]');
      if (!board) return null;
      const w = Number(board.getAttribute('data-original-width'));
      return board.getBoundingClientRect().width / (w * 0.3);
    });
    if (!exact) throw new Error('zoomTo: no board');
    const ratio = target / exact;
    if (Math.abs(Math.log(ratio)) < 0.002) return exact;
    const deltaY = Math.max(-120, Math.min(120, -Math.log(ratio) / 0.0022));
    await page.evaluate(
      (deltaY, ax, ay) => {
        const el = document.elementFromPoint(ax, ay);
        el.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0, ctrlKey: true, clientX: ax, clientY: ay, bubbles: true, cancelable: true }));
      },
      deltaY,
      anchor.x,
      anchor.y
    );
    await sleep(250);
  }
  return null;
}

/** The canvas scroll viewport (the element that scrolls the board layer). */
function canvasScrollerFinder() {
  const board = document.querySelector('[data-artboard-dom-id]');
  // The Radix ScrollArea viewport round the board layer: overflow-y scroll, and wider
  // than it shows (overflow-x is hidden but still scrolls programmatically).
  const viewport = board && board.closest('[data-radix-scroll-area-viewport]');
  if (viewport) return viewport;
  let el = board && board.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    const scrolls = /auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY);
    if (scrolls && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) return el;
    el = el.parentElement;
  }
  return null;
}

/** The canvas viewport's rect and the boards' rects, in CSS px. */
async function canvasLayout(page) {
  return page.evaluate((scrollerSrc) => {
    const scroller = new Function('return (' + scrollerSrc + ')')()();
    const s = scroller.getBoundingClientRect();
    const boards = [...document.querySelectorAll('[data-artboard-dom-id]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.getAttribute('data-artboard-dom-id'), x: r.x, y: r.y, w: r.width, h: r.height, ow: Number(b.getAttribute('data-original-width')), oh: Number(b.getAttribute('data-original-height')) };
    });
    return { scroller: { x: s.x, y: s.y, w: s.width, h: s.height, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop }, boards };
  }, canvasScrollerFinder.toString());
}

/**
 * Zoom and scroll the canvas so boards [first, last] fill the viewport's width, with
 * `leftGaps` board gaps (15 board-display px each, zoomed) before the first and `rightGaps`
 * after the last. With rightGaps under 1 the next board starts just past the right edge,
 * so no sliver of it shows. Boards sit at the top of the canvas (the board layer cannot
 * scroll them down), at scrollTop `scrollTop`.
 */
async function frameBoards(page, { first = 0, last = 0, leftGaps = 1, rightGaps = 0.5, zoom = null, scrollTop = 0 } = {}) {
  let layout = await canvasLayout(page);
  const b0 = layout.boards[first];
  const b1 = layout.boards[last];
  const currentZoom = b0.w / (b0.ow * 0.3);
  const runAt1 = (b1.x + b1.w - b0.x) / currentZoom;
  if (!zoom) zoom = layout.scroller.w / (runAt1 + 15 * (leftGaps + rightGaps));
  const anchor = { x: layout.scroller.x + layout.scroller.w / 2, y: layout.scroller.y + layout.scroller.h / 2 };
  await zoomTo(page, zoom, anchor);
  await sleep(400);
  layout = await canvasLayout(page);
  const a = layout.boards[first];
  const z = a.w / (a.ow * 0.3);
  const wantLeft = layout.scroller.x + leftGaps * 15 * z;
  await page.evaluate(
    (scrollerSrc, dx, top) => {
      const scroller = new Function('return (' + scrollerSrc + ')')()();
      scroller.scrollLeft += dx;
      scroller.scrollTop = top;
    },
    canvasScrollerFinder.toString(),
    a.x - wantLeft,
    scrollTop
  );
  await sleep(500);
  return canvasLayout(page);
}

/** The editor framing shared by the result and editor shots: boards 1 to 3 across the canvas. */
async function frameThree(page) {
  return frameBoards(page, { first: 0, last: 2, leftGaps: 1, rightGaps: 0.5 });
}

function dataUrl(file) {
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
}

async function waitFor(page, fnSrc, timeout = 60000) {
  await page.waitForFunction(fnSrc, { timeout, polling: 400 });
}

/** Reject when `promise` takes longer than `ms`, naming `label`. */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
    }),
  ]);
}

function reportBlocked() {
  if (blockedHosts.size) console.log('network kept local:', [...blockedHosts].join(', '));
}

module.exports = {
  CAP,
  REPO,
  PROMO,
  OUT,
  SCREENS,
  BASE,
  lib,
  sleep,
  juniper,
  mcp: juniper.mcp,
  buildJuniper: juniper.buildJuniper,
  openTemplate: capLib.openTemplate,
  openEditor,
  settle,
  ensureVisible,
  waitStartDialog,
  rect,
  rectOpt,
  clipRect,
  writeRects,
  openToasts,
  clearToasts,
  frameProblems,
  shot,
  parkMouse,
  clickRect,
  setInputValue,
  zoomLevel,
  zoomTo,
  canvasScrollerFinder,
  canvasLayout,
  frameBoards,
  frameThree,
  dataUrl,
  waitFor,
  withTimeout,
  reportBlocked,
  blockedHosts,
};
