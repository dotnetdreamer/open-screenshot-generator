// Numbers over a span of days, from the stored day records.
//
// Downloads have two sources. The analytics Downloads report is the better one
// (it splits first-time downloads by source and page), and Sales and Trends is
// the faster one (it arrives the next morning and goes back a year on day
// one). A day uses analytics when that feed has reported it and Sales and
// Trends otherwise, so a chart never stops at the edge of one feed's history
// and never counts a download twice.
//
// Conversion follows App Store Connect's definitions:
//   conversion rate        (first-time downloads + redownloads) / unique impressions
//   product page rate      downloads started on the product page / unique page views
// and is only computed over days where both halves were reported, so a day
// with impressions but no download report yet cannot drag the rate to zero.

import { addDays, dayRange, inWindow, previousWindow, type DayWindow } from './dates';
import { addCounts } from './records';
import type { Counts, DayRecord, DayString, SourceType } from './types';

export type MetricId =
  | 'impressions'
  | 'pageViews'
  | 'downloads'
  | 'conversion'
  | 'pageConversion'
  | 'redownloads'
  | 'updates'
  | 'iapUnits'
  | 'proceeds';

export interface MetricSpec {
  id: MetricId;
  label: string;
  /** Short explanation, shown under the metric's tile. */
  hint: string;
  kind: 'count' | 'rate' | 'money';
}

export const METRICS: Record<MetricId, MetricSpec> = {
  impressions: { id: 'impressions', label: 'Times seen', hint: "How often your app showed up in the App Store. In App Store Connect: Impressions", kind: 'count' },
  pageViews: { id: 'pageViews', label: 'Page visits', hint: "How often people opened your app's page. In App Store Connect: Product Page Views", kind: 'count' },
  downloads: { id: 'downloads', label: 'New downloads', hint: 'People who downloaded your app for the first time', kind: 'count' },
  conversion: { id: 'conversion', label: 'Download rate', hint: "How many of the people who saw your app then downloaded your app. In App Store Connect: Conversion Rate", kind: 'rate' },
  pageConversion: { id: 'pageConversion', label: 'Page download rate', hint: "How many of the people who opened your app's page then downloaded your app", kind: 'rate' },
  redownloads: { id: 'redownloads', label: 'Redownloads', hint: 'People who downloaded your app again', kind: 'count' },
  updates: { id: 'updates', label: 'Updates', hint: 'Updates installed', kind: 'count' },
  iapUnits: { id: 'iapUnits', label: 'In-app purchases', hint: 'Purchases and subscription renewals', kind: 'count' },
  proceeds: { id: 'proceeds', label: 'Earnings', hint: "What Apple pays you, after Apple's fee", kind: 'money' },
};

/** Which slice of the data to read. Empty means everything. */
export interface MetricFilter {
  territory?: string;
  source?: SourceType;
}

/** A span's numbers, everything summed except the rates. */
export interface Totals {
  impressions: number;
  uniqueImpressions: number;
  pageViews: number;
  uniquePageViews: number;
  downloads: number;
  firstDownloads: number;
  redownloads: number;
  pageDownloads: number;
  updates: number;
  iapUnits: number;
  proceeds: Record<string, number>;
  /** Null where no day in the span had both halves reported. */
  conversion: number | null;
  pageConversion: number | null;
  /** Inputs to the rates, for significance tests. */
  conversionBase: { downloads: number; uniqueImpressions: number };
  pageConversionBase: { downloads: number; uniquePageViews: number };
  /** Days that had any data at all, and which feeds. */
  days: number;
  hasEngagement: boolean;
  hasDownloads: boolean;
  hasSales: boolean;
}

function sliceOf(record: DayRecord, filter: MetricFilter): Counts {
  if (filter.source) {
    // Sales and Trends has no source, so a source filter reads analytics only.
    return record.sources[filter.source] ?? {};
  }
  if (filter.territory) return record.territories[filter.territory] ?? {};
  const total: Counts = {};
  for (const counts of Object.values(record.territories)) addCounts(total, counts);
  return total;
}

interface DayValues {
  date: DayString;
  impressions: number | null;
  uniqueImpressions: number | null;
  pageViews: number | null;
  uniquePageViews: number | null;
  downloads: number | null;
  firstDownloads: number | null;
  redownloads: number | null;
  pageDownloads: number | null;
  updates: number | null;
  iapUnits: number | null;
  proceeds: Record<string, number> | null;
}

