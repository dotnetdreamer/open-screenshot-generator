// Capture: the iPhone 17 Pro simulator running Juniper, the grid of boards by language, and
// "Take all screens in all languages" filling it.
//
//   capture-live.png       the first board taken in every language (an earlier sitting), Juniper
//                          open on its Today screen in English
//   capture-progress.png   "Take all screens in all languages" held mid-way through German
//   capture-done.png       every board in every language (the grid shows three language rows at
//                          this window height; the fourth, Arabic, is one scroll below)
//   capture-done-tall.png  the same in a taller window (1440 wide), where all four rows fit (an extra)
//
// The simulator is the patched IPC mock in flows-lib.cjs: every screenshot is one of Juniper's real
// screens, in the language and on the screen of the last launch.
//
//   node cap-capture.cjs
const F = require('./flows-lib.cjs');
const { sleep } = F;

const CAPTURE = 'Capture: screenshots of your app';
const SIM = {
  id: '5E2F7A10-3C4B-4D8E-9F61-2A7B8C9D0E1F',
  platform: 'ios',
  kind: 'simulator',
  name: 'iPhone 17 Pro',
  state: 'running',
  os: 'iOS 26.5',
  model: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
};
const APPS = [{ id: 'com.example.juniper', name: 'Juniper', running: true }];

/** How each frame reaches its screen: the first screen (null), or a juniper:// link. */
const ROUTES = [null, 'juniper://detail', 'juniper://add', 'juniper://stats', 'juniper://trophies', null];

async function waitFor(page, fn, timeout = 30000, ...args) {
  await page.waitForFunction(fn, { timeout, polling: 300 }, ...args);
}

/** The pointer rests on empty space, so no hover state shows in a shot. */
async function park(page) {
  await page.mouse.move(1400, 560);
  await sleep(300);
}

const box = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

