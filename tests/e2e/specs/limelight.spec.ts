import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { Editor } from '../helpers/editor';
import { png } from '../helpers/png';

// Limelight (src/lib/limelight): the activity bar's view that films the
// user's app on 3D phones. These drive the real stage, WebGL included, and
// judge it by its pixels: a screen has to show its picture in the picture's
// own colours, and keep showing it, moving, through what takes a WebGL
// picture away (a tab in the back, another view in front, a resize, the GPU
// dropping the context with or without giving it back). A video is read back
// frame by frame, and its sound track decoded.

test.use({ actionTimeout: 30_000 });
// One at a time, in order: each test drives a WebGL stage, and four at once
// on a busy Mac ran past their time.
test.describe.configure({ mode: 'default', timeout: 240_000 });

const VIEW_BUTTON = 'Limelight: film your app in 3D for promo videos';
/** A screenshot in one colour, so a pixel of the screen can be checked exactly. */
const BLUE: [number, number, number] = [51, 102, 204];
const SOLID = png(300, 650, () => BLUE);
const SOLID_URL = `data:image/png;base64,${SOLID.toString('base64')}`;

type RGB = [number, number, number];
const near = (a: RGB, b: RGB, tolerance: number) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function openView(page: Page) {
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: VIEW_BUTTON }).click();
  const view = page.getByTestId('limelight-view');
  await expect(view).toBeVisible();
  return view;
}

/** Picks the scene's phone, so its inspector (and its pictures) shows. */
async function pickPhone(page: Page) {
  await page.getByTestId('limelight-timeline').getByRole('button', { name: /^iPhone 17 Pro$/ }).click();
}

/** A new scene whose phone shows the blue picture, with no reflection on its glass. */
async function startScene(page: Page) {
  const editor = new Editor(page);
  await editor.goto();
  await editor.startBlankProject();
  const view = await openView(page);
  await view.getByRole('button', { name: 'Start a scene', exact: true }).click();
  // The gallery draws its previews meanwhile; with WebGL on a busy CPU, reading one back holds the page for seconds.
  await page.getByTestId('limelight-gallery').getByRole('button', { name: /^One phone/ }).click({ timeout: 120_000 });
  // Making the scene copies pictures and starts a stage; WebKit takes its time.
  await expect(page.getByTestId('limelight-gallery')).toBeHidden({ timeout: 45_000 });
  await expect(page.getByTestId('limelight-canvas')).toBeVisible({ timeout: 60_000 });
  await pickPhone(page);
  await page.getByTestId('limelight-pictures').locator('input[type=file]').setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: SOLID });
  await expect(page.getByTestId('limelight-pictures').getByRole('button', { name: 'Picture 1', exact: true })).toBeVisible();
  // The glass reflection adds light over the screen; at 0 the screen is the picture alone.
  const glare = page.getByRole('slider', { name: 'Glass reflection' });
  await glare.focus();
  await glare.press('Home');
  await expect(glare).toHaveAttribute('aria-valuenow', '0');
  // Nothing picked, so no outline crosses the screen.
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await page.keyboard.press('Home');
}

/**
 * The colour at a point of the stage (fractions of its width and height),
 * from a screenshot of the page, which holds what WebGL drew. A stage being
 * made again swaps its canvas, so one can go between finding it and
 * measuring it: that look gives no colour, and a poll asks again.
 */
const NO_COLOUR: RGB = [-255, -255, -255];
async function stageColour(page: Page, at = { x: 0.5, y: 0.5 }): Promise<RGB> {
  const box = await page.getByTestId('limelight-canvas').boundingBox();
  if (!box) return NO_COLOUR;
  const bytes = await page.screenshot({ clip: { x: box.x + box.width * at.x - 4, y: box.y + box.height * at.y - 4, width: 8, height: 8 } });
  return colourIn(page, bytes.toString('base64'), 'image/png');
}

/** The average colour of a few pixels round a point of a picture, decoded in the page. */
async function colourIn(page: Page, base64: string, type: string, at = { x: 0.5, y: 0.5 }): Promise<RGB> {
  return page.evaluate(
    async ({ base64, type, at }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const x = Math.max(0, Math.min(bitmap.width - 3, Math.floor(at.x * bitmap.width) - 1));
      const y = Math.max(0, Math.min(bitmap.height - 3, Math.floor(at.y * bitmap.height) - 1));
      const data = ctx.getImageData(x, y, 3, 3).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
      return sum.map((v) => Math.round(v / 9)) as [number, number, number];
    },
    { base64, type, at }
  );
}

async function expectPictureShows(page: Page, label: string) {
  await expect
    .poll(async () => {
      const [r, g, b] = await stageColour(page);
      return Math.max(Math.abs(r - BLUE[0]), Math.abs(g - BLUE[1]), Math.abs(b - BLUE[2]));
    }, { message: `the phone's screen shows the picture ${label}`, timeout: 30_000 })
    .toBeLessThanOrEqual(3);
}

async function clockMoves(page: Page) {
  const clock = page.getByTestId('limelight-clock');
  const before = await clock.innerText();
  await expect.poll(() => clock.innerText(), { message: 'the clock moves while it plays', timeout: 5_000 }).not.toBe(before);
}

/** The stage as 96 x 96 grey levels, from a screenshot of the page; null while its canvas is being swapped. */
async function stageLook(page: Page): Promise<number[] | null> {
  const box = await page.getByTestId('limelight-canvas').boundingBox();
  if (!box) return null;
  const bytes = await page.screenshot({ clip: box });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, 96, 96);
    const pixels = ctx.getImageData(0, 0, 96, 96).data;
    const grey: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) grey.push((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
    return grey;
  }, [...bytes]);
}

/**
 * The picture moves, not just the clock: the stage drawn now differs from the
 * one a moment ago in more than a few places (more than grain could change).
 * A look is a screenshot, which takes seconds while Chromium here draws WebGL
 * on the CPU, so the first look is taken before the poll and the poll has time.
 */
async function stageMoves(page: Page, label: string) {
  let before = await stageLook(page);
  await expect
    .poll(async () => {
      const now = await stageLook(page);
      if (!now) return 0;
      if (!before) {
        before = now;
        return 0;
      }
      const first = before;
      return now.filter((v, i) => Math.abs(v - first[i]) > 12).length;
    }, { message: `the picture on the stage moves ${label}`, timeout: 30_000 })
    .toBeGreaterThan(20);
}

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    // On the prototype: WebKit drops properties set on the document object itself.
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function dropContext(page: Page, giveBack: boolean) {
  await page.evaluate(async (back) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="limelight-canvas"]')!;
    const ext = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('No WEBGL_lose_context');
    ext.loseContext();
    if (back) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      ext.restoreContext();
    }
  }, giveBack);
}

