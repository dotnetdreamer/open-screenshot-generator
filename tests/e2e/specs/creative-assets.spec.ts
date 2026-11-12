import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Download, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';
import { put, waitForProject } from '../fixtures/db';
import { centreOf, expectBoardSize, fingerDragTile } from '../helpers/canvas';
import type { Editor } from '../helpers/editor';

/**
 * App Store header and search art, new in iOS 27 (src/lib/creative).
 *
 * The art lives in the same project as the screenshots, so most of what can
 * break is somewhere else: a Canvas Size change, an export, the store mockup.
 * Each test adds the art through the toolbar the way a user does and then
 * asserts on one of those neighbours.
 */

function creativeDialog(page: Page) {
  return page.getByRole('dialog').filter({ hasText: 'App Store header and search' });
}

/** The toolbar's + menu, default looks, Add. Leaves the header selected. */
async function addHeaderAndSearch(app: Editor, page: Page, boardsAfter = 3): Promise<void> {
  await app.create('App Store header and search art');
  const dialog = creativeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Product page header' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Search results' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add 2 artboards', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(app.artboards).toHaveCount(boardsAfter);
}

/** Put one project into the database and open it. Seeding needs the app's own schema in place first. */
async function openStoredProject(app: Editor, page: Page, id: string, name: string, boards: unknown[]): Promise<void> {
  await expect(app.startDialog).toBeVisible();
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
  await put(page, 'projects', { id, name, timestamp: new Date('2026-11-12T10:00:00.000Z'), projectData: boards });
  await app.goto(`/?projectId=${id}`);
  await expect(app.artboards).toHaveCount(boards.length, { timeout: 45_000 });
}

/** A screenshot artboard with one headline, set in `fontFamily`. */
function screenshotBoard(fontFamily: string): Record<string, unknown> {
  return {
    id: 'creative_type_board',
    name: 'Screenshot',
    size: { width: 1206, height: 2622 },
    backgroundColor: '#14213D',
    zoom: 1,
    position: { x: 50, y: 50 },
    elements: [
      {
        id: 'creative_type_headline',
        type: 'text',
        name: 'Headline',
        position: { x: 103, y: 300 },
        size: { width: 1000, height: 1200 },
        rotation: 0,
        scale: 1,
        content: 'Calm mornings for the whole family',
        fontSize: 48,
        color: '#FFFFFF',
        fontFamily,
        fontWeight: '700',
        textAlign: 'center',
        lineHeight: 1.2,
      },
    ],
  };
}

/**
 * Open a stored project whose one screenshot sets its headline in `fontFamily`,
 * so the designs take that face too. The headline is too long to sit under a
 * name on the universal image, which leaves the name on its own there.
 */
async function openHeadlineProject(app: Editor, page: Page, fontFamily: string): Promise<void> {
  await openStoredProject(app, page, 'creative_type', 'Mommy Mornings', [screenshotBoard(fontFamily)]);
  await expect(app.board(0).locator('[data-element-id="creative_type_headline"]')).toBeVisible({ timeout: 45_000 });
}

/**
 * Search art the way the first designs laid it out, before they were sized for
 * an iPhone: an eyebrow with the app name, the headline, a line under it and
 * the phone, all inside the safe area. The headline is the user's own.
 */
