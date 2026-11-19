// The cut-out worker. Downloads and keeps the model, runs it, refines its
// mask on the photo and draws the finished picture, all off the page's thread
// so the editor keeps answering while a 3000 pixel photo is worked on.
//
// Bundled on its own by scripts/build-cutout.mjs into public/cutout/, beside
// onnxruntime-web's WebAssembly file, rather than through Next: the dev server
// (Turbopack), the export (webpack), the desktop shell and the CLI then all
// load the same file from the same place.

import * as ort from 'onnxruntime-web/webgpu';
import { colorKey, detectFlatBackground, hasTransparentBorder } from '../colorKey';
import { downloadModel, DownloadStoppedError, readModel } from '../modelStore';
import type { CutoutModelSpec } from '../models';
import {
  composeCutout,
  estimateForeground,
  featherEdge,
  modelInput,
  refineMask,
  resizePlaneArea,
  resizeRgba,
  shiftEdge,
  sigmoidPlane,
  toBytes,
  toFloats,
  trimBounds,
  type Plane,
} from '../refine';
import type { CutDone, LoadDone, RenderDone, RenderSettings, WorkerRequest, WorkerResponse } from './protocol';

// The DOM library has no worker scope type; this is the part used here.
declare const self: {
  location: Location;
  crossOriginIsolated: boolean;
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

ort.env.wasm.wasmPaths = new URL('./ort/', self.location.href).href;
// Threads need a cross-origin isolated page, which the editor is not (it
// loads pictures and fonts from other sites). Measured: one thread runs the
// 512 model in 5.9 s on an M1 Pro, four would take 1.8 s.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
ort.env.wasm.proxy = false;
// The runtime's warnings about the graph go to the console as errors otherwise.
ort.env.logLevel = 'error';

interface Loaded {
  spec: CutoutModelSpec;
  session: ort.InferenceSession;
  device: 'webgpu' | 'wasm';
}

let loaded: Loaded | null = null;
const images = new Map<string, { rgba: Uint8ClampedArray; width: number; height: number }>();
const downloads = new Map<number, AbortController>();

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

async function load(spec: CutoutModelSpec, gpu: boolean): Promise<LoadDone> {
  if (loaded?.spec.id === spec.id && (loaded.device === 'webgpu') === gpu) return { device: loaded.device, ms: 0 };
  const started = performance.now();
  if (loaded) {
    await loaded.session.release().catch(() => undefined);
    loaded = null;
  }
  const bytes = await readModel(spec);
  const device = gpu ? 'webgpu' : 'wasm';
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: [device],
    graphOptimizationLevel: 'all',
    // Errors only: the graph optimiser's notes otherwise fill the console.
    logSeverityLevel: 3,
  });
  loaded = { spec, session, device };
  return { device, ms: Math.round(performance.now() - started) };
}

async function runModel(rgba: Uint8ClampedArray, width: number, height: number): Promise<Plane> {
  if (!loaded) throw new Error('The cut-out model is not loaded');
  const { session, spec } = loaded;
  const size = spec.size;
  const input = new ort.Tensor('float32', modelInput(rgba, width, height, size), [1, 3, size, size]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const output = outputs[session.outputNames[session.outputNames.length - 1]];
  const logits = output.data as Float32Array;
  const plane = sigmoidPlane(logits, size);
  input.dispose?.();
  for (const value of Object.values(outputs)) value.dispose?.();
  return plane;
}

async function cut(request: Extract<WorkerRequest, { type: 'cut' }>): Promise<{ result: CutDone; transfer: Transferable[] }> {
  const image = images.get(request.key);
  if (!image) throw new Error('That picture is no longer open');
  const started = performance.now();
  const { rgba, width, height } = image;
  const n = width * height;

  if (hasTransparentBorder(rgba, width, height)) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3];
    return { result: { mask: mask.buffer, width, height, engine: 'existing', flat: false, ms: Math.round(performance.now() - started) }, transfer: [mask.buffer] };
  }

  let coarse: Plane | null = null;
  let engine: CutDone['engine'] = 'color';
  if (request.useModel && loaded) {
    coarse = await runModel(rgba, width, height);
    engine = 'model';
  } else if (request.hint) {
    const bytes = new Uint8Array(request.hint.mask);
    const data = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) data[i] = bytes[i] / 255;
    coarse = { data, width: request.hint.width, height: request.hint.height };
    engine = 'vision';
  }

  const flat = detectFlatBackground(rgba, width, height);
  let mask: Uint8Array;
  if (coarse) {
    const refined = refineMask(rgba, width, height, coarse);
    mask = flat ? colorKey(rgba, width, height, flat, { model: refined }).alpha : toBytes(refined);
  } else if (flat) {
    mask = colorKey(rgba, width, height, flat).alpha;
  } else {
    throw new Error('NO_ENGINE');
  }
  return {
    result: { mask: mask.buffer as ArrayBuffer, width, height, engine, flat: !!flat, ms: Math.round(performance.now() - started) },
    transfer: [mask.buffer as ArrayBuffer],
  };
}

