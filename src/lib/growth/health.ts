// App health: how often the app crashes and freezes, by version and day, from
// each store's own numbers, so the ratings screen can put them beside the
// ratings and the reviews that mention crashes.
//
// App Store: two reports of the App Analytics request Growth already keeps
// (healthSync.ts reads them), measured on Ludo Wala in November 2026:
//
//   App Crashes             Date, App Name, App Apple Identifier, App Version,
//                           Device, Platform Version, Crashes, Unique Devices
//   App Sessions Standard   Date, App Name, App Apple Identifier, App Version,
//                           Device, Platform Version, Source Type, Page Type,
//                           App Download Date, Territory, Sessions,
//                           Total Session Duration, Unique Devices
//
// Both count only people who share analytics with developers, and Apple sends
// a report only once events exist from at least five of them. App Crashes
// counts crashes that left a crash log. The crash rate here is crashes per
// session of those same people, shown per 1,000 sessions. None of the
// account's four apps had an App Crashes file then, so "no numbers" has to
// read as "fewer than five people", never as "no crashes".
//
// Freezes on the App Store are Xcode's hang rate, from the power and
// performance metrics (GET /v1/apps/{id}/perfPowerMetrics?filter[metricType]=
// HANG): a value per version for the newest versions, no days. The answer's
// shape is Apple's documented example (a launch time one); no app on the
// account had hang data, so the metric is read by category, never by name,
// and its unit is printed as Apple writes it.
//
// Google Play: Android vitals from the Play Developer Reporting API, per day
// (Google's days are in America/Los_Angeles) and per build (versionCode):
// userPerceivedCrashRate and userPerceivedAnrRate, the share of the day's
// users who had a crash or a freeze while using the app, each with the
// distinctUsers it divides by. Google's own lines are 1.09% and 0.47%; above
// them Google Play can show an app to fewer people. Google sends rates as
// shares with four decimals ("0.0090"), and distinctUsers in steps of ten
// (measured on Ludo Wala, 2026-11-16). Vitals name a build only: its version
// comes from the reviews, which carry both (playVersionNames). A Play Console
// release name is mostly typed by the developer ("New help form"), so it is
// shown beside the version, never as it.
//
// This file holds the parts without storage. healthSync.ts fetches and
// stores; GrowthHealth.tsx draws.

import { addDays, dayRange, normalizeDay, today, type DayWindow } from './dates';
import { columnIndex, numberCell, parseDelimited } from './delimited';
import { bucketsIn, ratingBuckets, type RatingGranularity } from './ratingHistory';
import { reviewDay, topicsOf } from './reviewTopics';
import type { DayString, RatingDay, StoreReview } from './types';

export type HealthStore = 'appstore' | 'playstore';

/** The version key of every version together. Apple's are added up; Google's come from a query of their own. */
export const ALL_VERSIONS = '*';

/** Google Play's bad behavior thresholds for the share of users with a crash, and with a freeze. */
export const GOOGLE_CRASH_LINE = 0.0109;
export const GOOGLE_FREEZE_LINE = 0.0047;

/** Below these a rate is shown, but too thin to compare two versions by. */
export const MIN_SESSIONS = 200;
export const MIN_USER_DAYS = 200;
/**
 * The share of an App Store version's days with sessions that need crash
 * numbers too before its rate is compared. Apple sends no crash file for a
 * day under its five-people line (the test account had sessions files and no
 * crash file at all), so a rate over the reported days alone runs high.
 */
export const MIN_CRASH_COVERAGE = 0.75;

/** One version on one day, or every version (ALL_VERSIONS). Only the fields its store has are set. */
export interface HealthPoint {
  /** App Store: sessions of the people who share analytics. */
  sessions?: number;
  /** App Store: crashes among those people that left a crash log. */
  crashes?: number;
  /** App Store: devices that crashed, added up over the device and OS rows. */
  crashDevices?: number;
  /** Google Play: the day's users of this build (the crash metric set's distinctUsers). */
  users?: number;
  /** Google Play: the share of them who had a crash while using the app, 0 to 1. */
  crashRate?: number;
  /** Google Play: the users the freeze rate divides by (the ANR metric set's distinctUsers). */
  anrUsers?: number;
  /** Google Play: the share of them who had a freeze while using the app, 0 to 1. */
  anrRate?: number;
}

export interface HangReading {
  /** As Apple wrote it, such as "s/hr". */
  unit: string;
  points: Array<{ version: string; value: number }>;
  /** Apple's own sentence about a change in the hang rate, when Apple wrote one. */
  summary?: string;
}

