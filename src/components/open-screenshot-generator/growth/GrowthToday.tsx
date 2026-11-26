"use client";

// Today: every app of the account on one page, the first screen once a store
// key is saved. A greeting and two or three sentences of what changed, the
// totals with each app's part of them, the columns by day with one colour per
// app, each app in a row, where the downloads come from on a map, and down the
// side what to do next, what happened since the last look, and the round
// numbers coming up. Everything is worked out in studio.ts from what Growth
// has stored; no AI writes a number or a sentence here.
//
// The apps are refreshed one after another when their numbers are older than
// the refresh setting, as the background monitor does when Growth is not on
// screen, and Refresh all in the header refreshes every app. An app that was
// never refreshed waits for the user: its first refresh reads a year of sales.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FlagIcon,
  FolderOpenIcon,
  ImagesIcon,
  Loader2Icon,
  MessageSquareIcon,
  PartyPopperIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SparkleIcon,
  StarIcon,
  TrophyIcon,
  TypeIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccount } from '@/lib/account/store';
import { openExternal } from '@/lib/desktop';
import { addDays, formatDay, formatWindow, previousWindow, today } from '@/lib/growth/dates';
import { onGrowthChange, readMeta, writeMeta } from '@/lib/growth/db';
import { formatAgo, formatCount, formatMoney, formatPerDay, formatRate, formatRating, plural } from '@/lib/growth/format';
import { dueForAutoSync, noteAutoSync } from '@/lib/growth/autoSync';
import { covers, dailySeries, metricValue, relativeChange } from '@/lib/growth/metrics';
import { markInsightsSeen } from '@/lib/growth/monitor';
import { getGrowthSettings } from '@/lib/growth/settings';
import {
  MAX_TODO_LENGTH,
  changeManualTodos,
  dueWords,
  localDay,
  manualCounts,
  newManualTodo,
  sortManualTodos,
  useManualTodos,
  type ManualTodo,
} from '@/lib/growth/manualTodos';
import {
  MILESTONE_WORDS,
  formatFigure,
  greeting,
  mapShades,
  roughDays,
  studioActivity,
  studioApps,
  studioBrief,
  studioCountries,
  studioFigure,
  studioImpacts,
  studioMilestones,
  studioRange,
  studioRateSeries,
  studioRating,
  studioSeries,
  studioSummaryText,
  studioTodos,
  type ActivityKind,
  type BriefLine,
  type Milestone,
  type SeriesMetric,
  type StudioAction,
  type StudioActivity,
  type StudioApp,
  type StudioFigure,
  type StudioImpact,
  type StudioTodo,
} from '@/lib/growth/studio';
import { metaKeys, type LiveListing } from '@/lib/growth/sync';
import { territoryName } from '@/lib/growth/territories';
import type { GrowthApp, InsightTone } from '@/lib/growth/types';
import { useStudioData } from '@/lib/growth/useStudioData';
import { isStorePublishingAvailable } from '@/lib/publish';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { Delta, Gated, Panel, StoreImage, useGrowthView } from './GrowthShared';
import {
  DownloadsMap,
  MapKey,
  PartsBar,
  StackedColumns,
  TileSpark,
  columnTitle,
  shadeColor,
  slotColor,
  type AppMeta,
  type ChartMarker,
  type DayColumn,
} from './GrowthTodayCharts';

const VISITED_KEY = 'today:visited';

// --- app icons ----------------------------------------------------------------------------

/** Each app's store icon, from what the last refresh read (the App Store lookup, Google Play's page). */
function useAppIcons(apps: GrowthApp[]): Map<string, string> {
  const ids = apps.map((app) => app.id).join('\n');
  const [icons, setIcons] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const list = ids ? ids.split('\n') : [];
    const read = () =>
      void Promise.all(
        list.map(async (id) => {
          const live = await readMeta<LiveListing>(metaKeys.live(id));
          if (live?.iconUrl) return [id, live.iconUrl] as const;
          const play = await readMeta<{ iconUrl?: string | null }>(metaKeys.playApp(id));
          return [id, play?.iconUrl ?? null] as const;
        })
      ).then(
        (entries) => {
          if (!cancelled) setIcons(new Map(entries.filter((entry): entry is readonly [string, string] => !!entry[1])));
        },
        (error) => console.error('Reading the app icons failed', error)
      );
    read();
    const off = onGrowthChange((changed) => {
      if (changed !== null && !list.includes(changed)) return;
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (!cancelled) read();
      }, 400);
    });
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      off();
    };
  }, [ids]);
  return icons;
}

/** An app's icon, or its first letter on its own colour while there is none. */
function AppAvatar({ app, iconUrl, slot, size = 32, className }: { app: { name: string }; iconUrl?: string | null; slot: number; size?: number; className?: string }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.23) };
  if (iconUrl) return <StoreImage src={iconUrl} alt="" className={cn('shrink-0 border object-cover', className)} style={style} />;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center font-semibold text-white', className)}
      style={{ ...style, background: slotColor(slot), fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {app.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** The apps' icons side by side, a little over each other, for the header and the greeting. */
export function TodayAppStack({ apps, size = 24, limit = 5 }: { apps: GrowthApp[]; size?: number; limit?: number }) {
  const icons = useAppIcons(apps);
  if (apps.length === 0) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--growth-series))]/15 text-[hsl(var(--growth-series))]" style={{ width: size + 8, height: size + 8 }} aria-hidden>
        <SparkleIcon className="h-4 w-4" />
      </span>
    );
  }
  const shown = apps.slice(0, limit);
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((app, index) => (
        <span key={app.id} className={cn('rounded-[28%] ring-2 ring-card', index > 0 && '-ml-1.5')} style={{ zIndex: shown.length - index }}>
          <AppAvatar app={app} iconUrl={icons.get(app.id) ?? app.iconUrl} slot={(index % 8) + 1} size={size} />
        </span>
      ))}
      {apps.length > limit && (
        <span className="-ml-1.5 inline-flex items-center justify-center rounded-[28%] bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-card" style={{ width: size, height: size }}>
          +{apps.length - limit}
        </span>
      )}
    </span>
  );
}

// --- words ----------------------------------------------------------------------------------

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function firstName(name: string | undefined): string | null {
  const clean = name?.trim();
  if (!clean || clean.includes('@')) return null;
  const first = clean.split(/\s+/)[0];
  // A sign-in name without a space is often a login ("dotnetdreamer"), not a name to greet.
  if (!/\s/.test(clean) && first === first.toLowerCase()) return null;
  return first;
}

function periodWords(days: number): string {
  return days === 365 ? 'the 12 months before' : `the ${days} days before`;
}

/** When an item happened: "3 hours ago" for a real time, "Today", "Yesterday" or the day otherwise. */
function whenWords(item: Pick<StudioActivity, 'at' | 'exact'>, now: number, todayDay: string): string {
  const day = new Date(item.at).toISOString().slice(0, 10);
  if (item.exact && now - item.at < 24 * 3_600_000 && now >= item.at) return formatAgo(item.at, now).replace(/^just now$/, 'Just now');
  if (day === todayDay) return 'Today';
  if (day === addDays(todayDay, -1)) return 'Yesterday';
  return formatDay(day);
}

function compareWords(figure: StudioFigure, days: number): string {
  if (figure.value === null) return 'No numbers yet';
  if (figure.compared.length === 0) return 'Nothing to compare yet';
  if (figure.compared.length < figure.reporting.length) return `Compared for ${figure.compared.length} of ${figure.reporting.length} apps`;
  return `vs ${periodWords(days)}`;
}

// --- the screen ---------------------------------------------------------------------------------

type ChartMetric = Extract<SeriesMetric, 'downloads' | 'pageViews' | 'updates' | 'proceeds'>;

