import { readFileSync, statSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';

/**
 * Exporting artboards as PNG files, which is the whole point of the app.
 *
 * The two platforms save a file in genuinely different ways and both are
 * covered here:
 *
 *   web      an <a download> anchor, so Playwright sees a real download event.
 *   desktop  WKWebView ignores that anchor (see src/lib/desktop.ts), so the app
 *            goes through the native dialogs instead: one save dialog for a
 *            single file, one folder picker for a batch. The mocked IPC records
 *            both, which is the only way to assert what the desktop app asked
 *            the OS to do.
 *
 * The file name is the contract both platforms are supposed to agree on, so it
 * is spelled out once and asserted on each.
 */

// `01_` is the board's canvas position, `Blank_Artboard` its name, and the tail
// is canvasSizeSlug() naming the store tier the canvas was exported at. The
// quote in `iPhone 6.9"` is already gone before sanitizeFileName() sees it, so
// the desktop name has to come out byte for byte identical to the web one.
const AS_IS_PNG = '01_Blank_Artboard_iPhone-6_9-Portrait_1290x2796.png';
const IPAD_13_PNG = '01_Blank_Artboard_iPad-13-Portrait_2064x2752.png';

/** The live readout the export puts up while it works. */
function progressDialog(page: Page) {
  return page.getByRole('dialog').filter({ hasText: 'Exporting Screenshots' });
}

/** The "N PNG files" summary the dialog keeps in step with the tick boxes. */
function fileCount(page: Page) {
  return page.getByText(/^\d+ PNG files?$/);
}

/** Every browser download the page starts, in order. Empty on desktop by design. */
function collectDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  return downloads;
}

/**
 * What the export actually produced, whichever platform is running: the names
 * of the desktop writes, or of the browser downloads.
 */
async function exportedNames(
  isDesktop: boolean,
  tauri: TauriHarness,
  downloads: Download[],
  count: number
): Promise<string[]> {
  if (isDesktop) {
    const files = await tauri.waitForFiles(count, 120_000);
    return files.map((file) => file.path.split('/').pop() ?? file.path);
  }
  await expect.poll(() => downloads.length, { timeout: 120_000 }).toBeGreaterThanOrEqual(count);
  return downloads.map((download) => download.suggestedFilename());
}

/**
 * Read a PNG's own header rather than trusting the file name.
 * Bytes 16..24 are IHDR's width and height, byte 25 is the colour type: 2 is
 * truecolour with NO alpha channel, which is what App Store Connect requires
 * and what pngOpaque.ts exists to produce.
 */
