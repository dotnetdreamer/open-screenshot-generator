// Fetching everything for one app and folding it into the local database.
//
// Feeds run independently and fail independently: a key without the Sales
// role still gets its reviews, an account whose analytics reports are not on
// yet still gets its downloads. Each feed reports its own state, which is what
// the connection screen shows, line by line, with what to do about it.
//
// Order: the listing and reviews first (one or two requests each, and they make
// the window useful at once), then Sales and Trends, the analytics reports and
// the ratings sweep side by side, since they talk to three different hosts.
//
// Every import is idempotent (records.ts replaces a feed's day, reviews and
// events are keyed by id), so a sync that is stopped halfway, or run twice,
// leaves correct numbers behind and the next one carries on from there.

import type { AppStoreCredentials } from '@/lib/publish/types';
import {
  AscAuthError,
  AscForbiddenError,
  createReportRequest,
  downloadSegment,
  fetchListing,
  fetchReviews,
  fetchSalesDay,
  listInstances,
  listReportRequests,
  listReports,
  listSegments,
  type AscApp,
  type ReportRequest,
} from './asc';
import {
  analyticsReportKind,
  combineBatches,
  parseDownloadsReport,
  parseEngagementReport,
  type AnalyticsReportKind,
} from './analyticsReport';
import { addDays, dayRange, formatDay, normalizeDay, today, windowEndingAt } from './dates';
import { reportText } from './delimited';
import { plural } from './format';
import {
  announceGrowthChange,
  readDay,
  readDays,
  readEvents,
  readMeta,
  readRatings,
  readReviews,
  writeDays,
  writeEvents,
  writeListing,
  writeMeta,
  writeRatings,
  writeReviews,
} from './db';
import { lookupApp, type LookupResult } from './itunes';
import { byTerritory, indexRecords } from './metrics';
import { emptyFeedDay, mergeFeed, type FeedBatch } from './records';
import { parseSalesReport } from './salesReport';
import type { DayRecord, DayString, FeedId, FeedStatus, GrowthFeed, SyncProgress, SyncStatus, TerritoryRating, TimelineEvent } from './types';

export const IDLE_STATUS: SyncStatus = {
  listing: { state: 'idle' },
  reviews: { state: 'idle' },
  sales: { state: 'idle' },
  analytics: { state: 'idle' },
  ratings: { state: 'idle' },
};

export interface SyncOptions {
  credentials: AppStoreCredentials;
  app: AscApp;
  /** Every app on the account, for attributing in-app purchases by SKU. */
  allApps: AscApp[];
  vendorNumber?: string;
  historyDays: number;
  feeds?: GrowthFeed[];
  signal?: AbortSignal;
  onStatus?: (status: SyncStatus) => void;
  onProgress?: (progress: SyncProgress | null) => void;
}

/** What one live storefront lookup said about the app, kept for the Listing screen. */
export interface LiveListing {
  version: string;
  releaseDate: string | null;
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
  storeUrl: string | null;
  iconUrl: string | null;
  checkedAt: number;
}

export const metaKeys = {
  lastSync: (appId: string) => `sync:last:${appId}`,
  status: (appId: string) => `sync:status:${appId}`,
  live: (appId: string) => `app:live:${appId}`,
  salesDays: (vendor: string) => `sales:days:${vendor}`,
  skus: (vendor: string) => `sales:skus:${vendor}`,
  analyticsDone: (appId: string) => `analytics:done:${appId}`,
  /** The import version the files in analyticsDone were read with (ANALYTICS_IMPORT_VERSION). */
  analyticsVersion: (appId: string) => `analytics:version:${appId}`,
  /** What the analytics import knows about the app's history (AnalyticsHistory). */
  analyticsHistory: (appId: string) => `analytics:history:${appId}`,
  analyticsReports: (requestId: string) => `analytics:reports:${requestId}`,
  insightsDismissed: (appId: string) => `insights:dismissed:${appId}`,
  ratingsSwept: (appId: string) => `ratings:swept:${appId}`,
  /** Google Play: the report files read, by name, with the time each last changed. */
  playFiles: (appId: string) => `play:files:${appId}`,
  /** Google Play: the app's name and icon, from its store page, for the app picker. */
  playApp: (appId: string) => `play:app:${appId}`,
};

const running = new Map<string, Promise<SyncStatus>>();

/** Web Locks reach every window of the origin; the editor's tab windows each sync on their own. */
function webLocks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

/**
 * Day rows are read, merged and written back by Sales and Trends and by the
 * analytics import, which run side by side, and by a sync in another editor
 * window. Without a turn each, one writer reads a row, another writes its
 * numbers into it, and the first writes its stale copy back over them. One
 * lock for every app, because a Sales and Trends report carries every app on
 * the account. The promise chain is for engines without Web Locks.
 */
