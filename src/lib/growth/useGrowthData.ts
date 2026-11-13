"use client";

// Everything the Growth window shows for one app (loadData.ts), re-read
// whenever a sync or an edit announces a change.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onGrowthChange } from './db';
import { EMPTY_GROWTH_DATA, loadGrowthData, type GrowthData } from './loadData';
import type { GrowthApp } from './types';

export type { GrowthData } from './loadData';

export function useGrowthData(app: GrowthApp | null): GrowthData & { reload: () => void } {
  const [data, setData] = useState<GrowthData>(EMPTY_GROWTH_DATA);
  const [epoch, setEpoch] = useState(0);
  const appId = app?.id ?? null;
  const sample = !!app?.sample;
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (!app) {
      shownFor.current = null;
      setData(EMPTY_GROWTH_DATA);
      return;
    }
    // Another app: the last one's numbers go at once, so nothing (its last
    // sync time included, which decides whether to sync) is read as this one's.
    // A reload of the same app keeps them on screen until the new read lands.
    if (shownFor.current !== app.id) {
      shownFor.current = app.id;
      setData(EMPTY_GROWTH_DATA);
    }
    let cancelled = false;
    // A sync announces many small writes; one read per frame is plenty.
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        void loadGrowthData(app).then((next) => {
          if (!cancelled) setData(next);
        });
      }, 120);
    };
    void loadGrowthData(app).then((next) => {
      if (!cancelled) setData(next);
    });
    const unsubscribe = onGrowthChange((changed) => {
      if (changed === null || changed === app.id) refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // The app object is rebuilt by its parent; its id and kind are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, sample, epoch]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return useMemo(() => ({ ...data, reload }), [data, reload]);
}
