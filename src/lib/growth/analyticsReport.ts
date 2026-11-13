// The two analytics reports the growth feature reads, from Apple's Analytics
// Reports API (documentation/analytics-reports):
//
//   App Store Discovery and Engagement (Standard)
//     Date, App Name, App Apple Identifier, Event, Page Type, Source Type,
//     Engagement Type, Device, Platform Version, Territory, Counts, Unique Counts
//     Event is Impression, Page view or Tap. A page view can be of any page
//     the store has for the app: Product page, Store sheet, In-app event, App
//     privacy, App version history, Developer page, Media view and others.
//     Only Product page rows count as product page views, because the
//     Downloads report credits downloads to the product page the same way,
//     and the product page rate divides one by the other.
//
//   App Store Downloads (Standard)
//     Date, App Name, App Apple Identifier, Download Type, App Version, Device,
//     Platform Version, Source Type, Page Type, Pre-Order, Territory, Counts
//     Download Type is First-time download, Redownload, Manual update,
//     Auto-update or Restore.
//
// Rows are already aggregated per combination of those columns, so a day's
// impressions are the sum of its Impression rows. "Unique Counts" are summed
// the same way, which counts a device that saw the app in two storefronts
// twice; App Store Connect's own totals do the same per breakdown.

import { normalizeDay } from './dates';
import { columnIndex, numberCell, parseDelimited } from './delimited';
import { addCounts, bucket, feedDayFor, type FeedBatch } from './records';
import { territoryCode } from './territories';
import type { Counts, SourceType } from './types';

export function sourceTypeOf(value: string | undefined): SourceType {
  const text = (value ?? '').trim().toLowerCase();
  if (text.includes('search')) return 'search';
  if (text.includes('browse')) return 'browse';
  if (text.includes('app referrer') || text === 'app referral') return 'app-referrer';
  if (text.includes('web referrer') || text === 'web referral') return 'web-referrer';
  if (text.includes('app clip')) return 'app-clip';
  if (text.includes('notification')) return 'notification';
  if (text.includes('institutional')) return 'institutional';
  return 'unavailable';
}

/** Apple's device column, folded into the families the overview shows. */
export function deviceFamilyOf(value: string | undefined): string {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return 'Other';
  if (text.includes('iphone') || text.includes('ipod')) return 'iPhone';
  if (text.includes('ipad')) return 'iPad';
  if (text.includes('mac') || text.includes('desktop')) return 'Mac';
  if (text.includes('watch')) return 'Apple Watch';
  if (text.includes('tv')) return 'Apple TV';
  if (text.includes('vision')) return 'Apple Vision Pro';
  return 'Other';
}

/**
 * Whether a Page Type cell is the product page. A report without the column
 * cannot say which page a view was on, so there every page view counts.
 */
export function isProductPage(value: string | undefined): boolean {
  if (value === undefined) return true;
  return value.trim().toLowerCase() === 'product page';
}

export type AnalyticsReportKind = 'engagement' | 'downloads';

/**
 * Which report a name from /v1/analyticsReportRequests/{id}/reports is, if it
 * is one of the two this feature reads. The Standard level only: the Detailed
 * one repeats the same counts split finer, so reading both would double them.
 */
export function analyticsReportKind(name: string): AnalyticsReportKind | null {
  const text = name.toLowerCase();
  if (!text.includes('standard')) return null;
  if (text.includes('discovery') && text.includes('engagement')) return 'engagement';
  if (text.includes('download')) return 'downloads';
  return null;
}

interface ParseOptions {
  /** Keep only rows for this app. The reports are per app, but a stray row should not leak in. */
  appId?: string;
}

function rowFilter(header: string[], appId?: string): (row: string[]) => boolean {
  const index = columnIndex(header, 'App Apple Identifier', 'Apple Identifier', 'App ID');
  if (!appId || index < 0) return () => true;
  return (row) => {
    const value = (row[index] ?? '').trim();
    return !value || value === appId;
  };
}

