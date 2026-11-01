import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type BrowserContext, type Page } from '../fixtures/test';
import { DB_NAME, holdProjects, holdUndoStacks, put, readAll, readProjects } from '../fixtures/db';
import type { Editor } from '../helpers/editor';

/**
 * Project tabs: several projects open in one window, one of them on the canvas.
 *
 * The promise the strip makes is that leaving a tab loses nothing. Switching
 * parks the project with its undo history (src/lib/tabs/parking.ts) and coming
 * back restores it, so these tests edit, leave, come back and undo. A tab that
 * slept, was closed or moved to another window reads its project and its undo
 * stack back from IndexedDB (historyStore.ts), which is the other path they
 * cover: undo has to come back with it. A reload still starts undo over (rule
 * 28), which history-versions.spec.ts holds to.
 */

interface SeedProject {
  id: string;
  name: string;
  timestamp: Date;
  projectData: unknown[];
}

/** A one-board project with a single rectangle, coloured so a board shows whose it is. */
function seedProject(id: string, name: string, color: string): SeedProject {
  return {
    id,
    name,
    timestamp: new Date('2024-05-04T10:00:00.000Z'),
    projectData: [
      {
        id: `${id}_board`,
        name: `${name} board`,
        size: { width: 1024, height: 500 },
        backgroundColor: color,
        zoom: 1,
        position: { x: 50, y: 50 },
        elements: [
          {
            id: `${id}_rect`,
            type: 'shape',
            shapeType: 'rectangle',
            name: 'Seeded Rectangle',
            position: { x: 100, y: 120 },
            size: { width: 400, height: 200 },
            rotation: 0,
            scale: 1,
            fillColor: '#111827',
            strokeColor: '#000000',
            strokeWidth: 0,
          },
        ],
      },
    ],
  };
}

/** Like seedProject, with several artboards under the ids given. */
function seedBoards(id: string, name: string, color: string, boardIds: string[]): SeedProject {
  const [first] = seedProject(id, name, color).projectData as Array<Record<string, unknown>>;
  return {
    ...seedProject(id, name, color),
    projectData: boardIds.map((boardId, i) => ({
      ...first,
      id: boardId,
      name: `${name} board ${i + 1}`,
      elements: i === 0 ? first.elements : [],
    })),
  };
}

const strip = (page: Page) => page.locator('[data-project-tabs]');
const tabs = (page: Page) => strip(page).getByRole('tab');
const tabNamed = (page: Page, name: string) => tabs(page).filter({ hasText: name });
const activeTab = (page: Page) => strip(page).locator('[role="tab"][aria-selected="true"]');

/** Seeding needs the app's own schema in place first. */
async function waitForProjectStore(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open('ProjectDatabase');
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                const has = open.result.objectStoreNames.contains('projects');
                open.result.close();
                resolve(has);
              };
            })
        ),
      { timeout: 30_000 }
    )
    .toBe(true);
}

/** Two stored projects, with the first one open. */
async function openAlphaWithBetaStored(app: Editor, page: Page): Promise<void> {
  await expect(app.startDialog).toBeVisible();
  await waitForProjectStore(page);
  await put(page, 'projects', seedProject('tabs_alpha', 'Alpha', '#DBEAFE'));
  await put(page, 'projects', seedProject('tabs_beta', 'Beta', '#FEE2E2'));
  await app.goto('/?projectId=tabs_alpha');
  await expect(activeTab(page)).toContainText('Alpha');
  await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
}

/** The + button, then a stored project out of Recent projects. */
async function openInNewTab(app: Editor, page: Page, name: string, id: string): Promise<void> {
  await strip(page).getByRole('button', { name: 'New tab', exact: true }).click();
  await app.waitForStartDialogReady();
  await app.startDialog.getByText(name, { exact: true }).click();
  await expect(app.startDialog).toBeHidden();
  await expect(activeTab(page)).toContainText(name);
  await expect(app.board(0).locator(`[data-element-id="${id}_rect"]`)).toBeVisible();
}

async function openBetaInNewTab(app: Editor, page: Page): Promise<void> {
  await openInNewTab(app, page, 'Beta', 'tabs_beta');
}

/** Alpha on the canvas, and Beta in a tab that has not been read since a reload. */
async function alphaWithBetaAsleep(app: Editor, page: Page): Promise<void> {
  await openAlphaWithBetaStored(app, page);
  await openBetaInNewTab(app, page);
  await tabNamed(page, 'Alpha').click();
  await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
  // Let the session write land (it waits for the strip to sit still).
  await page.waitForTimeout(800);
  await app.goto(page.url());
  await expect(tabs(page)).toHaveCount(2);
  await expect(activeTab(page)).toContainText('Alpha');
  await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
}

/**
 * The tab bus as another editor window reaches it: a BroadcastChannel on the
 * web, and on the desktop the mocked Tauri event bus, which carries an app
 * event to every window the same way (fixtures/tauri-runtime.ts).
 */
const tabBus = (isDesktop: boolean) =>
  isDesktop ? { channel: '__e2e_tauri_event_bus__', event: 'abs-tabs-bus' } : { channel: 'abs-tabs-bus', event: null };

/** Send this window what another editor window would. */
async function postOnTabBus(page: Page, isDesktop: boolean, message: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ bus, message }) => {
      const channel = new BroadcastChannel(bus.channel);
      channel.postMessage(bus.event ? { event: bus.event, payload: message } : message);
      channel.close();
    },
    { bus: tabBus(isDesktop), message }
  );
}

/** This window's id on the tab bus, asked with a roll call, the way another window asks. */
async function editorWindowId(page: Page, isDesktop: boolean): Promise<string> {
  return page.evaluate(
    (bus) =>
      new Promise<string>((resolve) => {
        const channel = new BroadcastChannel(bus.channel);
        channel.onmessage = (event: MessageEvent) => {
          const message = (bus.event ? (event.data?.event === bus.event ? event.data.payload : null) : event.data) as {
            type?: string;
            to?: string;
            from?: string;
          } | null;
          if (message?.type !== 'here' || message.to !== 'test-window' || !message.from) return;
          channel.close();
          resolve(message.from);
        };
        const rollCall = { type: 'roll-call', from: 'test-window' };
        channel.postMessage(bus.event ? { event: bus.event, payload: rollCall } : rollCall);
      }),
    tabBus(isDesktop)
  );
}

/**
 * Whether this browser can keep a Blob in IndexedDB, which a version is.
 * Playwright's WebKit cannot (history-versions.spec.ts has the whole story).
 */
function canStoreBlobsInIndexedDb(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const name = 'e2e-blob-probe';
        const finish = (value: boolean, db?: IDBDatabase) => {
          db?.close();
          indexedDB.deleteDatabase(name);
          resolve(value);
        };
        const open = indexedDB.open(name, 1);
        open.onerror = () => finish(false);
        open.onupgradeneeded = () => open.result.createObjectStore('probe');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('probe', 'readwrite');
          try {
            tx.objectStore('probe').put(new Blob(['probe']), 'key');
          } catch {
            finish(false, db);
            return;
          }
          tx.oncomplete = () => finish(true, db);
          tx.onerror = () => finish(false, db);
          tx.onabort = () => finish(false, db);
        };
      })
  );
}

/** Closing a tab with changes asks first: answer it. */
async function confirmClose(page: Page, title: string, button = 'Close tab'): Promise<void> {
  const dialog = page.getByRole('alertdialog').filter({ hasText: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Focus the canvas, then undo. */
async function undo(app: Editor, page: Page): Promise<void> {
  await app.board(0).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('ControlOrMeta+z');
}

/** The stored row of a project, once `ready` says it is the one expected. */
async function storedBoards(page: Page, id: string): Promise<Array<{ id: string; elements: Array<Record<string, unknown>>; localized?: Record<string, Record<string, Record<string, unknown>>> }>> {
  const row = (await readProjects(page)).find((project) => project.id === id);
  return (row?.projectData ?? []) as never;
}

/**
 * A real font file for a test to import: the Noto Sans that Next carries for
 * its social images. The suite runs offline and the repo keeps no font files.
 */
const NOTO_SANS_FILE = path.resolve('node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf');

/**
 * Store a font in the device's font table the way another window's import
 * does, behind this page's back: this page has not put it on itself.
 */
async function importFontInAnotherWindow(page: Page, family: string, file: string): Promise<void> {
  await page.evaluate(
    ({ dbName, family, base64 }) =>
      new Promise<void>((resolve, reject) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'font/ttf' });
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('fonts', 'readwrite');
          tx.objectStore('fonts').put({
            id: 'font_e2e_other_window',
            family,
            fileName: 'other-window.ttf',
            format: 'truetype',
            mimeType: 'font/ttf',
            size: blob.size,
            createdAt: new Date(),
            blob,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    { dbName: DB_NAME, family, base64: fs.readFileSync(file).toString('base64') }
  );
}

/**
 * The built-in families' stylesheet, kept from every page until `release`.
 * When it comes, it has a face for each of `families`, all drawn by the Noto
 * Sans file. The suite runs offline, so without this a page has no stylesheet.
 */
async function holdBuiltInFonts(context: BrowserContext, ...families: string[]): Promise<{ release: () => void }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cors = { 'access-control-allow-origin': '*' };
  const file = fs.readFileSync(NOTO_SANS_FILE);
  await context.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'font/ttf' }, body: file })
  );
  await context.route('https://fonts.googleapis.com/**', async (route) => {
    await released;
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/css' },
      body: families
        .map(
          (family) =>
            `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/e2e/face.ttf) format('truetype'); }`
        )
        .join('\n'),
    });
  });
  return { release };
}

