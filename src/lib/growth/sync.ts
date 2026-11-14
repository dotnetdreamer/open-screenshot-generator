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
import { addDays, normalizeDay, today, windowEndingAt } from './dates';
import { reportText } from './delimited';
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
import type { FeedId, FeedStatus, GrowthFeed, SyncProgress, SyncStatus, TerritoryRating, TimelineEvent } from './types';

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

/** Merge each day into what is stored, inside the lock. */
export async function mergeAndWrite(entries: Array<{ appId: string; date: string; feed: FeedId; day: ReturnType<typeof emptyFeedDay> }>): Promise<void> {
  if (entries.length === 0) return;
  await withDayLock(async () => {
    const now = Date.now();
    const writes = [];
    for (const entry of entries) {
      writes.push(mergeFeed(await readDay(entry.appId, entry.date), entry.appId, entry.date, entry.feed, entry.day, now));
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

async function ensureRequests(options: SyncOptions): Promise<{ requests: ReportRequest[]; refusedCreate: boolean }> {
  const appId = options.app.id;
  let requests = await listReportRequests(options.credentials, appId, options.signal);
  let refusedCreate = false;
  const live = requests.filter((request) => !request.stoppedDueToInactivity);
  const tryCreate = async (accessType: 'ONGOING' | 'ONE_TIME_SNAPSHOT') => {
    try {
      const created = await createReportRequest(options.credentials, appId, accessType);
      requests = [...requests, created];
    } catch (error) {
      if (error instanceof AscForbiddenError) refusedCreate = true;
      else if (!/409|already exists|duplicate/i.test(describe(error))) throw error;
    }
  };
  if (!live.some((request) => request.accessType === 'ONGOING')) await tryCreate('ONGOING');
  // History before the ongoing request began. Apple makes it once.
  if (!requests.some((request) => request.accessType === 'ONE_TIME_SNAPSHOT')) await tryCreate('ONE_TIME_SNAPSHOT');
  return { requests: requests.filter((request) => !request.stoppedDueToInactivity), refusedCreate };
}

async function syncAnalytics(options: SyncOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const appId = options.app.id;
  let requests: ReportRequest[];
  let refusedCreate = false;
  try {
    ({ requests, refusedCreate } = await ensureRequests(options));
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
  const targets: Array<{ reportId: string; kind: AnalyticsReportKind }> = [];
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
      if (reportId) targets.push({ reportId, kind });
    }
  }

  const done = { ...((await readMeta<Record<string, string>>(metaKeys.analyticsDone(appId))) ?? {}) };
  const queue: Array<{ instanceId: string; processingDate: string; kind: AnalyticsReportKind }> = [];
  for (const target of targets) {
    for (const instance of await listInstances(options.credentials, target.reportId, options.signal)) {
      if (!done[instance.id]) queue.push({ instanceId: instance.id, processingDate: instance.processingDate, kind: target.kind });
    }
  }
  // Oldest first, so a later instance's corrections land last and win.
  queue.sort((a, b) => a.processingDate.localeCompare(b.processingDate));
  const batch = queue.slice(0, MAX_INSTANCES_PER_SYNC);

  const anyDone = Object.keys(done).length > 0;
  if (batch.length === 0 && !anyDone) {
    return { state: 'pending', message: 'Apple is getting App Analytics ready. The first numbers usually come within two days' };
  }

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
    await mergeAndWrite(Array.from(combined, ([date, day]) => ({ appId, date, feed, day })));
    done[item.instanceId] = item.processingDate;
    processed += 1;
    setProgress({ label: 'App Analytics', done: processed, total: batch.length });
    if (processed % 10 === 0) {
      await writeMeta(metaKeys.analyticsDone(appId), done);
      announceGrowthChange(appId);
    }
  }
  await writeMeta(metaKeys.analyticsDone(appId), done);

  const remaining = queue.length - batch.length;
  const latest = Object.values(done).sort().pop();
  return {
    state: 'ok',
    message: remaining > 0
      ? `Loaded ${processed} files from Apple. Files left for the next refresh: ${remaining}`
      : latest
        ? `Loaded up to ${latest}`
        : 'Up to date',
  };
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
