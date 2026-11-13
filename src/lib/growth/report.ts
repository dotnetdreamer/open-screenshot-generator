// Weekly, monthly and yearly reports: the figures computed here, the summary
// written by whichever AI the user set up (or left out when there is none),
// and the result saved as Markdown, plain text or PDF (reportPdf.ts).
//
// A week runs Monday to Sunday and a month is a calendar month, the same
// periods App Store Connect uses, so a figure here can be checked against
// Apple's own screen. A week or month report is only offered for a period
// whose last day the data has reached: a half-reported week would read as a
// bad week. A year is too long to wait for, so the newest yearly report is
// the year so far, compared with the same days of the year before; the full
// years before it follow.
//
// A figure is only compared with the period before when both periods have
// that figure for nearly every day (`covers`). Sales and Trends goes back a
// year on the first sync and App Analytics less, so the period before is
// often half empty, and against it any period reads as a leap.

import {
  addDays,
  daysBetween,
  formatDay,
  formatMonth,
  formatWindow,
  monthEnd,
  monthStart,
  shiftYears,
  weekStart,
  yearEnd,
  yearStart,
  type DayWindow,
} from './dates';
import { formatCount, formatMoney, formatRate, formatRating, plural } from './format';
import { formatChange } from './impact';
import {
  byTerritory,
  bySource,
  completeThrough,
  feedStarts,
  covers,
  indexRecords,
  metricValue,
  proceedsCurrency,
  relativeChange,
  totalsFor,
  type MetricId,
  type Totals,
} from './metrics';
import { REVIEW_TOPIC_LABELS, averageRating, reviewsIn, topicCounts, unansweredLow } from './reviewTopics';
import { territoryName } from './territories';
import { EVENT_KIND_LABELS, SOURCE_LABELS, type DayRecord, type SourceType, type StoreReview, type TimelineEvent } from './types';

export type ReportPeriod = 'week' | 'month' | 'year';

export interface ReportLine {
  label: string;
  value: string;
  change: string | null;
  /** True when the change is good news, false when bad, null when neither. */
  good: boolean | null;
}

export interface PeriodReport {
  appName: string;
  period: ReportPeriod;
  window: DayWindow;
  previous: DayWindow;
  title: string;
  lines: ReportLine[];
  territories: Array<{ name: string; downloads: string; share: string; change: string | null }>;
  sources: Array<{ name: string; impressions: string; downloads: string; conversion: string }>;
  reviews: { count: number; average: string; unanswered: number; topics: string[] };
  events: Array<{ date: string; label: string }>;
  /** Days in the period with no data from any feed. */
  missingDays: number;
  /** Whether downloads go back over the whole period before, which the storefront changes need. */
  previousCovered: boolean;
  /** Figures shown without a change, because their history does not reach back over the period before. */
  uncompared: string[];
  currency: string;
  current: Totals;
  previousTotals: Totals;
}

/**
 * The newest week or month the data has reached the end of, or the year so
 * far (a whole year once the data reaches 31 December), or null.
 */
export function latestCompletePeriod(records: DayRecord[], period: ReportPeriod): DayWindow | null {
  const through = completeThrough(records);
  if (!through) return null;
  if (period === 'year') return { from: yearStart(through), to: through };
  if (period === 'week') {
    const start = weekStart(through);
    const end = addDays(start, 6);
    if (end <= through) return { from: start, to: end };
    return { from: addDays(start, -7), to: addDays(start, -1) };
  }
  const end = monthEnd(through);
  if (end <= through) return { from: monthStart(through), to: end };
  const previousEnd = addDays(monthStart(through), -1);
  return { from: monthStart(previousEnd), to: previousEnd };
}

/**
 * What a report compares with: the week or month before, and for a year the
 * same days of the year before, so "2026 so far" stands beside the same
 * stretch of 2025 rather than all of it.
 */
export function periodBefore(window: DayWindow, period: ReportPeriod): DayWindow {
  if (period === 'week') return { from: addDays(window.from, -7), to: addDays(window.from, -1) };
  if (period === 'year') return { from: shiftYears(window.from, -1), to: shiftYears(window.to, -1) };
  const previousEnd = addDays(window.from, -1);
  return { from: monthStart(previousEnd), to: previousEnd };
}

/** The report one step further back in the list: the previous week, month or whole calendar year. */
export function earlierPeriod(window: DayWindow, period: ReportPeriod): DayWindow {
  if (period !== 'year') return periodBefore(window, period);
  const previousEnd = addDays(yearStart(window.from), -1);
  return { from: yearStart(previousEnd), to: yearEnd(previousEnd) };
}

