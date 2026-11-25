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
import type { BrowserContext, Page, Route, WebSocketRoute } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { Editor } from '../helpers/editor';

test.use({ actionTimeout: 30_000 });
test.describe.configure({ timeout: 300_000, mode: 'default' });

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'director');
const IOS = path.join(FIXTURES, 'ios-habits-small.mp4');
const ANDROID = path.join(FIXTURES, 'android-small.mp4');
const ICON = path.join(FIXTURES, 'app-icon.png');

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

/** Seconds from a clip's label, "name, 0:06.0 long". */
function clipSeconds(label: string | null): number {
  const match = /(\d+):(\d+(?:\.\d+)?) long/.exec(label ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
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
  const strip = page.getByRole('slider', { name: 'Video position' });
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

interface ColorBox {
  r: [number, number];
  g: [number, number];
  b: [number, number];
}

/** The share of a picture's pixels inside a colour box, 0 to 1, in a band of its height (fractions from the top). */
async function shareOf(page: Page, picture: Buffer, box: ColorBox, band: [number, number] = [0, 1]): Promise<number> {
  return page.evaluate(
    async ([base64, c, from, to]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const y0 = Math.floor(canvas.height * from);
      const y1 = Math.ceil(canvas.height * to);
      const data = ctx.getImageData(0, y0, canvas.width, y1 - y0).data;
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] >= c.r[0] && data[i] <= c.r[1] && data[i + 1] >= c.g[0] && data[i + 1] <= c.g[1] && data[i + 2] >= c.b[0] && data[i + 2] <= c.b[1]) hits += 1;
      }
      return hits / (data.length / 4);
    },
    [picture.toString('base64'), box, band[0], band[1]] as const
  );
}

/** A picture's mean brightness, 0 to 255. */
async function brightness(page: Page, picture: Buffer): Promise<number> {
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
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    return sum / (data.length / 4);
  }, picture.toString('base64'));
}

