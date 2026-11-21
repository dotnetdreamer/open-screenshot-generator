"use client";

// What every SEO screen shares: the view object (the site, its latest check,
// the AI, where to go next) and the small pieces the screens draw with.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { growthAiInUse, growthAiLabel, growthAiUnavailableReason, isGrowthAiAvailable, onGrowthAiChange, refreshGrowthAi } from '@/lib/growth/ai';
import type { AgentWriter } from '@/lib/ai/agentPrompt';
import { AREAS, AREA_WORDS, SEVERITY_WORDS } from '@/lib/seo/plain';
import type { KnowledgeState } from '@/lib/seo/sync';
import type { SeoState, SiteData } from '@/lib/seo/state';
import type { CheckArea, SeoSite, Severity, SiteRun, SiteScore } from '@/lib/seo/types';
import type { ArtboardState } from '@/types/artboard';

export type SeoSection = 'overview' | 'ask' | 'check' | 'ai' | 'words' | 'search' | 'visitors' | 'speed' | 'setup';

export interface SectionOptions {
  /** Site check: the finding to open. */
  finding?: string;
  /** Site check: the page to open. */
  page?: string;
  /** Ask AI: a question to put in the box. */
  question?: string;
}

export interface SeoAi {
  available: boolean;
  label: string | null;
  reason: string | null;
  inUse: AgentWriter | 'panel' | null;
}

export interface OpenProjectForSeo {
  id: string | null;
  name: string;
  artboards: ArtboardState[];
}

export interface SeoView {
  active: boolean;
  desktop: boolean;
  state: SeoState;
  site: SeoSite | null;
  data: SiteData;
  /** The latest check of the site, and the one before it. */
  run: SiteRun | null;
  previous: SiteRun | null;
  /** The score with PageSpeed's speed folded in when it has run. */
  score: SiteScore | null;
  knowledge: KnowledgeState;
  ai: SeoAi;
  section: SeoSection;
  options: SectionOptions;
  goTo: (section: SeoSection, options?: SectionOptions) => void;
  readProject: () => OpenProjectForSeo;
  /** Check the active site now: live, or the Website view's pages before they're published. */
  check: (mode?: SiteRun['mode']) => void;
  /** Open Growth's Ask AI to set up Google for SEO (desktop). */
  setUpGoogleWithAi: (() => void) | null;
}

const SeoContext = createContext<SeoView | null>(null);
export const SeoProvider = SeoContext.Provider;

export function useSeoView(): SeoView {
  const view = useContext(SeoContext);
  if (!view) throw new Error('useSeoView outside the SEO view');
  return view;
}

/** Which AI answers, read again when the view shows and when the window comes to the front, like Store compliance's. */
export function useSeoAi(active: boolean): SeoAi {
  const read = (): SeoAi => ({ available: isGrowthAiAvailable(), label: growthAiLabel(), reason: growthAiUnavailableReason(), inUse: growthAiInUse() });
  const [ai, setAi] = useState<SeoAi>({ available: false, label: null, reason: 'Looking for Claude Code and Codex', inUse: null });
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

/** Classes per severity, on Store compliance's level colours. Whole strings, so Tailwind finds them. */
export const SEVERITY_STYLE: Record<Severity, { text: string; tint: string; dot: string; ring: string }> = {
  Critical: { text: 'text-[hsl(var(--rules-critical))]', tint: 'bg-[hsl(var(--rules-critical))]/10', dot: 'bg-[hsl(var(--rules-critical))]', ring: 'ring-[hsl(var(--rules-critical))]/30' },
  High: { text: 'text-[hsl(var(--rules-high))]', tint: 'bg-[hsl(var(--rules-high))]/10', dot: 'bg-[hsl(var(--rules-high))]', ring: 'ring-[hsl(var(--rules-high))]/30' },
  Medium: { text: 'text-[hsl(var(--rules-medium))]', tint: 'bg-[hsl(var(--rules-medium))]/10', dot: 'bg-[hsl(var(--rules-medium))]', ring: 'ring-[hsl(var(--rules-medium))]/30' },
  Low: { text: 'text-[hsl(var(--rules-low))]', tint: 'bg-[hsl(var(--rules-low))]/10', dot: 'bg-[hsl(var(--rules-low))]', ring: 'ring-[hsl(var(--rules-low))]/30' },
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const style = SEVERITY_STYLE[severity];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', style.tint, style.text, className)}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {SEVERITY_WORDS[severity]}
    </span>
  );
}

