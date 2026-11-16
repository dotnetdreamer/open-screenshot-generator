"use client";

// Popularity's storage and refreshes: one record per keyword and country in
// the growth database's meta table, under `keywords:popularity:` keys, beside
// the newest search of each keyword (keywordWatch.ts). "Remove the data"
// keeps them with the other `keywords:` keys; nothing in them belongs to an
// app.
//
// Apple Ads sends a score a week, so a record younger than a day is used as it
// is, and one request asks for every keyword of a country that is due: a list
// of 50 keywords in 5 countries normally costs 5 requests a day. Ideas are
// asked about the same way, in the country on screen.
//
// One refresh runs at a time in the whole browser (a Web Lock). The screens
// wait their turn for it, so the table's refresh and the ideas' never skip
// each other; the background pass of Keywords, which runs every list after
// its rank check in the main window (useKeywordWatch.ts), skips when another
// one holds the lock.

import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '@/lib/desktop';
import { freshAppleAdsSetup, isAppleAdsConnected, subscribeAppleAdsSetup, type AppleAdsError, type AppleAdsSetup } from './appleAds';
import { deleteMeta, readMeta, readMetaWithPrefix, writeMeta } from './db';
import { today } from './dates';
import { allKeywordLists } from './keywordWatch';
import { fetchPopularity, TERMS_PER_REQUEST, type KeywordPopularity } from './popularity';

export const popularityKey = (country: string, term: string) => `keywords:popularity:${country}:${term}`;
const statusKey = (country: string) => `keywords:popularity-status:${country}`;

/** A record younger than this is used as it is. */
export const POPULARITY_FRESH_MS = 24 * 3_600_000;
/**
 * How long a country waits after a refresh that got no scores, by what went
 * wrong: a lost connection or a "slow down" passes soon, while a refused
 * request, key or role needs someone to change something. Check now asks
 * again at once (`retryRefused`), and a new key or ad account clears them all.
 */
const RETRY_AFTER: Record<AppleAdsError['kind'], number> = {
  network: 3_600_000,
  limit: 3_600_000,
  request: 6 * 3_600_000,
  key: 6 * 3_600_000,
  access: 6 * 3_600_000,
  account: 6 * 3_600_000,
};

/** Why the last refresh of a country got no scores, kept so the screen can say it and the next try waits. */
export interface PopularityStatus {
  at: number;
  text: string;
  kind: AppleAdsError['kind'];
}

// --- telling the screens -------------------------------------------------------------

const listeners = new Set<() => void>();

export function onPopularityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  listeners.forEach((listener) => listener());
}

/** The refresh running in this window, if any. */
let refreshing: { countries: string[] } | null = null;

export function popularityRefreshing(): { countries: string[] } | null {
  return refreshing;
}

// --- reading -------------------------------------------------------------------------

function isRecord(value: unknown): value is KeywordPopularity {
  return !!value && typeof value === 'object' && Array.isArray((value as KeywordPopularity).points) && typeof (value as KeywordPopularity).at === 'number';
}

/** The stored scores of these keywords in these countries, by `${country}|${term}`. */
export async function readPopularity(countries: string[], terms: string[]): Promise<Map<string, KeywordPopularity>> {
  const pairs = countries.flatMap((country) => terms.map((term) => ({ country, term })));
  const rows = await Promise.all(pairs.map((pair) => readMeta<KeywordPopularity>(popularityKey(pair.country, pair.term))));
  const out = new Map<string, KeywordPopularity>();
  rows.forEach((row, index) => {
    if (isRecord(row)) out.set(`${pairs[index].country}|${pairs[index].term}`, row);
  });
  return out;
}

export async function readPopularityStatus(countries: string[]): Promise<Map<string, PopularityStatus>> {
  const rows = await Promise.all(countries.map((country) => readMeta<PopularityStatus>(statusKey(country))));
  const out = new Map<string, PopularityStatus>();
  rows.forEach((row, index) => {
    if (row && typeof row.text === 'string' && typeof row.at === 'number') out.set(countries[index], row);
  });
  return out;
}

