/**
 * Films the multi-language flow against the real editor and writes the plates
 * the video is cut from: public/shots/*.png plus rects.json, the CSS-px boxes
 * of everything the camera flies to.
 *
 * The flow is the feature, in order: a project with no languages gets German,
 * Japanese and Spanish; the switcher moves to German; a headline is typed in
 * German from the properties panel; the base language is untouched when we go
 * back to it. Nothing here is mocked, so if the UI moves, rerun this and mirror
 * the new numbers into src/style.ts (RECTS).
 *
 * Needs the dev server on :9002 and the app-screenshots skill deps installed.
 */
const path = require('path');
const fs = require('fs');
const SKILL = path.join(__dirname, '../../.claude/skills/app-screenshots/scripts');
const lib = require(path.join(SKILL, 'lib.js'));

const OUT = path.join(__dirname, '../public/shots');
const VW = 1600;
const VH = 1000;
const DPR = 2;

/**
 * Adding a language machine translates the project on the spot, so the board
 * is already German by the time we get to the properties panel. The edit the
 * video films is therefore a rewrite of a machine string, not a blank being
 * filled: type a headline of your own over the one the machine guessed.
 */
const HEADLINE_ID = 'zf_b1_h';
const HEADLINE_DE = 'Bleib gesund';
/** Typed in chunks so the cut has real intermediate frames of the field. */
const CHUNKS = ['Bl', 'ei', 'b ', 'ge', 'sund'];

/** Machine translation doubles a word here ("Fitness Yoga App App"). Fixed by hand. */
const SUBTITLE_ID = 'zf_b1_s';
const SUBTITLE_DE = 'Fitness-Yoga-App';

const rects = { dpr: DPR, viewport: { width: VW, height: VH }, shots: {} };

const box = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
})()`;

/** getBoundingClientRect of the first element whose text matches a regex. */
const boxByText = (sel, re) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
    .find((n) => ${re}.test((n.textContent || '').trim()));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, text: (el.textContent || '').trim() };
})()`;

async function rect(page, shot, label, expr) {
  const r = await page.evaluate(expr);
  if (!r) throw new Error(`rect not found: ${shot}.${label}`);
  rects.shots[shot] = rects.shots[shot] || {};
  rects.shots[shot][label] = r;
  return r;
}

/** Same, but a miss is only logged: not every run has every control. */
async function rectOpt(page, shot, label, expr) {
  const r = await page.evaluate(expr);
  if (!r) {
    console.log(`  (no ${shot}.${label})`);
    return null;
  }
  rects.shots[shot] = rects.shots[shot] || {};
  rects.shots[shot][label] = r;
  return r;
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`${name}.png`);
}

/**
 * Real pointer click at an element's centre. Radix menus open on pointerdown,
 * which a DOM .click() never sends, so triggers have to be clicked for real.
 */
