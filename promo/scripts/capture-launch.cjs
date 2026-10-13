const fs = require('node:fs');
const path = require('node:path');
const {
  launch, sleep, clickTab, dismissTipsDialog, clickMenuItem,
} = require('../../.claude/skills/app-screenshots/scripts/lib.js');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'promo/public/launch');

function desktopExampleInit(projectId, stage = 'final') {
  const esbuild = require('esbuild');
  const file = path.join(ROOT, 'tests/e2e/fixtures/tauri-runtime.ts');
  const code = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const compiled = { exports: {} };
  new Function('exports', 'module', code)(compiled.exports, compiled);
  const exports = compiled.exports;
  const detection = { found: true, version: '2.1.202 (Claude Code)', loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' };
  const config = { ...exports.DEFAULT_TAURI_CONFIG, responses: { abs_claude_detect: detection } };
  const at = Date.now();
  const items = [
    { kind: 'notice', id: 'example-label', tone: 'info', text: 'Example workflow', at },
    { kind: 'user', id: 'example-request', text: 'Make five store screenshots for Kassa. Use my three app screens, bold headlines and a cobalt accent', attachments: 3, at },
    { kind: 'text', id: 'example-plan', text: 'I will use the Kassa template and keep every headline, device and background editable', at },
    ...[
      ['get_template', 'Kassa Money', { templateId: 'template_kassa_money' }],
      ['create_project_from_template', 'Kassa Money', { templateId: 'template_kassa_money' }],
      ['get_artboard', 'Money minus the noise', { artboardId: 'kassa-board-1' }],
      ['update_element', 'Money minus the noise', { elementId: 'kassa-b1-headline-18', content: 'Money minus the noise' }],
    ].map(([name, detail, input], i) => ({ kind: 'tool', id: `example-tool-${i}`, toolUseId: `example-tool-${i}`, name, detail, input, status: 'done', result: 'Example completed step', at, endedAt: at + 1 })),
    { kind: 'text', id: 'example-result', text: 'Five artboards are ready to refine. Select any layer to adjust the copy, layout or device frame', at },
  ];
  const chat = { id: 'launch-example', projectId, projectName: 'Kassa Money', createdAt: at, folders: [], readFolders: false, ranFolders: null };
  const stagedItems = stage === 'prompt' ? items.slice(0, 2) : stage === 'working' ? items.slice(0, 5) : items;
  const persisted = { v: 1, sessionId: null, resolvedModel: null, spawnId: null, items: stagedItems, chat };
  return exports.tauriInitScript(config) + `\nlocalStorage.setItem('osg-claude-agent-panel', '1');localStorage.setItem('abs-right-dock-tab', 'agent');localStorage.setItem('abs-right-dock-width', '420');localStorage.setItem('osg-claude-agent-v1', ${JSON.stringify(JSON.stringify(persisted))});`;
}

async function clickControl(page, selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  const r = await el.boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await sleep(250);
}

async function zoomOut(page, times = 2) {
  for (let i = 0; i < times; i++) await clickControl(page, 'button[title="Zoom Out"]');
  await sleep(500);
}

async function fitArtboards(page) {
  for (let i = 0; i < 5; i++) {
    const fits = await page.evaluate(() => {
      const agent = document.querySelector('[data-agent-panel]');
      const limit = agent ? agent.getBoundingClientRect().left - 8 : innerWidth - 328;
      return [...document.querySelectorAll('[data-artboard-dom-id]')].every(e => e.getBoundingClientRect().right <= limit);
    });
    if (fits) return;
    await zoomOut(page, 1);
  }
  throw new Error('The artboard set does not fit in the canvas');
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = e => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      agent: rect(document.querySelector('[data-agent-panel]')),
      artboards: [...document.querySelectorAll('[data-artboard-dom-id]')].map(e => ({ id: e.dataset.artboardDomId, ...rect(e) })),
      dialog: rect(document.querySelector('[role="dialog"]')),
    };
  });
}

async function captureAgentStage(browser, editorUrl, projectId, stage) {
  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(desktopExampleInit(projectId, stage));
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('[data-agent-panel]', { timeout: 60000 });
    await page.addStyleTag({ content: 'nextjs-portal { display: none }' });
    await zoomOut(page, 3);
    await fitArtboards(page);
    await page.evaluate(() => document.fonts.ready);
    await sleep(3500);
    const name = stage === 'final' ? 'editor-agent' : `editor-agent-${stage}`;
    await capture(page, name);
    return await geometry(page);
  } finally {
    await page.close();
  }
}

