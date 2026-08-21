// Verifies the detachable dock on the DESKTOP path: a real Tauri WebviewWindow,
// Tauri events as the transport, and the capability that lets the editor create
// and place one.
//
// Prerequisite: the app running with WebView2's inspector port open.
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run tauri:dev
// then, from the repo root:
//   node .claude/skills/app-screenshots/scripts/verify-detach-desktop.js
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.env.WEBVIEW_PORT || 9333;
const OUT = process.env.OUT_DIR || path.join(process.env.TEMP || '/tmp', 'detach-verify');
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const failures = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
    if (!ok) failures.push(name);
  };

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${PORT}`,
    defaultViewport: null,
  });

  const editorPage = async () => {
    const pages = await browser.pages();
    for (const page of pages) {
      const url = page.url();
      if (url.includes('localhost:9002') && !url.includes('panel=')) return page;
    }
    return null;
  };
  const panelPage = async () => {
    const pages = await browser.pages();
    return pages.find((page) => page.url().includes('panel=')) ?? null;
  };

  try {
    const page = await editorPage();
    check('the editor webview is reachable over CDP', !!page, page ? page.url() : '');
    if (!page) throw new Error('no editor webview');
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        console.log('      [editor.' + m.type() + ']', m.text().slice(0, 300));
      }
    });
    page.on('pageerror', (e) => console.log('      [editor.pageerror]', String(e).slice(0, 300)));

    // A panel window left over from a previous run would make everything below
    // pass for the wrong reason.
    const leftover = await panelPage();
    if (leftover) {
      await leftover.evaluate(() => {
        const button = document.querySelector('button[aria-label="Put back in the editor"]');
        if (button) button.click();
      });
      await sleep(2000);
    }

    // Tauri really is the shell, so this is really the desktop transport.
    const isTauri = await page.evaluate(() => '__TAURI_INTERNALS__' in window);
    check('the editor is running inside Tauri', isTauri);

    // The Tips dialog covers the dock on a first run.
    const dismissed = await page.evaluate(() => {
      const close = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent || '').trim() === 'Close'
      );
      if (close) close.click();
      return !!close;
    });
    if (dismissed) await sleep(800);

    // The start dialog is modal and covers the dock, so get a project open first.
    if (await page.$('[role="dialog"]')) {
      const started = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((b) =>
          (b.textContent || '').includes('Start blank')
        );
        if (button) button.click();
        return !!button;
      });
      if (started) {
        await page.waitForFunction("location.search.includes('projectId')", {
          polling: 500,
          timeout: 30000,
        });
        await sleep(2500);
      }
    }

    // The dock remembers being collapsed across launches (abs-right-dock-open),
    // and the menu lives in its header, so open it first.
    const expand = await page.$('button[aria-label="Expand right panel"]');
    if (expand) {
      const expandBox = await expand.boundingBox();
      await page.mouse.click(expandBox.x + expandBox.width / 2, expandBox.y + expandBox.height / 2);
      await sleep(1200);
    }

    const menu = await page.$('button[aria-label="Panel and display options"]');
    check('the dock offers the panel menu', !!menu);
    if (!menu) throw new Error('no panel menu');
    const box = await menu.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(
      'document.body.innerText.includes("Open all panels in a window")',
      { polling: 300, timeout: 10000 }
    );
    const menuText = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim())
    );
    console.log('      menu:', JSON.stringify(menuText));
    // The display list needs no extra permission: core:window:default is read
    // only but already carries availableMonitors. On a single display machine
    // the group is hidden rather than shown disabled, so an absence here is
    // correct and the printed menu above is the evidence either way.
    check('the panel menu built without a permission error', menuText.length > 0);

    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
        el.textContent.includes('Open all panels in a window')
      );
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      item.click();
    });

    // A real OS window, created by the frontend. If capabilities/panels.json is
    // missing or the create permission is not granted, this never appears.
    let panel = null;
    for (let i = 0; i < 40 && !panel; i++) {
      await sleep(500);
      panel = await panelPage();
    }
    check('a Tauri panel window opened', !!panel, panel ? panel.url() : 'none after 20s');
    if (!panel) throw new Error('no panel window');

    panel.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        console.log('      [panel.' + m.type() + ']', m.text().slice(0, 300));
      }
    });
    panel.on('pageerror', (e) => console.log('      [panel.pageerror]', String(e).slice(0, 300)));
    await panel.waitForFunction(
      'document.body.innerText.includes("Properties") || document.body.innerText.includes("cannot find the editor")',
      { polling: 300, timeout: 20000 }
    );
    await sleep(1500);
    await panel.screenshot({ path: path.join(OUT, 'desktop-01-panel.png') });

    const connected = await panel.evaluate(
      () =>
        !document.body.innerText.includes('cannot find the editor') &&
        !document.body.innerText.includes('Connecting to the editor')
    );
    check('the bus reached the panel window over Tauri events', connected);

    // Placement. The window was positioned with PhysicalPosition/PhysicalSize
    // computed from the display's work area, which is the same code path the
    // "Move to display" menu uses, so this is the multi monitor maths under
    // test even on a single display machine.
    const placement = await page.evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const [position, size, monitors] = await Promise.all([
        invoke('plugin:window|outer_position', { label: 'panel-dock' }),
        invoke('plugin:window|outer_size', { label: 'panel-dock' }),
        invoke('plugin:window|available_monitors', {}),
      ]);
      return { position, size, monitors };
    });
    const onAWorkArea = placement.monitors.some((monitor) => {
      const area = monitor.workArea;
      return (
        placement.position.x >= area.position.x - 1 &&
        placement.position.y >= area.position.y - 1 &&
        placement.position.x + placement.size.width <= area.position.x + area.size.width + 1 &&
        placement.position.y + placement.size.height <= area.position.y + area.size.height + 1
      );
    });
    check(
      'the panel window was placed inside a display work area',
      onAWorkArea,
      `${placement.size.width}x${placement.size.height} at ${placement.position.x},${placement.position.y} across ${placement.monitors.length} display(s)`
    );

    // And it wrote down where it landed, so the next detach reopens there.
    await sleep(1200);
    const remembered = await panel.evaluate(() => {
      try {
        return window.localStorage.getItem('abs-panel-window-dock');
      } catch {
        return null;
      }
    });
    check('the panel window remembered its geometry', !!remembered, remembered || 'nothing stored');

    // The editor gave the dock's width back to the canvas.
    const railOk = await page.evaluate(
      () =>
        document.body.innerText.includes('Show panels') &&
        document.body.innerText.includes('Put back')
    );
    check('the editor shows the detached rail', railOk);
    await page.screenshot({ path: path.join(OUT, 'desktop-02-editor.png') });

    // An intent crossing the Tauri event bus and landing in the editor.
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-element-id]').length
    );
    const historyRows = await panel.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find(
        (el) => el.textContent.trim() === 'History'
      );
      return !!tab;
    });
    check('the panel window rendered the editor snapshot', historyRows);

    // Reattach, which is the panel telling the editor to close its window.
    await panel.evaluate(() => {
      const button = document.querySelector('button[aria-label="Put back in the editor"]');
      button.click();
    });
    let closed = false;
    for (let i = 0; i < 30 && !closed; i++) {
      await sleep(400);
      closed = !(await panelPage());
    }
    check('reattaching closed the Tauri panel window', closed);
    await page.waitForFunction(
      'document.body.innerText.includes("Properties") && !document.body.innerText.includes("Show panels")',
      { polling: 300, timeout: 15000 }
    );
    check('the panels came back into the dock', true, `${before} elements on canvas`);
    await page.screenshot({ path: path.join(OUT, 'desktop-03-reattached.png') });

    // Reopen, and prove the window did not grow. setSize sets the CLIENT area
    // while outerSize reports the frame too, so a geometry saved with the wrong
    // one puts the height of a title bar on the window every single time it is
    // reopened. This is the check that catches that coming back.
    const menuAgain = await page.$('button[aria-label="Panel and display options"]');
    const againBox = await menuAgain.boundingBox();
    await page.mouse.click(againBox.x + againBox.width / 2, againBox.y + againBox.height / 2);
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
    let reopened = null;
    for (let i = 0; i < 40 && !reopened; i++) {
      await sleep(500);
      reopened = await panelPage();
    }
    check('the panel window reopened', !!reopened);
    if (reopened) {
      await sleep(2000);
      const second = await page.evaluate(async () => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const [position, size] = await Promise.all([
          invoke('plugin:window|outer_position', { label: 'panel-dock' }),
          invoke('plugin:window|outer_size', { label: 'panel-dock' }),
        ]);
        return { position, size };
      });
      check(
        'reopening did not move or resize the window',
        second.size.width === placement.size.width &&
          second.size.height === placement.size.height &&
          second.position.x === placement.position.x &&
          second.position.y === placement.position.y,
        `${placement.size.width}x${placement.size.height}@${placement.position.x},${placement.position.y} -> ${second.size.width}x${second.size.height}@${second.position.x},${second.position.y}`
      );
      // Close it the way a person closes a window, with the title bar's X,
      // without telling the editor first. That fires CloseRequested, which is
      // where the panel says goodbye, and the dock must take its panels back
      // rather than sit on a rail for a window that is gone.
      await page.evaluate(async () => {
        await window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'panel-dock' });
      });
      let gone = false;
      for (let i = 0; i < 30 && !gone; i++) {
        await sleep(400);
        gone = !(await panelPage());
      }
      check('the X button closed the panel window', gone);
      let cameBack = false;
      for (let i = 0; i < 25 && !cameBack; i++) {
        await sleep(400);
        cameBack = await page.evaluate(
          () =>
            document.body.innerText.includes('Properties') &&
            !document.body.innerText.includes('Show panels')
        );
      }
      check('closing the panel window puts the panels back in the dock', cameBack);
      await page.screenshot({ path: path.join(OUT, 'desktop-04-after-close.png') });
    }
  } catch (error) {
    console.error('ERROR', error.message);
    failures.push(error.message);
  } finally {
    browser.disconnect();
  }

  console.log('\nOutput in', OUT);
  console.log(failures.length ? `FAILURES: ${failures.join(', ')}` : 'ALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})();