/** Bold captions' yellow, Bloom's violet discs, and a pure green set by hand. */
const YELLOW: ColorBox = { r: [225, 255], g: [180, 230], b: [0, 90] };
const VIOLET: ColorBox = { r: [70, 200], g: [10, 120], b: [165, 255] };
const GREEN: ColorBox = { r: [0, 70], g: [200, 255], b: [0, 70] };

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
    // A close-up is a pill with a button in it; every other moment is a marker, a button itself.
    const labels = await page.getByTestId('director-moment').evaluateAll((els) => els.map((el) => el.querySelector('button')?.getAttribute('aria-label') ?? el.getAttribute('aria-label') ?? ''));
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

  test('a template sets the shape, the camera and the words, and the recording comes first', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await page.locator('[data-template-id="social-ad"]').click();
    await expect(page.getByTestId('director-begin')).toBeVisible();
    await page.getByTestId('director-recording-first').click();
    await expect(page.getByTestId('director-pick')).toBeVisible();
    await addRecording(page, ANDROID);
    await expect(page.getByTestId('director-shape').getByRole('button', { name: /^Square/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('director-style').getByRole('button', { name: /^Bold/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('director-end')).toHaveValue('Get it today');
    // The recording still picks the phone: an Android one gets a Pixel.
    await expect(page.getByTestId('director-phone').getByRole('combobox', { name: 'Phone model in the video' })).toContainText('Pixel');
  });

  test('Cinematic: its camera, background and words, the icon, a white end card, and words styled and coloured', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    const ids = await page.locator('[data-template-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-template-id')));
    expect(ids.slice(0, 2)).toEqual(['cinematic', 'pop']);
    await page.locator('[data-template-id="cinematic"]').click();
    await page.getByTestId('director-recording-first').click();
    await addRecording(page, IOS);
    await pause(page);
    await expect(page.getByTestId('director-style').getByRole('button', { name: /^Cinematic/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('director-background').getByRole('button', { name: 'Noir' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('director-words-headline')).toHaveAttribute('aria-pressed', 'true');
    const card = page.getByTestId('director-card');
    await expect(card.getByRole('switch', { name: 'Add an ending screen' })).toHaveAttribute('aria-checked', 'true');
    await expect(card.getByRole('switch', { name: 'Make the ending screen white' })).toHaveAttribute('aria-checked', 'true');
    // The icon at the top needs an icon first.
    await expect(card.getByRole('switch', { name: 'Show icon in the top left' })).toBeDisabled();
    await page.getByTestId('director-icon-file').setInputFiles(ICON);
    await expect(page.getByTestId('director-icon')).toBeVisible();
    await expect(card.getByRole('switch', { name: 'Show icon in the top left' })).toBeEnabled();

    // The end: the white card. Over the film instead, the end is Noir's black.
    const duration = Number(await page.getByRole('slider', { name: 'Video position' }).getAttribute('aria-valuemax'));
    await seek(page, duration);
    await expect.poll(async () => brightness(page, await filmPicture(page)), { timeout: 15_000 }).toBeGreaterThan(200);
    await card.getByRole('switch', { name: 'Make the ending screen white' }).click();
    await expect.poll(async () => brightness(page, await filmPicture(page)), { timeout: 15_000 }).toBeLessThan(110);

    // Bold captions: the title at the bottom, its starred word in yellow; Soft has no yellow.
    await page.getByTestId('director-title').fill('Daily *habits*');
    await page.getByTestId('director-words-punchy').click();
    await seek(page, 3);
    await page.waitForTimeout(600);
    const bold = await filmPicture(page);
    expect(await shareOf(page, bold, YELLOW, [0.6, 0.85])).toBeGreaterThan(0.002);
    expect(await shareOf(page, bold, YELLOW, [0, 0.5])).toBeLessThan(0.0005);
    await page.getByTestId('director-words-soft').click();
    await page.waitForTimeout(600);
    expect(await shareOf(page, await filmPicture(page), YELLOW)).toBeLessThan(0.0005);
    // A highlight colour of the user's own.
    await page.getByTestId('director-words-punchy').click();
    await page.getByTestId('director-accent').fill('#00ff00');
    await page.waitForTimeout(600);
    const green = await filmPicture(page);
    expect(await shareOf(page, green, GREEN, [0.6, 0.85])).toBeGreaterThan(0.002);
    expect(await shareOf(page, green, YELLOW)).toBeLessThan(0.0005);
  });

  test('Pop promo: violet discs, bold captions, the icon at the top, and a card that clears the discs away', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await page.locator('[data-template-id="pop"]').click();
    await page.getByTestId('director-recording-first').click();
    await addRecording(page, IOS);
    await pause(page);
    await expect(page.getByTestId('director-background').getByRole('button', { name: 'Bloom' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('director-words-punchy')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('director-icon-file').setInputFiles(ICON);
    const card = page.getByTestId('director-card');
    await expect(card.getByRole('switch', { name: 'Show icon in the top left' })).toHaveAttribute('aria-checked', 'true');
    await expect(card.getByRole('switch', { name: 'Make the ending screen white' })).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('director-title').fill('Daily habits');
    // Partway in: the violet discs, and the title's last word in yellow.
    await seek(page, 1.4);
    await page.waitForTimeout(600);
    const during = await filmPicture(page);
    expect(await shareOf(page, during, VIOLET)).toBeGreaterThan(0.05);
    expect(await shareOf(page, during, YELLOW, [0.6, 0.85])).toBeGreaterThan(0.002);
    // The end: the card, with the discs gone and the room pale behind it.
    const duration = Number(await page.getByRole('slider', { name: 'Video position' }).getAttribute('aria-valuemax'));
    await seek(page, duration);
    await expect.poll(async () => shareOf(page, await filmPicture(page), VIOLET), { timeout: 15_000 }).toBeLessThan(0.01);
    expect(await brightness(page, await filmPicture(page))).toBeGreaterThan(150);
    // Turning the card off keeps the discs to the end.
    await card.getByRole('switch', { name: 'Add an ending screen' }).click();
    const newEnd = Number(await page.getByRole('slider', { name: 'Video position' }).getAttribute('aria-valuemax'));
    expect(newEnd).toBeLessThan(duration);
    await seek(page, newEnd);
    await expect.poll(async () => shareOf(page, await filmPicture(page), VIOLET), { timeout: 15_000 }).toBeGreaterThan(0.05);
  });

  test('two recordings: a split, the recording changed from the playhead, undo, and taking one out', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    await pause(page);
    const ruler = page.getByRole('slider', { name: 'Video position' });
    const length = async () => Number(await ruler.getAttribute('aria-valuemax'));
    const clips = page.getByTestId('director-clip');
    const whole = await length();

    // A split keeps the film's length and makes two clips of one recording.
    await seek(page, 6);
    await page.getByTestId('director-split').click();
    await expect(clips).toHaveCount(2);
    expect(Math.abs((await length()) - whole)).toBeLessThan(0.05);
    await page.waitForTimeout(700); // the next change is a step of its own for undo

    // From the playhead on, the Android recording: the second clip becomes it, whole.
    await page.getByTestId('director-change-from').click();
    await page.getByTestId('director-file').setInputFiles(ANDROID);
    await expect(clips.nth(1)).toHaveAttribute('aria-label', /android-small/);
    await expect(page.getByTestId('director-busy')).toHaveCount(0, { timeout: 120_000 });
    const cutAt = clipSeconds(await clips.nth(0).getAttribute('aria-label'));
    const android = truth('android-small.json').duration;
    expect(Math.abs((await length()) - (cutAt + android + 0.7))).toBeLessThan(0.15);
    // The picked clip's panel says which recording it is.
    await expect(page.getByTestId('director-clip-panel')).toContainText('Recording 2 of 2');
    await expect(page.getByTestId('director-clip-panel')).toContainText('android-small');

    // Undo puts the first recording back from the playhead on.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(clips.nth(1)).toHaveAttribute('aria-label', /ios-habits-small/);
    expect(Math.abs((await length()) - whole)).toBeLessThan(0.05);

    // Taking the second clip out leaves the first, and the film shortens to it.
    await clips.nth(1).click();
    await page.getByTestId('director-delete-selected').click();
    await expect(clips).toHaveCount(1);
    expect(Math.abs((await length()) - (cutAt + 0.7))).toBeLessThan(0.15);
  });

  test('an Android recording gets an Android phone', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, ANDROID);
    await expect(page.getByTestId('director-phone').getByRole('combobox', { name: 'Phone model in the video' })).toContainText('Pixel');
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
    await panel.getByRole('button', { name: 'Skip this moment' }).click();
    const pill = page.locator(`[data-testid="director-moment"][data-moment-id="${id}"]`);
    await expect(pill).toHaveAttribute('data-close', 'false');
    await expect(pill.getByRole('button')).toHaveAccessibleName(/skipped/);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(pill).toHaveAttribute('data-close', 'true');
  });

  test('a close-up dragged across a cut can be deleted at once: what is picked follows it to its new clip', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    await pause(page);
    await seek(page, 4);
    await page.getByTestId('director-add-closeup').click();
    const mine = page.locator('[data-testid="director-moment"][data-moment-id*="-u"]');
    await expect(mine).toHaveCount(1);
    await seek(page, 7);
    await page.getByTestId('director-split').click();
    await expect(page.getByTestId('director-clip')).toHaveCount(2);
    const before = await mine.getAttribute('data-moment-id');

    // Pixels a second on the timeline, from two moments' places, then a real drag from 4 s to 10 s.
    const pps = await page.evaluate(() => {
      const marks = Array.from(document.querySelectorAll('[data-testid="director-moment"]')).map((el) => {
        const button = (el.querySelector('button') ?? el) as HTMLElement;
        const t = Number(/ at ([\d.]+) seconds/.exec(button.getAttribute('aria-label') ?? '')?.[1]);
        const r = button.getBoundingClientRect();
        return { t, x: r.left + r.width / 2 };
      }).filter((m) => Number.isFinite(m.t));
      const a = marks[0];
      const b = marks[marks.length - 1];
      return (b.x - a.x) / (b.t - a.t);
    });
    const box = (await mine.getByRole('button').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3 * pps, y, { steps: 6 });
    await page.mouse.move(x + 6 * pps, y, { steps: 6 });
    await page.mouse.up();
    await expect(mine).not.toHaveAttribute('data-moment-id', before!);

    // Delete straight away, nothing picked again: the close-up goes.
    await page.getByRole('button', { name: 'Delete selection' }).click();
    await expect(mine).toHaveCount(0);
  });

  test('a film playing when Director is left stays paused, even when a reading finishes out of sight', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    const playing = () => page.evaluate(() => Array.from(document.querySelectorAll('video')).filter((video) => !video.paused).length);
    const button = page.getByTestId('director-viewport').getByRole('button', { name: /^(Play|Pause)$/ });
    if ((await button.getAttribute('aria-label')) === 'Play') await button.click();
    await expect(button).toHaveAttribute('aria-label', 'Pause');
    await expect.poll(playing).toBeGreaterThan(0);

    // The recording read again while the film plays, and the editor shown before the reading is done.
    await page.getByTestId('director-clip').first().click();
    await page.getByRole('button', { name: 'Find moments again' }).click();
    await expect(page.getByTestId('director-busy')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the editor' }).click();
    await expect(page.getByTestId('director-view')).toBeHidden();
    // Still reading out of sight: the end of the reading is what this test is about.
    await expect(page.getByTestId('director-busy')).toHaveCount(1);
    await expect(page.getByTestId('director-busy')).toHaveCount(0, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    expect(await playing()).toBe(0);

    // Back in Director: paused, and it plays when asked.
    await page.getByRole('button', { name: /^Director: / }).click();
    await expect(page.getByTestId('director-view')).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', 'Play');
    await button.click();
    await expect.poll(playing).toBeGreaterThan(0);
    await pause(page);
  });

  test('reading waits while the page is hidden, and finishes with every kind of moment once it is seen', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    // The page as a hidden or covered window reports itself.
    await page.evaluate(() => {
      let state: DocumentVisibilityState = 'visible';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      (window as unknown as { __hidePage: (on: boolean) => void }).__hidePage = (on) => {
        state = on ? 'hidden' : 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    const hide = (on: boolean) => page.evaluate((value) => (window as unknown as { __hidePage: (on: boolean) => void }).__hidePage(value), on);
    const busy = page.getByTestId('director-busy');
    const progress = async () => ((await busy.count()) ? Number((await busy.innerText()).match(/(\d+)%/)?.[1] ?? -1) : 100);

    // Hidden from the start: the recording waits to be read.
    await hide(true);
    await page.getByTestId('director-file').setInputFiles(IOS);
    await expect(busy).toBeVisible({ timeout: 60_000 });
    const waiting = await progress();
    await page.waitForTimeout(3000);
    expect(await progress()).toBe(waiting);

    // Seen: it reads. Hidden again partway: it stops where it was.
    await hide(false);
    await expect.poll(progress, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(5);
    await hide(true);
    await page.waitForTimeout(600);
    const held = await progress();
    expect(held, 'still reading when hidden').toBeLessThan(100);
    await page.waitForTimeout(3000);
    expect(await progress()).toBe(held);

    // Seen again: it finishes, and finds what a reading in view finds.
    await hide(false);
    await expect(busy).toHaveCount(0, { timeout: 120_000 });
    const labels = await page.getByTestId('director-moment').evaluateAll((els) => els.map((el) => el.querySelector('button')?.getAttribute('aria-label') ?? el.getAttribute('aria-label') ?? ''));
    for (const kind of ['Tap', 'Scroll', 'Typing']) expect(labels.some((label) => label.startsWith(kind)), `${kind} in ${labels.join(', ')}`).toBe(true);
  });

  test('a play still on its way when Director is left doesn\'t run the video on unseen', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    await pause(page);
    // The next play() waits until a pause cuts it short, as a browser does with a play still loading.
    await page.evaluate(() => {
      const play = HTMLMediaElement.prototype.play;
      const pauseVideo = HTMLMediaElement.prototype.pause;
      const held = new Map<HTMLMediaElement, (error: DOMException) => void>();
      const flag = window as unknown as { __holdPlay: boolean };
      flag.__holdPlay = true;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (!flag.__holdPlay) return play.call(this);
        flag.__holdPlay = false;
        return new Promise<void>((_resolve, reject) => held.set(this, reject));
      };
      HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
        const reject = held.get(this);
        if (reject) {
          held.delete(this);
          reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
        }
        return pauseVideo.call(this);
      };
    });
    const button = page.getByTestId('director-viewport').getByRole('button', { name: /^(Play|Pause)$/ });
    await button.click();
    await expect(button).toHaveAttribute('aria-label', 'Pause');
    expect(await page.evaluate(() => (window as unknown as { __holdPlay: boolean }).__holdPlay)).toBe(false);
    await page.getByRole('button', { name: 'Back to the editor' }).click();
    await expect(page.getByTestId('director-view')).toBeHidden();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('video')).filter((video) => !video.paused).length)).toBe(0);
  });

  test('exports an MP4 that plays, with the film\'s length', async ({ page, isDesktop, tauri }) => {
    // Playwright's Chromium draws WebGL in software: reading each frame back
    // takes most of the export, and longer still while the machine is busy.
    test.setTimeout(720_000);
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
    // A white end card with the icon and the badges: it has to reach the file, its pictures loaded first.
    await page.getByTestId('director-icon-file').setInputFiles(ICON);
    await expect(page.getByTestId('director-icon')).toBeVisible();
    const card = page.getByTestId('director-card');
    await card.getByRole('switch', { name: 'Add an ending screen' }).click();
    await card.getByRole('switch', { name: 'Make the ending screen white' }).click();
    await expect(card.getByRole('switch', { name: 'Make the ending screen white' })).toHaveAttribute('aria-checked', 'true');
    // Read before the dialog opens: a modal dialog hides the page behind it from these queries.
    const duration = Number(await page.getByRole('slider', { name: 'Video position' }).getAttribute('aria-valuemax'));

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
      await expect(dialog.getByTestId('director-export-done')).toBeVisible({ timeout: 600_000 });
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
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), dialog.getByTestId('director-export-start').click()]);
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
      // The last frames: the white card, with the icon's orange and the badges' black on it.
      const look = async (t: number) => {
        video.currentTime = t;
        await new Promise((resolve) => (video.onseeked = resolve));
        const canvas = document.createElement('canvas');
        canvas.width = 270;
        canvas.height = 270;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, 270, 270);
        const data = ctx.getImageData(0, 0, 270, 270).data;
        let sum = 0;
        let orange = 0;
        let black = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (data[i] > 200 && data[i + 1] > 60 && data[i + 1] < 170 && data[i + 2] < 140) orange += 1;
          if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) black += 1;
        }
        const n = data.length / 4;
        return { brightness: sum / n, orange: orange / n, black: black / n };
      };
      const end = await look(video.duration - 0.15);
      const before = await look(Math.max(0, video.duration - 3.2));
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, end, before };
    }, bytes.toString('base64'));
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1080);
    expect(Math.abs(probe.duration - duration)).toBeLessThan(0.2);
    expect(probe.end.brightness, JSON.stringify(probe)).toBeGreaterThan(190);
    expect(probe.end.orange, 'the icon').toBeGreaterThan(0.01);
    expect(probe.end.black, 'the badges').toBeGreaterThan(0.005);
    expect(probe.before.brightness, 'the film before the card').toBeLessThan(probe.end.brightness - 60);
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

