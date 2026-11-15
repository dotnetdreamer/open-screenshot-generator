// Social graphics from Juniper's English screens.
//   STYLE=Duo node social.cjs  -> social/entry.png, flow.png, flow-styles.png, result.png, <format>.png
// Every format is opened from the graphics screen with the same set-up: Juniper's
// five screens, the name, the forest green and the launch line. The screen does
// not keep that state across an opened project, so it is checked and redone
// before each one.
const fs = require('fs');
const path = require('path');
const R = require('./rig.cjs');
const S = require('./steps.cjs');
const { buildJuniper, mcp } = require(path.join(R.CAP, 'juniper.cjs'));
const { feedPosts } = require('./posts.cjs');

const STYLE = process.env.STYLE || 'Duo';
const WANT = process.env.WANT || 'is out now';
const RESULT_FORMAT = process.env.RESULT || 'Link Preview';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const RESULT_ONLY = process.env.RESULT_ONLY === '1';
const SCREENS = path.join(R.REPO, 'promo', 'public', 'juniper', 'en');
const FORMATS = [
  { label: 'Link Preview', file: 'link-preview' },
  { label: 'Social Post', file: 'post' },
  { label: 'Story', file: 'story' },
  { label: 'Play Feature Graphic', file: 'play-feature-graphic' },
  { label: 'X Header', file: 'x-header' },
  { label: 'LinkedIn Banner', file: 'linkedin-banner' },
];
const DEBUG = path.join(__dirname, 'explore');
const GREEN = '#2d6a4f';

const styleButton = (style) =>
  [...document.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').startsWith(style + '. '));

async function openGraphics(page) {
  await S.create(page, 'Make social graphics');
  await page.waitForFunction(() => !!document.querySelector('#graphics-name') && !!document.querySelector('#graphics-name').offsetParent, { timeout: 20000 });
  await R.sleep(800);
}

async function pickFormat(page, label) {
  await R.clickPick(
    page,
    (label) => [...document.querySelectorAll('[aria-label="Graphic format"] [role="tab"]')].find((t) => (t.textContent || '').startsWith(label)),
    label
  );
  await R.sleep(1500);
}

async function scrollDialogBy(page, fn) {
  await page.evaluate(fn);
  await R.sleep(900);
}

async function waitImages(page) {
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])))
  );
  await R.sleep(1200);
}

async function shotCount(page) {
  return page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((x) => /^\d+ screenshots?/.test((x.textContent || '').trim()) && x.offsetParent);
    return p ? parseInt(p.textContent, 10) : 0;
  });
}

/** Screens, name, colour and wording, whatever the screen kept. */
async function prepare(page) {
  if ((await shotCount(page)) !== 5) {
    if ((await shotCount(page)) > 0) {
      await R.clickPick(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Clear' && b.offsetParent));
      await R.sleep(800);
    }
    const input = await page.evaluateHandle(() => document.querySelector('#graphics-name').closest('.space-y-4').querySelector('input[type="file"]'));
    const UP = path.join(__dirname, 'upload');
    fs.mkdirSync(UP, { recursive: true });
    // The intake orders a batch by file name, so the copies are numbered.
    const files = ['today', 'detail', 'stats', 'add', 'trophies'].map((s, i) => {
      const to = path.join(UP, `juniper-${i + 1}-${s}.png`);
      fs.copyFileSync(path.join(SCREENS, s + '.png'), to);
      return to;
    });
    await input.asElement().uploadFile(...files);
    await page.waitForFunction(
      () => [...document.querySelectorAll('p')].some((p) => /^5 screenshots/.test((p.textContent || '').trim())),
      { timeout: 60000, polling: 500 }
    );
    await R.sleep(1200);
  }
  const name = await page.evaluate(() => document.querySelector('#graphics-name').value);
  if (name !== 'Juniper') {
    await S.setInput(page, '#graphics-name', 'Juniper');
    await R.sleep(800);
  }
  const picked = await page.evaluate(() => {
    const on = [...document.querySelectorAll('button[aria-label^="Use #"]')].find((b) => /ring-2/.test(b.className));
    return on ? on.getAttribute('aria-label').slice(4).toLowerCase() : null;
  });
  if (picked !== GREEN) {
    const has = await page.evaluate((hex) => !!document.querySelector(`button[aria-label="Use ${hex}"]`), GREEN);
    if (!has) throw new Error('no ' + GREEN + ' swatch');
    await R.clickPick(page, (hex) => document.querySelector(`button[aria-label="Use ${hex}"]`), GREEN);
    await R.sleep(1000);
  }
  for (let i = 0; i < 6; i++) {
    const text = await page.evaluate((src) => {
      const b = new Function('return ' + src)()();
      return b ? b.innerText || b.textContent || '' : '';
    }, `() => (${styleButton.toString()})(${JSON.stringify(STYLE)})`);
    if (text.includes(WANT)) return;
    console.log('wording now', JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 80)));
    await R.clickPick(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'New lines'));
    await R.sleep(1200);
  }
  throw new Error('the wording never reached ' + WANT);
}

