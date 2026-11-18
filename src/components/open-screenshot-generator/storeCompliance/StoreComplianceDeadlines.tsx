"use client";

// Deadlines: the dates new laws and store rules start, as a timeline by
// month. Coming up first, soonest at the top, and the ones that have started
// on their own tab. A deadline opened from the Overview arrives open. Each
// says what changes in plain words where the repository has them (plain.ts),
// with the law's name and the playbook's own words one click down.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ExternalLinkIcon, SearchIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openExternal } from '@/lib/desktop';
import { deadlineDay } from '@/lib/storeCompliance/parse';
import { deadlineSummary, deadlineTitle, firstLine, placeName } from '@/lib/storeCompliance/plain';
import { daysUntil, deadlineStore, deadlinesByDay, searchDeadlines } from '@/lib/storeCompliance/search';
import type { Deadline } from '@/lib/storeCompliance/types';
import { cn } from '@/lib/utils';
import { PlainText, SEVERITY_STYLE, SeverityBadge, formatDay, fromToday, useRulesView } from './StoreComplianceShared';

const REGIONS = ['App Store', 'Google Play', 'EU', 'USA', 'UK', 'Other countries'] as const;
type Region = (typeof REGIONS)[number];

export function regionOf(jurisdiction: string): Region {
  const where = jurisdiction.toLowerCase();
  if (/apple|app store/.test(where)) return 'App Store';
  if (/google|android|\bplay\b/.test(where)) return 'Google Play';
  if (/european union|\(eu\)|\beu\b/.test(where)) return 'EU';
  if (/united states|\busa\b|\bus\b/.test(where)) return 'USA';
  if (/united kingdom|\(uk\)|\buk\b/.test(where)) return 'UK';
  return 'Other countries';
}

