"use client";

// App health on the Ratings screen (src/lib/growth/health.ts): crashes and
// freezes on the same timeline as the ratings, the reviews that mention
// crashes under them, a sentence when a version changed things, and every
// version in a table.
//
// The health chart sits in the ratings panel, under the chart the toggle
// shows, with the same buckets, margins and axis width, and the same syncId,
// so a week on one chart is the week under it on the other, and the pointer
// shows both. Choosing a version shades its days on every chart. Each store's
// numbers stay in its own words: per 1,000 sessions on the App Store, a share
// of users on Google Play, never one turned into the other.

import React from 'react';
import { AlertTriangleIcon, CheckCircle2Icon, ExternalLinkIcon, HeartPulseIcon } from 'lucide-react';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { formatDay } from '@/lib/growth/dates';
import { openExternal } from '@/lib/desktop';
import { formatExact, formatRating, plural } from '@/lib/growth/format';
import {
  buildName,
  crashChange,
  crashWords,
  freezeWords,
  GOOGLE_CRASH_LINE,
  GOOGLE_FREEZE_LINE,
  healthTicks,
  partial,
  steady,
  timesWords,
  type AppHealth,
  type HealthBucket,
  type HealthFinding,
  type HealthStore,
  type VersionRow,
} from '@/lib/growth/health';
import type { RatingGranularity } from '@/lib/growth/ratingHistory';
import type { FeedStatus, TimelineEvent } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { AXIS, Legend, appColor, bandArea, bandShade, bucketLabel, releaseLines, type ChartBand } from './GrowthRatingCharts';
import { Panel, SectionTitle } from './GrowthShared';

const CRASH_COLOR = appColor(0);
const FREEZE_COLOR = appColor(1);
const LINE_COLOR = 'hsl(var(--muted-foreground))';

/** Google Play's builds have no release dates: a version's first day with users marks it on the charts instead. */
export function versionMarks(appId: string, rows: VersionRow[]): TimelineEvent[] {
  return rows
    .filter((row) => row.health)
    .map((row) => {
      const named = versionWords(row);
      return { id: `health:${row.key}`, appId, date: row.from, kind: 'release' as const, title: named.charAt(0).toUpperCase() + named.slice(1), origin: 'auto' as const, version: row.name, createdAt: 0 };
    });
}

/** Where the numbers come from, in the store's own terms. */
function SourceTip({ store }: { store: HealthStore }) {
  return (
    <InfoTip label="Where the crash numbers come from">
      {store === 'appstore' ? (
        <>
          <p>From App Analytics: crashes for every 1,000 sessions, counting only people who share analytics with developers.</p>
          <p>Apple sends crash numbers only once at least five of those people had a crash, so a small app can have none. The numbers cover every country.</p>
          <p>Freezes are Xcode&apos;s hang rate for your newest versions, in the versions table.</p>
        </>
      ) : (
        <>
          <p>From Android vitals: the share of people who had a crash, or a freeze of the app, while using it each day.</p>
          <p>Google&apos;s lines are 1.09% for crashes and 0.47% for freezes. Above them, Google Play can show your app to fewer people. The numbers cover every country.</p>
        </>
      )}
    </InfoTip>
  );
}