/** One day's values, with null for every number no feed has reported for that day. */
export function dayValues(record: DayRecord | undefined, date: DayString, filter: MetricFilter = {}): DayValues {
  const empty: DayValues = {
    date,
    impressions: null,
    uniqueImpressions: null,
    pageViews: null,
    uniquePageViews: null,
    downloads: null,
    firstDownloads: null,
    redownloads: null,
    pageDownloads: null,
    updates: null,
    iapUnits: null,
    proceeds: null,
  };
  if (!record) return empty;
  const counts = sliceOf(record, filter);
  const engagement = record.feeds.engagement !== undefined;
  const analytics = record.feeds.downloads !== undefined;
  const sales = record.feeds.sales !== undefined && !filter.source;
  const out = { ...empty };
  if (engagement) {
    out.impressions = counts.impressions ?? 0;
    out.uniqueImpressions = counts.uniqueImpressions ?? 0;
    out.pageViews = counts.pageViews ?? 0;
    out.uniquePageViews = counts.uniquePageViews ?? 0;
  }
  if (analytics) {
    out.firstDownloads = counts.firstDownloads ?? 0;
    out.redownloads = counts.redownloads ?? 0;
    out.pageDownloads = counts.pageDownloads ?? 0;
    out.downloads = out.firstDownloads;
  } else if (sales) {
    out.firstDownloads = counts.units ?? 0;
    out.redownloads = counts.reunits ?? 0;
    out.downloads = out.firstDownloads;
  }
  if (sales) {
    out.updates = counts.updates ?? 0;
    out.iapUnits = counts.iapUnits ?? 0;
    out.proceeds = counts.proceeds ?? {};
  }
  return out;
}

export function indexRecords(records: DayRecord[]): Map<DayString, DayRecord> {
  return new Map(records.map((record) => [record.date, record]));
}

export function totalsFor(
  byDate: Map<DayString, DayRecord>,
  window: DayWindow,
  filter: MetricFilter = {}
): Totals {
  const totals: Totals = {
    impressions: 0,
    uniqueImpressions: 0,
    pageViews: 0,
    uniquePageViews: 0,
    downloads: 0,
    firstDownloads: 0,
    redownloads: 0,
    pageDownloads: 0,
    updates: 0,
    iapUnits: 0,
    proceeds: {},
    conversion: null,
    pageConversion: null,
    conversionBase: { downloads: 0, uniqueImpressions: 0 },
    pageConversionBase: { downloads: 0, uniquePageViews: 0 },
    days: 0,
    hasEngagement: false,
    hasDownloads: false,
    hasSales: false,
  };
  for (const date of dayRange(window.from, window.to)) {
    const record = byDate.get(date);
    if (!record) continue;
    const values = dayValues(record, date, filter);
    const any = values.impressions !== null || values.downloads !== null;
    if (!any) continue;
    totals.days += 1;
    if (values.impressions !== null) {
      totals.hasEngagement = true;
      totals.impressions += values.impressions;
      totals.uniqueImpressions += values.uniqueImpressions ?? 0;
      totals.pageViews += values.pageViews ?? 0;
      totals.uniquePageViews += values.uniquePageViews ?? 0;
    }
    if (values.downloads !== null) {
      totals.downloads += values.downloads;
      totals.firstDownloads += values.firstDownloads ?? 0;
      totals.redownloads += values.redownloads ?? 0;
    }
    if (record.feeds.downloads !== undefined) {
      totals.hasDownloads = true;
      totals.pageDownloads += values.pageDownloads ?? 0;
    }
    if (values.proceeds !== null) {
      totals.hasSales = true;
      totals.updates += values.updates ?? 0;
      totals.iapUnits += values.iapUnits ?? 0;
      for (const [currency, amount] of Object.entries(values.proceeds)) {
        totals.proceeds[currency] = Math.round(((totals.proceeds[currency] ?? 0) + amount) * 100) / 100;
      }
    }
    if (values.uniqueImpressions !== null && values.downloads !== null) {
      totals.conversionBase.downloads += (values.firstDownloads ?? 0) + (values.redownloads ?? 0);
      totals.conversionBase.uniqueImpressions += values.uniqueImpressions;
    }
    if (values.uniquePageViews !== null && record.feeds.downloads !== undefined) {
      totals.pageConversionBase.downloads += values.pageDownloads ?? 0;
      totals.pageConversionBase.uniquePageViews += values.uniquePageViews;
    }
  }
  if (totals.conversionBase.uniqueImpressions > 0) {
    totals.conversion = totals.conversionBase.downloads / totals.conversionBase.uniqueImpressions;
  }
  if (totals.pageConversionBase.uniquePageViews > 0) {
    totals.pageConversion = totals.pageConversionBase.downloads / totals.pageConversionBase.uniquePageViews;
  }
  return totals;
}

