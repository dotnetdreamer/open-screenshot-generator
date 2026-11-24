// Director: a screen recording in, a film of it on a 3D phone out.
//
// The recordings are small copies of two made-up apps with a known script
// (tests/e2e/fixtures/director/*.json), so a test can say which moments the
// analysis has to find. Judged by pixels and by what the view shows, never by
// the clock alone: a test that a film plays checks that the picture moves.
//
// Director keeps the recording as a Blob in IndexedDB, which Playwright's
// WebKit can't store, so on `desktop` these skip behind the same probe as
// capture.spec.ts and cutout.spec.ts; `desktop-chromium` runs them.
//
// The phone link needs no server: the test stands in for the connection
// server (a WebSocket route that copies each message to the room, as
// infra/vps/mcp-relay/src/collab.js does), and the phone page gets its tilt
// from deviceorientation events the test sends.

import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { Editor } from '../helpers/editor';

test.use({ actionTimeout: 30_000 });
test.describe.configure({ timeout: 300_000, mode: 'default' });

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'director');
const IOS = path.join(FIXTURES, 'ios-habits-small.mp4');
const ANDROID = path.join(FIXTURES, 'android-small.mp4');

interface TruthEvent {
  kind: string;
  t?: number;
  t0?: number;
  t1?: number;
}
const truth = (name: string): { duration: number; events: TruthEvent[] } => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

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

const NO_BLOBS = 'Playwright WebKit cannot store the recording Blob in IndexedDB; desktop-chromium runs this';

async function openDirector(page: Page) {
  await page.getByRole('button', { name: /^Director: / }).click();
  await expect(page.getByTestId('director-start')).toBeVisible({ timeout: 60_000 });
}

/** Adds a recording and waits until its moments are on the timeline. */
async function addRecording(page: Page, file: string) {
  await page.getByTestId('director-file').setInputFiles(file);
  await expect(page.getByTestId('director-viewport')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('director-moment').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('director-busy')).toHaveCount(0, { timeout: 120_000 });
}

async function pause(page: Page) {
  const button = page.getByTestId('director-viewport').getByRole('button', { name: /^(Play|Pause)$/ });
  if ((await button.getAttribute('aria-label')) === 'Pause') await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Play');
}

/** Moves the film to `t` seconds by clicking the strip. */
async function seek(page: Page, t: number) {
  const strip = page.getByRole('slider', { name: 'Move through the film' });
  const box = (await strip.boundingBox())!;
  const duration = Number(await strip.getAttribute('aria-valuemax'));
  await page.mouse.click(box.x + (Math.min(t, duration) / duration) * box.width, box.y + box.height / 2);
}

async function filmPicture(page: Page): Promise<Buffer> {
  return page.getByTestId('director-canvas').screenshot();
}

/** How different two pictures are: the mean of every channel's difference, 0 to 255. */
async function difference(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([one, two]) => {
      const load = async (base64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        return img;
      };
      const [x, y] = await Promise.all([load(one), load(two)]);
      const w = Math.min(x.naturalWidth, y.naturalWidth);
      const h = Math.min(x.naturalHeight, y.naturalHeight);
      const read = (img: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = read(x);
      const db = read(y);
      let sum = 0;
      for (let i = 0; i < da.length; i += 4) sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      return sum / ((da.length / 4) * 3);
    },
    [a.toString('base64'), b.toString('base64')] as const
  );
}

/** How much a picture varies: a blank or one-colour canvas is near 0. */
async function variety(page: Page, picture: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let mean = 0;
    for (let i = 0; i < data.length; i += 4) mean += data[i] + data[i + 1] + data[i + 2];
    mean /= (data.length / 4) * 3;
    let spread = 0;
    for (let i = 0; i < data.length; i += 4) spread += Math.abs((data[i] + data[i + 1] + data[i + 2]) / 3 - mean);
    return spread / (data.length / 4);
  }, picture.toString('base64'));
}

