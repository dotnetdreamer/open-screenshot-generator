// Telling the user about new reviews: a message in the app, and in the
// desktop app a post to a Slack channel if they added a Slack webhook.
//
// Every refresh of an app ends here (sync.ts, playSync.ts), whichever window
// ran it, so a review is found once. The reviews already told about are kept
// per app (`reviews:told:<appId>`). The first look at an app only records
// what is there, or every review it ever had would arrive as new. Reviews
// older than NEW_REVIEW_DAYS are never news: Google Play's monthly files
// bring old reviews in long after they were written.
//
// The in-app message waits in `reviews:untold:<appId>` for the background
// monitor (monitor.ts), which shows it with the editor in front. The Growth
// view clears it for the app it shows, since the reviews are on screen there.

import { bridgeFetch } from '@/lib/account/transport';
import { isTauri } from '@/lib/desktop';
import { addDays, today } from './dates';
import { readMeta, readReviews, writeMeta } from './db';
import { getGrowthSettings } from './settings';
import { isPlayApp } from './stores';
import { listingLanguageName, territoryName, UNKNOWN_TERRITORY } from './territories';
import { reviewDay } from './reviewTopics';
import type { StoreReview } from './types';

/** A review written longer ago than this is not announced. */
export const NEW_REVIEW_DAYS = 14;
const KEPT_IDS = 3000;
const SLACK_REVIEWS = 5;

export type ReviewAlertLevel = 'all' | 'low' | 'off';

const toldKey = (appId: string) => `reviews:told:${appId}`;
const untoldKey = (appId: string) => `reviews:untold:${appId}`;

/** Whether a review is one the user asked to hear about. */
export function wanted(review: StoreReview, level: ReviewAlertLevel): boolean {
  if (level === 'off') return false;
  return level === 'all' || review.rating <= 2;
}

/**
 * The reviews of an app no earlier refresh told about. Pure, for the tests:
 * `told` is null on the first look, which tells about nothing.
 */
export function newReviews(reviews: StoreReview[], told: string[] | null, now: string = today()): StoreReview[] {
  if (!told) return [];
  const known = new Set(told);
  const since = addDays(now, -NEW_REVIEW_DAYS);
  return reviews.filter((review) => !known.has(review.id) && reviewDay(review) >= since);
}

/**
 * Look for new reviews after a refresh: remember them, post them to Slack,
 * and leave the ones the user wants to hear about for the in-app message.
 */
export async function noteNewReviews(appId: string, appName: string): Promise<StoreReview[]> {
  const reviews = await readReviews(appId);
  const told = (await readMeta<string[]>(toldKey(appId))) ?? null;
  const fresh = newReviews(reviews, told);
  await writeMeta(toldKey(appId), Array.from(new Set([...reviews.map((review) => review.id), ...(told ?? [])])).slice(0, KEPT_IDS));
  const settings = getGrowthSettings();
  const level = settings.reviewAlerts ?? 'all';
  const shown = fresh.filter((review) => wanted(review, level));
  if (shown.length === 0) return [];
  const waiting = (await readMeta<string[]>(untoldKey(appId))) ?? [];
  await writeMeta(untoldKey(appId), Array.from(new Set([...waiting, ...shown.map((review) => review.id)])).slice(-200));
  const webhook = settings.slackWebhook?.trim();
  if (webhook && isTauri()) {
    await postToSlack(webhook, slackMessage(appName, shown)).catch((error) => console.error('Posting the new reviews to Slack failed', error));
  }
  return shown;
}

/** The reviews waiting for the in-app message, taken off the list. */
export async function takeUntoldReviews(appId: string): Promise<StoreReview[]> {
  const ids = (await readMeta<string[]>(untoldKey(appId))) ?? [];
  if (ids.length === 0) return [];
  await writeMeta(untoldKey(appId), []);
  const wantedIds = new Set(ids);
  return (await readReviews(appId)).filter((review) => wantedIds.has(review.id));
}

/** The Growth view shows the app's reviews, so the message about them is not needed. */
export async function clearUntoldReviews(appId: string): Promise<void> {
  const ids = (await readMeta<string[]>(untoldKey(appId))) ?? [];
  if (ids.length > 0) await writeMeta(untoldKey(appId), []);
}

// --- Slack ----------------------------------------------------------------------------

/** A Slack incoming webhook address, which is the only kind Growth posts to. */
export function isSlackWebhook(value: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(value.trim());
}

function stars(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return `${'★'.repeat(full)}${'☆'.repeat(5 - full)}`;
}

/** Slack reads <, > and & as markup, so they are escaped in anything a reviewer wrote. */
function slackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function where(review: StoreReview): string {
  if (isPlayApp(review.appId)) return review.language ? listingLanguageName(review.language) : 'Google Play';
  return review.territory === UNKNOWN_TERRITORY ? '' : territoryName(review.territory);
}

/** The Slack message for some new reviews of one app. */
export function slackMessage(appName: string, reviews: StoreReview[]): string {
  const store = reviews.some((review) => isPlayApp(review.appId)) ? 'Google Play' : 'App Store';
  const lines = [`*${slackText(appName)}* has ${reviews.length === 1 ? 'a new review' : `${reviews.length} new reviews`} on ${store}`];
  for (const review of reviews.slice(0, SLACK_REVIEWS)) {
    const body = Array.from(review.body.replace(/\s+/g, ' ').trim());
    const excerpt = body.length > 280 ? `${body.slice(0, 277).join('')}...` : body.join('');
    const place = where(review);
    lines.push(`${stars(review.rating)}${review.title ? ` *${slackText(review.title)}*` : ''}${place ? ` (${slackText(place)})` : ''}\n>${slackText(excerpt)}`);
  }
  if (reviews.length > SLACK_REVIEWS) lines.push(`And ${reviews.length - SLACK_REVIEWS} more in Open Screenshot Generator`);
  return lines.join('\n');
}

/** Post a message to a Slack incoming webhook. Desktop only: Slack's server sends no CORS header. */
export async function postToSlack(webhook: string, text: string): Promise<void> {
  if (!isSlackWebhook(webhook)) throw new Error('That is not a Slack webhook address. It starts with https://hooks.slack.com/services/');
  const fetcher = await bridgeFetch();
  const response = await fetcher(webhook.trim(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!response.ok) {
    const answer = (await response.text().catch(() => '')).trim();
    throw new Error(response.status === 404 || answer === 'no_service' ? 'Slack does not know that webhook. Make a new one in Slack and paste it again' : `Slack answered ${response.status}${answer ? `: ${answer.slice(0, 80)}` : ''}`);
  }
}