/** What the health chart says when it has no numbers to draw. */
function HealthWaits({ status, owner, health }: { status: FeedStatus; owner: string; health: AppHealth | null }) {
  const hasAny = !!health && Object.keys(health.days).length > 0;
  const text =
    status.state === 'needs-setup' || status.state === 'forbidden' || status.state === 'empty' || status.state === 'error'
      ? status.message ?? `${owner} has sent no crash numbers yet`
      : hasAny && health?.through
        ? `No crash numbers in these days. The newest are from ${formatDay(health.through, { withYear: true })}`
        : status.state === 'syncing'
          ? `Asking ${owner} for crash numbers`
          : `Crash numbers come with the next refresh`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted/50 px-3 py-3 text-xs text-muted-foreground" data-testid="growth-health-waits">
      <HeartPulseIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      {status.link && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void openExternal(status.link!.url)}>
          {status.link.label}
          <ExternalLinkIcon className="ml-1.5 h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/** Ratings with nothing to chart yet still says where the crash numbers stand, with the button that fixes their setup. */
export function HealthStatus({ store, owner, status, health }: { store: HealthStore; owner: string; status: FeedStatus; health: AppHealth | null }) {
  return (
    <Panel className="space-y-2" data-testid="growth-health-status">
      <p className="flex items-center gap-1 text-xs font-medium">
        App health
        <SourceTip store={store} />
      </p>
      <HealthWaits status={status} owner={owner} health={health} />
    </Panel>
  );
}

/** The reviews that mention crashes, one small bar per bucket, placed exactly under the chart's points or bars. */
function ReviewStrip({ buckets, granularity, scale, right }: { buckets: HealthBucket[]; granularity: RatingGranularity; scale: 'point' | 'band'; right: number }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.crashReviews));
  const total = buckets.reduce((sum, bucket) => sum + bucket.crashReviews, 0);
  const count = buckets.length;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Reviews that mention crashes</span>
        <span className="tabular-nums">{plural(total, 'review')}</span>
      </div>
      <ul className="relative h-7 border-b" style={{ marginLeft: 44, marginRight: right }} aria-label="Reviews that mention crashes">
        {buckets.map((bucket, index) => {
          const center = scale === 'band' ? ((index + 0.5) / count) * 100 : count > 1 ? (index / (count - 1)) * 100 : 50;
          const width = Math.max(3, Math.min(12, 240 / count));
          return (
            <li
              key={bucket.start}
              className="absolute bottom-0 -translate-x-1/2"
              style={{ left: `${center}%` }}
              title={`${bucketLabel(bucket.start, granularity, true)}: ${mentionWords(bucket.crashReviews)}`}
            >
              {bucket.crashReviews > 0 && (
                <span
                  className="block rounded-t-sm"
                  style={{ width, height: Math.max(3, (bucket.crashReviews / max) * 26), background: 'hsl(var(--growth-bad))' }}
                />
              )}
              <span className="sr-only">
                {bucketLabel(bucket.start, granularity, true)}: {bucket.crashReviews}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HealthTooltip({
  active,
  payload,
  store,
  granularity,
}: {
  active?: boolean;
  payload?: Array<{ payload: { bucket: HealthBucket } }>;
  store: HealthStore;
  granularity: RatingGranularity;
}) {
  if (!active || !payload?.length) return null;
  const { bucket } = payload[0].payload;
  const crash = bucket.crash;
  return (
    <div className="max-w-[280px] rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{bucketLabel(bucket.start, granularity, true)}</p>
      <p className="mt-1 flex items-center gap-2">
        <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: CRASH_COLOR }} />
        <span className="flex-1">Crashes</span>
        <span className="font-medium tabular-nums">{crash.rate === null ? 'n/a' : crashWords(store, crash.rate, { short: true })}</span>
      </p>
      {crash.rate !== null && (
        <p className="mt-0.5 text-muted-foreground">
          {store === 'appstore'
            ? `${formatExact(crash.events ?? 0)} in ${formatExact(crash.volume)} sessions`
            : `${formatExact(crash.volume)} people a day, added up`}
        </p>
      )}
      {partial(crash) && (
        <p className="mt-0.5 text-muted-foreground">
          {`Apple sent crash numbers for ${crash.coveredDays} of the ${plural(crash.days ?? 0, 'day')} with sessions`}
        </p>
      )}
      {bucket.freeze && (
        <p className="mt-1 flex items-center gap-2">
          <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: FREEZE_COLOR }} />
          <span className="flex-1">Freezes</span>
          <span className="font-medium tabular-nums">{bucket.freeze.rate === null ? 'n/a' : freezeWords(bucket.freeze.rate, { short: true })}</span>
        </p>
      )}
      <p className="mt-1 text-muted-foreground">
        {bucket.crashReviews > 0 ? mentionWords(bucket.crashReviews) : 'No reviews mention crashes'}
      </p>
    </div>
  );
}

/**
 * The health timeline, drawn under a ratings chart. `bars` matches a bar
 * chart above it (bars sit in bands, lines on points), so the columns line up.
 */