function pngHeader(path: string): { signature: string; width: number; height: number; colorType: number } {
  const bytes = readFileSync(path);
  return {
    signature: bytes.subarray(0, 8).toString('hex'),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

test.describe('the export dialog', () => {
  test('opens with the current canvas ticked and no generated size', async ({ app, page }) => {
    await app.startBlankProject();
    await app.openExportDialog();

    await expect(page.locator('#export-as-is')).toBeChecked();
    // A blank canvas carries no device mockup, so the project has no detected
    // format and every App Store tier is still on offer.
    await expect(page.locator('#gen-ios')).not.toBeChecked();
    await expect(page.locator('#gen-ipad-pro-13')).not.toBeChecked();
    await expect(page.locator('#gen-ipad-11')).not.toBeChecked();
    await expect(page.locator('#export-current-artboard-only')).not.toBeChecked();

    await expect(app.exportDialog.getByText('Current layout, 1290×2796')).toBeVisible();
    await expect(fileCount(page)).toHaveText('1 PNG file');
    await expect(app.exportDialog.getByText('1 artboard, 1 size')).toBeVisible();
  });

  test('the file count follows the tick boxes, and an empty selection cannot be exported', async ({ app, page }) => {
    await app.startBlankProject();
    await app.openExportDialog();
    const exportButton = app.exportDialog.getByRole('button', { name: 'Export', exact: true });

    await page.locator('#gen-ipad-pro-13').click();
    await expect(fileCount(page)).toHaveText('2 PNG files');
    await expect(app.exportDialog.getByText('1 artboard, 2 sizes')).toBeVisible();

    // Dropping the as-is pass leaves the generated size on its own, which is a
    // legitimate export of one file, not an empty one.
    await page.locator('#export-as-is').click();
    await expect(fileCount(page)).toHaveText('1 PNG file');
    await expect(exportButton).toBeEnabled();

    await page.locator('#gen-ipad-pro-13').click();
    await expect(fileCount(page)).toHaveText('0 PNG files');
    await expect(app.exportDialog.getByText('Nothing selected yet')).toBeVisible();
    await expect(exportButton).toBeDisabled();

    // Reopening is a fresh decision: the dialog resets rather than remembering
    // a selection the user backed out of.
    await app.exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(app.exportDialog).toBeHidden();
    await app.openExportDialog();
    await expect(page.locator('#export-as-is')).toBeChecked();
    await expect(page.locator('#gen-ipad-pro-13')).not.toBeChecked();
    await expect(fileCount(page)).toHaveText('1 PNG file');
  });

  test('Cancel writes nothing and leaves the editor alone', async ({ app, page, tauri, isDesktop }) => {
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await app.openExportDialog();
    await app.exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(app.exportDialog).toBeHidden();
    await expect(progressDialog(page)).toBeHidden();
    expect(downloads).toHaveLength(0);
    expect(await tauri.files()).toEqual([]);
    if (isDesktop) expect(await tauri.callsTo('plugin:dialog|save')).toEqual([]);

    // The canvas is still live, so a cancelled export cannot have wedged it.
    await expect(app.artboards).toHaveCount(1);
    await app.openExportDialog();
    await expect(app.exportDialog).toBeVisible();
  });

  test('"Selected artboard only" scopes the run to the board on the canvas', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.setTimeout(180_000);
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await app.openExportDialog();

    await page.locator('#export-current-artboard-only').click();
    await expect(page.locator('#export-current-artboard-only')).toBeChecked();
    await expect(app.exportDialog.getByText('Only "Blank Artboard" is exported')).toBeVisible();
    // One board in the project, so scoping changes the wording and nothing else.
    await expect(fileCount(page)).toHaveText('1 PNG file');

    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    expect(await exportedNames(isDesktop, tauri, downloads, 1)).toEqual([AS_IS_PNG]);
  });
});

test.describe('exporting to a file', () => {
  test('a plain export produces one PNG named for the board, its position and its canvas size', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.setTimeout(180_000);
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await app.openExportDialog();

    // Armed before the click: the run is short, and the readout is the only
    // thing standing between the user and a frozen-looking editor.
    const progressSeen = progressDialog(page)
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(app.exportDialog).toBeHidden();
    expect(await progressSeen).toBe(true);

    expect(await exportedNames(isDesktop, tauri, downloads, 1)).toEqual([AS_IS_PNG]);

    if (isDesktop) {
      // WKWebView drops <a download>, so a desktop export that produced a
      // browser download would silently produce no file at all.
      expect(downloads).toHaveLength(0);
      const [file] = await tauri.files();
      expect(file.via).toBe('plugin:fs|write_file');
      expect(file.path).toBe(`/tmp/osg-e2e/${AS_IS_PNG}`);
      expect(file.bytes).toBeGreaterThan(1000);

      const [save] = await tauri.callsTo('plugin:dialog|save');
      const options = save.args.options as Record<string, unknown>;
      // The name the app suggests to the OS is the same one the browser build
      // downloads, which is what sanitizeFileName() exists to guarantee.
      expect(options.defaultPath).toBe(AS_IS_PNG);
      expect(options.title).toBe(`Save ${AS_IS_PNG.replace(/\.png$/, '')}`);
      expect(options.filters).toEqual([{ name: 'PNG file', extensions: ['png'] }]);
      // A single file goes through the save dialog, never the folder picker.
      expect(await tauri.callsTo('plugin:dialog|open')).toEqual([]);
    } else {
      const path = await downloads[0].path();
      expect(statSync(path).size).toBeGreaterThan(1000);
      // The file is the store-sized capture, not a picture of the shrunken
      // board the canvas shows at 0.3 scale.
      expect(pngHeader(path)).toEqual({
        signature: '89504e470d0a1a0a',
        width: 1290,
        height: 2796,
        colorType: 2,
      });
      expect(await tauri.files()).toEqual([]);
    }

    await expect(progressDialog(page)).toBeHidden();
    // `exact` because the toast viewport also renders a screen-reader
    // announcement that concatenates every toast's title and description.
    await expect(page.getByText('Artboard Exported', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        isDesktop ? `Saved to /tmp/osg-e2e/${AS_IS_PNG}` : `"${AS_IS_PNG}" has been downloaded.`,
        { exact: true }
      )
    ).toBeVisible();
    // Nothing about an export may disturb the project it captured.
    await expect(app.artboards).toHaveCount(1);
    // An export is supposed to keep a version of the state it captured, and
    // on Chromium it does. That is NOT asserted here: on WebKit the write
    // fails (IndexedDB rejects the gzipped Blob) and saveVersion swallows it,
    // so the assertion would pass on one engine and fail on the other. See the
    // report that came with this file.
  });

  test('ticking an App Store size adds a second file at that size', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.setTimeout(240_000);
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await app.openExportDialog();

    await page.locator('#gen-ipad-pro-13').click();
    await expect(fileCount(page)).toHaveText('2 PNG files');
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

    // The as-is capture first, then the converted iPad canvas: the generated
    // pass is a real second render at 2064x2752, not a relabelled copy.
    const names = await exportedNames(isDesktop, tauri, downloads, 2);
    expect(names).toEqual([AS_IS_PNG, IPAD_13_PNG]);

    if (isDesktop) {
      // A batch picks one destination up front instead of asking per file.
      const opens = await tauri.callsTo('plugin:dialog|open');
      expect(opens).toHaveLength(1);
      const openOptions = opens[0].args.options as Record<string, unknown>;
      expect(openOptions.directory).toBe(true);
      expect(openOptions.recursive).toBe(true);
      expect(await tauri.callsTo('plugin:dialog|save')).toEqual([]);
      expect((await tauri.files()).map((file) => file.path)).toEqual([
        `/tmp/osg-e2e/${AS_IS_PNG}`,
        `/tmp/osg-e2e/${IPAD_13_PNG}`,
      ]);
      expect(downloads).toHaveLength(0);
    }

    await expect(progressDialog(page)).toBeHidden();
    await expect(page.getByText('Export Complete', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        isDesktop ? '2 of 2 images saved to /tmp/osg-e2e' : '2 of 2 images downloaded',
        { exact: true }
      )
    ).toBeVisible();
    // The generated format converts a temporary canvas list, so the project
    // itself must come back exactly as it was.
    await expect(app.artboards).toHaveCount(1);
    await expect(app.canvasSizeButton).toHaveAttribute('title', /1290 × 2796/);
  });
});