/** What Growth keeps of one app's health, a meta row of its own (healthKey). */
export interface AppHealth {
  appId: string;
  store: HealthStore;
  /** Day, then version key, then the numbers. */
  days: Record<DayString, Record<string, HealthPoint>>;
  /** App Store: the days a crash file answered for. Only on those is a missing crash row a zero. */
  crashDays?: DayString[];
  /** Google Play: build number to the name of the Play Console release that carries it, as typed (releaseNamesOf). */
  releaseNames?: Record<string, string>;
  hangs?: HangReading;
  /** The newest day the store's numbers reach. */
  through?: DayString;
  readAt: number;
}

export const healthKey = (appId: string) => `health:${appId}`;

export function emptyHealth(appId: string, store: HealthStore): AppHealth {
  return { appId, store, days: {}, readAt: 0 };
}

// --- reading the App Store's files ---------------------------------------------------

export type HealthReportKind = 'crashes' | 'sessions';

/**
 * Which report a name from /v1/analyticsReportRequests/{id}/reports is, if it
 * is one of the two app health reads. Names as Apple listed them on Ludo Wala:
 * "App Crashes" has no Standard or Detailed level; "App Sessions Standard" is
 * read, never "Detailed" (the same sessions split finer, so reading both would
 * double them) nor "Context" (devices only). "App Crashes Expanded" is iOS
 * only and has no sessions to divide by.
 */
export function healthReportKind(name: string): HealthReportKind | null {
  const text = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text === 'app crashes') return 'crashes';
  if (text === 'app sessions standard') return 'sessions';
  return null;
}

/** A file's numbers: day, then version, then the fields that file reports. */
export type HealthRows = Map<DayString, Map<string, HealthPoint>>;

function rowsFor(rows: HealthRows, day: DayString, version: string): HealthPoint {
  let versions = rows.get(day);
  if (!versions) {
    versions = new Map();
    rows.set(day, versions);
  }
  let point = versions.get(version);
  if (!point) {
    point = {};
    versions.set(version, point);
  }
  return point;
}

function appFilter(header: string[], appId?: string): (row: string[]) => boolean {
  const index = columnIndex(header, 'App Apple Identifier', 'Apple Identifier', 'App ID');
  if (!appId || index < 0) return () => true;
  return (row) => {
    const value = (row[index] ?? '').trim();
    return !value || value === appId;
  };
}

/** App Crashes: crashes and crashed devices per day and version. Rows are already split by device and OS, so they add up. */
export function parseCrashesReport(text: string, options: { appId?: string } = {}): HealthRows {
  const { header, rows } = parseDelimited(text);
  const col = {
    date: columnIndex(header, 'Date'),
    version: columnIndex(header, 'App Version'),
    crashes: columnIndex(header, 'Crashes'),
    devices: columnIndex(header, 'Unique Devices'),
  };
  const out: HealthRows = new Map();
  if (col.date < 0 || col.version < 0 || col.crashes < 0) return out;
  const keep = appFilter(header, options.appId);
  for (const row of rows) {
    if (!keep(row)) continue;
    const day = normalizeDay(row[col.date]);
    const version = (row[col.version] ?? '').trim();
    if (!day || !version) continue;
    const point = rowsFor(out, day, version);
    point.crashes = (point.crashes ?? 0) + numberCell(row[col.crashes]);
    if (col.devices >= 0) point.crashDevices = (point.crashDevices ?? 0) + numberCell(row[col.devices]);
  }
  return out;
}

/** App Sessions Standard: sessions per day and version, added up over every device, source and country row. */
export function parseSessionsReport(text: string, options: { appId?: string } = {}): HealthRows {
  const { header, rows } = parseDelimited(text);
  const col = {
    date: columnIndex(header, 'Date'),
    version: columnIndex(header, 'App Version'),
    sessions: columnIndex(header, 'Sessions'),
  };
  const out: HealthRows = new Map();
  if (col.date < 0 || col.version < 0 || col.sessions < 0) return out;
  const keep = appFilter(header, options.appId);
  for (const row of rows) {
    if (!keep(row)) continue;
    const day = normalizeDay(row[col.date]);
    const version = (row[col.version] ?? '').trim();
    if (!day || !version) continue;
    const point = rowsFor(out, day, version);
    point.sessions = (point.sessions ?? 0) + numberCell(row[col.sessions]);
  }
  return out;
}

/** Add one segment's rows to the rest of the same file: a file split in segments has distinct rows in each. */
export function addHealthRows(into: HealthRows, from: HealthRows): HealthRows {
  for (const [day, versions] of from) {
    for (const [version, point] of versions) {
      const target = rowsFor(into, day, version);
      for (const [field, value] of Object.entries(point) as Array<[keyof HealthPoint, number]>) {
        if (field === 'crashRate' || field === 'anrRate') target[field] = value;
        else target[field] = (target[field] ?? 0) + value;
      }
    }
  }
  return into;
}

