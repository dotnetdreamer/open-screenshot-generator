// The page's side of the background remover: one worker per window
// (worker/cutoutWorker.ts), which model this computer uses, whether it is
// downloaded, and the cut itself.
//
// A cut comes in up to two steps. On a Mac with macOS 14 or later, Apple's
// subject lifting answers first, in a few hundredths of a second (vision.ts);
// then BiRefNet's mask replaces it once the model is downloaded and loaded,
// which takes a few seconds on a GPU. Anywhere else the model's mask is the
// first and only step. A picture on a plain colour is cut by colour too
// (colorKey.ts), so a logo comes out right even before the model is here.

import { useSyncExternalStore } from 'react';
import { withBasePath } from '@/lib/basePath';
import { modelFor, type CutoutModelSpec } from './models';
import { deleteModel, hasModel, storedModels } from './modelStore';
import { scaleRgba, workingSize, type WorkingPicture } from './picture';
import { VISION_SIDE, visionAvailable, visionMask } from './vision';
import type { CutDone, CutoutEngine, LoadDone, RenderDone, RenderSettings, WorkerRequest, WorkerResponse } from './worker/protocol';

export type { CutoutEngine, RenderSettings } from './worker/protocol';

export type ModelPhase = 'unknown' | 'missing' | 'downloading' | 'loading' | 'ready' | 'failed';

export interface CutoutStatus {
  phase: ModelPhase;
  /** The model this computer uses, once known. */
  model: CutoutModelSpec | null;
  /** Where the loaded model runs. */
  device: 'webgpu' | 'wasm' | null;
  /** Apple's subject cut-out is here (Mac, macOS 14 and later). */
  vision: boolean;
  received: number;
  total: number;
  /** Why the model is not ready, in words for the user. */
  error: string | null;
}

let status: CutoutStatus = { phase: 'unknown', model: null, device: null, vision: false, received: 0, total: 0, error: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<CutoutStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}

export function getCutoutStatus(): CutoutStatus {
  return status;
}

export function subscribeCutoutStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_STATUS: CutoutStatus = { phase: 'unknown', model: null, device: null, vision: false, received: 0, total: 0, error: null };

/** The model's state, live. */
export function useCutoutStatus(): CutoutStatus {
  return useSyncExternalStore(subscribeCutoutStatus, getCutoutStatus, () => SERVER_STATUS);
}

// --- the worker ------------------------------------------------------------------

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; progress?: (received: number, total: number) => void }>();

/** A failure the worker reported, kept apart from one this side made. */
export class CutoutWorkerError extends Error {
  constructor(message: string, readonly stopped = false) {
    super(message);
    this.name = 'CutoutWorkerError';
  }
}

function workerOf(): Worker {
  if (worker) return worker;
  // The worker is a prebuilt file in public/ (scripts/build-cutout.mjs), not a
  // module for the bundler to follow, and Turbopack reports any `new Worker(`
  // whose address it cannot work out, so the constructor goes by another name.
  const WorkerFile = globalThis.Worker;
  const created = new WorkerFile(withBasePath('/cutout/cutout-worker.js'), { type: 'module', name: 'cutout' });
  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') {
      entry.progress?.(message.received, message.total);
      return;
    }
    pending.delete(message.id);
    if (message.type === 'done') entry.resolve(message.result);
    else entry.reject(new CutoutWorkerError(message.error, message.stopped));
  };
  created.onerror = (event) => {
    console.error('The cut-out worker failed', event.message);
    const error = new CutoutWorkerError('The background remover stopped working. Reload the window and try again');
    pending.forEach((entry) => entry.reject(error));
    pending.clear();
    worker = null;
    setStatus({ phase: status.phase === 'downloading' ? 'missing' : 'unknown', device: null });
  };
  worker = created;
  return created;
}

/** A request without its id, kept apart per kind (a plain Omit of the union would merge them). */
type Body = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

function ask<T>(body: Body, transfer: Transferable[] = [], progress?: (received: number, total: number) => void): { id: number; promise: Promise<T> } {
  const id = nextId++;
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, progress });
    workerOf().postMessage({ ...body, id } as WorkerRequest, transfer);
  });
  return { id, promise };
}

// --- which model, and getting it ready ---------------------------------------------

const GPU_FAILED_KEY = 'osg.cutout.gpu-failed';

function gpuFailedBefore(): boolean {
  try {
    return window.localStorage.getItem(GPU_FAILED_KEY) === '1';
  } catch {
    return false;
  }
}

function noteGpuFailed(): void {
  try {
    window.localStorage.setItem(GPU_FAILED_KEY, '1');
  } catch {
    // Private mode: it is found out again next time.
  }
}

interface GpuAdapterLike {
  features?: { has(name: string): boolean };
  limits?: { maxStorageBuffersPerShaderStage?: number };
}

/**
 * Whether WebGPU can run the 1024 model here: half precision in shaders (the
 * model is fp16; headless Chromium's adapter has none and refuses the session)
 * and the 7 storage buffers a shader stage the rewritten export needs. Asked
 * before anything is downloaded, so a GPU that cannot run it never costs the
 * 118 MB it would have fetched.
 */
