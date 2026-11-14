"use client";

// Small pieces every Growth screen uses: the delta chip, the stat tile, the
// tone icon, the empty state, and the context that hands each screen the
// app, its data, the competitors it follows and the ways back to the editor.

import React, { createContext, useContext } from 'react';
import {
  AlertTriangleIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  InfoIcon,
  MinusIcon,
  OctagonAlertIcon,
  StarIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DayWindow } from '@/lib/growth/dates';
import type { GrowthData } from '@/lib/growth/useGrowthData';
import type { DayRecord, DayString, GrowthApp, Insight, InsightTone, ListingIssue } from '@/lib/growth/types';
import type { GrowthStore, StoreWords } from '@/lib/growth/stores';
import type { AppStoreCredentials, PlayCredentials } from '@/lib/publish/types';
import type { RivalsData } from '@/lib/growth/useRivals';
import type { ArtboardState } from '@/types/artboard';
import { formatChange } from '@/lib/growth/impact';
import { useStoreImage } from '@/lib/growth/storeImages';

export type GrowthTab =
  | 'overview'
  | 'insights'
  | 'reviews'
  | 'listing'
  | 'competitors'
  | 'markets'
  | 'timeline'
  | 'reports'
  | 'ask'
  | 'connect';

export interface GrowthTabOptions {
  /** Reviews: open with this filter. */
  reviewRating?: number;
  reviewUnanswered?: boolean;
  reviewTopic?: string;
  /** Listing: open on this language. */
  locale?: string;
  /** Markets: highlight this storefront. */
  territory?: string;
  /** Timeline: scroll to this event. */
  eventId?: string;
  /** Ask: start with this question. */
  question?: string;
  /** Competitors: open on this change, with its before and after showing. */
  rivalChange?: string;
}

/** The project open in the editor, as Competitors shows it beside the apps followed. */
export interface OpenProject {
  name: string;
  /** In the language on screen. */
  artboards: ArtboardState[];
  /** The language on screen, null for the base language. */
  language: string | null;
}

export interface GrowthView {
  app: GrowthApp;
  /** True while Growth is the view on screen. */
  active: boolean;
  /** The store the app is in, and the words for it ("App Store", "Apple"; "Google Play", "Google"). */
  store: GrowthStore;
  words: StoreWords;
  data: GrowthData;
  byDate: Map<DayString, DayRecord>;
  /** The selected range, ending where every feed has reported. */
  window: DayWindow;
  rangeDays: number;
  latest: DayString | null;
  insights: Insight[];
  dismissedInsights: Insight[];
  listingIssues: ListingIssue[];
  credentials?: AppStoreCredentials;
  /** The Google Play service account key, for an app on Google Play. */
  playCredentials?: PlayCredentials;
  /** Writes reach the store: desktop, the store's key and an app of the account. */
  canWrite: boolean;
  /**
   * Why each kind of action cannot run now, null when it can. The buttons
   * stay on screen, disabled, with this as the reason (`Gated`).
   */
  blocked: {
    /** Anything that needs an app of the account: a sync, a reply, an apply, an event. */
    app: string | null;
    /** Anything the AI writes. */
    ai: string | null;
  };
  aiAvailable: boolean;
  aiLabel: string | null;
  tabOptions: GrowthTabOptions;
  goTo: (tab: GrowthTab, options?: GrowthTabOptions) => void;
  dismissInsight: (id: string) => void;
  restoreInsights: () => void;
  onPublish: () => void;
  onLocalize: (storeLocales: string[]) => void;
  onAskAgent?: (question: string) => void;
  /** Why the agent cannot take a question here, when onAskAgent is unset. */
  agentUnavailable?: string;
  onOpenProject?: (projectId: string) => void;
  /**
   * Competitors: the apps followed for this app, or for no app (an empty
   * owner) in the web build and on a desktop with no store key.
   */
  rivalOwner: string;
  rivals: RivalsData & { reload: () => void };
  /**
   * The project open in the editor, read when asked so an edit does not
   * redraw Growth: its artboards in the language on screen, which is null for
   * the base language.
   */
  openProject?: () => OpenProject | null;
}

const GrowthContext = createContext<GrowthView | null>(null);

export const GrowthProvider = GrowthContext.Provider;

export function useGrowthView(): GrowthView {
  const view = useContext(GrowthContext);
  if (!view) throw new Error('useGrowthView needs the Growth view around it');
  return view;
}

/** "+12%" in green, "-8%" in red, with an arrow, or a dash when there is nothing to compare. */
export function Delta({
  change,
  higherIsBetter = true,
  className,
  title,
}: {
  change: number | null | undefined;
  higherIsBetter?: boolean;
  className?: string;
  title?: string;
}) {
  if (change === null || change === undefined || !Number.isFinite(change)) {
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-xs text-muted-foreground', className)} title={title}>
        <MinusIcon className="h-3 w-3" />
      </span>
    );
  }
  const flat = Math.abs(change) < 0.005;
  const good = flat ? null : (change > 0) === higherIsBetter;
  const Icon = flat ? MinusIcon : change > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
        good === null && 'text-muted-foreground',
        good === true && 'text-[hsl(var(--growth-good))]',
        good === false && 'text-[hsl(var(--growth-bad))]',
        className
      )}
      title={title}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {formatChange(change)}
    </span>
  );
}

const TONE_ICON: Record<InsightTone, React.ComponentType<{ className?: string }>> = {
  good: CheckCircle2Icon,
  neutral: InfoIcon,
  warning: AlertTriangleIcon,
  problem: OctagonAlertIcon,
};

const TONE_LABEL: Record<InsightTone, string> = {
  good: 'Good news',
  neutral: 'For your information',
  warning: 'Worth a look',
  problem: 'Problem',
};

export function ToneIcon({ tone, className }: { tone: InsightTone; className?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span title={TONE_LABEL[tone]} className="inline-flex">
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          tone === 'good' && 'text-[hsl(var(--growth-good))]',
          tone === 'neutral' && 'text-muted-foreground',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'problem' && 'text-[hsl(var(--growth-bad))]',
          className
        )}
      />
      <span className="sr-only">{TONE_LABEL[tone]}</span>
    </span>
  );
}

export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon
          key={star}
          className={cn(
            'h-3.5 w-3.5',
            star <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

export function SectionTitle({ title, hint, actions }: { title: string; hint?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-md text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * A button for an action that cannot run now: it stays where it is, disabled,
 * and the reason shows on hover. The reason sits on a wrapper because a
 * disabled Button takes no pointer events, so its own title never shows.
 */
export function Gated({ reason, children }: { reason: string | null | undefined; children: React.ReactElement<{ disabled?: boolean }> }) {
  if (!reason) return children;
  return (
    <span className="inline-flex cursor-not-allowed" title={reason} data-gated-reason={reason}>
      {React.cloneElement(children, { disabled: true })}
    </span>
  );
}

/** The first reason that applies, for an action that needs more than one thing. */
export function firstReason(...reasons: Array<string | null | undefined>): string | null {
  return reasons.find((reason) => !!reason) ?? null;
}

/**
 * An image from a store: Google Play's are fetched by the app first
 * (storeImages.ts), since their server refuses the web view's own requests.
 */
export function StoreImage({ src, alt, ...rest }: Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string }) {
  const source = useStoreImage(src);
  // While the app fetches it: a box of a phone screenshot's shape, or the size the caller gave.
  if (!source) return <span aria-hidden className={cn('inline-block aspect-[1/2] rounded-md bg-muted', rest.className)} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={source} alt={alt} {...rest} />;
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)} {...rest}>
      {children}
    </div>
  );
}
