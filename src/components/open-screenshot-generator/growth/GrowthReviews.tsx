"use client";

// Written reviews, and the replies to them.
//
// A reply is public (Apple checks it before it shows, Google Play shows it at
// once), so nothing here sends one without a click on Send: the AI fills the
// box, the person edits it. Google Play does not say where a reviewer is, so
// its reviews are filtered and named by the reviewer's language instead, and
// its API has no way to delete a reply.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2Icon,
  MessageSquareIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  LanguagesIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { suggestReply, translateText } from '@/lib/growth/ai';
import { MAX_REPLY_LENGTH, deleteReviewReply, replyToReview } from '@/lib/growth/asc';
import { MAX_PLAY_REPLY_LENGTH, replyToPlayReview } from '@/lib/growth/play';
import { ratingSummary } from '@/lib/growth/ratings';
import { addDays, formatDay, today } from '@/lib/growth/dates';
import { writeReview } from '@/lib/growth/db';
import { formatCount, formatRating } from '@/lib/growth/format';
import {
  REVIEW_TOPIC_LABELS,
  averageRating,
  ratingHistogram,
  reviewDay,
  topicCounts,
  topicsOf,
  type ReviewTopic,
} from '@/lib/growth/reviewTopics';
import { listingLanguageFor, listingLanguageName, territoryName } from '@/lib/growth/territories';
import type { StoreReview } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { BarList } from './GrowthCharts';
import { EmptyState, Gated, Panel, Stars, useGrowthView } from './GrowthShared';

type StarFilter = 'all' | 'low' | 'mid' | 'high' | '1' | '2' | '3' | '4' | '5';
type ReplyFilter = 'all' | 'unanswered' | 'answered';
type PeriodFilter = 'all' | '7' | '30' | '90';

const PAGE = 40;

function readerLanguage(): string {
  try {
    const code = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0];
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? 'English';
  } catch {
    return 'English';
  }
}

