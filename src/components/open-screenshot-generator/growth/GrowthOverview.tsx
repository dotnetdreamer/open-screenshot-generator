"use client";

// The first screen: did the latest screenshots work, the headline numbers
// against the period before, the chosen metric over time with the timeline on
// it, and the three insights that matter most right now.

import React, { useMemo, useState } from 'react';
import {
  ArrowRightIcon,
  FolderOpenIcon,
  ImagesIcon,
  SparklesIcon,
  UploadCloudIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDay, previousWindow, today } from '@/lib/growth/dates';
import { markEventLive } from '@/lib/growth/events';
import { formatCount, formatPerDay, formatRate, formatRating } from '@/lib/growth/format';
import { confidenceBar, describeEvents, eventImpact, formatChange, type ImpactResult } from '@/lib/growth/impact';
import { confidenceSentence } from '@/lib/growth/insights';
import {
  bySource,
  byTerritory,
  compareWindows,
  covers,
  feedStarts,
  dailySeries,
  metricSpec,
  metricValue,
  proceedsCurrency,
  relativeChange,
  smooth,
  storeMetrics,
  type MetricId,
} from '@/lib/growth/metrics';
import { ratingSummary } from '@/lib/growth/ratings';
import type { GrowthStore } from '@/lib/growth/stores';
import { territoryName } from '@/lib/growth/territories';
import { sourceLabel, type TimelineEvent } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { BarList, Sparkline, TrendChart, formatMetricValue } from './GrowthCharts';
import { Delta, Gated, Panel, SectionTitle, ToneIcon, useGrowthView } from './GrowthShared';
import { InsightActions } from './GrowthInsights';

const TILE_METRICS: Record<GrowthStore, MetricId[]> = {
  appstore: ['impressions', 'pageViews', 'conversion', 'downloads', 'proceeds'],
  // Google Play sends Growth no times seen and no earnings.
  playstore: ['pageViews', 'pageConversion', 'downloads', 'updates'],
};

