// A film to an MP4 file, in the browser: each frame is drawn by a stage of
// its own at the file's size, the words go on top, and WebCodecs encodes it.
// The same H.264 and AAC set-up as the App Preview export (videoExport.ts).
//
// It draws one frame at a time and waits for the encoder when it falls
// behind, so it never holds more than a few frames in memory, and the page
// stays responsive between frames.

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { getMediaUrl } from '@/lib/mediaStore';
import { createAudioTrack, mixAudio, pickEncoderConfig } from '@/lib/video/videoExport';
import type { VideoElementProps } from '@/types/artboard';
import { filmDuration, recordingTime, stageFrameAt } from './frame';
import { finishFor, planFor } from './film';
import { backdropFor } from './looks';
import { drawOverlay } from './overlay';
import { DirectorStage } from './stage';
import { hiddenVideo, loadVideo } from './video';
import type { Film, FilmFormat } from './types';

export interface FilmSize {
  width: number;
  height: number;
}

/** The file sizes for each picture shape: full HD on the long side. */
export const FILM_SIZES: Record<FilmFormat, FilmSize> = {
  vertical: { width: 1080, height: 1920 },
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

export interface ExportOptions {
  fps?: 30 | 60;
  /** Bits a second; 10 Mbps by default at 30 fps. */
  bitrate?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Why this browser can't make the file, or null when it can. */
export function exportBlocker(): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return "This browser can't make video files. Use the desktop app, Chrome, Edge or Safari 16.4 or later.";
  }
  return null;
}

function stopped(): DOMException {
  return new DOMException('Stopped', 'AbortError');
}

/** How long the encoder may take no frames before the export gives up. */
const STALL_MS = 10_000;
const STALLED = "This device stopped making the video partway. Try again, or export on a computer.";

/** `promise`, or an error after `ms`, or a stop when `signal` aborts. */
function withLimit<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(STALLED)), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(stopped());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/**
 * Two frames through an encoder set up like the real one, before any work:
 * some browsers report an H.264 encoder that never hands anything back (the
 * iOS Simulator's Safari does, measured on iOS 26.5), and that should be a
 * clear message at once rather than an export stuck at its first frame.
 */
async function checkEncoder(config: VideoEncoderConfig, canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void> {
  let outputs = 0;
  let failure: unknown = null;
  const probe = new VideoEncoder({ output: () => (outputs += 1), error: (e) => (failure = e) });
  try {
    probe.configure(config);
    for (let i = 0; i < 2; i++) {
      const frame = new VideoFrame(canvas, { timestamp: i * 33_333, duration: 33_333 });
      probe.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }
    await withLimit(probe.flush(), 4000, signal).catch((error) => {
      if ((error as { name?: string })?.name === 'AbortError') throw error;
    });
    if (failure || outputs === 0) {
      throw new Error("This browser can't make video files on this device. Export on a computer, or in the desktop app.");
    }
  } finally {
    try {
      if (probe.state !== 'closed') probe.close();
    } catch {
      // already closed
    }
  }
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

/** Seeks and waits until the new frame can be drawn. */
async function showFrame(video: FrameCallbackVideo, t: number): Promise<void> {
  const target = Math.min(Math.max(0, t), Math.max(0, (video.duration || 0) - 0.001));
  if (Math.abs(video.currentTime - target) < 1 / 480 && video.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => {
      // The frame is decoded at 'seeked' in Chromium; WebKit can hand the old
      // one to WebGL until the new one is shown, so wait for that when we can.
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(finish);
        setTimeout(finish, 120);
      } else finish();
    };
    // A seek that never answers (some files) gives a stale frame, not a hung export.
    const timer = setTimeout(finish, 1500);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = target;
  });
}

