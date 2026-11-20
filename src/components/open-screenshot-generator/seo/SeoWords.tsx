"use client";

// How the site's words read: filler, phrases common in AI-written copy,
// repetition and how many facts there are, page by page, and titles and
// descriptions that look made in bulk. claude-seo's copy check, which never
// claims an AI wrote anything; it points at what a reader would notice.

import React from 'react';
import { SparklesIcon, TypeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ContentQuality } from '@/lib/seo/checks';
import type { PageReport } from '@/lib/seo/types';
import { InfoTip } from '../capture/InfoTip';
import { Card, CardTitle, EmptyState, useSeoView } from './SeoShared';

interface Meter {
  label: string;
  value: number;
  /** Where the copy check raises its flag. */
  flagAt: number;
  higherIsBetter: boolean;
  hint: string;
}

function meters(copy: ContentQuality): Meter[] {
  return [
    { label: 'Filler', value: copy.filler_score, flagAt: 50, higherIsBetter: false, hint: 'Phrases like "at the end of the day" that take space and say nothing' },
    { label: 'AI phrasing', value: copy.ai_pattern_score, flagAt: 40, higherIsBetter: false, hint: 'Phrases common in AI-written copy, like "unlock the full potential"' },
    { label: 'Repetition', value: copy.repetition_score, flagAt: 30, higherIsBetter: false, hint: 'Pairs of words that come up again and again' },
    { label: 'Facts', value: Math.round(copy.information_density * 100), flagAt: 20, higherIsBetter: true, hint: 'Numbers and names for every hundred words: prices, devices, places' },
  ];
}

function MeterBar({ meter }: { meter: Meter }) {
  const bad = meter.higherIsBetter ? meter.value < meter.flagAt : meter.value >= meter.flagAt;
  return (
    <div title={meter.hint}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{meter.label}</span>
        <span className={cn('font-medium tabular-nums', bad ? 'text-[hsl(var(--rules-medium))]' : 'text-[hsl(var(--growth-good))]')}>{meter.value}</span>
      </div>
      <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('absolute inset-y-0 left-0 rounded-full', bad ? 'bg-[hsl(var(--rules-medium))]' : 'bg-[hsl(var(--growth-good))]')} style={{ width: `${Math.max(3, Math.min(100, meter.value))}%` }} />
        <div className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${meter.flagAt}%` }} aria-hidden />
      </div>
    </div>
  );
}

export function SeoWords() {
  const view = useSeoView();
  const run = view.run;
  if (!run) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState icon={TypeIcon} title="Check your site first">
          <p className="max-w-sm text-sm text-muted-foreground">The check reads the words on each page and points out filler and copy that reads machine-made.</p>
          {view.site && (
            <Button className="mt-1" onClick={() => view.check()}>
              Check now
            </Button>
          )}
        </EmptyState>
      </div>
    );
  }
  const judged = run.pages.filter((page): page is PageReport & { copy: ContentQuality } => Boolean(page.copy));
  const tooShort = run.pages.filter((page) => page.checks && !page.copy);
  const flagged = judged.filter((page) => !page.copy.coverage && page.copy.flags.some((flag) => flag === 'filler' || flag === 'ai-patterns'));
  const templated = run.metadata.pages.filter((page) => page.templated);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Words</h2>
          <p className="text-xs text-muted-foreground">
            {flagged.length
              ? `${flagged.length} ${flagged.length === 1 ? 'page reads' : 'pages read'} machine-made in places. Google rates copy made in bulk as low quality.`
              : 'No page reads machine-made. Google rewards words with real details about your app.'}
          </p>
        </div>
        <InfoTip label="About the copy check">
          The check counts phrases common in filler and in AI-written copy, words that repeat, and facts such as numbers and names. It never says an AI wrote a page: good AI copy passes, and a person can write filler. The phrase lists are English, so other languages get the repetition score only.
        </InfoTip>
      </div>

      {templated.length > 0 && (
        <Card className="border-[hsl(var(--rules-medium))]/30">
          <CardTitle title="Titles and descriptions that look made in bulk" hint="These descriptions repeat their page's title and end with a stock sales line. Write each one by hand, or ask AI for new words on the Site check screen." />
          <ul className="space-y-1.5">
            {templated.slice(0, 8).map((page) => (
              <li key={page.url ?? page.title} className="text-sm">
                <span className="font-medium">{page.title}</span>
                <span className="block text-xs text-muted-foreground">{page.description}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {judged.map((page) => (
          <Card key={page.finalUrl} className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{page.label}</p>
                <p className="text-xs text-muted-foreground">{page.copy.tokens} words</p>
              </div>
              {page.copy.coverage && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title="The phrase lists are English">Not English</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(page.copy.coverage ? meters(page.copy).filter((meter) => meter.label === 'Repetition') : meters(page.copy)).map((meter) => (
                <MeterBar key={meter.label} meter={meter} />
              ))}
            </div>
            {!page.copy.coverage && [...page.copy.matches.filler, ...page.copy.matches.ai_patterns].length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[...page.copy.matches.filler, ...page.copy.matches.ai_patterns].slice(0, 10).map((phrase) => (
                  <span key={phrase} className="rounded-full bg-[hsl(var(--rules-medium))]/10 px-2 py-0.5 text-[11px] text-[hsl(var(--rules-medium))]">
                    &quot;{phrase}&quot;
                  </span>
                ))}
              </div>
            )}
            {page.copy.flags.some((flag) => flag === 'filler' || flag === 'ai-patterns') && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => view.goTo('ask', { question: `Rewrite the machine-made parts of ${page.label} in plain words, with real details. These phrases came up: ${[...page.copy.matches.filler, ...page.copy.matches.ai_patterns].slice(0, 6).join(', ')}.` })}>
                <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
                Ask AI to rewrite it
              </Button>
            )}
          </Card>
        ))}
      </div>

      {tooShort.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {tooShort.length} {tooShort.length === 1 ? 'page has' : 'pages have'} too few words to judge: {tooShort.slice(0, 6).map((page) => page.label).join(', ')}
          {tooShort.length > 6 ? ' and more' : ''}.
        </p>
      )}
    </div>
  );
}