/** Green from 90, amber from 50, red below: Lighthouse's bands. */
export function scoreTone(score: number | null): { text: string; stroke: string; words: string } {
  if (score === null) return { text: 'text-muted-foreground', stroke: 'hsl(var(--muted-foreground))', words: 'Not measured yet' };
  if (score >= 90) return { text: 'text-[hsl(var(--growth-good))]', stroke: 'hsl(var(--growth-good))', words: 'Good' };
  if (score >= 50) return { text: 'text-[hsl(var(--rules-medium))]', stroke: 'hsl(var(--rules-medium))', words: 'Needs work' };
  return { text: 'text-[hsl(var(--rules-critical))]', stroke: 'hsl(var(--rules-critical))', words: 'Poor' };
}

export function ScoreRing({ score, size = 112, label, className }: { score: number | null; size?: number; label: string; className?: string }) {
  const stroke = Math.max(6, Math.round(size / 13));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = scoreTone(score);
  const share = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} role="img" aria-label={score === null ? `${label}: not measured yet` : `${label}: ${score} out of 100, ${tone.words.toLowerCase()}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * share} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-semibold tabular-nums leading-none', tone.text)} style={{ fontSize: Math.round(size * 0.3) }}>
          {score ?? '?'}
        </span>
        {size >= 96 && <span className="mt-1 text-[11px] text-muted-foreground">of 100</span>}
      </div>
    </div>
  );
}

/** One bar per area, with what the area covers on hover. */
export function AreaBars({ areas, onPick, className }: { areas: Record<CheckArea, number | null>; onPick?: (area: CheckArea) => void; className?: string }) {
  return (
    <ul className={cn('grid gap-2', className)}>
      {AREAS.map((area) => {
        const score = areas[area];
        const tone = scoreTone(score);
        const words = AREA_WORDS[area];
        const body = (
          <>
            <span className="w-32 shrink-0 truncate text-left text-xs text-muted-foreground">{words.title}</span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${score ?? 0}%`, background: tone.stroke }} />
            </span>
            <span className={cn('w-9 shrink-0 text-right text-xs font-medium tabular-nums', tone.text)}>{score ?? '?'}</span>
          </>
        );
        return (
          <li key={area} title={score === null ? `${words.hint}. Not measured yet` : words.hint}>
            {onPick ? (
              <button type="button" className="flex w-full items-center gap-3 rounded-md px-1 py-0.5 hover:bg-muted/60" onClick={() => onPick(area)}>
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-1 py-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ icon: Icon, title, hint, actions }: { icon?: React.ComponentType<{ className?: string }>; title: string; hint?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start gap-2">
      {Icon && (
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--seo-accent))]/10 text-[hsl(var(--seo-accent))]">
          <Icon className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold leading-6">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tile({ label, value, children, title }: { label: string; value: React.ReactNode; children?: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm" title={title}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {children && <div className="mt-0.5 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, className }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--seo-accent))]/10 text-[hsl(var(--seo-accent))]">
        <Icon className="h-6 w-6" />
      </span>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

/** A page's address without the site's root, for lists. */
export function shortAddress(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 && value % 1 ? 1 : 0 }).format(value);
}

/** The change from before to now as a share, for Growth's Delta; null when there was nothing before. */
export function changeOf(now: number, before: number): number | null {
  if (!before) return null;
  return (now - before) / before;
}