export function HealthTimeline({
  store,
  owner,
  health,
  status,
  buckets,
  granularity,
  events,
  band,
  syncId,
  bars,
  everyCountry = false,
}: {
  store: HealthStore;
  /** "Apple" or "Google". */
  owner: string;
  /** A country is picked above: say these numbers are for every country. */
  everyCountry?: boolean;
  health: AppHealth | null;
  status: FeedStatus;
  buckets: HealthBucket[];
  granularity: RatingGranularity;
  events: TimelineEvent[];
  band: ChartBand | null;
  syncId: string;
  bars: boolean;
}) {
  const factor = store === 'appstore' ? 1000 : 100;
  const data = buckets.map((bucket) => ({
    start: bucket.start,
    crash: bucket.crash.rate === null ? null : bucket.crash.rate * factor,
    freeze: bucket.freeze?.rate == null ? null : bucket.freeze.rate * 100,
    bucket,
  }));
  const hasCrash = data.some((row) => row.crash !== null);
  const hasFreeze = data.some((row) => row.freeze !== null);
  const anyReviews = buckets.some((bucket) => bucket.crashReviews > 0);
  const values = data.flatMap((row) => [row.crash, row.freeze]).filter((value): value is number => typeof value === 'number');
  const top = values.length ? Math.max(...values) : 0;
  // Google's lines show when the numbers come near them; far below, a sentence says so instead.
  const crashLine = store === 'playstore' && hasCrash && top >= GOOGLE_CRASH_LINE * 100 * 0.4;
  const freezeLine = store === 'playstore' && hasFreeze && top >= GOOGLE_FREEZE_LINE * 100 * 0.4;
  const ticks = healthTicks(Math.max(top * 1.15, crashLine ? GOOGLE_CRASH_LINE * 100 * 1.15 : 0, freezeLine ? GOOGLE_FREEZE_LINE * 100 * 1.15 : 0, store === 'appstore' ? 1 : 0.1));
  const lines = releaseLines(events, buckets);
  const area = bandArea(band, buckets, bars ? 'band' : 'point');
  const right = bars ? 8 : 12;
  const trimmed = (value: number) => (value >= 10 ? value.toFixed(0) : value.toFixed(2).replace(/\.?0+$/, ''));
  const format = (value: number) => (store === 'appstore' ? trimmed(value) : `${trimmed(value)}%`);
  const label = store === 'appstore' ? 'Crashes per 1,000 sessions' : 'People with a crash or a freeze';

  return (
    <div className="space-y-2 border-t pt-4" data-testid="growth-health-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs font-medium">
          <span>
            App health
            <span className="font-normal text-muted-foreground">
              {store === 'appstore' ? ', crashes per 1,000 sessions' : ', share of people'}
              {everyCountry ? ', every country' : ''}
            </span>
          </span>
          <SourceTip store={store} />
        </p>
        {hasCrash && (
          <Legend
            items={[
              { label: 'Crashes', color: CRASH_COLOR, dashed: true },
              ...(hasFreeze ? [{ label: 'Freezes', color: FREEZE_COLOR, dashed: true }] : []),
              ...(crashLine || freezeLine ? [{ label: "Google's lines", color: LINE_COLOR, dashed: true }] : []),
            ]}
          />
        )}
      </div>
      {hasCrash ? (
        <div style={{ height: 170 }} role="img" aria-label={`${label} per ${granularity}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 16, right, bottom: 0, left: 0 }} syncId={syncId} syncMethod="value">
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
              <XAxis
                dataKey="start"
                scale={bars ? 'band' : 'point'}
                tickFormatter={(value: string) => bucketLabel(value, granularity)}
                tick={AXIS}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                minTickGap={24}
              />
              <YAxis domain={[0, ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={format} tick={AXIS} tickLine={false} axisLine={false} width={44} />
              <Tooltip cursor={{ stroke: 'hsl(var(--border))' }} content={<HealthTooltip store={store} granularity={granularity} />} />
              {bandShade(area, band?.label ?? '', lines)}
              {lines.map((line) => (
                <ReferenceLine
                  key={line.id}
                  x={line.x}
                  stroke={LINE_COLOR}
                  strokeDasharray="3 3"
                  strokeOpacity={0.6}
                  label={{ value: line.label, position: 'insideTopLeft', fontSize: 10, fill: LINE_COLOR, offset: 4 }}
                />
              ))}
              {crashLine && (
                <ReferenceLine
                  y={GOOGLE_CRASH_LINE * 100}
                  stroke={LINE_COLOR}
                  strokeDasharray="6 4"
                  label={{ value: "Google's line for crashes", position: 'insideTopRight', fontSize: 10, fill: LINE_COLOR }}
                />
              )}
              {freezeLine && (
                <ReferenceLine
                  y={GOOGLE_FREEZE_LINE * 100}
                  stroke={LINE_COLOR}
                  strokeDasharray="2 4"
                  label={{ value: "Google's line for freezes", position: 'insideBottomRight', fontSize: 10, fill: LINE_COLOR }}
                />
              )}
              <Line type="monotone" dataKey="crash" name="Crashes" stroke={CRASH_COLOR} strokeWidth={2} dot={data.filter((row) => row.crash !== null).length < 3 ? { r: 4, fill: CRASH_COLOR, strokeWidth: 0 } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} connectNulls isAnimationActive={false} />
              {hasFreeze && (
                <Line type="monotone" dataKey="freeze" name="Freezes" stroke={FREEZE_COLOR} strokeWidth={2} dot={data.filter((row) => row.freeze !== null).length < 3 ? { r: 4, fill: FREEZE_COLOR, strokeWidth: 0 } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} connectNulls isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <HealthWaits status={status} owner={owner} health={health} />
      )}
      {hasCrash && store === 'playstore' && !crashLine && (
        <p className="text-[11px] text-muted-foreground">Well under Google&apos;s lines of 1.09% for crashes and 0.47% for freezes.</p>
      )}
      {(hasCrash || anyReviews) && <ReviewStrip buckets={buckets} granularity={granularity} scale={bars ? 'band' : 'point'} right={right} />}
    </div>
  );
}

/** The one sentence worth reading first, when a version changed how often the app crashes or freezes. */
export function HealthFindingCard({
  store,
  finding,
  rating,
  crashReviewIds,
  since,
  shown,
  onShow,
  onReadReviews,
}: {
  store: HealthStore;
  finding: HealthFinding;
  rating: { before: number | null; now: number | null };
  /** The version's reviews that mention crashes, and the first day of its time (its release, where known). */
  crashReviewIds: string[];
  since: string;
  /** The version is the one shaded on the charts. */
  shown: boolean;
  onShow: () => void;
  onReadReviews: (ids: string[]) => void;
}) {
  const { version, previous, before, after, measure, kind, overLine } = finding;
  const worse = kind === 'worse';
  const v = shortName(version);
  const named = versionWords(version);
  const Named = named.charAt(0).toUpperCase() + named.slice(1);
  const title =
    measure === 'crash'
      ? overLine
        ? `${Named} is over Google's line for crashes`
        : worse
          ? `Crashes went up with ${named}`
          : `${Named} crashes less`
      : overLine
        ? `${Named} is over Google's line for freezes`
        : worse
          ? `Freezes went up with ${named}`
          : `${Named} freezes less`;
  const times = worse ? timesWords(after, before) : null;
  const what = measure === 'crash' ? 'a crash' : 'the app freeze';
  const first =
    store === 'appstore'
      ? `${crashWords(store, after)} on ${v}, ${worse ? 'up' : 'down'} from ${crashWords(store, before, { short: true })} on ${shortName(previous)}.`
      : `${shareWords(after)} of people using ${v} had ${what}, ${worse ? 'up' : 'down'} from ${shareWords(before)} on ${shortName(previous)}${times ? `, ${times} as many` : ''}.`;
  const line = overLine ? ` Google's line is ${measure === 'crash' ? '1.09%' : '0.47%'}; above it, Google Play can show your app to fewer people.` : '';
  const reviews = crashReviewIds.length > 0 ? ` ${plural(crashReviewIds.length, 'review')} since ${formatDay(since)} ${crashReviewIds.length === 1 ? 'mentions' : 'mention'} crashes.` : '';
  const ratingMoved = rating.before !== null && rating.now !== null && Math.abs(rating.now - rating.before) >= 0.05;
  const ratingText = ratingMoved ? ` Your rating went from ${formatRating(rating.before)} to ${formatRating(rating.now)} since then.` : '';
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-lg border p-4',
        worse ? 'border-[hsl(var(--growth-bad))]/40 bg-[hsl(var(--growth-bad))]/5' : 'border-[hsl(var(--growth-good))]/40 bg-[hsl(var(--growth-good))]/5'
      )}
      data-testid="growth-health-finding"
      role="status"
    >
      {worse ? (
        <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--growth-bad))]" aria-hidden />
      ) : (
        <CheckCircle2Icon className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--growth-good))]" aria-hidden />
      )}
      <div className="min-w-[220px] flex-1 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          {first}
          {line}
          {reviews}
          {ratingText}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-8 text-xs" aria-pressed={shown} onClick={onShow}>
          {shown ? `Hide ${v} on the charts` : `Show ${v} on the charts`}
        </Button>
        {crashReviewIds.length > 0 && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onReadReviews(crashReviewIds)}>
            Read the {plural(crashReviewIds.length, 'review')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A version in a sentence: "version 2.4", or "build 205" while Google Play's version for the build is not known. */
function versionWords(entry: { name: string; build: string | null }): string {
  return entry.build && entry.name === buildName(entry.build) ? `build ${entry.build}` : `version ${entry.name}`;
}
/** The same, short: "2.4", or "build 205". */
function shortName(entry: { name: string; build: string | null }): string {
  return entry.build && entry.name === buildName(entry.build) ? `build ${entry.build}` : entry.name;
}
/** When a version came out, or when the store saw it, in words that say which (VersionRow). */
function datesWords(row: VersionRow): string {
  if (row.released) return `Released ${formatDay(row.released)}`;
  if (!row.seen) return '';
  return row.seen.from === row.seen.to ? `Seen ${formatDay(row.seen.from)}` : `Seen ${formatDay(row.seen.from)} to ${formatDay(row.seen.to)}`;
}

/** "1 review mentions crashes", "3 reviews mention crashes". */
function mentionWords(count: number): string {
  return `${plural(count, 'review')} ${count === 1 ? 'mentions' : 'mention'} crashes`;
}

/** A Google Play share, crashes or freezes alike: "2.1%". */
function shareWords(rate: number): string {
  return freezeWords(rate, { short: true });
}

function ChangeNote({ store, change }: { store: HealthStore; change: NonNullable<ReturnType<typeof crashChange>> }) {
  if (change.kind === 'over-line') {
    return <span className="rounded-full bg-[hsl(var(--growth-bad))]/10 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--growth-bad))]">Over Google&apos;s line</span>;
  }
  const worse = change.kind === 'worse';
  const times = worse ? timesWords(change.after, change.before) : null;
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        worse ? 'bg-[hsl(var(--growth-bad))]/10 text-[hsl(var(--growth-bad))]' : 'bg-[hsl(var(--growth-good))]/10 text-[hsl(var(--growth-good))]'
      )}
      title={`${worse ? 'Up' : 'Down'} from ${crashWords(store, change.before)} on the version before`}
    >
      {worse ? (times ? `${times} the one before` : 'Up on the one before') : 'Down on the one before'}
    </span>
  );
}

