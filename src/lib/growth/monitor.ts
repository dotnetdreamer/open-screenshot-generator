// Growth's background monitor: keeps each watched app's numbers fresh while
// the desktop app is open, and finds the insights that turned up since the
// user last looked, so the toolbar can say so without the Growth window open.
//
// What it watches: apps the user has synced in Growth before (a last sync
// time is stored for them). An account with thirty apps is not read thirty
// times over because two of them are looked at. An app is synced when
// autoSync.ts says it is due, which is the same rule the Growth window uses
// and the same record of attempts, so the two never start one app twice.
//
// Seen insights are a list of ids per app (`insights:seen:<appId>`). The
// first look at an app only records what is there: every card on the screen
// would otherwise be "new" the first time the monitor runs.

import { listApps, type AscApp } from './asc';
import { dueForAutoSync, noteAutoSync } from './autoSync';
import { today } from './dates';
import { readMeta, readMetaWithPrefix, writeMeta } from './db';
import { buildInsights } from './insights';
import { checkListing } from './listingChecks';
import { loadGrowthData, type GrowthData } from './loadData';
import { getGrowthSettings } from './settings';
import { metaKeys, syncApp } from './sync';
import type { Insight } from './types';
import type { AppStoreCredentials } from '@/lib/publish/types';

export const insightsSeenKey = (appId: string) => `insights:seen:${appId}`;

/** Where the last list of the account's apps is kept, per key. */
export const appsListKey = (credentials: Pick<AppStoreCredentials, 'issuerId' | 'keyId'>) =>
  `apps:list:${credentials.issuerId}:${credentials.keyId}`;

/** The insights worth a mention: something to fix, or good news. */
export function isNotable(insight: Insight): boolean {
  return insight.tone !== 'neutral' && insight.weight >= 50;
}

/** The insights the Growth window would show for this data, dismissed ones left out. */
export function appInsights(appId: string, data: GrowthData): Insight[] {
  const dismissed = new Set(data.dismissed);
  return buildInsights({
    appId,
    records: data.records,
    reviews: data.reviews,
    ratings: data.ratings,
    events: data.events,
    listing: data.listing,
    listingIssues: data.listing ? checkListing(data.listing) : [],
    today: today(),
  }).filter((insight) => !dismissed.has(insight.id));
}

const seenListeners = new Set<(appId: string) => void>();

/** Called with an app's id once the user has seen its insights. */
export function onInsightsSeen(listener: (appId: string) => void): () => void {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
}

/**
 * Mark everything the user can now see for an app as seen. The Growth window
 * calls it for the app it shows.
 */
export async function markInsightsSeen(appId: string, insights: Insight[]): Promise<void> {
  const stored = (await readMeta<string[]>(insightsSeenKey(appId))) ?? [];
  const seen = new Set(stored);
  const before = seen.size;
  for (const insight of insights) seen.add(insight.id);
  // Ids of cards long gone would pile up forever; the newest 500 cover months.
  if (seen.size !== before || stored.length === 0) await writeMeta(insightsSeenKey(appId), Array.from(seen).slice(-500));
  seenListeners.forEach((listener) => listener(appId));
}

/** The notable insights of an app the user has not seen. A first look records them all instead. */
export async function unseenInsights(appId: string, insights: Insight[]): Promise<Insight[]> {
  const seen = await readMeta<string[]>(insightsSeenKey(appId));
  if (!seen) {
    await writeMeta(insightsSeenKey(appId), insights.map((insight) => insight.id));
    return [];
  }
  const known = new Set(seen);
  return insights.filter((insight) => isNotable(insight) && !known.has(insight.id)).sort((a, b) => b.weight - a.weight);
}

export interface MonitorFinding {
  app: AscApp;
  /** Notable insights not seen yet, most important first. */
  fresh: Insight[];
}

export interface MonitorPassOptions {
  credentials: AppStoreCredentials;
  signal?: AbortSignal;
  /**
   * Also look for unseen insights in apps that are not due a sync. The first
   * pass after the editor opens does, so the toolbar shows what is waiting
   * from before a restart.
   */
  checkAll?: boolean;
}

/** The apps with a stored last sync, newest sync first. */
async function watchedApps(): Promise<Array<{ appId: string; lastSync: number }>> {
  const prefix = metaKeys.lastSync('');
  const rows = await readMetaWithPrefix<number>(prefix);
  return rows
    .map((row) => ({ appId: row.key.slice(prefix.length), lastSync: Number(row.value) || 0 }))
    .filter((row) => row.appId)
    .sort((a, b) => b.lastSync - a.lastSync);
}

/** The account's apps, fresh when Apple answers and the last list kept when it does not. */
async function accountApps(credentials: AppStoreCredentials, signal?: AbortSignal): Promise<AscApp[]> {
  try {
    const apps = await listApps(credentials, signal);
    await writeMeta(appsListKey(credentials), apps);
    return apps;
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = await readMeta<AscApp[]>(appsListKey(credentials));
    if (cached?.length) return cached;
    throw error;
  }
}

/**
 * One pass: sync every watched app that is due, then report the notable
 * insights of each that the user has not seen. Apps are synced one after
 * another, never side by side, so a pass never takes more than one sync's
 * share of the editor's time.
 */
export async function runMonitorPass(options: MonitorPassOptions): Promise<MonitorFinding[]> {
  const settings = getGrowthSettings();
  if (!settings.monitor || settings.refreshHours <= 0) return [];
  const watched = await watchedApps();
  const work = watched
    .map((entry) => ({ ...entry, due: dueForAutoSync(entry.appId, entry.lastSync, settings.refreshHours) }))
    .filter((entry) => entry.due || options.checkAll);
  if (work.length === 0) return [];

  const apps = await accountApps(options.credentials, options.signal);
  const findings: MonitorFinding[] = [];
  for (const entry of work) {
    if (options.signal?.aborted) break;
    const app = apps.find((candidate) => candidate.id === entry.appId);
    // An app gone from the account (removed, or a different key) is left alone.
    if (!app) continue;
    if (entry.due) {
      noteAutoSync(app.id);
      const current = getGrowthSettings();
      try {
        await syncApp({
          credentials: options.credentials,
          app,
          allApps: apps,
          vendorNumber: current.vendorNumber,
          historyDays: current.historyDays,
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) break;
        console.error(`Growth background sync of ${app.name} failed`, error);
      }
      if (options.signal?.aborted) break;
    }
    const fresh = await unseenInsights(app.id, appInsights(app.id, await loadGrowthData(app)));
    if (fresh.length > 0) findings.push({ app, fresh });
  }
  return findings;
}