/**
 * Rough units per US dollar. Only used to decide which currency to headline,
 * never shown and never used to add currencies together: 1,330 won is not more
 * money than 10 dollars, and without this the yen or the won would always win.
 */
const ROUGH_PER_USD: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, JPY: 150, CNY: 7.2, KRW: 1330, INR: 83, BRL: 5.1, CAD: 1.36, AUD: 1.52,
  MXN: 17, CHF: 0.88, SEK: 10.5, NOK: 10.7, DKK: 6.9, PLN: 4, TRY: 32, RUB: 90, ZAR: 18.5, SGD: 1.35,
  HKD: 7.8, TWD: 32, NZD: 1.65, ILS: 3.7, SAR: 3.75, AED: 3.67, IDR: 15700, THB: 36, MYR: 4.7, PHP: 56,
  VND: 25000, CZK: 23, HUF: 360, RON: 4.6, BGN: 1.8, CLP: 950, COP: 4000, PEN: 3.75, EGP: 48, NGN: 1500,
  PKR: 280, KZT: 450, QAR: 3.64, TZS: 2500,
};

/** The currency most of the proceeds came in, by value, for headline numbers. */
export function primaryCurrency(proceeds: Record<string, number>, fallback = 'USD'): string {
  let best = fallback;
  let bestValue = -Infinity;
  for (const [currency, amount] of Object.entries(proceeds)) {
    const value = Math.abs(amount) / (ROUGH_PER_USD[currency] ?? 1);
    if (value > bestValue) {
      best = currency;
      bestValue = value;
    }
  }
  return best;
}

/**
 * The one currency to state proceeds in when spans are put side by side. Each
 * span choosing its own would print one span's yen beside another's dollars
 * under a single symbol, and the change between them would mean nothing. The
 * spans' proceeds are summed per currency first, so the pick is the currency
 * most of the money came in across all of them.
 */
export function proceedsCurrency(...spans: Totals[]): string {
  const combined: Record<string, number> = {};
  for (const span of spans) {
    for (const [currency, amount] of Object.entries(span.proceeds)) {
      combined[currency] = (combined[currency] ?? 0) + Math.abs(amount);
    }
  }
  return primaryCurrency(combined);
}

/**
 * A span's value for one metric. Proceeds are the part paid in `currency`,
 * which callers comparing two spans must pass (proceedsCurrency), or the
 * span's own main currency when it stands alone.
 */
export function metricValue(totals: Totals, metric: MetricId, currency?: string): number | null {
  switch (metric) {
    case 'impressions':
      return totals.hasEngagement ? totals.impressions : null;
    case 'pageViews':
      return totals.hasEngagement ? totals.pageViews : null;
    case 'downloads':
      return totals.days > 0 && (totals.hasDownloads || totals.hasSales) ? totals.downloads : null;
    case 'conversion':
      return totals.conversion;
    case 'pageConversion':
      return totals.pageConversion;
    case 'redownloads':
      return totals.hasDownloads || totals.hasSales ? totals.redownloads : null;
    case 'updates':
      return totals.hasSales ? totals.updates : null;
    case 'iapUnits':
      return totals.hasSales ? totals.iapUnits : null;
    case 'proceeds': {
      if (!totals.hasSales) return null;
      return totals.proceeds[currency ?? primaryCurrency(totals.proceeds)] ?? 0;
    }
  }
}

/** The first day each feed has reported for an app: where its history starts. */
export interface FeedStarts {
  engagement: DayString | null;
  downloads: DayString | null;
  sales: DayString | null;
}

export function feedStarts(records: DayRecord[]): FeedStarts {
  const starts: FeedStarts = { engagement: null, downloads: null, sales: null };
  for (const record of records) {
    for (const feed of ['engagement', 'downloads', 'sales'] as const) {
      if (record.feeds[feed] === undefined) continue;
      const seen = starts[feed];
      if (!seen || record.date < seen) starts[feed] = record.date;
    }
  }
  return starts;
}

function earliest(...days: Array<DayString | null>): DayString | null {
  const present = days.filter((day): day is DayString => !!day);
  return present.length ? present.reduce((a, b) => (a < b ? a : b)) : null;
}

