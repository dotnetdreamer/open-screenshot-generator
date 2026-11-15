"use client";

// Ratings: the app's star rating over time, its new ratings, the stars, and
// every country, beside the apps the user follows if they want.
//
// The stores keep no ratings history, so the history starts on the first
// day Growth read the ratings (ratingHistory.ts) and grows with each
// refresh. Written reviews are the one history the stores give in full, so
// "Written reviews" shows from the start. Every chart says where its numbers
// come from and from which day.

import React, { useMemo, useState } from 'react';
import { InfoIcon, StarIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addDays, formatDay, today, windowEndingAt } from '@/lib/growth/dates';
import { formatCount, formatExact, formatRating } from '@/lib/growth/format';
import { ratingSummary } from '@/lib/growth/ratings';
import {
  countryRows,
  historyStart,
  ratingBuckets,
  readingsOf,
  reviewBuckets,
  starTotal,
  territoriesOf,
  versionRatings,
  type RatingGranularity,
} from '@/lib/growth/ratingHistory';
import { ratingHistogram } from '@/lib/growth/reviewTopics';
import { listingLanguageName, territoryName, UNKNOWN_TERRITORY } from '@/lib/growth/territories';
import type { RatingDay, StarCounts } from '@/lib/growth/types';
import { useRatingHistory } from '@/lib/growth/useRatingHistory';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { RatingLines, StarBars, StarBreakdown, appColor, type LineSeries, type StarBucket } from './GrowthRatingCharts';
import { Delta, EmptyState, Panel, SectionTitle, Stars, useGrowthView } from './GrowthShared';

type Mode = 'all' | 'new' | 'written';

const MODES: Array<[Mode, string]> = [
  ['all', 'All ratings'],
  ['new', 'New ratings'],
  ['written', 'Written reviews'],
];

const GRANULARITIES: Array<[RatingGranularity, string]> = [
  ['day', 'Days'],
  ['week', 'Weeks'],
  ['month', 'Months'],
];

/** Followed apps drawn beside yours at most, so the lines stay apart. */
const MAX_COMPARED = 3;

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn('rounded px-2.5 py-1 text-xs', value === option ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The newest reading of each country that has stars, added up. */
function latestStars(rows: RatingDay[], territory: string): { stars: StarCounts; countries: number } | null {
  const codes = territory === 'all' ? territoriesOf(rows) : [territory];
  let total: StarCounts = [0, 0, 0, 0, 0];
  let countries = 0;
  for (const code of codes) {
    const list = readingsOf(rows, code);
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const stars = list[index].point.stars;
      if (stars && starTotal(stars) > 0) {
        total = total.map((value, star) => value + stars[star]) as StarCounts;
        countries += 1;
        break;
      }
    }
  }
  return countries > 0 ? { stars: total, countries } : null;
}

