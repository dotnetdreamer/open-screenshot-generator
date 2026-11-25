// Reading small grey frames out of a recording, for analyze.ts, and a strip
// of pictures for the timeline. Browser only.
//
// Where seeking is quick (WebKit), it seeks to every sample. Where it's slow
// (Chromium starts again from a keyframe each time), the recording is played,
// muted, at four times its speed, and a frame is kept each time the one on
// screen reaches the next sample time (requestVideoFrameCallback). Where a
// browser has no frame callback, or playing stalls, it falls back to seeking.
// Nothing is read while the page can't be seen: it waits, and carries on
// once the window or tab is back in view.

import type { LumaFrame } from './analyze';
import { hiddenVideo, loadVideo } from './video';

export interface SampleOptions {
  /** The part to read, in the recording's seconds. */
  start: number;
  end: number;
  /** Seconds between frames. */
  step: number;
  /** The frames' long side in pixels. */
  maxSide?: number;
  /** Seconds between pictures for the timeline strip. */
  thumbEvery?: number;
  thumbHeight?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface Thumb {
  /** Film seconds. */
  t: number;
  url: string;
}

export interface SampledRecording {
  /** Times are film seconds: the recording's seconds less `start`. */
  frames: LumaFrame[];
  thumbs: Thumb[];
}

/** Seconds between analysis frames for a recording this long: about ten a second, never more than 600 frames. */
export function stepFor(duration: number): number {
  return Math.max(0.1, Math.ceil((duration / 600) * 100) / 100);
}

function abortError(): DOMException {
  return new DOMException('Stopped', 'AbortError');
}

export type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

class FrameReader {
  readonly width: number;
  readonly height: number;
  private readonly big: CanvasRenderingContext2D;
  private readonly small: CanvasRenderingContext2D;
  private readonly thumb: HTMLCanvasElement;
  private readonly thumbCtx: CanvasRenderingContext2D;

  constructor(
    private readonly video: HTMLVideoElement,
    maxSide: number,
    thumbHeight: number
  ) {
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const scale = maxSide / Math.max(vw, vh);
    this.width = Math.max(8, Math.round(vw * scale));
    this.height = Math.max(8, Math.round(vh * scale));
    // Down in two steps: one big jump skips pixels and lets small text flicker.
    const bigCanvas = document.createElement('canvas');
    bigCanvas.width = this.width * 3;
    bigCanvas.height = this.height * 3;
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = this.width;
    smallCanvas.height = this.height;
    this.big = bigCanvas.getContext('2d', { willReadFrequently: false })!;
    this.small = smallCanvas.getContext('2d', { willReadFrequently: true })!;
    this.big.imageSmoothingQuality = 'high';
    this.small.imageSmoothingQuality = 'high';
    this.thumb = document.createElement('canvas');
    this.thumb.height = thumbHeight;
    this.thumb.width = Math.max(1, Math.round((thumbHeight * vw) / vh));
    this.thumbCtx = this.thumb.getContext('2d')!;
    this.thumbCtx.imageSmoothingQuality = 'high';
  }

