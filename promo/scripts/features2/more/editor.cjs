// The montage features on Juniper, signed in, desktop look:
//   tabs.png, outline.png, bg-photo.png, versions.png, save.png,
//   together-menu.png, together.png, discover.png, save-storage.png
//   STEPS=tabs,outline node editor.cjs   runs a subset (the build always runs)
const fs = require('fs');
const path = require('path');
const R = require('./rig.cjs');
const S = require('./steps.cjs');
const { buildJuniper, mcp } = require(path.join(R.CAP, 'juniper.cjs'));
const { feedPosts } = require('./posts.cjs');

const STEPS = process.env.STEPS ? process.env.STEPS.split(',') : null;
const want = (name) => !STEPS || STEPS.includes(name);
const DEBUG = path.join(__dirname, 'explore');
const SKY = process.env.SKY || 'somnia-sleep-sky-4.png';
const BG_BOARD = process.env.BG_BOARD || 'tpl_dr_ab1';
const OTHERS = [
  { card: 'Cinevault', name: 'Cinevault' },
  { card: 'Kassa Money', name: 'Kassa Money' },
  { card: 'Somnia Sleep', name: 'Somnia Sleep' },
];
const VERSIONS = [
  { label: 'Green headlines', ago: 2 * 24 * 60 + 70 },
  { label: 'Before translations', ago: 5 * 60 + 20 },
  { label: 'Launch set', ago: 12 },
];

const activeTabText = () => {
  const t = document.querySelector('[data-project-tabs] [role="tab"][aria-selected="true"]');
  return t ? (t.textContent || '').trim() : '';
};

async function waitImages(page) {
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])))
  );
  await R.sleep(1200);
}

async function clean(page) {
  await R.dismissToasts(page);
  await S.parkMouse(page);
  await R.sleep(600);
  const h = (await R.hazards(page)).filter((x) => !/^pulse .* 8x8/.test(x));
  if (h.length) console.log('  hazards:', h);
  return h;
}

/** The + in the tab strip, then a template card out of the start screen. */
async function openTemplateInNewTab(page, card, name) {
  const before = page.url();
  await R.clickPick(page, () => document.querySelector('[data-project-tabs] button[aria-label="New tab"]'));
  await page.waitForFunction(
    () => [...document.querySelectorAll('[role="dialog"] [role="tab"]')].some((t) => (t.textContent || '').includes('App Screenshots')),
    { timeout: 30000 }
  );
  await R.sleep(800);
  await R.lib.clickTab(page, 'App Screenshots');
  const CARDS = '[role="dialog"] [role="tabpanel"][data-state="active"] .cursor-pointer';
  await page.waitForFunction(
    (sel, t) => [...document.querySelectorAll(sel)].some((c) => (c.textContent || '').includes(t)),
    { timeout: 60000, polling: 500 },
    CARDS,
    card
  );
  await page.evaluate((sel, t) => [...document.querySelectorAll(sel)].find((c) => (c.textContent || '').includes(t)).click(), CARDS, card);
  await page.waitForFunction((before) => location.href !== before, { timeout: 30000, polling: 300 }, before);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 30000, polling: 300 }).catch(() => {});
  await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 2", { timeout: 60000, polling: 500 });
  await R.capLib.settle(page, 2000);
  await S.renameProject(page, name);
  // One real edit, so the tab is a project and not a preview of a template.
  const listed = await mcp(page, 'list_artboards', {});
  const boards = Array.isArray(listed) ? listed : listed.artboards || listed.items || [];
  if (boards[0]) await mcp(page, 'update_artboard', { artboardId: boards[0].id, name: boards[0].name + ' ' });
  if (boards[0]) await mcp(page, 'update_artboard', { artboardId: boards[0].id, name: boards[0].name });
  await R.sleep(800);
  await R.dismissToasts(page);
  console.log('opened', name, '->', await page.evaluate(activeTabText));
}

async function switchToTab(page, name) {
  await R.clickPick(
    page,
    (name) => [...document.querySelectorAll('[data-project-tabs] [role="tab"]')].find((t) => (t.textContent || '').trim() === name),
    name
  );
  await page.waitForFunction(
    (name) => {
      const t = document.querySelector('[data-project-tabs] [role="tab"][aria-selected="true"]');
      return t && (t.textContent || '').trim() === name;
    },
    { timeout: 30000 },
    name
  );
  await R.capLib.settle(page, 2500);
}