/** The terms of a country that have no record, or one older than POPULARITY_FRESH_MS. */
export function popularityDue(stored: Map<string, KeywordPopularity>, country: string, terms: string[], now = Date.now()): string[] {
  return terms.filter((term) => {
    const record = stored.get(`${country}|${term}`);
    return !record || now - record.at >= POPULARITY_FRESH_MS;
  });
}

// --- refreshing ----------------------------------------------------------------------

export interface PopularityRefreshResult {
  /** Requests Apple answered. */
  asked: number;
  /** Countries Apple gave no scores for this time. */
  failed: number;
  /** Not connected, not the desktop app, or another window was refreshing. */
  skipped?: 'not-connected' | 'not-desktop' | 'busy';
}

function webLocks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (error as Error)?.name === 'AbortError' || !!signal?.aborted;
}

/** The key and ad account a refresh reads with, to notice a change while it runs. */
function setupId(setup: AppleAdsSetup): string | null {
  return isAppleAdsConnected(setup) ? `${setup.key.clientId}|${setup.key.keyId}|${setup.account.id}` : null;
}

/**
 * Ask Apple Ads for the scores of these keywords in these countries that are
 * due (or all of them with `force`), one request per country and 50 terms.
 * A country that got no scores waits as RETRY_AFTER says, unless
 * `retryRefused` or `force`. A key, role or account Apple refuses stops the
 * whole refresh, and so does a change of key or ad account while it runs:
 * what the old one gets is not written.
 */
export async function refreshPopularity(options: {
  countries: string[];
  terms: string[];
  force?: boolean;
  /** Ask a country again now, even when its last try failed lately. Check now does. */
  retryRefused?: boolean;
  /** Wait for a refresh running elsewhere instead of skipping. Screens wait; the background pass does not. */
  wait?: boolean;
  signal?: AbortSignal;
}): Promise<PopularityRefreshResult> {
  if (!isAppleAdsConnected()) return { asked: 0, failed: 0, skipped: 'not-connected' };
  if (!isTauri()) return { asked: 0, failed: 0, skipped: 'not-desktop' };
  const terms = Array.from(new Set(options.terms.filter(Boolean)));
  const countries = Array.from(new Set(options.countries.filter(Boolean)));
  if (terms.length === 0 || countries.length === 0) return { asked: 0, failed: 0 };

  const run = async (): Promise<PopularityRefreshResult> => {
    // Read inside the lock: a refresh that waited must use the key saved now, not the one saved when it was asked for.
    // Read from storage, not the copy in memory: a key removed in another window is gone even if this one missed the news.
    const setup = freshAppleAdsSetup();
    if (!isAppleAdsConnected(setup)) return { asked: 0, failed: 0, skipped: 'not-connected' };
    const started = setupId(setup);
    const unchanged = () => setupId(freshAppleAdsSetup()) === started;
    const [stored, status] = await Promise.all([readPopularity(countries, terms), readPopularityStatus(countries)]);
    const now = Date.now();
    let asked = 0;
    let failed = 0;
    refreshing = { countries };
    announce();
    try {
      for (const country of countries) {
        if (!unchanged()) break;
        const due = options.force ? terms : popularityDue(stored, country, terms, now);
        if (due.length === 0) continue;
        const refused = status.get(country);
        if (!options.force && !options.retryRefused && refused && now - refused.at < (RETRY_AFTER[refused.kind] ?? RETRY_AFTER.request)) continue;
        try {
          for (let index = 0; index < due.length; index += TERMS_PER_REQUEST) {
            const chunk = due.slice(index, index + TERMS_PER_REQUEST);
            const found = await fetchPopularity(setup.key, setup.account, country, chunk, { day: today(), signal: options.signal });
            if (!unchanged()) break;
            await Promise.all(Array.from(found.values()).map((record) => writeMeta(popularityKey(country, record.term), record)));
            asked += 1;
            announce();
          }
          if (refused && unchanged()) await deleteMeta([statusKey(country)]);
        } catch (error) {
          if (isAbort(error, options.signal)) throw error;
          // A refusal of a key that was changed or removed meanwhile is old news.
          if (!unchanged()) break;
          const problem = error as AppleAdsError;
          failed += 1;
          console.error(`Apple Ads popularity for ${country} failed`, error);
          await writeMeta(statusKey(country), { at: Date.now(), text: problem.message || 'Apple Ads gave no answer', kind: problem.kind ?? 'request' } satisfies PopularityStatus);
          announce();
          // A key or a role problem is the same for every country.
          if (problem.kind === 'key' || problem.kind === 'access' || problem.kind === 'account') break;
        }
      }
    } finally {
      refreshing = null;
      announce();
    }
    return { asked, failed };
  };

  const locks = webLocks();
  if (!locks) return run();
  return locks.request('osg-growth-popularity', { ifAvailable: !options.wait }, (lock) => (lock ? run() : Promise.resolve<PopularityRefreshResult>({ asked: 0, failed: 0, skipped: 'busy' })));
}

