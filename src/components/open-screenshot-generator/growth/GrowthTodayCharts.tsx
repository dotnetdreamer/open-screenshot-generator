"use client";

// The charts on Growth's Today screen (GrowthToday.tsx).
//
// Every app keeps one colour everywhere on the screen: its slot in the
// validated categorical palette (`--growth-tag-1` to `8`), taken in the
// account's order (studio.ts `colorSlots`), never by rank, so hiding an app
// or changing the range never repaints the others. Text never wears an app's
// colour; a swatch or a line key beside the name carries it.
//
// The bars follow the dataviz rules the other Growth charts follow: columns
// no wider than 24 px, a 2 px gap in the card's colour between the apps in a
// column, a rounded top on the column only, solid hairline grid, and a
// tooltip that lists every app on the day pointed at.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay } from '@/lib/growth/dates';
import { formatCount, formatMoney, formatRate } from '@/lib/growth/format';
import { territoryName } from '@/lib/growth/territories';
import { cn } from '@/lib/utils';
import { Delta } from './GrowthShared';

/** An app's colour, by its slot (studio.ts); slot 0 is "Other apps". */
export function slotColor(slot: number): string {
  return slot > 0 ? `hsl(var(--growth-tag-${slot}))` : 'hsl(var(--growth-compare))';
}

export interface AppMeta {
  id: string;
  name: string;
  slot: number;
  iconUrl?: string | null;
}

// --- tiles -----------------------------------------------------------------------------

/**
 * A stat tile's trend: a 2 px line over a 10% wash of the same colour, with a
 * dot on the newest day. No axis: the tile's number says what it is.
 */