/** Choose how a frame reaches its screen, through the chooser beside its name. */
async function setRoute(page, frameTitle, link) {
  await F.clickWhere(page, (title) => {
    const b = document.querySelector(`[data-testid="capture-view"] button[aria-label="Choose the screen for ${title}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, frameTitle);
  await waitFor(page, () => !!document.querySelector('[data-radix-popper-content-wrapper] [role="radiogroup"]'));
  await sleep(300);
  const answer = link ? 'A screen with a link' : 'The first screen of my app';
  await F.clickWhere(page, (answer) => {
    const radio = [...document.querySelectorAll('[role="radio"]')].find((r) => {
      const id = r.getAttribute('aria-labelledby');
      return id && document.getElementById(id)?.textContent === answer;
    });
    if (!radio) return null;
    const r = radio.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, answer);
  await sleep(300);
  if (link) {
    await waitFor(page, () => !!document.querySelector('input[aria-label="Link to this screen"]'));
    await F.setValue(page, 'input[aria-label="Link to this screen"]', link);
    await sleep(200);
  }
  await F.clickWhere(page, () => {
    const pop = document.querySelector('[data-radix-popper-content-wrapper]');
    const b = pop && [...pop.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Save' && !x.disabled);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await waitFor(page, () => !document.querySelector('[data-radix-popper-content-wrapper] [role="radiogroup"]'));
  await sleep(400);
}

async function clickButton(page, text) {
  await F.clickWhere(page, (text) => {
    const view = document.querySelector('[data-testid="capture-view"]');
    const b = [...view.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, text);
}

/** Open Capture and wait for the simulator, its live screen and the app. */
async function openCapture(page) {
  await F.openView(page, CAPTURE);
  await waitFor(page, () => !!document.querySelector('[data-testid="capture-view"]'));
  await waitFor(page, () => /Ready/.test(document.querySelector('[data-testid="capture-device-state"]')?.textContent || ''), 30000);
  await waitFor(page, () => !!document.querySelector('[data-testid="capture-live-view"] img'), 30000);
  await waitFor(page, () => /Juniper/.test(document.querySelector('[data-testid="capture-view"] button[aria-label="Your app"]')?.textContent || ''), 30000);
  await waitFor(page, () => [...document.querySelectorAll('[data-capture-cell] img')].length >= 18, 30000);
  await sleep(1500);
}

/** A reload: the project and Capture's picks stay, the screenshots list of this sitting goes. */
async function reopen(page) {
  await sleep(3000); // the project is saved a moment after it changes
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await F.lib.dismissTipsDialog(page, { timeout: 8000 });
  await waitFor(page, () => document.querySelectorAll('[data-element-id]').length > 3, 60000);
  await F.settle(page, 1500);
  await openCapture(page);
}

/** What the grid's cells hold, by key: 'own' (a screenshot of the app), 'example' or the text. */
async function cellStates(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-capture-cell]')].map((cell) => [
        cell.getAttribute('data-capture-cell').replace(/^tpl_dr_/, '').replace(/:tpl_dr_ab\d_device/, ''),
        cell.querySelector('img') ? (cell.textContent.includes('Example') ? 'example' : 'own') : cell.textContent.trim() || 'empty',
      ])
    )
  );
}

const cellRect = (key) => `() => document.querySelector('[data-capture-cell="${key}"]')`;

const RECTS = {
  'device-screen': `() => document.querySelector('[data-testid="capture-live-view"]')`,
  device: `() => document.querySelector('[data-testid="capture-view"] button[aria-label="Device"]')`,
  'your-app': `() => document.querySelector('[data-testid="capture-view"] button[aria-label="Your app"]')`,
  'take-screenshot': `() => [...document.querySelectorAll('[data-testid="capture-view"] aside button')].find((b) => b.textContent.trim() === 'Take screenshot' && b.getAttribute('data-testid') !== 'capture-live-view')`,
  'take-all': `() => [...document.querySelectorAll('[data-testid="capture-view"] button')].find((b) => b.textContent.trim() === 'Take all screens in all languages')`,
  'take-this-screen': `() => [...document.querySelectorAll('[data-testid="capture-view"] button')].find((b) => b.textContent.trim() === 'Take this screen in all languages')`,
  // The part of the grid on screen: the table's width, the scroll box's height.
  grid: `() => { const table = document.querySelector('[data-testid="capture-grid"] table').getBoundingClientRect(); const scroller = document.querySelector('[data-testid="capture-grid"]').getBoundingClientRect(); const top = Math.max(table.top, scroller.top); const bottom = Math.min(table.bottom, scroller.bottom); return { x: table.left, y: top, w: table.width, h: bottom - top }; }`,
  'clean-status-bar': `() => document.querySelector('#capture-tidy')?.closest('div.flex.items-start')`,
};

const GRID_BOX = `() => document.querySelector('[data-testid="capture-grid"]')`;

const RUN_ROWS = Number(process.env.STOP_AT || 9);

(async () => {
  const { page, close } = await F.openFlows({
    responses: {
      abs_capture_devices: { ios: { devices: [SIM], models: [] }, android: { devices: [], models: [] } },
      abs_capture_apps: APPS,
    },
  });
  try {
    await F.openTemplate(page, 'Droply Habits');
    await F.buildJuniperDesign(page);
    await F.settle(page, 1500);
    await F.clearToasts(page);
    await openCapture(page);

    const titles = await page.evaluate(() => [...document.querySelectorAll('[data-testid="capture-frame-name"]')].map((n) => n.textContent.trim()));
    console.log('frames', titles);
    // An earlier sitting: the first board, Juniper's first screen, taken in every language.
    await setRoute(page, titles[0], ROUTES[0]);
    await clickButton(page, 'Take this screen in all languages');
    await waitFor(page, () => [...document.querySelectorAll('li, [role="status"]')].some((n) => /Took 4 screenshots/.test(n.textContent || '')), 120000);
    await F.clearToasts(page);

    await reopen(page);
    console.log('cells', JSON.stringify(await cellStates(page)));
    await F.clearToasts(page);
    await park(page);
    const liveRects = await F.measure(page, { ...RECTS, 'filled-cell': cellRect('tpl_dr_ab1:tpl_dr_ab1_device|de-DE') }, { clip: GRID_BOX });
    await F.shot(page, 'capture-live.png');
    F.saveRects('capture-live.png', liveRects);

    // Every other frame learns how to reach its screen, then the whole grid in one run.
    for (let i = 1; i < titles.length; i++) await setRoute(page, titles[i], ROUTES[i]);
    const before = await page.evaluate(() => {
      window.__flows.hold = true;
      return window.__flows.shots;
    });
    await clickButton(page, 'Take all screens in all languages');
    // Let the run take the English row and the first German frames, then hold it.
    for (let n = 0; n < 40; n++) {
      await waitFor(page, () => window.__E2E_TAURI__.commandsHeld.length > 0, 60000);
      const done = (await page.evaluate(() => window.__flows.shots)) - before;
      if (done >= RUN_ROWS) break;
      await page.evaluate(() => window.__E2E_TAURI__.releaseCommands());
      await sleep(200);
    }
    await sleep(1800);
    console.log('run', await page.evaluate(() => document.querySelector('[data-testid="capture-run"]')?.textContent));
    await park(page);
    const progressRects = await F.measure(page, {
      ...RECTS,
      progress: `() => document.querySelector('[data-testid="capture-run"]')`,
      'stop-run': `() => [...document.querySelectorAll('[data-testid="capture-run"] button')].find((b) => b.textContent.trim() === 'Stop')`,
      'filled-cell': cellRect('tpl_dr_ab2:tpl_dr_ab2_device|de-DE'),
      'working-cell': `() => [...document.querySelectorAll('[data-capture-cell]')].find((c) => c.querySelector('.animate-spin'))`,
    }, { clip: GRID_BOX });
    await F.shot(page, 'capture-progress.png');
    F.saveRects('capture-progress.png', progressRects);

    // The rest of the run, then a new sitting with every frame filled.
    await page.evaluate(() => {
      window.__flows.hold = false;
      window.__E2E_TAURI__.releaseCommands();
    });
    await waitFor(page, () => [...document.querySelectorAll('li, [role="status"]')].some((n) => /Took 24 screenshots/.test(n.textContent || '')), 300000);
    await F.clearToasts(page);
    await reopen(page);
    const cells = await cellStates(page);
    console.log('cells', JSON.stringify(cells));
    if (Object.values(cells).some((state) => state !== 'own')) throw new Error('not every cell is filled');
    await F.clearToasts(page);
    await park(page);
    const doneRects = await F.measure(page, { ...RECTS, 'filled-cell': cellRect('tpl_dr_ab4:tpl_dr_ab4_device|ja') }, { clip: GRID_BOX });
    await F.shot(page, 'capture-done.png');
    F.saveRects('capture-done.png', doneRects);

    // An extra: a taller window, where the Arabic row fits too.
    await page.setViewport({ width: 1440, height: 1136, deviceScaleFactor: 2 });
    await sleep(1500);
    // Tall enough for the device column too, so nothing is cut at the bottom edge.
    const more = await page.evaluate(() => {
      const aside = document.querySelector('[data-testid="capture-view"] aside');
      return Math.max(0, aside.scrollHeight - aside.clientHeight);
    });
    if (more > 0) {
      await page.setViewport({ width: 1440, height: 1136 + more + 8, deviceScaleFactor: 2 });
      await sleep(1500);
    }
    await F.settle(page, 1000);
    await park(page);
    const tallRects = await F.measure(page, {
      ...RECTS,
      'filled-cell': cellRect('tpl_dr_ab4:tpl_dr_ab4_device|ar-SA'),
      'arabic-row': `() => [...document.querySelectorAll('[data-testid="capture-grid"] tbody tr')].pop()`,
    }, { clip: GRID_BOX });
    await F.shot(page, 'capture-done-tall.png');
    F.saveRects('capture-done-tall.png', tallRects);
  } catch (e) {
    console.error(e);
    await F.shot(page, '_error-capture.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