/** Whether a face of `family` has finished loading on the page. */
function faceLoaded(page: Page, family: string): Promise<boolean> {
  return page.evaluate((family) => {
    let loaded = false;
    document.fonts.forEach((face) => {
      if (face.family.replace(/["']/g, '') === family && face.status === 'loaded') loaded = true;
    });
    return loaded;
  }, family);
}

/** A 1 by 1 PNG, the smallest picture a project can carry. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Sign this page in to GitHub gists, with one project saved there: `projectId`
 * as somebody saved it on another machine, with a rectangle of its own and a
 * picture. The gist API answers from here (the suite runs offline).
 */
async function signInToGistsWith(page: Page, context: BrowserContext, projectId: string, name: string): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'open-screenshot-generator.account',
      JSON.stringify({ provider: 'github', accessToken: 'e2e-token', account: { id: 'e2e-user', name: 'E2E Tester' } })
    );
  });
  const [board] = seedProject(projectId, name, '#000000').projectData as Array<Record<string, unknown>>;
  const [rect] = board.elements as Array<Record<string, unknown>>;
  const manifest = {
    formatVersion: 1,
    id: projectId,
    name,
    timestamp: '2024-05-04T10:00:00.000Z',
    projectData: [{ ...board, elements: [{ ...rect, id: `${projectId}_account_rect` }] }],
    media: [{ id: 'media_e2e_account', name: 'pixel.png', mimeType: 'image/png', size: 68, createdAt: '2024-05-04T10:00:00.000Z' }],
  };
  const summary = {
    id: 'gist_e2e',
    description: `${name} [open-screenshot-generator]#${projectId}`,
    updated_at: '2024-05-04T10:00:00Z',
    files: { 'project.json': { filename: 'project.json', size: 500 } },
  };
  const gist = {
    ...summary,
    files: {
      'project.json': { filename: 'project.json', content: JSON.stringify(manifest), truncated: false },
      'media-media_e2e_account.b64': { filename: 'media-media_e2e_account.b64', content: PIXEL_PNG, truncated: false },
    },
  };
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, accept, content-type, x-github-api-version',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE',
  };
  await context.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === '/gists') return json(url.searchParams.get('page') === '1' ? [summary] : []);
    if (url.pathname === '/gists/gist_e2e/commits') return json([{ version: 'e2e', committed_at: '2024-05-04T10:00:00Z' }]);
    if (url.pathname === '/gists/gist_e2e') return json(gist);
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
}

test.describe('project tabs', () => {
  test('a tab keeps its edits and its undo history while another project is open', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);

    await openBetaInNewTab(app, page);
    await expect(tabs(page)).toHaveCount(2);
    await expect(app.elementsOn(0)).toHaveCount(1);

    await tabNamed(page, 'Alpha').click();
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.elementsOn(0)).toHaveCount(2);

    // The rectangle added before the switch is still the last thing to undo.
    await app.board(0).click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(app.elementsOn(0)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(app.elementsOn(0)).toHaveCount(2);
  });

  test('switching to a parked tab reads nothing from storage', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);

    // With the project store held, any read would wait for as long as the
    // hold lasts. A parked tab comes back anyway, because it is in memory.
    const hold = await holdProjects(page);
    try {
      await tabNamed(page, 'Alpha').click();
      await expect(activeTab(page)).toContainText('Alpha');
      await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible({ timeout: 5_000 });
    } finally {
      await hold.release();
    }
  });

  test('closing a tab hands over to its neighbour, keeps the project, and can be undone', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);

    await tabNamed(page, 'Beta').getByRole('button', { name: 'Close Beta' }).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
    // A closed tab is not a deleted project.
    expect((await readProjects(page)).map((project) => project.id).sort()).toEqual(['tabs_alpha', 'tabs_beta']);

    await strip(page).getByRole('button', { name: 'All open projects' }).click();
    await page.getByRole('menuitem', { name: 'Beta' }).click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page)).toContainText('Beta');
    await expect(app.board(0).locator('[data-element-id="tabs_beta_rect"]')).toBeVisible();
  });

  test('the strip survives a reload, and a sleeping tab opens from storage', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);
    // Let the session write land (it waits for the strip to sit still).
    await page.waitForTimeout(600);

    await app.goto(page.url());
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page)).toContainText('Beta');

    await tabNamed(page, 'Alpha').click();
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
    await expect(page).toHaveURL(/projectId=tabs_alpha/);
  });

  test('a reload keeps the zoom the active tab was left at', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    const before = await app.zoomLevel();
    await app.zoomInButton.click();
    await app.zoomInButton.click();
    const zoomed = await app.zoomLevel();
    expect(zoomed).toBeGreaterThan(before);
    // The session write waits for the zoom to settle.
    await page.waitForTimeout(800);

    await app.goto(page.url());
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
    await expect.poll(() => app.zoomLevel()).toBe(zoomed);
  });

  test('a tab left for an hour sleeps, and wakes with its undo history', async ({ app, page }) => {
    // A fake clock from the first script on, so an hour can pass at once.
    await page.clock.install();
    await openAlphaWithBetaStored(app, page);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await openBetaInNewTab(app, page);

    // Not after a minute: the tab is still in memory.
    await page.clock.fastForward('01:00');
    const alphaChip = tabNamed(page, 'Alpha').locator('.opacity-60');
    await expect(alphaChip).toHaveCount(0);
    // After an hour it sleeps, which the strip shows on its chip.
    await page.clock.fastForward('01:01:00');
    await expect(alphaChip).toHaveCount(1);

    await tabNamed(page, 'Alpha').click();
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.elementsOn(0)).toHaveCount(2);
    // Read back from disk, the undo history included: the rectangle added
    // before it slept is still the last thing to undo.
    await undo(app, page);
    await expect(app.elementsOn(0)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(app.elementsOn(0)).toHaveCount(2);
  });

  test('a closed tab reopens with its undo history', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await openBetaInNewTab(app, page);

    await tabNamed(page, 'Alpha').getByRole('button', { name: 'Close Alpha' }).click();
    await confirmClose(page, 'Close Alpha?');
    await expect(tabs(page)).toHaveCount(1);
    await strip(page).getByRole('button', { name: 'All open projects' }).click();
    await page.getByRole('menuitem', { name: 'Alpha' }).click();
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await undo(app, page);
    await expect(app.elementsOn(0)).toHaveCount(1);
  });

  test('tabs closed together reopen with their undo history too', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await openBetaInNewTab(app, page);
    // The palette is still open on Basic.
    await app.addElement('Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    const reopen = async (name: string) => {
      await strip(page).getByRole('button', { name: 'All open projects' }).click();
      await page.getByRole('menuitem', { name }).click();
      await expect(activeTab(page)).toContainText(name);
      await expect(app.elementsOn(0)).toHaveCount(2);
    };

    // Beta closes from the canvas.
    await tabNamed(page, 'Alpha').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close tabs to the right' }).click();
    await confirmClose(page, 'Close Beta?');
    await expect(tabs(page)).toHaveCount(1);
    await reopen('Beta');
    await undo(app, page);
    await expect(app.elementsOn(0)).toHaveCount(1);

    // Alpha closes from the parking lot.
    await tabNamed(page, 'Beta').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close other tabs' }).click();
    await confirmClose(page, 'Close Alpha?');
    await expect(tabs(page)).toHaveCount(1);
    await reopen('Alpha');
    await undo(app, page);
    await expect(app.elementsOn(0)).toHaveCount(1);
  });

  test("closing a tab with changes asks first, and Don't ask again stops asking", async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);
    // Beta has no changes, so it closes without a question.
    await tabNamed(page, 'Beta').getByRole('button', { name: 'Close Beta' }).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await openBetaInNewTab(app, page);
    // Alpha has one now, and Cancel keeps it open.
    await tabNamed(page, 'Alpha').getByRole('button', { name: 'Close Alpha' }).click();
    await confirmClose(page, 'Close Alpha?', 'Cancel');
    await expect(tabs(page)).toHaveCount(2);

    await tabNamed(page, 'Alpha').getByRole('button', { name: 'Close Alpha' }).click();
    const dialog = page.getByRole('alertdialog').filter({ hasText: 'Close Alpha?' });
    await dialog.getByRole('checkbox', { name: "Don't ask again" }).check();
    await dialog.getByRole('button', { name: 'Close tab', exact: true }).click();
    await expect(tabs(page)).toHaveCount(1);
    // Settings has the switch that turns the question back on.
    expect(await page.evaluate(() => localStorage.getItem('open-screenshot-generator.confirm-tab-close'))).toBe('0');

    // Beta has changes too, and closes without asking now.
    await app.addElement('Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await strip(page).getByRole('button', { name: 'All open projects' }).click();
    await page.getByRole('menuitem', { name: 'Alpha' }).click();
    await expect(tabs(page)).toHaveCount(2);
    await tabNamed(page, 'Beta').getByRole('button', { name: 'Close Beta' }).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('a tab whose only change is a restored version still asks before it closes', async ({ app, page }) => {
    test.skip(!(await canStoreBlobsInIndexedDb(page)), 'this browser cannot put a Blob in IndexedDB, and a version is one');
    await openAlphaWithBetaStored(app, page);
    // The first edit keeps the state Alpha opened in as a version.
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await expect.poll(async () => (await readAll(page, 'projectVersions')).length).toBeGreaterThan(0);
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.elementsOn(0)).toHaveCount(2);
    // A reload starts a sitting with nothing changed in it yet.
    await page.waitForTimeout(800);
    await app.goto(page.url());
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.elementsOn(0)).toHaveCount(2);

    await app.dockTab('Versions').click();
    const versions = page
      .locator('[role="tabpanel"][data-state="active"]')
      .filter({ has: page.getByText('Versions', { exact: true }) });
    await versions
      .locator('li')
      .filter({ hasText: 'Before this session' })
      .getByTitle('Put this state back on the canvas')
      .click();
    await expect(app.elementsOn(0)).toHaveCount(1);

    // A restore is a change like any other, whatever its history row is called.
    await tabNamed(page, 'Alpha').getByRole('button', { name: 'Close Alpha' }).click();
    await confirmClose(page, 'Close Alpha?', 'Cancel');
    await expect(tabs(page)).toHaveCount(2);
  });

  test('closing other tabs closes the ones asked about, not one that opened meanwhile', async ({
    app,
    page,
    isDesktop,
  }) => {
    await openAlphaWithBetaStored(app, page);
    await put(page, 'projects', seedProject('tabs_gamma', 'Gamma', '#DCFCE7'));
    await openBetaInNewTab(app, page);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);

    await tabNamed(page, 'Alpha').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close other tabs' }).click();
    const question = page.getByRole('alertdialog').filter({ hasText: 'Close Beta?' });
    await expect(question).toBeVisible();

    // Another window moves Gamma here while the question is up.
    const to = await editorWindowId(page, isDesktop);
    await postOnTabBus(page, isDesktop, { type: 'adopt', from: 'test-window', to, projectId: 'tabs_gamma', name: 'Gamma' });
    // By its id: the open dialog hides the strip from the accessibility tree.
    await expect(strip(page).locator('[data-tab-id="tabs_gamma"]')).toHaveCount(1);

    await question.getByRole('button', { name: 'Close tab', exact: true }).click();
    await expect(tabNamed(page, 'Beta')).toHaveCount(0);
    await expect(tabNamed(page, 'Gamma')).toHaveCount(1);
    await expect(tabs(page)).toHaveCount(2);
  });

  test('a template looked at from the gallery shares one tab until it is edited', async ({ app, page }) => {
    const dialog = app.startDialog;
    await dialog.getByRole('tab', { name: /App Screenshots/ }).click();
    await dialog.getByAltText('Somnia Sleep', { exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page).locator('.italic')).toHaveCount(1);

    // Another template from the toolbar takes the preview's place.
    await app.create('Start from a template');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('tab', { name: /App Screenshots/ }).click();
    await dialog.getByAltText('Kassa Money', { exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page)).toContainText('Kassa Money');

    // Editing makes it a project worth keeping: the next template gets a tab.
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(activeTab(page).locator('.italic')).toHaveCount(0);
    await app.create('Start from a template');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('tab', { name: /App Screenshots/ }).click();
    await dialog.getByAltText('Somnia Sleep', { exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(tabs(page)).toHaveCount(2);
  });
});