/**
 * Whether a metric's history reaches back over all of a span, so the span can
 * stand beside another. One that starts before the data does holds a fraction
 * of its days, and against a full span reads as a leap. Inside the history a
 * day without rows is a real zero: App Analytics sends nothing for a day
 * nobody saw the app, which is common for a small one, so counting the days
 * with rows instead would leave a small app with no comparisons at all.
 */
export function covers(starts: FeedStarts, metric: MetricId, window: DayWindow): boolean {
  const downloads = earliest(starts.downloads, starts.sales);
  let start: DayString | null;
  switch (metric) {
    case 'impressions':
    case 'pageViews':
      start = starts.engagement;
      break;
    case 'downloads':
    case 'redownloads':
      start = downloads;
      break;
    case 'conversion':
    case 'pageConversion':
      start = starts.engagement && downloads ? (starts.engagement > downloads ? starts.engagement : downloads) : null;
      break;
    case 'updates':
    case 'iapUnits':
    case 'proceeds':
      start = starts.sales;
      break;
  }
  return !!start && start <= window.from;
}

/** Relative change from `before` to `after`, null when it cannot be stated. */
export function relativeChange(after: number | null, before: number | null): number | null {
  if (after === null || before === null) return null;
  if (before === 0) return after === 0 ? 0 : null;
  return (after - before) / Math.abs(before);
}

export interface Comparison {
  current: Totals;
  previous: Totals;
  window: DayWindow;
  previousWindow: DayWindow;
}

export function compareWindows(byDate: Map<DayString, DayRecord>, window: DayWindow, filter: MetricFilter = {}): Comparison {
  const prior = previousWindow(window);
  return {
    current: totalsFor(byDate, window, filter),
    previous: totalsFor(byDate, prior, filter),
    window,
    previousWindow: prior,
  };
}

export interface SeriesPoint {
  date: DayString;
  /** Null where no feed has reported the day yet. */
  value: number | null;
}

/** One value per day, for charts. Rates are per day, from that day's own counts. */
export function dailySeries(
  byDate: Map<DayString, DayRecord>,
  window: DayWindow,
  metric: MetricId,
  filter: MetricFilter = {},
  currency?: string
): SeriesPoint[] {
  return dayRange(window.from, window.to).map((date) => {
    const values = dayValues(byDate.get(date), date, filter);
    let value: number | null = null;
    switch (metric) {
      case 'impressions':
        value = values.impressions;
        break;
      case 'pageViews':
        value = values.pageViews;
        break;
      case 'downloads':
        value = values.downloads;
        break;
      case 'redownloads':
        value = values.redownloads;
        break;
      case 'updates':
        value = values.updates;
        break;
      case 'iapUnits':
        value = values.iapUnits;
        break;
      case 'proceeds':
        value = values.proceeds ? values.proceeds[currency ?? primaryCurrency(values.proceeds)] ?? 0 : null;
        break;
      case 'conversion': {
        const base = values.uniqueImpressions;
        value =
          base && values.downloads !== null
            ? ((values.firstDownloads ?? 0) + (values.redownloads ?? 0)) / base
            : null;
        break;
      }
      case 'pageConversion': {
        const base = values.uniquePageViews;
        value = base && values.pageDownloads !== null ? values.pageDownloads / base : null;
        break;
      }
    }
    return { date, value };
  });
}

/** A trailing average that ignores missing days, so a weekly rhythm does not hide a trend. */
export function smooth(points: SeriesPoint[], span = 7): SeriesPoint[] {
  return points.map((point, index) => {
    let sum = 0;
    let count = 0;
    for (let back = Math.max(0, index - span + 1); back <= index; back += 1) {
      const value = points[back].value;
      if (value !== null) {
        sum += value;
        count += 1;
      }
    }
    return { date: point.date, value: count > 0 ? sum / count : null };
  });
}

export interface BreakdownRow {
  key: string;
  totals: Totals;
  /** Share of the window's first-time downloads, 0 to 1. */
  share: number;
  /** First-time downloads against the previous window of the same length. */
  change: number | null;
}

function keysIn(
  byDate: Map<DayString, DayRecord>,
  window: DayWindow,
  compareTo: DayWindow,
  pick: (record: DayRecord) => string[]
): string[] {
  const keys = new Set<string>();
  for (const [date, record] of byDate) {
    if (inWindow(date, window) || inWindow(date, compareTo)) {
      for (const key of pick(record)) keys.add(key);
    }
  }
  return Array.from(keys);
}

