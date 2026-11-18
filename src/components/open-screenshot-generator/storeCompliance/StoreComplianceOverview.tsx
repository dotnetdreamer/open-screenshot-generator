"use client";

// Where Store compliance opens: how far the open project's checklist has
// come, the two checks that stop most rejections, the AI check, the deadlines
// coming up and the reasons apps are rejected most, each a way into its
// section.

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightIcon, BookOpenIcon, CalendarClockIcon, CheckIcon, MessageSquareWarningIcon, ShieldAlertIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readLastCheck } from '@/lib/storeCompliance/chat';
import { checklistItemsFor, deadlineDay } from '@/lib/storeCompliance/parse';
import { checkText, deadlineTitle, placeName, ruleTitle } from '@/lib/storeCompliance/plain';
import { daysUntil, deadlineStore, deadlinesByDay, ruleForStores } from '@/lib/storeCompliance/search';
import { markNewsSeen } from '@/lib/storeCompliance/sync';
import { countsAsDone, DEVICE_LIST, useTicks } from '@/lib/storeCompliance/ticks';
import type { CheckResult } from '@/lib/storeCompliance/ai';
import { cn } from '@/lib/utils';
import { InlineMarkdown } from './RulesMarkdown';
import { PlainText, SEVERITY_STYLE, SeverityBadge, StoreMarks, formatAgo, formatDay, fromToday, useRulesView } from './StoreComplianceShared';

export function ProgressRing({ done, total, size = 76 }: { done: number; total: number; size?: number }) {
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const share = total > 0 ? done / total : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share)}
          className="stroke-[hsl(var(--rules-accent))] transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{Math.round(share * 100)}%</span>
    </div>
  );
}

