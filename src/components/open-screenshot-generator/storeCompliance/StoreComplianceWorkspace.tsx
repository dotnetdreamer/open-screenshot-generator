"use client";

// Store compliance: what gets an app rejected from the App Store and Google Play,
// how to fix it, the checks to make before sending it for review, and the
// laws with dates coming up. One of the views the activity bar switches
// between (ActivityBar.tsx).
//
// The rules are not part of the app. They come from the App Store Compliance
// Playbook on GitHub (src/lib/storeCompliance/source.ts), fetched the first time
// this view shows in a sitting and kept in a database on this computer, so a
// change to the repository reaches everyone and the view still works offline
// (sync.ts). Ask AI uses the same AI as Growth (Claude Code, Codex or the AI
// panel's provider) and can check the open project's screenshots.
//
// The view stays mounted once opened, like Growth, so the section, a search
// and an answer on its way are as they were after a visit to the editor.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppleIcon,
  BookOpenIcon,
  CalendarClockIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WifiOffIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { growthAiInUse, growthAiLabel, growthAiUnavailableReason, isGrowthAiAvailable, onGrowthAiChange, refreshGrowthAi } from '@/lib/growth/ai';
import { askRulesQuestion } from '@/lib/storeCompliance/chat';
import { ruleTitle } from '@/lib/storeCompliance/plain';
import { checkStoreCompliance, openStoreCompliance, useStoreCompliance } from '@/lib/storeCompliance/sync';
import type { ShipStore } from '@/lib/storeCompliance/types';
import { cn } from '@/lib/utils';
import { StoreComplianceAsk } from './StoreComplianceAsk';
import { StoreComplianceChecklist } from './StoreComplianceChecklist';
import { StoreComplianceDeadlines } from './StoreComplianceDeadlines';
import { StoreComplianceGuides } from './StoreComplianceGuides';
import { StoreComplianceLibrary } from './StoreComplianceLibrary';
import { StoreComplianceOverview } from './StoreComplianceOverview';
import {
  EmptyState,
  RuleSheet,
  RulesProvider,
  formatAgo,
  localDay,
  type OpenProjectForRules,
  type RulesAi,
  type RulesSection,
  type RulesView,
  type SectionOptions,
} from './StoreComplianceShared';

interface NavItem {
  section: RulesSection;
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
    label: 'Before you submit',
    items: [
      { section: 'checklist', label: 'Checklist', icon: ListChecksIcon },
      { section: 'rules', label: 'Why apps get rejected', icon: ShieldAlertIcon },
      { section: 'deadlines', label: 'Deadlines', icon: CalendarClockIcon },
    ],
  },
  { label: 'Learn', items: [{ section: 'guides', label: 'Guides', icon: BookOpenIcon }] },
];

const STORES_KEY = 'osg-store-compliance-stores';

function readStores(): ShipStore[] {
  try {
    const saved = window.localStorage.getItem(STORES_KEY);
    if (saved === 'apple' || saved === 'google') return [saved];
  } catch {
    // Private mode: both stores, as for a new user.
  }
  return ['apple', 'google'];
}

/**
 * Which AI answers, read again whenever the view shows and whenever the
 * window comes back to the front. The view stays mounted, and nothing tells
 * it when the AI panel gets a key (it is saved quietly) or when Claude Code
 * is signed in from a terminal, so reading it once would leave the buttons
 * saying "set up an AI" after the user has. With no AI ready, coming back to
 * the window also looks for Claude Code and Codex again.
 */
function useRulesAi(active: boolean): RulesAi {
  const read = (): RulesAi => ({ available: isGrowthAiAvailable(), label: growthAiLabel(), reason: growthAiUnavailableReason(), inUse: growthAiInUse() });
  const [ai, setAi] = useState<RulesAi>({ available: false, label: null, reason: 'Looking for Claude Code and Codex', inUse: null });
  useEffect(() => {
    if (!active) return;
    const refresh = () => setAi(read());
    refresh();
    const onFront = () => {
      if (document.visibilityState === 'hidden') return;
      if (!isGrowthAiAvailable()) refreshGrowthAi({ refresh: true });
      refresh();
    };
    window.addEventListener('focus', onFront);
    document.addEventListener('visibilitychange', onFront);
    const stop = onGrowthAiChange(refresh);
    return () => {
      stop();
      window.removeEventListener('focus', onFront);
      document.removeEventListener('visibilitychange', onFront);
    };
  }, [active]);
  return ai;
}

