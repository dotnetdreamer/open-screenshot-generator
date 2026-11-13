// Fetching everything for one Google Play app and folding it into the local
// database, the counterpart of sync.ts for the App Store.
//
// Three sources, each failing on its own like Apple's feeds:
//
//   listing    the store page, read through an edit that is never committed
//   reviews    the Reviews API: reviews written or changed in the last week
//   reports    the monthly report files in the account's Cloud Storage
//              bucket: installs, store listing visitors and acquisitions,
//              ratings, and every month's reviews. These need the bucket's
//              address (Setup) and a permission on the service account.
//
// The report files are rewritten as a month fills, so each one is read again
// only when Cloud Storage says it changed since the last read. A month's
// numbers replace what that month had before (records.ts), so reading a file
// twice never doubles anything.

import type { PlayCredentials } from '@/lib/publish/types';
import { combineBatches } from './analyticsReport';
import { addDays, formatDay, today } from './dates';
import { announceGrowthChange, readDays, readMeta, readRatings, readReviews, writeListing, writeMeta, writeRatings, writeReviews } from './db';
import { formatRating } from './format';
import {
  PlayAuthError,
  PlayForbiddenError,
  PlayNotFoundError,
  downloadReportObject,
  fetchPlayListing,
  fetchPlayReviews,
  listReportObjects,
  type ReportObject,
} from './play';
import {
  fillMonthDays,
  parseInstallsReport,
  parseRatingsReport,
  parseReviewsReport,
  parseStorePerformanceByCountry,
  parseStorePerformanceBySource,
  playReportText,
  reportFile,
  reportPrefix,
  type PlayReportKind,
} from './playReports';
import type { FeedBatch } from './records';
import { packageOf } from './stores';
import { IDLE_STATUS, describe, exclusiveSync, isAbort, mergeAndWrite, metaKeys, type LiveListing } from './sync';
import type { FeedId, FeedStatus, GrowthApp, GrowthFeed, StoreReview, SyncProgress, SyncStatus, TerritoryRating } from './types';

export interface PlaySyncOptions {
  credentials: PlayCredentials;
  /** The Google Play app, `play:` and its package name (stores.ts). */
  app: GrowthApp;
  /** The reports bucket's name, from the Cloud Storage URI under Setup. */
  bucket?: string | null;
  historyDays: number;
  feeds?: GrowthFeed[];
  signal?: AbortSignal;
  onStatus?: (status: SyncStatus) => void;
  onProgress?: (progress: SyncProgress | null) => void;
}

/** Sync one Google Play app. One at a time per app, as syncApp does for the App Store. */
export function syncPlayApp(options: PlaySyncOptions): Promise<SyncStatus> {
  return exclusiveSync(options.app.id, () => runPlaySync(options));
}

const NO_BUCKET = 'Add your Cloud Storage URI under Setup to see downloads, page visits and ratings';
const NO_REPORT_ACCESS =
  'Your service account cannot read the report files. In Play Console, under Users and permissions, give the service account the View app information permission for the whole account. The permission can take a day or more to work';