export function TileSpark({ values, color = 'hsl(var(--growth-series))', className }: { values: Array<number | null>; color?: string; className?: string }) {
  const id = useMemo(() => `today-spark-${Math.random().toString(36).slice(2, 9)}`, []);
  const present = values.filter((value): value is number => value !== null);
  if (present.length < 2) return <div className={cn('h-9', className)} aria-hidden />;
  const min = Math.min(0, ...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const step = 100 / Math.max(1, values.length - 1);
  const points: Array<[number, number]> = [];
  values.forEach((value, index) => {
    if (value === null) return;
    points.push([index * step, 34 - ((value - min) / span) * 30]);
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
  const area = `${line}L${points[points.length - 1][0].toFixed(2)},36L${points[0][0].toFixed(2)},36Z`;
  const [lastX, lastY] = points[points.length - 1];
  return (
    <div className={cn('relative h-9 w-full', className)} aria-hidden>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {/* The end dot in HTML, so the stretched SVG does not squash it into an oval. */}
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
        style={{ left: `${lastX}%`, top: `${(lastY / 36) * 100}%`, background: color }}
      />
    </div>
  );
}

/**
 * A whole split into its apps: a thin bar, each app's part its own block with
 * a 2 px gap, no text on it. The names and amounts are in the title, and in
 * the apps table below the tiles.
 */
export function PartsBar({ parts, apps, format, className }: { parts: Array<{ appId: string; value: number }>; apps: Map<string, AppMeta>; format: (value: number) => string; className?: string }) {
  const shown = parts.filter((part) => part.value > 0);
  const total = shown.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0 || shown.length === 0) return <div className={cn('h-1.5 rounded-full bg-muted', className)} aria-hidden />;
  const words = shown.map((part) => `${apps.get(part.appId)?.name ?? 'An app'}: ${format(part.value)} (${Math.round((part.value / total) * 100)}%)`).join('\n');
  return (
    <div className={cn('flex h-1.5 w-full gap-0.5', className)} title={words} role="img" aria-label={words.replace(/\n/g, ', ')}>
      {shown.map((part) => (
        <span
          key={part.appId}
          className="h-full min-w-[3px] rounded-full first:rounded-l-full last:rounded-r-full"
          style={{ flexGrow: part.value, flexBasis: 0, background: slotColor(apps.get(part.appId)?.slot ?? 0) }}
        />
      ))}
    </div>
  );
}

// --- the columns by day ------------------------------------------------------------------

export interface DayColumn {
  /** The first day of the column: a day, or a week's Monday-or-start. */
  key: string;
  label: string;
  /** Long label for the tooltip: "Nov 4" or "Nov 4 to 10". */
  title: string;
  total: number | null;
  /** Every app's numbers are in for the column. */
  complete: boolean;
  values: Record<string, number>;
  /** Apps whose numbers stop before this column. */
  missing: string[];
}

interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  dataKey?: string;
  payload?: Record<string, unknown> & { __complete?: boolean };
  order: string[];
}

/**
 * One app's part of a column. A part with another app's part below it leaves
 * a 2 px gap, and the top part of a column gets the 4 px rounded top.
 */
function Segment({ x = 0, y = 0, width = 0, height = 0, fill, dataKey = '', payload = {}, order }: SegmentProps) {
  if (!(height > 0) || !(width > 0)) return null;
  const index = order.indexOf(dataKey);
  const has = (key: string) => Number(payload[key] ?? 0) > 0;
  const above = order.slice(index + 1).some(has);
  const below = order.slice(0, index).some(has);
  const gap = below && height > 3 ? 2 : 0;
  const h = height - gap;
  const r = above ? 0 : Math.min(4, width / 2, h);
  const d = r
    ? `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + width - r},${y}Q${x + width},${y} ${x + width},${y + r}L${x + width},${y + h}Z`
    : `M${x},${y + h}L${x},${y}L${x + width},${y}L${x + width},${y + h}Z`;
  return <path d={d} fill={fill} fillOpacity={payload.__complete === false ? 0.45 : 1} />;
}

function ColumnTooltip({
  active,
  payload,
  apps,
  order,
  format,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
  apps: Map<string, AppMeta>;
  order: string[];
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as unknown as DayColumn & Record<string, unknown>;
  const column = row.__column as DayColumn;
  const listed = order
    .filter((id) => column.values[id] !== undefined)
    .sort((a, b) => (column.values[b] ?? 0) - (column.values[a] ?? 0));
  return (
    <div className="min-w-[180px] max-w-[260px] rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{column.title}</p>
      <p className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">All apps</span>
        <span className="text-sm font-semibold tabular-nums">{column.total === null ? 'n/a' : format(column.total)}</span>
      </p>
      <ul className="mt-1.5 space-y-1 border-t pt-1.5">
        {listed.map((id) => (
          <li key={id} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: slotColor(apps.get(id)?.slot ?? 0) }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{apps.get(id)?.name}</span>
            <span className="font-medium tabular-nums">{format(column.values[id] ?? 0)}</span>
          </li>
        ))}
        {column.missing.map((id) => (
          <li key={id} className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-block h-0.5 w-3 shrink-0 rounded opacity-40" style={{ background: slotColor(apps.get(id)?.slot ?? 0) }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{apps.get(id)?.name}</span>
            <span>not in yet</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ChartMarker {
  key: string;
  label: string;
}

/** The columns by day, one coloured part per app, the newest days lighter while some apps' numbers are not in. */
export function StackedColumns({
  columns,
  order,
  apps,
  kind,
  currency,
  markers = [],
  height = 260,
}: {
  columns: DayColumn[];
  /** The apps shown, bottom of the column first. */
  order: string[];
  apps: Map<string, AppMeta>;
  kind: 'count' | 'money';
  currency?: string;
  markers?: ChartMarker[];
  height?: number;
}) {
  const format = (value: number) => (kind === 'money' ? formatMoney(value, currency ?? 'USD') : formatCount(value));
  const data = useMemo(
    () =>
      columns.map((column) => ({
        ...column.values,
        __key: column.key,
        __label: column.label,
        __complete: column.complete,
        __column: column,
      })),
    [columns]
  );
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Columns by day, one colored part per app, with the numbers in the table under the chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
          <XAxis
            dataKey="__key"
            tickFormatter={(value: string) => data.find((row) => row.__key === value)?.__label ?? value}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(value: number) => (kind === 'money' ? formatMoney(value, currency ?? 'USD').replace(/\.00$/, '') : formatCount(value))}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={52}
          />
          <Tooltip cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.6 }} content={<ColumnTooltip apps={apps} order={order} format={format} />} isAnimationActive={false} />
          {markers.map((marker) => (
            <ReferenceLine
              key={`${marker.key}:${marker.label}`}
              x={marker.key}
              stroke="hsl(var(--growth-highlight))"
              strokeWidth={1.5}
              strokeOpacity={0.9}
              label={{ value: marker.label, position: 'insideTopLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))', offset: 4 }}
            />
          ))}
          {order.map((id) => (
            <Bar
              key={id}
              dataKey={id}
              stackId="apps"
              fill={slotColor(apps.get(id)?.slot ?? 0)}
              maxBarSize={24}
              isAnimationActive={false}
              shape={(props: unknown) => <Segment {...(props as SegmentProps)} order={order} />}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- the map ------------------------------------------------------------------------------

type WorldModule = typeof import('@/lib/growth/worldShapes');
let worldLoad: Promise<WorldModule> | null = null;

/** The country shapes, loaded the first time a map shows so the editor never carries them. */
function useWorld(): WorldModule | null {
  const [world, setWorld] = useState<WorldModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    worldLoad ??= import('@/lib/growth/worldShapes');
    worldLoad.then(
      (module) => {
        if (!cancelled) setWorld(module);
      },
      (error) => {
        worldLoad = null;
        console.error('The map could not be loaded', error);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return world;
}

export interface MapCountry {
  territory: string;
  downloads: number;
  share: number;
  change: number | null;
  parts: Array<{ appId: string; value: number }>;
}

const SHADES = [1, 2, 3, 4, 5];

export function shadeColor(shade: number): string {
  return shade > 0 ? `hsl(var(--growth-map-${shade}))` : 'hsl(var(--muted))';
}

/**
 * New downloads by country on a world map, one hue from pale (fewest) to
 * deep (most). Countries too small to draw are a dot. Pointing at a country
 * shows its numbers; the list beside the map carries the same numbers as
 * text, and the two follow each other's pointer.
 */
export function DownloadsMap({
  countries,
  shadeOf,
  hovered,
  onHover,
  apps,
}: {
  countries: MapCountry[];
  shadeOf: (downloads: number) => number;
  hovered: string | null;
  onHover: (territory: string | null) => void;
  apps: Map<string, AppMeta>;
}) {
  const world = useWorld();
  const box = useRef<HTMLDivElement | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const byCode = useMemo(() => new Map(countries.map((row) => [row.territory, row])), [countries]);
  const width = world?.WORLD_WIDTH ?? 960;
  const height = world?.WORLD_HEIGHT ?? 426;
  const shown = hovered ? byCode.get(hovered) ?? null : null;

  const track = (code: string) => ({
    onPointerEnter: () => onHover(code),
    onPointerMove: (event: React.PointerEvent) => {
      const rect = box.current?.getBoundingClientRect();
      if (rect) setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    },
    onPointerLeave: () => {
      onHover(null);
      setPointer(null);
    },
  });

  return (
    <div ref={box} className="relative w-full" style={{ aspectRatio: `${width} / ${height}` }}>
      {!world ? (
        <div className="absolute inset-0 animate-pulse rounded-lg bg-muted/60" aria-hidden />
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Map of new downloads by country, with the numbers in the list beside the map">
          {world.WORLD_LAND.map((d, index) => (
            <path key={`land-${index}`} d={d} fill={shadeColor(0)} stroke="hsl(var(--card))" strokeWidth={0.6} />
          ))}
          {Object.entries(world.WORLD_SHAPES).map(([code, d]) => {
            const row = byCode.get(code);
            return (
              <path
                key={code}
                d={d}
                fill={shadeColor(row ? shadeOf(row.downloads) : 0)}
                stroke="hsl(var(--card))"
                strokeWidth={0.6}
                className="transition-opacity"
                opacity={hovered && hovered !== code ? 0.55 : 1}
                {...(row ? track(code) : {})}
              />
            );
          })}
          {hovered && world.WORLD_SHAPES[hovered] && (
            <path d={world.WORLD_SHAPES[hovered]} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.2} pointerEvents="none" />
          )}
          {Object.entries(world.WORLD_DOTS).map(([code, [x, y]]) => {
            const row = byCode.get(code);
            if (!row) return null;
            return (
              <g key={code} {...track(code)}>
                {/* A bigger, invisible target, so a small country is easy to point at. */}
                <circle cx={x} cy={y} r={9} fill="transparent" />
                <circle cx={x} cy={y} r={4.5} fill={shadeColor(shadeOf(row.downloads))} stroke={hovered === code ? 'hsl(var(--foreground))' : 'hsl(var(--card))'} strokeWidth={2} />
              </g>
            );
          })}
        </svg>
      )}
      {shown && pointer && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[240px] rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            left: Math.min(pointer.x + 14, (box.current?.clientWidth ?? 0) - 200),
            top: Math.max(4, pointer.y - 12),
          }}
        >
          <p className="font-medium">{territoryName(shown.territory)}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-sm font-semibold">{formatCount(shown.downloads)}</span>
            <span className="text-muted-foreground">new downloads, {formatRate(shown.share).replace(/\.\d+%$/, '%')}</span>
            <Delta change={shown.change} />
          </p>
          {shown.parts.length > 1 && (
            <ul className="mt-1.5 space-y-0.5 border-t pt-1.5">
              {shown.parts.slice(0, 4).map((part) => (
                <li key={part.appId} className="flex items-center gap-2">
                  <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: slotColor(apps.get(part.appId)?.slot ?? 0) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{apps.get(part.appId)?.name}</span>
                  <span className="font-medium">{formatCount(part.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The map's key: no downloads, then the five shades from fewest to most. */
export function MapKey({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground', className)}>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: shadeColor(0) }} aria-hidden />
        None
      </span>
      <span className="flex items-center gap-1.5">
        Fewer
        <span className="flex gap-0.5" aria-hidden>
          {SHADES.map((shade) => (
            <span key={shade} className="h-2.5 w-4 rounded-sm" style={{ background: shadeColor(shade) }} />
          ))}
        </span>
        More
      </span>
    </div>
  );
}

/** "Nov 4", or "Nov 4 to 10" for a week. */
export function columnTitle(from: string, to: string): string {
  if (from === to) return formatDay(from, { withYear: false });
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth ? `${formatDay(from, { withYear: false })} to ${Number(to.slice(8, 10))}` : `${formatDay(from, { withYear: false })} to ${formatDay(to, { withYear: false })}`;
}
