// "more" agent rig: the shared capture helpers plus a fake backend.
//
// Same launch as cap-lib's openEditor, with three differences that matter here:
//  1. ONE request handler that answers pb.openscrgen.app (auth, Discover feed,
//     cloud projects), mcp.openscrgen.app (collab ticket) and the TURN endpoint
//     locally, lets the static build and Google Fonts through, and refuses every
//     other host.
//  2. --host-resolver-rules maps every other hostname to nothing, so a request
//     that somehow escaped interception (a CORS preflight, a WebSocket) cannot
//     reach a real server either.
//  3. A WebSocket stand-in for the collab signalling socket, so a live session
//     reads as connected with no server at all.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CAP = path.join(__dirname, '..', 'rig');
const capLib = require(path.join(CAP, 'cap-lib.cjs'));
const tauriInit = require(path.join(CAP, 'tauri-init.cjs'));
const { lib, BASE, CLAUDE_READY, CODEX_READY, MCP_RUNNING } = capLib;
const puppeteer = require(require('path').resolve(__dirname, '..', '..', '..', '..') + '/.claude/skills/app-screenshots/scripts/node_modules/puppeteer-core');

const REPO = require('path').resolve(__dirname, '..', '..', '..', '..');
const OUT = path.join(REPO, 'promo', 'public', 'features2', 'more');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWER = { id: 'promo-viewer', handle: 'samrivera', name: 'Sam Rivera', followers: 128, isViewer: true };

function signedInStorage(viewer = VIEWER) {
  return {
    'open-screenshot-generator.account': JSON.stringify({
      provider: 'google',
      accessToken: 'promo-local-token',
      account: { id: viewer.id, name: viewer.name, email: 'sam@example.com' },
    }),
    'open-screenshot-generator.discover.session': JSON.stringify({
      token: 'promo-local-token',
      provider: 'google',
      accountId: viewer.id,
      viewer,
    }),
  };
}

// ---------------------------------------------------------------- fake backend

const CAPABILITIES = { enabled: true, writes: true, signin: true, google: true, github: true, githubPat: false, cloudProjects: true };

