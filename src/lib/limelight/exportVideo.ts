/**
 * A Limelight scene as an MP4.
 *
 * Every frame is drawn by the stage at the video's own size, at exactly
 * n / fps seconds: `sceneAt` is a pure function of the time, so nothing is
 * dropped or doubled however slow the computer is, and frame n is the same
 * picture the preview shows at that moment. Frames are encoded with
 * WebCodecs' VideoEncoder and muxed by mp4-muxer, the pair the editor's App
 * Preview export uses (src/lib/video/videoExport.ts), with its choice of
 * H.264 profile. Every video gets an AAC track: the scene's music when it
 * has some and the browser has an AAC encoder, otherwise silence written
 * without an AudioEncoder, so no browser leaves the track out: App Store
 * Connect turns down a preview without a sound track.
 *
 * The stage holds the scene for the length of the export: the dialog keeps
 * the user's hands off it, but an agent's edit can still arrive, and it
 * waits on the stage until the last frame is drawn.
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, createAudioTrack, pickEncoderConfig, silentAudioTrack, storeCodecCandidatesFor, type AudioTrack } from '@/lib/video/videoExport';
import { formatPresetById } from './presets';
import type { LimelightStage } from './stage/stage';
import type { LimelightScene } from './types';

export class ExportStopped extends Error {
  constructor() {
    super('The export was stopped');
  }
}

export interface VideoExportOptions {
  /** Frames drawn so far, of how many. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** True when this browser can encode H.264 video. */
export function canExportVideo(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Bits a second for a picture of this size: 0.12 bits a pixel a frame, which
 * keeps phone screens sharp in motion, between 6 and 40 Mbit/s.
 */
export function bitrateFor(width: number, height: number, fps: number): number {
  return Math.round(Math.min(40_000_000, Math.max(6_000_000, width * height * fps * 0.12)));
}

/** How many frames a scene has: its length at its frame rate, rounded, at least one. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.round(duration * fps));
}

/**
 * The scene's music as an AAC track `seconds` long, at its volume, or null
 * when it has none or this browser can't encode AAC. Whole AAC frames only,
 * so the sound never runs past the picture.
 */
async function musicTrack(scene: LimelightScene, seconds: number): Promise<AudioTrack | null> {
  if (!scene.music) return null;
  try {
    const { renderSceneMusic } = await import('./musicRender');
    const music = await renderSceneMusic(scene, AUDIO_SAMPLE_RATE);
    if (!music) return null;
    const whole = (Math.floor((seconds * AUDIO_SAMPLE_RATE) / 1024) * 1024) / AUDIO_SAMPLE_RATE;
    const volume = scene.music.volume;
    const mix = Array.from({ length: AUDIO_CHANNELS }, (_, c) => {
      const channel = music.getChannelData(Math.min(c, music.numberOfChannels - 1));
      const out = new Float32Array(Math.ceil(whole * AUDIO_SAMPLE_RATE));
      for (let i = 0; i < out.length && i < channel.length; i++) out[i] = channel[i] * volume;
      return out;
    });
    return await createAudioTrack(whole, mix);
  } catch (error) {
    console.warn('Limelight could not add the music to the video', error);
    return null;
  }
}

export async function exportSceneVideo(stage: LimelightStage, scene: LimelightScene, options: VideoExportOptions = {}): Promise<Blob> {
  if (!canExportVideo()) throw new Error("This browser can't make videos. Use the desktop app, Chrome or Edge.");
  const { width, height, fps, duration } = scene.format;
  const store = !!formatPresetById(scene.format.preset)?.rules;
  const frames = frameCount(duration, fps);
  const config = await pickEncoderConfig(width, height, fps, bitrateFor(width, height, fps), store ? storeCodecCandidatesFor(width, height) : undefined);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    audio: { codec: 'aac', numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_SAMPLE_RATE },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  });
  stage.hold(scene);
  try {
    encoder.configure(config);
    // The sound first, out of the frame loop's way.
    await ((await musicTrack(scene, frames / fps)) ?? silentAudioTrack(frames / fps)).encodeInto(muxer);
    for (let i = 0; i < frames; i++) {
      if (options.signal?.aborted) throw new ExportStopped();
      if (failure) throw failure;
      const { pixels } = await stage.renderPixels({ width, height, time: i / fps, keepView: true });
      const frame = new VideoFrame(pixels, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      // A key frame every two seconds, as the editor's export makes them.
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((resolve) => window.setTimeout(resolve, 5));
      options.onProgress?.(i + 1, frames);
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    stage.releaseOutput();
    stage.release();
    stage.invalidate();
  }
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