const CHART_METRICS: Array<{ id: ChartMetric; label: string }> = [
  { id: 'downloads', label: 'New downloads' },
  { id: 'pageViews', label: 'Page visits' },
  { id: 'updates', label: 'Updates' },
  { id: 'proceeds', label: 'Earnings' },
];

export function GrowthToday() {
  const view = useGrowthView();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const desktop = mounted && isStorePublishingAvailable();
  const { loaded, inputs } = useStudioData(view.apps);
  const icons = useAppIcons(view.apps);
  const { session } = useAccount();
  const day = today();

  const apps = useMemo(() => studioApps(inputs, view.rangeDays, day), [inputs, view.rangeDays, day]);
  const meta = useMemo(
    () => new Map<string, AppMeta>(apps.map((entry) => [entry.app.id, { id: entry.app.id, name: entry.app.name, slot: entry.slot, iconUrl: icons.get(entry.app.id) ?? entry.data.live?.iconUrl ?? entry.app.iconUrl }])),
    [apps, icons]
  );
  const figures = useMemo(
    () => ({
      downloads: studioFigure(apps, 'downloads'),
      pageViews: studioFigure(apps, 'pageViews'),
      rate: studioFigure(apps, 'rate'),
      proceeds: studioFigure(apps, 'proceeds'),
    }),
    [apps]
  );
  const rating = useMemo(() => studioRating(apps), [apps]);
  const milestones = useMemo(() => studioMilestones(apps, day), [apps, day]);
  const todos = useMemo(() => studioTodos(apps, day), [apps, day]);
  const activity = useMemo(() => studioActivity(apps, milestones, day), [apps, milestones, day]);
  const impacts = useMemo(() => studioImpacts(apps, day), [apps, day]);
  const brief = useMemo(() => studioBrief(apps, { days: view.rangeDays, milestones, impacts, today: day }), [apps, view.rangeDays, milestones, impacts, day]);
  const range = useMemo(() => studioRange(apps), [apps]);
  const summary = useMemo(
    () =>
      apps.some((entry) => entry.counted)
        ? studioSummaryText({
            title: range.window ? `My apps, ${formatDay(range.window.from)} to ${formatDay(range.window.to)}` : 'My apps',
            brief,
            apps,
            figures,
            rating,
            days: view.rangeDays,
          })
        : null,
    [apps, brief, figures, rating, range, view.rangeDays]
  );

  // What came in since the last look, fixed for this visit: the dots stay
  // while the screen shows, and the next visit counts from now.
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readMeta<number>(VISITED_KEY).then((value) => {
      if (!cancelled) setSince(value ?? 0);
    });
    const timer = window.setTimeout(() => void writeMeta(VISITED_KEY, Date.now()), 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // The insights listed here count as seen, so the activity bar's count drops.
  // Only the rows a list shows count, never the ones folded under its "Show all".
  const [listed, setListed] = useState<{ todo: string[]; activity: string[] }>({ todo: [], activity: [] });
  const onTodoShown = useCallback((ids: string[]) => setListed((current) => (same(current.todo, ids) ? current : { ...current, todo: ids })), []);
  const onActivityShown = useCallback((ids: string[]) => setListed((current) => (same(current.activity, ids) ? current : { ...current, activity: ids })), []);
  const shownInsights = useMemo(() => {
    const ids = new Set([...listed.todo, ...listed.activity]);
    return inputs.map((input) => ({ appId: input.app.id, insights: (input.insights ?? []).filter((insight) => ids.has(`insight:${input.app.id}:${insight.id}`)) }));
  }, [inputs, listed]);
  // Marked when the cards themselves change, not on every read a refresh causes.
  const shownKey = shownInsights.map((entry) => `${entry.appId}:${entry.insights.map((insight) => insight.id).join(',')}`).join('|');
  const latestShown = useRef(shownInsights);
  latestShown.current = shownInsights;
  useEffect(() => {
    if (!view.active || !loaded) return;
    for (const entry of latestShown.current) if (entry.insights.length) void markInsightsSeen(entry.appId, entry.insights);
  }, [view.active, loaded, shownKey]);

  // Apps refreshed before are refreshed again once their numbers are older
  // than the setting, on showing and every ten minutes while Today shows.
  const latest = useRef({ inputs, view });
  latest.current = { inputs, view };
  useEffect(() => {
    if (!view.active || !loaded) return;
    const check = () => {
      const { inputs: now, view: current } = latest.current;
      const hours = getGrowthSettings().refreshHours;
      const due = now.filter(
        (input) => input.data.lastSync && !current.refreshReason(input.app.id) && dueForAutoSync(input.app.id, input.data.lastSync, hours)
      );
      if (due.length === 0 || current.refreshing) return;
      for (const input of due) noteAutoSync(input.app.id);
      current.refreshApps(due.map((input) => input.app.id));
    };
    check();
    const timer = window.setInterval(check, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [view.active, loaded]);

  const noApps = view.apps.length === 0;
  const hasNumbers = apps.some((entry) => entry.counted);

  return (
    <div className="mx-auto max-w-[1500px] space-y-4" data-testid="growth-today">
      <Hero
        name={firstName(session?.account.name)}
        brief={brief}
        apps={apps}
        meta={meta}
        loaded={loaded}
        desktop={desktop}
        mounted={mounted}
        rangeText={range.window ? (range.shared ? formatWindow(range.window) : `${formatDay(range.window.from)} to ${formatDay(range.window.to)}`) : null}
        shared={range.shared}
        summary={summary}
      />
      <div className="grid gap-4 min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Tiles apps={apps} meta={meta} figures={figures} rating={rating} />
          {impacts.length > 0 && <Impacts impacts={impacts} meta={meta} />}
          <Columns apps={apps} meta={meta} currency={figures.proceeds.currency} hasEarnings={figures.proceeds.value !== null} hasNumbers={hasNumbers} />
          <AppsTable apps={apps} meta={meta} total={figures.downloads.value} loaded={loaded} noApps={noApps} />
          <Countries apps={apps} meta={meta} />
        </div>
        <aside className="grid content-start gap-4 md:grid-cols-2 min-[1400px]:grid-cols-1" aria-label="To do, what's new and milestones">
          <TodoList todos={todos} meta={meta} loaded={loaded} noApps={noApps} onShown={onTodoShown} />
          <Activity items={activity} meta={meta} since={since} onShown={onActivityShown} />
          <Milestones milestones={milestones} meta={meta} />
        </aside>
      </div>
    </div>
  );
}

// --- the greeting -------------------------------------------------------------------------------

function Hero({
  name,
  brief,
  apps,
  meta,
  loaded,
  desktop,
  mounted,
  rangeText,
  shared,
  summary,
}: {
  name: string | null;
  brief: BriefLine[];
  apps: StudioApp[];
  meta: Map<string, AppMeta>;
  loaded: boolean;
  desktop: boolean;
  mounted: boolean;
  rangeText: string | null;
  shared: boolean;
  summary: string | null;
}) {
  const view = useGrowthView();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const newest = apps.reduce<number | null>((max, entry) => (entry.data.lastSync && (!max || entry.data.lastSync > max) ? entry.data.lastSync : max), null);
  const never = apps.filter((entry) => !entry.data.lastSync).length;
  const refreshing = view.refreshing ? meta.get(view.refreshing.appId)?.name : null;
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const noApps = view.apps.length === 0;

  return (
    <section
      className="relative overflow-hidden rounded-xl border bg-card px-5 py-5 sm:px-6"
      style={{
        backgroundImage:
          'radial-gradient(70% 140% at 0% 0%, hsl(var(--growth-series) / 0.13), transparent 62%), radial-gradient(55% 140% at 100% 0%, hsl(var(--growth-assistant) / 0.11), transparent 60%)',
      }}
      aria-labelledby="growth-today-title"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-[420px]">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{date}</p>
          <h2 id="growth-today-title" className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
            {greeting(now.getHours())}
            {name ? `, ${name}` : ''}
          </h2>
          {noApps && (!mounted || (desktop && /^Loading/.test(view.blocked.app ?? ''))) ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              {mounted && view.blocked.app ? view.blocked.app : 'Loading your apps'}
            </p>
          ) : noApps ? (
            <div className="mt-2 max-w-2xl space-y-3">
              <p className="text-sm text-muted-foreground">
                {!desktop
                  ? 'Today shows every app you have on the App Store and Google Play in one place. Growth reads the stores in the desktop app.'
                  : view.blocked.app ?? 'Connect your App Store or Google Play account to see every app here.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {mounted && !desktop ? (
                  <Button size="sm" onClick={() => void openExternal('https://openscrgen.app')}>
                    Get the desktop app
                    <ExternalLinkIcon className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => view.goTo('ask')}>
                      <BotIcon className="mr-1.5 h-4 w-4" />
                      Set up with Ask AI
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => view.goTo('connect')}>
                      <PlugIcon className="mr-1.5 h-4 w-4" />
                      Open Setup
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : !loaded ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Reading your apps
            </p>
          ) : brief.length > 0 ? (
            <div className="mt-2 max-w-3xl space-y-1 text-[15px] leading-relaxed text-foreground/75" data-testid="growth-today-brief">
              {brief.map((line) => (
                <p key={line.text}>
                  <BriefText line={line} />
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Refresh your apps to see how they're doing.</p>
          )}
        </div>
        {!noApps && (
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end sm:text-right">
            <TodayAppStack apps={view.apps} size={34} limit={6} />
            <p className="text-xs text-muted-foreground" role="status">
              {refreshing ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                  Refreshing {refreshing}
                </span>
              ) : newest ? (
                `Updated ${formatAgo(newest)}`
              ) : (
                'Not refreshed yet'
              )}
            </p>
            {rangeText && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {rangeText}
                {!shared && (
                  <InfoTip label="Why the dates differ">
                    <p>Each app counts its own last days, the same days its Overview shows.</p>
                    <p>Google Play's numbers arrive a few days after the App Store's, so a Google Play app's days end earlier.</p>
                  </InfoTip>
                )}
              </p>
            )}
            {never > 0 && never < apps.length && (
              <p className="text-xs text-muted-foreground">{never === 1 ? '1 app is waiting for its first refresh' : `${never} apps are waiting for their first refresh`}</p>
            )}
            {summary && <CopySummary text={summary} />}
          </div>
        )}
      </div>
    </section>
  );
}

/** Copies Today as plain text, to paste into a chat or a post. */
function CopySummary({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch (error) {
      console.error('Copying the summary failed', error);
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 1800);
  };
  return (
    <Button size="sm" variant="ghost" className="-mr-2 h-7 px-2 text-xs text-muted-foreground" onClick={() => void copy()} title="Copy these numbers as text, to paste into a chat or a post">
      {state === 'copied' ? <CheckIcon className="mr-1 h-3.5 w-3.5" /> : <CopyIcon className="mr-1 h-3.5 w-3.5" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy summary'}
    </Button>
  );
}

/** A sentence with its key words in bold, each the first time it comes up. */
function BriefText({ line }: { line: BriefLine }) {
  const parts: React.ReactNode[] = [];
  let rest = line.text;
  let key = 0;
  while (rest) {
    let next: { at: number; word: string } | null = null;
    for (const word of line.strong) {
      const at = word ? rest.indexOf(word) : -1;
      if (at >= 0 && (!next || at < next.at || (at === next.at && word.length > next.word.length))) next = { at, word };
    }
    if (!next) {
      parts.push(rest);
      break;
    }
    if (next.at > 0) parts.push(rest.slice(0, next.at));
    parts.push(
      <strong key={key++} className="font-semibold text-foreground">
        {next.word}
      </strong>
    );
    rest = rest.slice(next.at + next.word.length);
  }
  return <>{parts}</>;
}

// --- the tiles ---------------------------------------------------------------------------------

const TILE_HINTS: Record<StudioFigure['metric'], { label: string; hint: string }> = {
  downloads: { label: 'New downloads', hint: 'People who downloaded one of your apps for the first time, on the App Store and Google Play.' },
  pageViews: {
    label: 'Page visits',
    hint: "How often people opened your apps' store pages. App Store Connect calls them Product Page Views, Play Console calls them store listing visitors.",
  },
  rate: {
    label: 'Download rate',
    hint: "How many of the people who opened one of your store pages then downloaded the app. Your screenshots change this number more than anything else on the page.",
  },
  proceeds: { label: 'Earnings', hint: "What Apple pays you, after Apple's fee. Google Play's earnings aren't in Growth yet." },
};

function Tiles({
  apps,
  meta,
  figures,
  rating,
}: {
  apps: StudioApp[];
  meta: Map<string, AppMeta>;
  figures: Record<'downloads' | 'pageViews' | 'rate' | 'proceeds', StudioFigure>;
  rating: { average: number | null; count: number | null; apps: number; weighted: boolean };
}) {
  const view = useGrowthView();
  const sparks = useMemo(() => {
    const totals = (metric: ChartMetric, currency?: string) =>
      studioSeries(apps, metric, currency)
        .days.filter((entry) => entry.complete)
        .map((entry) => entry.total);
    return {
      downloads: totals('downloads'),
      pageViews: totals('pageViews'),
      proceeds: totals('proceeds', figures.proceeds.currency),
      rate: studioRateSeries(apps).map((entry) => entry.value),
    };
  }, [apps, figures.proceeds.currency]);
  const waiting = apps.reduce((sum, entry) => sum + entry.waiting, 0);
  const waitingParts = apps.filter((entry) => entry.waiting > 0).map((entry) => ({ appId: entry.app.id, value: entry.waiting }));
  const oldest = apps.reduce<string | null>((min, entry) => (entry.oldestWaiting && (!min || entry.oldestWaiting < min) ? entry.oldestWaiting : min), null);
  const mostWaiting = [...apps].sort((a, b) => b.waiting - a.waiting)[0];

  const tile = (metric: StudioFigure['metric']) => {
    const figure = figures[metric];
    const { label, hint } = TILE_HINTS[metric];
    const others = figure.others ? Object.keys(figure.others).length : 0;
    const format = (value: number) =>
      metric === 'proceeds' ? formatMoney(value, figure.currency ?? 'USD') : metric === 'rate' ? formatRate(value) : formatCount(value);
    return (
      <div key={metric} className="flex min-w-0 flex-col rounded-xl border bg-card p-4" data-testid={`growth-today-tile-${metric}`}>
        <div className="flex items-center gap-1">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <InfoTip label={`About ${label.toLowerCase()}`}>
            <p>{hint}</p>
          </InfoTip>
        </div>
        <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight" data-value={figure.value ?? ''}>
          {formatFigure(figure)}
        </p>
        <div className="mt-2 flex min-h-[18px] flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {figure.value !== null && figure.compared.length > 0 && <Delta change={figure.change} />}
          <span className="text-[11px] text-muted-foreground">
            {metric === 'proceeds' && figure.value !== null && others > 0
              ? `In ${figure.currency}, plus ${others} other currenc${others === 1 ? 'y' : 'ies'}`
              : compareWords(figure, view.rangeDays)}
          </span>
        </div>
        <TileSpark values={sparks[metric]} className="mt-3" />
        {metric !== 'rate' && figure.parts.length > 1 && <PartsBar parts={figure.parts} apps={meta} format={format} className="mt-3" />}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="growth-today-tiles">
      {tile('downloads')}
      {tile('pageViews')}
      {tile('rate')}
      {tile('proceeds')}
      <div className="flex min-w-0 flex-col rounded-xl border bg-card p-4" data-testid="growth-today-tile-rating">
        <div className="flex items-center gap-1">
          <p className="truncate text-xs font-medium text-muted-foreground">Rating</p>
          <InfoTip label="About the rating">
            <p>Every app's star rating together, each counted by how many ratings it has.</p>
            <p>Google's report files give a Google Play app's average without a count. With such an app in the list, the number is the plain average of your apps' ratings.</p>
          </InfoTip>
        </div>
        <p className="mt-1.5 flex items-baseline gap-2 text-[26px] font-semibold leading-none tracking-tight">
          {rating.average === null ? 'n/a' : formatRating(rating.average)}
          {rating.average !== null && <StarRow rating={rating.average} />}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {rating.average === null
            ? 'No ratings yet'
            : rating.weighted && rating.count !== null
              ? `${plural(rating.count, 'rating')}${rating.apps > 1 ? ` across ${rating.apps} apps` : ''}`
              : rating.apps > 1
                ? `Average of ${rating.apps} apps' ratings`
                : 'Average of all ratings'}
        </p>
        <div className="mt-auto space-y-1.5 pt-3">
          {apps
            .filter((entry) => entry.rating.average !== null)
            .slice(0, 3)
            .map((entry) => (
              <div key={entry.app.id} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slotColor(entry.slot) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.app.name}</span>
                <span className="font-medium tabular-nums">{formatRating(entry.rating.average)}</span>
              </div>
            ))}
        </div>
      </div>
      <button
        type="button"
        className="flex min-w-0 flex-col rounded-xl border bg-card p-4 text-left transition-colors enabled:hover:bg-muted/40 disabled:cursor-default"
        disabled={!mostWaiting || mostWaiting.waiting === 0}
        onClick={() => mostWaiting && view.openApp(mostWaiting.app.id, 'reviews', { reviewUnanswered: true })}
        title={mostWaiting && mostWaiting.waiting > 0 ? `Open the reviews of ${mostWaiting.app.name} that wait for a reply` : undefined}
        data-testid="growth-today-tile-reviews"
      >
        <p className="truncate text-xs font-medium text-muted-foreground">Reviews to answer</p>
        <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{formatCount(waiting)}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {waiting === 0 ? 'Every review has an answer' : oldest ? `The oldest came in ${formatDay(oldest.slice(0, 10))}` : 'Waiting for a reply'}
        </p>
        <div className="mt-auto pt-3">
          {waitingParts.length > 0 ? (
            <PartsBar parts={waitingParts} apps={meta} format={(value) => plural(value, 'review')} />
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--growth-good))]">
              <CheckCircle2Icon className="h-3.5 w-3.5" />
              All caught up
            </p>
          )}
        </div>
      </button>
    </div>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${formatRating(rating)} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.max(0, Math.min(1, rating - (star - 1)));
        return (
          <span key={star} className="relative inline-block h-3.5 w-3.5" aria-hidden>
            <StarIcon className="absolute inset-0 h-3.5 w-3.5 text-muted-foreground/30" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <StarIcon className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

// --- new screenshots --------------------------------------------------------------------------------

const VERDICT: Record<StudioImpact['impact']['verdict'], { text: string; tone: InsightTone }> = {
  better: { text: 'Up', tone: 'good' },
  worse: { text: 'Down', tone: 'problem' },
  flat: { text: 'About the same', tone: 'neutral' },
  'too-early': { text: 'Not sure yet', tone: 'neutral' },
  'not-live': { text: 'Not live yet', tone: 'neutral' },
  'no-data': { text: 'No numbers', tone: 'neutral' },
};

function Impacts({ impacts, meta }: { impacts: StudioImpact[]; meta: Map<string, AppMeta> }) {
  const view = useGrowthView();
  return (
    <Panel className="rounded-xl" data-testid="growth-today-screenshots">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ImagesIcon className="h-4 w-4 text-[hsl(var(--growth-highlight))]" />
        <h3 className="text-sm font-semibold">Did your new screenshots work?</h3>
        <InfoTip label="How the screenshots are measured">
          <p>Growth compares the 14 days before the new screenshots went live with the days after.</p>
          <p>A sale, a feature or the time of year can move the numbers too, so the result says what changed, not why.</p>
        </InfoTip>
      </div>
      <div className={cn('grid gap-3', impacts.length > 1 && 'sm:grid-cols-2 xl:grid-cols-3')}>
        {impacts.slice(0, 3).map((entry) => (
          <ImpactCard key={entry.event.id} entry={entry} app={meta.get(entry.appId)} wide={impacts.length === 1} />
        ))}
      </div>
    </Panel>
  );
}

/** One app's newest screenshots, before and after. Alone on the row it lies flat, the numbers large. */
function ImpactCard({ entry, app, wide }: { entry: StudioImpact; app: AppMeta | undefined; wide: boolean }) {
  const view = useGrowthView();
  const { appId, event, impact } = entry;
  const verdict = VERDICT[impact.verdict];
  const rate = impact.measure !== 'downloads';
  const format = (value: number | null) => (rate ? formatRate(value) : formatPerDay(value));
  const days = Math.min(14, impact.daysAfter);
  const store = appId.startsWith('play:') ? 'on Google Play' : 'in the App Store';
  const chip = (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
        verdict.tone === 'good' && 'bg-[hsl(var(--growth-good))]/10 text-[hsl(var(--growth-good))]',
        verdict.tone === 'problem' && 'bg-[hsl(var(--growth-bad))]/10 text-[hsl(var(--growth-bad))]',
        verdict.tone === 'neutral' && 'bg-muted text-muted-foreground'
      )}
    >
      {verdict.text}
    </span>
  );
  const buttons = (
    <div className="flex flex-wrap gap-1.5">
      {event.projectId && view.onOpenProject && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => view.onOpenProject?.(event.projectId!)}>
          <FolderOpenIcon className="mr-1 h-3.5 w-3.5" />
          Open the project
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => view.openApp(appId, 'overview')}>
        Details
        <ChevronRightIcon className="ml-0.5 h-3.5 w-3.5" />
      </Button>
    </div>
  );
  const numbers =
    impact.verdict === 'not-live' ? (
      <p className="text-xs text-muted-foreground">Growth starts comparing on the day people see the new screenshots.</p>
    ) : (
      <div className={cn('flex flex-wrap items-end', wide ? 'gap-x-5 gap-y-2' : 'gap-2')}>
        <span>
          {wide && <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">Before</span>}
          <span className={cn('font-semibold', wide ? 'text-[26px] leading-none tracking-tight' : 'text-lg')}>{format(impact.beforeRate)}</span>
        </span>
        <ArrowRightIcon className={cn('text-muted-foreground', wide ? 'mb-1 h-4 w-4' : 'mb-1 h-3.5 w-3.5')} />
        <span>
          {wide && <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">After</span>}
          <span className={cn('font-semibold', wide ? 'text-[26px] leading-none tracking-tight' : 'text-lg')}>{format(impact.afterRate)}</span>
        </span>
        <span className="mb-0.5">
          <Delta change={impact.change} className={wide ? 'text-sm' : undefined} />
          {wide && <span className="block text-[11px] text-muted-foreground">{rate ? 'download rate' : 'new downloads a day'}</span>}
        </span>
      </div>
    );
  const measured =
    impact.verdict === 'not-live' ? null : (
      <div className="space-y-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-[hsl(var(--growth-highlight))]" style={{ width: `${(days / 14) * 100}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground">{days} of 14 days measured</p>
      </div>
    );
  const about = (
    <p className="text-xs text-muted-foreground">
      Uploaded {formatDay(event.date)}
      {event.version ? ` to version ${event.version}` : ''}
      {impact.liveDate ? `, ${store} since ${formatDay(impact.liveDate)}` : ''}
    </p>
  );

  if (wide) {
    return (
      <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(180px,240px)] md:items-center">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <AppAvatar app={{ name: app?.name ?? '' }} iconUrl={app?.iconUrl} slot={app?.slot ?? 0} size={26} />
            <p className="line-clamp-2 min-w-0 text-sm font-semibold">{app?.name}</p>
            {chip}
          </div>
          {about}
        </div>
        {numbers}
        <div className="space-y-2">
          {measured}
          {buttons}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <AppAvatar app={{ name: app?.name ?? '' }} iconUrl={app?.iconUrl} slot={app?.slot ?? 0} size={22} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{app?.name}</p>
        {chip}
      </div>
      {about}
      {numbers}
      {impact.verdict !== 'not-live' && <p className="text-[11px] text-muted-foreground">{rate ? 'Download rate' : 'New downloads a day'}, before and after</p>}
      {measured}
      <div className="mt-auto pt-1">{buttons}</div>
    </div>
  );
}

// --- the columns by day ------------------------------------------------------------------------------

function Columns({
  apps,
  meta,
  currency,
  hasEarnings,
  hasNumbers,
}: {
  apps: StudioApp[];
  meta: Map<string, AppMeta>;
  currency?: string;
  hasEarnings: boolean;
  hasNumbers: boolean;
}) {
  const view = useGrowthView();
  const [metric, setMetric] = useState<ChartMetric>('downloads');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [table, setTable] = useState(false);
  const series = useMemo(() => studioSeries(apps, metric, currency), [apps, metric, currency]);
  const weekly = view.rangeDays >= 180;

  const columns = useMemo<DayColumn[]>(() => {
    if (!weekly) {
      return series.days.map((entry) => ({
        key: entry.date,
        label: formatDay(entry.date, { withYear: false }),
        title: formatDay(entry.date, { withYear: true }),
        total: entry.total,
        complete: entry.complete,
        values: entry.values,
        missing: entry.missing,
      }));
    }
    const out: DayColumn[] = [];
    for (let start = 0; start < series.days.length; start += 7) {
      const chunk = series.days.slice(start, start + 7);
      const values: Record<string, number> = {};
      let total: number | null = null;
      for (const entry of chunk) {
        for (const [id, value] of Object.entries(entry.values)) values[id] = (values[id] ?? 0) + value;
        if (entry.total !== null) total = (total ?? 0) + entry.total;
      }
      const last = chunk[chunk.length - 1];
      out.push({
        key: chunk[0].date,
        label: formatDay(chunk[0].date, { withYear: false }),
        title: `Week of ${columnTitle(chunk[0].date, last.date)}`,
        total,
        complete: chunk.every((entry) => entry.complete),
        values,
        missing: last.missing,
      });
    }
    return out;
  }, [series, weekly]);

  const order = series.apps.filter((id) => !hidden.has(id));
  const shownColumns = useMemo(
    () =>
      columns.map((column) => {
        const values = Object.fromEntries(Object.entries(column.values).filter(([id]) => !hidden.has(id)));
        const present = Object.values(values);
        return { ...column, values, total: present.length ? present.reduce((a, b) => a + b, 0) : column.total === null ? null : 0 };
      }),
    [columns, hidden]
  );
  const markers = useMemo<ChartMarker[]>(() => {
    if (!columns.length) return [];
    const keys = columns.map((column) => column.key);
    const from = keys[0];
    const out: ChartMarker[] = [];
    for (const entry of apps) {
      if (!series.apps.includes(entry.app.id) || hidden.has(entry.app.id)) continue;
      for (const event of entry.data.events) {
        if (event.kind !== 'screenshots' || event.date < from || event.date > (series.days[series.days.length - 1]?.date ?? from)) continue;
        // A week's column takes the upload on any of its days.
        const key = weekly ? [...keys].reverse().find((candidate) => candidate <= event.date) ?? from : event.date;
        out.push({ key, label: series.apps.length > 1 ? `${entry.app.name.split(':')[0].trim().slice(0, 18)} screenshots` : 'New screenshots' });
      }
    }
    return out.slice(-4);
  }, [apps, columns, hidden, series, weekly]);

  const available = CHART_METRICS.filter((entry) => entry.id !== 'proceeds' || hasEarnings);
  const label = CHART_METRICS.find((entry) => entry.id === metric)?.label ?? '';
  const incomplete = columns.some((column) => !column.complete);
  const format = (value: number) => (metric === 'proceeds' ? formatMoney(value, currency ?? 'USD') : formatCount(value));

  return (
    <Panel className="rounded-xl" data-testid="growth-today-columns">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {label} {weekly ? 'by week' : 'by day'}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each color is one app.{metric === 'proceeds' && currency ? ` Earnings in ${currency} only.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="What the columns show">
          {available.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={metric === entry.id}
              onClick={() => setMetric(entry.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors',
                metric === entry.id ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {!hasNumbers ? (
        <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
          <p className="text-sm font-medium">No numbers yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">The columns fill in after your apps' first refresh. Sales and Trends arrives in a few minutes, App Analytics in a day or two.</p>
        </div>
      ) : (
        <>
          <StackedColumns
            columns={shownColumns}
            order={order}
            apps={meta}
            kind={metric === 'proceeds' ? 'money' : 'count'}
            currency={currency}
            markers={markers}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5">
            {series.apps.map((id) => {
              const app = meta.get(id);
              const off = hidden.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={!off}
                  onClick={() =>
                    setHidden((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      // Never hide the last app: an empty chart says nothing.
                      else if (series.apps.length - next.size > 1) next.add(id);
                      return next;
                    })
                  }
                  className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted', off && 'opacity-45')}
                  title={off ? `Show ${app?.name} on the chart` : `Hide ${app?.name} on the chart`}
                >
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: slotColor(app?.slot ?? 0) }} aria-hidden />
                  <span className={cn('max-w-[160px] truncate', off && 'line-through')}>{app?.name}</span>
                </button>
              );
            })}
            <span className="ml-auto flex items-center gap-3">
              {incomplete && <span className="text-[11px] text-muted-foreground">Lighter columns: some apps' numbers aren't in yet</span>}
              <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={table} onClick={() => setTable((value) => !value)}>
                {table ? 'Hide the numbers' : 'Show the numbers'}
                <ChevronDownIcon className={cn('h-3.5 w-3.5 transition-transform', table && 'rotate-180')} />
              </button>
            </span>
          </div>
          {table && (
            <div className="mt-3 max-h-72 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{weekly ? 'Week' : 'Day'}</th>
                    {order.map((id) => (
                      <th key={id} className="px-3 py-2 text-right font-medium">
                        {meta.get(id)?.name}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium">All apps</th>
                  </tr>
                </thead>
                <tbody>
                  {[...shownColumns].reverse().map((column) => (
                    <tr key={column.key} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5">{column.title}</td>
                      {order.map((id) => (
                        <td key={id} className="px-3 py-1.5 text-right tabular-nums">
                          {column.values[id] !== undefined ? format(column.values[id]) : column.missing.includes(id) ? 'not in yet' : ''}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{column.total === null ? '' : format(column.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// --- every app in a row -------------------------------------------------------------------------------

function AppsTable({ apps, meta, total, loaded, noApps }: { apps: StudioApp[]; meta: Map<string, AppMeta>; total: number | null; loaded: boolean; noApps: boolean }) {
  const rows = useMemo(
    () =>
      [...apps].sort((a, b) => {
        const left = a.current ? metricValue(a.current, 'downloads') ?? -1 : -2;
        const right = b.current ? metricValue(b.current, 'downloads') ?? -1 : -2;
        return right - left || a.app.name.localeCompare(b.app.name);
      }),
    [apps]
  );
  return (
    <Panel className="rounded-xl p-0" data-testid="growth-today-apps">
      <div className="flex flex-wrap items-end justify-between gap-2 px-4 pb-2 pt-4">
        <div>
          <h3 className="text-sm font-semibold">Your apps</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">New downloads, rating and what's waiting, app by app. Open an app for everything about it.</p>
        </div>
      </div>
      {noApps ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">Your apps show here once Growth is connected to the App Store or Google Play.</p>
      ) : !loaded && rows.length === 0 ? (
        <p className="flex items-center gap-2 px-4 pb-4 text-xs text-muted-foreground">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          Reading your apps
        </p>
      ) : (
        <ul className="divide-y border-t">
          {rows.map((entry) => (
            <AppRow key={entry.app.id} entry={entry} meta={meta} total={total} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AppRow({ entry, meta, total }: { entry: StudioApp; meta: Map<string, AppMeta>; total: number | null }) {
  const view = useGrowthView();
  const app = meta.get(entry.app.id);
  const downloads = entry.current ? metricValue(entry.current, 'downloads') : null;
  const before = entry.before ? metricValue(entry.before, 'downloads') : null;
  const comparable = entry.window ? covers(entry.starts, 'downloads', previousWindow(entry.window)) : false;
  const spark = useMemo(() => (entry.window ? dailySeries(entry.byDate, entry.window, 'downloads').map((point) => point.value) : []), [entry]);
  const share = total && downloads !== null ? downloads / total : null;
  const progress = view.syncProgress[entry.app.id];
  const syncing = entry.app.id in view.syncProgress;
  const reason = view.refreshReason(entry.app.id);
  const health = entry.input.healthNote;
  // An app refreshed lately that simply has no numbers (no downloads yet) needs no button.
  const needsRefresh = (entry.leftOut === 'old-numbers' || !entry.data.lastSync) && !syncing;
  return (
    // The app's name is a button stretched over the whole row, so a click
    // anywhere opens the app while the Refresh button stays its own button.
    <li
      className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1.5fr)_minmax(90px,1fr)_88px_92px_112px_16px]"
      data-app-id={entry.app.id}
    >
        <span className="flex min-w-0 items-center gap-3">
          <AppAvatar app={entry.app} iconUrl={app?.iconUrl} slot={entry.slot} size={36} />
          <span className="min-w-0">
            <button
              type="button"
              onClick={() => view.openApp(entry.app.id, 'overview')}
              className="block max-w-full truncate text-left text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
              title={`Open ${entry.app.name}`}
            >
              {entry.app.name}
            </button>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {entry.store === 'playstore' ? 'Google Play' : 'App Store'}
              {entry.version ? ` ${entry.version}` : ''}
              <span aria-hidden> · </span>
              {syncing
                ? progress
                  ? `Refreshing ${progress.label}, ${progress.done} of ${progress.total}`
                  : 'Refreshing'
                : entry.leftOut === 'no-numbers'
                  ? entry.data.lastSync
                    ? 'No numbers from the store yet'
                    : 'Not refreshed yet'
                  : entry.leftOut === 'old-numbers' && entry.through
                    ? `Numbers stop ${formatDay(entry.through)}, left out of the totals`
                    : entry.data.lastSync
                      ? `Updated ${formatAgo(entry.data.lastSync)}`
                      : ''}
            </span>
          </span>
        </span>

        <span className="hidden min-w-0 md:block">
          <TileSpark values={spark} color={slotColor(entry.slot)} className="h-7" />
        </span>

        <span className="text-right">
          <span className="block text-sm font-semibold tabular-nums" data-downloads={downloads ?? ''}>
            {downloads === null ? 'n/a' : formatCount(downloads)}
          </span>
          <span className="flex items-center justify-end gap-1">
            {comparable && downloads !== null && before !== null ? <Delta change={relativeChange(downloads, before)} /> : <span className="text-[11px] text-muted-foreground">new downloads</span>}
          </span>
        </span>

        <span className="hidden flex-col items-end gap-1 md:flex">
          {entry.rating.average !== null ? (
            <>
              <span className="flex items-center gap-1 text-sm font-medium tabular-nums">
                <StarIcon className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                {formatRating(entry.rating.average)}
              </span>
              <span className="text-[11px] text-muted-foreground">{entry.rating.count !== null ? plural(entry.rating.count, 'rating') : 'average'}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">No rating yet</span>
          )}
        </span>

        <span className="hidden flex-col items-end gap-1 md:flex">
          {needsRefresh ? (
            <span className="relative z-10">
              <Gated reason={reason}>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => view.refreshApps([entry.app.id])}>
                  <RefreshCwIcon className="mr-1 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </Gated>
            </span>
          ) : entry.waiting > 0 ? (
            <span
              className="flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-800 dark:text-amber-300"
              title={`${plural(entry.waiting, 'review')} waiting for a reply`}
            >
              <MessageSquareIcon className="h-3 w-3" aria-hidden />
              {formatCount(entry.waiting)} to answer
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">No reviews waiting</span>
          )}
          {health && (
            <span className={cn('text-[11px]', health.worse ? 'text-[hsl(var(--growth-bad))]' : 'text-[hsl(var(--growth-good))]')}>
              {health.worse ? 'Crashes went up' : 'Crashes went down'}
            </span>
          )}
        </span>

        <ChevronRightIcon className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden />

        {share !== null && (
          <span className="col-span-full -mt-1 hidden h-1 overflow-hidden rounded-full bg-muted md:block" aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, share * 100)}%`, background: slotColor(entry.slot) }} />
          </span>
        )}
    </li>
  );
}

// --- countries ------------------------------------------------------------------------------------------

function Countries({ apps, meta }: { apps: StudioApp[]; meta: Map<string, AppMeta> }) {
  const countries = useMemo(() => studioCountries(apps), [apps]);
  const shadeOf = useMemo(() => mapShades(countries.map((row) => row.downloads)), [countries]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const list = all ? countries : countries.slice(0, 6);
  const max = countries[0]?.downloads ?? 0;
  return (
    <Panel className="rounded-xl" data-testid="growth-today-countries">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Where new downloads come from</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {countries.length > 0 ? `${plural(countries.length, 'country', 'countries')}, every app together` : 'Countries show up after the first downloads'}
          </p>
        </div>
        <MapKey />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <DownloadsMap countries={countries} shadeOf={shadeOf} hovered={hovered} onHover={setHovered} apps={meta} />
        <div className="min-w-0">
          {countries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No downloads by country yet.</p>
          ) : (
            <ul className="space-y-1" onPointerLeave={() => setHovered(null)}>
              {list.map((row) => (
                <li key={row.territory}>
                  <div
                    className={cn('rounded-md px-2 py-1 transition-colors', hovered === row.territory && 'bg-muted')}
                    onPointerEnter={() => setHovered(row.territory)}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: shadeColor(shadeOf(row.downloads)) }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{territoryName(row.territory)}</span>
                      <span className="shrink-0 font-medium tabular-nums">{formatCount(row.downloads)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-[hsl(var(--growth-series))]" style={{ width: `${max > 0 ? Math.max(2, (row.downloads / max) * 100) : 0}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(row.share * 100)}%</span>
                      <Delta change={row.change} className="w-14 shrink-0 justify-end text-[11px]" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {countries.length > 6 && (
            <button type="button" className="mt-2 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAll((value) => !value)}>
              {all ? 'Show fewer' : `Show all ${countries.length}`}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

// --- what to do next ------------------------------------------------------------------------------------------

/** Run what a to-do or an activity item points at. */
function useRunAction() {
  const view = useGrowthView();
  return (action: StudioAction | undefined, appId: string) => {
    if (!action) {
      view.openApp(appId, 'overview');
      return;
    }
    switch (action.kind) {
      case 'reviews':
        view.openApp(appId, 'reviews', { reviewRating: action.rating, reviewUnanswered: action.unanswered, reviewTopic: action.topic });
        return;
      case 'listing':
        view.openApp(appId, 'listing', { locale: action.locale });
        return;
      case 'markets':
        view.openApp(appId, 'markets', { territory: action.territory });
        return;
      case 'timeline':
        view.openApp(appId, 'timeline', { eventId: action.eventId });
        return;
      case 'localize':
        view.onLocalize(action.locales);
        return;
      case 'publish':
        view.onPublish();
        return;
      case 'ask':
        view.openApp(appId, 'ask', { question: action.question });
        return;
      case 'refresh':
        view.refreshApps([appId]);
        return;
      case 'setup':
        view.goTo('connect');
        return;
      case 'health':
        view.openApp(appId, 'ratings');
        return;
    }
  };
}

const ACTION_LABEL: Record<StudioAction['kind'], string> = {
  reviews: 'Answer',
  listing: 'Fix',
  markets: 'See',
  timeline: 'See',
  localize: 'Translate',
  publish: 'Upload',
  ask: 'Ask AI',
  refresh: 'Refresh',
  setup: 'Setup',
  health: 'See',
};

const TONE_DOT: Record<InsightTone, string | null> = {
  problem: 'bg-[hsl(var(--growth-bad))]',
  warning: 'bg-amber-500',
  good: 'bg-[hsl(var(--growth-good))]',
  neutral: null,
};

type TodoRow = { kind: 'auto'; todo: StudioTodo } | { kind: 'own'; todo: ManualTodo };

function TodoList({
  todos,
  meta,
  loaded,
  noApps,
  onShown,
}: {
  todos: StudioTodo[];
  meta: Map<string, AppMeta>;
  loaded: boolean;
  noApps: boolean;
  /** The ids of the rows Growth worked out that are on screen now. */
  onShown: (ids: string[]) => void;
}) {
  const view = useGrowthView();
  const run = useRunAction();
  const own = useManualTodos();
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  // Due days are on the person's own calendar, not the stores' UTC one.
  const day = localDay();
  const ownSorted = useMemo(() => sortManualTodos(own.list), [own.list]);
  // The user's own first, ticked-off ones struck through under the open ones
  // so a tick never sends one out of sight, then the ones Growth worked out.
  const rows: TodoRow[] = useMemo(
    () => [...ownSorted.map((todo) => ({ kind: 'own' as const, todo })), ...todos.map((todo) => ({ kind: 'auto' as const, todo }))],
    [ownSorted, todos]
  );
  const counts = manualCounts(own.list, day);
  const open = counts.open + todos.length;
  const shown = all ? rows : rows.slice(0, 6);
  const shownIds = shown.flatMap((row) => (row.kind === 'auto' ? [row.todo.id] : [])).join('\n');
  useEffect(() => onShown(shownIds ? shownIds.split('\n') : []), [shownIds, onShown]);

  return (
    <Panel className="rounded-xl" data-testid="growth-today-todo">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">To do</h3>
        <InfoTip label="Where the to-do list comes from">
          <p>Growth writes most of this list from your apps: reviews waiting for a reply, problems on a store page, numbers that moved, crashes and setup left to finish. Those go away by themselves once they're done.</p>
          <p>Add your own to-dos too, with a day they're due. They stay on this computer.</p>
        </InfoTip>
        <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          Add a to-do
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center" data-testid="growth-today-todo-counts">
        {[
          { label: 'Open', value: open, tone: null },
          { label: 'Due today', value: counts.dueToday, tone: counts.dueToday > 0 ? 'text-amber-700 dark:text-amber-300' : null },
          { label: 'Late', value: counts.late, tone: counts.late > 0 ? 'text-[hsl(var(--growth-bad))]' : null },
        ].map((entry) => (
          <div key={entry.label} className="rounded-lg bg-muted/50 px-2 py-2">
            <p className={cn('text-lg font-semibold leading-none', entry.tone)}>{formatCount(entry.value)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{entry.label}</p>
          </div>
        ))}
      </div>

      {adding && <AddTodo meta={meta} onDone={() => setAdding(false)} />}

      {rows.length === 0 ? (
        noApps ? (
          <p className="text-xs text-muted-foreground">Things to do for your apps show up here.</p>
        ) : loaded ? (
          <div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--growth-good))]/5 px-3 py-3 text-xs">
            <CheckCircle2Icon className="h-4 w-4 shrink-0 text-[hsl(var(--growth-good))]" />
            Nothing to do right now. Nice work.
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            Reading your apps
          </p>
        )
      ) : (
        <ul className="space-y-0.5">
          {shown.map((row) => {
            if (row.kind === 'own') return <OwnTodo key={row.todo.id} todo={row.todo} app={row.todo.appId ? meta.get(row.todo.appId) : undefined} day={day} />;
            const todo = row.todo;
            const app = meta.get(todo.appId);
            const reason = todo.action.kind === 'refresh' ? view.refreshReason(todo.appId) : null;
            const dot = TONE_DOT[todo.tone];
            return (
              <li key={todo.id} className="flex items-start gap-3 rounded-lg px-1.5 py-2 hover:bg-muted/40" data-todo-id={todo.id}>
                <span className="relative mt-0.5 shrink-0">
                  <AppAvatar app={{ name: app?.name ?? '' }} iconUrl={app?.iconUrl} slot={app?.slot ?? 0} size={28} />
                  {dot && <span className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card', dot)} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{todo.title}</span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">{app?.name}</span>
                    {todo.detail ? `. ${todo.detail}` : ''}
                  </span>
                </span>
                <Gated reason={reason}>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 px-2.5 text-xs" onClick={() => run(todo.action, todo.appId)}>
                    {ACTION_LABEL[todo.action.kind]}
                  </Button>
                </Gated>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > 6 && (
        <button type="button" className="mt-2 px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </Panel>
  );
}

/** One of the user's own to-dos: a round box to tick it off, its app and when it's due. */
function OwnTodo({ todo, app, day }: { todo: ManualTodo; app: AppMeta | undefined; day: string }) {
  const done = !!todo.doneAt;
  const due = todo.due ? dueWords(todo.due, day) : null;
  const toggle = () =>
    void changeManualTodos((list) => list.map((entry) => (entry.id === todo.id ? { ...entry, doneAt: done ? undefined : Date.now() } : entry))).catch((error) =>
      console.error('The to-do could not be saved', error)
    );
  const remove = () => void changeManualTodos((list) => list.filter((entry) => entry.id !== todo.id)).catch((error) => console.error('The to-do could not be removed', error));
  return (
    <li className="group flex items-start gap-3 rounded-lg px-1.5 py-2 hover:bg-muted/40" data-todo-id={todo.id}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Not done yet: ${todo.title}` : `Done: ${todo.title}`}
        onClick={toggle}
        className={cn(
          'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          done ? 'border-[hsl(var(--growth-good))] bg-[hsl(var(--growth-good))] text-white' : 'border-muted-foreground/40 hover:border-[hsl(var(--growth-good))]'
        )}
      >
        {done && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
      </button>
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words text-sm leading-snug', done && 'text-muted-foreground line-through')}>{todo.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {app && (
            <span className="flex min-w-0 items-center gap-1">
              <AppAvatar app={{ name: app.name }} iconUrl={app.iconUrl} slot={app.slot} size={14} />
              <span className="truncate">{app.name}</span>
            </span>
          )}
          {due && !done && (
            <span
              className={cn(
                'font-medium',
                due.state === 'late' && 'text-[hsl(var(--growth-bad))]',
                due.state === 'today' && 'text-amber-700 dark:text-amber-300'
              )}
            >
              {due.text}
            </span>
          )}
          {!app && !due && !done && <span>Your own to-do</span>}
          {done && <span>Done</span>}
        </span>
      </span>
      <button
        type="button"
        onClick={remove}
        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={`Remove the to-do: ${todo.title}`}
        title="Remove"
        data-touch-reveal
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function AddTodo({ meta, onDone }: { meta: Map<string, AppMeta>; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [appId, setAppId] = useState<string>('none');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => input.current?.focus(), []);
  const ready = title.trim().length > 0 && !saving;
  const save = () => {
    if (!ready) return;
    setSaving(true);
    const todo = newManualTodo({ title, appId: appId === 'none' ? null : appId, due: due || null });
    void changeManualTodos((list) => [...list, todo])
      .then(onDone, (error) => console.error('The to-do could not be saved', error))
      .finally(() => setSaving(false));
  };
  return (
    <form
      className="mb-3 space-y-2 rounded-lg border bg-muted/30 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      data-testid="growth-today-add-todo"
    >
      <Input
        ref={input}
        value={title}
        maxLength={MAX_TODO_LENGTH}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
        placeholder="What needs doing?"
        aria-label="What needs doing"
        className="h-8 bg-card text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={appId} onValueChange={setAppId}>
          <SelectTrigger className="h-8 w-[150px] bg-card text-xs" aria-label="Which app">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">
              No app
            </SelectItem>
            {Array.from(meta.values()).map((app) => (
              <SelectItem key={app.id} value={app.id} className="text-xs">
                {app.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Due on" className="h-8 w-[140px] bg-card text-xs" />
        <span className="ml-auto flex gap-1.5">
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className="h-8 px-3 text-xs" disabled={!ready}>
            Add
          </Button>
        </span>
      </div>
    </form>
  );
}

// --- what happened -------------------------------------------------------------------------------------------

const ACTIVITY_ICON: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  review: MessageSquareIcon,
  'rating-change': StarIcon,
  release: RocketIcon,
  screenshots: ImagesIcon,
  listing: TypeIcon,
  featured: FlagIcon,
  milestone: TrophyIcon,
  'good-news': SparkleIcon,
};

function Activity({
  items,
  meta,
  since,
  onShown,
}: {
  items: StudioActivity[];
  meta: Map<string, AppMeta>;
  since: number | null;
  /** The ids of the items on screen now. */
  onShown: (ids: string[]) => void;
}) {
  const run = useRunAction();
  const [all, setAll] = useState(false);
  const now = Date.now();
  const day = today();
  const fresh = since === null ? 0 : items.filter((item) => item.at > since).length;
  const shown = all ? items : items.slice(0, 6);
  const shownIds = shown.map((item) => item.id).join('\n');
  useEffect(() => onShown(shownIds ? shownIds.split('\n') : []), [shownIds, onShown]);
  return (
    <Panel className="rounded-xl" data-testid="growth-today-activity">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">What's new</h3>
        {fresh > 0 && since !== 0 && (
          <span className="rounded-full bg-[hsl(var(--growth-series))]/12 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--growth-series))]">
            {fresh} since your last look
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">New reviews, releases, uploads and round numbers from the last few weeks show up here.</p>
      ) : (
        <ol className="relative space-y-0.5">
          {shown.map((item) => {
            const app = meta.get(item.appId);
            const Icon = ACTIVITY_ICON[item.kind];
            const isNew = since !== null && since !== 0 && item.at > since;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => run(item.action, item.appId)}
                  className="flex w-full items-start gap-3 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                      item.tone === 'good' && 'bg-[hsl(var(--growth-good))]/10 text-[hsl(var(--growth-good))]',
                      item.tone === 'warning' && 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
                      item.tone === 'problem' && 'bg-[hsl(var(--growth-bad))]/10 text-[hsl(var(--growth-bad))]',
                      item.tone === 'neutral' && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {item.kind === 'milestone' ? <PartyPopperIcon className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-sm leading-snug">
                        <span className="line-clamp-2 font-medium">{item.title}</span>
                      </span>
                      {isNew && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--growth-series))]" title="New since your last look" />}
                    </span>
                    {item.stars !== undefined && item.kind === 'review' && (
                      <span className="mt-0.5 block">
                        <StarRow rating={item.stars} />
                      </span>
                    )}
                    {item.detail && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{item.detail}</span>}
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: slotColor(app?.slot ?? 0) }} aria-hidden />
                      <span className="truncate">{app?.name}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{whenWords(item, now, day)}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 6 && (
        <button type="button" className="mt-2 px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </Panel>
  );
}

// --- milestones ----------------------------------------------------------------------------------------------------

function paceWords(milestone: Milestone): string {
  const words = MILESTONE_WORDS[milestone.kind];
  if (milestone.daysLeft !== null) return `${roughDays(milestone.daysLeft)} to go at this pace`;
  if (milestone.perDay && milestone.perDay > 0) return 'More than two years away at this pace';
  if (milestone.kind === 'ratings' && milestone.perDay === null) return 'Growth needs a week of ratings to guess when';
  return `No new ${words.many} lately`;
}

function Milestones({ milestones, meta }: { milestones: Milestone[]; meta: Map<string, AppMeta> }) {
  const [all, setAll] = useState(false);
  const day = today();
  const recent = (milestone: Milestone) => !!milestone.passedOn && milestone.passed > 0 && milestone.passedOn >= addDays(day, -7);
  const shown = all ? milestones : milestones.slice(0, 4);
  return (
    <Panel className="rounded-xl" data-testid="growth-today-milestones">
      <div className="mb-3 flex items-center gap-2">
        <TrophyIcon className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">Milestones</h3>
        <InfoTip label="How the guess works">
          <p>The next round number for each app, and when it'll get there if the last four weeks keep their pace.</p>
          <p>Downloads count from the first day Growth has numbers for.</p>
        </InfoTip>
      </div>
      {milestones.length === 0 ? (
        <p className="text-xs text-muted-foreground">Round numbers for downloads, ratings and reviews show up after the first refresh.</p>
      ) : (
        <ul className="space-y-3.5">
          {shown.map((milestone) => {
            const app = milestone.appId ? meta.get(milestone.appId) : null;
            const words = MILESTONE_WORDS[milestone.kind];
            const share = Math.max(0.02, Math.min(1, milestone.value / milestone.goal));
            const party = recent(milestone);
            return (
              <li key={milestone.id}>
                <div className="flex items-center gap-2 text-xs">
                  {app ? (
                    <AppAvatar app={{ name: app.name }} iconUrl={app.iconUrl} slot={app.slot} size={18} />
                  ) : (
                    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[hsl(var(--growth-series))]/15 text-[hsl(var(--growth-series))]" aria-hidden>
                      <SparkleIcon className="h-3 w-3" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{app?.name ?? 'All apps'}</span>
                    <span className="text-muted-foreground"> · {words.many}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    <span className="font-semibold text-foreground">{formatCount(milestone.value)}</span> of {formatCount(milestone.goal)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={milestone.goal} aria-valuenow={milestone.value} aria-label={`${app?.name ?? 'All apps'}: ${formatCount(milestone.value)} of ${formatCount(milestone.goal)} ${words.many}`}>
                  <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: app ? slotColor(app.slot) : 'hsl(var(--growth-series))' }} />
                </div>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {party ? (
                    <>
                      <PartyPopperIcon className="h-3 w-3 text-amber-500" aria-hidden />
                      Passed {formatCount(milestone.passed)} on {formatDay(milestone.passedOn!)}
                    </>
                  ) : (
                    paceWords(milestone)
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {milestones.length > 4 && (
        <button type="button" className="mt-3 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${milestones.length}`}
        </button>
      )}
    </Panel>
  );
}
