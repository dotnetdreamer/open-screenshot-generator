"use client";
// Live playback of an App Preview timeline ON the canvas, so a preview can be
// watched in the editor instead of exported first and opened in a player.
//
// One board plays at a time. A single rAF loop owns the clock and every
// interested element subscribes to it directly: the artboard component itself
// does NOT re-render per frame, so the elements it hands down keep their
// identity and React skips their subtrees. Only the handful of nodes that
// actually move (the animated element boxes, gesture overlays, the transport
// bar) re-render at 60fps.
//
// The frame math is the export's own (lib/video/animation.ts +
// lib/video/gestures.ts), so what plays here is what encodes into the MP4.

import { useEffect, useState } from 'react';

export interface PlaybackSnapshot {
  /** Board currently loaded in the transport, null when nothing is. */
  artboardId: string | null;
  time: number; // seconds into the timeline
  duration: number; // loop length in seconds
  playing: boolean; // false while paused/scrubbing
}

let snapshot: PlaybackSnapshot = { artboardId: null, time: 0, duration: 0, playing: false };
const listeners = new Set<() => void>();
let rafId: number | null = null;
let lastTs = 0;

function emit() {
  // Copied: a listener may unsubscribe (unmount) while we are notifying.
  for (const listener of Array.from(listeners)) listener();
}

function setSnapshot(next: Partial<PlaybackSnapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

function tick(ts: number) {
  rafId = null;
  if (!snapshot.playing) return;
  // A backgrounded tab hands back a huge delta; clamp it so returning to the
  // tab resumes where it left off instead of jumping several loops ahead.
  const delta = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  let time = snapshot.time + delta;
  if (snapshot.duration > 0 && time >= snapshot.duration) {
    time -= Math.floor(time / snapshot.duration) * snapshot.duration;
  }
  snapshot = { ...snapshot, time };
  emit();
  rafId = requestAnimationFrame(tick);
}

function startClock() {
  if (rafId !== null) return;
  lastTs = 0;
  rafId = requestAnimationFrame(tick);
}

function stopClock() {
  if (rafId === null) return;
  cancelAnimationFrame(rafId);
  rafId = null;
}

export function getPlayback(): PlaybackSnapshot {
  return snapshot;
}

/** Start (or restart) a board's timeline. Replaces whatever was playing. */
export function playArtboard(artboardId: string, duration: number) {
  const switching = snapshot.artboardId !== artboardId;
  const atEnd = snapshot.duration > 0 && snapshot.time >= snapshot.duration - 0.01;
  setSnapshot({
    artboardId,
    duration: Math.max(0.1, duration),
    time: switching || atEnd ? 0 : snapshot.time,
    playing: true,
  });
  startClock();
}

export function pausePlayback() {
  if (!snapshot.playing) return;
  stopClock();
  setSnapshot({ playing: false });
}

/** Pause if this board is running, otherwise start it from where it stands. */
export function togglePlayback(artboardId: string, duration: number) {
  if (snapshot.artboardId === artboardId && snapshot.playing) {
    pausePlayback();
    return;
  }
  playArtboard(artboardId, duration);
}

/** Leave preview mode: the board goes back to its static, editable state. */
export function stopPlayback() {
  stopClock();
  setSnapshot({ artboardId: null, time: 0, duration: 0, playing: false });
}

export function seekPlayback(time: number) {
  if (!snapshot.artboardId) return;
  lastTs = 0; // don't bill the scrub gap to the next frame
  setSnapshot({ time: Math.max(0, Math.min(snapshot.duration, time)) });
}

/** Restart the board that is loaded, from zero. */
export function restartPlayback() {
  if (!snapshot.artboardId) return;
  lastTs = 0;
  setSnapshot({ time: 0, playing: true });
  startClock();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Timeline position of `artboardId`, or null when that board is not the one in
 * the transport (which is also the signal to render it statically).
 *
 * Set `enabled` to false for elements that do not care about the clock: they
 * then never re-render during playback. Subscribers that return null keep
 * returning null, and React bails out on the unchanged state, so boards that
 * are not playing cost nothing per frame.
 */
export function usePlaybackTime(artboardId: string | null | undefined, enabled = true): number | null {
  const read = () =>
    enabled && artboardId && snapshot.artboardId === artboardId ? snapshot.time : null;
  const [time, setTime] = useState<number | null>(read);
  useEffect(() => {
    // No subscription at all when the element cannot animate: a listener that
    // can only ever report null is still a listener called 60 times a second,
    // once per element on the canvas.
    if (!enabled || !artboardId) {
      setTime(null);
      return;
    }
    setTime(read());
    return subscribe(() => setTime(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artboardId, enabled]);
  return time;
}

/** True while this board's timeline is loaded and running (not paused). */
export function usePlaybackRunning(artboardId: string | null | undefined): boolean {
  const read = () => !!artboardId && snapshot.artboardId === artboardId && snapshot.playing;
  const [running, setRunning] = useState(read);
  useEffect(() => {
    setRunning(read());
    return subscribe(() => setRunning(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artboardId]);
  return running;
}

/** True while this board is in preview mode at all, running or paused. */
export function usePlaybackActive(artboardId: string | null | undefined): boolean {
  const read = () => !!artboardId && snapshot.artboardId === artboardId;
  const [active, setActive] = useState(read);
  useEffect(() => {
    setActive(read());
    return subscribe(() => setActive(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artboardId]);
  return active;
}

/**
 * The whole snapshot, for the transport bar. Re-renders every frame while
 * playing, so keep it to a leaf component.
 */
export function usePlaybackSnapshot(): PlaybackSnapshot {
  const [state, setState] = useState(snapshot);
  useEffect(() => subscribe(() => setState(snapshot)), []);
  return state;
}
