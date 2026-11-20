"use client";

// Everything the check found, by problem or by page. Each problem says why
// it matters and what to do in plain words; the check's own message and what
// it saw on the page are one click away ("Details"). Title and description
// problems can ask the AI for new words, and with Search Console connected a
// page can ask Google whether it's in the index.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ExternalLinkIcon, Loader2Icon, SearchIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { PAGE_CHECKS, SEVERITY_ORDER, type Severity } from '@/lib/seo/checks';
import { AREA_WORDS, isPageCheckId, plainFinding, SEVERITY_WORDS } from '@/lib/seo/plain';
import { suggestPageWords, type PageWords } from '@/lib/seo/ai';
import { MOVED_REASON, inspectPage, movedFrom } from '@/lib/seo/state';
import { useSeoGoogle } from '@/lib/seo/googleSettings';
import { getKnowledgeState } from '@/lib/seo/sync';
import type { Inspection } from '@/lib/seo/google';
import type { PageReport, SiteFinding } from '@/lib/seo/types';
import { Gated } from '../growth/GrowthShared';
import { CopyButton } from '../storeCompliance/StoreComplianceShared';
import { Card, EmptyState, SEVERITY_STYLE, SeverityBadge, shortAddress, useSeoView } from './SeoShared';
import { GoogleProblemNote } from './SeoGoogle';

const WORD_FINDINGS = new Set(['missing-title', 'title-too-long', 'title-too-short', 'missing-meta-description', 'meta-description-too-long', 'title-not-reflected-in-content', 'description-not-reflected-in-content', 'duplicate-title', 'duplicate-description', 'templated-metadata']);

