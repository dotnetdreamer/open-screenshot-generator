// The Export dialog for Juniper, and the required iPhone size it adds for a project that lacks it.
//
//   export.png           Juniper (1206 x 2622, the required iPhone size) with every language and
//                        the optional large iPhone size ticked: the files it will write
//   export-missing.png   the same set changed to 1290 x 2796 through Canvas size, so it really
//                        lacks the required size: the dialog starts with 1206 x 2622 ticked,
//                        "Required for the medium display slot in App Store Connect"
//   publish-missing.png  an extra: the upload dialog for that project, which says it in a
//                        sentence and starts on the required size
//
//   node cap-export.cjs
const F = require('./flows-lib.cjs');
const A = require('./apple-mock.cjs');
const { sleep } = F;

async function waitFor(page, fn, timeout = 30000, ...args) {
  await page.waitForFunction(fn, { timeout, polling: 300 }, ...args);
}

async function park(page) {
  await page.mouse.move(1430, 880);
  await sleep(300);
}

const EXPORT_DIALOG = `[...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Export screenshots'))`;

async function clickId(page, id) {
  await F.clickWhere(page, (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
  await sleep(400);
}

async function openExport(page) {
  await F.lib.clickMenuItem(page, 'Export', 'Artboards as images');
  await waitFor(page, () => !!document.querySelector('#export-as-is'), 20000);
  await sleep(800);
}

async function closeDialogs(page) {
  await page.keyboard.press('Escape');
  await sleep(800);
}

const rowOf = (id) => `() => document.getElementById('${id}')?.closest('div.flex.items-start')`;

(async () => {
  const { page, close } = await F.openFlows({
    http: A.APPLE,
    storage: { [A.CREDENTIALS_KEY]: JSON.stringify(A.credentials()) },
  });
  try {
    await F.openTemplate(page, 'Droply Habits');
    await F.juniper.buildJuniper(page);
    await F.settle(page, 2000);
    await F.clearToasts(page);

    // Juniper as it is: every language, plus the optional large iPhone size.
    await openExport(page);
    await clickId(page, 'export-locale-all');
    await clickId(page, 'gen-ios-large');
    await waitFor(page, `/40 PNG files/.test((${EXPORT_DIALOG}).textContent)`, 10000);
    const fit = await F.cleanScroll(page, `() => ${EXPORT_DIALOG}`, { from: 0, prefer: 'low' });
    console.log('export dialog scroll', JSON.stringify(fit));
    await park(page);
    const exportRects = await F.measure(page, {
      dialog: `() => ${EXPORT_DIALOG}`,
      'current-size': rowOf('export-as-is'),
      'store-sizes': `() => [...(${EXPORT_DIALOG}).querySelectorAll('p')].find((p) => p.textContent.trim() === 'Additional App Store sizes')?.parentElement`,
      'large-iphone': rowOf('gen-ios-large'),
      languages: `() => [...(${EXPORT_DIALOG}).querySelectorAll('p')].find((p) => p.textContent.trim() === 'Languages')?.parentElement`,
      'file-count': `() => [...(${EXPORT_DIALOG}).querySelectorAll('p')].find((p) => /PNG files?$/.test(p.textContent.trim()))?.parentElement`,
      'export-button': `() => [...(${EXPORT_DIALOG}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export')`,
      'upload-instead': `() => [...(${EXPORT_DIALOG}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Upload to the store instead')`,
    });
    await F.shot(page, 'export.png');
    F.saveRects('export.png', exportRects);
    await closeDialogs(page);

    // The set at 6.9 inches through Canvas size, content scaled: it lacks the required size now.
    await F.clickWhere(page, () => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').startsWith('Canvas size:'));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await waitFor(page, () => !!document.getElementById('size-ios-6-9'), 15000);
    await clickId(page, 'size-ios-6-9');
    await F.clickWhere(page, () => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector('#size-ios-6-9'));
      const b = dialog && [...dialog.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Apply' && !x.disabled);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await waitFor(page, () => !document.getElementById('size-ios-6-9'), 15000);
    const boards = await F.juniper.mcp(page, 'list_artboards', {});
    const list = Array.isArray(boards) ? boards : boards.artboards || [];
    console.log('sizes now', JSON.stringify(list.map((b) => `${b.width}x${b.height}`)));
    await F.settle(page, 1500);
    await F.clearToasts(page);

    await openExport(page);
    const required = await page.evaluate(() => document.getElementById('gen-ios')?.getAttribute('data-state'));
    console.log('required size ticked:', required);
    const fit2 = await F.cleanScroll(page, `() => ${EXPORT_DIALOG}`, { from: 0, prefer: 'low' });
    console.log('export dialog scroll', JSON.stringify(fit2));
    await park(page);
    const missingRects = await F.measure(page, {
      dialog: `() => ${EXPORT_DIALOG}`,
      'current-size': rowOf('export-as-is'),
      'required-size': rowOf('gen-ios'),
      'store-sizes': `() => [...(${EXPORT_DIALOG}).querySelectorAll('p')].find((p) => p.textContent.trim() === 'Additional App Store sizes')?.parentElement`,
      'file-count': `() => [...(${EXPORT_DIALOG}).querySelectorAll('p')].find((p) => /PNG files?$/.test(p.textContent.trim()))?.parentElement`,
      'export-button': `() => [...(${EXPORT_DIALOG}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export')`,
    });
    await F.shot(page, 'export-missing.png');
    F.saveRects('export-missing.png', missingRects);
    await closeDialogs(page);

    // The upload dialog says it in a sentence, and starts on the required size.
    await F.lib.clickMenuItem(page, 'Save this project, or upload it to a store', 'To App Store Connect or Google Play');
    await waitFor(page, `!!${A.DIALOG}`, 20000);
    await waitFor(page, `(${A.DIALOG}).textContent.includes('Juniper: Habit Tracker') && (${A.DIALOG}).textContent.includes('en-US')`, 30000);
    await sleep(800);
    // The sentence in the middle of the dialog's scroll area, edges between lines.
    const SCROLLER = `() => (${A.DIALOG}).querySelector('div.overflow-y-auto')`;
    const target = await page.evaluate(`(() => {
      const box = (${SCROLLER})();
      const line = [...box.querySelectorAll('p')].find((p) => /needs one iPhone set/.test(p.textContent));
      const r = line.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return Math.max(0, box.scrollTop + (r.top - b.top) - box.clientHeight / 2);
    })()`);
    const fit3 = await F.cleanScroll(page, SCROLLER, { from: Math.max(0, target - 160), to: target + 160, near: target });
    console.log('upload dialog scroll', JSON.stringify(fit3));
    await A.maskKey(page);
    await park(page);
    const publishMissingRects = await F.measure(page, {
      dialog: `() => ${A.DIALOG}`,
      'required-size-note': `() => [...(${A.DIALOG}).querySelectorAll('p')].find((p) => /needs one iPhone set/.test(p.textContent))`,
      size: `() => [...(${A.DIALOG}).querySelectorAll('h3')].find((h) => h.textContent.trim() === 'What gets uploaded')?.parentElement`,
      'upload-button': `() => [...(${A.DIALOG}).querySelectorAll('button')].find((b) => /^Upload\\b/.test(b.textContent.trim()))`,
    });
    await F.shot(page, 'publish-missing.png');
    F.saveRects('publish-missing.png', publishMissingRects);
  } catch (e) {
    console.error(e);
    await F.shot(page, '_error-export.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