/** Playing, whether it was or not. */
async function play(page: Page) {
  const button = page.getByRole('button', { name: 'Play', exact: true });
  if (await button.isVisible()) await button.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
}

// ---------------------------------------------------------------------------
// The agents' tools, the CLI's way in (src/lib/headless/bridge.ts)
// ---------------------------------------------------------------------------

type ToolPart = { type: string; text?: string; data?: string; mimeType?: string };

/** The agents' MCP tools in a page loaded with window.__OSG_HEADLESS set. */
function agentTools(page: Page) {
  const raw = (name: string, args: Record<string, unknown>) =>
    page.evaluate(
      (message) => (window as unknown as { __osg: { mcp: (m: unknown) => Promise<unknown> } }).__osg.mcp(message),
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
    ) as Promise<{ result?: { content: ToolPart[]; isError?: boolean } }>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await raw(name, args);
    const text = response.result?.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('') ?? '';
    if (response.result?.isError) throw new Error(`${name}: ${text}`);
    return JSON.parse(text);
  };
  /** A frame as the agent sees it: a JPEG, as base64. */
  const frame = async (args: Record<string, unknown>) => {
    const response = await raw('render_limelight_frame', args);
    const image = response.result?.content.find((part) => part.type === 'image');
    if (response.result?.isError || !image?.data) throw new Error(`render_limelight_frame: ${JSON.stringify(response.result)}`);
    return image.data;
  };
  return { raw, call, frame };
}

async function headless(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
  });
}

/** The app booted as the CLI drives it, with one artboard whose phone shows the blue picture. */
async function bootForAgents(page: Page) {
  await headless(page);
  const editor = new Editor(page);
  await editor.goto();
  await page.waitForFunction(() => (window as unknown as { __osg?: { ready: boolean } }).__osg?.ready === true);
  const board = {
    id: 'ab_phone',
    name: 'Home',
    position: { x: 0, y: 0 },
    size: { width: 1206, height: 2622 },
    backgroundColor: '#ffffff',
    backgroundType: 'solid',
    zoom: 1,
    elements: [{ id: 'el_phone', type: 'device', deviceType: 'iphone-17-pro', screenshotSrc: SOLID_URL, position: { x: 100, y: 400 }, size: { width: 1000, height: 2000 }, rotation: 0, scale: 1 }],
  };
  await page.evaluate(
    (value) => (window as unknown as { __osg: { loadProject: (d: unknown[], n: string, i: string) => Promise<boolean> } }).__osg.loadProject([value], 'Juniper', 'proj_ll'),
    board
  );
  return agentTools(page);
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

async function canEncodeH264(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (typeof VideoEncoder === 'undefined') return false;
    const support = await VideoEncoder.isConfigSupported({ codec: 'avc1.42E01F', width: 886, height: 1920, bitrate: 6_000_000, framerate: 30 }).catch(() => ({ supported: false }));
    return !!support.supported;
  });
}

/** The shortest length, so an export is quick: 2 seconds, 60 frames. */
async function shortest(page: Page) {
  const length = page.getByRole('slider', { name: 'Length' });
  await length.focus();
  await length.press('Home');
  await expect(length).toHaveAttribute('aria-valuenow', '2');
}

/** Presses Export video and gives back the MP4 the app saved; `during` runs while it is made. */
async function exportMp4(page: Page, isDesktop: boolean, during?: () => Promise<void>): Promise<Buffer> {
  if (isDesktop) {
    // The desktop app writes the file through Tauri's fs plugin: keep what it is given.
    await page.evaluate(() => {
      const desktop = window as unknown as {
        __TAURI_INTERNALS__: { invoke(command: string, args?: unknown, options?: unknown): Promise<unknown> };
        __E2E_MP4__?: string;
      };
      const invoke = desktop.__TAURI_INTERNALS__.invoke;
      desktop.__TAURI_INTERNALS__.invoke = (command, args, options) => {
        if (command === 'plugin:fs|write_file') {
          const bytes = args instanceof ArrayBuffer
            ? new Uint8Array(args)
            : ArrayBuffer.isView(args)
              ? new Uint8Array(args.buffer, args.byteOffset, args.byteLength)
              : Uint8Array.from(args as number[]);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          desktop.__E2E_MP4__ = btoa(binary);
        }
        return invoke(command, args, options);
      };
    });
    await page.getByRole('button', { name: 'Export video', exact: true }).click();
    if (during) await during();
    await expect(page.getByTestId('limelight-export')).toBeHidden({ timeout: 180_000 });
    const written = await page.waitForFunction(() => (window as unknown as { __E2E_MP4__?: string }).__E2E_MP4__, null, { timeout: 30_000 });
    return Buffer.from((await written.jsonValue()) as string, 'base64');
  }
  const download = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  if (during) await during();
  await expect(page.getByTestId('limelight-export')).toBeHidden({ timeout: 180_000 });
  return fs.readFileSync((await (await download).path())!);
}

interface Box {
  type: string;
  /** Where the box's contents start, after its size and type. */
  body: number;
  end: number;
}

