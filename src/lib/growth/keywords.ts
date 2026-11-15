// Keywords: where an App Store app shows up when people search the App Store
// for the words the user tracks, in each country, day by day.
//
// The ranks come from Apple's public search, the documented Search API at
// itunes.apple.com/search that the Competitors finder also asks. It needs no
// key and answers any web page (CORS *), so Keywords works in the web build
// too. It lists the apps in the order Apple ranks them: 200 asked for, 170 to
// 194 sent back for 18 common searches on 2026-11-15. Search ads are not in
// the answer, so a rank is the one an app earns.
//
// How close that order is to the App Store's own, measured 2026-11-15 against
// the web App Store's search page (apps.apple.com/<cc>/iphone/search) for 18
// searches in 8 countries: the same app came first in all 18, the first five
// were the same apps in 14 and in the same order in 10, and of the page's
// first ten apps (180 in all) 108 were at the same place in Apple's search,
// 153 within one place and 170 within two. The farthest was 30 places off.
// That is the web App Store, not the App Store app on an iPhone, which was
// not compared, so the screens never promise more than "close".
//
// Apple's servers answer a search with max-age=86400, so an answer can be a
// copy from up to a day earlier. Ranks are kept per day for that reason too.
// Google Play is never searched: its robots.txt asks programs to keep out of
// /store/search, and Google offers no search API.
//
// This file holds the parts without storage. keywordWatch.ts keeps the
// lists, the searches and the ranks in the growth database, and runs the
// checks.

import { bridgeFetch } from '@/lib/account/transport';
import { addDays, dayOf, daysBetween } from './dates';
import { csvText } from './csv';
import { throwIfAborted } from './http';
import { lookupTurn } from './itunes';
import { andList, fieldLength, quoteList, splitKeywords, stem, wordsOf, writtenWithoutSpaces } from './listingChecks';
import { languageCovers, listingLanguageFor, listingLanguageName, territoryName } from './territories';
import { LISTING_LIMITS, type DayString, type ListingField, type ListingIssue, type ListingLocale, type ListingSnapshot } from './types';

/** Keywords per list. Each keyword is one search in each country, every day. */
export const MAX_KEYWORDS = 50;
/** Countries per list: 50 keywords in 5 countries is 250 searches, about 13 minutes at Apple's 20 a minute. */
export const MAX_KEYWORD_COUNTRIES = 5;
/** Countries a new list starts with. */
const NEW_LIST_COUNTRIES = 3;
/** Apps asked for in one search, Apple's most. */
const RESULTS_ASKED = 200;
/** Apps kept with their details, for the search results the screen draws. */
export const TOP_KEPT = 10;
/** Screenshots kept per app: the ones a search result shows. */
const SHOTS_KEPT = 3;
/** The longest keyword kept. Longer text is a sentence, not a search. */
export const MAX_TERM_LENGTH = 60;
/** A rank with no new reading for this many days is old news, and the screen says when it was read. */
export const STALE_AFTER_DAYS = 2;
/** A keyword not found in this many checks in a row is worth replacing. */
export const NOT_FOUND_CHECKS = 7;
/**
 * How far back each comparison looks, in days before the latest reading. A
 * comparison takes the newest reading inside its window, and none when the
 * window has no reading: a month old reading is never passed off as yesterday.
 */
export const MOVE_WINDOWS = { day: [1, 3], week: [7, 10], month: [30, 37] } as const;

const SEARCH_URL = 'https://itunes.apple.com/search';

// --- what is kept ------------------------------------------------------------------

/** Where a tracked keyword came from, for the list's own record. */
export type KeywordSource = 'typed' | 'store-page' | 'top-apps' | 'competitors' | 'ai';

export interface TrackedKeyword {
  /** As normalizeTerm leaves it: lowercase, single spaces. */
  term: string;
  addedAt: number;
  source?: KeywordSource;
}

/**
 * The keywords tracked for one of the user's apps, and where. A list belongs
 * to the app Growth shows (its id), or to no app (an empty owner) in the web
 * build and on a desktop with no store key, as the Competitors lists do. The
 * app ranked is the owner, or the app the user named as theirs on Competitors.
 */
