// The review summary: what people like, dislike and ask for in an app's
// reviews, the user's own app or one they follow in Competitors.
//
// The AI only sorts. It gets the reviews with short ids (r1, r2...) and
// answers with themes and the ids of the reviews behind each one. Everything
// the screen prints about a theme is worked out here from those ids: how many
// reviews, their share, their stars, and the quotes, which are the reviews'
// own words. An id the AI made up is dropped, and so is a theme left with
// none. So a count is always a count of real reviews, though which reviews
// belong to a theme is the AI's reading of them.
//
// A summary outlives the screen it was asked from (the Growth view mounts a
// fresh screen per section), so the writing runs here, keyed by app and
// scope, and the finished summary is kept in the growth database.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { extractJsonCandidates } from '@/lib/ai/jsonExtract';
import { summarizeReviews } from './ai';
import { normalizeDay } from './dates';
import { readMeta, writeMeta } from './db';
import type { PublicReview } from './publicReviews';
import { listingLanguageName, territoryName, UNKNOWN_TERRITORY } from './territories';
import { storeOf } from './stores';
import type { DayString, StoreReview } from './types';

/** The newest reviews a summary reads. More makes the prompt long and the answer slow. */
export const MAX_SUMMARY_REVIEWS = 200;
/** Fewer than this and there is nothing to group. */
export const MIN_SUMMARY_REVIEWS = 3;
const MAX_THEMES = 6;
const MAX_IDEAS = 3;
const KEPT_SUMMARIES = 12;
const BODY_CHARS = 500;

/** A review as a summary reads it, from either kind of review. */
export interface SummaryReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  /** A country, or on Google Play a language. */
  place: string;
  date: string;
  version?: string;
}

export function fromStoreReview(review: StoreReview): SummaryReview {
  const play = storeOf(review.appId) === 'playstore';
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    place: play ? (review.language ? listingLanguageName(review.language) : '') : review.territory === UNKNOWN_TERRITORY ? '' : territoryName(review.territory),
    date: review.createdDate,
    version: review.appVersion,
  };
}

export function fromPublicReview(review: PublicReview): SummaryReview {
  return {
    id: `${review.territory}:${review.id}`,
    rating: review.rating,
    title: review.title,
    body: review.body,
    place: territoryName(review.territory),
    date: review.date,
    version: review.version,
  };
}

export type SummaryGroup = 'liked' | 'disliked' | 'requests';

export const GROUP_LABELS: Record<SummaryGroup, string> = {
  liked: 'What people like',
  disliked: 'What people dislike',
  requests: 'What people ask for',
};

export interface SummaryTheme {
  theme: string;
  detail: string;
  /** The reviews behind it, best examples first. */
  reviewIds: string[];
}

export interface SummaryScope {
  /** A country code, a language, or 'all'. */
  place: string;
  /** Days back, or 0 for all the reviews kept. */
  days: number;
  stars: 'all' | 'low' | 'high';
}

export interface ReviewSummary {
  id: string;
  appId: string;
  appName: string;
  /** The user's own app, or an app they follow. */
  own: boolean;
  scope: SummaryScope;
  /** How many reviews it read, and the days they were written. */
  reviewCount: number;
  from: DayString | null;
  to: DayString | null;
  headline: string;
  groups: Record<SummaryGroup, SummaryTheme[]>;
  /** Own app: lines for the screenshots from what people like. An app followed: what its users miss. */
  ideas: string[];
  writtenAt: number;
  /** The AI that wrote it, as Setup names it. */
  writer: string | null;
  /** The reviews it read, so the screen can show the ones behind a theme. */
  reviews: SummaryReview[];
}