/** The boxes of an MP4 between two offsets, one level deep. */
function boxesIn(buffer: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header) break;
    boxes.push({ type, body: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

/** A box found by its path of types under `from`. */
function deepFind(buffer: Buffer, from: Box, path: string[]): Box | undefined {
  let box: Box | undefined = from;
  for (const type of path) {
    if (!box) return undefined;
    box = boxesIn(buffer, box.body, box.end).find((child) => child.type === type);
  }
  return box;
}

/** An MP4's length in seconds and its tracks, read box by box. */
function mp4Tracks(mp4: Buffer) {
  const top = boxesIn(mp4, 0, mp4.length);
  expect(top.map((box) => box.type)).toEqual(expect.arrayContaining(['ftyp', 'moov', 'mdat']));
  const moov = top.find((box) => box.type === 'moov')!;
  const inMoov = boxesIn(mp4, moov.body, moov.end);
  const mvhd = inMoov.find((box) => box.type === 'mvhd')!;
  const v1 = mp4[mvhd.body] === 1;
  const timescale = mp4.readUInt32BE(mvhd.body + (v1 ? 20 : 12));
  const length = v1 ? Number(mp4.readBigUInt64BE(mvhd.body + 24)) : mp4.readUInt32BE(mvhd.body + 16);
  const tracks = inMoov.filter((box) => box.type === 'trak').map((trak) => {
    const inTrak = boxesIn(mp4, trak.body, trak.end);
    const tkhd = inTrak.find((box) => box.type === 'tkhd')!;
    const mdia = inTrak.find((box) => box.type === 'mdia')!;
    const hdlr = boxesIn(mp4, mdia.body, mdia.end).find((box) => box.type === 'hdlr')!;
    const stsz = deepFind(mp4, mdia, ['minf', 'stbl', 'stsz']);
    const stsd = deepFind(mp4, mdia, ['minf', 'stbl', 'stsd']);
    return {
      kind: mp4.toString('ascii', hdlr.body + 8, hdlr.body + 12),
      width: mp4.readUInt32BE(tkhd.end - 8) / 65536,
      height: mp4.readUInt32BE(tkhd.end - 4) / 65536,
      samples: stsz ? mp4.readUInt32BE(stsz.body + 8) : 0,
      codec: stsd ? mp4.toString('ascii', stsd.body + 12, stsd.body + 16) : '',
    };
  });
  return { seconds: length / timescale, tracks };
}

/** The colour at a point of the video's frames at these times, decoded by the browser's own player. */
async function videoColours(page: Page, mp4: Buffer, times: number[], at: { x: number; y: number }): Promise<RGB[]> {
  return page.evaluate(
    async ({ base64, times, at }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(`The video would not play: ${video.error?.code}`));
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      const colours: [number, number, number][] = [];
      for (const time of times) {
        const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
        video.currentTime = time;
        await seeked;
        ctx.drawImage(video, 0, 0);
        const data = ctx.getImageData(Math.floor(at.x * canvas.width), Math.floor(at.y * canvas.height), 1, 1).data;
        colours.push([data[0], data[1], data[2]]);
      }
      URL.revokeObjectURL(url);
      return colours;
    },
    { base64: mp4.toString('base64'), times, at }
  );
}

/** The MP4's sound, decoded by the browser: how long, how many channels, and its loudest sample. */
async function soundOf(page: Page, mp4: Buffer) {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const context = new OfflineAudioContext(2, 48000, 48000);
    const buffer = await context.decodeAudioData(bytes.buffer);
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    return { seconds: buffer.duration, channels: buffer.numberOfChannels, peak };
  }, mp4.toString('base64'));
}

// ---------------------------------------------------------------------------
// Google Drive, faked
// ---------------------------------------------------------------------------

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties?: Record<string, string>;
  data?: Buffer;
  modifiedTime: string;
}

/**
 * Google Drive's v3 API as far as Limelight uses it, in memory: folders by app
 * property, children, multipart and resumable uploads, and downloads. Answers
 * CORS too, as Google does, since the page calls it from another origin. A
 * resumable upload's first piece is lost on purpose: Drive answers it with a
 * 308 and no Range, which by Drive's rule means it has none of the file.
 */
