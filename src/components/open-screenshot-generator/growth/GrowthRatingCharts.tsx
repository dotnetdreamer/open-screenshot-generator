"use client";

// The charts of the ratings screens: ratings per star stacked by period,
// the average rating as a line (one per app when competitors are compared),
// and the stars as bars. Colours are the --growth-star-* scale for stars and
// the series and tag slots for apps (globals.css), so an app keeps its colour
// however many apps are on the chart.

import React from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay, formatMonth } from '@/lib/growth/dates';
import { formatCount, formatExact, formatRating } from '@/lib/growth/format';
import type { RatingGranularity } from '@/lib/growth/ratingHistory';
import type { StarCounts, TimelineEvent } from '@/lib/growth/types';
import { cn } from '@/lib/utils';

export const STAR_COLORS = [1, 2, 3, 4, 5].map((star) => `hsl(var(--growth-star-${star}))`);
/** The colour of the n-th app on a chart: yours first, then the apps you follow. */
export function appColor(index: number): string {
  return index === 0 ? 'hsl(var(--growth-series))' : `hsl(var(--growth-tag-${((index % 7) + 1).toString()}))`;
}

const AXIS = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

export function bucketLabel(start: string, granularity: RatingGranularity, long = false): string {
  if (granularity === 'month') return formatMonth(start);
  if (granularity === 'week') return long ? `Week of ${formatDay(start, { withYear: true })}` : formatDay(start, { withYear: false });
  return long ? formatDay(start, { withYear: true }) : formatDay(start, { withYear: false });
}

function releaseLines(events: TimelineEvent[], buckets: Array<{ start: string; end: string }>): Array<{ x: string; label: string; id: string }> {
  const out: Array<{ x: string; label: string; id: string }> = [];
  for (const event of events) {
    if (event.kind !== 'release') continue;
    const bucket = buckets.find((entry) => event.date >= entry.start && event.date <= entry.end);
    if (bucket && !out.some((line) => line.x === bucket.start)) out.push({ x: bucket.start, label: event.version ?? 'Release', id: event.id });
  }
  return out;
}

function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('inline-block h-2.5 w-2.5 rounded-sm', item.dashed && 'h-0.5 w-3 rounded-none')} style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export interface StarBucket {
  start: string;
  end: string;
  /** The ratings whose stars are known, per star. */
  stars: StarCounts | null;
  /** Ratings counted whose stars are not known, drawn in grey on top. */
  unknown?: number;
  count: number;
  average: number | null;
  /** The new ratings of this bucket may include some from the days before it. */
  note?: string;
}

/** New ratings (or written reviews) per period, one segment per star. */
export function StarBars({
  buckets,
  granularity,
  events = [],
  height = 240,
  what,
}: {
  buckets: StarBucket[];
  granularity: RatingGranularity;
  events?: TimelineEvent[];
  height?: number;
  /** "new ratings" or "written reviews", for the tooltip and the label. */
  what: string;
}) {
  const data = buckets.map((bucket) => ({
    start: bucket.start,
    s1: bucket.stars?.[0] ?? 0,
    s2: bucket.stars?.[1] ?? 0,
    s3: bucket.stars?.[2] ?? 0,
    s4: bucket.stars?.[3] ?? 0,
    s5: bucket.stars?.[4] ?? 0,
    // Counted, but not split by star.
    unknown: bucket.unknown ?? (bucket.stars ? 0 : bucket.count),
    bucket,
  }));
  const split = buckets.some((bucket) => bucket.stars && bucket.stars.some((value) => value > 0));
  const whole = data.some((row) => row.unknown > 0);
  const lines = releaseLines(events, buckets);
  return (
    <div className="space-y-2">
      <div style={{ height }} role="img" aria-label={`${what} per ${granularity}, by stars`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis dataKey="start" tickFormatter={(value: string) => bucketLabel(value, granularity)} tick={AXIS} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} minTickGap={24} />
            <YAxis allowDecimals={false} tickFormatter={(value: number) => formatCount(value)} tick={AXIS} tickLine={false} axisLine={false} width={44} />
            <Tooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} content={<StarTooltip granularity={granularity} what={what} />} />
            {lines.map((line) => (
              <ReferenceLine key={line.id} x={line.x} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: line.label, position: 'insideTopLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))', offset: 4 }} />
            ))}
            {[1, 2, 3, 4, 5].map((star) => (
              <Bar key={star} dataKey={`s${star}`} stackId="stars" fill={STAR_COLORS[star - 1]} stroke="hsl(var(--card))" strokeWidth={1} isAnimationActive={false} />
            ))}
            <Bar dataKey="unknown" stackId="stars" fill="hsl(var(--growth-compare))" stroke="hsl(var(--card))" strokeWidth={1} isAnimationActive={false} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          ...(split ? [5, 4, 3, 2, 1].map((star) => ({ label: `${star} star${star === 1 ? '' : 's'}`, color: STAR_COLORS[star - 1] })) : []),
          ...(whole ? [{ label: 'Stars not known', color: 'hsl(var(--growth-compare))' }] : []),
        ]}
      />
    </div>
  );
}