/**
 * Layers and artboards moving from one tab's project to another. The target is
 * written in the background (it is not on the canvas), with an undo step of
 * its own, so each side undoes its half.
 */
test.describe('moving between tabs', () => {
  /** Alpha open, Beta in the next tab, back on Alpha. */
  async function alphaAndBetaOpen(app: Editor, page: Page): Promise<void> {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
  }

  test('the canvas menu moves a layer to another tab, and each side undoes its half', async ({ app, page }) => {
    await alphaAndBetaOpen(app, page);
    await app.board(0).locator('[data-element-id="tabs_alpha_rect"]').click({ button: 'right' });
    const menu = page.locator('[data-canvas-context-menu]');
    await menu.getByRole('button', { name: 'Move to tab' }).hover();
    await menu.getByRole('menuitem', { name: 'Beta' }).click();

    await expect(app.elementsOn(0)).toHaveCount(0);
    await expect(page.getByText('Moved to Beta', { exact: true }).first()).toBeVisible();

    await tabNamed(page, 'Beta').click();
    await expect(activeTab(page)).toContainText('Beta');
    // Beta's own rectangle, and Alpha's under a new id, selected on arrival.
    await expect(app.elementsOn(0)).toHaveCount(2);
    await expect(app.selectedElement).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(app.board(0).locator('[data-element-id="tabs_beta_rect"]')).toBeVisible();

    await tabNamed(page, 'Alpha').click();
    await expect(activeTab(page)).toContainText('Alpha');
    // Alpha's own artboard on the canvas first: an undo pressed while the tab
    // is still switching is dropped (canvasStillHolds), not applied anywhere.
    await expect(app.board(0)).toHaveAttribute('data-artboard-dom-id', 'tabs_alpha_board');
    await expect(app.elementsOn(0)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
  });

  test('a layer dragged up onto another tab moves there', async ({ app, page }) => {
    await alphaAndBetaOpen(app, page);
    const rect = app.board(0).locator('[data-element-id="tabs_alpha_rect"]');
    // Selected first: a press on a layer that is not selected only selects it.
    await rect.click();
    const from = await rect.boundingBox();
    const to = await tabNamed(page, 'Beta').boundingBox();
    if (!from || !to) throw new Error('nothing to drag between');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(page.locator('[data-tab-carry-label]')).toContainText('Move to Beta');
    await page.mouse.up();

    await expect(app.elementsOn(0)).toHaveCount(0);
    await tabNamed(page, 'Beta').click();
    await expect(app.elementsOn(0)).toHaveCount(2);
    // Nothing moved within Alpha on the way: the drag committed nothing there.
    const stored = (await readProjects(page)).find((project) => project.id === 'tabs_alpha');
    const boards = stored?.projectData as Array<{ elements: unknown[] }> | undefined;
    expect(boards?.[0]?.elements).toHaveLength(0);
  });

  test('an artboard moved while the canvas changes tabs leaves the project it came from', async ({ app, page }) => {
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    // Alpha and Beta share a board id, the way a duplicated project does.
    await put(page, 'projects', seedBoards('tabs_alpha', 'Alpha', '#DBEAFE', ['shared_board', 'alpha_board_2']));
    await put(page, 'projects', seedBoards('tabs_beta', 'Beta', '#FEE2E2', ['shared_board', 'beta_board_2']));
    await put(page, 'projects', seedProject('tabs_gamma', 'Gamma', '#DCFCE7'));
    await app.goto('/?projectId=tabs_alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
    await openInNewTab(app, page, 'Beta', 'tabs_beta');
    await openInNewTab(app, page, 'Gamma', 'tabs_gamma');
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();

    await app.board(0).click({ button: 'right', position: { x: 4, y: 140 } });
    const menu = page.locator('[data-canvas-context-menu]');
    await menu.getByRole('button', { name: 'Move artboard to tab' }).hover();
    // With the project store held, the move's write to Gamma waits, and the
    // canvas goes to Beta before it lands.
    const hold = await holdProjects(page);
    try {
      await menu.getByRole('menuitem', { name: 'Gamma' }).click();
      await tabNamed(page, 'Beta').click();
      await expect(activeTab(page)).toContainText('Beta');
    } finally {
      await hold.release();
    }
    await expect(page.getByText('Moved to Gamma', { exact: true }).first()).toBeVisible();

    // Beta keeps both of its boards; the one that moved came out of Alpha.
    await expect(app.artboards).toHaveCount(2);
    await expect.poll(async () => (await storedBoards(page, 'tabs_alpha')).map((board) => board.id)).toEqual(['alpha_board_2']);
    expect((await storedBoards(page, 'tabs_beta')).map((board) => board.id)).toEqual(['shared_board', 'beta_board_2']);
    expect(await storedBoards(page, 'tabs_gamma')).toHaveLength(2);
  });

  test('the Move to tab list stays open while the pointer travels to it', async ({ app, page }) => {
    await openAlphaWithBetaStored(app, page);
    await put(page, 'projects', seedProject('tabs_gamma', 'Gamma', '#DCFCE7'));
    await openBetaInNewTab(app, page);
    await openInNewTab(app, page, 'Gamma', 'tabs_gamma');
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();

    await app.board(0).locator('[data-element-id="tabs_alpha_rect"]').click({ button: 'right' });
    const menu = page.locator('[data-canvas-context-menu]');
    const row = menu.getByRole('button', { name: 'Move to tab' });
    await row.hover();
    const second = menu.getByRole('menuitem', { name: 'Gamma' });
    await expect(second).toBeVisible();
    const from = await row.boundingBox();
    const to = await second.boundingBox();
    if (!from || !to) throw new Error('no menu to travel across');
    // A plain diagonal move, the way a hand makes it: across the gap between
    // the menu and its list, and over the corner of the Copy to tab row.
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await expect(second).toBeVisible();
    await second.click();
    await expect(page.getByText('Moved to Gamma', { exact: true }).first()).toBeVisible();
  });

  test('layers moving into a project with another base language keep their translations and their look', async ({
    app,
    page,
  }) => {
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    const english = { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] };
    const german = { baseLocale: 'de-DE', locales: [{ code: 'en-US' }] };
    const alpha = seedProject('tabs_alpha', 'Alpha', '#DBEAFE');
    const [alphaBoard] = alpha.projectData as Array<Record<string, unknown>>;
    alpha.projectData = [
      {
        ...alphaBoard,
        localization: english,
        elements: [
          {
            id: 'tabs_alpha_rect',
            type: 'text',
            name: 'Greeting',
            content: 'Hello',
            fontSize: 24,
            color: '#111827',
            fontFamily: 'Inter',
            position: { x: 100, y: 120 },
            size: { width: 400, height: 120 },
            rotation: 0,
            scale: 1,
          },
        ],
        // German is see-through in German only. English sets no opacity at all.
        localized: {
          'de-DE': {
            tabs_alpha_rect: { content: 'Hallo', origin: 'manual', detached: ['opacity'], opacity: 0.3 },
          },
        },
      },
    ];
    const beta = seedProject('tabs_beta', 'Beta', '#FEE2E2');
    const [betaBoard] = beta.projectData as Array<Record<string, unknown>>;
    beta.projectData = [{ ...betaBoard, localization: german }];
    await put(page, 'projects', alpha);
    await put(page, 'projects', beta);
    await app.goto('/?projectId=tabs_alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();

    await app.board(0).locator('[data-element-id="tabs_alpha_rect"]').click({ button: 'right' });
    const menu = page.locator('[data-canvas-context-menu]');
    await menu.getByRole('button', { name: 'Move to tab' }).hover();
    await menu.getByRole('menuitem', { name: 'Beta' }).click();
    await expect(page.getByText('Moved to Beta', { exact: true }).first()).toBeVisible();

    // Beta's base language is German, so the German is its text now and the
    // English an override, where an English base would have lost the German.
    const [board] = await storedBoards(page, 'tabs_beta');
    const arrived = board.elements.find((element) => element.type === 'text');
    expect(arrived?.content).toBe('Hallo');
    const inEnglish = board.localized?.['en-US']?.[arrived?.id as string];
    expect(inEnglish?.content).toBe('Hello');
    // German's opacity is the base one now, and English says it sets none.
    expect(arrived?.opacity).toBe(0.3);
    expect(inEnglish?.detached).toContain('opacity');
    expect(inEnglish?.opacity).toBeNull();

    // And English draws without it, the way Alpha drew it.
    await tabNamed(page, 'Beta').click();
    await expect(activeTab(page)).toContainText('Beta');
    const layer = (text: string) => app.board(0).locator('[data-element-id]').filter({ hasText: text });
    const seeThrough = (text: string) => layer(text).locator('div[style*="opacity"]');
    await expect(seeThrough('Hallo')).toHaveCount(1);
    await page.locator('button[title^="Showing "]').first().click();
    await page.getByRole('menuitemcheckbox', { name: /English/ }).click();
    await expect(layer('Hello')).toHaveCount(1);
    await expect(seeThrough('Hello')).toHaveCount(0);
  });

  test('an artboard is copied to another tab from the canvas menu', async ({ app, page }) => {
    await alphaAndBetaOpen(app, page);
    // Empty space on the artboard, away from the rectangle.
    await app.board(0).click({ button: 'right', position: { x: 4, y: 140 } });
    const menu = page.locator('[data-canvas-context-menu]');
    await menu.getByRole('button', { name: 'Copy artboard to tab' }).hover();
    await menu.getByRole('menuitem', { name: 'Beta' }).click();
    await expect(page.getByText('Copied to Beta', { exact: true }).first()).toBeVisible();
    await expect(app.artboards).toHaveCount(1);

    await tabNamed(page, 'Beta').click();
    await expect(activeTab(page)).toContainText('Beta');
    await expect(app.artboards).toHaveCount(2);
  });

  test('a layer edited while its move waits for a font moves with the edit, and nothing of it is lost', async ({
    app,
    page,
    context,
  }) => {
    test.skip(!fs.existsSync(NOTO_SANS_FILE), 'needs the Noto Sans file Next carries');
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    const alpha = seedProject('tabs_alpha', 'Alpha', '#DBEAFE');
    const [alphaBoard] = alpha.projectData as Array<Record<string, unknown>>;
    alpha.projectData = [
      {
        ...alphaBoard,
        elements: [
          {
            id: 'tabs_alpha_text',
            type: 'text',
            name: 'Headline',
            content: 'Hello',
            fontSize: 24,
            color: '#111827',
            fontFamily: 'Lobster',
            position: { x: 100, y: 120 },
            size: { width: 400, height: 120 },
            rotation: 0,
            scale: 1,
          },
        ],
      },
    ];
    await put(page, 'projects', alpha);
    await put(page, 'projects', seedProject('tabs_beta', 'Beta', '#FEE2E2'));
    // The headline's face is a built-in one, so the move waits for the
    // stylesheet, which is held from here on.
    const fonts = await holdBuiltInFonts(context, 'Lobster');
    const text = app.board(0).locator('[data-element-id="tabs_alpha_text"]');
    try {
      await app.goto('/?projectId=tabs_alpha');
      await expect(text).toBeVisible();
      await openBetaInNewTab(app, page);
      await tabNamed(page, 'Alpha').click();
      await expect(text).toBeVisible();
      await text.click({ button: 'right' });
      const menu = page.locator('[data-canvas-context-menu]');
      await menu.getByRole('button', { name: 'Move to tab' }).hover();
      await menu.getByRole('menuitem', { name: 'Beta' }).click();
      // Still here while the move waits, and edited meanwhile.
      await expect(text).toBeVisible();
      await text.click();
      await app.textContentInput.fill('Edited on the way');
      await app.textContentInput.blur();
      await expect(text).toContainText('Edited on the way');
    } finally {
      fonts.release();
    }

    await expect(page.getByText('Moved to Beta', { exact: true }).first()).toBeVisible();
    await expect(app.elementsOn(0)).toHaveCount(0);
    // Beta has the headline as it was edited, and Alpha has nothing of it left.
    await expect
      .poll(async () => (await storedBoards(page, 'tabs_beta'))[0].elements.map((element) => element.content ?? null))
      .toEqual([null, 'Edited on the way']);
    await expect.poll(async () => (await storedBoards(page, 'tabs_alpha'))[0].elements.length).toBe(0);
  });

  test('an artboard edited while its move waits for a font moves with the edit', async ({ app, page, context }) => {
    test.skip(!fs.existsSync(NOTO_SANS_FILE), 'needs the Noto Sans file Next carries');
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    // Two artboards, since a project keeps one, and the headline on the first.
    const alpha = seedBoards('tabs_alpha', 'Alpha', '#DBEAFE', ['alpha_board_1', 'alpha_board_2']);
    (alpha.projectData as Array<Record<string, unknown>>)[0].elements = [
      {
        id: 'tabs_alpha_text',
        type: 'text',
        name: 'Headline',
        content: 'Hello',
        fontSize: 24,
        color: '#111827',
        fontFamily: 'Lobster',
        position: { x: 100, y: 120 },
        size: { width: 400, height: 120 },
        rotation: 0,
        scale: 1,
      },
    ];
    await put(page, 'projects', alpha);
    await put(page, 'projects', seedProject('tabs_beta', 'Beta', '#FEE2E2'));
    const fonts = await holdBuiltInFonts(context, 'Lobster');
    const text = app.board(0).locator('[data-element-id="tabs_alpha_text"]');
    try {
      await app.goto('/?projectId=tabs_alpha');
      await expect(text).toBeVisible();
      await openBetaInNewTab(app, page);
      await tabNamed(page, 'Alpha').click();
      await expect(text).toBeVisible();
      // Empty space on the first artboard, away from the headline.
      await app.board(0).click({ button: 'right', position: { x: 4, y: 140 } });
      const menu = page.locator('[data-canvas-context-menu]');
      await menu.getByRole('button', { name: 'Move artboard to tab' }).hover();
      await menu.getByRole('menuitem', { name: 'Beta' }).click();
      await expect(text).toBeVisible();
      await text.click();
      await app.textContentInput.fill('Edited on the way');
      await app.textContentInput.blur();
      await expect(text).toContainText('Edited on the way');
    } finally {
      fonts.release();
    }

    await expect(page.getByText('Moved to Beta', { exact: true }).first()).toBeVisible();
    await expect(app.artboards).toHaveCount(1);
    await expect.poll(async () => (await storedBoards(page, 'tabs_alpha')).map((board) => board.id)).toEqual(['alpha_board_2']);
    const arrived = (await storedBoards(page, 'tabs_beta'))[1];
    expect(arrived?.elements.map((element) => element.content)).toEqual(['Edited on the way']);
  });

  test("a copy waits for the face a language's font setting brings in while it waits", async ({ app, page, context }) => {
    test.skip(!fs.existsSync(NOTO_SANS_FILE), 'needs the Noto Sans file Next carries');
    // The design tools an agent uses, through the headless bridge.
    await page.addInitScript(() => {
      (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
    });
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    // Japanese draws in the headline's own face for now, with words too long
    // for the box, so they are drawn smaller to fit.
    const alpha = seedProject('tabs_alpha', 'Alpha', '#DBEAFE');
    const [alphaBoard] = alpha.projectData as Array<Record<string, unknown>>;
    alpha.projectData = [
      {
        ...alphaBoard,
        localization: { baseLocale: 'en-US', locales: [{ code: 'ja', autoFont: false }] },
        elements: [
          {
            id: 'tabs_alpha_text',
            type: 'text',
            name: 'Headline',
            content: 'Hello',
            fontSize: 24,
            color: '#111827',
            fontFamily: 'Lobster',
            position: { x: 10, y: 100 },
            size: { width: 1000, height: 200 },
            rotation: 0,
            scale: 1,
          },
        ],
        localized: {
          ja: {
            tabs_alpha_text: {
              content: 'Erstelle Bildschirmfotos fuer den App Store in wenigen Minuten und exportiere alles',
              origin: 'manual',
            },
          },
        },
      },
    ];
    // Japanese is Beta's base language, so a copy there is rewritten in
    // Japanese, at the size the Japanese fits its box at.
    const beta = seedProject('tabs_beta', 'Beta', '#FEE2E2');
    const [betaBoard] = beta.projectData as Array<Record<string, unknown>>;
    beta.projectData = [{ ...betaBoard, localization: { baseLocale: 'ja', locales: [{ code: 'en-US' }] } }];
    await put(page, 'projects', alpha);
    await put(page, 'projects', beta);
    const copiedSizes = async () =>
      (await storedBoards(page, 'tabs_beta'))[0].elements
        .filter((element) => element.type === 'text')
        .map((element) => element.fontSize as number);
    const copyToBeta = async () => {
      await app.board(0).locator('[data-element-id="tabs_alpha_text"]').click({ button: 'right' });
      const menu = page.locator('[data-canvas-context-menu]');
      await menu.getByRole('button', { name: 'Copy to tab' }).hover();
      await menu.getByRole('menuitem', { name: 'Beta' }).click();
    };

    const fonts = await holdBuiltInFonts(context, 'Lobster', 'Noto Sans JP');
    try {
      await app.goto('/?projectId=tabs_alpha');
      await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();
      await openBetaInNewTab(app, page);
      await tabNamed(page, 'Alpha').click();
      await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();
      await copyToBeta();
      // While the copy waits for the headline's face, Japanese is given a face
      // of its own, the way an agent can (add_locales).
      const answer = await page.evaluate(() =>
        (
          window as unknown as {
            __osg: { mcp: (message: unknown) => Promise<{ result?: { isError?: boolean }; error?: unknown }> };
          }
        ).__osg.mcp({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'add_locales', arguments: { locales: ['ja'], autoFont: true } },
        })
      );
      expect(answer.error).toBeUndefined();
      expect(answer.result?.isError).toBeFalsy();
    } finally {
      fonts.release();
    }
    await expect.poll(async () => (await copiedSizes()).length).toBe(1);

    // The same copy again, with Japanese's face certainly on the page.
    await page.evaluate(() => document.fonts.load('16px "Noto Sans JP"', 'Erstelle').then(() => undefined));
    await expect.poll(() => faceLoaded(page, 'Noto Sans JP')).toBe(true);
    await copyToBeta();
    await expect.poll(async () => (await copiedSizes()).length).toBe(2);
    const [first, again] = await copiedSizes();
    expect(first).toBeLessThan(24);
    expect(first).toBe(again);
  });
});

/**
 * Copy and paste between projects (issue #47). The clipboard is one for the
 * whole app (elementClipboard.ts), so a copy in one tab or window is what a
 * paste in any other reads, and it lands the way Copy to tab does.
 */
test.describe('copy and paste between projects', () => {
  test('layers copied in one tab paste into another, as a group and with their translations', async ({ app, page }) => {
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    const languages = { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] };
    const alpha = seedProject('tabs_alpha', 'Alpha', '#DBEAFE');
    const [alphaBoard] = alpha.projectData as Array<Record<string, unknown>>;
    const [seededRect] = alphaBoard.elements as Array<Record<string, unknown>>;
    alpha.projectData = [
      {
        ...alphaBoard,
        localization: languages,
        elements: [
          { ...seededRect, groupId: 'badges', groupName: 'Badges' },
          {
            id: 'tabs_alpha_text',
            type: 'text',
            name: 'Greeting',
            content: 'Hello',
            fontSize: 24,
            color: '#111827',
            fontFamily: 'Inter',
            position: { x: 100, y: 340 },
            size: { width: 400, height: 80 },
            rotation: 0,
            scale: 1,
            groupId: 'badges',
            groupName: 'Badges',
          },
        ],
        localized: { 'de-DE': { tabs_alpha_text: { content: 'Hallo', origin: 'manual' } } },
      },
    ];
    const beta = seedProject('tabs_beta', 'Beta', '#FEE2E2');
    const [betaBoard] = beta.projectData as Array<Record<string, unknown>>;
    beta.projectData = [{ ...betaBoard, localization: languages }];
    await put(page, 'projects', alpha);
    await put(page, 'projects', beta);
    await app.goto('/?projectId=tabs_alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();

    // A right-click on one layer of a group copies the whole group.
    await app.board(0).locator('[data-element-id="tabs_alpha_rect"]').click({ button: 'right' });
    await page.locator('[data-canvas-context-menu]').getByRole('button', { name: /^Copy\s*Ctrl\+C$/ }).click();

    await tabNamed(page, 'Beta').click();
    await expect(activeTab(page)).toContainText('Beta');
    await app.board(0).click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+v');
    await expect(app.elementsOn(0)).toHaveCount(3);
    await expect(page.getByText('2 layers from Alpha', { exact: true }).first()).toBeVisible();

    // A group of their own, and the German came along.
    await expect.poll(async () => (await storedBoards(page, 'tabs_beta'))[0].elements.length).toBe(3);
    const [board] = await storedBoards(page, 'tabs_beta');
    const pasted = board.elements.filter((element) => element.id !== 'tabs_beta_rect');
    expect(new Set(pasted.map((element) => element.groupId)).size).toBe(1);
    expect(pasted[0].groupId).toBeTruthy();
    expect(pasted[0].groupId).not.toBe('badges');
    const text = pasted.find((element) => element.type === 'text');
    expect(board.localized?.['de-DE']?.[text?.id as string]?.content).toBe('Hallo');

    // One step of Beta's own undo takes the paste back.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(app.elementsOn(0)).toHaveCount(1);
  });

  test('a paste at a point centres the layers where the language on screen draws them', async ({ app, page }) => {
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    const alpha = seedProject('tabs_alpha', 'Alpha', '#DBEAFE');
    const [alphaBoard] = alpha.projectData as Array<Record<string, unknown>>;
    alpha.projectData = [
      {
        ...alphaBoard,
        localization: { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] },
        // German has the rectangle 200 pixels to the right of the base one.
        localized: { 'de-DE': { tabs_alpha_rect: { detached: ['position'], position: { x: 300, y: 120 } } } },
      },
    ];
    await put(page, 'projects', alpha);
    await app.goto('/?projectId=tabs_alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
    const rect = app.board(0).locator('[data-element-id="tabs_alpha_rect"]');
    const inEnglish = await rect.boundingBox();
    await page.locator('button[title^="Showing "]').first().click();
    await page.getByRole('menuitemcheckbox', { name: /Deutsch/ }).click();
    // German draws the rectangle further right.
    await expect.poll(async () => (await rect.boundingBox())?.x ?? 0).toBeGreaterThan((inEnglish?.x ?? 0) + 50);

    await app.board(0).locator('[data-element-id="tabs_alpha_rect"]').click();
    await page.keyboard.press('ControlOrMeta+c');
    // Right-click the artboard 512 across and 250 down, in its own pixels.
    const board = app.board(0);
    const box = await board.boundingBox();
    const width = Number(await board.getAttribute('data-original-width'));
    if (!box || !width) throw new Error('no artboard to paste on');
    const scale = box.width / width;
    await board.click({ button: 'right', position: { x: 512 * scale, y: 250 * scale } });
    await page.locator('[data-canvas-context-menu]').getByRole('button', { name: /^Paste\s*Ctrl\+V$/ }).click();
    await expect(app.elementsOn(0)).toHaveCount(2);

    // The German box, 400 by 200, is centred on the point: its corner near
    // (312, 150), give or take the pixel the pointer landed on.
    const germanCorner = async () => {
      const [stored] = await storedBoards(page, 'tabs_alpha');
      const pasted = stored.elements.find((element) => element.id !== 'tabs_alpha_rect');
      return stored.localized?.['de-DE']?.[pasted?.id as string]?.position as { x: number; y: number } | undefined;
    };
    await expect.poll(async () => (await germanCorner()) !== undefined).toBe(true);
    const corner = (await germanCorner())!;
    expect(Math.abs(corner.x - 312)).toBeLessThan(3);
    expect(Math.abs(corner.y - 150)).toBeLessThan(3);
  });

  test('a layer copied in one window pastes into a project open in another', async ({ app, page, context }) => {
    await openAlphaWithBetaStored(app, page);
    await app.board(0).locator('[data-element-id="tabs_alpha_rect"]').click();
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.getByText('Copied', { exact: true }).first()).toBeVisible();

    const second = await context.newPage();
    await second.goto('/?projectId=tabs_beta', { waitUntil: 'domcontentloaded' });
    const board = second.locator('[data-artboard-dom-id]').first();
    await expect(board.locator('[data-element-id="tabs_beta_rect"]')).toBeVisible({ timeout: 60_000 });
    // Empty space on the artboard, away from Beta's own rectangle.
    await board.click({ button: 'right', position: { x: 4, y: 140 } });
    await second.locator('[data-canvas-context-menu]').getByRole('button', { name: /^Paste\s*Ctrl\+V$/ }).click();
    await expect(board.locator('[data-element-id]')).toHaveCount(2);
    await expect(second.getByText('Seeded Rectangle from Alpha', { exact: true }).first()).toBeVisible();
    await expect.poll(async () => (await storedBoards(second, 'tabs_beta'))[0].elements.length).toBe(2);
  });

  test('a paste into another base language measures its text in a font another window imported', async ({ app, page }) => {
    test.skip(!fs.existsSync(NOTO_SANS_FILE), 'needs the Noto Sans file Next carries');
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    test.skip(!(await canStoreBlobsInIndexedDb(page)), 'this browser cannot put a Blob in IndexedDB, and a font file is one');
    // A headline in a font this window has not got, with German too long for
    // its box, so the German is drawn smaller to fit.
    const alpha = seedProject('tabs_alpha', 'Alpha', '#DBEAFE');
    const [alphaBoard] = alpha.projectData as Array<Record<string, unknown>>;
    alpha.projectData = [
      {
        ...alphaBoard,
        localization: { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] },
        elements: [
          {
            id: 'tabs_alpha_text',
            type: 'text',
            name: 'Headline',
            content: 'Hello',
            fontSize: 24,
            color: '#111827',
            fontFamily: 'Other Window Sans',
            position: { x: 10, y: 100 },
            size: { width: 1000, height: 200 },
            rotation: 0,
            scale: 1,
          },
        ],
        localized: {
          'de-DE': {
            tabs_alpha_text: {
              content: 'Erstelle Bildschirmfotos fuer den App Store in wenigen Minuten und exportiere alles',
              origin: 'manual',
            },
          },
        },
      },
    ];
    // German is Beta's base language, so a paste there is rewritten in German,
    // at the size the German fits its box at.
    const beta = seedProject('tabs_beta', 'Beta', '#FEE2E2');
    const [betaBoard] = beta.projectData as Array<Record<string, unknown>>;
    beta.projectData = [{ ...betaBoard, localization: { baseLocale: 'de-DE', locales: [{ code: 'en-US' }] } }];
    await put(page, 'projects', alpha);
    await put(page, 'projects', beta);
    await app.goto('/?projectId=tabs_alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();

    // Another window imports the font, after this one put its own on the page.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(500);
    await importFontInAnotherWindow(page, 'Other Window Sans', NOTO_SANS_FILE);

    await app.board(0).locator('[data-element-id="tabs_alpha_text"]').click();
    await page.keyboard.press('ControlOrMeta+c');
    await tabNamed(page, 'Beta').click();
    await expect(activeTab(page)).toContainText('Beta');
    const pastedSizes = async () =>
      (await storedBoards(page, 'tabs_beta'))[0].elements
        .filter((element) => element.type === 'text')
        .map((element) => element.fontSize as number);
    await app.board(0).click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await pastedSizes()).length).toBe(1);
    // The same paste again, with the font certainly on the page by now.
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await pastedSizes()).length).toBe(2);

    const [first, again] = await pastedSizes();
    expect(first).toBeLessThan(24);
    expect(first).toBe(again);
    const onThePage = await page.evaluate(() => {
      let found = false;
      document.fonts.forEach((face) => {
        if (face.family.includes('Other Window Sans')) found = true;
      });
      return found;
    });
    expect(onThePage).toBe(true);
  });

  test('a paste into another base language waits for the built-in fonts when they come after the page', async ({
    app,
    page,
    context,
  }) => {
    test.skip(!fs.existsSync(NOTO_SANS_FILE), 'needs the Noto Sans file Next carries');
    await expect(app.startDialog).toBeVisible();
    await waitForProjectStore(page);
    // The same headline as above, in a built-in face this time.
    const alpha = seedProject('tabs_alpha', 'Alpha', '#DBEAFE');
    const [alphaBoard] = alpha.projectData as Array<Record<string, unknown>>;
    alpha.projectData = [
      {
        ...alphaBoard,
        localization: { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] },
        elements: [
          {
            id: 'tabs_alpha_text',
            type: 'text',
            name: 'Headline',
            content: 'Hello',
            fontSize: 24,
            color: '#111827',
            fontFamily: 'Lobster',
            position: { x: 10, y: 100 },
            size: { width: 1000, height: 200 },
            rotation: 0,
            scale: 1,
          },
        ],
        localized: {
          'de-DE': {
            tabs_alpha_text: {
              content: 'Erstelle Bildschirmfotos fuer den App Store in wenigen Minuten und exportiere alles',
              origin: 'manual',
            },
          },
        },
      },
    ];
    const beta = seedProject('tabs_beta', 'Beta', '#FEE2E2');
    const [betaBoard] = beta.projectData as Array<Record<string, unknown>>;
    beta.projectData = [{ ...betaBoard, localization: { baseLocale: 'de-DE', locales: [{ code: 'en-US' }] } }];
    await put(page, 'projects', alpha);
    await put(page, 'projects', beta);
    const pastedSizes = async () =>
      (await storedBoards(page, 'tabs_beta'))[0].elements
        .filter((element) => element.type === 'text')
        .map((element) => element.fontSize as number);

    // The stylesheet is held from here, so the page opened next has no
    // built-in face declared yet when the paste comes.
    const fonts = await holdBuiltInFonts(context, 'Lobster');
    try {
      await app.goto('/?projectId=tabs_alpha');
      await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();
      await openBetaInNewTab(app, page);
      await tabNamed(page, 'Alpha').click();
      await expect(app.board(0).locator('[data-element-id="tabs_alpha_text"]')).toBeVisible();
      await app.board(0).locator('[data-element-id="tabs_alpha_text"]').click();
      await page.keyboard.press('ControlOrMeta+c');
      await tabNamed(page, 'Beta').click();
      await expect(activeTab(page)).toContainText('Beta');
      await app.board(0).click({ position: { x: 4, y: 4 } });
      await page.keyboard.press('ControlOrMeta+v');
      // Time for a paste that did not wait to have landed.
      await page.waitForTimeout(1_000);
    } finally {
      fonts.release();
    }
    await expect.poll(async () => (await pastedSizes()).length).toBe(1);
    // The same paste again, once the face is certainly on the page.
    await expect.poll(() => faceLoaded(page, 'Lobster')).toBe(true);
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await pastedSizes()).length).toBe(2);

    const [first, again] = await pastedSizes();
    expect(first).toBeLessThan(24);
    expect(first).toBe(again);
  });
});