export function GrowthRatings() {
  const view = useGrowthView();
  const play = view.store === 'playstore';
  const [mode, setMode] = useState<Mode>('all');
  const [granularity, setGranularity] = useState<RatingGranularity>(view.rangeDays > 120 ? 'month' : view.rangeDays > 31 ? 'week' : 'day');
  const [territory, setTerritory] = useState('all');
  const [compared, setCompared] = useState<string[]>([]);

  const rivals = useMemo(() => view.rivals.list?.rivals ?? [], [view.rivals.list]);
  const ids = useMemo(() => [view.app.id, ...rivals.map((rival) => rival.id)].filter(Boolean), [view.app.id, rivals]);
  const history = useRatingHistory(ids);
  const rows = useMemo(() => history.byApp.get(view.app.id) ?? [], [history.byApp, view.app.id]);
  const span = useMemo(() => windowEndingAt(today(), view.rangeDays), [view.rangeDays]);
  const before = useMemo(() => ({ from: addDays(span.from, -view.rangeDays), to: addDays(span.from, -1) }), [span, view.rangeDays]);
  const started = historyStart(rows);

  const summary = ratingSummary(view.data.ratings);
  const countries = useMemo(() => countryRows(rows, view.data.ratings, span), [rows, view.data.ratings, span]);
  const placeName = (code: string) => (code === UNKNOWN_TERRITORY ? 'Every country' : /^[A-Z]{2}$/.test(code) ? territoryName(code) : listingLanguageName(code));
  const territories = useMemo(() => countries.map((row) => row.territory).filter((code) => code !== UNKNOWN_TERRITORY), [countries]);
  const shownTerritory = territory !== 'all' && !territories.includes(territory) ? 'all' : territory;

  const buckets = useMemo(() => ratingBuckets(rows, { territory: shownTerritory, granularity, window: span }), [rows, shownTerritory, granularity, span]);
  const previous = useMemo(() => ratingBuckets(rows, { territory: shownTerritory, granularity: 'month', window: before }), [rows, shownTerritory, before]);
  const reviewSeries = useMemo(
    () => reviewBuckets(view.data.reviews, { territory: shownTerritory, granularity, window: span, play }),
    [view.data.reviews, shownTerritory, granularity, span, play]
  );
  const versions = useMemo(() => (play ? [] : versionRatings(rows)), [rows, play]);

  const newCount = buckets.reduce((sum, bucket) => sum + bucket.newCount, 0);
  const newSummed = buckets.filter((bucket) => bucket.newAverage !== null && bucket.newCount > 0);
  const newAverage = newSummed.length ? newSummed.reduce((sum, bucket) => sum + bucket.newAverage! * bucket.newCount, 0) / newSummed.reduce((sum, bucket) => sum + bucket.newCount, 0) : null;
  const earlierNew = previous.reduce((sum, bucket) => sum + bucket.newCount, 0);
  const earlierCovered = !!started && started <= before.from;
  const lastAverage = [...buckets].reverse().find((bucket) => bucket.average !== null)?.average ?? null;
  const firstAverage = buckets.find((bucket) => bucket.average !== null)?.average ?? null;
  const averageChange = started && started <= span.from && lastAverage !== null && firstAverage !== null ? lastAverage - firstAverage : null;
  const stars = latestStars(rows, shownTerritory);
  const written = ratingHistogram(view.data.reviews.filter((review) => shownTerritory === 'all' || (play ? review.language === shownTerritory : review.territory === shownTerritory)));
  const dayAverages = buckets.some((bucket) => bucket.dayAverage !== null);

  const starts = buckets.map((bucket) => bucket.start);
  const comparedRivals = rivals.filter((rival) => compared.includes(rival.id));
  const averageSeries: LineSeries[] = [
    { id: 'you', label: view.app.name, color: appColor(0), values: new Map(buckets.map((bucket) => [bucket.start, bucket.average])) },
    ...comparedRivals.map((rival, index) => {
      const rivalRows = history.byApp.get(rival.id) ?? [];
      const rivalBuckets = ratingBuckets(rivalRows, { territory: shownTerritory, granularity, window: span });
      return { id: rival.id, label: rival.name, color: appColor(index + 1), values: new Map(rivalBuckets.map((bucket) => [bucket.start, bucket.average])) };
    }),
  ];
  const countSeries: LineSeries[] = [{ id: 'count', label: 'Ratings', color: appColor(0), values: new Map(buckets.map((bucket) => [bucket.start, bucket.count])) }];

  const newBars: StarBucket[] = buckets.map((bucket) => ({
    start: bucket.start,
    end: bucket.end,
    stars: bucket.newStars,
    unknown: bucket.newUnknown,
    count: bucket.newCount,
    average: bucket.newAverage,
    note: bucket.reset
      ? `${view.words.owner} started counting the ratings again in this ${granularity}, so these are all the ratings since.`
      : bucket.spansGap
        ? `Some of these may be from before this ${granularity}: Growth reads the ratings when it refreshes.`
        : undefined,
  }));
  const writtenBars: StarBucket[] = reviewSeries.map((bucket) => ({ start: bucket.start, end: bucket.end, stars: bucket.stars, count: bucket.count, average: bucket.average }));

  if (!view.app.id) {
    return (
      <EmptyState icon={StarIcon} title="No ratings yet">
        Your app&apos;s star rating shows here, by day and by country, once Growth can read your app.
      </EmptyState>
    );
  }
  if (!history.loaded) return null;
  const nothing = rows.length === 0 && view.data.ratings.length === 0 && view.data.reviews.length === 0;
  if (nothing) {
    return (
      <EmptyState icon={StarIcon} title="No ratings yet">
        {play
          ? 'Refresh to load your ratings. Google Play ratings come from the monthly report files, so add your Cloud Storage URI under Setup.'
          : 'Refresh to load your ratings. Growth reads your star rating in every country you sell in, and keeps a record from that day on.'}
      </EmptyState>
    );
  }

  const historyNote = started
    ? `Growth keeps a record of your ratings from ${formatDay(started, { withYear: true })}, the first day it read them. The stores keep none.`
    : 'Growth starts its record of your ratings with the next refresh. The stores keep none.';

  return (
    <div className="space-y-4" data-testid="growth-ratings">
      <SectionTitle
        title="Ratings"
        hint={
          <span className="inline-flex items-center gap-1">
            Your star rating over time, the new ratings and every country
            <InfoTip label="Where the ratings come from">
              <p>{historyNote}</p>
              <p>
                {play
                  ? 'Google Play: the averages come from your monthly report files, with a figure for every day. The number of ratings and the stars come from your Google Play page, which the desktop app reads twice a day.'
                  : 'App Store: Apple says how many ratings your app has in each country and their average, but not how many have each number of stars. New ratings are the difference between two days.'}
              </p>
            </InfoTip>
          </span>
        }
        actions={
          <Select value={shownTerritory} onValueChange={setTerritory}>
            <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                All countries
              </SelectItem>
              {territories.map((code) => (
                <SelectItem key={code} value={code} className="text-xs">
                  {placeName(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Panel>
          <p className="text-xs text-muted-foreground">Average rating</p>
          <div className="mt-1 flex items-end gap-2">
            <p className="text-3xl font-semibold leading-none" data-testid="growth-ratings-average">
              {formatRating(shownTerritory === 'all' ? summary.average ?? lastAverage : countries.find((row) => row.territory === shownTerritory)?.average)}
            </p>
            <Stars rating={(shownTerritory === 'all' ? summary.average ?? lastAverage : countries.find((row) => row.territory === shownTerritory)?.average) ?? 0} className="mb-1" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {shownTerritory === 'all'
              ? summary.count !== null
                ? `${formatExact(summary.count)} rating${summary.count === 1 ? '' : 's'} in ${summary.countries} ${summary.countries === 1 ? 'country' : 'countries'}`
                : summary.average !== null
                  ? 'Average of all ratings'
                  : 'No ratings yet'
              : (() => {
                  const row = countries.find((entry) => entry.territory === shownTerritory);
                  return row?.count !== null && row?.count !== undefined ? `${formatExact(row.count)} rating${row.count === 1 ? '' : 's'} in ${placeName(shownTerritory)}` : 'Average of all ratings';
                })()}
          </p>
          {averageChange !== null && Math.abs(averageChange) >= 0.005 && (
            <p
              className={cn('mt-1 text-xs', averageChange > 0 ? 'text-[hsl(var(--growth-good))]' : 'text-[hsl(var(--growth-bad))]')}
              title={`From ${formatRating(firstAverage)} at the start of the period`}
            >
              {averageChange > 0 ? 'Up' : 'Down'} {Math.abs(averageChange).toFixed(2)} stars in the last {view.rangeDays} days
            </p>
          )}
        </Panel>

        <Panel>
          <p className="text-xs text-muted-foreground">New ratings in the period</p>
          {dayAverages && !buckets.some((bucket) => bucket.newCount > 0) ? (
            <>
              <p className="mt-1 text-3xl font-semibold leading-none">
                {formatRating(buckets.filter((bucket) => bucket.dayAverage !== null).reduce((sum, bucket, _, all) => sum + bucket.dayAverage! / all.length, 0))}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Average of the ratings given each day. Google gives no number of new ratings.</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-3xl font-semibold leading-none" data-testid="growth-ratings-new">
                {started ? formatExact(newCount) : 'n/a'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {!started
                  ? 'Growth counts new ratings from the next refresh on'
                  : newAverage !== null
                    ? `${formatRating(newAverage)} stars on average`
                    : newCount > 0
                      ? 'Too many ratings in all to work out their average'
                      : started > span.from
                        ? `Counted from ${formatDay(started)}`
                        : 'No new ratings'}
              </p>
              {earlierCovered && started && started <= span.from && earlierNew + newCount > 0 && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Delta change={earlierNew > 0 ? newCount / earlierNew - 1 : null} />
                  <span>vs the {view.rangeDays} days before</span>
                </p>
              )}
            </>
          )}
        </Panel>

        <Panel>
          <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
            {stars ? 'Ratings by stars' : 'Written reviews by stars'}
            <InfoTip label="Where the stars come from">
              {stars ? (
                <p>From your Google Play page in {stars.countries === 1 ? '1 country' : `${stars.countries} countries`}, as the desktop app last read it.</p>
              ) : play ? (
                <p>The desktop app reads the stars of every rating from your Google Play page twice a day. Until then, these are the stars of your written reviews.</p>
              ) : (
                <p>Apple doesn&apos;t share how many of your ratings have each number of stars, so these are the stars of your written reviews.</p>
              )}
            </InfoTip>
          </p>
          <StarBreakdown stars={stars?.stars ?? (written as StarCounts)} />
        </Panel>
      </div>

      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Toggle label="Show" value={mode} options={MODES} onChange={setMode} />
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'all' && rivals.length > 0 && (
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Compare with">
                <span className="text-xs text-muted-foreground">Compare with</span>
                {rivals.map((rival) => {
                  const on = compared.includes(rival.id);
                  const index = comparedRivals.findIndex((entry) => entry.id === rival.id);
                  return (
                    <button
                      key={rival.id}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && compared.length >= MAX_COMPARED}
                      title={!on && compared.length >= MAX_COMPARED ? `Compare up to ${MAX_COMPARED} apps at a time` : undefined}
                      onClick={() => setCompared((current) => (on ? current.filter((id) => id !== rival.id) : [...current, rival.id]))}
                      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-50', on ? 'border-foreground' : 'hover:bg-muted')}
                    >
                      {on && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: appColor(index + 1) }} />}
                      {rival.name}
                    </button>
                  );
                })}
              </div>
            )}
            <Toggle label="Group by" value={granularity} options={GRANULARITIES} onChange={setGranularity} />
          </div>
        </div>

        {mode === 'all' && (
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-medium">Average rating</p>
              {buckets.some((bucket) => bucket.average !== null) || comparedRivals.length > 0 ? (
                <RatingLines starts={starts} series={averageSeries} granularity={granularity} events={view.data.events} label="Average rating" />
              ) : (
                <HistoryWaits started={started} />
              )}
            </div>
            {buckets.some((bucket) => bucket.count !== null) && (
              <div>
                <p className="mb-1 text-xs font-medium">Number of ratings</p>
                <RatingLines
                  starts={starts}
                  series={countSeries}
                  granularity={granularity}
                  events={view.data.events}
                  height={160}
                  domain={undefinedDomain(buckets.map((bucket) => bucket.count))}
                  format={(value) => formatCount(value)}
                  label="Number of ratings"
                  whole
                />
              </div>
            )}
          </div>
        )}

        {mode === 'new' &&
          (dayAverages && !buckets.some((bucket) => bucket.newCount > 0) ? (
            <div>
              <p className="mb-1 text-xs font-medium">Average of the ratings given</p>
              <RatingLines
                starts={starts}
                series={[{ id: 'day', label: 'Ratings given', color: appColor(0), values: new Map(buckets.map((bucket) => [bucket.start, bucket.dayAverage])) }]}
                granularity={granularity}
                events={view.data.events}
                label="Average of the ratings given"
              />
              <p className="mt-2 text-xs text-muted-foreground">Google Play gives the average of each day&apos;s ratings, not how many there were.</p>
            </div>
          ) : started ? (
            <div>
              <StarBars buckets={newBars} granularity={granularity} events={view.data.events} what="new ratings" />
              {started > span.from && <p className="mt-2 text-xs text-muted-foreground">Counted from {formatDay(started, { withYear: true })}, the first day Growth read your ratings.</p>}
            </div>
          ) : (
            <HistoryWaits started={started} />
          ))}

        {mode === 'written' &&
          (view.data.reviews.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No written reviews yet</p>
          ) : (
            <div>
              <StarBars buckets={writtenBars} granularity={granularity} events={view.data.events} what="written reviews" />
              <p className="mt-2 text-xs text-muted-foreground">Ratings that come with text. The stores send every one, so this goes back to your first review.</p>
            </div>
          ))}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="min-w-0">
          <SectionTitle
            title="Countries"
            hint={started ? `New ratings and the change in the average over the last ${view.rangeDays} days` : 'The rating in each country, as Growth last read it'}
          />
          {countries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No ratings by country yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="growth-ratings-countries">
                <thead className="border-b bg-muted/40 text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Country</th>
                    <th className="py-2 pr-3 text-right font-medium">Rating</th>
                    <th className="py-2 pr-3 text-right font-medium">Ratings</th>
                    <th className="py-2 pr-3 text-right font-medium">New</th>
                    <th className="py-2 pr-3 text-right font-medium">Change</th>
                    <th className="w-32 py-2 font-medium">Stars</th>
                  </tr>
                </thead>
                <tbody>
                  {countries.map((row) => (
                    <tr
                      key={row.territory}
                      className={cn('cursor-pointer border-b last:border-0 hover:bg-muted/50', row.territory === shownTerritory && 'bg-muted/60')}
                      onClick={() => setTerritory(row.territory === UNKNOWN_TERRITORY || row.territory === shownTerritory ? 'all' : row.territory)}
                      aria-selected={row.territory === shownTerritory}
                    >
                      <td className="px-3 py-2">{placeName(row.territory)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatRating(row.average)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.count === null ? 'n/a' : formatExact(row.count)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{started ? formatExact(row.newCount) : 'n/a'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.change === null ? (
                          <span className="text-muted-foreground">n/a</span>
                        ) : (
                          <span className={cn(row.change > 0.004 && 'text-[hsl(var(--growth-good))]', row.change < -0.004 && 'text-[hsl(var(--growth-bad))]')}>
                            {row.change > 0 ? '+' : ''}
                            {row.change.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="py-2">{row.stars ? <MiniStars stars={row.stars} /> : <span className="text-muted-foreground">n/a</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <SectionTitle title="By version" hint={play ? 'Written reviews of each version' : 'New ratings while each version was on sale'} />
          {play ? (
            <VersionReviews />
          ) : versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Shows after Growth has read your ratings on two days with a version on sale.</p>
          ) : (
            <ul className="space-y-2">
              {versions.slice(0, 8).map((entry) => (
                <li key={entry.version} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="font-medium">Version {entry.version}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {formatDay(entry.from)} to {formatDay(entry.to)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatExact(entry.newCount)} new{entry.newAverage !== null ? `, ${formatRating(entry.newAverage)} stars` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** A domain for a count chart that does not start at zero, so a slow climb shows. */
function undefinedDomain(values: Array<number | null>): [number, number] | undefined {
  const present = values.filter((value): value is number => typeof value === 'number');
  if (present.length === 0) return undefined;
  const low = Math.min(...present);
  const high = Math.max(...present);
  const pad = Math.max(1, Math.round((high - low) * 0.15));
  return [Math.max(0, low - pad), high + pad];
}

function HistoryWaits({ started }: { started: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-4 text-xs text-muted-foreground">
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {started
          ? `Growth read your ratings first on ${formatDay(started, { withYear: true })}. The chart fills in with each refresh, and new ratings show from the second day on.`
          : 'The stores keep no history of ratings, so Growth keeps its own from the next refresh on. New ratings show from the second day.'}
      </span>
    </div>
  );
}

function MiniStars({ stars }: { stars: StarCounts }) {
  const total = stars.reduce((sum, value) => sum + value, 0);
  if (total === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="flex h-2 w-28 overflow-hidden rounded-full bg-muted" title={[5, 4, 3, 2, 1].map((star) => `${star} stars: ${formatExact(stars[star - 1])}`).join(', ')}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className="h-full" style={{ width: `${(stars[star - 1] / total) * 100}%`, background: `hsl(var(--growth-star-${star}))` }} />
      ))}
    </span>
  );
}

/** Google Play's written reviews say which version the reviewer had. */
function VersionReviews() {
  const view = useGrowthView();
  const rows = useMemo(() => {
    const byVersion = new Map<string, { count: number; sum: number; newest: string }>();
    for (const review of view.data.reviews) {
      if (!review.appVersion) continue;
      const entry = byVersion.get(review.appVersion) ?? { count: 0, sum: 0, newest: '' };
      entry.count += 1;
      entry.sum += review.rating;
      if (review.createdDate > entry.newest) entry.newest = review.createdDate;
      byVersion.set(review.appVersion, entry);
    }
    return Array.from(byVersion.entries()).sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }));
  }, [view.data.reviews]);
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No written reviews with a version yet</p>;
  return (
    <ul className="space-y-2">
      {rows.slice(0, 8).map(([version, entry]) => (
        <li key={version} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium">Version {version}</span>
          <span className="tabular-nums">
            {formatExact(entry.count)} review{entry.count === 1 ? '' : 's'}, {formatRating(entry.sum / entry.count)} stars
          </span>
        </li>
      ))}
    </ul>
  );
}
