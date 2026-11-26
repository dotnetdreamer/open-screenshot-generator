// Growth's Today screen: every app of the account on one page, so a morning
// look answers "how are my apps doing" without opening each app in turn.
//
// Each app is measured over its own last days, the way its Overview measures
// it (`defaultWindow`). An App Store app's numbers end a day or two ago and a
// Google Play app's several days earlier, so one shared window would either
// cut the App Store apps short or leave the Google Play app's newest days out.
// An app's figure here is the figure its Overview shows for the same range,
// and a total adds those figures up. A change is stated only over the apps
// whose history reaches back over their period before (`covers`), and says
// how many of the apps that is.
//
// An app whose numbers stop more than LEFT_OUT_DAYS ago stays out of the
// totals and says why: a month-old figure is not "the last 28 days". Earnings
// are never added across currencies (rule 52 in AGENTS.md).
//
// Everything is worked out here from what Growth has stored; no AI writes a
// number or a sentence on the screen.

import { addDays, daysBetween, formatDay, inWindow, previousWindow, windowLength, type DayWindow } from './dates';
import { formatCount, formatMoney, formatRate, plural } from './format';
import { eventImpact, type ImpactResult } from './impact';
import { checkListing } from './listingChecks';
import {
  compareWindows,
  completeThrough,
  covers,
  dayValues,
  defaultWindow,
  feedStarts,
  indexRecords,
  metricValue,
  proceedsCurrency,
  relativeChange,
  totalsFor,
  type FeedStarts,
  type Totals,
} from './metrics';
import { ratingSummary, type RatingSummary } from './ratings';
import { ratingSteps } from './ratingHistory';
import { statusOf } from './reviewInbox';
import { storeOf, type GrowthStore } from './stores';
import { UNKNOWN_TERRITORY } from './territories';
import type { GrowthData } from './loadData';
import type {
  DayRecord,
  DayString,
  GrowthApp,
  GrowthFeed,
  Insight,
  InsightAction,
  InsightTone,
  RatingDay,
  ReviewMark,
  StoreReview,
  TimelineEvent,
} from './types';

/** Numbers that stop longer ago than this are too old for a total of recent days. */
export const LEFT_OUT_DAYS = 21;

/** How far back the activity list looks, in days: reviews, then everything else. */
export const REVIEW_NEWS_DAYS = 14;
export const NEWS_DAYS = 30;

/** Colour slots: the validated categorical palette has eight (`--growth-tag-1` to `8`). */
export const COLOR_SLOTS = 8;

export interface StudioInput {
  app: GrowthApp;
  data: GrowthData;
  /** The user's marks on the app's reviews, for what still needs a reply. */
  marks?: Map<string, ReviewMark>;
  /** The app's ratings history, for the pace of new ratings. */
  ratingDays?: RatingDay[];
  /** Insights as the Growth view builds them for the app (monitor.ts `appInsights`), dismissed ones left out. */
  insights?: Insight[];
  /** The latest crash or freeze change across versions, as Ratings words it. */
  healthNote?: { worse: boolean; title: string } | null;
}

export interface StudioApp {
  app: GrowthApp;
  store: GrowthStore;
  data: GrowthData;
  /** 1 to 8, the app's colour on every chart; 0 for the apps folded into "Other apps". */
  slot: number;
  byDate: Map<DayString, DayRecord>;
  starts: FeedStarts;
  /** The newest day every feed of the app has reported. */
  through: DayString | null;
  /** The app's own last days, as its Overview shows them. Null without numbers. */
  window: DayWindow | null;
  current: Totals | null;
  before: Totals | null;
  /** In the totals: the app has numbers, and they are recent. */
  counted: boolean;
  leftOut: 'no-numbers' | 'old-numbers' | null;
  rating: RatingSummary;
  /** Reviews waiting for a reply, and the oldest one's date. */
  waiting: number;
  oldestWaiting: string | null;
  /** How many of the reviews waiting have one or two stars. */
  waitingLow: number;
  /** New downloads in every day Growth has, and the day those numbers start. */
  allDownloads: number;
  downloadsSince: DayString | null;
  /** The version on sale, as the last refresh read it, else the newest release on the timeline. */
  version: string | null;
  input: StudioInput;
}

function versionOnSale(data: GrowthData): string | null {
  if (data.live?.version) return data.live.version;
  const release = data.events
    .filter((event) => event.kind === 'release' && event.version)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return release?.version ?? null;
}

function ms(day: DayString): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/** Every new download Growth has stored for an app, and the first day of those numbers. */
export function allTimeDownloads(records: DayRecord[]): { total: number; since: DayString | null; byDay: Array<[DayString, number]> } {
  let total = 0;
  let since: DayString | null = null;
  const byDay: Array<[DayString, number]> = [];
  for (const record of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
    const value = dayValues(record, record.date).downloads;
    if (value === null) continue;
    if (!since) since = record.date;
    total += value;
    byDay.push([record.date, value]);
  }
  return { total, since, byDay };
}

/**
 * Colour slots that follow the app, never its rank on the screen: by the
 * account's own order, so a filter or a range never repaints an app. Past
 * eight apps, the seven with the most downloads keep a colour and the rest
 * share "Other apps".
 */
export function colorSlots(apps: Array<{ id: string; downloads: number }>): Map<string, number> {
  const slots = new Map<string, number>();
  const coloured =
    apps.length <= COLOR_SLOTS
      ? new Set(apps.map((app) => app.id))
      : new Set(
          [...apps]
            .sort((a, b) => b.downloads - a.downloads)
            .slice(0, COLOR_SLOTS - 1)
            .map((app) => app.id)
        );
  let next = 1;
  for (const app of apps) slots.set(app.id, coloured.has(app.id) ? next++ : 0);
  return slots;
}

