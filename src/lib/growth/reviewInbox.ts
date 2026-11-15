// The review inbox: every written review of the user's apps in one list, with
// what the user did about each one.
//
// A review is in one of three states. It is replied once it has a reply (a
// reply Apple is still checking counts). It is done when the user marked it
// done without a reply. Anything else is to do. Tags are the user's own labels,
// such as Bug or Feature request, kept in the review marks table beside the
// reviews (db.ts), because every refresh writes the reviews whole.
//
// Templates and tags are the same for all apps, so they live in the meta
// table under one key each. Everything else here is pure: filters, the sort,
// the reply numbers and the CSV export.

import { addDays, normalizeDay, today, type DayWindow } from './dates';
import { csvCell } from './csv';
import { announceGrowthChange, dropTagEverywhere, readMeta, writeMeta } from './db';
import { REVIEW_TOPIC_LABELS, reviewDay, topicsOf, type ReviewTopic } from './reviewTopics';
import { listingLanguageName, territoryName, UNKNOWN_TERRITORY } from './territories';
import { isPlayApp } from './stores';
import type { RatingChange, ReplyTemplate, ReviewMark, ReviewTag, StoreReview } from './types';

export type ReviewStatus = 'todo' | 'replied' | 'done';

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  todo: 'To do',
  replied: 'Replied',
  done: 'Done',
};

export function statusOf(review: StoreReview, mark: ReviewMark | undefined): ReviewStatus {
  if (review.response) return 'replied';
  if (mark?.doneAt) return 'done';
  return 'todo';
}

// --- tags ---------------------------------------------------------------------------

/** The tag colours, in the order new tags take them: --growth-tag-1 to 8 in globals.css. */
export const TAG_COLORS = ['1', '2', '3', '4', '5', '6', '7', '8'];

/** A tag's colour as CSS. */
export function tagColor(color: string): string {
  return `hsl(var(--growth-tag-${TAG_COLORS.includes(color) ? color : '1'}))`;
}

/** Tags most people start with, offered when there are none yet. */
export const SUGGESTED_TAGS = ['Bug', 'Feature request', 'Question', 'Praise'];

const TAGS_KEY = 'reviews:tags';
const TEMPLATES_KEY = 'reviews:templates';
export const MAX_TAG_LENGTH = 30;

export async function readTags(): Promise<ReviewTag[]> {
  const tags = await readMeta<ReviewTag[]>(TAGS_KEY);
  return Array.isArray(tags) ? tags : [];
}

export async function writeTags(tags: ReviewTag[]): Promise<void> {
  await writeMeta(TAGS_KEY, tags);
  announceGrowthChange(null);
}

/** Delete a tag, and take it off every review that has it. */
export async function removeTag(tags: ReviewTag[], tagId: string): Promise<void> {
  await writeTags(tags.filter((tag) => tag.id !== tagId));
  await dropTagEverywhere(tagId);
}

/** A tag name as kept: trimmed, one space between words, at most MAX_TAG_LENGTH characters. */
export function cleanTagName(name: string): string {
  return Array.from(name.trim().replace(/\s+/g, ' ')).slice(0, MAX_TAG_LENGTH).join('');
}

/** The list with a new tag on the end, or the list as it was when one of that name is there. */
export function withTag(tags: ReviewTag[], name: string, id = `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`): { tags: ReviewTag[]; tag: ReviewTag | null } {
  const clean = cleanTagName(name);
  if (!clean) return { tags, tag: null };
  const existing = tags.find((tag) => tag.name.toLowerCase() === clean.toLowerCase());
  if (existing) return { tags, tag: existing };
  const used = new Set(tags.map((tag) => tag.color));
  const color = TAG_COLORS.find((entry) => !used.has(entry)) ?? TAG_COLORS[tags.length % TAG_COLORS.length];
  const tag = { id, name: clean, color };
  return { tags: [...tags, tag], tag };
}

