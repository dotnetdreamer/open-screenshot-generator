"use client";

// Competitor reviews: what people say about the apps the user follows, by
// country, and what they complain about there against what they complain
// about in the user's own app.
//
// An App Store app's reviews come from Apple's public reviews feed
// (publicReviews.ts), fifty a page, newest first, read when the screen asks
// and kept for six hours. A Google Play app's are the twenty its page shows,
// kept by each competitors check. A Google Play page also has the ratings per
// star; for an App Store app the stars are those of the reviews read, since
// Apple's web pages refuse the desktop app's own HTTP client (403, measured
// 2026-11-14) and its lookup has no stars.

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2Icon, RefreshCwIcon, SearchIcon, SparklesIcon, UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDay, normalizeDay } from '@/lib/growth/dates';
import { formatAgo, formatExact, formatRating } from '@/lib/growth/format';
import { MAX_FEED_PAGES, loadPublicReviews, readPublicReviews, type PublicReview, type PublicReviewSet } from '@/lib/growth/publicReviews';
import { REVIEW_TOPIC_LABELS, topicCounts } from '@/lib/growth/reviewTopics';
import { isPlayApp } from '@/lib/growth/stores';
import { territoryName } from '@/lib/growth/territories';
import type { StarCounts, StoreReview } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { StarBreakdown } from './GrowthRatingCharts';
import { EmptyState, Gated, Panel, SectionTitle, StoreImage, Stars, useGrowthView } from './GrowthShared';

type StarFilter = 'all' | 'low' | 'high';
const PAGE = 30;
/** Fewer low reviews than this on either side and the comparison is left out: the shares would be noise. */
const MIN_COMPARED = 8;

/** Public reviews as the topic matcher reads them. */
function asReviews(reviews: PublicReview[]): Array<Pick<StoreReview, 'title' | 'body' | 'rating'>> {
  return reviews.map((review) => ({ title: review.title, body: review.body, rating: review.rating }));
}

