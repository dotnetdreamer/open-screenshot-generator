"use client";

// Keeps the tracked keywords checked while the editor is open, in the web
// build as much as in the desktop app: Apple's search needs no key.
//
// The first pass waits a minute after the editor opens, after the competitors'
// first pass has had its turn, then a pass runs every 30 minutes. A pass asks
// only for the searches that have no rank for today yet (keywordWatch.ts), so
// most passes ask Apple nothing. After the ranks, the desktop app with Apple
// Ads connected refreshes the popularity scores older than a day
// (popularityWatch.ts).

import { useEffect } from 'react';
import { runKeywordPass } from './keywordWatch';
import { refreshPopularityForLists } from './popularityWatch';

const FIRST_PASS_MS = 60_000;
const PASS_EVERY_MS = 30 * 60_000;

/** `enabled` is off in the desktop app's tab windows: the main window checks for them. */
export function useKeywordWatch({ enabled }: { enabled: boolean }): void {
  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    const pass = () =>
      void runKeywordPass({ signal: stop.signal })
        .catch((error) => console.error('The keywords check failed', error))
        .then(() => refreshPopularityForLists({ signal: stop.signal }))
        .catch((error) => console.error('Refreshing keyword popularity failed', error));
    const first = window.setTimeout(pass, FIRST_PASS_MS);
    const interval = window.setInterval(pass, PASS_EVERY_MS);
    return () => {
      stop.abort();
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [enabled]);
}
