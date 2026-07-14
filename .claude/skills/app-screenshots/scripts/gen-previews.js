/**
 * Generates real card-thumbnail previews for the App Screenshots templates —
 * a wide 3:1 phone-carousel strip per template (previewAspect '3 / 1',
 * previewFit 'contain') — the app-screenshot counterpart to the fg-* previews.
 * Replaces the placehold.co / empty previewImage with /data/projects/previews/<slug>.png.
 *
 * Pass A: open each template, export its artboards (clean, chrome-free PNGs).
 * Pass B: compose the strip on the template's own background, write the preview,
 *         and rewrite previewImage in the JSON.
 *
 * Usage (dev server on :9002 must be running):
 *   node gen-previews.js                 # all 41 app-screenshot templates
 *   node gen-previews.js tunio-music ...  # subset (for testing)
 *   node gen-previews.js --compose-only   # skip export (reuse cached src PNGs)
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { launch, exportArtboards, sleep, clickTab, APP_URL } = require('./lib');
const { renderOnPage, EDGE, CW, CH } = require('./compose-preview');

const REPO = path.resolve(__dirname, '../../../..');
const PROJ = path.join(REPO, 'public/data/projects');
const PREVIEWS = path.join(PROJ, 'previews');
const SRC = path.resolve(process.env.TEMP || require('os').tmpdir(), 'artboard-previews-src');
const MAX_SCREENS = 6;

// The App Screenshots category, in gallery order.
const SLUGS = [
  'breathora-breathing', 'vowly-wedding',
  'connectly-chat', 'budgetly-finance', 'listly-tasks', 'inboxly-mail', 'darzi-studio',
  'beauty-glam', 'castique-podcast', 'inquira', 'zyluxe-beauty', 'nexmind',
  'endless-communities', 'kicksy-sneakers', 'endless-podcasts', 'answerly-ai', 'lumina-search',
  'streamio-movies', 'readly-books', 'luxe-glow', 'cryptix', 'feasto',
  'storybuzz-kids', 'trackio-fitness', 'streamio-binge', 'roomora-home', 'playverse-games',
  'voyago-travel', 'finexa-crypto', 'flixio-kids', 'listenly-audio', 'tripora-travel',
  'tunio-music', 'coinly-crypto', 'stockio-invest', 'threadly-social', 'beatforge-studio',
  'podly-podcasts', 'cinevault-stream', 'sereno-mind', 'droply-habits', 'zeeb-fashion',
  'lingua-learn', 'verda-eco', 'zenfit-yoga', 'blogio-articles',
  // Apple Watch category (behind the "Apple Watch" tab).
  'watch-smart-appscreens', 'watch-editors-choice', 'watch-dark-aso',
  'watch-ultra-showcase', 'watch-lavender', 'watch-sunset',
  // Mac category (behind the "Mac" tab).
  'mac-flowdesk', 'mac-pulseform',
  // App Preview Videos category (behind the "App Preview Videos" tab).
  'pv-midnight-launch', 'pv-sunrise-fitness', 'pv-minimal-light',
  'pv-ocean-social', 'pv-royal-shop', 'pv-forest-wellness',
];

// Slugs whose card lives behind a non-default Radix tab; the value is the tab
// label to click before searching for the card.
const SLUG_TAB = {
  'watch-smart-appscreens': 'Apple Watch', 'watch-editors-choice': 'Apple Watch',
  'watch-dark-aso': 'Apple Watch', 'watch-ultra-showcase': 'Apple Watch',
  'watch-lavender': 'Apple Watch', 'watch-sunset': 'Apple Watch',
  'mac-flowdesk': 'Mac', 'mac-pulseform': 'Mac',
  'pv-midnight-launch': 'App Preview Videos', 'pv-sunrise-fitness': 'App Preview Videos',
  'pv-minimal-light': 'App Preview Videos', 'pv-ocean-social': 'App Preview Videos',
  'pv-royal-shop': 'App Preview Videos', 'pv-forest-wellness': 'App Preview Videos',
};

function meta(slug) {
  const j = JSON.parse(fs.readFileSync(path.join(PROJ, `${slug}.json`), 'utf8'));
  const ab = j.projectData[0];
  let bg = ab.backgroundColor || '#111';
  if (ab.backgroundType === 'gradient' && ab.backgroundGradient) {
    const g = ab.backgroundGradient;
    bg = `linear-gradient(${g.angle || 180}deg, ${g.color1}, ${g.color2})`;
  }
  const ratio = ab.size ? ab.size.width / ab.size.height : undefined;
  return { name: j.name, boards: j.projectData.length, bg, ratio };
}

async function openTemplate(page, cardTitle, tab) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (tab) {
    await page.waitForFunction(
      `[...document.querySelectorAll('[role="tab"]')].some((b) => (b.textContent || '').includes(${JSON.stringify(tab)}))`,
      { timeout: 90000, polling: 500 }
    );
    await clickTab(page, tab);
  }
  // Radix keeps inactive tab panels mounted (hidden), so scope the card search
  // to the active panel or a title substring can match a hidden card in another
  // tab and open the wrong project.
  const CARDS = '[role="dialog"] [role="tabpanel"][data-state="active"] .cursor-pointer';
  await page.waitForFunction(
    `[...document.querySelectorAll('${CARDS}')].some((c) => (c.textContent || '').includes(${JSON.stringify(cardTitle)}))`,
    { timeout: 90000, polling: 500 }
  );
  await page.evaluate((t, sel) => {
    [...document.querySelectorAll(sel)].find((c) => (c.textContent || '').includes(t)).click();
  }, cardTitle, CARDS);
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 30000, polling: 500 });
  await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 3", { timeout: 60000, polling: 500 });
  // Wait for the webfonts the project actually uses. A fixed sleep is not
  // enough: if Google Fonts is slow, the export captures a serif fallback,
  // whose wider glyphs wrap the headlines and wreck the layout.
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
    { timeout: 60000, polling: 500 }
  );
  await sleep(4000); // skeleton images + first paint settle
}

(async () => {
  const args = process.argv.slice(2);
  const composeOnly = args.includes('--compose-only');
  const only = args.filter((a) => !a.startsWith('--'));
  const list = only.length ? SLUGS.filter((s) => only.includes(s)) : SLUGS;
  fs.mkdirSync(PREVIEWS, { recursive: true });
  fs.mkdirSync(SRC, { recursive: true });

  // ---- Pass A: export artboards (one browser per template, proven flow) ----
  if (!composeOnly) {
    for (const slug of list) {
      const dir = path.join(SRC, slug);
      const have = fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).length;
      const { name, boards } = meta(slug);
      if (have >= Math.min(boards, MAX_SCREENS)) { console.log(`A cache ${slug} (${have} pngs)`); continue; }
      fs.rmSync(dir, { recursive: true, force: true });
      const { browser, page } = await launch({ downloadDir: dir });
      try {
        await openTemplate(page, name, SLUG_TAB[slug]);
        const files = await exportArtboards(page, dir, boards);
        console.log(`A export ${slug} -> ${files.length} boards`);
      } catch (e) {
        console.log(`A FAIL ${slug}: ${String(e).slice(0, 160)}`);
      } finally {
        await browser.close();
      }
    }
  }

  // ---- Pass B: compose strips + rewrite previewImage (one shared browser) ----
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, args: ['--no-sandbox'],
    defaultViewport: { width: CW, height: CH, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  let done = 0;
  for (const slug of list) {
    const dir = path.join(SRC, slug);
    if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => /\.png$/i.test(f))) {
      console.log(`B SKIP ${slug} (no exported screens)`); continue;
    }
    const { bg, ratio } = meta(slug);
    const out = path.join(PREVIEWS, `${slug}.png`);
    const n = await renderOnPage(page, dir, bg, out, MAX_SCREENS, ratio);
    // rewrite previewImage (handles placehold.co and empty "")
    const file = path.join(PROJ, `${slug}.json`);
    let text = fs.readFileSync(file, 'utf8');
    const rel = `/data/projects/previews/${slug}.png`;
    text = text.replace(/("previewImage":\s*)"[^"]*"/, `$1"${rel}"`);
    fs.writeFileSync(file, text);
    console.log(`B compose ${slug} -> ${path.basename(out)} (${n} screens), previewImage set`);
    done++;
  }
  await browser.close();
  console.log(`\nDONE: ${done}/${list.length} previews generated`);
})();
