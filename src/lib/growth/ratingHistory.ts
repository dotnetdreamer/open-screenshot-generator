// The ratings history: what an app's star rating was on each day a refresh
// read it, by country, and the new ratings worked out from it.
//
// Neither store keeps a history. Apple's lookup and both stores' web pages say
// what a rating is now, so Growth writes a row for every day it reads one
// (RatingDay, in the growth database) and new ratings are the difference
// between two readings of the same country:
//
//   count       new ratings are the count now less the count before
//   stars       with Google Play's page read at both ends, the new ratings
//               per star are the difference per star, which is exact (Apple
//               shares no stars: its web pages refuse the app's HTTP client)
//   average     without stars, the sum of the new ratings is the sum now less
//               the sum before (average times count). Apple rounds the average
//               to five decimals, so for an app with millions of ratings that
//               sum is too rough to use, and the new ratings get no average
//               (`newSum` is null)
//
// A count that falls is not new ratings. A count that falls to less than half
// is Apple's reset (a developer can reset the summary rating with a new
// version), and the ratings counted since are all new; a smaller fall is
// ratings taken away, and counts as none.
//
// Google Play's report files are the other source: a row for every day, with
// the average of every rating and the average of the ratings given that day,
// and no counts. Those days have `dayAverage` and no steps.
//
// Everything here is pure. `recordRatings` is the one writer, and syncs,
// the Google Play import and the competitors check all go through it.

import { addDays, dayRange, inWindow, monthStart, today, weekStart, type DayWindow } from './dates';
import { updateRatingDays } from './db';
import { UNKNOWN_TERRITORY } from './territories';
import type { DayString, RatingDay, RatingPoint, StarCounts, StoreReview, TerritoryRating } from './types';
import { reviewDay } from './reviewTopics';

export type RatingGranularity = 'day' | 'week' | 'month';

/** Apple's averages have five decimals: each one can be off by half of the last. */
const AVERAGE_ROUNDING = 0.000005;

export function emptyStars(): StarCounts {
  return [0, 0, 0, 0, 0];
}

export function starTotal(stars: StarCounts): number {
  return stars[0] + stars[1] + stars[2] + stars[3] + stars[4];
}

/** The sum of the stars: one per one-star rating, five per five-star. */
export function starSum(stars: StarCounts): number {
  return stars[0] + 2 * stars[1] + 3 * stars[2] + 4 * stars[3] + 5 * stars[4];
}

export function addStars(a: StarCounts, b: StarCounts): StarCounts {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4]];
}

/** Stars as a store page gives them, five stars first or one star first, checked to be five whole numbers. */
export function asStarCounts(values: unknown, order: 'five-first' | 'one-first'): StarCounts | null {
  if (!Array.isArray(values) || values.length !== 5) return null;
  if (!values.every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)) return null;
  const numbers = values as number[];
  const oneFirst = order === 'one-first' ? numbers : [...numbers].reverse();
  return [oneFirst[0], oneFirst[1], oneFirst[2], oneFirst[3], oneFirst[4]];
}

// --- writing -------------------------------------------------------------------------

/**
 * One reading folded into the one already stored for that country and day.
 * The lookup and the store page are read one after the other and each brings
 * its own fields, so they merge. Stars read for another count are dropped:
 * they would no longer add up to it.
 */
export function mergePoint(before: RatingPoint | undefined, reading: RatingPoint): RatingPoint {
  if (!before) return reading;
  const merged: RatingPoint = { ...before, ...stripUndefined(reading) };
  // Google Play's files give no count; a count the store page gave that day stays.
  if (reading.count === null && before.count !== null) merged.count = before.count;
  if (!reading.stars && before.stars && reading.count !== null && reading.count !== before.count) delete merged.stars;
  return merged;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) if (entry !== undefined) (out as Record<string, unknown>)[key] = entry;
  return out;
}

export function withReadings(row: RatingDay | undefined, appId: string, date: DayString, readings: Record<string, RatingPoint>): RatingDay {
  const territories = { ...(row?.territories ?? {}) };
  for (const [territory, reading] of Object.entries(readings)) territories[territory] = mergePoint(territories[territory], reading);
  return { key: `${appId}|${date}`, appId, date, territories };
}

/** Write readings into the history: today's for a refresh, one row per day for Google Play's files. */
export async function recordRatings(appId: string, byDay: Map<DayString, Record<string, RatingPoint>>): Promise<void> {
  const dates = Array.from(byDay.keys()).filter((date) => Object.keys(byDay.get(date) ?? {}).length > 0);
  await updateRatingDays(appId, dates, (date, row) => withReadings(row, appId, date, byDay.get(date)!));
}

