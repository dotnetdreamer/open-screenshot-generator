"use client";

// One list of followed apps for the Competitors screen (rivalWatch.ts): the
// list, what each app showed in each country, the changes found and which of
// them the user has seen, read again whenever a check or an edit writes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adoptRivalList,
  onRivalsChange,
  readRivalChanges,
  readRivalList,
  readSeenRivalChanges,
  readSnapshots,
  rivalCheckState,
  type RivalCheckState,
} from './rivalWatch';
import { ownAppId, type RivalChange, type RivalList, type RivalSnapshot } from './rivals';

export interface RivalsData {
  loaded: boolean;
  list: RivalList | null;
  /** By app id (App Store digits, or `play:` and a package): the followed apps and the user's own. */
  snapshots: Map<string, RivalSnapshot>;
  /** Newest first. */
  changes: RivalChange[];
  seen: Set<string>;
  /** The check of this list running in this window. */
  checking: RivalCheckState | null;
  /**
   * Apps followed with no Growth app and no app of the user's named, for
   * the list of a Growth app to offer to take over (moveUnownedRivals).
   */
  unowned: RivalList | null;
}

const EMPTY: RivalsData = { loaded: false, list: null, snapshots: new Map(), changes: [], seen: new Set(), checking: null, unowned: null };

async function load(owner: string): Promise<Omit<RivalsData, 'checking'>> {
  await adoptRivalList(owner);
  const list = await readRivalList(owner);
  const own = list ? ownAppId(list) : null;
  const ids = [...(list?.rivals.map((rival) => rival.id) ?? []), ...(own ? [own] : [])];
  const [snapshots, changes, seen, unowned] = await Promise.all([
    readSnapshots(ids),
    readRivalChanges(list?.rivals.map((rival) => rival.id) ?? []),
    readSeenRivalChanges(),
    owner ? readRivalList('') : Promise.resolve(null),
  ]);
  return { loaded: true, list, snapshots, changes, seen, unowned: unowned && unowned.rivals.length > 0 ? unowned : null };
}

/** `owner` is null while it is not known yet which app Growth shows; nothing is read then. */
export function useRivals(owner: string | null): RivalsData & { reload: () => void } {
  const [data, setData] = useState<Omit<RivalsData, 'checking'>>(EMPTY);
  const [checking, setChecking] = useState<RivalCheckState | null>(null);
  const [epoch, setEpoch] = useState(0);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Another app's list goes at once, so nothing of it is shown as this
    // one's. A reload of the same list keeps it on screen until the read lands.
    if (shownFor.current !== owner) {
      shownFor.current = owner;
      setData(EMPTY);
      setChecking(null);
    }
    if (owner === null) return;
    let scheduled = false;
    const read = () =>
      void load(owner).then(
        (next) => {
          if (!cancelled) setData(next);
        },
        (error) => console.error('The competitors could not be read', error)
      );
    read();
    const progress = () => {
      const state = rivalCheckState();
      setChecking(state && state.owner === owner ? { ...state } : null);
    };
    progress();
    const unsubscribe = onRivalsChange((event) => {
      if (event === 'progress') {
        progress();
        return;
      }
      // A check writes once per country; one read per short pause is plenty.
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        read();
      }, 120);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [owner, epoch]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return useMemo(() => ({ ...data, checking, reload }), [data, checking, reload]);
}