/** Forget what the last refreshes said went wrong in every country, after the key changed, so the new key is tried at once. */
export async function clearPopularityStatus(): Promise<void> {
  const rows = await readMetaWithPrefix<PopularityStatus>(statusKey(''));
  await deleteMeta(rows.map((row) => row.key));
  announce();
}

/** The background pass: every keyword list's keywords in its countries, when Apple Ads is connected. */
export async function refreshPopularityForLists(options: { signal?: AbortSignal } = {}): Promise<void> {
  if (!isAppleAdsConnected() || !isTauri()) return;
  for (const list of await allKeywordLists()) {
    if (options.signal?.aborted) return;
    if (list.keywords.length === 0) continue;
    try {
      await refreshPopularity({ countries: list.countries.length > 0 ? list.countries : ['US'], terms: list.keywords.map((keyword) => keyword.term), signal: options.signal });
    } catch (error) {
      if (isAbort(error, options.signal)) return;
      console.error('Refreshing keyword popularity failed', error);
    }
  }
}

// --- the hook ---------------------------------------------------------------------------

export interface PopularityData {
  /** True once the stored scores were read. */
  loaded: boolean;
  /** Apple Ads is connected. */
  connected: boolean;
  /** By `${country}|${term}`. */
  records: Map<string, KeywordPopularity>;
  /** Why a country got no scores lately, by country. */
  status: Map<string, PopularityStatus>;
  /** A refresh runs in this window. */
  refreshing: boolean;
}

/** The stored scores of these keywords in these countries, read again whenever a refresh writes or the key changes. */
export function usePopularity(countries: string[], terms: string[]): PopularityData {
  const countriesKey = countries.join(',');
  const termsKey = terms.join('\n');
  const [data, setData] = useState<PopularityData>({ loaded: false, connected: false, records: new Map(), status: new Map(), refreshing: false });

  useEffect(() => {
    let cancelled = false;
    let reads = 0;
    const wantedCountries = countriesKey ? countriesKey.split(',') : [];
    const wantedTerms = termsKey ? termsKey.split('\n') : [];
    const read = () => {
      const ticket = ++reads;
      void Promise.all([readPopularity(wantedCountries, wantedTerms), readPopularityStatus(wantedCountries)]).then(
        ([records, status]) => {
          if (cancelled || ticket !== reads) return;
          setData({ loaded: true, connected: isAppleAdsConnected(), records, status, refreshing: popularityRefreshing() !== null });
        },
        (error) => console.error('Keyword popularity could not be read', error)
      );
    };
    read();
    const offChange = onPopularityChange(read);
    const offSetup = subscribeAppleAdsSetup(read);
    return () => {
      cancelled = true;
      offChange();
      offSetup();
    };
  }, [countriesKey, termsKey]);

  return useMemo(() => data, [data]);
}
