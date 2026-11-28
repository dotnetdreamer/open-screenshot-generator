"use client";

// The overview: one line on how everything stands, the counts, every
// monitor's last 90 days, and what changed lately. With no monitors yet it
// is the welcome: paste an address, or pick one of the pages and apps the
// app already knows about.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  BellRingIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WifiOffIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { monitorFromInput } from '@/lib/uptime/detect';
import { uptimeCommands } from '@/lib/uptime/engine';
import { formatAgo, formatDuration, formatMs, formatPercent, formatWhen } from '@/lib/uptime/format';
import { dayBars, headline, outagesOf, overallUptime, uptimeOf, type Headline } from '@/lib/uptime/stats';
import type { Beat, Bucket, Monitor, UptimeEvent } from '@/lib/uptime/types';
import { CheckBars, DayBars, DayLegend } from './UptimeCharts';
import { KindIcon, Panel, PanelTitle, StateIcon, StatusDot, Tile, useSuggestions, useUptimeView, useWatch } from './UptimeShared';

const DAY = 86_400_000;
const BOARD_DAYS = 90;
const BOARD_ROWS = 12;

export function UptimeOverview() {
  const { view } = useUptimeView();
  if (view.monitors.length === 0) return <Welcome />;
  return <Dashboard />;
}

// ---- with monitors ----------------------------------------------------------

function Dashboard() {
  const { view, now, go, summaryOf } = useUptimeView();
  const line = headline(view.monitors, view.summaries, now, view.offlineSince);
  const active = view.monitors.filter((monitor) => !monitor.paused);
  const down = active.filter((monitor) => summaryOf(monitor.id)?.state === 'down');
  const up = active.filter((monitor) => summaryOf(monitor.id)?.state === 'up');
  const averages = view.summaries.map((summary) => summary.avg24).filter((value): value is number => value !== null);
  const average = averages.length ? averages.reduce((total, value) => total + value, 0) / averages.length : null;
  const lastCheck = Math.max(0, ...view.summaries.map((summary) => summary.last?.t ?? 0));
  const firstDown = down.map((monitor) => summaryOf(monitor.id)?.downSince ?? null).filter((value): value is number => value !== null).sort((a, b) => a - b)[0];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <Hero line={line} lastCheck={lastCheck || null} onOpen={down.length === 1 ? () => go({ name: 'monitor', id: down[0].id }) : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Up" value={`${up.length} of ${active.length}`} hint={view.monitors.length > active.length ? `${view.monitors.length - active.length} paused` : 'Being checked now'} icon={<StateIcon state="up" className="h-3.5 w-3.5 text-[hsl(var(--uptime-up-text))]" />} testId="uptime-tile-up" />
        <Tile
          label="Down"
          value={down.length}
          tone={down.length > 0 ? 'down' : undefined}
          hint={firstDown ? `Since ${formatWhen(firstDown, now)}` : 'Nothing is down'}
          icon={<StateIcon state="down" className="h-3.5 w-3.5 text-[hsl(var(--uptime-down-text))]" />}
          testId="uptime-tile-down"
        />
        <Tile label="Uptime, last 24 hours" value={formatPercent(overallUptime(view.summaries))} hint="Average of your monitors" icon={<ActivityIcon className="h-3.5 w-3.5" />} />
        <Tile label="Answer time, last 24 hours" value={formatMs(average)} hint="How long they take to answer" icon={<ZapGlyph />} />
      </div>
      <Suggested />
      <StatusBoard monitors={view.monitors} />
      <Changes />
    </div>
  );
}

