// Popularity: how often people search a keyword on the App Store, in a
// country, week by week, from Apple Ads' search term popularity
// (POST /v1/insights/apps/search-term-popularity/query, appleAds.ts).
//
// Apple gives each search term a score from 1 to 100 per country,
// `searchPopularity1to100`, where 100 is the most searched term in that
// country across every genre, and a tier from 1 to 5, `searchPopularity1to5`,
// the dots Apple Ads shows. The scores come weekly (Sunday to Saturday, UTC)
// or monthly. Apple names a week by the Sunday after it: the field is "the
// date immediately following the completed weekly range", and Apple's own
// example asks for Jan 5 to 11, 2025 and gets rows named 2025-01-12. Growth
// keeps the Sunday the week starts on instead (readPopularityRows).
//
// Apple's documentation says the endpoint "returns the most popular search
// terms for a given App Store genre and country", lists a term only with at
// least 500 searches and 10 ad impressions in the period, and ranks up to
// 500 terms per genre and country. So a term Apple sends no row for has no
// score: that is not the same as nobody searching it, and the screens say
// "no score", never "not searched".
//
// A row comes per genre a term belongs to. The 1 to 100 score is across all
// genres, so the rows of one term and week agree; the highest is kept anyway.
//
// Beside popularity, a keyword's chance: whether an app with no more ratings
// than the user's is in the first ten of its search (keywords.ts keeps the
// first ten with their rating counts). That is the "Within reach" the ideas
// have always shown, and the map's horizontal axis.
//
// This file holds the parts without storage. popularityWatch.ts keeps the
// scores in the growth database and decides when to ask again.

import { addDays, formatDay, formatMonth, normalizeDay, parseDay } from './dates';
import { queryPopularityPage, AppleAdsError, type AppleAdsAccount, type AppleAdsKey } from './appleAds';
import { normalizeTerm, TOP_KEPT, type KeywordSearch } from './keywords';
import type { DayString } from './types';

/** Weeks asked for: about three months, enough to see a season turn. */
export const POPULARITY_WEEKS = 12;
/** Search terms per request. A list tracks at most 50 keywords, so one request covers a country. */
export const TERMS_PER_REQUEST = 50;
/** Rows per page. This endpoint takes 5,000 at most; 50 terms over 12 weeks in a few genres stays well under. */
const PAGE_SIZE = 2_000;
/** Pages read at most for one request, so a strange answer cannot loop. */
const MAX_PAGES = 5;
/** A trend compares the latest week with the newest one this many days before it. */
export const TREND_WINDOW: readonly [number, number] = [28, 42];

// --- what is kept ------------------------------------------------------------------

export interface PopularityPoint {
  /** The first day the score covers: the Sunday its week starts on, or the first of its month. */
  week: DayString;
  /** 1 to 100, 100 being the most searched term in the country. */
  score: number;
  /** 1 to 5, as Apple Ads shows it. */
  tier: number;
}

/** A keyword's popularity in one country: one record per term and country in the growth database. */
export interface KeywordPopularity {
  /** As normalizeTerm leaves it. */
  term: string;
  country: string;
  /** When Apple answered, in ms. */
  at: number;
  /** Oldest first. Empty when Apple has no score for the term in the country. */
  points: PopularityPoint[];
  /** What each point covers: a week unless Apple refused the weekly ranges and answered by month. */
  granularity?: 'week' | 'month';
}

// --- the request ---------------------------------------------------------------------

export interface PopularityRange {
  start: DayString;
  end: DayString;
  granularity: 'WEEKLY_SUN_SAT' | 'MONTHLY';
}

/**
 * The last `weeks` whole weeks before `day`, Sunday to Saturday in UTC: the
 * week `day` is in has not ended, so it is left out even on its Saturday.
 */
export function popularityRange(day: DayString, weeks = POPULARITY_WEEKS): PopularityRange {
  const weekday = parseDay(day).getUTCDay();
  const end = addDays(day, -(weekday + 1));
  return { start: addDays(end, -(weeks * 7 - 1)), end, granularity: 'WEEKLY_SUN_SAT' };
}

/** The last `months` whole months before `day`'s month, for when Apple refuses the weekly ranges. */
export function monthlyRange(day: DayString, months = 3): PopularityRange {
  const date = parseDay(day);
  const end = addDays(`${day.slice(0, 7)}-01`, -1);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1)).toISOString().slice(0, 10);
  return { start, end, granularity: 'MONTHLY' };
}

/** The request body for some terms in one country. */
export function popularityRequest(country: string, terms: string[], range: PopularityRange, page = 0) {
  return {
    fields: ['searchPopularity1to100', 'searchPopularity1to5'],
    filters: [
      { field: 'countryOrRegion', operator: 'EQUALS', value: country.toUpperCase() },
      { field: 'searchTerm', operator: 'IN', value: terms },
    ],
    timeRange: { start: range.start, end: range.end, granularity: range.granularity },
    sorting: [
      { field: 'searchTerm', order: 'ASC' },
      { field: range.granularity === 'MONTHLY' ? 'month' : 'week', order: 'ASC' },
    ],
    pagination: { offset: page * PAGE_SIZE, pageSize: PAGE_SIZE },
  };
}