function firstDesignSearchBoard(): Record<string, unknown> {
  const layer = { rotation: 0, scale: 1, fontFamily: 'Arial', textAlign: 'left' };
  return {
    id: 'artboard_old1s_search',
    name: 'Search results',
    size: { width: 3840, height: 2560 },
    backgroundColor: '#1E1B4B',
    zoom: 1,
    position: { x: 50, y: 50 },
    creativeAsset: 'search',
    elements: [
      {
        ...layer,
        id: 'cr-old1s-search-name',
        type: 'text',
        name: 'App name',
        position: { x: 966, y: 880 },
        size: { width: 1000, height: 70 },
        content: 'Mommy Mornings',
        fontSize: 13.5,
        color: '#C7D2FE',
        fontWeight: '600',
        lineHeight: 1.2,
      },
      {
        ...layer,
        id: 'cr-old1s-search-headline',
        type: 'text',
        name: 'Headline',
        position: { x: 966, y: 965 },
        size: { width: 1100, height: 330 },
        content: 'Plan your day\nyour own way',
        fontSize: 42,
        color: '#FDE68A',
        fontWeight: '700',
        lineHeight: 1.1,
      },
      {
        ...layer,
        id: 'cr-old1s-search-subhead',
        type: 'text',
        name: 'Subheadline',
        position: { x: 966, y: 1320 },
        size: { width: 1100, height: 90 },
        content: 'Mornings that start themselves',
        fontSize: 17,
        color: '#A5B4FC',
        fontWeight: '400',
        lineHeight: 1.3,
      },
      {
        id: 'cr-old1s-search-phone',
        type: 'device',
        name: 'Phone',
        deviceType: 'iphone-16-pro',
        styleType: 'normal',
        position: { x: 2250, y: 844 },
        size: { width: 500, height: 1060 },
        rotation: 0,
        scale: 1,
        screenshotSrc: '/data/projects/fg-screens/fg-cards-dark.png',
        screenshotObjectFit: 'cover',
      },
    ],
  };
}

/** What the page drew for each text layer of the generated designs. */
function drawnText(app: Editor): Promise<{ text: string; lines: number; overflow: number }[]> {
  return app.artboards.locator('[data-element-id^="cr-"] [data-text-body]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const tops = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
      const box = node as HTMLElement;
      return {
        text: (node.textContent ?? '').replace(/\s+/g, ' '),
        lines: tops.size,
        // The height of the lines, with the box's padding, over the height of
        // the box that clips them. By line height, because a face's own
        // ascent and descent say nothing about where its lines fall.
        overflow: (tops.size * parseFloat(getComputedStyle(box).lineHeight) + 4) / box.offsetHeight,
      };
    })
  );
}

/**
 * A real font file: the Noto Sans that Next carries for its social images.
 * The suite runs offline and the repo keeps no font files.
 */
const NOTO_SANS_FILE = path.resolve('node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf');

/**
 * One built-in family whose font file is kept from the page until `release`.
 * It is Noto Sans drawn a quarter oversize, so copy fitted in the fallback is
 * too wide for its box once the real face arrives. The stylesheet that
 * declares it is answered here as well, because the suite runs offline.
 */
async function holdFace(context: BrowserContext, family: string): Promise<{ release: () => void }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cors = { 'access-control-allow-origin': '*' };
  const file = readFileSync(NOTO_SANS_FILE);
  await context.route('https://fonts.gstatic.com/**', async (route) => {
    await released;
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'font/ttf' }, body: file });
  });
  await context.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/css' },
      body: ['400', '700']
        .map(
          (weight) =>
            `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; size-adjust: 125%; src: url(https://fonts.gstatic.com/e2e/late-${weight}.ttf) format('truetype'); }`
        )
        .join('\n'),
    })
  );
  return { release };
}

function collectDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  return downloads;
}

async function exportedNames(isDesktop: boolean, tauri: TauriHarness, downloads: Download[], count: number): Promise<string[]> {
  if (isDesktop) {
    const files = await tauri.waitForFiles(count, 180_000);
    return files.map((file) => file.path.split('/').pop() ?? file.path);
  }
  await expect.poll(() => downloads.length, { timeout: 180_000 }).toBeGreaterThanOrEqual(count);
  return downloads.map((download) => download.suggestedFilename());
}

