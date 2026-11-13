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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDay, previousWindow } from '@/lib/growth/dates';
import { formatCount, formatRate, formatRating } from '@/lib/growth/format';
import { confidenceBar, describeEvents, eventImpact, formatChange, type ImpactResult } from '@/lib/growth/impact';
import { confidenceSentence } from '@/lib/growth/insights';
import {
  METRICS,
  bySource,
  byTerritory,
  compareWindows,
  covers,
  feedStarts,
  dailySeries,
  metricValue,
  proceedsCurrency,
  relativeChange,
  smooth,
  type MetricId,
} from '@/lib/growth/metrics';
import { territoryName } from '@/lib/growth/territories';
import { SOURCE_LABELS, type SourceType, type TimelineEvent } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { BarList, Sparkline, TrendChart, formatMetricValue } from './GrowthCharts';
import { Delta, Panel, SectionTitle, ToneIcon, useGrowthView } from './GrowthShared';
import { InsightActions } from './GrowthInsights';

const TILE_METRICS: MetricId[] = ['impressions', 'pageViews', 'conversion', 'downloads', 'proceeds'];

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

  const ratingCount = view.data.ratings.reduce((sum, rating) => sum + rating.count, 0);
  const ratingAverage = ratingCount > 0 ? view.data.ratings.reduce((sum, rating) => sum + rating.average * rating.count, 0) / ratingCount : null;

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {TILE_METRICS.map((id) => {
          const spec = METRICS[id];
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
              title={`${spec.hint}. Show on the chart`}
            >
              <p className="truncate text-xs text-muted-foreground">{spec.label}</p>
              <p className="mt-1 text-xl font-semibold leading-none">{formatMetricValue(now, spec, currency)}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Delta change={relativeChange(now, then)} />
                <span className="text-[11px] text-muted-foreground">
                  {now === null
                    ? 'not reported yet'
                    : id === 'proceeds' && otherCurrencies > 0
                      ? `in ${currency}, plus ${otherCurrencies} other currenc${otherCurrencies === 1 ? 'y' : 'ies'}`
                      : comparable
                        ? 'vs period before'
                        : 'no full period before'}
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
          title="Star rating across the storefronts checked. Open the reviews"
        >
          <p className="truncate text-xs text-muted-foreground">Rating</p>
          <p className="mt-1 text-xl font-semibold leading-none">{ratingAverage === null ? 'n/a' : formatRating(ratingAverage)}</p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {ratingCount > 0 ? `${formatCount(ratingCount)} ratings in ${view.data.ratings.length} storefronts` : 'No ratings checked yet'}
          </p>
        </button>
      </div>

      <Panel>
        <SectionTitle
          title={`${METRICS[metric].label} by day`}
          hint={METRICS[metric].hint}
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
                <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Metric on the chart">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(METRICS) as MetricId[]).map((id) => (
                    <SelectItem key={id} value={id} className="text-xs">
                      {METRICS[id].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
        />
        <TrendChart
          points={series}
          metric={METRICS[metric]}
          currency={currency}
          events={view.data.events}
          showPrevious={showPrevious}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <SectionTitle
            title="Worth your attention"
            actions={
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => view.goTo('insights')}>
                All insights
                <ArrowRightIcon className="ml-1 h-3.5 w-3.5" />
              </Button>
            }
          />
          {view.insights.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing stands out in the numbers right now.</p>
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
          <SectionTitle title="How people find the app" hint="First-time downloads by where they started" />
          <BarList
            rows={sources.slice(0, 6).map((row) => ({
              key: row.key,
              label: SOURCE_LABELS[row.key as SourceType] ?? row.key,
              value: row.totals.downloads,
              display: formatCount(row.totals.downloads),
              sub: row.totals.conversion !== null ? `${formatRate(row.totals.conversion)} conversion` : undefined,
            }))}
            emptyText="Sources need App Analytics, which this app has not reported yet"
          />
        </Panel>

        <Panel>
          <SectionTitle
            title="Top storefronts"
            actions={
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => view.goTo('markets')}>
                All storefronts
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
      <p className="text-sm font-medium">No numbers for this app yet</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {statuses.sales.state === 'needs-setup'
          ? 'Add your vendor number on the Connection tab to load downloads and proceeds from Sales and Trends. They arrive in minutes, while App Analytics takes a day or two.'
          : view.data.lastSync && (statuses.sales.state === 'ok' || statuses.sales.state === 'empty')
            ? // Synced, and Sales and Trends answered: an app with no downloads in
              // the days read (not released yet, or off sale) has nothing to
              // show. How far back those days go is the history setting's
              // choice, so the sentence names the date rather than "a year".
              `Sales and Trends has no downloads of this app${statuses.sales.since ? ` since ${formatDay(statuses.sales.since, { withYear: true })}` : ' yet'}. Its numbers start here with its first download.`
            : 'Sync the app to load its numbers. Sales and Trends arrives in minutes; App Analytics, which has impressions and conversion, takes a day or two the first time.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={() => view.goTo('connect')}>
          Connection
        </Button>
        <Button size="sm" variant="outline" onClick={() => view.goTo('reviews')}>
          Reviews
        </Button>
        <Button size="sm" variant="outline" onClick={() => view.goTo('listing')}>
          Listing
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
  'too-early': 'Measuring',
  'not-live': 'Not live yet',
  'no-data': 'No data',
};

function ImpactHero({ event, impact }: { event: TimelineEvent | null; impact: ImpactResult | null }) {
  const view = useGrowthView();
  if (!event || !impact) {
    return (
      <Panel className="flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
        <SparklesIcon className="h-6 w-6 shrink-0 text-[hsl(var(--growth-highlight))]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">See whether your next screenshots sell better</p>
          <p className="text-xs text-muted-foreground">
            Upload a set from the editor and this page compares the conversion rate before and after it goes live, with a
            significance test so day to day noise is not mistaken for a win.
          </p>
        </div>
        <Button size="sm" onClick={view.onPublish}>
          <UploadCloudIcon className="mr-1.5 h-4 w-4" />
          Upload screenshots
        </Button>
      </Panel>
    );
  }
  const measuredRate = impact.measure === 'conversion';
  const format = (value: number | null) => (measuredRate ? formatRate(value) : formatCount(value));
  const days = Math.min(14, impact.daysAfter);
  const tone = impact.verdict === 'better' ? 'good' : impact.verdict === 'worse' ? 'problem' : 'neutral';
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
            {VERDICT_TEXT[impact.verdict]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {event.detail ?? event.title}. Uploaded {formatDay(event.date)}
          {event.version ? ` to version ${event.version}` : ''}
          {impact.liveDate ? `, live since ${formatDay(impact.liveDate)}` : ''}.
        </p>
        {impact.verdict === 'not-live' ? (
          <p className="text-xs">
            Waiting for version {event.version} to be released. The comparison starts the day it is on the store.
          </p>
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
                <p className="text-[11px] text-muted-foreground">{measuredRate ? 'conversion rate' : 'downloads per day'}</p>
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
                  ? `Also in these weeks: ${describeEvents(impact.others)}. They can move the numbers too.`
                  : 'A before and after comparison, so a feature, a sale or a season can move it too.'}
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
        {view.aiAvailable && impact.verdict !== 'not-live' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              view.goTo('ask', {
                question: `My new screenshots went live on ${formatDay(impact.liveDate ?? event.date)}. Did they work, and what should I test next?`,
              })
            }
          >
            <SparklesIcon className="mr-1.5 h-4 w-4" />
            Ask AI
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** For the timeline: the same before and after, as one line. */
export function impactLine(impact: ImpactResult): string {
  if (impact.verdict === 'not-live') return 'Not on the store yet';
  if (impact.verdict === 'no-data') return 'No numbers around this date';
  const measured = impact.measure === 'conversion' ? 'Conversion' : 'Downloads a day';
  const format = (value: number | null) => (impact.measure === 'conversion' ? formatRate(value) : formatCount(value));
  const days = impact.daysAfter > 0 ? `, ${Math.min(impact.daysAfter, 14)} days after` : '';
  return `${measured} ${format(impact.beforeRate)} to ${format(impact.afterRate)} (${formatChange(impact.change)})${days}`;
}
