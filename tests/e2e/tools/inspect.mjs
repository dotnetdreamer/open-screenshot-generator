// Selector scout. Opens the running app and prints what is actually in the DOM,
// so a spec can be written against real accessible names instead of guesses.
//
// The editor has almost no data-testid attributes of its own, so locators lean
// on roles and visible text, and those are only knowable from a live page.
//
//   node tests/e2e/tools/inspect.mjs                     # the start screen
//   node tests/e2e/tools/inspect.mjs --url '/?panel=1'   # a detached panel window
//   node tests/e2e/tools/inspect.mjs --desktop           # with the Tauri runtime injected
//   node tests/e2e/tools/inspect.mjs --click 'Blank canvas' --shot start.png
//
// Requires the dev server (npm run dev) on :9002, or E2E_BASE_URL.

import { chromium, webkit } from '@playwright/test';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const base = process.env.E2E_BASE_URL ?? 'http://localhost:9002';
const desktop = !!flag('desktop', false);
const target = flag('url', '/');
// Comma separated, clicked in order: --click 'Close,Start with a blank canvas'
const clickLabels = String(flag('click', '') || '').split(',').map((v) => v.trim()).filter(Boolean);
const shot = flag('shot', null);

const browser = await (desktop ? webkit : chromium).launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

if (desktop) {
  // Reuse the suite's own runtime so the scout sees what the tests see.
  const source = readFileSync(new URL('../fixtures/tauri-runtime.ts', import.meta.url), 'utf8');
  const start = source.indexOf('return `(() => {');
  if (start === -1) throw new Error('tauri-runtime.ts no longer exposes its script the way inspect.mjs reads it');
  console.log('[inspect] injecting the Tauri runtime is only supported through the test fixtures;');
  console.log('[inspect] run `npx playwright test --project desktop --debug` for a desktop DOM.');
}

const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`  [console.error] ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));

await page.goto(base + target, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2500);

for (const label of clickLabels) {
  console.log(`\n[inspect] clicking "${label}"`);
  const asButton = page.getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
  if (await asButton.count()) await asButton.click();
  else await page.getByText(label, { exact: false }).first().click();
  await page.waitForTimeout(2500);
}

const report = await page.evaluate(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const name = (el) =>
    (el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      el.getAttribute('placeholder') ||
      '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70);

  const collect = (selector) =>
    Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map((el) => ({
        name: name(el),
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        classes: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 90),
      }))
      .filter((e) => e.name);

  return {
    title: document.title,
    htmlClass: document.documentElement.className,
    buttons: collect('button, [role="button"]'),
    tabs: collect('[role="tab"]'),
    dialogs: collect('[role="dialog"] h2, [role="dialog"] [role="heading"]'),
    inputs: Array.from(document.querySelectorAll('input, textarea, select'))
      .map((el) => ({
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        name: name(el),
        hidden: !visible(el),
        accept: el.getAttribute('accept') || '',
        multiple: el.hasAttribute('multiple'),
      })),
    headings: collect('h1, h2, h3, [role="heading"]'),
    canvas: (() => {
      const boards = Array.from(document.querySelectorAll('.artboard, [data-artboard-surface]'));
      return {
        count: boards.length,
        boards: boards.slice(0, 4).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            classes: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
            attrs: Object.fromEntries(
              Array.from(el.attributes)
                .filter((a) => a.name.startsWith('data-') || a.name === 'id')
                .map((a) => [a.name, a.value.slice(0, 60)])
            ),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            bg: getComputedStyle(el).backgroundColor,
            childElements: el.children.length,
          };
        }),
        // The board layer is placed by a CSS transform; a test converting
        // artboard coordinates to page coordinates needs it.
        transforms: Array.from(document.querySelectorAll('[style*="transform"]'))
          .slice(0, 8)
          .map((el) => ({
            classes: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
            transform: getComputedStyle(el).transform,
          }))
          .filter((t) => t.transform && t.transform !== 'none'),
      };
    })(),
    dataAttrs: Array.from(
      new Set(
        Array.from(document.querySelectorAll('*'))
          .flatMap((el) => Array.from(el.attributes).map((a) => a.name))
          .filter((n) => n.startsWith('data-') && !n.startsWith('data-radix') && !n.startsWith('data-state'))
      )
    ).sort(),
  };
});

const section = (label, rows) => {
  console.log(`\n### ${label} (${rows.length})`);
  for (const row of rows) console.log('  ' + JSON.stringify(row));
};

console.log(`\n=== ${base + target} ===`);
console.log(`title: ${report.title}`);
console.log(`<html class="${report.htmlClass}">`);
console.log(`artboard nodes: ${report.canvas.count}`);
for (const b of report.canvas.boards) console.log('  board ' + JSON.stringify(b));
for (const t of report.canvas.transforms) console.log('  transform ' + JSON.stringify(t));
section('buttons', report.buttons);
section('tabs', report.tabs);
section('headings', report.headings);
section('dialog titles', report.dialogs);
section('inputs', report.inputs);
console.log(`\n### data-* attributes in the document\n  ${report.dataAttrs.join('\n  ')}`);

if (shot && typeof shot === 'string') {
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`\nscreenshot: ${shot}`);
}

await browser.close();
