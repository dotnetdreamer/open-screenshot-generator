"use client";

// Review summary: what people like, dislike and ask for, in the user's own
// app or in an app they follow. The AI sorts the reviews into themes; every
// count, share and quote on the screen is worked out from the reviews it
// named (reviewSummary.ts), so the numbers are real reviews and the quotes
// are their own words.
//
// The user's own reviews are the ones Growth keeps. An App Store app they
// follow is read from Apple's public reviews feed first, and a Google Play
// app from the reviews its page shows, which each competitors check keeps.

import React, { useEffect, useMemo, useState } from 'react';
import { CopyIcon, Loader2Icon, SparklesIcon, SquareIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isTauri } from '@/lib/desktop';
import { addDays, formatDay, normalizeDay, today } from '@/lib/growth/dates';
import { formatExact, formatRating } from '@/lib/growth/format';
import { loadPublicReviews, readAllPublicReviews } from '@/lib/growth/publicReviews';
import {
  GROUP_LABELS,
  MIN_SUMMARY_REVIEWS,
  deleteSummary,
  fromPublicReview,
  fromStoreReview,
  stopReviewSummary,
  themeStars,
  useReviewSummaries,
  writeReviewSummary,
  type ReviewSummary,
  type SummaryGroup,
  type SummaryReview,
  type SummaryScope,
} from '@/lib/growth/reviewSummary';
import { placeOf } from '@/lib/growth/reviewInbox';
import { readSummarySchedule, setSummarySchedule, type SummaryEvery } from '@/lib/growth/reviewSchedule';
import { reviewDay } from '@/lib/growth/reviewTopics';
import { isPlayApp, storeOf } from '@/lib/growth/stores';
import { listingLanguageName, territoryName } from '@/lib/growth/territories';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { EmptyState, Gated, Panel, SectionTitle, Stars, useGrowthView } from './GrowthShared';

const PERIODS: Array<[number, string]> = [
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
  [365, 'Last 12 months'],
  [0, 'All the reviews'],
];

const STAR_SCOPES: Array<[SummaryScope['stars'], string]> = [
  ['all', 'All ratings'],
  ['low', '1 to 3 stars'],
  ['high', '4 and 5 stars'],
];

function starsIn(rating: number, stars: SummaryScope['stars']): boolean {
  return stars === 'all' || (stars === 'low' ? rating <= 3 : rating >= 4);
}

function placeLabel(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? territoryName(code) : listingLanguageName(code);
}

