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
