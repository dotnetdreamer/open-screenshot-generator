// Apple's subject lifting, through the desktop app (src-tauri/src/cutout.rs).
// A Mac on macOS 14 or later answers in a few hundredths of a second with
// nothing to download, so the background remover shows its mask first and
// replaces it with the model's once that is ready.

import { isTauri } from '@/lib/desktop';

let availability: Promise<boolean> | null = null;

/** Whether this computer has Apple's subject cut-out. Always false on the web. */
export function visionAvailable(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  availability ??= import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<boolean>('abs_cutout_vision_available'))
    .catch(() => false);
  return availability;
}

/** The longest side sent to Vision. Its own analysis is smaller still. */
export const VISION_SIDE = 2048;

export interface VisionMask {
  mask: Uint8Array;
  width: number;
  height: number;
}

/** Vision's mask for a picture given as RGBA bytes, one byte a pixel. */
export async function visionMask(rgba: Uint8ClampedArray, width: number, height: number): Promise<VisionMask> {
  const { invoke } = await import('@tauri-apps/api/core');
  const body = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const answer = await invoke<ArrayBuffer>('abs_cutout_vision', body, {
    headers: { 'x-osg-width': String(width), 'x-osg-height': String(height) },
  });
  const view = new DataView(answer);
  const maskWidth = view.getUint32(0, true);
  const maskHeight = view.getUint32(4, true);
  return { mask: new Uint8Array(answer, 8, maskWidth * maskHeight), width: maskWidth, height: maskHeight };
}