  luma(t: number): LumaFrame {
    this.big.drawImage(this.video, 0, 0, this.big.canvas.width, this.big.canvas.height);
    this.small.drawImage(this.big.canvas, 0, 0, this.width, this.height);
    const rgba = this.small.getImageData(0, 0, this.width, this.height).data;
    const data = new Uint8Array(this.width * this.height);
    for (let i = 0, j = 0; j < data.length; i += 4, j += 1) {
      data[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    }
    return { t, width: this.width, height: this.height, data };
  }

  thumbUrl(): string {
    this.thumbCtx.drawImage(this.big.canvas, 0, 0, this.thumb.width, this.thumb.height);
    return this.thumb.toDataURL('image/jpeg', 0.72);
  }
}

/** Waits for `event` on the video, at most `timeoutMs`. Resolves true when the event came, false when the time ran out. */
function waitFor(video: HTMLVideoElement, event: string, signal?: AbortSignal, timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const finish = (came: boolean) => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      resolve(came);
    };
    const onEvent = () => finish(true);
    const failed = () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      signal?.removeEventListener('abort', aborted);
      reject(new Error('This recording could not be read. Use an MP4 or MOV file.'));
    };
    const aborted = () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener('error', failed);
      reject(abortError());
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/** Moves the video to `t`. Resolves true once it got there, false when it didn't say so in time. */
async function seekTo(video: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<boolean> {
  const target = Math.min(Math.max(0, t), Math.max(0, (video.duration || 0) - 0.001));
  if (Math.abs(video.currentTime - target) < 1 / 240 && video.readyState >= 2) return true;
  const seeked = waitFor(video, 'seeked', signal, 1500);
  video.currentTime = target;
  return seeked;
}

/** The page can't be seen: a hidden or fully covered window, a minimised one, a tab in the background. */
function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Resolves once the page can be seen. Nothing is read while it can't: there
 * WebKit can stop answering seeks (measured in the desktop app with its window
 * hidden: no 'seeked' for 1.6 s, seek after seek), and a picture drawn then is
 * an old one, so a reading made out of sight found only the new screens.
 */
export function whenSeen(signal?: AbortSignal): Promise<void> {
  if (!pageHidden()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (pageHidden()) return;
      document.removeEventListener('visibilitychange', check);
      signal?.removeEventListener('abort', aborted);
      resolve();
    };
    const aborted = () => {
      document.removeEventListener('visibilitychange', check);
      reject(abortError());
    };
    document.addEventListener('visibilitychange', check);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/**
 * Plays the recording fast from `from` and keeps a frame at each sample time.
 * Resolves false when playing gives too few frames (or none) to go on with,
 * or the page is hidden; the caller then seeks from where this stopped.
 * Exported for the unit tests.
 */
export function readByPlaying(
  video: FrameCallbackVideo,
  reader: Pick<FrameReader, 'luma' | 'thumbUrl'>,
  options: SampleOptions,
  out: SampledRecording,
  from: number
): Promise<boolean> {
  const { start, end, step, signal, onProgress } = options;
  const thumbEvery = options.thumbEvery ?? 1;
  const keptFrames = out.frames.length;
  const keptThumbs = out.thumbs.length;
  return new Promise((resolve, reject) => {
    let next = from;
    let nextThumb = keptThumbs ? start + out.thumbs[keptThumbs - 1].t + thumbEvery : from;
    let handle = 0;
    let lastFrameAt = performance.now();
    let finished = false;
    const finish = (value: boolean | Error) => {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      if (handle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
      video.pause();
      signal?.removeEventListener('abort', onAbort);
      document.removeEventListener('visibilitychange', onHidden);
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const onAbort = () => finish(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    // The page hidden: playing stops here, and the caller seeks on from here once the page is seen.
    const onHidden = () => {
      if (pageHidden()) finish(false);
    };
    document.addEventListener('visibilitychange', onHidden);
    const watchdog = setInterval(() => {
      // Nothing came for a while: a hidden tab, or a browser that doesn't play
      // here. The caller carries on by seeking from where this stopped.
      if (performance.now() - lastFrameAt > 1500) finish(false);
    }, 250);
    // Four times the speed, unless the browser hands over too few frames for
    // that. Safari on iPhone calls back about ten times a second whatever the
    // speed, so at four times it would skip most of what happens; then the
    // speed drops until the frames come one sample apart, and the part read so
    // far is read again. Too few even at normal speed (a window macOS has
    // covered gets about two a second), and seeking takes over. A file with
    // gaps of its own (an Android phone records only when the screen changes)
    // calls back quickly across a gap, which is no reason to slow down.
    let rate = 4;
    let windowWall = 0;
    let windowMedia = 0;
    let windowCount = 0;
    let lastWall = 0;
    let lastMedia = -1;
    const restart = () => {
      out.frames.length = keptFrames;
      out.thumbs.length = keptThumbs;
      next = from;
      nextThumb = keptThumbs ? start + out.thumbs[keptThumbs - 1].t + thumbEvery : from;
      lastMedia = -1;
      windowWall = 0;
      windowMedia = 0;
      windowCount = 0;
      video.currentTime = from;
    };
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (finished) return;
      // A frame that comes once the page is hidden, before its visibilitychange: not kept.
      if (pageHidden()) {
        finish(false);
        return;
      }
      lastFrameAt = performance.now();
      const media = metadata.mediaTime;
      if (lastMedia >= 0) {
        windowWall += lastFrameAt - lastWall;
        windowMedia += media - lastMedia;
        windowCount += 1;
        if (windowCount >= 6) {
          const wallGap = windowWall / windowCount;
          const mediaGap = windowMedia / windowCount;
          if (wallGap >= 45 && mediaGap > step * 1.5) {
            if (rate <= 1) {
              // Too few frames even at normal speed: seeking reads it better.
              restart();
              finish(false);
              return;
            }
            rate = Math.max(1, Math.round(rate * (step / mediaGap) * 1.3 * 4) / 4);
            video.playbackRate = rate;
            restart();
            handle = video.requestVideoFrameCallback!(onFrame);
            return;
          }
          windowWall = 0;
          windowMedia = 0;
          windowCount = 0;
        }
      }
      lastWall = lastFrameAt;
      lastMedia = media;
      if (media + step * 0.5 >= next) {
        // A phone that records only when the screen changes (most Android
        // phones) leaves gaps: nothing changed there, so the last frame
        // stands in for the samples it skipped, and a still stretch reads as still.
        const last = out.frames[out.frames.length - 1];
        while (last && next + step * 0.5 < media) {
          out.frames.push({ ...last, t: next - start });
          next += step;
        }
        out.frames.push(reader.luma(media - start));
        if (media + step * 0.5 >= nextThumb) {
          out.thumbs.push({ t: media - start, url: reader.thumbUrl() });
          nextThumb += thumbEvery;
        }
        while (next <= media + step * 0.5) next += step;
        onProgress?.(Math.min(1, (media - start) / Math.max(0.001, end - start)));
      }
      if (media >= end - 1e-3 || video.ended) {
        finish(true);
        return;
      }
      handle = video.requestVideoFrameCallback!(onFrame);
    };
    if (pageHidden()) {
      finish(false);
      return;
    }
    handle = video.requestVideoFrameCallback!(onFrame);
    video.addEventListener('ended', () => finish(true), { once: true });
    video.playbackRate = rate;
    video.play().catch(() => finish(false));
  });
}

/** Seeks to each sample time from `from` on and keeps its frame. How long each seek took goes into `seekMs`, when given. */
/** Exported for the unit tests. */
export async function readBySeeking(
  video: FrameCallbackVideo,
  reader: Pick<FrameReader, 'luma' | 'thumbUrl'>,
  options: SampleOptions,
  out: SampledRecording,
  from: number,
  until = Infinity,
  seekMs?: number[]
): Promise<number> {
  const { start, end, step, signal, onProgress } = options;
  const thumbEvery = options.thumbEvery ?? 1;
  let nextThumb = out.thumbs.length ? start + out.thumbs[out.thumbs.length - 1].t + thumbEvery : start;
  let t = from;
  while (t <= end + 1e-6 && t < until - 1e-6) {
    if (signal?.aborted) throw abortError();
    await whenSeen(signal);
    const asked = performance.now();
    await seekTo(video, t, signal);
    // Hidden while the seek was on its way, even if it landed (WebKit has handed
    // over a picture 136 ms after the page hid): nothing drawn now is kept, and
    // the time says nothing about seeking. The same sample is read again once the page is seen.
    if (pageHidden()) continue;
    seekMs?.push(performance.now() - asked);
    out.frames.push(reader.luma(t - start));
    if (t >= nextThumb - 1e-6) {
      out.thumbs.push({ t: t - start, url: reader.thumbUrl() });
      nextThumb += thumbEvery;
    }
    onProgress?.(Math.min(1, (t - start) / Math.max(0.001, end - start)));
    t += step;
  }
  return t;
}

/** A seek this quick or quicker makes seeking every sample faster than playing (WebKit seeks in about 6 ms). */
const QUICK_SEEK_MS = 25;

/** How different two small grey frames are: the mean difference of their pixels, 0 to 255. */
function frameDifference(a: LumaFrame, b: LumaFrame): number {
  const n = Math.min(a.data.length, b.data.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / n;
}

/**
 * Whether the frames that playing gave (from `from` in `out.frames`) are true.
 * Where a browser hands over a playing video's old picture again and again
 * (the desktop app did with slow seeks: 177 of 186 frames the same, across a
 * tap and a new screen), most frames match the one before. Then six of them
 * are drawn again by seeking, which gives the true picture, and more than
 * one that differs means playing can't be trusted here. A recording that is
 * still where the six fall passes, and its frames are right anyway.
 * Exported for the unit tests.
 */
export async function playedTrue(
  video: FrameCallbackVideo,
  reader: Pick<FrameReader, 'luma'>,
  options: SampleOptions,
  out: SampledRecording,
  from: number
): Promise<boolean> {
  const played = out.frames.slice(from);
  if (played.length < 12) return true;
  let same = 0;
  for (let i = 1; i < played.length; i++) if (frameDifference(played[i], played[i - 1]) === 0) same += 1;
  if (same / (played.length - 1) < 0.5) return true;
  const checks = 6;
  let wrong = 0;
  for (let k = 0; k < checks; k++) {
    const frame = played[Math.min(played.length - 1, Math.floor(((k + 0.5) * played.length) / checks))];
    await whenSeen(options.signal);
    await seekTo(video, options.start + frame.t, options.signal);
    // Hidden as the seek landed: this one is drawn again once the page is seen.
    if (pageHidden()) {
      k -= 1;
      continue;
    }
    if (frameDifference(reader.luma(frame.t), frame) > 2) wrong += 1;
  }
  return wrong < 2;
}

/**
 * Whether seeking reads a recording better than playing it, from how long
 * the first seeks took. The middle one counts, so one slow seek can't decide.
 * Only the seeks are timed: the first picture drawn from a video can take a
 * second on its own (1003 ms in the desktop app, then 3 to 15 ms), which says
 * nothing about seeking, and counted in, it once sent the desktop app to
 * playing, which there draws the same picture over and over.
 */
export function seeksAreQuick(seekMs: number[]): boolean {
  if (!seekMs.length) return true;
  const sorted = [...seekMs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const middle = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return middle <= QUICK_SEEK_MS;
}

/**
 * Small grey frames and a picture strip from part of a recording. `url` is
 * an object URL or a public path.
 *
 * The first few samples are read by seeking, and timed: where a seek is quick
 * (Safari, the desktop app), seeking reads every sample, exactly one step
 * apart; where it's slow (Chromium starts again from a keyframe each time),
 * playing reads the rest, and seeking only takes over if playing stalls.
 */
export async function sampleRecording(url: string, options: SampleOptions): Promise<SampledRecording> {
  const { start, step, signal } = options;
  const video = hiddenVideo() as FrameCallbackVideo;
  const out: SampledRecording = { frames: [], thumbs: [] };
  try {
    await whenSeen(signal);
    await loadVideo(video, url, signal);
    if (!video.videoWidth) throw new Error('This recording could not be read. Use an MP4 or MOV file.');
    const reader = new FrameReader(video, options.maxSide ?? 160, options.thumbHeight ?? 112);
    await seekTo(video, start, signal);
    const seekMs: number[] = [];
    let t = await readBySeeking(video, reader, options, out, start, start + step * 6, seekMs);
    if (!seeksAreQuick(seekMs) && typeof video.requestVideoFrameCallback === 'function') {
      await seekTo(video, t, signal);
      const playedFrom = out.frames.length;
      const thumbsFrom = out.thumbs.length;
      const done = await readByPlaying(video, reader, options, out, t);
      if (!(await playedTrue(video, reader, options, out, playedFrom))) {
        // Playing drew old pictures: the same part is read again by seeking, slower but true.
        out.frames.length = playedFrom;
        out.thumbs.length = thumbsFrom;
      } else if (done) {
        options.onProgress?.(1);
        return out;
      } else {
        t = out.frames.length ? start + out.frames[out.frames.length - 1].t + step : start;
      }
    }
    await readBySeeking(video, reader, options, out, t);
    options.onProgress?.(1);
    return out;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}