/** Each app's numbers for the last `days` days, in the account's order. */
export function studioApps(inputs: StudioInput[], days: number, today: DayString): StudioApp[] {
  const fallback = addDays(today, -1);
  const oldest = addDays(today, -LEFT_OUT_DAYS);
  const base = inputs.map((input) => {
    const records = input.data.records;
    const byDate = indexRecords(records);
    const through = completeThrough(records);
    const all = allTimeDownloads(records);
    return { input, records, byDate, through, all };
  });
  const slots = colorSlots(base.map((entry) => ({ id: entry.input.app.id, downloads: entry.all.total })));
  return base.map(({ input, records, byDate, through, all }) => {
    const window = through ? defaultWindow(records, days, fallback) : null;
    const comparison = window ? compareWindows(byDate, window) : null;
    const leftOut = !through ? 'no-numbers' : through < oldest ? 'old-numbers' : null;
    const waitingReviews = input.data.reviews.filter((review) => statusOf(review, input.marks?.get(review.id)) === 'todo');
    const oldestWaiting = waitingReviews.reduce<string | null>(
      (oldest, review) => (!oldest || review.createdDate < oldest ? review.createdDate : oldest),
      null
    );
    return {
      app: input.app,
      store: storeOf(input.app.id),
      data: input.data,
      slot: slots.get(input.app.id) ?? 0,
      byDate,
      starts: feedStarts(records),
      through,
      window,
      current: comparison?.current ?? null,
      before: comparison?.previous ?? null,
      counted: !leftOut,
      leftOut,
      rating: ratingSummary(input.data.ratings),
      waiting: waitingReviews.length,
      oldestWaiting,
      waitingLow: waitingReviews.filter((review) => review.rating <= 2).length,
      allDownloads: all.total,
      downloadsSince: all.since,
      version: versionOnSale(input.data),
      input,
    };
  });
}

// --- the tiles ---------------------------------------------------------------------

export type StudioMetric = 'downloads' | 'pageViews' | 'rate' | 'proceeds';

export interface StudioPart {
  appId: string;
  value: number;
}

export interface StudioFigure {
  metric: StudioMetric;
  /** Over every app counted, null when none of them has the number. */
  value: number | null;
  /** The change over the apps that can be compared, null when none can. */
  change: number | null;
  /** The apps the change is over. */
  compared: string[];
  /** The apps that have the number at all. */
  reporting: string[];
  /** Each app's part of a count, biggest first, for the bar under it. */
  parts: StudioPart[];
  /** Earnings: the currency the value is in, and what came in other currencies. */
  currency?: string;
  others?: Record<string, number>;
}

function countFigure(apps: StudioApp[], metric: 'downloads' | 'pageViews'): StudioFigure {
  const parts: StudioPart[] = [];
  let value: number | null = null;
  let now = 0;
  let then = 0;
  const compared: string[] = [];
  for (const entry of apps) {
    if (!entry.counted || !entry.current || !entry.before || !entry.window) continue;
    const current = metricValue(entry.current, metric);
    if (current === null) continue;
    value = (value ?? 0) + current;
    parts.push({ appId: entry.app.id, value: current });
    const before = metricValue(entry.before, metric);
    if (before !== null && covers(entry.starts, metric, previousWindow(entry.window))) {
      now += current;
      then += before;
      compared.push(entry.app.id);
    }
  }
  return {
    metric,
    value,
    change: compared.length ? relativeChange(now, then) : null,
    compared,
    reporting: parts.map((part) => part.appId),
    parts: parts.sort((a, b) => b.value - a.value),
  };
}

/**
 * The download rate from page visits, over every app at once: downloads that
 * started on a store page over the people who opened one. It is the one rate
 * both stores report the same way (App Store's rate from times seen has no
 * Google Play twin), and the one the screenshots move.
 */
function rateFigure(apps: StudioApp[]): StudioFigure {
  let downloads = 0;
  let views = 0;
  let nowDownloads = 0;
  let nowViews = 0;
  let thenDownloads = 0;
  let thenViews = 0;
  const reporting: string[] = [];
  const compared: string[] = [];
  for (const entry of apps) {
    if (!entry.counted || !entry.current || !entry.before || !entry.window) continue;
    const base = entry.current.pageConversionBase;
    if (base.uniquePageViews <= 0) continue;
    downloads += base.downloads;
    views += base.uniquePageViews;
    reporting.push(entry.app.id);
    const prior = entry.before.pageConversionBase;
    if (prior.uniquePageViews > 0 && covers(entry.starts, 'pageConversion', previousWindow(entry.window))) {
      nowDownloads += base.downloads;
      nowViews += base.uniquePageViews;
      thenDownloads += prior.downloads;
      thenViews += prior.uniquePageViews;
      compared.push(entry.app.id);
    }
  }
  return {
    metric: 'rate',
    value: views > 0 ? downloads / views : null,
    change: nowViews > 0 && thenViews > 0 ? relativeChange(nowDownloads / nowViews, thenDownloads / thenViews) : null,
    compared,
    reporting,
    parts: [],
  };
}

