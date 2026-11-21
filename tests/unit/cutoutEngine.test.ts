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

async function engine(
  options: {
    cached?: boolean;
    flat?: boolean;
    simd?: boolean;
    vision?: boolean;
    holdDownload?: boolean;
    /** WebGPU with half precision, so the 1024 model is the one used. */
    gpu?: boolean;
    /** Where the model's mask says nothing: on the GPU only, or on both. */
    unsureOn?: 'webgpu' | 'all';
  } = {}
) {
  const state = { cached: !!options.cached, vision: !!options.vision };
  const requests: string[] = [];
  const stored = new Map<string, string>();
  let device: 'webgpu' | 'wasm' | null = null;
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
        device = request.gpu ? 'webgpu' : 'wasm';
        if (state.cached) done({ device, ms: 0 });
        else fail('Model download is incomplete');
      } else if (request.type === 'cut') {
        const unsure = request.useModel && (options.unsureOn === 'all' || (options.unsureOn === 'webgpu' && device === 'webgpu'));
        if (!request.useModel && !request.hint && !options.flat) fail('NO_ENGINE');
        else done({ mask: new Uint8Array([unsure ? 128 : 255]).buffer, width: 1, height: 1, engine: request.useModel ? 'model' : request.hint ? 'vision' : 'color', flat: !!options.flat, ...(unsure ? { unsure } : {}), ms: 0 });
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
    navigator: options.gpu
      ? { gpu: { requestAdapter: async () => ({ features: { has: (name: string) => name === 'shader-f16' }, limits: { maxStorageBuffersPerShaderStage: 10 } }) } }
      : {},
    window: { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } },
    WebAssembly: options.simd === false ? { validate: () => false } : WebAssembly,
    testState: state,
  });
  const api = module.exports as typeof import('@/lib/cutout/engine');
  const picture = { rgba: new Uint8ClampedArray([20, 30, 40, 255]), width: 1, height: 1, hasAlpha: false };
  return { api, requests, picture, stored, downloadStarted, finishDownload: () => finishDownload?.() };
}

test('a GPU whose mask says nothing hands the photo, and the ones after it, to the CPU model', async () => {
  const { api, picture, requests, stored } = await engine({ cached: true, gpu: true, unsureOn: 'webgpu' });
  const first = await api.cutPicture('photo', picture);
  assert.equal(first.engine, 'model');
  assert.equal(first.mask[0], 255, "the CPU model's mask, not the GPU's grey");
  assert.deepEqual(requests, ['load', 'cut', 'load', 'cut'], 'the GPU model, then the CPU model');
  assert.equal(api.getCutoutStatus().model?.device, 'cpu');
  assert.equal(api.getCutoutStatus().device, 'wasm');
  assert.equal(stored.get('osg.cutout.gpu-failed'), '1', 'remembered for the next time the app opens');

  await api.cutPicture('next', picture);
  assert.deepEqual(requests.slice(4), ['cut'], 'the next photo goes straight to the CPU model');
});

test('a photo the model finds nothing in fails with words, rather than being called cut', async () => {
  const { api, picture } = await engine({ cached: true, gpu: true, unsureOn: 'all' });
  await assert.rejects(api.cutPicture('photo', picture), (error: Error) => error.message === api.EMPTY_MASK);
});

test('a photo on a plain colour that the model finds nothing in is still cut by its colour', async () => {
  const { api, picture } = await engine({ cached: true, unsureOn: 'all', flat: true });
  assert.equal((await api.cutPicture('logo', picture)).engine, 'color');
});

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

interface QueueState {
  paused: boolean;
  scans: number;
  attempts: number;
  rows: Array<{
    id: string;
    state: string;
    sourceMediaId?: string;
    error?: string;
    photoFails?: Error;
    /** The state write the database refuses for this picture. */
    refuseState?: string;
    /** The first save finds the picture changed under the cut. */
    changesOnce?: boolean;
    /** The picture's version, `mediaId`. */
    mediaId?: string;
    /** Another window saves this version while the picture is cut: a hand edit, so a finished one. */
    editedDuringCut?: string;
    /** The cut fails after another window saved a finished version. */
    failsAfterEdit?: string;
    /** Set when the queue's cut was saved. */
    savedByQueue?: boolean;
  }>;
}

/** The real queue, with the engine, the library and the canvas run by `state`. */
async function libraryQueue(state: QueueState) {
  const stubs: Record<string, string> = {
    './engine': `
      export class CutoutWorkerError extends Error { constructor() { super('Download paused'); this.stopped = true; } }
      export const DEFAULT_RENDER = {};
      export async function openPicture() {}
      export function forgetPicture() {}
      export async function cutPicture() {
        globalThis.testState.attempts++;
        if (globalThis.testState.paused) throw new CutoutWorkerError();
        const edited = globalThis.testState.rows.find(row => row.editedDuringCut);
        if (edited) {
          Object.assign(edited, { mediaId: edited.editedDuringCut, state: 'ready' });
          delete edited.editedDuringCut;
        }
        const failing = globalThis.testState.rows.find(row => row.failsAfterEdit);
        if (failing) {
          Object.assign(failing, { mediaId: failing.failsAfterEdit, state: 'ready' });
          delete failing.failsAfterEdit;
          throw new Error('NO_ENGINE');
        }
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
      export class PictureChangedError extends Error {}
      export async function setLibraryImageState(id, state, error) {
        const row = await getLibraryImage(id);
        if (row.refuseState === state) throw new Error('The database refused the write');
        Object.assign(row, { state, error });
      }
      const unfinished = (row) => !!row && !row.deletedAt && (row.state === 'waiting' || row.state === 'cutting');
      export async function stillUnfinished(id) { return unfinished(await getLibraryImage(id)); }
      export async function settleUnfinishedImage(id, state, error) {
        const row = await getLibraryImage(id);
        if (row.refuseState === state) throw new Error('The database refused the write');
        if (!unfinished(row)) return false;
        Object.assign(row, { state, error });
        return true;
      }
      export async function saveLibraryCut(id, cut) {
        const row = await getLibraryImage(id);
        if (!cut.photo) throw new Error('A save has to say which photo its mask is over');
        if (row.changesOnce) {
          row.changesOnce = false;
          throw new PictureChangedError();
        }
        // As the real one: a cut of a version the picture no longer is.
        if (!('basis' in cut) || cut.basis !== row.mediaId) throw new PictureChangedError();
        row.state = 'ready';
        row.savedByQueue = true;
      }
      export async function photoOf(id) {
        const row = await getLibraryImage(id);
        if (row?.photoFails) throw row.photoFails;
        // A copy, as a read from the database is.
        return row?.sourceMediaId ? { row: { ...row }, photo: { id: row.sourceMediaId, blob: new Blob() } } : null;
      }
      export function isOutOfRoom(error) { return error?.name === 'QuotaExceededError'; }
      export const OUT_OF_ROOM = 'Out of room';
    `,
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
    module, exports: module.exports, testState: state, console: { ...console, error: () => {} }, navigator: {}, Blob,
  });
  return module.exports as typeof import('@/lib/cutout/queue');
}

