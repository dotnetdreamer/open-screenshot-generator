"use client";

// Popularity on the Keywords screen (src/lib/growth/popularity.ts): Apple Ads'
// 1 to 100 score for how a keyword's searches in a country compare with
// other words', as a five bar meter beside the number, a line over the
// weeks, and the map, where each keyword sits by its popularity against how
// strong the first ten apps of its search are.
//
// The map's horizontal axis is the fewest ratings any app in the first ten
// has, the user's own app left out, on a log scale. A keyword goes on the
// map only when every other app there shows a count (everyCountShown): one
// with no count could have fewer, and the dot would sit too far right. A
// dashed line marks the user's own rating count: a keyword left of the line
// has an app with no more ratings than the user's in its top 10, which is
// what "Within reach" means everywhere in Keywords. Higher up, the keyword
// is searched more. Each dot is coloured by where the user's app ranks now,
// as the summary bar colours ranks.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, MinusIcon } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bucketOf } from '@/lib/growth/keywords';
import { dayOf, formatDay, formatMonth } from '@/lib/growth/dates';
import { formatCount, formatExact } from '@/lib/growth/format';
import { everyCountShown, latestPoint, periodWords, sinceWords, tierWords, type Competition, type KeywordPopularity, type PopularityPoint, type PopularityTrend } from '@/lib/growth/popularity';
import { territoryName } from '@/lib/growth/territories';
import { cn } from '@/lib/utils';

// --- small --------------------------------------------------------------------------------

/** A score as five rising bars, filled up to Apple's tier, and the number beside them. */
export function PopularityMeter({
  point,
  granularity,
  className,
  large = false,
}: {
  point: PopularityPoint;
  granularity?: KeywordPopularity['granularity'];
  className?: string;
  large?: boolean;
}) {
  const words = `Popularity ${point.score} of 100, ${tierWords(point.tier).toLowerCase()}`;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} role="img" aria-label={words} title={`${words}. ${periodWords(point.week, granularity)}`}>
      <span className={cn('flex items-end gap-[2px]', large ? 'h-5' : 'h-3.5')} aria-hidden>
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            key={level}
            className={cn('rounded-[1px]', large ? 'w-[4px]' : 'w-[3px]', level <= point.tier ? 'bg-[hsl(var(--growth-series))]' : 'bg-[hsl(var(--growth-series))]/20')}
            style={{ height: `${30 + level * 14}%` }}
          />
        ))}
      </span>
      <span className={cn('font-semibold tabular-nums', large ? 'text-lg leading-none' : 'text-xs')} aria-hidden>
        {point.score}
      </span>
    </span>
  );
}

/**
 * A keyword's popularity in a table cell: the meter, "No score" when Apple
 * Ads lists none, or "Waiting" until Apple Ads was asked.
 */
export function PopularityCell({ record, term, country, refreshing }: { record?: KeywordPopularity; term: string; country: string; refreshing: boolean }) {
  if (!record) {
    return refreshing ? (
      <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Asking Apple Ads" />
    ) : (
      <span className="text-[11px] text-muted-foreground" title="Growth hasn't asked Apple Ads about this keyword yet">
        Waiting
      </span>
    );
  }
  const point = latestPoint(record);
  if (!point) {
    return (
      <span
        className="whitespace-nowrap text-[11px] text-muted-foreground"
        title={`Apple Ads has no popularity score for "${term}" in ${territoryName(country)}. Apple Ads only lists words with at least 500 searches in the ${record.granularity === 'month' ? 'month' : 'week'}`}
      >
        No score
      </span>
    );
  }
  return <PopularityMeter point={point} granularity={record.granularity} />;
}

/** How the score moved over about a month, with the week (or month) it compares with. */
export function PopularityTrendChip({ trend, granularity, className }: { trend: PopularityTrend; granularity?: KeywordPopularity['granularity']; className?: string }) {
  if (trend.kind === 'unknown' || !trend.since) return null;
  const since = sinceWords(trend.since, granularity);
  const base = cn('inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-medium tabular-nums', className);
  if (trend.kind === 'same') {
    return (
      <span className={cn(base, 'text-muted-foreground')} title={`No change ${since}`}>
        <MinusIcon className="h-3 w-3" aria-hidden />
        No change {since}
      </span>
    );
  }
  const up = trend.kind === 'up';
  const words = `${up ? 'Up' : 'Down'} ${Math.abs(trend.change)} ${since}`;
  // More searches is neither good nor bad news on its own, so the arrow is not green or red.
  return (
    <span className={cn(base, 'text-foreground')} title={words}>
      {up ? <ArrowUpIcon className="h-3 w-3" aria-hidden /> : <ArrowDownIcon className="h-3 w-3" aria-hidden />}
      {words}
    </span>
  );
}

