"use client";

// SEO: how the user's app website does in Google and in AI answers. One of
// the views the activity bar switches between (ActivityBar.tsx).
//
// The checks run here, on pages the view fetches (the desktop app reads any
// https site; a browser only sites that let other sites read them, such as
// GitHub Pages) or on the Website view's pages before they are published.
// They are claude-seo's checks, copied into src/lib/seo/checks from the
// user's fork. What the AI knows about SEO comes from the same fork, read
// when the view opens (src/lib/seo/sync.ts). Google's own numbers need a
// service account key, the kind Growth uses for Google Play.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BotIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  Loader2Icon,
  MousePointerClickIcon,
  PlayIcon,
  SearchCheckIcon,
  SettingsIcon,
  SparklesIcon,
  SquareIcon,
  TypeIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { track } from '@/lib/analytics';
import { isTauri } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { loadSeo, selectSite, siteData, speedOf, startCheck, stopJob, syncWebsiteSites, scoreWithSpeed, useSeo } from '@/lib/seo/state';
import { getKnowledgeState, openSeoKnowledge, subscribeKnowledge } from '@/lib/seo/sync';
import { registerSeoSetup } from '@/lib/seo/setupPort';
import type { SiteRun } from '@/lib/seo/types';
import { Gated } from '../growth/GrowthShared';
import { SeoAsk } from './SeoAsk';
import { SeoAiSearch } from './SeoAiSearch';
import { SeoOverview } from './SeoOverview';
import { SeoSetup } from './SeoSetup';
import { SeoSiteCheck } from './SeoSiteCheck';
import { SeoSearch, SeoVisitors } from './SeoGoogle';
import { SeoSpeed } from './SeoSpeed';
import { SeoWords } from './SeoWords';
import { SeoProvider, useSeoAi, type OpenProjectForSeo, type SectionOptions, type SeoSection, type SeoView } from './SeoShared';