/** Width, height and colour type from IHDR. 2 is RGB with no alpha channel. */
function pngHeader(path: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

test.describe('App Store header and search art', () => {
  test("lands at the front of the canvas at Apple's sizes, with the safe area drawn and the check passing", async ({ app, page }) => {
    await app.startBlankProject();
    await addHeaderAndSearch(app, page);

    await expectBoardSize(app.board(0), 3840, 1646);
    await expectBoardSize(app.board(1), 3840, 2560);
    await expectBoardSize(app.board(2), 1206, 2622);
    // One guide per creative artboard, none on the screenshot.
    await expect(page.getByText('Art safe area', { exact: true })).toHaveCount(2);

    const badge = page.getByTitle('App Store check for the product page header');
    await expect(badge).toContainText('Ready');
    await badge.click();
    await expect(page.getByText('Ready for App Store Connect', { exact: true })).toBeVisible();

    await waitForProject(page, (project) => {
      const boards = project.projectData as { creativeAsset?: string }[];
      return boards?.[0]?.creativeAsset === 'header' && boards[1]?.creativeAsset === 'search' && !boards[2]?.creativeAsset;
    });
  });

  test("keeps Apple's size when the canvas size changes", async ({ app, page }) => {
    await app.startBlankProject();
    await addHeaderAndSearch(app, page);
    // The header is selected, and the size button still names the screenshots.
    await expect(app.canvasSizeButton).toHaveAttribute('title', /1206 × 2622/);

    await app.canvasSizeButton.click();
    await expect(app.canvasSizeDialog).toBeVisible();
    await app.canvasSizeDialog.locator('#size-ios-6-9').click();
    await app.canvasSizeDialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(app.canvasSizeDialog).toBeHidden();

    await expectBoardSize(app.board(0), 3840, 1646);
    await expectBoardSize(app.board(1), 3840, 2560);
    await expectBoardSize(app.board(2), 1290, 2796);
  });

  test('the store listing opens with the header and shows the search art in place of three screenshots', async ({ app, page }) => {
    await app.startBlankProject();
    await addHeaderAndSearch(app, page);

    await app.chooseFromMenu(app.previewButton, /Store listing/i);
    const dialog = app.previewDialog;
    await expect(dialog).toBeVisible();
    // The carousel is screenshots only; the art has places of its own.
    await expect(dialog.getByText('1 screenshot', { exact: true })).toBeVisible();
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(1);
    await expect(dialog.getByText(/An iPhone shows this much of the header/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Search results', exact: true }).click();
    await expect(dialog.getByText(/Your search art takes the place of three screenshots here/)).toBeVisible();
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(0);
  });

  test('the store listing shows as much of the art as an iPhone does, not just the safe area', async ({ app, page }) => {
    await app.startBlankProject();
    await addHeaderAndSearch(app, page);
    // The canvas marks both areas on each piece of art.
    await expect(page.getByText('Shown on an iPhone', { exact: true })).toHaveCount(2);

    await app.chooseFromMenu(app.previewButton, /Store listing/i);
    const dialog = app.previewDialog;
    await expect(dialog).toBeVisible();

    /** The window the phone shows the art through, and the whole artboard drawn behind it. */
    const boxes = async (placement: 'header' | 'search') => {
      const window = dialog.locator(`[data-creative-crop="${placement}"]`);
      await expect(window).toBeVisible();
      const shown = (await window.boundingBox())!;
      const art = (await window.locator('[data-artboard-surface]').boundingBox())!;
      return { shown, art };
    };

    // A header shows top to bottom, with a strip cut from each side. Drawn to
    // the safe area instead, it would show well under half its width.
    const header = await boxes('header');
    expect(Math.abs(header.shown.height - header.art.height)).toBeLessThan(1.5);
    expect(header.shown.width / header.art.width).toBeGreaterThan(0.82);
    expect(header.shown.width / header.art.width).toBeLessThan(0.86);
    const centre = (box: { x: number; width: number }) => box.x + box.width / 2;
    expect(Math.abs(centre(header.shown) - centre(header.art))).toBeLessThan(1.5);

    // Search art shows edge to edge from its top, less a strip at the bottom.
    await dialog.getByRole('button', { name: 'Search results', exact: true }).click();
    const search = await boxes('search');
    expect(Math.abs(search.shown.width - search.art.width)).toBeLessThan(1.5);
    expect(Math.abs(search.shown.y - search.art.y)).toBeLessThan(1.5);
    expect(search.shown.height / search.art.height).toBeGreaterThan(0.82);
    expect(search.shown.height / search.art.height).toBeLessThan(0.86);
  });

  test('a listing with no art says what iOS 27 adds, and the way in opens the dialog', async ({ app, page }) => {
    await app.startBlankProject();
    await app.chooseFromMenu(app.previewButton, /Store listing/i);
    await expect(app.previewDialog.getByText('New in iOS 27', { exact: true })).toBeVisible();
    await app.previewDialog.getByRole('button', { name: 'Add header and search art', exact: true }).click();
    await expect(creativeDialog(page)).toBeVisible();
    // Cancelling goes back to the listing it came from.
    await creativeDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(app.previewDialog.getByText('New in iOS 27', { exact: true })).toBeVisible();
  });

  test('exports under the placement names, with the screenshots still numbered from 01', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.setTimeout(300_000);
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await addHeaderAndSearch(app, page);

    await app.openExportDialog();
    await expect(app.exportDialog.getByText('3 PNG files', { exact: true })).toBeVisible();
    await expect(app.exportDialog.getByText(/Includes 2 App Store header and search artboards/)).toBeVisible();
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

    const names = (await exportedNames(isDesktop, tauri, downloads, 3)).sort();
    expect(names).toEqual([
      '01_Blank_Artboard_iPhone-6_3-Portrait_1206x2622.png',
      'AppStore_Header_3840x1646.png',
      'AppStore_SearchResult_3840x2560.png',
    ]);

    if (!isDesktop) {
      const byName = new Map(downloads.map((download) => [download.suggestedFilename(), download]));
      // App Store Connect turns away a PNG that carries an alpha channel.
      expect(pngHeader(await byName.get('AppStore_Header_3840x1646.png')!.path())).toEqual({
        width: 3840,
        height: 1646,
        colorType: 2,
      });
      expect(pngHeader(await byName.get('AppStore_SearchResult_3840x2560.png')!.path())).toEqual({
        width: 3840,
        height: 2560,
        colorType: 2,
      });
    }
  });

  test("the sidebar's Header tab adds one design with a click, at the start of the canvas and with the name typed there", async ({
    app,
    page,
  }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Header').click();
    const tab = page.getByRole('tabpanel', { name: 'Header' });
    await expect(tab.getByRole('heading', { name: 'Product page header' })).toBeVisible();
    await expect(tab.getByRole('heading', { name: 'Search results' })).toBeVisible();
    await expect(tab.getByRole('heading', { name: 'Universal' })).toBeVisible();

    await tab.getByLabel('App name').fill('Somnia');
    await tab.getByRole('button', { name: 'Add the Wordmark header', exact: true }).click();

    await expect(app.artboards).toHaveCount(2);
    await expectBoardSize(app.board(0), 3840, 1646);
    await expectBoardSize(app.board(1), 1206, 2622);
    await expect(app.board(0).getByText('Somnia', { exact: true })).toBeVisible();
    await expect(page.getByTitle('App Store check for the product page header')).toContainText('Ready');
    await waitForProject(page, (project) => {
      const boards = project.projectData as { creativeAsset?: string }[];
      return boards?.length === 2 && boards[0]?.creativeAsset === 'header' && !boards[1]?.creativeAsset;
    });
  });

  test('a name in capitals is set whole, in a face that sets it wider than an average letter would', async ({ app, page }) => {
    // In Arial Bold this name is 9.7 ems wide. The designs sized it by an
    // average letter, which made it 8.7, so "MORNINGS" broke onto a line its
    // box had no room for and the box cut it off.
    await openHeadlineProject(app, page, 'Arial');
    await app.ensurePaletteOpen();
    await app.paletteTab('Header').click();
    const tab = page.getByRole('tabpanel', { name: 'Header' });
    await tab.getByLabel('App name').fill('MOMMY MORNINGS');
    const designs = ['Wordmark header', 'Wordmark search result', 'Wordmark universal image', 'Name and screen universal image'];
    for (const [index, design] of designs.entries()) {
      await tab.getByRole('button', { name: `Add the ${design}`, exact: true }).click();
      await expect(app.artboards).toHaveCount(index + 2);
    }

    // The app's own check, which measures each text layer against its box.
    const chips = page.getByTitle(/^App Store check for /);
    await expect(chips).toHaveCount(designs.length);
    await expect(chips.filter({ hasText: 'Ready' })).toHaveCount(designs.length);

    // And the page itself: no layer draws lines taller than the box that clips
    // them, and the name never breaks inside a word.
    const layers = await drawnText(app);
    const names = layers.filter((layer) => layer.text === 'MOMMY MORNINGS');
    expect(names).toHaveLength(designs.length);
    for (const layer of layers) expect(layer.overflow, layer.text).toBeLessThanOrEqual(1.01);
    for (const name of names) expect(name.lines, 'one line a word at most').toBeLessThanOrEqual(2);
  });

  test('a design added before its font has arrived waits for the font, and is fitted in it', async ({
    app,
    page,
    context,
  }) => {
    const face = await holdFace(context, 'Late Wide');
    await openHeadlineProject(app, page, 'Late Wide');
    await app.ensurePaletteOpen();
    await app.paletteTab('Header').click();
    const tab = page.getByRole('tabpanel', { name: 'Header' });
    await tab.getByLabel('App name').fill('MOMMY MORNINGS');
    await tab.getByRole('button', { name: 'Add the Wordmark universal image', exact: true }).click();

    // The type is fitted by measuring it. Measured now it would be fitted in
    // the fallback, so the design holds off until the face is on the page.
    await page.waitForTimeout(500);
    await expect(app.artboards).toHaveCount(1);

    face.release();
    await expect(app.artboards).toHaveCount(2);
    await expect(page.getByTitle('App Store check for the universal')).toContainText('Ready');
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('700 16px "Late Wide"')), { timeout: 15_000 })
      .toBe(true);
    const [name] = (await drawnText(app)).filter((layer) => layer.text === 'MOMMY MORNINGS');
    expect(name.overflow).toBeLessThanOrEqual(1.01);
    expect(name.lines).toBeLessThanOrEqual(2);
  });

  test('art made before the designs were sized for an iPhone is rebuilt from its chip, and Undo brings it back', async ({
    app,
    page,
  }) => {
    await openStoredProject(app, page, 'creative_old', 'Mommy Mornings', [firstDesignSearchBoard(), screenshotBoard('Arial')]);
    const chip = page.getByTitle('App Store check for the search results');
    const headline = app.board(0).locator('[data-element-id="cr-old1s-search-headline"] [data-text-body]');
    const glyph = () => headline.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    await expect(headline).toHaveText(/Plan your day\s*your own way/);
    expect(await glyph()).toBeCloseTo(140, 0);

    // The check says what is wrong with it, and the chip offers the way out.
    await expect(chip).toContainText('to check');
    await chip.click();
    await expect(page.getByText('Looks small on an iPhone', { exact: true })).toBeVisible();
    await expect(page.getByText('Too small to read on an iPhone', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Rebuild design', exact: true }).click();

    // The user's own words on the same layers, at a size an iPhone shows well.
    await expect(chip).toContainText('Ready');
    await expect(headline).toHaveText(/Plan your day\s*your own way/);
    expect(await glyph()).toBeGreaterThan(200);
    await expect(app.board(0).locator('[data-element-id="cr-old1s-search-subhead"]')).toContainText('Mornings that start themselves');
    // Search art no longer repeats the app name over its headline.
    await expect(app.board(0).locator('[data-element-id="cr-old1s-search-name"]')).toHaveCount(0);
    for (const layer of await drawnText(app)) expect(layer.overflow, layer.text).toBeLessThanOrEqual(1.01);
    // It is the same artboard, saved with its new layout.
    await waitForProject(page, (project) => {
      const boards = project.projectData as { id: string; elements: { id: string; fontSize?: number }[] }[];
      const art = boards?.find((board) => board.id === 'artboard_old1s_search');
      const saved = art?.elements.find((el) => el.id === 'cr-old1s-search-headline');
      return !!saved && (saved.fontSize ?? 0) > 60 && !art!.elements.some((el) => el.id === 'cr-old1s-search-name');
    });

    // One step back is the layout it had.
    await app.undoButton.click();
    await expect(chip).toContainText('to check');
    expect(await glyph()).toBeCloseTo(140, 0);
    await expect(app.board(0).locator('[data-element-id="cr-old1s-search-name"]')).toHaveCount(1);
  });

  test('a design that went in before a slow font arrived is fitted again when the font does', async ({
    app,
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const face = await holdFace(context, 'Late Wide');
    await openHeadlineProject(app, page, 'Late Wide');
    await app.ensurePaletteOpen();
    await app.paletteTab('Header').click();
    const tab = page.getByRole('tabpanel', { name: 'Header' });
    await tab.getByLabel('App name').fill('MOMMY MORNINGS');
    await tab.getByRole('button', { name: 'Add the Wordmark universal image', exact: true }).click();

    // The wait for a face ends after three seconds, and the design goes in
    // fitted to the fallback.
    await expect(app.artboards).toHaveCount(2, { timeout: 15_000 });
    const name = app.board(0).locator('[data-element-id$="-universal-name"] [data-text-body]');
    const glyph = () => name.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    const fallbackFit = await glyph();

    // Now the face arrives. It is a quarter wider than the fallback, so the
    // name as fitted would break onto a line its box cuts off.
    face.release();
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('700 16px "Late Wide"')), { timeout: 15_000 })
      .toBe(true);
    await expect.poll(glyph, { timeout: 15_000 }).toBeLessThan(fallbackFit);
    await expect(page.getByTitle('App Store check for the universal')).toContainText('Ready');
    const [drawn] = (await drawnText(app)).filter((layer) => layer.text === 'MOMMY MORNINGS');
    expect(drawn.overflow).toBeLessThanOrEqual(1.01);
    expect(drawn.lines).toBeLessThanOrEqual(2);
  });

  test('a design dragged from the Header tab onto an artboard lands right after it', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Header').click();
    const tile = page.getByRole('button', { name: 'Add the Two screens search result', exact: true });
    await expect(tile).toBeVisible();

    // The HTML5 drag a mouse makes, event by event, so both browsers run it the
    // same way: the tile writes the payload, the drop on the artboard reads it.
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await tile.dispatchEvent('dragstart', { dataTransfer });
    await app.board(0).dispatchEvent('drop', { dataTransfer });

    await expect(app.artboards).toHaveCount(2);
    await expectBoardSize(app.board(0), 1206, 2622);
    await expectBoardSize(app.board(1), 3840, 2560);
    await expect(page.getByTitle('App Store check for the search results')).toBeVisible();
  });

  test('a design held and dragged with a finger lands after the artboard it is let go over', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Header').click();
    const tile = page.getByRole('button', { name: 'Add the Headline and screen search result', exact: true });
    await expect(tile).toBeVisible();
    await fingerDragTile(page, tile, await centreOf(app.board(0)));

    await expect(app.artboards).toHaveCount(2);
    await expectBoardSize(app.board(0), 1206, 2622);
    await expectBoardSize(app.board(1), 3840, 2560);
  });

  test('a design lifted with a finger anywhere but the canvas adds nothing', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Header').click();
    const tile = page.getByRole('button', { name: 'Add the Wordmark header', exact: true });
    await expect(tile).toBeVisible();

    // Lifted over the toolbar: the user changed their mind.
    await fingerDragTile(page, tile, await centreOf(app.createButton));
    // The drop is answered on the lift itself, so an artboard added by it would
    // be on the canvas well within this.
    await page.waitForTimeout(750);
    await expect(app.artboards).toHaveCount(1);
  });

  test('two designs of each kind export as separate files, so the desktop folder keeps both', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.setTimeout(300_000);
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await addHeaderAndSearch(app, page);
    // A second pair to compare against, the way a product page test starts.
    await addHeaderAndSearch(app, page, 5);

    await app.openExportDialog();
    await expect(app.exportDialog.getByText('5 PNG files', { exact: true })).toBeVisible();
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

    const names = (await exportedNames(isDesktop, tauri, downloads, 5)).sort();
    expect(names).toEqual([
      '01_Blank_Artboard_iPhone-6_3-Portrait_1206x2622.png',
      'AppStore_Header_3840x1646.png',
      'AppStore_Header_3840x1646_2.png',
      'AppStore_SearchResult_3840x2560.png',
      'AppStore_SearchResult_3840x2560_2.png',
    ]);
  });
});