// --- over the weeks ----------------------------------------------------------------------

const AXIS = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };
const timeOf = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The score week by week. One series, so no legend: the panel's title names it. */
export function PopularityChart({ record, term, country }: { record?: KeywordPopularity; term: string; country: string }) {
  if (!record) return <p className="py-8 text-center text-xs text-muted-foreground">Popularity shows here after Apple Ads answers</p>;
  if (record.points.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        Apple Ads has no popularity score for &quot;{term}&quot; in {territoryName(country)}. Apple Ads only lists words with at least 500 searches in the{' '}
        {record.granularity === 'month' ? 'month' : 'week'}.
      </p>
    );
  }
  const data = record.points.map((point) => ({ ...point, t: timeOf(point.week) }));
  const first = data[0].t;
  const last = data[data.length - 1].t;
  // Three days each side, so a single week sits in the middle rather than on an edge.
  const domain: [number, number] = [first - 3 * 86_400_000, last + 3 * 86_400_000];
  return (
    <div className="space-y-2">
      <div className="h-[200px]" role="img" aria-label={`Popularity of "${term}" in ${territoryName(country)}, week by week, from 1 to 100`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              ticks={data.length <= 6 ? data.map((point) => point.t) : [data[0].t, data[Math.floor(data.length / 2)].t, data[data.length - 1].t]}
              tickFormatter={(value: number) => (record.granularity === 'month' ? formatMonth(dayOf(new Date(value))) : formatDay(dayOf(new Date(value)), { withYear: false }))}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
            />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS} tickLine={false} axisLine={false} width={30} />
            <Tooltip cursor={{ stroke: 'hsl(var(--border))' }} content={<PopularityTooltip granularity={record.granularity} />} />
            <Line
              type="monotone"
              dataKey="score"
              name="Popularity"
              stroke="hsl(var(--growth-series))"
              strokeWidth={2}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.index === data.length - 1 && props.cx !== undefined && props.cy !== undefined ? (
                  <circle key={`end-${props.index}`} cx={props.cx} cy={props.cy} r={4} fill="hsl(var(--growth-series))" stroke="hsl(var(--card))" strokeWidth={2} />
                ) : (
                  <g key={`dot-${props.index}`} />
                )
              }
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {record.granularity === 'month'
          ? 'One point for each month, since Apple Ads gave no weekly scores. 100 is the word people search most in the country.'
          : data.length === 1
            ? 'Apple Ads gives a new score each week, so the line grows from here.'
            : 'One point for each week. 100 is the word people search most in the country.'}
      </p>
    </div>
  );
}

function PopularityTooltip({ active, payload, granularity }: { active?: boolean; payload?: Array<{ payload: PopularityPoint }>; granularity?: KeywordPopularity['granularity'] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">{periodWords(point.week, granularity, { withYear: true })}</p>
      <p className="mt-1 flex items-center gap-2">
        <span aria-hidden className="inline-block h-0.5 w-3 rounded bg-[hsl(var(--growth-series))]" />
        <span className="font-semibold tabular-nums">{point.score}</span>
        <span className="text-muted-foreground">Popularity, {tierWords(point.tier).toLowerCase()}</span>
      </p>
    </div>
  );
}

// --- the map ------------------------------------------------------------------------------

/** One keyword on the map. */
export interface MapKeyword {
  term: string;
  /** The user's rank now: undefined not checked, null not found. */
  rank: number | null | undefined;
  record?: KeywordPopularity;
  /** Null without a search to read the first ten from. */
  competition: Competition | null;
}

type DotKind = 'top10' | 'top50' | 'lower' | 'none' | 'unchecked';

