"use client";

// What the Store compliance screens share: the view's context (the library,
// the section, the stores the user ships to, the open project, the AI), the
// marks for a rule's level and its store, the words for dates, and the sheet
// that shows one rule over whatever screen is open, so a rule named in an AI
// answer or a check opens without leaving that screen. The screens show the
// playbook in plain words where the repository has them (plain.ts).

import React, { createContext, useContext, useRef, useState } from 'react';
import { AppleIcon, CheckIcon, ClipboardCopyIcon, ExternalLinkIcon, GlobeIcon, PlayIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { openExternal } from '@/lib/desktop';
import { repoPath } from '@/lib/storeCompliance/parse';
import { deadlineTitle, plainBlocks, ruleFix, ruleProblem, ruleTitle } from '@/lib/storeCompliance/plain';
import { filePageUrl } from '@/lib/storeCompliance/source';
import type { RulesState } from '@/lib/storeCompliance/sync';
import type { Deadline, RejectionRule, RuleStore, RulesLibrary, Severity, ShipStore } from '@/lib/storeCompliance/types';
import type { ArtboardState } from '@/types/artboard';
import { cn } from '@/lib/utils';
import type { AiChoice } from '../growth/AiPicker';

export type RulesSection = 'overview' | 'ask' | 'checklist' | 'rules' | 'deadlines' | 'guides';

export interface SectionOptions {
  /** Rejection reasons: show only the rules an update brought. */
  onlyNew?: boolean;
  /** Rejection reasons: start with this search. */
  query?: string;
  /** Deadlines: open this one. */
  deadline?: string;
  /** Guides: open this guide, at this heading. */
  guide?: string;
  anchor?: string;
  /** Ask AI: start on this form. */
  start?: 'check' | 'rejected';
}

export interface OpenProjectForRules {
  id: string | null;
  name: string;
  /** The base document, every language in it. */
  artboards: ArtboardState[];
}

export interface RulesAi {
  available: boolean;
  label: string | null;
  /** Why no AI can answer, for the disabled buttons. */
  reason: string | null;
  inUse: AiChoice | null;
}

export interface RulesView {
  active: boolean;
  library: RulesLibrary;
  state: RulesState;
  section: RulesSection;
  options: SectionOptions;
  goTo: (section: RulesSection, options?: SectionOptions) => void;
  openRule: (id: string) => void;
  openGuide: (path: string, anchor?: string) => void;
  /** The stores the user ships to, at least one. */
  stores: ShipStore[];
  setStores: (stores: ShipStore[]) => void;
  project: { id: string | null; name: string };
  readProject: () => OpenProjectForRules;
  ai: RulesAi;
  /** Today, YYYY-MM-DD, in the user's time zone. */
  today: string;
  /** Ask AI a question, from any screen. */
  ask: (question: string) => void;
}

const RulesContext = createContext<RulesView | null>(null);

export const RulesProvider = RulesContext.Provider;

export function useRulesView(): RulesView {
  const view = useContext(RulesContext);
  if (!view) throw new Error('useRulesView outside the Store compliance view');
  return view;
}

export const CHECKLIST_PATH = 'docs/PRE-SUBMISSION-CHECKLIST.md';

/** A link in a guide or the checklist: another guide opens in Guides, a heading scrolls, a web address opens the browser. */
export function useGuideLinks(from: string): (href: string) => void {
  const view = useRulesView();
  return (href: string) => {
    if (/^(https?:|mailto:)/i.test(href)) {
      void openExternal(href);
      return;
    }
    const [, anchor] = href.split('#');
    const path = href.startsWith('#') ? from : repoPath(href, from);
    if (!path) return;
    if (path === CHECKLIST_PATH) view.goTo('checklist');
    else if (/\.md$/i.test(path)) view.openGuide(path, anchor);
    else void openExternal(filePageUrl(path));
  };
}

// --- levels and stores --------------------------------------------------------------

/** A rule's level: how likely it is to get the app turned down, as the playbook rates it. */
export const SEVERITY_WORDS: Record<Severity, string> = { critical: 'Critical', high: 'High risk', medium: 'Medium risk', low: 'Low risk' };

/** A deadline's level: how much it matters to apps. */
export const PRIORITY_WORDS: Record<Severity, string> = { critical: 'Critical', high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

/** Classes per level. Whole strings, so Tailwind finds them. */
export const SEVERITY_STYLE: Record<Severity, { text: string; tint: string; dot: string; edge: string }> = {
  critical: {
    text: 'text-[hsl(var(--rules-critical))]',
    tint: 'bg-[hsl(var(--rules-critical))]/10',
    dot: 'bg-[hsl(var(--rules-critical))]',
    edge: 'before:bg-[hsl(var(--rules-critical))]',
  },
  high: {
    text: 'text-[hsl(var(--rules-high))]',
    tint: 'bg-[hsl(var(--rules-high))]/10',
    dot: 'bg-[hsl(var(--rules-high))]',
    edge: 'before:bg-[hsl(var(--rules-high))]',
  },
  medium: {
    text: 'text-[hsl(var(--rules-medium))]',
    tint: 'bg-[hsl(var(--rules-medium))]/10',
    dot: 'bg-[hsl(var(--rules-medium))]',
    edge: 'before:bg-[hsl(var(--rules-medium))]',
  },
  low: {
    text: 'text-[hsl(var(--rules-low))]',
    tint: 'bg-[hsl(var(--rules-low))]/10',
    dot: 'bg-[hsl(var(--rules-low))]',
    edge: 'before:bg-[hsl(var(--rules-low))]',
  },
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export function SeverityBadge({ severity, of = 'rule', className }: { severity: Severity; of?: 'rule' | 'deadline'; className?: string }) {
  const style = SEVERITY_STYLE[severity];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', style.tint, style.text, className)}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {(of === 'deadline' ? PRIORITY_WORDS : SEVERITY_WORDS)[severity]}
    </span>
  );
}

export const STORE_WORDS: Record<RuleStore, string> = { apple: 'App Store', google: 'Google Play', both: 'Both stores', web: 'Websites' };

export function StoreMarks({ store, className }: { store: RuleStore; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground', className)} title={STORE_WORDS[store]}>
      {(store === 'apple' || store === 'both') && <AppleIcon aria-hidden className="h-3.5 w-3.5" />}
      {(store === 'google' || store === 'both') && <PlayIcon aria-hidden className="h-3.5 w-3.5" />}
      {store === 'web' && <GlobeIcon aria-hidden className="h-3.5 w-3.5" />}
      <span>{STORE_WORDS[store]}</span>
    </span>
  );
}

// --- dates ------------------------------------------------------------------------------

/** YYYY-MM-DD in the user's time zone. */
export function localDay(at = new Date()): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

/** "2 Aug 2026", in the user's own date order. */
export function formatDay(day: string | null): string {
  if (!day) return 'No date';
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "in 12 days", "tomorrow", "3 months ago". */
export function fromToday(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const ahead = days > 0;
  const span = Math.abs(days);
  const amount = span < 45 ? `${span} days` : span < 548 ? `${Math.round(span / 30.4)} months` : `${Math.round(span / 365)} years`;
  return ahead ? `In ${amount}` : `${amount} ago`;
}

export function formatAgo(at: number | null): string {
  if (!at) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// --- small parts ----------------------------------------------------------------------

export function Gate({ reason, children }: { reason: string | null | undefined; children: React.ReactElement<{ disabled?: boolean }> }) {
  if (!reason) return children;
  return (
    <span className="inline-flex cursor-not-allowed" title={reason} data-gated-reason={reason}>
      {React.cloneElement(children, { disabled: true })}
    </span>
  );
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('h-7 gap-1.5 text-xs', className)}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch((error) => console.error('Copying failed', error));
      }}
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardCopyIcon className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

/** A rule named in an answer or a check: its level and title, opening the rule. */
export function RuleChip({ rule, onOpen }: { rule: RejectionRule; onOpen: (id: string) => void }) {
  const style = SEVERITY_STYLE[rule.severity];
  return (
    <button
      type="button"
      onClick={() => onOpen(rule.id)}
      title={`${SEVERITY_WORDS[rule.severity]}: ${ruleTitle(rule)}`}
      data-rule-chip={rule.id}
      className={cn(
        'mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-px align-baseline text-[12px] font-medium transition-colors hover:bg-muted',
        style.text
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} />
      <span className="truncate">{ruleTitle(rule)}</span>
    </button>
  );
}

export function DeadlineChip({ deadline, onOpen }: { deadline: Deadline; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(deadline.id)}
      title={deadline.law}
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-px align-baseline text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--rules-accent))]" />
      <span className="truncate">{deadlineTitle(deadline)}</span>
    </button>
  );
}