export function StoreComplianceWorkspace({ active, readProject }: { active: boolean; readProject: () => OpenProjectForRules }) {
  const state = useStoreCompliance();
  const ai = useRulesAi(active);
  const [section, setSection] = useState<RulesSection>('overview');
  const [options, setOptions] = useState<SectionOptions>({});
  // Changes on every goTo, so a section asked for again starts over with its options.
  const [visit, setVisit] = useState(0);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [stores, setStoresState] = useState<ShipStore[]>(['apple', 'google']);
  const [project, setProject] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [today, setToday] = useState(() => localDay());

  useEffect(() => setStoresState(readStores()), []);

  // The first time the view shows in a sitting, and whenever it shows again
  // after six hours, the rules are checked against GitHub.
  useEffect(() => {
    if (!active) return;
    void openStoreCompliance();
    const { id, name } = readProject();
    setProject({ id, name });
    setToday(localDay());
  }, [active, readProject]);

  // Back online after a check that could not reach GitHub: check again.
  const offline = state.head?.problem?.kind === 'offline';
  useEffect(() => {
    if (!offline) return;
    const retry = () => void checkStoreCompliance();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offline]);

  const setStores = useCallback((next: ShipStore[]) => {
    if (next.length === 0) return;
    setStoresState(next);
    try {
      window.localStorage.setItem(STORES_KEY, next.length === 2 ? 'both' : next[0]);
    } catch {
      // Kept until the view reloads.
    }
  }, []);

  const goTo = useCallback((next: RulesSection, nextOptions: SectionOptions = {}) => {
    setSection(next);
    setOptions(nextOptions);
    setVisit((count) => count + 1);
    track('store_compliance_section', { section: next });
  }, []);

  const library = state.library;
  const ask = useCallback(
    (question: string) => {
      if (!library) return;
      goTo('ask');
      void askRulesQuestion(question, { library, stores, today, ai: ai.label });
    },
    [library, goTo, stores, today, ai.label]
  );

  const view: RulesView | null = useMemo(
    () =>
      library
        ? {
            active,
            library,
            state,
            section,
            options,
            goTo,
            openRule: setRuleId,
            openGuide: (path, anchor) => goTo('guides', { guide: path, anchor }),
            stores,
            setStores,
            project,
            readProject,
            ai,
            today,
            ask,
          }
        : null,
    [active, library, state, section, options, goTo, stores, setStores, project, readProject, ai, today, ask]
  );

  const newRules = state.news && !state.news.seen ? state.news.rules.length : 0;
  const newDeadlines = state.news && !state.news.seen ? state.news.deadlines.length : 0;
  const badge = (target: RulesSection): number => (target === 'rules' ? newRules : target === 'deadlines' ? newDeadlines : 0);
  const openedRule = ruleId ? library?.rules.find((rule) => rule.id === ruleId) ?? null : null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" data-testid="store-compliance-view" aria-labelledby="store-compliance-title">
      <header className="relative flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(var(--rules-accent))] to-[hsl(var(--rules-accent))]/70 text-white shadow-sm dark:text-background">
            <ShieldCheckIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 id="store-compliance-title" className="text-sm font-semibold leading-tight">
              Store compliance
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">Get your app approved on the App Store and Google Play</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StorePicker stores={stores} onChange={setStores} />
          <SyncStatus />
        </div>
        {state.checking && state.progress && state.progress.total > 0 && (
          <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden" aria-hidden>
            <div
              className="h-full bg-[hsl(var(--rules-accent))] transition-[width] duration-300"
              style={{ width: `${Math.max(6, Math.round((state.progress.done / state.progress.total) * 100))}%` }}
            />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-52 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r"
          aria-label="Store compliance sections"
        >
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
                <NavButton key={item.section} item={item} current={section === item.section} count={badge(item.section)} disabled={!library} onClick={() => goTo(item.section)} />
              ))}
            </div>
          ))}
        </nav>

        <main className={cn('min-h-0 flex-1', section === 'ask' && view ? 'overflow-hidden' : 'overflow-y-auto')} key={`${section}:${visit}`}>
          {view ? (
            <RulesProvider value={view}>
              {section === 'overview' && <StoreComplianceOverview />}
              {section === 'ask' && <StoreComplianceAsk />}
              {section === 'checklist' && <StoreComplianceChecklist />}
              {section === 'rules' && <StoreComplianceLibrary />}
              {section === 'deadlines' && <StoreComplianceDeadlines />}
              {section === 'guides' && <StoreComplianceGuides />}
            </RulesProvider>
          ) : (
            <FirstLoad />
          )}
        </main>
      </div>
      {/* Outside the section, so a section change does not open it again. */}
      <RuleSheet
        rule={openedRule}
        isNew={!!openedRule && !!state.news && !state.news.seen && state.news.rules.includes(openedRule.id)}
        onClose={() => setRuleId(null)}
        onAsk={(rule) => {
          setRuleId(null);
          ask(`Explain "${ruleTitle(rule)}" [${rule.id}] for my app. What should I check, and how do I fix it?`);
        }}
      />
    </section>
  );
}

