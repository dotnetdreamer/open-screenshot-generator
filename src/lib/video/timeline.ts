// How long an artboard's App Preview timeline runs, computed synchronously
// from what is already on the elements.
//
// videoExport.analyzeArtboardForVideo answers the same question but has to
// await the media table for a recording's duration, which a render pass cannot
// do. Uploads write durationSeconds onto the element, so the numbers agree;
// when they cannot (an old project whose element never got probed) the
// recording simply does not extend the timeline here.

import type { ArtboardState } from '@/types/artboard';
import { animationEndTime } from './animation';
import { gestureEndTime } from './gestures';

/** Longest preview the UI will let a board run for. */
export const PREVIEW_DURATION_MAX = 60;

export interface ArtboardTimeline {
  /** Anything with motion: an animation, a gesture hint or a recording. */
  hasMotion: boolean;
  /** Seconds until the last recording/animation/gesture finishes. */
  contentEndSeconds: number;
  /** Playback (and suggested export) length: contentEnd rounded up, 1..30. */
  duration: number;
}

const EMPTY: ArtboardTimeline = { hasMotion: false, contentEndSeconds: 0, duration: 0 };

export function artboardTimeline(ab: ArtboardState | null | undefined): ArtboardTimeline {
  if (!ab) return EMPTY;
  let hasMotion = false;
  let end = 0;

  for (const el of ab.elements) {
    if (el.type === 'video' || el.type === 'video-device') {
      // An empty recording mockup still makes this a preview board: you drop
      // the phone on first, and the timeline has to be there to animate the
      // rest of the layers against it.
      if (el.type === 'video-device') hasMotion = true;
      const hasRecording = !!(el.mediaId || el.videoSrc);
      if (hasRecording) {
        hasMotion = true;
        const duration = el.durationSeconds ?? 0;
        const start = el.trimStart ?? 0;
        const stop = el.trimEnd ?? duration;
        end = Math.max(end, Math.max(0, stop - start));
      }
    } else if (el.type === 'gesture') {
      hasMotion = true;
      // A looping gesture plays for as long as the board does, so it never
      // decides the length on its own.
      if (!el.gestureRepeat) end = Math.max(end, gestureEndTime(el));
    }
    if (el.animation) {
      hasMotion = true;
      end = Math.max(end, animationEndTime(el.animation));
    }
  }

  // An explicit length on the board wins: a preview can be stretched past what
  // its content needs (dead air at the end is a legitimate edit) or cut short.
  const override = ab.previewDurationSeconds;
  const duration =
    override !== undefined && override > 0
      ? Math.min(PREVIEW_DURATION_MAX, Math.max(1, override))
      : Math.min(30, Math.max(1, Math.ceil(end) || 15));

  return {
    hasMotion: hasMotion || override !== undefined,
    contentEndSeconds: end,
    duration: hasMotion || override !== undefined ? duration : 0,
  };
}