let dayWrites: Promise<unknown> = Promise.resolve();

function withDayLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (locks) return locks.request('osg-growth-day-rows', () => task());
  const next = dayWrites.then(task, task);
  dayWrites = next.catch(() => undefined);
  return next;
}

/** One feed's numbers for a day. `onlyIfMissing` writes them only where that feed has nothing for the day yet. */
export interface DayWrite {
  appId: string;
  date: string;
  feed: FeedId;
  day: ReturnType<typeof emptyFeedDay>;
  onlyIfMissing?: boolean;
}

/** Merge each day into what is stored, inside the lock. */
export async function mergeAndWrite(entries: DayWrite[]): Promise<void> {
  if (entries.length === 0) return;
  await withDayLock(async () => {
    const now = Date.now();
    const writes = [];
    for (const entry of entries) {
      const stored = await readDay(entry.appId, entry.date);
      if (entry.onlyIfMissing && stored?.feeds[entry.feed] !== undefined) continue;
      writes.push(mergeFeed(stored, entry.appId, entry.date, entry.feed, entry.day, now));
    }
    await writeDays(writes);
  });
}

export function isSyncing(appId: string): boolean {
  return running.has(appId);
}

/**
 * Sync one app. A second call in this window joins the one running; a sync of
 * the same app already running in another editor window is left to finish,
 * and this call answers with the last saved status instead of starting a
 * second one beside it.
 */
export function syncApp(options: SyncOptions): Promise<SyncStatus> {
  return exclusiveSync(options.app.id, () => runSync(options));
}

/**
 * Run one app's sync unless one is running already: in this window it is
 * joined, in another editor window it is left to finish and the last saved
 * status answers. Both stores' syncs go through here (playSync.ts too).
 */