function Tile({ icon: Icon, value, label, detail, onClick }: { icon: React.ComponentType<{ className?: string }>; value: string; label: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-1 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <ArrowRightIcon className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
      <span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

export function StoreComplianceOverview() {
  const view = useRulesView();
  const { library, stores, project, today } = view;
  const list = project.id ?? DEVICE_LIST;
  const { ticks, toggle } = useTicks(list);
  const [lastCheck, setLastCheck] = useState<{ result: CheckResult; projectName: string } | null>(null);

  useEffect(() => {
    if (!project.id) return;
    let live = true;
    void readLastCheck(project.id)
      .then((found) => live && setLastCheck(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project.id]);

  const items = useMemo(() => checklistItemsFor(library.checklist, stores), [library.checklist, stores]);
  const done = items.filter((item) => countsAsDone(item, ticks.get(item.id))).length;
  const first = library.checklist?.sections[0] ?? null;
  const firstItems = first ? first.groups.flatMap((group) => group.items) : [];

  const rules = useMemo(() => library.rules.filter((rule) => ruleForStores(rule.store, stores)), [library.rules, stores]);
  const critical = rules.filter((rule) => rule.severity === 'critical');
  const coming = useMemo(
    () =>
      deadlinesByDay(library.deadlines, today).coming.filter((deadline) => {
        const store = deadlineStore(deadline);
        return !store || stores.includes(store);
      }),
    [library.deadlines, today, stores]
  );
  const within90 = coming.filter((deadline) => daysUntil(deadlineDay(deadline)!, today) <= 90);
  const guideCount = library.guides.reduce((sum, group) => sum + group.guides.length, 0);
  const news = view.state.news && !view.state.news.seen ? view.state.news : null;
  const storeWords = stores.length === 2 ? 'App Store and Google Play' : stores[0] === 'apple' ? 'App Store' : 'Google Play';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6" data-testid="store-compliance-overview">
      {news && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[hsl(var(--rules-accent))]/30 bg-[hsl(var(--rules-accent))]/5 px-4 py-3" role="status" data-testid="store-compliance-news">
          <SparklesIcon className="h-4 w-4 shrink-0 text-[hsl(var(--rules-accent))]" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">New since your last visit:</span>{' '}
            {[news.rules.length ? `${news.rules.length} rejection reason${news.rules.length === 1 ? '' : 's'}` : '', news.deadlines.length ? `${news.deadlines.length} deadline${news.deadlines.length === 1 ? '' : 's'}` : '']
              .filter(Boolean)
              .join(' and ')}
          </p>
          {news.rules.length > 0 && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => view.goTo('rules', { onlyNew: true })}>
              See the new rules
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Close" aria-label="Close the note about new rules" onClick={() => void markNewsSeen()}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border bg-card p-5" aria-labelledby="rules-ready-title">
          <div className="flex items-center gap-4">
            <ProgressRing done={done} total={items.length} />
            <div className="min-w-0 flex-1">
              <h2 id="rules-ready-title" className="text-base font-semibold">
                Ready for review?
              </h2>
              <p className="text-sm text-muted-foreground" data-testid="store-compliance-progress">
                {done} of {items.length} checks done{project.name ? ` for ${project.name}` : ''}
              </p>
              <Button size="sm" variant="outline" className="mt-2 h-8 gap-1.5" onClick={() => view.goTo('checklist')}>
                {done > 0 ? 'Continue the checklist' : 'Open the checklist'}
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {firstItems.length > 0 && (
            <div className="mt-5 border-t pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The two checks that stop most rejections</p>
              <ul className="space-y-2">
                {firstItems.map((item) => {
                  const ticked = countsAsDone(item, ticks.get(item.id));
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={ticked}
                        onClick={() => toggle(item.id, !ticked)}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors',
                          ticked ? 'border-[hsl(var(--rules-accent))]/30 bg-[hsl(var(--rules-accent))]/5' : 'hover:bg-muted/50'
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                            ticked ? 'border-[hsl(var(--rules-accent))] bg-[hsl(var(--rules-accent))] text-white dark:text-background' : 'border-muted-foreground/40'
                          )}
                        >
                          {ticked && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
                        </span>
                        <span className={cn('leading-relaxed', ticked && 'text-muted-foreground')}>
                          {item.plain ? <PlainText text={checkText(item)} listClassName="text-[13px] text-muted-foreground" /> : <InlineMarkdown text={item.text} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="relative overflow-hidden rounded-2xl border bg-card p-5" aria-labelledby="rules-check-title">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[hsl(var(--rules-accent))]/10 blur-2xl" />
          <div className="relative flex h-full flex-col gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--rules-accent))]/10 text-[hsl(var(--rules-accent))]">
              <SparklesIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 id="rules-check-title" className="text-base font-semibold">
                Let AI check your app
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                AI reads the text on your screenshots and store page. It tells you what could get your app rejected.
              </p>
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {[
                'Text on all your screenshots, in every language',
                'Your store page text',
                `Checked against ${rules.length} rules`,
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--rules-accent))]" />
                  {line}
                </li>
              ))}
            </ul>
            {lastCheck && (
              <button
                type="button"
                onClick={() => view.goTo('ask', { start: 'check' })}
                className="rounded-lg border bg-background/60 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60"
                data-testid="store-compliance-last-check"
              >
                <span className="font-medium text-foreground">
                  Last check: {lastCheck.result.findings.length === 0 ? 'nothing to fix' : `${lastCheck.result.findings.length} thing${lastCheck.result.findings.length === 1 ? '' : 's'} to look at`}
                </span>
                , {formatAgo(lastCheck.result.at)}
              </button>
            )}
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              <Button size="sm" className="gap-1.5" onClick={() => view.goTo('ask', { start: 'check' })}>
                <SparklesIcon className="h-3.5 w-3.5" />
                Check my app
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => view.goTo('ask', { start: 'rejected' })}>
                <MessageSquareWarningIcon className="h-3.5 w-3.5" />
                I got rejected
              </Button>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          icon={ShieldAlertIcon}
          value={String(rules.length)}
          label="Why apps get rejected"
          detail={`${critical.length} of them are critical`}
          onClick={() => view.goTo('rules')}
        />
        <Tile
          icon={CalendarClockIcon}
          value={String(within90.length)}
          label="Deadlines in the next 90 days"
          detail={coming[0] ? `Next: ${deadlineTitle(coming[0])}, ${fromToday(daysUntil(deadlineDay(coming[0])!, today)).toLowerCase()}` : 'Nothing dated ahead'}
          onClick={() => view.goTo('deadlines')}
        />
        <Tile icon={BookOpenIcon} value={String(guideCount)} label="Guides" detail="Apple, Google Play, appeals and the laws for apps" onClick={() => view.goTo('guides')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card" aria-labelledby="rules-coming-title">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="rules-coming-title" className="text-sm font-semibold">
              Coming up
            </h2>
            <button type="button" className="text-xs font-medium text-[hsl(var(--rules-accent))] hover:underline" onClick={() => view.goTo('deadlines')}>
              Every deadline
            </button>
          </div>
          <ul className="divide-y">
            {coming.slice(0, 5).map((deadline) => {
              const days = daysUntil(deadlineDay(deadline)!, today);
              return (
                <li key={deadline.id}>
                  <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50" onClick={() => view.goTo('deadlines', { deadline: deadline.id })}>
                    <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_STYLE[deadline.priority].dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium leading-snug">{deadlineTitle(deadline)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{placeName(deadline.jurisdiction)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn('block text-xs font-semibold tabular-nums', days <= 30 && 'text-[hsl(var(--rules-high))]')}>{fromToday(days)}</span>
                      <span className="block text-[11px] text-muted-foreground">{formatDay(deadlineDay(deadline))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {coming.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No dated deadlines ahead for {storeWords}</li>}
          </ul>
        </section>

        <section className="rounded-2xl border bg-card" aria-labelledby="rules-common-title">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="rules-common-title" className="text-sm font-semibold">
              Biggest rejection risks
            </h2>
            <button type="button" className="text-xs font-medium text-[hsl(var(--rules-accent))] hover:underline" onClick={() => view.goTo('rules')}>
              All {rules.length}
            </button>
          </div>
          <ul className="divide-y">
            {critical.slice(0, 5).map((rule) => (
              <li key={rule.id}>
                <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50" onClick={() => view.openRule(rule.id)}>
                  <SeverityBadge severity={rule.severity} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{ruleTitle(rule)}</span>
                    <StoreMarks store={rule.store} className="mt-0.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