interface NavItem {
  section: SeoSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: Array<{ label?: string; items: NavItem[] }> = [
  {
    items: [
      { section: 'overview', label: 'Overview', icon: LayoutDashboardIcon },
      { section: 'ask', label: 'Ask AI', icon: SparklesIcon },
    ],
  },
  {
    label: 'Your site',
    items: [
      { section: 'check', label: 'Site check', icon: ListChecksIcon },
      { section: 'ai', label: 'AI search', icon: BotIcon },
      { section: 'words', label: 'Words', icon: TypeIcon },
    ],
  },
  {
    label: 'Google',
    items: [
      { section: 'search', label: 'Search', icon: MousePointerClickIcon },
      { section: 'visitors', label: 'Visitors', icon: UsersRoundIcon },
      { section: 'speed', label: 'Speed', icon: GaugeIcon },
    ],
  },
];

const ADD_SITE = '__add__';

function useKnowledge() {
  return React.useSyncExternalStore(subscribeKnowledge, getKnowledgeState, getKnowledgeState);
}

export function SeoWorkspace({ active, readProject, onSetUpGoogle }: { active: boolean; readProject: () => OpenProjectForSeo; onSetUpGoogle?: () => void }) {
  const state = useSeo();
  const knowledge = useKnowledge();
  const ai = useSeoAi(active);
  const [section, setSection] = useState<SeoSection>('overview');
  const [options, setOptions] = useState<SectionOptions>({});
  // Changes on every goTo, so a section asked for again starts over with its options.
  const [visit, setVisit] = useState(0);
  const [desktop, setDesktop] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    setDesktop(isTauri());
    // Ask AI's Google setup for SEO reads and saves through this.
    registerSeoSetup();
  }, []);

  useEffect(() => {
    if (!active) return;
    void (async () => {
      if (!started.current) {
        started.current = true;
        await loadSeo();
      }
      await syncWebsiteSites(readProject().id);
    })();
    void openSeoKnowledge();
  }, [active, readProject]);

  const goTo = useCallback((next: SeoSection, nextOptions: SectionOptions = {}) => {
    setSection(next);
    setOptions(nextOptions);
    setVisit((count) => count + 1);
    track('seo_section', { section: next });
  }, []);

  const site = state.sites.find((entry) => entry.id === state.activeId) ?? null;
  const data = siteData(site?.id ?? null, state);
  const run = data.runs[0] ?? null;
  const previous = data.runs[1] ?? null;
  const score = run ? scoreWithSpeed(run, speedOf(site, 'mobile', state)) : null;

  const check = useCallback(
    (mode?: SiteRun['mode']) => {
      if (!site) return;
      const chosen = mode ?? (site.url ? 'live' : 'draft');
      track('seo_check', { mode: chosen, source: site.source });
      void startCheck(site.id, chosen, readProject);
    },
    [site, readProject]
  );

  const view: SeoView = useMemo(
    () => ({
      active,
      desktop,
      state,
      site,
      data,
      run,
      previous,
      score,
      knowledge,
      ai,
      section,
      options,
      goTo,
      readProject,
      check,
      setUpGoogleWithAi: desktop && onSetUpGoogle ? onSetUpGoogle : null,
    }),
    [active, desktop, state, site, data, run, previous, score, knowledge, ai, section, options, goTo, readProject, check, onSetUpGoogle]
  );

  const urgent = run ? run.findings.filter((finding) => finding.severity === 'Critical' || finding.severity === 'High').length : 0;
  const progress = state.progress && state.progress.siteId === site?.id ? state.progress : null;
  const checking = state.busy.check === site?.id;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" data-testid="seo-view" aria-labelledby="seo-view-title">
      <header className="relative flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(var(--seo-accent))] to-[hsl(var(--seo-accent))]/70 text-white shadow-sm dark:text-background">
            <SearchCheckIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 id="seo-view-title" className="text-sm font-semibold leading-tight">
              SEO
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">Get your app&apos;s website found on Google and in AI answers</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state.sites.length > 0 && (
            <Select
              value={site?.id ?? ''}
              onValueChange={(value) => {
                if (value === ADD_SITE) goTo('setup');
                else selectSite(value);
              }}
            >
              <SelectTrigger className="h-8 w-[230px] text-xs" aria-label="Site to check">
                <SelectValue placeholder="Pick a site" />
              </SelectTrigger>
              <SelectContent>
                {state.sites.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id} className="text-xs">
                    {entry.name}
                    {entry.source === 'website' && !entry.url ? ' (not online yet)' : ''}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={ADD_SITE} className="text-xs">
                  Add another site
                </SelectItem>
              </SelectContent>
            </Select>
          )}
          {site &&
            (checking ? (
              <Button size="sm" variant="outline" className="h-8" onClick={() => stopJob('check')}>
                <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Gated reason={!site.url && site.source !== 'website' ? 'Add the address first' : null}>
                <Button size="sm" className="h-8 bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" onClick={() => check()} data-testid="seo-check-now">
                  <PlayIcon className="mr-1.5 h-3.5 w-3.5" />
                  {site.url ? 'Check now' : 'Check before publishing'}
                </Button>
              </Gated>
            ))}
        </div>
        {progress && (
          <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden" aria-hidden>
            <div
              className="h-full bg-[hsl(var(--seo-accent))] transition-[width] duration-300"
              style={{ width: `${Math.max(6, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%` }}
            />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-52 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r" aria-label="SEO sections">
          {NAV.map((group, index) => (
            <div
              key={group.label ?? index}
              role="group"
              aria-label={group.label}
              className={cn('flex shrink-0 gap-1 md:flex-col', index > 0 && 'border-l pl-1 md:mt-2 md:border-l-0 md:border-t md:pl-0 md:pt-2')}
            >
              {group.label && (
                <p className="hidden px-3 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:block" aria-hidden>
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <NavButton key={item.section} item={item} current={section === item.section} count={item.section === 'check' ? urgent : 0} onClick={() => goTo(item.section)} />
              ))}
            </div>
          ))}
          <div className="flex shrink-0 gap-1 md:mt-auto md:flex-col md:border-t md:pt-2">
            <NavButton item={{ section: 'setup', label: 'Setup', icon: SettingsIcon }} current={section === 'setup'} count={0} onClick={() => goTo('setup')} />
          </div>
        </nav>

        <main className={cn('min-h-0 flex-1', section === 'ask' ? 'overflow-hidden' : 'overflow-y-auto')} key={`${section}:${visit}`}>
          {!state.loaded ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Opening SEO
            </div>
          ) : (
            <SeoProvider value={view}>
              {section === 'overview' && <SeoOverview />}
              {section === 'ask' && <SeoAsk />}
              {section === 'check' && <SeoSiteCheck />}
              {section === 'ai' && <SeoAiSearch />}
              {section === 'words' && <SeoWords />}
              {section === 'search' && <SeoSearch />}
              {section === 'visitors' && <SeoVisitors />}
              {section === 'speed' && <SeoSpeed />}
              {section === 'setup' && <SeoSetup />}
            </SeoProvider>
          )}
        </main>
      </div>
    </section>
  );
}

function NavButton({ item, current, count, onClick }: { item: NavItem; current: boolean; count: number; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors', current ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}
      aria-current={current ? 'page' : undefined}
    >
      <Icon className={cn('h-4 w-4 shrink-0', current && 'text-[hsl(var(--seo-accent))]')} />
      <span className="flex-1">{item.label}</span>
      {count > 0 && (
        <span className="rounded-full bg-[hsl(var(--rules-high))]/15 px-1.5 text-[11px] font-medium tabular-nums text-[hsl(var(--rules-high))]" title={`${count} important things to fix`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
