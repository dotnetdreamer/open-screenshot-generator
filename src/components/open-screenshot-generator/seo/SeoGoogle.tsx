"use client";

// Google's own numbers for the site: Search (Search Console: how often the
// site shows in Google, the clicks, the searches) and Visitors (Google
// Analytics). Both read as the service account in the desktop app. The
// search chart marks Google's confirmed ranking updates, from claude-seo's
// data/google-updates.json, so a dip next to one reads as what it is.

import React, { useEffect, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KeyRoundIcon, Loader2Icon, MousePointerClickIcon, RefreshCwIcon, SparklesIcon, TrendingUpIcon, UsersRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { closeToPageOne, listAnalyticsProperties, listSearchConsoleSites, propertyFor, type AnalyticsProperty, type SearchConsoleSite, type SearchRow } from '@/lib/seo/google';
import { setSiteProperties, useSeoGoogle } from '@/lib/seo/googleSettings';
import { analyticsOf, googleReason, refreshGoogle, searchOf } from '@/lib/seo/state';
import { googleUpdates, type GoogleUpdate } from '@/lib/seo/sync';
import { formatAgo } from '../storeCompliance/StoreComplianceShared';
import { Delta, Gated } from '../growth/GrowthShared';
import { InfoTip } from '../capture/InfoTip';
import { Card, CardTitle, EmptyState, Tile, changeOf, formatNumber, shortAddress, useSeoView } from './SeoShared';

const SERIES = 'hsl(var(--growth-series))';

function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Why Google's numbers can't be read, or what's missing before they can. */
function NeedsGoogle({ what }: { what: 'search' | 'visitors' }) {
  const view = useSeoView();
  const reason = googleReason();
  const Icon = what === 'search' ? MousePointerClickIcon : UsersRoundIcon;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <EmptyState icon={Icon} title={what === 'search' ? 'See how people find you on Google' : 'See who visits your site'}>
        <p className="max-w-md text-sm text-muted-foreground">
          {what === 'search'
            ? 'Search Console shows how often your site comes up on Google, how many people click, and what they searched for. It is free, from your own Google account.'
            : 'Google Analytics shows how many people visit, where they come from and which pages they read. It is free, from your own Google account.'}
        </p>
        {reason && <p className="max-w-md text-xs text-muted-foreground">{reason}.</p>}
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {view.setUpGoogleWithAi && (
            <Button className="bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" onClick={view.setUpGoogleWithAi}>
              <SparklesIcon className="mr-1.5 h-4 w-4" />
              Set up with Ask AI
            </Button>
          )}
          <Button variant="outline" onClick={() => view.goTo('setup')}>
            <KeyRoundIcon className="mr-1.5 h-4 w-4" />
            Set it up myself
          </Button>
        </div>
      </EmptyState>
    </div>
  );
}

