"use client";

// Growth: how the app is doing on the App Store, in the same window as the
// screenshots that sell it.
//
// It reads App Store Connect with the key the upload dialog already has, keeps
// everything in a database on this computer (src/lib/growth/db.ts), and works
// out the insights here without any AI. AI is used where it writes something:
// a review reply, a listing field, a report summary, an answer.
//
// What no store dashboard can do, and this one does, is tie the numbers back
// to the designs: every screenshot upload from the editor lands on the
// timeline, and the overview measures the conversion rate before and after the
// version carrying it went live.
//
// The web build cannot reach App Store Connect (no CORS), so it opens on a
// sample app with made-up numbers, as the desktop app does before a key is
// connected. Everything works on the sample, and nothing it does leaves the
// machine.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3Icon,
  BotIcon,
  CalendarClockIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlugIcon,
  RefreshCwIcon,
  SquareIcon,
  TypeIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import { track } from '@/lib/analytics';
import { growthAiLabel, isGrowthAiAvailable } from '@/lib/growth/ai';
import { listApps, type AscApp } from '@/lib/growth/asc';
import { addDays, formatWindow, today } from '@/lib/growth/dates';
import { readMeta, writeMeta } from '@/lib/growth/db';
import { formatAgo } from '@/lib/growth/format';
import { buildInsights } from '@/lib/growth/insights';
import { checkListing } from '@/lib/growth/listingChecks';
import { completeThrough, defaultWindow, indexRecords } from '@/lib/growth/metrics';
import { SAMPLE_APP } from '@/lib/growth/sample';
import { getGrowthSettings, useGrowthSettings } from '@/lib/growth/settings';
import { metaKeys, syncApp } from '@/lib/growth/sync';
import { dueForAutoSync, forgetAutoSync, noteAutoSync } from '@/lib/growth/autoSync';
import { appsListKey, markInsightsSeen } from '@/lib/growth/monitor';
import type { GrowthApp, SyncProgress, SyncStatus } from '@/lib/growth/types';
import { useGrowthData } from '@/lib/growth/useGrowthData';
import { getStoreCredentials, isStorePublishingAvailable, useStoreCredentials } from '@/lib/publish';
import { cn } from '@/lib/utils';
import { GrowthAsk } from './GrowthAsk';
import { GrowthConnect } from './GrowthConnect';
import { GrowthInsights } from './GrowthInsights';
import { GrowthListing } from './GrowthListing';
import { GrowthMarkets } from './GrowthMarkets';
import { GrowthOverview } from './GrowthOverview';
import { GrowthReports } from './GrowthReports';
import { GrowthReviews } from './GrowthReviews';
import { GrowthProvider, type GrowthTab, type GrowthTabOptions, type GrowthView } from './GrowthShared';
import { GrowthTimeline } from './GrowthTimeline';

const DESKTOP_URL = 'https://openscrgen.app';

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 28, label: 'Last 28 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
];

const NAV: Array<{ tab: GrowthTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { tab: 'overview', label: 'Overview', icon: LayoutDashboardIcon },
  { tab: 'insights', label: 'Insights', icon: LightbulbIcon },
  { tab: 'reviews', label: 'Reviews', icon: MessageSquareIcon },
  { tab: 'listing', label: 'Listing', icon: TypeIcon },
  { tab: 'markets', label: 'Storefronts', icon: GlobeIcon },
  { tab: 'timeline', label: 'Timeline', icon: CalendarClockIcon },
  { tab: 'reports', label: 'Reports', icon: FileTextIcon },
  { tab: 'ask', label: 'Ask AI', icon: BotIcon },
  { tab: 'connect', label: 'Connection', icon: PlugIcon },
];

export interface GrowthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: GrowthTab;
  /** Open the upload dialog. */
  onPublish: () => void;
  /** Start translating the screenshots into these App Store Connect locales. */
  onLocalize: (storeLocales: string[]) => void;
  /** Hand a question to the Claude Code or Codex agent. Absent when neither can run. */
  onAskAgent?: (question: string) => void;
  /** Open a saved project, from a screenshots event on the timeline. */
  onOpenProject?: (projectId: string) => void;
}