async function saveNamedVersion(page, label) {
  await R.clickPick(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Save this state' && b.offsetParent));
  await page.waitForFunction(() => document.activeElement && document.activeElement.placeholder === 'Name this version', { timeout: 10000 });
  await page.evaluate((label) => {
    const input = document.activeElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, label);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, label);
  await R.sleep(200);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (label) => [...document.querySelectorAll('li span')].some((s) => (s.textContent || '').trim() === label),
    { timeout: 20000 },
    label
  );
  await R.sleep(700);
}

/** Move named versions back in time, in IndexedDB, so the list reads like a week of work. */
async function ageVersions(page, versions) {
  return page.evaluate(
    (versions) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('ProjectDatabase');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('projectVersions', 'readwrite');
          const store = tx.objectStore('projectVersions');
          const seen = [];
          store.openCursor().onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            const row = cursor.value;
            const hit = versions.find((v) => v.label === row.label);
            seen.push([row.label, row.kind]);
            if (hit) {
              row.createdAt = new Date(Date.now() - hit.ago * 60000);
              cursor.update(row);
            }
            cursor.continue();
          };
          tx.oncomplete = () => {
            db.close();
            resolve(seen);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    versions
  );
}

/** Scroll the properties panel so an element sits near a fraction of its height. */
async function scrollPanelTo(page, selector, frac = 0.35) {
  await page.evaluate(
    (selector, frac) => {
      const target = document.querySelector(selector);
      if (!target) return false;
      let el = target.parentElement;
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) break;
        el = el.parentElement;
      }
      if (!el || el === document.body) return false;
      const box = el.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      el.scrollTop += t.top - (box.top + box.height * frac);
      return true;
    },
    selector,
    frac
  );
  await R.sleep(700);
}

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
    /**
     * Select the second headline, then rest the pointer on the second board's
     * phone. The point has to be on Maya's own canvas: her right dock covers
     * the third board in a window this wide.
     */
    async act() {
      await pageB.bringToFront().catch(() => {});
      const head = await R.centerOf(pageB, () => document.querySelector('[data-element-id="tpl_dr_ab2_headline"]'));
      if (head) await pageB.mouse.click(head.x, head.y);
      await R.sleep(600);
      const point = async () => {
        const board = await R.rectOf(pageB, () => document.querySelector('[data-artboard-dom-id="tpl_dr_ab2"]'));
        if (!board) return;
        const tx = board.x + board.w * 0.64;
        const ty = board.y + board.h * 0.34;
        for (let i = 0; i <= 12; i++) {
          await pageB.mouse.move(tx - 96 + i * 8, ty - 48 + i * 4);
          await R.sleep(70);
        }
      };
      await point();
      await page.bringToFront().catch(() => {});
      await R.sleep(900);
      const cursors = await page.evaluate(() => document.querySelectorAll('[data-collab-cursor]').length);
      if (!cursors) {
        // Moved again with this tab in front: the other tab still takes input.
        await point();
        await R.sleep(900);
      }
    },
    async close() {
      await pageB.close().catch(() => {});
    },
  };
}

