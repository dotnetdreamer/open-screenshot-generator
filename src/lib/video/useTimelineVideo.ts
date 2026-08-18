"use client";
// Binds a <video> on the canvas to the artboard's playback clock.
//
// Idle (nothing playing on this board) the recording loops muted so a mockup
// never sits on a frozen frame while you design, but only while it can be
// seen: a playing <video> holds a live hardware decode pipeline (tens of MB
// each in WebKit), and every board decoding forever offscreen is standing
// memory pressure that helps get the macOS WKWebView killed (issue #19).
// Out of sight, the video pauses and its current frame stands in as the
// poster. Once the board is previewing, the clock owns it: the recording
// starts at trimStart, stops at trimEnd, pauses when the transport pauses,
// and jumps back with the loop. Trim math is the export's
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
  artboardId: string | null | undefined,
  // The resolved source. A dependency because media-store recordings mount
  // their <video> only after the blob URL arrives; without it this effect
  // would run once against a null ref and the recording would never start
  // (the autoplay attribute used to paper over that).
  src?: string
) {
  const time = usePlaybackTime(artboardId);
  const running = usePlaybackRunning(artboardId);
  const previewing = time !== null;
  const { trimStart, trimEnd, durationSeconds } = trim;

  // Ownership handover in both directions, plus the idle visibility gate.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (previewing) {
      video.loop = false;
      return;
    }
    video.loop = true;

    // Idle playback runs only while the element is near the viewport and the
    // tab is shown; otherwise pause and keep the current frame on screen.
    let nearViewport = false;
    const sync = () => {
      if (nearViewport && document.visibilityState === 'visible') {
        if (video.paused) {
          void video.play().catch(() => {
            // Autoplay can be refused (rare for muted inline video); the
            // poster frame is a fine fallback.
          });
        }
      } else if (!video.paused) {
        video.pause();
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      // No observer (old engines, bare test DOMs): the old always-play idle.
      nearViewport = true;
      sync();
      return;
    }

    // 300px of margin so a recording is already rolling by the time it
    // scrolls into view, instead of visibly starting up at the edge.
    const observer = new IntersectionObserver(
      (entries) => {
        nearViewport = entries[entries.length - 1]?.isIntersecting ?? false;
        sync();
      },
      { rootMargin: '300px', threshold: 0 }
    );
    observer.observe(video);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [previewing, ref, src]);

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
    // src for the same reason as the idle effect: a recording that resolves
    // mid-preview mounts its <video> late, and a paused transport would
    // otherwise leave it un-seeked at frame 0 until the next play or scrub.
  }, [time, running, trimStart, trimEnd, durationSeconds, ref, src]);
}