test.describe('Director', () => {
  test('reads a recording, finds its taps, typing and scrolls, and plays a moving film', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    // A blank project's made-up name ("Blank Canvas Copy") isn't the app's name, so no title yet.
    await expect(page.getByTestId('director-title')).toHaveValue('');

    // The script of the made-up app has taps, typing and scrolls; the timeline has to show each kind.
    const labels = await page.getByTestId('director-moment').evaluateAll((els) => els.map((el) => el.querySelector('button')?.getAttribute('aria-label') ?? ''));
    const script = truth('ios-habits-small.json');
    const kinds = new Set(script.events.map((e) => e.kind));
    if (kinds.has('tap')) expect(labels.some((l) => l.startsWith('Tap'))).toBe(true);
    if (kinds.has('scroll')) expect(labels.some((l) => l.startsWith('Scroll'))).toBe(true);
    if (kinds.has('type')) expect(labels.some((l) => l.startsWith('Typing'))).toBe(true);
    // The director gives some of them close-ups.
    await expect(page.locator('[data-testid="director-moment"][data-close="true"]').first()).toBeVisible();

    // A real picture, and it moves while the film plays.
    await pause(page);
    await seek(page, 1);
    await page.waitForTimeout(600);
    const first = await filmPicture(page);
    expect(await variety(page, first)).toBeGreaterThan(8);
    await seek(page, script.duration * 0.6);
    await page.waitForTimeout(600);
    const later = await filmPicture(page);
    expect(await difference(page, first, later)).toBeGreaterThan(4);

    // Playing changes the picture on its own.
    const before = await filmPicture(page);
    await page.getByTestId('director-viewport').getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1500);
    expect(await difference(page, before, await filmPicture(page))).toBeGreaterThan(2);
    await pause(page);

    // The film is kept: back to the list and it's there.
    await page.getByRole('button', { name: 'All videos' }).click();
    await expect(page.getByTestId('director-films')).toContainText('ios-habits-small');

    // And with another project open: the list is every video on this device,
    // so one made in another project, or before a project had its id, stays in it.
    await page.getByRole('button', { name: 'Back to the editor' }).click();
    await page.locator('[data-project-tabs]').getByRole('button', { name: 'New tab', exact: true }).click();
    await editor.startBlankProject();
    await openDirector(page);
    await expect(page.getByTestId('director-films')).toContainText('ios-habits-small');
  });

  test('an Android recording gets an Android phone', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, ANDROID);
    await expect(page.getByTestId('director-phone').getByRole('combobox', { name: 'Phone' })).toContainText('Pixel');
  });

  test('a moment left out loses its close-up, and undo brings it back', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    await pause(page);

    const close = page.locator('[data-testid="director-moment"][data-close="true"]').first();
    const id = await close.getAttribute('data-moment-id');
    await close.getByRole('button').click();
    const panel = page.getByTestId('director-moment-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Leave out' }).click();
    const pill = page.locator(`[data-testid="director-moment"][data-moment-id="${id}"]`);
    await expect(pill).toHaveAttribute('data-close', 'false');
    await expect(pill.getByRole('button')).toHaveAccessibleName(/left out/);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(pill).toHaveAttribute('data-close', 'true');
  });

  test('exports an MP4 that plays, with the film\'s length', async ({ page, isDesktop, tauri }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    const encodes = await page.evaluate(() => typeof VideoEncoder !== 'undefined');
    test.skip(!encodes, 'This browser has no WebCodecs video encoder');
    await editor.startBlankProject();
    await openDirector(page);
    // The shorter recording: Playwright's Chromium draws WebGL without the GPU.
    await addRecording(page, ANDROID);
    await pause(page);
    await page.getByTestId('director-shape').getByRole('button', { name: /^Square/ }).click();
    // Read before the dialog opens: a modal dialog hides the page behind it from these queries.
    const duration = Number(await page.getByRole('slider', { name: 'Move through the film' }).getAttribute('aria-valuemax'));

    await page.getByTestId('director-export').click();
    const dialog = page.getByTestId('director-export-dialog');
    await expect(dialog).toContainText('1080 by 1080');
    let bytes: Buffer;
    if (isDesktop) {
      // The desktop app asks where to save first, then writes through the fs
      // plugin, which the test's desktop shell only counts: keep the bytes it was handed.
      await page.evaluate(() => {
        type Invoke = (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
        const shell = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke }; __e2eFilm?: Uint8Array };
        const invoke = shell.__TAURI_INTERNALS__.invoke;
        shell.__TAURI_INTERNALS__.invoke = (cmd, args, options) => {
          if (cmd === 'plugin:fs|write_file' && args instanceof Uint8Array) shell.__e2eFilm = args;
          return invoke(cmd, args, options);
        };
      });
      await dialog.getByTestId('director-export-start').click();
      await expect(dialog.getByTestId('director-export-done')).toBeVisible({ timeout: 240_000 });
      const [saved] = await tauri.files();
      expect(saved.path).toMatch(/android-small\.mp4$/);
      const base64 = await page.evaluate(() => {
        const film = (window as unknown as { __e2eFilm?: Uint8Array }).__e2eFilm;
        if (!film) return '';
        let text = '';
        for (let i = 0; i < film.length; i += 0x8000) text += String.fromCharCode(...film.subarray(i, i + 0x8000));
        return btoa(text);
      });
      bytes = Buffer.from(base64, 'base64');
      expect(bytes.length).toBe(saved.bytes);
    } else {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 240_000 }), dialog.getByTestId('director-export-start').click()]);
      bytes = fs.readFileSync((await download.path())!);
      await expect(dialog.getByTestId('director-export-done')).toBeVisible();
    }
    expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');

    // The file plays in the browser, at the size asked for and the film's length.
    const probe = await page.evaluate(async (base64) => {
      const blob = await (await fetch(`data:video/mp4;base64,${base64}`)).blob();
      const video = document.createElement('video');
      video.muted = true;
      video.src = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    }, bytes.toString('base64'));
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1080);
    expect(Math.abs(probe.duration - duration)).toBeLessThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// The phone link
