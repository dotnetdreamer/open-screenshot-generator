"use client";

// Keywords: where the user's App Store app shows up when people search the
// App Store, for each keyword the user tracks, in each country, day by day
// (src/lib/growth/keywords.ts reads Apple's search, keywordWatch.ts keeps the
// ranks and runs the checks). Beside each rank: how it moved, the app that
// comes first, the apps followed on Competitors, and whether the keyword is
// on the store page. Ideas for more keywords come from the names of the apps
// that rank, the store page, the apps followed and the AI, and each idea is
// checked with a real search before it shows a rank.
//
// A keyword the store page lacks can be added to the keywords from here. The
// edit goes to the Store page's changes (listingDrafts.ts), never to Apple:
// the user reads it there and applies it with the rest.
//
// With Apple Ads connected (desktop only, appleAds.ts), each keyword and idea
// also shows its popularity, Apple Ads' weekly score from 1 to 100 per
// country (popularity.ts), and the table can turn into a map of popularity
// against how strong the top 10 of each search is (GrowthPopularity.tsx).
// Ideas then come best chance first: the words the app can rank for, most
// searched first.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  DownloadIcon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addDays, dayOf, daysBetween, formatDay, today } from '@/lib/growth/dates';
import { formatAgo, formatCount, formatExact, formatRating } from '@/lib/growth/format';
import {
  MAX_KEYWORD_COUNTRIES,
  MAX_KEYWORDS,
  addToKeywordField,
  bucketOf,
  coverageOf,
  keywordsCsv,
  listingLocaleFor,
  loneReadings,
  nameIdeas,
  namePhrases,
  parseKeywordInput,
  rankIn,
  rankWords,
  searchLanguageName,
  standingOf,
  startingKeywordCountries,
  storePageTerms,
  type KeywordDay,
  type KeywordSearch,
  type KeywordSource,
  type KeywordStanding,
  type RankBucket,
  type RankMove,
  type SearchApp,
} from '@/lib/growth/keywords';
import { dropKeywordIdea, startKeywordIdeas, stopKeywordIdeas, useKeywordIdeas } from '@/lib/growth/keywordIdeas';
import {
  changeKeywordCountries,
  checkKeywords,
  freshSearch,
  isAppStoreId,
  isKeywordListWaiting,
  readKeywordSearches,
  refreshRivalRanks,
  stopKeywordCheck,
  trackKeywords,
  untrackKeyword,
} from '@/lib/growth/keywordWatch';
import { collapseChanges, andList, quoteList } from '@/lib/growth/listingChecks';
import { setListingChanges, upsertListingChanges, useListingDrafts } from '@/lib/growth/listingDrafts';
import { listingFieldEditable } from '@/lib/growth/listingFields';
import { byTerritory } from '@/lib/growth/metrics';
import { MAX_RIVALS, findRivals, localTerritory, startingCountries } from '@/lib/growth/rivals';
import { checkRivals, followRival, isRivalListDue, setYourApp } from '@/lib/growth/rivalWatch';
import { TERRITORY_CODES, listingLanguageFor, listingLanguageName, territoryName } from '@/lib/growth/territories';
import type { ListingLocale, ListingSnapshot, TimelineEvent } from '@/lib/growth/types';
import { useKeywords } from '@/lib/growth/useKeywords';
import { isAppleAdsConnected, useAppleAdsSetup } from '@/lib/growth/appleAds';
import { byBestChance, chanceOf, competitionOf, everyCountShown, latestPoint, periodWords, popularityTrend, tierWords, type Chance, type Competition, type KeywordPopularity } from '@/lib/growth/popularity';
import { refreshPopularity, usePopularity } from '@/lib/growth/popularityWatch';
import { isTauri, saveBlobToDisk } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { AppleAdsDialog, PopularityPrompt } from './GrowthAppleAds';
import { AppFinder, AppIcon, Shot, Toggle } from './GrowthCompetitors';
import { KeywordMap, PopularityCell, PopularityChart, PopularityMeter, PopularityTrendChip } from './GrowthPopularity';
import { appColor } from './GrowthRatingCharts';
import { EmptyState, Gated, Panel, SectionTitle, useGrowthView } from './GrowthShared';

type Span = 'day' | 'week' | 'month';
type Filter = 'all' | 'top10' | 'moved' | 'unfound' | 'missing';
type Sort = 'rank' | 'term' | 'change' | 'popularity';
type DetailView = 'ranks' | 'popularity' | 'results';
type IdeaTab = 'top-apps' | 'store-page' | 'competitors' | 'ai';
type TableView = 'list' | 'map';

/** Days of ranks the chart draws. */
const CHART_DAYS = 90;
const SPARK_DAYS = 30;

/** One tracked keyword in the country on show. */
interface Row {
  term: string;
  series: KeywordDay[];
  standing: KeywordStanding;
  search?: KeywordSearch;
  /** Null when Growth has no store page to check against. */
  coverage: ReturnType<typeof coverageOf> | null;
  /** Apple Ads' scores, when Apple Ads is connected and was asked. */
  popularity?: KeywordPopularity;
  /** How strong the first ten of the newest search are. Null before the first check. */
  competition: Competition | null;
}

/** The latest score, for sorting: a keyword with no score goes last. */
function scoreOf(row: Pick<Row, 'popularity'>): number {
  return latestPoint(row.popularity)?.score ?? -1;
}

/** An app followed on Competitors, as the screens name it. */
interface Followed {
  id: string;
  name: string;
  iconUrl: string | null;
}

/** The reading a move compares with, for its date. */
function baseOf(standing: KeywordStanding, span: Span): KeywordDay | undefined {
  return span === 'day' ? standing.previous : span === 'week' ? standing.weekAgo : standing.monthAgo;
}

function moveOf(standing: KeywordStanding, span: Span): RankMove {
  return span === 'day' ? standing.dayMove : span === 'week' ? standing.weekMove : standing.monthMove;
}

/** Higher is better, for sorting by change: a found keyword first, a lost one last. */
function moveScore(move: RankMove): number {
  if (move.kind === 'found') return 1000;
  if (move.kind === 'lost') return -1000;
  if (move.kind === 'up') return move.places;
  if (move.kind === 'down') return -move.places;
  return 0;
}

function isMoved(move: RankMove): boolean {
  return move.kind === 'up' || move.kind === 'down' || move.kind === 'found' || move.kind === 'lost';
}

