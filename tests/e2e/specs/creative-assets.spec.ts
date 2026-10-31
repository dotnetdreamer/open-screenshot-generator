import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';
import { waitForProject } from '../fixtures/db';
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
    await expect(dialog.getByText(/The header crop is an estimate/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Search results', exact: true }).click();
    await expect(dialog.getByText(/Your search art takes the place of three screenshots here/)).toBeVisible();
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(0);
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