export function GrowthRivalReviews() {
  const view = useGrowthView();
  const options = view.tabOptions;
  const rivals = useMemo(() => view.rivals.list?.rivals ?? [], [view.rivals.list]);
  const countries = useMemo(() => view.rivals.list?.countries ?? [], [view.rivals.list]);
  const [appId, setAppId] = useState<string>(() => (options.reviewApp && rivals.some((rival) => rival.id === options.reviewApp) ? options.reviewApp : rivals[0]?.id ?? ''));
  const rival = rivals.find((entry) => entry.id === appId) ?? rivals[0] ?? null;
  const [country, setCountry] = useState<string>(() => options.reviewPlace ?? countries[0] ?? 'US');
  const shownCountry = countries.includes(country) ? country : countries[0] ?? 'US';
  const play = !!rival && isPlayApp(rival.id);

  const [set, setSet] = useState<PublicReviewSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StarFilter>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  // The kept reviews at once, then the App Store's newest page when they are old.
  useEffect(() => {
    if (!rival) return;
    let cancelled = false;
    const stop = new AbortController();
    setSet(null);
    setError(null);
    setLimit(PAGE);
    void readPublicReviews(rival.id, shownCountry).then((kept) => {
      if (!cancelled && kept) setSet(kept);
    });
    if (!play) {
      setLoading(true);
      void loadPublicReviews(rival.id, shownCountry, { pages: 1, signal: stop.signal })
        .then((fresh) => {
          if (!cancelled) setSet(fresh);
        })
        .catch((failure) => {
          if (cancelled || (failure as Error)?.name === 'AbortError') return;
          console.error('Reading the competitor reviews failed', failure);
          setError('The App Store did not send the reviews. Try again in a minute');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
      stop.abort();
    };
  }, [rival, shownCountry, play]);

  const snapshot = rival ? view.rivals.snapshots.get(rival.id)?.countries[shownCountry] ?? null : null;
  const reviews = set?.reviews ?? [];
  const needle = query.trim().toLowerCase();
  const shown = reviews.filter((review) => {
    if (filter === 'low' && review.rating > 2) return false;
    if (filter === 'high' && review.rating < 4) return false;
    if (needle && !`${review.title} ${review.body} ${review.author}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const histogram = reviews.reduce<StarCounts>((total, review) => {
    total[Math.min(5, Math.max(1, review.rating)) - 1] += 1;
    return total;
  }, [0, 0, 0, 0, 0]);
  const pageStars: StarCounts | null = play ? snapshot?.stars ?? null : null;

  // What people complain about there, against what they complain about in your app.
  const theirLow = useMemo(() => asReviews(reviews.filter((review) => review.rating <= 2)), [reviews]);
  const yourLow = useMemo(() => view.data.reviews.filter((review) => review.rating <= 2), [view.data.reviews]);
  const complaints = useMemo(() => {
    const theirs = topicCounts(theirLow);
    const yours = new Map(topicCounts(yourLow).map((entry) => [entry.topic, entry.count]));
    return theirs.slice(0, 6).map((entry) => ({
      topic: entry.topic,
      theirs: entry.count / Math.max(1, theirLow.length),
      yours: yourLow.length >= MIN_COMPARED ? (yours.get(entry.topic) ?? 0) / yourLow.length : null,
      count: entry.count,
    }));
  }, [theirLow, yourLow]);

  const loadMore = () => {
    if (!rival || play || !set) return;
    setLoading(true);
    setError(null);
    void loadPublicReviews(rival.id, shownCountry, { pages: Math.min(MAX_FEED_PAGES, set.pages + 1) })
      .then((fresh) => {
        setSet(fresh);
        setLimit((value) => value + PAGE);
      })
      .catch((failure) => {
        console.error('Reading more competitor reviews failed', failure);
        setError('The App Store did not send more reviews. Try again in a minute');
      })
      .finally(() => setLoading(false));
  };

  const refresh = () => {
    if (!rival || play) return;
    setLoading(true);
    setError(null);
    void loadPublicReviews(rival.id, shownCountry, { pages: Math.max(1, set?.pages ?? 1), force: true })
      .then(setSet)
      .catch((failure) => {
        console.error('Reading the competitor reviews failed', failure);
        setError('The App Store did not send the reviews. Try again in a minute');
      })
      .finally(() => setLoading(false));
  };

  if (!view.rivals.loaded) return null;
  if (!rival) {
    return (
      <EmptyState icon={UsersIcon} title="No competitors yet">
        <p>Follow an app on Competitors, and its reviews show here: what people like about it, and what they complain about.</p>
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="outline" onClick={() => view.goTo('competitors')}>
            Open Competitors
          </Button>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4" data-testid="growth-rival-reviews">
      <SectionTitle
        title="Competitor reviews"
        hint={
          <span className="inline-flex items-center gap-1">
            What people say about the apps you follow, in each country
            <InfoTip label="Where competitor reviews come from">
              <p>App Store: Apple shows anyone the newest 500 reviews of an app in each country. Growth reads 50 at a time and keeps them for six hours.</p>
              <p>Google Play: Google shows 20 reviews on an app&apos;s page, the ones it picks, some of them old. Growth keeps them each time it checks your competitors.</p>
            </InfoTip>
          </span>
        }
        actions={
          <>
            <Select value={shownCountry} onValueChange={setCountry}>
              <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countries.map((code) => (
                  <SelectItem key={code} value={code} className="text-xs">
                    {territoryName(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Gated reason={view.blocked.aiAlone}>
              <Button size="sm" variant="outline" className="h-8" onClick={() => view.goTo('review-summary', { reviewApp: rival.id, reviewPlace: shownCountry })}>
                <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
                Summarize with AI
              </Button>
            </Gated>
          </>
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Competitor">
        {rivals.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === rival.id}
            onClick={() => setAppId(entry.id)}
            className={cn('inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs', entry.id === rival.id ? 'border-foreground bg-muted font-medium' : 'hover:bg-muted/60')}
          >
            {entry.iconUrl ? <StoreImage src={entry.iconUrl} alt="" className="h-6 w-6 rounded-md" /> : <span className="h-6 w-6 rounded-md bg-muted" aria-hidden />}
            {entry.name}
            <span className="text-[10px] font-normal text-muted-foreground">{isPlayApp(entry.id) ? 'Google Play' : 'App Store'}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel>
          <p className="text-xs text-muted-foreground">Rating in {territoryName(shownCountry)}</p>
          <div className="mt-1 flex items-end gap-2">
            <p className="text-3xl font-semibold leading-none">{formatRating(snapshot?.rating ?? null)}</p>
            <Stars rating={snapshot?.rating ?? 0} className="mb-1" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {snapshot?.ratingCount ? `${formatExact(snapshot.ratingCount)} ratings` : 'Checked on Competitors'}
            {snapshot?.seenAt ? `, checked ${formatAgo(snapshot.seenAt)}` : ''}
          </p>
        </Panel>
        <Panel>
          <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
            {pageStars ? 'Ratings by stars' : `Stars of the ${formatExact(reviews.length)} reviews read`}
            {!pageStars && (
              <InfoTip label="Where the stars come from">
                <p>{play ? 'Growth reads the stars of every rating from the Google Play page when it checks your competitors. Until then, these' : 'Apple doesn\'t share how many ratings have each number of stars. These'} are the stars of the reviews Growth read.</p>
              </InfoTip>
            )}
          </p>
          <StarBreakdown stars={pageStars ?? histogram} />
        </Panel>
        <Panel>
          <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
            What people complain about
            <InfoTip label="How complaints are compared">
              <p>Topics in the 1 and 2 star reviews, found in the text by Growth. Each share is of the low reviews on that side.</p>
              {yourLow.length < MIN_COMPARED && <p>Your app shows beside them once it has {MIN_COMPARED} low reviews.</p>}
            </InfoTip>
          </p>
          {complaints.length === 0 ? (
            <p className="text-xs text-muted-foreground">{theirLow.length === 0 ? 'No 1 or 2 star reviews in the ones read' : 'No common topics in the low reviews'}</p>
          ) : (
            <ul className="space-y-1.5">
              {complaints.map((entry) => (
                <li key={entry.topic} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{REVIEW_TOPIC_LABELS[entry.topic]}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-medium text-foreground">{Math.round(entry.theirs * 100)}%</span>
                      {entry.yours !== null && <span className="ml-1.5">yours {Math.round(entry.yours * 100)}%</span>}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-[hsl(var(--growth-series))]" style={{ width: `${Math.max(3, Math.round(entry.theirs * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search the reviews of ${rival.name}`} className="h-9 pl-8 text-sm" aria-label="Search competitor reviews" />
          </div>
          <Select value={filter} onValueChange={(value) => setFilter(value as StarFilter)}>
            <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Filter by stars">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All ratings</SelectItem>
              <SelectItem value="low" className="text-xs">1 and 2 stars</SelectItem>
              <SelectItem value="high" className="text-xs">4 and 5 stars</SelectItem>
            </SelectContent>
          </Select>
          {!play && (
            <Button size="sm" variant="outline" className="h-9" onClick={refresh} disabled={loading} title="Get the newest reviews from the App Store">
              {loading ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />}
              Refresh
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {set
            ? `${formatExact(shown.length)} of ${formatExact(reviews.length)} reviews${play ? ' from the Google Play page' : ''}, read ${formatAgo(set.fetchedAt)}`
            : loading
              ? 'Getting the reviews from the App Store'
              : play
                ? 'Growth keeps the reviews of a Google Play app each time it checks your competitors. Check now on Competitors to get them.'
                : 'No reviews read yet'}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {set && reviews.length === 0 && !loading && <p className="py-6 text-center text-xs text-muted-foreground">No reviews of {rival.name} in {territoryName(shownCountry)} yet</p>}
        <ul className="space-y-2">
          {shown.slice(0, limit).map((review) => (
            <li key={review.id} className="rounded-md border px-3 py-2" data-rival-review={review.id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stars rating={review.rating} />
                {review.title && <p className="text-sm font-semibold">{review.title}</p>}
                <p className="text-xs text-muted-foreground">
                  {[review.author, normalizeDay(review.date) ? formatDay(normalizeDay(review.date)!) : '', review.version ? `version ${review.version}` : ''].filter(Boolean).join(', ')}
                </p>
                {review.helpful ? <span className="ml-auto text-[11px] text-muted-foreground">{formatExact(review.helpful)} found it useful</span> : null}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{review.body}</p>
              {review.reply && (
                <div className="mt-2 rounded-md border-l-2 border-muted-foreground/40 bg-muted/50 px-3 py-1.5 text-xs">
                  <p className="font-medium">The developer replied{review.reply.date ? `, ${formatDay(normalizeDay(review.reply.date) ?? '')}` : ''}</p>
                  <p className="mt-0.5 whitespace-pre-line">{review.reply.body}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
        {(shown.length > limit || (!play && set && !set.complete && set.pages < MAX_FEED_PAGES)) && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => (shown.length > limit ? setLimit((value) => value + PAGE) : loadMore())}
            >
              {loading ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Show more
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