test('the library queue keeps paused photos waiting and resumes them together', async () => {
  const state: QueueState = {
    paused: true,
    scans: 0,
    attempts: 0,
    rows: ['first', 'second'].map((id) => ({ id, state: 'waiting', sourceMediaId: id })),
  };
  const queue = await libraryQueue(state);
  await queue.drainLibraryQueue();
  assert.deepEqual(state.rows.map((row) => row.state), ['waiting', 'waiting']);
  assert.equal(state.attempts, 1);
  assert.equal(state.scans, 1);

  state.paused = false;
  await queue.drainLibraryQueue();
  assert.deepEqual(state.rows.map((row) => row.state), ['ready', 'ready']);
  assert.equal(state.attempts, 3);
});

test('a picture whose photo cannot be had fails on its own, and the next one is still cut', async () => {
  const full = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  const state: QueueState = {
    paused: false,
    scans: 0,
    attempts: 0,
    rows: [
      { id: 'first', state: 'waiting', photoFails: full },
      { id: 'second', state: 'waiting' },
      { id: 'third', state: 'waiting', sourceMediaId: 'third' },
    ],
  };
  const queue = await libraryQueue(state);
  await queue.drainLibraryQueue();
  assert.deepEqual(state.rows.map((row) => [row.state, row.error]), [
    ['failed', 'Out of room'],
    ['failed', 'The photo is no longer on this device'],
    ['ready', undefined],
  ]);
});

test('a picture whose row will not take a write waits for the next run, and the pictures after it are still cut', async () => {
  const state: QueueState = {
    paused: false,
    scans: 0,
    attempts: 0,
    rows: [
      // Marking it as being cut fails.
      { id: 'first', state: 'waiting', sourceMediaId: 'first', refuseState: 'cutting' },
      // Its cut fails, and so does marking it failed.
      { id: 'second', state: 'waiting', photoFails: new Error('No photo'), refuseState: 'failed' },
      { id: 'third', state: 'waiting', sourceMediaId: 'third' },
    ],
  };
  const queue = await libraryQueue(state);
  await queue.drainLibraryQueue();
  assert.deepEqual(state.rows.map((row) => row.state), ['waiting', 'cutting', 'ready']);
  assert.equal(state.attempts, 1, 'only the third was cut, once');
  assert.ok(state.scans <= 3, `the run ended instead of trying them again and again (${state.scans} scans)`);

  // The next run tries them again.
  delete state.rows[0].refuseState;
  await queue.drainLibraryQueue();
  assert.equal(state.rows[0].state, 'ready');
});

test('a picture whose photo changes while it is cut is cut once more, from the new photo', async () => {
  const state: QueueState = {
    paused: false,
    scans: 0,
    attempts: 0,
    rows: [{ id: 'first', state: 'waiting', sourceMediaId: 'first', changesOnce: true }],
  };
  const queue = await libraryQueue(state);
  await queue.drainLibraryQueue();
  assert.equal(state.rows[0].state, 'ready');
  assert.equal(state.attempts, 2);
});

test('a picture saved in another window while it is cut keeps that version, and is not cut again over it', async () => {
  const state: QueueState = {
    paused: false,
    scans: 0,
    attempts: 0,
    rows: [{ id: 'first', state: 'waiting', sourceMediaId: 'first', mediaId: 'asset_1', editedDuringCut: 'asset_2' }],
  };
  const queue = await libraryQueue(state);
  await queue.drainLibraryQueue();
  assert.equal(state.rows[0].state, 'ready');
  assert.equal(state.rows[0].mediaId, 'asset_2', 'the edit is the picture');
  assert.equal(state.rows[0].savedByQueue, undefined, 'no cut was saved over it');
  assert.equal(state.attempts, 1, 'and none was started again');
});

test('a cut that fails after another window finished the picture leaves that version as it is', async () => {
  const state: QueueState = {
    paused: false,
    scans: 0,
    attempts: 0,
    rows: [{ id: 'first', state: 'waiting', sourceMediaId: 'first', mediaId: 'asset_1', failsAfterEdit: 'asset_2' }],
  };
  const queue = await libraryQueue(state);
  await queue.drainLibraryQueue();
  assert.equal(state.rows[0].state, 'ready', 'not marked failed');
  assert.equal(state.rows[0].error, undefined);
  assert.equal(state.rows[0].mediaId, 'asset_2');
});
