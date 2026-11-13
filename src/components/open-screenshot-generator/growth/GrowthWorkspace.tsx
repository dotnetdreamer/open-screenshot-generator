"use client";

// Growth: how the app is doing on the App Store or Google Play, in the same
// window as the screenshots that sell it. It is one of the views the activity
// bar switches between (ActivityBar.tsx), beside the editor.
//
// It reads App Store Connect and Google Play with the keys the upload dialog
// already has, keeps everything in a database on this computer
// (src/lib/growth/db.ts), and works out the insights here without any AI. AI is
// used where it writes something: a review reply, a listing field, a report
// summary, an answer. The picker lists the App Store Connect account's apps and
// the Google Play app of the service account key (Play has no list of apps to
// ask for, so the upload dialog's package name names it).
//
// What no store dashboard can do, and this one does, is tie the numbers back
// to the designs: every screenshot upload from the editor lands on the
// timeline, and the overview measures the conversion rate before and after the
// version carrying it went live.
//
// Only real apps are shown. Without one (the web build, which cannot reach the
// stores, or the desktop app before a key is connected) every screen is
// there and empty, and each action is disabled with the reason (`blocked`).
//
// The view stays mounted once opened, so the section, its filters and a sync
// under way are still there after a visit to the editor. What only counts
// while the view shows (insights marked as seen, the automatic sync check)
// follows `active`.

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
import { growthAiLabel, growthAiUnavailableReason, isGrowthAiAvailable, onGrowthAiChange } from '@/lib/growth/ai';
import { listApps, type AscApp } from '@/lib/growth/asc';
import { addDays, formatWindow, today } from '@/lib/growth/dates';
import { onGrowthChange, readMeta, writeMeta } from '@/lib/growth/db';
import { formatAgo } from '@/lib/growth/format';
import { buildInsights } from '@/lib/growth/insights';
import { checkListing } from '@/lib/growth/listingChecks';
import { EMPTY_GROWTH_DATA } from '@/lib/growth/loadData';
import { completeThrough, defaultWindow, indexRecords } from '@/lib/growth/metrics';
import { getGrowthSettings, useGrowthSettings } from '@/lib/growth/settings';
import { metaKeys, syncApp } from '@/lib/growth/sync';
import { bucketFromUri } from '@/lib/growth/play';
import { syncPlayApp } from '@/lib/growth/playSync';
import { STORE_WORDS, isPlayApp, playAppId, storeOf } from '@/lib/growth/stores';
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
import { Gated, GrowthProvider, StoreImage, type GrowthTab, type GrowthTabOptions, type GrowthView } from './GrowthShared';
import { GrowthTimeline } from './GrowthTimeline';

const DESKTOP_URL = 'https://openscrgen.app';

/** Stands in for the app while there is none, so every screen can draw itself empty. */
const NO_APP: GrowthApp = { id: '', name: 'Your app', bundleId: '' };

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
  { tab: 'listing', label: 'Store page', icon: TypeIcon },
  { tab: 'markets', label: 'Countries', icon: GlobeIcon },
  { tab: 'timeline', label: 'Timeline', icon: CalendarClockIcon },
  { tab: 'reports', label: 'Reports', icon: FileTextIcon },
  { tab: 'ask', label: 'Ask AI', icon: BotIcon },
  { tab: 'connect', label: 'Setup', icon: PlugIcon },
];

/** A section to show, from whoever switched to Growth. A new nonce navigates again. */
export interface GrowthRequest {
  tab: GrowthTab;
  options?: GrowthTabOptions;
  nonce: number;
}

export interface GrowthWorkspaceProps {
  /** True while Growth is the view on screen. */
  active: boolean;
  request?: GrowthRequest | null;
  /** Open the upload dialog. */
  onPublish: () => void;
  /** Start translating the screenshots into these App Store Connect locales. */
  onLocalize: (storeLocales: string[]) => void;
  /** Hand a question to the Claude Code or Codex agent. Absent when neither can run. */
  onAskAgent?: (question: string) => void;
  /** Why the agent cannot take a question here, when onAskAgent is absent for a reason other than the CLIs. */
  agentUnavailable?: string;
  /** Open a saved project, from a screenshots event on the timeline. */
  onOpenProject?: (projectId: string) => void;
}