/** The chosen style's card: its text and whether its phones show uploaded screens. */
async function cardState(page) {
  return page.evaluate((style) => {
    const b = [...document.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').startsWith(style + '. '));
    if (!b) return null;
    const imgs = [...b.querySelectorAll('img')].map((i) => i.currentSrc || i.src);
    return { text: (b.innerText || '').replace(/\s+/g, ' '), imgs };
  }, STYLE);
}

(async () => {
  const { browser, page } = await R.openRig({ storage: R.signedInStorage(), posts: feedPosts() });
  const rects = {};
  try {
    await R.capLib.openTemplate(page, 'Droply Habits');
    await S.renameProject(page, 'Juniper');
    await buildJuniper(page, { languages: false });
    await R.capLib.settle(page, 1500);
    // Recent projects is read when the active project changes, so a reload
    // brings the new name into it.
    await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 3", { timeout: 60000, polling: 500 });
    await R.capLib.settle(page, 2000);
    await R.dismissToasts(page);

    if (!ONLY && !RESULT_ONLY) {
      // The entry, on the start screen the + opens, with the Community tab up.
      await S.create(page, 'Start from a template');
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Make social graphics')), {
        timeout: 20000,
      });
      await R.lib.clickTab(page, 'Community');
      await R.sleep(3000);
      await waitImages(page);
      await S.parkMouse(page);
      const entryCard = () =>
        [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Make social graphics') && (b.textContent || '').includes('Link previews'));
      rects['social/entry.png'] = {
        makeSocialGraphics: await R.rectOf(page, entryCard),
        start: await R.rectOf(page, (src) => {
          const c = new Function('return ' + src)()();
          return c && [...c.querySelectorAll('span')].find((s) => (s.textContent || '').trim().startsWith('Start'));
        }, entryCard.toString()),
      };
      console.log('entry hazards', await R.hazards(page));
      await R.shot(page, 'social/entry.png');
      await R.clickPick(page, entryCard);
      await page.waitForFunction(() => !!document.querySelector('#graphics-name') && !!document.querySelector('#graphics-name').offsetParent, { timeout: 20000 });
      await R.sleep(800);
      await prepare(page);

      // The screen, at the result's format, top first, then the designs.
      await pickFormat(page, RESULT_FORMAT);
      await scrollDialogBy(page, async () => {
        const scroller = document.querySelector('#graphics-name').closest('.overflow-y-auto');
        for (let y = 0; y <= scroller.scrollHeight; y += 300) {
          scroller.scrollTop = y;
          await new Promise((r) => setTimeout(r, 120));
        }
        scroller.scrollTop = 0;
      });
      await waitImages(page);
      await S.parkMouse(page);
      const flowRects = async () => ({
        screenshots: await R.rectOf(page, () => {
          const p = [...document.querySelectorAll('p')].find((x) => /^5 screenshots/.test((x.textContent || '').trim()));
          return p && p.closest('.space-y-2');
        }),
        appName: await R.rectOf(page, () => document.querySelector('#graphics-name')),
        brandColour: await R.rectOf(page, () => {
          const b = document.querySelector('button[aria-label^="Use #"]');
          return b && b.parentElement;
        }),
        formats: await R.rectOf(page, () => document.querySelector('[aria-label="Graphic format"]')),
        styleCard: await R.rectOf(page, (style) => {
          const b = [...document.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').startsWith(style + '. '));
          return b && b.parentElement;
        }, STYLE),
        openButton: await R.rectOf(page, (style) => {
          const b = [...document.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').startsWith(style + '. '));
          return b && [...b.parentElement.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Open');
        }, STYLE),
      });
      console.log('flow hazards', await R.hazards(page));
      await R.shot(page, 'social/flow.png');
      rects['social/flow.png'] = await flowRects();
      await scrollDialogBy(page, () => {
        const name = document.querySelector('#graphics-name');
        const section = name.closest('section');
        const scroller = name.closest('.overflow-y-auto');
        scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      });
      await waitImages(page);
      await S.parkMouse(page);
      console.log('styles hazards', await R.hazards(page));
      await R.shot(page, 'social/flow-styles.png');
      rects['social/flow-styles.png'] = await flowRects();
      delete rects['social/flow-styles.png'].screenshots;
    } else {
      await openGraphics(page);
      await prepare(page);
    }

    // Every format in the chosen style: set up, open, capture, come back.
    const order = [FORMATS.find((f) => f.label === RESULT_FORMAT), ...FORMATS.filter((f) => f.label !== RESULT_FORMAT)].filter(
      (f) => (!ONLY || ONLY.includes(f.file)) && (!RESULT_ONLY || f.label === RESULT_FORMAT)
    );
    let first = true;
    for (const format of order) {
      if (!first) {
        await openGraphics(page);
        await prepare(page);
      }
      await pickFormat(page, format.label);
      await page.evaluate((src) => {
        const b = new Function('return ' + src)()();
        if (b) b.scrollIntoView({ block: 'center' });
      }, `() => (${styleButton.toString()})(${JSON.stringify(STYLE)})`);
      await R.sleep(1500);
      await waitImages(page);
      const state = await cardState(page);
      console.log(format.file, 'card', state && state.text.slice(0, 90), state && state.imgs.length);
      if (!state || !state.text.includes(WANT)) throw new Error('card for ' + format.label + ' does not say ' + WANT);
      const before = page.url();
      await R.clickPick(page, (style) => {
        const b = [...document.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').startsWith(style + '. '));
        return b && [...b.parentElement.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Open');
      }, STYLE);
      await page.waitForFunction((before) => location.href !== before && location.search.includes('projectId'), { timeout: 30000, polling: 300 }, before);
      await page.waitForFunction(() => !document.querySelector('#graphics-name') || !document.querySelector('#graphics-name').offsetParent, { timeout: 30000 });
      await R.capLib.settle(page, 2500);
      const boards = await mcp(page, 'list_artboards', {});
      const list = Array.isArray(boards) ? boards : boards.artboards || boards.items || [];
      const board = list[0];
      if (!board) throw new Error('no board after opening ' + format.label + ': ' + JSON.stringify(boards).slice(0, 300));
      // The phones must hold Juniper's screens, not the placeholders.
      const art = await mcp(page, 'get_artboard', { artboardId: board.id });
      const srcs = JSON.stringify(art).match(/"screenshotSrc":"[^"]{0,60}/g) || [];
      console.log(format.file, 'screens', srcs.map((s) => s.slice(16, 60)));
      if (!srcs.length || srcs.some((s) => /fg-screens|placeholder|app-screens/.test(s))) throw new Error(format.label + ' phones hold placeholder screens');
      await R.captureBoard(page, board.id, `social/${format.file}.png`);
      if (first && !ONLY) {
        // The editor with what it built.
        await S.fitView(page, { boardIds: [board.id], frac: 0.92 });
        await S.parkMouse(page);
        await R.dismissToasts(page);
        await R.sleep(1200);
        await R.shot(page, 'social/result.png');
        rects['social/result.png'] = {
          board: await R.rectOf(page, (id) => document.querySelector(`[data-artboard-dom-id="${id}"]`), board.id),
          tab: await R.rectOf(page, () => document.querySelector('[data-project-tabs] [role="tab"][aria-selected="true"]')),
        };
        console.log('result hazards', await R.hazards(page), 'zoom', await S.zoomLevel(page));
      }
      first = false;
    }
    for (const [file, value] of Object.entries(rects)) R.saveRects(file, value);
  } catch (e) {
    console.error(e);
    fs.mkdirSync(DEBUG, { recursive: true });
    await page.screenshot({ path: path.join(DEBUG, 'social-error.png') });
    process.exitCode = 1;
  } finally {
    await R.closeRig(browser);
  }
})();
