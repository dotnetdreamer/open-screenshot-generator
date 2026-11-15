// Keywords' storage and checks: the lists of keywords tracked, the newest
// search per keyword and country, and the ranks day by day. Lists and
// searches live in the growth database's meta table (db.ts) under
// `keywords:` keys; the ranks in its keywordDays table. It all works the same
// in the web build and the desktop app, since Apple's search needs no key.
//
// A check asks Apple once per keyword per country (keywords.ts) and writes
// each answer as it comes, so the screen fills in while the check runs. The
// background pass owes a list only the searches it has no row for today, so
// a check that was stopped or cut short carries on where it ended, and a day
// that has every row asks Apple nothing. Check now asks again for every
// keyword, but a search answered in the last hour is used as it is: Apple's
// servers would send the same copy.
//
// One check runs at a time in the whole browser: a lock covers every window
// of the app, so two editor windows never ask Apple twice for one list. A
// check the user asks for waits for one running in another window; the
// background pass skips instead.

import { readKeywordDays, readMeta, readMetaWithPrefix, updateKeywordDays, writeKeywordDays, writeMeta } from './db';
import { addDays, today } from './dates';
import {
  MAX_KEYWORD_COUNTRIES,
  MAX_KEYWORDS,
  dayFromSearch,
  normalizeTerm,
  rankIn,
  searchKeyword,
  searchesDue,
  type KeywordDay,
  type KeywordList,
  type KeywordSearch,
  type KeywordSource,
} from './keywords';
import type { DayString } from './types';
import { readRivalList } from './rivalWatch';
import { TERRITORY_CODES } from './territories';

export const keywordKeys = {
  list: (owner: string) => `keywords:list:${owner}`,
  search: (country: string, term: string) => `keywords:search:${country}:${term}`,
};

const LIST_PREFIX = 'keywords:list:';
/** After a check that got no answer at all, or left searches unanswered, the background pass waits this long. */
const RETRY_AFTER_FAILURE_MS = 3_600_000;
/** A search answered this recently is used again rather than asked again. */
const REUSE_SEARCH_MS = 3_600_000;
/** Requests that fail one after another before a check gives up on Apple for now. */
const FAILURES_IN_A_ROW = 3;

// --- telling the screens -------------------------------------------------------------

export type KeywordsEvent = 'data' | 'progress';

const listeners = new Set<(event: KeywordsEvent) => void>();

export function onKeywordsChange(listener: (event: KeywordsEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(event: KeywordsEvent): void {
  listeners.forEach((listener) => listener(event));
}

/** The check running in this window, for its progress bar. */
export interface KeywordCheckState {
  owner: string;
  done: number;
  total: number;
}

let checking: KeywordCheckState | null = null;

export function keywordCheckState(): KeywordCheckState | null {
  return checking;
}

function setChecking(state: KeywordCheckState | null): void {
  checking = state;
  announce('progress');
}

// --- lists ---------------------------------------------------------------------------

function webLocks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

let listWrites: Promise<unknown> = Promise.resolve();

/** A list is changed by the screen (a keyword, a country) and by a check (its times), maybe in two windows at once: one at a time. */
function withListLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (locks) return locks.request('osg-growth-keyword-lists', () => task());
  const next = listWrites.then(task, task);
  listWrites = next.catch(() => undefined);
  return next;
}

function cleanList(value: KeywordList | undefined, owner: string): KeywordList | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.keywords)) return null;
  return { ...value, owner, countries: Array.isArray(value.countries) ? value.countries : [] };
}

export async function readKeywordList(owner: string): Promise<KeywordList | null> {
  return cleanList(await readMeta<KeywordList>(keywordKeys.list(owner)), owner);
}

export async function allKeywordLists(): Promise<KeywordList[]> {
  const rows = await readMetaWithPrefix<KeywordList>(LIST_PREFIX);
  return rows.map((row) => cleanList(row.value, row.key.slice(LIST_PREFIX.length))).filter((list): list is KeywordList => !!list);
}

function validCountries(countries: string[]): string[] {
  return Array.from(new Set(countries.map((code) => code.toUpperCase()).filter((code) => TERRITORY_CODES.includes(code)))).slice(0, MAX_KEYWORD_COUNTRIES);
}

