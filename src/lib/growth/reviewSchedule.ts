// Review summaries Growth writes on its own, every week or every month, for
// the user's own app or one they follow. The user picks it on the Review
// summary screen; the background monitor in the desktop app's main window
// writes a summary when one is due and an AI can write it, and a message says
// it is ready. A summary that fails (too few reviews, the AI did not answer)
// is tried again a day later, not on every pass.

import { readAllPublicReviews, loadPublicReviews } from './publicReviews';
import { allRivalLists } from './rivalWatch';
import { deleteMeta, readMeta, readMetaWithPrefix, readReviews, writeMeta } from './db';
import { growthAiLabel, isGrowthAiAvailable, refreshGrowthAi } from './ai';
import { addDays, normalizeDay, today } from './dates';
import { reviewDay } from './reviewTopics';
import { fromPublicReview, fromStoreReview, readSummaries, writeReviewSummary, type ReviewSummary, type SummaryReview, type SummaryScope } from './reviewSummary';
import { isPlayApp, storeOf } from './stores';

export type SummaryEvery = 'week' | 'month';

export interface SummarySchedule {
  every: SummaryEvery;
  appName: string;
  /** The user's own app, or one they follow. */
  own: boolean;
}

const DAY_MS = 86_400_000;
const RETRY_MS = DAY_MS;
const PREFIX = 'reviews:summary-every:';
const scheduleKey = (appId: string) => `${PREFIX}${appId}`;
const triedKey = (appId: string) => `reviews:summary-tried:${appId}`;

export function scheduledScope(every: SummaryEvery): SummaryScope {
  return { place: 'all', days: every === 'week' ? 7 : 30, stars: 'all' };
}

/** Whether the newest summary of the schedule's scope is a week (or a month) old, give or take six hours. */
export function summaryDue(summaries: ReviewSummary[], every: SummaryEvery, now = Date.now()): boolean {
  const scope = scheduledScope(every);
  const last = summaries
    .filter((summary) => summary.scope.place === scope.place && summary.scope.days === scope.days && summary.scope.stars === scope.stars)
    .reduce((newest, summary) => Math.max(newest, summary.writtenAt), 0);
  return now - last >= scope.days * DAY_MS - 6 * 3_600_000;
}

export async function readSummarySchedule(appId: string): Promise<SummarySchedule | null> {
  const value = await readMeta<SummarySchedule>(scheduleKey(appId));
  return value && (value.every === 'week' || value.every === 'month') ? value : null;
}

export async function setSummarySchedule(appId: string, schedule: SummarySchedule | null): Promise<void> {
  if (schedule) await writeMeta(scheduleKey(appId), schedule);
  else await deleteMeta([scheduleKey(appId)]);
  await deleteMeta([triedKey(appId)]);
}

/** The reviews a scheduled summary reads: the period's, from every country Growth knows of. */
async function scheduledReviews(appId: string, own: boolean, scope: SummaryScope, signal: AbortSignal): Promise<SummaryReview[]> {
  const since = addDays(today(), -(scope.days - 1));
  if (own) return (await readReviews(appId)).filter((review) => reviewDay(review) >= since).map(fromStoreReview);
  const recent = (date: string) => (normalizeDay(date) ?? '') >= since;
  if (isPlayApp(appId)) {
    return (await readAllPublicReviews(appId)).flatMap((set) => set.reviews).filter((review) => recent(review.date)).map(fromPublicReview);
  }
  const countries = Array.from(new Set((await allRivalLists()).filter((list) => list.rivals.some((rival) => rival.id === appId)).flatMap((list) => list.countries)));
  const read: SummaryReview[] = [];
  for (const country of countries) {
    const set = await loadPublicReviews(appId, country, { pages: 1, signal });
    read.push(...set.reviews.filter((review) => recent(review.date)).map(fromPublicReview));
  }
  return read;
}

/**
 * Write every scheduled summary that is due, one after another. Answers the
 * summaries written. Nothing runs without an AI that can write.
 */
export async function runDueSummaries(signal?: AbortSignal): Promise<ReviewSummary[]> {
  const rows = await readMetaWithPrefix<SummarySchedule>(PREFIX);
  if (rows.length === 0) return [];
  if (!isGrowthAiAvailable()) {
    // The first pass may run before Claude Code and Codex were looked for.
    refreshGrowthAi();
    return [];
  }
  const written: ReviewSummary[] = [];
  for (const row of rows) {
    if (signal?.aborted) break;
    const appId = row.key.slice(PREFIX.length);
    const schedule = row.value;
    if (!schedule || (schedule.every !== 'week' && schedule.every !== 'month')) continue;
    if (!summaryDue(await readSummaries(appId), schedule.every)) continue;
    const tried = (await readMeta<number>(triedKey(appId))) ?? 0;
    if (Date.now() - tried < RETRY_MS) continue;
    await writeMeta(triedKey(appId), Date.now());
    const scope = scheduledScope(schedule.every);
    try {
      const summary = await writeReviewSummary({
        appId,
        appName: schedule.appName,
        own: schedule.own,
        scope,
        reviews: (jobSignal) => scheduledReviews(appId, schedule.own, scope, jobSignal),
        writer: growthAiLabel(),
        store: storeOf(appId),
        signal,
      });
      written.push(summary);
    } catch (error) {
      if (signal?.aborted) break;
      console.error(`The scheduled review summary of ${schedule.appName} was not written`, error);
    }
  }
  return written;
}
