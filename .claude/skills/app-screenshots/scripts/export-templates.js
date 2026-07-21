/**
 * Export every artboard of each project template as PNGs for visual review.
 * Usage: node export-templates.js <outRoot> [templateName ...]
 * Each template gets its own download dir: <outRoot>/<slug>/
 */
const fs = require('fs');
const path = require('path');
const { launch, startBlankProject, sleep, exportArtboards, clickTab, APP_URL } = require('./lib');

const TEMPLATES = [
  { slug: 'calora-macros', card: 'Calora Macros', boards: 5 },
  { slug: 'puzzlo-word', card: 'Puzzlo Word', boards: 5 },
  { slug: 'sproutly-parenting', card: 'Sproutly Parenting', boards: 5 },
  { slug: 'zapio-remote', card: 'Zapio Remote', boards: 5 },
  { slug: 'runzo-coach', card: 'Runzo Coach', boards: 5 },
  { slug: 'nookly-focus', card: 'Nookly Focus', boards: 5 },
  { slug: 'breathora-breathing', card: 'Breathora Breathing', boards: 5 },
  { slug: 'vowly-wedding', card: 'Vowly Wedding', boards: 5 },
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
  { slug: 'zenfit-yoga', card: 'Zenfit Yoga', boards: 5 },
  { slug: 'playpop-intro', card: 'PlayPop Intro', boards: 5 },
  { slug: 'lotus-calm', card: 'Lotus Calm', boards: 5 },
  { slug: 'cvcraft-resume', card: 'CVCraft Resume', boards: 7 },
  { slug: 'nutrio-fitness', card: 'Nutrio Fitness', boards: 5 },
  { slug: 'blogio-articles', card: 'Blogio Articles', boards: 4 },
  { slug: 'watch-breathora', card: 'Breathora Watch', boards: 5, tab: 'Apple Watch' },
  { slug: 'watch-vowly', card: 'Vowly Watch', boards: 5, tab: 'Apple Watch' },
  { slug: 'watch-smart-appscreens', card: 'Smart AppScreens', boards: 5, tab: 'Apple Watch' },
  { slug: 'watch-editors-choice', card: 'Editors Choice', boards: 5, tab: 'Apple Watch' },
  { slug: 'watch-dark-aso', card: 'Dark ASO', boards: 5, tab: 'Apple Watch' },
  { slug: 'watch-ultra-showcase', card: 'Ultra Showcase', boards: 5, tab: 'Apple Watch' },
  { slug: 'watch-lavender', card: 'Lavender', boards: 5, tab: 'Apple Watch' },
  { slug: 'watch-sunset', card: 'Sunset Pop', boards: 5, tab: 'Apple Watch' },
  { slug: 'mac-flowdesk', card: 'Flowdesk Focus', boards: 5, tab: 'Mac' },
  { slug: 'mac-pulseform', card: 'Pulseform Training', boards: 5, tab: 'Mac' },
  { slug: 'mac-skyfit', card: 'Skyfit Coach', boards: 5, tab: 'Mac' },
  { slug: 'mac-inkpress', card: 'Inkpress Writer', boards: 5, tab: 'Mac' },
  { slug: 'mac-everglade', card: 'Everglade Focus', boards: 5, tab: 'Mac' },
  { slug: 'mac-festivo', card: 'Festivo Events', boards: 5, tab: 'Mac' },
  { slug: 'mac-terra', card: 'Terra Impact', boards: 5, tab: 'Mac' },
  { slug: 'mac-loopchat', card: 'Loopchat Desk', boards: 5, tab: 'Mac' },
  { slug: 'mac-ledgerly', card: 'Ledgerly Money', boards: 5, tab: 'Mac' },
  { slug: 'mac-boardly', card: 'Boardly Tasks', boards: 5, tab: 'Mac' },
  { slug: 'mac-postbox', card: 'Postbox Mail', boards: 5, tab: 'Mac' },
  { slug: 'mac-atelier', card: 'Atelier Noir', boards: 5, tab: 'Mac' },
];

async function openTemplateFromStartDialog(page, cardTitle, tab) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Non-default categories (Apple Watch, Feature Graphic) live behind a Radix
  // tab — click it first so its panel becomes active. Radix keeps INACTIVE tab
  // panels mounted (just hidden), so the card search below must be scoped to the
  // active panel; an unscoped [role=dialog] search matches hidden cards in other
  // tabs and can open the wrong project (e.g. "Lavender" also appears in a
  // screenshots-tab description).
  if (tab) {
    await page.waitForFunction(
      `[...document.querySelectorAll('[role="tab"]')].some((b) => (b.textContent || '').includes(${JSON.stringify(tab)}))`,
      { timeout: 90000, polling: 500 }
    );
    await clickTab(page, tab);
  }
  const CARDS = '[role="dialog"] [role="tabpanel"][data-state="active"] .cursor-pointer';
  // Wait for the template cards to load in the active tab panel.
  await page.waitForFunction(
    `[...document.querySelectorAll('${CARDS}')].some((c) => (c.textContent || '').includes(${JSON.stringify(cardTitle)}))`,
    { timeout: 90000, polling: 500 }
  );
  await page.evaluate((cardTitle, sel) => {
    const card = [...document.querySelectorAll(sel)].find(
      (c) => (c.textContent || '').includes(cardTitle)
    );
    card.click();
  }, cardTitle, CARDS);
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
      await openTemplateFromStartDialog(page, t.card, t.tab);
      const files = await exportArtboards(page, dir, t.boards);
      console.log('   exported:', files.join(', '));
    } catch (e) {
      console.log('   FAILED:', String(e).slice(0, 400));
    } finally {
      await browser.close();
    }
  }
})();
