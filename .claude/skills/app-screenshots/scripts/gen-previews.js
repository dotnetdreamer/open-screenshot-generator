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
const { launch, exportArtboards, sleep, APP_URL } = require('./lib');
const { renderOnPage, EDGE, CW, CH } = require('./compose-preview');

const REPO = path.resolve(__dirname, '../../../..');
const PROJ = path.join(REPO, 'public/data/projects');
const PREVIEWS = path.join(PROJ, 'previews');
const SRC = path.resolve(process.env.TEMP || require('os').tmpdir(), 'artboard-previews-src');
const MAX_SCREENS = 6;

// The App Screenshots category, in gallery order.
const SLUGS = [
  'connectly-chat', 'budgetly-finance', 'listly-tasks', 'inboxly-mail', 'darzi-studio',
  'beauty-glam', 'castique-podcast', 'inquira', 'zyluxe-beauty', 'nexmind',
  'endless-communities', 'kicksy-sneakers', 'endless-podcasts', 'answerly-ai', 'lumina-search',
  'streamio-movies', 'readly-books', 'luxe-glow', 'cryptix', 'feasto',
  'storybuzz-kids', 'trackio-fitness', 'streamio-binge', 'roomora-home', 'playverse-games',
  'voyago-travel', 'finexa-crypto', 'flixio-kids', 'listenly-audio', 'tripora-travel',
  'tunio-music', 'coinly-crypto', 'stockio-invest', 'threadly-social', 'beatforge-studio',
  'podly-podcasts', 'cinevault-stream', 'sereno-mind', 'droply-habits', 'zeeb-fashion',
  'lingua-learn', 'verda-eco',
];

function meta(slug) {
  const j = JSON.parse(fs.readFileSync(path.join(PROJ, `${slug}.json`), 'utf8'));
  const ab = j.projectData[0];
  let bg = ab.backgroundColor || '#111';
  if (ab.backgroundType === 'gradient' && ab.backgroundGradient) {
    const g = ab.backgroundGradient;
    bg = `linear-gradient(${g.angle || 180}deg, ${g.color1}, ${g.color2})`;
  }
  return { name: j.name, boards: j.projectData.length, bg };
}

async function openTemplate(page, cardTitle) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    `[...document.querySelectorAll('[role="dialog"] .cursor-pointer')].some((c) => (c.textContent || '').includes(${JSON.stringify(cardTitle)}))`,
    { timeout: 90000, polling: 500 }
  );
  await page.evaluate((t) => {
    [...document.querySelectorAll('[role="dialog"] .cursor-pointer')]
      .find((c) => (c.textContent || '').includes(t)).click();
  }, cardTitle);
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 30000, polling: 500 });
  await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 3", { timeout: 60000, polling: 500 });
  await sleep(4000); // fonts + skeleton images + first paint settle
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
        await openTemplate(page, name);
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
    const { bg } = meta(slug);
    const out = path.join(PREVIEWS, `${slug}.png`);
    const n = await renderOnPage(page, dir, bg, out, MAX_SCREENS);
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