export interface KeywordList {
  owner: string;
  /** In the order the user added them. */
  keywords: TrackedKeyword[];
  /** Two letter codes, in the order the user put them. */
  countries: string[];
  /** When a check last got answers, in ms. */
  checkedAt?: number;
  /** When a check last got no answer at all, so the next try waits a while. */
  failedAt?: number;
  /** Searches the last check could not get, which the background pass asks again an hour later. */
  trouble?: { at: number; searches: number };
}

/** An app in a search answer, with what a search result shows of it. */
export interface SearchApp {
  id: string;
  name: string;
  developer: string;
  iconUrl: string | null;
  rating: number | null;
  ratingCount: number | null;
  /** As the store prints it there: "Free", "$2.99". */
  priceLabel: string;
  genre: string;
  /** The first screenshots, the ones a search result shows. */
  screenshots: string[];
}

/** One search, as Apple answered it. The newest one per keyword and country is kept. */
export interface KeywordSearch {
  term: string;
  country: string;
  /** When Apple answered, in ms. */
  at: number;
  /** Every app the search listed, by id, in Apple's order. */
  ids: string[];
  /** The first TOP_KEPT apps, with their details. */
  top: SearchApp[];
}

/** An app's rank for one keyword in one country on one day: a row of the growth database's keywordDays table. */
export interface KeywordDay {
  /** `${appId}|${country}|${term}|${date}` */
  key: string;
  /** The app whose rank this is. */
  appId: string;
  term: string;
  country: string;
  date: DayString;
  /** 1 is first. Null: not among the apps the search listed. */
  rank: number | null;
  /** How many apps the search listed. */
  total: number;
  /** The ranks of the App Store apps followed on Competitors, by id. Null where an app was not listed. */
  rivals: Record<string, number | null>;
  /** When the search was answered, in ms. */
  at: number;
}

// --- typing a keyword ---------------------------------------------------------------

const EDGE_PUNCTUATION = /^["'“”‘’«»([{]+|["'“”‘’«»)\]}.,;:!?。]+$/gu;

/** A keyword as Growth keeps it: lowercase, single spaces, no quotes or stops around it, at most MAX_TERM_LENGTH characters. */
export function normalizeTerm(text: string): string {
  const cleaned = text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim().replace(EDGE_PUNCTUATION, '').trim();
  return Array.from(cleaned).slice(0, MAX_TERM_LENGTH).join('').trim();
}

/** The keywords in what the user typed: one per comma or line, each once. */
export function parseKeywordInput(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\n;，、]/)) {
    const term = normalizeTerm(part);
    if (/[\p{L}\p{N}]/u.test(term) && !out.includes(term)) out.push(term);
  }
  return out;
}

/** The countries a new list starts with: the ones given first (the app's busiest), then the United States. */
export function startingKeywordCountries(preferred: Array<string | null | undefined>, known: string[]): string[] {
  const codes = [...preferred, 'US'].filter((code): code is string => !!code && known.includes(code));
  return Array.from(new Set(codes)).slice(0, NEW_LIST_COUNTRIES);
}

// --- the search ---------------------------------------------------------------------