/** Hollow dots: not found has a solid ring, a rank not checked yet a dashed one. */
const DOT_KINDS: Array<{ id: DotKind; label: string; color: string; hollow?: 'solid' | 'dashed' }> = [
  { id: 'top10', label: 'Your app in the top 10', color: 'hsl(var(--growth-good))' },
  { id: 'top50', label: '11 to 50', color: 'hsl(var(--growth-series))' },
  { id: 'lower', label: '51 and lower', color: 'hsl(var(--growth-compare))' },
  { id: 'none', label: 'Not found', color: 'hsl(var(--muted-foreground))', hollow: 'solid' },
  { id: 'unchecked', label: 'Rank not checked yet', color: 'hsl(var(--muted-foreground))', hollow: 'dashed' },
];

function dotKind(rank: number | null | undefined): DotKind {
  if (rank === undefined) return 'unchecked';
  const bucket = bucketOf(rank);
  return bucket === 'top3' ? 'top10' : bucket;
}

const HEIGHT = 300;
const PAD = { top: 22, right: 18, bottom: 40, left: 40 };
/** Ratings on the horizontal axis, placed by log10(1 + count) so that 0 has a place. */
const RATING_TICKS = [0, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];
const at = (count: number) => Math.log10(1 + Math.max(0, count));

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function KeywordMap({
  keywords,
  ownRatings,
  appName,
  country,
  selected,
  onSelect,
  refreshing,
}: {
  keywords: MapKeyword[];
  ownRatings: number | null;
  appName: string;
  country: string;
  selected: string | null;
  onSelect: (term: string) => void;
  refreshing: boolean;
}) {
  const [box, width] = useWidth();
  const [hovered, setHovered] = useState<string | null>(null);

  const placed = useMemo(
    () =>
      keywords.flatMap((keyword) => {
        const point = latestPoint(keyword.record);
        const weakest = keyword.competition?.weakest;
        return point && keyword.competition && everyCountShown(keyword.competition) && typeof weakest === 'number' ? [{ ...keyword, point, weakest }] : [];
      }),
    [keywords]
  );
  const noScore = keywords.filter((keyword) => keyword.record && keyword.record.points.length === 0);
  const waitingScore = keywords.filter((keyword) => !keyword.record);
  const waitingSearch = keywords.filter((keyword) => latestPoint(keyword.record) && !keyword.competition);
  // Searched, but the first ten have no rating count to place the keyword by: none at all, or not every app's.
  const noCounts = keywords.filter((keyword) => latestPoint(keyword.record) && keyword.competition && keyword.competition.counted === 0);
  const someCounts = keywords.filter(
    (keyword) => latestPoint(keyword.record) && keyword.competition && keyword.competition.counted > 0 && !everyCountShown(keyword.competition)
  );
  const kinds = new Set(placed.map((keyword) => dotKind(keyword.rank)));

  const top = Math.max(3, Math.ceil(Math.max(at(ownRatings ?? 0), ...placed.map((keyword) => at(keyword.weakest))) + 0.05));
  const ticks = RATING_TICKS.filter((tick) => at(tick) <= top + 0.001);
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (count: number) => PAD.left + (at(count) / top) * plotWidth;
  const y = (score: number) => PAD.top + (1 - score / 100) * plotHeight;
  const line = ownRatings !== null ? x(ownRatings) : null;

  const shown = placed.find((keyword) => keyword.term === hovered) ?? null;
  const describe = (keyword: (typeof placed)[number]) =>
    `${keyword.term}: popularity ${keyword.point.score}, fewest ratings in the top 10 ${formatExact(keyword.weakest)}, ${
      typeof keyword.rank === 'number' ? `your rank ${keyword.rank}` : keyword.rank === null ? 'your app not found' : 'your rank not checked'
    }`;

  return (
    <div className="space-y-3 px-4 pb-4" data-testid="growth-keyword-map">
      <p className="text-xs text-muted-foreground">
        Each dot is a keyword in {territoryName(country)}. Higher up, the keyword is searched more. Left of the dashed line, an app with no more ratings
        than yours is in the top 10.
      </p>
      <div ref={box} className="relative w-full" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="group" aria-label={`Keyword map for ${territoryName(country)}: popularity against the fewest ratings in the top 10`} className="overflow-visible">
            {/* Within reach: the side of the line where the top 10 has an app no stronger than yours. */}
            {line !== null && line > PAD.left && (
              <rect x={PAD.left} y={PAD.top} width={Math.min(plotWidth, line - PAD.left)} height={plotHeight} fill="hsl(var(--growth-good) / 0.06)" />
            )}
            {[0, 25, 50, 75, 100].map((score) => (
              <g key={score}>
                <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(score)} y2={y(score)} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                <text x={PAD.left - 8} y={y(score)} dy="0.32em" textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))" className="tabular-nums">
                  {score}
                </text>
              </g>
            ))}
            {ticks.map((tick) => (
              <text key={tick} x={x(tick)} y={PAD.top + plotHeight + 16} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))" className="tabular-nums">
                {formatCount(tick)}
              </text>
            ))}
            <line x1={PAD.left} x2={PAD.left + plotWidth} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight} stroke="hsl(var(--border))" />
            <text x={PAD.left + plotWidth / 2} y={HEIGHT - 4} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
              Fewest ratings in the top 10
            </text>
            <text x={12} y={PAD.top + plotHeight / 2} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))" transform={`rotate(-90 12 ${PAD.top + plotHeight / 2})`}>
              Popularity
            </text>
            {line !== null && (
              <g>
                <line x1={line} x2={line} y1={PAD.top} y2={PAD.top + plotHeight} stroke="hsl(var(--foreground))" strokeOpacity={0.55} strokeDasharray="4 3" />
                <text
                  x={line > PAD.left + plotWidth * 0.7 ? line - 6 : line + 6}
                  y={PAD.top - 8}
                  textAnchor={line > PAD.left + plotWidth * 0.7 ? 'end' : 'start'}
                  fontSize={11}
                  fill="hsl(var(--foreground))"
                >
                  {appName}: {formatExact(ownRatings)} {ownRatings === 1 ? 'rating' : 'ratings'}
                </text>
              </g>
            )}
            {line !== null && line > PAD.left + 70 && (
              <text x={PAD.left + 8} y={PAD.top + 14} fontSize={11} fontWeight={600} fill="hsl(var(--growth-good))">
                Within reach
              </text>
            )}
            {placed.map((keyword) => {
              const kind = dotKind(keyword.rank);
              const style = DOT_KINDS.find((entry) => entry.id === kind)!;
              const color = style.color;
              const cx = x(keyword.weakest);
              const cy = y(keyword.point.score);
              const isSelected = keyword.term === selected;
              const hollow = !!style.hollow;
              return (
                <g
                  key={keyword.term}
                  data-map-keyword={keyword.term}
                  role="button"
                  tabIndex={0}
                  aria-label={describe(keyword)}
                  aria-pressed={isSelected}
                  className="cursor-pointer outline-none [&:focus-visible>circle.ring]:stroke-[hsl(var(--ring))]"
                  onPointerEnter={() => setHovered(keyword.term)}
                  onPointerLeave={() => setHovered((current) => (current === keyword.term ? null : current))}
                  onFocus={() => setHovered(keyword.term)}
                  onBlur={() => setHovered((current) => (current === keyword.term ? null : current))}
                  onClick={() => onSelect(keyword.term)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(keyword.term);
                    }
                  }}
                >
                  {/* The pointer only has to come near: the hit area is 24 pixels across. */}
                  <circle cx={cx} cy={cy} r={12} fill="transparent" />
                  {isSelected && <circle className="ring" cx={cx} cy={cy} r={9} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2} />}
                  {!isSelected && <circle className="ring" cx={cx} cy={cy} r={8} fill="none" stroke="transparent" strokeWidth={2} />}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 6 : 5}
                    fill={hollow ? 'hsl(var(--card))' : color}
                    stroke={hollow ? color : 'hsl(var(--card))'}
                    strokeWidth={2}
                    strokeDasharray={style.hollow === 'dashed' ? '2 2' : undefined}
                  />
                  {isSelected && (
                    <text
                      x={cx > PAD.left + plotWidth * 0.75 ? cx - 13 : cx + 13}
                      y={cy}
                      dy="0.32em"
                      textAnchor={cx > PAD.left + plotWidth * 0.75 ? 'end' : 'start'}
                      fontSize={12}
                      fontWeight={600}
                      fill="hsl(var(--foreground))"
                      paintOrder="stroke"
                      stroke="hsl(var(--card))"
                      strokeWidth={4}
                    >
                      {keyword.term}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {shown && width > 0 && (
          <MapTooltip keyword={shown} ownRatings={ownRatings} left={x(shown.weakest)} top={y(shown.point.score)} width={width} />
        )}
        {width > 0 && placed.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-xs text-muted-foreground" style={{ paddingLeft: PAD.left, paddingBottom: PAD.bottom }}>
            {refreshing ? 'Asking Apple Ads for the popularity of your keywords' : 'Keywords show here once each one has a popularity score and a check'}
          </div>
        )}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="Key">
        {DOT_KINDS.filter((entry) => entry.id !== 'unchecked' || kinds.has('unchecked')).map((entry) => (
          <li key={entry.id} className="flex items-center gap-1.5">
            <svg width={10} height={10} aria-hidden>
              <circle
                cx={5}
                cy={5}
                r={4}
                fill={entry.hollow ? 'hsl(var(--card))' : entry.color}
                stroke={entry.color}
                strokeWidth={entry.hollow ? 1.5 : 0}
                strokeDasharray={entry.hollow === 'dashed' ? '2 1.5' : undefined}
              />
            </svg>
            {entry.label}
          </li>
        ))}
        {ownRatings !== null && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-3 border-t-2 border-dashed border-foreground/60" />
            Your app&apos;s ratings
          </li>
        )}
      </ul>

      {(noScore.length > 0 || noCounts.length > 0 || someCounts.length > 0 || waitingScore.length > 0 || waitingSearch.length > 0) && (
        <div className="space-y-1.5 border-t pt-3 text-[11px] text-muted-foreground">
          {noScore.length > 0 && (
            <OffMap label={`Not on the map, no popularity score from Apple Ads (${noScore.length})`} terms={noScore.map((keyword) => keyword.term)} onSelect={onSelect} />
          )}
          {noCounts.length > 0 && (
            <OffMap label={`Not on the map, no other app in the top 10 shows its ratings (${noCounts.length})`} terms={noCounts.map((keyword) => keyword.term)} onSelect={onSelect} />
          )}
          {someCounts.length > 0 && (
            <OffMap
              label={`Not on the map, some apps in the top 10 don't show their ratings (${someCounts.length})`}
              terms={someCounts.map((keyword) => keyword.term)}
              onSelect={onSelect}
            />
          )}
          {waitingScore.length > 0 && (
            <OffMap label={`Waiting for Apple Ads (${waitingScore.length})`} terms={waitingScore.map((keyword) => keyword.term)} onSelect={onSelect} />
          )}
          {waitingSearch.length > 0 && (
            <OffMap label={`Waiting for the first check (${waitingSearch.length})`} terms={waitingSearch.map((keyword) => keyword.term)} onSelect={onSelect} />
          )}
        </div>
      )}
    </div>
  );
}