function makeBackend({ posts = [], viewer = VIEWER, viewers = {}, log = () => {} } = {}) {
  // One cloud per account, picked by the bearer token, so a second person in
  // the same browser never saves over the first person's record.
  const accounts = new Map();
  const account = (token) => {
    if (!accounts.has(token)) {
      const n = accounts.size + 1;
      accounts.set(token, {
        n,
        stamp: Date.parse('2026-11-15T09:12:44.512Z'),
        record: null,
        visibility: 'private',
        shareSlug: '',
        slug: n === 1 ? 'q7m2x9c4v8b1n5k3h6t0wa' : `p${n}m2x9c4v8b1n5k3h6t0wb`.slice(0, 22),
        recordId: `rjuniper000000${n}`,
      });
    }
    return accounts.get(token);
  };
  let state = account('Bearer promo-local-token');
  const iso = () => new Date(state.stamp).toISOString().replace('T', ' ');
  const bump = () => {
    state.stamp += 1000;
    return iso();
  };
  const record = (fields = {}) => {
    state.record = {
      id: state.recordId,
      projectId: fields.projectId || (state.record && state.record.projectId) || 'project',
      name: fields.name || (state.record && state.record.name) || 'Juniper',
      boards: fields.boards || (state.record && state.record.boards) || 5,
      docBytes: 48211,
      assetBytes: 0,
      formatVersion: 1,
      docEncoding: 'gzip',
      visibility: state.visibility,
      created: '2026-11-15 09:12:44.512Z',
      updated: iso(),
      ...(state.shareSlug ? { shareSlug: state.shareSlug } : {}),
      assets: [],
    };
    return state.record;
  };

  function answer(req) {
    const url = new URL(req.url());
    const method = req.method();
    const p = url.pathname;
    const auth = (req.headers() || {}).authorization || '';
    state = account(auth || 'Bearer promo-local-token');
    const json = (body, status = 200) =>
      req.respond({
        status,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
        body: JSON.stringify(body),
      });
    if (method === 'OPTIONS') {
      return req.respond({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
        body: '',
      });
    }
    // Images the feed hands back as paths: served from the repo's own public/.
    if (p.startsWith('/data/') || p.startsWith('/promo-art/')) {
      const file = p.startsWith('/promo-art/')
        ? path.join(__dirname, 'art', p.slice('/promo-art/'.length))
        : path.join(REPO, 'public', p);
      if (fs.existsSync(file)) {
        return req.respond({
          status: 200,
          contentType: 'image/png',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: fs.readFileSync(file),
        });
      }
      log('missing art ' + p);
      return req.respond({ status: 404, body: '' });
    }
    if (p === '/api/openscreengen/auth/methods') return json(CAPABILITIES);
    if (/^\/api\/openscreengen\/auth\/(google|github)$/.test(p)) {
      const body = req.postData() || '';
      const other = Object.entries(viewers).find(([token]) => body.includes(token.replace(/-token$/, '')));
      return other ? json({ token: other[0], record: other[1] }) : json({ token: 'promo-local-token', record: viewer });
    }
    if (p === '/api/openscreengen/discover/feed') {
      const limit = Number(url.searchParams.get('limit') || 24);
      const scope = url.searchParams.get('scope') || 'all';
      const list = scope === 'all' ? posts : [];
      return json({ posts: list.slice(0, limit), nextCursor: null, total: list.length });
    }
    if (p === '/api/openscreengen/discover/tags') {
      const counts = {};
      for (const post of posts) for (const tag of post.tags || []) counts[tag] = (counts[tag] || 0) + 1;
      return json({ tags: Object.entries(counts).map(([tag, count]) => ({ tag, count })) });
    }
    let m;
    if ((m = p.match(/^\/api\/openscreengen\/discover\/posts\/([^/]+)$/)) && method === 'GET') {
      const post = posts.find((x) => x.id === decodeURIComponent(m[1]));
      return post ? json({ post }) : json({ error: 'Not found' }, 404);
    }
    if (/\/discover\/posts\/[^/]+\/comments$/.test(p)) return json({ comments: [] });
    if (/\/discover\//.test(p)) return json({ ok: true });

    // Cloud projects.
    if (p === '/api/openscreengen/projects' && method === 'GET') {
      return json({ projects: state.record ? [state.record] : [], limit: 20 });
    }
    if (p === '/api/openscreengen/projects' && method === 'POST') {
      const body = req.postData() || '';
      const field = (name) => {
        const hit = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`));
        return hit ? hit[1] : undefined;
      };
      bump();
      const project = record({ projectId: field('project_id'), name: field('name'), boards: Number(field('boards')) || undefined });
      return json({ project, missing: [] });
    }
    if ((m = p.match(/^\/api\/openscreengen\/projects\/([^/]+)\/share$/))) {
      state.visibility = 'link';
      state.shareSlug = state.slug;
      bump();
      record();
      return json({ visibility: 'link', shareSlug: state.shareSlug, updated: state.record.updated });
    }
    if ((m = p.match(/^\/api\/openscreengen\/projects\/([^/]+)\/assets$/))) {
      bump();
      record();
      return json({ updated: state.record.updated });
    }
    if ((m = p.match(/^\/api\/openscreengen\/projects\/([^/]+)$/))) {
      if (method === 'DELETE') {
        state.record = null;
        return json({ ok: true });
      }
      return state.record ? json({ project: state.record }) : json({ error: 'Not found' }, 404);
    }
    if ((m = p.match(/^\/api\/openscreengen\/shared\/([^/]+)$/))) {
      const owner = [...accounts.values()].find((a) => a.shareSlug === decodeURIComponent(m[1]) && a.record);
      return owner ? json({ project: owner.record }) : json({ error: 'Not found' }, 404);
    }
    log(`backend: unanswered ${method} ${p}`);
    return json({ error: 'Not found' }, 404);
  }

  return { answer, accounts };
}

// ---------------------------------------------------------------- page scripts

/** The signalling socket, answered in the page. Opens, answers pings, relays nothing. */
const FAKE_SOCKET = `(() => {
  const Real = window.WebSocket;
  const isOurs = (url) => /openscrgen\\.app|ludowala\\.app/.test(String(url));
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.binaryType = 'blob';
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      window.__promoSockets = (window.__promoSockets || []).concat(this);
      setTimeout(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this._fire('open', new Event('open'));
      }, 60);
      this._keep = setInterval(() => this._recv({ type: 'pong' }), 8000);
    }
    _fire(type, event) {
      const handler = this['on' + type];
      try { if (handler) handler.call(this, event); } catch (e) { console.error(e); }
      this.dispatchEvent(event);
    }
    _recv(message) {
      if (this.readyState !== 1) return;
      this._fire('message', new MessageEvent('message', { data: JSON.stringify(message) }));
    }
    send(data) {
      try {
        const message = JSON.parse(data);
        if (message && message.type === 'ping') setTimeout(() => this._recv({ type: 'pong' }), 15);
      } catch {}
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      clearInterval(this._keep);
      this._fire('close', new CloseEvent('close', { code: 1000 }));
    }
  }
  FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
  function Socket(url, protocols) {
    if (isOurs(url)) return new FakeSocket(url);
    return protocols === undefined ? new Real(url) : new Real(url, protocols);
  }
  Socket.prototype = Real.prototype;
  Socket.CONNECTING = 0; Socket.OPEN = 1; Socket.CLOSING = 2; Socket.CLOSED = 3;
  window.WebSocket = Socket;
  // Copying the invite link is answered here: a headless page has no clipboard.
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText = async () => {};
      navigator.clipboard.write = async () => {};
    }
  } catch {}
})();`;

// ---------------------------------------------------------------- launching

async function launchEdge({ width = 1440, height = 900, dpr = 2 } = {}) {
  const resolverRules =
    'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE fonts.googleapis.com, EXCLUDE fonts.gstatic.com';
  const args = [
    '--no-sandbox',
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`,
    '--disable-features=LazyImageLoading,AutomaticLazyImageLoading,LazyFrameLoading',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    `--host-resolver-rules=${resolverRules}`,
    ...(process.env.EDGE_ARGS ? process.env.EDGE_ARGS.split(' ').filter(Boolean) : []),
  ];
  const port = 9700 + Math.floor(Math.random() * 250);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-more-edge-'));
  const child = spawn(lib.EDGE, ['--headless', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args, 'about:blank'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let browser = null;
  for (let i = 0; i < 80 && !browser; i++) {
    try {
      browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: { width, height, deviceScaleFactor: dpr },
        protocolTimeout: 600000,
      });
    } catch {
      await sleep(250);
    }
  }
  if (!browser) throw new Error(`Edge did not expose a debug port on ${port}`);
  browser.__profile = profile;
  browser.__child = child;
  return browser;
}

