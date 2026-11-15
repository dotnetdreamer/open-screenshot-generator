// Capture helpers for the Open Screenshot Generator store set.
//
// Drives the frozen static build (default http://127.0.0.1:9311) in headless Edge at the Mac
// app's real window size, 1440x900, rendered at 2x. The e2e Tauri IPC mock is installed before any
// app script, so the page renders the desktop UI (MCP pill, Claude Code and Codex, the Agent dock)
// exactly as the desktop shell would, with detection and status answered from `responses`.
const fs = require('fs');
const path = require('path');
const lib = require(require('path').resolve(__dirname, '..', '..', '..', '..') + '/.claude/skills/app-screenshots/scripts/lib.js');
const tauriInit = require('./tauri-init.cjs');

const BASE = process.env.EDITOR_URL || 'http://127.0.0.1:9311';
const OUT_ROOT = require('path').join(__dirname, '..', 'out');
const NONCE = 'e2e-bridge-nonce';

const CLAUDE_READY = {
  found: true,
  path: '/Users/maya/.local/bin/claude',
  version: '2.1.202 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};
const CODEX_READY = {
  found: true,
  path: '/Users/maya/.local/bin/codex',
  version: 'codex-cli 0.162.0',
  loggedIn: true,
  authMethod: 'chatgpt',
  planType: 'plus',
  models: [
    { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  ],
};
const MCP_RUNNING = { running: true, port: 8722, url: 'http://127.0.0.1:8722/mcp' };

// Same spawn-and-connect launcher as the skill's lib.js, plus EDGE_ARGS for render flags (a 3x
// capture of a heavy board can leave whole layers unpainted on the GPU path).
async function launchEdge({ width, height, dpr }) {
  const { spawn } = require('child_process');
  const os = require('os');
  const puppeteer = require(require('path').resolve(__dirname, '..', '..', '..', '..') + '/.claude/skills/app-screenshots/scripts/node_modules/puppeteer-core');
  const args = [
    '--no-sandbox',
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`,
    // CalculateNativeWinOcclusion: Windows marks a headless window as occluded after a while,
    // document.hidden turns true, frames stop, and a long run of __osg.capture calls waits forever.
    '--disable-features=LazyImageLoading,AutomaticLazyImageLoading,LazyFrameLoading,CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(process.env.EDGE_ARGS ? process.env.EDGE_ARGS.split(' ').filter(Boolean) : []),
  ];
  const defaultViewport = { width, height, deviceScaleFactor: dpr };
  const port = 9200 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-store-edge-'));
  const child = spawn(lib.EDGE, ['--headless', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args, 'about:blank'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let browser = null;
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport, protocolTimeout: 600000 });
    } catch {
      await lib.sleep(250);
    }
  }
  if (!browser) throw new Error(`Edge did not expose a debug port on ${port}`);
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  // Keep the page focused and visible for the same reason as the occlusion flag above.
  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await page.bringToFront().catch(() => {});
  return { browser, page };
}

async function openEditor({
  width = 1440,
  height = 900,
  dpr = 2,
  os = 'macos',
  theme = 'light',
  responses = {},
  storage = {},
  tauri = true,
  headless = false,
} = {}) {
  const { browser, page } = await launchEdge({ width, height, dpr });
  await page.setRequestInterception(true);
  page.on('request', (req) =>
    /google-analytics|googletagmanager|gtag\/js|doubleclick|googlesyndication|adsbygoogle|\/collect\?/.test(req.url())
      ? req.abort()
      : req.continue()
  );
  if (tauri) {
    const cfg = {
      ...tauriInit.DEFAULT,
      os,
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
  // The npm CLI's bridge (window.__osg): the same design tools as MCP, used here to stage content.
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
  return { browser, page };
}

/** Open a template card from the start dialog (scoped to the active tab panel). */
async function openTemplate(page, cardTitle, tab = 'App Screenshots') {
  await page.waitForFunction(
    `[...document.querySelectorAll('[role="tab"]')].some((b) => (b.textContent || '').includes(${JSON.stringify(tab)}))`,
    { timeout: 90000, polling: 500 }
  );
  await lib.clickTab(page, tab);
  const CARDS = '[role="dialog"] [role="tabpanel"][data-state="active"] .cursor-pointer';
  await page.waitForFunction(
    `[...document.querySelectorAll('${CARDS}')].some((c) => (c.textContent || '').includes(${JSON.stringify(cardTitle)}))`,
    { timeout: 90000, polling: 500 }
  );
  await page.evaluate(
    (cardTitle, sel) => [...document.querySelectorAll(sel)].find((c) => (c.textContent || '').includes(cardTitle)).click(),
    cardTitle,
    CARDS
  );
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 30000, polling: 500 });
  await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 3", { timeout: 60000, polling: 500 });
  await settle(page);
}

async function settle(page, ms = 2500) {
  await lib.waitForProjectFonts(page);
  // An off-screen lazy image never decodes, so each wait is capped.
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])))
  );
  await lib.sleep(ms);
}

/** Play Claude Code stream-json lines into the page as though Rust emitted them. */
async function playClaude(page, spawnId, messages) {
  for (const m of messages) {
    await page.evaluate(
      (spawnId, line, nonce) => window.__E2E_TAURI__.emitFromBackend('abs-claude-event', { spawnId, kind: 'stdout', line, nonce }),
      spawnId,
      JSON.stringify(m),
      NONCE
    );
    await lib.sleep(60);
  }
}

async function shot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  console.log('shot', file);
}

module.exports = { lib, BASE, NONCE, CLAUDE_READY, CODEX_READY, MCP_RUNNING, openEditor, openTemplate, settle, playClaude, shot, sleep: lib.sleep };