function moneyFigure(apps: StudioApp[]): StudioFigure {
  const counted = apps.filter((entry) => entry.counted && entry.current?.hasSales);
  const currency = proceedsCurrency(...counted.flatMap((entry) => [entry.current!, ...(entry.before ? [entry.before] : [])]));
  const parts: StudioPart[] = [];
  const others: Record<string, number> = {};
  let value: number | null = null;
  let now = 0;
  let then = 0;
  const compared: string[] = [];
  for (const entry of counted) {
    const current = metricValue(entry.current!, 'proceeds', currency) ?? 0;
    value = (value ?? 0) + current;
    parts.push({ appId: entry.app.id, value: current });
    for (const [code, amount] of Object.entries(entry.current!.proceeds)) {
      if (code !== currency && amount !== 0) others[code] = Math.round(((others[code] ?? 0) + amount) * 100) / 100;
    }
    const before = entry.before ? metricValue(entry.before, 'proceeds', currency) : null;
    if (before !== null && entry.window && covers(entry.starts, 'proceeds', previousWindow(entry.window))) {
      now += current;
      then += before;
      compared.push(entry.app.id);
    }
  }
  return {
    metric: 'proceeds',
    value: value === null ? null : Math.round(value * 100) / 100,
    change: compared.length ? relativeChange(now, then) : null,
    compared,
    reporting: parts.map((part) => part.appId),
    parts: parts.sort((a, b) => b.value - a.value),
    currency,
    others,
  };
}

export function studioFigure(apps: StudioApp[], metric: StudioMetric): StudioFigure {
  if (metric === 'rate') return rateFigure(apps);
  if (metric === 'proceeds') return moneyFigure(apps);
  return countFigure(apps, metric);
}

/**
 * Every app's star rating as one. Weighted by each app's count of ratings
 * when every rated app has a count. A Google Play app read from Google's
 * report files has an average and no count, and leaving it out of a weighted
 * average would print the small app's 5.0 for a big app's 4.6, so then the
 * figure is the plain average of the apps' ratings, and `weighted` says so.
 */
export function studioRating(apps: StudioApp[]): { average: number | null; count: number | null; apps: number; weighted: boolean } {
  let sum = 0;
  let count = 0;
  const averages: number[] = [];
  let uncounted = 0;
  for (const entry of apps) {
    const { average, count: ratings } = entry.rating;
    if (average === null) continue;
    averages.push(average);
    if (ratings) {
      sum += average * ratings;
      count += ratings;
    } else {
      uncounted += 1;
    }
  }
  if (averages.length === 0) return { average: null, count: null, apps: 0, weighted: false };
  if (uncounted === 0) return { average: sum / count, count, apps: averages.length, weighted: true };
  return { average: averages.reduce((a, b) => a + b, 0) / averages.length, count: null, apps: averages.length, weighted: false };
}

// --- the chart -----------------------------------------------------------------------

export type SeriesMetric = 'downloads' | 'pageViews' | 'updates' | 'proceeds';

export interface StudioDay {
  date: DayString;
  /** Each counted app's value that day, absent where the app's numbers are not in yet or no feed reported the day. */
  values: Record<string, number>;
  total: number | null;
  /** Every counted app has reported this day. Past it, some apps' numbers are not in yet. */
  complete: boolean;
  /** The counted apps whose numbers stop before this day. */
  missing: string[];
}

export interface StudioSeries {
  days: StudioDay[];
  /** The last day every counted app has numbers for. */
  completeThrough: DayString | null;
  /** The apps on the chart, in the account's order. */
  apps: string[];
}

/**
 * One value per app and day, over the days from the earliest window's start
 * to the latest window's end. Unlike the totals, each app shows every day it
 * has numbers for in that span, not only the days of its own window: an app
 * whose window starts later still sold on the first days, and leaving those
 * out would draw a dip that never happened. The days past an app's newest
 * numbers are the only gaps, and they are named as "not in yet".
 * Earnings are the part paid in `currency` only.
 */
export function studioSeries(apps: StudioApp[], metric: SeriesMetric, currency?: string): StudioSeries {
  const counted = apps.filter((entry) => entry.counted && entry.window && entry.through);
  if (counted.length === 0) return { days: [], completeThrough: null, apps: [] };
  const range = studioRange(counted);
  const allIn = counted.reduce((min, entry) => (entry.through! < min ? entry.through! : min), counted[0].through!);
  const days: StudioDay[] = [];
  for (let date = range.window!.from; date <= range.window!.to; date = addDays(date, 1)) {
    const values: Record<string, number> = {};
    const missing: string[] = [];
    let total: number | null = null;
    for (const entry of counted) {
      if (date > entry.through!) {
        missing.push(entry.app.id);
        continue;
      }
      const day = dayValues(entry.byDate.get(date), date);
      let value: number | null;
      if (metric === 'proceeds') value = day.proceeds ? day.proceeds[currency ?? 'USD'] ?? 0 : null;
      else value = day[metric];
      if (value === null) continue;
      values[entry.app.id] = value;
      total = (total ?? 0) + value;
    }
    days.push({ date, values, total, complete: date <= allIn, missing });
  }
  return { days, completeThrough: allIn, apps: counted.map((entry) => entry.app.id) };
}

/**
 * The download rate from page visits per day, over the apps that reported
 * both halves that day, up to the last day every counted app has numbers for.
 */
export function studioRateSeries(apps: StudioApp[]): Array<{ date: DayString; value: number | null }> {
  const counted = apps.filter((entry) => entry.counted && entry.window && entry.through);
  const range = studioRange(counted);
  if (!range.window || counted.length === 0) return [];
  const allIn = counted.reduce((min, entry) => (entry.through! < min ? entry.through! : min), counted[0].through!);
  const out: Array<{ date: DayString; value: number | null }> = [];
  for (let date = range.window.from; date <= allIn; date = addDays(date, 1)) {
    let downloads = 0;
    let views = 0;
    for (const entry of counted) {
      const day = dayValues(entry.byDate.get(date), date);
      if (day.uniquePageViews === null || day.pageDownloads === null) continue;
      downloads += day.pageDownloads;
      views += day.uniquePageViews;
    }
    out.push({ date, value: views > 0 ? downloads / views : null });
  }
  return out;
}