/** Wire a page: interception, Tauri mock, storage, socket stand-in. */
async function preparePage(page, opts) {
  const {
    os: osName = 'macos',
    theme = 'dark',
    responses = {},
    storage = {},
    tauri = true,
    headless = true,
    backend,
    log = (line) => console.log(line),
    pageStorageOverride = null,
  } = opts;
  page.on('pageerror', (e) => log('[pageerror] ' + String(e).slice(0, 300)));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    let url;
    try {
      url = new URL(req.url());
    } catch {
      return req.continue();
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return req.continue();
    const host = url.hostname;
    if (host === '127.0.0.1' || host === 'localhost') return req.continue();
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return req.continue();
    if (host === 'pb.openscrgen.app') return backend.answer(req);
    if (host === 'mcp.openscrgen.app' && url.pathname === '/collab/ticket') {
      return req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
        body: JSON.stringify({ ticket: 'promo-ticket' }),
      });
    }
    if (host === 'play.ludowala.app') {
      return req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
        body: JSON.stringify({ iceServers: [{ urls: 'stun:127.0.0.1:3478' }], ttl: 3600 }),
      });
    }
    if (!/google-analytics|googletagmanager|doubleclick|googlesyndication/.test(host)) {
      log(`[blocked] ${req.method()} ${url.origin}${url.pathname}`);
    }
    return req.abort('blockedbyclient');
  });
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
  await page.evaluateOnNewDocument(FAKE_SOCKET);
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
  if (pageStorageOverride) {
    // A second person in the same browser profile: their own sign-in, read only
    // by this page, never written back over the first person's.
    await page.evaluateOnNewDocument((over) => {
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      const del = Storage.prototype.removeItem;
      Storage.prototype.getItem = function (key) {
        if (this === window.localStorage && Object.prototype.hasOwnProperty.call(over, key)) return over[key];
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (this === window.localStorage && Object.prototype.hasOwnProperty.call(over, key)) {
          over[key] = String(value);
          return;
        }
        return set.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        if (this === window.localStorage && Object.prototype.hasOwnProperty.call(over, key)) return;
        return del.call(this, key);
      };
    }, pageStorageOverride);
  }
}

async function openRig(opts = {}) {
  const { width = 1440, height = 900, dpr = 2, url = BASE } = opts;
  const log = opts.log || ((line) => console.log(line));
  const backend = opts.backend || makeBackend({ posts: opts.posts || [], log });
  const browser = await launchEdge({ width, height, dpr });
  const page = await browser.newPage();
  await preparePage(page, { ...opts, backend, log });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await lib.dismissTipsDialog(page);
  return { browser, page, backend };
}

