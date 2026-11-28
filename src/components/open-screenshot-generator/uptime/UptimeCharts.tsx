"use client";

// Uptime's charts.
//
// - CheckBars: one bar per check, newest on the right. A bar is taller the
//   worse the check went (up, checking again, down), so an outage stands out
//   by its shape as well as its red, which red and green alone can't do for
//   people with red-green colour blindness.
// - DayBars: one bar per day, the same idea: the more time down, the taller
//   the bar, from a short green one for a perfect day to a full red one.
// - ResponseChart: the response time over time, one line, the stretches
//   that were down shaded behind it.
//
// Every bar strip answers the mouse and the arrow keys with the same
// details, and says what it shows in words to a screen reader.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { BEAT_LABELS, formatDuration, formatLongDay, formatMs, formatPercent, formatWhen } from '@/lib/uptime/format';
import { dayTone, timeTicks, type DayBar, type DayTone, type ResponsePoint } from '@/lib/uptime/stats';
import type { Beat } from '@/lib/uptime/types';
import { stateColor } from './UptimeShared';

/** How tall a check's bar is, as a share of the strip. */
function beatHeight(beat: Beat | null): number {
  if (!beat) return 0.28;
  switch (beat.s) {
    case 'up':
      return 0.56;
    case 'pending':
      return 0.8;
    case 'down':
      return 1;
    case 'offline':
    case 'unclear':
      return 0.28;
  }
}

function beatColor(beat: Beat | null): string {
  if (!beat) return 'hsl(var(--uptime-empty))';
  return stateColor(beat.s);
}

/** Which bar the pointer or the keyboard is on, and the details box for it. */
function useStrip(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const onMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect || count === 0) return;
      const at = Math.floor(((event.clientX - rect.left) / rect.width) * count);
      setIndex(Math.max(0, Math.min(count - 1, at)));
    },
    [count]
  );
  const onKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (count === 0) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setIndex((current) => {
          const from = current ?? count - 1;
          if (event.key === 'Home') return 0;
          if (event.key === 'End') return count - 1;
          return Math.max(0, Math.min(count - 1, from + (event.key === 'ArrowLeft' ? -1 : 1)));
        });
      } else if (event.key === 'Escape') {
        setIndex(null);
      }
    },
    [count]
  );
  return { index, setIndex, box, onMove, onKey };
}

function TipBox({ index, count, children }: { index: number; count: number; children: React.ReactNode }) {
  // Kept inside the strip: the box leans left near the right end.
  const share = (index + 0.5) / count;
  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[260px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
      style={{ left: `${share * 100}%`, transform: `translateX(-${Math.round(share * 100)}%)` }}
    >
      {children}
    </div>
  );
}

function CheckDetails({ beat, now }: { beat: Beat | null; now: number }) {
  if (!beat) return <p className="text-muted-foreground">No check here yet</p>;
  return (
    <div className="space-y-0.5">
      <p className="flex items-center gap-1.5 font-medium">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: beatColor(beat) }} aria-hidden />
        {BEAT_LABELS[beat.s]}
        {beat.slow && <span className="font-normal text-muted-foreground">(slow)</span>}
      </p>
      <p className="text-muted-foreground">{formatWhen(beat.t, now)}</p>
      {beat.ms !== undefined && beat.s === 'up' && <p>Answered in {formatMs(beat.ms)}</p>}
      {beat.msg && <p className="text-foreground">{beat.msg}</p>}
    </div>
  );
}

/**
 * The last checks as bars. `size` sm is the list row's strip, lg the one at
 * the top of a monitor's page.
 */
