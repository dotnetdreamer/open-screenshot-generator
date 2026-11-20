import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { build as Esbuild } from 'esbuild';
import type { WorkerRequest } from '@/lib/cutout/worker/protocol';

const { build } = createRequire(path.join(process.cwd(), 'package.json'))('esbuild') as { build: typeof Esbuild };

// Run the real engine with a worker and storage controlled by each test.
const engineSource = build({
  entryPoints: ['src/lib/cutout/engine.ts'],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: { '@': path.join(process.cwd(), 'src') },
  plugins: [{
    name: 'cutout-test-io',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/modelStore$/ }, () => ({ path: 'store', namespace: 'cutout-test' }));
      builder.onResolve({ filter: /^\.\/vision$/ }, () => ({ path: 'vision', namespace: 'cutout-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'cutout-test' }, ({ path: name }) => ({
        contents: name === 'store'
          ? 'export async function hasModel() { return globalThis.testState.cached; } export async function storedModels() { return []; } export async function deleteModel() {}'
          : 'export const VISION_SIDE = 2048; export async function visionAvailable() { return globalThis.testState.vision; } export async function visionMask() { return { mask: new Uint8Array([255]), width: 1, height: 1 }; }',
        loader: 'js',
      }));
    },
  }],
}).then((result) => result.outputFiles![0].text);

async function engine(options: { cached?: boolean; flat?: boolean; simd?: boolean; vision?: boolean; holdDownload?: boolean } = {}) {
  const state = { cached: !!options.cached, vision: !!options.vision };
  const requests: string[] = [];
  let finishDownload: (() => void) | undefined;
  let announceDownload: (() => void) | undefined;
  const downloadStarted = new Promise<void>((resolve) => { announceDownload = resolve; });
  class TestWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    stopDownload: (() => void) | undefined;
    postMessage(request: WorkerRequest) {
      requests.push(request.type);
      const done = (result: unknown) => queueMicrotask(() => this.onmessage?.({ data: { id: request.id, type: 'done', result } }));
      const fail = (error: string) => queueMicrotask(() => this.onmessage?.({ data: { id: request.id, type: 'failed', error } }));
      if (request.type === 'download') {
        finishDownload = () => { state.cached = true; done(null); };
        this.stopDownload = () => queueMicrotask(() => this.onmessage?.({ data: { id: request.id, type: 'failed', error: 'The download was stopped', stopped: true } }));
        announceDownload?.();
        if (!options.holdDownload) finishDownload();
      } else if (request.type === 'stop') {
        this.stopDownload?.();
        done(null);
      } else if (request.type === 'load') {
        if (state.cached) done({ device: 'wasm', ms: 0 });
        else fail('Model download is incomplete');
      } else if (request.type === 'cut') {
        if (!request.useModel && !request.hint && !options.flat) fail('NO_ENGINE');
        else done({ mask: new Uint8Array([255]).buffer, width: 1, height: 1, engine: request.useModel ? 'model' : request.hint ? 'vision' : 'color', flat: !!options.flat, ms: 0 });
      }
    }
  }
  const module = { exports: {} };
  runInNewContext(await engineSource, {
    module,
    exports: module.exports,
    process,
    console,
    queueMicrotask,
    setTimeout,
    Uint8Array,
    Uint8ClampedArray,
    DOMException,
    Worker: TestWorker,
    navigator: {},
    window: { localStorage: { getItem: () => null } },
    WebAssembly: options.simd === false ? { validate: () => false } : WebAssembly,
    testState: state,
  });
  const api = module.exports as typeof import('@/lib/cutout/engine');
  const picture = { rgba: new Uint8ClampedArray([20, 30, 40, 255]), width: 1, height: 1, hasAlpha: false };
  return { api, requests, picture, downloadStarted, finishDownload: () => finishDownload?.() };
}

test('a flat logo needs no model download, including an agent call', async () => {
  for (const download of [true, false]) {
    const { api, picture, requests } = await engine({ flat: true });
    const result = await api.cutPicture('logo', picture, { download });
    assert.equal(result.engine, 'color');
    assert.equal(result.final, true);
    assert.deepEqual(requests, ['cut']);
  }
});

test('a cached model refines a logo without another download', async () => {
  const { api, picture, requests } = await engine({ flat: true, cached: true });
  assert.equal((await api.cutPicture('logo', picture)).engine, 'model');
  assert.deepEqual(requests, ['load', 'cut']);
});

test('a photo downloads its model before loading it', async () => {
  const { api, picture, requests } = await engine();
  assert.equal((await api.cutPicture('photo', picture)).engine, 'model');
  assert.deepEqual(requests, ['cut', 'download', 'load', 'cut']);
});

test('a photo waits for a download already under way, including an agent call', async () => {
  for (const download of [true, false]) {
    const fixture = await engine({ holdDownload: true });
    const downloading = fixture.api.downloadCutoutModel();
    await fixture.downloadStarted;
    const cutting = fixture.api.cutPicture('photo', fixture.picture, { download });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(fixture.requests, ['download', 'cut']);
    fixture.finishDownload();
    await downloading;
    assert.equal((await cutting).engine, 'model');
    assert.deepEqual(fixture.requests, ['download', 'cut', 'load', 'cut']);
  }
});