function breakdown(
  byDate: Map<DayString, DayRecord>,
  window: DayWindow,
  compareTo: DayWindow,
  keys: string[],
  filterFor: (key: string) => MetricFilter
): BreakdownRow[] {
  const all = totalsFor(byDate, window);
  const rows = keys.map((key) => {
    const filter = filterFor(key);
    const totals = totalsFor(byDate, window, filter);
    const previous = totalsFor(byDate, compareTo, filter);
    const base = all.downloads || 0;
    return {
      key,
      totals,
      share: base > 0 ? totals.downloads / base : 0,
      change: relativeChange(totals.downloads, previous.downloads),
    };
  });
  return rows.sort(
    (a, b) =>
      b.totals.downloads - a.totals.downloads ||
      b.totals.pageViews - a.totals.pageViews ||
      b.totals.impressions - a.totals.impressions
  );
}

/** Per storefront, with each one's change against `compareTo` (the span just before, unless a report says otherwise). */
export function byTerritory(
  byDate: Map<DayString, DayRecord>,
  window: DayWindow,
  compareTo: DayWindow = previousWindow(window)
): BreakdownRow[] {
  const keys = keysIn(byDate, window, compareTo, (record) => Object.keys(record.territories));
  return breakdown(byDate, window, compareTo, keys, (territory) => ({ territory })).filter(
    (row) => row.totals.downloads > 0 || row.totals.pageViews > 0 || row.totals.impressions > 0 || Object.keys(row.totals.proceeds).length > 0
  );
}

export function bySource(byDate: Map<DayString, DayRecord>, window: DayWindow): BreakdownRow[] {
  const compareTo = previousWindow(window);
  const keys = keysIn(byDate, window, compareTo, (record) => Object.keys(record.sources));
  return breakdown(byDate, window, compareTo, keys, (source) => ({ source: source as SourceType })).filter(
    (row) => row.totals.downloads > 0 || row.totals.impressions > 0
  );
}

/** The newest day any feed has reported, which is where "the last 28 days" ends. */
export function latestDay(records: DayRecord[]): DayString | null {
  let latest: DayString | null = null;
  for (const record of records) {
    if (Object.keys(record.feeds).length === 0) continue;
    if (!latest || record.date > latest) latest = record.date;
  }
  return latest;
}

/**
 * The newest day every feed this app uses has reported. Sales and Trends
 * arrives a day before the analytics reports, so a window ending at the newest
 * day of any feed would hold one day fewer of impressions than of downloads,
 * and every comparison against the previous window would read as a fall.
 * Feeds that have said nothing in the last 30 days do not hold it back.
 */
export function completeThrough(records: DayRecord[]): DayString | null {
  const latest = latestDay(records);
  if (!latest) return null;
  const horizon = addDays(latest, -30);
  const newest = new Map<string, DayString>();
  for (const record of records) {
    if (record.date < horizon) continue;
    for (const feed of Object.keys(record.feeds)) {
      const seen = newest.get(feed);
      if (!seen || record.date > seen) newest.set(feed, record.date);
    }
  }
  let through: DayString | null = null;
  for (const day of newest.values()) {
    if (!through || day < through) through = day;
  }
  return through ?? latest;
}

export function earliestDay(records: DayRecord[]): DayString | null {
  let earliest: DayString | null = null;
  for (const record of records) {
    if (Object.keys(record.feeds).length === 0) continue;
    if (!earliest || record.date < earliest) earliest = record.date;
  }
  return earliest;
}

/** Days per bucket, so a year-long chart groups into weeks. */
export function bucketSeries(points: SeriesPoint[], size: number, mode: 'sum' | 'mean'): SeriesPoint[] {
  if (size <= 1) return points;
  const out: SeriesPoint[] = [];
  for (let start = 0; start < points.length; start += size) {
    const slice = points.slice(start, start + size);
    const present = slice.filter((point) => point.value !== null);
    if (present.length === 0) {
      out.push({ date: slice[0].date, value: null });
      continue;
    }
    const sum = present.reduce((acc, point) => acc + (point.value ?? 0), 0);
    out.push({ date: slice[0].date, value: mode === 'sum' ? sum : sum / present.length });
  }
  return out;
}

/** Sum of a series, ignoring missing days. */
export function seriesSum(points: SeriesPoint[]): number {
  return points.reduce((acc, point) => acc + (point.value ?? 0), 0);
}

/** The last `days` days ending where every feed has reported, or at `fallback` with no data. */
export function defaultWindow(records: DayRecord[], days: number, fallback: DayString): DayWindow {
  const to = completeThrough(records) ?? fallback;
  return { from: addDays(to, -(days - 1)), to };
}
