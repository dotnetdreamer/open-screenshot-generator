"use client";

// The charts in the Growth window.
//
// One measure per chart and one axis, always: a metric over time, the same
// days of the period before as a dashed grey line for comparison, and the
// timeline's events as markers, so a change in the line can be read against
// what happened. New screenshots get the highlight colour because they are the
// question this window is built to answer.
//
// Colours are theme tokens (--growth-* in globals.css), never raw values, so
// the dark editor gets the dark steps of the same palette.

import React, { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDay } from '@/lib/growth/dates';
import { formatCount, formatMoney, formatRate } from '@/lib/growth/format';
import type { MetricSpec } from '@/lib/growth/metrics';
import { EVENT_KIND_LABELS, type TimelineEvent } from '@/lib/growth/types';
import { cn } from '@/lib/utils';

export function formatMetricValue(value: number | null | undefined, metric: Pick<MetricSpec, 'kind'>, currency = 'USD'): string {
  if (value === null || value === undefined) return 'n/a';
  if (metric.kind === 'rate') return formatRate(value);
  if (metric.kind === 'money') return formatMoney(value, currency);
  return formatCount(value);
}

export interface TrendPoint {
  date: string;
  value: number | null;
  previous?: number | null;
}

interface TrendChartProps {
  points: TrendPoint[];
  metric: MetricSpec;
  currency?: string;
  events?: TimelineEvent[];
  height?: number;
  showPrevious?: boolean;
  highlightEventId?: string;
  className?: string;
}

const SERIES = 'hsl(var(--growth-series))';
const COMPARE = 'hsl(var(--growth-compare))';
const HIGHLIGHT = 'hsl(var(--growth-highlight))';

function TrendTooltip({
  active,
  payload,
  metric,
  currency,
  eventsByDate,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
  metric: MetricSpec;
  currency?: string;
  eventsByDate: Map<string, TimelineEvent[]>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const events = eventsByDate.get(point.date) ?? [];
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{formatDay(point.date, { withYear: true })}</p>
      <p className="mt-1 flex items-center gap-2">
        <span className="inline-block h-0.5 w-3 rounded" style={{ background: SERIES }} aria-hidden />
        {metric.label}: <span className="font-medium tabular-nums">{formatMetricValue(point.value, metric, currency)}</span>
      </p>
      {point.previous !== undefined && (
        <p className="mt-0.5 flex items-center gap-2 text-muted-foreground">
          <span className="inline-block h-0.5 w-3 rounded border-t border-dashed" style={{ borderColor: COMPARE }} aria-hidden />
          Period before: <span className="tabular-nums">{formatMetricValue(point.previous, metric, currency)}</span>
        </p>
      )}
      {events.map((event) => (
        <p key={event.id} className="mt-1 max-w-[240px] text-foreground">
          <span className="font-medium">{EVENT_KIND_LABELS[event.kind]}:</span> {event.title}
        </p>
      ))}
    </div>
  );
}

export function TrendChart({
  points,
  metric,
  currency,
  events = [],
  height = 260,
  showPrevious = true,
  highlightEventId,
  className,
}: TrendChartProps) {
  const from = points[0]?.date;
  const to = points[points.length - 1]?.date;
  const visible = useMemo(
    () => (from && to ? events.filter((event) => event.date >= from && event.date <= to) : []),
    [events, from, to]
  );
  const eventsByDate = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of visible) map.set(event.date, [...(map.get(event.date) ?? []), event]);
    return map;
  }, [visible]);
  const hasPrevious = showPrevious && points.some((point) => point.previous !== undefined && point.previous !== null);
  const gradientId = useMemo(() => `growth-fill-${Math.random().toString(36).slice(2, 8)}`, []);

  const tickFormatter = (value: number) => {
    if (metric.kind === 'rate') return formatRate(value);
    if (metric.kind === 'money') return formatMoney(value, currency ?? 'USD').replace(/\.00$/, '');
    return formatCount(value);
  };

  return (
    <div className={cn('w-full', className)} style={{ height }} role="img" aria-label={`${metric.label} by day`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 18, right: 12, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => formatDay(value, { withYear: false })}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={tickFormatter}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--border))' }}
            content={<TrendTooltip metric={metric} currency={currency} eventsByDate={eventsByDate} />}
          />
          {visible.map((event) => {
            const highlight = event.kind === 'screenshots' || event.id === highlightEventId;
            return (
              <ReferenceLine
                key={event.id}
                x={event.date}
                stroke={highlight ? HIGHLIGHT : 'hsl(var(--muted-foreground))'}
                strokeDasharray={highlight ? undefined : '3 3'}
                strokeWidth={highlight ? 2 : 1}
                strokeOpacity={highlight ? 0.9 : 0.6}
                label={{
                  value: event.kind === 'screenshots' ? 'Screenshots' : event.kind === 'release' ? event.version ?? 'Release' : EVENT_KIND_LABELS[event.kind],
                  // Screenshots are uploaded days before their version is
                  // released, so their label sits left of the line and the
                  // release's right of its own, and the two never overlap.
                  position: event.kind === 'screenshots' ? 'insideTopRight' : 'insideTopLeft',
                  fontSize: 10,
                  fill: highlight ? HIGHLIGHT : 'hsl(var(--muted-foreground))',
                  offset: 4,
                }}
              />
            );
          })}
          {hasPrevious && (
            <Line
              type="monotone"
              dataKey="previous"
              stroke={COMPARE}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={SERIES}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A plain SVG trend line for stat tiles: no axes, no labels, the shape only. */
export function Sparkline({ values, className }: { values: Array<number | null>; className?: string }) {
  const present = values.filter((value): value is number => value !== null);
  if (present.length < 2) return <div className={cn('h-8', className)} aria-hidden />;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const step = 100 / Math.max(1, values.length - 1);
  let path = '';
  values.forEach((value, index) => {
    if (value === null) return;
    const x = index * step;
    const y = 30 - ((value - min) / span) * 26;
    path += `${path ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn('h-8 w-full', className)} aria-hidden>
      <path d={path} fill="none" stroke={SERIES} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export interface BarRow {
  key: string;
  label: React.ReactNode;
  value: number;
  display: string;
  sub?: React.ReactNode;
  title?: string;
}

/** Horizontal bars for a ranking: one hue, sorted, with the value as text beside each. */
export function BarList({ rows, className, emptyText = 'Nothing to show yet' }: { rows: BarRow[]; className?: string; emptyText?: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  return (
    <ul className={cn('space-y-2', className)}>
      {rows.map((row) => (
        <li key={row.key} title={row.title}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{row.display}</span>
              {row.sub && <span className="ml-2">{row.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${max > 0 ? Math.max(2, (row.value / max) * 100) : 0}%`, background: SERIES }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