test('a browser without SIMD refuses a photo before downloading a model', async () => {
  const { api, picture, requests } = await engine({ simd: false });
  await assert.rejects(api.cutPicture('photo', picture), /Update your browser or operating system/);
  assert.equal(api.getCutoutStatus().model, null);
  assert.ok(!requests.includes('download'));
  assert.ok(!requests.includes('load'));
});

test('a browser without SIMD still cuts a flat logo or uses Vision', async () => {
  for (const options of [{ flat: true, vision: false }, { flat: false, vision: true }]) {
    const { api, picture, requests } = await engine({ ...options, simd: false });
    const result = await api.cutPicture('picture', picture);
    assert.equal(result.engine, options.flat ? 'color' : 'vision');
    assert.equal(result.final, true);
    assert.ok(!requests.includes('download'));
    assert.ok(!requests.includes('load'));
  }
});

test('Stop prevents later photos from restarting the download until Download is chosen', async () => {
  const fixture = await engine({ holdDownload: true });
  const first = fixture.api.cutPicture('first', fixture.picture);
  const stopped = assert.rejects(first, /Choose Download to continue/);
  await fixture.downloadStarted;
  fixture.api.stopCutoutDownload();
  await stopped;
  assert.equal(fixture.api.getCutoutStatus().phase, 'missing');

  await assert.rejects(fixture.api.cutPicture('next', fixture.picture), /Choose Download to continue/);
  await assert.rejects(fixture.api.downloadCutoutModel({ automatic: true }), /Choose Download to continue/);
  assert.equal(fixture.requests.filter((request) => request === 'download').length, 1);

  const resumed = fixture.api.downloadCutoutModel();
  await new Promise<void>((resolve) => setImmediate(resolve));
  fixture.finishDownload();
  await resumed;
  assert.equal((await fixture.api.cutPicture('next', fixture.picture)).engine, 'model');
  assert.equal(fixture.requests.filter((request) => request === 'download').length, 2);
});

test('the library queue keeps paused photos waiting and resumes them together', async () => {
  const state = {
    paused: true,
    scans: 0,
    attempts: 0,
    rows: ['first', 'second'].map((id) => ({ id, state: 'waiting', sourceMediaId: id })),
  };
  const stubs: Record<string, string> = {
    './engine': `
      export class CutoutWorkerError extends Error { constructor() { super('Download paused'); this.stopped = true; } }
      export const DEFAULT_RENDER = {};
      export async function openPicture() {}
      export function forgetPicture() {}
      export async function cutPicture() {
        globalThis.testState.attempts++;
        if (globalThis.testState.paused) throw new CutoutWorkerError();
        return { mask: new Uint8Array([255]), width: 1, height: 1, engine: 'model' };
      }
      export async function renderCutout() { return { rgba: new ArrayBuffer(4), width: 1, height: 1, rect: {} }; }
    `,
    './library': `
      export async function getLibraryImage(id) { return globalThis.testState.rows.find(row => row.id === id); }
      export async function unfinishedLibraryImages() {
        if (++globalThis.testState.scans > 10) throw Error('The queue kept retrying after Stop');
        return globalThis.testState.rows.filter(row => row.state === 'waiting' || row.state === 'cutting');
      }
      export async function setLibraryImageState(id, state) { (await getLibraryImage(id)).state = state; }
      export async function saveLibraryCut(id) { (await getLibraryImage(id)).state = 'ready'; }
    `,
    '@/lib/mediaStore': 'export async function getMediaAsset() { return { blob: new Blob() }; }',
    './picture': `
      export async function decodePicture() { return { rgba: new Uint8ClampedArray(4), width: 1, height: 1, hasAlpha: false }; }
      export async function encodeRgba() { return new Blob(); }
      export async function encodeMask() { return new Blob(); }
      export async function thumbnailOf() { return new Blob(); }
    `,
  };
  const result = await build({
    entryPoints: ['src/lib/cutout/queue.ts'],
    absWorkingDir: process.cwd(),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'cutout-queue-test-io',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path: name }) => name in stubs ? { path: name, namespace: 'queue-test' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'queue-test' }, ({ path: name }) => ({ contents: stubs[name], loader: 'js' }));
      },
    }],
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles![0].text, {
    module, exports: module.exports, testState: state, console, navigator: {}, Blob,
  });
  const queue = module.exports as typeof import('@/lib/cutout/queue');
  await queue.drainLibraryQueue();
  assert.deepEqual(state.rows.map((row) => row.state), ['waiting', 'waiting']);
  assert.equal(state.attempts, 1);
  assert.equal(state.scans, 1);

  state.paused = false;
  await queue.drainLibraryQueue();
  assert.deepEqual(state.rows.map((row) => row.state), ['ready', 'ready']);
  assert.equal(state.attempts, 3);
});