async function changeList(owner: string, change: (list: KeywordList) => KeywordList, create?: () => KeywordList): Promise<KeywordList | null> {
  const result = await withListLock(async () => {
    const current = (await readKeywordList(owner)) ?? (create ? create() : null);
    if (!current) return null;
    const next = change(current);
    await writeMeta(keywordKeys.list(owner), next);
    return next;
  });
  announce('data');
  return result;
}

/**
 * Track keywords. A list that does not exist yet starts with `countries`.
 * Keywords already tracked are left as they are; past MAX_KEYWORDS the rest
 * are refused, and `refused` says how many.
 */
export async function trackKeywords(
  owner: string,
  terms: string[],
  options: { source: KeywordSource; countries: string[] }
): Promise<{ added: string[]; refused: number }> {
  const outcome = { added: [] as string[], refused: 0 };
  await changeList(
    owner,
    (current) => {
      const have = new Set(current.keywords.map((keyword) => keyword.term));
      const keywords = [...current.keywords];
      const now = Date.now();
      for (const raw of terms) {
        const term = normalizeTerm(raw);
        if (!term || have.has(term)) continue;
        if (keywords.length >= MAX_KEYWORDS) {
          outcome.refused += 1;
          continue;
        }
        have.add(term);
        keywords.push({ term, addedAt: now, source: options.source });
        outcome.added.push(term);
      }
      return { ...current, keywords };
    },
    () => ({ owner, keywords: [], countries: validCountries(options.countries.length ? options.countries : ['US']) })
  );
  return outcome;
}

/** Stop tracking a keyword. Its past ranks stay in the database, so tracking it again brings them back. */
export async function untrackKeyword(owner: string, term: string): Promise<void> {
  await changeList(owner, (current) => ({ ...current, keywords: current.keywords.filter((keyword) => keyword.term !== term) }));
}

/** Change the countries a list checks, on the stored list in its turn. A list keeps one country at least. */
export async function changeKeywordCountries(owner: string, change: (countries: string[]) => string[], startWith: string[]): Promise<void> {
  await changeList(
    owner,
    (current) => {
      const next = validCountries(change(current.countries.length ? current.countries : startWith));
      return next.length > 0 ? { ...current, countries: next } : current;
    },
    () => ({ owner, keywords: [], countries: validCountries(startWith) })
  );
}

/** An App Store app id: all digits. Google Play apps cannot be searched. */
export function isAppStoreId(id: string | null | undefined): id is string {
  return !!id && /^\d+$/.test(id);
}

/**
 * The app a list ranks: its owner when that is an App Store app, or, for a
 * list with no Growth app, the App Store app the user named as theirs on
 * Competitors. Null for a Google Play app, or when no app is named yet.
 */
export async function keywordAppOf(owner: string): Promise<string | null> {
  if (isAppStoreId(owner)) return owner;
  if (owner) return null;
  const named = (await readRivalList(''))?.yourApp?.id;
  return isAppStoreId(named) ? named : null;
}

// --- reading -------------------------------------------------------------------------

/** The newest search of each keyword in each country, by `${country}|${term}`. */
export async function readKeywordSearches(countries: string[], terms: string[]): Promise<Map<string, KeywordSearch>> {
  const pairs = countries.flatMap((country) => terms.map((term) => ({ country, term })));
  const rows = await Promise.all(pairs.map((pair) => readMeta<KeywordSearch>(keywordKeys.search(pair.country, pair.term))));
  const out = new Map<string, KeywordSearch>();
  rows.forEach((row, index) => {
    if (row && Array.isArray(row.ids) && Array.isArray(row.top)) out.set(`${pairs[index].country}|${pairs[index].term}`, row);
  });
  return out;
}

/** An app's ranks in these countries over the last `days` days. */
export async function readKeywordHistory(appId: string, countries: string[], days: number): Promise<KeywordDay[]> {
  const from = addDays(today(), -days);
  const rows = await Promise.all(countries.map((country) => readKeywordDays(appId, country, from)));
  return rows.flat();
}

// --- checks --------------------------------------------------------------------------

