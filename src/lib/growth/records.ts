// Folding a feed's report into the stored days.
//
// Each feed owns a fixed set of fields (FEED_FIELDS). When a feed reports a
// day, its fields on that day are REPLACED, never added to: Apple re-issues
// past days with corrections (an analytics instance "might contain data for
// that day, full data for past dates, or both"), and Sales and Trends can be
// fetched twice for the same date. Replacing makes every import idempotent,
// so a retry or an overlapping instance can never double a number.

import { FEED_FIELDS, type Counts, type DayRecord, type DayString, type FeedId, type SourceType } from './types';

/** What one feed says about one day, before it is merged. */
export interface FeedDay {
  territories: Record<string, Counts>;
  sources: Partial<Record<SourceType, Counts>>;
  devices: Record<string, Counts>;
}

/** A feed's whole report, by day. */
export type FeedBatch = Map<DayString, FeedDay>;

export function recordKey(appId: string, date: DayString): string {
  return `${appId}|${date}`;
}

export function emptyRecord(appId: string, date: DayString): DayRecord {
  return { key: recordKey(appId, date), appId, date, territories: {}, sources: {}, devices: {}, feeds: {} };
}

export function emptyFeedDay(): FeedDay {
  return { territories: {}, sources: {}, devices: {} };
}

/** The day's entry for `date` in `batch`, created on first use. */
export function feedDayFor(batch: FeedBatch, date: DayString): FeedDay {
  let day = batch.get(date);
  if (!day) {
    day = emptyFeedDay();
    batch.set(date, day);
  }
  return day;
}

export function bucket<K extends string>(map: Partial<Record<K, Counts>>, key: K): Counts {
  let counts = map[key];
  if (!counts) {
    counts = {};
    map[key] = counts;
  }
  return counts;
}

/** Add `add` into `target`, proceeds per currency. */
export function addCounts(target: Counts, add: Counts): void {
  for (const [field, value] of Object.entries(add) as Array<[keyof Counts, Counts[keyof Counts]]>) {
    if (value === undefined) continue;
    if (field === 'proceeds') {
      const proceeds = (target.proceeds ??= {});
      for (const [currency, amount] of Object.entries(value as Record<string, number>)) {
        proceeds[currency] = round2((proceeds[currency] ?? 0) + amount);
      }
    } else {
      (target as Record<string, number>)[field] = ((target as Record<string, number>)[field] ?? 0) + (value as number);
    }
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stripFields(map: Record<string, Counts>, fields: Array<keyof Counts>): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  for (const [key, counts] of Object.entries(map)) {
    const kept: Counts = { ...counts };
    for (const field of fields) delete kept[field];
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  return out;
}

function addMap(target: Record<string, Counts>, add: Record<string, Counts>): void {
  for (const [key, counts] of Object.entries(add)) {
    const existing = target[key] ?? (target[key] = {});
    addCounts(existing, counts);
  }
}

/**
 * The stored day with `feed`'s report for it in place of whatever that feed
 * said before. Pure: `existing` is not touched.
 */
export function mergeFeed(
  existing: DayRecord | undefined,
  appId: string,
  date: DayString,
  feed: FeedId,
  day: FeedDay,
  now: number
): DayRecord {
  const base = existing ?? emptyRecord(appId, date);
  const fields = FEED_FIELDS[feed];
  const territories = stripFields(base.territories, fields);
  const sources = stripFields(base.sources as Record<string, Counts>, fields);
  const devices = stripFields(base.devices ?? {}, fields);
  addMap(territories, day.territories);
  addMap(sources, day.sources as Record<string, Counts>);
  addMap(devices, day.devices);
  return {
    key: recordKey(appId, date),
    appId,
    date,
    territories,
    sources: sources as DayRecord['sources'],
    devices,
    feeds: { ...base.feeds, [feed]: now },
  };
}

/** Sum of every territory, which is the day's total for each field. */
export function dayTotal(record: DayRecord): Counts {
  const total: Counts = {};
  for (const counts of Object.values(record.territories)) addCounts(total, counts);
  return total;
}
