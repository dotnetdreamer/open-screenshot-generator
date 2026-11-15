"use client";

// Every insight card, filterable by category, each with the action that
// deals with it: open the reviews it is about, fix the listing, translate the
// screenshots, upload a new set, or ask the AI what to do.

import React, { useMemo, useState } from 'react';
import { EyeIcon, LanguagesIcon, LightbulbIcon, SparklesIcon, UploadCloudIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDay } from '@/lib/growth/dates';
import { INSIGHT_CATEGORY_LABELS, type Insight, type InsightCategory } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { Delta, EmptyState, Gated, Panel, ToneIcon, useGrowthView } from './GrowthShared';

type Filter = 'all' | 'attention' | InsightCategory;

export function GrowthInsights() {
  const view = useGrowthView();
  const [filter, setFilter] = useState<Filter>('all');
  const categories = useMemo(() => {
    const counts = new Map<InsightCategory, number>();
    for (const insight of view.insights) counts.set(insight.category, (counts.get(insight.category) ?? 0) + 1);
    return Array.from(counts.entries());
  }, [view.insights]);
  const attention = view.insights.filter((insight) => insight.tone === 'problem' || insight.tone === 'warning').length;
  const shown = view.insights.filter((insight) => {
    if (filter === 'all') return true;
    if (filter === 'attention') return insight.tone === 'problem' || insight.tone === 'warning';
    return insight.category === filter;
  });

  const chip = (id: Filter, label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        filter === id ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'
      )}
      aria-pressed={filter === id}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {chip('all', 'All', view.insights.length)}
        {chip('attention', 'Needs attention', attention)}
        {categories.map(([category, count]) => chip(category, INSIGHT_CATEGORY_LABELS[category], count))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={LightbulbIcon} title="No insights to show">
          Insights come from your numbers, reviews and store page. New insights show up after you refresh.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {shown.map((insight) => (
            <li key={insight.id}>
              <InsightCard insight={insight} />
            </li>
          ))}
        </ul>
      )}

      {view.dismissedInsights.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {view.dismissedInsights.length} insight{view.dismissedInsights.length === 1 ? '' : 's'} hidden.{' '}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={view.restoreInsights}>
            Show hidden insights
          </button>
        </p>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const view = useGrowthView();
  return (
    <Panel className="flex gap-3" data-insight-kind={insight.kind}>
      <ToneIcon tone={insight.tone} className="mt-0.5 h-5 w-5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {INSIGHT_CATEGORY_LABELS[insight.category]} · {formatDay(insight.date)}
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug">{insight.title}</p>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {insight.metric && (
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums">{insight.metric.value}</p>
                {insight.metric.delta !== undefined && <Delta change={insight.metric.delta} />}
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => view.dismissInsight(insight.id)}
              title="Hide this insight"
              aria-label="Hide this insight"
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{insight.body}</p>
        <InsightActions insight={insight} />
      </div>
    </Panel>
  );
}

/** The buttons under an insight. `compact` drops everything but the main one, for the overview. */
export function InsightActions({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  const view = useGrowthView();
  const action = insight.action;
  const buttons: React.ReactNode[] = [];
  const size = compact ? 'h-7 px-2 text-xs' : 'h-8 text-xs';
  // Asking takes an AI that writes, or the coding agent.
  const askReason = view.aiAvailable || view.onAskAgent ? null : view.blocked.ai;

  if (action) {
    switch (action.kind) {
      case 'reviews':
        buttons.push(
          <Button key="main" variant="outline" size="sm" className={size} onClick={() => view.goTo('reviews', { reviewRating: action.rating, reviewUnanswered: action.unanswered, reviewTopic: action.topic })}>
            <EyeIcon className="mr-1.5 h-3.5 w-3.5" />
            Read the reviews
          </Button>
        );
        break;
      case 'listing':
        buttons.push(
          <Button key="main" variant="outline" size="sm" className={size} onClick={() => view.goTo('listing', { locale: action.locale })}>
            Open the store page
          </Button>
        );
        break;
      case 'markets':
        buttons.push(
          <Button key="main" variant="outline" size="sm" className={size} onClick={() => view.goTo('markets', { territory: action.territory })}>
            See the countries
          </Button>
        );
        break;
      case 'timeline':
        buttons.push(
          <Button key="main" variant="outline" size="sm" className={size} onClick={() => view.goTo('timeline', { eventId: action.eventId })}>
            Open the timeline
          </Button>
        );
        break;
      case 'localize':
        buttons.push(
          <Button key="main" size="sm" className={size} onClick={() => view.onLocalize(action.locales)}>
            <LanguagesIcon className="mr-1.5 h-3.5 w-3.5" />
            Translate the screenshots
          </Button>
        );
        if (!compact) {
          buttons.push(
            <Button key="listing" variant="outline" size="sm" className={size} onClick={() => view.goTo('listing')}>
              Store page languages
            </Button>
          );
        }
        break;
      case 'publish':
        buttons.push(
          <Button key="main" variant="outline" size="sm" className={size} onClick={view.onPublish}>
            <UploadCloudIcon className="mr-1.5 h-3.5 w-3.5" />
            Upload screenshots
          </Button>
        );
        break;
      case 'ask':
        buttons.push(
          <Gated key="main" reason={askReason}>
            <Button variant="outline" size="sm" className={size} onClick={() => view.goTo('ask', { question: action.question })}>
              <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
              Ask why
            </Button>
          </Gated>
        );
        break;
    }
  }
  if (!compact && action?.kind !== 'ask') {
    buttons.push(
      <Gated key="ask" reason={askReason}>
        <Button
          variant="ghost"
          size="sm"
          className={size}
          onClick={() => view.goTo('ask', { question: `${insight.title}. Why, and what should I do next?` })}
        >
          <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
          Ask AI
        </Button>
      </Gated>
    );
  }
  if (buttons.length === 0) return null;
  return <div className={cn('flex flex-wrap gap-2', compact ? 'mt-1.5' : 'mt-3')}>{compact ? buttons.slice(0, 1) : buttons}</div>;
}