// --- reading the answer ------------------------------------------------------------

/** One of Apple's rows, as far as Growth reads it. */
export interface PopularityRow {
  term: string;
  week: DayString;
  score: number;
  tier: number;
}

function scoreOf(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(number) : null;
}

/** The tier Apple's five dots would show for a score, for a row that came without one. */
export function tierOf(score: number): number {
  return Math.min(5, Math.max(1, Math.ceil(score / 20)));
}

/** The rows of one page, with what makes no sense dropped. */
export function readPopularityRows(body: unknown): PopularityRow[] {
  const rows = (body as { result?: { rows?: unknown } })?.result?.rows;
  if (!Array.isArray(rows)) return [];
  const out: PopularityRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const term = typeof row.searchTerm === 'string' ? normalizeTerm(row.searchTerm) : '';
    // A week comes named by the Sunday after it, and is kept as the Sunday it
    // starts on. A month comes as YYYY-MM, and is kept as its first day.
    const named = typeof row.week === 'string' ? normalizeDay(row.week) : null;
    const month = typeof row.month === 'string' ? normalizeDay(/^\d{4}-\d{2}$/.test(row.month) ? `${row.month}-01` : row.month) : null;
    const week = named ? addDays(named, -7) : month;
    const score = scoreOf(row.searchPopularity1to100);
    if (!term || !week || score === null || score < 0) continue;
    const tier = scoreOf(row.searchPopularity1to5);
    out.push({ term, week, score: Math.min(100, score), tier: tier !== null && tier >= 1 && tier <= 5 ? tier : tierOf(score) });
  }
  return out;
}

/**
 * Every term asked about, with the weeks Apple sent for it, oldest first. A
 * term with no row gets a record with no points: Apple answered and has no
 * score for it.
 */
export function popularityOf(rows: PopularityRow[], terms: string[], country: string, at: number, granularity: 'week' | 'month' = 'week'): Map<string, KeywordPopularity> {
  const out = new Map<string, KeywordPopularity>();
  for (const term of terms) out.set(term, { term, country, at, points: [], granularity });
  const byWeek = new Map<string, Map<DayString, PopularityPoint>>();
  for (const row of rows) {
    if (!out.has(row.term)) continue;
    const weeks = byWeek.get(row.term) ?? new Map<DayString, PopularityPoint>();
    byWeek.set(row.term, weeks);
    const seen = weeks.get(row.week);
    if (!seen || row.score > seen.score) weeks.set(row.week, { week: row.week, score: row.score, tier: row.tier });
  }
  for (const [term, weeks] of byWeek) {
    out.get(term)!.points = Array.from(weeks.values()).sort((a, b) => a.week.localeCompare(b.week));
  }
  return out;
}

/**
 * Ask Apple about some terms in one country, every page of the answer. When
 * Apple refuses the range (Apple's documentation gives no limit for it), a
 * shorter one is tried, then months: three tries at most, the first refusal
 * reported if every one is refused.
 */
export async function fetchPopularity(
  key: AppleAdsKey,
  account: Pick<AppleAdsAccount, 'id'>,
  country: string,
  terms: string[],
  options: { day: DayString; at?: number; signal?: AbortSignal }
): Promise<Map<string, KeywordPopularity>> {
  const ranges = [popularityRange(options.day), popularityRange(options.day, 4), monthlyRange(options.day)];
  let refusal: unknown = null;
  for (const range of ranges) {
    try {
      const rows: PopularityRow[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const body = await queryPopularityPage(key, account.id, popularityRequest(country, terms, range, page), options.signal);
        const sent = (body as { result?: { rows?: unknown } } | null)?.result?.rows;
        // An answer in another shape is not "no score" for every term: it says nothing.
        if (!Array.isArray(sent)) {
          console.error('Apple Ads answered the popularity query in a shape Growth does not read', body);
          throw new AppleAdsError("Apple Ads sent an answer Growth couldn't read. Growth tries again later", 'request');
        }
        rows.push(...readPopularityRows(body));
        if (sent.length < PAGE_SIZE) break;
      }
      return popularityOf(rows, terms, country, options.at ?? Date.now(), range.granularity === 'MONTHLY' ? 'month' : 'week');
    } catch (error) {
      // Only a refused request is worth another range: a bad key or a lost connection is not.
      if (!(error instanceof AppleAdsError) || error.kind !== 'request' || error.status !== 400) throw error;
      refusal ??= error;
    }
  }
  throw refusal;
}

// --- reading the scores ------------------------------------------------------------

export function latestPoint(popularity: Pick<KeywordPopularity, 'points'> | null | undefined): PopularityPoint | undefined {
  return popularity?.points[popularity.points.length - 1];
}

/** How a score moved over about a month. */
export interface PopularityTrend {
  kind: 'up' | 'down' | 'same' | 'unknown';
  change: number;
  /** The week it compares with. */
  since?: DayString;
}

