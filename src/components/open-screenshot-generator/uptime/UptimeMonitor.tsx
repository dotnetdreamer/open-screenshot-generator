"use client";

// One monitor's page: where it stands and since when, its last checks, the
// uptime and answer times, the response time chart, its last 90 days, its
// outages and what the last answer said.

import React, { useEffect, useMemo, useState } from 'react';
import {
  CopyIcon,
  ExternalLinkIcon,
  EraserIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  WifiOffIcon,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { isTauri, openExternal } from '@/lib/desktop';
import { refreshUptime } from '@/lib/uptime/store';
import { cn } from '@/lib/utils';
import { uptimeCommands } from '@/lib/uptime/engine';
import { copyName, daysLeft, formatAgo, formatDate, formatDuration, formatInterval, formatMs, formatPercent, formatWhen, KIND_LABELS, openableUrl, targetText } from '@/lib/uptime/format';
import { beatSeries, coverMs, dayBars, hourSeries, lastBeats, outagesOf, partlyUnseen, uptimeOf, type ResponsePoint } from '@/lib/uptime/stats';
import type { Bucket, Monitor, Summary, UptimeEvent } from '@/lib/uptime/types';
import { CheckBars, CheckLegend, DayBars, DayLegend, ResponseChart } from './UptimeCharts';
import { Fact, KindIcon, Panel, PanelTitle, StateChip, StateIcon, Tile, stateText, stateTint, useUptimeView } from './UptimeShared';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Range = 'hour' | 'day' | 'week' | 'month';
const RANGES: Array<{ id: Range; label: string; span: number }> = [
  { id: 'hour', label: 'Last hour', span: HOUR },
  { id: 'day', label: '24 hours', span: DAY },
  { id: 'week', label: '7 days', span: 7 * DAY },
  { id: 'month', label: '30 days', span: 30 * DAY },
];

export function UptimeMonitor({ id }: { id: string }) {
  const { monitorOf, summaryOf, now } = useUptimeView();
  const monitor = monitorOf(id);
  const summary = summaryOf(id);
  // The figures as of opening the page, not of the last view Rust sent
  // (see `FIGURES_EVERY` in UptimeWorkspace.tsx).
  useEffect(() => {
    if (isTauri()) void refreshUptime();
  }, [id]);
  if (!monitor || !summary) return null;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6" data-testid="uptime-monitor" data-monitor={monitor.id}>
      <Heading monitor={monitor} summary={summary} />
      <StateBanner monitor={monitor} summary={summary} now={now} />
      <Panel>
        <PanelTitle title="Last checks" hint={`The newest is on the right. ${formatInterval(monitor.interval)}.`} actions={<CheckLegend />} />
        <CheckBars beats={lastBeats(summary.recent, 100)} now={now} size="lg" label={`${monitor.name}, last 100 checks`} />
      </Panel>
      <Numbers monitor={monitor} summary={summary} now={now} />
      <Response monitor={monitor} summary={summary} />
      <History monitor={monitor} summary={summary} />
      <LastAnswer monitor={monitor} summary={summary} now={now} />
    </div>
  );
}