/**
 * Moves the phone page as its accelerometer would read it, at 60 a second:
 * at rest first (gravity only, the standard's signs), then a push of
 * `metres` toward the person over `seconds`, then at rest again.
 */
async function pushPhone(phone: Page, metres: number, seconds: number) {
  await phone.evaluate(
    async ([distance, length]) => {
      const beta = (80 * Math.PI) / 180;
      const gravity = { x: 0, y: 9.81 * Math.sin(beta), z: 9.81 * Math.cos(beta) };
      const send = (a: number) =>
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', {
            acceleration: { x: 0, y: 0, z: a },
            accelerationIncludingGravity: { x: gravity.x, y: gravity.y, z: gravity.z + a },
            rotationRate: { alpha: 0, beta: 0, gamma: 0 },
            interval: 16,
          })
        );
      const tick = () => new Promise((resolve) => setTimeout(resolve, 1000 / 60));
      for (let i = 0; i < 20; i++) {
        send(0);
        await tick();
      }
      const peak = (distance * 2 * Math.PI) / (length * length);
      const start = performance.now();
      for (;;) {
        const t = (performance.now() - start) / 1000;
        if (t > length) break;
        send(peak * Math.sin((2 * Math.PI * t) / length));
        await tick();
      }
      for (let i = 0; i < 20; i++) {
        send(0);
        await tick();
      }
    },
    [metres, seconds] as const
  );
}

