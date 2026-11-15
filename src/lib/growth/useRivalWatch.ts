"use client";

// Keeps the followed apps (rivalWatch.ts) checked while the editor is open,
// in the web build as much as in the desktop app: the lookup needs no key.
//
// The first pass waits half a minute after the editor opens, then a pass runs
// every 30 minutes, and each pass checks only the lists whose last answers
// are older than the check interval (twice a day). New screenshots found by
// any check, this one's or the Competitors screen's, are announced once
// (onFound), except for the list whose screen is in front. The count of new
// screenshots not seen yet is for Growth's button on the activity bar.

import { useEffect, useRef, useState } from 'react';
import { onRivalChangesFound, onRivalsChange, rivalsOnScreen, runRivalPass, unseenRivalNews, type RivalNews } from './rivalWatch';

const FIRST_PASS_MS = 30_000;
const PASS_EVERY_MS = 30 * 60_000;

export interface RivalWatchOptions {
  /** Off in the desktop app's tab windows: the main window checks for them. */
  enabled: boolean;
  /** New screenshots of followed apps, each announced once. */
  onFound: (news: RivalNews[]) => void;
}

export function useRivalWatch({ enabled, onFound }: RivalWatchOptions): {
  /** New screenshots of followed apps the user has not seen. */
  unseen: number;
  news: RivalNews[];
} {
  const [news, setNews] = useState<RivalNews[]>([]);
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;

  useEffect(() => {
    let cancelled = false;
    let scheduled = false;
    const count = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        void unseenRivalNews().then(
          (next) => {
            if (!cancelled) setNews(next);
          },
          (error) => console.error('The new competitor screenshots could not be counted', error)
        );
      }, 200);
    };
    count();
    const unsubscribe = onRivalsChange((event) => {
      if (event === 'data') count();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const announced = new Set<string>();
    return onRivalChangesFound((changes) => {
      void unseenRivalNews().then((all) => {
        const ids = new Set(changes.map((change) => change.id));
        const fresh = all.filter((item) => ids.has(item.change.id) && !announced.has(item.change.id) && item.owner !== rivalsOnScreen());
        fresh.forEach((item) => announced.add(item.change.id));
        if (fresh.length > 0) onFoundRef.current(fresh);
      });
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    const pass = () => void runRivalPass({ signal: stop.signal }).catch((error) => console.error('The competitors check failed', error));
    const first = window.setTimeout(pass, FIRST_PASS_MS);
    const interval = window.setInterval(pass, PASS_EVERY_MS);
    return () => {
      stop.abort();
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [enabled]);

  // One change seen by two lists counts once.
  const unseen = new Set(news.map((item) => item.change.id)).size;
  return { unseen, news };
}