/** The readings of one refresh, dated today. */
export function todaysReadings(readings: Record<string, RatingPoint>, date: DayString = today()): Map<DayString, Record<string, RatingPoint>> {
  return new Map([[date, readings]]);
}

/** A stored storefront rating as a reading: the shape the ratings table and the history share. */
export function pointOf(rating: TerritoryRating, version?: string): RatingPoint {
  return {
    average: rating.average,
    // The ratings table writes 0 for a count the store does not give (Google Play's files).
    count: rating.count > 0 ? rating.count : null,
    ...(version ? { version } : {}),
    at: rating.checkedAt,
  };
}

// --- reading -------------------------------------------------------------------------

/** One country's readings, oldest first. */
export function readingsOf(rows: RatingDay[], territory: string): Array<{ date: DayString; point: RatingPoint }> {
  return rows
    .filter((row) => row.territories[territory])
    .map((row) => ({ date: row.date, point: row.territories[territory] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Every country with a reading, by its newest count, biggest first. */
export function territoriesOf(rows: RatingDay[]): string[] {
  const newest = new Map<string, { date: string; count: number }>();
  for (const row of rows) {
    for (const [territory, point] of Object.entries(row.territories)) {
      const seen = newest.get(territory);
      if (!seen || row.date > seen.date) newest.set(territory, { date: row.date, count: point.count ?? 0 });
    }
  }
  return Array.from(newest.entries())
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([territory]) => territory);
}

/** The first day the history has anything, or null. */
export function historyStart(rows: RatingDay[]): DayString | null {
  let first: DayString | null = null;
  for (const row of rows) if (Object.keys(row.territories).length > 0 && (!first || row.date < first)) first = row.date;
  return first;
}

/** What changed in one country between two readings, dated by the later one. */
export interface RatingStep {
  date: DayString;
  /** The day of the reading before. New ratings fall somewhere between the two. */
  since: DayString;
  territory: string;
  newCount: number;
  /** The new ratings' stars added up, or null when the readings cannot say. */
  newSum: number | null;
  /** Per star, when the store page was read at both ends. */
  newStars: StarCounts | null;
  /** The count fell to less than half: the store started counting again. */
  reset: boolean;
  /** The version on sale at the later reading, when the store says. */
  version?: string;
}

/** The steps of one country's readings. */
export function stepsOf(readings: Array<{ date: DayString; point: RatingPoint }>, territory: string): RatingStep[] {
  const steps: RatingStep[] = [];
  for (let index = 1; index < readings.length; index += 1) {
    const before = readings[index - 1];
    const after = readings[index];
    const step = stepBetween(before.point, after.point);
    if (!step) continue;
    steps.push({ ...step, date: after.date, since: before.date, territory, ...(after.point.version ? { version: after.point.version } : {}) });
  }
  return steps;
}

function stepBetween(before: RatingPoint, after: RatingPoint): Omit<RatingStep, 'date' | 'since' | 'territory' | 'version'> | null {
  if (before.count === null || after.count === null) return null;
  if (after.count < before.count) {
    // Less than half is a reset: what the store counts now came after it.
    if (after.count < before.count / 2) {
      return {
        newCount: after.count,
        newSum: after.stars ? starSum(after.stars) : after.average * after.count,
        newStars: after.stars ?? null,
        reset: true,
      };
    }
    return { newCount: 0, newSum: null, newStars: null, reset: false };
  }
  if (before.stars && after.stars) {
    const delta = after.stars.map((value, star) => value - before.stars![star]) as StarCounts;
    if (delta.every((value) => value >= 0)) {
      return { newCount: starTotal(delta), newSum: starSum(delta), newStars: delta, reset: false };
    }
    // Some ratings were changed or taken away, so the stars no longer tell
    // the new ones apart. The count still does.
  }
  const newCount = after.count - before.count;
  if (newCount === 0) return { newCount: 0, newSum: null, newStars: null, reset: false };
  const sum = after.average * after.count - before.average * before.count;
  const error = AVERAGE_ROUNDING * (after.count + before.count);
  const usable = error <= newCount * 0.25 && sum >= newCount - error && sum <= newCount * 5 + error;
  return { newCount, newSum: usable ? Math.min(newCount * 5, Math.max(newCount, sum)) : null, newStars: null, reset: false };
}

/** Every country's steps. */
export function ratingSteps(rows: RatingDay[], territory?: string): RatingStep[] {
  const territories = territory && territory !== 'all' ? [territory] : territoriesOf(rows);
  return territories.flatMap((code) => stepsOf(readingsOf(rows, code), code));
}

/** The first day of the bucket a day falls in. */
export function bucketOf(day: DayString, granularity: RatingGranularity): DayString {
  if (granularity === 'week') return weekStart(day);
  if (granularity === 'month') return monthStart(day);
  return day;
}

/** The buckets that cover a window, in order. */
export function bucketsIn(window: DayWindow, granularity: RatingGranularity): Array<{ start: DayString; end: DayString }> {
  const starts: DayString[] = [];
  for (const day of dayRange(window.from, window.to)) {
    const start = bucketOf(day, granularity);
    if (starts[starts.length - 1] !== start) starts.push(start);
  }
  return starts.map((start, index) => ({
    start,
    end: index + 1 < starts.length ? addDays(starts[index + 1], -1) : window.to,
  }));
}

export interface RatingBucket {
  start: DayString;
  end: DayString;
  /** Every rating at the end of the bucket: each country's newest reading up to then, added up. Null before the first reading. */
  count: number | null;
  average: number | null;
  /** New ratings in the bucket. */
  newCount: number;
  /** Their average, from the steps that can say. */
  newAverage: number | null;
  /** Per star, over the steps that had stars; null when none had. */
  newStars: StarCounts | null;
  /** New ratings whose stars the readings cannot tell: steps without the store page at both ends. */
  newUnknown: number;
  /** Google Play's files: the average of the ratings given on the bucket's days. */
  dayAverage: number | null;
  /** Some country's count was reset in the bucket. */
  reset: boolean;
  /** A step in the bucket began in an earlier bucket, so some of its new ratings may be from then. */
  spansGap: boolean;
}

/**
 * The history in buckets, for one country or all of them. The total is each
 * country's newest reading up to the bucket's end, so a refresh that read
 * only one country leaves the others as they were last read.
 */
export function ratingBuckets(
  rows: RatingDay[],
  options: { territory: string | 'all'; granularity: RatingGranularity; window: DayWindow }
): RatingBucket[] {
  // All countries is the whole app's row where the store has one (Google
  // Play's files), since its countries have averages and no counts to add up.
  const known = territoriesOf(rows);
  const territories = options.territory !== 'all' ? [options.territory] : known.includes(UNKNOWN_TERRITORY) ? [UNKNOWN_TERRITORY] : known;
  const readings = new Map(territories.map((code) => [code, readingsOf(rows, code)]));
  const steps = territories.flatMap((code) => stepsOf(readings.get(code) ?? [], code));
  return bucketsIn(options.window, options.granularity).map(({ start, end }) => {
    let count = 0;
    let sum = 0;
    let counted = false;
    let averageOnly: number[] = [];
    for (const code of territories) {
      const list = readings.get(code) ?? [];
      let newest: RatingPoint | null = null;
      for (const entry of list) {
        if (entry.date > end) break;
        newest = entry.point;
      }
      if (!newest) continue;
      if (newest.count === null) averageOnly.push(newest.average);
      else {
        counted = true;
        count += newest.count;
        sum += newest.average * newest.count;
      }
    }
    if (counted) averageOnly = [];
    const inside = steps.filter((step) => step.date >= start && step.date <= end);
    const newCount = inside.reduce((total, step) => total + step.newCount, 0);
    const summed = inside.filter((step) => step.newSum !== null && step.newCount > 0);
    const summedCount = summed.reduce((total, step) => total + step.newCount, 0);
    const newAverage = summedCount > 0 ? summed.reduce((total, step) => total + (step.newSum ?? 0), 0) / summedCount : null;
    const withStars = inside.filter((step) => step.newCount > 0 && step.newStars);
    const newStars = withStars.length > 0 ? withStars.reduce((total, step) => addStars(total, step.newStars!), emptyStars()) : null;
    const newUnknown = inside.filter((step) => step.newCount > 0 && !step.newStars).reduce((total, step) => total + step.newCount, 0);
    const days = territories.flatMap((code) =>
      (readings.get(code) ?? []).filter((entry) => entry.date >= start && entry.date <= end && entry.point.dayAverage !== undefined).map((entry) => entry.point.dayAverage!)
    );
    return {
      start,
      end,
      count: counted ? count : null,
      average: counted && count > 0 ? sum / count : averageOnly.length > 0 ? averageOnly.reduce((a, b) => a + b, 0) / averageOnly.length : null,
      newCount,
      newAverage,
      newStars,
      newUnknown,
      dayAverage: days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : null,
      reset: inside.some((step) => step.reset),
      spansGap: inside.some((step) => step.since < start && step.newCount > 0),
    };
  });
}

/** One country in the table. */
export interface CountryRatingRow {
  territory: string;
  average: number;
  count: number | null;
  stars?: StarCounts;
  /** New ratings in the window, and their average when the readings can say. */
  newCount: number;
  newAverage: number | null;
  /** The average now less the average at the window's start, when a reading that old exists. */
  change: number | null;
  /** When the newest reading was made, in ms. */
  at: number;
}

/**
 * Each country as it is now (the ratings table, which every refresh rewrites),
 * with what the history says about the window. A country the history has
 * never read still shows, with no new ratings.
 */
export function countryRows(rows: RatingDay[], current: TerritoryRating[], window: DayWindow): CountryRatingRow[] {
  const byTerritory = new Map(current.map((rating) => [rating.territory, rating]));
  const territories = Array.from(new Set([...current.map((rating) => rating.territory), ...territoriesOf(rows)]));
  return territories
    .map((territory): CountryRatingRow | null => {
      const list = readingsOf(rows, territory);
      const latest = list[list.length - 1]?.point;
      const stored = byTerritory.get(territory);
      const fromTable = stored ? pointOf(stored) : null;
      const now = latest && (!fromTable || latest.at >= fromTable.at) ? latest : fromTable ? { ...fromTable, count: fromTable.count ?? latest?.count ?? null } : null;
      // Apple answers a country with no ratings with an average of 0 from 0
      // ratings: the history keeps it, for the first rating there to count
      // as new, but the table has nothing to show for it.
      if (!now || now.count === 0) return null;
      const steps = stepsOf(list, territory).filter((step) => inWindow(step.date, window));
      const newCount = steps.reduce((total, step) => total + step.newCount, 0);
      const summed = steps.filter((step) => step.newSum !== null && step.newCount > 0);
      const summedCount = summed.reduce((total, step) => total + step.newCount, 0);
      let atStart: RatingPoint | null = null;
      for (const entry of list) {
        if (entry.date > window.from) break;
        atStart = entry.point;
      }
      return {
        territory,
        average: now.average,
        count: now.count,
        ...(now.stars ?? latest?.stars ? { stars: now.stars ?? latest?.stars } : {}),
        newCount,
        newAverage: summedCount > 0 ? summed.reduce((total, step) => total + (step.newSum ?? 0), 0) / summedCount : null,
        change: atStart ? now.average - atStart.average : null,
        at: stored?.checkedAt ?? latest?.at ?? 0,
      };
    })
    .filter((row): row is CountryRatingRow => !!row)
    .sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.territory.localeCompare(b.territory));
}

/** New ratings while each version was on sale, newest version first. App Store only: Google Play's readings have no version. */
export interface VersionRatings {
  version: string;
  from: DayString;
  to: DayString;
  newCount: number;
  newAverage: number | null;
}

export function versionRatings(rows: RatingDay[]): VersionRatings[] {
  const byVersion = new Map<string, { from: DayString; to: DayString; count: number; summedCount: number; sum: number }>();
  for (const step of ratingSteps(rows)) {
    if (!step.version || step.reset) continue;
    const entry = byVersion.get(step.version) ?? { from: step.since, to: step.date, count: 0, summedCount: 0, sum: 0 };
    entry.from = step.since < entry.from ? step.since : entry.from;
    entry.to = step.date > entry.to ? step.date : entry.to;
    entry.count += step.newCount;
    if (step.newSum !== null && step.newCount > 0) {
      entry.summedCount += step.newCount;
      entry.sum += step.newSum;
    }
    byVersion.set(step.version, entry);
  }
  return Array.from(byVersion.entries())
    .map(([version, entry]) => ({
      version,
      from: entry.from,
      to: entry.to,
      newCount: entry.count,
      newAverage: entry.summedCount > 0 ? entry.sum / entry.summedCount : null,
    }))
    .sort((a, b) => b.to.localeCompare(a.to) || b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/** Written reviews in buckets, per star: the one history every store gives in full. */
export interface ReviewBucket {
  start: DayString;
  end: DayString;
  stars: StarCounts;
  count: number;
  average: number | null;
}

export function reviewBuckets(reviews: StoreReview[], options: { territory: string | 'all'; granularity: RatingGranularity; window: DayWindow; play?: boolean }): ReviewBucket[] {
  const buckets = bucketsIn(options.window, options.granularity).map(({ start, end }) => ({ start, end, stars: emptyStars(), count: 0, average: null as number | null }));
  const index = new Map(buckets.map((bucket, position) => [bucket.start, position]));
  for (const review of reviews) {
    if (options.territory !== 'all') {
      const place = options.play ? review.language ?? '' : review.territory;
      if (place !== options.territory) continue;
    }
    const day = reviewDay(review);
    if (!inWindow(day, options.window)) continue;
    const position = index.get(bucketOf(day, options.granularity));
    if (position === undefined) continue;
    const star = Math.min(5, Math.max(1, Math.round(review.rating)));
    buckets[position].stars[star - 1] += 1;
    buckets[position].count += 1;
  }
  for (const bucket of buckets) bucket.average = bucket.count > 0 ? starSum(bucket.stars) / bucket.count : null;
  return buckets;
}