/** The reviews a summary reads: the newest MAX_SUMMARY_REVIEWS, each with a short id for the AI. */
export function summaryLines(reviews: SummaryReview[]): { lines: string[]; byShortId: Map<string, SummaryReview> } {
  const newest = [...reviews].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_SUMMARY_REVIEWS);
  const byShortId = new Map<string, SummaryReview>();
  const lines = newest.map((review, index) => {
    const shortId = `r${index + 1}`;
    byShortId.set(shortId, review);
    const body = Array.from(review.body.replace(/\s+/g, ' ').trim()).slice(0, BODY_CHARS).join('');
    const parts = [
      `[${shortId}]`,
      `${review.rating} of 5`,
      review.place,
      review.version ? `version ${review.version}` : '',
      normalizeDay(review.date) ?? '',
    ].filter(Boolean);
    return `${parts.join(', ')}\n${review.title ? `${review.title.trim()}: ` : ''}${body}`;
  });
  return { lines, byShortId };
}

function cleanLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').replace(/[\u2013\u2014]/g, ',').trim();
  return Array.from(text).length > max ? '' : text;
}

/**
 * The AI's answer, checked: themes with at least one review the list had,
 * each review once per theme, at most MAX_THEMES a group. Throws when nothing
 * in the answer could be used.
 */
export function readSummaryAnswer(
  answer: string,
  byShortId: Map<string, SummaryReview>
): { headline: string; groups: Record<SummaryGroup, SummaryTheme[]>; ideas: string[] } {
  for (const candidate of extractJsonCandidates(answer)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const groups = { liked: [], disliked: [], requests: [] } as Record<SummaryGroup, SummaryTheme[]>;
    for (const group of Object.keys(groups) as SummaryGroup[]) {
      const themes = Array.isArray(record[group]) ? (record[group] as unknown[]) : [];
      for (const entry of themes) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        const theme = cleanLine(item.theme, 60);
        const detail = cleanLine(item.detail, 240);
        const ids = Array.isArray(item.reviews) ? item.reviews : [];
        const reviewIds = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string').map((id) => id.trim())))
          .filter((id) => byShortId.has(id))
          .map((id) => byShortId.get(id)!.id);
        if (!theme || reviewIds.length === 0) continue;
        groups[group].push({ theme, detail, reviewIds });
      }
      groups[group] = groups[group].sort((a, b) => b.reviewIds.length - a.reviewIds.length).slice(0, MAX_THEMES);
    }
    const ideas = (Array.isArray(record.ideas) ? record.ideas : [])
      .map((idea) =>
        cleanLine(idea, 60)
          .replace(/!+/g, '')
          .trim()
          .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '')
          .trim()
      )
      .filter(Boolean)
      .slice(0, MAX_IDEAS);
    const headline = cleanLine(record.headline, 240);
    const found = groups.liked.length + groups.disliked.length + groups.requests.length;
    if (found === 0 && !headline) continue;
    return { headline, groups, ideas };
  }
  throw new Error('The AI did not sort the reviews into themes. Try again');
}

/** The stars of a theme's reviews, and their average. */
export function themeStars(theme: SummaryTheme, reviews: Map<string, SummaryReview>): { average: number | null; low: number } {
  const ratings = theme.reviewIds.map((id) => reviews.get(id)?.rating).filter((rating): rating is number => typeof rating === 'number');
  return {
    average: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
    low: ratings.filter((rating) => rating <= 2).length,
  };
}

// --- kept summaries -------------------------------------------------------------------

const summariesKey = (appId: string) => `reviews:summaries:${appId}`;

export async function readSummaries(appId: string): Promise<ReviewSummary[]> {
  const rows = await readMeta<ReviewSummary[]>(summariesKey(appId));
  return Array.isArray(rows) ? rows : [];
}

async function keepSummary(summary: ReviewSummary): Promise<void> {
  const rows = await readSummaries(summary.appId);
  await writeMeta(summariesKey(summary.appId), [summary, ...rows.filter((row) => row.id !== summary.id)].slice(0, KEPT_SUMMARIES));
  announceSummaries();
}

export async function deleteSummary(appId: string, id: string): Promise<void> {
  const rows = await readSummaries(appId);
  await writeMeta(summariesKey(appId), rows.filter((row) => row.id !== id));
  announceSummaries();
}

// --- writing, outside the screen --------------------------------------------------------

interface Job {
  controller: AbortController;
  work: Promise<ReviewSummary>;
}