export function SeoSiteCheck() {
  const view = useSeoView();
  const run = view.run;
  const [mode, setMode] = useState<'problems' | 'pages'>(view.options.page ? 'pages' : 'problems');
  const [level, setLevel] = useState<Severity | 'all'>('all');
  if (!run) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState icon={SearchIcon} title="Nothing checked yet">
          <p className="max-w-sm text-sm text-muted-foreground">Check your site to see what keeps it from showing up on Google and how to fix it.</p>
          {view.site && (
            <Button className="mt-1" onClick={() => view.check()}>
              {view.site.url ? 'Check now' : 'Check before publishing'}
            </Button>
          )}
        </EmptyState>
      </div>
    );
  }
  const counts = Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, run.findings.filter((finding) => finding.severity === severity).length])) as Record<Severity, number>;
  const shown = level === 'all' ? run.findings : run.findings.filter((finding) => finding.severity === level);
  const pagesRead = run.pages.filter((page) => page.checks).length;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Site check</h2>
          <p className="text-xs text-muted-foreground">
            {run.findings.length} things found on {pagesRead} {pagesRead === 1 ? 'page' : 'pages'} of {view.site?.name}
            {run.mode === 'draft' ? ', before publishing' : ''}
          </p>
        </div>
        <div role="group" aria-label="Show" className="flex rounded-lg border bg-muted/30 p-0.5">
          {(['problems', 'pages'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={mode === choice}
              onClick={() => setMode(choice)}
              className={cn('rounded-md px-3 py-1 text-xs transition-colors', mode === choice ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {choice === 'problems' ? 'By problem' : 'By page'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'problems' ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="How urgent">
            <FilterChip on={level === 'all'} onClick={() => setLevel('all')} label={`All (${run.findings.length})`} />
            {SEVERITY_ORDER.map((severity) => (
              <FilterChip key={severity} on={level === severity} onClick={() => setLevel(severity)} label={`${SEVERITY_WORDS[severity]} (${counts[severity]})`} dot={SEVERITY_STYLE[severity].dot} disabled={!counts[severity]} />
            ))}
          </div>
          {shown.length ? (
            <ul className="flex flex-col gap-2" data-testid="seo-findings">
              {shown.map((finding) => (
                <FindingCard key={finding.id} finding={finding} open={view.options.finding === finding.id} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing at this level. Pick another one above.</p>
          )}
        </>
      ) : (
        <PageList pages={run.pages} findings={run.findings} openUrl={view.options.page} />
      )}
    </div>
  );
}

function FilterChip({ on, onClick, label, dot, disabled }: { on: boolean; onClick: () => void; label: string; dot?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40',
        on ? 'border-[hsl(var(--seo-accent))]/40 bg-[hsl(var(--seo-accent))]/10 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dot)} />}
      {label}
    </button>
  );
}

function FindingCard({ finding, open: startOpen }: { finding: SiteFinding; open: boolean }) {
  const view = useSeoView();
  const [open, setOpen] = useState(startOpen);
  const [details, setDetails] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (startOpen) ref.current?.scrollIntoView({ block: 'center' });
  }, [startOpen]);
  const plain = plainFinding(finding.id);
  const pages = finding.pages.filter((page) => page.url);
  const run = view.run!;
  const original = isPageCheckId(finding.id) ? PAGE_CHECKS[finding.id][1] : null;
  return (
    <li ref={ref} className={cn('rounded-xl border bg-card shadow-sm transition-shadow', open && 'shadow-md')} data-finding={finding.id}>
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <SeverityBadge severity={finding.severity} className="w-[104px] justify-center" />
        <span className="min-w-0 flex-1 text-sm font-medium">{plain.title}</span>
        <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">{AREA_WORDS[finding.area].title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{pages.length > 1 ? `${pages.length} pages` : pages.length === 1 ? '1 page' : 'Whole site'}</span>
        <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-4 pb-4 pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Why it matters</p>
              <p className="mt-1 text-sm">{plain.why}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">What to do</p>
              <p className="mt-1 text-sm">{plain.fix}</p>
            </div>
          </div>
          {pages.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Where</p>
              <ul className="mt-1 divide-y rounded-lg border">
                {pages.slice(0, 12).map((page, index) => (
                  <li key={`${page.url}:${index}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{page.label || shortAddress(page.url)}</span>
                      {details && <span className="block truncate font-mono text-[11px] text-muted-foreground">{page.evidence}</span>}
                    </span>
                    {run.mode === 'live' && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={`Open ${shortAddress(page.url)}`} aria-label={`Open ${page.label || page.url}`} onClick={() => void openExternal(page.url)}>
                        <ExternalLinkIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {pages.length > 12 && <p className="mt-1 text-xs text-muted-foreground">And {pages.length - 12} more</p>}
            </div>
          )}
          {details && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              {original && <p className="mb-1">{original}</p>}
              {!pages.length && finding.pages[0]?.evidence && <p className="font-mono">{finding.pages[0].evidence}</p>}
              <p className="mt-1">Check id: {finding.id}</p>
            </div>
          )}
          {WORD_FINDINGS.has(finding.id) && pages[0] && <NewWords pageUrl={pages[0].url} />}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => view.goTo('ask', { question: `How do I fix "${plain.title}" on my site? It's on ${pages.length || 1} ${pages.length === 1 ? 'page' : 'pages'}.` })}>
              <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
              Ask AI about this
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setDetails((value) => !value)} aria-pressed={details}>
              {details ? 'Hide details' : 'Details'}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** A new title and description from the AI, for one page. */
function NewWords({ pageUrl }: { pageUrl: string }) {
  const view = useSeoView();
  const page = view.run?.pages.find((entry) => entry.finalUrl === pageUrl) ?? null;
  const [words, setWords] = useState<PageWords | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!page) return null;
  const write = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setWords(await suggestPageWords({ page, siteName: view.site?.name ?? '', knowledge: getKnowledgeState() }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The AI did not answer. Try again');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-[hsl(var(--seo-accent))]/25 bg-[hsl(var(--seo-accent))]/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm">
          {words ? `New words for ${page.label}` : `Want new words for ${page.label}? AI writes a title and a description from the page.`}
        </p>
        <Gated reason={view.ai.available ? null : view.ai.reason}>
          <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void write()}>
            {busy ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />}
            {busy ? 'Writing' : words ? 'Write again' : 'Write new words'}
          </Button>
        </Gated>
      </div>
      {problem && (
        <p className="mt-2 text-sm text-[hsl(var(--rules-critical))]" role="alert">
          {problem}
        </p>
      )}
      {words && (
        <div className="mt-3 space-y-2">
          {(['title', 'description'] as const).map((part) => {
            const text = words[part];
            const length = Array.from(text).length;
            const [min, max] = part === 'title' ? [30, 60] : [120, 160];
            return (
              <div key={part} className="rounded-md border bg-background p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{part === 'title' ? 'Title' : 'Description'}</p>
                  <span className={cn('text-[11px] tabular-nums', length >= min && length <= max ? 'text-[hsl(var(--growth-good))]' : 'text-[hsl(var(--rules-medium))]')}>
                    {length} characters
                  </span>
                  <CopyButton text={text} label="Copy" className="ml-auto" />
                </div>
                <p className="text-sm">{text}</p>
              </div>
            );
          })}
          {view.site?.source === 'website' && (
            <p className="text-xs text-muted-foreground">Paste them into the Website view: the title comes from Your app, the description from Home page.</p>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_WORDS = (page: PageReport): { text: string; tone: string } => {
  if (page.status === null) return { text: "Couldn't open", tone: 'text-[hsl(var(--rules-critical))]' };
  if (page.status >= 400) return { text: `Error ${page.status}`, tone: 'text-[hsl(var(--rules-critical))]' };
  if (page.redirects.length) return { text: 'Redirects', tone: 'text-[hsl(var(--rules-medium))]' };
  return { text: 'Opens', tone: 'text-[hsl(var(--growth-good))]' };
};

function PageList({ pages, findings, openUrl }: { pages: PageReport[]; findings: SiteFinding[]; openUrl?: string }) {
  const [open, setOpen] = useState<string | null>(openUrl ?? null);
  const byPage = useMemo(() => {
    const map = new Map<string, SiteFinding[]>();
    for (const finding of findings) {
      for (const page of finding.pages) {
        if (!page.url) continue;
        map.set(page.url, [...(map.get(page.url) ?? []), finding]);
      }
    }
    return map;
  }, [findings]);
  return (
    <Card className="p-0">
      <ul className="divide-y" data-testid="seo-pages">
        {pages.map((page) => {
          const list = byPage.get(page.finalUrl) ?? [];
          const status = STATUS_WORDS(page);
          const isOpen = open === page.finalUrl;
          return (
            <li key={page.finalUrl}>
              <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : page.finalUrl)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{page.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{page.checks?.facts.title || page.problem || shortAddress(page.finalUrl)}</span>
                </span>
                <span className={cn('shrink-0 text-xs', status.tone)}>{status.text}</span>
                <span className="flex w-16 shrink-0 justify-end gap-1" aria-label={`${list.length} problems`}>
                  {SEVERITY_ORDER.map((severity) => {
                    const n = list.filter((finding) => finding.severity === severity).length;
                    return n ? (
                      <span key={severity} className={cn('rounded-full px-1.5 text-[11px] font-medium tabular-nums', SEVERITY_STYLE[severity].tint, SEVERITY_STYLE[severity].text)} title={`${n} ${SEVERITY_WORDS[severity].toLowerCase()}`}>
                        {n}
                      </span>
                    ) : null;
                  })}
                </span>
                <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && <PageDetail page={page} findings={list} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function PageDetail({ page, findings }: { page: PageReport; findings: SiteFinding[] }) {
  const view = useSeoView();
  const facts = page.checks?.facts;
  return (
    <div className="space-y-3 bg-muted/20 px-4 pb-4 pt-2">
      {page.problem && <p className="text-sm text-[hsl(var(--rules-critical))]">{page.problem}</p>}
      {facts && (
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label={`Title (${facts.title_length} characters)`}>{facts.title || 'None'}</Fact>
          <Fact label={`Description (${facts.meta_description_length} characters)`}>{facts.meta_description || 'None'}</Fact>
          <Fact label="Main heading">{facts.h1.join(' / ') || 'None'}</Fact>
          <Fact label="Language">{facts.lang ?? 'Not set'}</Fact>
          <Fact label="Words on the page">{facts.word_count ?? 'Not counted for this language'}</Fact>
          <Fact label="Pictures">
            {facts.images.total} in all{facts.images.missing_alt ? `, ${facts.images.missing_alt} with no description` : ''}
          </Fact>
          {page.redirects.length > 0 && <Fact label="Redirects">{page.redirects.map(shortAddress).join(' to ')}</Fact>}
          <Fact label="Google may read it">{page.googleAllowed ? 'Yes' : 'No, robots.txt keeps Google out'}</Fact>
        </dl>
      )}
      {findings.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {findings.map((finding) => (
            <li key={finding.id}>
              <button type="button" className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs hover:border-[hsl(var(--seo-accent))]/40" onClick={() => view.goTo('check', { finding: finding.id })}>
                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_STYLE[finding.severity].dot)} />
                {plainFinding(finding.id).title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {view.run?.mode === 'live' && (
          <Button variant="outline" size="sm" className="h-8" onClick={() => void openExternal(page.finalUrl)}>
            <ExternalLinkIcon className="mr-1.5 h-3.5 w-3.5" />
            Open the page
          </Button>
        )}
        {view.run?.mode === 'live' && <OnGoogle url={page.finalUrl} />}
      </div>
    </div>
  );
}

const COVERAGE_WORDS: Array<[RegExp, string]> = [
  [/submitted and indexed|indexed, not submitted/i, 'On Google'],
  [/crawled.*not indexed/i, 'Google read the page but left it out for now'],
  [/discovered.*not indexed/i, "Google knows the page but hasn't read it yet"],
  [/unknown to google/i, "Google doesn't know this page yet"],
  [/noindex/i, 'Left out because of a noindex tag'],
  [/blocked by robots/i, 'robots.txt keeps Google out'],
  [/redirect/i, 'The address redirects somewhere else'],
  [/not found|404/i, 'Google got a not found error'],
  [/duplicate/i, 'Google treats it as a copy of another page'],
  [/alternate page with proper canonical/i, "Google shows the page's main version instead, which is fine"],
];

export function coverageWords(inspection: Inspection): string {
  return COVERAGE_WORDS.find(([pattern]) => pattern.test(inspection.coverageState))?.[1] ?? (inspection.verdict === 'PASS' ? 'On Google' : inspection.coverageState || 'Google gave no answer');
}

/** Ask Search Console whether a page is in Google, when Search Console is connected. */
function OnGoogle({ url }: { url: string }) {
  const view = useSeoView();
  const google = useSeoGoogle();
  const site = view.site!;
  const property = google.sites[site.id]?.searchConsole;
  const inspection = view.data.inspections[url];
  const busy = view.state.busy.inspect === site.id;
  const failed = view.state.errors.inspect;
  const problem = failed && failed.siteId === site.id && failed.url === url ? failed : null;
  const reason = !view.desktop
    ? 'Needs the desktop app'
    : !google.active
      ? 'Add a Google key under Setup first'
      : !property
        ? 'Pick the Search Console property under Setup first'
        : movedFrom(site, view.run)
          ? MOVED_REASON
          : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Gated reason={reason}>
        <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void inspectPage(site.id, url)}>
          {busy ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SearchIcon className="mr-1.5 h-3.5 w-3.5" />}
          Is it on Google?
        </Button>
      </Gated>
      {inspection && (
        <span className={cn('text-xs', inspection.verdict === 'PASS' ? 'text-[hsl(var(--growth-good))]' : 'text-[hsl(var(--rules-medium))]')} title={`Google says: ${inspection.coverageState}`}>
          {coverageWords(inspection)}
          {inspection.lastCrawlTime ? `, last read ${new Date(inspection.lastCrawlTime).toLocaleDateString()}` : ''}
        </span>
      )}
      {problem && (
        <div className="basis-full" role="alert">
          <GoogleProblemNote problem={problem} />
        </div>
      )}
    </div>
  );
}