// ---------------------------------------------------------------------------

/** The connection server, stood in by the test: rooms, and each message copied to everybody in its room. */
async function standInRelay(context: BrowserContext) {
  const rooms = new Map<string, Set<WebSocketRoute>>();
  await context.route('**/collab/ticket', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: 'test-ticket' }) }));
  await context.routeWebSocket(/\/collab(\?|$)/, (ws) => {
    const mine = new Set<string>();
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string; topics?: string[]; topic?: string };
      if (message.type === 'subscribe') {
        for (const topic of message.topics ?? []) {
          if (!rooms.has(topic)) rooms.set(topic, new Set());
          rooms.get(topic)!.add(ws);
          mine.add(topic);
        }
      } else if (message.type === 'publish' && message.topic && mine.has(message.topic)) {
        for (const peer of rooms.get(message.topic) ?? []) peer.send(JSON.stringify({ ...message, clients: rooms.get(message.topic)!.size }));
      } else if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });
    ws.onClose(() => {
      for (const topic of mine) rooms.get(topic)?.delete(ws);
    });
  });
}

/** Tilts the phone page: a deviceorientation event as the phone's sensors send it. */
async function tilt(phone: Page, alpha: number, beta: number, gamma: number) {
  await phone.evaluate(([a, b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g, absolute: false })), [alpha, beta, gamma] as const);
}

test.describe('Director with a phone', () => {
  test('the phone page says how to open it when it has no link', async ({ page }) => {
    await page.goto('/remote');
    await expect(page.getByRole('heading', { name: 'Open this page from Director' })).toBeVisible();
  });

  test('a phone scans the code, turns the 3D phone live, and records a take', async ({ page, context }) => {
    await standInRelay(context);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    test.skip(!(await page.evaluate(() => typeof DeviceOrientationEvent !== 'undefined')), 'No DeviceOrientationEvent in this browser');
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    await pause(page);
    await seek(page, 1);

    const hand = page.getByTestId('director-hand');
    await hand.getByRole('button', { name: 'Use your phone' }).click();
    const qr = hand.getByTestId('director-qr');
    await expect(qr).toBeVisible();
    const link = await qr.getAttribute('data-link');
    expect(link).toMatch(/\/remote#r=[0-9a-f]{32}&t=test-ticket$/);

    // The phone opens the link from the code.
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(link!.replace(/^https?:\/\/[^/]+/, ''));
    await expect(phone.getByTestId('remote-start')).toBeVisible({ timeout: 30_000 });
    await expect(hand.getByTestId('director-link-status')).toContainText('connected', { timeout: 30_000 });
    await phone.getByTestId('remote-start').click();
    await expect(phone.getByTestId('remote-live')).toBeVisible();

    // Held upright, then turned: the 3D phone on the computer turns with it.
    await page.waitForTimeout(400);
    const still = await filmPicture(page);
    for (let i = 0; i <= 10; i++) {
      await tilt(phone, 0, 80, 0);
      await phone.waitForTimeout(16);
    }
    await phone.getByTestId('remote-center').click();
    for (let i = 0; i <= 20; i++) {
      await tilt(phone, 0, 80, i * 2);
      await phone.waitForTimeout(16);
    }
    await page.waitForTimeout(600);
    const turned = await filmPicture(page);
    expect(await difference(page, still, turned)).toBeGreaterThan(3);

    // Record a take from the phone: the film plays from the start and keeps the moves.
    await phone.getByTestId('remote-record').click();
    for (let i = 0; i < 60; i++) {
      await tilt(phone, 0, 80, 20 * Math.sin(i / 8));
      await phone.waitForTimeout(25);
    }
    await phone.getByTestId('remote-record').click();
    await expect(hand.getByTestId('director-take')).toBeVisible({ timeout: 30_000 });
    await expect(hand.getByRole('switch', { name: 'Use my take' })).toBeChecked();
    await phone.close();
  });
});