(async () => {
  const { browser, page, backend } = await R.openRig({ storage: R.signedInStorage(), posts: feedPosts() });
  const rects = {};
  const shotsTaken = [];
  const take = async (file, rectFns, before) => {
    const h = await clean(page);
    if (before) await before();
    const r = {};
    for (const [k, fn] of Object.entries(rectFns || {})) r[k] = await fn();
    rects[file] = r;
    await R.shot(page, file);
    shotsTaken.push(file + (h.length ? ' (hazards: ' + h.join('; ') + ')' : ''));
  };
  try {
    await R.capLib.openTemplate(page, 'Droply Habits');
    await buildJuniper(page, { languages: true });
    await R.capLib.settle(page, 2000);
    await R.dismissToasts(page);
    const juniperUrl = page.url();
    console.log('juniper', juniperUrl);

    // ---- versions, saved now, aged later -----------------------------------
    if (want('versions')) {
      await S.dockTab(page, 'Versions');
      for (const v of VERSIONS) await saveNamedVersion(page, v.label);
      await S.dockTab(page, 'Properties');
    }

    // ---- three more projects in tabs ----------------------------------------
    if (want('tabs') || want('versions') || want('discover')) {
      for (const other of OTHERS) await openTemplateInNewTab(page, other.card, other.name);
      if (want('versions')) console.log('versions in db', JSON.stringify(await ageVersions(page, VERSIONS)));
      await switchToTab(page, 'Juniper');
      await R.dismissToasts(page);
    }

    // ---- tabs.png --------------------------------------------------------------
    if (want('tabs')) {
      await S.fitView(page, { frac: 0.97 });
      await waitImages(page);
      await take('tabs.png', {
        tabStrip: () => R.rectOf(page, () => document.querySelector('[data-project-tabs]')),
        juniperTab: () => R.rectOf(page, () => [...document.querySelectorAll('[data-project-tabs] [role="tab"]')].find((t) => (t.textContent || '').trim() === 'Juniper')),
        newTabButton: () => R.rectOf(page, () => document.querySelector('[data-project-tabs] button[aria-label="New tab"]')),
      });
    }

    // ---- outline.png -----------------------------------------------------------
    if (want('outline')) {
      const art = await mcp(page, 'get_artboard', { artboardId: 'tpl_dr_ab1' });
      const head = (art.elements || []).find((e) => e.id === 'tpl_dr_ab1_headline');
      const fs0 = head ? head.fontSize : 30;
      const width = Math.round(fs0 * 0.09 * 2) / 2;
      console.log('headline fontSize', fs0, 'outline', width);
      await mcp(page, 'update_element', { artboardId: 'tpl_dr_ab1', elementId: 'tpl_dr_ab1_headline', outlineColor: '#16231C', outlineWidth: width });
      await R.sleep(800);
      await S.resetZoom(page);
      await S.fitView(page, { boardIds: ['tpl_dr_ab1'], frac: 0.98 });
      await S.selectElement(page, 'tpl_dr_ab1_headline');
      await page.waitForSelector('#textOutlineColor', { timeout: 15000 });
      await scrollPanelTo(page, '#textOutlineColor', 0.45);
      await take('outline.png', {
        headline: () => R.rectOf(page, () => document.querySelector('[data-element-id="tpl_dr_ab1_headline"]')),
        outlineControl: () => R.rectOf(page, () => document.querySelector('#textOutlineColor')?.closest('.space-y-2')),
        outlineWidth: () => R.rectOf(page, () => document.querySelector('#textOutlineWidth')),
      });
      await page.keyboard.press('Escape');
      await R.sleep(500);
    }

    // ---- bg-photo.png ----------------------------------------------------------
    if (want('bgphoto')) {
      await S.resetZoom(page);
      await S.fitView(page, { boardIds: [BG_BOARD], frac: 0.98 });
      // The board itself, not an element on it.
      await page.keyboard.press('Escape');
      await R.sleep(300);
      await S.selectBoardBackground(page, BG_BOARD, 0.9, 0.04);
      await page.waitForFunction(() => [...document.querySelectorAll('label')].some((l) => (l.textContent || '').trim() === 'Background Image' && l.offsetParent), { timeout: 15000 });
      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 15000 }),
        R.clickPick(page, () => {
          const label = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim() === 'Background Image' && l.offsetParent);
          return label && [...label.parentElement.querySelectorAll('button')].find((b) => /Upload Image|Replace/.test(b.textContent || ''));
        }),
      ]);
      await chooser.accept([path.join(R.REPO, 'public', 'data', 'projects', SKY)]);
      await page.waitForSelector('#bgImageTint', { timeout: 20000 });
      await R.sleep(1500);
      await page.evaluate(() => {
        const input = document.querySelector('#bgImageTint');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, '#2d6a4f');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await R.sleep(1500);
      // Strength up to about half, with the slider's own keys.
      const thumb = await R.centerOf(page, () => document.querySelector('#bgImageTintStrength [role="slider"]') || document.querySelector('#bgImageTintStrength'));
      if (thumb) {
        await page.focus('#bgImageTintStrength [role="slider"]').catch(() => {});
        for (let i = 0; i < Number(process.env.TINT_STEPS || 10); i++) {
          await page.keyboard.press('ArrowRight');
          await R.sleep(30);
        }
        await R.sleep(1200);
      }
      await scrollPanelTo(page, '#bgImageFit', 0.2);
      await waitImages(page);
      await take('bg-photo.png', {
        board: () => R.rectOf(page, (id) => document.querySelector(`[data-artboard-dom-id="${id}"]`), BG_BOARD),
        tintControl: () => R.rectOf(page, () => document.querySelector('#bgImageTint')?.closest('.space-y-1')),
        backgroundImage: () =>
          R.rectOf(page, () => {
            const label = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim() === 'Background Image' && l.offsetParent);
            return label && label.parentElement;
          }),
      });
    }

    // ---- versions.png ----------------------------------------------------------
    if (want('versions')) {
      await page.keyboard.press('Escape');
      await S.resetZoom(page);
      await S.fitView(page, { frac: 0.97 });
      await S.dockTab(page, 'Versions');
      await R.sleep(1200);
      // Only the named ones: the automatic checkpoints are deleted from their rows.
      for (let i = 0; i < 12; i++) {
        const gone = await page.evaluate((names) => {
          const row = [...document.querySelectorAll('li')].find((li) => {
            const label = li.querySelector('span span')?.textContent?.trim();
            return label && !names.includes(label) && li.querySelector('button[title="Delete this version"]');
          });
          if (!row) return false;
          row.querySelector('button[title="Delete this version"]').click();
          return true;
        }, VERSIONS.map((v) => v.label));
        if (!gone) break;
        await R.sleep(900);
      }
      await R.sleep(800);
      await take('versions.png', {
        panel: () => R.rectOf(page, () => {
          const head = [...document.querySelectorAll('span')].find((s) => (s.textContent || '').trim() === 'Versions' && s.offsetParent && s.className.includes('font-semibold'));
          return head && head.closest('.flex-col');
        }),
        newest: () => R.rectOf(page, () => [...document.querySelectorAll('li')].find((li) => (li.textContent || '').includes('Launch set'))),
        saveThisState: () => R.rectOf(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Save this state' && b.offsetParent)),
      });
      await S.dockTab(page, 'Properties');
    }

    // ---- save.png --------------------------------------------------------------
    if (want('save')) {
      await S.openMenu(page, 'Save this project, or upload it to a store');
      await take('save.png', {
        menu: () => R.rectOf(page, () => document.querySelector('[role="menu"]')),
        ownStorage: () => R.rectOf(page, () => [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent || '').includes('To your own storage'))),
        cloud: () => R.rectOf(page, () => [...document.querySelectorAll('[role="menuitem"]')].find((i) => /cloud/i.test(i.textContent || ''))),
      });
      await S.closeMenus(page);
    }

    // ---- discover.png -----------------------------------------------------------
    if (want('discover')) {
      await S.create(page, 'Start from a template');
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] [role="tab"]')].some((t) => (t.textContent || '').includes('Community')), { timeout: 20000 });
      await R.lib.clickTab(page, 'Community');
      await R.sleep(3000);
      await waitImages(page);
      await take('discover.png', {
        feed: () => R.rectOf(page, () => {
          const h = [...document.querySelectorAll('h3')].find((x) => (x.textContent || '').includes('Trending in the community'));
          return h && h.closest('.overflow-y-auto');
        }),
        firstPost: () => R.rectOf(page, () => document.querySelector('[role="dialog"] [role="tabpanel"][data-state="active"] .grid > *')),
        browseAll: () => R.rectOf(page, () => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith('Browse all'))),
        communityTab: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"] [role="tab"]')].find((t) => (t.textContent || '').includes('Community'))),
      });
      await page.keyboard.press('Escape');
      await R.sleep(800);
    }

    // ---- together ---------------------------------------------------------------
    if (want('together')) {
      await S.openMenu(page, 'Share this project');
      await take('together-menu.png', {
        menu: () => R.rectOf(page, () => document.querySelector('[role="menu"]')),
        menuItem: () => R.rectOf(page, () => [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent || '').includes('Edit together'))),
      });
      await R.clickPick(page, () => [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent || '').includes('Edit together')));
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('Edit together')), { timeout: 15000 });
      await R.sleep(800);
      const createBtn = () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Create the invite link|Start the session/.test(b.textContent || ''));
      if (await page.evaluate(`!!(${createBtn.toString()})()`)) {
        await R.clickPick(page, createBtn);
      }
      await page.waitForFunction(
        () => [...document.querySelectorAll('[role="dialog"]')].some((d) => /In the room/.test(d.textContent || '')),
        { timeout: 45000, polling: 500 }
      );
      await R.sleep(2000);

      // A second person, in a second tab of the same browser: the room meets
      // over the browser's own channel between tabs, so nothing leaves the machine.
      let peer = null;
      if (process.env.PEER !== '0') {
        try {
          peer = await addPeer(browser, page, backend);
        } catch (error) {
          console.log('peer did not join:', String((error && error.message) || error).slice(0, 300));
        }
      }

      // The link is a key to the project: shown, but never the real one, and
      // pinned so a re-render cannot put the real one back before the shutter.
      const mask = async () => {
        await page.evaluate(() => {
          const FAKE = 'https://editor.openscrgen.app/?collab=xxxxxxxxxxxxxxxxxxxxxx#k=xxxxxxxxxxxxxxxxxxxxxx';
          const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          for (const input of document.querySelectorAll('input')) {
            const v = proto.get.call(input);
            if (/collab=/.test(v) && v !== FAKE) {
              proto.set.call(input, FAKE);
              Object.defineProperty(input, 'value', { configurable: true, get: () => FAKE, set: () => {} });
            }
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const n = walker.currentNode;
            if (/collab=|#k=/.test(n.nodeValue || '')) n.nodeValue = FAKE;
          }
        });
        await R.sleep(300);
        const leak = await page.evaluate(() => {
          const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          return [...document.querySelectorAll('input')].map((i) => proto.get.call(i)).filter((v) => /collab=(?!x{22})/.test(v));
        });
        if (leak.length) throw new Error('invite link still on screen');
      };
      await take(
        'together.png',
        {
          dialog: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Edit together'))),
          linkPanel: () =>
            R.rectOf(page, () => {
              const input = [...document.querySelectorAll('[role="dialog"] input')].find((i) => /collab=/.test(i.value));
              return input && input.parentElement;
            }),
          room: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"] .rounded-lg.border')].find((d) => /In the room|Connecting/.test(d.textContent || ''))),
          toolbarFaces: () => R.rectOf(page, () => [...document.querySelectorAll('button')].find((b) => /Editing together with|Nobody else is here yet/.test(b.title || ''))),
        },
        mask
      );
      await page.keyboard.press('Escape');
      await R.sleep(1000);

      // The canvas while the other person works: their pointer and their selection.
      if (peer) {
        await S.resetZoom(page);
        await S.fitView(page, { boardIds: ['tpl_dr_ab2', 'tpl_dr_ab3'], frac: 0.98 });
        await peer.act();
        await R.sleep(2500);
        console.log('peer marks', await page.evaluate(() => [document.querySelectorAll('[data-collab-cursor]').length, document.querySelectorAll('[data-collab-selection]').length]));
        await take(
          'together-canvas.png',
          {
            peerCursor: () => R.rectOf(page, () => document.querySelector('[data-collab-cursor]')),
            peerSelection: () => R.rectOf(page, () => document.querySelector('[data-collab-selection]')),
            toolbarFaces: () => R.rectOf(page, () => [...document.querySelectorAll('button')].find((b) => /Editing together with|Nobody else is here yet/.test(b.title || ''))),
          },
          mask
        );
        await peer.close();
        await page.bringToFront().catch(() => {});
      }
    }

    // ---- save-storage.png: the storage choice, which only a signed-out person sees
    if (want('storage')) {
      // A fresh load first: it ends any live session, so nobody else's marks
      // are left on the canvas, and it puts this tab back in front.
      await page.bringToFront().catch(() => {});
      await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction("document.querySelectorAll('[data-element-id]').length > 3", { timeout: 60000, polling: 500 });
      await R.capLib.settle(page, 4000);
      await R.lib.dismissTipsDialog(page, { timeout: 4000 }).catch(() => {});
      await R.dismissToasts(page);
      // Clicked until the dialog answers: a click while the page is still
      // wiring itself up after the load can land on a button with no handler yet.
      let opened = false;
      for (let i = 0; i < 4 && !opened; i++) {
        await R.clickPick(page, () => [...document.querySelectorAll('button')].find((b) => /^Account\b/.test(b.getAttribute('aria-label') || '') && b.offsetParent));
        opened = await page
          .waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /Your account|Save to your own storage/.test(d.textContent || '')), { timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (!opened) await S.parkMouse(page);
      }
      if (!opened) throw new Error('the account dialog did not open');
      await R.sleep(1000);
      const signOut = () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent || '').trim() === 'Sign out');
      if (await page.evaluate(`!!(${signOut.toString()})()`)) {
        await R.clickPick(page, signOut);
        await R.sleep(1500);
        // A confirm step, if there is one.
        const confirm = () => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => /Sign out/.test(b.textContent || ''));
        if (await page.evaluate(`!!(${confirm.toString()})()`)) {
          await R.clickPick(page, confirm);
          await R.sleep(1500);
        }
      }
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => /Continue with GitHub/.test(b.textContent || '')), { timeout: 15000 });
      await R.sleep(800);
      await take('save-storage.png', {
        dialog: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"]')].find((d) => /Save to your own storage/.test(d.textContent || ''))),
        google: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Continue with Google/.test(b.textContent || ''))),
        github: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Continue with GitHub/.test(b.textContent || ''))),
      });
    }

    for (const [file, value] of Object.entries(rects)) R.saveRects(file, value);
    console.log('\ntaken:\n  ' + shotsTaken.join('\n  '));
  } catch (e) {
    console.error(e);
    fs.mkdirSync(DEBUG, { recursive: true });
    await page.screenshot({ path: path.join(DEBUG, 'editor-error.png') });
    for (const [file, value] of Object.entries(rects)) R.saveRects(file, value);
    process.exitCode = 1;
  } finally {
    await R.closeRig(browser);
  }
})();
