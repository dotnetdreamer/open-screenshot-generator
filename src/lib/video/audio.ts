// Where a sound layer sits on an App Preview board's timeline.
//
// The editor preview (useTimelineAudio), the timeline length (timeline.ts) and
// the export mix (videoExport.ts) all read the clip range from here, so what
// you hear while scrubbing is what ends up in the MP4. Kept free of the media
// store so the timeline math stays importable anywhere.

import type { AudioElementProps } from '@/types/artboard';

export interface AudioClipRange {
  /** Second of the preview the sound comes in at. */
  start: number;
  /** Second of the preview the sound stops at. */
  end: number;
  /** Seconds into the file that `start` plays. */
  sourceStart: number;
}

/**
 * Where a sound layer plays on the board's timeline. Null while it has no
 * file, or no known length to place it by.
 */
export function audioClipRange(el: AudioElementProps): AudioClipRange | null {
  if (!el.mediaId) return null;
  const sourceStart = Math.max(0, el.trimStart ?? 0);
  const sourceEnd = el.trimEnd ?? el.durationSeconds ?? 0;
  const length = sourceEnd - sourceStart;
  if (!(length > 0)) return null;
  const start = Math.max(0, el.startTime ?? 0);
  return { start, end: start + length, sourceStart };
}

/** A sound file's name without its extension, for the layer. */
export function soundLayerName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'Sound';
}