export async function exportFilm(film: Film, options: ExportOptions = {}): Promise<Blob> {
  const blocker = exportBlocker();
  if (blocker) throw new Error(blocker);
  const { signal, onProgress } = options;
  const fps = options.fps ?? film.fps;
  const size = FILM_SIZES[film.format];
  const width = Math.floor(size.width / 2) * 2;
  const height = Math.floor(size.height / 2) * 2;
  const bitrate = options.bitrate ?? (fps === 60 ? 16_000_000 : 10_000_000);
  const duration = filmDuration(film);
  const total = Math.max(1, Math.round(duration * fps));
  const plan = planFor(film);
  const backdrop = backdropFor(film.look);

  const url = await getMediaUrl(film.source.mediaId);
  if (!url) throw new Error('The recording is no longer on this device. Add it again.');

  const video = hiddenVideo() as FrameCallbackVideo;

  const glCanvas = document.createElement('canvas');
  let stage: DirectorStage | null = null;
  let encoder: VideoEncoder | null = null;
  try {
    await loadVideo(video, url, signal);
    if (signal?.aborted) throw stopped();

    stage = new DirectorStage(glCanvas);
    stage.setSize(width, height, 1);
    stage.setLook(backdrop);
    stage.setPhone(film.phone.deviceType, finishFor(film.phone.deviceType, film.phone.finish, film.look));
    stage.setScreen({ image: video, width: video.videoWidth, height: video.videoHeight });

    const composite = document.createElement('canvas');
    composite.width = width;
    composite.height = height;
    const ctx = composite.getContext('2d');
    if (!ctx) throw new Error('Could not make a drawing surface for the video.');

    const config = await pickEncoderConfig(width, height, fps, bitrate);
    const mix = film.sound.recording
      ? await mixAudio(
          [],
          [{ el: { mediaId: film.source.mediaId, name: film.source.name, volume: 1 } as VideoElementProps, trimStart: film.trim.start, trimEnd: film.trim.end }],
          duration
        )
      : null;
    const audio = await createAudioTrack(duration, mix);
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height },
      ...(audio ? { audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } } : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    await checkEncoder(config, composite, signal);
    let failure: Error | null = null;
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        failure = e instanceof Error ? e : new Error(String(e));
      },
    });
    encoder.configure(config);
    const audioDone = audio ? audio.encodeInto(muxer) : Promise.resolve();

    onProgress?.(0, total);
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw stopped();
      if (failure) throw failure;
      const t = i / fps;
      await showFrame(video, recordingTime(film, t));
      stage.screenChanged();
      stage.render(stageFrameAt(film, plan, t));
      ctx.drawImage(glCanvas, 0, 0, width, height);
      drawOverlay(ctx, width, height, t, plan.cues, film.format, backdrop);
      const frame = new VideoFrame(composite, { timestamp: Math.round((i * 1_000_000) / fps), duration: Math.round(1_000_000 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // Wait for the encoder when it falls behind, but never for ever: an
      // encoder that stops taking frames ends the export with a message.
      let waitedSince = 0;
      let queue = encoder.encodeQueueSize;
      while (encoder.encodeQueueSize > 3) {
        await new Promise((resolve) => setTimeout(resolve, 4));
        if (signal?.aborted) throw stopped();
        if (failure) throw failure;
        const now = performance.now();
        if (encoder.encodeQueueSize < queue) {
          queue = encoder.encodeQueueSize;
          waitedSince = now;
        } else if (!waitedSince) waitedSince = now;
        else if (now - waitedSince > STALL_MS) throw new Error(STALLED);
      }
      onProgress?.(i + 1, total);
    }
    await withLimit(encoder.flush(), 20_000, signal);
    if (failure) throw failure;
    // A sound encoder that stops answering costs the sound, never the video.
    await withLimit(audioDone, 20_000, signal).catch((error) => {
      if ((error as { name?: string })?.name === 'AbortError') throw error;
      console.error('The sound track did not finish', error);
    });
    muxer.finalize();
    return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
  } finally {
    try {
      if (encoder && encoder.state !== 'closed') encoder.close();
    } catch {
      // already closed
    }
    if (stage) {
      stage.dispose();
      stage.loseContext();
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

/** A file name for a film's video. */
export function filmFileName(film: Film): string {
  const base = film.name.trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, ' ').trim() || 'Film';
  return `${base}.mp4`;
}