export function GrowthWorkspace({ active, request, onPublish, onLocalize, onAskAgent, agentUnavailable, onOpenProject }: GrowthWorkspaceProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const desktop = mounted && isStorePublishingAvailable();
  const { credentials } = useStoreCredentials();
  const key = credentials.appstore;
  const playKey = credentials.playstore;
  const [settings, setSettings] = useGrowthSettings();

  const [apps, setApps] = useState<AscApp[]>([]);
  // Null until the account's apps have been asked for with this key.
  const [appsListed, setAppsListed] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [tab, setTab] = useState<GrowthTab>(request?.tab ?? 'overview');
  const [tabOptions, setTabOptions] = useState<GrowthTabOptions>(request?.options ?? {});
  // Bumped on every navigation, so going to the tab already open with new
  // options (a filter from an insight card) starts that screen afresh.
  const [navEpoch, setNavEpoch] = useState(0);
  const [rangeDays, setRangeDays] = useState(28);
  // One entry per app with a sync running in this view. Per app, because a
  // sync carries on when the picker moves to another app, and its progress,
  // its feed states and its Stop belong to the app it is reading.
  const [syncs, setSyncs] = useState<Record<string, { progress: SyncProgress | null; status: SyncStatus | null }>>({});
  const controllers = useRef(new Map<string, AbortController>());
  // Ticks every ten minutes while the view shows, so Growth left on screen
  // all day still syncs when its numbers get old. With the editor in front,
  // the background monitor does that instead (monitor.ts).
  const [staleCheck, setStaleCheck] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setStaleCheck((value) => value + 1), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const goTo = useCallback((next: GrowthTab, options?: GrowthTabOptions) => {
    setTab(next);
    setTabOptions(options ?? {});
    setNavEpoch((value) => value + 1);
  }, []);

  useEffect(() => {
    if (request) goTo(request.tab, request.options);
    // Only a new request navigates; the same one again on a re-render does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  useEffect(() => {
    if (!active) return;
    track('growth_open', { connected: (!!key || !!playKey) && desktop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // The Google Play app of the service account key, named after its store
  // page once a refresh has read it (playSync.ts keeps the name and icon).
  const playPackage = desktop ? playKey?.packageName.trim() || null : null;
  const playId = playPackage ? playAppId(playPackage) : null;
  const [playMeta, setPlayMeta] = useState<{ name?: string; iconUrl?: string | null } | null>(null);
  useEffect(() => {
    setPlayMeta(null);
    if (!playId) return;
    let cancelled = false;
    const read = () =>
      void readMeta<{ name?: string; iconUrl?: string | null }>(metaKeys.playApp(playId)).then((value) => {
        if (!cancelled) setPlayMeta(value ?? null);
      });
    read();
    const unsubscribe = onGrowthChange((changed) => {
      if (changed === null || changed === playId) read();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [playId]);
  const playApp: GrowthApp | null = useMemo(
    () =>
      playId && playPackage
        ? { id: playId, name: playMeta?.name || playPackage, bundleId: playPackage, iconUrl: playMeta?.iconUrl ?? undefined }
        : null,
    [playId, playPackage, playMeta]
  );

  // The apps on the account: the last list at once, then a fresh one.
  const keyId = key ? `${key.issuerId}:${key.keyId}` : null;
  useEffect(() => {
    if (!desktop || !key) {
      setApps([]);
      setAppsListed(null);
      setAppsError(null);
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
        if (!cancelled) setAppsError(error instanceof Error ? error.message : 'Your apps could not be loaded');
      })
      .finally(() => {
        if (!cancelled) setAppsListed(keyId);
      });
    return () => {
      cancelled = true;
    };
    // The key object is rebuilt on every store change; its ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, keyId]);

  const picked: GrowthApp | null = useMemo(
    () =>
      apps.find((choice) => choice.id === settings.appId) ??
      (playApp && playApp.id === settings.appId ? playApp : null) ??
      apps[0] ??
      playApp ??
      null,
    [apps, playApp, settings.appId]
  );
  const app = picked ?? NO_APP;
  const ascApp = picked ? apps.find((entry) => entry.id === picked.id) : undefined;
  const store = picked ? storeOf(picked.id) : 'appstore';
  const words = STORE_WORDS[store];
  const anyApps = apps.length > 0 || !!playApp;

  const loadedData = useGrowthData(picked);
  // With no app there is nothing to wait for: the screens draw empty at once.
  const data = picked ? loadedData : { ...EMPTY_GROWTH_DATA, loaded: true, reload: loadedData.reload };
  const { reload } = loadedData;
  const running = syncs[app.id];
  const syncing = !!running;
  const progress = running?.progress ?? null;
  const status = running?.status ?? data.status;

  // Why an action on the app cannot run, most basic first.
  const appReason: string | null = !mounted
    ? 'Loading'
    : !desktop
      ? 'Growth works in the desktop app only'
      : picked
        ? null
        : !key
          ? 'Add your App Store Connect API key or Google Play service account key under Setup first'
          : appsError
            ? 'App Store Connect did not send your apps. Check your API key under Setup'
            : appsListed !== keyId
              ? 'Loading your apps from App Store Connect'
              : 'Your App Store Connect account has no apps yet';

  const runSync = useCallback(() => {
    // Read at call time rather than from the render: a key saved a moment ago
    // under Setup is in the store before this component re-renders.
    const latest = getStoreCredentials();
    if (!desktop || !picked) return;
    const id = picked.id;
    const play = isPlayApp(id);
    const playCredentials = play && latest.playstore && playAppId(latest.playstore.packageName) === id ? latest.playstore : null;
    if (play ? !playCredentials : !latest.appstore || !ascApp) return;
    // A sync the background monitor started is joined (syncApp hands back the
    // one running), so the header shows it rather than a Refresh that does nothing.
    if (controllers.current.has(id)) return;
    const stop = new AbortController();
    controllers.current.set(id, stop);
    const patch = (value: { progress?: SyncProgress | null; status?: SyncStatus | null }) =>
      setSyncs((all) => (all[id] ? { ...all, [id]: { ...all[id], ...value } } : all));
    setSyncs((all) => ({ ...all, [id]: { progress: null, status: null } }));
    const current = getGrowthSettings();
    const callbacks = {
      historyDays: current.historyDays,
      signal: stop.signal,
      onStatus: (next: SyncStatus) => patch({ status: next }),
      onProgress: (next: SyncProgress | null) => patch({ progress: next }),
    };
    const work = playCredentials
      ? syncPlayApp({ ...callbacks, credentials: playCredentials, app: picked, bucket: bucketFromUri(current.playReportsUri) })
      : syncApp({ ...callbacks, credentials: latest.appstore!, app: ascApp!, allApps: apps, vendorNumber: current.vendorNumber });
    void work
      .catch((error) => console.error('Growth sync failed', error))
      .finally(() => {
        // Stopped before it finished: the next look may try again at once.
        if (stop.signal.aborted) forgetAutoSync(id);
        controllers.current.delete(id);
        setSyncs((all) => {
          const next = { ...all };
          delete next[id];
          return next;
        });
        reload();
      });
  }, [desktop, picked, ascApp, apps, reload]);

  // Sync when the last one is older than the setting says: on showing, and
  // again whenever the numbers age past it with the view on screen. The
  // attempt is shared with the background monitor (autoSync.ts), so a sync
  // that fails is retried an hour later, not on every render.
  useEffect(() => {
    if (!active || !data.loaded || !picked || (!ascApp && !isPlayApp(picked.id))) return;
    if (!dueForAutoSync(picked.id, data.lastSync, settings.refreshHours)) return;
    noteAutoSync(picked.id);
    runSync();
  }, [active, data.loaded, data.lastSync, picked, ascApp, settings.refreshHours, runSync, staleCheck]);

  // Syncs carry on with the editor in front, and stop when the view goes
  // with its window.
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
      picked
        ? buildInsights({
            appId: picked.id,
            records: data.records,
            reviews: data.reviews,
            ratings: data.ratings,
            events: data.events,
            listing: data.listing,
            listingIssues,
            today: today(),
          })
        : [],
    [picked, data.records, data.reviews, data.ratings, data.events, data.listing, listingIssues]
  );
  const dismissed = useMemo(() => new Set(data.dismissed), [data.dismissed]);
  const insights = useMemo(() => allInsights.filter((insight) => !dismissed.has(insight.id)), [allInsights, dismissed]);
  const dismissedInsights = allInsights.filter((insight) => dismissed.has(insight.id));
  // What the view shows counts as seen, so the activity bar's count of new
  // insights (the background monitor's) drops this app. Only while it shows:
  // a sync finishing behind the editor leaves its news for the count.
  useEffect(() => {
    if (!active || !picked || !data.loaded) return;
    void markInsightsSeen(picked.id, insights);
  }, [active, picked, data.loaded, insights]);

  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiLabel, setAiLabel] = useState<string | null>(null);
  const [aiReason, setAiReason] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      setAiAvailable(isGrowthAiAvailable());
      setAiLabel(growthAiLabel());
      setAiReason(growthAiUnavailableReason());
    };
    refresh();
    return onGrowthAiChange(refresh);
  }, [active]);

  const view: GrowthView = {
    app,
    store,
    words,
    data: { ...data, status },
    byDate,
    window: span,
    rangeDays,
    latest,
    insights,
    dismissedInsights,
    listingIssues,
    credentials: key,
    playCredentials: playKey,
    canWrite: desktop && !!picked && (store === 'playstore' ? !!playKey : !!key),
    blocked: {
      app: appReason,
      ai: appReason ?? (aiAvailable ? null : aiReason ?? 'Set up an AI first'),
    },
    aiAvailable: aiAvailable && !appReason,
    aiLabel,
    tabOptions,
    goTo,
    dismissInsight: (id) => {
      if (!picked) return;
      void writeMeta(metaKeys.insightsDismissed(picked.id), [...data.dismissed, id]).then(data.reload);
    },
    restoreInsights: () => {
      if (!picked) return;
      void writeMeta(metaKeys.insightsDismissed(picked.id), []).then(data.reload);
    },
    onPublish,
    onLocalize,
    onAskAgent,
    agentUnavailable,
    onOpenProject,
  };

  const badge = (target: GrowthTab): number => {
    if (target === 'insights') return insights.filter((insight) => insight.tone === 'problem' || insight.tone === 'warning').length;
    if (target === 'reviews') return data.reviews.filter((review) => review.rating <= 2 && !review.response).length;
    if (target === 'listing') return listingIssues.filter((issue) => issue.severity !== 'tip').length;
    return 0;
  };

  const iconUrl = picked ? data.live?.iconUrl ?? app.iconUrl : undefined;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" data-testid="growth-view" aria-labelledby="growth-view-title">
      <h1 id="growth-view-title" className="sr-only">
        Growth
      </h1>

      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {iconUrl ? (
            <StoreImage src={iconUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg border" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--growth-series))]/15 text-[hsl(var(--growth-series))]">
              <BarChart3Icon className="h-4 w-4" />
            </div>
          )}
          <Gated reason={anyApps ? null : appReason}>
            <Select value={picked?.id ?? ''} onValueChange={(value) => setSettings({ appId: value })}>
              <SelectTrigger className="h-9 max-w-[280px] border-0 px-2 text-sm font-semibold shadow-none" aria-label="App">
                <SelectValue placeholder="No app yet" />
              </SelectTrigger>
              <SelectContent>
                {apps.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-xs">{playApp ? 'App Store' : 'Your apps'}</SelectLabel>
                    {apps.map((choice) => (
                      <SelectItem key={choice.id} value={choice.id} className="text-sm">
                        {choice.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {playApp && (
                  <SelectGroup>
                    <SelectLabel className="text-xs">Google Play</SelectLabel>
                    <SelectItem value={playApp.id} className="text-sm">
                      {playApp.name}
                    </SelectItem>
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Gated>
          {picked && playApp && apps.length > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{words.store}</span>
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
          {syncing ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => controllers.current.get(app.id)?.abort()} title="Stop refreshing and keep everything loaded so far">
              <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Gated reason={appReason}>
              <Button variant="outline" size="sm" className="h-8" onClick={runSync} title={data.lastSync ? `Updated ${formatAgo(data.lastSync)}` : `Get the latest numbers from ${words.owner}`}>
                <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            </Gated>
          )}
        </div>
        {progress && (
          <div className="flex w-full items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            <span className="truncate">Refreshing {progress.label}</span>
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

      {mounted && !picked && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs" role="status" data-testid="growth-no-app">
          <span className="min-w-0 flex-1">{appReason}.</span>
          {!desktop ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void openExternal(DESKTOP_URL)}>
              Get the desktop app
              <ExternalLinkIcon className="ml-1 h-3 w-3" />
            </Button>
          ) : (
            tab !== 'connect' && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => goTo('connect')}>
                Open Setup
              </Button>
            )
          )}
        </div>
      )}
      {appsError && picked && (
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
                onClick={() => goTo(item.tab)}
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
    </section>
  );
}
