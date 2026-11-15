// The upload dialog: Juniper's five boards in four languages, sent to App Store Connect.
//
//   publish-ready.png      the dialog with a saved key, Juniper's app, version and listings,
//                          "Upload every language" ticked: Upload 20
//   publish-uploading.png  mid upload, the progress line and bar
//   publish-done.png       "20 screenshots uploaded to App Store Connect"
//
// App Store Connect answers through the IPC mock's http rules (apple-mock.cjs). Nothing reaches
// Apple. The key is a throwaway P-256 key made per run; its id and issuer are masked in the DOM.
//
//   node cap-publish.cjs
const F = require('./flows-lib.cjs');
const { APPLE, credentials, CREDENTIALS_KEY, DIALOG, maskKey } = require('./apple-mock.cjs');
const { sleep } = F;

async function waitFor(page, fn, timeout = 30000, ...args) {
  await page.waitForFunction(fn, { timeout, polling: 300 }, ...args);
}

async function park(page) {
  await page.mouse.move(1430, 880);
  await sleep(300);
}

const SCROLLER = `() => (${DIALOG}).querySelector('div.overflow-y-auto')`;

const RECTS = {
  dialog: `() => ${DIALOG}`,
  'upload-button': `() => [...(${DIALOG}).querySelectorAll('button')].find((b) => /^Upload\\b/.test(b.textContent.trim()) && !/every language/.test(b.textContent))`,
  destination: `() => [...(${DIALOG}).querySelectorAll('h3')].find((h) => h.textContent.trim() === 'Where it goes')?.parentElement?.parentElement`,
  'all-languages': `() => (${DIALOG}).querySelector('#publish-all-languages')?.closest('div.rounded-md')`,
  boards: `() => [...(${DIALOG}).querySelectorAll('ul')].find((u) => u.querySelector('[id^="publish-tpl_"]'))`,
  'footer-status': `() => (${DIALOG}).querySelector('div[class*="justify-between"] > p')`,
};

(async () => {
  const { page, close } = await F.openFlows({
    http: APPLE,
    storage: { [CREDENTIALS_KEY]: JSON.stringify(credentials()) },
  });
  try {
    await F.openTemplate(page, 'Droply Habits');
    await F.juniper.buildJuniper(page);
    await F.settle(page, 2000);
    await F.clearToasts(page);

    await F.lib.clickMenuItem(page, 'Save this project, or upload it to a store', 'To App Store Connect or Google Play');
    await waitFor(page, `!!${DIALOG}`, 20000);
    // App, version and listing come from App Store Connect.
    await waitFor(page, `(${DIALOG}).textContent.includes('Juniper: Habit Tracker') && (${DIALOG}).textContent.includes('1.3 (prepare for submission)') && (${DIALOG}).textContent.includes('en-US')`, 30000);
    await F.clickWhere(page, () => {
      const box = document.querySelector('#publish-all-languages');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await waitFor(page, `/Upload 20/.test((${DIALOG}).textContent)`, 20000);
    await sleep(800);
    await maskKey(page);
    await park(page);
    const readyRects = await F.measure(page, RECTS, { clip: SCROLLER });
    await F.shot(page, 'publish-ready.png');
    F.saveRects('publish-ready.png', readyRects);

    // Upload, held at Apple's storage after a few files.
    await page.evaluate(() => {
      window.__E2E_TAURI__.config.http.find((rule) => /blobstore/.test(rule.match)).hold = true;
    });
    await F.clickWhere(page, (sel) => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Upload to the store'));
      const b = [...dialog.querySelectorAll('button')].find((x) => /^Upload 20$/.test(x.textContent.trim()));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const STOP_AT = Number(process.env.STOP_AT || 8);
    for (let n = 0; n < 40; n++) {
      await waitFor(page, () => window.__E2E_TAURI__.httpHeld.length > 0, 180000);
      const sent = await page.evaluate(() => window.__E2E_TAURI__.httpRequests.filter((r) => r.method === 'PUT').length);
      if (sent >= STOP_AT) break;
      await page.evaluate(() => window.__E2E_TAURI__.releaseHttp());
      await sleep(150);
    }
    await sleep(1000);
    await maskKey(page);
    await park(page);
    console.log('progress', await page.evaluate(() => document.querySelector('[role="progressbar"]')?.parentElement?.textContent));
    const uploadingRects = await F.measure(
      page,
      {
        ...RECTS,
        progress: `() => (${DIALOG}).querySelector('[role="progressbar"]')?.parentElement`,
        'progress-bar': `() => (${DIALOG}).querySelector('[role="progressbar"]')`,
      },
      { clip: SCROLLER }
    );
    await F.shot(page, 'publish-uploading.png');
    F.saveRects('publish-uploading.png', uploadingRects);

    // The rest, Apple's processing, and the result.
    await page.evaluate(() => {
      window.__E2E_TAURI__.config.http.find((rule) => /blobstore/.test(rule.match)).hold = false;
      window.__E2E_TAURI__.releaseHttp();
    });
    await waitFor(page, `/uploaded to App Store Connect/.test((${DIALOG}).textContent)`, 180000);
    await sleep(800);
    await page.evaluate((sel) => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Upload to the store'));
      const done = [...dialog.querySelectorAll('p')].find((p) => /uploaded to App Store Connect/.test(p.textContent))?.parentElement;
      done?.scrollIntoView({ block: 'end' });
    });
    await sleep(600);
    await F.clearToasts(page);
    await maskKey(page);
    await park(page);
    const doneRects = await F.measure(page, {
      ...RECTS,
      'done-message': `() => [...(${DIALOG}).querySelectorAll('p')].find((p) => /uploaded to App Store Connect/.test(p.textContent))?.parentElement`,
      'open-app-store-connect': `() => [...(${DIALOG}).querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Open App Store Connect'))`,
      'see-results-in-growth': `() => [...(${DIALOG}).querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('See results in Growth'))`,
    }, { clip: SCROLLER });
    await F.shot(page, 'publish-done.png');
    F.saveRects('publish-done.png', doneRects);
    const requests = await page.evaluate(() => window.__E2E_TAURI__.httpRequests.map((r) => r.method + ' ' + r.url));
    const counts = {};
    for (const r of requests) {
      const key = r.replace(/\?.*$/, '').replace(/loc-[a-z]+/, 'loc-*');
      counts[key] = (counts[key] || 0) + 1;
    }
    console.log('apple requests', JSON.stringify(counts, null, 1));
  } catch (e) {
    console.error(e);
    await F.shot(page, '_error-publish.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
