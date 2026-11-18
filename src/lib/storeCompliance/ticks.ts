// The boxes ticked in the checklist, one list per project (the project's id),
// since a project is one app's screenshots. Kept in the Store compliance
// database, written box by box, and told to the app's other windows, so two
// windows on the same project show the same ticks.

import { useCallback, useEffect, useState } from 'react';
import { clearTicks, readTicks, setTick, type Tick } from './store';

export type { Tick } from './store';

/**
 * A box is done when it is ticked, or marked as not applying with a reason,
 * except a box every app has (`always`): "doesn't apply" never counts there,
 * even one written before the checklist said so.
 */
export function countsAsDone(item: { always?: boolean }, tick: Tick | undefined): boolean {
  return !!tick && !(item.always && tick.na);
}

const listeners = new Set<(list: string) => void>();
let channel: BroadcastChannel | null = null;

function announce(list: string): void {
  listeners.forEach((listener) => listener(list));
  try {
    channel?.postMessage({ list });
  } catch {
    // The other windows read the ticks when they show the checklist.
  }
}

function listen(listener: (list: string) => void): () => void {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('osg-store-compliance-ticks');
    channel.onmessage = (event: MessageEvent<{ list?: unknown }>) => {
      if (typeof event.data?.list === 'string') listeners.forEach((each) => each(event.data.list as string));
    };
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A checklist that is not a project's: the open project has no id yet. */
export const DEVICE_LIST = 'device';

export function useTicks(list: string): {
  ticks: Map<string, Tick>;
  loaded: boolean;
  toggle: (item: string, done: boolean) => void;
  /** Mark a box as not applying, with the reason, or take the mark off (null). */
  markNotApplying: (item: string, reason: string | null) => void;
  reset: () => Promise<void>;
} {
  const [ticks, setTicks] = useState<Map<string, Tick>>(() => new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    const read = () =>
      void readTicks(list)
        .then((next) => {
          if (live) {
            setTicks(next);
            setLoaded(true);
          }
        })
        .catch((error) => {
          console.error('Reading the checklist failed', error);
          if (live) setLoaded(true);
        });
    setLoaded(false);
    read();
    const stop = listen((changed) => {
      if (changed === list) read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [list]);

  const write = useCallback(
    (item: string, tick: Tick | null) => {
      // On screen at once, written after.
      setTicks((current) => {
        const next = new Map(current);
        if (tick) next.set(item, tick);
        else next.delete(item);
        return next;
      });
      void setTick(list, item, tick)
        .then(() => announce(list))
        .catch((error) => console.error('Saving the checklist failed', error));
    },
    [list]
  );
  const toggle = useCallback((item: string, done: boolean) => write(item, done ? { at: Date.now() } : null), [write]);
  const markNotApplying = useCallback(
    (item: string, reason: string | null) => write(item, reason && reason.trim() ? { at: Date.now(), na: reason.trim().slice(0, 200) } : null),
    [write]
  );

  const reset = useCallback(async () => {
    await clearTicks(list);
    setTicks(new Map());
    announce(list);
  }, [list]);

  return { ticks, loaded, toggle, markNotApplying, reset };
}