async function hasUsableGpu(): Promise<boolean> {
  if (gpuFailedBefore()) return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> } }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return !!adapter && !!adapter.features?.has('shader-f16') && (adapter.limits?.maxStorageBuffersPerShaderStage ?? 8) >= 8;
  } catch {
    return false;
  }
}

function hasWasmSimd(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11,
    ]));
  } catch {
    return false;
  }
}

let detecting: Promise<void> | null = null;

/** Works out the model and whether it is downloaded, once a window. */
export function detectCutout(): Promise<void> {
  detecting ??= (async () => {
    const [gpu, vision] = await Promise.all([hasUsableGpu(), visionAvailable()]);
    if (!hasWasmSimd()) {
      setStatus({
        model: null, vision, phase: 'failed', device: null, received: 0, total: 0,
        error: 'This browser cannot run the cut-out model. Update your browser or operating system to remove backgrounds from photos',
      });
      return;
    }
    const model = modelFor(gpu);
    const ready = await hasModel(model);
    setStatus({ model, vision, phase: ready ? 'ready' : 'missing', total: model.bytes, received: ready ? model.bytes : 0, error: null });
  })().catch((error) => {
    detecting = null;
    setStatus({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  });
  return detecting;
}

let downloading: { id: number; promise: Promise<void> } | null = null;
let automaticDownloadsStopped = false;

function pausedDownloadError(): CutoutWorkerError {
  return new CutoutWorkerError('The model download is paused. Choose Download to continue', true);
}

/** Downloads this computer's model. Resolves when it is stored. */
export async function downloadCutoutModel(options: { automatic?: boolean } = {}): Promise<void> {
  if (options.automatic && automaticDownloadsStopped) throw pausedDownloadError();
  if (!options.automatic) automaticDownloadsStopped = false;
  await detectCutout();
  const model = status.model;
  if (!model) throw new Error(status.error ?? 'The background remover is not available here');
  if (status.phase === 'ready' || status.phase === 'loading') return;
  if (downloading) return downloading.promise;
  setStatus({ phase: 'downloading', received: 0, total: model.bytes, error: null });
  const job = ask<null>({ type: 'download', spec: model }, [], (received, total) => setStatus({ received, total }));
  downloading = {
    id: job.id,
    promise: job.promise.then(
      () => {
        downloading = null;
        setStatus({ phase: 'ready', received: model.bytes });
      },
      (error: CutoutWorkerError) => {
        downloading = null;
        setStatus({ phase: error.stopped ? 'missing' : 'failed', error: error.stopped ? null : friendlyDownloadError(error) });
        throw error;
      }
    ),
  };
  return downloading.promise;
}

function friendlyDownloadError(error: Error): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "You're offline. Connect to the internet and try again";
  if (/QuotaExceeded|quota/i.test(error.message)) return "There isn't enough free space on this computer";
  return error.message || "The download didn't work. Try again";
}

/** Stops automatic downloads until Download is chosen. Keeps the pieces already here. */
export function stopCutoutDownload(): void {
  automaticDownloadsStopped = true;
  if (!downloading) return;
  void ask({ type: 'stop', target: downloading.id }).promise.catch(() => undefined);
}

let loading: Promise<LoadDone> | null = null;

/** Loads the downloaded model into the worker. */
async function loadModel(): Promise<LoadDone> {
  const model = status.model;
  if (!model) throw new Error('The background remover is not available here');
  if (status.device) return { device: status.device, ms: 0 };
  loading ??= (async () => {
    setStatus({ phase: 'loading', error: null });
    try {
      const done = await ask<LoadDone>({ type: 'load', spec: model, gpu: model.device === 'gpu' }).promise;
      setStatus({ phase: 'ready', device: done.device });
      return done;
    } catch (error) {
      if (model.device === 'gpu') {
        // The GPU would not take the 1024 model: use the CPU model from now on.
        console.error('The GPU could not run the cut-out model', error);
        noteGpuFailed();
        const fallback = modelFor(false);
        const ready = await hasModel(fallback);
        setStatus({ model: fallback, phase: ready ? 'ready' : 'missing', received: ready ? fallback.bytes : 0, total: fallback.bytes, device: null });
        throw new Error('GPU_FALLBACK');
      }
      setStatus({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Downloads (when allowed) and loads the model. False when it cannot be had now. */
async function modelReady(download: boolean): Promise<boolean> {
  await detectCutout();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (status.phase === 'missing' || status.phase === 'failed' || status.phase === 'downloading') {
      if (!download && status.phase !== 'downloading') return false;
      try {
        await downloadCutoutModel({ automatic: true });
      } catch {
        return false;
      }
    }
    try {
      await loadModel();
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === 'GPU_FALLBACK') continue;
      return false;
    }
  }
  return false;
}

/** The models kept on this device and the room they take. */
export async function cutoutModelsOnDevice(): Promise<{ bytes: number }> {
  const models = await storedModels();
  return { bytes: models.reduce((sum, model) => sum + model.bytes, 0) };
}

/** Removes every downloaded model from this device. */
export async function removeCutoutModels(): Promise<void> {
  stopCutoutDownload();
  for (const model of await storedModels()) await deleteModel(model.id);
  if (worker) {
    worker.terminate();
    worker = null;
    pending.forEach((entry) => entry.reject(new CutoutWorkerError('The model was removed')));
    pending.clear();
  }
  detecting = null;
  setStatus({ phase: 'unknown', device: null, received: 0 });
  await detectCutout();
}

// --- cutting -----------------------------------------------------------------------

export interface CutStep {
  mask: Uint8Array;
  width: number;
  height: number;
  engine: CutoutEngine;
  flat: boolean;
  /** No better mask is coming. */
  final: boolean;
}

/** Hands a picture to the worker under `key`. The page keeps its own copy. */
export async function openPicture(key: string, picture: WorkingPicture): Promise<void> {
  const copy = picture.rgba.slice();
  await ask({ type: 'image', key, rgba: copy.buffer, width: picture.width, height: picture.height }, [copy.buffer]).promise;
}

export function forgetPicture(key: string): void {
  if (worker) void ask({ type: 'forget', key }).promise.catch(() => undefined);
}

async function cutWith(key: string, useModel: boolean, hint: { mask: Uint8Array; width: number; height: number } | null): Promise<CutDone> {
  const hintBody = hint ? { mask: hint.mask.slice().buffer, width: hint.width, height: hint.height } : null;
  return ask<CutDone>({ type: 'cut', key, useModel, hint: hintBody }, hintBody ? [hintBody.mask] : []).promise;
}

/**
 * Cuts the picture opened under `key`, calling `onStep` with each mask as it
 * improves; resolves with the last one. `download` lets it fetch the model
 * when it is not on this device yet.
 */
export async function cutPicture(
  key: string,
  picture: WorkingPicture,
  options: { onStep?: (step: CutStep) => void; download?: boolean; signal?: AbortSignal; preferVision?: boolean } = {}
): Promise<CutStep> {
  await detectCutout();
  const checkStopped = () => {
    if (options.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  };
  const emit = (done: CutDone, final: boolean): CutStep => {
    const step = { mask: new Uint8Array(done.mask), width: done.width, height: done.height, engine: done.engine, flat: done.flat, final };
    options.onStep?.(step);
    return step;
  };
  const download = options.download ?? true;

  // A picture that already has no background needs no model at all.
  if (picture.hasAlpha) {
    const own = await cutWith(key, false, null).catch(() => null);
    if (own?.engine === 'existing') return emit(own, true);
  }

  // A plain background needs no download. When the model is already here,
  // its mask refines the colour cut, including soft shadows.
  const modelHere = status.phase === 'ready' || status.device !== null;
  let first: CutStep | null = null;
  if (!modelHere) {
    const byColor = await cutWith(key, false, null).catch(() => null);
    if (byColor) {
      return emit(byColor, true);
    }
  }

  if (status.vision && !first) {
    try {
      const size = workingSize(picture.width, picture.height, VISION_SIDE);
      const small = scaleRgba(picture.rgba, picture.width, picture.height, size.width, size.height);
      const hint = await visionMask(small, size.width, size.height);
      checkStopped();
      const modelComing = status.phase === 'ready' || status.device !== null || download;
      first = emit(await cutWith(key, false, hint), !modelComing || !!options.preferVision);
      if (options.preferVision) return first;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      console.error("Apple's subject cut-out failed", error);
    }
  }

  checkStopped();
  if (await modelReady(download)) {
    checkStopped();
    return emit(await cutWith(key, true, null), true);
  }
  if (first) {
    const done: CutStep = { ...first, final: true };
    options.onStep?.(done);
    return done;
  }
  if (automaticDownloadsStopped && status.phase === 'missing') throw pausedDownloadError();
  try {
    return emit(await cutWith(key, false, null), true);
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_ENGINE') {
      throw new Error(status.error ?? 'Do the one-time download on the left first, then try again');
    }
    throw error;
  }
}

/** The finished picture for a mask: edges, colours and trim applied in the worker. */
export function renderCutout(key: string, mask: Uint8Array, settings: RenderSettings, maxSide?: number): Promise<RenderDone> {
  const copy = mask.slice();
  return ask<RenderDone>({ type: 'render', key, mask: copy.buffer, settings, maxSide }, [copy.buffer]).promise;
}

/** The mask with the edge controls applied, for the editor to show. */
export async function shapeMask(mask: Uint8Array, width: number, height: number, edge: number, softness: number): Promise<Uint8Array> {
  if (!edge && softness <= 0) return mask;
  const copy = mask.slice();
  const shaped = await ask<ArrayBuffer>({ type: 'shape', mask: copy.buffer, width, height, edge, softness }, [copy.buffer]).promise;
  return new Uint8Array(shaped);
}

export const DEFAULT_RENDER: RenderSettings = { edge: 0, softness: 0, cleanColors: true, trim: true };