/** Every version: when it was out, its ratings, how often it crashed and froze, and the reviews about crashes. */
export function HealthVersions({
  store,
  rows,
  hangUnit,
  hangSummary,
  selected,
  onSelect,
  onReadReviews,
}: {
  store: HealthStore;
  rows: VersionRow[];
  hangUnit: string | null;
  hangSummary: string | null;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onReadReviews: (ids: string[]) => void;
}) {
  const hangs = store === 'appstore' && rows.some((row) => row.health?.hang !== null && row.health?.hang !== undefined);
  return (
    <Panel className="min-w-0" data-testid="growth-health-versions">
      <SectionTitle
        title="Versions"
        hint={
          store === 'appstore'
            ? 'New ratings and crashes while each version was out. Pick one to see its days on the charts'
            : 'Written reviews, crashes and freezes of each version. Pick one to see its days on the charts'
        }
      />
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {store === 'appstore' ? 'Shows after Growth has read your ratings on two days with a version on sale, or once Apple sends crash numbers.' : 'Shows once Google sends crash numbers, or a written review names a version.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Versions, newest first</caption>
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="py-2 pr-3 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Dates
                    <InfoTip label="About the dates">
                      {store === 'appstore' ? (
                        <p>Released is the day the App Store put the version out. Seen is the first and the last day Apple counted people using it, or Growth saw it on sale. It shows for a version Growth didn&apos;t see come out.</p>
                      ) : (
                        <p>Google Play doesn&apos;t say when a build came out. Seen is the first and the last day Google counted people using it, or, for a version without crash numbers, the days of the reviews that name it.</p>
                      )}
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-medium">{store === 'appstore' ? 'New ratings' : 'Written reviews'}</th>
                <th className="py-2 pr-3 font-medium">Crashes</th>
                {store === 'playstore' && <th className="py-2 pr-3 font-medium">Freezes</th>}
                {hangs && (
                  <th className="py-2 pr-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Hang rate
                      <InfoTip label="About the hang rate">
                        <p>Xcode&apos;s hang rate for your newest versions: how long the app was frozen for each hour it was used, for a typical iPhone. Apple sends it only for the newest versions.</p>
                        {hangSummary && <p>From Apple: {hangSummary}</p>}
                      </InfoTip>
                    </span>
                  </th>
                )}
                <th className="py-2 pr-3 text-right font-medium">About crashes</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row, index) => {
                const health = row.health;
                const change = crashChange(store, rows, index);
                const on = selected === row.key;
                const thin = health && health.crash.rate !== null && !steady(store, health.crash);
                // Google Play: the build behind a known version, and the release's own name when the developer typed one.
                const detail = [
                  row.build && row.name !== buildName(row.build) ? `build ${row.build}` : null,
                  row.releaseName ? `"${row.releaseName}" in Play Console` : null,
                ]
                  .filter(Boolean)
                  .join(', ');
                return (
                  <tr
                    key={row.key}
                    className={cn('cursor-pointer border-b last:border-0 hover:bg-muted/50', on && 'bg-muted/60')}
                    onClick={() => onSelect(on ? null : row.key)}
                    aria-selected={on}
                    data-version={row.name}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-medium underline-offset-2 hover:underline"
                        aria-pressed={on}
                        aria-label={`${on ? 'Hide' : 'Show'} ${versionWords(row)} on the charts`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(on ? null : row.key);
                        }}
                      >
                        {row.name}
                      </button>
                      {index === 0 && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Newest</span>}
                      {detail && <span className="block text-[10px] text-muted-foreground">{detail}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{datesWords(row)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                      {row.ratings && row.ratings.count > 0 ? (
                        <>
                          {plural(row.ratings.count, row.ratings.what === 'reviews' ? 'review' : 'rating')}
                          {row.ratings.average !== null ? <span className="text-muted-foreground">, {formatRating(row.ratings.average)} stars</span> : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {health && health.crash.rate !== null ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('tabular-nums', thin && 'text-muted-foreground')} title={thin && !partial(health.crash) ? 'From few sessions or users, so it can jump' : undefined}>
                            {crashWords(store, health.crash.rate, { short: true })}
                          </span>
                          {thin && !partial(health.crash) && <span className="text-[10px] text-muted-foreground">few {store === 'appstore' ? 'sessions' : 'users'}</span>}
                          {partial(health.crash) && (
                            <span className="text-[10px] text-muted-foreground" title="Apple sends no crash file for a day when fewer than five people who share analytics had a crash">
                              on {health.crash.coveredDays} of {plural(health.crash.days ?? 0, 'day')}
                            </span>
                          )}
                          {change && <ChangeNote store={store} change={change} />}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">n/a</span>
                      )}
                    </td>
                    {store === 'playstore' && (
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                        {health?.freeze && health.freeze.rate !== null ? freezeWords(health.freeze.rate, { short: true }) : <span className="text-muted-foreground">n/a</span>}
                      </td>
                    )}
                    {hangs && (
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                        {health?.hang !== null && health?.hang !== undefined ? `${health.hang} ${hangUnit ?? ''}`.trim() : <span className="text-muted-foreground">n/a</span>}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.crashReviewIds.length > 0 ? (
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            onReadReviews(row.crashReviewIds);
                          }}
                          aria-label={`Read the ${plural(row.crashReviewIds.length, 'review')} about crashes on ${shortName(row)}`}
                        >
                          {formatExact(row.crashReviewIds.length)}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
