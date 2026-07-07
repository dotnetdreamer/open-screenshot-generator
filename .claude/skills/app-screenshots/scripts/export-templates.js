/**
 * Export every artboard of each project template as PNGs for visual review.
 * Usage: node export-templates.js <outRoot> [templateName ...]
 * Each template gets its own download dir: <outRoot>/<slug>/
 */
const fs = require('fs');
const path = require('path');
const { launch, startBlankProject, sleep, exportArtboards, APP_URL } = require('./lib');

const TEMPLATES = [
  { slug: 'beauty-glam', card: 'Beauty Glam', boards: 5 },
  { slug: 'castique-podcast', card: 'Castique Podcast', boards: 5 },
  { slug: 'inquira', card: 'Inquira', boards: 5 },
  { slug: 'zyluxe-beauty', card: 'Zyluxe Beauty', boards: 5 },
  { slug: 'nexmind', card: 'NexMind', boards: 5 },
  { slug: 'endless-communities', card: 'Endless Communities', boards: 5 },
  { slug: 'kicksy-sneakers', card: 'Kicksy Sneakers', boards: 5 },
  { slug: 'endless-podcasts', card: 'Endless Podcasts', boards: 5 },
  { slug: 'answerly-ai', card: 'Answerly AI', boards: 5 },
  { slug: 'lumina-search', card: 'Lumina Search', boards: 5 },
  { slug: 'streamio-movies', card: 'Streamio Movies', boards: 5 },
  { slug: 'readly-books', card: 'Readly', boards: 5 },
  { slug: 'luxe-glow', card: 'Luxe Glow', boards: 5 },
  { slug: 'cryptix', card: 'CrypTix', boards: 5 },
  { slug: 'feasto', card: 'Feasto', boards: 5 },
  { slug: 'storybuzz-kids', card: 'StoryBuzz Kids', boards: 5 },
  { slug: 'trackio-fitness', card: 'Trackio Fitness', boards: 5 },
  { slug: 'streamio-binge', card: 'Streamio Binge', boards: 5 },
  { slug: 'roomora-home', card: 'Roomora Home', boards: 5 },
  { slug: 'playverse-games', card: 'Playverse Games', boards: 5 },
  { slug: 'darzi-studio', card: 'Darzi Studio', boards: 7 },
  { slug: 'voyago-travel', card: 'Voyago Travel', boards: 5 },
  { slug: 'finexa-crypto', card: 'Finexa Crypto', boards: 5 },
  { slug: 'flixio-kids', card: 'Flixio Kids', boards: 5 },
  { slug: 'listenly-audio', card: 'Listenly Audiobooks', boards: 5 },
  { slug: 'tripora-travel', card: 'Tripora Travel', boards: 5 },
  { slug: 'tunio-music', card: 'Tunio Music', boards: 5 },
  { slug: 'coinly-crypto', card: 'Coinly Crypto', boards: 5 },
  { slug: 'stockio-invest', card: 'Stockio Invest', boards: 5 },
  { slug: 'threadly-social', card: 'Threadly Social', boards: 5 },
  { slug: 'beatforge-studio', card: 'Beatforge Studio', boards: 5 },
  { slug: 'podly-podcasts', card: 'Podly Podcasts', boards: 5 },
  { slug: 'cinevault-stream', card: 'Cinevault', boards: 5 },
  { slug: 'sereno-mind', card: 'Sereno Mind', boards: 5 },
  { slug: 'droply-habits', card: 'Droply Habits', boards: 5 },
  { slug: 'zeeb-fashion', card: 'Zeeb Fashion', boards: 5 },
  { slug: 'budgetly-finance', card: 'Budgetly Finance', boards: 8 },
  { slug: 'verda-eco', card: 'Verda Eco', boards: 5 },
];

async function openTemplateFromStartDialog(page, cardTitle) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Wait for the template cards to load in the start dialog.
  await page.waitForFunction(
    `[...document.querySelectorAll('[role="dialog"] .cursor-pointer')].some((c) => (c.textContent || '').includes(${JSON.stringify(cardTitle)}))`,
    { timeout: 90000, polling: 500 }
  );
  await page.evaluate((cardTitle) => {
    const card = [...document.querySelectorAll('[role="dialog"] .cursor-pointer')].find(
      (c) => (c.textContent || '').includes(cardTitle)
    );
    card.click();
  }, cardTitle);
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 30000, polling: 500 });
  // Wait for artboard elements to mount.
  await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 3", {
    timeout: 60000,
    polling: 500,
  });
  await sleep(4000); // fonts + images + first paint settle
}

(async () => {
  const outRoot = process.argv[2];
  if (!outRoot) throw new Error('usage: node export-templates.js <outRoot> [slug ...]');
  const only = process.argv.slice(3);
  const list = only.length ? TEMPLATES.filter((t) => only.includes(t.slug)) : TEMPLATES;

  for (const t of list) {
    const dir = path.join(outRoot, t.slug);
    fs.rmSync(dir, { recursive: true, force: true });
    const { browser, page } = await launch({ downloadDir: dir });
    try {
      console.log('== ' + t.slug);
      await openTemplateFromStartDialog(page, t.card);
      const files = await exportArtboards(page, dir, t.boards);
      console.log('   exported:', files.join(', '));
    } catch (e) {
      console.log('   FAILED:', String(e).slice(0, 400));
    } finally {
      await browser.close();
    }
  }
})();