async function closeRig(browser) {
  try {
    await browser.close();
  } catch {}
  try {
    if (browser.__child && browser.__child.pid) process.kill(browser.__child.pid);
  } catch {}
  try {
    if (browser.__profile) fs.rmSync(browser.__profile, { recursive: true, force: true });
  } catch {}
}

// ---------------------------------------------------------------- page helpers

/** Center of the first element a function finds, or null. */
async function centerOf(page, pick, ...args) {
  return page.evaluate(
    (src, args) => {
      const fn = new Function('return ' + src)();
      const el = fn(...args);
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    pick.toString(),
    args
  );
}

async function clickPick(page, pick, ...args) {
  const at = await centerOf(page, pick, ...args);
  if (!at) throw new Error('nothing to click for ' + pick.toString().slice(0, 140));
  await page.mouse.click(at.x, at.y);
  return at;
}

/** The viewport rect of the first element a function finds. */
async function rectOf(page, pick, ...args) {
  return page.evaluate(
    (src, args) => {
      const fn = new Function('return ' + src)();
      const el = fn(...args);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const round = (v) => Math.round(v * 10) / 10;
      return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
    },
    pick.toString(),
    args
  );
}

const byText = (selector, text, exact = false) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => ${
    exact ? `(n.textContent || '').trim() === ${JSON.stringify(text)}` : `(n.textContent || '').includes(${JSON.stringify(text)})`
  })`;

/** Close every toast on screen. */
async function dismissToasts(page) {
  for (let i = 0; i < 6; i++) {
    const n = await page.evaluate(() => {
      const toasts = [...document.querySelectorAll('li[data-state="open"], [data-radix-toast-viewport] > li, ol > li[role="status"]')].filter(
        (li) => li.closest('[data-radix-toast-viewport], ol[tabindex="-1"]')
      );
      for (const t of toasts) {
        const close = t.querySelector('button[toast-close], button[aria-label="Close"], button');
        if (close) close.click();
      }
      return toasts.length;
    });
    if (!n) return;
    await sleep(500);
  }
}

async function toastTexts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-radix-toast-viewport] li, ol[tabindex="-1"] li')].map((li) => (li.innerText || '').replace(/\s+/g, ' ').trim())
  );
}

/** Anything that would ruin a still: spinners, skeletons, error text. */
async function hazards(page) {
  return page.evaluate(() => {
    const out = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const where = (el) => {
      const r = el.getBoundingClientRect();
      const label = el.getAttribute('aria-label') || el.closest('[aria-label]')?.getAttribute('aria-label') || '';
      return `@${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ${label.slice(0, 40)}`;
    };
    for (const el of document.querySelectorAll('.animate-spin')) if (visible(el)) out.push('spinner ' + where(el));
    for (const el of document.querySelectorAll('.animate-pulse')) if (visible(el)) out.push('pulse ' + where(el));
    for (const el of document.querySelectorAll('[data-radix-toast-viewport] li, ol[tabindex="-1"] li')) if (visible(el)) out.push('toast: ' + (el.innerText || '').slice(0, 80));
    return out;
  });
}

function saveRects(file, rects) {
  const target = path.join(OUT, 'rects.json');
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {}
  all[file] = rects;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(all, null, 2));
}

async function shot(page, rel) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  console.log('shot', rel);
  return file;
}

/** Capture one board through the bridge and write the PNG. */
async function captureBoard(page, boardId, rel, locale = null) {
  const imgs = await page.evaluate((id, loc) => window.__osg.capture([id], null, loc), boardId, locale);
  if (!imgs || !imgs[0]) throw new Error('capture returned nothing for ' + boardId);
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(imgs[0].base64, 'base64'));
  console.log('captured', rel, imgs[0].width + 'x' + imgs[0].height);
  return { file, width: imgs[0].width, height: imgs[0].height };
}

module.exports = {
  REPO,
  OUT,
  CAP,
  VIEWER,
  capLib,
  lib,
  sleep,
  signedInStorage,
  makeBackend,
  launchEdge,
  preparePage,
  openRig,
  closeRig,
  centerOf,
  clickPick,
  rectOf,
  byText,
  dismissToasts,
  toastTexts,
  hazards,
  saveRects,
  shot,
  captureBoard,
};