const FIELDS: Record<'crashes' | 'sessions' | 'crash' | 'anr', Array<keyof HealthPoint>> = {
  crashes: ['crashes', 'crashDevices'],
  sessions: ['sessions'],
  crash: ['users', 'crashRate'],
  anr: ['anrUsers', 'anrRate'],
};

/**
 * Put one source's numbers in. On every day the source answers for, its own
 * fields are REPLACED for every version (a later file corrects an earlier
 * one, and reading a file twice never doubles a number), and the other
 * sources' fields stay. A day the source does not answer for is left alone.
 */
export function mergeHealth(health: AppHealth, source: keyof typeof FIELDS, rows: HealthRows, covered: Iterable<DayString>): AppHealth {
  const fields = FIELDS[source];
  const days: AppHealth['days'] = { ...health.days };
  const answered = new Set<DayString>([...covered, ...rows.keys()]);
  for (const day of answered) {
    const before = days[day] ?? {};
    const after: Record<string, HealthPoint> = {};
    for (const [version, point] of Object.entries(before)) {
      const kept: HealthPoint = { ...point };
      for (const field of fields) delete kept[field];
      if (Object.keys(kept).length > 0) after[version] = kept;
    }
    for (const [version, point] of rows.get(day) ?? []) {
      const kept: HealthPoint = { ...(after[version] ?? {}) };
      for (const field of fields) if (point[field] !== undefined) kept[field] = point[field];
      after[version] = kept;
    }
    if (Object.keys(after).length > 0) days[day] = after;
    else delete days[day];
  }
  const next: AppHealth = { ...health, days };
  if (source === 'crashes') next.crashDays = [...new Set([...(health.crashDays ?? []), ...answered])].sort();
  const newest = [...answered].sort().pop();
  if (newest && (!next.through || newest > next.through)) next.through = newest;
  return next;
}

// --- reading Google Play's vitals ----------------------------------------------------

interface VitalsDecimal {
  value?: string;
}
interface VitalsRowBody {
  startTime?: { year?: number; month?: number; day?: number };
  dimensions?: Array<{ dimension?: string; stringValue?: string; int64Value?: string }>;
  metrics?: Array<{ metric?: string; decimalValue?: VitalsDecimal }>;
}

/**
 * How Google writes a rate. The reference calls the rates a "percentage of
 * distinct users"; what it sends is a share: Ludo Wala's "0.0185" for Nov 14
 * is the 1.85% Play Console shows for that day (checked 2026-11-16). This
 * factor turns it into a share from 0 to 1.
 */
export const VITALS_RATE_SCALE = 1;