export interface KeywordCheckResult {
  /** Searches Apple answered. */
  searches: number;
  /** Searches left without an answer, failed or never asked after Apple stopped answering. */
  failed: number;
  /** Every search had a row for today already. */
  upToDate?: boolean;
  /** Another window was checking, and this call did not wait for it. */
  skipped?: boolean;
}

export interface KeywordCheckOptions {
  signal?: AbortSignal;
  /** Search this country first: the one on screen. */
  first?: string;
  /** Wait for a check running in another window rather than skip. The background pass does not wait. */
  wait?: boolean;
  /** Ask again for searches that have a row for today. Check now does. */
  again?: boolean;
  /** These keywords only, or these countries only: a keyword or a country just added. */
  only?: { terms?: string[]; countries?: string[] };
}

const NOTHING: KeywordCheckResult = { searches: 0, failed: 0 };

const running = new Map<string, { work: Promise<KeywordCheckResult>; stop: AbortController }>();

export function isCheckingKeywords(owner: string): boolean {
  return running.has(owner);
}

/** Stop the check of this list running in this window. What came back so far is kept. */
export function stopKeywordCheck(owner: string): void {
  running.get(owner)?.stop.abort();
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (error as Error)?.name === 'AbortError' || !!signal?.aborted;
}

/**
 * Search a list's keywords in its countries. A second call in this window
 * waits for the check running and then runs, so a keyword added during a
 * check is still searched; Stop keeps what came back.
 */
export function checkKeywords(owner: string, options: KeywordCheckOptions = {}): Promise<KeywordCheckResult> {
  const existing = running.get(owner);
  if (existing) return existing.work.catch(() => undefined).then(() => checkKeywords(owner, options));
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const locks = webLocks();
  const task = () => runCheck(owner, stop.signal, options);
  const work = (
    locks
      ? locks.request('osg-growth-keyword-check', { ifAvailable: !options.wait }, (lock) =>
          lock ? task() : Promise.resolve<KeywordCheckResult>({ ...NOTHING, skipped: true })
        )
      : task()
  ).finally(() => {
    options.signal?.removeEventListener('abort', onAbort);
    running.delete(owner);
  });
  running.set(owner, { work, stop });
  return work;
}

/** A search for an idea, or for a check: the stored one when Apple answered it within the hour, a new one otherwise. */
export async function freshSearch(term: string, country: string, signal?: AbortSignal): Promise<KeywordSearch> {
  const stored = await readMeta<KeywordSearch>(keywordKeys.search(country, term));
  if (stored && Array.isArray(stored.ids) && Date.now() - stored.at < REUSE_SEARCH_MS) return stored;
  const search = await searchKeyword(term, country, { signal });
  await writeMeta(keywordKeys.search(country, term), search);
  announce('data');
  return search;
}

/**
 * Give today's rows the ranks of apps followed since the rows were written.
 * A search lists every app, so each row takes them from the very search it
 * was read from (same answer time), and nothing is asked again; a row whose
 * search was replaced or is gone keeps what it has, and its app shows as not
 * checked rather than as not found.
 */
async function fillRivalRanks(appId: string, countries: string[], date: DayString, rivalIds: string[]): Promise<number> {
  let filled = 0;
  for (const country of countries) {
    const rows = (await readKeywordDays(appId, country, date)).filter((row) => row.date === date);
    const short = rows.filter((row) => rivalIds.some((id) => id !== appId && !(id in row.rivals)));
    if (short.length === 0) continue;
    const searches = await readKeywordSearches([country], short.map((row) => row.term));
    filled += await updateKeywordDays(
      short.map((row) => row.key),
      (row) => {
        const search = searches.get(`${country}|${row.term}`);
        if (!search || search.at !== row.at) return null;
        const missing = rivalIds.filter((id) => id !== appId && !(id in row.rivals));
        if (missing.length === 0) return null;
        const rivals = { ...row.rivals };
        for (const id of missing) rivals[id] = rankIn(search, id);
        return { ...row, rivals };
      }
    );
  }
  if (filled > 0) announce('data');
  return filled;
}

