/**
 * Opens a template by its gallery card text and takes a zoomed-out overview shot.
 * Usage: node verify-template.js "Listly Tasks" [zoomOuts=2] [outfile]
 */
const { launch, clickByTitle, openTemplatesView, sleep, shot } = require('./lib');

(async () => {
  const cardText = process.argv[2];
  if (!cardText) throw new Error('usage: node verify-template.js "<Template Name>" [zoomOuts] [outfile]');
  const zoomOuts = parseInt(process.argv[3] || '2', 10);
  const outfile = process.argv[4] || `out/${cardText.toLowerCase().replace(/\s+/g, '-')}-overview.png`;

  const { browser, page } = await launch({ width: 2400, height: 1300 });
  await page.goto('http://localhost:9002', { waitUntil: 'domcontentloaded', timeout: 120000 });
  // The dialog opens on the three-card landing screen; step into the gallery.
  await openTemplatesView(page);
  // Template gallery loads async after the tabs appear — wait for the card.
  await page.waitForFunction(
    (text) => [...document.querySelectorAll('div,h3,span')].some((n) => (n.textContent || '').trim() === text),
    { timeout: 60000, polling: 500 },
    cardText
  );
  await page.evaluate((text) => {
    const el = [...document.querySelectorAll('div,h3,span')].find((n) => (n.textContent || '').trim() === text);
    (el.closest('[class*="card"]') || el).click();
  }, cardText);
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 30000, polling: 500 });
  await sleep(3000);
  for (let i = 0; i < zoomOuts; i++) { await clickByTitle(page, 'Zoom Out'); await sleep(300); }
  await sleep(1500);
  await shot(page, outfile);
  await browser.close();
  console.log('written', outfile);
})();