/** Pick the Search Console and Analytics properties for the site, with the likely one chosen for you. */
export function PropertyPicker({ compact = false }: { compact?: boolean }) {
  const view = useSeoView();
  const google = useSeoGoogle();
  const site = view.site;
  const [searchSites, setSearchSites] = useState<SearchConsoleSite[] | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsProperty[] | null>(null);
  const [problem, setProblem] = useState<{ search?: string; analytics?: string }>({});
  const [loading, setLoading] = useState(false);
  const key = google.active;
  const chosen = site ? google.sites[site.id] ?? {} : {};
  // A property picked is read at once; until then its screen says there are no numbers yet.
  const pick = (patch: Parameters<typeof setSiteProperties>[1]) => {
    if (!site) return;
    setSiteProperties(site.id, patch);
    void refreshGoogle(site.id);
  };

  const load = async () => {
    if (!key || !site) return;
    setLoading(true);
    const [searchAnswer, analyticsAnswer] = await Promise.allSettled([listSearchConsoleSites(key), listAnalyticsProperties(key)]);
    const next: { search?: string; analytics?: string } = {};
    if (searchAnswer.status === 'fulfilled') {
      setSearchSites(searchAnswer.value);
      const likely = site.url ? propertyFor(site.url, searchAnswer.value) : null;
      if (likely && !chosen.searchConsole) setSiteProperties(site.id, { searchConsole: likely });
    } else next.search = searchAnswer.reason instanceof Error ? searchAnswer.reason.message : 'Search Console did not answer';
    if (analyticsAnswer.status === 'fulfilled') {
      setAnalytics(analyticsAnswer.value);
      if (!chosen.analytics && analyticsAnswer.value.length === 1) setSiteProperties(site.id, { analytics: analyticsAnswer.value[0].property, analyticsName: analyticsAnswer.value[0].name });
    } else next.analytics = analyticsAnswer.reason instanceof Error ? analyticsAnswer.reason.message : 'Analytics did not answer';
    setProblem(next);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // Look again when the key or the site changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key?.email, site?.id]);

  if (!site || !key) return null;
  return (
    <div className={cn('grid gap-3', !compact && 'sm:grid-cols-2')}>
      <div className="space-y-1">
        <p className="text-xs font-medium">Search Console property</p>
        <Select value={chosen.searchConsole ?? ''} onValueChange={(value) => pick({ searchConsole: value })} disabled={!searchSites?.length}>
          <SelectTrigger className="h-9 text-xs" aria-label="Search Console property">
            <SelectValue placeholder={loading ? 'Looking' : searchSites?.length ? 'Pick one' : 'None shared with the key yet'} />
          </SelectTrigger>
          <SelectContent>
            {(searchSites ?? []).map((entry) => (
              <SelectItem key={entry.siteUrl} value={entry.siteUrl} className="text-xs">
                {entry.siteUrl.replace(/^sc-domain:/, '')}
                {entry.siteUrl.startsWith('sc-domain:') ? ' (whole domain)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {problem.search && <p className="text-xs text-[hsl(var(--rules-critical))]">{problem.search}</p>}
        {searchSites && !searchSites.length && !problem.search && (
          <p className="text-xs text-muted-foreground">Add {key.email} as a user of your site in Search Console, then look again.</p>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium">Analytics property</p>
        <Select
          value={chosen.analytics ?? ''}
          onValueChange={(value) => pick({ analytics: value, analyticsName: analytics?.find((entry) => entry.property === value)?.name })}
          disabled={!analytics?.length}
        >
          <SelectTrigger className="h-9 text-xs" aria-label="Analytics property">
            <SelectValue placeholder={loading ? 'Looking' : analytics?.length ? 'Pick one' : 'None shared with the key yet'} />
          </SelectTrigger>
          <SelectContent>
            {(analytics ?? []).map((entry) => (
              <SelectItem key={entry.property} value={entry.property} className="text-xs">
                {entry.name}
                {entry.account ? `, ${entry.account}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {problem.analytics && <p className="text-xs text-[hsl(var(--rules-critical))]">{problem.analytics}</p>}
        {analytics && !analytics.length && !problem.analytics && <p className="text-xs text-muted-foreground">Add {key.email} as a Viewer in Analytics, then look again.</p>}
      </div>
      <div className={cn('flex items-center gap-2', !compact && 'sm:col-span-2')}>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" disabled={loading} onClick={() => void load()}>
          <RefreshCwIcon className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Look again
        </Button>
      </div>
    </div>
  );
}

/** What went wrong reading one of the two, Search Console or Analytics, for the site on screen. */
function GoogleError({ which }: { which: 'search' | 'analytics' }) {
  const view = useSeoView();
  const error = view.state.errors[which] ?? view.state.errors.google;
  if (!error || error.siteId !== view.site?.id) return null;
  return (
    <div className="rounded-xl border border-[hsl(var(--rules-critical))]/30 bg-[hsl(var(--rules-critical))]/5 p-4 text-sm" role="alert">
      <p>{error.message}</p>
      {error.activationUrl && (
        <Button size="sm" variant="outline" className="mt-2 h-8" onClick={() => void openExternal(error.activationUrl as string)}>
          Turn it on in Google Cloud
        </Button>
      )}
    </div>
  );
}

function useRefreshOnOpen(enabled: boolean, fetchedAt: number | undefined) {
  const view = useSeoView();
  useEffect(() => {
    if (!enabled || !view.site) return;
    // Google's numbers move once a day; an hour-old copy is fresh enough.
    if (fetchedAt && Date.now() - fetchedAt < 60 * 60 * 1000) return;
    void refreshGoogle(view.site.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, view.site?.id]);
}

interface DayPoint {
  date: string;
  value: number;
}

function DayChart({ points, label, format, updates = [], reversed = false }: { points: DayPoint[]; label: string; format: (value: number) => string; updates?: GoogleUpdate[]; reversed?: boolean }) {
  const from = points[0]?.date;
  const to = points[points.length - 1]?.date;
  const shown = useMemo(() => (from && to ? updates.filter((update) => update.date >= from && update.date <= to && /core|spam|ranking|helpful/i.test(`${update.kind} ${update.name}`)) : []), [updates, from, to]);
  const gradient = useMemo(() => `seo-fill-${Math.random().toString(36).slice(2, 8)}`, []);
  if (!points.length) return <p className="py-10 text-center text-sm text-muted-foreground">No days to show yet</p>;
  return (
    <div className="h-56 w-full" role="img" aria-label={`${label} by day`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
          <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis reversed={reversed} width={44} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickFormatter={format} allowDecimals={!reversed} />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as DayPoint;
              const today = shown.filter((update) => update.date === point.date);
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">{shortDay(point.date)}</p>
                  <p className="mt-1 flex items-center gap-2">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ background: SERIES }} aria-hidden />
                    {label}: <span className="font-medium tabular-nums">{format(point.value)}</span>
                  </p>
                  {today.map((update) => (
                    <p key={update.name} className="mt-1 max-w-[240px]">
                      <span className="font-medium">Google update:</span> {update.name}
                    </p>
                  ))}
                </div>
              );
            }}
          />
          {shown.map((update) => (
            <ReferenceLine key={`${update.date}:${update.name}`} x={update.date} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.7} />
          ))}
          <Area type="monotone" dataKey="value" stroke={SERIES} strokeWidth={2} fill={`url(#${gradient})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type SearchMetric = 'clicks' | 'impressions' | 'ctr' | 'position';

const SEARCH_METRICS: Record<SearchMetric, { label: string; format: (value: number) => string }> = {
  clicks: { label: 'Clicks', format: (value) => formatNumber(value) },
  impressions: { label: 'Times seen', format: (value) => formatNumber(value) },
  ctr: { label: 'Click rate', format: (value) => `${(value * 100).toFixed(1)}%` },
  position: { label: 'Average place', format: (value) => value.toFixed(1) },
};

export function SeoSearch() {
  const view = useSeoView();
  const google = useSeoGoogle();
  const site = view.site;
  const property = site ? google.sites[site.id]?.searchConsole : undefined;
  const ready = !googleReason() && Boolean(property);
  const search = searchOf(site?.id ?? null, view.state);
  const [metric, setMetric] = useState<SearchMetric>('clicks');
  const busy = view.state.busy.google === site?.id;
  useRefreshOnOpen(ready, search?.fetchedAt);
  if (!site) return <NeedsGoogle what="search" />;
  if (googleReason()) return <NeedsGoogle what="search" />;
  if (!property) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
        <Card>
          <CardTitle icon={MousePointerClickIcon} title="Pick your site in Search Console" hint={`Search Console lists the sites that ${google.active?.email ?? 'the key'} may see.`} />
          <PropertyPicker />
        </Card>
      </div>
    );
  }
  const updates = googleUpdates(view.knowledge);
  const close = search ? closeToPageOne(search.queries) : [];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Search</h2>
          <p className="text-xs text-muted-foreground">
            {property.replace(/^sc-domain:/, '')}, the last 28 days{search ? `. Updated ${formatAgo(search.fetchedAt)}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void refreshGoogle(site.id)}>
          <RefreshCwIcon className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
          Refresh
        </Button>
      </div>
      <GoogleError which="search" />
      {!search ? (
        <Card className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" aria-busy={busy}>
          {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
          {busy ? 'Getting your numbers from Google' : 'No numbers yet. Press Refresh.'}
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="seo-search-tiles">
            {(Object.keys(SEARCH_METRICS) as SearchMetric[]).map((key) => (
              <button key={key} type="button" className={cn('rounded-xl text-left ring-offset-background transition-shadow', metric === key && 'ring-2 ring-[hsl(var(--seo-accent))]/50')} onClick={() => setMetric(key)} aria-pressed={metric === key}>
                <Tile label={SEARCH_METRICS[key].label} value={SEARCH_METRICS[key].format(search.totals[key])}>
                  <Delta change={changeOf(search.totals[key], search.previous[key])} higherIsBetter={key !== 'position'} /> from the 28 days before
                </Tile>
              </button>
            ))}
          </div>
          <Card>
            <CardTitle
              icon={TrendingUpIcon}
              title={`${SEARCH_METRICS[metric].label} by day`}
              hint={metric === 'position' ? 'Lower is better: 1 is the first result on Google.' : 'The last two days can still change while Google counts.'}
              actions={
                <InfoTip label="About the dashed lines">
                  A dashed line marks a day Google confirmed an update to how it ranks pages, from claude-seo&apos;s list of Google&apos;s announcements. A change in your numbers right after one is often the update, not your site.
                </InfoTip>
              }
            />
            <DayChart
              points={search.days.map((day) => ({ date: day.date, value: day[metric] }))}
              label={SEARCH_METRICS[metric].label}
              format={SEARCH_METRICS[metric].format}
              updates={updates}
              reversed={metric === 'position'}
            />
          </Card>
          {close.length > 0 && (
            <Card>
              <CardTitle icon={SparklesIcon} title="Searches you're close to page one on" hint="People see your site for these, but it sits low on the page. A better title or a page about the search can move it up." />
              <ul className="divide-y">
                {close.map((row) => (
                  <li key={row.keys[0]} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{row.keys[0]}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">Seen {formatNumber(row.impressions)} times</span>
                    <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">Place {row.position.toFixed(0)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <RowsTable title="What people searched" rows={search.queries} first="Search" />
            <RowsTable title="Pages they found" rows={search.pages} first="Page" page />
          </div>
        </>
      )}
    </div>
  );
}

function RowsTable({ title, rows, first, page = false }: { title: string; rows: SearchRow[]; first: string; page?: boolean }) {
  return (
    <Card className="p-0">
      <p className="border-b px-4 py-3 text-sm font-semibold">{title}</p>
      {rows.length ? (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{first}</th>
                <th className="px-2 py-2 text-right font-medium">Clicks</th>
                <th className="px-2 py-2 text-right font-medium">Seen</th>
                <th className="px-4 py-2 text-right font-medium">Place</th>
              </tr>
            </thead>
            <tbody className="divide-y [&>tr:nth-child(even)]:bg-transparent">
              {rows.slice(0, 25).map((row) => (
                <tr key={row.keys[0]}>
                  <td className="max-w-[16rem] truncate px-4 py-2" title={row.keys[0]}>
                    {page ? shortAddress(row.keys[0]) : row.keys[0]}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.clicks)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(row.impressions)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{row.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. A new site takes a few days to show up in Search Console.</p>
      )}
    </Card>
  );
}

export function SeoVisitors() {
  const view = useSeoView();
  const google = useSeoGoogle();
  const site = view.site;
  const property = site ? google.sites[site.id]?.analytics : undefined;
  const ready = !googleReason() && Boolean(property);
  const analytics = analyticsOf(site?.id ?? null, view.state);
  const busy = view.state.busy.google === site?.id;
  useRefreshOnOpen(ready, analytics?.fetchedAt);
  if (!site || googleReason()) return <NeedsGoogle what="visitors" />;
  if (!property) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
        <Card>
          <CardTitle icon={UsersRoundIcon} title="Pick your site in Analytics" hint={`Analytics lists the properties that ${google.active?.email ?? 'the key'} may see.`} />
          <PropertyPicker />
        </Card>
      </div>
    );
  }
  const totalSessions = analytics?.channels.reduce((sum, row) => sum + row.sessions, 0) ?? 0;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Visitors</h2>
          <p className="text-xs text-muted-foreground">
            {google.sites[site.id]?.analyticsName ?? property}, the last 28 days{analytics ? `. Updated ${formatAgo(analytics.fetchedAt)}` : ''}
          </p>
        </div>
        <Gated reason={busy ? 'Already getting the numbers' : null}>
          <Button variant="outline" size="sm" className="h-8" onClick={() => void refreshGoogle(site.id)}>
            <RefreshCwIcon className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
            Refresh
          </Button>
        </Gated>
      </div>
      <GoogleError which="analytics" />
      {!analytics ? (
        <Card className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          {busy && <Loader2Icon className="h-4 w-4 animate-spin" />}
          {busy ? 'Getting your numbers from Google' : 'No numbers yet. Press Refresh.'}
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="seo-visitor-tiles">
            <Tile label="Visitors" value={formatNumber(analytics.totals.users)}>
              <Delta change={changeOf(analytics.totals.users, analytics.previous.users)} /> from the 28 days before
            </Tile>
            <Tile label="Visits" value={formatNumber(analytics.totals.sessions)}>
              <Delta change={changeOf(analytics.totals.sessions, analytics.previous.sessions)} /> from the 28 days before
            </Tile>
            <Tile label="Visits that stayed" value={formatNumber(analytics.totals.engaged)} title="Visits that lasted 10 seconds or more, opened another page or did something">
              <Delta change={changeOf(analytics.totals.engaged, analytics.previous.engaged)} /> from the 28 days before
            </Tile>
            <Tile label="Pages read" value={formatNumber(analytics.totals.views)}>
              <Delta change={changeOf(analytics.totals.views, analytics.previous.views)} /> from the 28 days before
            </Tile>
          </div>
          <Card>
            <CardTitle icon={TrendingUpIcon} title="Visitors by day" />
            <DayChart points={analytics.days.map((day) => ({ date: day.date, value: day.users }))} label="Visitors" format={(value) => formatNumber(value)} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle title="Where visits come from" hint="Organic Search is people who found you on Google or another search engine." />
              <ul className="space-y-2">
                {analytics.channels.map((row) => (
                  <li key={row.channel} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{row.channel || 'Unknown'}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatNumber(row.sessions)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${totalSessions ? Math.max(2, (row.sessions / totalSessions) * 100) : 0}%`, background: SERIES }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-0">
              <p className="border-b px-4 py-3 text-sm font-semibold">Pages people read</p>
              <table className="w-full text-left text-sm">
                <thead className="bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Page</th>
                    <th className="px-2 py-2 text-right font-medium">Reads</th>
                    <th className="px-4 py-2 text-right font-medium">Visitors</th>
                  </tr>
                </thead>
                <tbody className="divide-y [&>tr:nth-child(even)]:bg-transparent">
                  {analytics.pages.map((row) => (
                    <tr key={row.path}>
                      <td className="max-w-[16rem] truncate px-4 py-2" title={row.path}>
                        {row.path}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.views)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(row.users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