/** The latest week against the newest one 4 to 6 weeks before it, and nothing when there is none. */
export function popularityTrend(points: PopularityPoint[]): PopularityTrend {
  const latest = points[points.length - 1];
  if (!latest) return { kind: 'unknown', change: 0 };
  const from = addDays(latest.week, -TREND_WINDOW[1]);
  const to = addDays(latest.week, -TREND_WINDOW[0]);
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const point = points[index];
    if (point.week > to) continue;
    if (point.week < from) break;
    const change = latest.score - point.score;
    return { kind: change > 0 ? 'up' : change < 0 ? 'down' : 'same', change, since: point.week };
  }
  return { kind: 'unknown', change: 0 };
}

/** The period a point covers, in words: "Week of Nov 8", or "Oct 2026" for a month. */
export function periodWords(day: DayString, granularity: KeywordPopularity['granularity'], options: { withYear?: boolean } = {}): string {
  return granularity === 'month' ? formatMonth(day) : `Week of ${formatDay(day, options)}`;
}

/** What a move compares with, in words: "since the week of Oct 11", or "since Sep 2026". */
export function sinceWords(day: DayString, granularity: KeywordPopularity['granularity']): string {
  return granularity === 'month' ? `since ${formatMonth(day)}` : `since the week of ${formatDay(day, { withYear: false })}`;
}

const TIER_WORDS = ['Very low', 'Low', 'Medium', 'High', 'Very high'];

/** A tier in words, for the screen and screen readers. */
export function tierWords(tier: number): string {
  return TIER_WORDS[Math.min(5, Math.max(1, Math.round(tier))) - 1];
}

// --- a keyword's chance ------------------------------------------------------------

/** How strong the first ten apps of a search are, against the user's app. */
export interface Competition {
  /** The fewest ratings any app in the first ten shows, the user's own left out. Null when none of them shows a count. */
  weakest: number | null;
  /** Apps in the first ten, the user's own left out, with no more ratings than the user's. */
  beatable: number;
  /** Apps in the first ten with a rating count, the user's own left out. */
  counted: number;
  /** Apps in the first ten, the user's own left out. */
  others: number;
}

export function competitionOf(search: Pick<KeywordSearch, 'top'>, appId: string, ownRatings: number | null): Competition {
  const others = search.top.filter((app) => app.id !== appId);
  const counts = others.map((app) => app.ratingCount).filter((count): count is number => typeof count === 'number');
  return {
    weakest: counts.length > 0 ? Math.min(...counts) : null,
    beatable: ownRatings === null ? 0 : counts.filter((count) => count <= ownRatings).length,
    counted: counts.length,
    others: others.length,
  };
}

/**
 * Whether every other app in the first ten shows a rating count, so that
 * `weakest` is the fewest ratings there, not just the fewest shown.
 */
export function everyCountShown(competition: Competition): boolean {
  return competition.counted > 0 && competition.counted === competition.others;
}

/**
 * `ranked`: the user's app is in the first ten already. `reach`: an app with
 * no more ratings than the user's is (Within reach). `crowded`: ten other
 * apps are, and every one of them shows more ratings. `unknown`: anything
 * else, such as no search yet, a first ten with room left, or an app there
 * with no count, which could have fewer ratings than the user's.
 */
export type Chance = 'ranked' | 'reach' | 'crowded' | 'unknown';

export function chanceOf(rank: number | null | undefined, competition: Competition | null, ownRatings: number | null): Chance {
  if (typeof rank === 'number' && rank <= TOP_KEPT) return 'ranked';
  if (!competition || ownRatings === null) return 'unknown';
  if (competition.weakest !== null && competition.weakest <= ownRatings) return 'reach';
  return competition.others >= TOP_KEPT && everyCountShown(competition) ? 'crowded' : 'unknown';
}

const CHANCE_ORDER: Record<Chance, number> = { ranked: 0, reach: 0, unknown: 1, crowded: 2 };

/**
 * Best chance first: words the user's app can rank for (in the top 10
 * already, or Within reach), then words whose chance is not known (not
 * checked yet, mostly), then crowded ones; within each, the most searched
 * first, and words with no score last.
 */
export function byBestChance<T extends { term: string; chance: Chance; score: number | null }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      CHANCE_ORDER[a.chance] - CHANCE_ORDER[b.chance] ||
      (b.score ?? -1) - (a.score ?? -1) ||
      a.term.localeCompare(b.term)
  );
}

// --- what an AI reads ----------------------------------------------------------------

/** What every AI that reads popularity is told about where it comes from. */
export const POPULARITY_SOURCE_NOTE =
  "Popularity is Apple Ads' search term popularity: a weekly score from 1 to 100 for each country, where 100 is the most searched term in that country. It is Apple's relative measure, not a count of searches. `week` is the Sunday (UTC) that starts the week a score covers, Sunday to Saturday. A keyword with no score is one Apple Ads does not list: Apple's documentation says it lists a term only with at least 500 searches and 10 ad impressions in the period, so no score is not the same as nobody searching it.";
