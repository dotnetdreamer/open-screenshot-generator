"use client";

// Runs Growth's background monitor (monitor.ts) from the editor window.
//
// The first pass waits a minute and a half after the editor opens, so it does
// not compete with a project loading, and also looks at apps that are not due
// a sync so the toolbar shows what was waiting from before a restart. After
// that a pass every 15 minutes, each syncing only what is due. Passes stop
// while the Growth window is open, since the window syncs its app itself, and
// never overlap.
//
// What a pass finds is announced once (onFound), and the count of notable
// insights not yet seen is kept for the toolbar's Growth button. An app drops
// out of the count when the Growth window shows it (onInsightsSeen).

import { useEffect, useRef, useState } from 'react';
import { getStoreCredentials, isStorePublishingAvailable } from '@/lib/publish';
import { onInsightsSeen, runMonitorPass, type MonitorFinding } from './monitor';
import { subscribeGrowthSettings, getGrowthSettings } from './settings';

const FIRST_PASS_MS = 90_000;
const PASS_EVERY_MS = 15 * 60_000;

export interface GrowthMonitorOptions {
  /** Desktop main window only: a tab window would sync the same apps again. */
  enabled: boolean;
  /** True while the Growth window is open. */
  paused: boolean;
  /** Insights no earlier pass reported, at most once each. */
  onFound: (findings: MonitorFinding[]) => void;
}

export function useGrowthMonitor({ enabled, paused, onFound }: GrowthMonitorOptions): {
  /** Notable insights not seen yet, across the watched apps. */
  unseen: number;
  /** The apps they are in. */
  appIds: string[];
} {
  const [unseen, setUnseen] = useState<Record<string, string[]>>({});
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;
  const announced = useRef(new Set<string>());
  const [monitorOn, setMonitorOn] = useState(true);

  useEffect(() => {
    setMonitorOn(getGrowthSettings().monitor);
    return subscribeGrowthSettings(() => setMonitorOn(getGrowthSettings().monitor));
  }, []);

  useEffect(
    () =>
      onInsightsSeen((appId) =>
        setUnseen((current) => {
          if (!(appId in current)) return current;
          const next = { ...current };
          delete next[appId];
          return next;
        })
      ),
    []
  );

  useEffect(() => {
    if (!enabled || !monitorOn) return;
    const stop = new AbortController();
    let running = false;
    let first = true;
    const pass = async () => {
      if (running || pausedRef.current || stop.signal.aborted) return;
      if (!isStorePublishingAvailable()) return;
      const credentials = getStoreCredentials().appstore;
      if (!credentials) return;
      running = true;
      try {
        const findings = await runMonitorPass({ credentials, signal: stop.signal, checkAll: first });
        first = false;
        if (stop.signal.aborted) return;
        setUnseen((current) => {
          const next = { ...current };
          for (const finding of findings) next[finding.app.id] = finding.fresh.map((insight) => insight.id);
          return next;
        });
        const news = findings
          .map((finding) => ({ ...finding, fresh: finding.fresh.filter((insight) => !announced.current.has(insight.id)) }))
          .filter((finding) => finding.fresh.length > 0);
        for (const finding of news) finding.fresh.forEach((insight) => announced.current.add(insight.id));
        if (news.length > 0) onFoundRef.current(news);
      } catch (error) {
        if (!stop.signal.aborted) console.error('The Growth background check failed', error);
      } finally {
        running = false;
      }
    };
    const firstTimer = window.setTimeout(() => void pass(), FIRST_PASS_MS);
    const interval = window.setInterval(() => void pass(), PASS_EVERY_MS);
    return () => {
      stop.abort();
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
    };
  }, [enabled, monitorOn]);

  return {
    unseen: Object.values(unseen).reduce((sum, ids) => sum + ids.length, 0),
    appIds: Object.keys(unseen),
  };
}
