// The app's numbers, cut down to what a language model can read in one go.
//
// Three readers share it: the Ask tab, the report summary, and the agent's
// get_store_overview tool. Keeping one digest means the in-app answer, the
// written report and the Claude Code agent all reason from the same figures,
// and a question asked in two places cannot get two different sets of facts.
//
// Review text is cut to a few hundred characters and the reviewer's nickname
// is left out: it adds nothing to an answer and is the one personal detail in
// the data.

import { addDays, formatWindow, type DayWindow } from './dates';
import { formatChange, eventImpact } from './impact';
import {
  byTerritory,
  bySource,
  compareWindows,
  completeThrough,
  indexRecords,
  proceedsCurrency,
  relativeChange,
  type Totals,
} from './metrics';
import { REVIEW_TOPIC_LABELS, averageRating, reviewDay, reviewsIn, topicCounts, unansweredLow } from './reviewTopics';
import { territoryName } from './territories';
import {
  EVENT_KIND_LABELS,
  SOURCE_LABELS,
  type DayRecord,
  type Insight,
  type ListingIssue,
  type ListingSnapshot,
  type SourceType,
  type StoreReview,
  type TerritoryRating,
  type TimelineEvent,
} from './types';

export interface DigestInput {
  appId: string;
  appName: string;
  records: DayRecord[];
  reviews: StoreReview[];
  ratings: TerritoryRating[];
  events: TimelineEvent[];
  insights: Insight[];
  listing: ListingSnapshot | null;
  listingIssues: ListingIssue[];
  /** How many days the comparison covers. 28 by default. */
  days?: number;
  today: string;
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function totalsSummary(totals: Totals, currency: string) {
  return {
    impressions: totals.hasEngagement ? totals.impressions : null,
    productPageViews: totals.hasEngagement ? totals.pageViews : null,
    firstTimeDownloads: totals.days > 0 ? totals.downloads : null,
    redownloads: totals.days > 0 ? totals.redownloads : null,
    conversionRate: round(totals.conversion),
    productPageConversionRate: round(totals.pageConversion),
    inAppPurchases: totals.hasSales ? totals.iapUnits : null,
    proceeds: totals.hasSales ? totals.proceeds[currency] ?? 0 : null,
    proceedsCurrency: currency,
    daysWithData: totals.days,
  };
}

export function buildDigest(input: DigestInput) {
  const byDate = indexRecords(input.records);
  const through = completeThrough(input.records);
  const days = input.days ?? 28;
  const window: DayWindow | null = through ? { from: addDays(through, -(days - 1)), to: through } : null;
  const notes: string[] = [];

  let totals: Record<string, unknown> | null = null;
  let territories: unknown[] = [];
  let sources: unknown[] = [];
  if (window) {
    const { current, previous, previousWindow } = compareWindows(byDate, window);
    const currency = proceedsCurrency(current, previous);
    const now = totalsSummary(current, currency);
    const then = totalsSummary(previous, currency);
    totals = {
      window: `${window.from} to ${window.to} (${formatWindow(window)})`,
      previousWindow: `${previousWindow.from} to ${previousWindow.to}`,
      current: now,
      previous: then,
      change: Object.fromEntries(
        (Object.keys(now) as Array<keyof typeof now>)
          .filter((key) => typeof now[key] === 'number' && typeof then[key] === 'number')
          .map((key) => [key, formatChange(relativeChange(now[key] as number, then[key] as number))])
      ),
    };
    if (!current.hasEngagement) notes.push('No App Analytics data: impressions, page views and conversion are unknown.');
    if (!current.hasSales) notes.push('No Sales and Trends data: proceeds and in-app purchases are unknown.');
    territories = byTerritory(byDate, window)
      .slice(0, 12)
      .map((row) => ({
        territory: `${territoryName(row.key)} (${row.key})`,
        firstTimeDownloads: row.totals.downloads,
        shareOfDownloads: round(row.share, 3),
        productPageViews: row.totals.hasEngagement ? row.totals.pageViews : null,
        conversionRate: round(row.totals.conversion),
        downloadsChange: formatChange(row.change),
      }));
    sources = bySource(byDate, window).map((row) => ({
      source: SOURCE_LABELS[row.key as SourceType] ?? row.key,
      impressions: row.totals.impressions,
      firstTimeDownloads: row.totals.downloads,
      conversionRate: round(row.totals.conversion),
    }));
  } else {
    notes.push('No numbers have been synced for this app yet.');
  }

  const ratingCount = input.ratings.reduce((sum, rating) => sum + rating.count, 0);
  const ratingAverage =
    ratingCount > 0 ? input.ratings.reduce((sum, rating) => sum + rating.average * rating.count, 0) / ratingCount : null;

  const recentWindow: DayWindow = { from: addDays(input.today, -(days - 1)), to: input.today };
  const recent = reviewsIn(input.reviews, recentWindow);
  const latestReviews = [...input.reviews]
    .sort((a, b) => b.createdDate.localeCompare(a.createdDate))
    .slice(0, 15)
    .map((review) => ({
      date: reviewDay(review),
      rating: review.rating,
      territory: review.territory,
      title: review.title.slice(0, 120),
      body: review.body.slice(0, 280),
      replied: !!review.response,
    }));

  const latest = through ?? input.today;
  const events = [...input.events]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12)
    .map((event) => {
      const impact = through ? eventImpact(byDate, event, { latest, events: input.events }) : null;
      return {
        date: event.date,
        kind: EVENT_KIND_LABELS[event.kind],
        title: event.title,
        version: event.version ?? null,
        project: event.projectName ?? null,
        impact: impact
          ? {
              verdict: impact.verdict,
              measure: impact.measure,
              change: formatChange(impact.change),
              confidence: round(impact.confidence, 2),
              liveDate: impact.liveDate,
              daysAfter: impact.daysAfter,
            }
          : null,
      };
    });

  return {
    app: { id: input.appId, name: input.appName },
    dataCompleteThrough: through,
    totals,
    topTerritories: territories,
    sources,
    ratings: {
      averageAcrossStorefronts: round(ratingAverage, 2),
      ratingsCount: ratingCount,
      byStorefront: [...input.ratings]
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((rating) => ({ territory: rating.territory, average: rating.average, count: rating.count })),
    },
    reviews: {
      writtenInLastDays: recent.length,
      averageOfThose: round(averageRating(recent), 2),
      lowRatingsWithoutReply: unansweredLow(recent).length,
      topics: topicCounts(recent).map((entry) => ({ topic: REVIEW_TOPIC_LABELS[entry.topic], count: entry.count, lowRatings: entry.low })),
      latest: latestReviews,
    },
    timeline: events,
    insights: input.insights.slice(0, 12).map((insight) => ({ tone: insight.tone, title: insight.title, detail: insight.body })),
    listing: input.listing
      ? {
          version: input.listing.versionString,
          state: input.listing.state,
          primaryLanguage: input.listing.primaryLocale,
          languages: input.listing.locales.map((locale) => ({
            locale: locale.locale,
            name: locale.name,
            subtitle: locale.subtitle,
            keywords: locale.keywords,
            screenshots: locale.screenshotCounts ?? null,
          })),
          issues: input.listingIssues.slice(0, 12).map((entry) => `${entry.locale}: ${entry.title}`),
        }
      : null,
    notes,
  };
}

export type GrowthDigest = ReturnType<typeof buildDigest>;