/**
 * The range the screen speaks for: one window when every counted app has the
 * same one, else from the earliest start to the latest end.
 */
export function studioRange(apps: StudioApp[]): { window: DayWindow | null; shared: boolean } {
  const windows = apps.filter((entry) => entry.counted && entry.window).map((entry) => entry.window!);
  if (windows.length === 0) return { window: null, shared: true };
  const shared = windows.every((window) => window.from === windows[0].from && window.to === windows[0].to);
  return {
    window: {
      from: windows.reduce((min, window) => (window.from < min ? window.from : min), windows[0].from),
      to: windows.reduce((max, window) => (window.to > max ? window.to : max), windows[0].to),
    },
    shared,
  };
}

// --- countries -----------------------------------------------------------------------

export interface StudioCountry {
  territory: string;
  downloads: number;
  /** Over the apps that can be compared, as the tiles do. */
  change: number | null;
  /** Share of every new download on the screen, 0 to 1. */
  share: number;
  parts: StudioPart[];
}

/** New downloads by country over every counted app, biggest first. Unknown places are left out. */
export function studioCountries(apps: StudioApp[]): StudioCountry[] {
  const rows = new Map<string, { downloads: number; now: number; then: number; compared: boolean; parts: StudioPart[] }>();
  let all = 0;
  for (const entry of apps) {
    if (!entry.counted || !entry.window) continue;
    const prior = previousWindow(entry.window);
    const comparable = covers(entry.starts, 'downloads', prior);
    const territories = new Set<string>();
    for (const [date, record] of entry.byDate) {
      if (inWindow(date, entry.window) || (comparable && inWindow(date, prior))) {
        for (const code of Object.keys(record.territories)) territories.add(code);
      }
    }
    for (const territory of territories) {
      if (territory === UNKNOWN_TERRITORY) continue;
      const current = totalsFor(entry.byDate, entry.window, { territory });
      const now = metricValue(current, 'downloads');
      if (now === null) continue;
      const row = rows.get(territory) ?? { downloads: 0, now: 0, then: 0, compared: false, parts: [] };
      row.downloads += now;
      all += now;
      if (now > 0) row.parts.push({ appId: entry.app.id, value: now });
      if (comparable) {
        const before = metricValue(totalsFor(entry.byDate, prior, { territory }), 'downloads');
        if (before !== null) {
          row.now += now;
          row.then += before;
          row.compared = true;
        }
      }
      rows.set(territory, row);
    }
  }
  return Array.from(rows.entries())
    .filter(([, row]) => row.downloads > 0)
    .map(([territory, row]) => ({
      territory,
      downloads: row.downloads,
      change: row.compared ? relativeChange(row.now, row.then) : null,
      share: all > 0 ? row.downloads / all : 0,
      parts: row.parts.sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.downloads - a.downloads || a.territory.localeCompare(b.territory));
}

/**
 * Five shades for the map, 1 for the fewest downloads and 5 for the most, 0
 * for none. By rank rather than by size, so one big country does not leave
 * every other one in the palest shade; equal counts get the same shade.
 */
export function mapShades(values: number[]): (downloads: number) => number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  return (downloads: number) => {
    if (!(downloads > 0) || sorted.length === 0) return 0;
    // How many counts are at or below this one.
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle] <= downloads) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, Math.ceil((5 * low) / sorted.length));
  };
}

// --- milestones ------------------------------------------------------------------------

/** Round numbers worth a mention, from a new app's first ten downloads up. */
export const GOALS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000,
  5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000,
];

/** The round number at or below a value (0 below the first), and the next one above it. */
export function goalsAround(value: number): { passed: number; goal: number } {
  let passed = 0;
  for (const goal of GOALS) {
    if (goal <= value) passed = goal;
    else return { passed, goal };
  }
  return { passed, goal: passed * 2 };
}

export type MilestoneKind = 'downloads' | 'ratings' | 'reviews';

export interface Milestone {
  id: string;
  /** Null for every app together. */
  appId: string | null;
  kind: MilestoneKind;
  value: number;
  goal: number;
  passed: number;
  /** The day the round number at or below the value was passed, where the stored history shows it. */
  passedOn: DayString | null;
  /** The recent pace per day, null when nothing came in lately or the pace is unknown. */
  perDay: number | null;
  /** Whole days to the goal at that pace, null without a pace or past two years. */
  daysLeft: number | null;
  /** The first day the count covers, for downloads. */
  since: DayString | null;
}

const PACE_DAYS = 28;
const LONGEST_FORECAST = 730;

function forecast(value: number, goal: number, perDay: number | null): number | null {
  if (!perDay || perDay <= 0) return null;
  const days = Math.ceil((goal - value) / perDay);
  return days > LONGEST_FORECAST ? null : Math.max(1, days);
}

/** The day a running total first reached `mark`, from per-day amounts oldest first. */
function dayReached(byDay: Array<[DayString, number]>, mark: number): DayString | null {
  if (mark <= 0) return null;
  let running = 0;
  for (const [date, value] of byDay) {
    running += value;
    if (running >= mark) return date;
  }
  return null;
}

function downloadsMilestone(appId: string | null, byDay: Array<[DayString, number]>, since: DayString | null, perDay: number | null): Milestone {
  const value = byDay.reduce((sum, [, amount]) => sum + amount, 0);
  const { passed, goal } = goalsAround(value);
  return {
    id: `downloads:${appId ?? 'all'}`,
    appId,
    kind: 'downloads',
    value,
    goal,
    passed,
    passedOn: dayReached(byDay, passed),
    perDay,
    daysLeft: forecast(value, goal, perDay),
    since,
  };
}