function Heading({ monitor, summary }: { monitor: Monitor; summary: Summary }) {
  const { go, view } = useUptimeView();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<'delete' | 'clear' | null>(null);
  const [checking, setChecking] = useState(false);
  const link = openableUrl(monitor);

  const run = async (label: string, action: () => Promise<unknown>, done?: string) => {
    try {
      await action();
      if (done) toast({ title: done });
    } catch (failure) {
      toast({ title: label, description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' });
    }
  };

  const checkNow = async () => {
    setChecking(true);
    await run('The check didn\'t start', () => uptimeCommands.check(monitor.id));
    track('uptime_check_now', { kind: monitor.kind });
    window.setTimeout(() => setChecking(false), 800);
  };

  const pause = (hours: number | null) =>
    run('The monitor wasn\'t paused', () => uptimeCommands.pause(monitor.id, hours === null ? null : Date.now() + hours * HOUR), hours === null ? `${monitor.name} is paused` : `${monitor.name} is paused for ${formatDuration(hours * HOUR)}`);

  const duplicate = async () => {
    try {
      // "copy" makes it the user's name: the store's name mustn't take it back.
      const name = copyName(monitor.name, view.monitors.map((other) => other.name));
      const copy = await uptimeCommands.save({ ...monitor, id: '', name, autoName: false, paused: false, pausedUntil: null });
      toast({ title: `${copy.name} added` });
      go({ name: 'monitor', id: copy.id });
    } catch (failure) {
      toast({ title: 'The copy wasn\'t made', description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card">
        <KindIcon kind={monitor.kind} className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-xl font-semibold leading-tight" data-testid="uptime-monitor-name">
            {monitor.name}
          </h2>
          <StateChip state={summary.state} />
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="shrink-0">{KIND_LABELS[monitor.kind]}</span>
          <span aria-hidden>·</span>
          {link ? (
            <button type="button" className="inline-flex min-w-0 items-center gap-1 truncate hover:text-foreground hover:underline" onClick={() => void openExternal(link)} title="Open in your browser">
              <span className="truncate">{targetText(monitor)}</span>
              <ExternalLinkIcon className="h-3 w-3 shrink-0" />
            </button>
          ) : (
            <span className="truncate">{targetText(monitor)}</span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {monitor.paused ? (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => void run('The monitor wasn\'t resumed', () => uptimeCommands.resume(monitor.id), `${monitor.name} is being checked again`)}>
            <PlayIcon className="h-3.5 w-3.5" />
            Resume
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void checkNow()} disabled={checking || summary.running} data-testid="uptime-check-now">
              <RefreshCwIcon className={cn('h-3.5 w-3.5', (checking || summary.running) && 'motion-safe:animate-spin')} />
              Check now
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5">
                  <PauseIcon className="h-3.5 w-3.5" />
                  Pause
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No checks and no alerts while paused</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void pause(1)}>For 1 hour</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void pause(4)}>For 4 hours</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void pause(24)}>For a day</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void pause(null)}>Until I resume it</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => go({ name: 'edit', id: monitor.id })}>
          <PencilIcon className="h-3.5 w-3.5" />
          Edit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="More for this monitor">
              <MoreHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void duplicate()}>
              <CopyIcon className="mr-2 h-3.5 w-3.5" />
              Make a copy
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setConfirm('clear')}>
              <EraserIcon className="mr-2 h-3.5 w-3.5" />
              Clear the history
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-[hsl(var(--uptime-down-text))] focus:text-[hsl(var(--uptime-down-text))]" onSelect={() => setConfirm('delete')}>
              <Trash2Icon className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'delete' ? `Delete ${monitor.name}?` : `Clear the history of ${monitor.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete'
                ? 'Uptime stops checking it and deletes its history from this computer. This can\'t be undone.'
                : 'Every check, outage and day bar of this monitor is deleted from this computer. The monitor stays and starts again from now.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[hsl(var(--uptime-down))] text-white hover:bg-[hsl(var(--uptime-down))]/90"
              onClick={() => {
                const what = confirm;
                setConfirm(null);
                if (what === 'delete') {
                  void run('The monitor wasn\'t deleted', () => uptimeCommands.remove(monitor.id), `${monitor.name} deleted`).then(() => go({ name: 'overview' }));
                } else {
                  void run('The history wasn\'t cleared', () => uptimeCommands.clear(monitor.id), 'History cleared');
                }
              }}
            >
              {confirm === 'delete' ? 'Delete' : 'Clear the history'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StateBanner({ monitor, summary, now }: { monitor: Monitor; summary: Summary; now: number }) {
  const { view } = useUptimeView();
  const next = summary.next && summary.next > now ? `Next check ${formatAgo(summary.next, now)}` : summary.running ? 'Checking now' : null;
  const offline = view.offlineSince !== null;
  let title: string;
  let detail: string | null = null;
  switch (summary.state) {
    case 'up':
      title = summary.since ? `Up for ${formatDuration(now - summary.since)}` : 'Up';
      detail = summary.last?.ms !== undefined ? `The last check answered in ${formatMs(summary.last.ms)}.` : null;
      break;
    case 'down':
      title = summary.downSince ? `Down for ${formatDuration(now - summary.downSince)}` : 'Down';
      detail = summary.last?.msg || summary.downMsg || null;
      break;
    case 'pending':
      title = 'Failed a check, checking again';
      detail = summary.last?.msg ? `${summary.last.msg}. It counts as down after ${monitor.retries + 1} failed checks in a row.` : null;
      break;
    case 'paused':
      title = monitor.pausedUntil ? `Paused until ${formatWhen(monitor.pausedUntil, now)}` : 'Paused until you resume it';
      detail = 'No checks and no alerts while it is paused.';
      break;
    default:
      title = 'The first check is on its way';
  }
  return (
    <section className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', stateTint(summary.state))} data-testid="uptime-state" data-state={summary.state} aria-live="polite">
      <StateIcon state={summary.state} className={cn('h-6 w-6', stateText(summary.state))} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-base font-semibold', stateText(summary.state))}>{title}</p>
        {detail && <p className="text-sm text-foreground/80">{detail}</p>}
        {summary.last?.s === 'unclear' && summary.state !== 'paused' && (
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="uptime-unclear">
            {summary.last.msg ? `${summary.last.msg}. ` : ''}That check couldn&apos;t tell, so it doesn&apos;t count as up or down.
          </p>
        )}
        {offline && summary.state !== 'paused' && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <WifiOffIcon className="h-3 w-3" />
            This computer is offline, so checks don&apos;t count right now
          </p>
        )}
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {summary.last && <p>Last check {formatAgo(summary.last.t, now)}</p>}
        {next && monitor.paused === false && <p>{next}</p>}
      </div>
    </section>
  );
}

/** What Google Play lets people do with the app, from the check's `offer`. */
function offerText(offer: string | undefined, short = false): string {
  if (!offer) return 'No data';
  if (offer === 'Install') return short ? 'Install' : 'Install, for free';
  if (offer === 'Pre-register') return 'Pre-registration';
  if (offer === 'Listed') return short ? 'The page only' : 'The page only, no Install button';
  return `Buy for ${offer}`;
}

/** Under 99% reads in red, the line most uptime promises are made at. */
function lowUptime(value: number | null): 'down' | undefined {
  return value !== null && value < 99 ? 'down' : undefined;
}

function Numbers({ monitor, summary, now }: { monitor: Monitor; summary: Summary; now: number }) {
  const cert = summary.detail.cert;
  const left = cert ? daysLeft(cert.expires, now) : null;
  const certTone = left !== null && monitor.certDays > 0 && left <= monitor.certDays ? 'pending' : undefined;
  // Uptime is time between checks, so the first check alone has none yet.
  const soon = summary.uptime24 === null && summary.last ? 'After the next check' : undefined;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        label="Answer time now"
        value={summary.last?.s === 'up' ? formatMs(summary.last.ms) : summary.last ? 'None' : 'No data'}
        hint={summary.last?.s === 'up' ? (summary.last.code ? `Status ${summary.last.code}` : 'The last check') : summary.last ? 'The last check failed' : undefined}
      />
      <Tile label="Average, 24 hours" value={formatMs(summary.avg24)} hint="Checks that passed" />
      <Tile label="Uptime, 24 hours" value={formatPercent(summary.uptime24)} tone={lowUptime(summary.uptime24)} hint={soon} />
      <Tile label="Uptime, 7 days" value={formatPercent(summary.uptime7)} tone={lowUptime(summary.uptime7)} hint={soon} />
      <Tile label="Uptime, 30 days" value={formatPercent(summary.uptime30)} tone={lowUptime(summary.uptime30)} hint={soon} />
      {monitor.kind === 'http' && monitor.url.startsWith('https:') ? (
        <Tile
          label="Certificate"
          value={left === null ? 'No data' : left < 0 ? 'Ran out' : `${left} days`}
          tone={certTone}
          hint={cert ? `Until ${formatDate(cert.expires)}` : 'Read on the next check'}
          icon={certTone ? <ShieldAlertIcon className="h-3.5 w-3.5 text-[hsl(var(--uptime-pending-text))]" /> : <ShieldCheckIcon className="h-3.5 w-3.5" />}
          testId="uptime-cert"
        />
      ) : monitor.kind === 'store' && monitor.store === 'google' ? (
        // Google Play's page shows no version; what it lets people do is the news.
        <Tile label="Google Play offers" value={<span className="text-base">{offerText(summary.detail.offer, true)}</span>} hint={summary.detail.offer ? 'At the last check' : undefined} testId="uptime-offer" />
      ) : monitor.kind === 'store' ? (
        <Tile label="Version" value={summary.detail.version ?? summary.version ?? 'No data'} hint="As the App Store shows it" />
      ) : monitor.kind === 'dns' ? (
        <Tile label="Records" value={summary.detail.answers?.length ?? 0} hint={`${monitor.dnsType} records found`} />
      ) : (
        <Tile label="Answered from" value={<span className="text-base">{summary.detail.ip ?? 'No data'}</span>} hint={summary.detail.ip ? 'Its address' : undefined} />
      )}
    </div>
  );
}

function Response({ monitor, summary }: { monitor: Monitor; summary: Summary }) {
  // A monitor added in the last two hours has nothing to show across a day yet.
  const [range, setRange] = useState<Range>(() => (Date.now() - monitor.created < 2 * HOUR ? 'hour' : 'day'));
  const [points, setPoints] = useState<ResponsePoint[] | null>(null);
  const [span, setSpan] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - DAY, to: Date.now() }));
  const { now } = useUptimeView();
  const last = summary.last?.t ?? 0;
  const revision = summary.revision;
  useEffect(() => {
    let current = true;
    const to = Date.now();
    const chosen = RANGES.find((entry) => entry.id === range) ?? RANGES[1];
    const from = to - chosen.span;
    const hourly = range === 'week' || range === 'month';
    (hourly ? uptimeCommands.hours(monitor.id, from, to + HOUR).then((buckets) => hourSeries(buckets, from, to)) : uptimeCommands.beats(monitor.id, from, to + 1).then((beats) => beatSeries(beats, coverMs(monitor))))
      .then((next) => {
        if (!current) return;
        setPoints(next);
        setSpan({ from, to });
      })
      .catch(() => current && setPoints([]));
    return () => {
      current = false;
    };
  }, [monitor.id, range, last, revision]);
  const hourly = range === 'week' || range === 'month';
  return (
    <Panel>
      <PanelTitle
        title="Answer time"
        hint={hourly ? 'The average of each hour. Red shading shows time it was down.' : 'Each check. Red shading shows time it was down.'}
        actions={
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="How far back">
            {RANGES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={range === entry.id}
                onClick={() => setRange(entry.id)}
                className={cn('rounded-md px-2 py-1 text-xs transition-colors', range === entry.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {entry.label}
              </button>
            ))}
          </div>
        }
      />
      {points === null ? (
        <div className="h-[220px] animate-pulse rounded-lg bg-muted/60" />
      ) : points.every((point) => point.ms === null && point.down === 0) ? (
        <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">No checks in this time yet</div>
      ) : (
        <ResponseChart points={points} from={span.from} to={span.to} hourly={hourly} slowMs={monitor.slowMs} now={now} />
      )}
    </Panel>
  );
}

function History({ monitor, summary }: { monitor: Monitor; summary: Summary }) {
  const { now } = useUptimeView();
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [events, setEvents] = useState<UptimeEvent[] | null>(null);
  // Moves on with every outage, pause and clear.
  const revision = summary.revision;
  useEffect(() => {
    let current = true;
    const to = Date.now();
    void uptimeCommands
      .hours(monitor.id, to - 90 * DAY, to + HOUR)
      .then((rows) => current && setBuckets(rows))
      .catch(() => current && setBuckets([]));
    void uptimeCommands
      .events(monitor.id, 500)
      .then((rows) => current && setEvents(rows))
      .catch(() => current && setEvents([]));
    return () => {
      current = false;
    };
  }, [monitor.id, revision]);
  const bars = useMemo(() => (buckets ? dayBars(buckets, 90, now) : null), [buckets, now]);
  const outages = useMemo(() => (events ? outagesOf(events, now) : null), [events, now]);
  const share = buckets ? uptimeOf(buckets) : null;
  return (
    <>
      <Panel>
        <PanelTitle title="Last 90 days" hint={share === null ? 'Each bar is a day. Days start at midnight where you are.' : `${formatPercent(share)} up over the days it was checked.`} actions={<DayLegend />} />
        {bars ? <DayBars bars={bars} label={`${monitor.name}, last 90 days`} /> : <div className="h-10 animate-pulse rounded-md bg-muted" />}
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
          <span>90 days ago</span>
          <span>Today</span>
        </div>
      </Panel>
      <Panel>
        <PanelTitle title="Outages" hint={outages && outages.length > 0 ? `${outages.length} since ${formatDate(outages[outages.length - 1].start)}` : undefined} />
        {outages === null ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            Reading the history
          </div>
        ) : outages.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No outages so far. When it goes down, each time shows here with how long it lasted and why.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="uptime-outages">
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th className="py-1.5 pr-4 font-medium">Started</th>
                  <th className="py-1.5 pr-4 font-medium">Lasted</th>
                  <th className="py-1.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {outages.slice(0, 50).map((outage) => (
                  <tr key={outage.start} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-2 pr-4 tabular-nums">{formatWhen(outage.start, now)}</td>
                    <td className="whitespace-nowrap py-2 pr-4">
                      {outage.end === null ? (
                        <span className={cn('font-medium', stateText('down'))}>Still down, {formatDuration(outage.length)}</span>
                      ) : (
                        <>
                          {formatDuration(outage.length)}
                          {outage.changed && <span className="block text-[11px] text-muted-foreground">Until the monitor was changed</span>}
                          {partlyUnseen(outage, monitor) && <span className="block text-[11px] text-muted-foreground">The app was closed for part of it</span>}
                        </>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">{outage.msg || 'No reason was given'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function LastAnswer({ monitor, summary, now }: { monitor: Monitor; summary: Summary; now: number }) {
  const detail = summary.detail;
  const cert = detail.cert;
  const rules: string[] = [formatInterval(monitor.interval), `gives up after ${formatDuration(monitor.timeout * 1000)}`];
  rules.push(monitor.retries === 0 ? 'down on the first failed check' : `down after ${monitor.retries + 1} failed checks in a row`);
  if (monitor.kind === 'http') {
    if (monitor.method !== 'GET') rules.push(`asks with ${monitor.method}`);
    if (monitor.accept !== '200-299') rules.push(`accepts status ${monitor.accept}`);
    if (monitor.keyword) rules.push(`${monitor.keywordAbsent ? 'fails if the page has' : 'needs the page to have'} "${monitor.keyword}"`);
    if (monitor.jsonPath) rules.push(`reads ${monitor.jsonPath} in the answer`);
  }
  return (
    <Panel>
      <PanelTitle title="Last answer" hint={detail.at ? `From the check ${formatAgo(detail.at, now)}` : 'Shows after the first check'} />
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.last?.code !== undefined && <Fact label="Status">{summary.last.code}</Fact>}
        {detail.ip && <Fact label={monitor.kind === 'dns' ? 'DNS server asked' : 'Address that answered'}>{detail.ip}</Fact>}
        {detail.finalUrl && <Fact label="Ended up at">{detail.finalUrl}</Fact>}
        {detail.server && <Fact label="Server">{detail.server}</Fact>}
        {detail.bytes !== undefined && <Fact label="Read">{detail.bytes >= 1024 ? `${Math.round(detail.bytes / 1024)} KB` : `${detail.bytes} bytes`}</Fact>}
        {cert && (
          <Fact label="Certificate">
            {cert.subject || 'For this site'}, from {cert.issuer || 'an unnamed issuer'}, runs out {formatDate(cert.expires)}
          </Fact>
        )}
        {detail.found !== undefined && <Fact label={`Value of ${monitor.jsonPath}`}>{detail.found}</Fact>}
        {detail.appName && <Fact label="App">{detail.appName}</Fact>}
        {detail.offer && <Fact label="Google Play offers">{offerText(detail.offer)}</Fact>}
        {detail.version && <Fact label="Version">{detail.version}</Fact>}
        {detail.answers && detail.answers.length > 0 && (
          <Fact label={`${monitor.dnsType} records`}>
            <ul className="space-y-0.5">
              {detail.answers.map((answer) => (
                <li key={answer} className="font-mono text-xs">
                  {answer}
                </li>
              ))}
            </ul>
          </Fact>
        )}
        <Fact label="How it's checked">{rules.join(', ')}</Fact>
        {detail.tech && (
          <Fact label="What the network said" mono>
            {detail.tech}
          </Fact>
        )}
      </dl>
    </Panel>
  );
}
