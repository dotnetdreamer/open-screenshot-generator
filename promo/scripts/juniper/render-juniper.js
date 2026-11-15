/**
 * Renders Juniper's five app screens in four languages to
 * public/juniper/<lang>/<screen>.png at 1206 x 2622 (402 x 874 CSS px at 3x),
 * the iPhone 6.3" size, using headless Edge through the app-screenshots skill's
 * puppeteer. Fonts come from Google Fonts, so this needs the network.
 *
 *   node scripts/juniper/render-juniper.js
 */
const fs = require("fs");
const path = require("path");
const url = require("url");

const SKILL = path.join(__dirname, "..", "..", "..", ".claude", "skills", "app-screenshots", "scripts");
const lib = require(path.join(SKILL, "lib.js"));

const OUT = path.join(__dirname, "..", "..", "public", "juniper");
const PAGE = url.pathToFileURL(path.join(__dirname, "juniper.html")).href;
const SCREENS = ["today", "detail", "stats", "add", "trophies"];
const LANGS = ["en", "de", "ja", "ar"];

(async () => {
  // The skill's launcher: Edge 150 broke puppeteer.launch, so it spawns Edge and connects.
  const { browser, page } = await lib.launch({ width: 402, height: 874, dpr: 3 });
  try {
    for (const lang of LANGS) {
      fs.mkdirSync(path.join(OUT, lang), { recursive: true });
      for (const screen of SCREENS) {
        await page.goto(`${PAGE}?screen=${screen}&lang=${lang}`, { waitUntil: "networkidle0", timeout: 60000 });
        await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
        const file = path.join(OUT, lang, `${screen}.png`);
        await page.screenshot({ path: file });
        console.log("wrote", path.relative(process.cwd(), file));
      }
    }
  } finally {
    await browser.close();
  }
})();
