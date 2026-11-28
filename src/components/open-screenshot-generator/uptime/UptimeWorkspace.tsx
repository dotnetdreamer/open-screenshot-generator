"use client";

// Uptime: the user's websites, servers and store listings, checked from this
// computer by the desktop app (src-tauri/src/uptime/), with the history and
// the alerts. One of the views the activity bar switches between
// (ActivityBar.tsx).
//
// The list of monitors sits on the left, as in uptime-kuma; the right side
// shows the overview, a monitor's page, the form to add or change one, or
// where alerts go. The web build has no way to make the checks, so it
// explains where Uptime runs instead.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIcon, BellRingIcon, DownloadIcon, LayoutDashboardIcon, Loader2Icon, PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { isTauri, openExternal } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { uptimeCommands } from '@/lib/uptime/engine';
import { formatPercent, targetText } from '@/lib/uptime/format';
import { lastBeats } from '@/lib/uptime/stats';
import { refreshUptime, shownSettings, startUptime, useNow, useUptime } from '@/lib/uptime/store';
import type { Monitor, MonitorState, Settings, Summary } from '@/lib/uptime/types';
import { CheckBars } from './UptimeCharts';
import { UptimeAlerts } from './UptimeAlerts';
import { UptimeForm } from './UptimeForm';
import { UptimeMonitor } from './UptimeMonitor';
import { UptimeOverview } from './UptimeOverview';
import { StatusDot, UptimeProvider, stateText, type UptimeContextValue, type UptimeSection } from './UptimeShared';

const DESKTOP_URL = 'https://openscrgen.app';

type Filter = 'all' | 'down' | 'paused';

/** Down first, then checking again, then the rest in the user's order. */
/** "1 place", "3 places": where alerts go. */
/** Where alerts go, for the Alerts button: with the changes still saving made. */
function alertNote(settings: Settings): string {
  if (settings.targets.length > 0) return placesWord(settings.targets.length + (settings.desktop ? 1 : 0));
  return settings.desktop ? 'This computer' : 'Off';
}

/** How often the open Uptime view reads Rust's figures again. */
const FIGURES_EVERY = 15_000;

function placesWord(count: number): string {
  return count === 1 ? '1 place' : `${count} places`;
}

function rank(state: MonitorState): number {
  return state === 'down' ? 0 : state === 'pending' ? 1 : 2;
}