/** The search request: iPhone apps, as many as Apple lists. */
export function searchUrl(term: string, country: string): string {
  const params = new URLSearchParams({ term, country: country.toLowerCase(), entity: 'software', limit: String(RESULTS_ASKED) });
  return `${SEARCH_URL}?${params.toString()}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function appRows(body: unknown): Array<Record<string, unknown>> {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results.filter((row): row is Record<string, unknown> => {
    if (!row || typeof row !== 'object') return false;
    const entry = row as Record<string, unknown>;
    if (entry.trackId === undefined || entry.trackId === null) return false;
    return entry.kind === undefined || entry.kind === 'software' || entry.wrapperType === 'software';
  });
}

function searchAppOf(row: Record<string, unknown>, id: string): SearchApp {
  const price = numberOrNull(row.price);
  const shots = Array.isArray(row.screenshotUrls) ? row.screenshotUrls.filter((url): url is string => typeof url === 'string' && url.length > 0) : [];
  return {
    id,
    name: text(row.trackName),
    developer: text(row.artistName) || text(row.sellerName),
    iconUrl: text(row.artworkUrl512) || text(row.artworkUrl100) || null,
    rating: numberOrNull(row.averageUserRating),
    ratingCount: numberOrNull(row.userRatingCount),
    priceLabel: text(row.formattedPrice) || (price === 0 ? 'Free' : ''),
    genre: text(row.primaryGenreName),
    screenshots: shots.slice(0, SHOTS_KEPT),
  };
}

/** A search answer as Growth keeps it: every app's id in Apple's order, and the first ones in full. */
export function readSearch(body: unknown, term: string, country: string, at: number): KeywordSearch {
  const ids: string[] = [];
  const seen = new Set<string>();
  const top: SearchApp[] = [];
  for (const row of appRows(body)) {
    const id = String(row.trackId);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (top.length < TOP_KEPT) top.push(searchAppOf(row, id));
  }
  return { term, country, at, ids, top };
}

/**
 * Search the App Store for `term` in `country`, after this window's turn at
 * Apple's servers (lookupTurn): the search and the lookup are one service,
 * and Apple asks for about 20 requests a minute between them.
 */
export async function searchKeyword(term: string, country: string, options: { signal?: AbortSignal; now?: number } = {}): Promise<KeywordSearch> {
  throwIfAborted(options.signal);
  await lookupTurn(options.signal);
  const doFetch = await bridgeFetch();
  // no-store: the browser would otherwise keep each answer for the day
  // Apple's Cache-Control allows, and a check would read its own last copy.
  const response = await doFetch(searchUrl(term, country), { method: 'GET', cache: 'no-store' });
  throwIfAborted(options.signal);
  if (!response.ok) throw new Error(`The App Store search answered HTTP ${response.status}`);
  // Apple sends the JSON as text/javascript, so it is read as text.
  return readSearch(JSON.parse(await response.text()), term, country, options.now ?? Date.now());
}

/** Where an app is in a search: 1 is first. Null when the search did not list it. */
export function rankIn(search: Pick<KeywordSearch, 'ids'>, appId: string): number | null {
  const index = search.ids.indexOf(appId);
  return index >= 0 ? index + 1 : null;
}

export function keywordDayKey(appId: string, country: string, term: string, date: DayString): string {
  return `${appId}|${country}|${term}|${date}`;
}

/** The day's row for `appId` from a search, with the ranks of the apps it follows. */
export function dayFromSearch(search: KeywordSearch, appId: string, rivalIds: string[], date: DayString): KeywordDay {
  const rivals: Record<string, number | null> = {};
  for (const id of rivalIds) if (id !== appId) rivals[id] = rankIn(search, id);
  return {
    key: keywordDayKey(appId, search.country, search.term, date),
    appId,
    term: search.term,
    country: search.country,
    date,
    rank: rankIn(search, appId),
    total: search.ids.length,
    rivals,
    at: search.at,
  };
}

/** The searches a check still owes today: every keyword in every country without a row for today yet. */
export function searchesDue(terms: string[], countries: string[], doneToday: Set<string>): Array<{ term: string; country: string }> {
  const out: Array<{ term: string; country: string }> = [];
  for (const country of countries) {
    for (const term of terms) if (!doneToday.has(`${country}|${term}`)) out.push({ term, country });
  }
  return out;
}

// --- reading the ranks --------------------------------------------------------------

export type RankBucket = 'top3' | 'top10' | 'top50' | 'lower' | 'none';

export function bucketOf(rank: number | null | undefined): RankBucket {
  if (rank === null || rank === undefined) return 'none';
  if (rank <= 3) return 'top3';
  if (rank <= 10) return 'top10';
  if (rank <= 50) return 'top50';
  return 'lower';
}

/** How a rank moved between two readings. */
export interface RankMove {
  /** `found`: not listed before, listed now. `lost`: the other way. `unknown`: nothing to compare with. */
  kind: 'up' | 'down' | 'same' | 'found' | 'lost' | 'unknown';
  places: number;
}

export function moveBetween(now: number | null | undefined, before: number | null | undefined): RankMove {
  if (now === undefined || before === undefined) return { kind: 'unknown', places: 0 };
  if (now === null && before === null) return { kind: 'same', places: 0 };
  if (before === null) return { kind: 'found', places: 0 };
  if (now === null) return { kind: 'lost', places: 0 };
  if (now === before) return { kind: 'same', places: 0 };
  return now < before ? { kind: 'up', places: before - now } : { kind: 'down', places: now - before };
}

/** The newest row dated from `from` to `to`, both included, from rows oldest first. */
export function rowBetween(rows: KeywordDay[], from: DayString, to: DayString): KeywordDay | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const date = rows[index].date;
    if (date <= to) return date >= from ? rows[index] : undefined;
  }
  return undefined;
}

/** Where an app stands for one keyword in one country, from its rows oldest first. */
export interface KeywordStanding {
  latest?: KeywordDay;
  /** What each move compares with: the newest reading inside its window (MOVE_WINDOWS), when there is one. */
  previous?: KeywordDay;
  weekAgo?: KeywordDay;
  monthAgo?: KeywordDay;
  dayMove: RankMove;
  weekMove: RankMove;
  monthMove: RankMove;
  /**
   * Checks in a row, up to the latest one, that did not find the app. Counted
   * in checks, not days: Growth checks only while the app is open, and a day
   * without a check says nothing either way.
   */
  notFoundChecks: number;
  /** The latest reading is older than STALE_AFTER_DAYS. */
  stale: boolean;
}

export function standingOf(rows: KeywordDay[], today: DayString): KeywordStanding {
  const latest = rows[rows.length - 1];
  if (!latest) {
    const unknown: RankMove = { kind: 'unknown', places: 0 };
    return { dayMove: unknown, weekMove: unknown, monthMove: unknown, notFoundChecks: 0, stale: false };
  }
  const within = ([near, far]: readonly [number, number]) => rowBetween(rows, addDays(latest.date, -far), addDays(latest.date, -near));
  const previous = within(MOVE_WINDOWS.day);
  const weekAgo = within(MOVE_WINDOWS.week);
  const monthAgo = within(MOVE_WINDOWS.month);
  let notFoundChecks = 0;
  for (let index = rows.length - 1; index >= 0 && rows[index].rank === null; index -= 1) notFoundChecks += 1;
  return {
    latest,
    previous,
    weekAgo,
    monthAgo,
    dayMove: moveBetween(latest.rank, previous?.rank),
    weekMove: moveBetween(latest.rank, weekAgo?.rank),
    monthMove: moveBetween(latest.rank, monthAgo?.rank),
    notFoundChecks,
    stale: daysBetween(latest.date, today) > STALE_AFTER_DAYS,
  };
}

/**
 * The readings with no reading on either side, by position. A line needs two
 * points, so a chart draws these as dots: between two misses, a found check is
 * otherwise a line of no length, and nothing shows.
 */
export function loneReadings(values: Array<number | null | undefined>): Set<number> {
  const out = new Set<number>();
  values.forEach((value, index) => {
    if (typeof value === 'number' && typeof values[index - 1] !== 'number' && typeof values[index + 1] !== 'number') out.add(index);
  });
  return out;
}

/**
 * A rank in words: the number, "Not found" for a check that did not list the
 * app, and "Not checked" for a day with no value for it, such as a competitor
 * followed after that day's check.
 */
export function rankWords(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : value === null ? 'Not found' : 'Not checked';
}

/** Rows of one keyword in one country, oldest first, from a mixed list. */
export function rowsByCountryAndTerm(rows: KeywordDay[]): Map<string, Map<string, KeywordDay[]>> {
  const out = new Map<string, Map<string, KeywordDay[]>>();
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const country = out.get(row.country) ?? new Map<string, KeywordDay[]>();
    out.set(row.country, country);
    const list = country.get(row.term) ?? [];
    list.push(row);
    country.set(row.term, list);
  }
  return out;
}

// --- the store page -------------------------------------------------------------------

/**
 * The store page language shoppers in `country` read: the country's main
 * language when the page has it, the page's main language otherwise, which is
 * what the App Store shows when a language is missing.
 */
export function listingLocaleFor(country: string, listing: Pick<ListingSnapshot, 'locales' | 'primaryLocale'>): string {
  const wanted = listingLanguageFor(country);
  const exact = listing.locales.find((entry) => entry.locale === wanted);
  if (exact) return exact.locale;
  return listing.locales.find((entry) => languageCovers(entry.locale, wanted))?.locale ?? listing.primaryLocale;
}

export type IndexedField = Extract<ListingField, 'name' | 'subtitle' | 'keywords'>;

/** Where a keyword's words are on a store page, and the words that are on none of the three fields the App Store searches. */
export interface Coverage {
  fields: IndexedField[];
  missing: string[];
}

const INDEXED: IndexedField[] = ['name', 'subtitle', 'keywords'];

/**
 * Which of the name, subtitle and keywords hold a keyword. The App Store
 * searches those three together and puts single words from them together, so
 * "ludo online" is covered by "Ludo" in the name and "online" in the keywords.
 * A language written without spaces is matched as a whole phrase instead.
 */
export function coverageOf(term: string, locale: Pick<ListingLocale, 'locale' | 'name' | 'subtitle' | 'keywords'>): Coverage {
  if (writtenWithoutSpaces(locale.locale)) {
    const compact = (value: string) => value.toLowerCase().replace(/\s+/g, '');
    const needle = compact(term);
    const fields = INDEXED.filter((field) =>
      field === 'keywords' ? splitKeywords(locale.keywords).some((entry) => compact(entry).includes(needle)) : compact(locale[field]).includes(needle)
    );
    return { fields, missing: fields.length > 0 || !needle ? [] : [term] };
  }
  const words = Array.from(new Set(wordsOf(term, locale.locale)));
  const index: Record<IndexedField, Set<string>> = {
    name: new Set(wordsOf(locale.name, locale.locale).map(stem)),
    subtitle: new Set(wordsOf(locale.subtitle, locale.locale).map(stem)),
    keywords: new Set(wordsOf(locale.keywords, locale.locale).map(stem)),
  };
  const fields = INDEXED.filter((field) => words.some((word) => index[field].has(stem(word))));
  const missing = words.filter((word) => INDEXED.every((field) => !index[field].has(stem(word))));
  return { fields, missing };
}

/** The keyword field with words added at its end, as many as fit in Apple's 100 characters. */
export function addToKeywordField(keywords: string, words: string[]): { after: string; added: string[]; left: string[] } {
  const limit = LISTING_LIMITS.keywords;
  let after = keywords.replace(/[\s,，、]+$/u, '');
  const taken = new Set(splitKeywords(after).map((entry) => entry.toLowerCase()));
  const added: string[] = [];
  const left: string[] = [];
  for (const word of words) {
    const folded = word.toLowerCase();
    if (!folded || taken.has(folded)) continue;
    const next = after ? `${after},${word}` : word;
    if (fieldLength(next) <= limit) {
      after = next;
      added.push(word);
      taken.add(folded);
    } else {
      left.push(word);
    }
  }
  return { after, added, left };
}

/** The ids of the Store page checks that come from Keywords end in these. */
const KEYWORD_ISSUE_ENDINGS = [':keywords:tracked-missing', ':keywords:not-found'];

/** Whether a Store page check comes from Keywords, rather than from the page's own checks on the keywords field. */
export function isKeywordsIssue(id: string): boolean {
  return KEYWORD_ISSUE_ENDINGS.some((ending) => id.endsWith(ending));
}

/** What the Store page checks need to know about the keywords tracked. */
export interface KeywordFacts {
  /** In the order the user added them. */
  terms: string[];
  countries: string[];
  /** By country, then term. */
  standings: Map<string, Map<string, KeywordStanding>>;
}

function countriesText(codes: string[]): string {
  return andList(codes.map(territoryName));
}

/**
 * Store page checks that come from Keywords, one of each kind per language:
 * keywords the user tracks whose words are not on the page (with a fix that
 * adds the missing words to the keywords, as many as fit), and words in the
 * keywords that search has not found the app for in a week. A language is
 * checked when it is the one shoppers in a tracked country read
 * (listingLocaleFor). Both are tips: tracking a keyword for research alone
 * must not fill the Store page with warnings.
 */
export function keywordListingIssues(listing: ListingSnapshot, facts: KeywordFacts): ListingIssue[] {
  const out: ListingIssue[] = [];
  if (facts.terms.length === 0) return out;
  for (const locale of listing.locales) {
    const countries = facts.countries.filter((country) => listingLocaleFor(country, listing) === locale.locale);
    if (countries.length === 0) continue;

    const missingTerms: string[] = [];
    const missingWords: string[] = [];
    for (const term of facts.terms) {
      const coverage = coverageOf(term, locale);
      if (coverage.missing.length === 0) continue;
      missingTerms.push(term);
      for (const word of coverage.missing) if (!missingWords.includes(word)) missingWords.push(word);
    }
    if (missingTerms.length > 0) {
      const addition = addToKeywordField(locale.keywords, missingWords);
      const count = missingTerms.length;
      const full = addition.added.length === 0;
      out.push({
        id: `${locale.locale}:keywords:tracked-missing`,
        locale: locale.locale,
        field: 'keywords',
        severity: 'tip',
        title: `${count === 1 ? '1 keyword you track isn\'t' : `${count} keywords you track aren't`} on your store page`,
        detail: [
          `${quoteList(missingTerms)}. The App Store finds your app by the words in its name, subtitle and keywords.`,
          full
            ? 'Your keywords are full. Make room first.'
            : addition.left.length > 0
              ? `${quoteList(addition.left)} ${addition.left.length === 1 ? "doesn't" : "don't"} fit in your keywords.`
              : '',
        ]
          .filter(Boolean)
          .join(' '),
        fix: full
          ? undefined
          : {
              locale: locale.locale,
              field: 'keywords',
              before: locale.keywords,
              after: addition.after,
              reason: `Added ${andList(addition.added.map((word) => `"${word}"`))} from Keywords`,
            },
      });
    }

    const unfound = splitKeywords(locale.keywords)
      .map(normalizeTerm)
      .filter((term) => facts.terms.includes(term))
      .filter((term) =>
        countries.every((country) => {
          const standing = facts.standings.get(country)?.get(term);
          // Old readings are not advice: the screen shows when they were taken.
          return !!standing?.latest && !standing.stale && standing.latest.rank === null && standing.notFoundChecks >= NOT_FOUND_CHECKS;
        })
      );
    if (unfound.length > 0) {
      const count = unfound.length;
      out.push({
        id: `${locale.locale}:keywords:not-found`,
        locale: locale.locale,
        field: 'keywords',
        severity: 'tip',
        title: `${count === 1 ? '1 of your keywords isn\'t' : `${count} of your keywords aren't`} found in search`,
        detail: `Search in ${countriesText(countries)} didn't find your app for ${quoteList(unfound)} in any of Growth's last ${NOT_FOUND_CHECKS} checks. Words that rank would do more in that space.`,
      });
    }
  }
  return out;
}

// --- ideas ------------------------------------------------------------------------------

/** Separators inside an app name: "Ludo King: Board Game" is two phrases, not one. */
const NAME_PARTS = /[:|\u2022\u00b7,()[\]!?/\\\u2013\u2014+&\u30fb\uff65\uff5c\uff1a\uff0c\u3001]+|\s-\s/u;

/** The words and two word phrases of a name, each once, never across a separator. */
export function namePhrases(name: string, locale: string): string[] {
  const out = new Set<string>();
  for (const part of name.split(NAME_PARTS)) {
    const phrase = normalizeTerm(part);
    if (!phrase) continue;
    if (writtenWithoutSpaces(locale)) {
      const length = Array.from(phrase).length;
      if (length >= 2 && length <= 12) out.add(phrase);
      continue;
    }
    const words = wordsOf(phrase, locale).filter((word) => !/^\d+$/.test(word));
    words.forEach((word, index) => {
      out.add(word);
      if (index > 0) out.add(`${words[index - 1]} ${word}`);
    });
  }
  return Array.from(out);
}

/** A word found in the names of several apps, and how many of them use it. */
export interface NameIdea {
  term: string;
  apps: number;
}

/**
 * Words and phrases the names of these apps share, most used first: a word
 * counts once per app. Words in `exclude` (tracked already, or on the user's
 * store page) are left out, and so is anything fewer than `minApps` apps use.
 */
export function nameIdeas(names: string[], locale: string, exclude: Set<string>, minApps: number, limit = 12): NameIdea[] {
  const counts = new Map<string, number>();
  for (const name of names) for (const phrase of namePhrases(name, locale)) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  return Array.from(counts.entries())
    .filter(([term, apps]) => apps >= minApps && !exclude.has(term))
    .sort((a, b) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, apps]) => ({ term, apps }));
}

/** Keywords on the user's own store page, as they would be tracked: each keyword of the field, and the name and subtitle phrases. */
export function storePageTerms(locale: Pick<ListingLocale, 'locale' | 'name' | 'subtitle' | 'keywords'>): string[] {
  const out: string[] = [];
  const add = (term: string) => {
    const clean = normalizeTerm(term);
    if (/[\p{L}\p{N}]/u.test(clean) && Array.from(clean).length >= 2 && !out.includes(clean)) out.push(clean);
  };
  for (const entry of splitKeywords(locale.keywords)) add(entry);
  for (const field of [locale.name, locale.subtitle]) for (const part of field.split(NAME_PARTS)) add(part);
  return out;
}

/** Which language a country searches in, by name, for the AI and the screen. */
export function searchLanguageName(country: string, listing?: Pick<ListingSnapshot, 'locales' | 'primaryLocale'> | null): string {
  return listingLanguageName(listing ? listingLocaleFor(country, listing) : listingLanguageFor(country));
}

/**
 * The fewest ratings any app in the first ten has, for "an app with fewer
 * ratings than yours made the top 10". Null when none of them shows a count.
 */
export function fewestRatingsOnTop(search: Pick<KeywordSearch, 'top'>): number | null {
  const counts = search.top.map((app) => app.ratingCount).filter((count): count is number => typeof count === 'number');
  return counts.length > 0 ? Math.min(...counts) : null;
}

/** The ranks as a CSV file a spreadsheet opens: one row per keyword, country and day, newest day first. */
export function keywordsCsv(history: Map<string, Map<string, KeywordDay[]>>, terms: string[], countries: string[]): string {
  const rows: Array<Array<string | number | null>> = [['Keyword', 'Country', 'Day', 'Rank', 'Apps listed']];
  for (const term of terms) {
    for (const country of countries) {
      const days = history.get(country)?.get(term) ?? [];
      for (const day of [...days].reverse()) rows.push([term, territoryName(country), day.date, day.rank ?? 'Not found', day.total]);
    }
  }
  return csvText(rows);
}

// --- what an AI reads ---------------------------------------------------------------

/** What every AI that reads keyword ranks is told about where they come from. */
export const KEYWORD_SOURCE_NOTE =
  "Ranks come from Apple's public App Store search for iPhone apps, read once a day while the app's main window is open. That order is close to the App Store app's but not the same, and ads are not counted. A rank of null means the search did not list the app; a missing value means it was not checked.";

/** Keywords in a few lines per country, for get_store_overview and Growth's Ask AI. */
export interface KeywordDigest {
  tracked: number;
  source: string;
  countries: Array<{
    code: string;
    country: string;
    /** The newest day any keyword was checked there. */
    checked: string | null;
    top10: number;
    top50: number;
    found: number;
    notFound: number;
    notChecked: number;
    /** The best ranks, best first, five at most. */
    best: Array<{ keyword: string; rank: number }>;
    /** The biggest moves since the check one to three days before, five at most: null is not found. */
    moved: Array<{ keyword: string; since: string; from: number | null; to: number | null }>;
  }>;
}

function moveSize(move: RankMove): number {
  return move.kind === 'found' || move.kind === 'lost' ? 1000 : move.places;
}

export function keywordDigest(
  list: Pick<KeywordList, 'keywords' | 'countries'>,
  history: Map<string, Map<string, KeywordDay[]>>,
  today: DayString
): KeywordDigest | null {
  if (list.keywords.length === 0) return null;
  const countries = (list.countries.length > 0 ? list.countries : ['US']).map((code) => {
    const rows = list.keywords.map((keyword) => ({ keyword: keyword.term, standing: standingOf(history.get(code)?.get(keyword.term) ?? [], today) }));
    const ranks = rows.map((row) => row.standing.latest?.rank);
    const dates = rows.map((row) => row.standing.latest?.date).filter((date): date is string => !!date);
    return {
      code,
      country: territoryName(code),
      checked: dates.length > 0 ? dates.sort()[dates.length - 1] : null,
      top10: ranks.filter((rank) => typeof rank === 'number' && rank <= 10).length,
      top50: ranks.filter((rank) => typeof rank === 'number' && rank <= 50).length,
      found: ranks.filter((rank) => typeof rank === 'number').length,
      notFound: ranks.filter((rank) => rank === null).length,
      notChecked: ranks.filter((rank) => rank === undefined).length,
      best: rows
        .flatMap((row) => (typeof row.standing.latest?.rank === 'number' ? [{ keyword: row.keyword, rank: row.standing.latest.rank }] : []))
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 5),
      moved: rows
        .filter((row) => ['up', 'down', 'found', 'lost'].includes(row.standing.dayMove.kind) && row.standing.previous && row.standing.latest)
        .sort((a, b) => moveSize(b.standing.dayMove) - moveSize(a.standing.dayMove))
        .slice(0, 5)
        .map((row) => ({ keyword: row.keyword, since: row.standing.previous!.date, from: row.standing.previous!.rank, to: row.standing.latest!.rank })),
    };
  });
  return { tracked: list.keywords.length, source: KEYWORD_SOURCE_NOTE, countries };
}

export interface KeywordReportInput {
  list: KeywordList;
  history: Map<string, Map<string, KeywordDay[]>>;
  /** The newest search of each keyword, by `${country}|${term}`: read for one keyword only. */
  searches: Map<string, KeywordSearch>;
  listing: ListingSnapshot | null;
  /** The App Store apps the user follows on Competitors, by id. */
  followed: Array<{ id: string; name: string }>;
  today: DayString;
  /** One keyword, with the first apps for it and its rank at each check. */
  keyword?: string;
  /** One country, as a two letter code. */
  country?: string;
}

/**
 * The keywords as list_store_keywords answers: for each keyword and country
 * the rank, each comparison with the day it compares with, misses in a row,
 * where the followed apps rank, and whether the words are on the store page.
 * Asked about one keyword, it adds the first apps for it and every check.
 */
export function keywordReport(input: KeywordReportInput) {
  const term = input.keyword === undefined ? undefined : normalizeTerm(input.keyword);
  const allCountries = input.list.countries.length > 0 ? input.list.countries : ['US'];
  const countries = input.country ? allCountries.filter((code) => code === input.country) : allCountries;
  const keywords = term ? input.list.keywords.filter((keyword) => keyword.term === term) : input.list.keywords;
  const change = (base?: KeywordDay, latest?: KeywordDay) => (base && latest ? { since: base.date, from: base.rank, to: latest.rank } : undefined);
  return {
    source: KEYWORD_SOURCE_NOTE,
    countries: countries.map((code) => ({ code, name: territoryName(code) })),
    keywords: keywords.map((keyword) => ({
      keyword: keyword.term,
      countries: Object.fromEntries(
        countries.map((code) => {
          const rows = input.history.get(code)?.get(keyword.term) ?? [];
          const standing = standingOf(rows, input.today);
          const latest = standing.latest;
          const locale = input.listing ? input.listing.locales.find((entry) => entry.locale === listingLocaleFor(code, input.listing!)) : undefined;
          const coverage = locale ? coverageOf(keyword.term, locale) : null;
          const search = term ? input.searches.get(`${code}|${keyword.term}`) : undefined;
          return [
            code,
            {
              rank: latest ? latest.rank : undefined,
              appsListed: latest?.total,
              checked: latest?.date ?? null,
              stale: standing.stale,
              changes: {
                day: change(standing.previous, latest),
                week: change(standing.weekAgo, latest),
                month: change(standing.monthAgo, latest),
              },
              missesInARow: standing.notFoundChecks,
              competitors: input.followed
                .filter((app) => !!latest && app.id in latest.rivals)
                .map((app) => ({ name: app.name, rank: latest!.rivals[app.id] })),
              onStorePage: coverage && locale ? { language: listingLanguageName(locale.locale), fields: coverage.fields, missingWords: coverage.missing } : undefined,
              ...(term
                ? {
                    firstApps: search
                      ? { checked: dayOf(new Date(search.at)), apps: search.top.map((app, index) => ({ rank: index + 1, name: app.name, ratings: app.ratingCount })) }
                      : undefined,
                    checks: rows.map((row) => ({ date: row.date, rank: row.rank })),
                  }
                : {}),
            },
          ];
        })
      ),
    })),
  };
}
