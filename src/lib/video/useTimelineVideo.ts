"use client";
// Binds a <video> on the canvas to the artboard's playback clock.
//
// Idle (nothing playing on this board) the recording keeps the behaviour it
// has always had: muted, looping, autoplaying, so a mockup never sits on a
// frozen frame while you design. Once the board is previewing, the clock owns
// it: the recording starts at trimStart, stops at trimEnd, pauses when the
// transport pauses, and jumps back with the loop. Trim math is the export's
// (videoExport.sourceTimeAt), so the preview and the MP4 show the same frames.

import { useEffect, type RefObject } from 'react';
import { usePlaybackRunning, usePlaybackTime } from './playback';

// How far the element may drift from the timeline before it is re-seeked. A
// playing <video> advances on its own clock, so small drift is normal and
// correcting it every frame would stutter; a loop or a scrub blows past this.
const RESYNC_THRESHOLD_SECONDS = 0.25;

export interface TimelineVideoTrim {
  trimStart?: number;
  trimEnd?: number;
  durationSeconds?: number;
}

export function useTimelineVideo(
  ref: RefObject<HTMLVideoElement | null>,
  trim: TimelineVideoTrim,
  artboardId: string | null | undefined
) {
  const time = usePlaybackTime(artboardId);
  const running = usePlaybackRunning(artboardId);
  const previewing = time !== null;
  const { trimStart, trimEnd, durationSeconds } = trim;

  // Ownership handover in both directions.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (previewing) {
      video.loop = false;
      return;
    }
    video.loop = true;
    void video.play().catch(() => {
      // Autoplay can be refused (rare for muted inline video); the poster
      // frame is a fine fallback.
    });
  }, [previewing, ref]);

  useEffect(() => {
    const video = ref.current;
    if (!video || time === null) return;
    const start = trimStart ?? 0;
    const sourceEnd = trimEnd ?? (Number.isFinite(video.duration) ? video.duration : durationSeconds ?? 0);
    const playable = Math.max(0, sourceEnd - start);
    const target = start + (playable > 0 ? Math.min(time, playable) : time);

    if (Math.abs(video.currentTime - target) > RESYNC_THRESHOLD_SECONDS) {
      try {
        video.currentTime = target;
      } catch {
        // Seeking before metadata lands throws; the next frame retries.
      }
    }

    if (running) {
      if (video.paused) void video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  }, [time, running, trimStart, trimEnd, durationSeconds, ref]);
}