function monthOf(day: string | null): string {
  if (!day) return 'No date';
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function DeadlineCard({ deadline, today, open, onToggle, onAsk }: { deadline: Deadline; today: string; open: boolean; onToggle: () => void; onAsk: () => void }) {
  const day = deadlineDay(deadline);
  const days = day ? daysUntil(day, today) : null;
  const date = day ? new Date(`${day}T00:00:00Z`) : null;
  const dates: Array<[string, string | null]> = [
    ['Takes effect', deadline.effective ? formatDay(deadline.effective) : null],
    ['Time to get ready', deadline.grace],
    ['Has to be done by', deadline.mandatory ? formatDay(deadline.mandatory) : null],
    ['Enforced from', deadline.enforcement ? formatDay(deadline.enforcement) : null],
  ];
  return (
    <li id={`deadline-${deadline.id}`} className="relative pl-16" data-deadline={deadline.id}>
      <div className="absolute left-0 top-3 flex w-12 flex-col items-center" aria-hidden>
        <span className="text-lg font-semibold leading-none tabular-nums">{date ? date.getUTCDate() : '?'}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{date ? date.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }) : ''}</span>
      </div>
      <span aria-hidden className={cn('absolute left-[54px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-background', SEVERITY_STYLE[deadline.priority].dot)} />
      <div className={cn('rounded-xl border bg-card transition-shadow', open && 'shadow-md')}>
        <button type="button" className="flex w-full items-start gap-3 p-4 text-left" onClick={onToggle} aria-expanded={open}>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={deadline.priority} of="deadline" />
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={deadline.jurisdiction}>
                {placeName(deadline.jurisdiction)}
              </span>
            </span>
            <span className="mt-2 block text-sm font-semibold leading-snug">{deadlineTitle(deadline)}</span>
            {open ? (
              <PlainText className="mt-1 text-xs leading-relaxed text-muted-foreground" text={deadlineSummary(deadline)} />
            ) : (
              <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{firstLine(deadlineSummary(deadline))}</span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {days !== null && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                  days >= 0 && days <= 30 ? 'bg-[hsl(var(--rules-high))]/10 text-[hsl(var(--rules-high))]' : 'bg-muted text-muted-foreground'
                )}
              >
                {days < 0 ? `Started ${fromToday(days).toLowerCase()}` : fromToday(days)}
              </span>
            )}
            <ChevronDownIcon className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </span>
        </button>
        {open && (
          <div className="space-y-3 border-t px-4 pb-4 pt-3 text-xs">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {dates
                .filter(([, value]) => !!value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
            </dl>
            {deadline.plain && (
              // The plain words leave the law's name and its details out: here they are, as the playbook writes them.
              <dl className="space-y-2" data-testid="store-deadline-original">
                <div>
                  <dt className="text-muted-foreground">The law</dt>
                  <dd className="leading-relaxed">{deadline.law}</dd>
                </div>
                {deadline.requirement && (
                  <div>
                    <dt className="text-muted-foreground">Original wording</dt>
                    <dd className="leading-relaxed">{deadline.requirement}</dd>
                  </div>
                )}
              </dl>
            )}
            {deadline.sourceNote && <p className="leading-relaxed text-muted-foreground">{deadline.sourceNote}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-8 gap-1.5" onClick={onAsk}>
                <SparklesIcon className="h-3.5 w-3.5" />
                What this means for my app
              </Button>
              {deadline.sourceUrl && (
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void openExternal(deadline.sourceUrl!)}>
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  Read the law
                </Button>
              )}
              {deadline.verifiedOn && <span className="text-muted-foreground">Checked against the source on {formatDay(deadline.verifiedOn)}</span>}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function StoreComplianceDeadlines() {
  const view = useRulesView();
  const { library, stores, today, options } = view;
  const [tab, setTab] = useState<'coming' | 'past'>('coming');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<Region | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(options.deadline ? [options.deadline] : []));
  const scrolled = useRef(false);

  const forStores = useMemo(
    () =>
      library.deadlines.filter((deadline) => {
        const store = deadlineStore(deadline);
        return !store || stores.includes(store);
      }),
    [library.deadlines, stores]
  );
  const { coming, past } = useMemo(() => deadlinesByDay(searchDeadlines(forStores, query), today), [forStores, query, today]);
  const shown = (tab === 'coming' ? coming : past).filter((deadline) => !region || regionOf(deadline.jurisdiction) === region);
  const regions = useMemo(() => REGIONS.filter((name) => forStores.some((deadline) => regionOf(deadline.jurisdiction) === name)), [forStores]);

  // A deadline asked for by the Overview: on its tab, in view.
  useEffect(() => {
    if (!options.deadline || scrolled.current) return;
    const target = library.deadlines.find((deadline) => deadline.id === options.deadline);
    if (!target) return;
    const day = deadlineDay(target);
    if (day && day < today) setTab('past');
    scrolled.current = true;
    window.requestAnimationFrame(() => document.getElementById(`deadline-${target.id}`)?.scrollIntoView({ block: 'center' }));
  }, [options.deadline, library.deadlines, today]);

  const months: Array<{ month: string; deadlines: Deadline[] }> = [];
  for (const deadline of shown) {
    const month = monthOf(deadlineDay(deadline));
    const last = months[months.length - 1];
    if (last?.month === month) last.deadlines.push(deadline);
    else months.push({ month, deadlines: [deadline] });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6" data-testid="store-compliance-deadlines">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border bg-muted/30 p-0.5" role="tablist" aria-label="Which deadlines">
          {(
            [
              ['coming', `Coming up ${coming.length}`],
              ['past', `Already started ${past.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('rounded-md px-3 py-1.5 text-xs transition-colors', tab === id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <SearchIcon aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the deadlines" aria-label="Search the deadlines" className="h-9 bg-card pl-8 text-xs" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the deadline applies">
        {regions.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={region === name}
            onClick={() => setRegion(region === name ? null : name)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              region === name ? 'border-foreground/20 bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'coming' && (
        <p className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--rules-accent))]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--rules-accent))]" />
          Today, {formatDay(today)}
        </p>
      )}
      {months.length === 0 && <p className="rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">No deadlines match</p>}
      {months.map((group) => (
        <section key={group.month} aria-label={group.month}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.month}</h2>
          <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[58px] before:top-2 before:w-px before:bg-border">
            {group.deadlines.map((deadline) => (
              <DeadlineCard
                key={deadline.id}
                deadline={deadline}
                today={today}
                open={opened.has(deadline.id)}
                onToggle={() =>
                  setOpened((current) => {
                    const next = new Set(current);
                    if (next.has(deadline.id)) next.delete(deadline.id);
                    else next.add(deadline.id);
                    return next;
                  })
                }
                onAsk={() => {
                  const day = deadlineDay(deadline);
                  view.ask(`What does "${deadlineTitle(deadline)}" [${deadline.id}] mean for my app, and what do I have to do${day ? ` by ${formatDay(day)}` : ''}?`);
                }}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