function NavButton({ item, current, count, disabled, onClick }: { item: NavItem; current: boolean; count: number; disabled: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-50',
        current ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      )}
      aria-current={current ? 'page' : undefined}
    >
      <Icon className={cn('h-4 w-4 shrink-0', current && 'text-[hsl(var(--rules-accent))]')} />
      <span className="flex-1">{item.label}</span>
      {count > 0 && (
        <span className="rounded-full bg-[hsl(var(--rules-accent))]/15 px-1.5 text-[11px] font-medium tabular-nums text-[hsl(var(--rules-accent))]" title={`${count} new since your last visit`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

/** Which stores the user ships to. Every screen follows it: the checklist, the rules, the deadlines, the AI. */
function StorePicker({ stores, onChange }: { stores: ShipStore[]; onChange: (stores: ShipStore[]) => void }) {
  const choices: Array<{ id: ShipStore; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'apple', label: 'App Store', icon: AppleIcon },
    { id: 'google', label: 'Google Play', icon: PlayIcon },
  ];
  return (
    <div role="group" aria-label="Stores your app is on" className="flex rounded-lg border bg-muted/30 p-0.5" title="Every list here shows only what applies to the stores you pick">
      {choices.map((choice) => {
        const on = stores.includes(choice.id);
        const Icon = choice.icon;
        return (
          <button
            key={choice.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? stores.filter((store) => store !== choice.id) : [...stores, choice.id])}
            disabled={on && stores.length === 1}
            title={on && stores.length === 1 ? 'Pick at least one store' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors disabled:cursor-default',
              on ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

function SyncStatus() {
  const state = useStoreCompliance();
  const problem = state.head?.problem ?? null;
  let dot = 'bg-[hsl(var(--rules-accent))]';
  let text = 'Up to date';
  let detail = state.head?.checkedAt ? `Checked for updates ${formatAgo(state.head.checkedAt)}` : 'Not checked yet';
  if (state.checking) {
    text = state.progress && state.progress.total > 0 ? `Downloading updates, ${state.progress.done} of ${state.progress.total}` : 'Checking for updates';
    detail = 'Asking GitHub for the latest rules';
  } else if (problem) {
    dot = 'bg-[hsl(var(--rules-medium))]';
    text = problem.kind === 'offline' ? 'Offline' : problem.kind === 'broken' ? "Couldn't use the update" : "Couldn't check for updates";
    detail = problem.message;
  } else if (!state.head?.checkedAt) {
    text = 'Not checked yet';
  }
  return (
    <div className="flex items-center gap-1">
      <span role="status" className="flex max-w-[260px] items-center gap-1.5 text-xs text-muted-foreground" title={detail} data-testid="store-compliance-status">
        {state.checking ? <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />}
        <span className="truncate">{text}</span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={state.checking}
        onClick={() => {
          track('store_compliance_check');
          void checkStoreCompliance({ force: true });
        }}
        title="Check for updates now"
        aria-label="Check for updates"
      >
        <RefreshCwIcon className={cn('h-4 w-4', state.checking && 'animate-spin')} />
      </Button>
    </div>
  );
}

/** Before the first copy is here: getting it, or why it could not be got. */
function FirstLoad() {
  const state = useStoreCompliance();
  const problem = state.head?.problem ?? null;
  if ((problem || state.checkedOnce) && !state.checking) {
    return (
      <EmptyState icon={problem?.kind === 'offline' ? WifiOffIcon : ShieldAlertIcon} title="The rules haven't downloaded yet">
        <p className="max-w-sm text-sm text-muted-foreground" data-testid="store-compliance-problem">
          {/* No problem saved means the database itself failed, as it can when a browser keeps no site data. */}
          {problem?.message ?? "The rules couldn't be saved on this computer. Try again."}
        </p>
        <Button size="sm" className="mt-1" onClick={() => void checkStoreCompliance({ force: true })}>
          Try again
        </Button>
      </EmptyState>
    );
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6" aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        {state.progress && state.progress.total > 0
          ? `Downloading the latest rules from GitHub, ${state.progress.done} of ${state.progress.total} files`
          : 'Downloading the latest rules from GitHub'}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-xl border bg-card" />
    </div>
  );
}
