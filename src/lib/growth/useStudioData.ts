"use client";

// What Growth's Today screen reads for every app (studio.ts): each app's
// stored numbers, reviews and marks, ratings history, health and insights.
// A refresh or an edit announces which app it wrote to, and only that app is
// read again; an announcement for every app reads them all.

import { useEffect, useMemo, useRef, useState } from 'react';
import { onGrowthChange, readMeta, readRatingDays, readReviewMarks } from './db';
import { buildName, healthFinding, healthKey, playVersionNames, versionHealth, type AppHealth, type HealthFinding } from './health';
import { loadGrowthData } from './loadData';
import { appInsights } from './monitor';
import { storeOf } from './stores';
import type { StudioInput } from './studio';
import type { GrowthApp } from './types';

/** "version 2.4", or "build 205" while Google Play's version for the build is not known, as Ratings says it. */
function versionWords(entry: { name: string; build: string | null }): string {
  return entry.build && entry.name === buildName(entry.build) ? `build ${entry.build}` : `version ${entry.name}`;
}

/** The health finding's title, in the words the Ratings screen uses for its card. */
export function healthTitle(finding: HealthFinding): string {
  const named = versionWords(finding.version);
  const Named = named.charAt(0).toUpperCase() + named.slice(1);
  const what = finding.measure === 'crash' ? 'crashes' : 'freezes';
  if (finding.overLine) return `${Named} is over Google's line for ${what}`;
  if (finding.kind === 'worse') return `${what.charAt(0).toUpperCase()}${what.slice(1)} went up with ${named}`;
  return finding.measure === 'crash' ? `${Named} crashes less` : `${Named} freezes less`;
}

async function readApp(app: GrowthApp): Promise<StudioInput> {
  const [data, ratingDays, health, marks] = await Promise.all([
    loadGrowthData(app),
    readRatingDays(app.id),
    readMeta<AppHealth>(healthKey(app.id)),
    readReviewMarks([app.id]),
  ]);
  const store = storeOf(app.id);
  const names = store === 'playstore' ? playVersionNames(data.reviews, health?.releaseNames) : {};
  const finding = health ? healthFinding(store, versionHealth(health, names)) : null;
  return {
    app,
    data,
    ratingDays,
    marks: new Map(marks.map((mark) => [mark.id, mark])),
    insights: appInsights(app.id, data),
    healthNote: finding ? { worse: finding.kind === 'worse', title: healthTitle(finding) } : null,
  };
}

export interface StudioData {
  /** Every app has been read once. */
  loaded: boolean;
  /** In the order of `apps`, for the apps read so far. */
  inputs: StudioInput[];
}

export function useStudioData(apps: GrowthApp[]): StudioData {
  // The list as a key: the parent rebuilds the app objects on every render.
  const key = apps.map((app) => `${app.id}\u0001${app.name}\u0001${app.iconUrl ?? ''}`).join('\n');
  const latestApps = useRef(apps);
  latestApps.current = apps;
  const [read, setRead] = useState<{ key: string; byId: Map<string, StudioInput> }>({ key: '', byId: new Map() });

  useEffect(() => {
    const list = latestApps.current;
    let cancelled = false;
    const pending = new Set<string>();
    let timer: number | null = null;
    const readSome = (ids: string[]) => {
      for (const app of list) {
        if (!ids.includes(app.id)) continue;
        void readApp(app).then(
          (input) => {
            if (cancelled) return;
            setRead((current) => {
              const byId = new Map(current.key === key ? current.byId : []);
              byId.set(app.id, input);
              return { key, byId };
            });
          },
          (error) => console.error(`Reading ${app.name} for Today failed`, error)
        );
      }
    };
    readSome(list.map((app) => app.id));
    const unsubscribe = onGrowthChange((changed) => {
      if (changed !== null && !list.some((app) => app.id === changed)) return;
      for (const id of changed === null ? list.map((app) => app.id) : [changed]) pending.add(id);
      // A refresh writes in bursts; one read per short pause is plenty.
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        const ids = Array.from(pending);
        pending.clear();
        if (!cancelled) readSome(ids);
      }, 200);
    });
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [key]);

  return useMemo(() => {
    const byId = read.key === key ? read.byId : new Map<string, StudioInput>();
    const inputs = apps.flatMap((app) => {
      const input = byId.get(app.id);
      // The name and icon as the picker has them now; the numbers as last read.
      return input ? [{ ...input, app }] : [];
    });
    return { loaded: apps.every((app) => byId.has(app.id)), inputs };
    // `apps` is read through the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, key]);
}
