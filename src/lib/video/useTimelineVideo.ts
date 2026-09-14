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
//
// Sound: idle, every recording is muted. A recording with keepAudio is heard
// only while its own board's transport is running, and only until its trim
// runs out, which is also where the export mix stops it. Copies rendered
// without a board (the preview dialog, thumbnails) never preview, so they
// never make a noise.

import { useEffect, useRef, type RefObject } from 'react';
import { usePlaybackRunning, usePlaybackTime } from './playback';

// How far the element may drift from the timeline before it is re-seeked. A
// playing <video> advances on its own clock, so small drift is normal and
// correcting it every frame would stutter; a loop or a scrub blows past this.
const RESYNC_THRESHOLD_SECONDS = 0.25;

export interface TimelineVideoTrim {
  trimStart?: number;
  trimEnd?: number;
  durationSeconds?: number;
  keepAudio?: boolean;
  volume?: number;
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
  const { trimStart, trimEnd, durationSeconds, keepAudio, volume } = trim;
  // Set when the browser refused to play this recording with sound, so the
  // effect does not unmute it again on every frame. Cleared by the next press
  // of play, which is a user gesture.
  const soundRefused = useRef(false);

  // Ownership handover in both directions, plus the idle visibility gate.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (previewing) {
      video.loop = false;
      return;
    }
    video.loop = true;
    video.muted = true;

    // Idle playback runs only while the element is near the viewport and the
    // tab is shown; otherwise pause and keep the current frame on screen.
    let nearViewport = false;
    const sync = () => {
      if (nearViewport && document.visibilityState === 'visible') {
        if (video.paused) {
          void video.play().catch(() => {
            // Autoplay can be refused; the poster frame is a fine fallback.
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
    // A trim end past the end of the file stops at the file, as the export does.
    const fileEnd = Number.isFinite(video.duration) ? video.duration : durationSeconds;
    const sourceEnd = Math.min(trimEnd ?? Infinity, fileEnd || Infinity);
    const playable = Number.isFinite(sourceEnd) ? Math.max(0, sourceEnd - start) : 0;
    const target = start + (playable > 0 ? Math.min(time, playable) : time);
    // Past the trim the picture holds its last frame, and the sound stops.
    const holding = playable > 0 && time >= playable;
    if (!running) soundRefused.current = false;
    const audible = running && !!keepAudio && !holding && !soundRefused.current;
    video.volume = Math.max(0, Math.min(1, volume ?? 1));
    if (video.muted === audible) {
      const wasPlaying = !video.paused;
      video.muted = !audible;
      // Chromium and WebKit pause a playing video on the spot when it is
      // unmuted without a user gesture. A paused one finds out from play().
      if (audible && wasPlaying && video.paused) {
        soundRefused.current = true;
        video.muted = true;
      }
    }

    if (Math.abs(video.currentTime - target) > RESYNC_THRESHOLD_SECONDS) {
      try {
        video.currentTime = target;
      } catch {
        // Seeking before metadata lands throws; the next frame retries.
      }
    }

    if (running && !holding) {
      if (video.paused) {
        void video.play().catch((error: unknown) => {
          // Sound refused without a user gesture. Pressing play is one, so
          // this only happens when playback started some other way; the
          // picture still runs, muted. An AbortError is a pause or a new
          // source cutting in, not a refusal.
          if (!video.muted && (error as DOMException | undefined)?.name === 'NotAllowedError') {
            soundRefused.current = true;
            video.muted = true;
            void video.play().catch(() => {});
          }
        });
      }
    } else if (!video.paused) {
      // Paused, or holding the last frame: a play() here would restart an
      // ended recording from the top and the resync would drag it back.
      video.pause();
    }
    // src for the same reason as the idle effect: a recording that resolves
    // mid-preview mounts its <video> late, and a paused transport would
    // otherwise leave it un-seeked at frame 0 until the next play or scrub.
  }, [time, running, trimStart, trimEnd, durationSeconds, keepAudio, volume, ref, src]);
}
