"use client";
// Binds a sound layer's <audio> to the artboard's playback clock.
//
// Unlike a recording there is no idle loop: a sound only plays while its board
// is previewing and the transport is running, and only between the second it
// comes in at and the end of its trim. Scrubbing a paused board seeks it
// without making a noise. The clip math is lib/video/audio.ts, shared with the
// export mix, so the preview and the MP4 line up.

import { useEffect, type RefObject } from 'react';
import type { AudioElementProps } from '@/types/artboard';
import { audioClipRange } from './audio';
import { usePlaybackRunning, usePlaybackTime } from './playback';

// Same tolerance as useTimelineVideo: a playing element keeps its own clock,
// and re-seeking on every frame would stutter.
const RESYNC_THRESHOLD_SECONDS = 0.25;

export function useTimelineAudio(
  ref: RefObject<HTMLAudioElement | null>,
  element: AudioElementProps,
  artboardId: string | null | undefined,
  // The resolved source, so the effect runs again once the blob URL arrives.
  src?: string
) {
  const time = usePlaybackTime(artboardId);
  const running = usePlaybackRunning(artboardId);
  const { mediaId, startTime, trimStart, trimEnd, durationSeconds, volume } = element;

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, volume ?? 1));

    const range = audioClipRange(element);
    const inClip = time !== null && !!range && time >= range.start && time < range.end;
    if (time === null || !range || !inClip) {
      if (!audio.paused) audio.pause();
      return;
    }

    const target = range.sourceStart + (time - range.start);
    if (Math.abs(audio.currentTime - target) > RESYNC_THRESHOLD_SECONDS) {
      try {
        audio.currentTime = target;
      } catch {
        // Seeking before metadata lands throws; the next tick retries.
      }
    }
    if (running) {
      if (audio.paused) {
        void audio.play().catch(() => {
          // Refused without a user gesture. Pressing play is one, so this only
          // happens when playback was started some other way.
        });
      }
    } else if (!audio.paused) {
      audio.pause();
    }
    // `element` is read only for the fields listed, which are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, running, mediaId, startTime, trimStart, trimEnd, durationSeconds, volume, ref, src]);

  // A layer that unmounts mid-preview (deleted, board switched) must go quiet.
  useEffect(() => {
    const audio = ref.current;
    return () => {
      audio?.pause();
    };
  }, [ref, src]);
}