export function UptimeWorkspace({ active, request = null }: { active: boolean; request?: { id: string; nonce: number } | null }) {
  const { view, error } = useUptime();
  const { toast } = useToast();
  const [desktop, setDesktop] = useState(false);
  const [section, setSection] = useState<UptimeSection>({ name: 'overview' });
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [checkingAll, setCheckingAll] = useState(false);
  const now = useNow(active);

  useEffect(() => {
    setDesktop(isTauri());
    void startUptime();
  }, []);

  // Rust works out the 24 hour, 7 and 30 day figures when it makes a view,
  // and a paused monitor, or one checked hourly, makes none for a long time
  // while its window moves on. So the view is read again while Uptime is on
  // screen: a paused monitor's figure stayed at 59.28% after its last outage
  // had left the 24 hours.
  useEffect(() => {
    if (!active || !isTauri()) return;
    const read = () => {
      if (document.visibilityState === 'visible') void refreshUptime();
    };
    const timer = window.setInterval(read, FIGURES_EVERY);
    document.addEventListener('visibilitychange', read);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, [active]);

  const go = useCallback((next: UptimeSection) => {
    setSection(next);
    track('uptime_section', { section: next.name });
  }, []);

  // An alert's "See" opens its monitor.
  useEffect(() => {
    if (request) setSection({ name: 'monitor', id: request.id });
  }, [request]);

  const summaries = useMemo(() => new Map((view?.summaries ?? []).map((summary) => [summary.id, summary])), [view]);
  const monitors = useMemo(() => view?.monitors ?? [], [view]);

  // A monitor deleted from another window takes its page with it.
  useEffect(() => {
    if (!view) return;
    if ((section.name === 'monitor' || section.name === 'edit') && !monitors.some((monitor) => monitor.id === section.id)) setSection({ name: 'overview' });
  }, [view, monitors, section]);

  const context: UptimeContextValue | null = useMemo(
    () =>
      view
        ? {
            view,
            desktop,
            active,
            now,
            go,
            monitorOf: (id: string) => monitors.find((monitor) => monitor.id === id),
            summaryOf: (id: string) => summaries.get(id),
          }
        : null,
    [view, desktop, active, now, go, monitors, summaries]
  );

  const stateOf = useCallback((monitor: Monitor): MonitorState => (monitor.paused ? 'paused' : summaries.get(monitor.id)?.state ?? 'unknown'), [summaries]);
  const counts = useMemo(() => {
    const tally = { down: 0, paused: 0 };
    for (const monitor of monitors) {
      const state = stateOf(monitor);
      if (state === 'down') tally.down += 1;
      if (state === 'paused') tally.paused += 1;
    }
    return tally;
  }, [monitors, stateOf]);
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return monitors
      .map((monitor, order) => ({ monitor, order, state: stateOf(monitor) }))
      .filter(({ monitor, state }) => (filter === 'all' ? true : filter === 'down' ? state === 'down' : state === 'paused'))
      .filter(({ monitor }) => !words || monitor.name.toLowerCase().includes(words) || targetText(monitor).toLowerCase().includes(words))
      .sort((a, b) => rank(a.state) - rank(b.state) || a.order - b.order)
      .map(({ monitor }) => monitor);
  }, [monitors, filter, search, stateOf]);

  // A filter left on with nothing in it goes back to all.
  useEffect(() => {
    if (filter === 'down' && counts.down === 0) setFilter('all');
    if (filter === 'paused' && counts.paused === 0) setFilter('all');
  }, [filter, counts]);

  const checkAll = async () => {
    setCheckingAll(true);
    try {
      await uptimeCommands.check();
      track('uptime_check_all', { monitors: monitors.length });
    } catch (failure) {
      toast({ title: 'The checks didn\'t start', description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' });
    } finally {
      window.setTimeout(() => setCheckingAll(false), 1200);
    }
  };

  const selectedId = section.name === 'monitor' || section.name === 'edit' ? section.id : null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" data-testid="uptime-view" aria-labelledby="uptime-view-title">
      <header className="relative flex flex-wrap items-center gap-3 border-b bg-card/60 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(var(--uptime-accent))] to-[hsl(var(--uptime-accent))]/70 text-white shadow-sm dark:text-background">
            <ActivityIcon className="h-4 w-4" />
            {counts.down > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[hsl(var(--uptime-down))] ring-2 ring-card" aria-hidden />}
          </div>
          <div className="min-w-0">
            <h1 id="uptime-view-title" className="text-sm font-semibold leading-tight">
              Uptime
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">Know the moment your website or server goes down</p>
          </div>
        </div>
        {desktop && view?.loaded && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {monitors.length > 0 && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => void checkAll()} disabled={checkingAll}>
                <RefreshCwIcon className={cn('mr-1.5 h-3.5 w-3.5', checkingAll && 'motion-safe:animate-spin')} />
                Check all now
              </Button>
            )}
            <Button size="sm" className="h-8 bg-[hsl(var(--uptime-accent))] text-white hover:bg-[hsl(var(--uptime-accent))]/90 dark:text-background" onClick={() => go({ name: 'add' })} data-testid="uptime-add">
              <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
              Add a monitor
            </Button>
          </div>
        )}
      </header>

      {!desktop ? (
        <DesktopOnly />
      ) : !view || !context ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          {error ? (
            <span>{error}</span>
          ) : (
            <>
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Opening Uptime
            </>
          )}
        </div>
      ) : (
        <UptimeProvider value={context}>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <nav className="flex max-h-56 shrink-0 flex-col border-b md:max-h-none md:w-72 md:border-b-0 md:border-r" aria-label="Uptime">
              <div className="space-y-1 p-2">
                <NavButton icon={LayoutDashboardIcon} label="Overview" current={section.name === 'overview'} onClick={() => go({ name: 'overview' })} />
              </div>
              <div className="flex items-center justify-between px-4 pb-1 pt-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Monitors</p>
                <span className="text-[11px] tabular-nums text-muted-foreground">{monitors.length}</span>
              </div>
              {monitors.length > 6 && (
                <div className="relative px-2 pb-1">
                  <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a monitor" aria-label="Find a monitor" className="h-8 pl-7 text-xs" />
                </div>
              )}
              {(counts.down > 0 || counts.paused > 0) && (
                <div className="flex flex-wrap gap-1 px-2 pb-1" role="group" aria-label="Show">
                  <FilterChip current={filter === 'all'} onClick={() => setFilter('all')}>
                    All {monitors.length}
                  </FilterChip>
                  {counts.down > 0 && (
                    <FilterChip current={filter === 'down'} onClick={() => setFilter('down')} tone="down">
                      Down {counts.down}
                    </FilterChip>
                  )}
                  {counts.paused > 0 && (
                    <FilterChip current={filter === 'paused'} onClick={() => setFilter('paused')}>
                      Paused {counts.paused}
                    </FilterChip>
                  )}
                </div>
              )}
              <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" data-testid="uptime-list">
                {shown.map((monitor) => (
                  <li key={monitor.id}>
                    <MonitorRow monitor={monitor} summary={summaries.get(monitor.id)} state={stateOf(monitor)} current={selectedId === monitor.id} now={now} onClick={() => go({ name: 'monitor', id: monitor.id })} />
                  </li>
                ))}
                {monitors.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">Monitors you add show here.</li>}
                {monitors.length > 0 && shown.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No monitor matches.</li>}
              </ul>
              <div className="border-t p-2">
                <NavButton
                  icon={BellRingIcon}
                  label="Alerts"
                  current={section.name === 'alerts'}
                  onClick={() => go({ name: 'alerts' })}
                  note={alertNote(shownSettings(view))}
                />
              </div>
            </nav>

            <main className="min-h-0 flex-1 overflow-y-auto" key={`${section.name}:${'id' in section ? section.id : ''}`}>
              {section.name === 'overview' && <UptimeOverview />}
              {section.name === 'monitor' && <UptimeMonitor id={section.id} />}
              {section.name === 'add' && <UptimeForm seed={section.seed} />}
              {section.name === 'edit' && <UptimeForm editId={section.id} />}
              {section.name === 'alerts' && <UptimeAlerts />}
            </main>
          </div>
        </UptimeProvider>
      )}
    </section>
  );
}