const jobs = new Map<string, Job>();
const failures = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function announceSummaries(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A key for one app and scope: one summary is written for it at a time. */
export function summaryJobKey(appId: string, scope: SummaryScope): string {
  return `${appId}|${scope.place}|${scope.days}|${scope.stars}`;
}

export interface SummaryRequest {
  appId: string;
  appName: string;
  own: boolean;
  scope: SummaryScope;
  /** Reads the reviews when the job starts: a competitor's are fetched first. */
  reviews: (signal: AbortSignal) => Promise<SummaryReview[]>;
  writer: string | null;
  store: 'appstore' | 'playstore';
  /** Stops the job from outside, as the background monitor does when its window goes. */
  signal?: AbortSignal;
}

/** Start writing a summary, or join the one already being written for that app and scope. */
export function writeReviewSummary(request: SummaryRequest): Promise<ReviewSummary> {
  const key = summaryJobKey(request.appId, request.scope);
  const running = jobs.get(key);
  if (running) return running.work;
  const controller = new AbortController();
  request.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  failures.delete(key);
  const work = (async (): Promise<ReviewSummary> => {
    const reviews = await request.reviews(controller.signal);
    if (reviews.length < MIN_SUMMARY_REVIEWS) {
      throw new Error(
        reviews.length === 0
          ? 'There are no reviews here yet'
          : `A summary needs at least ${MIN_SUMMARY_REVIEWS} reviews, and there ${reviews.length === 1 ? 'is only 1' : `are only ${reviews.length}`} here`
      );
    }
    const { lines, byShortId } = summaryLines(reviews);
    const answer = await summarizeReviews({ appName: request.appName, own: request.own, lines, store: request.store, signal: controller.signal });
    const result = readSummaryAnswer(answer, byShortId);
    const read = Array.from(byShortId.values());
    const days = read.map((review) => normalizeDay(review.date)).filter((day): day is string => !!day).sort();
    const summary: ReviewSummary = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      appId: request.appId,
      appName: request.appName,
      own: request.own,
      scope: request.scope,
      reviewCount: read.length,
      from: days[0] ?? null,
      to: days[days.length - 1] ?? null,
      ...result,
      writtenAt: Date.now(),
      writer: request.writer,
      reviews: read,
    };
    await keepSummary(summary);
    return summary;
  })();
  jobs.set(key, { controller, work });
  announceSummaries();
  work.then(
    () => undefined,
    (error) => {
      if ((error as Error)?.name !== 'AbortError' && !controller.signal.aborted) {
        failures.set(key, error instanceof Error ? error.message : 'The summary could not be written');
      }
    }
  );
  void work
    .catch(() => undefined)
    .finally(() => {
      if (jobs.get(key)?.work === work) jobs.delete(key);
      announceSummaries();
    });
  return work;
}

/** Stop the summary being written for that app and scope, and its AI run with it. */
export function stopReviewSummary(appId: string, scope: SummaryScope): void {
  jobs.get(summaryJobKey(appId, scope))?.controller.abort();
}

/** The summaries kept for an app, and whether one is being written for this scope. */
export function useReviewSummaries(
  appId: string | null,
  scope: SummaryScope
): { summaries: ReviewSummary[]; writing: boolean; failure: string | null; loaded: boolean } {
  const tick = useSyncExternalStore(subscribe, () => version, () => 0);
  const [state, setState] = useState<{ appId: string | null; rows: ReviewSummary[]; loaded: boolean }>({ appId: null, rows: [], loaded: false });
  useEffect(() => {
    let cancelled = false;
    if (!appId) {
      setState({ appId, rows: [], loaded: true });
      return;
    }
    void readSummaries(appId).then(
      (rows) => {
        if (!cancelled) setState({ appId, rows, loaded: true });
      },
      (error) => {
        console.error('Reading the review summaries failed', error);
        if (!cancelled) setState({ appId, rows: [], loaded: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [appId, tick]);
  const key = appId ? summaryJobKey(appId, scope) : '';
  const mine = state.appId === appId;
  return {
    summaries: mine ? state.rows : [],
    loaded: mine && state.loaded,
    writing: !!key && jobs.has(key),
    failure: key ? failures.get(key) ?? null : null,
  };
}