export function GrowthReviews() {
  const view = useGrowthView();
  const options = view.tabOptions;
  const [stars, setStars] = useState<StarFilter>(() =>
    options.reviewRating === undefined ? 'all' : options.reviewRating <= 2 ? 'low' : String(options.reviewRating) as StarFilter
  );
  const [reply, setReply] = useState<ReplyFilter>(options.reviewUnanswered ? 'unanswered' : 'all');
  const [territory, setTerritory] = useState('all');
  const [topic, setTopic] = useState<ReviewTopic | 'all'>((options.reviewTopic as ReviewTopic) ?? 'all');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // Answered while "Needs a reply" is showing: kept in view, so the reply and
  // its state can be seen, until the filters change.
  const [justAnswered, setJustAnswered] = useState<Set<string>>(() => new Set());

  const reviews = view.data.reviews;
  const play = view.store === 'playstore';
  // Where a review is from: its country, or on Google Play its language.
  const placeOf = (review: StoreReview) => (play ? review.language ?? '' : review.territory);
  const territories = useMemo(
    () => Array.from(new Set(reviews.map((review) => (play ? review.language ?? '' : review.territory)))).filter(Boolean).sort(),
    [reviews, play]
  );
  const recent = useMemo(() => reviews.filter((review) => reviewDay(review) >= addDays(today(), -89)), [reviews]);
  const topics = useMemo(() => topicCounts(recent), [recent]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const since = period === 'all' ? null : addDays(today(), -(Number(period) - 1));
    return reviews.filter((review) => {
      if (stars === 'low' && review.rating > 2) return false;
      if (stars === 'mid' && review.rating !== 3) return false;
      if (stars === 'high' && review.rating < 4) return false;
      if (/^[1-5]$/.test(stars) && review.rating !== Number(stars)) return false;
      if (reply === 'unanswered' && review.response && !justAnswered.has(review.id)) return false;
      if (reply === 'answered' && !review.response) return false;
      if (territory !== 'all' && placeOf(review) !== territory) return false;
      if (topic !== 'all' && !topicsOf(review).includes(topic)) return false;
      if (since && reviewDay(review) < since) return false;
      if (needle && !`${review.title} ${review.body} ${review.nickname}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // placeOf only reads `play`, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, stars, reply, territory, topic, period, query, justAnswered, play]);

  useEffect(() => {
    setLimit(PAGE);
    setJustAnswered(new Set());
  }, [stars, reply, territory, topic, period, query]);

  const rating = ratingSummary(view.data.ratings);
  const ratingAverage = rating.average;
  const ratingCount = rating.count ?? 0;
  const histogram = ratingHistogram(reviews);
  const unanswered = reviews.filter((review) => review.rating <= 2 && !review.response).length;

  if (reviews.length === 0) {
    return (
      <EmptyState icon={MessageSquareIcon} title="No written reviews yet">
        {view.data.status.reviews.state === 'forbidden'
          ? view.data.status.reviews.message
          : play
            ? view.data.status.reviews.state === 'empty'
              ? 'Google Play has no written reviews from the last 7 days. The monthly report files under Setup bring the older reviews.'
              : 'Refresh to load your written reviews. Google Play sends the reviews of the last 7 days, and the monthly report files under Setup bring the older reviews.'
            : 'Refresh to load your written reviews. Ratings without text are counted on the Overview.'}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Panel>
          <p className="text-xs text-muted-foreground">Average rating</p>
          <div className="mt-1 flex items-end gap-2">
            <p className="text-3xl font-semibold leading-none">{formatRating(ratingAverage ?? averageRating(reviews))}</p>
            <Stars rating={ratingAverage ?? averageRating(reviews) ?? 0} className="mb-1" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {ratingCount > 0
              ? `${formatCount(ratingCount)} rating${ratingCount === 1 ? '' : 's'} in ${rating.countries} ${rating.countries === 1 ? 'country' : 'countries'}, and ${formatCount(reviews.length)} written review${reviews.length === 1 ? '' : 's'}`
              : play && ratingAverage !== null
                ? `Average of all ratings, and ${formatCount(reviews.length)} written review${reviews.length === 1 ? '' : 's'}`
                : `${formatCount(reviews.length)} written review${reviews.length === 1 ? '' : 's'}`}
          </p>
          {unanswered > 0 && (
            <button
              type="button"
              className="mt-3 text-xs font-medium text-[hsl(var(--growth-bad))] underline-offset-2 hover:underline"
              onClick={() => {
                setStars('low');
                setReply('unanswered');
              }}
            >
              {unanswered} low rating{unanswered === 1 ? '' : 's'} without a reply
            </button>
          )}
        </Panel>
        <Panel>
          <p className="mb-2 text-xs text-muted-foreground">Written reviews by stars</p>
          <BarList
            rows={[5, 4, 3, 2, 1].map((star) => ({
              key: String(star),
              label: `${star} star${star === 1 ? '' : 's'}`,
              value: histogram[star - 1],
              display: formatCount(histogram[star - 1]),
            }))}
          />
        </Panel>
        <Panel>
          <p className="mb-2 text-xs text-muted-foreground">Topics in the last 90 days</p>
          {topics.length === 0 ? (
            <p className="text-xs text-muted-foreground">No common topics yet</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {topics.slice(0, 8).map((entry) => (
                <button
                  key={entry.topic}
                  type="button"
                  onClick={() => setTopic(topic === entry.topic ? 'all' : entry.topic)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    topic === entry.topic ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'
                  )}
                  title={`${entry.count} review${entry.count === 1 ? '' : 's'}, ${entry.low} with 1 or 2 stars`}
                >
                  {REVIEW_TOPIC_LABELS[entry.topic]} <span className="tabular-nums opacity-70">{entry.count}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reviews" className="h-9 pl-8 text-sm" aria-label="Search reviews" />
        </div>
        <Select value={stars} onValueChange={(value) => setStars(value as StarFilter)}>
          <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Filter by stars">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All ratings</SelectItem>
            <SelectItem value="low" className="text-xs">1 and 2 stars</SelectItem>
            <SelectItem value="mid" className="text-xs">3 stars</SelectItem>
            <SelectItem value="high" className="text-xs">4 and 5 stars</SelectItem>
            {[5, 4, 3, 2, 1].map((star) => (
              <SelectItem key={star} value={String(star)} className="text-xs">
                Only {star} star{star === 1 ? '' : 's'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={reply} onValueChange={(value) => setReply(value as ReplyFilter)}>
          <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Filter by reply">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Replied or not</SelectItem>
            <SelectItem value="unanswered" className="text-xs">Needs a reply</SelectItem>
            <SelectItem value="answered" className="text-xs">Replied</SelectItem>
          </SelectContent>
        </Select>
        <Select value={territory} onValueChange={setTerritory}>
          <SelectTrigger className="h-9 w-[160px] text-xs" aria-label={play ? 'Filter by language' : 'Filter by country'}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">{play ? 'All languages' : 'All countries'}</SelectItem>
            {territories.map((code) => (
              <SelectItem key={code} value={code} className="text-xs">
                {play ? listingLanguageName(code) : territoryName(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(value) => setPeriod(value as PeriodFilter)}>
          <SelectTrigger className="h-9 w-[130px] text-xs" aria-label="Filter by date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Any time</SelectItem>
            <SelectItem value="7" className="text-xs">Last 7 days</SelectItem>
            <SelectItem value="30" className="text-xs">Last 30 days</SelectItem>
            <SelectItem value="90" className="text-xs">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length === reviews.length
          ? `${formatCount(reviews.length)} review${reviews.length === 1 ? '' : 's'}`
          : `${formatCount(filtered.length)} of ${formatCount(reviews.length)} review${reviews.length === 1 ? '' : 's'}`}
        {topic !== 'all' && (
          <>
            {' '}about {REVIEW_TOPIC_LABELS[topic].toLowerCase()}.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => setTopic('all')}>
              Clear
            </button>
          </>
        )}
      </p>

      <ul className="space-y-3">
        {filtered.slice(0, limit).map((review) => (
          <li key={review.id}>
            <ReviewCard review={review} onAnswered={() => setJustAnswered((ids) => new Set(ids).add(review.id))} />
          </li>
        ))}
      </ul>
      {filtered.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((value) => value + PAGE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review, onAnswered }: { review: StoreReview; onAnswered: () => void }) {
  const view = useGrowthView();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'suggest' | 'translate-review' | 'translate-draft' | 'send' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  // What the AI is writing for this card has nowhere to go once the card is
  // gone (another section, another filter), so leaving stops its CLI. A reply
  // or a delete already sent to Apple is let finish.
  const aiJob = useRef<AbortController | null>(null);
  useEffect(() => () => aiJob.current?.abort(), []);
  const aiSignal = () => {
    aiJob.current = new AbortController();
    return aiJob.current.signal;
  };
  const topics = topicsOf(review);
  const play = view.store === 'playstore';
  const reviewerLanguage = listingLanguageName(review.language ?? listingLanguageFor(review.territory));
  const maxLength = play ? MAX_PLAY_REPLY_LENGTH : MAX_REPLY_LENGTH;
  const sendReason = view.canWrite ? null : view.blocked.app ?? `To reply, you need the desktop app and your ${view.words.key}`;

  const pastReplies = useMemo(
    () =>
      view.data.reviews
        .filter((other) => other.response?.body && other.id !== review.id)
        .slice(0, 4)
        .map((other) => other.response!.body),
    [view.data.reviews, review.id]
  );

  const run = async (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch (failure) {
      console.error('Growth review action failed', failure);
      setError(failure instanceof Error ? failure.message : 'Your last action did not work. Try again');
    } finally {
      setBusy(null);
    }
  };

  const send = () =>
    run('send', async () => {
      const text = draft.trim();
      if (!text) throw new Error('Write a reply first');
      onAnswered();
      let response;
      if (play) {
        if (!view.playCredentials) throw new Error('Add your Google Play service account key under Setup first');
        response = await replyToPlayReview(view.playCredentials, review.id, text);
      } else {
        if (!view.credentials) throw new Error('Add your App Store Connect API key under Setup first');
        response = await replyToReview(view.credentials, review.id, text);
      }
      await writeReview({ ...review, response });
      setComposing(false);
      setDraft('');
    });

  const remove = () =>
    run('delete', async () => {
      if (!review.response) return;
      if (!view.credentials) throw new Error('Add your App Store Connect API key under Setup first');
      await deleteReviewReply(view.credentials, review.response.id);
      await writeReview({ ...review, response: undefined });
    });

  const suggest = () =>
    run('suggest', async () => {
      const description = view.data.listing?.locales.find((locale) => locale.locale === view.data.listing?.primaryLocale)?.description;
      const notes = view.data.listing?.locales.find((locale) => locale.locale === view.data.listing?.primaryLocale)?.whatsNew;
      setDraft(
        await suggestReply({
          signal: aiSignal(),
          review,
          appName: view.app.name,
          appDescription: description,
          releaseNotes: notes || undefined,
          pastReplies,
          notes: draft,
          store: view.store,
          language: review.language ? reviewerLanguage : undefined,
        })
      );
    });

  const length = Array.from(draft).length;

  return (
    <Panel className="space-y-2" data-review-id={review.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars rating={review.rating} />
        {/* Google Play reviews seldom have a title, so a missing one is not worth a line there. */}
        {(review.title || !play) && <p className="text-sm font-semibold">{review.title || 'No title'}</p>}
        <p className="text-xs text-muted-foreground">
          {review.nickname ? `${review.nickname}, ` : ''}
          {play ? (review.language ? `in ${reviewerLanguage}` : 'Google Play') : territoryName(review.territory)}, {formatDay(reviewDay(review))}
          {review.appVersion ? `, version ${review.appVersion}` : ''}
        </p>
      </div>
      <p className="whitespace-pre-line text-sm">{showTranslation && translation ? translation : review.body}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {topics.map((topic) => (
          <span key={topic} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {REVIEW_TOPIC_LABELS[topic]}
          </span>
        ))}
        <Gated reason={view.blocked.ai}>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={busy === 'translate-review'}
              onClick={() => {
                if (translation) {
                  setShowTranslation((value) => !value);
                  return;
                }
                void run('translate-review', async () => {
                  setTranslation(await translateText(`${review.title}\n${review.body}`, readerLanguage(), aiSignal()));
                  setShowTranslation(true);
                });
              }}
            >
              {busy === 'translate-review' ? <Loader2Icon className="mr-1 h-3 w-3 animate-spin" /> : <LanguagesIcon className="mr-1 h-3 w-3" />}
              {translation ? (showTranslation ? 'Show original' : 'Show translation') : `Translate to ${readerLanguage()}`}
            </Button>
        </Gated>
      </div>

      {review.response && !composing && (
        <div className="rounded-md border-l-2 border-[hsl(var(--growth-series))] bg-muted/50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Your reply
              <span className="ml-2 font-normal text-muted-foreground">
                {review.response.state === 'PENDING_PUBLISH' ? `Waiting for ${view.words.owner} to check the reply` : 'Published'}
                {review.response.lastModified ? `, ${formatDay(review.response.lastModified.slice(0, 10))}` : ''}
              </span>
            </p>
            <div className="flex gap-1">
              <Gated reason={sendReason}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setDraft(review.response!.body);
                    setComposing(true);
                  }}
                >
                  <PencilIcon className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
              </Gated>
              {!play && (
                <Gated reason={sendReason}>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy === 'delete'} onClick={() => void remove()}>
                    {busy === 'delete' ? <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2Icon className="mr-1 h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </Gated>
              )}
            </div>
          </div>
          <p className="mt-1 whitespace-pre-line text-sm">{review.response.body}</p>
        </div>
      )}

      {!review.response && !composing && (
        <Gated reason={sendReason}>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setComposing(true)}>
            <MessageSquareReplyIcon className="mr-1.5 h-3.5 w-3.5" />
            Reply
          </Button>
        </Gated>
      )}

      {composing && (
        <div className="space-y-2 rounded-md border p-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder={view.aiAvailable ? 'Write a reply, or some notes for the AI to use' : 'Write a reply'}
            className="text-sm"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                // Not while the AI is still writing: the box holds the notes
                // it was given, and those must never go out as the reply.
                if (busy !== null) return;
                void send();
              }
            }}
            aria-label="Reply"
            autoFocus
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Gated reason={view.blocked.ai}>
                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={busy !== null} onClick={() => void suggest()}>
                  {busy === 'suggest' ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />}
                  {draft.trim() ? 'Write from notes' : 'Suggest a reply'}
                </Button>
              </Gated>
              {draft.trim() && (
                <Gated reason={view.blocked.ai}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={busy !== null}
                    onClick={() => void run('translate-draft', async () => setDraft(await translateText(draft, reviewerLanguage, aiSignal())))}
                    title={
                      play
                        ? `Translate the reply into ${reviewerLanguage}, the language of the review`
                        : `Translate the reply into ${reviewerLanguage}, the main language of ${territoryName(review.territory)}`
                    }
                  >
                    {busy === 'translate-draft' ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LanguagesIcon className="mr-1.5 h-3.5 w-3.5" />}
                    Translate reply to {reviewerLanguage}
                  </Button>
                </Gated>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('text-[11px] tabular-nums', length > maxLength ? 'text-destructive' : 'text-muted-foreground')}>
                {length} / {maxLength}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setComposing(false);
                  setDraft('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-8 text-xs" disabled={busy !== null || !draft.trim() || length > maxLength} onClick={() => void send()}>
                {busy === 'send' ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SendIcon className="mr-1.5 h-3.5 w-3.5" />}
                {review.response ? 'Update reply' : 'Send reply'}
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {play
              ? 'Replies are public. Google Play shows each reply under the review.'
              : 'Replies are public. Apple checks each reply before the reply shows under the review.'}
          </p>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Panel>
  );
}