export function GrowthDialog({ open, onOpenChange, initialTab, onPublish, onLocalize, onAskAgent, onOpenProject }: GrowthDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const desktop = mounted && isStorePublishingAvailable();
  const { credentials } = useStoreCredentials();
  const key = credentials.appstore;
  const [settings, setSettings] = useGrowthSettings();

  const [apps, setApps] = useState<AscApp[]>([]);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [tab, setTab] = useState<GrowthTab>(initialTab ?? 'overview');
  const [tabOptions, setTabOptions] = useState<GrowthTabOptions>({});
  // Bumped on every navigation, so going to the tab already open with new
  // options (a filter from an insight card) starts that screen afresh.
  const [navEpoch, setNavEpoch] = useState(0);
  const [rangeDays, setRangeDays] = useState(28);
  // One entry per app with a sync running in this window. Per app, because a
  // sync carries on when the picker moves to another app, and its progress,
  // its feed states and its Stop belong to the app it is reading.
  const [syncs, setSyncs] = useState<Record<string, { progress: SyncProgress | null; status: SyncStatus | null }>>({});
  const controllers = useRef(new Map<string, AbortController>());
  // Ticks every ten minutes while the window is open, so a window left open
  // all day still syncs when its numbers get old.
  const [staleCheck, setStaleCheck] = useState(0);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setStaleCheck((value) => value + 1), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab ?? 'overview');
    setTabOptions({});
    track('growth_open', { connected: !!key && desktop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The apps on the account: the last list at once, then a fresh one.
  useEffect(() => {
    if (!open || !desktop || !key) {
      setApps([]);
      return;
    }
    let cancelled = false;
    const cacheKey = appsListKey(key);
    void readMeta<AscApp[]>(cacheKey).then((cached) => {
      if (!cancelled && cached?.length) setApps(cached);
    });
    void listApps(key)
      .then(async (list) => {
        if (cancelled) return;
        setApps(list);
        setAppsError(null);
        await writeMeta(cacheKey, list);
      })
      .catch((error) => {
        console.error('Listing the App Store Connect apps failed', error);
        if (!cancelled) setAppsError(error instanceof Error ? error.message : 'The apps could not be listed');
      });
    return () => {
      cancelled = true;
    };
  }, [open, desktop, key]);

  const choices: GrowthApp[] = useMemo(() => [...apps, SAMPLE_APP], [apps]);
  const app: GrowthApp = useMemo(() => {
    const wanted = choices.find((choice) => choice.id === settings.appId);
    if (wanted && (!wanted.sample || apps.length === 0 || settings.appId === SAMPLE_APP.id)) return wanted;
    return apps[0] ?? SAMPLE_APP;
  }, [choices, settings.appId, apps]);
  const ascApp = apps.find((entry) => entry.id === app.id);

  const data = useGrowthData(open ? app : null);
  const { reload } = data;
  const running = syncs[app.id];
  const syncing = !!running;
  const progress = running?.progress ?? null;
  const status = running?.status ?? data.status;

  const runSync = useCallback(() => {
    // Read at call time rather than from the render: a key saved a moment ago
    // on the Connection tab is in the store before this component re-renders.
    const latestKey = getStoreCredentials().appstore;
    if (!desktop || !latestKey || app.sample || !ascApp) return;
    const id = app.id;
    // A sync the background monitor started is joined (syncApp hands back the
    // one running), so the header shows it rather than a Sync that does nothing.
    if (controllers.current.has(id)) return;
    const stop = new AbortController();
    controllers.current.set(id, stop);
    const patch = (value: { progress?: SyncProgress | null; status?: SyncStatus | null }) =>
      setSyncs((all) => (all[id] ? { ...all, [id]: { ...all[id], ...value } } : all));
    setSyncs((all) => ({ ...all, [id]: { progress: null, status: null } }));
    const current = getGrowthSettings();
    void syncApp({
      credentials: latestKey,
      app: ascApp,
      allApps: apps,
      vendorNumber: current.vendorNumber,
      historyDays: current.historyDays,
      signal: stop.signal,
      onStatus: (next) => patch({ status: next }),
      onProgress: (next) => patch({ progress: next }),
    })
      .catch((error) => console.error('Growth sync failed', error))
      .finally(() => {
        // Stopped before it finished: the next opening may try again at once.
        if (stop.signal.aborted) forgetAutoSync(id);
        controllers.current.delete(id);
        setSyncs((all) => {
          const next = { ...all };
          delete next[id];
          return next;
        });
        reload();
      });
  }, [desktop, app, ascApp, apps, reload]);

  // Sync when the last one is older than the setting says: on opening, and
  // again whenever the numbers age past it with the window still open. The
  // attempt is shared with the background monitor (autoSync.ts), so a sync
  // that fails is retried an hour later, not on every render.
  useEffect(() => {
    if (!open || !data.loaded || app.sample || !ascApp) return;
    if (!dueForAutoSync(app.id, data.lastSync, settings.refreshHours)) return;
    noteAutoSync(app.id);
    runSync();
  }, [open, data.loaded, data.lastSync, app, ascApp, settings.refreshHours, runSync, staleCheck]);

  // Closing the window stops every sync it started, whichever app each was for.
  useEffect(() => {
    if (open) return;
    for (const stop of controllers.current.values()) stop.abort();
  }, [open]);
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const stop of running.values()) stop.abort();
    };
  }, []);

  const byDate = useMemo(() => indexRecords(data.records), [data.records]);
  const latest = useMemo(() => completeThrough(data.records), [data.records]);
  const span = useMemo(() => defaultWindow(data.records, rangeDays, addDays(today(), -1)), [data.records, rangeDays]);
  const listingIssues = useMemo(() => (data.listing ? checkListing(data.listing) : []), [data.listing]);
  const allInsights = useMemo(
    () =>
      buildInsights({
        appId: app.id,
        records: data.records,
        reviews: data.reviews,
        ratings: data.ratings,
        events: data.events,
        listing: data.listing,
        listingIssues,
        today: today(),
      }),
    [app.id, data.records, data.reviews, data.ratings, data.events, data.listing, listingIssues]
  );
  const dismissed = useMemo(() => new Set(data.dismissed), [data.dismissed]);
  const insights = useMemo(() => allInsights.filter((insight) => !dismissed.has(insight.id)), [allInsights, dismissed]);
  const dismissedInsights = allInsights.filter((insight) => dismissed.has(insight.id));
  // What this window shows counts as seen, so the toolbar's count of new
  // insights (the background monitor's) drops this app.
  useEffect(() => {
    if (!open || !data.loaded || app.sample) return;
    void markInsightsSeen(app.id, insights);
  }, [open, data.loaded, app.id, app.sample, insights]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiLabel, setAiLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setAiAvailable(isGrowthAiAvailable());
    setAiLabel(growthAiLabel());
  }, [open]);

  const close = () => onOpenChange(false);
  const view: GrowthView = {
    app,
    data: { ...data, status },
    byDate,
    window: span,
    rangeDays,
    latest,
    insights,
    dismissedInsights,
    listingIssues,
    credentials: key,
    canWrite: desktop && !!key && !app.sample,
    sample: !!app.sample,
    aiAvailable,
    aiLabel,
    tabOptions,
    goTo: (next, options) => {
      setTab(next);
      setTabOptions(options ?? {});
      setNavEpoch((value) => value + 1);
    },
    dismissInsight: (id) => void writeMeta(metaKeys.insightsDismissed(app.id), [...data.dismissed, id]).then(data.reload),
    restoreInsights: () => void writeMeta(metaKeys.insightsDismissed(app.id), []).then(data.reload),
    onPublish: () => {
      close();
      onPublish();
    },
    onLocalize: (locales) => {
      close();
      onLocalize(locales);
    },
    onAskAgent: onAskAgent
      ? (question) => {
          close();
          onAskAgent(question);
        }
      : undefined,
    onOpenProject: onOpenProject
      ? (projectId) => {
          close();
          onOpenProject(projectId);
        }
      : undefined,
  };

  const badge = (target: GrowthTab): number => {
    if (target === 'insights') return insights.filter((insight) => insight.tone === 'problem' || insight.tone === 'warning').length;
    if (target === 'reviews') return data.reviews.filter((review) => review.rating <= 2 && !review.response).length;
    if (target === 'listing') return listingIssues.filter((issue) => issue.severity !== 'tip').length;
    return 0;
  };

  const iconUrl = data.live?.iconUrl ?? app.iconUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] w-[97vw] max-w-[1500px] flex-col gap-0 overflow-hidden p-0" data-testid="growth-dialog">
        <DialogTitle className="sr-only">Growth</DialogTitle>
        <DialogDescription className="sr-only">Downloads, conversion, reviews and the App Store listing for your app</DialogDescription>

        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 pr-12">
          <div className="flex min-w-0 items-center gap-2">
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg border" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--growth-series))]/15 text-[hsl(var(--growth-series))]">
                <BarChart3Icon className="h-4 w-4" />
              </div>
            )}
            <Select value={app.id} onValueChange={(value) => setSettings({ appId: value })}>
              <SelectTrigger className="h-9 max-w-[280px] border-0 px-2 text-sm font-semibold shadow-none" aria-label="App">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {apps.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-xs">Your apps</SelectLabel>
                    {apps.map((choice) => (
                      <SelectItem key={choice.id} value={choice.id} className="text-sm">
                        {choice.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectLabel className="text-xs">Made-up numbers, to try it out</SelectLabel>
                  <SelectItem value={SAMPLE_APP.id} className="text-sm">
                    {SAMPLE_APP.name}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {app.sample && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                Sample data
              </span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="hidden text-xs text-muted-foreground lg:inline">
              {data.records.length > 0 ? formatWindow(span) : null}
            </span>
            <Select value={String(rangeDays)} onValueChange={(value) => setRangeDays(Number(value))}>
              <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((range) => (
                  <SelectItem key={range.days} value={String(range.days)} className="text-xs">
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!app.sample && desktop && key && (
              syncing ? (
                <Button variant="outline" size="sm" className="h-8" onClick={() => controllers.current.get(app.id)?.abort()} title="Stop syncing. What arrived so far is kept">
                  <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-8" onClick={runSync} title={data.lastSync ? `Last sync ${formatAgo(data.lastSync)}` : 'Load this app from App Store Connect'}>
                  <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
                  Sync
                </Button>
              )
            )}
          </div>
          {progress && (
            <div className="flex w-full items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
              <span className="truncate">Syncing {progress.label}</span>
              <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[hsl(var(--growth-series))] transition-[width]"
                  style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 5}%` }}
                />
              </div>
              <span className="tabular-nums">
                {progress.done} of {progress.total}
              </span>
            </div>
          )}
        </header>

        {app.sample && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs">
            <span className="min-w-0 flex-1">
              {desktop
                ? 'Juniper is a made-up app with made-up numbers, so you can see what this window does. Connect your App Store Connect key to see your own app.'
                : 'Juniper is a made-up app with made-up numbers. Your own app needs the desktop app, because App Store Connect does not answer browsers.'}
            </span>
            {desktop ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => view.goTo('connect')}>
                Connect your app
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void openExternal(DESKTOP_URL)}>
                Get the desktop app
                <ExternalLinkIcon className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        )}
        {appsError && !app.sample && (
          <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{appsError}</div>
        )}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-48 md:flex-col md:overflow-x-visible md:border-b-0 md:border-r"
            aria-label="Growth sections"
          >
            {NAV.map((item) => {
              const count = badge(item.tab);
              const Icon = item.icon;
              return (
                <button
                  key={item.tab}
                  type="button"
                  onClick={() => view.goTo(item.tab)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    tab === item.tab ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    item.tab === 'connect' && 'md:mt-auto'
                  )}
                  aria-current={tab === item.tab ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] tabular-nums text-amber-700 dark:text-amber-300">{count}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <main className="min-h-0 flex-1 overflow-y-auto p-4" key={`${app.id}:${tab}:${navEpoch}`}>
            {!data.loaded ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Loading {app.name}
              </p>
            ) : (
              <GrowthProvider value={view}>
                {tab === 'overview' && <GrowthOverview />}
                {tab === 'insights' && <GrowthInsights />}
                {tab === 'reviews' && <GrowthReviews />}
                {tab === 'listing' && <GrowthListing />}
                {tab === 'markets' && <GrowthMarkets />}
                {tab === 'timeline' && <GrowthTimeline />}
                {tab === 'reports' && <GrowthReports />}
                {tab === 'ask' && <GrowthAsk />}
                {tab === 'connect' && <GrowthConnect desktop={desktop} onSync={runSync} />}
              </GrowthProvider>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