/**
 * Tabs across windows. A browser gives a moved tab a popup; the desktop gives it
 * a Tauri window, which the mocked IPC here cannot create, so these run on the
 * web project only. One rule holds either way: one window writes a project.
 */
test.describe('tabs across windows', () => {
  test.skip(({ isDesktop }) => isDesktop, 'A real second window needs the browser, not the mocked desktop shell.');

  test('a tab moved to a new window opens there, undo history and all, until that window reloads', async ({
    app,
    page,
    context,
  }) => {
    await openAlphaWithBetaStored(app, page);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);
    await openBetaInNewTab(app, page);

    await tabNamed(page, 'Alpha').click({ button: 'right' });
    const popupOpened = context.waitForEvent('page');
    await page.getByRole('menuitem', { name: 'Move to new window' }).click();
    const popup = await popupOpened;

    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page)).toContainText('Beta');
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toContain('projectId=tabs_alpha');
    expect(popup.url()).toContain('tabwindow=');
    await expect(popup.locator('[data-project-tabs] [role="tab"]')).toHaveCount(1, { timeout: 60_000 });
    await expect(popup.locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible({ timeout: 60_000 });

    // The rectangle added in the first window is still the last thing to undo.
    const boardInPopup = popup.locator('[data-artboard-dom-id]').first();
    await expect(boardInPopup.locator('[data-element-id]')).toHaveCount(2);
    await boardInPopup.click({ position: { x: 4, y: 4 } });
    await popup.keyboard.press('ControlOrMeta+z');
    await expect(boardInPopup.locator('[data-element-id]')).toHaveCount(1);
    await popup.keyboard.press('ControlOrMeta+Shift+z');
    await expect(boardInPopup.locator('[data-element-id]')).toHaveCount(2);

    // The stack is that window's now, so it ends with it: a reload there starts
    // undo over (rule 28), even with the first window still open.
    await popup.waitForTimeout(1_500);
    await popup.reload();
    await expect(boardInPopup.locator('[data-element-id]')).toHaveCount(2, { timeout: 60_000 });
    await boardInPopup.click({ position: { x: 4, y: 4 } });
    await popup.keyboard.press('ControlOrMeta+z');
    await popup.waitForTimeout(800);
    await expect(boardInPopup.locator('[data-element-id]')).toHaveCount(2);
  });

  test('an open that writes the project first is refused while another window has it', async ({ app, page, context }) => {
    await openAlphaWithBetaStored(app, page);
    const before = (await readProjects(page)).find((project) => project.id === 'tabs_alpha');

    // The headless bridge opens through loadProjectFromData, the loader the
    // account, cloud and live session opens share. It writes the row first.
    const second = await context.newPage();
    await second.addInitScript(() => {
      (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
    });
    await second.goto('/', { waitUntil: 'domcontentloaded' });
    await second.waitForFunction(() => (window as unknown as { __osg?: { ready: boolean } }).__osg?.ready === true, null, {
      timeout: 60_000,
    });
    const outcome = await second.evaluate(async (data) => {
      const bridge = (window as unknown as { __osg: { loadProject: (d: unknown[], n: string, i: string) => Promise<boolean> } }).__osg;
      try {
        return { opened: await bridge.loadProject(data, 'Alpha copy', 'tabs_alpha') };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }, seedProject('tabs_alpha', 'Alpha', '#000000').projectData);
    expect(outcome.error).toContain('open in another window');
    await expect(second.locator('[data-element-id="tabs_alpha_rect"]')).toHaveCount(0);

    // Nothing was written over the first window's project.
    const after = (await readProjects(page)).find((project) => project.id === 'tabs_alpha');
    expect(after?.name).toBe(before?.name);
    expect(JSON.stringify(after?.projectData)).toBe(JSON.stringify(before?.projectData));
    await expect(activeTab(page)).toContainText('Alpha');
  });

  test('a window a tab was moved into leaves the detached panels to the main window', async ({ app, page, context }) => {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();

    const panelOpened = page.waitForEvent('popup');
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Open all panels in a window');
    const panels = await panelOpened;
    await panels.getByRole('tab', { name: 'History', exact: true }).click();
    const history = panels.locator('[role="tabpanel"][data-state="active"]');
    await expect(history).toContainText('Alpha', { timeout: 30_000 });

    await tabNamed(page, 'Beta').click({ button: 'right' });
    const editorOpened = context.waitForEvent('page');
    await page.getByRole('menuitem', { name: 'Move to new window' }).click();
    const moved = await editorOpened;
    await expect(moved.locator('[data-element-id="tabs_beta_rect"]')).toBeVisible({ timeout: 60_000 });
    // Time for a second host to have announced itself, had there been one.
    await moved.waitForTimeout(1_500);
    await expect(history).toContainText('Alpha');
    await expect(history).not.toContainText('Beta');

    // And closing that window leaves them open.
    await moved.close();
    await page.waitForTimeout(1_000);
    expect(panels.isClosed()).toBe(false);
    await expect(history).toContainText('Alpha');
  });

  test('a move into a tab that closes on the way loses nothing, and keeps the project until it is done', async ({
    app,
    page,
    context,
  }) => {
    await alphaWithBetaAsleep(app, page);
    await app.board(0).locator('[data-element-id="tabs_alpha_rect"]').click({ button: 'right' });
    const menu = page.locator('[data-canvas-context-menu]');
    await menu.getByRole('button', { name: 'Move to tab' }).hover();
    // With the project store held, the move stops while it reads Beta.
    const hold = await holdProjects(page);
    let second: Page | null = null;
    try {
      await menu.getByRole('menuitem', { name: 'Beta' }).click();
      await tabNamed(page, 'Beta').getByRole('button', { name: 'Close Beta' }).click();
      await expect(tabs(page)).toHaveCount(1);

      // Another window asks for Beta while the move still has it, and asks
      // for it to be moved there.
      second = await context.newPage();
      await second.goto('/?projectId=tabs_beta', { waitUntil: 'domcontentloaded' });
      const dialog = second.getByRole('alertdialog').filter({ hasText: 'This project is open in another window' });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await dialog.getByRole('button', { name: 'Move it here' }).click();
    } finally {
      await hold.release();
    }

    // Beta's tab went before the move wrote anything, so nothing moved.
    await expect(page.getByText('Beta could not take the layers', { exact: true }).first()).toBeVisible();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
    // The other window gets Beta once the move has let go of it.
    const elsewhere = second as Page;
    await expect(elsewhere.locator('[data-element-id="tabs_beta_rect"]')).toBeVisible({ timeout: 30_000 });
    await expect(elsewhere.locator('[data-artboard-dom-id]').first().locator('[data-element-id]')).toHaveCount(1);
    expect((await storedBoards(page, 'tabs_alpha'))[0].elements.map((element) => element.id)).toEqual([
      'tabs_alpha_rect',
    ]);
  });

  test('a project whose tab closed while the next one was read opens in another window', async ({
    app,
    page,
    context,
  }) => {
    await alphaWithBetaAsleep(app, page);
    // Beta opens from storage, and Alpha stays on the canvas until it is read.
    await tabNamed(page, 'Alpha').getByRole('button', { name: 'Close Alpha' }).click();
    await expect(activeTab(page)).toContainText('Beta');
    await expect(app.board(0).locator('[data-element-id="tabs_beta_rect"]')).toBeVisible();

    const second = await context.newPage();
    await second.goto('/?projectId=tabs_alpha', { waitUntil: 'domcontentloaded' });
    await expect(second.locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible({ timeout: 60_000 });
  });

  test('a project open in another window is asked for, then moved here', async ({ app, page, context }) => {
    await openAlphaWithBetaStored(app, page);

    // A second window of the editor, opening the same project.
    const second = await context.newPage();
    await second.goto('/?projectId=tabs_alpha', { waitUntil: 'domcontentloaded' });
    const dialog = second.getByRole('alertdialog').filter({ hasText: 'This project is open in another window' });
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    await dialog.getByRole('button', { name: 'Move it here' }).click();
    await expect(second.locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible({ timeout: 30_000 });
    await expect(second.locator('[data-project-tabs] [role="tab"][aria-selected="true"]')).toContainText('Alpha');
    // The first window let go of it.
    await expect(tabs(page)).toHaveCount(0);
  });

  /** Alpha moved out of the main window into a popup of its own, Beta left behind. */
  async function alphaInItsOwnWindow(app: Editor, page: Page, context: BrowserContext): Promise<Page> {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click({ button: 'right' });
    const popupOpened = context.waitForEvent('page');
    await page.getByRole('menuitem', { name: 'Move to new window' }).click();
    const popup = await popupOpened;
    await expect(popup.locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible({ timeout: 60_000 });
    await expect(tabs(page)).toHaveCount(1);
    return popup;
  }

  test('a tab moved to a new window while it is being read stays out of this one, and the canvas keeps its undo', async ({
    app,
    page,
    context,
  }) => {
    await alphaWithBetaAsleep(app, page);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);

    // Beta is read from storage as it opens, and the hold stops that read.
    const hold = await holdProjects(page);
    let opened: Page | null = null;
    try {
      await tabNamed(page, 'Beta').click();
      await tabNamed(page, 'Beta').click({ button: 'right' });
      const popupOpened = context.waitForEvent('page');
      await page.getByRole('menuitem', { name: 'Move to new window' }).click();
      opened = await popupOpened;
      await expect(tabs(page)).toHaveCount(1);
    } finally {
      await hold.release();
    }
    const popup = opened as Page;
    await expect(popup.locator('[data-element-id="tabs_beta_rect"]')).toBeVisible({ timeout: 60_000 });

    // The read this window started for Beta never puts it back here.
    await page.waitForTimeout(1_000);
    await expect(app.board(0).locator('[data-element-id="tabs_beta_rect"]')).toHaveCount(0);
    await expect(activeTab(page)).toContainText('Alpha');
    // Alpha never left the canvas, so its undo history is still here.
    await undo(app, page);
    await expect(app.elementsOn(0)).toHaveCount(1);
  });

  test('a tab moved to its own window goes back from its menu', async ({ app, page, context }) => {
    const popup = await alphaInItsOwnWindow(app, page, context);
    await tabs(popup).filter({ hasText: 'Alpha' }).click({ button: 'right' });
    const back = popup.getByRole('menuitem', { name: /Main window/ });
    await expect(back).toBeVisible();
    const closed = popup.waitForEvent('close');
    await back.click();
    // Its window had nothing else, so it closes.
    await closed;
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible({ timeout: 30_000 });
  });

  test('a tab dragged out of its window and let go over another moves there', async ({ app, page, context }) => {
    const popup = await alphaInItsOwnWindow(app, page, context);
    // Headless windows all sit in the corner of one screen. Put the main window
    // to the right of the popup, the way two windows on a desk would be.
    const popupSize = await popup.evaluate(() => ({ width: window.outerWidth || window.innerWidth }));
    const mainLeft = popupSize.width + 100;
    await page.evaluate((left) => {
      Object.defineProperty(window, 'screenX', { get: () => left, configurable: true });
      Object.defineProperty(window, 'screenY', { get: () => 0, configurable: true });
    }, mainLeft);

    const tab = tabs(popup).filter({ hasText: 'Alpha' });
    const box = await tab.boundingBox();
    if (!box) throw new Error('no tab to drag');
    await popup.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await popup.mouse.down();
    await popup.mouse.move(box.x + box.width / 2 + 10, box.y + 120, { steps: 4 });
    await expect(popup.locator('[data-tab-tear-card]')).toContainText('Drop it on another window');
    // Out past the popup's right edge, over the main window.
    await popup.mouse.move(mainLeft + 300, 300, { steps: 12 });
    await expect(page.locator('[data-incoming-tab]')).toContainText('Let go to move Alpha here');
    await expect(popup.locator('[data-tab-tear-card]')).toContainText('the main window');
    const closed = popup.waitForEvent('close');
    await popup.mouse.up();
    await closed;
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(page.locator('[data-incoming-tab]')).toHaveCount(0);
  });

  test('where a dragged tab is let go decides where it lands, not where it was a moment before', async ({
    app,
    page,
    context,
  }) => {
    const popup = await alphaInItsOwnWindow(app, page, context);
    const popupSize = await popup.evaluate(() => ({ width: window.outerWidth || window.innerWidth }));
    const mainLeft = popupSize.width + 100;
    const mainWidth = await page.evaluate((left) => {
      Object.defineProperty(window, 'screenX', { get: () => left, configurable: true });
      Object.defineProperty(window, 'screenY', { get: () => 0, configurable: true });
      return window.outerWidth || window.innerWidth;
    }, mainLeft);

    const tab = tabs(popup).filter({ hasText: 'Alpha' });
    const box = await tab.boundingBox();
    if (!box) throw new Error('no tab to drag');
    await popup.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await popup.mouse.down();
    await popup.mouse.move(box.x + box.width / 2 + 10, box.y + 120, { steps: 4 });
    await popup.mouse.move(mainLeft + 300, 300, { steps: 12 });
    await expect(page.locator('[data-incoming-tab]')).toBeVisible();
    // Past the main window's far edge, over no window, and let go in the same
    // moment, before a frame can look at where the pointer went. The popup sits
    // at the screen's corner, so its client and screen pixels agree.
    await tab.evaluate((element, x) => {
      const at = { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, clientX: x, clientY: 300, screenX: x, screenY: 300 };
      element.dispatchEvent(new PointerEvent('pointermove', { ...at, buttons: 1 }));
      element.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 }));
    }, mainLeft + mainWidth + 400);
    await popup.mouse.up();

    await expect(page.locator('[data-incoming-tab]')).toHaveCount(0);
    // The tab stayed, so its window did too.
    await page.waitForTimeout(1_000);
    expect(popup.isClosed()).toBe(false);
    await expect(tabs(popup)).toHaveCount(1);
    await expect(tabs(page)).toHaveCount(1);
  });

  test('an open from the account stops when its tab moves to another window first, and writes nothing there', async ({
    app,
    page,
    context,
  }) => {
    await signInToGistsWith(page, context, 'tabs_beta', 'Beta');
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();

    // The copy in the account is opened over Beta's. Holding the media store
    // stops that open after it has claimed Beta, while it writes Beta's
    // picture, which comes before Beta itself.
    const hold = await holdProjects(page, 'media');
    let opened: Page | null = null;
    try {
      // Signed in, the Account button is named after the account.
      await page.getByRole('button', { name: /E2E Tester$/ }).first().click();
      await page.getByTitle('Open this project').click();
      await expect(page.getByText('Saving media 1 of 1').first()).toBeVisible({ timeout: 30_000 });
      // Beta moves to a window of its own meanwhile, and opens there.
      await tabNamed(page, 'Beta').click({ button: 'right' });
      const popupOpened = context.waitForEvent('page');
      await page.getByRole('menuitem', { name: 'Move to new window' }).click();
      opened = await popupOpened;
      await expect(opened.locator('[data-element-id="tabs_beta_rect"]')).toBeVisible({ timeout: 60_000 });
    } finally {
      await hold.release();
    }
    const popup = opened as Page;

    // The open from the account stopped before it wrote Beta, which the other
    // window has now, and says why rather than finding Beta open elsewhere.
    const toast = page.getByText('Beta did not open here', { exact: true }).first();
    const elsewhere = page.getByRole('alertdialog').filter({ hasText: 'This project is open in another window' });
    await expect(toast.or(elsewhere)).toBeVisible({ timeout: 30_000 });
    expect((await storedBoards(page, 'tabs_beta'))[0].elements.map((element) => element.id)).toEqual(['tabs_beta_rect']);
    await expect(toast).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(popup.locator('[data-element-id="tabs_beta_account_rect"]')).toHaveCount(0);
  });

  test('a project moved to a new window as it opens leaves this window, and its address, on the next tab', async ({
    app,
    page,
    context,
  }) => {
    await openAlphaWithBetaStored(app, page);
    await strip(page).getByRole('button', { name: 'New tab', exact: true }).click();
    await app.waitForStartDialogReady();
    await app.startDialog.getByRole('tab', { name: /App Screenshots/ }).click();

    // A template opens the way a file, the account and the cloud do, and its
    // last read is the list of recent projects, after the template is on the
    // canvas. Holding the project store walks it there one read at a time.
    const hold = await holdProjects(page);
    let opened: Page | null = null;
    try {
      await app.startDialog.getByAltText('Somnia Sleep', { exact: true }).click();
      await expect
        .poll(
          async () => {
            if ((await activeTab(page).textContent())?.includes('Somnia Sleep') && !(await app.startDialog.isVisible())) {
              return true;
            }
            await hold.handOver();
            return false;
          },
          { intervals: [500], timeout: 30_000 }
        )
        .toBe(true);
      // It moves to a window of its own before that read is answered.
      await activeTab(page).click({ button: 'right' });
      const popupOpened = context.waitForEvent('page');
      await page.getByRole('menuitem', { name: 'Move to new window' }).click();
      opened = await popupOpened;
    } finally {
      await hold.release();
    }
    const popup = opened as Page;
    await expect(popup.locator('[data-project-tabs] [role="tab"]')).toContainText('Somnia Sleep', { timeout: 60_000 });

    // This window shows Alpha, and so does its address, which a reload opens.
    await expect(activeTab(page)).toContainText('Alpha');
    const moved = new URL(popup.url()).searchParams.get('projectId');
    expect(moved).toBeTruthy();
    expect(new URL(page.url()).searchParams.get('projectId')).toBe('tabs_alpha');
  });

  test('a project opened again here while its tab moves to another window is asked about, not opened twice', async ({
    app,
    page,
    context,
  }) => {
    await openAlphaWithBetaStored(app, page);
    await openBetaInNewTab(app, page);
    await tabNamed(page, 'Alpha').click();
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();

    // Holding the undo stacks stops Beta's move once its tab has gone, while
    // its undo stack is written and this window still holds its lock.
    const hold = await holdUndoStacks(page);
    let opened: Page | null = null;
    try {
      await tabNamed(page, 'Beta').click({ button: 'right' });
      const popupOpened = context.waitForEvent('page');
      await page.getByRole('menuitem', { name: 'Move to new window' }).click();
      opened = await popupOpened;
      await expect(tabs(page)).toHaveCount(1);
      // Beta opened again here, out of Recent projects.
      await strip(page).getByRole('button', { name: 'New tab', exact: true }).click();
      await app.waitForStartDialogReady();
      await app.startDialog.getByText('Beta', { exact: true }).click();
      // And the new window waiting for Beta's lock by now.
      await expect
        .poll(
          () =>
            page.evaluate(async (name) => {
              const state = await navigator.locks.query();
              return (state.pending ?? []).some((lock) => lock.name === name);
            }, 'open-screenshot-generator.project:tabs_beta'),
          { timeout: 60_000 }
        )
        .toBe(true);
    } finally {
      await hold.release();
    }
    const popup = opened as Page;
    await expect(popup.locator('[data-element-id="tabs_beta_rect"]')).toBeVisible({ timeout: 60_000 });

    // Beta is that window's, so this one asks about it instead of opening it too.
    const elsewhere = page.getByRole('alertdialog').filter({ hasText: 'This project is open in another window' });
    await expect(elsewhere).toBeVisible();
    await expect(page.locator('[data-element-id="tabs_beta_rect"]')).toHaveCount(0);
    // The question hides the strip from the accessibility tree while it is up.
    await elsewhere.getByRole('button', { name: 'Cancel' }).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page)).toContainText('Alpha');
    await expect(app.board(0).locator('[data-element-id="tabs_alpha_rect"]')).toBeVisible();
  });
});