async function runPlaySync(options: PlaySyncOptions): Promise<SyncStatus> {
  const appId = options.app.id;
  const wanted = new Set<GrowthFeed>(options.feeds ?? ['listing', 'reviews', 'analytics', 'ratings']);
  // Google Play has no Sales and Trends: that line stays as it is.
  wanted.delete('sales');
  const status: SyncStatus = { ...IDLE_STATUS, ...((await readMeta<SyncStatus>(metaKeys.status(appId))) ?? {}) };
  for (const feed of wanted) status[feed] = { ...status[feed], state: 'syncing' };
  const emit = () => options.onStatus?.({ ...status });
  emit();
  const setProgress = (value: SyncProgress | null) => options.onProgress?.(value);

  let authFailure: string | null = null;
  const settle = (feed: GrowthFeed, value: FeedStatus) => {
    status[feed] = { ...value, updatedAt: Date.now() };
    emit();
  };
  const failure = (error: unknown): FeedStatus => {
    if (isAbort(error, options.signal)) return { state: 'idle', message: 'The refresh was stopped' };
    if (error instanceof PlayAuthError) {
      authFailure = error.message;
      return { state: 'error', message: error.message };
    }
    console.error('Growth sync of a Google Play app failed', error);
    return { state: 'error', message: describe(error) };
  };
  const run = async (feed: GrowthFeed, task: () => Promise<FeedStatus>) => {
    if (!wanted.has(feed)) return;
    if (authFailure) return settle(feed, { state: 'error', message: authFailure });
    try {
      settle(feed, await task());
    } catch (error) {
      settle(feed, failure(error));
    } finally {
      setProgress(null);
    }
    announceGrowthChange(appId);
  };

  await run('listing', () => syncListing(options));
  await run('reviews', () => syncReviews(options, setProgress));

  if (wanted.has('analytics') || wanted.has('ratings')) {
    const bucket = options.bucket?.trim();
    if (authFailure) {
      if (wanted.has('analytics')) settle('analytics', { state: 'error', message: authFailure });
      if (wanted.has('ratings')) settle('ratings', { state: 'error', message: authFailure });
    } else if (!bucket) {
      if (wanted.has('analytics')) settle('analytics', { state: 'needs-setup', message: NO_BUCKET });
      if (wanted.has('ratings')) settle('ratings', { state: 'needs-setup', message: NO_BUCKET });
    } else {
      try {
        const result = await syncReports(options, bucket, setProgress);
        if (wanted.has('analytics')) settle('analytics', result.numbers);
        if (wanted.has('ratings')) settle('ratings', result.ratings);
        // Reviews from the monthly files fill in what the Reviews API no
        // longer hands out, so the reviews line counts them too.
        if (result.reviewsAdded > 0 && status.reviews.state !== 'error' && status.reviews.state !== 'forbidden') {
          const total = (await readReviews(appId)).length;
          settle('reviews', { state: 'ok', message: `${total} written review${total === 1 ? '' : 's'}` });
        }
      } catch (error) {
        const reason =
          error instanceof PlayForbiddenError
            ? { state: 'forbidden' as const, message: NO_REPORT_ACCESS }
            : error instanceof PlayNotFoundError
              ? { state: 'error' as const, message: 'Google could not find that Cloud Storage bucket. Copy the Cloud Storage URI again in Play Console, under Manage account, then Play apps reports' }
              : failure(error);
        if (wanted.has('analytics')) settle('analytics', reason);
        if (wanted.has('ratings')) settle('ratings', reason);
      } finally {
        setProgress(null);
      }
      announceGrowthChange(appId);
    }
  }

  options.onProgress?.(null);
  await writeMeta(metaKeys.status(appId), status);
  if (!options.signal?.aborted) await writeMeta(metaKeys.lastSync(appId), Date.now());
  announceGrowthChange(appId);
  return status;
}

// --- the store page ----------------------------------------------------------------

async function syncListing(options: PlaySyncOptions): Promise<FeedStatus> {
  try {
    const result = await fetchPlayListing(options.credentials, options.app.id, options.signal);
    if (!result) return { state: 'empty', message: 'Your app has no store page on Google Play yet' };
    await writeListing(result.listing);
    const live: LiveListing = {
      version: '',
      releaseDate: null,
      screenshotUrls: result.images.screenshotUrls,
      ipadScreenshotUrls: [],
      storeUrl: result.images.storeUrl,
      iconUrl: result.images.iconUrl,
      checkedAt: Date.now(),
    };
    await writeMeta(metaKeys.live(options.app.id), live);
    const primary = result.listing.locales.find((entry) => entry.locale === result.listing.primaryLocale);
    await writeMeta(metaKeys.playApp(options.app.id), { name: primary?.name || options.app.name, iconUrl: result.images.iconUrl });
    const count = result.listing.locales.length;
    return { state: 'ok', message: `${count} language${count === 1 ? '' : 's'}` };
  } catch (error) {
    if (error instanceof PlayForbiddenError) {
      return { state: 'forbidden', message: 'Your service account cannot load the store page. In Play Console, give the service account access to this app' };
    }
    if (error instanceof PlayNotFoundError) {
      return {
        state: 'error',
        message: `Google Play does not know the package ${packageOf(options.app.id) ?? ''}. Check the package name under Setup`,
      };
    }
    throw error;
  }
}

