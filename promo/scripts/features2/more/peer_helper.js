const MAYA = { id: 'promo-maya', handle: 'mayachen', name: 'Maya Chen', followers: 64, isViewer: true };

/**
 * Maya joins Juniper's room from a second tab: her own sign-in (read only by
 * her tab), a copy of the project under its own id so the two tabs never want
 * the same project lock, and the invite the first tab handed out.
 */
async function addPeer(browser, page, backend) {
  const projectId = new URL(page.url()).searchParams.get('projectId');
  const room = await page.evaluate(
    (pid) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('ProjectDatabase');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['cloudLinks', 'projects'], 'readwrite');
          const out = {};
          tx.objectStore('cloudLinks').get(pid).onsuccess = (e) => {
            out.link = e.target.result || null;
          };
          const projects = tx.objectStore('projects');
          projects.get(pid).onsuccess = (e) => {
            const row = e.target.result;
            if (row) {
              projects.put({ ...row, id: 'project_maya_juniper', name: 'Juniper', timestamp: new Date(Date.now() - 3 * 3600 * 1000) });
              out.copied = true;
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve({ slug: out.link && out.link.shareSlug, key: out.link && out.link.collabKey, copied: !!out.copied });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    projectId
  );
  if (!room.slug || !room.key || !room.copied) throw new Error('no room to join: ' + JSON.stringify({ slug: room.slug, key: room.key ? 'set' : null, copied: room.copied }));
  const pageB = await browser.newPage();
  await pageB.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const over = {
    'open-screenshot-generator.account': JSON.stringify({
      provider: 'google',
      accessToken: 'promo-maya-access',
      account: { id: MAYA.id, name: MAYA.name, email: 'maya@example.com' },
    }),
    'open-screenshot-generator.discover.session': JSON.stringify({ token: 'promo-maya-token', provider: 'google', accountId: MAYA.id, viewer: MAYA }),
    'open-screenshot-generator.collab.joined': JSON.stringify({ [room.slug]: 'project_maya_juniper' }),
  };
  await R.preparePage(pageB, {
    tauri: false,
    headless: false,
    theme: 'dark',
    storage: {},
    backend,
    pageStorageOverride: over,
    log: (line) => console.log('[maya] ' + line),
  });
  await pageB.goto(`${R.capLib.BASE}/?collab=${room.slug}#k=${room.key}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await R.lib.dismissTipsDialog(pageB, { timeout: 8000 }).catch(() => {});
  try {
    await pageB.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Editing together with|Nobody else is here yet/.test(b.title || '')), {
      timeout: 60000,
      polling: 500,
    });
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('Maya Chen')), {
      timeout: 30000,
      polling: 500,
    });
  } catch (error) {
    await pageB.screenshot({ path: require('path').join(__dirname, 'explore', 'maya-error.png') }).catch(() => {});
    await pageB.close().catch(() => {});
    throw error;
  }
  console.log('Maya is in the room');
  return {
    page: pageB,
    /** Select the second headline and rest the pointer over the third board. */
    async act() {
      await pageB.bringToFront().catch(() => {});
      const head = await R.centerOf(pageB, () => document.querySelector('[data-element-id="tpl_dr_ab2_headline"]'));
      if (head) await pageB.mouse.click(head.x, head.y);
      await R.sleep(600);
      const board = await R.rectOf(pageB, () => document.querySelector('[data-artboard-dom-id="tpl_dr_ab3"]'));
      if (board) {
        const tx = board.x + board.w * 0.58;
        const ty = board.y + board.h * 0.52;
        for (let i = 0; i <= 12; i++) {
          await pageB.mouse.move(tx - 120 + i * 10, ty - 60 + i * 5);
          await R.sleep(70);
        }
      }
      await page.bringToFront().catch(() => {});
      await R.sleep(800);
    },
    async close() {
      await pageB.close().catch(() => {});
    },
  };
}