export function GrowthOverview() {
  const view = useGrowthView();
  const [metric, setMetric] = useState<MetricId>('downloads');
  const [showPrevious, setShowPrevious] = useState(true);
  const [smoothed, setSmoothed] = useState(false);

  const comparison = useMemo(() => compareWindows(view.byDate, view.window), [view.byDate, view.window]);
  const starts = useMemo(() => feedStarts(view.data.records), [view.data.records]);
  // One currency for both periods: each picking its own would put this
  // period's yen beside the last one's dollars under one symbol.
  const currency = proceedsCurrency(comparison.current, comparison.previous);
  const otherCurrencies = new Set(
    [...Object.keys(comparison.current.proceeds), ...Object.keys(comparison.previous.proceeds)].filter((code) => code !== currency)
  ).size;

  const series = useMemo(() => {
    const current = dailySeries(view.byDate, view.window, metric, {}, currency);
    const before = dailySeries(view.byDate, previousWindow(view.window), metric, {}, currency);
    const shaped = smoothed ? smooth(current) : current;
    const shapedBefore = smoothed ? smooth(before) : before;
    return shaped.map((point, index) => ({ ...point, previous: shapedBefore[index]?.value ?? null }));
  }, [view.byDate, view.window, metric, currency, smoothed]);

  const rating = ratingSummary(view.data.ratings);
  const play = view.store === 'playstore';

  const sources = useMemo(() => bySource(view.byDate, view.window), [view.byDate, view.window]);
  const territories = useMemo(() => byTerritory(view.byDate, view.window).slice(0, 6), [view.byDate, view.window]);

  const latestShots = useMemo(
    () => [...view.data.events].filter((event) => event.kind === 'screenshots').sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [view.data.events]
  );
  const impact = useMemo(
    () => (latestShots && view.latest ? eventImpact(view.byDate, latestShots, { latest: view.latest, events: view.data.events }) : null),
    [latestShots, view.byDate, view.latest, view.data.events]
  );

  if (view.data.records.length === 0) return <NoNumbersYet />;

  return (
    <div className="space-y-4">
      <ImpactHero event={latestShots} impact={impact} />

      <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3', play ? 'xl:grid-cols-5' : 'xl:grid-cols-6')}>
        {TILE_METRICS[view.store].map((id) => {
          const spec = metricSpec(id, view.store);
          const now = metricValue(comparison.current, id, currency);
          // Only beside a period the history reaches all the way back over: one
          // that starts before the data does would make any period look like a leap.
          const comparable = covers(starts, id, comparison.previousWindow);
          const then = comparable ? metricValue(comparison.previous, id, currency) : null;
          const points = dailySeries(view.byDate, view.window, id, {}, currency).map((point) => point.value);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMetric(id)}
              className={cn(
                'rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50',
                metric === id && 'border-[hsl(var(--growth-series))] ring-1 ring-[hsl(var(--growth-series))]'
              )}
              title={`${spec.hint}. Show ${spec.label.toLowerCase()} on the chart`}
            >
              <p className="truncate text-xs text-muted-foreground">{spec.label}</p>
              <p className="mt-1 text-xl font-semibold leading-none">{formatMetricValue(now, spec, currency)}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Delta change={relativeChange(now, then)} />
                <span className="text-[11px] text-muted-foreground">
                  {now === null
                    ? 'no numbers yet'
                    : id === 'proceeds' && otherCurrencies > 0
                      ? `in ${currency}, plus ${otherCurrencies} other currenc${otherCurrencies === 1 ? 'y' : 'ies'}`
                      : comparable
                        ? 'vs period before'
                        : 'nothing to compare yet'}
                </span>
              </div>
              <Sparkline values={points} className="mt-2" />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => view.goTo('reviews')}
          className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50"
          title={play ? "Average star rating from Google's report files. Open the reviews" : 'Star rating in the countries checked. Open the reviews'}
        >
          <p className="truncate text-xs text-muted-foreground">Rating</p>
          <p className="mt-1 text-xl font-semibold leading-none">{rating.average === null ? 'n/a' : formatRating(rating.average)}</p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {rating.count !== null
              ? `${formatCount(rating.count)} rating${rating.count === 1 ? '' : 's'} in ${rating.countries} ${rating.countries === 1 ? 'country' : 'countries'}`
              : rating.average !== null
                ? 'Average of all ratings'
                : 'No ratings loaded yet'}
          </p>
        </button>
      </div>

      <Panel>
        <SectionTitle
          title={`${metricSpec(metric, view.store).label} by day`}
          hint={metricSpec(metric, view.store).hint}
          actions={
            <>
              <div className="flex items-center gap-1.5">
                <Switch id="growth-prev" checked={showPrevious} onCheckedChange={setShowPrevious} />
                <Label htmlFor="growth-prev" className="text-xs font-normal">
                  Period before
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch id="growth-smooth" checked={smoothed} onCheckedChange={setSmoothed} />
                <Label htmlFor="growth-smooth" className="text-xs font-normal">
                  7 day average
                </Label>
              </div>
              <Select value={metric} onValueChange={(value) => setMetric(value as MetricId)}>
                <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="What the chart shows">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {storeMetrics(view.store).map((id) => (
                    <SelectItem key={id} value={id} className="text-xs">
                      {metricSpec(id, view.store).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
        />
        <TrendChart
          points={series}
          metric={metricSpec(metric, view.store)}
          currency={currency}
          events={view.data.events}
          showPrevious={showPrevious}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <SectionTitle
            title="Top insights"
            actions={
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => view.goTo('insights')}>
                All insights
                <ArrowRightIcon className="ml-1 h-3.5 w-3.5" />
              </Button>
            }
          />
          {view.insights.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing needs your attention right now.</p>
          ) : (
            <ul className="space-y-3">
              {view.insights.slice(0, 3).map((insight) => (
                <li key={insight.id} className="flex gap-2">
                  <ToneIcon tone={insight.tone} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{insight.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{insight.body}</p>
                    <InsightActions insight={insight} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <SectionTitle
            title="How people find your app"
            hint={play ? 'Downloads from your page, by where people came from' : 'New downloads by where people came from'}
          />
          <BarList
            rows={sources.slice(0, 6).map((row) => {
              // Google Play splits only the page's visits and downloads by source.
              const value = play ? row.totals.pageDownloads : row.totals.downloads;
              const rate = play ? row.totals.pageConversion : row.totals.conversion;
              return {
                key: row.key,
                label: sourceLabel(row.key, view.store),
                value,
                display: formatCount(value),
                sub: rate !== null ? `${formatRate(rate)} download rate` : undefined,
              };
            })}
            emptyText={play ? "Google's report files have no traffic sources for your app yet" : 'App Analytics has not sent numbers for your app yet'}
          />
        </Panel>

        <Panel>
          <SectionTitle
            title="Top countries"
            actions={
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => view.goTo('markets')}>
                All countries
                <ArrowRightIcon className="ml-1 h-3.5 w-3.5" />
              </Button>
            }
          />
          <BarList
            rows={territories.map((row) => ({
              key: row.key,
              label: territoryName(row.key),
              value: row.totals.downloads,
              display: formatCount(row.totals.downloads),
              sub: <Delta change={row.change} />,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

function NoNumbersYet() {
  const view = useGrowthView();
  const statuses = view.data.status;
  return (
    <Panel className="flex flex-col items-center gap-3 py-10 text-center">
      <ImagesIcon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">No numbers for your app yet</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {view.store === 'playstore'
          ? statuses.analytics.state === 'needs-setup'
            ? "Add your Cloud Storage URI under Setup. Google then sends your downloads, page visits and ratings from Google's monthly report files."
            : statuses.analytics.state === 'forbidden' || statuses.analytics.state === 'error'
              ? statuses.analytics.message
              : view.data.lastSync
                ? "Google's report files have no numbers for your app yet. Google adds each day's numbers about a week later."
                : "Refresh to load your numbers. Google adds each day's numbers to Google's report files about a week later."
          : statuses.sales.state === 'needs-setup'
          ? 'Add your vendor number under Setup. Then downloads and earnings from Sales and Trends arrive in a few minutes. App Analytics (times seen and download rate) takes a day or two.'
          : view.data.lastSync && (statuses.sales.state === 'ok' || statuses.sales.state === 'empty')
            ? // Synced, and Sales and Trends answered: an app with no downloads in
              // the days read (not released yet, or off sale) has nothing to
              // show. How far back those days go is the history setting's
              // choice, so the sentence names the date rather than "a year".
              `Sales and Trends has no downloads of your app${statuses.sales.since ? ` since ${formatDay(statuses.sales.since, { withYear: true })}` : ' yet'}. Growth shows your numbers after the first download.`
            : 'Refresh to load your numbers. Sales and Trends (downloads and earnings) arrives in a few minutes. App Analytics (times seen and download rate) takes a day or two the first time.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={() => view.goTo('connect')}>
          Setup
        </Button>
        <Button size="sm" variant="outline" onClick={() => view.goTo('reviews')}>
          Reviews
        </Button>
        <Button size="sm" variant="outline" onClick={() => view.goTo('listing')}>
          Store page
        </Button>
      </div>
    </Panel>
  );
}

// What the numbers did, not why: a before and after comparison cannot say the
// screenshots caused it (impact.ts).
const VERDICT_TEXT: Record<ImpactResult['verdict'], string> = {
  better: 'Up',
  worse: 'Down',
  flat: 'About the same',
  'too-early': 'Not sure yet',
  'not-live': 'Not live yet',
  'no-data': 'No numbers',
};

function verdictText(verdict: ImpactResult['verdict'], store: GrowthStore): string {
  // "Not in the App Store yet", "Not on Google Play yet".
  if (verdict === 'not-live') return store === 'playstore' ? 'Not on Google Play yet' : 'Not in the App Store yet';
  return VERDICT_TEXT[verdict];
}

/**
 * Google Play: when the new screenshots went live. Google checks them first,
 * which can take up to a week, and no API says when it is done, so the user
 * can set the day, which the comparison then starts from (impact.ts).
 */
function LiveDayControl({ event, waiting }: { event: TimelineEvent; waiting: boolean }) {
  const view = useGrowthView();
  // The day Growth counts from now: the one set, else the upload day, else none while Play holds them.
  const current = event.liveDate ?? (waiting ? null : event.date);
  const [day, setDay] = useState(current ?? today());
  const [saving, setSaving] = useState(false);
  const valid = day >= event.date && day <= today();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`growth-live-${event.id}`} className="text-[11px] text-muted-foreground">
        {waiting ? 'Day the new screenshots went live' : 'Day the new screenshots went live, if Google took longer'}
      </label>
      <Input
        id={`growth-live-${event.id}`}
        type="date"
        value={day}
        min={event.date}
        max={today()}
        onChange={(change) => setDay(change.target.value)}
        className="h-7 w-[150px] text-xs"
      />
      <Gated reason={view.blocked.app}>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={!valid || saving || day === current}
          onClick={() => {
            setSaving(true);
            void markEventLive(event, day)
              .catch((error) => console.error('The live day could not be saved', error))
              .finally(() => setSaving(false));
          }}
        >
          Save the day
        </Button>
      </Gated>
    </div>
  );
}

function ImpactHero({ event, impact }: { event: TimelineEvent | null; impact: ImpactResult | null }) {
  const view = useGrowthView();
  if (!event || !impact) {
    return (
      <Panel className="flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
        <SparklesIcon className="h-6 w-6 shrink-0 text-[hsl(var(--growth-highlight))]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">See if your next screenshots get more downloads</p>
          <p className="text-xs text-muted-foreground">
            Upload new screenshots from the editor. Growth then compares your downloads before and after the new screenshots go live.
          </p>
        </div>
        <Button size="sm" onClick={view.onPublish}>
          <UploadCloudIcon className="mr-1.5 h-4 w-4" />
          Upload screenshots
        </Button>
      </Panel>
    );
  }
  const measuredRate = impact.measure !== 'downloads';
  const format = (value: number | null) => (measuredRate ? formatRate(value) : formatPerDay(value));
  const days = Math.min(14, impact.daysAfter);
  const tone = impact.verdict === 'better' ? 'good' : impact.verdict === 'worse' ? 'problem' : 'neutral';
  const play = view.store === 'playstore';
  return (
    <Panel
      className={cn(
        'grid gap-4 md:grid-cols-[1fr_auto]',
        impact.verdict === 'better' && 'border-[hsl(var(--growth-good))]/40',
        impact.verdict === 'worse' && 'border-[hsl(var(--growth-bad))]/40'
      )}
      data-testid="growth-impact"
    >
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToneIcon tone={tone} />
          <p className="text-sm font-semibold">Did the new screenshots work?</p>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              tone === 'good' && 'bg-[hsl(var(--growth-good))]/10 text-[hsl(var(--growth-good))]',
              tone === 'problem' && 'bg-[hsl(var(--growth-bad))]/10 text-[hsl(var(--growth-bad))]',
              tone === 'neutral' && 'bg-muted text-muted-foreground'
            )}
          >
            {verdictText(impact.verdict, view.store)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {event.detail ?? event.title}. Uploaded {formatDay(event.date)}
          {event.version ? ` to version ${event.version}` : ''}
          {impact.liveDate ? `, ${play ? 'on Google Play' : 'in the App Store'} since ${formatDay(impact.liveDate)}` : ''}.
        </p>
        {play && (
          <p className="text-[11px] text-muted-foreground">
            {event.waitsForReview && !event.liveDate
              ? 'Google Play holds the new screenshots until you send the changes for review in Play Console. Google then checks the new screenshots, which can take up to a week.'
              : event.liveDate
                ? 'Growth compares your numbers before and after the day you set.'
                : 'Google checks new screenshots before people see the new screenshots, which can take up to a week. Growth counts from the upload day.'}
          </p>
        )}
        {play && event.kind === 'screenshots' && <LiveDayControl event={event} waiting={!!event.waitsForReview && !event.liveDate} />}
        {impact.verdict === 'not-live' ? (
          play ? null : (
            <p className="text-xs">
              Waiting for version {event.version} to be released. Growth then compares your numbers before and after the release day.
            </p>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Before</p>
                <p className="text-2xl font-semibold">{format(impact.beforeRate)}</p>
              </div>
              <ArrowRightIcon className="mb-2 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">After</p>
                <p className="text-2xl font-semibold">{format(impact.afterRate)}</p>
              </div>
              <div className="pb-1">
                <Delta change={impact.change} className="text-sm" />
                <p className="text-[11px] text-muted-foreground">{measuredRate ? 'download rate' : 'downloads per day'}</p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-[hsl(var(--growth-highlight))]" style={{ width: `${(days / 14) * 100}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {days} of 14 days measured. {confidenceSentence(impact.confidence, confidenceBar(impact.daysAfter))}
              </p>
              <p className="text-[11px] text-muted-foreground" data-testid="growth-impact-others">
                {impact.others.length > 0
                  ? `Events in the same weeks can change your numbers too: ${describeEvents(impact.others)}.`
                  : 'A sale or the time of year can also change your numbers.'}
              </p>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-row flex-wrap items-start gap-2 md:flex-col md:items-stretch">
        {event.projectId && view.onOpenProject && (
          <Button size="sm" variant="outline" onClick={() => view.onOpenProject?.(event.projectId!)}>
            <FolderOpenIcon className="mr-1.5 h-4 w-4" />
            Open the project
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => view.goTo('timeline', { eventId: event.id })}>
          Timeline
        </Button>
        {impact.verdict !== 'not-live' && (
          <Gated reason={view.aiAvailable || view.onAskAgent ? null : view.blocked.ai}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                view.goTo('ask', {
                  question: `My new screenshots went live on ${formatDay(impact.liveDate ?? event.date)}. Did the new screenshots work, and what should I test next?`,
                })
              }
            >
              <SparklesIcon className="mr-1.5 h-4 w-4" />
              Ask AI
            </Button>
          </Gated>
        )}
      </div>
    </Panel>
  );
}

/** For the timeline: the same before and after, as one line. */
export function impactLine(impact: ImpactResult, store: GrowthStore = 'appstore'): string {
  if (impact.verdict === 'not-live') return verdictText('not-live', store);
  if (impact.verdict === 'no-data') return 'No numbers around the event date';
  const rate = impact.measure !== 'downloads';
  const measured = rate ? 'Download rate' : 'Downloads a day';
  const format = (value: number | null) => (rate ? formatRate(value) : formatPerDay(value));
  const days = impact.daysAfter > 0 ? `, ${Math.min(impact.daysAfter, 14)} days after the event` : '';
  return `${measured} ${format(impact.beforeRate)} to ${format(impact.afterRate)} (${formatChange(impact.change)})${days}`;
}