test.describe('Director with a phone', () => {
  test('the phone page says how to open it when it has no link', async ({ page }) => {
    await page.goto('/remote');
    await expect(page.getByRole('heading', { name: 'Connect this phone to Director' })).toBeVisible();
  });

  test('signed out, moves first asks for a sign-in at once, with its button, and asks the server no more', async ({ page, context }) => {
    // The connection server as it answers someone signed out.
    let tickets = 0;
    await context.route('**/collab/ticket', (route) => {
      tickets += 1;
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sign in first' }) });
    });
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    await openDirector(page);
    await page.locator('[data-template-id="launch"]').click();
    await page.getByTestId('director-moves-first').click();

    const hand = page.getByTestId('director-hand');
    await expect(hand.getByText('Sign in and choose Connect a phone to get your QR code')).toBeVisible();
    await expect(hand.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    // Nothing in the way of it: no "Not connected" and no Cancel to press first.
    await expect(hand.getByTestId('director-link-status')).toHaveCount(0);
    await expect(hand.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(hand.getByRole('button', { name: 'Connect a phone' })).toBeEnabled();
    // The card under the picture says to sign in, with its own button, never to scan a code that isn't there.
    const card = page.getByTestId('director-moves-first-card');
    await expect(card).not.toContainText('Scan the QR code');
    await expect(card).toContainText('Sign in to connect your phone');
    await expect(card.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    const asked = tickets;
    expect(asked).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect(tickets).toBe(asked);
  });

  test('a connection that fails: the card says so, Cancel puts it back to connect, and trying again brings the code', async ({ page, context }) => {
    let refuse = true;
    let tickets = 0;
    await context.route('**/collab/ticket', (route) => {
      tickets += 1;
      return refuse
        ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: 'test-ticket' }) });
    });
    await context.routeWebSocket(/\/collab(\?|$)/, (ws) => ws.onMessage(() => undefined));
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    await openDirector(page);
    await page.locator('[data-template-id="launch"]').click();
    await page.getByTestId('director-moves-first').click();
    const hand = page.getByTestId('director-hand');
    const card = page.getByTestId('director-moves-first-card');
    await expect(hand.getByTestId('director-link-status')).toHaveText("Couldn't connect your phone");
    await expect(card).toContainText("Your phone couldn't connect");
    await expect(card).not.toContainText('Scan the QR code');
    // Try again from the card asks the server again (still refusing here).
    const asked = tickets;
    await card.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => tickets).toBeGreaterThan(asked);
    await expect(card).toContainText("Your phone couldn't connect");
    // Cancel in the panel: the card asks to connect, with its button.
    await hand.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toContainText('Connect your phone');
    await expect(card).not.toContainText('Scan the QR code');
    // Tried again from the card, with the server answering: the code comes up, and the card says to scan it.
    refuse = false;
    await card.getByRole('button', { name: 'Connect a phone' }).click();
    await expect(hand.getByTestId('director-qr')).toBeVisible();
    await expect(card).toContainText('Scan the QR code');
  });

  test('moves first: the phone\'s code shows at once, and the recording added later takes over', async ({ page, context }) => {
    await standInRelay(context);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await page.locator('[data-template-id="launch"]').click();
    await page.getByTestId('director-moves-first').click();

    // No click needed: the code for the phone is up as soon as the film opens.
    const hand = page.getByTestId('director-hand');
    await expect(hand.getByTestId('director-qr')).toBeVisible();
    await expect(page.getByTestId('director-no-recording')).toBeVisible();
    await expect(page.getByTestId('director-export')).toBeDisabled();
    const card = page.getByTestId('director-moves-first-card');
    await expect(card).toContainText('Scan the QR code');

    // The phone opens the code's link: the card stops asking for the code.
    const link = await hand.getByTestId('director-qr').getAttribute('data-link');
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(link!.replace(/^https?:\/\/[^/]+/, ''));
    await phone.getByTestId('remote-start').click();
    await expect(hand.getByTestId('director-link-status')).toContainText('connected', { timeout: 30_000 });
    await expect(card).toContainText('Your phone is connected');
    await expect(card).not.toContainText('Scan the QR code');
    await expect(card.getByRole('button', { name: 'Connect a phone' })).toHaveCount(0);
    // Disconnected: no code on screen, so the card asks to connect again, with its button.
    await hand.getByRole('button', { name: 'Disconnect' }).click();
    await expect(card).toContainText('Connect your phone');
    await expect(card).not.toContainText('Scan the QR code');
    await expect(card.getByRole('button', { name: 'Connect a phone' })).toBeVisible();
    await phone.close();

    // The stand-in runs as long as asked, the end words after it.
    const ruler = page.getByRole('slider', { name: 'Video position' });
    await page.getByTestId('director-no-recording').getByRole('button', { name: '20 sec' }).click();
    await expect(ruler).toHaveAttribute('aria-valuemax', '21.8');
    // It plays with no recording: the clock runs on the stand-in.
    await page.getByTestId('director-viewport').getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1200);
    expect(Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.5);
    await pause(page);

    // The recording, added later, takes over the film's length.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('director-add-first-recording').click()]);
    await chooser.setFiles(IOS);
    await expect(page.getByTestId('director-clip')).toHaveCount(1);
    await expect(page.getByTestId('director-no-recording')).toHaveCount(0);
    await expect(page.getByTestId('director-busy')).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId('director-moment').first()).toBeVisible();
    const habits = truth('ios-habits-small.json').duration;
    expect(Math.abs(Number(await ruler.getAttribute('aria-valuemax')) - (habits + 1.8))).toBeLessThan(0.1);
    await expect(page.getByTestId('director-export')).toBeEnabled();
  });

  test('forward and back is off until turned on, on the computer or the phone, and a take keeps to it', async ({ page, context }) => {
    test.setTimeout(240_000);
    await standInRelay(context);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    test.skip(!(await page.evaluate(() => typeof DeviceMotionEvent !== 'undefined')), 'No DeviceMotionEvent in this browser');
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    await pause(page);
    await seek(page, 1);
    const hand = page.getByTestId('director-hand');
    await hand.getByRole('button', { name: 'Connect a phone' }).click();
    const link = await hand.getByTestId('director-qr').getAttribute('data-link');
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(link!.replace(/^https?:\/\/[^/]+/, ''));
    await phone.getByTestId('remote-start').click();
    await expect(phone.getByTestId('remote-live')).toBeVisible();
    await expect(hand.getByTestId('director-link-status')).toContainText('connected', { timeout: 30_000 });
    const onDesk = hand.getByRole('switch', { name: 'Zoom by moving your phone' });
    const onPhone = phone.getByTestId('remote-depth');
    await expect(onDesk).toHaveAttribute('aria-checked', 'false');
    await expect(onPhone).toHaveText('Zoom by moving your phone (off)');
    for (let i = 0; i < 5; i++) await tilt(phone, 0, 80, 0);
    await phone.getByTestId('remote-center').click();
    await tilt(phone, 0, 80, 0);
    await page.waitForTimeout(400);
    const before = await filmPicture(page);
    const changed = async (from = before) => difference(page, from, await filmPicture(page));

    // Off: twenty centimetres closer and the picture stays as it was.
    await pushPhone(phone, 0.2, 0.6);
    await tilt(phone, 0, 80, 0);
    await page.waitForTimeout(400);
    expect(await changed()).toBeLessThan(0.5);

    // On at the computer: the phone shows it and starts from where it is, so nothing jumps.
    await onDesk.click();
    await expect(onPhone).toHaveText('Zoom by moving your phone (on)');
    await tilt(phone, 0, 80, 0);
    await page.waitForTimeout(400);
    expect(await changed()).toBeLessThan(0.5);
    // Then a push moves in, as it happens: the phone held at one angle sends
    // no orientation events, so no tilt carries the distance to the computer.
    await pushPhone(phone, 0.2, 0.6);
    const zoom = async () => Number((await phone.getByTestId('remote-zoom').innerText()).match(/([\d.]+)x/)![1]);
    await expect.poll(zoom).toBeGreaterThan(1.3);
    await page.waitForTimeout(400);
    expect(await changed()).toBeGreaterThan(3);

    // A take, held that close the whole way.
    const record = hand.getByTestId('director-record-take');
    await record.click();
    await expect(record).toHaveText('Stop recording');
    for (let i = 0; i < 40; i++) {
      await tilt(phone, 0, 80, 0);
      await page.waitForTimeout(50);
    }
    await record.click();
    await expect(hand.getByTestId('director-take')).toBeVisible();
    await seek(page, 1);
    await page.waitForTimeout(400);
    const closer = await filmPicture(page);
    expect(await difference(page, before, closer)).toBeGreaterThan(3);

    // Off on the phone: the computer follows, and the take is back at the planned distance.
    await onPhone.click();
    await expect(onDesk).toHaveAttribute('aria-checked', 'false');
    await expect(onPhone).toHaveText('Zoom by moving your phone (off)');
    await page.waitForTimeout(400);
    expect(await changed(closer)).toBeGreaterThan(3);
    expect(await changed()).toBeLessThan(0.5);
  });

  test('while the code is on its way the card says so, and a late answer to an older try leaves a connected phone alone', async ({ page, context }) => {
    await standInRelay(context);
    // Registered after the stand-in, so it answers first. Tickets hang until the test answers them
    // (development runs the first connect twice, so there can be two); after Cancel they come at once.
    const held: Route[] = [];
    let answerNow = false;
    await context.route('**/collab/ticket', (route) => {
      if (!answerNow) {
        held.push(route);
        return;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: 'test-ticket' }) });
    });
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    await openDirector(page);
    await page.locator('[data-template-id="launch"]').click();
    await page.getByTestId('director-moves-first').click();
    const hand = page.getByTestId('director-hand');
    const card = page.getByTestId('director-moves-first-card');
    await expect(hand.getByTestId('director-link-status')).toHaveText('Preparing the QR code');
    await expect(card).toContainText('Preparing the QR code');
    await expect(card).not.toContainText('Scan the QR code');
    await expect(page.getByTestId('director-qr')).toHaveCount(0);

    // Cancel, then try again from the card: this time the code comes, and a phone connects.
    await hand.getByRole('button', { name: 'Cancel' }).click();
    answerNow = true;
    await card.getByRole('button', { name: 'Connect a phone' }).click();
    const link = await hand.getByTestId('director-qr').getAttribute('data-link');
    await expect(card).toContainText('Scan the QR code');
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(link!.replace(/^https?:\/\/[^/]+/, ''));
    await phone.getByTestId('remote-start').click();
    await expect(hand.getByTestId('director-link-status')).toContainText('connected', { timeout: 30_000 });
    await expect(card).toContainText('Your phone is connected');

    // The first try's answer arrives at last, refused: nothing changes.
    expect(held.length).toBeGreaterThan(0);
    for (const route of held) await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sign in first' }) });
    await page.waitForTimeout(1500);
    await expect(hand.getByTestId('director-link-status')).toContainText('connected');
    await expect(hand.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    await expect(card).toContainText('Your phone is connected');
    await expect(hand.getByText('Sign in and choose Connect a phone to get your QR code')).toHaveCount(0);
    await phone.close();
  });

  test('a phone\'s Record while Director is hidden changes nothing: the film stays paused where it was', async ({ page, context }) => {
    await standInRelay(context);
    const editor = new Editor(page);
    await editor.goto();
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await editor.startBlankProject();
    await openDirector(page);
    await addRecording(page, IOS);
    await pause(page);
    await seek(page, 2);
    // Found by its attributes, not its role: a role lookup skips it while Director is hidden.
    const ruler = page.locator('[role="slider"][aria-label="Video position"]');
    const hand = page.getByTestId('director-hand');
    await hand.getByRole('button', { name: 'Connect a phone' }).click();
    const link = await hand.getByTestId('director-qr').getAttribute('data-link');
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(link!.replace(/^https?:\/\/[^/]+/, ''));
    await phone.getByTestId('remote-start').click();
    await expect(phone.getByTestId('remote-live')).toBeVisible();
    await expect(hand.getByTestId('director-link-status')).toContainText('connected', { timeout: 30_000 });
    const before = await ruler.getAttribute('aria-valuenow');
    expect(Number(before)).toBeGreaterThan(1.5);

    // Director hidden, then Record pressed on the phone: the film neither plays nor goes back to the start.
    await page.getByRole('button', { name: 'Back to the editor' }).click();
    await expect(page.getByTestId('director-view')).toBeHidden();
    await phone.getByTestId('remote-record').click();
    await page.waitForTimeout(1500);
    expect(await ruler.getAttribute('aria-valuenow')).toBe(before);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('video')).filter((video) => !video.paused).length)).toBe(0);

    // Back in Director: paused at the same place, and no take began.
    await page.getByRole('button', { name: /^Director: / }).click();
    await expect(page.getByTestId('director-viewport').getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(hand.getByTestId('director-record-take')).toHaveText('Start recording');
    expect(await ruler.getAttribute('aria-valuenow')).toBe(before);
    await phone.close();
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
    await hand.getByRole('button', { name: 'Connect a phone' }).click();
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
    await expect(hand.getByRole('switch', { name: 'Use my saved phone movements' })).toBeChecked();
    await phone.close();
  });
});
