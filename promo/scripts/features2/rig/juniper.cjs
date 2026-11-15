// Juniper's store screenshot set, built in the real editor from the Droply Habits template:
// Juniper's own screens in the phones (a localized screen per language), its palette on the
// boards, and its headlines in English, German, Japanese and Arabic. Every step goes through
// window.__osg, the same design tools MCP clients and the CLI use.
//
//   const { buildJuniper } = require('./juniper.cjs');
//   const info = await buildJuniper(page);   // page opened with openEditor({ headless: true })
//
// Run directly to render the set: node juniper.cjs  ->  ../out/juniper-set/<lang>/b<n>.png
const fs = require('fs');
const path = require('path');

const PROMO = require('path').join(require('path').resolve(__dirname, '..', '..', '..', '..'), 'promo');
const SCREENS = path.join(PROMO, 'public', 'juniper');
const LANGS = { en: null, de: 'de-DE', ja: 'ja', ar: 'ar-SA' };

/** Board -> which Juniper screen each phone shows, its colour and its headline per language. */
const BOARDS = [
  {
    id: 'tpl_dr_ab1',
    bg: '#2D6A4F',
    phones: { tpl_dr_ab1_device: 'today' },
    head: {
      en: 'BUILD HABITS\nTHAT STICK',
      de: 'GEWOHNHEITEN,\nDIE BLEIBEN',
      ja: '続く習慣を\nつくろう',
      ar: 'عادات\nتدوم معك',
    },
  },
  {
    id: 'tpl_dr_ab2',
    bg: '#3C8460',
    phones: { tpl_dr_ab2_device: 'detail' },
    head: {
      en: 'WATCH YOUR\nSTREAK\nGROW',
      de: 'SIEH DEINE\nSERIE\nWACHSEN',
      ja: '連続記録が\nどんどん\n伸びる',
      ar: 'شاهد\nسلسلتك\nتكبر',
    },
  },
  {
    id: 'tpl_dr_ab3',
    bg: '#2D6A4F',
    phones: { tpl_dr_ab3_device: 'add' },
    head: {
      en: 'REMINDERS\nRIGHT WHEN\nYOU NEED THEM',
      de: 'ERINNERUNGEN\nGENAU ZUR\nRICHTIGEN ZEIT',
      ja: 'ちょうどいい\nタイミングで\nお知らせ',
      ar: 'تذكير\nفي الوقت\nالمناسب',
    },
  },
  {
    id: 'tpl_dr_ab4',
    bg: '#24573F',
    phones: { tpl_dr_ab4_device: 'stats' },
    head: {
      en: 'YOUR WEEK\nAT A GLANCE',
      de: 'DEINE WOCHE\nAUF EINEN BLICK',
      ja: '1週間を\nひと目で',
      ar: 'أسبوعك\nفي لمحة',
    },
  },
  {
    id: 'tpl_dr_ab5',
    bg: '#4C55C9',
    phones: { tpl_dr_ab5_device_top: 'trophies', tpl_dr_ab5_device_bottom: 'today' },
    head: {
      en: 'A TROPHY FOR\nEVERY RUN',
      de: 'TROPHÄEN\nFÜR JEDE SERIE',
      ja: '続けるたびに\nトロフィー',
      ar: 'جائزة\nلكل سلسلة',
    },
  },
];