/** A mark with one tag added or taken away. Null when nothing is left to keep. */
export function toggledTag(mark: ReviewMark | undefined, review: { id: string; appId: string }, tagId: string, on: boolean): ReviewMark | null {
  const tags = new Set(mark?.tags ?? []);
  if (on) tags.add(tagId);
  else tags.delete(tagId);
  return keptMark({ id: review.id, appId: review.appId, tags: Array.from(tags), ...(mark?.doneAt ? { doneAt: mark.doneAt } : {}), updatedAt: Date.now() });
}

/** A mark with "no reply needed" set or cleared. */
export function markedDone(mark: ReviewMark | undefined, review: { id: string; appId: string }, done: boolean): ReviewMark | null {
  return keptMark({ id: review.id, appId: review.appId, tags: mark?.tags ?? [], ...(done ? { doneAt: Date.now() } : {}), updatedAt: Date.now() });
}

function keptMark(mark: ReviewMark): ReviewMark | null {
  return mark.tags.length === 0 && !mark.doneAt ? null : mark;
}

// --- templates ----------------------------------------------------------------------

export async function readTemplates(): Promise<ReplyTemplate[]> {
  const templates = await readMeta<ReplyTemplate[]>(TEMPLATES_KEY);
  return Array.isArray(templates) ? templates : [];
}

export async function writeTemplates(templates: ReplyTemplate[]): Promise<void> {
  await writeMeta(TEMPLATES_KEY, templates);
  announceGrowthChange(null);
}

/** The most used first, then the newest. */
export function sortTemplates(templates: ReplyTemplate[]): ReplyTemplate[] {
  return [...templates].sort((a, b) => b.uses - a.uses || b.createdAt - a.createdAt);
}

/** A short name for a template saved from a reply: its first words. */
export function templateName(body: string): string {
  const words = body.trim().replace(/\s+/g, ' ').split(' ');
  const name = words.slice(0, 6).join(' ');
  return words.length > 6 ? `${name}...` : name;
}

/**
 * A template's text for one review: {name} becomes the reviewer's name and
 * {app} the app's. Without a name, "Hi {name}," reads "Hi," and the space
 * the name left is closed.
 */
export function fillTemplate(body: string, values: { name?: string; app: string }): string {
  const name = values.name?.trim() ?? '';
  return body
    .replace(/\{app\}/gi, values.app)
    .replace(/\{name\}/gi, name)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The names the stores use when the reviewer gave none, which a reply should not greet. */
const NO_NAME = /^(a google user|anonymous|anonym|utilisateur google)$/i;

export function reviewerName(review: Pick<StoreReview, 'nickname'>): string {
  const name = review.nickname?.trim() ?? '';
  return NO_NAME.test(name) ? '' : name;
}

// --- carrying history across refreshes ---------------------------------------------

/**
 * A review as a refresh fetched it, with the rating changes the stored copy
 * knew about, and a new one when the stars changed since. The time of a
 * change is the review's own new date when the store moved it, else now.
 */
export function carryReviewHistory(stored: StoreReview | undefined, fresh: StoreReview, now = Date.now()): StoreReview {
  if (!stored) return fresh;
  const changes: RatingChange[] = stored.ratingChanges ?? [];
  if (stored.rating !== fresh.rating) {
    const freshTime = Date.parse(fresh.createdDate);
    const storedTime = Date.parse(stored.createdDate);
    const at = Number.isFinite(freshTime) && Number.isFinite(storedTime) && freshTime > storedTime ? freshTime : now;
    return { ...fresh, ratingChanges: [...changes, { from: stored.rating, to: fresh.rating, at }].slice(-10) };
  }
  return changes.length > 0 ? { ...fresh, ratingChanges: changes } : fresh;
}

/** Fresh reviews with what the stored ones knew carried over. */
export function carryAll(stored: StoreReview[], fresh: StoreReview[], now = Date.now()): StoreReview[] {
  const byId = new Map(stored.map((review) => [review.id, review]));
  return fresh.map((review) => carryReviewHistory(byId.get(review.id), review, now));
}

/** The time of the reply, in ms, or null. */
export function replyTime(review: StoreReview): number | null {
  const time = review.response?.lastModified ? Date.parse(review.response.lastModified) : NaN;
  return Number.isFinite(time) ? time : null;
}

/** The last change of stars that came after the reply, if any. */
export function changeAfterReply(review: StoreReview): RatingChange | null {
  const replied = replyTime(review);
  if (replied === null || !review.ratingChanges?.length) return null;
  const after = review.ratingChanges.filter((change) => change.at >= replied);
  if (after.length === 0) return null;
  // From the stars at the reply to the stars now.
  return { from: after[0].from, to: review.rating, at: after[after.length - 1].at };
}

// --- filters and sort ---------------------------------------------------------------

export type StarFilter = 'all' | 'low' | 'mid' | 'high' | '1' | '2' | '3' | '4' | '5';
export type PeriodFilter = 'all' | '7' | '30' | '90' | '365';
export type ReviewSort = 'newest' | 'oldest' | 'lowest' | 'highest';

export interface ReviewFilter {
  status: ReviewStatus | 'all';
  stars: StarFilter;
  /** A country, or on Google Play a language. */
  place: string;
  version: string;
  /** A tag id, 'all', or 'none' for reviews with no tag. */
  tag: string;
  topic: ReviewTopic | 'all';
  period: PeriodFilter;
  query: string;
  /** Only reviews whose stars changed. */
  changed: boolean;
  /** Only these reviews, from a summary's theme. */
  ids?: string[] | null;
}

export const DEFAULT_FILTER: ReviewFilter = {
  status: 'todo',
  stars: 'all',
  place: 'all',
  version: 'all',
  tag: 'all',
  topic: 'all',
  period: 'all',
  query: '',
  changed: false,
  ids: null,
};

export const SORT_LABELS: Record<ReviewSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  lowest: 'Low ratings first',
  highest: 'High ratings first',
};