async function mouseClick(page, sel) {
  const r = await page.evaluate(box(sel));
  if (!r) throw new Error(`cannot click, not found: ${sel}`);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

/**
 * Wait until the board is painted again. Every locale change rebuilds the
 * artboards, and a screenshot taken during that gap is a blank canvas.
 */
async function settle(page, ms = 2600) {
  await page.waitForFunction(
    `(() => {
      const el = document.querySelector('[data-element-id="${HEADLINE_ID}"]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 100 && r.height > 20;
    })()`,
    { timeout: 60000, polling: 300 }
  );
  await page.evaluate('document.fonts.ready.then(() => true)');
  await lib.sleep(ms);
}

/** Pick a language from the switcher menu, by the name it shows. */
async function switchTo(page, re) {
  await mouseClick(page, 'button[title^="Showing"]');
  await page.waitForFunction("document.querySelectorAll('[role=\"menuitemcheckbox\"]').length > 1", {
    timeout: 15000,
    polling: 250,
  });
  await lib.sleep(700);
  const ok = await page.evaluate((src) => {
    const el = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((n) =>
      new RegExp(src).test(n.textContent || '')
    );
    if (!el) return false;
    el.click();
    return true;
  }, re.source);
  if (!ok) throw new Error(`language not in menu: ${re}`);
  await settle(page);
}

/** Click a button whose trimmed text matches, in the DOM (Radix-safe). */
async function clickText(page, re, what) {
  const ok = await page.evaluate((src) => {
    const el = [...document.querySelectorAll('button')].find((b) =>
      new RegExp(src).test((b.textContent || '').trim())
    );
    if (!el) return false;
    el.click();
    return true;
  }, re.source);
  if (!ok) throw new Error(`button not found: ${what || re}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ width: VW, height: VH, dpr: DPR });

  // ---- 1. Open the template ------------------------------------------------
  await page.goto(lib.APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // The tips dialog opens first and holds the start dialog behind it.
  await page.waitForFunction(
    "[...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Close')",
    { timeout: 90000, polling: 500 }
  );
  await lib.sleep(600);
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Close').click()`
  );
  await page.waitForFunction(
    "!!document.querySelector('input[placeholder^=\"Search templates\"]')",
    { timeout: 30000, polling: 400 }
  );
  await lib.sleep(800);
  await page.evaluate(
    `document.querySelector('input[placeholder^="Search templates"]').focus()`
  );
  await page.keyboard.type('Zenfit', { delay: 50 });
  await page.waitForFunction(
    "(() => { const i = document.querySelector(\"img[alt='Zenfit Yoga']\"); return !!i && i.complete && i.naturalWidth > 0; })()",
    { timeout: 60000, polling: 500 }
  );
  await lib.sleep(900);
  await page.evaluate(`(() => {
    const img = document.querySelector("img[alt='Zenfit Yoga']");
    const card = img && img.closest('.group');
    (card || img).click();
  })()`);
  await page.waitForFunction("location.search.includes('projectId')", { timeout: 60000, polling: 500 });
  await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 30", {
    timeout: 60000,
    polling: 500,
  });
  await page.evaluate('document.fonts.ready.then(() => true)');
  await lib.sleep(4500); // template images settle

  // Frame the first board: zoom until the headline is comfortably readable.
  for (let i = 0; i < 6; i++) {
    const r = await page.evaluate(box(`[data-element-id="${HEADLINE_ID}"]`));
    if (r && r.w >= 250) break;
    await lib.clickByTitle(page, 'Zoom In');
    await lib.sleep(400);
  }
  await page.evaluate(
    `document.querySelector('[data-element-id="${HEADLINE_ID}"]').scrollIntoView({ block: 'center', inline: 'center' })`
  );
  await lib.sleep(900);

  await rect(page, 'base', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  await rect(page, 'base', 'subtitle', box(`[data-element-id="${SUBTITLE_ID}"]`));
  await rect(page, 'base', 'addLanguage', box('button[title="Export this project in more than one language"]'));
  await shoot(page, '01-base');

  // ---- 2. Languages dialog -------------------------------------------------
  await page.evaluate(`document.querySelector('button[title="Export this project in more than one language"]').click()`);
  await page.waitForFunction("!!document.querySelector('input[aria-label=\"Search languages\"]')", {
    timeout: 20000,
    polling: 300,
  });
  await lib.sleep(900);
  await rect(page, 'dialog', 'dialog', box('[role="dialog"]'));
  await rect(page, 'dialog', 'search', box('input[aria-label="Search languages"]'));
  await shoot(page, '02-dialog');

  // Search, tick, repeat. German first: it is the language the rest of the
  // video is in, so it is the one the camera watches being ticked.
  // page.click on a live React input intermittently blocks the CDP call long
  // enough to trip protocolTimeout, so focus and select in the page instead.
  const focusSearch = () =>
    page.evaluate(`(() => {
      const i = document.querySelector('input[aria-label="Search languages"]');
      i.focus();
      i.select();
    })()`);

  const pick = async (query, code, shotName) => {
    await focusSearch();
    await page.keyboard.type(query, { delay: 45 });
    await page.waitForFunction(
      `!!document.querySelector('label[for="locale-${code}"]')`,
      { timeout: 10000, polling: 200 }
    );
    await lib.sleep(500);
    if (shotName) {
      await rect(page, shotName, 'search', box('input[aria-label="Search languages"]'));
      await rect(page, shotName, 'row', box(`label[for="locale-${code}"]`));
      await shoot(page, shotName);
    }
    await page.evaluate(`document.querySelector('label[for="locale-${code}"]').click()`);
    await lib.sleep(450);
    if (shotName) {
      await rect(page, `${shotName}-on`, 'row', box(`label[for="locale-${code}"]`));
      await rect(page, `${shotName}-on`, 'apply', boxByText('button', /^(Add \d+ languages?|Save languages)$/));
      await shoot(page, `${shotName}-on`);
    }
  };

  await pick('german', 'de-DE', '03-german');
  await pick('japanese', 'ja');
  await pick('spanish (spain)', 'es-ES');

  await focusSearch();
  await page.keyboard.press('Backspace');
  await lib.sleep(700);
  await rect(page, 'picked', 'apply', boxByText('button', /^(Add \d+ languages?|Save languages)$/));
  await rect(page, 'picked', 'dialog', box('[role="dialog"]'));
  await shoot(page, '04-picked');

  // ---- 3. Apply, and the switcher appears ---------------------------------
  // Applying also machine translates the three languages, which unmounts the
  // boards for a beat. Every shot from here waits for the headline to be back
  // on its feet, or it catches an empty canvas.
  await clickText(page, /^Add \d+ languages?$/, 'apply languages');
  await page.waitForFunction("!!document.querySelector('button[title^=\"Showing\"]')", {
    timeout: 30000,
    polling: 300,
  });
  await settle(page);
  await rect(page, 'added', 'switcher', box('button[title^="Showing"]'));
  await shoot(page, '05-added');

  // ---- 4. The language menu ------------------------------------------------
  await mouseClick(page, 'button[title^="Showing"]');
  await page.waitForFunction("document.querySelectorAll('[role=\"menuitemcheckbox\"]').length > 1", {
    timeout: 15000,
    polling: 250,
  });
  await lib.sleep(800);
  await rect(page, 'menu', 'menu', box('[role="menu"]'));
  await rect(page, 'menu', 'german', boxByText('[role="menuitemcheckbox"]', /Deutsch/));
  await rect(page, 'menu', 'base', boxByText('[role="menuitemcheckbox"]', /Base$/));
  await shoot(page, '06-menu');

  // ---- 5. Switch to German -------------------------------------------------
  await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((n) => /Deutsch/.test(n.textContent || ''));
    el.click();
  })()`);
  await page.waitForFunction(
    "!!document.querySelector('[role=\"status\"]') && /Viewing/.test(document.querySelector('[role=\"status\"]').textContent || '')",
    { timeout: 15000, polling: 250 }
  );
  await settle(page);
  await rect(page, 'german', 'notice', box('[role="status"]'));
  await rect(page, 'german', 'back', boxByText('button', /^Back to /));
  await rectOpt(page, 'german', 'untranslated', boxByText('button', /untranslated$/));
  console.log('  notice:', await page.evaluate(`document.querySelector('[role="status"]').textContent`));
  await rect(page, 'german', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  await rect(page, 'german', 'switcher', box('button[title^="Showing"]'));
  await shoot(page, '07-german');

  // ---- 6. Select the headline, type it in German ---------------------------
  const h = await page.evaluate(box(`[data-element-id="${HEADLINE_ID}"]`));
  await page.mouse.click(h.x + h.w / 2, h.y + h.h / 2);
  await page.waitForFunction("!!document.getElementById('textContent')", { timeout: 15000, polling: 250 });
  // German typed into an English-locale browser gets red squiggles under it,
  // which are the browser's opinion and not the app's.
  await page.evaluate(`document.getElementById('textContent').setAttribute('spellcheck', 'false')`);
  await lib.sleep(1000);
  await rect(page, 'selected', 'content', box('#textContent'));
  await rect(page, 'selected', 'contentGroup', box('#textContent'));
  await rect(page, 'selected', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  const chip = await page.evaluate(boxByText('span', /^DE$/));
  if (chip) rects.shots.selected.chip = chip;
  await shoot(page, '08-selected');

  // The canvas commits on blur, not per keystroke, so these frames are the
  // field filling up while the board still shows the machine's wording. That
  // gap is the reveal the cut is built around.
  await page.evaluate(`(() => {
    const t = document.getElementById('textContent');
    t.focus();
    t.select();
  })()`);
  await page.keyboard.press('Backspace');
  await lib.sleep(300);
  await shoot(page, '09-type-0');
  for (let i = 0; i < CHUNKS.length; i++) {
    await page.keyboard.type(CHUNKS[i], { delay: 60 });
    await lib.sleep(260);
    await shoot(page, `09-type-${i + 1}`);
  }
  await rect(page, 'typed', 'content', box('#textContent'));

  await page.evaluate(`document.getElementById('textContent').blur()`);
  await page.waitForFunction(
    `(document.querySelector('[data-element-id="${HEADLINE_ID}"]').textContent || '').includes(${JSON.stringify(HEADLINE_DE)})`,
    { timeout: 15000, polling: 200 }
  );
  await lib.sleep(1200);
  await rect(page, 'committed', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  await rect(page, 'committed', 'content', box('#textContent'));
  await shoot(page, '10-committed');

  // ---- 7. Fix the machine's doubled word in the subtitle --------------------
  const s = await page.evaluate(box(`[data-element-id="${SUBTITLE_ID}"]`));
  await page.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
  await page.waitForFunction("!!document.getElementById('textContent')", { timeout: 15000, polling: 250 });
  await lib.sleep(900);
  await page.evaluate(`(() => {
    const t = document.getElementById('textContent');
    t.setAttribute('spellcheck', 'false');
    t.focus();
    t.select();
  })()`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(SUBTITLE_DE, { delay: 30 });
  await page.evaluate(`document.getElementById('textContent').blur()`);
  await lib.sleep(1800);
  // Deselect so the board reads clean.
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 1900).catch(() => {});
  await lib.sleep(1200);
  await rect(page, 'deutsch', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  await rect(page, 'deutsch', 'subtitle', box(`[data-element-id="${SUBTITLE_ID}"]`));
  await rect(page, 'deutsch', 'back', boxByText('button', /^Back to /));
  await shoot(page, '11-deutsch');

  // ---- 8. The rest of the languages, same layout ---------------------------
  await switchTo(page, /日本語/);
  await rect(page, 'japanese', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  await shoot(page, '12-japanese');

  await switchTo(page, /Español/);
  await rect(page, 'spanish', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  await shoot(page, '13-spanish');

  // ---- 9. Back to the base language ---------------------------------------
  await switchTo(page, /Base$/);
  await rect(page, 'base2', 'headline', box(`[data-element-id="${HEADLINE_ID}"]`));
  await rect(page, 'base2', 'subtitle', box(`[data-element-id="${SUBTITLE_ID}"]`));
  await rect(page, 'base2', 'switcher', box('button[title^="Showing"]'));
  await shoot(page, '14-back-to-base');

  // The menu one last time: German now carries its own count.
  await mouseClick(page, 'button[title^="Showing"]');
  await page.waitForFunction("document.querySelectorAll('[role=\"menuitemcheckbox\"]').length > 1", {
    timeout: 15000,
    polling: 250,
  });
  await lib.sleep(900);
  await rect(page, 'menu2', 'menu', box('[role="menu"]'));
  await rect(page, 'menu2', 'german', boxByText('[role="menuitemcheckbox"]', /Deutsch/));
  await shoot(page, '15-menu-final');

  fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 2));
  console.log('rects.json written');
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
