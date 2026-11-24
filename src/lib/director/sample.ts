// Reading small grey frames out of a recording, for analyze.ts, and a strip
// of pictures for the timeline. Browser only.
//
// The recording is played, muted, at four times its speed, and a frame is
// kept each time the one on screen reaches the next sample time
// (requestVideoFrameCallback). Playing decodes each frame once; seeking to
// every sample instead makes the decoder start again from a keyframe each
// time, which is several times slower. Where a browser has no frame callback,
// or playing stalls (a hidden tab), it falls back to seeking.

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

type FrameCallbackVideo = HTMLVideoElement & {
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

function waitFor(video: HTMLVideoElement, event: string, signal?: AbortSignal, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      resolve();
    };
    const failed = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      signal?.removeEventListener('abort', aborted);
      reject(new Error('This recording could not be read. Use an MP4 or MOV file.'));
    };
    const aborted = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener('error', failed);
      reject(abortError());
    };
    const timer = setTimeout(done, timeoutMs);
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

async function seekTo(video: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  const target = Math.min(Math.max(0, t), Math.max(0, (video.duration || 0) - 0.001));
  if (Math.abs(video.currentTime - target) < 1 / 240 && video.readyState >= 2) return;
  const seeked = waitFor(video, 'seeked', signal, 1500);
  video.currentTime = target;
  await seeked;
}

/**
 * Plays the recording fast from `from` and keeps a frame at each sample time.
 * Resolves false when playing gives too few frames (or none) to go on with;
 * the caller then seeks from where this stopped.
 */
function readByPlaying(video: FrameCallbackVideo, reader: FrameReader, options: SampleOptions, out: SampledRecording, from: number): Promise<boolean> {
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
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const onAbort = () => finish(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
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
    handle = video.requestVideoFrameCallback!(onFrame);
    video.addEventListener('ended', () => finish(true), { once: true });
    video.playbackRate = rate;
    video.play().catch(() => finish(false));
  });
}

/** Seeks to each sample time from `from` on and keeps its frame. */
async function readBySeeking(video: FrameCallbackVideo, reader: FrameReader, options: SampleOptions, out: SampledRecording, from: number, until = Infinity): Promise<number> {
  const { start, end, step, signal, onProgress } = options;
  const thumbEvery = options.thumbEvery ?? 1;
  let nextThumb = out.thumbs.length ? start + out.thumbs[out.thumbs.length - 1].t + thumbEvery : start;
  let t = from;
  for (; t <= end + 1e-6 && t < until - 1e-6; t += step) {
    if (signal?.aborted) throw abortError();
    await seekTo(video, t, signal);
    out.frames.push(reader.luma(t - start));
    if (t >= nextThumb - 1e-6) {
      out.thumbs.push({ t: t - start, url: reader.thumbUrl() });
      nextThumb += thumbEvery;
    }
    onProgress?.(Math.min(1, (t - start) / Math.max(0.001, end - start)));
  }
  return t;
}

/** A seek this quick or quicker makes seeking every sample faster than playing (WebKit seeks in about 6 ms). */
const QUICK_SEEK_MS = 25;

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
    await loadVideo(video, url, signal);
    if (!video.videoWidth) throw new Error('This recording could not be read. Use an MP4 or MOV file.');
    const reader = new FrameReader(video, options.maxSide ?? 160, options.thumbHeight ?? 112);
    await seekTo(video, start, signal);
    const began = performance.now();
    let t = await readBySeeking(video, reader, options, out, start, start + step * 6);
    const perSeek = (performance.now() - began) / Math.max(1, out.frames.length);
    if (perSeek > QUICK_SEEK_MS && typeof video.requestVideoFrameCallback === 'function') {
      await seekTo(video, t, signal);
      const done = await readByPlaying(video, reader, options, out, t);
      if (done) {
        options.onProgress?.(1);
        return out;
      }
      t = out.frames.length ? start + out.frames[out.frames.length - 1].t + step : start;
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