function render(request: Extract<WorkerRequest, { type: 'render' }>): { result: RenderDone; transfer: Transferable[] } {
  const image = images.get(request.key);
  if (!image) throw new Error('That picture is no longer open');
  const settings: RenderSettings = request.settings;
  let { rgba, width, height } = image;
  let mask: Uint8Array = new Uint8Array(request.mask);
  // A quick look is drawn small: the edge controls answer while they move.
  const scale = request.maxSide && Math.max(width, height) > request.maxSide ? request.maxSide / Math.max(width, height) : 1;
  if (scale < 1) {
    const toWidth = Math.max(1, Math.round(width * scale));
    const toHeight = Math.max(1, Math.round(height * scale));
    const small = resizePlaneArea(toFloats(mask), width, height, toWidth, toHeight);
    rgba = resizeRgba(rgba, width, height, toWidth, toHeight);
    mask = toBytes(small);
    width = toWidth;
    height = toHeight;
  }
  let alpha = toFloats(mask);
  if (settings.edge) alpha = shiftEdge(alpha, width, height, settings.edge * scale);
  if (settings.softness > 0) alpha = featherEdge(alpha, width, height, settings.softness * scale);
  const finalMask = settings.edge || settings.softness > 0 ? toBytes(alpha) : mask;
  const full = { x: 0, y: 0, width, height };
  const rect = settings.trim ? trimBounds(finalMask, width, height) ?? full : full;
  const foreground = settings.cleanColors ? estimateForeground(rgba, width, height, alpha) : null;
  const out = composeCutout(rgba, width, finalMask, rect, foreground);
  const back = scale < 1
    ? {
        x: Math.round(rect.x / scale),
        y: Math.round(rect.y / scale),
        width: Math.round(rect.width / scale),
        height: Math.round(rect.height / scale),
      }
    : rect;
  const bytes = out.buffer as ArrayBuffer;
  return { result: { rgba: bytes, width: rect.width, height: rect.height, rect: back }, transfer: [bytes] };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'download': {
        const controller = new AbortController();
        downloads.set(request.id, controller);
        try {
          await downloadModel(request.spec, {
            signal: controller.signal,
            onProgress: ({ received, total }) => post({ id: request.id, type: 'progress', received, total }),
          });
        } finally {
          downloads.delete(request.id);
        }
        post({ id: request.id, type: 'done', result: null });
        return;
      }
      case 'stop':
        downloads.get(request.target)?.abort();
        post({ id: request.id, type: 'done', result: null });
        return;
      case 'load':
        post({ id: request.id, type: 'done', result: await load(request.spec, request.gpu) });
        return;
      case 'image':
        images.set(request.key, { rgba: new Uint8ClampedArray(request.rgba), width: request.width, height: request.height });
        // Two at most: the one on screen and the one being cut behind it.
        while (images.size > 2) images.delete(images.keys().next().value as string);
        post({ id: request.id, type: 'done', result: null });
        return;
      case 'cut': {
        const { result, transfer } = await cut(request);
        post({ id: request.id, type: 'done', result }, transfer);
        return;
      }
      case 'render': {
        const { result, transfer } = render(request);
        post({ id: request.id, type: 'done', result }, transfer);
        return;
      }
      case 'shape': {
        let alpha = toFloats(new Uint8Array(request.mask));
        if (request.edge) alpha = shiftEdge(alpha, request.width, request.height, request.edge);
        if (request.softness > 0) alpha = featherEdge(alpha, request.width, request.height, request.softness);
        const shaped = toBytes(alpha);
        const buffer = shaped.buffer as ArrayBuffer;
        post({ id: request.id, type: 'done', result: buffer }, [buffer]);
        return;
      }
      case 'forget':
        images.delete(request.key);
        post({ id: request.id, type: 'done', result: null });
        return;
    }
  } catch (error) {
    post({
      id: request.id,
      type: 'failed',
      error: error instanceof Error ? error.message : String(error),
      stopped: error instanceof DownloadStoppedError,
    });
  }
};