function OffMap({ label, terms, onSelect }: { label: string; terms: string[]; onSelect: (term: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{label}:</span>
      {terms.map((term) => (
        <button key={term} type="button" className="rounded-full border px-2 py-0.5 text-[11px] text-foreground hover:bg-muted" onClick={() => onSelect(term)}>
          {term}
        </button>
      ))}
    </div>
  );
}

function MapTooltip({
  keyword,
  ownRatings,
  left,
  top,
  width,
}: {
  keyword: MapKeyword & { point: PopularityPoint; weakest: number };
  ownRatings: number | null;
  left: number;
  top: number;
  width: number;
}) {
  // To the left of the dot on the right half, so the tooltip never runs off the panel.
  const flip = left > width / 2;
  const rank = typeof keyword.rank === 'number' ? String(keyword.rank) : keyword.rank === null ? 'Not found' : 'Not checked';
  return (
    <div
      className="pointer-events-none absolute z-10 w-[220px] rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
      style={{ left: flip ? left - 232 : left + 12, top: Math.max(0, top - 20) }}
      role="presentation"
    >
      <p className="break-words font-medium">{keyword.term}</p>
      {/* The value first and the label after it, since the reader came for the number. */}
      <div className="mt-1 space-y-0.5">
        <p className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{keyword.point.score}</span>
          <span className="text-muted-foreground">Popularity, {tierWords(keyword.point.tier).toLowerCase()}</span>
        </p>
        <p className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{rank}</span>
          <span className="text-muted-foreground">Your rank</span>
        </p>
        <p className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{formatExact(keyword.weakest)}</span>
          <span className="text-muted-foreground">Fewest ratings in the top 10{ownRatings !== null ? `, yours ${formatExact(ownRatings)}` : ''}</span>
        </p>
      </div>
    </div>
  );
}
