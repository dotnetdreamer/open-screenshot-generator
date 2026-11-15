// App Store header and search art (iOS 27), built from Juniper.
//   EXPLORE=1 node header.cjs  -> explore/header-*.png (palette tab, dialog)
//   node header.cjs            -> header/dialog.png, header/editor.png, header/<art>.png
const fs = require('fs');
const path = require('path');
const R = require('./rig.cjs');
const S = require('./steps.cjs');
const { buildJuniper, mcp } = require(path.join(R.CAP, 'juniper.cjs'));

const EXPLORE = process.env.EXPLORE === '1';
const HEADER_LOOK = process.env.HEADER_LOOK || 'Showcase';
const SEARCH_LOOK = process.env.SEARCH_LOOK || 'Two screens';
const DEBUG = path.join(__dirname, 'explore');

const dialogSel = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('App Store header and search'));

async function waitImages(page) {
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])))
  );
  await R.sleep(1500);
}

async function snap(page, name) {
  fs.mkdirSync(DEBUG, { recursive: true });
  await page.screenshot({ path: path.join(DEBUG, name + '.png') });
  console.log('snap', name);
}

(async () => {
  const { browser, page } = await R.openRig({ storage: R.signedInStorage(), posts: [] });
  const rects = {};
  try {
    await R.capLib.openTemplate(page, 'Droply Habits');
    await buildJuniper(page, { languages: true });
    await R.capLib.settle(page, 2000);
    await R.dismissToasts(page);

    // The palette's Header tab, drawn from Juniper.
    await S.paletteTab(page, 'Header');
    await R.sleep(2500);
    await waitImages(page);
    if (EXPLORE) {
      await snap(page, 'header-palette');
      await page.evaluate(() => {
        const panel = document.querySelector('[role="tabpanel"][data-state="active"] .overflow-y-auto') || document.querySelector('#palette-store-art-name')?.closest('.overflow-y-auto');
        if (panel) panel.scrollTop = 600;
      });
      await R.sleep(1200);
      await snap(page, 'header-palette-2');
    }

    // The dialog, from the +.
    await S.create(page, 'App Store header and search art');
    await page.waitForFunction(`!!(${dialogSel.toString()})()`, { timeout: 20000 });
    await R.sleep(2500);
    await waitImages(page);
    if (EXPLORE) {
      await snap(page, 'header-dialog');
      await page.evaluate((src) => {
        const d = new Function('return ' + src)()();
        const body = d && d.querySelector('.overflow-y-auto');
        if (body) body.scrollTop = 10000;
      }, dialogSel.toString());
      await R.sleep(1000);
      await snap(page, 'header-dialog-2');
      await page.keyboard.press('Escape');
      return;
    }

    // Pick the looks, then show the dialog with them picked.
    for (const [kind, look] of [
      ['Product page header', HEADER_LOOK],
      ['Search results', SEARCH_LOOK],
    ]) {
      await R.clickPick(
        page,
        (src, kind, look) => {
          const d = new Function('return ' + src)()();
          const section = [...d.querySelectorAll('section')].find((s) => (s.querySelector('h3')?.textContent || '').trim() === kind);
          return section && [...section.querySelectorAll('button[aria-pressed]')].find((b) => (b.querySelector('p')?.textContent || '').trim() === look);
        },
        dialogSel.toString(),
        kind,
        look
      );
      await R.sleep(600);
    }
    await S.parkMouse(page);
    await R.sleep(800);
    console.log('dialog hazards', await R.hazards(page));
    const inDialog = (fnSrc) => fnSrc;
    rects['header/dialog.png'] = {
      dialog: await R.rectOf(page, (src) => {
        const d = new Function('return ' + src)()();
        return d;
      }, dialogSel.toString()),
      headerPick: await R.rectOf(page, (src, look) => {
        const d = new Function('return ' + src)()();
        const section = [...d.querySelectorAll('section')].find((s) => (s.querySelector('h3')?.textContent || '').trim() === 'Product page header');
        return section && [...section.querySelectorAll('button[aria-pressed]')].find((b) => (b.querySelector('p')?.textContent || '').trim() === look);
      }, dialogSel.toString(), HEADER_LOOK),
      searchPick: await R.rectOf(page, (src, look) => {
        const d = new Function('return ' + src)()();
        const section = [...d.querySelectorAll('section')].find((s) => (s.querySelector('h3')?.textContent || '').trim() === 'Search results');
        return section && [...section.querySelectorAll('button[aria-pressed]')].find((b) => (b.querySelector('p')?.textContent || '').trim() === look);
      }, dialogSel.toString(), SEARCH_LOOK),
      addButton: await R.rectOf(page, (src) => {
        const d = new Function('return ' + src)()();
        return [...d.querySelectorAll('button')].find((b) => /^Add \d artboards?$/.test((b.textContent || '').trim()));
      }, dialogSel.toString()),
    };
    void inDialog;
    await R.shot(page, 'header/dialog.png');

    // Add them.
    const before = await page.evaluate(() => document.querySelectorAll('[data-artboard-dom-id]').length);
    await R.clickPick(page, (src) => {
      const d = new Function('return ' + src)()();
      return [...d.querySelectorAll('button')].find((b) => /^Add \d artboards?$/.test((b.textContent || '').trim()));
    }, dialogSel.toString());
    await page.waitForFunction((n) => document.querySelectorAll('[data-artboard-dom-id]').length >= n + 2, { timeout: 30000 }, before);
    await R.capLib.settle(page, 3000);
    await R.dismissToasts(page);

    // Adding the art opens the store listing, so the product page is the next frame.
    const listingOpen = await page
      .waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Close preview/i.test(b.getAttribute('aria-label') || b.title || '')), { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (listingOpen) {
      await R.sleep(2500);
      await waitImages(page);
      await S.parkMouse(page);
      console.log('listing hazards', await R.hazards(page));
      // The phone is the first box around the art that is phone shaped; a
      // check card is the first box around its heading that is card sized.
      const phoneOf = (sel) => {
        let el = document.querySelector(sel);
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.width >= 300 && r.height >= 560 && r.height < 880) return el;
          el = el.parentElement;
        }
        return null;
      };
      const cardOf = (heading) => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
        const t = dialog && [...dialog.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').trim() === heading);
        let el = t;
        while (el && el !== dialog) {
          const r = el.getBoundingClientRect();
          if (r.height >= 120) return el;
          el = el.parentElement;
        }
        return null;
      };
      rects['header/listing.png'] = {
        phone: await R.rectOf(page, phoneOf, '[data-creative-crop="header"]'),
        headerArt: await R.rectOf(page, () => document.querySelector('[data-creative-crop="header"]')),
        searchToggle: await R.rectOf(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Search results' && b.offsetParent)),
        headerCheck: await R.rectOf(page, cardOf, 'Product page header'),
        searchCheck: await R.rectOf(page, cardOf, 'Search result'),
      };
      await R.shot(page, 'header/listing.png');
      await R.clickPick(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Search results' && b.offsetParent));
      await R.sleep(2500);
      await waitImages(page);
      await S.parkMouse(page);
      rects['header/listing-search.png'] = {
        phone: await R.rectOf(page, phoneOf, '[data-creative-crop="search"]'),
        searchArt: await R.rectOf(page, () => document.querySelector('[data-creative-crop="search"]')),
      };
      await R.shot(page, 'header/listing-search.png');
      await R.clickPick(page, () => [...document.querySelectorAll('button')].find((b) => /Close preview/i.test(b.getAttribute('aria-label') || b.title || '')));
      await R.sleep(1500);
    }

    // The creative boards, from the bridge.
    const listed = await mcp(page, 'list_artboards', {});
    const boards = Array.isArray(listed) ? listed : listed.artboards || listed.items || [];
    console.log('boards', JSON.stringify(boards.map((b) => [b.id, b.name, b.width || (b.size && b.size.width), b.height || (b.size && b.size.height)])));
    const art = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artboard-dom-id]')].slice(0, 2).map((b) => b.getAttribute('data-artboard-dom-id'))
    );
    console.log('front boards', art);

    // The editor: Header tab open, the new art in view with its checks. The
    // right dock folds away so the two pieces of art get the room.
    if (process.env.KEEP_DOCK !== '1') {
      await R.clickPick(page, () => [...document.querySelectorAll('button')].find((b) => b.title === 'Collapse right panel'));
      await R.sleep(1200);
    }
    await S.fitView(page, { boardIds: art, frac: 0.97, insets: { top: 56, bottom: 64, left: 14, right: 14 } });
    await R.sleep(1500);
    await waitImages(page);
    await S.parkMouse(page);
    await R.dismissToasts(page);
    console.log('editor hazards', await R.hazards(page));
    rects['header/editor.png'] = {
      headerTab: await R.rectOf(page, () => [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || '').trim() === 'Header' && t.offsetParent)),
      palette: await R.rectOf(page, () => document.querySelector('#palette-store-art-name')?.closest('.overflow-y-auto')),
      headerBoard: await R.rectOf(page, (id) => document.querySelector(`[data-artboard-dom-id="${id}"]`), art[0]),
      searchBoard: await R.rectOf(page, (id) => document.querySelector(`[data-artboard-dom-id="${id}"]`), art[1]),
      headerCheck: await R.rectOf(page, () => document.querySelector('[title="App Store check for the product page header"]')),
      searchCheck: await R.rectOf(page, () => document.querySelector('[title="App Store check for the search results"]')),
    };
    await R.shot(page, 'header/editor.png');

    // The art itself, at Apple's sizes.
    await R.captureBoard(page, art[0], 'header/product-page-header.png');
    await R.captureBoard(page, art[1], 'header/search-result.png');
    for (const [loc, tag] of [['de-DE', 'de'], ['ja', 'ja']]) {
      await R.captureBoard(page, art[0], `header/product-page-header-${tag}.png`, loc);
    }

    // And the universal image, one click from the Header tab.
    const count = await page.evaluate(() => document.querySelectorAll('[data-artboard-dom-id]').length);
    await R.clickPick(page, () => document.querySelector('button[aria-label="Add the Name and screen universal image"]'));
    await page.waitForFunction((n) => document.querySelectorAll('[data-artboard-dom-id]').length > n, { timeout: 20000 }, count);
    await R.sleep(3000);
    const after = await mcp(page, 'list_artboards', {});
    const all = Array.isArray(after) ? after : after.artboards || after.items || [];
    const uni = all.find((b) => /universal/i.test(b.name || '') || (b.width || (b.size && b.size.width)) === 5244);
    console.log('universal', JSON.stringify(uni));
    if (uni) await R.captureBoard(page, uni.id, 'header/universal.png');

    for (const [file, value] of Object.entries(rects)) R.saveRects(file, value);
  } catch (e) {
    console.error(e);
    await snap(page, 'header-error');
    process.exitCode = 1;
  } finally {
    await R.closeRig(browser);
  }
})();
