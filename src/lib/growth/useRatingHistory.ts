"use client";

// The ratings history of some apps (ratingHistory.ts), read again when a
// refresh or a competitors check writes.

import { useEffect, useState } from 'react';
import { onGrowthChange, readRatingDays } from './db';
import { onRivalsChange } from './rivalWatch';
import type { RatingDay } from './types';

export function useRatingHistory(appIds: string[]): { loaded: boolean; byApp: Map<string, RatingDay[]> } {
  const key = appIds.join('\n');
  const [state, setState] = useState<{ key: string; loaded: boolean; byApp: Map<string, RatingDay[]> }>({ key: '', loaded: false, byApp: new Map() });
  useEffect(() => {
    let cancelled = false;
    let scheduled = false;
    const ids = key ? key.split('\n') : [];
    const read = () =>
      void Promise.all(ids.map((id) => readRatingDays(id))).then(
        (lists) => {
          if (!cancelled) setState({ key, loaded: true, byApp: new Map(ids.map((id, index) => [id, lists[index]])) });
        },
        (error) => {
          console.error('Reading the ratings history failed', error);
          if (!cancelled) setState({ key, loaded: true, byApp: new Map() });
        }
      );
    const later = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        if (!cancelled) read();
      }, 150);
    };
    read();
    const offGrowth = onGrowthChange((changed) => {
      if (changed === null || ids.includes(changed)) later();
    });
    const offRivals = onRivalsChange((event) => {
      if (event === 'data') later();
    });
    return () => {
      cancelled = true;
      offGrowth();
      offRivals();
    };
  }, [key]);
  return state.key === key ? { loaded: state.loaded, byApp: state.byApp } : { loaded: false, byApp: new Map() };
}