export function CheckBars({ beats, now, size = 'sm', label, className }: { beats: Array<Beat | null>; now: number; size?: 'sm' | 'lg'; label: string; className?: string }) {
  const strip = useStrip(beats.length);
  const counts = useMemo(() => {
    const tally = { up: 0, down: 0, pending: 0, offline: 0, unclear: 0 };
    for (const beat of beats) if (beat) tally[beat.s] += 1;
    return tally;
  }, [beats]);
  const spoken = `${label}: ${counts.up} up, ${counts.down} down${counts.pending ? `, ${counts.pending} checking again` : ''}${counts.offline ? `, ${counts.offline} while offline` : ''}${counts.unclear ? `, ${counts.unclear} that couldn't tell` : ''}`;
  const active = strip.index !== null ? beats[strip.index] : null;
  return (
    <div className={cn('relative', className)}>
      <div
        ref={strip.box}
        role="img"
        aria-label={spoken}
        tabIndex={size === 'lg' ? 0 : -1}
        onPointerMove={strip.onMove}
        onPointerLeave={() => strip.setIndex(null)}
        onKeyDown={strip.onKey}
        onBlur={() => strip.setIndex(null)}
        className={cn('flex items-end rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', size === 'lg' ? 'h-9 gap-[2px]' : 'h-4 gap-px')}
        data-testid={size === 'lg' ? 'uptime-check-bars' : undefined}
      >
        {beats.map((beat, index) => (
          <span
            key={beat ? beat.t : `empty-${index}`}
            className={cn('min-w-[2px] flex-1 rounded-[2px] transition-[height] duration-300', strip.index === index && 'opacity-70')}
            style={{ height: `${beatHeight(beat) * 100}%`, background: beatColor(beat) }}
            data-status={beat?.s ?? 'empty'}
          />
        ))}
      </div>
      {strip.index !== null && size === 'lg' && (
        <TipBox index={strip.index} count={beats.length}>
          <CheckDetails beat={active} now={now} />
        </TipBox>
      )}
    </div>
  );
}

export const DAY_TONE_COLORS: Record<DayTone, string> = {
  good: 'hsl(var(--uptime-up))',
  warning: 'hsl(var(--uptime-pending))',
  serious: 'hsl(var(--uptime-serious))',
  critical: 'hsl(var(--uptime-down))',
  empty: 'hsl(var(--uptime-empty))',
};

const DAY_TONE_WORDS: Record<DayTone, string> = {
  good: 'Up the whole time it was checked',
  warning: 'Down for a short while',
  serious: 'Down for a while',
  critical: 'Down for a long time',
  empty: 'Not checked that day',
};

/** Taller the worse the day went, so the steps read without colour too. */
function dayHeight(tone: DayTone): number {
  switch (tone) {
    case 'good':
      return 0.55;
    case 'warning':
      return 0.7;
    case 'serious':
      return 0.85;
    case 'critical':
      return 1;
    case 'empty':
      return 0.3;
  }
}

/** One bar per day, oldest on the left. */
export function DayBars({ bars, label, compact = false, className }: { bars: DayBar[]; label: string; compact?: boolean; className?: string }) {
  const strip = useStrip(bars.length);
  const bad = bars.filter((bar) => bar.down > 0).length;
  const checked = bars.filter((bar) => bar.uptime !== null).length;
  const spoken = `${label}: ${checked} days checked, ${bad} with time down`;
  const active = strip.index !== null ? bars[strip.index] : null;
  return (
    <div className={cn('relative', className)}>
      <div
        ref={strip.box}
        role="img"
        aria-label={spoken}
        tabIndex={compact ? -1 : 0}
        onPointerMove={strip.onMove}
        onPointerLeave={() => strip.setIndex(null)}
        onKeyDown={strip.onKey}
        onBlur={() => strip.setIndex(null)}
        className={cn('flex items-end rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', compact ? 'h-6 gap-px' : 'h-10 gap-[2px]')}
      >
        {bars.map((bar, index) => {
          const tone = dayTone(bar.uptime);
          return (
            <span
              key={bar.day}
              className={cn('min-w-[1px] flex-1 rounded-[2px]', strip.index === index && 'opacity-70')}
              style={{ height: `${dayHeight(tone) * 100}%`, background: DAY_TONE_COLORS[tone] }}
              data-tone={tone}
            />
          );
        })}
      </div>
      {active && strip.index !== null && (
        <TipBox index={strip.index} count={bars.length}>
          <p className="font-medium">{formatLongDay(active.day)}</p>
          <p className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: DAY_TONE_COLORS[dayTone(active.uptime)] }} aria-hidden />
            {DAY_TONE_WORDS[dayTone(active.uptime)]}
          </p>
          {active.uptime !== null && (
            <p className="mt-0.5 text-muted-foreground">
              {formatPercent(active.uptime)} up{active.down > 0 ? `, down ${formatDuration(active.down)}` : ''}
            </p>
          )}
          {active.checks > 0 && <p className="text-muted-foreground">{active.checks.toLocaleString()} checks</p>}
        </TipBox>
      )}
    </div>
  );
}