async function mcp(page, name, args = {}) {
  const res = await page.evaluate(
    (name, args) => window.__osg.mcp({ jsonrpc: '2.0', id: Date.now() + Math.random(), method: 'tools/call', params: { name, arguments: args } }),
    name,
    args
  );
  if (res && (res.error || res.result?.isError)) throw new Error(`${name} failed: ${JSON.stringify(res).slice(0, 400)}`);
  const text = res?.result?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function dataUrl(file) {
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
}

/** Upload each screen once per language; returns { lang: { screen: 'asset:..' } }. */
async function uploadScreens(page) {
  const refs = {};
  for (const lang of Object.keys(LANGS)) {
    refs[lang] = {};
    for (const screen of ['today', 'detail', 'stats', 'add', 'trophies']) {
      const asset = await mcp(page, 'upload_asset', { source: dataUrl(path.join(SCREENS, lang, `${screen}.png`)), name: `juniper-${lang}-${screen}` });
      refs[lang][screen] = asset.ref || asset.reference || (asset.id ? `asset:${asset.id}` : asset);
    }
  }
  return refs;
}

/**
 * Turn the open Droply Habits project into Juniper. Leaves the canvas on the base language.
 * `languages: false` skips German, Japanese and Arabic.
 */
async function buildJuniper(page, { languages = true, name = 'Juniper' } = {}) {
  await page.waitForFunction('!!window.__osg && window.__osg.ready', { timeout: 60000, polling: 300 });
  const refs = await uploadScreens(page);
  for (const board of BOARDS) {
    await mcp(page, 'set_background', { artboardId: board.id, backgroundColor: board.bg });
    for (const [elementId, screen] of Object.entries(board.phones)) {
      await mcp(page, 'update_element', { artboardId: board.id, elementId, screenshotSrc: refs.en[screen] });
    }
    await mcp(page, 'update_element', { artboardId: board.id, elementId: board.id + '_headline', content: board.head.en, color: '#F6F2E9' });
  }
  if (languages) {
    const locales = Object.values(LANGS).filter(Boolean);
    await mcp(page, 'add_locales', { locales, autoFont: true, autoFit: true });
    const writes = [];
    for (const [lang, locale] of Object.entries(LANGS)) {
      if (!locale) continue;
      for (const board of BOARDS) writes.push({ elementId: board.id + '_headline', artboardId: board.id, locale, text: board.head[lang] });
    }
    await mcp(page, 'set_localized_texts', { writes });
    for (const [lang, locale] of Object.entries(LANGS)) {
      if (!locale) continue;
      for (const board of BOARDS) {
        for (const [elementId, screen] of Object.entries(board.phones)) {
          await mcp(page, 'set_locale_override', { elementId, artboardId: board.id, locale, screenshotSrc: refs[lang][screen] });
        }
      }
    }
  }
  // The project name shows in the tab and the bottom bar of every later capture: rename it
  // the way a person does (double-click the name, type, Enter), with the native value setter
  // because keyboard typing drops characters at high DPR.
  await renameProject(page, name);
  return { boards: BOARDS.map((b) => b.id), langs: LANGS, refs };
}

/** Rename the open project through ProjectNameField (double-click, set the input, Enter). */
async function renameProject(page, name) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('[title="Double-click to rename project"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!box) throw new Error('No project name field to rename');
  await page.mouse.click(box.x, box.y, { clickCount: 2 });
  await page.waitForSelector('input[placeholder="Project name..."]', { timeout: 10000 });
  await page.evaluate((name) => {
    const input = document.querySelector('input[placeholder="Project name..."]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, name);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('[title="Double-click to rename project"]')].some((n) => (n.textContent || '').trim() === name),
    { timeout: 10000, polling: 200 },
    name
  );
}

module.exports = { buildJuniper, renameProject, mcp, BOARDS, LANGS };

if (require.main === module) {
  const { openEditor, openTemplate, settle } = require('./cap-lib.cjs');
  const OUT = path.join(PROMO, 'public', 'features2', 'juniper-set');
  (async () => {
    const { browser, page } = await openEditor({ theme: 'dark', dpr: 1, headless: true, tauri: false });
    try {
      await openTemplate(page, 'Droply Habits');
      await buildJuniper(page);
      await settle(page, 2000);
      for (const [lang, locale] of Object.entries(LANGS)) {
        fs.mkdirSync(path.join(OUT, lang), { recursive: true });
        for (const [i, board] of BOARDS.entries()) {
          const imgs = await page.evaluate((id, loc) => window.__osg.capture([id], null, loc), board.id, locale);
          fs.writeFileSync(path.join(OUT, lang, `b${i + 1}.png`), Buffer.from(imgs[0].base64, 'base64'));
          console.log('captured', lang, `b${i + 1}`, imgs[0].width + 'x' + imgs[0].height);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