async function fakeDrive(page: Page) {
  const files = new Map<string, FakeFile>();
  // How many times each name was written: scene.json is written last in a save.
  const writes = new Map<string, number>();
  const sessions = new Map<string, { meta: { name: string; parents?: string[] }; mimeType: string; total: number; data: Buffer; puts: number }>();
  const resumable = { sessions: 0, puts: 0, noRange: 0 };
  let next = 1;
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    // As Google's: the list names itself, so the page can tell a missing Range from a hidden one.
    'access-control-expose-headers': 'location, range, access-control-expose-headers',
  };
  const json = (body: unknown) => ({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const view = (file: FakeFile) => ({ id: file.id, name: file.name, size: String(file.data?.length ?? 0), modifiedTime: file.modifiedTime, appProperties: file.appProperties });
  await page.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const upload = url.pathname.startsWith('/upload/');
    const idInPath = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];
    if (upload && url.searchParams.get('uploadType') === 'resumable' && request.method() === 'POST') {
      const id = `s${next++}`;
      const headers = request.headers();
      sessions.set(id, { meta: JSON.parse(request.postData() ?? '{}'), mimeType: headers['x-upload-content-type'], total: Number(headers['x-upload-content-length']), data: Buffer.alloc(0), puts: 0 });
      resumable.sessions++;
      return route.fulfill({ status: 200, headers: { ...cors, location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` } });
    }
    if (upload && url.searchParams.get('upload_id') && request.method() === 'PUT') {
      const session = sessions.get(url.searchParams.get('upload_id')!);
      if (!session) return route.fulfill({ status: 404, headers: cors, body: 'no such upload' });
      const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(request.headers()['content-range'] ?? '');
      const has = (): Record<string, string> => (session.data.length > 0 ? { range: `bytes=0-${session.data.length - 1}` } : {});
      if (range) {
        resumable.puts++;
        session.puts++;
        const body = request.postDataBuffer() ?? Buffer.alloc(0);
        if (session.puts === 1) {
          // Lost on the way: Drive has nothing, and says so with no Range.
          resumable.noRange++;
          return route.fulfill({ status: 308, headers: cors });
        }
        if (Number(range[1]) === session.data.length) session.data = Buffer.concat([session.data, body]);
      }
      if (session.data.length < session.total) return route.fulfill({ status: 308, headers: { ...cors, ...has() } });
      writes.set(session.meta.name, (writes.get(session.meta.name) ?? 0) + 1);
      const file: FakeFile = { id: `f${next++}`, name: session.meta.name, mimeType: session.mimeType, parents: session.meta.parents ?? ['root'], data: session.data, modifiedTime: new Date().toISOString() };
      files.set(file.id, file);
      return route.fulfill(json({ id: file.id, size: String(file.data!.length) }));
    }
    if (!upload && request.method() === 'GET' && !idInPath) {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const prop = /key='(\w+)' and value='([^']*)'/.exec(q);
      const folders = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      const found = [...files.values()].filter(
        (file) =>
          (!parent || file.parents.includes(parent)) &&
          (!folders || file.mimeType === 'application/vnd.google-apps.folder') &&
          (!prop || file.appProperties?.[prop[1]] === prop[2])
      );
      return route.fulfill(json({ files: found.map(view) }));
    }
    if (!upload && request.method() === 'GET' && idInPath && url.searchParams.get('alt') === 'media') {
      const file = files.get(idInPath);
      if (!file) return route.fulfill({ status: 404, headers: cors, body: 'missing' });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': file.mimeType }, body: file.data ?? Buffer.alloc(0) });
    }
    if (!upload && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      const file: FakeFile = { id: `f${next++}`, name: body.name, mimeType: body.mimeType, parents: body.parents ?? ['root'], appProperties: body.appProperties, modifiedTime: new Date().toISOString() };
      files.set(file.id, file);
      return route.fulfill(json({ id: file.id }));
    }
    if (!upload && request.method() === 'PATCH' && idInPath) {
      const file = files.get(idInPath)!;
      Object.assign(file, JSON.parse(request.postData() ?? '{}'));
      return route.fulfill(json({ id: file.id }));
    }
    if (upload) {
      // Multipart: a JSON part with the metadata, then the file.
      const boundary = /boundary=([^;]+)/.exec(request.headers()['content-type'] ?? '')![1];
      const raw = request.postDataBuffer()!;
      const firstBody = raw.indexOf('\r\n\r\n') + 4;
      const metaEnd = raw.indexOf(`\r\n--${boundary}`, firstBody);
      const meta = JSON.parse(raw.subarray(firstBody, metaEnd).toString('utf8'));
      const contentStart = raw.indexOf('\r\n\r\n', metaEnd) + 4;
      const contentEnd = raw.lastIndexOf(`\r\n--${boundary}--`);
      const data = Buffer.from(raw.subarray(contentStart, contentEnd));
      const written = idInPath ? files.get(idInPath)?.name ?? '' : meta.name;
      writes.set(written, (writes.get(written) ?? 0) + 1);
      const mime = /Content-Type: ([^\r\n]+)/.exec(raw.subarray(metaEnd, contentStart).toString('utf8'))?.[1] ?? 'application/octet-stream';
      if (idInPath) {
        const file = files.get(idInPath)!;
        file.data = data;
        file.modifiedTime = new Date().toISOString();
        return route.fulfill(json({ id: file.id, version: '2' }));
      }
      const file: FakeFile = { id: `f${next++}`, name: meta.name, mimeType: mime, parents: meta.parents ?? ['root'], appProperties: meta.appProperties, data, modifiedTime: new Date().toISOString() };
      files.set(file.id, file);
      return route.fulfill(json({ id: file.id, version: '1' }));
    }
    return route.fulfill({ status: 400, headers: cors, body: `not faked: ${request.method()} ${url.pathname}` });
  });
  return { files, writes, resumable };
}

/** What Limelight's database on this device holds of each picture, without the bytes. */
async function storedPictures(page: Page): Promise<Array<{ id: string; name: string; bytes: number; from?: unknown }>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('OpenScreenshotGeneratorLimelight');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const rows = db.transaction('media').objectStore('media').getAll();
          rows.onsuccess = () => {
            resolve((rows.result as Array<{ id: string; name: string; bytes: number; from?: unknown }>).map(({ id, name, bytes, from }) => ({ id, name, bytes, from })));
            db.close();
          };
          rows.onerror = () => reject(rows.error);
        };
      })
  );
}

test.describe('Limelight', () => {
  test('exports the scene as an MP4 at its own size, a frame for every 30th of a second, with a silent sound track', async ({ page, isDesktop }) => {
    // No AudioEncoder, as in a browser that has H.264 but can't make AAC: the sound track must not need one.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'AudioEncoder', { configurable: true, writable: true, value: undefined });
    });
    await startScene(page);
    test.skip(!(await canEncodeH264(page)), 'This browser has no H.264 encoder');
    await shortest(page);
    const mp4 = await exportMp4(page, isDesktop);
    const { seconds, tracks } = mp4Tracks(mp4);
    expect(seconds).toBeGreaterThan(1.9);
    expect(seconds).toBeLessThan(2.2);
    expect(tracks.find((track) => track.kind === 'vide')).toMatchObject({ width: 886, height: 1920, samples: 60, codec: 'avc1' });
    // App Store Connect turns down a preview without sound: every export has a silent AAC track, never longer than the picture.
    expect(tracks.find((track) => track.kind === 'soun')).toMatchObject({ codec: 'mp4a', samples: Math.floor((2 * 48000) / 1024) });
    const sound = await soundOf(page, mp4);
    expect(sound.channels).toBe(2);
    expect(sound.seconds).toBeGreaterThan(1.9);
    expect(sound.peak).toBe(0);
  });

  test("an agent's change made while a video is made waits for it, so every frame shows the same scene", async ({ page, isDesktop }) => {
    await headless(page);
    await startScene(page);
    test.skip(!(await canEncodeH264(page)), 'This browser has no H.264 encoder');
    const tools = agentTools(page);
    const { scenes } = await tools.call('list_limelight_scenes', {});
    const sceneId = scenes.find((scene: { open: boolean }) => scene.open).sceneId;
    // One flat colour behind the phone, and the shortest length.
    const backdrop = (colour: string) => ({ style: 'solid', top: colour, bottom: colour });
    await tools.call('set_limelight_look', { sceneId, duration: 2, look: { backdrop: backdrop('#2050c0'), vignette: 0, grain: 0, depthOfField: false } });
    const dialog = page.getByTestId('limelight-export');
    const mp4 = await exportMp4(page, isDesktop, async () => {
      // A quarter of the way through, the agent turns the backdrop red.
      await expect.poll(async () => Number(/Frame (\d+)/.exec(await dialog.innerText())?.[1] ?? 0), { timeout: 120_000, intervals: [50] }).toBeGreaterThanOrEqual(15);
      await tools.call('set_limelight_look', { sceneId, look: { backdrop: backdrop('#d02020') } });
    });
    const colours = await videoColours(page, mp4, [0.05, 1, 1.95], { x: 0.06, y: 0.04 });
    for (const [i, colour] of colours.entries()) expect(near(colour, [32, 80, 192], 28), `frame ${i}'s backdrop is the blue it started with: ${colour}`).toBe(true);
    // The change isn't lost: the toast says the video doesn't have it, and the stage shows it now.
    await expect(page.getByText(/The scene changed while it was made/).first()).toBeVisible();
    await expect.poll(async () => near(await stageColour(page, { x: 0.06, y: 0.04 }), [208, 32, 32], 28), { message: 'the stage shows the red backdrop after the export' }).toBe(true);
  });

  test("an agent's change made while the export is still getting ready stays out of the video and is on the stage after", async ({ page, isDesktop }) => {
    await headless(page);
    await startScene(page);
    test.skip(!(await canEncodeH264(page)), 'This browser has no H.264 encoder');
    const tools = agentTools(page);
    const { scenes } = await tools.call('list_limelight_scenes', {});
    const sceneId = scenes.find((scene: { open: boolean }) => scene.open).sceneId;
    const backdrop = (colour: string) => ({ style: 'solid', top: colour, bottom: colour });
    await tools.call('set_limelight_look', { sceneId, duration: 2, look: { backdrop: backdrop('#2050c0'), vignette: 0, grain: 0, depthOfField: false } });
    // The export's first step, asking the browser about the encoder, waits until the test lets it go.
    await page.evaluate(() => {
      const w = window as unknown as { __E2E_ASKED__?: boolean; __E2E_GO__?: () => void };
      const asked = VideoEncoder.isConfigSupported.bind(VideoEncoder);
      const go = new Promise<void>((resolve) => {
        w.__E2E_GO__ = resolve;
      });
      Object.defineProperty(VideoEncoder, 'isConfigSupported', {
        configurable: true,
        writable: true,
        value: async (config: VideoEncoderConfig) => {
          w.__E2E_ASKED__ = true;
          await go;
          return asked(config);
        },
      });
    });
    const mp4 = await exportMp4(page, isDesktop, async () => {
      await page.waitForFunction(() => (window as unknown as { __E2E_ASKED__?: boolean }).__E2E_ASKED__ === true);
      await tools.call('set_limelight_look', { sceneId, look: { backdrop: backdrop('#d02020') } });
      // The stage takes the change before the export goes on: red through the dialog's dark overlay.
      await expect
        .poll(async () => {
          const [r, , b] = await stageColour(page, { x: 0.06, y: 0.04 });
          return r - b;
        }, { message: 'the stage shows the red backdrop under the dialog' })
        .toBeGreaterThan(15);
      await page.evaluate(() => (window as unknown as { __E2E_GO__: () => void }).__E2E_GO__());
    });
    const colours = await videoColours(page, mp4, [0.05, 1, 1.95], { x: 0.06, y: 0.04 });
    for (const [i, colour] of colours.entries()) expect(near(colour, [32, 80, 192], 28), `frame ${i}'s backdrop is the blue of the moment Export video was pressed: ${colour}`).toBe(true);
    await expect(page.getByText(/The scene changed while it was made/).first()).toBeVisible();
    await expect.poll(async () => near(await stageColour(page, { x: 0.06, y: 0.04 }), [208, 32, 32], 28), { message: 'the stage shows the red backdrop after the export' }).toBe(true);
  });

  test('saves a scene and its pictures to Google Drive, a big one in pieces, and opens it on another device as it was', async ({ page, isDesktop }) => {
    // The desktop app reaches Drive through Tauri's HTTP plugin, which the desktop project doesn't route.
    test.skip(isDesktop, "The fake Drive answers the web build's fetch only");
    const drive = await fakeDrive(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'open-screenshot-generator.account',
        JSON.stringify({ provider: 'google', account: { id: 'u1', name: 'Test person' }, accessToken: 'test-token', expiresAt: Date.now() + 3_600_000 })
      );
    });
    await startScene(page);
    // A second picture over 5 MB, from the end of the video: it goes up resumably. Noise doesn't compress.
    const random = randomBytes(1400 * 1400 * 3);
    const noise = png(1400, 1400, (x, y) => {
      const at = (y * 1400 + x) * 3;
      return [random[at], random[at + 1], random[at + 2]];
    });
    expect(noise.length).toBeGreaterThan(5 * 1024 * 1024);
    await page.keyboard.press('End');
    await pickPhone(page);
    await page.getByTestId('limelight-pictures').locator('input[type=file]').setInputFiles({ name: 'noise.png', mimeType: 'image/png', buffer: noise });
    await expect(page.getByTestId('limelight-pictures').getByRole('button', { name: 'Picture 2', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.keyboard.press('Home');

    await page.getByRole('button', { name: 'Save to Drive', exact: true }).click();
    await expect.poll(() => drive.writes.get('scene.json') ?? 0, { timeout: 60_000 }).toBe(1);
    await expect(page.getByText('Saved to Google Drive', { exact: true })).toBeVisible();
    const saved = [...drive.files.values()];
    const root = saved.find((file) => file.appProperties?.absLimelight === '1');
    const folder = saved.find((file) => file.appProperties?.absLimelightScene);
    expect(root?.parents).toEqual(['root']);
    expect(folder?.parents).toEqual([root!.id]);
    const payload = JSON.parse(saved.find((file) => file.name === 'scene.json')!.data!.toString('utf8'));
    expect(payload.kind).toBe('limelight-scene');
    expect(payload.scene.id).toBe(folder!.appProperties!.absLimelightScene);
    // scene.json says what each picture is; the files hold just the bytes, every one of them.
    expect(payload.pictures.map((picture: { name: string }) => picture.name).sort()).toEqual(['blue.png', 'noise.png']);
    const pictures = saved.filter((file) => file.name.startsWith('file__'));
    expect(pictures).toHaveLength(2);
    expect(pictures.some((file) => file.data!.equals(SOLID))).toBe(true);
    expect(pictures.some((file) => file.data!.equals(noise))).toBe(true);
    // The big one went up in pieces, and its first piece was sent again when Drive said it had none of it.
    expect(drive.resumable).toMatchObject({ sessions: 1, noRange: 1 });
    expect(drive.resumable.puts).toBeGreaterThanOrEqual(2);

    // A second save sends the scene again, not the pictures: waited for by the second write of scene.json.
    await page.getByRole('button', { name: 'Save to Drive', exact: true }).click();
    await expect.poll(() => drive.writes.get('scene.json') ?? 0, { timeout: 30_000 }).toBe(2);
    expect([...drive.files.values()].filter((file) => file.name === 'scene.json')).toHaveLength(1);
    expect([...drive.files.values()].filter((file) => file.name.startsWith('file__'))).toHaveLength(2);
    expect([...drive.writes.entries()].filter(([name]) => name.startsWith('file__')).map(([, count]) => count)).toEqual([1, 1]);
    expect(drive.resumable.sessions).toBe(1);

    // Changed here after the save, then opened from Drive: the change here stays, and Drive's comes in beside it.
    const nameField = page.getByRole('textbox', { name: 'Scene name' });
    await nameField.fill('Changed here');
    await nameField.press('Enter');
    const list = page.getByRole('navigation', { name: 'Your scenes' });
    await expect(list.getByRole('button', { name: /^Changed here/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open from Google Drive', exact: true }).click();
    await page.getByTestId('limelight-drive').getByRole('button', { name: new RegExp(literally(payload.scene.name)) }).click();
    await expect(page.getByText('Opened as a copy', { exact: true })).toBeVisible();
    await expect(list.getByRole('button', { name: /^Changed here/ }).first()).toBeVisible();
    await expect(list.getByRole('button', { name: new RegExp(`^${literally(payload.scene.name)} from Drive`) }).first()).toBeVisible();

    // Renamed, saved to Drive, then the rename undone: the undone scene is a change here, so opening Drive's keeps both.
    await list.getByRole('button', { name: /^Changed here/ }).first().click();
    await expect(nameField).toHaveValue('Changed here');
    await nameField.fill('Saved rename');
    await nameField.press('Enter');
    await expect(list.getByRole('button', { name: /^Saved rename/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Save to Drive', exact: true }).click();
    await expect.poll(() => drive.writes.get('scene.json') ?? 0, { timeout: 30_000 }).toBe(3);
    await expect(page.getByText('Saved to Google Drive', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(nameField).toHaveValue('Changed here');
    await page.getByRole('button', { name: 'Open from Google Drive', exact: true }).click();
    await page.getByTestId('limelight-drive').getByRole('button', { name: /Saved rename/ }).click();
    await expect(page.getByText('Opened as a copy', { exact: true }).first()).toBeVisible();
    await expect(list.getByRole('button', { name: /^Changed here/ }).first()).toBeVisible();
    await expect(list.getByRole('button', { name: /^Saved rename from Drive/ }).first()).toBeVisible();

    // On a device without the scene: the scene and its pictures come back from Drive, names and all.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase('OpenScreenshotGeneratorLimelight');
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        })
    );
    await page.reload();
    await new Editor(page).waitForBoot();
    await openView(page);
    await page.getByRole('button', { name: 'Open from Google Drive', exact: true }).click();
    await page.getByTestId('limelight-drive').getByRole('button', { name: /Saved rename/ }).click();
    await expect(page.getByTestId('limelight-drive')).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('limelight-canvas')).toBeVisible({ timeout: 60_000 });
    await expectPictureShows(page, 'after opening from Drive');
    const stored = await storedPictures(page);
    expect(stored.map((picture) => picture.name).sort()).toEqual(['blue.png', 'noise.png']);
    expect(stored.find((picture) => picture.name === 'noise.png')?.bytes).toBe(noise.length);
  });

  test('the agents make and change a scene through the MCP tools, the open view follows, and undo takes it back', async ({ page }) => {
    const { raw, call } = await bootForAgents(page);
    const made = await call('create_limelight_scene', { template: 'hero-orbit', fromProject: true, name: 'Agent promo' });
    expect(made.actors).toHaveLength(1);
    expect(made.actors[0].screens).toHaveLength(1);
    expect(made.template).toBe('hero-orbit');
    const listed = await call('list_limelight_scenes', {});
    expect(listed.scenes.map((scene: { name: string }) => scene.name)).toContain('Agent promo');

    // The view open on the agent's scene, then the agent changes it while the user watches.
    await openView(page);
    await page.getByRole('navigation', { name: 'Your scenes' }).getByRole('button', { name: /Agent promo/ }).first().click();
    await expect(page.getByTestId('limelight-canvas')).toBeVisible({ timeout: 60_000 });
    const shots = page.getByTestId('limelight-shot');
    await expect(shots).toHaveCount(3);
    const titled = await call('add_limelight_actor', { sceneId: made.sceneId, kind: 'title', text: 'Juniper' });
    await expect(page.getByTestId('limelight-timeline').getByRole('button', { name: 'Juniper', exact: true })).toBeVisible();
    await call('set_limelight_camera', {
      sceneId: made.sceneId,
      shots: [
        { time: 0, azimuth: -30, elevation: 8, fit: true, ease: 'glide' },
        { time: 12, azimuth: 30, elevation: 4, fit: true, pull: 0.9, ease: 'glide' },
      ],
    });
    await expect(shots).toHaveCount(2);
    // The agent's change is a step of its own: undo in the view takes the camera back.
    await page.getByTestId('limelight-stage').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(shots).toHaveCount(3);
    await expect(page.getByTestId('limelight-timeline').getByRole('button', { name: 'Juniper', exact: true })).toBeVisible();

    // What the agent sees: a picture of a frame, as an image block before the summary.
    const frame = await raw('render_limelight_frame', { sceneId: made.sceneId, time: 2 });
    const image = frame.result?.content.find((part) => part.type === 'image');
    expect(frame.result?.isError).toBeFalsy();
    expect(image?.mimeType).toBe('image/jpeg');
    expect((image?.data ?? '').length).toBeGreaterThan(2000);
    expect((image?.data ?? '').length).toBeLessThan(256 * 1024);
    const summary = JSON.parse(frame.result!.content.find((part) => part.type === 'text')!.text!);
    expect(summary).toMatchObject({ sceneId: made.sceneId, time: 2, width: 360 });
    expect(titled.actorId).toBeTruthy();

    // The scene open in the view is not the agent's to delete.
    const refused = await raw('delete_limelight_scene', { sceneId: made.sceneId });
    expect(refused.result?.isError).toBe(true);
  });

  test('with depth of field, vignette and grain all off, a still is the picture, not black', async ({ page }) => {
    const glErrors: string[] = [];
    page.on('console', (message) => {
      if (/INVALID_OPERATION|INVALID_FRAMEBUFFER|GL_INVALID/i.test(message.text())) glErrors.push(message.text());
    });
    const tools = await bootForAgents(page);
    const made = await tools.call('create_limelight_scene', { pictures: [{ src: SOLID_URL }], name: 'Plain' });
    await tools.call('update_limelight_actor', { sceneId: made.sceneId, actorId: made.actors[0].id, changes: { glare: 0 } });
    for (const look of [
      { depthOfField: true, vignette: 0.3, grain: 0.04 },
      { depthOfField: false, vignette: 0, grain: 0 },
      { depthOfField: false, vignette: 0.3, grain: 0 },
    ]) {
      await tools.call('set_limelight_look', { sceneId: made.sceneId, look });
      const colour = await colourIn(page, await tools.frame({ sceneId: made.sceneId, time: 1, width: 360 }), 'image/jpeg');
      expect(near(colour, BLUE, 12), `the screen with ${JSON.stringify(look)} shows the picture: ${colour}`).toBe(true);
    }
    expect(glErrors).toEqual([]);
  });

  test('a scene with more pictures than the stage keeps decoded shows the right one at every moment, every time', async ({ page }) => {
    const tools = await bootForAgents(page);
    // Thirteen pictures, each its own colour, two seconds each.
    const colours: RGB[] = Array.from({ length: 13 }, (_, k) => [10 + k * 18, 60 + (k % 3) * 50, 240 - k * 15]);
    const pictures = colours.map((colour) => ({ src: `data:image/png;base64,${png(120, 260, () => colour).toString('base64')}` }));
    const made = await tools.call('create_limelight_scene', { pictures, duration: 26, name: 'Many pictures' });
    expect(made.actors[0].screens).toHaveLength(13);
    await tools.call('update_limelight_actor', { sceneId: made.sceneId, actorId: made.actors[0].id, changes: { glare: 0 } });
    await tools.call('set_limelight_look', { sceneId: made.sceneId, look: { depthOfField: false, vignette: 0, grain: 0 } });
    for (const order of [[0, 3, 6, 9, 12], [12, 0, 6, 0, 12]]) {
      for (const k of order) {
        const time = 2 * k + 1.5;
        const colour = await colourIn(page, await tools.frame({ sceneId: made.sceneId, time, width: 360 }), 'image/jpeg');
        expect(near(colour, colours[k], 10), `picture ${k + 1} at ${time} s: ${colour}, not ${colours[k]}`).toBe(true);
      }
    }
  });

  test('eight phones changing picture at once show all sixteen pictures on the stage, and none is read again and again', async ({ page }) => {
    // Counts every picture the page decodes; the stage reads each with createImageBitmap.
    await page.addInitScript(() => {
      const w = window as unknown as { __E2E_DECODES__: number };
      w.__E2E_DECODES__ = 0;
      const decode = window.createImageBitmap.bind(window) as (...args: unknown[]) => Promise<ImageBitmap>;
      window.createImageBitmap = ((...args: unknown[]) => {
        w.__E2E_DECODES__++;
        return decode(...args);
      }) as typeof createImageBitmap;
    });
    const tools = await bootForAgents(page);
    // What each phone shows halfway through its fade: the mix of its two pictures, one 40 above it in red and blue and below in green, one the other way.
    const colours: RGB[] = [[200, 60, 60], [60, 180, 80], [60, 90, 210], [210, 190, 50], [190, 60, 190], [50, 190, 200], [215, 130, 45], [120, 70, 205]];
    const shift: RGB = [40, -40, 40];
    // With the picture going out missing, the screen is half dark; with the one coming in missing, it is the first colour alone.
    const pair = (colour: RGB) =>
      [1, -1].map((sign) => ({ src: `data:image/png;base64,${png(120, 260, () => colour.map((v, i) => v + sign * shift[i]) as RGB).toString('base64')}` }));
    // A wide video, so eight phones side by side are big enough to measure.
    const made = await tools.call('create_limelight_scene', { pictures: pair(colours[0]), size: 'google-play', duration: 4, name: 'Eight at once' });
    const sceneId = made.sceneId;
    const phones: Array<{ id: string; screens: Array<Record<string, unknown>> }> = [made.actors[0]];
    for (const colour of colours.slice(1)) phones.push((await tools.call('add_limelight_actor', { sceneId, kind: 'device', pictures: pair(colour) })).actor);
    for (const phone of phones) {
      // From 2 s on, a one-second fade to the second picture, on every phone at once.
      const screens = phone.screens.map((screen, i) => ({ ...screen, transition: i === 0 ? 'cut' : 'fade', duration: 1 }));
      await tools.call('update_limelight_actor', { sceneId, actorId: phone.id, changes: { glare: 0, screens } });
    }
    // A grey backdrop, far from every phone's colour.
    await tools.call('set_limelight_look', { sceneId, look: { backdrop: { style: 'solid', top: '#808080', bottom: '#808080' }, depthOfField: false, vignette: 0, grain: 0 } });
    await tools.call('set_limelight_camera', { sceneId, shots: [{ time: 0, fit: true }] });
    const scene = await tools.call('get_limelight_scene', { sceneId });
    const shown = new Set(scene.actors.flatMap((actor: { screens: Array<{ media: string; time: number }> }) => actor.screens.map((screen) => screen.media)));
    expect(shown.size, 'sixteen pictures, two a phone').toBe(16);
    expect(scene.actors.map((actor: { screens: Array<{ time: number }> }) => actor.screens[1].time)).toEqual(Array(8).fill(2));

    await openView(page);
    await page.getByRole('navigation', { name: 'Your scenes' }).getByRole('button', { name: /Eight at once/ }).first().click();
    await expect(page.getByTestId('limelight-canvas')).toBeVisible({ timeout: 60_000 });
    // The playhead halfway through the fades: 2 s, then 15 frames. The keys go to the stage, clicked beside the video.
    const stageBox = (await page.getByTestId('limelight-stage').boundingBox())!;
    await page.getByTestId('limelight-stage').click({ position: { x: 8, y: stageBox.height / 2 } });
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('limelight-clock')).toContainText('0:02.5 /');

    /** How many pixels of the stage are each phone's halfway colour. */
    const counts = async () => {
      const box = await page.getByTestId('limelight-canvas').boundingBox();
      if (!box) return colours.map(() => 0);
      const bytes = await page.screenshot({ clip: box });
      return page.evaluate(
        async ({ data, colours }) => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
          const found = colours.map(() => 0);
          for (let i = 0; i < pixels.length; i += 4) {
            const k = colours.findIndex((c) => Math.abs(pixels[i] - c[0]) <= 24 && Math.abs(pixels[i + 1] - c[1]) <= 24 && Math.abs(pixels[i + 2] - c[2]) <= 24);
            if (k >= 0) found[k]++;
          }
          return found;
        },
        { data: [...bytes], colours }
      );
    };
    await expect.poll(async () => Math.min(...(await counts())), { message: 'every phone shows both its pictures halfway through the fade', timeout: 60_000 }).toBeGreaterThan(150);
    // Then nothing more is read while the picture stays as it is.
    const decodes = () => page.evaluate(() => (window as unknown as { __E2E_DECODES__: number }).__E2E_DECODES__);
    const before = await decodes();
    await page.waitForTimeout(2000);
    expect((await decodes()) - before, 'pictures read again in two seconds of a still stage').toBe(0);
    const after = await counts();
    expect(Math.min(...after), `every phone still shows its colour: ${after}`).toBeGreaterThan(150);
  });

  test.describe('on a screen with twice the pixels', () => {
    test.use({ deviceScaleFactor: 2 });

    test('a stage made again while it plays draws light frames until it is paused, as the one it replaced did', async ({ page }) => {
      await startScene(page);
      /** Pixels drawn for each CSS pixel across, on the stage now on screen. */
      const ratio = () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="limelight-canvas"]:not([data-e2e-gone])');
          return canvas && canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 0;
        });
      await expect.poll(ratio, { message: 'a still stage draws every pixel', timeout: 30_000 }).toBeGreaterThan(1.9);
      await play(page);
      await expect.poll(ratio, { message: 'a playing stage draws light frames', timeout: 30_000 }).toBeLessThan(1.3);
      // The context goes for good while it plays: a new stage takes over a moment later.
      await page.evaluate(() => document.querySelector('[data-testid="limelight-canvas"]')!.setAttribute('data-e2e-gone', ''));
      await dropContext(page, false);
      await expect(page.locator('[data-testid="limelight-canvas"]:not([data-e2e-gone])')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await expect.poll(ratio, { message: 'the new stage draws light frames while it plays', timeout: 30_000 }).toBeLessThan(1.3);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect.poll(ratio, { message: 'paused, the new stage draws every pixel', timeout: 30_000 }).toBeGreaterThan(1.9);
    });
  });

  test("a template fills with the project screenshots, saves as the user's own template, and the director's view changes no shot", async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    const view = await openView(page);
    await view.getByRole('button', { name: 'Start a scene', exact: true }).click();
    const gallery = page.getByTestId('limelight-gallery');
    // Every built-in template draws its preview: ten stills with depth of field, which Chromium here draws on the CPU.
    await expect(gallery.locator('img')).toHaveCount(10, { timeout: 180_000 });
    await gallery.getByRole('button', { name: /^Side by side:/ }).click();
    await expect(gallery).toBeHidden();
    const timeline = page.getByTestId('limelight-timeline');
    await expect(timeline.getByRole('button', { name: /^iPhone 17 Pro( \d)?$/ })).toHaveCount(3);
    const shots = page.getByTestId('limelight-shot');
    const count = await shots.count();

    await page.getByRole('button', { name: 'From outside', exact: true }).click();
    const stage = (await page.getByTestId('limelight-stage').boundingBox())!;
    await page.mouse.move(stage.x + 24, stage.y + 24);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(stage.x + 24 + i * 14, stage.y + 24);
    await page.mouse.up();
    await expect(shots).toHaveCount(count);
    await page.getByRole('button', { name: 'Through the camera', exact: true }).click();

    // Kept as the user's own template, it starts a new scene with the same three phones.
    await page.getByRole('button', { name: /^More for / }).first().click();
    await page.getByRole('menuitem', { name: 'Save as my template' }).click();
    await expect(page.getByText('Saved as your template', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New scene', exact: true }).click();
    await gallery.getByRole('button', { name: /^Your template / }).click();
    await expect(gallery).toBeHidden();
    // Two scenes now, each with its own menu.
    await expect(page.getByRole('navigation', { name: 'Your scenes' }).getByRole('button', { name: /^More for / })).toHaveCount(2);
    await expect(timeline.getByRole('button', { name: /^iPhone 17 Pro( \d)?$/ })).toHaveCount(3);
  });

  test('shows a screenshot on a 3D phone in its own colours, and keeps it moving through a hidden tab, another view, a resize and a lost context', async ({ page, browserName }) => {
    // About fifteen waits on the stage, each a few seconds where WebGL is drawn on the CPU.
    test.setTimeout(400_000);
    await startScene(page);
    // Two seconds long, so the camera's whole swing passes in two seconds and
    // starts again: the motion checks don't hang on the slow ends of one long move
    // (Chromium here draws on the CPU, a few frames a second).
    await shortest(page);
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.keyboard.press('Home');
    await expectPictureShows(page, 'when the scene opens');
    // Still while paused, once the finished frame is up: what the motion check counts is not noise.
    await page.waitForTimeout(800);
    const still = (await stageLook(page))!;
    await page.waitForTimeout(600);
    expect((await stageLook(page))!.filter((v, i) => Math.abs(v - still[i]) > 12).length).toBeLessThanOrEqual(2);

    await play(page);
    await clockMoves(page);
    await stageMoves(page, 'while it plays');

    // A tab in the back: hidden, and on Chromium frozen as a background tab is.
    await setVisibility(page, 'hidden');
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    }
    await setVisibility(page, 'visible');
    await expectPictureShows(page, 'after the tab comes back');
    await clockMoves(page);
    await stageMoves(page, 'after the tab comes back');

    // Another view in front, then Limelight again.
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Editor', exact: true }).click();
    await expect(page.getByTestId('limelight-view')).toBeHidden();
    await openView(page);
    await expectPictureShows(page, 'after the editor was in front');
    await play(page);
    await stageMoves(page, 'after the editor was in front');

    // The window made smaller and larger again while it plays.
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: Math.round(size.width * 0.7), height: Math.round(size.height * 0.75) });
    await expectPictureShows(page, 'in a smaller window');
    await stageMoves(page, 'in a smaller window');
    await page.setViewportSize(size);
    await expectPictureShows(page, 'with the window its size again');
    await stageMoves(page, 'with the window its size again');

    // The GPU takes the context and gives it back; then takes it for good.
    await dropContext(page, true);
    await expectPictureShows(page, 'after the context came back');
    await play(page);
    await stageMoves(page, 'after the context came back');
    await dropContext(page, false);
    await expectPictureShows(page, 'after the context was dropped for good');
    await play(page);
    await clockMoves(page);
    await stageMoves(page, 'after the context was dropped for good');
  });

  test('undo brings a phone back with its picture after a scene that shared the picture is deleted', async ({ page }) => {
    await startScene(page);
    await expectPictureShows(page, 'on the first scene');
    const list = page.getByRole('navigation', { name: 'Your scenes' });
    const menus = list.getByRole('button', { name: /^More for / });
    const original = ((await menus.first().getAttribute('aria-label')) ?? '').replace(/^More for /, '');
    // A copy shares the picture; making it opens it.
    await menus.first().click();
    await page.getByRole('menuitem', { name: 'Make a copy' }).click();
    await expect(menus).toHaveCount(2);
    // Back on the first scene, its phone deleted.
    await list.getByRole('button', { name: new RegExp(`^${literally(original)}(?! copy)`) }).first().click();
    await pickPhone(page);
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('limelight-timeline').getByRole('button', { name: /^iPhone 17 Pro$/ })).toHaveCount(0);
    await page.waitForTimeout(1200);
    // The copy deleted: the picture is now on no scene, only in the first scene's undo.
    await page.getByRole('button', { name: `More for ${original} copy`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(menus).toHaveCount(1);
    await page.getByTestId('limelight-stage').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('limelight-timeline').getByRole('button', { name: /^iPhone 17 Pro$/ })).toHaveCount(1);
    // Read back from this device's database, not the stage's memory: a reload.
    await page.waitForTimeout(1500);
    await page.reload();
    await new Editor(page).waitForBoot();
    await openView(page);
    await expect(page.getByTestId('limelight-canvas')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await expectPictureShows(page, 'after undo and a reload');
    expect((await storedPictures(page)).map((picture) => picture.name)).toEqual(['blue.png']);
  });

  test('a camera drag at the playhead adds a shot, undo takes it back, and the scene is still there after a reload', async ({ page }) => {
    await startScene(page);
    const shots = page.getByTestId('limelight-shot');
    await expect(shots).toHaveCount(2);
    // The playhead to a third of the way, then a drag from the backdrop swings the camera.
    const tracks = await page.getByTestId('limelight-tracks').boundingBox();
    await page.mouse.click(tracks!.x + tracks!.width / 3, tracks!.y + 8);
    await expect(page.getByTestId('limelight-clock')).toContainText('0:05.0');
    const stage = (await page.getByTestId('limelight-stage').boundingBox())!;
    await page.mouse.move(stage.x + 24, stage.y + 24);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(stage.x + 24 + i * 12, stage.y + 24 + i * 3);
    await page.mouse.up();
    await expect(shots).toHaveCount(3);
    await expect(page.getByText(/^Shot 2 added at 5\.0 s$/)).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(shots).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(shots).toHaveCount(3);

    // Saved a moment after the change: a reload finds the scene with its three shots.
    await page.waitForTimeout(1500);
    await page.reload();
    await new Editor(page).waitForBoot();
    await openView(page);
    await expect(page.getByTestId('limelight-canvas')).toBeVisible({ timeout: 60_000 });
    await expect(shots).toHaveCount(3);
    await expectPictureShows(page, 'after a reload');
  });
});