// --- reviews ------------------------------------------------------------------------

async function syncReviews(options: PlaySyncOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const appId = options.app.id;
  setProgress({ label: 'reviews', done: 0, total: 1 });
  try {
    const fresh = await fetchPlayReviews(options.credentials, appId, { signal: options.signal });
    await writeReviews(fresh);
    const total = (await readReviews(appId)).length;
    if (total === 0) return { state: 'empty', message: 'No written reviews in the last 7 days' };
    return { state: 'ok', message: `${total} written review${total === 1 ? '' : 's'}` };
  } catch (error) {
    if (error instanceof PlayForbiddenError) {
      return { state: 'forbidden', message: 'Your service account cannot load reviews. In Play Console, give the service account the permission to reply to reviews' };
    }
    throw error;
  }
}

// --- the report files ----------------------------------------------------------------

interface ReportsResult {
  numbers: FeedStatus;
  ratings: FeedStatus;
  reviewsAdded: number;
}

interface ReportGroup {
  feed: FeedId;
  month: string;
  files: ReportObject[];
}

function monthOf(day: string): string {
  return day.slice(0, 7).replace('-', '');
}

async function syncReports(options: PlaySyncOptions, bucket: string, setProgress: (value: SyncProgress | null) => void): Promise<ReportsResult> {
  const appId = options.app.id;
  const packageName = packageOf(appId) ?? options.credentials.packageName.trim();
  const kinds: PlayReportKind[] = ['installs', 'visits-country', 'ratings-overview', 'reviews'];
  // One listing per folder: the two store performance files share one, as do the two ratings files.
  const listed: ReportObject[] = [];
  for (const kind of kinds) listed.push(...(await listReportObjects(options.credentials, bucket, reportPrefix(kind, packageName), options.signal)));

  const files = listed
    .map((object) => ({ object, info: reportFile(object.name, packageName) }))
    .filter((entry): entry is { object: ReportObject; info: NonNullable<ReturnType<typeof reportFile>> } => !!entry.info);
  if (files.length === 0) {
    const none = { state: 'pending' as const, message: 'Google has not made report files for your app yet. New apps get the first files after a few days' };
    return { numbers: none, ratings: none, reviewsAdded: 0 };
  }

  const read = { ...((await readMeta<Record<string, string>>(metaKeys.playFiles(appId))) ?? {}) };
  const firstMonth = monthOf(addDays(today(), -Math.max(30, options.historyDays)));
  const changed = (object: ReportObject) => read[object.name] !== object.updated;

  // Numbers: a month is read again when any of its files changed.
  const groups = new Map<string, ReportGroup>();
  for (const { object, info } of files) {
    const feed: FeedId | null = info.kind === 'installs' ? 'installs' : info.kind.startsWith('visits') ? 'visits' : null;
    if (!feed || info.month < firstMonth) continue;
    const key = `${feed}:${info.month}`;
    const group = groups.get(key) ?? { feed, month: info.month, files: [] };
    group.files.push(object);
    groups.set(key, group);
  }
  const numberWork = Array.from(groups.values())
    .filter((group) => group.files.some(changed))
    .sort((a, b) => a.month.localeCompare(b.month));
  // Ratings: only the newest two months matter, since the newest day wins.
  const ratingFiles = files
    .filter((entry) => entry.info.kind === 'ratings-overview' || entry.info.kind === 'ratings-country')
    .sort((a, b) => b.info.month.localeCompare(a.info.month));
  const ratingMonths = Array.from(new Set(ratingFiles.map((entry) => entry.info.month))).slice(0, 2);
  const ratingWork = ratingFiles.filter((entry) => ratingMonths.includes(entry.info.month));
  const ratingsChanged = ratingWork.some((entry) => changed(entry.object));
  const reviewWork = files.filter((entry) => entry.info.kind === 'reviews' && entry.info.month >= firstMonth && changed(entry.object));

  const total = numberWork.reduce((sum, group) => sum + group.files.length, 0) + (ratingsChanged ? ratingWork.length : 0) + reviewWork.length;
  let done = 0;
  const step = () => {
    done += 1;
    setProgress({ label: 'Google Play reports', done, total });
  };
  setProgress({ label: 'Google Play reports', done, total });

  const download = async (object: ReportObject) => {
    const text = await playReportText(await downloadReportObject(options.credentials, bucket, object.name, options.signal));
    step();
    return text;
  };

  for (const group of numberWork) {
    const batches: FeedBatch[] = [];
    for (const object of group.files) {
      const info = reportFile(object.name, packageName);
      const text = await download(object);
      if (info?.kind === 'installs') batches.push(parseInstallsReport(text));
      else if (info?.kind === 'visits-country') batches.push(parseStorePerformanceByCountry(text));
      else if (info?.kind === 'visits-source') batches.push(parseStorePerformanceBySource(text));
    }
    const combined = fillMonthDays(combineBatches(batches));
    await mergeAndWrite(Array.from(combined, ([date, day]) => ({ appId, date, feed: group.feed, day })));
    for (const object of group.files) read[object.name] = object.updated;
    await writeMeta(metaKeys.playFiles(appId), read);
    announceGrowthChange(appId);
  }

  if (ratingsChanged) {
    const now = Date.now();
    const newest = new Map<string, TerritoryRating>();
    // Oldest month first, so the newest month's averages win.
    for (const entry of [...ratingWork].reverse()) {
      for (const rating of parseRatingsReport(await download(entry.object), appId, now)) newest.set(rating.territory, rating);
    }
    await writeRatings(Array.from(newest.values()));
    for (const entry of ratingWork) read[entry.object.name] = entry.object.updated;
    await writeMeta(metaKeys.playFiles(appId), read);
  }

  let reviewsAdded = 0;
  if (reviewWork.length > 0) {
    // A review the Reviews API sent is newer than the month's file, so it is kept as it is.
    const known = new Map((await readReviews(appId)).map((review) => [review.id, review]));
    for (const entry of reviewWork) {
      const fromFile = parseReviewsReport(await download(entry.object), appId);
      const keep: StoreReview[] = fromFile.filter((review) => {
        const stored = known.get(review.id);
        return !stored || (stored.createdDate || '') < (review.createdDate || '');
      });
      reviewsAdded += keep.filter((review) => !known.has(review.id)).length;
      for (const review of keep) known.set(review.id, review);
      await writeReviews(keep);
      read[entry.object.name] = entry.object.updated;
      await writeMeta(metaKeys.playFiles(appId), read);
    }
  }

  const hasNumberFiles = files.some((entry) => entry.info.kind === 'installs' || entry.info.kind.startsWith('visits'));
  const newest = (await readDays(appId))
    .filter((record) => record.feeds.installs !== undefined || record.feeds.visits !== undefined)
    .reduce((max, record) => (record.date > max ? record.date : max), '');
  const ratings = await readRatings(appId);
  return {
    numbers: !hasNumberFiles
      ? { state: 'pending', message: 'Google has not made the download and page visit files for your app yet' }
      : { state: 'ok', message: newest ? `Numbers up to ${formatDay(newest, { withYear: true })}` : 'Up to date' },
    ratings: ratings.length === 0 ? { state: 'empty', message: 'No ratings yet' } : { state: 'ok', message: ratingsMessage(ratings) },
    reviewsAdded,
  };
}

function ratingsMessage(ratings: TerritoryRating[]): string {
  const overall = ratings.find((rating) => rating.territory === 'ZZ');
  const countries = ratings.filter((rating) => rating.territory !== 'ZZ').length;
  const average = overall ? `${formatRating(overall.average)} stars on average` : 'Ratings loaded';
  return countries > 0 ? `${average}, ratings from ${countries} ${countries === 1 ? 'country' : 'countries'}` : average;
}