export function GrowthReviewSummary() {
  const view = useGrowthView();
  const options = view.tabOptions;
  const rivals = useMemo(() => view.rivals.list?.rivals ?? [], [view.rivals.list]);
  const rivalCountries = useMemo(() => view.rivals.list?.countries ?? [], [view.rivals.list]);
  const apps = useMemo(
    () => [...(view.app.id ? [{ id: view.app.id, name: view.app.name, own: true }] : []), ...rivals.map((rival) => ({ id: rival.id, name: rival.name, own: false }))],
    [view.app.id, view.app.name, rivals]
  );
  const [appId, setAppId] = useState<string>(() => options.reviewApp ?? view.app.id ?? rivals[0]?.id ?? '');
  const chosen = apps.find((entry) => entry.id === appId) ?? apps[0] ?? null;
  const own = !!chosen?.own;

  const ownPlaces = useMemo(() => Array.from(new Set(view.data.reviews.map(placeOf))).filter(Boolean).sort(), [view.data.reviews]);
  const places = own ? ownPlaces : rivalCountries;
  const [place, setPlace] = useState<string>(() => options.reviewPlace ?? 'all');
  const [days, setDays] = useState(90);
  const [stars, setStars] = useState<SummaryScope['stars']>('all');
  const shownPlace = place !== 'all' && !places.includes(place) ? 'all' : place;
  const scope: SummaryScope = { place: shownPlace, days, stars };
  const { summaries, writing, failure, loaded } = useReviewSummaries(chosen?.id ?? null, scope);
  const [shownId, setShownId] = useState<string | null>(null);
  const matching = summaries.filter((summary) => summary.scope.place === scope.place && summary.scope.days === scope.days && summary.scope.stars === scope.stars);
  const shown = summaries.find((summary) => summary.id === shownId) ?? matching[0] ?? null;

  const since = days > 0 ? addDays(today(), -(days - 1)) : null;
  const ownReviews = useMemo(
    () =>
      own
        ? view.data.reviews.filter(
            (review) => (shownPlace === 'all' || placeOf(review) === shownPlace) && (!since || reviewDay(review) >= since) && starsIn(review.rating, stars)
          )
        : [],
    [own, view.data.reviews, shownPlace, since, stars]
  );
  const play = !!chosen && isPlayApp(chosen.id);

  // Summaries on a schedule, which the desktop app's background check writes (reviewSchedule.ts).
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isTauri()), []);
  const [schedule, setSchedule] = useState<SummaryEvery | 'off'>('off');
  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    void readSummarySchedule(chosen.id).then((value) => {
      if (!cancelled) setSchedule(value?.every ?? 'off');
    });
    return () => {
      cancelled = true;
    };
  }, [chosen?.id]);
  const changeSchedule = (value: SummaryEvery | 'off') => {
    if (!chosen) return;
    setSchedule(value);
    void setSummarySchedule(chosen.id, value === 'off' ? null : { every: value, appName: chosen.name, own });
  };

  const reason = !chosen
    ? 'Pick an app first'
    : own
      ? view.blocked.ai ?? (ownReviews.length < MIN_SUMMARY_REVIEWS ? `A summary needs at least ${MIN_SUMMARY_REVIEWS} reviews here` : null)
      : view.blocked.aiAlone ?? (play && !view.rivals.snapshots.get(chosen.id) ? 'Check the app on Competitors first' : null);

  const write = () => {
    if (!chosen) return;
    setShownId(null);
    const readReviews = async (signal: AbortSignal): Promise<SummaryReview[]> => {
      if (own) return ownReviews.map(fromStoreReview);
      const countries = shownPlace === 'all' ? rivalCountries : [shownPlace];
      if (play) {
        // A Google Play app's reviews come with each competitors check.
        const sets = (await readAllPublicReviews(chosen.id)).filter((set) => countries.includes(set.territory));
        return sets.flatMap((set) => set.reviews).filter((review) => (!since || (normalizeDay(review.date) ?? '') >= since) && starsIn(review.rating, stars)).map(fromPublicReview);
      }
      const read: SummaryReview[] = [];
      for (const country of countries) {
        // One country gets the feed's newest 200; every country gets 50 each, so the wait stays short.
        const set = await loadPublicReviews(chosen.id, country, { pages: countries.length === 1 ? 4 : 1, signal });
        read.push(
          ...set.reviews.filter((review) => (!since || (normalizeDay(review.date) ?? '') >= since) && starsIn(review.rating, stars)).map(fromPublicReview)
        );
      }
      return read;
    };
    void writeReviewSummary({
      appId: chosen.id,
      appName: chosen.name,
      own,
      scope,
      reviews: readReviews,
      writer: view.aiLabel,
      store: storeOf(chosen.id),
    }).catch((error) => console.error('The review summary could not be written', error));
  };

  if (apps.length === 0) {
    return (
      <EmptyState icon={SparklesIcon} title="Nothing to summarize yet">
        A summary sorts your reviews into what people like, dislike and ask for. Add your app under Setup, or follow an app on Competitors to read its reviews.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4" data-testid="growth-review-summary">
      <SectionTitle
        title="Review summary"
        hint={
          <span className="inline-flex items-center gap-1">
            What people like, dislike and ask for, in your app or one you follow
            <InfoTip label="How the summary is made">
              <p>The AI reads the newest reviews, up to 200, and sorts them into themes. Growth then counts the reviews in each theme and quotes them, so every number is a real review.</p>
              <p>Which reviews fit a theme is the AI&apos;s call. Open a theme to read the reviews behind it.</p>
            </InfoTip>
          </span>
        }
      />

      <Panel className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">App</span>
          <Select
            value={chosen?.id ?? ''}
            onValueChange={(value) => {
              setAppId(value);
              setPlace('all');
              setShownId(null);
            }}
          >
            <SelectTrigger className="h-9 w-[220px] text-xs" aria-label="App to summarize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {apps.map((entry) => (
                <SelectItem key={entry.id} value={entry.id} className="text-xs">
                  {entry.own ? `${entry.name} (yours)` : entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{own && view.store === 'playstore' ? 'Language' : 'Country'}</span>
          <Select value={shownPlace} onValueChange={setPlace}>
            <SelectTrigger className="h-9 w-[170px] text-xs" aria-label="Where the reviews are from">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                {own && view.store === 'playstore' ? 'All languages' : own ? 'All countries' : 'Every country you check'}
              </SelectItem>
              {places.map((code) => (
                <SelectItem key={code} value={code} className="text-xs">
                  {placeLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Reviews from</span>
          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Reviews from">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map(([value, label]) => (
                <SelectItem key={value} value={String(value)} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Stars</span>
          <Select value={stars} onValueChange={(value) => setStars(value as SummaryScope['stars'])}>
            <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Stars">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAR_SCOPES.map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          {writing ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                {own ? 'Reading the reviews' : 'Getting the reviews, then reading them'}
              </span>
              <Button size="sm" variant="outline" className="h-9" onClick={() => chosen && stopReviewSummary(chosen.id, scope)}>
                <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
                Stop
              </Button>
            </>
          ) : (
            <Gated reason={reason}>
              <Button size="sm" className="h-9" onClick={write}>
                <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
                {shown ? 'Write a new summary' : 'Write summary'}
              </Button>
            </Gated>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 border-t pt-3 text-xs">
          <span className="text-muted-foreground">Write a summary on its own</span>
          <Gated reason={desktop ? null : 'Summaries on their own need the desktop app'}>
            <Select value={schedule} onValueChange={(value) => changeSchedule(value as SummaryEvery | 'off')}>
              <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Write a summary on its own">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off" className="text-xs">Only when I ask</SelectItem>
                <SelectItem value="week" className="text-xs">Every week</SelectItem>
                <SelectItem value="month" className="text-xs">Every month</SelectItem>
              </SelectContent>
            </Select>
          </Gated>
          <InfoTip label="How summaries on their own work">
            <p>While the desktop app is open, Growth writes a summary of the last 7 days of reviews every week, or of the last 30 days every month, and a message tells you when it&apos;s ready.</p>
            <p>Each summary is one request to the AI you picked under Setup.</p>
          </InfoTip>
        </div>
        <p className="w-full text-xs text-muted-foreground">
          {own
            ? ownReviews.length === 0
              ? 'No reviews match these choices'
              : `Reads the ${ownReviews.length > 200 ? '200 newest of ' : ''}${formatExact(ownReviews.length)} review${ownReviews.length === 1 ? '' : 's'} that match`
            : play
              ? "Reads the reviews Google Play shows on the app's page, which each competitors check keeps"
              : 'Gets the newest reviews from the App Store first, then reads them'}
        </p>
      </Panel>

      {failure && !writing && <p className="text-xs text-destructive">{failure}</p>}

      {!loaded ? null : shown ? (
        <SummaryCard summary={shown} onDelete={() => void deleteSummary(shown.appId, shown.id).then(() => setShownId(null))} />
      ) : (
        !writing && (
          <EmptyState icon={SparklesIcon} title="No summary yet">
            Pick the reviews to read above, then click Write summary. The summary stays here, so you can compare it with the next one.
          </EmptyState>
        )
      )}

      {summaries.length > 1 && (
        <Panel>
          <SectionTitle title="Earlier summaries" hint={`Of ${chosen?.name}, newest first`} />
          <ul className="divide-y">
            {summaries.map((summary) => (
              <li key={summary.id}>
                <button
                  type="button"
                  onClick={() => setShownId(summary.id)}
                  className={cn('flex w-full flex-wrap items-baseline justify-between gap-2 px-1 py-2 text-left text-xs hover:bg-muted/50', shown?.id === summary.id && 'font-medium')}
                >
                  <span className="min-w-0 flex-1 truncate">{summary.headline || 'Summary'}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {scopeText(summary.scope)}, {formatDay(new Date(summary.writtenAt).toISOString().slice(0, 10))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function scopeText(scope: SummaryScope): string {
  const where = scope.place === 'all' ? 'all countries' : placeLabel(scope.place);
  const when = scope.days > 0 ? `last ${scope.days} days` : 'all reviews';
  const stars = scope.stars === 'all' ? '' : scope.stars === 'low' ? ', 1 to 3 stars' : ', 4 and 5 stars';
  return `${where}, ${when}${stars}`;
}

function SummaryCard({ summary, onDelete }: { summary: ReviewSummary; onDelete: () => void }) {
  const view = useGrowthView();
  const reviews = useMemo(() => new Map(summary.reviews.map((review) => [review.id, review])), [summary.reviews]);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied((current) => (current === text ? null : current)), 1500);
    } catch (error) {
      console.error('Copying failed', error);
    }
  };
  return (
    <div className="space-y-4" data-testid="growth-review-summary-card">
      <Panel className="space-y-2">
        <p className="text-base font-semibold leading-snug">{summary.headline || `What people say about ${summary.appName}`}</p>
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <span>
            From {formatExact(summary.reviewCount)} review{summary.reviewCount === 1 ? '' : 's'}
            {summary.from && summary.to ? `, ${formatDay(summary.from)} to ${formatDay(summary.to)}` : ''}, {scopeText(summary.scope)}.
          </span>
          <span>
            Sorted by {summary.writer ?? 'the AI'} on {formatDay(new Date(summary.writtenAt).toISOString().slice(0, 10), { withYear: true })}.
          </span>
          <button type="button" onClick={onDelete} className="ml-1 inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline">
            <Trash2Icon className="h-3 w-3" />
            Delete
          </button>
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(GROUP_LABELS) as SummaryGroup[]).map((group) => (
          <Panel key={group} className="min-w-0 space-y-3" data-summary-group={group}>
            <p className="text-sm font-semibold">{GROUP_LABELS[group]}</p>
            {summary.groups[group].length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing here in these reviews</p>
            ) : (
              summary.groups[group].map((theme) => {
                const { average } = themeStars(theme, reviews);
                const share = summary.reviewCount > 0 ? theme.reviewIds.length / summary.reviewCount : 0;
                const quotes = theme.reviewIds.map((id) => reviews.get(id)).filter((review): review is SummaryReview => !!review).slice(0, 2);
                return (
                  <ThemeBlock
                    key={theme.theme}
                    title={theme.theme}
                    detail={theme.detail}
                    count={theme.reviewIds.length}
                    share={share}
                    average={average}
                    quotes={quotes}
                    all={theme.reviewIds.map((id) => reviews.get(id)).filter((review): review is SummaryReview => !!review)}
                    onOpen={summary.own && summary.appId === view.app.id ? () => view.goTo('reviews', { reviewIds: theme.reviewIds }) : undefined}
                  />
                );
              })
            )}
          </Panel>
        ))}
      </div>

      {summary.ideas.length > 0 && (
        <Panel className="space-y-2">
          <p className="text-sm font-semibold">{summary.own ? 'Lines for your screenshots' : `What people miss in ${summary.appName}`}</p>
          <p className="text-xs text-muted-foreground">
            {summary.own
              ? 'Ideas the AI took from what people like. Check each one against the reviews before you use it.'
              : 'Things the reviews ask for that your screenshots could show, if your app has them.'}
          </p>
          <ul className="flex flex-wrap gap-2">
            {summary.ideas.map((idea) => (
              <li key={idea}>
                <button type="button" onClick={() => void copy(idea)} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-muted" title="Copy">
                  {idea}
                  <CopyIcon className="h-3 w-3 text-muted-foreground" />
                  {copied === idea && <span className="text-[hsl(var(--growth-good))]">Copied</span>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ThemeBlock({
  title,
  detail,
  count,
  share,
  average,
  quotes,
  all,
  onOpen,
}: {
  title: string;
  detail: string;
  count: number;
  share: number;
  average: number | null;
  quotes: SummaryReview[];
  all: SummaryReview[];
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5" data-summary-theme={title}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 text-xs font-medium">{title}</p>
        <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatExact(count)} review{count === 1 ? '' : 's'}
          {average !== null ? `, ${formatRating(average)} stars` : ''}
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-[hsl(var(--growth-series))]" style={{ width: `${Math.max(3, Math.round(share * 100))}%` }} />
      </div>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      <ul className="space-y-1.5">
        {(open ? all : quotes).map((review) => (
          <li key={review.id} className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
            <span className="flex items-center gap-1.5">
              <Stars rating={review.rating} className="[&_svg]:h-3 [&_svg]:w-3" />
              <span className="text-muted-foreground">
                {[review.place, normalizeDay(review.date) ? formatDay(normalizeDay(review.date)!) : ''].filter(Boolean).join(', ')}
              </span>
            </span>
            <span className={cn('mt-0.5', open ? 'block whitespace-pre-line' : 'line-clamp-3')}>
              {review.title ? `${review.title}: ` : ''}
              {review.body}
            </span>
          </li>
        ))}
      </ul>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="text-xs underline-offset-2 hover:underline">
          Open the {count === 1 ? 'review' : `${count} reviews`} in Reviews
        </button>
      ) : (
        all.length > quotes.length && (
          <button type="button" onClick={() => setOpen((value) => !value)} className="text-xs underline-offset-2 hover:underline">
            {open ? 'Show fewer' : `Show all ${all.length} reviews`}
          </button>
        )
      )}
    </div>
  );
}
