"use client";
// A screen recording's own sound: whether the file has any, and the decoded
// audio for the export mix.
//
// MP4 and MOV go through mp4Audio.ts, which reads only the sound packets in
// the trimmed range. Anything else (WebM) is handed to decodeAudioData whole,
// which Chromium and WebKit both manage for WebM.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getMediaAsset, getMediaRevision, subscribeMedia } from '@/lib/mediaStore';
import { withBasePath } from '@/lib/basePath';
import { Mp4AudioError, decodeMp4Audio, probeMp4Audio } from './mp4Audio';

/** Decoded sound plus where to start playing it, as `source.start(when + lead, offset, duration)` takes it. */
export interface RecordingAudio {
  buffer: AudioBuffer;
  offset: number;
  lead: number;
  /** Seconds to play, or null to play to the end of the buffer. */
  duration: number | null;
}

/**
 * True when the recording has a sound track, false when it has none, null when
 * the container cannot be read without decoding it (WebM).
 */
export async function recordingHasSound(blob: Blob): Promise<boolean | null> {
  try {
    // A declared track with no samples is a writer that never got any audio.
    return (await probeMp4Audio(blob)).some((track) => track.sampleCount > 0);
  } catch {
    return null;
  }
}

/**
 * keepAudio for a file uploaded onto a recording layer. A layer that had no
 * recording yet keeps the new file's sound. A layer that already had one keeps
 * its own setting, and unset stays unset: that layer was made before sound was
 * kept, maybe with its audio already pulled out into a sound layer, and in a
 * translated view a write here would reach the base language's recording too.
 */
export function uploadKeepsAudio(el: { keepAudio?: boolean; mediaId?: string; videoSrc?: string }): boolean | undefined {
  if (el.keepAudio !== undefined) return el.keepAudio;
  return el.mediaId || el.videoSrc ? undefined : true;
}

/** Probes of stored files, per media id. A row that is not here yet is never cached. */
const soundProbeCache = new Map<string, Promise<boolean | null>>();

/**
 * Whether a stored recording has sound, for the properties panel. Undefined
 * while it is being read or when there is no stored file. Reads only the file's
 * headers, and looks again when a row arrives from a live session.
 */
export function useRecordingHasSound(mediaId: string | undefined): boolean | null | undefined {
  const [state, setState] = useState<boolean | null | undefined>(undefined);
  const revision = useSyncExternalStore(subscribeMedia, getMediaRevision, () => 0);
  useEffect(() => {
    setState(undefined);
    if (!mediaId) return;
    let cancelled = false;
    const cached = soundProbeCache.get(mediaId);
    const probe = cached
      ? cached
      : getMediaAsset(mediaId).then((asset) => {
          if (!asset) return undefined;
          const result = recordingHasSound(asset.blob);
          soundProbeCache.set(mediaId, result);
          return result;
        });
    probe
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => {
        if (!cancelled) setState(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaId, revision]);
  return state;
}

/** The recording's file: its media row, or the URL a template carries. Null when neither resolves. */
export async function loadRecordingBlob(el: { mediaId?: string; videoSrc?: string }): Promise<Blob | null> {
  if (el.mediaId) return (await getMediaAsset(el.mediaId))?.blob ?? null;
  if (el.videoSrc) {
    const response = await fetch(withBasePath(el.videoSrc));
    return response.ok ? await response.blob() : null;
  }
  return null;
}

/**
 * Largest MP4 or MOV read whole when mp4Audio cannot slice its sound (PCM,
 * ALAC). Bigger than this, the copy alone is issue #19, and WebKit rejects a
 * QuickTime file there anyway.
 */
const MAX_WHOLE_FILE_BYTES = 64 * 1024 * 1024;

/**
 * The recording's sound between file seconds [start, end), decoded at
 * `context`'s sample rate. Null when the file has no sound. Throws when it has
 * sound that cannot be read, so an export never quietly loses it.
 */
export async function decodeRecordingAudio(
  blob: Blob,
  context: BaseAudioContext,
  start: number,
  end: number
): Promise<RecordingAudio | null> {
  let notMp4 = false;
  try {
    const decoded = await decodeMp4Audio(blob, context, start, end);
    if (!decoded) return null;
    return decoded;
  } catch (error) {
    // Not an MP4 at all, or a codec ADTS cannot carry (PCM, ALAC): the browser
    // may still decode the whole file. Anything else is a real failure.
    if (!(error instanceof Mp4AudioError) || error.code === 'truncated') throw error;
    notMp4 = error.code === 'not-mp4';
    if (!notMp4 && blob.size > MAX_WHOLE_FILE_BYTES) throw error;
  }
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return { buffer, offset: start, lead: 0, duration: Number.isFinite(end) ? Math.max(0, end - start) : null };
  } catch (error) {
    // A WebM with no sound fails exactly like a broken one, and there is no
    // cheap way to tell them apart. Silence is the likelier truth.
    if (notMp4) {
      console.warn('Recording sound could not be decoded; exporting without it.', error);
      return null;
    }
    throw error;
  }
}