function addEverywhere(
  batch: FeedBatch,
  date: string,
  territory: string,
  source: SourceType,
  device: string,
  counts: Counts
): void {
  const day = feedDayFor(batch, date);
  addCounts(bucket(day.territories, territory), counts);
  addCounts(bucket(day.sources, source), counts);
  addCounts(bucket(day.devices, device), counts);
}

export function parseEngagementReport(text: string, options: ParseOptions = {}): FeedBatch {
  const { header, rows } = parseDelimited(text);
  const col = {
    date: columnIndex(header, 'Date'),
    event: columnIndex(header, 'Event'),
    page: columnIndex(header, 'Page Type'),
    source: columnIndex(header, 'Source Type'),
    device: columnIndex(header, 'Device'),
    territory: columnIndex(header, 'Territory'),
    counts: columnIndex(header, 'Counts'),
    unique: columnIndex(header, 'Unique Counts'),
  };
  const batch: FeedBatch = new Map();
  if (col.date < 0 || col.event < 0 || col.counts < 0) return batch;
  const keep = rowFilter(header, options.appId);

  for (const row of rows) {
    if (!keep(row)) continue;
    const date = normalizeDay(row[col.date]);
    if (!date) continue;
    const event = (row[col.event] ?? '').trim().toLowerCase();
    const counts = numberCell(row[col.counts]);
    const unique = col.unique >= 0 ? numberCell(row[col.unique]) : 0;
    let add: Counts | null = null;
    if (event.startsWith('impression')) add = { impressions: counts, uniqueImpressions: unique };
    else if (event.startsWith('page view') && isProductPage(col.page >= 0 ? row[col.page] : undefined)) {
      add = { pageViews: counts, uniquePageViews: unique };
    }
    if (!add) continue;
    addEverywhere(
      batch,
      date,
      territoryCode(col.territory >= 0 ? row[col.territory] : ''),
      sourceTypeOf(col.source >= 0 ? row[col.source] : ''),
      deviceFamilyOf(col.device >= 0 ? row[col.device] : ''),
      add
    );
  }
  return batch;
}

export function parseDownloadsReport(text: string, options: ParseOptions = {}): FeedBatch {
  const { header, rows } = parseDelimited(text);
  const col = {
    date: columnIndex(header, 'Date'),
    type: columnIndex(header, 'Download Type'),
    source: columnIndex(header, 'Source Type'),
    page: columnIndex(header, 'Page Type'),
    device: columnIndex(header, 'Device'),
    territory: columnIndex(header, 'Territory'),
    counts: columnIndex(header, 'Counts'),
  };
  const batch: FeedBatch = new Map();
  if (col.date < 0 || col.type < 0 || col.counts < 0) return batch;
  const keep = rowFilter(header, options.appId);

  for (const row of rows) {
    if (!keep(row)) continue;
    const date = normalizeDay(row[col.date]);
    if (!date) continue;
    const type = (row[col.type] ?? '').trim().toLowerCase();
    const counts = numberCell(row[col.counts]);
    let add: Counts | null = null;
    if (type.startsWith('first')) add = { firstDownloads: counts };
    else if (type.startsWith('redownload')) add = { redownloads: counts };
    if (!add) continue;
    if (col.page >= 0 && isProductPage(row[col.page])) add.pageDownloads = counts;
    addEverywhere(
      batch,
      date,
      territoryCode(col.territory >= 0 ? row[col.territory] : ''),
      sourceTypeOf(col.source >= 0 ? row[col.source] : ''),
      deviceFamilyOf(col.device >= 0 ? row[col.device] : ''),
      add
    );
  }
  return batch;
}

/** Merge several parsed segments of one instance into one batch, before it replaces anything. */
export function combineBatches(batches: FeedBatch[]): FeedBatch {
  const out: FeedBatch = new Map();
  for (const batch of batches) {
    for (const [date, day] of batch) {
      const target = feedDayFor(out, date);
      for (const [key, counts] of Object.entries(day.territories)) addCounts(bucket(target.territories, key), counts);
      for (const [key, counts] of Object.entries(day.sources)) {
        if (counts) addCounts(bucket(target.sources, key as SourceType), counts);
      }
      for (const [key, counts] of Object.entries(day.devices)) addCounts(bucket(target.devices, key), counts);
    }
  }
  return out;
}