// --- one rule, over any screen ---------------------------------------------------

export function RuleSheet({ rule, isNew, onClose, onAsk }: { rule: RejectionRule | null; isNew: boolean; onClose: () => void; onAsk: (rule: RejectionRule) => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={!!rule} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 focus:outline-none sm:max-w-lg"
        data-testid="store-rule-sheet"
        ref={sheet}
        tabIndex={-1}
        // Focus the sheet, not its first button, so no button looks pressed as it opens.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          sheet.current?.focus();
        }}
      >
        {rule && (
          <>
            <SheetHeader className={cn('relative space-y-2 border-b p-5 pr-12 text-left before:absolute before:inset-y-0 before:left-0 before:w-1', SEVERITY_STYLE[rule.severity].edge)}>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={rule.severity} />
                <StoreMarks store={rule.store} />
                {isNew && <span className="rounded-full bg-[hsl(var(--rules-accent))]/10 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--rules-accent))]">New</span>}
              </div>
              <SheetTitle className="text-lg leading-snug">{ruleTitle(rule)}</SheetTitle>
              <SheetDescription className="text-xs">
                {rule.guideline ? `${/^\d/.test(rule.guideline) ? 'Guideline ' : ''}${rule.guideline}` : 'Store rule'}
                {rule.added ? ` · Added ${formatDay(rule.added)}` : ''}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-5 p-5 text-sm">
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The problem</h3>
                <PlainText className="leading-relaxed" text={ruleProblem(rule) || 'The playbook gives no detail for this rule.'} />
              </section>
              <section className="rounded-xl border border-[hsl(var(--rules-accent))]/25 bg-[hsl(var(--rules-accent))]/5 p-4">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--rules-accent))]">
                  <CheckIcon className="h-3.5 w-3.5" />
                  How to fix it
                </h3>
                <PlainText className="leading-relaxed" text={ruleFix(rule) || 'The playbook gives no fix for this rule yet.'} />
              </section>
              {(rule.plain || rule.signals.length > 0 || rule.counterSignals.length > 0 || rule.recipe) && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">For your developer</h3>
                  {rule.plain && (
                    // The plain words leave out what a developer needs: the playbook's own are exact.
                    <div className="mb-3 space-y-1 rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground" data-testid="store-rule-original">
                      <p className="font-medium text-foreground">Original wording: {rule.title}</p>
                      {rule.detection && <p>{rule.detection}</p>}
                      {rule.fix && <p>Fix: {rule.fix}</p>}
                    </div>
                  )}
                  {rule.signals.length > 0 && (
                    <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                      Look for these in the code:{' '}
                      {rule.signals.map((word) => (
                        <code key={word} className="mx-0.5 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                          {word}
                        </code>
                      ))}
                    </p>
                  )}
                  {rule.counterSignals.length > 0 && (
                    <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                      These show it&apos;s fixed:{' '}
                      {rule.counterSignals.map((word) => (
                        <code key={word} className="mx-0.5 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                          {word}
                        </code>
                      ))}
                    </p>
                  )}
                  {rule.recipe && (
                    <div className="mt-2">
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/60 p-3 font-mono text-[11px] leading-relaxed text-foreground">{rule.recipe}</pre>
                      <CopyButton text={rule.recipe} label="Copy the search command" className="mt-2" />
                    </div>
                  )}
                </section>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t p-4">
              <Button size="sm" className="gap-1.5" onClick={() => onAsk(rule)}>
                <SparklesIcon className="h-3.5 w-3.5" />
                Ask AI about this rule
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void openExternal(filePageUrl('data/rejection-patterns.json'))}>
                <ExternalLinkIcon className="h-3.5 w-3.5" />
                Open on GitHub
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Plain words as they are written: short lines, and "- " lines as a list. */
export function PlainText({ text, className, listClassName }: { text: string; className?: string; listClassName?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      {plainBlocks(text).map((block, index) =>
        block.kind === 'line' ? (
          <p key={index}>{block.text}</p>
        ) : (
          <ul key={index} className={cn('list-disc space-y-0.5 pl-5 marker:text-muted-foreground', listClassName)}>
            {block.items.map((item, at) => (
              <li key={at}>{item}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/** The page's empty state: an icon, a line, and a way on. */
export function EmptyState({ icon: Icon, title, children, className }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--rules-accent))]/10 text-[hsl(var(--rules-accent))]">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}