export function GrowthKeywords() {
  const view = useGrowthView();
  const play = view.store === 'playstore';
  // The list belongs to the app Growth shows, or to no app, as Competitors' does.
  const owner = view.rivalOwner;
  const ownerKnown = view.rivals.loaded;
  const keywords = useKeywords(!play && ownerKnown ? owner : null);
  const { list, appId, history, searches, checking } = keywords;
  const terms = useMemo(() => list?.keywords.map((keyword) => keyword.term) ?? [], [list]);

  const busiest = useMemo(
    () =>
      byTerritory(view.byDate, view.window)
        .sort((a, b) => b.totals.downloads - a.totals.downloads)
        .slice(0, 3)
        .map((row) => row.key),
    [view.byDate, view.window]
  );
  const starting = useMemo(
    () => startingKeywordCountries([...busiest, view.rivals.list?.countries[0], localTerritory()], TERRITORY_CODES),
    [busiest, view.rivals.list]
  );
  const countries = list?.countries.length ? list.countries : starting;
  const [country, setCountry] = useState<string>(() => view.tabOptions.territory ?? countries[0] ?? 'US');
  useEffect(() => {
    if (!countries.includes(country)) setCountry(countries[0] ?? 'US');
  }, [countries, country]);

  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [span, setSpan] = useState<Span>('day');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('rank');
  const [selected, setSelected] = useState<string | null>(view.tabOptions.keyword ?? null);

  // The store page shoppers in this country read, when Growth has the app's store page.
  const listing: ListingSnapshot | null = view.data.listing && view.data.listing.appId === appId ? view.data.listing : null;
  const localeCode = listing ? listingLocaleFor(country, listing) : null;
  const pageLocale = listing ? listing.locales.find((entry) => entry.locale === localeCode) ?? null : null;

  const followed: Followed[] = useMemo(
    () =>
      (view.rivals.list?.rivals ?? [])
        .filter((rival) => isAppStoreId(rival.id))
        .map((rival) => {
          const seen = view.rivals.snapshots.get(rival.id)?.countries[country];
          return { id: rival.id, name: seen?.name || rival.name, iconUrl: seen?.iconUrl ?? rival.iconUrl };
        }),
    [view.rivals.list, view.rivals.snapshots, country]
  );

  const ownName = view.app.id ? view.app.name : view.rivals.list?.yourApp?.name ?? 'Your app';
  // The app's own rating count in this country, one rule everywhere (the map's line, the table, the ideas, Search
  // results): the count a search shows for the app when it lists it, else the count from the first tracked search
  // that lists the app (ownCount), else Growth's own count. A stored count can be days older than a search.
  const ownCount = useMemo(() => {
    if (!appId) return null;
    for (const term of terms) {
      const count = searches.get(`${country}|${term}`)?.top.find((app) => app.id === appId)?.ratingCount;
      if (typeof count === 'number') return count;
    }
    const fromGrowth = view.data.ratings.find((rating) => rating.territory === country)?.count;
    if (typeof fromGrowth === 'number') return fromGrowth;
    return view.rivals.snapshots.get(appId)?.countries[country]?.ratingCount ?? null;
  }, [appId, terms, searches, country, view.data.ratings, view.rivals.snapshots]);
  const ownFor = useCallback(
    (search?: KeywordSearch): number | null => {
      if (!appId) return null;
      const fromSearch = search?.top.find((app) => app.id === appId)?.ratingCount;
      return typeof fromSearch === 'number' ? fromSearch : ownCount;
    },
    [appId, ownCount]
  );

  // Popularity, with Apple Ads connected in the desktop app.
  const adsSetup = useAppleAdsSetup();
  const popularityOn = isAppleAdsConnected(adsSetup);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isTauri()), []);
  const popularity = usePopularity(popularityOn ? countries : [], terms);

  const day = today();
  const rows: Row[] = useMemo(() => {
    const here = history.get(country);
    return terms.map((term) => {
      const series = here?.get(term) ?? [];
      const search = searches.get(`${country}|${term}`);
      return {
        term,
        series,
        standing: standingOf(series, day),
        search,
        coverage: pageLocale ? coverageOf(term, pageLocale) : null,
        popularity: popularity.records.get(`${country}|${term}`),
        competition: search && appId ? competitionOf(search, appId, ownFor(search)) : null,
      };
    });
  }, [terms, history, searches, country, pageLocale, day, popularity.records, appId, ownFor]);

  const visible = useMemo(() => {
    const kept = rows.filter((row) => {
      const rank = row.standing.latest?.rank;
      if (filter === 'top10') return typeof rank === 'number' && rank <= 10;
      if (filter === 'moved') return isMoved(moveOf(row.standing, span));
      if (filter === 'unfound') return rank === null;
      if (filter === 'missing') return !!row.coverage && row.coverage.missing.length > 0;
      return true;
    });
    const rankKey = (row: Row) => (row.standing.latest ? row.standing.latest.rank ?? 10_000 : 20_000);
    return kept.sort((a, b) => {
      if (sort === 'term') return a.term.localeCompare(b.term);
      if (sort === 'change') return moveScore(moveOf(b.standing, span)) - moveScore(moveOf(a.standing, span)) || rankKey(a) - rankKey(b);
      if (sort === 'popularity' && popularityOn) return scoreOf(b) - scoreOf(a) || rankKey(a) - rankKey(b) || a.term.localeCompare(b.term);
      return rankKey(a) - rankKey(b) || a.term.localeCompare(b.term);
    });
  }, [rows, filter, sort, span, popularityOn]);

  // The keyword the detail shows: the one picked, or the first in the table.
  const current = rows.find((row) => row.term === selected) ?? visible[0] ?? rows[0] ?? null;
  const [tableView, setTableView] = useState<TableView>('list');
  const [adsOpen, setAdsOpen] = useState(false);

  // Scores older than a day are asked for again when the screen shows, the
  // country on screen first. One request per country covers every keyword.
  // The refresh waits for one the ideas started, never skips it, and a new
  // key or ad account asks again.
  const termsKey = terms.join('\n');
  const countriesKey = [country, ...countries.filter((code) => code !== country)].join(',');
  const adsId = popularityOn ? `${adsSetup.key?.clientId}|${adsSetup.key?.keyId}|${adsSetup.account?.id}` : '';
  useEffect(() => {
    if (!view.active || !adsId || !desktop || !termsKey) return;
    void refreshPopularity({ countries: countriesKey.split(','), terms: termsKey.split('\n'), wait: true }).catch((error) =>
      console.error('Refreshing keyword popularity failed', error)
    );
  }, [view.active, adsId, desktop, termsKey, countriesKey]);

  // Today's ranks are filled in when the screen shows, as the background pass would.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!view.active || !keywords.loaded || !appId || !list || autoChecked.current) return;
    autoChecked.current = true;
    if (!isKeywordListWaiting(list)) return;
    void checkKeywords(owner, { first: country }).catch((error) => console.error('The keywords check failed', error));
  }, [view.active, keywords.loaded, appId, list, owner, country]);

  const full = terms.length >= MAX_KEYWORDS;
  const fullReason = full ? `You can track ${MAX_KEYWORDS} keywords. Stop tracking one first` : null;

  const track = useCallback(
    async (input: string[], source: KeywordSource) => {
      setNote(null);
      const result = await trackKeywords(owner, input, { source, countries });
      if (result.added.length > 0) {
        const what = result.added.length <= 3 ? quoteList(result.added) : `${result.added.length} keywords`;
        const refused = result.refused > 0 ? `. ${result.refused} more didn't fit: you can track ${MAX_KEYWORDS} keywords` : '';
        const tracking = { tone: 'ok' as const, text: `Now tracking ${what}${refused}` };
        setNote(tracking);
        void checkKeywords(owner, { only: { terms: result.added }, first: country, wait: true })
          // The ranks are on screen now; a note about the refused ones stays.
          .then(() => setNote((current) => (current === tracking && !refused ? null : current)))
          .catch((error) => {
            console.error('Checking the new keywords failed', error);
            setNote({ tone: 'error', text: 'The App Store search could not be reached. Growth tries again later' });
          });
      } else if (result.refused > 0) {
        setNote({ tone: 'error', text: `You can track ${MAX_KEYWORDS} keywords. Stop tracking one first` });
      } else {
        setNote({ tone: 'ok', text: 'You track those keywords already' });
      }
      return result.added;
    },
    [owner, countries, country]
  );

  const checkNow = () => {
    setNote(null);
    if (popularityOn && desktop) {
      void refreshPopularity({ countries: countriesKey.split(','), terms, wait: true, retryRefused: true }).catch((error) => console.error('Refreshing keyword popularity failed', error));
    }
    void checkKeywords(owner, { first: country, again: true, wait: true })
      .then((result) => {
        if (result.failed > 0) setNote({ tone: 'error', text: `The App Store didn't answer ${result.failed} ${result.failed === 1 ? 'search' : 'searches'}. Growth tries again in an hour` });
      })
      .catch((error) => {
        if ((error as Error)?.name === 'AbortError') return;
        console.error('The keywords check failed', error);
        setNote({ tone: 'error', text: 'The App Store search could not be reached. Check your connection and try again' });
      });
  };

  if (play) {
    return (
      <div data-testid="growth-keywords">
        <EmptyState icon={SearchIcon} title="Keywords works for App Store apps">
          Google Play&apos;s published rules ask programs not to search Google Play, so Growth doesn&apos;t check where your app shows up there.
          {view.apps.some((app) => isAppStoreId(app.id)) ? ' Pick your App Store app at the top to see its keywords.' : ''}
        </EmptyState>
      </div>
    );
  }

  if (!ownerKnown || !keywords.loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="growth-keywords">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading your keywords
      </p>
    );
  }

  if (!appId) {
    return (
      <div className="mx-auto max-w-xl space-y-4" data-testid="growth-keywords">
        <KeywordsTitle appName={null} />
        <Panel data-testid="growth-keyword-your-app">
          <SectionTitle title="Which app is yours?" hint="Find your app on the App Store to see where it shows up in search" />
          <AppFinder
            territory={country}
            label="Find your app"
            actionLabel="This is my app"
            takenReason={(candidate) => (isAppStoreId(candidate.id) ? null : 'Keywords works for App Store apps')}
            onPick={async (candidate) => {
              await setYourApp('', candidate, view.rivals.list?.countries.length ? view.rivals.list.countries : startingCountries([localTerritory()]));
            }}
          />
        </Panel>
      </div>
    );
  }

  const checkedLine = checking
    ? `Checking ${checking.done} of ${checking.total} ${checking.total === 1 ? 'search' : 'searches'}`
    : list?.checkedAt
      ? `Checked ${formatAgo(list.checkedAt)}`
      : terms.length > 0
        ? 'Not checked yet'
        : null;

  return (
    <div className="space-y-4" data-testid="growth-keywords">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <KeywordsTitle appName={ownName} />
        <div className="flex flex-wrap items-center gap-2">
          {checkedLine && (
            <span className="text-xs text-muted-foreground" role="status">
              {checkedLine}
            </span>
          )}
          {checking ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => stopKeywordCheck(owner)} title="Stop checking and keep the ranks found so far">
              <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Gated reason={terms.length === 0 ? 'Track a keyword first' : null}>
              <Button variant="outline" size="sm" className="h-8" onClick={checkNow} title="Search the App Store for every keyword in every country now">
                <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
                Check now
              </Button>
            </Gated>
          )}
        </div>
      </div>

      {checking && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-[hsl(var(--growth-series))] transition-[width]"
            style={{ width: `${checking.total > 0 ? Math.max(4, Math.round((checking.done / checking.total) * 100)) : 4}%` }}
          />
        </div>
      )}

      <CountryTabs countries={countries} value={country} onChange={setCountry} />

      {note && (
        <p className={cn('text-xs', note.tone === 'error' ? 'text-destructive' : 'text-[hsl(var(--growth-good))]')} role="status">
          {note.text}
        </p>
      )}
      {list?.trouble && !checking && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          The App Store didn&apos;t answer {list.trouble.searches} {list.trouble.searches === 1 ? 'search' : 'searches'} in the last check. Growth tries again
          about an hour after that check.
        </p>
      )}

      {terms.length === 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <StartPanel
            pageLocale={pageLocale}
            locale={pageLocale?.locale ?? listingLanguageFor(country)}
            appName={ownName}
            countryName={territoryName(country)}
            onTrack={(input, source) => void track(input, source)}
          />
          <CountriesPanel owner={owner} countries={countries} starting={starting} />
        </div>
      ) : (
        <>
          <Summary rows={rows} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-4">
              <Panel className="space-y-3 p-0" data-testid="growth-keyword-table">
                <div className="space-y-3 px-4 pt-4">
                  <AddKeywords count={terms.length} blocked={fullReason} onTrack={(input) => track(input, 'typed')} />
                  {tableView === 'list' && <PopularityPrompt onConnect={() => setAdsOpen(true)} />}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Filters rows={rows} span={span} value={filter} onChange={setFilter} withPage={!!pageLocale} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Toggle
                        label="Show as"
                        value={tableView}
                        options={[
                          ['list', 'List'],
                          ['map', 'Map'],
                        ]}
                        onChange={setTableView}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        title="Save the ranks of the last 90 days, in every country, as a spreadsheet file"
                        onClick={() =>
                          void saveBlobToDisk(new Blob([keywordsCsv(history, terms, countries)], { type: 'text/csv;charset=utf-8' }), `${ownName} keywords ${day}.csv`).catch(
                            (error) => console.error('Saving the keywords failed', error)
                          )
                        }
                      >
                        <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
                        Export CSV
                      </Button>
                      {tableView === 'list' && (
                        <Toggle
                          label="Change over"
                          value={span}
                          options={[
                            ['day', 'Day'],
                            ['week', 'Week'],
                            ['month', 'Month'],
                          ]}
                          onChange={setSpan}
                        />
                      )}
                    </div>
                  </div>
                </div>
                {tableView === 'list' ? (
                  <KeywordTable
                    rows={visible}
                    span={span}
                    sort={sort}
                    onSort={setSort}
                    selected={current?.term ?? null}
                    onSelect={setSelected}
                    appId={appId}
                    followed={followed}
                    withPage={!!pageLocale}
                    country={country}
                    popularity={popularityOn ? { refreshing: popularity.refreshing } : null}
                  />
                ) : popularityOn ? (
                  <KeywordMap
                    keywords={visible.map((row) => ({ term: row.term, rank: row.standing.latest?.rank, record: row.popularity, competition: row.competition }))}
                    ownRatings={ownCount}
                    appName={ownName}
                    country={country}
                    selected={current?.term ?? null}
                    onSelect={setSelected}
                    refreshing={popularity.refreshing}
                  />
                ) : (
                  <PopularityPrompt always onConnect={() => setAdsOpen(true)} />
                )}
                {popularityOn && popularity.status.get(country) && (
                  <p className="px-4 pb-3 text-xs text-amber-700 dark:text-amber-300" role="status">
                    Popularity for {territoryName(country)}: {popularity.status.get(country)!.text}
                  </p>
                )}
              </Panel>
              <IdeasPanel
                owner={owner}
                appId={appId}
                appName={ownName}
                country={country}
                rows={rows}
                listing={listing}
                pageLocale={pageLocale}
                followed={followed}
                ownRatings={ownFor}
                blocked={fullReason}
                popularityOn={popularityOn && desktop}
                onTrack={(term, source) => {
                  void track([term], source).then((added) => {
                    if (added.length > 0 && source === 'ai') dropKeywordIdea(owner, country, term);
                  });
                }}
              />
            </div>
            <div className="space-y-4">
              {current && (
                <KeywordDetail
                  key={`${current.term}|${country}`}
                  row={current}
                  owner={owner}
                  appId={appId}
                  appName={ownName}
                  country={country}
                  followed={followed}
                  listing={listing}
                  pageLocale={pageLocale}
                  ownRatings={ownFor(current.search)}
                  popularityOn={popularityOn}
                  onStop={() => {
                    void untrackKeyword(owner, current.term);
                    setSelected(null);
                    setNote({ tone: 'ok', text: `Stopped tracking "${current.term}"` });
                  }}
                />
              )}
              <CountriesPanel owner={owner} countries={countries} starting={starting} />
            </div>
          </div>
        </>
      )}
      <AppleAdsDialog open={adsOpen} onOpenChange={setAdsOpen} />
    </div>
  );
}

