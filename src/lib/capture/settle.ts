/**
 * Waiting for an app to finish drawing before its screenshot is taken.
 *
 * A screenshot taken a second after a launch was blank on the simulator this
 * was built on: the app was still loading. So after a launch or a link, the
 * screen is sampled until two samples in a row look the same. A small grey
 * copy is enough to tell a screen that still moves from one that has stopped,
 * and costs little to compare.
 */

const SAMPLE_WIDTH = 24;
const SAMPLE_HEIGHT = 52;

/** Mean difference of two grey samples of the same size, from 0 (the same) to 255. */
export function frameDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return 255;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

/** Below this a screen counts as still. A blinking cursor stays under it; a spinner does not. */
export const STILL_BELOW = 1.5;

/** A small grey copy of a picture. Browser only. */
export async function greySample(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: SAMPLE_WIDTH,
    resizeHeight: SAMPLE_HEIGHT,
    resizeQuality: 'low',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No canvas to compare screens on');
    context.drawImage(bitmap, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const { data } = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const grey = new Uint8ClampedArray(SAMPLE_WIDTH * SAMPLE_HEIGHT);
    for (let pixel = 0; pixel < grey.length; pixel += 1) {
      const at = pixel * 4;
      grey[pixel] = (data[at] * 299 + data[at + 1] * 587 + data[at + 2] * 114) / 1000;
    }
    return grey;
  } finally {
    bitmap.close();
  }
}

export interface WaitOptions {
  signal?: AbortSignal;
  /** Never call the screen still before this long. */
  minMs?: number;
  /** Give up after this long and answer false. */
  maxMs?: number;
  /** The pause between samples. */
  intervalMs?: number;
  /** Each sample as it is taken, for a live view to show. */
  onFrame?: (blob: Blob) => void;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Stopped', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/**
 * Samples the screen with `take` until two samples in a row match the one
 * before. True once the screen is still; false when `maxMs` ran out first,
 * which leaves the caller to take the screenshot anyway and say so.
 */
export async function waitUntilStill(take: () => Promise<Blob>, options: WaitOptions = {}): Promise<boolean> {
  const { signal, minMs = 800, maxMs = 15_000, intervalMs = 250, onFrame } = options;
  const started = Date.now();
  let previous: Uint8ClampedArray | null = null;
  let stillRuns = 0;
  while (Date.now() - started < maxMs) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const blob = await take();
    onFrame?.(blob);
    const sample = await greySample(blob);
    stillRuns = previous && frameDifference(previous, sample) < STILL_BELOW ? stillRuns + 1 : 0;
    previous = sample;
    if (stillRuns >= 2 && Date.now() - started >= minMs) return true;
    await pause(intervalMs, signal);
  }
  return false;
}

export { pause };
