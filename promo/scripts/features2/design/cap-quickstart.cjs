// Shot 1: the start dialog's "Drop your screenshots" flow with Juniper's five English screens.
//   quickstart-empty.png     the drop zone before anything is dropped
//   quickstart-dragover.png  the same zone while files are held over it
//   quickstart-drop.png      the five screens in, the designs it suggests rendered with them
//   quickstart-result.png    the project the first suggestion opens
//   node cap-quickstart.cjs [--query habits]
const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');

const OUT = C.OUT;
const QUERY = (() => {
  const i = process.argv.indexOf('--query');
  return i > 0 ? process.argv[i + 1] : process.env.QUERY ?? 'habits';
})();
const APP_NAME = 'Juniper';
const ORDER = ['today', 'detail', 'add', 'stats', 'trophies'];

// The five screens as somebody would have them on disk, named so the natural sort keeps
// the store order (the intake sorts picked files by name).
function stageFiles() {
  const dir = path.join(__dirname, 'drop');
  fs.mkdirSync(dir, { recursive: true });
  return ORDER.map((screen, i) => {
    const file = path.join(dir, `juniper-${i + 1}-${screen}.png`);
    fs.copyFileSync(path.join(C.SCREENS, 'en', `${screen}.png`), file);
    return file;
  });
}

const DIALOG = '[role="dialog"]';

