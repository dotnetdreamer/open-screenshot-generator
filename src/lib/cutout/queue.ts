// Cutting pictures, one at a time per window: the library's waiting pictures,
// an agent's remove_background call and the Properties panel's button all go
// through `cutPictureFile`, which holds one lock so their steps never mix in the
// worker. A window that closes mid-cut leaves its picture `cutting`; the next
// window to open the background remover picks it up again, and a Web Lock per
// picture keeps two windows from cutting the same one.

import { getMediaAsset } from '@/lib/mediaStore';
import { CutoutWorkerError, cutPicture, DEFAULT_RENDER, forgetPicture, openPicture, renderCutout, type CutStep } from './engine';
import {
  getLibraryImage,
  saveLibraryCut,
  setLibraryImageState,
  unfinishedLibraryImages,
} from './library';
import { decodePicture, encodeMask, encodeRgba, thumbnailOf, type WorkingPicture } from './picture';
import type { Rect } from './refine';
import type { CutoutEngine, RenderSettings } from './worker/protocol';

let chain: Promise<unknown> = Promise.resolve();

/** Runs `job` once every cut started before it has finished. */
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}

export interface CutFiles {
  /** The finished picture, PNG. */
  picture: Blob;
  width: number;
  height: number;
  /** The mask over the photo, greyscale PNG, and its bytes. */
  mask: Blob;
  maskBytes: Uint8Array;
  thumb: ArrayBuffer;
  rect: Rect;
  settings: RenderSettings;
  engine: CutoutEngine;
  /** The photo at its working size, as it was cut. */
  source: WorkingPicture;
}

/** Turns a picture file into a cut-out. */
export function cutPictureFile(
  file: Blob,
  options: {
    settings?: Partial<RenderSettings>;
    download?: boolean;
    signal?: AbortSignal;
    onStep?: (step: CutStep) => void;
  } = {}
): Promise<CutFiles> {
  return inTurn(async () => {
    const source = await decodePicture(file);
    const key = `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await openPicture(key, source);
    try {
      const step = await cutPicture(key, source, { download: options.download, signal: options.signal, onStep: options.onStep });
      const settings = { ...DEFAULT_RENDER, ...options.settings };
      const rendered = await renderCutout(key, step.mask, settings);
      const rgba = new Uint8ClampedArray(rendered.rgba);
      const [picture, mask, thumbBlob] = await Promise.all([
        encodeRgba(rgba, rendered.width, rendered.height, 'image/png'),
        encodeMask(step.mask, step.width, step.height),
        thumbnailOf(rgba, rendered.width, rendered.height),
      ]);
      return {
        picture,
        width: rendered.width,
        height: rendered.height,
        mask,
        maskBytes: step.mask,
        thumb: await thumbBlob.arrayBuffer(),
        rect: rendered.rect,
        settings,
        engine: step.engine,
        source,
      };
    } finally {
      forgetPicture(key);
    }
  });
}

type StepListener = (id: string, step: CutStep | null, state: 'cutting' | 'done' | 'failed') => void;
const stepListeners = new Set<StepListener>();

/** Hears each library picture's masks as they improve, for the view on screen. */
export function onLibraryCutStep(listener: StepListener): () => void {
  stepListeners.add(listener);
  return () => stepListeners.delete(listener);
}

function withPictureLock<T>(id: string, job: () => Promise<T>): Promise<T | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return job();
  return locks.request(`osg-cutout-${id}`, { ifAvailable: true }, async (lock) => (lock ? job() : null));
}

let draining = false;

/** Cuts every waiting picture in the library, oldest first. */
export async function drainLibraryQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const waiting = await unfinishedLibraryImages();
      let progressed = false;
      let paused = false;
      for (const row of waiting) {
        const done = await withPictureLock(row.id, () => cutLibraryImage(row.id));
        if (done === 'paused') {
          paused = true;
          break;
        }
        if (done) progressed = true;
      }
      if (paused || !progressed) break;
    }
  } finally {
    draining = false;
  }
}

async function cutLibraryImage(id: string): Promise<boolean | 'paused'> {
  const row = await getLibraryImage(id);
  if (!row || row.deletedAt || (row.state !== 'waiting' && row.state !== 'cutting')) return false;
  const source = row.sourceMediaId ? await getMediaAsset(row.sourceMediaId) : undefined;
  if (!source) {
    await setLibraryImageState(id, 'failed', 'The photo is no longer on this device');
    return true;
  }
  await setLibraryImageState(id, 'cutting');
  stepListeners.forEach((listener) => listener(id, null, 'cutting'));
  try {
    const files = await cutPictureFile(source.blob, {
      settings: row.settings,
      onStep: (step) => stepListeners.forEach((listener) => listener(id, step, 'cutting')),
    });
    await saveLibraryCut(id, {
      mask: files.mask,
      picture: files.picture,
      width: files.width,
      height: files.height,
      thumb: files.thumb,
      settings: files.settings,
      rect: files.rect,
      engine: files.engine,
    });
    stepListeners.forEach((listener) => listener(id, null, 'done'));
  } catch (error) {
    if (error instanceof CutoutWorkerError && error.stopped) {
      await setLibraryImageState(id, 'waiting');
      return 'paused';
    }
    console.error('Cutting a picture failed', error);
    await setLibraryImageState(id, 'failed', error instanceof Error ? error.message : 'The background could not be removed');
    stepListeners.forEach((listener) => listener(id, null, 'failed'));
  }
  return true;
}