test.describe('the desktop dialogs cancelling', () => {
  // savePath null is the user pressing Cancel in the native save sheet,
  // openPath null the same in the folder picker.
  test.use({ tauriConfig: { savePath: null, openPath: null } });

  test('cancelling the save sheet writes nothing and does not wedge the editor', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'the web build has no native save dialog to cancel');
    test.setTimeout(180_000);
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await app.openExportDialog();
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

    // The board is still rendered and offered to the OS, and only the write is
    // skipped, so the sheet has to have been reached before nothing happened.
    await tauri.waitForCall('plugin:dialog|save', 120_000);
    await expect(progressDialog(page)).toBeHidden({ timeout: 120_000 });
    expect(await tauri.files()).toEqual([]);
    expect(downloads).toHaveLength(0);

    await expect(app.artboards).toHaveCount(1);
    await app.openExportDialog();
    await expect(app.exportDialog).toBeVisible();
  });

  test('cancelling the folder picker abandons the batch before anything is rendered', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'the web build downloads each file instead of picking a folder');
    test.setTimeout(180_000);
    const downloads = collectDownloads(page);
    await app.startBlankProject();
    await app.openExportDialog();
    await page.locator('#gen-ipad-pro-13').click();
    await expect(fileCount(page)).toHaveText('2 PNG files');
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

    await tauri.waitForCall('plugin:dialog|open', 60_000);
    await expect(app.exportDialog).toBeHidden();
    // The picker is asked before the first capture, so a cancel costs nothing:
    // no progress readout, no save sheet, no files.
    await expect(progressDialog(page)).toBeHidden();
    expect(await tauri.callsTo('plugin:dialog|save')).toEqual([]);
    expect(await tauri.files()).toEqual([]);
    expect(downloads).toHaveLength(0);

    await expect(app.artboards).toHaveCount(1);
    await app.openExportDialog();
    await expect(app.exportDialog).toBeVisible();
  });
});

test.describe('uploading to a store instead', () => {
  test('the export dialog hands off to the publish dialog, which owns up to where it can run', async ({
    app,
    page,
    isDesktop,
  }) => {
    await app.startBlankProject();
    await app.openExportDialog();
    const upload = app.exportDialog.getByRole('button', { name: 'Upload to the store instead' });
    await expect(upload).toBeVisible();
    await upload.click();

    await expect(app.exportDialog).toBeHidden();
    const publish = page.getByRole('dialog').filter({ hasText: 'Upload to the store' });
    await expect(publish).toBeVisible();
    await expect(publish.getByRole('button', { name: 'App Store Connect' })).toBeVisible();
    await expect(publish.getByRole('button', { name: 'Google Play' })).toBeVisible();

    if (isDesktop) {
      // Uploading is a desktop capability, so the desktop build gets on with
      // asking for credentials.
      await expect(publish.getByText('Store uploads need the desktop app')).toBeHidden();
      await expect(page.locator('#asc-issuer')).toBeVisible();
    } else {
      // Apple and Google block browser tabs, so the web build explains itself
      // rather than offering an upload that cannot work.
      await expect(publish.getByText('Store uploads need the desktop app')).toBeVisible();
      await expect(publish.getByRole('button', { name: /Get the desktop app/ })).toBeVisible();
      await expect(page.locator('#asc-issuer')).toHaveCount(0);
    }
  });
});
