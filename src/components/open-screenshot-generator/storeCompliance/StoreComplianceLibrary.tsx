"use client";

// Why apps get rejected: every rule of the playbook for the user's stores,
// with a search, the levels and the rules an update brought. A card opens the
// rule in the sheet with its fix.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { firstLine, ruleFix, ruleTitle } from '@/lib/storeCompliance/plain';
import { ruleForStores, searchRules } from '@/lib/storeCompliance/search';
import type { RejectionRule, Severity } from '@/lib/storeCompliance/types';
import { cn } from '@/lib/utils';
import { SEVERITY_ORDER, SEVERITY_STYLE, SEVERITY_WORDS, SeverityBadge, StoreMarks, useRulesView } from './StoreComplianceShared';

function RuleCard({ rule, isNew, onOpen }: { rule: RejectionRule; isNew: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-rule={rule.id}
      className={cn(
        'group relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-card p-4 pl-5 text-left transition-all before:absolute before:inset-y-0 before:left-0 before:w-1 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        SEVERITY_STYLE[rule.severity].edge
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={rule.severity} />
        <StoreMarks store={rule.store} />
        {isNew && <span className="rounded-full bg-[hsl(var(--rules-accent))]/10 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--rules-accent))]">New</span>}
      </span>
      <span className="text-sm font-semibold leading-snug">{ruleTitle(rule)}</span>
      {ruleFix(rule) && (
        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Fix: </span>
          {firstLine(ruleFix(rule))}
        </span>
      )}
      {rule.guideline && <span className="mt-auto truncate text-[11px] text-muted-foreground">{/^\d/.test(rule.guideline) ? `Guideline ${rule.guideline}` : rule.guideline}</span>}
    </button>
  );
}

export function StoreComplianceLibrary() {
  const view = useRulesView();
  const { library, stores, options } = view;
  const [query, setQuery] = useState(options.query ?? '');
  const [level, setLevel] = useState<Severity | null>(null);
  const [onlyNew, setOnlyNew] = useState(!!options.onlyNew);
  const [web, setWeb] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const newsState = view.state.news;
  const news = useMemo(() => new Set(newsState && !newsState.seen ? newsState.rules : []), [newsState]);

  // "/" searches, as it does in the review inbox.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const forStores = useMemo(() => library.rules.filter((rule) => ruleForStores(rule.store, stores) || (web && rule.store === 'web')), [library.rules, stores, web]);
  const found = useMemo(() => {
    let rules = searchRules(forStores, query);
    if (level) rules = rules.filter((rule) => rule.severity === level);
    if (onlyNew) rules = rules.filter((rule) => news.has(rule.id));
    return rules;
  }, [forStores, query, level, onlyNew, news]);
  const searching = query.trim().length > 0;
  const counts = useMemo(() => Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, forStores.filter((rule) => rule.severity === severity).length])) as Record<Severity, number>, [forStores]);
  const webCount = library.rules.filter((rule) => rule.store === 'web').length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6" data-testid="store-compliance-library">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search, for example: delete account, ads or 5.1.1"
            aria-label="Search the rules"
            className="h-11 rounded-xl bg-card pl-9 pr-10 text-sm"
          />
          {query && (
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setQuery('')} aria-label="Clear the search">
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter the rules">
          <FilterChip on={level === null && !onlyNew} onClick={() => { setLevel(null); setOnlyNew(false); }}>
            All {forStores.length}
          </FilterChip>
          {SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map((severity) => (
            <FilterChip key={severity} on={level === severity} onClick={() => setLevel(level === severity ? null : severity)}>
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_STYLE[severity].dot)} />
              {SEVERITY_WORDS[severity]} {counts[severity]}
            </FilterChip>
          ))}
          {news.size > 0 && (
            <FilterChip on={onlyNew} onClick={() => setOnlyNew(!onlyNew)}>
              New {news.size}
            </FilterChip>
          )}
          {webCount > 0 && (
            <FilterChip on={web} onClick={() => setWeb(!web)} title="Rules for websites and web apps, such as cookie consent">
              Websites {webCount}
            </FilterChip>
          )}
          <span className="ml-auto text-xs text-muted-foreground" role="status">
            {searching || level || onlyNew ? `${found.length} of ${forStores.length}` : ''}
          </span>
        </div>
      </div>

      {found.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
          <p className="text-sm font-medium">{searching ? `No rule matches "${query.trim()}"` : 'No rules here'}</p>
          {searching && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => view.ask(query.trim())}>
              <SparklesIcon className="h-3.5 w-3.5" />
              Ask AI instead
            </Button>
          )}
        </div>
      ) : searching || onlyNew ? (
        <div className="grid gap-3 md:grid-cols-2">
          {found.map((rule) => (
            <RuleCard key={rule.id} rule={rule} isNew={news.has(rule.id)} onOpen={() => view.openRule(rule.id)} />
          ))}
        </div>
      ) : (
        SEVERITY_ORDER.map((severity) => {
          const rules = found.filter((rule) => rule.severity === severity).sort((a, b) => ruleTitle(a).localeCompare(ruleTitle(b)));
          if (rules.length === 0) return null;
          return (
            <section key={severity} aria-label={`${SEVERITY_WORDS[severity]} rules`}>
              <h2 className={cn('mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide', SEVERITY_STYLE[severity].text)}>
                {SEVERITY_WORDS[severity]}
                <span className="font-normal text-muted-foreground">{rules.length}</span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {rules.map((rule) => (
                  <RuleCard key={rule.id} rule={rule} isNew={news.has(rule.id)} onOpen={() => view.openRule(rule.id)} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function FilterChip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
        on ? 'border-foreground/20 bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}