export function DayLegend() {
  const items: Array<[DayTone, string]> = [
    ['good', 'Up all day'],
    ['warning', 'Under 100%'],
    ['serious', 'Under 99%'],
    ['critical', 'Under 95%'],
    ['empty', 'Not checked'],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="What the colours mean">
      {items.map(([tone, text]) => (
        <li key={tone} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-1.5 rounded-[2px]" style={{ background: DAY_TONE_COLORS[tone], height: `${Math.round(dayHeight(tone) * 10)}px` }} aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  );
}

export function CheckLegend() {
  const items: Array<[Beat['s'] | 'empty', string]> = [
    ['up', 'Up'],
    ['pending', 'Failed, checking again'],
    ['down', 'Down'],
    ['offline', 'Not counted or no check'],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="What the bars mean">
      {items.map(([status, text]) => {
        const beat = status === 'empty' ? null : ({ t: 0, s: status } as Beat);
        return (
          <li key={status} className="flex items-end gap-1">
            <span className="inline-block w-1.5 rounded-[2px]" style={{ background: beatColor(beat), height: `${Math.round(beatHeight(beat) * 12)}px` }} aria-hidden />
            {text}
          </li>
        );
      })}
    </ul>
  );
}

const SERIES = 'hsl(var(--uptime-series))';

function ResponseTooltip({ active, payload, hourly, now }: { active?: boolean; payload?: Array<{ payload: ResponsePoint }>; hourly: boolean; now: number }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{hourly ? `${formatWhen(point.t, now)} hour` : formatWhen(point.t, now)}</p>
      {point.ms !== null ? (
        <p className="mt-1 flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: SERIES }} aria-hidden />
          {hourly ? 'Average' : 'Answered in'} <span className="font-medium tabular-nums">{formatMs(point.ms)}</span>
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">{point.down > 0 ? 'Down, no answer' : 'Not checked'}</p>
      )}
      {hourly && point.min !== null && point.min !== undefined && point.max !== null && point.max !== undefined && (
        <p className="mt-0.5 text-muted-foreground">
          Fastest {formatMs(point.min)}, slowest {formatMs(point.max)}
        </p>
      )}
      {hourly && point.down > 0 && <p className="mt-0.5 text-[hsl(var(--uptime-down-text))]">Down {Math.round(point.down * 100)}% of the hour</p>}
    </div>
  );
}

/** Stretches of time a series was down, for the shading. */
function downStretches(points: ResponsePoint[], step: number): Array<[number, number]> {
  const stretches: Array<[number, number]> = [];
  let start: number | null = null;
  points.forEach((point, index) => {
    const next = points[index + 1]?.t ?? point.t + step;
    if (point.down > 0) {
      if (start === null) start = point.t;
      if (index === points.length - 1 || points[index + 1].down === 0) {
        stretches.push([start, next]);
        start = null;
      }
    }
  });
  return stretches;
}

export function ResponseChart({ points, from, to, hourly, slowMs, now, height = 220 }: { points: ResponsePoint[]; from: number; to: number; hourly: boolean; slowMs: number; now: number; height?: number }) {
  const gradientId = useMemo(() => `uptime-fill-${Math.random().toString(36).slice(2, 8)}`, []);
  const stretches = useMemo(() => downStretches(points, hourly ? 3_600_000 : 60_000), [points, hourly]);
  const span = to - from;
  const tick = (value: number) => {
    const date = new Date(value);
    if (span <= 2 * 86_400_000) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const ticks = useMemo(() => timeTicks(from, to), [from, to]);
  const values = points.map((point) => point.ms).filter((value): value is number => value !== null);
  const hasData = values.length > 0;
  return (
    <div className="w-full" style={{ height }} role="img" aria-label={hasData ? `Response time, from ${formatMs(Math.min(...values))} to ${formatMs(Math.max(...values))}` : 'Response time: no checks in this range yet'}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[from, to]}
            ticks={ticks}
            tickFormatter={tick}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            minTickGap={36}
          />
          <YAxis
            tickFormatter={(value: number) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s` : `${Math.round(value)} ms`)}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            width={56}
            allowDecimals={false}
            domain={[0, 'auto']}
          />
          {stretches.map(([start, end]) => (
            <ReferenceArea key={start} x1={start} x2={end} fill="hsl(var(--uptime-down))" fillOpacity={0.14} strokeOpacity={0} ifOverflow="hidden" />
          ))}
          {slowMs > 0 && <ReferenceLine y={slowMs} stroke="hsl(var(--uptime-pending))" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Slow', position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />}
          <Tooltip cursor={{ stroke: 'hsl(var(--border))' }} content={<ResponseTooltip hourly={hourly} now={now} />} isAnimationActive={false} />
          <Area
            type="monotone"
            dataKey="ms"
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