function KeywordsTitle({ appName }: { appName: string | null }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <h2 className="text-base font-semibold">Keywords</h2>
        <InfoTip label="How Growth finds your rank">
          <p>Growth searches the App Store for each keyword in each country once a day, while the main window of Open Screenshot Generator is open.</p>
          <p>
            Growth reads Apple&apos;s public App Store search, not the App Store app on an iPhone, which can order apps differently. Ads aren&apos;t counted.
          </p>
          <p>
            Compared with the App Store website&apos;s search in November 2026, the first app was the same in all 18 searches compared. Of the first 10 apps
            in each, most were at the same place or one or two places off, and one was 30 places off.
          </p>
          <p>Apple can answer with a copy from up to a day earlier, so a change can show up a day late.</p>
          <p>Google Play&apos;s published rules ask programs not to search Google Play, so Keywords is for App Store apps.</p>
        </InfoTip>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {appName ? `Where ${appName} shows up when people search the App Store on an iPhone` : 'Where your app shows up when people search the App Store'}
      </p>
    </div>
  );
}

function CountryTabs({ countries, value, onChange }: { countries: string[]; value: string; onChange: (code: string) => void }) {
  if (countries.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Country">
      {countries.map((code) => (
        <button
          key={code}
          type="button"
          role="tab"
          aria-selected={code === value}
          onClick={() => onChange(code)}
          className={cn('rounded-full border px-3 py-1 text-xs', code === value ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
        >
          {territoryName(code)}
        </button>
      ))}
    </div>
  );
}

// --- ranks, small ----------------------------------------------------------------------

const BUCKET_STYLE: Record<Exclude<RankBucket, 'none'>, string> = {
  top3: 'bg-[hsl(var(--growth-good))]/15 text-[hsl(var(--growth-good))] ring-1 ring-inset ring-[hsl(var(--growth-good))]/35',
  top10: 'bg-[hsl(var(--growth-good))]/10 text-[hsl(var(--growth-good))]',
  top50: 'bg-[hsl(var(--growth-series))]/10 text-[hsl(var(--growth-series))]',
  lower: 'bg-muted text-muted-foreground',
};

/** A rank as a small badge: green in the top 10, blue to 50, grey below, a dashed box when the app was not found. */
export function RankPill({ day, large = false }: { day?: Pick<KeywordDay, 'rank' | 'total'> | null; large?: boolean }) {
  const size = large ? 'h-9 min-w-[3rem] px-2 text-lg' : 'h-6 min-w-[2.25rem] px-1.5 text-xs';
  if (!day) {
    return (
      <span className={cn('inline-flex items-center justify-center rounded-md text-muted-foreground', size, !large && 'text-[11px]')} title="Growth hasn't checked this keyword yet">
        Waiting
      </span>
    );
  }
  if (day.rank === null) {
    return (
      <span
        className={cn('inline-flex items-center justify-center whitespace-nowrap rounded-md border border-dashed text-muted-foreground', size, !large && 'text-[11px]', large && 'text-sm')}
        title={`Not among the ${formatExact(day.total)} apps Apple's search lists`}
      >
        Not found
      </span>
    );
  }
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-md font-semibold tabular-nums', size, BUCKET_STYLE[bucketOf(day.rank) as Exclude<RankBucket, 'none'>])}
      title={`Rank ${day.rank} of ${formatExact(day.total)} apps`}
    >
      <span className="sr-only">Rank </span>
      {day.rank}
    </span>
  );
}

/** A rank as a few coloured characters, for chips inside a line of text. */
export function RankText({ day }: { day?: Pick<KeywordDay, 'rank' | 'total'> | null }) {
  if (!day) return <span className="text-muted-foreground" title="Growth hasn't checked this keyword yet">waiting</span>;
  if (day.rank === null) {
    return (
      <span className="text-muted-foreground" title={`Not among the ${formatExact(day.total)} apps Apple's search lists`}>
        not found
      </span>
    );
  }
  return (
    <span className={cn('rounded px-1 font-semibold tabular-nums', BUCKET_STYLE[bucketOf(day.rank) as Exclude<RankBucket, 'none'>])} title={`Rank ${day.rank} of ${formatExact(day.total)} apps`}>
      <span className="sr-only">rank </span>
      {day.rank}
    </span>
  );
}

/**
 * How a rank moved, and since which check: `since` is the day of the reading
 * it compares with, which the title and screen readers name, so a comparison
 * never hides how old its starting point is.
 */
function MoveChip({ move, since, className }: { move: RankMove; since?: string; className?: string }) {
  const base = cn('inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium tabular-nums', className);
  const when = since ? ` since ${formatDay(since, { withYear: false })}` : '';
  const places = `${move.places} ${move.places === 1 ? 'place' : 'places'}`;
  if (move.kind === 'up' || move.kind === 'found') {
    const words = move.kind === 'found' ? `Found${when}, not found before` : `Up ${places}${when}`;
    return (
      <span className={cn(base, 'text-[hsl(var(--growth-good))]')} title={words}>
        <ArrowUpIcon className="h-3 w-3" aria-hidden />
        <span aria-hidden>{move.kind === 'found' ? 'Found' : move.places}</span>
        <span className="sr-only">{words}</span>
      </span>
    );
  }
  if (move.kind === 'down' || move.kind === 'lost') {
    const words = move.kind === 'lost' ? `Not found${when}, found before` : `Down ${places}${when}`;
    return (
      <span className={cn(base, 'text-[hsl(var(--growth-bad))]')} title={words}>
        <ArrowDownIcon className="h-3 w-3" aria-hidden />
        <span aria-hidden>{move.kind === 'lost' ? 'Lost' : move.places}</span>
        <span className="sr-only">{words}</span>
      </span>
    );
  }
  if (move.kind === 'same') {
    return (
      <span className={cn(base, 'text-muted-foreground')} title={`No change${when}`}>
        <MinusIcon className="h-3 w-3" aria-hidden />
        <span className="sr-only">No change{when}</span>
      </span>
    );
  }
  return <span className="sr-only">No check to compare with</span>;
}

/**
 * The rank over the last days as a small line: up is better. A check that did
 * not find the app breaks the line; a day without a check is skipped, since
 * Growth checks only while the app is open and a missing day says nothing.
 */
function RankSpark({ series, className }: { series: KeywordDay[]; className?: string }) {
  const from = addDays(today(), -(SPARK_DAYS - 1));
  const readings = series.filter((row) => row.date >= from);
  const found = readings.filter((row): row is KeywordDay & { rank: number } => typeof row.rank === 'number');
  // One reading is not a line yet.
  if (found.length < 2) return <div className={cn('h-6 w-24', className)} aria-hidden />;
  const best = Math.min(...found.map((row) => row.rank));
  const worst = Math.max(...found.map((row) => row.rank));
  const spread = worst - best || 1;
  const step = 100 / Math.max(1, SPARK_DAYS - 1);
  const x = (date: string) => daysBetween(from, date) * step;
  const y = (rank: number) => 3 + ((rank - best) / spread) * 18;
  let path = '';
  let open = false;
  const dots: Array<{ x: number; y: number }> = [];
  readings.forEach((row, index) => {
    if (typeof row.rank !== 'number') {
      open = false;
      return;
    }
    path += `${open ? 'L' : 'M'}${x(row.date).toFixed(2)},${y(row.rank).toFixed(2)}`;
    open = true;
    // A reading with no found neighbour draws as a dot: a line needs two.
    if (typeof readings[index - 1]?.rank !== 'number' && typeof readings[index + 1]?.rank !== 'number') dots.push({ x: x(row.date), y: y(row.rank) });
  });
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn('h-6 w-24', className)} aria-hidden>
      <path d={path} fill="none" stroke="hsl(var(--growth-series))" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {dots.map((dot, index) => (
        <circle key={index} cx={dot.x} cy={dot.y} r={1.6} fill="hsl(var(--growth-series))" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

// --- the summary -----------------------------------------------------------------------

const SEGMENTS: Array<{ id: RankBucket | 'unchecked'; label: string; color: string }> = [
  { id: 'top10', label: '1 to 10', color: 'hsl(var(--growth-good))' },
  { id: 'top50', label: '11 to 50', color: 'hsl(var(--growth-series))' },
  { id: 'lower', label: '51 and lower', color: 'hsl(var(--growth-compare))' },
  { id: 'none', label: 'Not found', color: 'hsl(var(--muted-foreground) / 0.25)' },
  { id: 'unchecked', label: 'Not checked yet', color: 'hsl(var(--muted))' },
];

function segmentOf(day?: KeywordDay): RankBucket | 'unchecked' {
  if (!day) return 'unchecked';
  const bucket = bucketOf(day.rank);
  return bucket === 'top3' ? 'top10' : bucket;
}

function Summary({ rows }: { rows: Row[] }) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(segmentOf(row.standing.latest), (counts.get(segmentOf(row.standing.latest)) ?? 0) + 1);
  const ranked = (rank: number | null | undefined, limit: number) => typeof rank === 'number' && rank <= limit;
  const tiles = [
    { label: 'In the top 10', now: rows.filter((row) => ranked(row.standing.latest?.rank, 10)).length, before: (row: Row) => ranked(row.standing.weekAgo?.rank, 10) },
    { label: 'In the top 50', now: rows.filter((row) => ranked(row.standing.latest?.rank, 50)).length, before: (row: Row) => ranked(row.standing.weekAgo?.rank, 50) },
    { label: 'Found in search', now: rows.filter((row) => typeof row.standing.latest?.rank === 'number').length, before: (row: Row) => typeof row.standing.weekAgo?.rank === 'number' },
  ];
  // A week back is only compared when every keyword has a reading from then.
  const weekKnown = rows.length > 0 && rows.every((row) => !!row.standing.weekAgo);
  const total = rows.length;
  return (
    <Panel className="space-y-3" data-testid="growth-keyword-summary">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => {
          const before = rows.filter(tile.before).length;
          const change = tile.now - before;
          return (
            <div key={tile.label} className="min-w-0">
              <p className="text-xs text-muted-foreground">{tile.label}</p>
              <p className="text-2xl font-semibold tabular-nums leading-tight">{tile.now}</p>
              <p className={cn('text-[11px]', !weekKnown || change === 0 ? 'text-muted-foreground' : change > 0 ? 'text-[hsl(var(--growth-good))]' : 'text-[hsl(var(--growth-bad))]')}>
                {!weekKnown ? `of ${total} keywords` : change === 0 ? 'Same as a week ago' : `${Math.abs(change)} ${change > 0 ? 'more' : 'fewer'} than a week ago`}
              </p>
            </div>
          );
        })}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Not found</p>
          <p className="text-2xl font-semibold tabular-nums leading-tight">{counts.get('none') ?? 0}</p>
          <p className="text-[11px] text-muted-foreground">not in the search results</p>
        </div>
      </div>
      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={SEGMENTS.map((segment) => `${segment.label}: ${counts.get(segment.id) ?? 0}`).join(', ')}>
          {SEGMENTS.map((segment) => {
            const count = counts.get(segment.id) ?? 0;
            if (count === 0) return null;
            return <span key={segment.id} style={{ width: `${(count / Math.max(1, total)) * 100}%`, background: segment.color }} className="h-full first:rounded-l-full last:rounded-r-full" />;
          })}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {SEGMENTS.filter((segment) => (counts.get(segment.id) ?? 0) > 0).map((segment) => (
            <li key={segment.id} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: segment.color }} />
              {segment.label}
              <span className="tabular-nums text-foreground">{counts.get(segment.id)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

// --- adding and filtering ---------------------------------------------------------------

function AddKeywords({ count, blocked, onTrack }: { count: number; blocked: string | null; onTrack: (input: string[]) => Promise<string[]> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = () => {
    const input = parseKeywordInput(value);
    if (input.length === 0 || busy) return;
    setBusy(true);
    void onTrack(input)
      .then(() => setValue(''))
      .finally(() => setBusy(false));
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="relative min-w-[200px] flex-1">
        <PlusIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Add keywords, separated by commas"
          aria-label="Keywords to track"
          className="h-9 pl-8 text-sm"
          disabled={!!blocked}
        />
      </div>
      <Gated reason={blocked}>
        <Button type="submit" size="sm" className="h-9" disabled={busy || parseKeywordInput(value).length === 0}>
          {busy ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlusIcon className="mr-1.5 h-3.5 w-3.5" />}
          Track
        </Button>
      </Gated>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {count} of {MAX_KEYWORDS}
      </span>
    </form>
  );
}

function Filters({ rows, span, value, onChange, withPage }: { rows: Row[]; span: Span; value: Filter; onChange: (filter: Filter) => void; withPage: boolean }) {
  const options: Array<{ id: Filter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: rows.length },
    { id: 'top10', label: 'Top 10', count: rows.filter((row) => typeof row.standing.latest?.rank === 'number' && row.standing.latest.rank <= 10).length },
    { id: 'moved', label: 'Moved', count: rows.filter((row) => isMoved(moveOf(row.standing, span))).length },
    { id: 'unfound', label: 'Not found', count: rows.filter((row) => row.standing.latest?.rank === null).length },
    ...(withPage ? [{ id: 'missing' as const, label: 'Not on your store page', count: rows.filter((row) => !!row.coverage && row.coverage.missing.length > 0).length }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
            value === option.id ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {option.label}
          <span className={cn('tabular-nums', value === option.id ? 'opacity-80' : 'text-foreground')}>{option.count}</span>
        </button>
      ))}
    </div>
  );
}

// --- the table ---------------------------------------------------------------------------

function KeywordTable({
  rows,
  span,
  sort,
  onSort,
  selected,
  onSelect,
  appId,
  followed,
  withPage,
  country,
  popularity,
}: {
  rows: Row[];
  span: Span;
  sort: Sort;
  onSort: (sort: Sort) => void;
  selected: string | null;
  onSelect: (term: string) => void;
  appId: string;
  followed: Followed[];
  withPage: boolean;
  country: string;
  /** Null hides the column: Apple Ads is not connected. */
  popularity: { refreshing: boolean } | null;
}) {
  const header = (id: Sort, label: string, className?: string, tip?: React.ReactNode) => (
    <th
      scope="col"
      className={cn('px-3 py-2 text-left text-[11px] font-medium text-muted-foreground', className)}
      aria-sort={sort === id ? (id === 'change' || id === 'popularity' ? 'descending' : 'ascending') : undefined}
    >
      <span className="inline-flex items-center gap-0.5">
        <button type="button" onClick={() => onSort(id)} className={cn('inline-flex items-center gap-1 hover:text-foreground', sort === id && 'text-foreground')}>
          {label}
          {sort === id && <ArrowDownIcon className="h-3 w-3" aria-hidden />}
        </button>
        {tip}
      </span>
    </th>
  );
  if (rows.length === 0) {
    return <p className="px-4 pb-4 text-xs text-muted-foreground">No keywords match this filter</p>;
  }
  return (
    <div className="overflow-x-auto pb-1">
      <table className="w-full border-collapse text-sm">
        <thead className="border-y bg-muted/40">
          <tr>
            {header('term', 'Keyword', 'pl-4')}
            {header('rank', 'Rank')}
            {header('change', 'Change')}
            {popularity &&
              header(
                'popularity',
                'Popularity',
                undefined,
                <InfoTip label="About popularity">
                  <p>
                    Popularity comes from Apple Ads. Each keyword gets a score from 1 to 100 in each country, and 100 is the word people search most in that country. The
                    score compares words with each other. It isn&apos;t a number of searches.
                  </p>
                  <p>
                    Apple Ads gives a new score each week, Sunday to Saturday. Apple Ads only lists words with at least 500 searches that week, so people may still search a
                    keyword with no score.
                  </p>
                </InfoTip>
              )}
            <th scope="col" className="hidden px-3 py-2 text-left text-[11px] font-medium text-muted-foreground sm:table-cell">
              Last 30 days
            </th>
            <th scope="col" className="hidden px-3 py-2 text-left text-[11px] font-medium text-muted-foreground lg:table-cell">
              First in search
            </th>
            {followed.length > 0 && (
              <th scope="col" className="hidden px-3 py-2 text-left text-[11px] font-medium text-muted-foreground md:table-cell">
                Competitors
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const first = row.search?.top[0];
            // An app the latest search was not read for (followed since) is not
            // checked yet, which is not the same as not found.
            const latestRivals = row.standing.latest?.rivals ?? {};
            const checked = followed.filter((app) => app.id in latestRivals);
            const rivals = checked
              .map((app) => ({ app, rank: latestRivals[app.id] }))
              .filter((entry): entry is { app: Followed; rank: number } => typeof entry.rank === 'number')
              .sort((a, b) => a.rank - b.rank);
            const isSelected = row.term === selected;
            return (
              <tr
                key={row.term}
                data-keyword={row.term}
                onClick={() => onSelect(row.term)}
                className={cn('cursor-pointer border-b last:border-b-0', isSelected ? 'bg-[hsl(var(--growth-series))]/10' : 'hover:bg-muted/60')}
              >
                <td className="max-w-[260px] py-2 pl-4 pr-3">
                  <button type="button" className="block max-w-full break-words text-left font-medium hover:underline" onClick={() => onSelect(row.term)} aria-current={isSelected ? 'true' : undefined}>
                    {row.term}
                  </button>
                  {withPage && row.coverage && (
                    <span className={cn('block text-[11px]', row.coverage.missing.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
                      {row.coverage.missing.length > 0 ? 'Not on your store page' : `In your ${andList(row.coverage.fields.map(fieldWord))}`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <RankPill day={row.standing.latest} />
                  {row.standing.stale && row.standing.latest && <span className="ml-1.5 text-[10px] text-muted-foreground">{formatDay(row.standing.latest.date)}</span>}
                </td>
                <td className="px-3 py-2">
                  <MoveChip move={moveOf(row.standing, span)} since={baseOf(row.standing, span)?.date} />
                </td>
                {popularity && (
                  <td className="px-3 py-2" data-popularity-cell>
                    <PopularityCell record={row.popularity} term={row.term} country={country} refreshing={popularity.refreshing} />
                  </td>
                )}
                <td className="hidden px-3 py-2 sm:table-cell">
                  <RankSpark series={row.series} />
                </td>
                <td className="hidden max-w-[220px] px-3 py-2 lg:table-cell">
                  {first ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <AppIcon url={first.iconUrl} className="h-6 w-6 rounded-md" />
                      <span className="min-w-0 break-words text-xs">{first.id === appId ? 'Your app' : first.name}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Waiting</span>
                  )}
                </td>
                {followed.length > 0 && (
                  <td className="hidden px-3 py-2 md:table-cell">
                    {!row.standing.latest || checked.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">Waiting</span>
                    ) : rivals.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">Not found</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {rivals.slice(0, 3).map((entry) => (
                          <span key={entry.app.id} className="inline-flex items-center gap-0.5" title={`${entry.app.name}: rank ${entry.rank}`}>
                            <AppIcon url={entry.app.iconUrl} className="h-5 w-5 rounded-md" />
                            <span className="text-[11px] tabular-nums text-muted-foreground">{entry.rank}</span>
                          </span>
                        ))}
                        {rivals.length > 3 && <span className="text-[11px] text-muted-foreground">+{rivals.length - 3}</span>}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fieldWord(field: string): string {
  return field === 'name' ? 'name' : field === 'subtitle' ? 'subtitle' : 'keywords';
}

// --- one keyword ---------------------------------------------------------------------------

function KeywordDetail({
  row,
  owner,
  appId,
  appName,
  country,
  followed,
  listing,
  pageLocale,
  ownRatings,
  popularityOn,
  onStop,
}: {
  row: Row;
  owner: string;
  appId: string;
  appName: string;
  country: string;
  followed: Followed[];
  listing: ListingSnapshot | null;
  pageLocale: ListingLocale | null;
  ownRatings: number | null;
  popularityOn: boolean;
  onStop: () => void;
}) {
  const view = useGrowthView();
  const [picked, setShow] = useState<DetailView>('ranks');
  const show: DetailView = picked === 'popularity' && !popularityOn ? 'ranks' : picked;
  const latest = row.standing.latest;
  // The comparisons there is a reading for, each with the day it compares with.
  const moves = [
    { label: 'Day', move: row.standing.dayMove, since: row.standing.previous?.date },
    { label: 'Week', move: row.standing.weekMove, since: row.standing.weekAgo?.date },
    { label: 'Month', move: row.standing.monthMove, since: row.standing.monthAgo?.date },
  ].filter((entry) => entry.move.kind !== 'unknown');
  return (
    <Panel className="space-y-4" data-testid="growth-keyword-detail" aria-label={`"${row.term}" in ${territoryName(country)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">&quot;{row.term}&quot;</p>
          <p className="text-xs text-muted-foreground">
            {territoryName(country)}
            {latest ? `, checked ${latest.date === today() ? 'today' : formatDay(latest.date, { withYear: false })}` : ', waiting for the first check'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <RankPill day={latest} large />
          {moves.length > 0 ? (
            <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {moves.map((entry) => (
                <span key={entry.label} className="inline-flex items-center gap-1">
                  {entry.label} <MoveChip move={entry.move} since={entry.since} />
                </span>
              ))}
            </span>
          ) : (
            latest && <span className="text-[11px] text-muted-foreground">{row.series.length === 1 ? 'First check' : 'No recent check to compare with'}</span>
          )}
        </div>
      </div>

      {popularityOn && <PopularityLine row={row} country={country} />}

      <Toggle
        label="Show"
        value={show}
        options={
          popularityOn
            ? [
                ['ranks', 'Rank over time'],
                ['popularity', 'Popularity'],
                ['results', 'Search results'],
              ]
            : [
                ['ranks', 'Rank over time'],
                ['results', 'Search results'],
              ]
        }
        onChange={setShow}
      />
      {show === 'ranks' ? (
        <RankChart row={row} appName={appName} followed={followed} events={view.data.events} />
      ) : show === 'popularity' ? (
        <PopularityChart record={row.popularity} term={row.term} country={country} />
      ) : (
        <SearchResults row={row} owner={owner} appId={appId} country={country} followed={followed} ownRatings={ownRatings} />
      )}

      <StorePageBlock row={row} country={country} listing={listing} pageLocale={pageLocale} />

      <div className="flex justify-end border-t pt-3">
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onStop} title="Stop tracking this keyword. Growth keeps its past ranks">
          <XIcon className="mr-1 h-3.5 w-3.5" />
          Stop tracking
        </Button>
      </div>
    </Panel>
  );
}

/** A keyword's popularity in one line: the score, its tier, how it moved in about a month, and its week. */
function PopularityLine({ row, country }: { row: Row; country: string }) {
  const point = latestPoint(row.popularity);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2" data-testid="growth-keyword-popularity">
      <span className="text-xs text-muted-foreground">Popularity</span>
      {!row.popularity ? (
        <span className="text-xs text-muted-foreground">Waiting for Apple Ads</span>
      ) : !point ? (
        <span className="text-xs text-muted-foreground">No score from Apple Ads in {territoryName(country)}</span>
      ) : (
        <>
          <PopularityMeter point={point} granularity={row.popularity.granularity} large />
          <span className="text-xs font-medium">{tierWords(point.tier)}</span>
          <PopularityTrendChip trend={popularityTrend(row.popularity.points)} granularity={row.popularity.granularity} />
          <span className="text-[11px] text-muted-foreground">{periodWords(point.week, row.popularity.granularity, { withYear: false })}</span>
        </>
      )}
    </div>
  );
}

const AXIS = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

/** The time of a day's start, for the chart's time axis. */
const timeOf = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** At most `count` of the values, spread evenly, the first and the last always in. */
function spread<T>(values: T[], count: number): T[] {
  if (values.length <= count) return values;
  const step = (values.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => values[Math.round(index * step)]);
}

/**
 * The rank day by day, with the apps followed beside it. One point per check:
 * a day without a check has no point, so the line runs across it, while a
 * check that did not find an app leaves a gap in that app's line.
 */
function RankChart({ row, appName, followed, events }: { row: Row; appName: string; followed: Followed[]; events: TimelineEvent[] }) {
  const from = addDays(today(), -(CHART_DAYS - 1));
  const readings = row.series.filter((entry) => entry.date >= from);
  if (readings.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">Ranks show here after the first check</p>;
  // The apps followed that this search lists on some day, best first, three at most.
  const rivals = followed
    .map((app) => {
      const ranks = readings.map((entry) => entry.rivals[app.id]).filter((rank): rank is number => typeof rank === 'number');
      return { app, best: ranks.length > 0 ? Math.min(...ranks) : null };
    })
    .filter((entry) => entry.best !== null)
    .sort((a, b) => (a.best ?? 0) - (b.best ?? 0))
    .slice(0, 3);
  const series = [{ id: 'you', label: appName, color: appColor(0) }, ...rivals.map((entry, index) => ({ id: entry.app.id, label: entry.app.name, color: appColor(index + 1) }))];
  const data = readings.map((entry) => {
    const point: Record<string, string | number | null | undefined> = { date: entry.date, t: timeOf(entry.date), you: entry.rank };
    // An app the day's search was not read for (followed later) has no value that day.
    for (const rival of rivals) point[rival.app.id] = rival.app.id in entry.rivals ? entry.rivals[rival.app.id] : undefined;
    return point;
  });
  const ranks = data.flatMap((point) => series.map((line) => point[line.id])).filter((value): value is number => typeof value === 'number');
  const worst = ranks.length > 0 ? Math.max(...ranks) : 10;
  const top = Math.max(10, Math.ceil(worst / 10) * 10);
  const ticks = [1, 10, 25, 50, 100, 150, 200].filter((tick) => tick <= top);
  const first = timeOf(readings[0].date);
  const last = timeOf(readings[readings.length - 1].date);
  // Half a day each side, so a single check sits in the middle rather than on an edge.
  const domain: [number, number] = [first - 43_200_000, last + 43_200_000];
  const marks = events.filter((event) => (event.kind === 'release' || event.kind === 'screenshots' || event.kind === 'listing') && event.date >= readings[0].date && event.date <= readings[readings.length - 1].date);
  return (
    <div className="space-y-2">
      <div className="h-[220px]" role="img" aria-label={`Rank of "${row.term}" at each check. Higher on the chart is a better rank`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              ticks={spread(data.map((point) => point.t as number), 6)}
              tickFormatter={(value: number) => formatDay(dayOf(new Date(value)), { withYear: false })}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              minTickGap={28}
            />
            {/* Room above and below, so a dot at rank 1 or on the last tick is not cut in half. */}
            <YAxis reversed domain={[1, top]} padding={{ top: 8, bottom: 8 }} ticks={ticks} allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={34} />
            {/* filterNull off: a check that found no app still gets a tooltip, saying so. */}
            <Tooltip cursor={{ stroke: 'hsl(var(--border))' }} filterNull={false} content={<RankTooltip series={series} />} />
            {marks.map((event) => (
              <ReferenceLine
                key={event.id}
                x={timeOf(event.date)}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
                label={{ value: event.kind === 'release' ? event.version ?? 'New version' : event.kind === 'screenshots' ? 'Screenshots' : 'Store page', position: 'insideTopLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))', offset: 4 }}
              />
            ))}
            {series.map((line, index) => {
              // A reading with none beside it would be a line of no length: it draws as a dot.
              const lone = loneReadings(data.map((point) => point[line.id] as number | null | undefined));
              return (
                <Line
                  key={line.id}
                  type="monotone"
                  dataKey={line.id}
                  name={line.label}
                  stroke={line.color}
                  strokeWidth={index === 0 ? 2.5 : 1.5}
                  strokeDasharray={index === 0 ? undefined : '4 3'}
                  dot={(props: { cx?: number; cy?: number; index?: number }) =>
                    props.index !== undefined && lone.has(props.index) && props.cx !== undefined && props.cy !== undefined ? (
                      <circle key={`${line.id}-${props.index}`} data-rank-dot={line.id} cx={props.cx} cy={props.cy} r={3} fill={line.color} />
                    ) : (
                      <g key={`${line.id}-${props.index}`} />
                    )
                  }
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {series.map((line, index) => (
          <li key={line.id} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className={cn('inline-block w-3 rounded', index === 0 ? 'h-0.5' : 'h-0 border-t-2 border-dashed')} style={index === 0 ? { background: line.color } : { borderColor: line.color }} />
            <span className="break-words">{index === 0 ? `${line.label} (you)` : line.label}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        {readings.length === 1
          ? 'Each day Growth checks adds a point, so the line grows from here.'
          : "One point for each day Growth checked. A gap in a line is a check that didn't find that app."}
      </p>
    </div>
  );
}

function RankTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, string | number | null | undefined> }>;
  series: Array<{ id: string; label: string; color: string }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{formatDay(String(point.date), { withYear: true })}</p>
      {series.map((line) => {
        const value = point[line.id];
        return (
          <p key={line.id} className="mt-1 flex items-center gap-2">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: line.color }} />
            <span className="max-w-[180px] flex-1 break-words">{line.label}</span>
            <span className="font-medium tabular-nums">{rankWords(typeof value === 'string' ? undefined : value)}</span>
          </p>
        );
      })}
    </div>
  );
}

function SearchResults({
  row,
  owner,
  appId,
  country,
  followed,
  ownRatings,
}: {
  row: Row;
  owner: string;
  appId: string;
  country: string;
  followed: Followed[];
  ownRatings: number | null;
}) {
  const view = useGrowthView();
  const [following, setFollowing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const search = row.search;
  if (!search) return <p className="py-8 text-center text-xs text-muted-foreground">Search results show here after the first check</p>;
  const rank = rankIn(search, appId);
  // The weakest of the other apps, as the map and Within reach count it: the user's own app is left out.
  // It is said only when every other app shows a count (one with none could have fewer), or when it is 0.
  const competition = competitionOf(search, appId, ownRatings);
  const fewest = competition.weakest === 0 || everyCountShown(competition) ? competition.weakest : null;
  const mineOnTop = search.top.some((app) => app.id === appId);
  const followedIds = new Set(followed.map((app) => app.id));
  const rivalList = view.rivals.list;
  const followFull = (rivalList?.rivals.length ?? 0) >= MAX_RIVALS;

  const follow = async (app: SearchApp) => {
    setFollowing(app.id);
    setProblem(null);
    try {
      const found = await findRivals(app.id, { territory: country });
      const candidate = found.candidates[0];
      if (!candidate) throw new Error(found.notice ?? 'That app could not be found');
      const lately = !!rivalList && rivalList.rivals.length > 0 && !isRivalListDue(rivalList);
      await followRival(owner, candidate, rivalList?.countries.length ? rivalList.countries : startingCountries([country]));
      // Today's searches list the app already: its ranks go in without asking Apple again.
      await refreshRivalRanks(owner);
      void checkRivals(owner, { first: country, wait: true, ...(lately ? { only: [candidate.id] } : {}) }).catch((error) => console.error('Looking up the new competitor failed', error));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That app could not be followed');
    } finally {
      setFollowing(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        What people see first when they search &quot;{row.term}&quot; in {territoryName(country)}
      </p>
      <ol className="space-y-1.5" aria-label={`Search results for ${row.term}`}>
        {search.top.map((app, index) => {
          const mine = app.id === appId;
          const isFollowed = followedIds.has(app.id);
          return (
            <li key={app.id} className={cn('rounded-md p-1.5', mine ? 'bg-[hsl(var(--growth-series))]/10 ring-1 ring-inset ring-[hsl(var(--growth-series))]/40' : '')}>
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">{index + 1}</span>
                <AppIcon url={app.iconUrl} className="h-8 w-8 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs font-medium">{app.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {app.ratingCount ? `${formatRating(app.rating)} stars, ${formatCount(app.ratingCount)} ${app.ratingCount === 1 ? 'rating' : 'ratings'}` : 'No ratings yet'}
                  </p>
                </div>
                {mine ? (
                  <span className="shrink-0 rounded-full bg-[hsl(var(--growth-series))]/15 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--growth-series))]">You</span>
                ) : isFollowed ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">Following</span>
                ) : (
                  <Gated reason={followFull ? `You follow ${MAX_RIVALS} apps already. Stop following one on Competitors first` : null}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      disabled={following !== null}
                      onClick={() => void follow(app)}
                      aria-label={`Follow ${app.name}`}
                      title="Follow this app on Competitors"
                    >
                      {following === app.id ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <PlusIcon className="mr-0.5 h-3 w-3" />}
                      Follow
                    </Button>
                  </Gated>
                )}
              </div>
              {index < 3 && app.screenshots.length > 0 && (
                <div className="mt-1.5 grid grid-cols-3 gap-1 pl-7">
                  {app.screenshots.slice(0, 3).map((url, shot) => (
                    <Shot key={`${shot}:${url}`} url={url} alt={`${app.name} screenshot ${shot + 1}`} className="aspect-[9/19.5] w-full rounded-md border object-cover" />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {rank !== null && rank > search.top.length && (
        <p className="rounded-md bg-[hsl(var(--growth-series))]/10 p-2 text-xs">
          Your app is number <span className="font-semibold tabular-nums">{rank}</span> of {formatExact(search.ids.length)} for this search.
        </p>
      )}
      {rank === null && (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          Your app isn&apos;t among the {formatExact(search.ids.length)} apps this search lists.
        </p>
      )}
      {fewest !== null && (
        <p className="text-[11px] text-muted-foreground">
          {fewest === 0
            ? `${mineOnTop ? 'Besides yours, an' : 'An'} app with no ratings yet is in the top 10.`
            : `The app with the fewest ratings in the top 10${mineOnTop ? ', other than yours,' : ''} has ${formatExact(fewest)} ${fewest === 1 ? 'rating' : 'ratings'}.`}
          {ownRatings !== null ? ` Yours has ${formatExact(ownRatings)} ${ownRatings === 1 ? 'rating' : 'ratings'}.` : ''}
        </p>
      )}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}

/** Whether the keyword is on the store page shoppers in this country read, and a way to add it to the keywords. */
function StorePageBlock({ row, country, listing, pageLocale }: { row: Row; country: string; listing: ListingSnapshot | null; pageLocale: ListingLocale | null }) {
  const view = useGrowthView();
  const drafts = useListingDrafts(view.app.id);
  const [added, setAdded] = useState<string[] | null>(null);
  if (!listing || !pageLocale || !row.coverage) {
    return (
      <div className="space-y-1 border-t pt-3">
        <p className="text-xs font-medium">On your store page</p>
        <p className="text-xs text-muted-foreground">
          {view.app.id && view.store === 'appstore'
            ? 'Refresh Growth to load your store page, then Growth shows if the keyword is on it.'
            : 'Add your App Store Connect key under Setup to see your store page here.'}
        </p>
      </div>
    );
  }
  const coverage = row.coverage;
  const language = listingLanguageName(pageLocale.locale);
  const waiting = collapseChanges(drafts.changes).find((change) => change.locale === pageLocale.locale && change.field === 'keywords');
  const base = waiting?.after ?? pageLocale.keywords;
  const missingNow = waiting ? coverageOf(row.term, { ...pageLocale, keywords: base }).missing : coverage.missing;
  const addition = addToKeywordField(base, missingNow);
  const editable = listingFieldEditable(listing, 'keywords');
  const reason = !view.canWrite
    ? view.blocked.app ?? 'To change your store page, you need the desktop app and your App Store Connect key'
    : !editable.ok
      ? 'To change your keywords, create a new version in App Store Connect first'
      : addition.added.length === 0
        ? `Your ${language} keywords are full. Make room on Store page first`
        : null;

  const add = () => {
    setListingChanges(view.app.id, (current) =>
      upsertListingChanges(
        current,
        [{ locale: pageLocale.locale, field: 'keywords', before: pageLocale.keywords, after: addition.after, reason: `Added ${andList(addition.added.map((word) => `"${word}"`))} from Keywords` }],
        listing
      )
    );
    setAdded(addition.added);
  };

  return (
    <div className="space-y-2 border-t pt-3" data-testid="growth-keyword-store-page">
      <p className="text-xs font-medium">On your {language} store page</p>
      {added ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--growth-good))]">
            <CheckIcon className="h-3.5 w-3.5" />
            Added {quoteList(added)} to your changes. Apply the changes on Store page.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => view.goTo('listing', { locale: pageLocale.locale })}>
            Open Store page
          </Button>
        </div>
      ) : missingNow.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {waiting && coverage.missing.length > 0
            ? 'Your waiting changes on Store page add this keyword.'
            : `In your ${andList(coverage.fields.map(fieldWord))}. The App Store finds your app by the words in its name, subtitle and keywords.`}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs">
            {quoteList(missingNow)} {missingNow.length === 1 ? "isn't" : "aren't"} in your name, subtitle or keywords, so this search can&apos;t find your app by{' '}
            {missingNow.length === 1 ? 'that word' : 'those words'}.
          </p>
          <Gated reason={reason}>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={add} title={`Add ${andList(addition.added.map((word) => `"${word}"`))} to your ${language} keywords. You check and apply the change on Store page`}>
              <PlusIcon className="mr-1 h-3.5 w-3.5" />
              Add to keywords
            </Button>
          </Gated>
          {reason && <p className="text-[11px] text-muted-foreground">{reason}.</p>}
          {addition.left.length > 0 && addition.added.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {quoteList(addition.left)} {addition.left.length === 1 ? "doesn't" : "don't"} fit in your keywords.
            </p>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Shoppers in {territoryName(country)} read your {language} store page.</p>
    </div>
  );
}

// --- ideas -----------------------------------------------------------------------------------

interface Idea {
  term: string;
  why: string;
  source: KeywordSource;
}

function IdeasPanel({
  owner,
  appId,
  appName,
  country,
  rows,
  listing,
  pageLocale,
  followed,
  ownRatings,
  blocked,
  popularityOn,
  onTrack,
}: {
  owner: string;
  appId: string;
  appName: string;
  country: string;
  rows: Row[];
  listing: ListingSnapshot | null;
  pageLocale: ListingLocale | null;
  followed: Followed[];
  /** The app's rating count for a search, by the screen's one rule (ownFor). */
  ownRatings: (search?: KeywordSearch) => number | null;
  blocked: string | null;
  /** Apple Ads is connected, in the desktop app. */
  popularityOn: boolean;
  onTrack: (term: string, source: KeywordSource) => void;
}) {
  const view = useGrowthView();
  const [tab, setTab] = useState<IdeaTab>('top-apps');
  const ai = useKeywordIdeas(owner, country);
  const tracked = useMemo(() => new Set(rows.map((row) => row.term)), [rows]);
  // How names are split into words: by the store page language, or the country's main one.
  const locale = pageLocale?.locale ?? listingLanguageFor(country);
  // Words on the store page are ideas of their own, not top app ideas.
  const onPage = useMemo(() => new Set(pageLocale ? storePageTerms(pageLocale) : []), [pageLocale]);

  const topNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) for (const app of row.search?.top ?? []) if (app.id !== appId && !seen.has(app.id)) seen.set(app.id, app.name);
    return Array.from(seen.values());
  }, [rows, appId]);

  const ideas: Idea[] = useMemo(() => {
    if (tab === 'top-apps') {
      return nameIdeas(topNames, locale, new Set([...tracked, ...onPage]), 2).map((idea) => ({
        term: idea.term,
        why: `In the names of ${idea.apps} top apps`,
        source: 'top-apps' as const,
      }));
    }
    if (tab === 'store-page') {
      const terms = pageLocale ? storePageTerms(pageLocale) : namePhrases(appName, locale);
      return terms
        .filter((term) => !tracked.has(term))
        .slice(0, 12)
        .map((term) => ({ term, why: pageLocale ? 'On your store page' : 'In your app name', source: 'store-page' as const }));
    }
    if (tab === 'competitors') {
      return nameIdeas(
        followed.map((app) => app.name),
        locale,
        new Set([...tracked, ...onPage]),
        1
      ).map((idea) => ({ term: idea.term, why: `In the names of ${idea.apps} ${idea.apps === 1 ? 'app' : 'apps'} you follow`, source: 'competitors' as const }));
    }
    // The panel's hint names the AI, so the rows need no reason of their own.
    return ai.terms.filter((term) => !tracked.has(term)).map((term) => ({ term, why: '', source: 'ai' as const }));
  }, [tab, topNames, locale, tracked, onPage, pageLocale, appName, followed, ai.terms]);

  // Searches already made for these ideas, so a checked idea shows its rank.
  // Keyed by `${country}|${term}`: the country can change while a search is
  // out, and its answer belongs to the country it was asked in.
  const [checked, setChecked] = useState<Map<string, KeywordSearch>>(new Map());
  const [checking, setChecking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ideaTerms = ideas.map((idea) => idea.term).join('\n');
  useEffect(() => {
    let cancelled = false;
    const wanted = ideaTerms ? ideaTerms.split('\n') : [];
    void readKeywordSearches([country], wanted).then((found) => {
      if (cancelled) return;
      setChecked((current) => new Map([...current, ...found]));
    });
    return () => {
      cancelled = true;
    };
  }, [ideaTerms, country]);

  const check = async (term: string) => {
    const asked = country;
    const key = `${asked}|${term}`;
    setChecking(key);
    setProblem(null);
    try {
      const search = await freshSearch(term, asked);
      setChecked((current) => new Map(current).set(key, search));
    } catch (error) {
      console.error('Checking a keyword idea failed', error);
      setProblem('The App Store search could not be reached. Check your connection and try again');
    } finally {
      setChecking((current) => (current === key ? null : current));
    }
  };

  // Popularity of the ideas on screen, in the country on screen: one request
  // for all of them, after any refresh already under way (wait), and again
  // after a new key or ad account.
  const ideaPopularity = usePopularity(popularityOn ? [country] : [], ideaTerms ? ideaTerms.split('\n') : []);
  const adsSetup = useAppleAdsSetup();
  const adsId = popularityOn ? `${adsSetup.key?.clientId}|${adsSetup.key?.keyId}|${adsSetup.account?.id}` : '';
  useEffect(() => {
    if (!adsId || !view.active || !ideaTerms) return;
    void refreshPopularity({ countries: [country], terms: ideaTerms.split('\n'), wait: true }).catch((error) =>
      console.error('Refreshing the popularity of keyword ideas failed', error)
    );
  }, [adsId, view.active, ideaTerms, country]);

  // While Check all runs the order holds still, so a row never jumps away from the pointer.
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const ordered = useMemo(() => {
    const withFacts = ideas.map((idea) => {
      const search = checked.get(`${country}|${idea.term}`);
      const rank = search ? rankIn(search, appId) : undefined;
      const mine = search ? ownRatings(search) : null;
      const chance: Chance = search ? chanceOf(rank, competitionOf(search, appId, mine), mine) : 'unknown';
      const record = ideaPopularity.records.get(`${country}|${idea.term}`);
      return { ...idea, search, rank, chance, record, score: latestPoint(record)?.score ?? null };
    });
    if (!popularityOn) return withFacts;
    if (frozen) {
      const place = (term: string) => {
        const index = frozen.indexOf(term);
        return index < 0 ? frozen.length : index;
      };
      return [...withFacts].sort((a, b) => place(a.term) - place(b.term));
    }
    return byBestChance(withFacts);
  }, [ideas, checked, country, appId, ownRatings, ideaPopularity.records, popularityOn, frozen]);

  const [checkingAll, setCheckingAll] = useState<{ done: number; total: number } | null>(null);
  const stopAll = useRef<AbortController | null>(null);
  // The answers only this screen shows stop with it; the searches already made stay stored.
  useEffect(() => () => stopAll.current?.abort(), []);
  const unchecked = ordered.filter((idea) => !idea.search).map((idea) => idea.term);
  const checkAll = async () => {
    const asked = country;
    const todo = [...unchecked];
    if (todo.length === 0) return;
    const stop = new AbortController();
    stopAll.current = stop;
    setFrozen(ordered.map((idea) => idea.term));
    setCheckingAll({ done: 0, total: todo.length });
    setProblem(null);
    let inARow = 0;
    try {
      for (const [index, term] of todo.entries()) {
        try {
          const search = await freshSearch(term, asked, stop.signal);
          setChecked((current) => new Map(current).set(`${asked}|${term}`, search));
          inARow = 0;
        } catch (error) {
          if (stop.signal.aborted || (error as Error)?.name === 'AbortError') break;
          console.error('Checking a keyword idea failed', error);
          inARow += 1;
          if (inARow >= 3) {
            setProblem('The App Store search could not be reached. Check your connection and try again');
            break;
          }
        }
        setCheckingAll({ done: index + 1, total: todo.length });
      }
    } finally {
      setCheckingAll(null);
      setFrozen(null);
      if (stopAll.current === stop) stopAll.current = null;
    }
  };

  const hints: Record<IdeaTab, string> = {
    'top-apps': 'Words the top apps for your keywords put in their names',
    'store-page': pageLocale ? "Words on your store page you don't track yet" : "Words in your app's name you don't track yet",
    competitors: 'Words the apps you follow put in their names',
    ai: `Ideas from ${view.aiLabel ?? 'the AI'}. Check each idea to see where your app would rank`,
  };

  return (
    <Panel className="space-y-3" data-testid="growth-keyword-ideas">
      <SectionTitle
        title="Ideas"
        hint={hints[tab]}
        actions={
          <Toggle
            label="Ideas from"
            value={tab}
            options={[
              ['top-apps', 'Top apps'],
              ['store-page', 'Your store page'],
              ['competitors', 'Competitors'],
              ['ai', 'AI'],
            ]}
            onChange={setTab}
          />
        }
      />
      {tab === 'ai' && (
        <div className="flex flex-wrap items-center gap-2">
          {ai.running ? (
            <Button size="sm" variant="outline" className="h-8" onClick={() => stopKeywordIdeas(owner, country)}>
              <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Gated reason={view.blocked.aiAlone}>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() =>
                  startKeywordIdeas(owner, country, {
                    appName,
                    country,
                    language: searchLanguageName(country, listing),
                    page: pageLocale ? { name: pageLocale.name, subtitle: pageLocale.subtitle, keywords: pageLocale.keywords, description: pageLocale.description } : null,
                    tracked: rows.map((row) => ({ term: row.term, rank: row.standing.latest?.rank ?? null })),
                    topNames,
                  })
                }
              >
                <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
                {ai.terms.length > 0 ? 'Get new ideas' : 'Get ideas'}
              </Button>
            </Gated>
          )}
          {ai.running && <span className="text-xs text-muted-foreground">{view.aiLabel ?? 'The AI'} is thinking of words people search for</span>}
          {ai.error && <span className="text-xs text-destructive">{ai.error}</span>}
        </div>
      )}
      {/* While Check all runs, its count and Stop stay: with one idea left, and on another tab, even an empty one. */}
      {((ideas.length > 0 && (popularityOn || unchecked.length > 1)) || checkingAll) && (
        <div className="flex flex-wrap items-center justify-between gap-2" data-testid="growth-idea-tools">
          {popularityOn && ideas.length > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              Best chance first
              <InfoTip label="How the ideas are sorted">
                <p>Words your app can rank for come first: your app is in the top 10 already, or an app with no more ratings than yours is in the top 10.</p>
                <p>Then come the words Growth can&apos;t judge yet, like ones not checked, then the rest. In each group, the words people search most come first.</p>
              </InfoTip>
            </span>
          ) : (
            <span />
          )}
          {checkingAll ? (
            <span className="flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground" role="status">
                Checking {checkingAll.done} of {checkingAll.total}
              </span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => stopAll.current?.abort()} title="Stop checking and keep the ideas checked so far">
                <SquareIcon className="mr-1 h-3 w-3" />
                Stop
              </Button>
            </span>
          ) : (
            unchecked.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={checking !== null}
                onClick={() => void checkAll()}
                title={`Search the App Store in ${territoryName(country)} for the ${unchecked.length} ideas not checked yet`}
              >
                <SearchIcon className="mr-1 h-3 w-3" />
                Check all
              </Button>
            )
          )}
        </div>
      )}
      {ideas.length === 0 ? (
        <IdeasEmpty tab={tab} hasRanks={rows.some((row) => !!row.search)} onCompetitors={() => view.goTo('competitors')} />
      ) : (
        <ul className="divide-y" aria-label="Keyword ideas">
          {ordered.map((idea) => {
            const { search, rank } = idea;
            return (
              <li key={idea.term} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-idea={idea.term} data-chance={idea.chance}>
                <div className="min-w-[140px] flex-1">
                  <p className="text-sm font-medium">{idea.term}</p>
                  {idea.why && <p className="text-[11px] text-muted-foreground">{idea.why}</p>}
                </div>
                {popularityOn && (
                  <div className="flex w-[64px] shrink-0 items-center" data-popularity-cell>
                    <PopularityCell record={idea.record} term={idea.term} country={country} refreshing={ideaPopularity.refreshing} />
                  </div>
                )}
                {search && (
                  <div className="flex min-w-0 items-center gap-2">
                    <RankPill day={{ rank: rank ?? null, total: search.ids.length }} />
                    {search.top[0] && (
                      <span className="hidden break-words text-[11px] text-muted-foreground sm:inline">
                        First: {search.top[0].id === appId ? 'your app' : search.top[0].name}
                      </span>
                    )}
                    {idea.chance === 'reach' && (
                      <span className="rounded-full bg-[hsl(var(--growth-good))]/10 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--growth-good))]" title="An app with no more ratings than yours is in the top 10 for this search">
                        Within reach
                      </span>
                    )}
                    {idea.chance === 'crowded' && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" title="The top 10 for this search is full, and every app there has more ratings than yours">
                        Crowded
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {!search && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={checking !== null || checkingAll !== null}
                      onClick={() => void check(idea.term)}
                      title={`Search the App Store for "${idea.term}" in ${territoryName(country)}`}
                      aria-label={`Check ${idea.term}`}
                    >
                      {checking === `${country}|${idea.term}` ? <Loader2Icon className="mr-1 h-3 w-3 animate-spin" /> : <SearchIcon className="mr-1 h-3 w-3" />}
                      Check
                    </Button>
                  )}
                  <Gated reason={blocked}>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onTrack(idea.term, idea.source)} aria-label={`Track ${idea.term}`}>
                      <PlusIcon className="mr-1 h-3 w-3" />
                      Track
                    </Button>
                  </Gated>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </Panel>
  );
}

function IdeasEmpty({ tab, hasRanks, onCompetitors }: { tab: IdeaTab; hasRanks: boolean; onCompetitors: () => void }) {
  if (tab === 'top-apps') {
    return <p className="text-xs text-muted-foreground">{hasRanks ? 'No word comes up in the names of more than one top app yet' : 'Ideas show here after Growth checks your keywords'}</p>;
  }
  if (tab === 'store-page') return <p className="text-xs text-muted-foreground">You track every word on your store page already</p>;
  if (tab === 'competitors') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Follow apps on Competitors to see the words they use
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCompetitors}>
          Open Competitors
        </Button>
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground">Ask the AI for words people might search for</p>;
}

// --- starting, and the countries ----------------------------------------------------------------

function StartPanel({
  pageLocale,
  locale,
  appName,
  countryName,
  onTrack,
}: {
  pageLocale: ListingLocale | null;
  /** The language the app name is split into words by. */
  locale: string;
  appName: string;
  countryName: string;
  onTrack: (input: string[], source: KeywordSource) => void;
}) {
  const suggested = useMemo(() => (pageLocale ? storePageTerms(pageLocale) : namePhrases(appName, locale)).slice(0, 12), [pageLocale, appName, locale]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(suggested));
  const [typed, setTyped] = useState('');
  useEffect(() => setPicked(new Set(suggested)), [suggested]);
  const chosen = suggested.filter((term) => picked.has(term));
  return (
    <Panel className="space-y-4" data-testid="growth-keyword-start">
      <div className="space-y-1">
        <p className="text-sm font-semibold">See where your app shows up in App Store search</p>
        <p className="text-xs text-muted-foreground">
          Add the words people type to find an app like yours. Growth checks your rank for each word in {countryName} and your other countries every day.
        </p>
      </div>
      {suggested.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">{pageLocale ? 'From your store page' : 'From your app name'}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggested.map((term) => {
              const on = picked.has(term);
              return (
                <button
                  key={term}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked((current) => {
                    const next = new Set(current);
                    if (on) next.delete(term);
                    else next.add(term);
                    return next;
                  })}
                  className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', on ? 'border-[hsl(var(--growth-series))] bg-[hsl(var(--growth-series))]/10' : 'text-muted-foreground hover:bg-muted')}
                >
                  {on ? <CheckIcon className="h-3 w-3" aria-hidden /> : <PlusIcon className="h-3 w-3" aria-hidden />}
                  {term}
                </button>
              );
            })}
          </div>
          <Button size="sm" disabled={chosen.length === 0} onClick={() => onTrack(chosen, 'store-page')}>
            Track {chosen.length} {chosen.length === 1 ? 'keyword' : 'keywords'}
          </Button>
        </div>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const input = parseKeywordInput(typed);
          if (input.length === 0) return;
          onTrack(input, 'typed');
          setTyped('');
        }}
      >
        <Input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Type keywords, separated by commas" aria-label="Keywords to track" className="h-9 min-w-[200px] flex-1 text-sm" />
        <Button type="submit" size="sm" variant="outline" className="h-9" disabled={parseKeywordInput(typed).length === 0}>
          <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
          Track
        </Button>
      </form>
    </Panel>
  );
}

function CountriesPanel({ owner, countries, starting }: { owner: string; countries: string[]; starting: string[] }) {
  const options = useMemo(
    () =>
      TERRITORY_CODES.filter((code) => !countries.includes(code))
        .map((code) => ({ code, name: territoryName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [countries]
  );
  const full = countries.length >= MAX_KEYWORD_COUNTRIES;
  return (
    <Panel data-testid="growth-keyword-countries">
      <SectionTitle title="Countries to check" hint={`Up to ${MAX_KEYWORD_COUNTRIES} countries. Each keyword is one search in each country, every day`} />
      <ul className="mb-3 flex flex-wrap gap-1.5">
        {countries.map((code) => (
          <li key={code} className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs">
            {territoryName(code)}
            <button
              type="button"
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              onClick={() => void changeKeywordCountries(owner, (current) => current.filter((other) => other !== code), starting)}
              disabled={countries.length <= 1}
              aria-label={`Stop checking ${territoryName(code)}`}
              title={countries.length <= 1 ? 'Growth needs one country to check' : `Stop checking ${territoryName(code)}`}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <Gated reason={full ? `You can check ${MAX_KEYWORD_COUNTRIES} countries. Remove one first` : null}>
        <Select
          value=""
          onValueChange={(code) => {
            void changeKeywordCountries(owner, (current) => (current.includes(code) ? current : [...current, code]), starting).then(() =>
              checkKeywords(owner, { only: { countries: [code] }, wait: true }).catch((error) => console.error('Checking the new country failed', error))
            );
          }}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Add a country">
            <SelectValue placeholder="Add a country" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.code} value={option.code} className="text-xs">
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Gated>
    </Panel>
  );
}
