"use client";

// One keyword list for the Keywords screen and the Store page (keywordWatch.ts):
// the list, the app it ranks, its ranks over the last days in every country of
// the list, and the newest search of each keyword, read again whenever a check
// or an edit writes, or Competitors names another app as the user's.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rowsByCountryAndTerm, type KeywordDay, type KeywordList, type KeywordSearch } from './keywords';
import {
  keywordAppOf,
  keywordCheckState,
  onKeywordsChange,
  readKeywordHistory,
  readKeywordList,
  readKeywordSearches,
  type KeywordCheckState,
} from './keywordWatch';
import { onRivalsChange } from './rivalWatch';

export interface KeywordsData {
  loaded: boolean;
  list: KeywordList | null;
  /** The App Store app whose ranks these are, null when there is none to rank. */
  appId: string | null;
  /** By country, then keyword: the rows of the last days, oldest first. */
  history: Map<string, Map<string, KeywordDay[]>>;
  /** The newest search of each keyword, by `${country}|${term}`. Empty unless asked for. */
  searches: Map<string, KeywordSearch>;
  /** The check of this list running in this window. */
  checking: KeywordCheckState | null;
}

const EMPTY: KeywordsData = { loaded: false, list: null, appId: null, history: new Map(), searches: new Map(), checking: null };

async function load(owner: string, days: number, withSearches: boolean): Promise<Omit<KeywordsData, 'checking'>> {
  const [list, appId] = await Promise.all([readKeywordList(owner), keywordAppOf(owner)]);
  const countries = list?.countries ?? [];
  const terms = list?.keywords.map((keyword) => keyword.term) ?? [];
  const [rows, searches] = await Promise.all([
    appId && countries.length > 0 ? readKeywordHistory(appId, countries, days) : Promise.resolve([]),
    withSearches ? readKeywordSearches(countries, terms) : Promise.resolve(new Map<string, KeywordSearch>()),
  ]);
  return { loaded: true, list, appId, history: rowsByCountryAndTerm(rows), searches };
}

/**
 * `owner` is null while it is not known yet which app Growth shows; nothing
 * is read then. `days` is how much history to read, and the Store page asks
 * for no searches.
 */
export function useKeywords(owner: string | null, options: { days?: number; searches?: boolean } = {}): KeywordsData & { reload: () => void } {
  const days = options.days ?? 90;
  const withSearches = options.searches ?? true;
  const [data, setData] = useState<Omit<KeywordsData, 'checking'>>(EMPTY);
  const [checking, setChecking] = useState<KeywordCheckState | null>(null);
  const [epoch, setEpoch] = useState(0);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Another app's list goes at once, so nothing of it shows as this one's.
    if (shownFor.current !== owner) {
      shownFor.current = owner;
      setData(EMPTY);
      setChecking(null);
    }
    if (owner === null) return;
    let scheduled = false;
    // Reads can overlap during a check; only the newest one lands.
    let reads = 0;
    const read = () => {
      const ticket = ++reads;
      void load(owner, days, withSearches).then(
        (next) => {
          if (!cancelled && ticket === reads) setData(next);
        },
        (error) => console.error('The keywords could not be read', error)
      );
    };
    read();
    const progress = () => {
      const state = keywordCheckState();
      setChecking(state && state.owner === owner ? { ...state } : null);
    };
    progress();
    const later = () => {
      // A check writes once per search; one read per short pause is plenty.
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        if (!cancelled) read();
      }, 150);
    };
    const offKeywords = onKeywordsChange((event) => (event === 'progress' ? progress() : later()));
    // The app a list with no Growth app ranks is the one named on Competitors.
    const offRivals = onRivalsChange((event) => {
      if (event === 'data' && owner === '') later();
    });
    return () => {
      cancelled = true;
      offKeywords();
      offRivals();
    };
  }, [owner, days, withSearches, epoch]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return useMemo(() => ({ ...data, checking, reload }), [data, checking, reload]);
}