(async () => {
  const files = stageFiles();
  const { page, close } = await C.openEditor({ theme: 'dark', dpr: 2 });
  try {
    await C.waitStartDialog(page);
    await C.sleep(1500);

    // Into the quick start view.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((n) => (n.textContent || '').includes('Drop your screenshots'));
      if (!b) throw new Error('no Drop your screenshots card');
      b.click();
    });
    await C.waitFor(page, `[...document.querySelectorAll('${DIALOG} p')].some((p) => (p.textContent || '').trim() === 'Drop your screenshots here')`);
    // The deck of template previews below the zone has to finish loading too.
    await C.waitFor(page, `![...document.querySelectorAll('${DIALOG} .animate-pulse')].some((n) => n.getBoundingClientRect().height > 0)`, 90000);
    await C.settle(page, 2500);
    await C.parkMouse(page);

    const zoneFinder = () =>
      [...document.querySelectorAll('[role="dialog"] p')].find((p) => /^(Drop your screenshots here|Let go to add them)$/.test((p.textContent || '').trim()))
        .closest('div.border-dashed');
    const dialogFinder = () => document.querySelector('[role="dialog"]');

    const emptyRects = {
      dialog: await C.rect(page, dialogFinder),
      dropZone: await C.rect(page, zoneFinder),
      chooseFiles: await C.rect(page, () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent || '').trim() === 'Choose files')),
    };
    await C.shot(page, path.join(OUT, 'quickstart-empty.png'));
    C.writeRects(OUT, 'quickstart-empty.png', emptyRects);

    // Files held over the zone: the same handlers a real drag runs.
    await page.evaluate((src) => {
      const zone = new Function('return (' + src + ')')()();
      const dt = new DataTransfer();
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, zoneFinder.toString());
    await C.sleep(600);
    await C.shot(page, path.join(OUT, 'quickstart-dragover.png'));
    C.writeRects(OUT, 'quickstart-dragover.png', { dialog: emptyRects.dialog, dropZone: await C.rect(page, zoneFinder) });
    await page.evaluate((src) => {
      const zone = new Function('return (' + src + ')')()();
      zone.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    }, zoneFinder.toString());
    await C.sleep(400);

    // The drop itself, through the zone's own file input (the same onFiles a drop calls).
    const inputs = await page.$$(`${DIALOG} input[type="file"][multiple]:not([webkitdirectory])`);
    if (!inputs.length) throw new Error('no file input in the zone');
    await inputs[0].uploadFile(...files);
    await C.waitFor(page, `[...document.querySelectorAll('${DIALOG} p')].some((p) => /^5 screenshots/.test((p.textContent || '').trim()))`, 60000);

    // Name the app, and the optional keywords.
    await C.setInputValue(page, '#quickstart-name', APP_NAME);
    if (QUERY) await C.setInputValue(page, '#quickstart-query', QUERY);
    await C.sleep(1500);

    // Every card on screen has to have its boards built and its images decoded.
    await C.waitFor(
      page,
      `(() => {
        const cards = [...document.querySelectorAll('${DIALOG} [role="button"][aria-pressed]')];
        if (cards.length < 3) return false;
        const onScreen = cards.filter((c) => c.getBoundingClientRect().top < innerHeight);
        return onScreen.every((c) => c.querySelector('[data-artboard-surface], .artboard, img'));
      })()`,
      90000
    );
    await C.settle(page, 3500);
    await C.clearToasts(page);

    const ranking = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] [role="button"][aria-pressed]')].slice(0, 8).map((c) => {
        const r = c.getBoundingClientRect();
        return { name: (c.querySelector('h4') || {}).textContent, top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
      })
    );
    console.log('ranking', JSON.stringify(ranking));

    // Two frames of the same state. The dialog cannot hold the intake and a whole row of
    // designs at 900px, so quickstart-drop.png is scrolled until the five screens and the
    // first row of designs (with their Use buttons) share the frame, and
    // quickstart-drop-top.png is the top of the same view, with the compact drop zone.
    const layout = await page.evaluate(() => {
      const card = document.querySelector('[role="dialog"] [role="button"][aria-pressed]');
      let scroller = card.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      const top = (el) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const bottom = (el) => el.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const zone = [...document.querySelectorAll('[role="dialog"] div.border-dashed')].find((d) => /Drop more here/.test(d.textContent || ''));
      const label = [...document.querySelectorAll('[role="dialog"] p')].find((p) => /^5 screenshots/.test((p.textContent || '').trim()));
      const thumbs = document.querySelector('[role="dialog"] li[data-shot-tile]');
      return {
        visible: scroller.clientHeight,
        zone: [top(zone), bottom(zone)],
        label: [top(label), bottom(label)],
        thumbs: [top(thumbs), bottom(thumbs)],
        card: [top(card), bottom(card)],
        cardContent: [top(card), bottom(card.querySelector('ul') || card.querySelector('h4').parentElement)],
        scroller: String(scroller.className).slice(0, 120),
      };
    });
    console.log('layout', JSON.stringify(layout));
    const setScroll = (y) =>
      page.evaluate((y) => {
        const card = document.querySelector('[role="dialog"] [role="button"][aria-pressed]');
        let scroller = card.parentElement;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        scroller.scrollTop = y;
        return scroller.scrollTop;
      }, y);
    // Prefer the label line too; otherwise start just above the thumbnails. The card's own
    // bottom padding may go under the edge, its title, Use button and reasons may not.
    const fits = (from) => layout.cardContent[1] - from + 6 <= layout.visible;
    const from = fits(layout.zone[0] - 6) ? layout.zone[0] - 6 : fits(layout.label[0] - 6) ? layout.label[0] - 6 : layout.thumbs[0] - 3;
    const scrollY = Math.max(0, Math.round(from));
    console.log('scroll to', scrollY, 'content end', Math.round(layout.cardContent[1] - scrollY), 'of', layout.visible);

    const firstCard = () => document.querySelector('[role="dialog"] [role="button"][aria-pressed]');
    const compactZone = () =>
      [...document.querySelectorAll('[role="dialog"] div.border-dashed')].find((d) => /Drop more here/.test(d.textContent || ''));
    const stripFinder = () => document.querySelector('[role="dialog"] li[data-shot-tile]').closest('ul, ol, div');
    const measure = async () => {
      const r = {
        dialog: await C.rect(page, dialogFinder),
        screenshotStrip: await C.rect(page, () => {
          const tiles = [...document.querySelectorAll('[role="dialog"] li[data-shot-tile]')];
          const a = tiles[0].getBoundingClientRect();
          const b = tiles[tiles.length - 1].getBoundingClientRect();
          return { getBoundingClientRect: () => ({ x: a.x, y: a.y, width: b.right - a.x, height: Math.max(a.height, b.height) }) };
        }),
        appName: await C.rect(page, () => document.querySelector('#quickstart-name')),
        keywords: await C.rect(page, () => document.querySelector('#quickstart-query')),
        firstMatch: await C.rect(page, firstCard),
        firstMatchUse: await C.rect(page, () =>
          [...document.querySelector('[role="dialog"] [role="button"][aria-pressed]').querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Use')
        ),
        secondMatch: await C.rect(page, () => document.querySelectorAll('[role="dialog"] [role="button"][aria-pressed]')[1]),
      };
      const zone = await C.rect(page, compactZone);
      const dialog = r.dialog;
      // Only a zone that is really on screen (the dialog header covers the scroller's top).
      if (zone.y >= dialog.y + 50 && zone.y + zone.h <= dialog.y + dialog.h) r.dropZone = zone;
      // Only what is really in view: the dialog's scroll area ends above its bottom edge, and
      // a card cut by it is no target to point at.
      const visibleBottom = await page.evaluate(() => {
        const card = document.querySelector('[role="dialog"] [role="button"][aria-pressed]');
        let scroller = card.parentElement;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        return scroller.getBoundingClientRect().bottom;
      });
      for (const [k, v] of Object.entries(r)) {
        if (k === 'dialog' || v.y + v.h <= visibleBottom + 1) continue;
        if (v.y + v.h <= visibleBottom + 14) {
          // Only the card's bottom padding is under the edge: ring what shows.
          v.h = Math.round((visibleBottom - v.y) * 10) / 10;
        } else {
          console.log('  dropping rect', k, '(cut by the scroll edge)');
          delete r[k];
        }
      }
      return r;
    };

    console.log('scrollTop set', await setScroll(scrollY));
    await C.sleep(900);
    await C.parkMouse(page);
    console.log('scrollTop now', await setScroll(scrollY));
    await C.sleep(400);
    const dropRects = await measure();
    await C.shot(page, path.join(OUT, 'quickstart-drop.png'));
    C.writeRects(OUT, 'quickstart-drop.png', dropRects);

    await setScroll(0);
    await C.sleep(900);
    const topRects = await measure();
    await C.shot(page, path.join(OUT, 'quickstart-drop-top.png'));
    C.writeRects(OUT, 'quickstart-drop-top.png', topRects);
    fs.writeFileSync(path.join(__dirname, 'quickstart-ranking.json'), JSON.stringify(ranking, null, 2));

    await setScroll(scrollY);
    await C.sleep(600);

    // Open the first suggestion.
    await C.clickRect(page, dropRects.firstMatchUse);
    await page.waitForFunction("location.search.includes('projectId')", { timeout: 60000, polling: 500 });
    await page.waitForFunction("!document.querySelector('[role=\"dialog\"]') && document.querySelectorAll('[data-artboard-dom-id] [data-element-id]').length > 3", {
      timeout: 60000,
      polling: 500,
    });
    await C.settle(page, 3500);
    await C.clearToasts(page, 9000);
    // The same framing the editor shots use (boards 1 to 3), so the film can cross from this
    // to Juniper in the editor without the canvas moving.
    const boardCount = await page.evaluate(() => document.querySelectorAll('[data-artboard-dom-id]').length);
    const framed = await C.frameThree(page);
    console.log('result zoom', await C.zoomLevel(page), 'boards', boardCount, 'scroller', JSON.stringify(framed.scroller));
    // A click on the bare canvas keeps the first board active without an element selected.
    await C.settle(page, 2000);
    await C.parkMouse(page);
    const resultRects = {
      canvas: await C.rect(page, () => {
        const board = document.querySelector('[data-artboard-dom-id]');
        let el = board.parentElement;
        while (el && el !== document.body) {
          const cs = getComputedStyle(el);
          if (/auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflow)) return el;
          el = el.parentElement;
        }
        return null;
      }),
    };
    for (let i = 0; i < 3; i++) resultRects['board' + (i + 1)] = await C.rect(page, (i) => document.querySelectorAll('[data-artboard-dom-id]')[i], i);
    const projectName = await C.rectOpt(page, () => document.querySelector('input[aria-label="Project name"], input[title="Project name"]'));
    if (projectName) resultRects.projectName = projectName;
    await C.shot(page, path.join(OUT, 'quickstart-result.png'));
    C.writeRects(OUT, 'quickstart-result.png', resultRects);
    const status = await page.evaluate(() => window.__osg && window.__osg.status());
    console.log('opened', JSON.stringify({ name: status && status.projectName, boards: status && status.artboards.map((b) => b.name + ' ' + b.width + 'x' + b.height) }));
  } catch (e) {
    console.error(e);
    await page.screenshot({ path: path.join(__dirname, 'zz-quickstart-error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    C.reportBlocked();
    await close();
  }
})();
