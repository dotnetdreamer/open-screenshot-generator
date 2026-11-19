// The messages between the page and the cut-out worker (cutoutWorker.ts).
// Every request carries an id; the worker answers it once with `done` or
// `failed`, and a download also sends `progress` on the way.

import type { CutoutModelSpec } from '../models';
import type { Rect } from '../refine';

export type CutoutEngine =
  /** The picture's own transparency: it had no background to begin with. */
  | 'existing'
  /** A plain colour backdrop, cut by colour alone. */
  | 'color'
  /** BiRefNet lite, with the colour cut on a plain backdrop. */
  | 'model'
  /** Apple's subject lifting (macOS 14 and later), with the same refinement. */
  | 'vision';

export interface RenderSettings {
  /** Grow (positive) or shrink (negative) the subject by this many pixels. */
  edge: number;
  /** Soften the edge by this many pixels. */
  softness: number;
  /** Take the old background's colour out of the edge. */
  cleanColors: boolean;
  /** Crop to the subject. */
  trim: boolean;
}

export type WorkerRequest =
  | { id: number; type: 'download'; spec: CutoutModelSpec }
  | { id: number; type: 'load'; spec: CutoutModelSpec; gpu: boolean }
  | { id: number; type: 'image'; key: string; rgba: ArrayBuffer; width: number; height: number }
  | {
      id: number;
      type: 'cut';
      key: string;
      /** Run the loaded model. */
      useModel: boolean;
      /** A mask from elsewhere (Apple's Vision), used when the model is not run. */
      hint?: { mask: ArrayBuffer; width: number; height: number } | null;
    }
  | {
      id: number;
      type: 'render';
      key: string;
      mask: ArrayBuffer;
      settings: RenderSettings;
      /** Draw it no longer than this, for a quick look. Full size when absent. */
      maxSide?: number;
    }
  /** The mask with the edge controls applied, the same size: what the editor shows. */
  | { id: number; type: 'shape'; mask: ArrayBuffer; width: number; height: number; edge: number; softness: number }
  | { id: number; type: 'forget'; key: string }
  /** Stops the request `target`, which is a download. */
  | { id: number; type: 'stop'; target: number };

export interface CutDone {
  /** One byte per pixel of the picture, 0 to 255. */
  mask: ArrayBuffer;
  width: number;
  height: number;
  engine: CutoutEngine;
  /** Whether the colour cut took part. */
  flat: boolean;
  ms: number;
}

export interface RenderDone {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  /** Where the result sits in the full size picture. */
  rect: Rect;
}

export interface LoadDone {
  device: 'webgpu' | 'wasm';
  ms: number;
}

export type WorkerResponse =
  | { id: number; type: 'progress'; received: number; total: number }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'failed'; error: string; stopped?: boolean };