/** After a follow on Competitors: today's ranks of a list take in the apps it follows now. */
export async function refreshRivalRanks(owner: string): Promise<void> {
  const [list, appId] = await Promise.all([readKeywordList(owner), keywordAppOf(owner)]);
  if (!list || !appId || list.keywords.length === 0) return;
  const rivalIds = ((await readRivalList(owner))?.rivals ?? []).map((rival) => rival.id).filter(isAppStoreId);
  if (rivalIds.length === 0) return;
  await fillRivalRanks(appId, list.countries.length > 0 ? list.countries : ['US'], today(), rivalIds);
}

async function runCheck(owner: string, signal: AbortSignal, options: KeywordCheckOptions): Promise<KeywordCheckResult> {
  const list = await readKeywordList(owner);
  if (!list || list.keywords.length === 0) return NOTHING;
  const appId = await keywordAppOf(owner);
  if (!appId) return NOTHING;
  const rivalIds = ((await readRivalList(owner))?.rivals ?? []).map((rival) => rival.id).filter(isAppStoreId);

  const listCountries = list.countries.length > 0 ? list.countries : ['US'];
  const wantedCountries = options.only?.countries ? listCountries.filter((code) => options.only!.countries!.includes(code)) : listCountries;
  const countries =
    options.first && wantedCountries.includes(options.first)
      ? [options.first, ...wantedCountries.filter((code) => code !== options.first)]
      : wantedCountries;
  const allTerms = list.keywords.map((keyword) => keyword.term);
  const terms = options.only?.terms ? allTerms.filter((term) => options.only!.terms!.includes(term)) : allTerms;
  const date = today();
  // Apps followed since today's rows were written get their ranks from the same searches.
  await fillRivalRanks(appId, countries, date, rivalIds);
  const done = new Set<string>();
  if (!options.again) {
    for (const country of countries) {
      for (const row of await readKeywordDays(appId, country, date)) if (row.date === date) done.add(`${country}|${row.term}`);
    }
  }
  const due = searchesDue(terms, countries, done);
  if (due.length === 0) return { ...NOTHING, upToDate: true };

  let answered = 0;
  let unanswered = 0;
  let inARow = 0;
  let lastError: unknown = null;
  setChecking({ owner, done: 0, total: due.length });
  try {
    for (const [index, pair] of due.entries()) {
      if (inARow >= FAILURES_IN_A_ROW) {
        unanswered += due.length - index;
        break;
      }
      try {
        const search = await freshSearch(pair.term, pair.country, signal);
        await writeKeywordDays([dayFromSearch(search, appId, rivalIds, date)]);
        answered += 1;
        inARow = 0;
        announce('data');
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        console.error(`Searching the App Store for "${pair.term}" in ${pair.country} failed`, error);
        lastError = error;
        unanswered += 1;
        inARow += 1;
      }
      setChecking({ owner, done: index + 1, total: due.length });
    }
  } finally {
    setChecking(null);
  }

  const now = Date.now();
  await changeList(owner, (current) => {
    const next = { ...current };
    if (answered > 0) {
      next.checkedAt = now;
      delete next.failedAt;
    } else {
      next.failedAt = now;
    }
    if (unanswered > 0) next.trouble = { at: now, searches: unanswered };
    else delete next.trouble;
    return next;
  });
  if (answered === 0 && lastError) throw lastError;
  return { searches: answered, failed: unanswered };
}

/** Whether the background pass should look at a list now: it tracks something, and no failure is under an hour old. */
export function isKeywordListWaiting(list: KeywordList, now = Date.now()): boolean {
  if (list.keywords.length === 0) return false;
  if (list.failedAt && now - list.failedAt < RETRY_AFTER_FAILURE_MS) return false;
  if (list.trouble && now - list.trouble.at < RETRY_AFTER_FAILURE_MS) return false;
  return true;
}

/** One background pass: every list fills in the ranks it has no row for today, one list after another. */
export async function runKeywordPass(options: { signal?: AbortSignal } = {}): Promise<void> {
  const now = Date.now();
  for (const list of await allKeywordLists()) {
    if (options.signal?.aborted) return;
    if (!isKeywordListWaiting(list, now)) continue;
    try {
      await checkKeywords(list.owner, { signal: options.signal });
    } catch (error) {
      if (isAbort(error, options.signal)) return;
      console.error('The keywords check failed', error);
    }
  }
}
