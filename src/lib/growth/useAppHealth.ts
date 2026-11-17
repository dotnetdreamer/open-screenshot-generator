"use client";

// One app's health (health.ts), read again when a refresh writes for it.

import { useEffect, useState } from 'react';
import { onGrowthChange, readMeta } from './db';
import { healthKey, type AppHealth } from './health';

export function useAppHealth(appId: string): { loaded: boolean; health: AppHealth | null } {
  const [state, setState] = useState<{ appId: string; loaded: boolean; health: AppHealth | null }>({ appId: '', loaded: false, health: null });
  useEffect(() => {
    let cancelled = false;
    let scheduled = false;
    if (!appId) {
      setState({ appId, loaded: true, health: null });
      return;
    }
    const read = () =>
      void readMeta<AppHealth>(healthKey(appId)).then(
        (health) => {
          if (!cancelled) setState({ appId, loaded: true, health: health ?? null });
        },
        (error) => {
          console.error('Reading the app health failed', error);
          if (!cancelled) setState({ appId, loaded: true, health: null });
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
    const off = onGrowthChange((changed) => {
      if (changed === null || changed === appId) later();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [appId]);
  return state.appId === appId ? { loaded: state.loaded, health: state.health } : { loaded: false, health: null };
}