/** Where a review is from: its country, or on Google Play its language. */
export function placeOf(review: StoreReview): string {
  return isPlayApp(review.appId) ? review.language ?? '' : review.territory;
}

export function placeName(review: StoreReview): string {
  if (isPlayApp(review.appId)) return review.language ? listingLanguageName(review.language) : 'Google Play';
  return review.territory === UNKNOWN_TERRITORY ? 'Unknown country' : territoryName(review.territory);
}

function starsMatch(rating: number, stars: StarFilter): boolean {
  if (stars === 'all') return true;
  if (stars === 'low') return rating <= 2;
  if (stars === 'mid') return rating === 3;
  if (stars === 'high') return rating >= 4;
  return rating === Number(stars);
}

/** Every review the filter lets through, in the order asked for. `keep` stays in whatever its state. */
export function filterReviews(
  reviews: StoreReview[],
  marks: Map<string, ReviewMark>,
  filter: ReviewFilter,
  sort: ReviewSort,
  options: { keep?: Set<string>; now?: string } = {}
): StoreReview[] {
  const needle = filter.query.trim().toLowerCase();
  const since = filter.period === 'all' ? null : addDays(options.now ?? today(), -(Number(filter.period) - 1));
  const ids = filter.ids ? new Set(filter.ids) : null;
  const out = reviews.filter((review) => {
    const mark = marks.get(review.id);
    if (ids && !ids.has(review.id)) return false;
    if (filter.status !== 'all' && statusOf(review, mark) !== filter.status && !options.keep?.has(review.id)) return false;
    if (!starsMatch(review.rating, filter.stars)) return false;
    if (filter.place !== 'all' && placeOf(review) !== filter.place) return false;
    if (filter.version !== 'all' && (review.appVersion ?? '') !== filter.version) return false;
    if (filter.tag === 'none' && (mark?.tags.length ?? 0) > 0) return false;
    if (filter.tag !== 'all' && filter.tag !== 'none' && !mark?.tags.includes(filter.tag)) return false;
    if (filter.topic !== 'all' && !topicsOf(review).includes(filter.topic)) return false;
    if (since && reviewDay(review) < since) return false;
    if (filter.changed && !review.ratingChanges?.length) return false;
    if (needle && !`${review.title} ${review.body} ${review.nickname} ${review.response?.body ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const time = (review: StoreReview) => Date.parse(review.createdDate) || 0;
  out.sort((a, b) => {
    if (sort === 'oldest') return time(a) - time(b);
    if (sort === 'lowest') return a.rating - b.rating || time(a) - time(b);
    if (sort === 'highest') return b.rating - a.rating || time(b) - time(a);
    return time(b) - time(a);
  });
  return out;
}

/** How many reviews are in each state, for the tabs. */
export function statusCounts(reviews: StoreReview[], marks: Map<string, ReviewMark>): Record<ReviewStatus | 'all', number> {
  const counts = { todo: 0, replied: 0, done: 0, all: reviews.length };
  for (const review of reviews) counts[statusOf(review, marks.get(review.id))] += 1;
  return counts;
}

/** The app versions the reviews name, newest first. */
export function versionsOf(reviews: StoreReview[]): string[] {
  return Array.from(new Set(reviews.map((review) => review.appVersion ?? '').filter(Boolean))).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true })
  );
}

// --- reply numbers ------------------------------------------------------------------

export interface ReplyStats {
  /** Reviews written in the window. */
  reviews: number;
  /** Of those, the ones with a reply. */
  replied: number;
  /** The middle time from a review to the reply, in hours, or null with no replies to time. */
  medianHours: number | null;
  /** To do now, whatever their age. */
  waiting: number;
  /** The day the oldest review to do was written. */
  oldestWaiting: string | null;
  /** Reviews whose stars went up or down after the reply. */
  raised: number;
  lowered: number;
}

export function replyStats(reviews: StoreReview[], marks: Map<string, ReviewMark>, window: DayWindow): ReplyStats {
  const inWindow = reviews.filter((review) => {
    const day = reviewDay(review);
    return day >= window.from && day <= window.to;
  });
  const replied = inWindow.filter((review) => review.response);
  const hours = replied
    .map((review) => {
      const reply = replyTime(review);
      const written = Date.parse(review.createdDate);
      return reply !== null && Number.isFinite(written) && reply >= written ? (reply - written) / 3_600_000 : null;
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const median = hours.length === 0 ? null : hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2;
  const todo = reviews.filter((review) => statusOf(review, marks.get(review.id)) === 'todo');
  const oldest = todo.reduce<string | null>((first, review) => {
    const day = reviewDay(review);
    return !first || day < first ? day : first;
  }, null);
  let raised = 0;
  let lowered = 0;
  for (const review of reviews) {
    const change = changeAfterReply(review);
    if (!change || change.to === change.from) continue;
    if (change.to > change.from) raised += 1;
    else lowered += 1;
  }
  return { reviews: inWindow.length, replied: replied.length, medianHours: median, waiting: todo.length, oldestWaiting: oldest, raised, lowered };
}

/** "3 hours", "2 days": a reply time as people say it. */
export function formatHours(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 36) {
    const rounded = Math.round(hours);
    return `${rounded} hour${rounded === 1 ? '' : 's'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// --- export -------------------------------------------------------------------------

/** The reviews as a CSV file a spreadsheet opens, one review a row. */
export function reviewsCsv(
  reviews: StoreReview[],
  marks: Map<string, ReviewMark>,
  tags: ReviewTag[],
  appName: (appId: string) => string
): string {
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
  const header = ['Date', 'App', 'Store', 'Country or language', 'Stars', 'Stars before', 'Title', 'Review', 'Reviewer', 'Version', 'Tags', 'Topics', 'Status', 'Reply', 'Reply date'];
  const rows = reviews.map((review) => {
    const mark = marks.get(review.id);
    return [
      normalizeDay(review.createdDate) ?? review.createdDate,
      appName(review.appId),
      isPlayApp(review.appId) ? 'Google Play' : 'App Store',
      placeName(review),
      review.rating,
      review.ratingChanges?.length ? review.ratingChanges[0].from : '',
      review.title,
      review.body,
      review.nickname,
      review.appVersion ?? '',
      (mark?.tags ?? []).map((id) => tagNames.get(id)).filter(Boolean).join('; '),
      topicsOf(review).map((topic) => REVIEW_TOPIC_LABELS[topic]).join('; '),
      STATUS_LABELS[statusOf(review, mark)],
      review.response?.body ?? '',
      review.response?.lastModified ? normalizeDay(review.response.lastModified) ?? '' : '',
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
