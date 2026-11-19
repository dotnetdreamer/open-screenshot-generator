import { deflateSync } from 'node:zlib';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { Editor } from '../helpers/editor';

// Remove background (src/lib/cutout): the activity bar's view that cuts people
// and products out of photos, the library of the user's own pictures it keeps,
// and the palette's Custom tab that places them.
//
// The model is a 120 MB download from Hugging Face, which no test makes: every
// request there is refused, so a picture on a plain colour (cut by colour,
// which needs no model) is what the default run cuts. The model's own path
// runs when E2E_CUTOUT_MODELS names a folder holding the two model files
// (birefnet_lite_webgpu_fp16.onnx and model_fp16.onnx), served in place of
// the real download.
//
// The library keeps its pictures as Blobs in IndexedDB, which Playwright's
// WebKit cannot store (tests/e2e/README.md), so on the `desktop` project these
// skip behind the same probe capture.spec.ts uses; desktop-chromium runs them.

test.use({ actionTimeout: 30_000 });
test.describe.configure({ timeout: 240_000 });

const VIEW_BUTTON = 'Remove background: cut people and products out of photos';

/** A PNG of `width` x `height` drawn by `paint`, encoded here so no fixture file is needed. */
function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const at = y * (width * 3 + 1) + 1 + x * 3;
      rows[at] = r;
      rows[at + 1] = g;
      rows[at + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A red ring on white, the kind of logo a plain colour cut gets exactly. */
const LOGO = png(240, 180, (x, y) => {
  const d = Math.hypot(x - 120, y - 90);
  return d > 30 && d < 62 ? [214, 40, 40] : [255, 255, 255];
});

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

const NO_BLOBS = 'Playwright WebKit cannot store the picture Blob in IndexedDB; desktop-chromium runs this';

/**
 * Refuses the real model download. With `serve` and E2E_CUTOUT_MODELS, serves the two
 * files from a server of the test's own and points the app's mirror setting
 * (MODEL_MIRROR_KEY in src/lib/cutout/models.ts) at it: a 120 MB answer through
 * page.route closes the browser's session. Returns whether models are served.
 */
async function routeModels(page: Page, serve = false): Promise<boolean> {
  await page.route('**/huggingface.co/**', (route) => route.abort());
  const dir = serve ? process.env.E2E_CUTOUT_MODELS : undefined;
  const files: Record<string, string> = {
    'birefnet-lite-1024': dir ? path.join(dir, 'birefnet_lite_webgpu_fp16.onnx') : '',
    'birefnet-lite-512': dir ? path.join(dir, 'model_fp16.onnx') : '',
  };
  if (!dir || !Object.values(files).every((file) => fs.existsSync(file))) return false;
  const server = createServer((request, response) => {
    const id = (request.url ?? '').replace(/^\//, '').replace(/\.onnx$/, '');
    const file = files[id];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  page.on('close', () => server.close());
  const port = (server.address() as AddressInfo).port;
  const urls = Object.fromEntries(Object.keys(files).map((id) => [id, `http://127.0.0.1:${port}/${id}.onnx`]));
  await page.addInitScript((value) => window.localStorage.setItem('osg.cutout.model-urls', value), JSON.stringify(urls));
  return true;
}

async function openView(page: Page) {
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: VIEW_BUTTON }).click();
  const view = page.getByTestId('cutout-view');
  await expect(view).toBeVisible();
  return view;
}

test.describe('Remove background', () => {
  test('cuts a logo on a plain colour without the model, keeps it, and puts it on the artboard', async ({ page }) => {
    const modelRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).hostname === 'huggingface.co') modelRequests.push(request.url());
    });
    await routeModels(page);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();

    const view = await openView(page);
    await view.getByTestId('cutout-file-input').setInputFiles({ name: 'ring-logo.png', mimeType: 'image/png', buffer: LOGO });

    const tile = view.getByTestId('cutout-tile').first();
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAccessibleName('ring logo', { timeout: 60_000 });
    await expect(view.getByText('Plain background removed', { exact: true })).toBeVisible();
    expect(modelRequests).toEqual([]);

    // The saved picture is cut to the ring, and see-through outside it.
    const saved = await page.evaluate(async () => {
      const openLibrary = indexedDB.open('OpenScreenshotGeneratorLibrary');
      const lib = await new Promise<IDBDatabase>((resolve) => (openLibrary.onsuccess = () => resolve(openLibrary.result)));
      const open = indexedDB.open('ProjectDatabase');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const rows = await new Promise<any[]>((resolve) => {
        const req = lib.transaction('images').objectStore('images').getAll();
        req.onsuccess = () => resolve(req.result);
      });
      const row = rows.find((candidate) => !candidate.deletedAt);
      const media = await new Promise<any>((resolve) => {
        const req = db.transaction('media').objectStore('media').get(row.mediaId);
        req.onsuccess = () => resolve(req.result);
      });
      const bitmap = await createImageBitmap(media.blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      db.close();
      lib.close();
      return { state: row.state, width: bitmap.width, height: bitmap.height, centre: pixel(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2)), ring: pixel(Math.floor(bitmap.width / 2), 8) };
    });
    expect(saved.state).toBe('ready');
    // Trimmed to the ring (124 pixels across) plus a little margin.
    expect(saved.width).toBeGreaterThan(120);
    expect(saved.width).toBeLessThan(140);
    // The ring's white middle is shut inside it, so without a model it stays.
    expect(saved.centre[3]).toBe(255);
    expect(saved.ring[0]).toBeGreaterThan(180);
    expect(saved.ring[3]).toBe(255);

    const before = await editor.artboards.first().locator('[data-element-id]').count();
    await view.getByTestId('cutout-place').click();
    await expect(page.getByTestId('cutout-view')).toBeHidden();
    await expect(editor.artboards.first().locator('[data-element-id]')).toHaveCount(before + 1);
    await expect(editor.artboards.first().locator('[data-element-id] img[src^="blob:"]').last()).toBeVisible();

    // The Custom tab lists it too.
    await editor.ensurePaletteOpen();
    await page.getByRole('tab', { name: 'Custom', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Add ring logo \(custom:img_/ })).toBeVisible();
  });

  test('the Custom tab keeps a picture as it is and places it', async ({ page }) => {
    await routeModels(page);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await editor.ensurePaletteOpen();
    await page.getByRole('tab', { name: 'Custom', exact: true }).click();
    const panel = page.locator('[role="tabpanel"][data-state="active"]');
    await expect(panel.getByText('Your own pictures show up here')).toBeVisible();
    await panel.getByTestId('custom-file-input').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: LOGO });
    const tile = panel.getByRole('button', { name: /^Add badge \(custom:img_/ });
    await expect(tile).toBeVisible();
    const before = await editor.artboards.first().locator('[data-element-id]').count();
    await tile.click();
    await expect(editor.artboards.first().locator('[data-element-id]')).toHaveCount(before + 1);
  });

  test("the Properties panel cuts a placed picture out in place, and undo puts it back", async ({ page }) => {
    await routeModels(page);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await editor.ensurePaletteOpen();
    await page.getByRole('tab', { name: 'Custom', exact: true }).click();
    const panel = page.locator('[role="tabpanel"][data-state="active"]');
    await panel.getByTestId('custom-file-input').setInputFiles({ name: 'ring.png', mimeType: 'image/png', buffer: LOGO });
    await panel.getByRole('button', { name: /^Add ring \(custom:img_/ }).click();

    const picture = editor.artboards.first().locator('[data-element-id] img').last();
    await expect(picture).toBeVisible();
    const srcBefore = await picture.getAttribute('src');
    await editor.activeDockPanel.getByRole('button', { name: 'Remove background', exact: true }).click();
    await expect(page.getByText('Background removed', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => picture.getAttribute('src')).not.toBe(srcBefore);
    // Cut in place: the corner of the picture is see-through now.
    const corner = await picture.evaluate(async (img: HTMLImageElement) => {
      const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return { alpha: context.getImageData(2, 2, 1, 1).data[3], width: bitmap.width };
    });
    expect(corner.alpha).toBe(0);
    // The frame is kept, so the ring stays where it was: the full 240 pixels.
    expect(corner.width).toBe(240);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect.poll(() => picture.getAttribute('src')).toBe(srcBefore);
  });

  test('the brush erases, undo brings it back, and the change is saved', async ({ page }) => {
    await routeModels(page);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    const view = await openView(page);
    await view.getByTestId('cutout-file-input').setInputFiles({ name: 'ring-logo.png', mimeType: 'image/png', buffer: LOGO });
    await expect(view.getByText('Plain background removed', { exact: true })).toBeVisible({ timeout: 60_000 });

    const maskId = () =>
      page.evaluate(async () => {
        const openLibrary = indexedDB.open('OpenScreenshotGeneratorLibrary');
        const lib = await new Promise<IDBDatabase>((resolve) => (openLibrary.onsuccess = () => resolve(openLibrary.result)));
        const open = indexedDB.open('ProjectDatabase');
        const db = await new Promise<IDBDatabase>((resolve) => (open.onsuccess = () => resolve(open.result)));
        const rows = await new Promise<any[]>((resolve) => {
          const req = lib.transaction('images').objectStore('images').getAll();
          req.onsuccess = () => resolve(req.result);
        });
        db.close();
        lib.close();
        return rows.find((row) => !row.deletedAt)?.mediaId as string;
      });
    const first = await maskId();

    const canvas = view.getByTestId('cutout-canvas');
    const box = (await canvas.boundingBox())!;
    await view.getByRole('button', { name: 'Erase', exact: true }).click();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(view.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    // A stroke saves a new picture a moment later.
    await expect.poll(maskId, { timeout: 15_000 }).not.toBe(first);
    await view.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(view.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  });

  test('the Properties panel cuts the selected language image and undo restores it', async ({ page }) => {
    await routeModels(page);
    await page.addInitScript(() => {
      (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
    });
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await page.waitForFunction(() => (window as unknown as { __osg?: { ready: boolean } }).__osg?.ready === true);
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await page.evaluate(
        (message) => (window as unknown as { __osg: { mcp: (m: unknown) => Promise<{ result?: { content: { text?: string }[]; isError?: boolean } }> } }).__osg.mcp(message),
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
      );
      const text = response.result?.content.map((part) => part.text ?? '').join('') ?? '';
      if (response.result?.isError) throw new Error(`${name}: ${text}`);
      return JSON.parse(text);
    };
    const boardId = (await call('list_artboards', {}))[0].id;
    const baseSource = `data:image/png;base64,${LOGO.toString('base64')}`;
    const germanPng = png(180, 140, (x, y) => x > 40 && x < 140 && y > 30 && y < 110 ? [30, 80, 220] : [255, 255, 255]);
    const germanSource = `data:image/png;base64,${germanPng.toString('base64')}`;
    const { id: elementId } = await call('add_element', { artboardId: boardId, type: 'image', imageSrc: baseSource, x: 100, y: 100, width: 240, height: 180 });
    await call('add_locales', { locales: ['de-DE'], autoFont: false });
    await call('set_locale_override', { artboardId: boardId, elementId, locale: 'de-DE', imageSrc: germanSource });
    await call('set_locale', { locale: 'de-DE' });
    const readSource = async (locale?: string) => {
      const board = await call('get_artboard', { artboardId: boardId, ...(locale ? { locale } : {}) });
      return board.elements.find((element: { id: string }) => element.id === elementId).imageSrc as string;
    };
    const baseBefore = await readSource();
    const germanBefore = await readSource('de-DE');
    const element = editor.artboards.first().locator(`[data-element-id="${elementId}"]`);
    const image = element.locator('img').last();
    await expect(image).toHaveAttribute('src', germanBefore);
    await element.click();
    await editor.dockTab('Properties').click();
    await editor.activeDockPanel.getByRole('button', { name: 'Remove background', exact: true }).click();
    await expect(page.getByText('Background removed', { exact: true })).toBeVisible({ timeout: 60_000 });
    const germanCut = await readSource('de-DE');
    expect(germanCut).toMatch(/^asset:asset_/);
    expect(await readSource()).toBe(baseBefore);
    const pixels = await page.evaluate(async (ref) => {
      const open = indexedDB.open('ProjectDatabase');
      const db = await new Promise<IDBDatabase>((resolve) => (open.onsuccess = () => resolve(open.result)));
      const asset = await new Promise<any>((resolve) => {
        const req = db.transaction('media').objectStore('media').get(ref.slice('asset:'.length));
        req.onsuccess = () => resolve(req.result);
      });
      db.close();
      const bitmap = await createImageBitmap(asset.blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return { width: canvas.width, height: canvas.height, corner: context.getImageData(0, 0, 1, 1).data[3], centre: Array.from(context.getImageData(90, 70, 1, 1).data) };
    }, germanCut);
    expect(pixels).toEqual({ width: 180, height: 140, corner: 0, centre: [30, 80, 220, 255] });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect.poll(() => readSource('de-DE')).toBe(germanBefore);
    expect(await readSource()).toBe(baseBefore);
    await expect(image).toHaveAttribute('src', germanBefore);
  });

  test('placing waits for a save already under way', async ({ page }) => {
    await routeModels(page);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    const view = await openView(page);
    await view.getByTestId('cutout-file-input').setInputFiles({ name: 'saving-ring.png', mimeType: 'image/png', buffer: LOGO });
    await expect(view.getByText('Plain background removed', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => {
      const hook = window as unknown as { __releaseCutoutRender?: () => void; __restoreCutoutRender?: () => void };
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (this: Worker, message: any, options?: any) {
        if (message?.type === 'render') {
          Worker.prototype.postMessage = original;
          hook.__releaseCutoutRender = () => {
            delete hook.__releaseCutoutRender;
            original.call(this, message, options);
          };
          return;
        }
        original.call(this, message, options);
      };
      hook.__restoreCutoutRender = () => {
        Worker.prototype.postMessage = original;
        hook.__releaseCutoutRender?.();
        delete hook.__restoreCutoutRender;
      };
    });
    try {
      await view.getByRole('switch', { name: 'Cut off empty space', exact: true }).click();
      await page.waitForFunction(() => !!(window as unknown as { __releaseCutoutRender?: () => void }).__releaseCutoutRender);
      await expect(view.getByText('Saving', { exact: true })).toBeVisible();
      await view.getByTestId('cutout-place').click();
      await expect(view).toBeVisible();
      await page.evaluate(() => (window as unknown as { __releaseCutoutRender?: () => void }).__releaseCutoutRender?.());
      const image = editor.artboards.first().locator('[data-element-id] img').last();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
    } finally {
      await page.evaluate(() => (window as unknown as { __restoreCutoutRender?: () => void }).__restoreCutoutRender?.()).catch(() => undefined);
    }
  });

  for (const action of ['place', 'export'] as const) {
    test(`an immediate ${action} uses the latest edit`, async ({ page, isDesktop, tauri }) => {
      await routeModels(page);
      const editor = new Editor(page);
      await editor.goto();
      test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
      await editor.startBlankProject();
      const view = await openView(page);
      await view.getByTestId('cutout-file-input').setInputFiles({ name: 'edited-ring.png', mimeType: 'image/png', buffer: LOGO });
      await expect(view.getByText('Plain background removed', { exact: true })).toBeVisible({ timeout: 60_000 });
      const trim = view.getByRole('switch', { name: 'Cut off empty space', exact: true });
      await expect(trim).toBeChecked();
      await trim.click();

      if (action === 'place') {
        await view.getByTestId('cutout-place').click();
        const image = editor.artboards.first().locator('[data-element-id] img').last();
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
      } else if (isDesktop) {
        await tauri.setSavePath('/tmp/osg-e2e/edited-ring.png');
        await view.getByRole('button', { name: 'Export as PNG', exact: true }).click();
        await expect.poll(() => tauri.lastPng()).not.toBeNull();
        expect(Buffer.from((await tauri.lastPng())!.base64, 'base64').readUInt32BE(16)).toBe(240);
      } else {
        const downloaded = page.waitForEvent('download');
        await view.getByRole('button', { name: 'Export as PNG', exact: true }).click();
        const file = await (await downloaded).path();
        expect(fs.readFileSync(file!).readUInt32BE(16)).toBe(240);
      }
    });
  }

  test('an empty library keeps backup access available', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('open-screenshot-generator.account', JSON.stringify({
        provider: 'github', accessToken: 'e2e-token', account: { id: 'e2e-user', name: 'Test account' },
      }));
    });
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    const view = await openView(page);
    await expect(view.getByTestId('cutout-tile')).toHaveCount(0);
    await expect(view.getByRole('button', { name: 'Back up to GitHub', exact: true })).toBeEnabled();
  });

  test('the agents cut, list and keep pictures through the MCP tools', async ({ page }) => {
    await routeModels(page);
    // The CLI's way in (src/lib/headless/bridge.ts), which runs the same tools the
    // desktop app's Claude Code and Codex agents call.
    await page.addInitScript(() => {
      (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
    });
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await page.waitForFunction(() => (window as unknown as { __osg?: { ready: boolean } }).__osg?.ready === true);
    const board = { id: 'ab_cut', name: 'Cut board', position: { x: 0, y: 0 }, size: { width: 1024, height: 768 }, backgroundColor: '#1e6a56', backgroundType: 'solid', zoom: 1, elements: [] };
    await page.evaluate(
      (value) => (window as unknown as { __osg: { loadProject: (d: unknown[], n: string, i: string) => Promise<boolean> } }).__osg.loadProject([value], 'Cut project', 'proj_cut'),
      board
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = (await page.evaluate(
        (message) => (window as unknown as { __osg: { mcp: (m: unknown) => Promise<unknown> } }).__osg.mcp(message),
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
      )) as { result?: { content: { text?: string }[]; isError?: boolean } };
      const text = response.result?.content.map((part) => part.text ?? '').join('') ?? '';
      if (response.result?.isError) throw new Error(`${name}: ${text}`);
      return JSON.parse(text);
    };
    const dataUrl = `data:image/png;base64,${LOGO.toString('base64')}`;

    const cut = await call('remove_background', { source: dataUrl, name: 'Agent ring' });
    expect(cut.ref).toMatch(/^asset:asset_/);
    expect(cut.engine).toBe('color');
    expect(cut.width).toBeLessThan(140);
    expect(cut.myImageId).toMatch(/^img_/);
    const editable = await page.evaluate(async (id) => {
      const openLibrary = indexedDB.open('OpenScreenshotGeneratorLibrary');
      const lib = await new Promise<IDBDatabase>((resolve) => (openLibrary.onsuccess = () => resolve(openLibrary.result)));
      const open = indexedDB.open('ProjectDatabase');
      const db = await new Promise<IDBDatabase>((resolve) => (open.onsuccess = () => resolve(open.result)));
      const row = await new Promise<any>((resolve) => {
        const req = lib.transaction('images').objectStore('images').get(id);
        req.onsuccess = () => resolve(req.result);
      });
      const source = await new Promise<any>((resolve) => {
        const req = db.transaction('media').objectStore('media').get(row.sourceMediaId);
        req.onsuccess = () => resolve(req.result);
      });
      const mask = await new Promise<any>((resolve) => {
        const req = db.transaction('media').objectStore('media').get(row.maskMediaId);
        req.onsuccess = () => resolve(req.result);
      });
      const original = await createImageBitmap(source.blob);
      const canvas = new OffscreenCanvas(original.width, original.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(original, 0, 0);
      const alpha = context.getImageData(0, 0, 1, 1).data[3];
      original.close();
      db.close();
      lib.close();
      return { width: canvas.width, height: canvas.height, alpha, hasMask: !!mask?.blob, trim: row.settings.trim };
    }, cut.myImageId);
    expect(editable).toEqual({ width: 240, height: 180, alpha: 255, hasMask: true, trim: true });

    const kept = await call('save_to_my_images', { source: dataUrl, name: 'Agent badge' });
    expect(kept.state).toBe('plain');
    const listed = await call('list_my_images', {});
    expect(listed.images.map((image: { name: string }) => image.name).sort()).toEqual(['Agent badge', 'Agent ring']);

    // In place: an image element's picture is swapped for its cut-out.
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __osg: { status: () => { artboards: unknown[] } } }).__osg.status())).artboards.length).toBe(1);
    const added = await call('add_element', { artboardId: 'ab_cut', type: 'image', imageSrc: kept.ref, x: 100, y: 100, width: 240, height: 180 });
    const swapped = await call('remove_background', { elementId: added.id ?? added.elementId });
    expect(swapped.replaced).toEqual({ artboardId: 'ab_cut', elementId: added.id ?? added.elementId });
    const boardState = await call('get_artboard', { artboardId: 'ab_cut' });
    const element = boardState.elements.find((candidate: { id: string }) => candidate.id === (added.id ?? added.elementId));
    expect(element.imageSrc).toBe(swapped.ref);

    expect((await call('delete_my_image', { id: kept.id })).ok).toBe(true);
    expect((await call('list_my_images', {})).count).toBe(2);
    await expect(editor.artboards.first().locator('[data-element-id]')).toHaveCount(1);
  });

  test('a photo is cut by the model when the model files are given', async ({ page }) => {
    const editor = new Editor(page);
    const served = await routeModels(page, true);
    test.skip(!served, 'Set E2E_CUTOUT_MODELS to a folder with the two model files to run the model');
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    const view = await openView(page);
    // A soft-edged dark disc on a busy gradient: not a plain colour, so the model cuts it.
    const photo = png(320, 240, (x, y) => {
      const d = Math.hypot(x - 160, y - 120);
      if (d < 70) return [30, 30, 40];
      return [(x * 3) % 256, (y * 2 + 80) % 256, ((x + y) * 5) % 256];
    });
    await view.getByTestId('cutout-file-input').setInputFiles({ name: 'disc.png', mimeType: 'image/png', buffer: photo });
    await expect(view.getByText('Background removed', { exact: true })).toBeVisible({ timeout: 200_000 });
    await expect(view.getByTestId('cutout-offline')).toBeVisible();
  });
});