/** What else the app knows about, still not watched: one click each, or hidden for good. */
function Suggested() {
  const { view } = useUptimeView();
  const { suggestions, hide } = useSuggestions(view.monitors);
  const { watch, adding } = useWatch();
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <Panel data-testid="uptime-suggestions">
      <PanelTitle title="More to watch" hint="From your website and the apps in Growth" />
      <ul className="divide-y">
        {suggestions.map((suggestion) => (
          <li key={suggestion.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <KindIcon kind={suggestion.monitor.kind} className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{suggestion.title}</p>
              <p className="truncate text-xs text-muted-foreground">{suggestion.hint}</p>
            </div>
            <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={adding !== null} onClick={() => void watch(suggestion)}>
              {adding === suggestion.key ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : 'Watch'}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" aria-label={`Don't suggest ${suggestion.title} again`} title="Don't suggest this again" onClick={() => hide(suggestion.key)}>
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ZapGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

const HERO_TONES: Record<Headline['tone'], { ring: string; wash: string; icon: React.ReactNode; trace: string }> = {
  good: { ring: 'bg-[hsl(var(--uptime-up)/0.14)] text-[hsl(var(--uptime-up-text))]', wash: 'from-[hsl(var(--uptime-up)/0.10)]', icon: <CheckCircle2Icon className="h-7 w-7" />, trace: 'hsl(var(--uptime-up))' },
  warning: { ring: 'bg-[hsl(var(--uptime-pending)/0.18)] text-[hsl(var(--uptime-pending-text))]', wash: 'from-[hsl(var(--uptime-pending)/0.12)]', icon: <AlertTriangleIcon className="h-7 w-7" />, trace: 'hsl(var(--uptime-pending))' },
  critical: { ring: 'bg-[hsl(var(--uptime-down)/0.14)] text-[hsl(var(--uptime-down-text))]', wash: 'from-[hsl(var(--uptime-down)/0.12)]', icon: <XCircleIcon className="h-7 w-7" />, trace: 'hsl(var(--uptime-down))' },
  quiet: { ring: 'bg-muted text-muted-foreground', wash: 'from-muted/60', icon: <ActivityIcon className="h-7 w-7" />, trace: 'hsl(var(--muted-foreground))' },
};

/** A heartbeat line drawn across the hero, its pulse running along it unless the user asked for less motion. */
function Trace({ color, flat }: { color: string; flat: boolean }) {
  const beat = flat ? 'l 24 0 l 8 0 l 8 0 l 8 0 l 8 0' : 'l 24 0 l 6 -14 l 8 30 l 6 -22 l 6 6';
  const path = `M 0 34 ${Array.from({ length: 6 }, () => `${beat} l 40 0`).join(' ')}`;
  return (
    <svg viewBox="0 0 552 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[42%] opacity-70 lg:block" aria-hidden>
      <defs>
        <linearGradient id="uptime-trace-fade" x1="0" x2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="35%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="url(#uptime-trace-fade)" strokeWidth="1.5" strokeLinejoin="round" />
      {!flat && <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="uptime-trace" />}
    </svg>
  );
}

function Hero({ line, lastCheck, onOpen }: { line: Headline; lastCheck: number | null; onOpen?: () => void }) {
  const { now } = useUptimeView();
  const tone = HERO_TONES[line.tone];
  return (
    <section className={cn('relative overflow-hidden rounded-2xl border bg-gradient-to-r to-card to-60% p-5 md:p-6', tone.wash)} data-testid="uptime-hero" data-tone={line.tone} aria-live="polite">
      <Trace color={tone.trace} flat={line.tone === 'quiet'} />
      <div className="relative flex flex-wrap items-center gap-4">
        <div className={cn('relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl', tone.ring)}>
          {line.tone === 'critical' && <span className="absolute inset-0 rounded-2xl bg-[hsl(var(--uptime-down)/0.25)] motion-safe:animate-ping" aria-hidden />}
          <span className="relative">{line.tone === 'warning' && line.title.includes('offline') ? <WifiOffIcon className="h-7 w-7" /> : tone.icon}</span>
        </div>
        <div className="min-w-0 flex-1 lg:max-w-[55%]">
          <h2 className="text-xl font-semibold leading-tight md:text-2xl">{line.title}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{line.detail}</p>
          {lastCheck && <p className="mt-1.5 text-[11px] text-muted-foreground">Last check {formatAgo(lastCheck, now)}</p>}
        </div>
        {onOpen && (
          <Button size="sm" variant="outline" className="relative gap-1" onClick={onOpen}>
            See what happened
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </section>
  );
}

function StatusBoard({ monitors }: { monitors: Monitor[] }) {
  const { now, go } = useUptimeView();
  const [hours, setHours] = useState<Record<string, Bucket[]>>({});
  const [showAll, setShowAll] = useState(false);
  const listed = showAll ? monitors : monitors.slice(0, BOARD_ROWS);
  const ids = listed.map((monitor) => monitor.id).join(',');
  const { view } = useUptimeView();
  // A clear or an outage changes a monitor's revision, and its bars with it.
  const revisions = view.summaries.map((summary) => summary.revision).join(',');
  // Read when the list changes and every five minutes, not on every check.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((count) => count + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let current = true;
    const to = Date.now();
    void Promise.all(
      ids
        .split(',')
        .filter(Boolean)
        .map(async (id) => [id, await uptimeCommands.hours(id, to - BOARD_DAYS * DAY, to + 3_600_000).catch(() => [] as Bucket[])] as const)
    ).then((rows) => {
      if (current) setHours(Object.fromEntries(rows));
    });
    return () => {
      current = false;
    };
  }, [ids, tick, revisions]);

  return (
    <Panel>
      <PanelTitle title="Last 90 days" hint="Each bar is a day. The more time down, the taller the bar." actions={<DayLegend />} />
      <ul className="divide-y" data-testid="uptime-board">
        {listed.map((monitor) => {
          const buckets = hours[monitor.id];
          const bars = buckets ? dayBars(buckets, BOARD_DAYS, now) : null;
          const share = buckets ? uptimeOf(buckets) : null;
          return (
            <li key={monitor.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="mb-1.5 flex items-center gap-2">
                <KindIcon kind={monitor.kind} className="h-3.5 w-3.5 text-muted-foreground" />
                <button type="button" className="min-w-0 truncate text-sm font-medium hover:underline" onClick={() => go({ name: 'monitor', id: monitor.id })}>
                  {monitor.name}
                </button>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{buckets ? (share === null ? 'No checks yet' : `${formatPercent(share)} up`) : ''}</span>
              </div>
              {bars ? <DayBars bars={bars} label={`${monitor.name}, last 90 days`} compact /> : <div className="h-6 animate-pulse rounded-md bg-muted" />}
            </li>
          );
        })}
      </ul>
      {monitors.length > BOARD_ROWS && (
        <Button size="sm" variant="ghost" className="mt-2 h-7 text-xs" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all ${monitors.length}`}
        </Button>
      )}
    </Panel>
  );
}

const EVENT_ICONS: Record<UptimeEvent['kind'], { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  down: { icon: XCircleIcon, className: 'text-[hsl(var(--uptime-down-text))]' },
  up: { icon: CheckCircle2Icon, className: 'text-[hsl(var(--uptime-up-text))]' },
  paused: { icon: PauseIcon, className: 'text-muted-foreground' },
  resumed: { icon: PlayIcon, className: 'text-muted-foreground' },
  cert: { icon: ShieldAlertIcon, className: 'text-[hsl(var(--uptime-pending-text))]' },
  version: { icon: SparklesIcon, className: 'text-[hsl(var(--uptime-accent))]' },
  added: { icon: PlusIcon, className: 'text-muted-foreground' },
  changed: { icon: PencilIcon, className: 'text-muted-foreground' },
};

/** What an event says, in a sentence about the monitor. */
export function eventText(event: UptimeEvent, name: string): { title: string; detail: string } {
  switch (event.kind) {
    case 'down':
      return { title: `${name} went down`, detail: event.msg ?? '' };
    case 'up':
      return { title: `${name} is back up`, detail: event.dur !== undefined ? `Down for ${formatDuration(event.dur)}` : '' };
    case 'paused':
      return { title: `${name} was paused`, detail: event.dur ? `For ${formatDuration(event.dur)}` : 'Until you resume it' };
    case 'resumed':
      return { title: `${name} is being checked again`, detail: '' };
    case 'cert':
      return { title: `${name}: ${event.msg ?? 'the certificate runs out soon'}`, detail: 'Renew it before then' };
    case 'version':
      return { title: `${name}: ${event.msg ?? 'a new version is live'}`, detail: '' };
    case 'added':
      return { title: `${name} was added`, detail: '' };
    case 'changed':
      return { title: `${name} was changed`, detail: '' };
  }
}

function Changes() {
  const { view, now, go, monitorOf } = useUptimeView();
  const [events, setEvents] = useState<UptimeEvent[] | null>(null);
  // A change of any monitor's state is when the list can have grown.
  // Every change to a monitor's history moves its revision on.
  const states = view.summaries.map((summary) => `${summary.id}:${summary.revision}`).join('|');
  useEffect(() => {
    let current = true;
    void uptimeCommands
      .events(null, 40)
      .then((rows) => {
        if (current) setEvents(rows.filter((event) => event.kind !== 'changed'));
      })
      .catch(() => current && setEvents([]));
    return () => {
      current = false;
    };
  }, [states]);
  const outages = useMemo(() => (events ? outagesOf(events, now).filter((outage) => outage.end === null || now - outage.start < 7 * DAY) : []), [events, now]);

  return (
    <Panel>
      <PanelTitle title="Latest changes" hint={outages.length ? `${outages.length} ${outages.length === 1 ? 'outage' : 'outages'} in the last 7 days` : 'No outages in the last 7 days'} />
      {events === null ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          Reading the history
        </div>
      ) : events.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">Changes such as a monitor going down or coming back show here.</p>
      ) : (
        <ol className="relative space-y-0" data-testid="uptime-changes">
          {events.slice(0, 15).map((event) => {
            const monitor = monitorOf(event.id);
            const { icon: Icon, className } = EVENT_ICONS[event.kind];
            const text = eventText(event, monitor?.name ?? 'A deleted monitor');
            return (
              <li key={`${event.id}:${event.t}:${event.kind}`} className="group relative flex gap-3 pb-3 last:pb-0">
                <span aria-hidden className="absolute left-[9px] top-6 h-[calc(100%-1rem)] w-px bg-border group-last:hidden" />
                <Icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', className)} />
                <div className="min-w-0 flex-1">
                  {monitor ? (
                    <button type="button" className="text-left text-sm font-medium hover:underline" onClick={() => go({ name: 'monitor', id: monitor.id })}>
                      {text.title}
                    </button>
                  ) : (
                    <p className="text-sm font-medium">{text.title}</p>
                  )}
                  {text.detail && <p className="text-xs text-muted-foreground">{text.detail}</p>}
                </div>
                <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground" dateTime={new Date(event.t).toISOString()} title={new Date(event.t).toLocaleString()}>
                  {formatWhen(event.t, now)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

// ---- before the first monitor --------------------------------------------

function Welcome() {
  const { go, view } = useUptimeView();
  const [text, setText] = useState('');
  const { suggestions } = useSuggestions(view.monitors);
  const { watch, adding } = useWatch();

  const start = () => {
    const seed = monitorFromInput(text);
    track('uptime_welcome_paste', { kind: seed?.kind ?? 'none' });
    go({ name: 'add', seed: seed ?? undefined });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8" data-testid="uptime-welcome">
      <section className="relative grid items-center gap-8 overflow-hidden rounded-3xl border bg-gradient-to-br from-[hsl(var(--uptime-accent)/0.12)] via-card to-card p-6 md:grid-cols-[minmax(0,1fr)_280px] md:p-10">
        <div className="relative space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--uptime-accent)/0.12)] px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--uptime-accent))]">
            <ActivityIcon className="h-3.5 w-3.5" />
            Uptime
          </span>
          <h2 className="text-2xl font-semibold leading-tight md:text-3xl">Know the moment your website goes down</h2>
          <p className="text-sm text-muted-foreground md:text-base">
            Uptime checks your website, your app&apos;s server and your store listing from this computer, as often as every 20 seconds, and tells you when one stops answering.
          </p>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <Input
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste a web address or a store link"
              aria-label="Web address, server or store link"
              className="h-11 flex-1 bg-card text-sm"
              data-testid="uptime-welcome-input"
            />
            <Button type="submit" className="h-11 gap-1.5 bg-[hsl(var(--uptime-accent))] px-5 text-white hover:bg-[hsl(var(--uptime-accent))]/90 dark:text-background">
              Start watching
              <ArrowRightIcon className="h-4 w-4" />
            </Button>
          </form>
        </div>
        <Preview />
      </section>

      {suggestions && suggestions.length > 0 && (
        <section aria-labelledby="uptime-suggestions-title" data-testid="uptime-suggestions">
          <h3 id="uptime-suggestions-title" className="mb-2 text-sm font-semibold">
            From your apps
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {suggestions.map((suggestion) => (
              <div key={suggestion.key} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <KindIcon kind={suggestion.monitor.kind} className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{suggestion.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{suggestion.hint}</p>
                </div>
                <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={adding !== null} onClick={() => void watch(suggestion)}>
                  {adding === suggestion.key ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : 'Watch'}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3 md:grid-cols-3" aria-label="How Uptime works">
        <HowItem icon={ActivityIcon} title="Checks from this computer">
          Every minute, or as often as you pick, while this app is open. A web page, a server port, a ping, a domain record or your store listing.
        </HowItem>
        <HowItem icon={BellRingIcon} title="Alerts when something breaks">
          A notification here, and a message in Slack, Discord, Telegram or ntfy if you add one. You hear again when it&apos;s back.
        </HowItem>
        <HowItem icon={ShieldCheckIcon} title="Nothing to host">
          No account and no server. The history stays on this computer, and time the app was closed never counts as down.
        </HowItem>
      </section>
    </div>
  );
}

/** What a watched site looks like, drawn from made-up checks: a monitor card and an alert over it. */
function Preview() {
  const beats = useMemo(
    () =>
      Array.from({ length: 34 }, (_, index) => ({
        t: index,
        s: (index === 21 ? 'down' : index === 20 ? 'pending' : 'up') as Beat['s'],
        ms: 160 + ((index * 37) % 60),
      })),
    []
  );
  return (
    <div className="relative hidden h-56 md:block" aria-hidden>
      <div className="absolute right-0 top-2 w-[264px] rounded-2xl border bg-card p-4 shadow-xl shadow-black/5">
        <div className="flex items-center gap-2">
          <StatusDot state="up" />
          <span className="flex-1 truncate text-sm font-semibold">yourapp.com</span>
          <span className="rounded-full bg-[hsl(var(--uptime-up)/0.12)] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--uptime-up-text))]">Up</span>
        </div>
        <p className="mt-1 pl-[18px] text-[11px] text-muted-foreground">Up for 12 days, answers in 182 ms</p>
        <CheckBars beats={beats} now={0} label="Example checks" className="mt-3" />
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-2xl font-semibold">99.98%</span>
          <span className="text-[11px] text-muted-foreground">up, last 30 days</span>
        </div>
      </div>
      <div className="absolute bottom-1 left-0 w-[236px] rounded-xl border bg-card/95 p-3 shadow-lg shadow-black/10 backdrop-blur">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <StateIcon state="up" className="h-3.5 w-3.5 text-[hsl(var(--uptime-up-text))]" />
          yourapp.com is back up
        </p>
        <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">It was down for 2 minutes.</p>
      </div>
    </div>
  );
}

function HowItem({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--uptime-accent)/0.12)] text-[hsl(var(--uptime-accent))]">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