function StarTooltip({ active, payload, granularity, what }: { active?: boolean; payload?: Array<{ payload: { bucket: StarBucket } }>; granularity: RatingGranularity; what: string }) {
  if (!active || !payload?.length) return null;
  const { bucket } = payload[0].payload;
  return (
    <div className="max-w-[260px] rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{bucketLabel(bucket.start, granularity, true)}</p>
      <p className="mt-1">
        {formatExact(bucket.count)} {what}
        {bucket.average !== null ? `, ${formatRating(bucket.average)} stars on average` : ''}
      </p>
      {bucket.stars && bucket.count > 0 && (
        <ul className="mt-1 space-y-0.5">
          {[5, 4, 3, 2, 1].map((star) => (
            <li key={star} className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: STAR_COLORS[star - 1] }} />
              <span className="flex-1">{star} star{star === 1 ? '' : 's'}</span>
              <span className="tabular-nums">{formatExact(bucket.stars![star - 1])}</span>
            </li>
          ))}
          {(bucket.unknown ?? 0) > 0 && (
            <li className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: 'hsl(var(--growth-compare))' }} />
              <span className="flex-1">Stars not known</span>
              <span className="tabular-nums">{formatExact(bucket.unknown!)}</span>
            </li>
          )}
        </ul>
      )}
      {bucket.note && <p className="mt-1 text-muted-foreground">{bucket.note}</p>}
    </div>
  );
}

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  /** By bucket start. */
  values: Map<string, number | null>;
}

/** The average rating per period, one line per app. One axis: stars. */
export function RatingLines({
  starts,
  series,
  granularity,
  events = [],
  height = 220,
  domain,
  format = (value: number) => formatRating(value),
  label,
  whole = false,
}: {
  starts: string[];
  series: LineSeries[];
  granularity: RatingGranularity;
  events?: TimelineEvent[];
  height?: number;
  domain?: [number, number];
  format?: (value: number) => string;
  label: string;
  /** Whole numbers only on the axis, for counts. */
  whole?: boolean;
}) {
  const data = starts.map((start) => {
    const row: Record<string, string | number | null> = { start };
    for (const line of series) row[line.id] = line.values.get(start) ?? null;
    return row;
  });
  const values = series.flatMap((line) => Array.from(line.values.values())).filter((value): value is number => typeof value === 'number');
  const low = values.length ? Math.min(...values) : 1;
  const high = values.length ? Math.max(...values) : 5;
  const auto: [number, number] = [Math.max(1, Math.floor((low - 0.2) * 2) / 2), Math.min(5, Math.ceil((high + 0.2) * 2) / 2)];
  const lines = releaseLines(events, starts.map((start, index) => ({ start, end: starts[index + 1] ?? '9999-12-31' })));
  return (
    <div className="space-y-2">
      <div style={{ height }} role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis dataKey="start" tickFormatter={(value: string) => bucketLabel(value, granularity)} tick={AXIS} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} minTickGap={24} />
            <YAxis domain={domain ?? auto} tickFormatter={format} tick={AXIS} tickLine={false} axisLine={false} width={44} allowDecimals={!whole} />
            <Tooltip cursor={{ stroke: 'hsl(var(--border))' }} content={<LineTooltip series={series} granularity={granularity} format={format} />} />
            {lines.map((line) => (
              <ReferenceLine key={line.id} x={line.x} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: line.label, position: 'insideTopLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))', offset: 4 }} />
            ))}
            {series.map((line) => (
              <Line
                key={line.id}
                type="monotone"
                dataKey={line.id}
                name={line.label}
                stroke={line.color}
                strokeWidth={2}
                // A line needs two points: a series with fewer than three shows its points as dots.
                dot={Array.from(line.values.values()).filter((value) => typeof value === 'number').length < 3 ? { r: 3.5, fill: line.color, strokeWidth: 0 } : false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && <Legend items={series.map((line) => ({ label: line.label, color: line.color, dashed: true }))} />}
    </div>
  );
}

function LineTooltip({
  active,
  payload,
  series,
  granularity,
  format,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, string | number | null> }>;
  series: LineSeries[];
  granularity: RatingGranularity;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{bucketLabel(String(row.start), granularity, true)}</p>
      {series.map((line) => {
        const value = row[line.id];
        return (
          <p key={line.id} className="mt-1 flex items-center gap-2">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: line.color }} />
            <span className="flex-1">{line.label}</span>
            <span className="font-medium tabular-nums">{typeof value === 'number' ? format(value) : 'n/a'}</span>
          </p>
        );
      })}
    </div>
  );
}

/** The stars as five bars, five stars at the top, each with its share and count. */
export function StarBreakdown({ stars, className }: { stars: StarCounts; className?: string }) {
  const total = stars.reduce((sum, value) => sum + value, 0);
  const max = Math.max(1, ...stars);
  return (
    <ul className={cn('space-y-1.5', className)} aria-label="Ratings by stars">
      {[5, 4, 3, 2, 1].map((star) => {
        const value = stars[star - 1];
        const share = total > 0 ? value / total : 0;
        return (
          <li key={star} className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
              {star} star{star === 1 ? '' : 's'}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full" style={{ width: `${value > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: STAR_COLORS[star - 1] }} />
            </span>
            <span className="w-24 shrink-0 text-right tabular-nums">
              <span className="font-medium">{Math.round(share * 100)}%</span>
              <span className="ml-1.5 text-muted-foreground">{formatCount(value)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
