import type { Download, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';
import { readProjects, waitForProject } from '../fixtures/db';
import type { Editor } from '../helpers/editor';
import type { ArtboardState } from '../../../src/types/artboard';

/** A stored project's artboards; the fixture types them as unknown. */
function boards(project: { projectData: unknown }): ArtboardState[] {
  return (project.projectData ?? []) as ArtboardState[];
}

/**
 * The Every device view (devices/EveryDeviceDialog.tsx): the design laid out
 * again for each store size, a layout picked for one artboard, a screenshot
 * added for one device, and a device's set exported with the project or
 * opened as a project of its own. What it writes is checked in the project
 * row, because that is what survives a reload.
 */

test.use({ actionTimeout: 45_000 });
test.describe.configure({ timeout: 240_000 });

function everyDevice(page: Page): Locator {
  return page.locator('[data-every-device]');
}

async function openEveryDevice(page: Page): Promise<void> {
  await page.getByTitle(/^Convert the project to another device format/).click();
  await page.getByRole('menuitem', { name: /^Every device/ }).click();
  await expect(everyDevice(page)).toBeVisible();
}

async function pickDevice(page: Page, name: string): Promise<void> {
  await everyDevice(page).locator('[data-device-choice]').filter({ hasText: name }).first().click();
  await expect(everyDevice(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

/** A multi-board template with phones on most of its artboards. */
async function openBudgetly(app: Editor): Promise<void> {
  await app.startDialog.getByRole('tab', { name: /App Screenshots/ }).click();
  await app.startDialog.getByAltText('Budgetly Finance', { exact: true }).click();
  await expect(app.startDialog).toBeHidden({ timeout: 30_000 });
  await expect(app.artboards.first()).toBeVisible({ timeout: 30_000 });
}

/** A plain PNG of the given size, drawn in the page. */
async function pngOfSize(page: Page, width: number, height: number): Promise<Buffer> {
  const data = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#2f855a';
      context.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/png');
    },
    [width, height]
  );
  return Buffer.from(data.split(',')[1], 'base64');
}

/** Whether this browser can put a Blob into IndexedDB (see capture.spec.ts and the e2e README). */
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

const NO_BLOBS = 'Playwright WebKit cannot store the screenshot Blob in IndexedDB; desktop-chromium runs this';

/** Width over height of the screens drawn in one artboard's preview, unturned. */
async function screenShapes(card: Locator): Promise<number[]> {
  return card.locator('[data-device-screen]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).offsetWidth / Math.max(1, (node as HTMLElement).offsetHeight))
  );
}

test.describe('the Every device view', () => {
  test('lays the design out for the iPad, and an iPad screenshot turns that phone into an iPad', async ({ app, page }) => {
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await openBudgetly(app);
    await openEveryDevice(page);

    // It opens on the iPad, the first device that is not the design's own.
    await expect(everyDevice(page).getByRole('heading', { name: 'iPad 13-inch', exact: true })).toBeVisible();
    const iphone = everyDevice(page).locator('[data-device-choice]').filter({ hasText: 'iPhone' }).first();
    await expect(iphone).toContainText('Your original');
    const ipad = everyDevice(page).locator('[data-device-choice]').filter({ hasText: 'iPad 13-inch' });
    await expect(ipad).toContainText('Needs iPad screenshots');

    // The artboard with a phone on it: a phone screen, then an iPad screen.
    // Pinned by position: the button the card is found by becomes Replace.
    const figures = everyDevice(page).locator('figure');
    const index = await figures.evaluateAll((nodes) =>
      nodes.findIndex((node) => [...node.querySelectorAll('button')].some((button) => /^Add a screenshot from an iPad/.test((button.textContent ?? '').trim())))
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const card = figures.nth(index);
    const before = await screenShapes(card);
    expect(before.length).toBeGreaterThan(0);
    expect(before[0]).toBeLessThan(0.6);

    const chooser = page.waitForEvent('filechooser');
    await card.getByRole('button', { name: /^Add a screenshot from an iPad/ }).click();
    await (await chooser).setFiles({ name: 'ipad.png', mimeType: 'image/png', buffer: await pngOfSize(page, 2064, 2752) });

    await expect(card.getByRole('button', { name: /^Change the iPad screenshot/ })).toBeVisible();
    await expect.poll(async () => (await screenShapes(card))[0], { timeout: 15_000 }).toBeGreaterThan(0.65);
    await waitForProject(page, (project) =>
      boards(project).some((board) =>
        Object.values(board.deviceSets?.['ipad-pro-13']?.screens ?? {}).some((screen) => screen?.naturalScreenshotWidth === 2064)
      )
    );

    // Removing it puts the phone back.
    await card.getByRole('button', { name: 'Remove the iPad screenshot' }).click();
    await expect(card.getByRole('button', { name: /^Add a screenshot from an iPad/ })).toBeVisible();
    await expect.poll(async () => (await screenShapes(card))[0], { timeout: 15_000 }).toBeLessThan(0.6);
  });

  test('a screenshot that takes a while to store keeps the changes made meanwhile', async ({ app, page }) => {
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await openBudgetly(app);
    await openEveryDevice(page);

    // Holds the picture's size probe, the first step of storing it. Patched on
    // the prototype, which WebKit keeps (a property set on one object it can drop).
    await page.evaluate(() => {
      const win = window as unknown as { __holdProbe: boolean; __heldProbes: Array<() => void> };
      win.__holdProbe = true;
      win.__heldProbes = [];
      const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        get(this: HTMLImageElement) {
          return source.get!.call(this);
        },
        set(this: HTMLImageElement, value: string) {
          if (win.__holdProbe && String(value).startsWith('blob:')) win.__heldProbes.push(() => source.set!.call(this, value));
          else source.set!.call(this, value);
        },
      });
    });

    const figures = everyDevice(page).locator('figure');
    const index = await figures.evaluateAll((nodes) =>
      nodes.findIndex((node) => [...node.querySelectorAll('button')].some((button) => /^Add a screenshot from an iPad/.test((button.textContent ?? '').trim())))
    );
    const card = figures.nth(index);
    const chooser = page.waitForEvent('filechooser');
    await card.getByRole('button', { name: /^Add a screenshot from an iPad/ }).click();
    await (await chooser).setFiles({ name: 'ipad.png', mimeType: 'image/png', buffer: await pngOfSize(page, 2064, 2752) });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __heldProbes: unknown[] }).__heldProbes.length))
      .toBeGreaterThan(0);

    // Meanwhile, the Android phone set is switched on.
    await everyDevice(page).getByRole('switch', { name: 'Export Android phone screenshots too' }).click();
    await waitForProject(page, (project) => boards(project).every((board) => board.deviceSetFormats?.includes('android')));

    await page.evaluate(() => {
      const win = window as unknown as { __holdProbe: boolean; __heldProbes: Array<() => void> };
      win.__holdProbe = false;
      for (const release of win.__heldProbes.splice(0)) release();
    });
    await expect(card.getByRole('button', { name: /^Change the iPad screenshot/ })).toBeVisible();
    const after = await waitForProject(page, (project) =>
      boards(project).some((board) =>
        Object.values(board.deviceSets?.['ipad-pro-13']?.screens ?? {}).some((screen) => screen?.naturalScreenshotWidth === 2064)
      )
    );
    // The screenshot landed on the project as it is now, not as it was when
    // the upload began.
    expect(boards(after).every((board) => board.deviceSetFormats?.includes('android'))).toBe(true);
  });

  test('a layout picked for one artboard is kept on it, and undo takes it back', async ({ app, page }) => {
    await openBudgetly(app);
    await openEveryDevice(page);
    await pickDevice(page, 'Mac');

    const picker = everyDevice(page).getByRole('radiogroup', { name: 'Layout of Smart Finance' });
    await expect(picker.getByRole('radio', { name: 'Text on the left (our pick)' })).toHaveAttribute('aria-checked', 'true');
    await picker.getByRole('radio', { name: 'Text on the right' }).click();
    await expect(picker.getByRole('radio', { name: 'Text on the right' })).toHaveAttribute('aria-checked', 'true');
    await waitForProject(page, (project) =>
      boards(project).some((board) => board.name === 'Smart Finance' && board.deviceSets?.mac?.layout === 'beside-flipped')
    );

    await page.keyboard.press('Escape');
    await expect(everyDevice(page)).toBeHidden();
    await app.undoButton.click();
    await waitForProject(page, (project) =>
      boards(project).every((board) => board.name !== 'Smart Finance' || !board.deviceSets?.mac)
    );

    // Back in the view, the artboard is on the layout picked for it again.
    await openEveryDevice(page);
    await pickDevice(page, 'Mac');
    await expect(
      everyDevice(page)
        .getByRole('radiogroup', { name: 'Layout of Smart Finance' })
        .getByRole('radio', { name: 'Text on the left (our pick)' })
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('a device switched on exports its set with the project', async ({ app, page, tauri, isDesktop }) => {
    const downloads: Download[] = [];
    page.on('download', (download) => downloads.push(download));
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('Device Mockups');
    await app.addElement('iPhone', 'device:iphone');
    await openEveryDevice(page);
    await pickDevice(page, 'Android phone');

    await everyDevice(page).getByRole('switch', { name: 'Export Android phone screenshots too' }).click();
    await waitForProject(page, (project) =>
      boards(project).every((board) => board.deviceSetFormats?.includes('android'))
    );
    await expect(everyDevice(page)).toContainText('When you export, you also get: Android phone.');

    await everyDevice(page).getByRole('button', { name: 'Export', exact: true }).click();
    await expect(everyDevice(page)).toBeHidden();
    await expect(app.exportDialog).toBeVisible();
    await expect(page.locator('#gen-android')).toBeChecked();
    await page.locator('#export-as-is').click();
    await expect(page.getByText(/^\d+ PNG files?$/)).toHaveText('1 PNG file');
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

    const names = await exportedNames(isDesktop, tauri, downloads, 1);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/1080x1920\.png$/);
    // The project itself is still the iPhone size it was.
    await expect(app.canvasSizeButton).toHaveAttribute('title', /1206 × 2622/);
  });

  test('Make an iPad 13-inch project makes the iPad set a project of its own', async ({ app, page }) => {
    await openBudgetly(app);
    const source = await waitForProject(page, (project) => project.name.startsWith('Budgetly'));
    await openEveryDevice(page);

    await everyDevice(page).getByRole('button', { name: 'Make an iPad 13-inch project' }).click();
    await expect(everyDevice(page)).toBeHidden({ timeout: 30_000 });
    const made = await waitForProject(
      page,
      (project) => project.name.endsWith('(iPad 13-inch)') && boards(project).length > 0,
      30_000
    );
    for (const board of boards(made)) {
      if (board.creativeAsset) continue;
      expect([board.size.width, board.size.height]).toEqual([2064, 2752]);
      expect(board.deviceSets).toBeUndefined();
    }
    await expect(app.canvasSizeButton).toHaveAttribute('title', /2064 × 2752/);

    // The new project keeps phone frames for its phone screenshots, and is
    // still the iPad's: its own device is read from its size.
    await openEveryDevice(page);
    await expect(everyDevice(page).locator('[data-device-choice]').filter({ hasText: 'iPad 13-inch' })).toContainText('Your original');
    await expect(everyDevice(page).locator('[data-device-choice]').filter({ hasText: /^iPhone/ }).first()).not.toContainText('Your original');
    await expect(everyDevice(page).getByRole('switch', { name: 'Export iPhone screenshots too' })).toBeVisible();
    await page.keyboard.press('Escape');

    // The project it came from is as it was.
    const projects = await readProjects(page);
    const original = projects.find((project) => project.id === source.id);
    expect(original ? boards(original)[0].size : null).toEqual({ width: 1206, height: 2622 });
  });

  test('an iPad project asks for an iPhone screenshot where its iPad one would be cut off', async ({ app, page }) => {
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await openBudgetly(app);
    await openEveryDevice(page);

    // One iPad screenshot, then the iPad set as a project of its own.
    const card = everyDevice(page).locator('figure').filter({ has: page.getByRole('button', { name: /^Add a screenshot from an iPad/ }) }).first();
    const chooser = page.waitForEvent('filechooser');
    await card.getByRole('button', { name: /^Add a screenshot from an iPad/ }).first().click();
    await (await chooser).setFiles({ name: 'ipad.png', mimeType: 'image/png', buffer: await pngOfSize(page, 2064, 2752) });
    await waitForProject(page, (project) =>
      boards(project).some((board) => Object.values(board.deviceSets?.['ipad-pro-13']?.screens ?? {}).some((screen) => !!screen))
    );
    await everyDevice(page).getByRole('button', { name: 'Make an iPad 13-inch project' }).click();
    await expect(everyDevice(page)).toBeHidden({ timeout: 30_000 });
    await expect(app.canvasSizeButton).toHaveAttribute('title', /2064 × 2752/);

    // On the iPhone, that screenshot is the one that asks for its own.
    await openEveryDevice(page);
    await pickDevice(page, 'iPhone');
    await expect(everyDevice(page).locator('[data-device-choice]').filter({ hasText: /^iPhone/ }).first()).toContainText('Needs iPhone screenshots');
    await expect(everyDevice(page)).toContainText(
      "One of your screenshots doesn't fit an iPhone screen, so its edges get cut off. To fix this, add a screenshot from an iPhone under it."
    );
    const asks = everyDevice(page).getByRole('button', { name: /^Add a screenshot from an iPhone/ });
    await expect(asks).toHaveCount(1);

    const phoneChooser = page.waitForEvent('filechooser');
    await asks.click();
    await (await phoneChooser).setFiles({ name: 'iphone.png', mimeType: 'image/png', buffer: await pngOfSize(page, 1206, 2622) });
    await expect(everyDevice(page).getByRole('button', { name: /^Change the iPhone screenshot/ })).toBeVisible();
    await expect(everyDevice(page).locator('[data-device-choice]').filter({ hasText: /^iPhone/ }).first()).not.toContainText('Needs iPhone screenshots');
  });
});

async function exportedNames(isDesktop: boolean, tauri: TauriHarness, downloads: Download[], count: number): Promise<string[]> {
  if (isDesktop) {
    const files = await tauri.waitForFiles(count, 120_000);
    return files.map((file) => file.path.split('/').pop() ?? file.path);
  }
  await expect.poll(() => downloads.length, { timeout: 120_000 }).toBeGreaterThanOrEqual(count);
  return downloads.map((download) => download.suggestedFilename());
}
