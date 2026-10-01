import { test, expect, type Page } from '../fixtures/test';
import { put } from '../fixtures/db';
import { Editor } from '../helpers/editor';

/**
 * The App Preview video export, judged by the frames it hands the encoder.
 *
 * Each element reaches the MP4 as a sprite: one html-to-image capture of the
 * element, moved into the corner of its own small canvas through the capture's
 * `style` option (captureSprite in src/lib/video/videoExport.ts). The clone
 * html-to-image makes also carries the element's logical insets, which hold its
 * board position, and a move that misses them draws the element outside its
 * own sprite. The video then comes out as the background alone, nothing
 * reports an error, and a PNG export of the same board still looks right, so a
 * frame is the only place it shows.
 *
 * The pixels are read from the canvas each VideoFrame is built from, before
 * encoding. That keeps the check exact, and it works in Playwright's Chromium,
 * which can encode H.264 but cannot play it back.
 */

/** The dialog's default export size, so a point on the board is the same point in a frame. */
const BOARD = { width: 886, height: 1920 };
const WHITE: Rgb = [255, 255, 255];
/** Bottom left, clear of every rectangle. */
const BACKGROUND_POINT = { x: 60, y: 1800 };

type Rgb = [number, number, number];

interface Swatch {
  id: string;
  /** What the rectangle exercises, for the failure message. */
  route: string;
  /** Its centre, which stays inside it however it is rotated or scaled. */
  at: { x: number; y: number };
  rgb: Rgb;
  props: Record<string, unknown>;
}

const SWATCHES: Swatch[] = [
  {
    id: 'el_far',
    route: 'an element far from the board origin',
    at: { x: 630, y: 1400 },
    rgb: [37, 99, 235],
    props: {
      fillColor: '#2563EB',
      position: { x: 480, y: 1300 },
      size: { width: 300, height: 200 },
      // An animation is what makes this an App Preview board. It has finished
      // long before the last frame.
      animation: { enter: 'fade', enterDelay: 0, enterDuration: 0.2 },
    },
  },
  {
    id: 'el_shadow',
    route: 'a padded sprite (its drop shadow grows the capture by 40px a side)',
    at: { x: 250, y: 350 },
    rgb: [22, 163, 74],
    props: {
      fillColor: '#16A34A',
      position: { x: 120, y: 260 },
      size: { width: 260, height: 180 },
      shadow: { x: 0, y: 16, blur: 24, color: 'rgba(0, 0, 0, 0.35)' },
    },
  },
  {
    id: 'el_turned',
    route: 'a rotated element',
    at: { x: 570, y: 640 },
    rgb: [220, 38, 38],
    props: {
      fillColor: '#DC2626',
      position: { x: 450, y: 520 },
      size: { width: 240, height: 240 },
      rotation: 30,
    },
  },
  {
    id: 'el_scaled',
    route: 'a scaled element',
    at: { x: 220, y: 990 },
    rgb: [147, 51, 234],
    props: {
      fillColor: '#9333EA',
      position: { x: 100, y: 900 },
      size: { width: 160, height: 120 },
      scale: 1.5,
    },
  },
];

/** One App Preview board holding the swatches, one second long. */
function seedProject() {
  return {
    id: 'proj_video_frames',
    name: 'Video Frames',
    // A Date, as the app writes it: the start dialog calls toLocaleString() on it.
    timestamp: new Date('2024-05-04T10:00:00.000Z'),
    projectData: [
      {
        id: 'artboard_video_frames',
        name: 'Frames',
        size: BOARD,
        backgroundColor: '#FFFFFF',
        zoom: 1,
        position: { x: 50, y: 50 },
        previewDurationSeconds: 1,
        elements: SWATCHES.map((swatch) => ({
          id: swatch.id,
          type: 'shape',
          shapeType: 'rectangle',
          name: swatch.id,
          rotation: 0,
          scale: 1,
          strokeColor: '#000000',
          strokeWidth: 0,
          ...swatch.props,
        })),
      },
    ],
  };
}

interface FramePixels {
  timestamp: number;
  pixels: Rgb[];
}

/**
 * Before the app loads, wrap VideoFrame so every frame built from a canvas
 * leaves behind the colour at each of `points`.
 */
async function recordFramePixels(page: Page, points: { x: number; y: number }[]): Promise<void> {
  await page.addInitScript((points) => {
    const Native = window.VideoFrame;
    if (typeof Native !== 'function') return;
    const frames: { timestamp: number; pixels: number[][] }[] = [];
    (window as unknown as { __framePixels: typeof frames }).__framePixels = frames;
    window.VideoFrame = new Proxy(Native, {
      construct(target, args, newTarget) {
        const [source, init] = args as [unknown, { timestamp?: number } | undefined];
        const context = source instanceof HTMLCanvasElement ? source.getContext('2d') : null;
        if (context) {
          frames.push({
            timestamp: init?.timestamp ?? 0,
            pixels: points.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))),
          });
        }
        return Reflect.construct(target, args, newTarget);
      },
    });
  }, points);
}

/** Seeding needs the app to have created its Dexie schema first. */
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

function expectColour(actual: Rgb, expected: Rgb, what: string): void {
  const off = Math.max(...expected.map((channel, i) => Math.abs(channel - actual[i])));
  expect(off, `${what}: got rgb(${actual.join(', ')}), wanted rgb(${expected.join(', ')})`).toBeLessThanOrEqual(6);
}

test.describe('App Preview video export', () => {
  test('every layer lands in the frame where the board has it', async ({ page }) => {
    test.setTimeout(180_000);
    await recordFramePixels(page, [...SWATCHES.map((swatch) => swatch.at), BACKGROUND_POINT]);

    const editor = new Editor(page);
    await editor.goto();
    test.skip(
      !(await page.evaluate(() => typeof VideoEncoder === 'function')),
      'This engine has no WebCodecs encoder, so it cannot export a video at all.'
    );
    await expect(editor.startDialog).toBeVisible();
    await waitForProjectStore(page);
    await put(page, 'projects', seedProject());

    await editor.goto('/');
    await editor.startDialog.getByText('Video Frames', { exact: true }).click();
    await expect(editor.startDialog).toBeHidden();
    for (const swatch of SWATCHES) {
      await expect(editor.board(0).locator(`[data-element-id="${swatch.id}"]`)).toBeVisible();
    }

    await editor.chooseFromMenu(editor.exportButton, /App preview video/i);
    const dialog = page.getByRole('dialog').filter({ hasText: 'Export App Preview Video' });
    await expect(dialog).toBeVisible();
    // With no recording on the board the dialog starts on the styled render,
    // and the button stays disabled until it has measured the board.
    await dialog.getByRole('button', { name: 'Export Styled Video' }).click();
    await expect(page.getByText('Video Exported', { exact: true }).first()).toBeVisible({ timeout: 120_000 });

    const frames = await page.evaluate(
      () => (window as unknown as { __framePixels: FramePixels[] }).__framePixels
    );
    // One second at the dialog's 30 fps.
    expect(frames).toHaveLength(30);
    const ordered = [...frames].sort((a, b) => a.timestamp - b.timestamp);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];

    // The faded rectangle has not appeared yet at 0s, which shows these are the
    // export's own frames, read as they are drawn.
    expectColour(first.pixels[0], WHITE, `${SWATCHES[0].route} at 0s`);
    for (const [index, swatch] of SWATCHES.entries()) {
      expectColour(last.pixels[index], swatch.rgb, swatch.route);
    }
    expectColour(last.pixels[SWATCHES.length], WHITE, 'the background');
  });
});