async function waitForText(page, selector, text) {
  await page.waitForFunction(
    `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e => (e.textContent || '').includes(${JSON.stringify(text)}))`,
    { polling: 500, timeout: 90000 }
  );
}

async function clickText(page, selector, text) {
  await page.evaluate((selector, text) => {
    const el = [...document.querySelectorAll(selector)].find(e => (e.textContent || '').includes(text));
    if (!el) throw new Error(`Missing ${text}`);
    el.click();
  }, selector, text);
}

async function capture(page, name) {
  await page.mouse.move(1908, 1068);
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`Captured ${name}.png`);
}

async function openKassa(page) {
  await page.goto('http://localhost:9002', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await dismissTipsDialog(page);
  await waitForText(page, '[role="tab"]', 'App Screenshots');
  await clickTab(page, 'App Screenshots');
  const cards = '[role="dialog"] [role="tabpanel"][data-state="active"] .cursor-pointer';
  await waitForText(page, cards, 'Kassa Money');
  await clickText(page, cards, 'Kassa Money');
  await page.waitForFunction("location.search.includes('projectId')", { polling: 500, timeout: 30000 });
  await page.waitForFunction("document.querySelectorAll('[data-artboard-dom-id]').length >= 5", { polling: 500, timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(3500);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await launch({ width: 1920, height: 1080, dpr: 1 });
  try {
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('open-screenshot-generator.theme', 'dark');
    });
    await openKassa(page);
    await page.addStyleTag({ content: 'nextjs-portal { display: none }' });
    await zoomOut(page);
    await sleep(5000);
    await capture(page, 'editor');
    const editorUrl = page.url();
    const projectId = new URL(editorUrl).searchParams.get('projectId');
    const metadata = { editor: await geometry(page) };

    metadata['editor-agent'] = await captureAgentStage(browser, editorUrl, projectId, 'final');
    fs.copyFileSync(path.join(OUT, 'editor-agent.png'), path.join(ROOT, 'website/assets/img/hero-editor.png'));
    console.log('Priority Agent dock capture is ready');
    metadata['editor-agent-prompt'] = await captureAgentStage(browser, editorUrl, projectId, 'prompt');
    metadata['editor-agent-working'] = await captureAgentStage(browser, editorUrl, projectId, 'working');

    await clickControl(page, '[data-element-id="kassa-b1-headline-18"]');
    await capture(page, 'editor-detail');
    metadata['editor-detail'] = await geometry(page);
    await clickControl(page, 'button[title="Add a language, or translate this project"]');
    await waitForText(page, '[role="menuitem"]', 'Add language');
    await clickText(page, '[role="menuitem"]', 'Add language');
    await page.waitForSelector('[role="dialog"] input[aria-label="Search languages"]', { timeout: 30000 });
    for (const code of ['de-DE', 'fr-FR', 'ja', 'es-ES']) {
      const box = await page.$(`#locale-${code}`);
      if (box) await box.click();
    }
    await page.evaluate(() => document.querySelector('#locale-de-DE')?.scrollIntoView({ block: 'center' }));
    await capture(page, 'localization');
    metadata.localization = await geometry(page);
    await page.keyboard.press('Escape');
    await sleep(300);
    await clickMenuItem(page, 'Export', 'Artboards as images');
    await page.waitForSelector('[role="dialog"] #export-as-is', { timeout: 30000 });
    await capture(page, 'export');
    metadata.export = await geometry(page);
    await page.keyboard.press('Escape');
    await sleep(300);

    await clickControl(page, 'button[title="Select Template"]');
    await waitForText(page, 'button', 'Open the agent');
    await clickText(page, 'button', 'Open the agent');
    await page.waitForSelector('#agent-instruction', { timeout: 30000 });
    const input = await page.$('[role="dialog"] input[type="file"][accept="image/*"][multiple]');
    await input.uploadFile(...[1, 2, 3].map(i => path.join(ROOT, `public/data/projects/kassa-money-screen-${i}.png`)));
    await page.type('#agent-instruction', 'Make five store screenshots for Kassa. Use my three app screens, bold headlines and a cobalt accent');
    await clickTab(page, 'Use my API key');
    await sleep(2500);
    await capture(page, 'agent-intake');
    metadata['agent-intake'] = await geometry(page);
    metadata.fixture = { file: 'editor-agent.png', kind: 'Actual Agent dock component with a seeded Example workflow transcript and the repository Tauri E2E IPC runtime', providerCalls: 0, project: 'Unmodified Kassa Money template' };
    fs.writeFileSync(path.join(OUT, 'capture-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