/** The day a vitals row starts, as YYYY-MM-DD in Google's own time zone. */
function vitalsDay(time: VitalsRowBody['startTime']): DayString | null {
  if (!time?.year || !time.month || !time.day) return null;
  return `${String(time.year).padStart(4, '0')}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

/**
 * The rows of one vitals query, as health rows: the rate and the users it
 * divides by, per day and build, or for every build (ALL_VERSIONS) when the
 * query had no versionCode dimension.
 */
export function readVitalsRows(body: unknown, kind: 'crash' | 'anr'): HealthRows {
  const out: HealthRows = new Map();
  const rows = (body as { rows?: VitalsRowBody[] } | null)?.rows;
  if (!Array.isArray(rows)) return out;
  const rateMetric = kind === 'crash' ? 'userPerceivedCrashRate' : 'userPerceivedAnrRate';
  for (const row of rows) {
    const day = vitalsDay(row.startTime);
    if (!day) continue;
    const dimension = row.dimensions?.find((entry) => entry.dimension === 'versionCode');
    const version = dimension ? (dimension.int64Value ?? dimension.stringValue ?? '').trim() : ALL_VERSIONS;
    if (!version) continue;
    const metric = (name: string) => {
      const raw = row.metrics?.find((entry) => entry.metric === name)?.decimalValue?.value;
      if (raw === undefined || raw === null) return null;
      const value = raw === '' ? 0 : Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const rate = metric(rateMetric);
    const users = metric('distinctUsers');
    if (rate === null || users === null) continue;
    const point = rowsFor(out, day, version);
    if (kind === 'crash') {
      point.crashRate = Math.max(0, rate * VITALS_RATE_SCALE);
      point.users = users;
    } else {
      point.anrRate = Math.max(0, rate * VITALS_RATE_SCALE);
      point.anrUsers = users;
    }
  }
  return out;
}

/** Build number to release name, from Play's tracks (GET .../edits/{id}/tracks): production first. */
export function releaseNamesOf(body: unknown): Record<string, string> {
  const tracks = (body as { tracks?: Array<{ track?: string; releases?: Array<{ name?: string; versionCodes?: string[] }> }> } | null)?.tracks;
  const out: Record<string, string> = {};
  if (!Array.isArray(tracks)) return out;
  const ordered = [...tracks].sort((a, b) => Number(b.track === 'production') - Number(a.track === 'production'));
  for (const track of ordered) {
    for (const release of track.releases ?? []) {
      const name = (release.name ?? '').trim();
      if (!name) continue;
      for (const code of release.versionCodes ?? []) {
        const key = String(code).trim();
        if (key && !out[key]) out[key] = name;
      }
    }
  }
  return out;
}

// --- reading Apple's hang rate -------------------------------------------------------

interface XcodeMetricsBody {
  productData?: Array<{
    platform?: string;
    metricCategories?: Array<{
      identifier?: string;
      metrics?: Array<{
        identifier?: string;
        unit?: { displayName?: string; identifier?: string };
        datasets?: Array<{ filterCriteria?: { device?: string; percentile?: string }; points?: Array<{ version?: string; value?: number }> }>;
      }>;
    }>;
  }>;
  insights?: Record<string, Array<{ metricCategory?: string; summaryString?: string }> | undefined>;
}

/**
 * The hang rate per version from an xcode-metrics answer: the HANG category's
 * metric, the dataset for every iPhone at the 50th percentile (Apple's
 * "typical") when there is one, else the first. Null when Apple has none.
 */
export function readHangMetrics(body: unknown, category = 'HANG'): HangReading | null {
  const metrics = body as XcodeMetricsBody | null;
  for (const product of metrics?.productData ?? []) {
    const found = product.metricCategories?.find((entry) => entry.identifier === category);
    const metric = found?.metrics?.find((entry) => (entry.datasets ?? []).some((set) => (set.points ?? []).length > 0));
    if (!metric) continue;
    const sets = metric.datasets ?? [];
    const typical =
      sets.find((set) => set.filterCriteria?.percentile === 'percentile.fifty' && set.filterCriteria?.device === 'all_iphones') ??
      sets.find((set) => set.filterCriteria?.percentile === 'percentile.fifty') ??
      sets[0];
    const points = (typical?.points ?? [])
      .filter((point): point is { version: string; value: number } => typeof point.version === 'string' && typeof point.value === 'number' && Number.isFinite(point.value))
      .map((point) => ({ version: point.version.trim(), value: point.value }));
    if (points.length === 0) continue;
    const summary = Object.values(metrics?.insights ?? {})
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .find((entry) => entry.metricCategory === category && entry.summaryString)?.summaryString;
    return { unit: metric.unit?.displayName || metric.unit?.identifier || '', points, ...(summary ? { summary } : {}) };
  }
  return null;
}

// --- rates ----------------------------------------------------------------------------

/** A rate over some days, and what it was worked out from. */
export interface RateOver {
  /** A share: crashes per session on the App Store, users with a crash on Google Play. Null with nothing to divide by. */
  rate: number | null;
  /** Sessions (App Store) or user days (Google Play): the more, the steadier the rate. */
  volume: number;
  /** App Store: the crashes counted. */
  events?: number;
  /** App Store: the days with sessions, and how many of them a crash file answered for (only those are counted). */
  days?: number;
  coveredDays?: number;
}

function pointsOn(health: AppHealth, day: DayString, version: string): HealthPoint[] {
  const versions = health.days[day];
  if (!versions) return [];
  if (version !== ALL_VERSIONS) return versions[version] ? [versions[version]] : [];
  // Apple's every version is the sum of its versions; Google sends its own row.
  if (health.store === 'playstore') return versions[ALL_VERSIONS] ? [versions[ALL_VERSIONS]] : [];
  return Object.entries(versions)
    .filter(([key]) => key !== ALL_VERSIONS)
    .map(([, point]) => point);
}

/**
 * The crash rate over some days. App Store: crashes over sessions, on the
 * days a crash file answered for. Google Play: the day rates weighted by
 * their users, as Google's own 7 and 28 day averages are.
 */
export function crashOver(health: AppHealth, days: Iterable<DayString>, version: string = ALL_VERSIONS): RateOver {
  if (health.store === 'appstore') {
    const crashDays = new Set(health.crashDays ?? []);
    let sessions = 0;
    let crashes = 0;
    let used = 0;
    let covered = 0;
    for (const day of days) {
      const points = pointsOn(health, day, version);
      const daySessions = points.reduce((sum, point) => sum + (point.sessions ?? 0), 0);
      if (daySessions > 0) used += 1;
      if (!crashDays.has(day)) continue;
      if (daySessions > 0) covered += 1;
      sessions += daySessions;
      crashes += points.reduce((sum, point) => sum + (point.crashes ?? 0), 0);
    }
    return { rate: sessions > 0 ? crashes / sessions : null, volume: sessions, events: crashes, days: used, coveredDays: covered };
  }
  let users = 0;
  let weighted = 0;
  for (const day of days) {
    for (const point of pointsOn(health, day, version)) {
      if (point.crashRate === undefined || !point.users) continue;
      users += point.users;
      weighted += point.crashRate * point.users;
    }
  }
  return { rate: users > 0 ? weighted / users : null, volume: users };
}

/** Google Play's freeze rate over some days, weighted the same way. Null on the App Store, which has no day by day freezes. */
export function freezeOver(health: AppHealth, days: Iterable<DayString>, version: string = ALL_VERSIONS): RateOver | null {
  if (health.store !== 'playstore') return null;
  let users = 0;
  let weighted = 0;
  for (const day of days) {
    for (const point of pointsOn(health, day, version)) {
      if (point.anrRate === undefined || !point.anrUsers) continue;
      users += point.anrUsers;
      weighted += point.anrRate * point.anrUsers;
    }
  }
  return { rate: users > 0 ? weighted / users : null, volume: users };
}

/** Whether a rate rests on enough sessions or users to compare, and on the App Store on enough of its days. */
export function steady(store: HealthStore, rate: RateOver | null): boolean {
  if (!rate || rate.rate === null || rate.volume < (store === 'appstore' ? MIN_SESSIONS : MIN_USER_DAYS)) return false;
  return !partial(rate) || (rate.coveredDays ?? 0) / (rate.days ?? 1) >= MIN_CRASH_COVERAGE;
}

/** An App Store rate over only some of the days with sessions: the others had no crash file. */
export function partial(rate: RateOver | null): boolean {
  return !!rate && rate.days !== undefined && rate.coveredDays !== undefined && rate.coveredDays < rate.days;
}

export function crashesAbout(review: StoreReview): boolean {
  return topicsOf(review).includes('crash');
}

// --- over time ------------------------------------------------------------------------

export interface HealthBucket {
  start: DayString;
  end: DayString;
  crash: RateOver;
  freeze: RateOver | null;
  /** Written reviews in the bucket that mention crashing or freezing. */
  crashReviews: number;
}

/** The health in the same buckets the ratings charts use (bucketsIn), so the columns line up. */
export function healthBuckets(
  health: AppHealth | null,
  options: { granularity: RatingGranularity; window: DayWindow; reviews: StoreReview[] }
): HealthBucket[] {
  const crashReviewDays = options.reviews.filter(crashesAbout).map(reviewDay);
  return bucketsIn(options.window, options.granularity).map(({ start, end }) => {
    const days = dayRange(start, end);
    return {
      start,
      end,
      crash: health ? crashOver(health, days) : { rate: null, volume: 0 },
      freeze: health ? freezeOver(health, days) : null,
      crashReviews: crashReviewDays.filter((day) => day >= start && day <= end).length,
    };
  });
}

// --- by version -------------------------------------------------------------------------

export interface VersionHealth {
  /** Apple's version string, or Google's build number. */
  key: string;
  /** What people call it: the version, or on Google Play "Build 205" while the build's version is not known. */
  name: string;
  /** Google Play: the build number. */
  build: string | null;
  /** Google Play: the name of the Play Console release that carries the build, when the developer typed one ("New help form"). */
  releaseName: string | null;
  /** The first and the last day the store counted people using it. */
  from: DayString;
  to: DayString;
  crash: RateOver;
  freeze: RateOver | null;
  /** App Store: Xcode's hang rate for it, in the reading's unit. */
  hang: number | null;
}

function versionOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Newest first. Each store makes the numbers go up: Apple takes a new
 * version only with a higher version number, Google a new build only with a
 * higher build number. So neither the day a version was first seen nor its
 * sessions decide which one is newest. On Google Play a version known only by
 * name, from reviews read before Growth kept builds, sits below the builds.
 */
function newerFirst(store: HealthStore, a: { name: string; build: string | null }, b: { name: string; build: string | null }): number {
  if (store === 'playstore') {
    if (a.build && b.build) return Number(b.build) - Number(a.build) || versionOrder(b.build, a.build);
    if (a.build || b.build) return a.build ? -1 : 1;
  }
  return versionOrder(b.name, a.name);
}

/**
 * The version in a Play Console release name, when Play Console made the name
 * itself ("138 (1.3.8)", build then version, measured on Ludo Wala's internal
 * track) or the name is a version number. Null for a name the developer
 * typed: Ludo Wala's production release of build 205 (version 1.4.65) is
 * called "New help form".
 */
export function versionInReleaseName(release: string, build: string): string | null {
  const text = release.trim();
  const made = /^(\d+)\s*\((.+)\)$/.exec(text);
  if (made) return made[1] === build ? made[2].trim() || null : null;
  const plain = /^v?(\d+(?:\.\d+)+)$/i.exec(text);
  return plain ? plain[1] : null;
}

/**
 * Google Play: build number to version name. Google sends both with every
 * review, so reviews come first; then release names that hold the version
 * (versionInReleaseName). Android vitals name builds only.
 */
export function playVersionNames(reviews: StoreReview[], releaseNames: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [build, release] of Object.entries(releaseNames)) {
    const name = versionInReleaseName(release, build);
    if (name) out[build] = name;
  }
  for (const review of reviews) {
    const build = review.appBuild?.trim();
    const name = review.appVersion?.trim();
    if (build && name) out[build] = name;
  }
  return out;
}

/** "Build 205" while a Google Play build's version is not known. */
export function buildName(build: string): string {
  return `Build ${build}`;
}

/**
 * Every version with numbers, newest first (newerFirst). `names` is Google
 * Play's build to version (playVersionNames); the App Store's keys are
 * versions already.
 */
export function versionHealth(health: AppHealth | null, names: Record<string, string> = {}): VersionHealth[] {
  if (!health) return [];
  const play = health.store === 'playstore';
  const spans = new Map<string, { from: DayString; to: DayString }>();
  for (const [day, versions] of Object.entries(health.days)) {
    for (const [key, point] of Object.entries(versions)) {
      if (key === ALL_VERSIONS) continue;
      if (!(point.sessions || point.users || point.anrUsers)) continue;
      const span = spans.get(key);
      if (!span) spans.set(key, { from: day, to: day });
      else {
        if (day < span.from) span.from = day;
        if (day > span.to) span.to = day;
      }
    }
  }
  const hangs = new Map((health.hangs?.points ?? []).map((point) => [point.version, point.value]));
  return [...spans.entries()]
    .map(([key, span]) => {
      const release = play ? health.releaseNames?.[key]?.trim() || null : null;
      const days = dayRange(span.from, span.to);
      return {
        key,
        name: play ? names[key] ?? buildName(key) : key,
        build: play ? key : null,
        releaseName: release && versionInReleaseName(release, key) === null ? release : null,
        from: span.from,
        to: span.to,
        crash: crashOver(health, days, key),
        freeze: freezeOver(health, days, key),
        hang: play ? null : hangs.get(key) ?? null,
      };
    })
    .sort((a, b) => newerFirst(health.store, a, b));
}

/** A release on the timeline that names its version: the App Store's are read with the ratings, any store's can be typed in. */
export interface VersionRelease {
  version: string;
  date: DayString;
}

/** A row of the versions table: what is known of one version's health and ratings. */
export interface VersionRow {
  /** The App Store's version; Google Play's build, or "name:<version>" for a version known only from reviews without a build. */
  key: string;
  name: string;
  build: string | null;
  releaseName: string | null;
  /** The day the store released it, from the timeline's release events. */
  released: DayString | null;
  /** The first and the last day the store counted people using it, Growth saw it on sale, or (Google Play, with no numbers) reviews named it. */
  seen: { from: DayString; to: DayString } | null;
  /** Its days on the charts: from its release to the day before the next version came out, else the days it was seen. */
  from: DayString;
  to: DayString;
  health: VersionHealth | null;
  /** App Store: new ratings while it was on sale. Google Play: written reviews of it. */
  ratings: { count: number; average: number | null; what: 'new ratings' | 'reviews' } | null;
  /** Its written reviews that mention crashes. */
  crashReviewIds: string[];
}

/**
 * Every version the screen knows of, newest first (newerFirst): those with
 * health numbers, the App Store's with new ratings (versionRatings) or a
 * release on the timeline, and Google Play's that written reviews name. A
 * Google Play review belongs to the build Google sent with it, or else to the
 * version it names; an App Store review names no version, so it belongs to
 * the version that was newest on its day.
 */
export function versionRows(
  store: HealthStore,
  input: {
    versions: VersionHealth[];
    ratingVersions?: Array<{ version: string; from: DayString; to: DayString; newCount: number; newAverage: number | null }>;
    reviews: StoreReview[];
    releases?: VersionRelease[];
    /** Google Play: build to version (playVersionNames). */
    names?: Record<string, string>;
  }
): VersionRow[] {
  const { versions, ratingVersions = [], reviews, releases = [], names = {} } = input;
  const rows = new Map<string, VersionRow>();
  const blank = (key: string, name: string, build: string | null): VersionRow => {
    const row: VersionRow = { key, name, build, releaseName: null, released: null, seen: null, from: '', to: '', health: null, ratings: null, crashReviewIds: [] };
    rows.set(key, row);
    return row;
  };
  const widen = (row: VersionRow, from: DayString, to: DayString) => {
    row.seen = row.seen ? { from: from < row.seen.from ? from : row.seen.from, to: to > row.seen.to ? to : row.seen.to } : { from, to };
  };
  const named = (name: string) => [...rows.values()].filter((row) => row.name === name).sort((a, b) => newerFirst(store, a, b))[0] ?? null;

  for (const entry of versions) {
    const row = blank(entry.key, entry.name, entry.build);
    row.releaseName = entry.releaseName;
    row.health = entry;
    widen(row, entry.from, entry.to);
  }

  const own = new Map<VersionRow, StoreReview[]>();
  if (store === 'appstore') {
    for (const entry of ratingVersions) {
      const row = rows.get(entry.version) ?? blank(entry.version, entry.version, null);
      row.ratings = { count: entry.newCount, average: entry.newAverage, what: 'new ratings' };
      widen(row, entry.from, entry.to);
    }
  } else {
    // Reviews with a build first, so a review that names only the version finds that build's row.
    const ordered = [...reviews].sort((a, b) => Number(!a.appBuild?.trim()) - Number(!b.appBuild?.trim()));
    for (const review of ordered) {
      const build = review.appBuild?.trim();
      const name = review.appVersion?.trim();
      let row: VersionRow | null = null;
      if (build) row = rows.get(build) ?? blank(build, names[build] ?? name ?? buildName(build), build);
      else if (name) row = named(name) ?? blank(`name:${name}`, name, null);
      if (!row) continue;
      own.set(row, [...(own.get(row) ?? []), review]);
    }
    for (const [row, list] of own) {
      row.ratings = { count: list.length, average: list.reduce((sum, review) => sum + review.rating, 0) / list.length, what: 'reviews' };
      row.crashReviewIds = list.filter(crashesAbout).map((review) => review.id);
      if (!row.health) {
        const days = list.map(reviewDay).sort();
        widen(row, days[0], days[days.length - 1]);
      }
    }
  }

  for (const release of releases) {
    const name = release.version.trim();
    if (!name) continue;
    const row = (store === 'appstore' ? rows.get(name) : named(name)) ?? blank(name, name, null);
    if (!row.released || release.date < row.released) row.released = release.date;
  }

  const sorted = [...rows.values()].sort((a, b) => newerFirst(store, a, b));
  const startOf = (row: VersionRow) => row.released ?? row.seen?.from ?? null;
  sorted.forEach((row, index) => {
    const start = startOf(row);
    if (row.released) {
      // Out until the next version came out, or still out.
      const next = sorted
        .slice(0, index)
        .map(startOf)
        .filter((day): day is DayString => !!day && day > row.released!)
        .sort()[0];
      row.from = row.released;
      row.to = next ? addDays(next, -1) : index === 0 ? today() : row.seen && row.seen.to > row.released ? row.seen.to : row.released;
    } else {
      row.from = start ?? today();
      row.to = row.seen?.to ?? row.from;
    }
  });

  if (store === 'appstore') {
    for (const review of reviews) {
      if (!crashesAbout(review)) continue;
      const day = reviewDay(review);
      const row = sorted.find((entry) => {
        const start = startOf(entry);
        return start !== null && start <= day;
      });
      if (row) row.crashReviewIds.push(review.id);
    }
  }
  return sorted;
}

/** How a version's crash rate stands against the newest older version with steady numbers, for the table's note. */
export function crashChange(store: HealthStore, rows: VersionRow[], index: number): { kind: 'worse' | 'better' | 'over-line'; before: number; after: number } | null {
  const row = rows[index];
  const now = row?.health?.crash;
  if (!row || !steady(store, now ?? null)) return null;
  const older = rows.slice(index + 1).find((entry) => steady(store, entry.health?.crash ?? null));
  const after = now!.rate!;
  if (!older) return store === 'playstore' && after >= GOOGLE_CRASH_LINE ? { kind: 'over-line', before: after, after } : null;
  const before = older.health!.crash.rate!;
  if (store === 'playstore' && after >= GOOGLE_CRASH_LINE && before < GOOGLE_CRASH_LINE) return { kind: 'over-line', before, after };
  if (after >= before * RISE && after - before >= MIN_STEP[store]) return { kind: 'worse', before, after };
  if (before >= after * RISE && before - after >= MIN_STEP[store]) return { kind: 'better', before, after };
  return null;
}

// --- what changed ---------------------------------------------------------------------

/** A rate rose by this much at least, and by this much over the one before, to count as up. */
const RISE = 1.5;
const MIN_STEP: Record<HealthStore, number> = { appstore: 0.001, playstore: 0.002 };

export interface HealthFinding {
  /** Worse or better than the version before, or across Google's line. */
  kind: 'worse' | 'better';
  measure: 'crash' | 'freeze';
  version: VersionHealth;
  previous: VersionHealth;
  before: number;
  after: number;
  /** Google Play: the version is over Google's line, and the one before was not. */
  overLine: boolean;
}

function compare(store: HealthStore, measure: 'crash' | 'freeze', version: VersionHealth, previous: VersionHealth): HealthFinding | null {
  const now = measure === 'crash' ? version.crash : version.freeze;
  const then = measure === 'crash' ? previous.crash : previous.freeze;
  if (!steady(store, now) || !steady(store, then)) return null;
  const after = now!.rate!;
  const before = then!.rate!;
  const line = measure === 'crash' ? GOOGLE_CRASH_LINE : GOOGLE_FREEZE_LINE;
  const overLine = store === 'playstore' && after >= line && before < line;
  if (overLine || (after >= before * RISE && after - before >= MIN_STEP[store])) {
    return { kind: 'worse', measure, version, previous, before, after, overLine };
  }
  if (before >= after * RISE && before - after >= MIN_STEP[store]) {
    return { kind: 'better', measure, version, previous, before, after, overLine: false };
  }
  return null;
}

/**
 * The one thing worth saying first: the newest version with steady numbers
 * against the newest older one that has them, crashes before freezes. Nothing
 * when the numbers are too thin or about the same.
 */
export function healthFinding(store: HealthStore, versions: VersionHealth[]): HealthFinding | null {
  const comparable = (measure: 'crash' | 'freeze') =>
    versions.filter((entry) => steady(store, measure === 'crash' ? entry.crash : entry.freeze));
  for (const measure of ['crash', 'freeze'] as const) {
    const list = comparable(measure);
    if (list.length < 2) continue;
    const found = compare(store, measure, list[0], list[1]);
    if (found) return found;
  }
  return null;
}

/**
 * The app's rating the day before a version's first day, and now: the
 * average of every country, from the ratings history. Null where Growth had
 * not read the ratings yet.
 */
export function ratingAround(rows: RatingDay[], from: DayString): { before: number | null; now: number | null } {
  const window = { from: addDays(from, -1), to: today() };
  const buckets = ratingBuckets(rows, { territory: 'all', granularity: 'day', window });
  const before = buckets[0]?.average ?? null;
  const now = [...buckets].reverse().find((bucket) => bucket.average !== null)?.average ?? null;
  return { before, now };
}

// --- in words -------------------------------------------------------------------------

function trimmed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

/** A crash rate as the store measures it: "2.4 per 1,000 sessions" or "1.21% of users". */
export function crashWords(store: HealthStore, rate: number | null, options: { short?: boolean } = {}): string {
  if (rate === null) return 'No numbers';
  if (store === 'appstore') {
    const perThousand = rate * 1000;
    const text = perThousand > 0 && perThousand < 0.1 ? 'under 0.1' : trimmed(perThousand, perThousand >= 10 ? 0 : 1);
    return options.short ? `${text} per 1,000` : `${text} per 1,000 sessions`;
  }
  return percentWords(rate, options.short ? '' : ' of users');
}

/** Google Play's freeze rate: "0.31% of users". */
export function freezeWords(rate: number | null, options: { short?: boolean } = {}): string {
  if (rate === null) return 'No numbers';
  return percentWords(rate, options.short ? '' : ' of users');
}

function percentWords(rate: number, after: string): string {
  const percent = rate * 100;
  const text = percent > 0 && percent < 0.01 ? 'under 0.01' : trimmed(percent, percent >= 10 ? 1 : 2);
  return `${text}%${after}`;
}

/** How many times one rate is the other, for "3 times as many", or null when it is not a clear step. */
export function timesWords(after: number, before: number): string | null {
  if (before <= 0) return null;
  const times = after / before;
  if (times >= 1.95) return `${trimmed(times, times >= 10 ? 0 : 1)} times`;
  return null;
}

/**
 * Round numbers for the left axis, from 0 to just past `top` in about four steps of 1, 2, 2.5 or 5
 * times a power of ten. Recharts splits a fixed top evenly, which gives labels like 0.45% and 1.35%.
 */
export function healthTicks(top: number): number[] {
  const rough = top > 0 ? top / 4 : 0.25;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((times) => times * power).find((size) => size >= rough - 1e-12) ?? 10 * power;
  const count = Math.max(1, Math.ceil(top / step - 1e-9));
  return Array.from({ length: count + 1 }, (_, index) => Number((index * step).toFixed(10)));
}