export function exclusiveSync(appId: string, task: () => Promise<SyncStatus>): Promise<SyncStatus> {
  const existing = running.get(appId);
  if (existing) return existing;
  const locks = webLocks();
  const work = (
    locks
      ? locks.request(`osg-growth-sync:${appId}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            const saved = (await readMeta<SyncStatus>(metaKeys.status(appId))) ?? IDLE_STATUS;
            return { ...IDLE_STATUS, ...saved };
          }
          return task();
        })
      : task()
  ).finally(() => running.delete(appId));
  running.set(appId, work);
  return work;
}

export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (error as Error)?.name === 'AbortError' || !!signal?.aborted;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'The data could not be loaded. Refresh to try again';
}

async function runSync(options: SyncOptions): Promise<SyncStatus> {
  const appId = options.app.id;
  const wanted = new Set<GrowthFeed>(options.feeds ?? ['listing', 'reviews', 'sales', 'analytics', 'ratings']);
  const status: SyncStatus = { ...IDLE_STATUS, ...((await readMeta<SyncStatus>(metaKeys.status(appId))) ?? {}) };
  for (const feed of wanted) status[feed] = { ...status[feed], state: 'syncing' };
  const emit = () => options.onStatus?.({ ...status });
  emit();

  const progress = new Map<GrowthFeed, SyncProgress>();
  const emitProgress = () => {
    if (progress.size === 0) {
      options.onProgress?.(null);
      return;
    }
    const parts = Array.from(progress.values());
    options.onProgress?.({
      label: parts.map((part) => part.label).join(', '),
      done: parts.reduce((sum, part) => sum + part.done, 0),
      total: parts.reduce((sum, part) => sum + part.total, 0),
    });
  };
  const setProgress = (feed: GrowthFeed, value: SyncProgress | null) => {
    if (value) progress.set(feed, value);
    else progress.delete(feed);
    emitProgress();
  };

  let authFailure: string | null = null;
  const run = async (feed: GrowthFeed, task: () => Promise<FeedStatus>) => {
    if (!wanted.has(feed)) return;
    // A refused key stops the feeds that use it. Ratings come from Apple's
    // public lookup and need no key, so they still run.
    if (authFailure && feed !== 'ratings') {
      status[feed] = { state: 'error', message: authFailure, updatedAt: Date.now() };
      emit();
      return;
    }
    try {
      status[feed] = { ...(await task()), updatedAt: Date.now() };
    } catch (error) {
      if (isAbort(error, options.signal)) {
        status[feed] = { state: 'idle', message: 'The refresh was stopped', updatedAt: Date.now() };
      } else if (error instanceof AscAuthError) {
        authFailure = error.message;
        status[feed] = { state: 'error', message: error.message, updatedAt: Date.now() };
      } else {
        console.error(`Growth sync: ${feed} failed`, error);
        status[feed] = { state: 'error', message: describe(error), updatedAt: Date.now() };
      }
    } finally {
      setProgress(feed, null);
    }
    emit();
    announceGrowthChange(appId);
  };

  await run('listing', () => syncListing(options));
  await run('reviews', () => syncReviews(options, (value) => setProgress('reviews', value)));
  await Promise.all([
    run('sales', () => syncSales(options, (value) => setProgress('sales', value))),
    run('analytics', () => syncAnalytics(options, (value) => setProgress('analytics', value))),
  ]);
  // After the numbers, so the sweep can start with the storefronts that matter.
  await run('ratings', () => syncRatings(options, (value) => setProgress('ratings', value)));

  options.onProgress?.(null);
  await writeMeta(metaKeys.status(appId), status);
  if (!options.signal?.aborted) await writeMeta(metaKeys.lastSync(appId), Date.now());
  announceGrowthChange(appId);
  return status;
}

// --- listing -----------------------------------------------------------------

async function syncListing(options: SyncOptions): Promise<FeedStatus> {
  try {
    const listing = await fetchListing(options.credentials, options.app, options.signal);
    if (!listing) return { state: 'empty', message: 'Your app has no App Store version yet' };
    await writeListing(listing);
    return { state: 'ok', message: `Version ${listing.versionString}, ${listing.locales.length} language${listing.locales.length === 1 ? '' : 's'}` };
  } catch (error) {
    if (error instanceof AscForbiddenError) {
      return { state: 'forbidden', message: 'Your key cannot load the store page. Use a key with the Admin, App Manager or Marketing role' };
    }
    throw error;
  }
}

// --- reviews -----------------------------------------------------------------

async function syncReviews(options: SyncOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const appId = options.app.id;
  const stored = await readReviews(appId);
  // Replies change on reviews already stored, so a refresh re-reads the last
  // two weeks rather than stopping at the newest review it has.
  const newest = stored[0]?.createdDate;
  const since = newest ? `${addDays(normalizeDay(newest) ?? today(), -14)}T00:00:00Z` : undefined;
  setProgress({ label: 'reviews', done: 0, total: 1 });
  try {
    // A refresh pages until it reaches `since` (fetchReviews stops there), so a
    // busy fortnight is read in full rather than cut at a page count and lost.
    const reviews = await fetchReviews(options.credentials, appId, { since, maxPages: 25, signal: options.signal });
    await writeReviews(reviews);
    const total = new Set([...stored.map((review) => review.id), ...reviews.map((review) => review.id)]).size;
    if (total === 0) return { state: 'empty', message: 'No written reviews yet' };
    return { state: 'ok', message: `${total} written review${total === 1 ? '' : 's'}` };
  } catch (error) {
    if (error instanceof AscForbiddenError) {
      return { state: 'forbidden', message: 'Your key cannot load reviews. Use a key with the Admin, App Manager, Customer Support or Marketing role' };
    }
    throw error;
  }
}

// --- Sales and Trends ----------------------------------------------------------

type SalesDayState = 'report' | 'empty';

/**
 * Apple keeps a year of daily Sales and Trends reports. Asking for the very
 * edge of that year risks a refusal on every sync, so a run stops short of it.
 */
const SALES_MAX_DAYS = 363;

/** One fetched day: its rows, and what to record about it once they are written. */
interface SalesDayResultEntry {
  day: string;
  kind: SalesDayState;
  rows: Parameters<typeof mergeAndWrite>[0];
}

/**
 * A Sales and Trends report covers every app on the account, so two apps
 * syncing at once (the window opens on one and the user picks another) each
 * fetched the whole year: 726 requests for 363 days, seen live in November
 * 2026. The fetch takes turns per vendor instead. The second waits, then reads
 * the days the first stored and asks only for what is still missing.
 */
const salesTurns = new Map<string, Promise<unknown>>();

function withSalesTurn<T>(vendor: string, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (locks) return locks.request(`osg-growth-sales:${vendor}`, signal ? { signal } : {}, () => task());
  const next = (salesTurns.get(vendor) ?? Promise.resolve()).then(task, task);
  salesTurns.set(vendor, next.catch(() => undefined));
  return next;
}

async function syncSales(options: SyncOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const vendor = options.vendorNumber?.trim();
  if (!vendor) {
    return { state: 'needs-setup', message: 'Add your vendor number to see downloads, purchases and earnings' };
  }
  return withSalesTurn(vendor, options.signal, () => syncSalesDays(options, vendor, setProgress));
}

async function syncSalesDays(options: SyncOptions, vendor: string, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const fetched = { ...((await readMeta<Record<string, SalesDayState>>(metaKeys.salesDays(vendor))) ?? {}) };
  const skus: Record<string, string> = { ...((await readMeta<Record<string, string>>(metaKeys.skus(vendor))) ?? {}) };
  for (const app of options.allApps) if (app.sku) skus[app.sku] = app.id;

  // Apple dates Sales and Trends in Pacific time and publishes a day the next
  // morning there, so yesterday in UTC may still be "not yet".
  const newest = addDays(today(), -1);
  const oldest = addDays(newest, -(Math.min(SALES_MAX_DAYS, Math.max(30, options.historyDays)) - 1));
  const recheck = new Set([newest, addDays(newest, -1), addDays(newest, -2)]);
  const wanted: string[] = [];
  for (let day = newest; day >= oldest; day = addDays(day, -1)) {
    if (!fetched[day] || recheck.has(day)) wanted.push(day);
  }

  // The four workers stop together: on the user's Stop, and on the first
  // error that every later request would hit too (a refused key or role).
  const stop = new AbortController();
  const onOuterAbort = () => stop.abort();
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });
  if (options.signal?.aborted) stop.abort();

  let done = 0;
  let notYet = 0;
  let failedDays = 0;
  let fatal: unknown = null;
  setProgress({ label: 'Sales and Trends', done, total: wanted.length });

  // A day is recorded as fetched in the same flush that writes its rows, never
  // before. Recorded first, a run stopped in between would leave a fetched day
  // with no rows, which no later sync fetches again and zeroFill turns into
  // a zero for every app on the account.
  let ready: SalesDayResultEntry[] = [];
  const flush = async () => {
    const batch = ready;
    ready = [];
    if (batch.length === 0) return;
    await mergeAndWrite(batch.flatMap((entry) => entry.rows));
    for (const entry of batch) fetched[entry.day] = entry.kind;
    await writeMeta(metaKeys.salesDays(vendor), fetched);
    await writeMeta(metaKeys.skus(vendor), skus);
    announceGrowthChange(options.app.id);
  };

  let index = 0;
  const worker = async () => {
    while (index < wanted.length && !stop.signal.aborted) {
      const day = wanted[index];
      index += 1;
      try {
        const result = await fetchSalesDay(options.credentials, vendor, day, stop.signal);
        if (result.kind === 'not-yet') {
          notYet += 1;
        } else {
          const rows: SalesDayResultEntry['rows'] = [];
          if (result.kind === 'report') {
            const parsed = parseSalesReport(await reportText(result.bytes), skus);
            Object.assign(skus, parsed.skus);
            for (const [appId, batch] of parsed.byApp) {
              for (const [date, feedDay] of batch) rows.push({ appId, date, feed: 'sales', day: feedDay });
            }
          }
          ready.push({ day, kind: result.kind, rows });
        }
      } catch (error) {
        if (isAbort(error, stop.signal)) return;
        if (error instanceof AscAuthError || error instanceof AscForbiddenError) {
          fatal = fatal ?? error;
          stop.abort();
          return;
        }
        // One bad day (a 500, a rate limit, a date Apple will not serve) is
        // left unrecorded, so the next sync asks for it again; the rest go on.
        failedDays += 1;
        console.error(`Growth sync: Sales and Trends for ${day} failed`, error);
      }
      done += 1;
      setProgress({ label: 'Sales and Trends', done, total: wanted.length });
      if (done % 20 === 0) {
        try {
          await flush();
        } catch (error) {
          fatal = fatal ?? error;
          stop.abort();
          return;
        }
      }
    }
  };

  try {
    // Settled, not raced: no worker may still be fetching once this returns,
    // or its rows would arrive after the last flush and be dropped.
    await Promise.allSettled([worker(), worker(), worker(), worker()]);
    // Whatever arrived before a stop or a failure is kept.
    await flush();
  } finally {
    options.signal?.removeEventListener('abort', onOuterAbort);
  }

  if (options.signal?.aborted) throw new DOMException('The sync was stopped', 'AbortError');
  if (fatal instanceof AscForbiddenError) {
    return {
      state: 'forbidden',
      message: /vendor/i.test(fatal.message)
        ? 'Apple did not accept your vendor number. Check the vendor number in App Store Connect, under Payments and Financial Reports'
        : 'Your key cannot load Sales and Trends. Use a key with the Admin, Finance or Sales role',
    };
  }
  if (fatal) throw fatal;
  await zeroFill(options.app.id, fetched);

  const days = Object.keys(fetched).length;
  if (days === 0 && notYet > 0) return { state: 'pending', message: 'Apple has not sent the first sales numbers yet' };
  const retry = failedDays > 0 ? `. ${failedDays} day${failedDays === 1 ? '' : 's'} could not be loaded. The next refresh tries again` : '';
  return { state: 'ok', message: `${days} day${days === 1 ? '' : 's'} of sales${retry}`, since: readSince(fetched) };
}

/** The first of the days read without a gap up to the newest one read. */
export function readSince(fetched: Record<string, unknown>): string | undefined {
  const days = Object.keys(fetched).sort();
  let since = days[days.length - 1];
  if (!since) return undefined;
  while (fetched[addDays(since, -1)]) since = addDays(since, -1);
  return since;
}

/**
 * Days Apple reported with no rows for this app are real zeros, but only from
 * the app's first sale on: before that it did not exist, and a zero there
 * would drag every average down. Runs after a sync, once the first day is known.
 */
async function zeroFill(appId: string, fetched: Record<string, SalesDayState>): Promise<void> {
  const records = await readDays(appId);
  const withSales = records.filter((record) => record.feeds.sales !== undefined && Object.keys(record.territories).length > 0);
  if (withSales.length === 0) return;
  const first = withSales.reduce((min, record) => (record.date < min ? record.date : min), withSales[0].date);
  const byDate = indexRecords(records);
  const entries: Parameters<typeof mergeAndWrite>[0] = [];
  for (const date of Object.keys(fetched)) {
    if (date < first || byDate.get(date)?.feeds.sales !== undefined) continue;
    entries.push({ appId, date, feed: 'sales', day: emptyFeedDay() });
  }
  await mergeAndWrite(entries);
}

// --- Analytics Reports ---------------------------------------------------------

/** At most this many report instances per sync; the rest wait for the next one. */
const MAX_INSTANCES_PER_SYNC = 150;

/**
 * Raised when the import starts storing something new for files it has read
 * before, so the next sync reads every file Apple still lists once more.
 * Version 2 stores the days a file covers with nothing counted on them
 * (`instanceDays`); version 1 skipped them.
 */
export const ANALYTICS_IMPORT_VERSION = 2;

const DAY_MS = 86_400_000;

/**
 * Apple deletes a report instance 35 days after making it, and a new one-time
 * snapshot brings back all the history it still has (Analytics Reports
 * documentation). It makes one about every 31 days, counting deleted
 * requests, and before that answers 409 "You already have such an entity"
 * (an App Store Connect engineer on the developer forums, thread 759773).
 */
const SNAPSHOT_EVERY_MS = 31 * DAY_MS;

/**
 * How far back a daily file's own days reach. Apple re-sends the last days in
 * full until they are complete: two for App Downloads and three for Discovery
 * and Engagement in Ludo Wala's files of November 2026. An older date in a
 * daily file is a correction.
 */
const RECENT_DAYS = 4;

/** What the analytics import knows about an app's history, kept between syncs. */
export interface AnalyticsHistory {
  /**
   * The reports whose snapshot file has been read, so their history before
   * the daily files is in. Per report: in November 2026 Apple listed Ludo
   * Wala's Downloads snapshot before its Discovery and Engagement one.
   */
  snapshotRead?: Partial<Record<AnalyticsReportKind, true>>;
  /** The last time Growth asked Apple for a snapshot, whatever Apple answered. */
  snapshotAskedAt?: number;
  /** The key may not ask for one: it needs the Admin role. */
  snapshotRefused?: boolean;
}

/**
 * Make sure Apple is making the daily reports. The snapshot of the history
 * before them is asked for after the import (`snapshotDue`), since a later
 * one is how days Apple has deleted come back.
 */
async function ensureOngoing(options: SyncOptions): Promise<{ requests: ReportRequest[]; refusedCreate: boolean }> {
  const appId = options.app.id;
  let requests = (await listReportRequests(options.credentials, appId, options.signal)).filter((request) => !request.stoppedDueToInactivity);
  let refusedCreate = false;
  if (!requests.some((request) => request.accessType === 'ONGOING')) {
    try {
      requests = [...requests, await createReportRequest(options.credentials, appId, 'ONGOING')];
    } catch (error) {
      if (error instanceof AscForbiddenError) refusedCreate = true;
      else if (!/409|already exists|duplicate/i.test(describe(error))) throw error;
    }
  }
  return { requests, refusedCreate };
}

async function syncAnalytics(options: SyncOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const appId = options.app.id;
  let requests: ReportRequest[];
  let refusedCreate = false;
  try {
    ({ requests, refusedCreate } = await ensureOngoing(options));
  } catch (error) {
    if (error instanceof AscForbiddenError) {
      return {
        state: 'forbidden',
        message: 'Your key cannot load App Analytics. Use a key with the Admin, Sales or Finance role',
      };
    }
    throw error;
  }
  if (requests.length === 0) {
    return refusedCreate
      ? {
          state: 'needs-setup',
          message: 'An Admin key has to turn on App Analytics one time',
        }
      : { state: 'pending', message: 'Growth asked Apple to turn on App Analytics. The first numbers usually come within two days' };
  }

  // Which reports to read, from each request.
  const targets: Array<{ reportId: string; kind: AnalyticsReportKind; snapshot: boolean }> = [];
  for (const request of requests) {
    let refs = await readMeta<Partial<Record<AnalyticsReportKind, string>>>(metaKeys.analyticsReports(request.id));
    if (!refs || !refs.engagement || !refs.downloads) {
      refs = {};
      for (const report of await listReports(options.credentials, request.id, options.signal)) {
        const kind = analyticsReportKind(report.name);
        if (kind && !refs[kind]) refs[kind] = report.id;
      }
      await writeMeta(metaKeys.analyticsReports(request.id), refs);
    }
    for (const kind of ['engagement', 'downloads'] as AnalyticsReportKind[]) {
      const reportId = refs[kind];
      if (reportId) targets.push({ reportId, kind, snapshot: request.accessType === 'ONE_TIME_SNAPSHOT' });
    }
  }

  // Files an older import read are read once more (ANALYTICS_IMPORT_VERSION).
  const upToDate = (await readMeta<number>(metaKeys.analyticsVersion(appId))) === ANALYTICS_IMPORT_VERSION;
  const done: Record<string, string> = upToDate ? { ...((await readMeta<Record<string, string>>(metaKeys.analyticsDone(appId))) ?? {}) } : {};
  const history: AnalyticsHistory = { ...((await readMeta<AnalyticsHistory>(metaKeys.analyticsHistory(appId))) ?? {}) };
  const queue: Array<{ instanceId: string; processingDate: string; kind: AnalyticsReportKind; snapshot: boolean }> = [];
  for (const target of targets) {
    for (const instance of await listInstances(options.credentials, target.reportId, options.signal)) {
      if (!done[instance.id]) queue.push({ instanceId: instance.id, processingDate: instance.processingDate, kind: target.kind, snapshot: target.snapshot });
    }
  }
  // Oldest first, so a later instance's corrections land last and win. On one
  // processing date the daily file goes after the snapshot.
  queue.sort((a, b) => a.processingDate.localeCompare(b.processingDate) || Number(b.snapshot) - Number(a.snapshot));
  const batch = queue.slice(0, MAX_INSTANCES_PER_SYNC);

  const save = async () => {
    await writeMeta(metaKeys.analyticsDone(appId), done);
    await writeMeta(metaKeys.analyticsHistory(appId), history);
  };
  let processed = 0;
  setProgress({ label: 'App Analytics', done: 0, total: batch.length });
  for (const item of batch) {
    const segments = await listSegments(options.credentials, item.instanceId, options.signal);
    const batches: FeedBatch[] = [];
    for (const segment of segments) {
      const text = await reportText(await downloadSegment(segment.url, options.signal));
      batches.push(item.kind === 'engagement' ? parseEngagementReport(text, { appId }) : parseDownloadsReport(text, { appId }));
    }
    const combined = combineBatches(batches);
    const feed: FeedId = item.kind;
    const writes: DayWrite[] = Array.from(combined, ([date, day]) => ({ appId, date, feed, day }));
    // The file's quiet days are zeros, but never over numbers another file stored.
    for (const date of instanceDays(item.processingDate, item.snapshot, combined.keys())) {
      if (!combined.has(date)) writes.push({ appId, date, feed, day: emptyFeedDay(), onlyIfMissing: true });
    }
    await mergeAndWrite(writes);
    if (item.snapshot) history.snapshotRead = { ...history.snapshotRead, [item.kind]: true };
    done[item.instanceId] = item.processingDate;
    processed += 1;
    setProgress({ label: 'App Analytics', done: processed, total: batch.length });
    if (processed % 10 === 0) {
      await save();
      announceGrowthChange(appId);
    }
  }
  await save();
  await writeMeta(metaKeys.analyticsVersion(appId), ANALYTICS_IMPORT_VERSION);

  const remaining = queue.length - batch.length;
  const { newest, missing } = analyticsCoverage(await readDays(appId));
  // Only with every listed file read: one still waiting may hold the days.
  if (remaining === 0 && !refusedCreate && snapshotDue(history, missing.length, Date.now())) {
    await askForSnapshot(options, history);
    await writeMeta(metaKeys.analyticsHistory(appId), history);
  }

  if (!newest) {
    return { state: 'pending', message: 'Apple is getting App Analytics ready. The first numbers usually come within two days' };
  }
  if (remaining > 0) {
    return { state: 'ok', message: `Loaded ${processed} files from Apple. Files left for the next refresh: ${remaining}` };
  }
  // The day the numbers reach, which an instance's processing date is not.
  const reach = `Numbers up to ${formatDay(newest, { withYear: true })}`;
  if (missing.length === 0) return { state: 'ok', message: reach };
  const gap = `${plural(missing.length, 'day')} ${missing.length === 1 ? 'is' : 'are'} missing`;
  if (refusedCreate || history.snapshotRefused) return { state: 'ok', message: `${reach}. ${gap}. An Admin key can ask Apple for them again` };
  // An ask that never reached Apple is not noted, and the next sync makes it.
  const asked = history.snapshotAskedAt !== undefined && Date.now() - history.snapshotAskedAt < SNAPSHOT_EVERY_MS;
  return { state: 'ok', message: asked ? `${reach}. ${gap}, and Growth asked Apple for them again` : `${reach}. ${gap}. The next refresh asks Apple for them again` };
}

/**
 * The days one analytics file answers for, rows or not. A day in there with
 * no rows is a zero of that report. A day no file answers for stays unknown,
 * and the overview takes its downloads from Sales and Trends (`dayValues`).
 *
 * A snapshot holds the history up to its processing date, quiet days and all.
 * Ludo Wala's, in November 2026, had no rows for Oct 31 and Nov 1: Sales and
 * Trends had no report for Oct 31, and its one download on Nov 1 is the
 * second one App Analytics counts on Nov 2. A daily file holds the day before
 * its processing date and the few before that still filling in, so its days
 * run from its oldest recent row. An older date in it is a correction and
 * stands alone. A day between two files is no file's: Apple deletes a file
 * after 35 days, and developers report daily files that skip a day (forums,
 * thread 825231), so a zero there would be made up.
 */
export function instanceDays(processingDate: string, snapshot: boolean, rowDates: Iterable<DayString>): DayString[] {
  const dates = [...new Set(rowDates)].sort();
  const processed = normalizeDay(processingDate);
  if (!processed) return dates;
  if (snapshot) {
    if (dates.length === 0) return [];
    const last = dates[dates.length - 1];
    return dayRange(dates[0], last > processed ? last : processed);
  }
  const newest = addDays(processed, -1);
  const recentFrom = addDays(processed, -RECENT_DAYS);
  const from = dates.find((date) => date >= recentFrom && date <= newest) ?? newest;
  return [...new Set([...dates, ...dayRange(from, newest)])].sort();
}

/**
 * The newest day App Analytics covers, and the days between each report's
 * first and newest that no file has covered: deleted before a sync read
 * them, or never sent. `byReport` keeps the two reports apart for the digest,
 * because Sales and Trends can stand in for a missing downloads day and
 * nothing stands in for a missing impressions day.
 */
export function analyticsCoverage(records: DayRecord[]): {
  newest: DayString | null;
  missing: DayString[];
  byReport: Record<AnalyticsReportKind, DayString[]>;
} {
  const byDate = indexRecords(records);
  const missing = new Set<DayString>();
  const byReport: Record<AnalyticsReportKind, DayString[]> = { engagement: [], downloads: [] };
  let newest: DayString | null = null;
  for (const feed of ['engagement', 'downloads'] as const) {
    const days = records.filter((record) => record.feeds[feed] !== undefined).map((record) => record.date).sort();
    if (days.length === 0) continue;
    const last = days[days.length - 1];
    if (!newest || last > newest) newest = last;
    for (const date of dayRange(days[0], last)) {
      if (byDate.get(date)?.feeds[feed] !== undefined) continue;
      missing.add(date);
      byReport[feed].push(date);
    }
  }
  return { newest, missing: [...missing].sort(), byReport };
}

/**
 * Whether to ask Apple for a new snapshot: a report's snapshot has not been
 * read yet, or days are missing from the history. At most once in Apple's 31
 * days, or a day after a key that may not ask was refused. Exported for tests.
 */
export function snapshotDue(history: AnalyticsHistory, missingDays: number, now: number): boolean {
  if (history.snapshotRead?.engagement && history.snapshotRead.downloads && missingDays === 0) return false;
  if (!history.snapshotAskedAt) return true;
  return now - history.snapshotAskedAt >= (history.snapshotRefused ? DAY_MS : SNAPSHOT_EVERY_MS);
}

/**
 * Ask Apple for a snapshot of the app's history. Apple's answer is no failure
 * of the feed: the numbers read so far stand. A refused key or Apple's monthly
 * limit is noted, so the next ask waits; anything else is tried again by the
 * next sync.
 */
async function askForSnapshot(options: SyncOptions, history: AnalyticsHistory): Promise<void> {
  try {
    await createReportRequest(options.credentials, options.app.id, 'ONE_TIME_SNAPSHOT');
    history.snapshotRefused = false;
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    if (error instanceof AscForbiddenError) {
      history.snapshotRefused = true;
    } else if (/409|already exists|already have/i.test(describe(error))) {
      history.snapshotRefused = false;
    } else {
      console.error('Growth sync: asking Apple for an App Analytics snapshot failed', error);
      return;
    }
  }
  history.snapshotAskedAt = Date.now();
}

// --- ratings and the live listing ------------------------------------------------

/** Storefronts every sweep includes, then the app's busiest ones. */
const DEFAULT_STOREFRONTS = ['US', 'GB', 'DE', 'JP', 'FR', 'CA', 'AU', 'BR', 'IN', 'CN'];
const MAX_STOREFRONTS = 20;
/**
 * Star averages move slowly and the lookup service wants about 20 requests a
 * minute, so the full sweep runs at most this often. Every sync still looks
 * the app up once, which is what notices a new release.
 */
const RATINGS_EVERY_MS = 12 * 3_600_000;

async function syncRatings(options: SyncOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const appId = options.app.id;
  const records = await readDays(appId);
  const latest = records.reduce((max, record) => (record.date > max ? record.date : max), '');
  const busy = latest ? byTerritory(indexRecords(records), windowEndingAt(latest, 90)).map((row) => row.key) : [];
  // The storefront the app was last found in goes first: between sweeps only
  // the first is asked, and an app not sold in the US (or not yet selling
  // anywhere) would otherwise be looked for where it is not, which hides its
  // releases from the timeline until the next sweep.
  const lastLive = await readMeta<LiveListing & { territory?: string }>(metaKeys.live(appId));
  const everywhere = Array.from(
    new Set([...(lastLive?.territory ? [lastLive.territory] : []), ...busy.slice(0, MAX_STOREFRONTS), ...DEFAULT_STOREFRONTS])
  ).slice(0, MAX_STOREFRONTS);
  const lastSweep = (await readMeta<number>(metaKeys.ratingsSwept(appId))) ?? 0;
  const fullSweep = Date.now() - lastSweep > RATINGS_EVERY_MS;
  const storefronts = fullSweep ? everywhere : everywhere.slice(0, 1);

  const ratings: TerritoryRating[] = [];
  let live: LookupResult | null = null;
  let liveTerritory = '';
  let failuresInARow = 0;
  setProgress({ label: 'ratings', done: 0, total: storefronts.length });
  for (const [index, territory] of storefronts.entries()) {
    // lookupApp waits its turn (RATING_PACE_MS apart, shared with the competitors check).
    try {
      const result = await lookupApp(appId, territory, options.signal);
      if (result) {
        if (!live) {
          live = result;
          liveTerritory = territory;
        }
        if (result.averageUserRating !== null && result.userRatingCount) {
          ratings.push({
            key: `${appId}|${territory}`,
            appId,
            territory,
            average: result.averageUserRating,
            count: result.userRatingCount,
            currentAverage: result.averageUserRatingForCurrentVersion ?? undefined,
            currentCount: result.userRatingCountForCurrentVersion ?? undefined,
            checkedAt: Date.now(),
          });
        }
      }
      failuresInARow = 0;
    } catch (error) {
      if (isAbort(error, options.signal)) throw error;
      failuresInARow += 1;
      // Three refusals in a row is the rate limit: stop and keep what came back.
      if (failuresInARow >= 3 && ratings.length === 0) throw error;
      if (failuresInARow >= 3) break;
    }
    setProgress({ label: 'ratings', done: index + 1, total: storefronts.length });
  }
  await writeRatings(ratings);
  if (fullSweep) await writeMeta(metaKeys.ratingsSwept(appId), Date.now());

  if (live) {
    const snapshot: LiveListing = {
      version: live.version,
      releaseDate: normalizeDay(live.currentVersionReleaseDate),
      screenshotUrls: live.screenshotUrls,
      ipadScreenshotUrls: live.ipadScreenshotUrls,
      storeUrl: live.storeUrl,
      iconUrl: live.iconUrl,
      checkedAt: Date.now(),
    };
    await writeMeta(metaKeys.live(appId), { ...snapshot, territory: liveTerritory });
    await recordRelease(appId, snapshot);
  }

  // Between full sweeps the stored ratings from the last one are the answer.
  const known = fullSweep ? ratings : await readRatings(appId);
  if (known.length === 0) {
    // Not found is not "not on the store": an app can be sold in a few
    // countries only, and a sweep asks twenty.
    return { state: 'empty', message: live || lastLive ? 'No ratings yet' : 'Not found on the App Store in the countries checked' };
  }
  const count = known.reduce((sum, rating) => sum + rating.count, 0);
  return { state: 'ok', message: `${count.toLocaleString('en-US')} rating${count === 1 ? '' : 's'} in ${known.length} ${known.length === 1 ? 'country' : 'countries'}` };
}

/** A version the store shows that the timeline does not know yet becomes a release event. */
async function recordRelease(appId: string, live: LiveListing): Promise<void> {
  if (!live.version || !live.releaseDate) return;
  const events = await readEvents(appId);
  const id = `release:${appId}:${live.version}`;
  if (events.some((event) => event.id === id || (event.kind === 'release' && event.version === live.version))) return;
  const event: TimelineEvent = {
    id,
    appId,
    date: live.releaseDate,
    kind: 'release',
    title: `Version ${live.version} released`,
    version: live.version,
    origin: 'auto',
    createdAt: Date.now(),
  };
  await writeEvents([event]);
}
