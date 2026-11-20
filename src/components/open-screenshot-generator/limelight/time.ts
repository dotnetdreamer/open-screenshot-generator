"use client";

// The playhead's time, outside React state: playback moves it every display
// frame, and only what shows the time (the clock, the playhead, the stage)
// listens, so the rest of the view does not render 60 times a second.

import { useEffect, useState, useSyncExternalStore } from 'react';

export class TimeStore {
  private value = 0;
  private readonly listeners = new Set<() => void>();

  get = (): number => this.value;

  set = (time: number) => {
    const next = Number.isFinite(time) ? Math.max(0, time) : 0;
    if (next === this.value) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export function useTime(store: TimeStore): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * The time, but updated at most every `ms`: for panels that show values at
 * the playhead, which need not redraw on every frame of playback.
 */
export function useSettledTime(store: TimeStore, ms = 100): number {
  const [time, setTime] = useState(store.get);
  useEffect(() => {
    let timer = 0;
    let last = 0;
    const update = () => {
      const now = performance.now();
      window.clearTimeout(timer);
      if (now - last >= ms) {
        last = now;
        setTime(store.get());
      } else {
        timer = window.setTimeout(() => {
          last = performance.now();
          setTime(store.get());
        }, ms - (now - last));
      }
    };
    const unsubscribe = store.subscribe(update);
    setTime(store.get());
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [store, ms]);
  return time;
}