/** "Week of Nov 2", "Oct 2026", "2025", "2026 so far". */
export function periodTitle(window: DayWindow, period: ReportPeriod): string {
  if (period === 'week') return `Week of ${formatDay(window.from)}`;
  if (period === 'month') return formatMonth(window.from);
  const year = window.from.slice(0, 4);
  return window.to === yearEnd(window.from) ? year : `${year} so far`;
}

function line(label: string, now: number | null, then: number | null, format: (value: number) => string, higherIsBetter = true): ReportLine | null {
  if (now === null) return null;
  const change = relativeChange(now, then);
  return {
    label,
    value: format(now),
    change: change === null ? null : formatChange(change),
    good: change === null || Math.abs(change) < 0.005 ? null : (change > 0) === higherIsBetter,
  };
}

export function buildReport(input: {
  appName: string;
  records: DayRecord[];
  reviews: StoreReview[];
  events: TimelineEvent[];
  period: ReportPeriod;
  window: DayWindow;
}): PeriodReport {
  const byDate = indexRecords(input.records);
  const previous = periodBefore(input.window, input.period);
  const current = totalsFor(byDate, input.window);
  const prior = totalsFor(byDate, previous);
  const currency = proceedsCurrency(current, prior);
  const starts = feedStarts(input.records);

  // Each figure is compared only when its history reaches back over the
  // whole period before (`covers`), else it shows without a change.
  const uncompared: string[] = [];
  const figure = (label: string, metric: MetricId, format: (value: number) => string): ReportLine | null => {
    const now = metricValue(current, metric, currency);
    if (now === null) return null;
    const comparable = covers(starts, metric, previous);
    if (!comparable) uncompared.push(label);
    return line(label, now, comparable ? metricValue(prior, metric, currency) : null, format);
  };
  const lines = [
    figure('Impressions', 'impressions', formatCount),
    figure('Product page views', 'pageViews', formatCount),
    figure('First-time downloads', 'downloads', formatCount),
    figure('Conversion rate', 'conversion', formatRate),
    figure('Redownloads', 'redownloads', formatCount),
    figure('In-app purchases', 'iapUnits', formatCount),
    figure('Proceeds', 'proceeds', (value) => formatMoney(value, currency)),
  ].filter((entry): entry is ReportLine => entry !== null);
  const previousCovered = covers(starts, 'downloads', previous);

  const reviews = reviewsIn(input.reviews, input.window);
  const average = averageRating(reviews);
  const span = daysBetween(input.window.from, input.window.to) + 1;

  return {
    appName: input.appName,
    period: input.period,
    window: input.window,
    previous,
    title: periodTitle(input.window, input.period),
    lines,
    territories: byTerritory(byDate, input.window, previous)
      .slice(0, 8)
      .map((row) => ({
        name: territoryName(row.key),
        downloads: formatCount(row.totals.downloads),
        share: `${Math.round(row.share * 100)}%`,
        change: row.change === null || !previousCovered ? null : formatChange(row.change),
      })),
    sources: bySource(byDate, input.window).map((row) => ({
      name: SOURCE_LABELS[row.key as SourceType] ?? row.key,
      impressions: formatCount(row.totals.impressions),
      downloads: formatCount(row.totals.downloads),
      conversion: formatRate(row.totals.conversion),
    })),
    reviews: {
      count: reviews.length,
      average: formatRating(average),
      unanswered: unansweredLow(reviews).length,
      topics: topicCounts(reviews)
        .slice(0, 4)
        .map((entry) => `${REVIEW_TOPIC_LABELS[entry.topic]} (${entry.count})`),
    },
    events: input.events
      .filter((event) => event.date >= input.window.from && event.date <= input.window.to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((event) => ({ date: formatDay(event.date), label: `${EVENT_KIND_LABELS[event.kind]}: ${event.title}` })),
    missingDays: Math.max(0, span - current.days),
    previousCovered,
    uncompared,
    currency,
    current,
    previousTotals: prior,
  };
}

/** The reviews line every form of the report shares. */
export function reviewsSentence(report: PeriodReport): string {
  if (report.reviews.count === 0) return 'No written reviews in this period.';
  return `${plural(report.reviews.count, 'written review')}, averaging ${report.reviews.average} stars. ${plural(report.reviews.unanswered, 'low rating')} without a reply.`;
}

function periodNoun(period: ReportPeriod): string {
  return period === 'week' ? 'week' : period === 'month' ? 'month' : 'year';
}

/** Why some figures have no change, or null when every figure has one. */
export function comparisonNote(report: PeriodReport): string | null {
  if (report.uncompared.length === 0) return null;
  const which =
    report.uncompared.length === report.lines.length
      ? 'No figure is compared'
      : `${listOf(report.uncompared.map((label) => label.toLowerCase()), 'and')} ${report.uncompared.length === 1 ? 'is' : 'are'} not compared`;
  return `${which.charAt(0).toUpperCase()}${which.slice(1)} with ${formatWindow(report.previous)}: the numbers do not reach back over all of it.`;
}

function listOf(items: string[], joiner: string): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

/** The figures as plain sentences, for the AI to write the summary from. */
export function reportFacts(report: PeriodReport): string {
  const parts = [
    `${report.appName}, ${periodNoun(report.period)} of ${formatWindow(report.window)}, compared with ${formatWindow(report.previous)}.`,
    ...report.lines.map((entry) => `${entry.label}: ${entry.value}${entry.change ? ` (${entry.change})` : ''}.`),
    comparisonNote(report) ?? '',
    report.territories.length
      ? `Top storefronts by downloads: ${report.territories.map((row) => `${row.name} ${row.downloads} (${row.share}${row.change ? `, ${row.change}` : ''})`).join('; ')}.`
      : '',
    report.sources.length
      ? `Sources: ${report.sources.map((row) => `${row.name} ${row.downloads} downloads at ${row.conversion}`).join('; ')}.`
      : '',
    `Reviews: ${report.reviews.count} written, averaging ${report.reviews.average} stars, ${report.reviews.unanswered} low ratings unanswered.${
      report.reviews.topics.length ? ` Topics: ${report.reviews.topics.join(', ')}.` : ''
    }`,
    report.events.length ? `Events: ${report.events.map((event) => `${event.date} ${event.label}`).join('; ')}.` : 'No events recorded.',
    report.missingDays > 0 ? `${plural(report.missingDays, 'day')} in the period have no data yet.` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

export function reportMarkdown(report: PeriodReport, summary?: string | null): string {
  const out: string[] = [];
  out.push(`# ${report.appName}: ${report.title}`);
  out.push('');
  out.push(`${formatWindow(report.window)}, compared with ${formatWindow(report.previous)}.`);
  if (summary && summary.trim()) {
    out.push('');
    out.push('## Summary');
    out.push('');
    out.push(summary.trim());
  }
  out.push('');
  out.push('## Numbers');
  out.push('');
  out.push('| Metric | Value | Change |');
  out.push('| --- | --- | --- |');
  for (const entry of report.lines) out.push(`| ${entry.label} | ${entry.value} | ${entry.change ?? ''} |`);
  const note = comparisonNote(report);
  if (note) {
    out.push('');
    out.push(note);
  }
  if (report.territories.length) {
    out.push('');
    out.push('## Storefronts');
    out.push('');
    out.push('| Storefront | Downloads | Share | Change |');
    out.push('| --- | --- | --- | --- |');
    for (const row of report.territories) out.push(`| ${row.name} | ${row.downloads} | ${row.share} | ${row.change ?? ''} |`);
  }
  if (report.sources.length) {
    out.push('');
    out.push('## How people found the app');
    out.push('');
    out.push('| Source | Impressions | Downloads | Conversion |');
    out.push('| --- | --- | --- | --- |');
    for (const row of report.sources) out.push(`| ${row.name} | ${row.impressions} | ${row.downloads} | ${row.conversion} |`);
  }
  out.push('');
  out.push('## Reviews');
  out.push('');
  out.push(reviewsSentence(report));
  if (report.reviews.topics.length) out.push(`Topics: ${report.reviews.topics.join(', ')}.`);
  if (report.events.length) {
    out.push('');
    out.push('## Timeline');
    out.push('');
    for (const event of report.events) out.push(`- ${event.date}: ${event.label}`);
  }
  if (report.missingDays > 0) {
    out.push('');
    out.push(`${plural(report.missingDays, 'day')} in this period have no data from App Store Connect yet.`);
  }
  out.push('');
  out.push('Made with Open Screenshot Generator.');
  return out.join('\n');
}

export function reportPlainText(report: PeriodReport, summary?: string | null): string {
  return reportMarkdown(report, summary)
    .replace(/^#+\s*/gm, '')
    .replace(/^\| --- .*$/gm, '')
    .replace(/^\| (.*) \|$/gm, (_match, row: string) => row.split(' | ').join('    '))
    .replace(/\n{3,}/g, '\n\n');
}
