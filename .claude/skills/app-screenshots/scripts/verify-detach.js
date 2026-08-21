// Verifies the detachable right dock end to end, on the web path.
//
// The desktop path opens a real Tauri window; the web path opens a popup and
// talks to it over BroadcastChannel. Everything above the transport is the same
// code, so proving the popup renders the panels from a pushed snapshot and that
// a click in the popup lands in the editor proves the feature.
//
// Run from the repo root with the dev server up:
//   node .claude/skills/app-screenshots/scripts/verify-detach.js
const path = require('path');
const { launch, dismissTipsDialog, shot, sleep } = require('./lib');

const OUT = process.env.OUT_DIR || path.join(process.env.TEMP || '/tmp', 'detach-verify');
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const { browser, page } = await launch();
  const failures = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
    if (!ok) failures.push(name);
  };

  try {
    // Not startBlankProject: the start screen only stands between you and the
    // editor on a first visit, and the Tips dialog sits on top of it either
    // way. Get to an open project however this build gets there.
    await page.goto('http://localhost:9002', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction('document.querySelectorAll(\'[role="tab"]\').length > 0', {
      polling: 500,
      timeout: 60000,
    });
    await dismissTipsDialog(page);
    const startBlank = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        (b.textContent || '').includes('Start blank')
      );
      if (button) button.click();
      return !!button;
    });
    if (startBlank) {
      await page.waitForFunction("location.search.includes('projectId')", {
        polling: 500,
        timeout: 30000,
      });
    }
    await sleep(2000);
    await shot(page, path.join(OUT, '01-editor.png'));

    // The dock still renders, with all four panels in it.
    const dockOk = await page.evaluate(() =>
      ['Properties', 'History', 'Versions'].every((label) =>
        [...document.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent.trim() === label)
      ) && !!document.querySelector('[role="separator"][aria-orientation="horizontal"]')
    );
    check('dock renders its tabs and the resize divider', dockOk);

    // Make sure there is a board and something on it, so Layers and Properties
    // have more than an empty state to show. Best effort: the checks below only
    // need the panels to render, not any particular content.
    const hasBoard = await page.evaluate(
      () => document.querySelectorAll('[data-artboard-dom-id]').length > 0
    );
    if (!hasBoard) {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.getAttribute('title') === 'New Artboard'
        );
        if (button) button.click();
      });
      await sleep(2500);
    }
    // Tiles only exist once a category is open; the tab shows category cards.
    await page.evaluate(() => {
      const category = document.querySelector('button[title="Browse Basic"]');
      if (category) category.click();
    });
    await sleep(1200);
    await page.evaluate(() => {
      const tile = document.querySelector('button[aria-label^="Add "]');
      if (tile) tile.click();
    });
    await sleep(2500);
    const elementCount = await page.evaluate(
      () => document.querySelectorAll('[data-element-id]').length
    );
    console.log(`      (board present: ${await page.evaluate(() => document.querySelectorAll('[data-artboard-dom-id]').length)}, elements: ${elementCount})`);

    // Open the panel menu and detach everything.
    const menu = await page.$('button[aria-label="Panel and display options"]');
    check('the dock offers the panel menu', !!menu);
    if (!menu) throw new Error('no panel menu');

    // Popups are blocked in headless unless we let them through, and we need a
    // handle on the new target either way.
    const popupPromise = new Promise((resolve) => page.once('popup', resolve));
    const box = await menu.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(
      'document.body.innerText.includes("Open all panels in a window")',
      { polling: 300, timeout: 10000 }
    );
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
        el.textContent.includes('Open all panels in a window')
      );
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      item.click();
    });

    const popup = await Promise.race([
      popupPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no popup opened')), 15000)),
    ]);
    await popup.waitForFunction(
      'document.body.innerText.includes("Properties") || document.body.innerText.includes("cannot find the editor")',
      { polling: 300, timeout: 20000 }
    );
    await new Promise((r) => setTimeout(r, 1500));
    await popup.screenshot({ path: path.join(OUT, '02-panel-window.png') });

    const connected = await popup.evaluate(
      () => !document.body.innerText.includes('cannot find the editor')
        && !document.body.innerText.includes('Connecting to the editor')
    );
    check('the panel window connected to the editor', connected);

    const panelHasTabs = await popup.evaluate(() =>
      ['Properties', 'History', 'Versions'].every((label) =>
        [...document.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent.trim() === label)
      )
    );
    check('the panel window renders all three tabs', panelHasTabs);

    const panelHasLayerRow = await popup.evaluate(() => document.body.innerText.includes('Layers'));
    check('the panel window renders the layers section', panelHasLayerRow);

    // The editor's dock gave way to the detached rail.
    const railOk = await page.evaluate(
      () => document.body.innerText.includes('Show panels') && document.body.innerText.includes('Put back')
    );
    check('the editor shows the detached rail', railOk);
    await shot(page, path.join(OUT, '03-editor-detached.png'));

    // The panel window's Layers list shows the editor's element.
    const layerListed = await popup.evaluate(
      () => document.querySelectorAll('button[title="Delete element"]').length > 0
    );
    check('the panel window lists the editor layers', layerListed);

    // Selecting a layer in the panel window must select it in the editor. This
    // is the intent round trip in its simplest form.
    await popup.evaluate(() => {
      const row = document.querySelector('button[title^="Double-click to rename"]');
      if (row) row.click();
    });
    await sleep(1500);
    // Round trip, not one way: the click became an intent, the editor changed
    // its selection, and the snapshot came back with the element on it. The
    // properties form dropping its empty state is the proof of all three.
    const selectionRoundTripped = await popup.evaluate(
      () => !document.body.innerText.includes('Select an element or artboard')
    );
    check('selecting a layer in the panel window round tripped through the editor', selectionRoundTripped);

    // Typing, then leaving the field. The content box keeps its edit locally
    // and commits once on blur (see handleTextContentBlur in PropertiesPanel),
    // which is also what keeps a detached window from putting one intent on the
    // bus per keystroke. So the blur is the part under test, not the typing.
    const typed = 'Detached typing works';
    await popup.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find(
        (el) => el.textContent.trim() === 'Properties'
      );
      if (tab) {
        tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        tab.click();
      }
    });
    await sleep(800);
    const contentBox = await popup.evaluate(() => {
      const area = document.querySelector('textarea');
      if (!area) return null;
      const rect = area.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    if (contentBox) {
      await popup.mouse.click(contentBox.x, contentBox.y);
      await popup.keyboard.down('Control');
      await popup.keyboard.press('KeyA');
      await popup.keyboard.up('Control');
      await popup.keyboard.type(typed, { delay: 35 });
      // Leave the field. Nothing is committed until this happens.
      await popup.keyboard.press('Tab');
      await sleep(2000);
      const inEditor = await page.evaluate(
        () => document.querySelector('[data-element-id]')?.innerText?.trim() ?? ''
      );
      check(
        'typing in the detached properties form reached the editor intact',
        inEditor.includes(typed),
        JSON.stringify(inEditor.slice(0, 60))
      );
    } else {
      check('the detached properties form has a content field', false);
    }

    // And the riskiest handler of all: delete reaches into an Artboard
    // component ref that only exists in the EDITOR window, so this proves an
    // intent is replayed there rather than attempted in the panel.
    const beforeDelete = await page.evaluate(
      () => document.querySelectorAll('[data-element-id]').length
    );
    await popup.evaluate(() => {
      const button = document.querySelector('button[title="Delete element"]');
      if (button) button.click();
    });
    await sleep(1500);
    const afterDelete = await page.evaluate(
      () => document.querySelectorAll('[data-element-id]').length
    );
    check(
      'deleting a layer from the panel window removed it in the editor',
      afterDelete === beforeDelete - 1,
      `${beforeDelete} -> ${afterDelete}`
    );

    // Jump a history state from the panel window and watch the editor's undo
    // pointer follow. Radix tabs ignore a synthetic click, so this goes through
    // the real mouse (rule 2 in SKILL.md), in the popup's own viewport.
    const historyTab = await popup.evaluateHandle(() =>
      [...document.querySelectorAll('[role="tab"]')].find(
        (el) => el.textContent.trim() === 'History'
      )
    );
    const historyBox = await historyTab.asElement().boundingBox();
    await popup.mouse.click(historyBox.x + historyBox.width / 2, historyBox.y + historyBox.height / 2);
    await popup.waitForFunction('document.body.innerText.includes("States")', {
      polling: 300,
      timeout: 10000,
    });
    const stateCount = await popup.evaluate(
      () => document.querySelectorAll('button[title^="Step back"], button[title="Current state"]').length
    );
    check('the panel window lists the editor history states', stateCount > 0, `${stateCount} states`);

    const elementsBefore = await page.evaluate(
      () => document.querySelectorAll('[data-element-id]').length
    );
    // The LAST step-back row, which is the state just before the current one.
    // The first row is the project opening, which has nothing on it either.
    await popup.evaluate(() => {
      const rows = [...document.querySelectorAll('button[title^="Step back"]')];
      const previous = rows[rows.length - 1];
      if (previous) previous.click();
    });
    await new Promise((r) => setTimeout(r, 1200));
    const elementsAfter = await page.evaluate(
      () => document.querySelectorAll('[data-element-id]').length
    );
    check(
      'a history jump in the panel window put the element back on the editor canvas',
      elementsAfter === elementsBefore + 1,
      `${elementsBefore} -> ${elementsAfter}`
    );
    await popup.screenshot({ path: path.join(OUT, '04-panel-history.png') });

    // Put it back.
    await popup.evaluate(() => {
      const button = document.querySelector('button[aria-label="Put back in the editor"]');
      button.click();
    });
    await page.waitForFunction(
      'document.body.innerText.includes("Properties") && !document.body.innerText.includes("Show panels")',
      { polling: 300, timeout: 15000 }
    );
    check('reattaching brings the panels back into the dock', true);
    await shot(page, path.join(OUT, '05-editor-reattached.png'));

    // Closing the window IS putting the panels back. Somebody who reaches for
    // the X is asking for the same thing as somebody who reaches for "Put
    // back", so the dock must not be left showing a rail for a window that no
    // longer exists.
    const menu2 = await page.$('button[aria-label="Panel and display options"]');
    const menu2Box = await menu2.boundingBox();
    const secondPopupPromise = new Promise((resolve) => page.once('popup', resolve));
    await page.mouse.click(menu2Box.x + menu2Box.width / 2, menu2Box.y + menu2Box.height / 2);
    await page.waitForFunction(
      'document.body.innerText.includes("Open all panels in a window")',
      { polling: 300, timeout: 10000 }
    );
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
        el.textContent.includes('Open all panels in a window')
      );
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      item.click();
    });
    const secondPopup = await Promise.race([
      secondPopupPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 12000)),
    ]);
    check('the panel window reopened', !!secondPopup, secondPopup ? secondPopup.url() : 'no popup');
    if (!secondPopup) throw new Error('no second popup');
    await sleep(4000);
    console.log('      second popup body:', JSON.stringify(
      (await secondPopup.evaluate(() => document.body.innerText)).slice(0, 120)
    ));
    await page.waitForFunction('document.body.innerText.includes("Show panels")', {
      polling: 300,
      timeout: 10000,
    });
    // Close it the way a person closes a window, without telling the editor.
    await secondPopup.close();
    let cameBack = false;
    for (let i = 0; i < 20 && !cameBack; i++) {
      await sleep(400);
      cameBack = await page.evaluate(
        () =>
          document.body.innerText.includes('Properties') &&
          !document.body.innerText.includes('Show panels')
      );
    }
    check('closing the panel window puts the panels back in the dock', cameBack);
    await shot(page, path.join(OUT, '06-editor-after-close.png'));
  } catch (error) {
    console.error('ERROR', error.message);
    failures.push(error.message);
  } finally {
    await browser.close();
  }

  console.log('\nOutput in', OUT);
  console.log(failures.length ? `FAILURES: ${failures.join(', ')}` : 'ALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})();