function NavButton({ icon: Icon, label, current, onClick, note }: { icon: React.ComponentType<{ className?: string }>; label: string; current: boolean; onClick: () => void; note?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors', current ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}
    >
      <Icon className={cn('h-4 w-4 shrink-0', current && 'text-[hsl(var(--uptime-accent))]')} />
      <span className="flex-1">{label}</span>
      {note && <span className="text-[11px] font-normal text-muted-foreground">{note}</span>}
    </button>
  );
}

function FilterChip({ current, onClick, tone, children }: { current: boolean; onClick: () => void; tone?: 'down'; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={current}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors',
        current ? 'border-transparent bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
        tone === 'down' && !current && 'text-[hsl(var(--uptime-down-text))]'
      )}
    >
      {children}
    </button>
  );
}

function MonitorRow({ monitor, summary, state, current, now, onClick }: { monitor: Monitor; summary: Summary | undefined; state: MonitorState; current: boolean; now: number; onClick: () => void }) {
  const uptime = summary?.uptime24 ?? null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={cn('group w-full rounded-lg px-2.5 py-2 text-left transition-colors', current ? 'bg-muted' : 'hover:bg-muted/50')}
      data-testid="uptime-row"
      data-monitor={monitor.id}
      data-state={state}
    >
      <span className="flex items-center gap-2">
        <StatusDot state={state} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{monitor.name}</span>
        <span className={cn('shrink-0 text-xs font-semibold tabular-nums', state === 'down' ? stateText('down') : uptime !== null && uptime < 99 ? stateText('pending') : 'text-muted-foreground')}>
          {state === 'paused' ? 'Paused' : uptime === null ? '' : formatPercent(uptime)}
        </span>
      </span>
      <span className="mt-1 flex items-center gap-2 pl-[18px]">
        <CheckBars beats={lastBeats(summary?.recent ?? [], 28)} now={now} label={`${monitor.name}, last checks`} className="w-full max-w-[200px]" />
      </span>
      <span className="mt-0.5 block truncate pl-[18px] text-[11px] text-muted-foreground">{targetText(monitor)}</span>
    </button>
  );
}

function DesktopOnly() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--uptime-accent)/0.12)] text-[hsl(var(--uptime-accent))]">
          <ActivityIcon className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Uptime runs in the desktop app</h2>
          <p className="text-sm text-muted-foreground">
            The desktop app checks your website, your app&apos;s server and your store listing from your own computer, and tells you the moment one goes down. There&apos;s no account to make and nothing to host.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => void openExternal(DESKTOP_URL)}>
          <DownloadIcon className="h-4 w-4" />
          Get the desktop app
        </Button>
      </div>
    </div>
  );
}
