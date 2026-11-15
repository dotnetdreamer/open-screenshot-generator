// Shared rig for the "flows" captures: Capture, the AI agent, the store upload, the Website
// view and Export, all with the Juniper project open.
//
// Same frozen build and e2e Tauri IPC mock as ../../cap-lib.cjs, plus:
//   - a wrapper around the mock's invoke, so the simulator answers with Juniper's real screens
//     (abs_capture_screenshot follows the last abs_capture_launch: its language and its
//     juniper://<screen> link), and Claude Code's one-shot prompts can be answered per job;
//   - every request that is not the frozen build or Google Fonts is dropped, so nothing reaches
//     a real backend (Apple and GitHub answer through the mock's http rules instead);
//   - helpers for rects, toasts and setting React inputs.
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
const OUT = PROMO + '/public/features2/flows';
const SCREENS = PROMO + '/public/juniper';
const BASE = process.env.EDITOR_URL || 'http://127.0.0.1:9311';
const sleep = lib.sleep;

const dropped = new Set();

async function launchEdge({ width, height, dpr }) {
  const puppeteer = require(REPO + '/.claude/skills/app-screenshots/scripts/node_modules/puppeteer-core');
  const args = [
    '--no-sandbox',
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`,
    '--disable-features=LazyImageLoading,AutomaticLazyImageLoading,LazyFrameLoading',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--hide-scrollbars',
    ...(process.env.EDGE_ARGS ? process.env.EDGE_ARGS.split(' ').filter(Boolean) : []),
  ];
  const defaultViewport = { width, height, deviceScaleFactor: dpr };
  const port = 9950 + Math.floor(Math.random() * 40);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-flows-edge-'));
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

/**
 * Runs in the page after the IPC mock: Juniper's simulator, and per-job answers for Claude Code's
 * one-shot prompts. `window.__flows` holds the state a script steers.
 */
function flowsWrapper() {
  const state = window.__E2E_TAURI__;
  const internals = window.__TAURI_INTERNALS__;
  if (!state || !internals) return;
  const original = internals.invoke;
  const SCREENS = ['today', 'detail', 'stats', 'add', 'trophies'];
  const flows = (window.__flows = {
    lang: 'en',
    screen: 'today',
    hold: false,
    launches: [],
    shots: 0,
    cache: new Map(),
    prompts: [],
    /** [{ when: 'regex source tested on system+user', reply: string | ((args) => string) }] */
    promptRules: [],
  });
  const langOf = (code) => {
    const value = String(code || '').toLowerCase();
    if (value.startsWith('de')) return 'de';
    if (value.startsWith('ja')) return 'ja';
    if (value.startsWith('ar')) return 'ar';
    return 'en';
  };
  const screenOf = (link) => {
    const match = /^juniper:\/\/([a-z]+)/.exec(String(link || ''));
    return match && SCREENS.includes(match[1]) ? match[1] : 'today';
  };
  async function png(lang, screen) {
    const key = lang + '/' + screen;
    if (!flows.cache.has(key)) {
      const b64 = await window.__flowsPng(lang, screen);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      flows.cache.set(key, bytes.buffer);
    }
    return flows.cache.get(key).slice(0);
  }
  internals.invoke = async function (cmd, args, options) {
    args = args || {};
    if (cmd === 'abs_capture_launch') {
      state.calls.push({ cmd, args: JSON.parse(JSON.stringify(args)), options: null });
      flows.lang = langOf(args.language);
      flows.screen = screenOf(args.link);
      flows.launches.push({ language: args.language, link: args.link });
      return null;
    }
    if (cmd === 'abs_capture_screenshot') {
      state.calls.push({ cmd, args: JSON.parse(JSON.stringify(args)), options: null });
      if (!args.preview && flows.hold) {
        await new Promise((resolve) => state.commandsHeld.push({ cmd, id: args.id, release: resolve, stop: resolve }));
      }
      if (!args.preview) flows.shots += 1;
      return png(flows.lang, flows.screen);
    }
    if (cmd === 'abs_claude_prompt' && flows.promptRules.length) {
      const text = String(args.system || '') + '\n' + String(args.prompt || args.user || '');
      flows.prompts.push({ system: String(args.system || '').slice(0, 400), prompt: String(args.prompt || '').slice(0, 2000) });
      const rule = flows.promptRules.find((candidate) => new RegExp(candidate.when).test(text));
      if (rule) {
        state.calls.push({ cmd, args: { system: String(args.system || '').slice(0, 200) }, options: null });
        if (rule.delayMs) await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
        return typeof rule.reply === 'string' ? rule.reply : String(rule.reply);
      }
    }
    return original(cmd, args, options);
  };
}

/**
 * Open the frozen build with the IPC mock, Juniper's simulator and the network guard.
 * `responses`, `http`, `held` go into the mock's config; `storage` into localStorage.
 */
async function openFlows({
  width = 1440,
  height = 900,
  dpr = 2,
  os: platform = 'macos',
  theme = 'dark',
  responses = {},
  http = [],
  held = [],
  storage = {},
  headless = true,
} = {}) {
  const { browser, page, close } = await launchEdge({ width, height, dpr });
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
    if (url.startsWith(BASE) || host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return req.continue();
    if (!dropped.has(host)) {
      dropped.add(host);
      console.log('[dropped]', url.slice(0, 160));
    }
    return req.abort();
  });
  await page.exposeFunction('__flowsPng', (lang, screen) => {
    const file = path.join(SCREENS, String(lang), `${String(screen)}.png`);
    return fs.readFileSync(file).toString('base64');
  });
  const cfg = {
    ...tauriInit.DEFAULT,
    os: platform,
    responses: {
      abs_mcp_status: MCP_RUNNING,
      abs_get_settings: { show_assistant_window: false, mcp_server_enabled: true, devtools_open: false },
      abs_claude_detect: CLAUDE_READY,
      abs_codex_detect: CODEX_READY,
      ...responses,
    },
    http,
    held,
  };
  await page.evaluateOnNewDocument(tauriInit(cfg));
  await page.evaluateOnNewDocument(flowsWrapper);
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

/**
 * Juniper's design on the open Droply Habits project: its palette, its headlines in English,
 * German, Japanese and Arabic, and its name. The phones keep the template's example screens,
 * for Capture to fill.
 */
async function buildJuniperDesign(page, { name = 'Juniper' } = {}) {
  const { mcp, BOARDS, LANGS } = juniper;
  await page.waitForFunction('!!window.__osg && window.__osg.ready', { timeout: 60000, polling: 300 });
  for (const board of BOARDS) {
    await mcp(page, 'set_background', { artboardId: board.id, backgroundColor: board.bg });
    await mcp(page, 'update_element', { artboardId: board.id, elementId: board.id + '_headline', content: board.head.en, color: '#F6F2E9' });
  }
  const locales = Object.values(LANGS).filter(Boolean);
  await mcp(page, 'add_locales', { locales, autoFont: true, autoFit: true });
  const writes = [];
  for (const [lang, locale] of Object.entries(LANGS)) {
    if (!locale) continue;
    for (const board of BOARDS) writes.push({ elementId: board.id + '_headline', artboardId: board.id, locale, text: board.head[lang] });
  }
  await mcp(page, 'set_localized_texts', { writes });
  await setProjectName(page, name);
}

/** Rename the open project through its name field, as the user does (juniper.cjs's helper). */
async function setProjectName(page, name) {
  await juniper.renameProject(page, name);
}

/** Click an activity bar view by its accessible name. */
async function openView(page, label) {
  const ok = await page.evaluate((label) => {
    const nav = document.querySelector('nav[aria-label="Views"]');
    const button = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.title === label);
    if (!button) return false;
    button.click();
    return true;
  }, label);
  if (!ok) throw new Error('view button not found: ' + label);
}

/** Real mouse click at the centre of the first element the function returns. */
async function clickWhere(page, fn, ...args) {
  const box = await page.evaluate(fn, ...args);
  if (!box) throw new Error('nothing to click for ' + fn.toString().slice(0, 120));
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  return box;
}

/** Set a React input or textarea's value the way typing would. */
async function setValue(page, selector, value) {
  await page.evaluate(
    (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('no element ' + selector);
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    selector,
    value
  );
}

/** Close every toast and wait until none is on screen. */
async function clearToasts(page, { timeout = 15000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const left = await page.evaluate(() => {
      const toasts = [...document.querySelectorAll('li[role="status"], [data-radix-toast-viewport] li, ol > li[data-state]')].filter(
        (li) => li.getBoundingClientRect().height > 0
      );
      for (const li of toasts) li.querySelector('[toast-close]')?.click();
      return toasts.length;
    });
    if (!left) return;
    await sleep(400);
  }
}

/** A rect in CSS px, from an element the function finds. */
function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
}

/** Measure named rects in the page: `finders` maps a name to a function source returning an element. */
/**
 * Measure named rects in the page: `finders` maps a name to a function source returning an element,
 * or a rect of its own ({ x, y, w, h }) for an area no single element covers. Every rect is kept to
 * the window; with `clip` (a function source returning the scroll box the elements sit in), a rect
 * inside that box is cut to its visible part, and left out when less than half of it shows.
 */
async function measure(page, finders, { clip = null } = {}) {
  const out = {};
  const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const box = clip
    ? await page.evaluate(`(() => { const el = (${clip})(); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, el: true }; })()`)
    : null;
  const round = (v) => Math.round(v * 10) / 10;
  for (const [name, fn] of Object.entries(finders)) {
    const found = await page.evaluate(`(() => {
      const el = (${fn})();
      if (!el) return null;
      if (!(el instanceof Element)) return { x: el.x, y: el.y, w: el.w, h: el.h, inside: false };
      const r = el.getBoundingClientRect();
      const scroller = ${clip ? `(${clip})()` : 'null'};
      return { x: r.x, y: r.y, w: r.width, h: r.height, inside: !!scroller && scroller !== el && scroller.contains(el) };
    })()`);
    if (!found) {
      console.log('  !! rect not found:', name);
      continue;
    }
    let { x, y, w, h } = found;
    const limit = found.inside && box ? box : { x: 0, y: 0, w: view.w, h: view.h };
    const x1 = Math.max(x, limit.x);
    const y1 = Math.max(y, limit.y);
    const x2 = Math.min(x + w, limit.x + limit.w);
    const y2 = Math.min(y + h, limit.y + limit.h);
    if (x2 <= x1 || y2 <= y1 || (y2 - y1) * (x2 - x1) < 0.5 * w * h) {
      console.log('  (mostly out of view, left out:', name + ')');
      continue;
    }
    if (x1 !== x || y1 !== y || x2 !== x + w || y2 !== y + h) console.log('  (cut to what shows:', name + ')');
    out[name] = { x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) };
  }
  return out;
}

const ATOMS =
  'h1,h2,h3,h4,h5,p,li,button,input,textarea,select,label,img,svg,table,[role="radio"],[role="checkbox"],[role="switch"],[role="tab"],[role="alert"],[role="progressbar"],.rounded-lg,.rounded-md,.rounded-xl,.border';

/**
 * Scroll a scroll box (found by `boxFinder`, a function source) to a position in [from, to] where
 * neither its top nor its bottom edge cuts through a block (a line of text, a control, a card), so
 * nothing in it shows halfway. `prefer` picks the lowest or the highest such position, `near` the
 * one closest to a scroll position. Answers
 * { scrollTop, clean }; when no position is clean, the box is left where it was.
 */
async function cleanScroll(page, boxFinder, { from = 0, to = 1e9, prefer = 'low', near = null, atoms = ATOMS, slack = 0.5 } = {}) {
  return page.evaluate(
    `(() => {
      const box = (${boxFinder})();
      if (!box) return null;
      const max = Math.max(0, box.scrollHeight - box.clientHeight);
      const lo = Math.max(0, Math.min(${from}, max));
      const hi = Math.max(lo, Math.min(${to}, max));
      const was = box.scrollTop;
      const top0 = box.getBoundingClientRect().top + box.clientTop;
      const spans = [...box.querySelectorAll(${JSON.stringify(atoms)})]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 1 && r.height < box.clientHeight * 0.6)
        .map((r) => [r.top - top0 + was, r.bottom - top0 + was]);
      const cuts = (y) => spans.some(([a, b]) => y > a + ${slack} && y < b - ${slack});
      const order = [];
      for (let s = lo; s <= hi; s += 1) order.push(s);
      if (${JSON.stringify(prefer)} === 'high') order.reverse();
      const near = ${near === null ? 'null' : 'Number(' + JSON.stringify(near) + ')'};
      if (near !== null) order.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
      for (const s of order) {
        if (!cuts(s) && !cuts(s + box.clientHeight)) {
          box.scrollTop = s;
          return { scrollTop: box.scrollTop, clean: true, max };
        }
      }
      return { scrollTop: was, clean: false, max };
    })()`
  );
}

/** Merge one file's rects into rects.json. */
function saveRects(file, rects) {
  const json = path.join(OUT, 'rects.json');
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(json, 'utf8'));
  } catch {}
  all[file] = rects;
  const sorted = Object.fromEntries(Object.keys(all).sort().map((key) => [key, all[key]]));
  fs.writeFileSync(json, JSON.stringify(sorted, null, 2) + '\n');
}

async function shot(page, file) {
  fs.mkdirSync(OUT, { recursive: true });
  const target = path.join(OUT, file);
  await page.screenshot({ path: target });
  console.log('shot', target);
  return target;
}

async function settle(page, ms = 1500) {
  await lib.waitForProjectFonts(page, { timeout: 20000 });
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])))
  );
  await sleep(ms);
}

module.exports = {
  REPO,
  PROMO,
  OUT,
  SCREENS,
  BASE,
  lib,
  juniper,
  capLib,
  sleep,
  openFlows,
  buildJuniperDesign,
  setProjectName,
  openView,
  clickWhere,
  setValue,
  clearToasts,
  measure,
  cleanScroll,
  rectOf,
  saveRects,
  shot,
  settle,
  openTemplate: capLib.openTemplate,
  playClaude: capLib.playClaude,
  CLAUDE_READY,
  CODEX_READY,
};
