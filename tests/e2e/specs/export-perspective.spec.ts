import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { waitForProject, type StoredProject } from '../fixtures/db';

/**
 * A perspective device keeps its perspective in the exported PNG.
 *
 * WebKit paints a capture (an SVG <foreignObject> image) in software, and its
 * software painter drops the perspective row of a transform: a tilted phone
 * exported flat on the Mac app while the canvas showed it tilted. The capture
 * now warps such elements itself where the engine needs it
 * (src/lib/perspectiveCapture.ts). This runs on every project; the WebKit ones
 * (desktop, web-webkit) are the ones that bite.
 *
 * The matrix is a pure perspective along x, w = 1 + 0.0006 x about the
 * phone's centre: the left side is nearer the viewer and comes out taller
 * than the right. A capture that drops the perspective draws a plain
 * rectangle, both sides the same height.
 */

const MATRIX = 'matrix3d(1, 0, 0, 0.0006, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)';

interface SavedElement {
  type?: string;
  styleType?: string;
  matrix3d?: string;
}

function elements(project: StoredProject): SavedElement[] {
  const boards = (project.projectData as Array<{ elements?: SavedElement[] }>) ?? [];
  return boards.flatMap((board) => board.elements ?? []);
}

/** How tall the phone is near its left and near its right side, in the PNG. */
function sideHeights(page: Page, pngBase64: string): Promise<{ left: number; right: number }> {
  return page.evaluate(async (src) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No 2D canvas');
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    // The frame is near black on a white board; the empty screen and its
    // label are light, so a column's dark run spans the frame top to bottom.
    const columns: { x: number; extent: number }[] = [];
    for (let x = 0; x < width; x++) {
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] < 270) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
      if (top >= 0) columns.push({ x, extent: bottom - top });
    }
    if (columns.length < 20) throw new Error(`The phone is missing from the export (${columns.length} columns)`);
    const first = columns[0].x;
    const last = columns[columns.length - 1].x;
    const span = last - first;
    const mean = (from: number, to: number) => {
      const picked = columns.filter((c) => c.x >= from && c.x <= to);
      return picked.reduce((sum, c) => sum + c.extent, 0) / picked.length;
    };
    return { left: mean(first + span * 0.1, first + span * 0.25), right: mean(last - span * 0.25, last - span * 0.1) };
  }, `data:image/png;base64,${pngBase64}`);
}

test.describe('exporting a perspective device', () => {
  test('the PNG keeps the perspective the canvas shows', async ({ app, page, tauri, isDesktop }) => {
    test.setTimeout(180_000);
    const downloads: Download[] = [];
    page.on('download', (download) => downloads.push(download));

    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('Device Mockups');
    await app.addElement('iPhone 17 Pro Max', 'device:iphone-17-pro-max');
    await page.locator('#deviceStyleType').click();
    await page.getByRole('option', { name: 'Custom Matrix3D', exact: true }).click();
    await page.locator('#customMatrix3d').fill(MATRIX);
    await waitForProject(page, (project) =>
      elements(project).some((el) => el.type === 'device' && el.styleType === 'custom' && el.matrix3d === MATRIX)
    );

    await app.openExportDialog();
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    let png: string;
    if (isDesktop) {
      await tauri.waitForFiles(1, 120_000);
      const written = await tauri.lastPng();
      expect(written, 'the desktop export wrote no PNG').not.toBeNull();
      png = written!.base64;
    } else {
      await expect.poll(() => downloads.length, { timeout: 120_000 }).toBeGreaterThanOrEqual(1);
      png = readFileSync(await downloads[0].path()).toString('base64');
    }

    const { left, right } = await sideHeights(page, png);
    // Measured 1.26 on Chromium and on WebKit with the warp at this matrix and
    // the palette size, and exactly 1.0 on WebKit without it.
    expect(left / right, `left ${left.toFixed(1)}px, right ${right.toFixed(1)}px`).toBeGreaterThan(1.15);
  });
});