/** New downloads per day over an app's own last 28 days of numbers. */
function downloadPace(entry: StudioApp): number | null {
  if (!entry.through || entry.leftOut) return null;
  const window = { from: addDays(entry.through, -(PACE_DAYS - 1)), to: entry.through };
  const value = metricValue(totalsFor(entry.byDate, window), 'downloads');
  return value === null ? null : value / windowLength(window);
}

/** New ratings per day over the last 28 days of the ratings history, null when the history is shorter than a week. */
function ratingPace(rows: RatingDay[] | undefined, today: DayString): number | null {
  if (!rows || rows.length === 0) return null;
  const start = rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0].date);
  const from = addDays(today, -PACE_DAYS);
  const span = Math.min(PACE_DAYS, daysBetween(start, today));
  if (span < 7) return null;
  const added = ratingSteps(rows)
    .filter((step) => step.date > from && !step.reset)
    .reduce((sum, step) => sum + step.newCount, 0);
  return added / span;
}

/**
 * The next round number for each app and each kind, and for every app's
 * downloads together, nearest to its goal first. A goal nothing is moving
 * towards (no pace) sorts after the ones on their way.
 */
export function studioMilestones(apps: StudioApp[], today: DayString): Milestone[] {
  const out: Milestone[] = [];
  const allDays = new Map<DayString, number>();
  let allPace = 0;
  let paced = false;
  let since: DayString | null = null;
  for (const entry of apps) {
    const all = allTimeDownloads(entry.data.records);
    const pace = downloadPace(entry);
    if (all.since) {
      out.push(downloadsMilestone(entry.app.id, all.byDay, all.since, pace));
      for (const [date, value] of all.byDay) allDays.set(date, (allDays.get(date) ?? 0) + value);
      if (!since || all.since < since) since = all.since;
      if (pace !== null) {
        allPace += pace;
        paced = true;
      }
    }
    const ratings = entry.rating.count;
    if (ratings !== null && ratings > 0) {
      const { passed, goal } = goalsAround(ratings);
      const perDay = ratingPace(entry.input.ratingDays, today);
      out.push({
        id: `ratings:${entry.app.id}`,
        appId: entry.app.id,
        kind: 'ratings',
        value: ratings,
        goal,
        passed,
        passedOn: null,
        perDay,
        daysLeft: forecast(ratings, goal, perDay),
        since: null,
      });
    }
    const reviews = entry.data.reviews;
    if (reviews.length > 0) {
      const { passed, goal } = goalsAround(reviews.length);
      const oldestFirst = [...reviews].sort((a, b) => a.createdDate.localeCompare(b.createdDate));
      const recent = reviews.filter((review) => review.createdDate.slice(0, 10) > addDays(today, -PACE_DAYS)).length;
      const perDay = recent > 0 ? recent / PACE_DAYS : null;
      out.push({
        id: `reviews:${entry.app.id}`,
        appId: entry.app.id,
        kind: 'reviews',
        value: reviews.length,
        goal,
        passed,
        passedOn: passed > 0 ? oldestFirst[passed - 1]?.createdDate.slice(0, 10) ?? null : null,
        perDay,
        daysLeft: forecast(reviews.length, goal, perDay),
        since: null,
      });
    }
  }
  const withDownloads = apps.filter((entry) => entry.downloadsSince).length;
  if (withDownloads > 1) {
    const byDay = Array.from(allDays.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    out.push(downloadsMilestone(null, byDay, since, paced ? allPace : null));
  }
  return out.sort((a, b) => {
    const moving = Number(b.daysLeft !== null) - Number(a.daysLeft !== null);
    if (moving) return moving;
    if (a.daysLeft !== null && b.daysLeft !== null && a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return b.value / b.goal - a.value / a.goal;
  });
}

/** "about 3 days", "about 2 weeks", "about 4 months". */
export function roughDays(days: number): string {
  if (days <= 1) return 'about a day';
  if (days < 14) return `about ${days} days`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks`;
  if (days < 365) return `about ${Math.round(days / 30)} months`;
  const years = Math.round((days / 365) * 2) / 2;
  return years === 1 ? 'about a year' : `about ${years} years`;
}

export const MILESTONE_WORDS: Record<MilestoneKind, { one: string; many: string }> = {
  downloads: { one: 'download', many: 'downloads' },
  ratings: { one: 'rating', many: 'ratings' },
  reviews: { one: 'written review', many: 'written reviews' },
};

// --- what to do next ---------------------------------------------------------------------

export type StudioAction =
  | InsightAction
  | { kind: 'refresh' }
  | { kind: 'setup' }
  | { kind: 'health' };

export interface StudioTodo {
  id: string;
  appId: string;
  tone: InsightTone;
  title: string;
  detail: string;
  /** How much it matters, 0 to 100, for the order. */
  weight: number;
  action: StudioAction;
}

const SETUP_FEEDS: GrowthFeed[] = ['sales', 'analytics', 'reviews', 'listing', 'health'];

function waitedDays(createdDate: string, today: DayString): number {
  return Math.max(0, daysBetween(createdDate.slice(0, 10), today));
}

/** What each app needs from the user, most important first. Computed, never typed in. */
export function studioTodos(apps: StudioApp[], today: DayString): StudioTodo[] {
  const out: StudioTodo[] = [];
  for (const entry of apps) {
    const id = entry.app.id;
    if (!entry.data.lastSync) {
      out.push({
        id: `refresh:${id}`,
        appId: id,
        tone: 'neutral',
        title: 'Get the numbers',
        detail: "Growth hasn't read this app yet. A refresh brings in downloads, reviews and ratings.",
        weight: 45,
        action: { kind: 'refresh' },
      });
      continue;
    }
    if (entry.leftOut === 'old-numbers' && entry.through) {
      out.push({
        id: `stale:${id}`,
        appId: id,
        tone: 'warning',
        title: 'Numbers are out of date',
        detail: `The newest numbers are from ${formatDay(entry.through)}. Refresh to bring them up to date.`,
        weight: 50,
        action: { kind: 'refresh' },
      });
    }
    const setup = SETUP_FEEDS.map((feed) => entry.data.status[feed]).find(
      (status) => status && (status.state === 'needs-setup' || status.state === 'forbidden' || status.state === 'error')
    );
    if (setup?.message) {
      out.push({
        id: `setup:${id}`,
        appId: id,
        tone: setup.state === 'error' ? 'problem' : 'warning',
        title: setup.state === 'needs-setup' ? 'Finish the setup' : 'A refresh ran into a problem',
        detail: setup.message,
        weight: 55,
        action: { kind: 'setup' },
      });
    }
    if (entry.waiting > 0) {
      const waited = entry.oldestWaiting ? waitedDays(entry.oldestWaiting, today) : 0;
      const parts = [
        waited > 0 ? `The oldest has waited ${plural(waited, 'day')}.` : 'The oldest came in today.',
        entry.waitingLow > 0 ? `${entry.waitingLow === entry.waiting && entry.waiting > 1 ? 'All' : formatCount(entry.waitingLow)} with 1 or 2 stars.` : '',
      ].filter(Boolean);
      out.push({
        id: `reviews:${id}`,
        appId: id,
        tone: entry.waitingLow > 0 ? 'warning' : 'neutral',
        title: `Answer ${plural(entry.waiting, 'review')}`,
        detail: parts.join(' '),
        weight: Math.min(95, 60 + entry.waiting * 4 + (entry.waitingLow > 0 ? 15 : 0) + Math.min(10, waited)),
        action: { kind: 'reviews', unanswered: true },
      });
    }
    if (entry.input.healthNote?.worse) {
      out.push({
        id: `health:${id}`,
        appId: id,
        tone: 'problem',
        title: entry.input.healthNote.title,
        detail: 'Ratings shows the crash numbers by version, with the reviews that mention crashes.',
        weight: 85,
        action: { kind: 'health' },
      });
    }
    const listing = entry.data.listing ? checkListing(entry.data.listing) : [];
    const problems = listing.filter((issue) => issue.severity === 'problem').length;
    const warnings = listing.filter((issue) => issue.severity === 'warning').length;
    if (problems + warnings > 0) {
      out.push({
        id: `listing:${id}`,
        appId: id,
        tone: problems > 0 ? 'problem' : 'warning',
        title: problems > 0 ? `Fix ${plural(problems, 'problem')} on the store page` : `Check ${plural(warnings, 'thing')} on the store page`,
        detail: listing.find((issue) => issue.severity !== 'tip')?.title ?? '',
        weight: problems > 0 ? 70 : 48,
        action: { kind: 'listing' },
      });
    }
    // The cards the reviews and the listing lines above already stand for are left out.
    const cards = (entry.input.insights ?? [])
      .filter((insight) => (insight.tone === 'problem' || insight.tone === 'warning') && insight.kind !== 'unanswered' && insight.kind !== 'listing')
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2);
    for (const insight of cards) {
      out.push({
        id: `insight:${id}:${insight.id}`,
        appId: id,
        tone: insight.tone,
        title: insight.title,
        detail: insight.body,
        weight: Math.min(90, insight.weight),
        action: insight.action ?? { kind: 'timeline' },
      });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// --- what happened lately -----------------------------------------------------------------

export type ActivityKind = 'review' | 'rating-change' | 'release' | 'screenshots' | 'listing' | 'featured' | 'milestone' | 'good-news';

export interface StudioActivity {
  id: string;
  appId: string;
  kind: ActivityKind;
  /** When it happened, in ms, for the order and for "new since your last look". */
  at: number;
  /** `at` is a real time (a review, an upload); otherwise only the day is known. */
  exact: boolean;
  title: string;
  detail?: string;
  stars?: number;
  tone: InsightTone;
  action?: StudioAction;
}

const EVENT_ACTIVITY: Partial<Record<TimelineEvent['kind'], ActivityKind>> = {
  release: 'release',
  screenshots: 'screenshots',
  listing: 'listing',
  featured: 'featured',
};

function reviewTime(review: StoreReview): number {
  const time = Date.parse(review.createdDate);
  return Number.isFinite(time) ? time : ms(review.createdDate.slice(0, 10));
}

/**
 * When an event happened: the moment it was stored, for one the editor or the
 * user added on its own day (an upload, a note), else its day. A release read
 * from the store is stored whenever a refresh first saw it, often days later.
 */
function eventTime(event: TimelineEvent): { at: number; exact: boolean } {
  const day = ms(event.date);
  if (event.origin !== 'auto' && event.createdAt && Math.abs(event.createdAt - day) <= 36 * 3_600_000) return { at: event.createdAt, exact: true };
  return { at: day, exact: false };
}

function eventTitle(event: TimelineEvent): string {
  switch (event.kind) {
    case 'release':
      return event.version ? `Version ${event.version} is out` : event.title;
    case 'screenshots':
      return event.screenshotCount ? `${plural(event.screenshotCount, 'new screenshot')} uploaded` : 'New screenshots uploaded';
    case 'listing':
      return 'Store page changed';
    case 'featured':
      return 'Featured by the store';
    default:
      return event.title;
  }
}

/** Newest first, at most `limit`: reviews, rating changes, releases, uploads, round numbers passed and good news. */
export function studioActivity(apps: StudioApp[], milestones: Milestone[], today: DayString, limit = 40): StudioActivity[] {
  const out: StudioActivity[] = [];
  const reviewsFrom = ms(addDays(today, -REVIEW_NEWS_DAYS));
  const newsFrom = addDays(today, -NEWS_DAYS);
  for (const entry of apps) {
    const id = entry.app.id;
    for (const review of entry.data.reviews) {
      const at = reviewTime(review);
      if (at >= reviewsFrom) {
        out.push({
          id: `review:${review.id}`,
          appId: id,
          kind: 'review',
          at,
          exact: Number.isFinite(Date.parse(review.createdDate)) && review.createdDate.length > 10,
          title: review.title.trim() || review.body.trim().split(/\s+/).slice(0, 8).join(' '),
          detail: review.title.trim() ? review.body.trim() : undefined,
          stars: review.rating,
          tone: review.rating >= 4 ? 'good' : review.rating <= 2 ? 'warning' : 'neutral',
          action: { kind: 'reviews', unanswered: !review.response },
        });
      }
      for (const change of review.ratingChanges ?? []) {
        if (change.at < reviewsFrom || change.from === change.to) continue;
        out.push({
          id: `rating-change:${review.id}:${change.at}`,
          appId: id,
          kind: 'rating-change',
          at: change.at,
          exact: true,
          title: `A reviewer changed ${change.from} ${change.from === 1 ? 'star' : 'stars'} to ${change.to}`,
          detail: review.title.trim() || undefined,
          stars: change.to,
          tone: change.to > change.from ? 'good' : 'warning',
          action: { kind: 'reviews' },
        });
      }
    }
    for (const event of entry.data.events) {
      const kind = EVENT_ACTIVITY[event.kind];
      if (!kind || event.date < newsFrom) continue;
      out.push({
        id: `event:${event.id}`,
        appId: id,
        kind,
        ...eventTime(event),
        title: eventTitle(event),
        detail: event.kind === 'release' ? undefined : event.detail,
        tone: event.kind === 'featured' ? 'good' : 'neutral',
        action: { kind: 'timeline', eventId: event.id },
      });
    }
    for (const insight of entry.input.insights ?? []) {
      // Round numbers come from the milestones below, with their own days.
      if (insight.tone !== 'good' || insight.weight < 50 || insight.kind === 'milestone' || insight.date < newsFrom) continue;
      out.push({
        id: `insight:${id}:${insight.id}`,
        appId: id,
        kind: 'good-news',
        at: ms(insight.date),
        exact: false,
        title: insight.title,
        detail: insight.body,
        tone: 'good',
        action: insight.action,
      });
    }
  }
  for (const milestone of milestones) {
    if (!milestone.appId || !milestone.passedOn || milestone.passed <= 0 || milestone.passedOn < newsFrom) continue;
    const words = MILESTONE_WORDS[milestone.kind];
    out.push({
      id: `milestone:${milestone.id}:${milestone.passed}`,
      appId: milestone.appId,
      kind: 'milestone',
      at: ms(milestone.passedOn),
      exact: false,
      title: `Passed ${formatCount(milestone.passed)} ${milestone.passed === 1 ? words.one : words.many}`,
      tone: 'good',
      action: milestone.kind === 'downloads' ? undefined : { kind: 'reviews' },
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

// --- the screenshots ------------------------------------------------------------------------

export interface StudioImpact {
  appId: string;
  event: TimelineEvent;
  impact: ImpactResult;
}

/** Each app's newest screenshots upload in the last 90 days, measured as its Overview measures it. */
export function studioImpacts(apps: StudioApp[], today: DayString): StudioImpact[] {
  const from = addDays(today, -90);
  const out: StudioImpact[] = [];
  for (const entry of apps) {
    const latest = entry.through;
    if (!latest) continue;
    const event = [...entry.data.events]
      .filter((item) => item.kind === 'screenshots' && item.date >= from)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!event) continue;
    out.push({ appId: entry.app.id, event, impact: eventImpact(entry.byDate, event, { latest, events: entry.data.events }) });
  }
  return out.sort((a, b) => b.event.date.localeCompare(a.event.date));
}

// --- the sentences at the top ----------------------------------------------------------------

function changeWords(change: number, days: number): { text: string; strong: string | null } | null {
  const percent = Math.round(Math.abs(change) * 100);
  const before = days === 365 ? 'the 12 months before' : `the ${days} days before`;
  if (percent < 3) return { text: `About the same as ${before}.`, strong: null };
  if (percent > 999) return null;
  const move = `${percent}% ${change > 0 ? 'more' : 'fewer'}`;
  return { text: `That's ${move} than ${before}.`, strong: move };
}

/** A sentence at the top of Today, and the words in it worth bold type. */
export interface BriefLine {
  text: string;
  strong: string[];
}

/**
 * Two or three plain sentences about the apps, most useful first: the
 * downloads, a round number just passed, what the newest screenshots did, the
 * reviews waiting. Each sentence names its app, and a change is only said when
 * every app with downloads can be compared.
 */
export function studioBrief(
  apps: StudioApp[],
  options: { days: number; milestones: Milestone[]; impacts: StudioImpact[]; today: DayString }
): BriefLine[] {
  const lines: BriefLine[] = [];
  const nameOf = (appId: string) => apps.find((entry) => entry.app.id === appId)?.app.name ?? 'Your app';
  const downloads = studioFigure(apps, 'downloads');
  const several = downloads.reporting.length > 1;
  if (downloads.value !== null) {
    const subject = several ? 'Your apps' : nameOf(downloads.reporting[0]);
    const period = options.days === 365 ? 'in the last 12 months' : `in the last ${options.days} days`;
    const count = plural(downloads.value, 'new download');
    const line: BriefLine = { text: `${subject} got ${count} ${period}.`, strong: [count] };
    if (downloads.change !== null && downloads.compared.length === downloads.reporting.length && downloads.value >= 10) {
      const words = changeWords(downloads.change, options.days);
      if (words) {
        line.text += ` ${words.text}`;
        if (words.strong) line.strong.push(words.strong);
      }
    }
    lines.push(line);
  }
  const passed = options.milestones
    .filter((milestone) => milestone.appId && milestone.passedOn && milestone.passed > 0 && milestone.passedOn >= addDays(options.today, -7))
    .sort((a, b) => b.passed - a.passed)[0];
  if (passed) {
    const words = MILESTONE_WORDS[passed.kind];
    const name = nameOf(passed.appId!);
    const mark = `${formatCount(passed.passed)} ${passed.passed === 1 ? words.one : words.many}`;
    lines.push({ text: `${name} passed ${mark} on ${formatDay(passed.passedOn!)}.`, strong: [name, mark] });
  }
  const shots = options.impacts.find((entry) => entry.impact.verdict === 'better' || entry.impact.verdict === 'worse');
  if (shots && shots.impact.change !== null) {
    // What moved since the new screenshots went live, never that they moved it (rule 50).
    const name = nameOf(shots.appId);
    const what = shots.impact.measure !== 'downloads' ? 'the download rate is' : 'new downloads a day are';
    const move = `${shots.impact.change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(shots.impact.change) * 100)}%`;
    const since = shots.impact.liveDate ? ` since the new screenshots went live on ${formatDay(shots.impact.liveDate)}` : ' since the new screenshots went live';
    lines.push({ text: `In ${name}, ${what} ${move}${since}.`, strong: [name, move] });
  }
  const waiting = apps.reduce((sum, entry) => sum + entry.waiting, 0);
  if (waiting > 0) {
    const count = plural(waiting, 'review');
    lines.push({ text: `${count} ${waiting === 1 ? 'is' : 'are'} waiting for a reply.`, strong: [count] });
  }
  // Which app brought most of the downloads comes last: the apps table shows it too.
  const top = downloads.parts[0];
  if (several && top && downloads.value && top.value / downloads.value >= 0.5) {
    const name = nameOf(top.appId);
    lines.push(
      top.value === downloads.value
        ? { text: `All the new downloads came from ${name}.`, strong: [name] }
        : { text: `${name} brought in ${formatCount(top.value)} of the new downloads.`, strong: [name, formatCount(top.value)] }
    );
  }
  return lines.slice(0, 3);
}

/**
 * Today as plain text, for the Copy summary button: the sentences, the
 * totals and one line per app with numbers, to paste into a chat or a post.
 */
export function studioSummaryText(options: {
  title: string;
  brief: BriefLine[];
  apps: StudioApp[];
  figures: Record<StudioMetric, StudioFigure>;
  rating: { average: number | null; count: number | null; apps: number; weighted: boolean };
  days: number;
}): string {
  const lines: string[] = [options.title, ''];
  for (const line of options.brief) lines.push(line.text);
  if (options.brief.length) lines.push('');
  const change = (figure: StudioFigure) =>
    figure.change !== null && figure.compared.length > 0
      ? ` (${figure.change >= 0 ? '+' : ''}${Math.round(figure.change * 100)}%${figure.compared.length < figure.reporting.length ? `, ${figure.compared.length} of ${figure.reporting.length} apps compared` : ''})`
      : '';
  const period = options.days === 365 ? 'last 12 months' : `last ${options.days} days`;
  const labels: Record<StudioMetric, string> = { downloads: 'New downloads', pageViews: 'Page visits', rate: 'Download rate', proceeds: 'Earnings' };
  for (const metric of ['downloads', 'pageViews', 'rate', 'proceeds'] as StudioMetric[]) {
    const figure = options.figures[metric];
    if (figure.value === null) continue;
    const others = figure.others ? Object.keys(figure.others).length : 0;
    lines.push(`${labels[metric]}, ${period}: ${formatFigure(figure)}${change(figure)}${metric === 'proceeds' && others ? `, plus ${others} other currenc${others === 1 ? 'y' : 'ies'}` : ''}`);
  }
  if (options.rating.average !== null) {
    const from = options.rating.weighted && options.rating.count ? ` from ${plural(options.rating.count, 'rating')}` : options.rating.apps > 1 ? `, the average of ${options.rating.apps} apps' ratings` : '';
    lines.push(`Rating: ${options.rating.average.toFixed(1)}${from}`);
  }
  const rows = options.apps
    .filter((entry) => entry.counted && entry.current)
    .map((entry) => ({ entry, downloads: metricValue(entry.current!, 'downloads') }))
    .filter((row) => row.downloads !== null)
    .sort((a, b) => b.downloads! - a.downloads!);
  if (rows.length > 1) {
    lines.push('');
    for (const { entry, downloads } of rows) {
      const rating = entry.rating.average !== null ? `, ${entry.rating.average.toFixed(1)} stars` : '';
      lines.push(`${entry.app.name}: ${plural(downloads!, 'new download')}${rating}`);
    }
  }
  return lines.join('\n').trim();
}

/** "Good morning", "Good afternoon" or "Good evening", by the hour on this computer. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A figure as the tiles print it. */
export function formatFigure(figure: StudioFigure): string {
  if (figure.value === null) return 'n/a';
  if (figure.metric === 'rate') return formatRate(figure.value);
  if (figure.metric === 'proceeds') return formatMoney(figure.value, figure.currency ?? 'USD');
  return formatCount(figure.value);
}
