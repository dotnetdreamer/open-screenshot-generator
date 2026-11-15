// Reviews of any app, not only the user's own: what Competitor reviews and
// the review summary read about the apps the user follows.
//
// App Store: Apple's public customer reviews feed,
// itunes.apple.com/<country>/rss/customerreviews/page=<n>/id=<id>/sortby=mostrecent/json.
// Measured on 2026-11-14:
//
//   - It answers any web page (`access-control-allow-origin: *`), so it works
//     in the web build too, with no key and no account.
//   - Fifty reviews a page, newest first, and ten pages at most: the newest
//     500 reviews of the app in that country. Ludo King's first US page went
//     from 12 November back to 30 July.
//   - Each entry has the stars (`im:rating`), the title, the text, the app
//     version, the reviewer's name, the time (`updated`, with its offset) and
//     the votes (`im:voteSum` of `im:voteCount`). An app with no reviews in a
//     country answers with no `entry` at all.
//   - No cache-control header came back, so a page is as fresh as Apple has it.
//
// Google Play has no such feed. Its app page shows twenty reviews, the ones
// Google picks to show first (playPage.ts reads them), so a Google Play app
// followed in Competitors has those twenty per country, saved by each check.
//
// What a read brings is kept per app and country (`rivals:reviews:` rows in
// the meta table), newest first, so the screens open at once and a check
// adds to what is there rather than starting over.

import { bridgeFetch } from '@/lib/account/transport';
import { readMeta, readMetaWithPrefix, writeMeta, deleteMeta } from './db';
import { throwIfAborted } from './http';
import { lookupTurn } from './itunes';

/** A review of any app, as the store shows it to the public. */
export interface PublicReview {
  id: string;
  /** App Store digits, or `play:` and a package. */
  appId: string;
  /** The country whose store showed it. */
  territory: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  version?: string;
  /** ISO timestamp. */
  date: string;
  /** App Store: how many people found it useful. Google Play: thumbs up. */
  helpful?: number;
  /** The developer's reply, which Google Play pages show. */
  reply?: { body: string; date: string | null };
}

/** What is kept for one app in one country. */
export interface PublicReviewSet {
  appId: string;
  territory: string;
  /** Newest first. */
  reviews: PublicReview[];
  /** When the newest page was read, in ms. */
  fetchedAt: number;
  /** App Store: the pages read so far (1 to 10). */
  pages: number;
  /** No more pages to read: the last one was short, or the feed's ten were read. */
  complete: boolean;
}

/** The feed's own limit: ten pages of fifty. */
export const MAX_FEED_PAGES = 10;
const PAGE_SIZE = 50;
/** A set read more recently than this is shown as it is; an older one reads its first page again. */
export const PUBLIC_REVIEWS_FRESH_MS = 6 * 3_600_000;

export const publicReviewKeys = {
  set: (appId: string, territory: string) => `rivals:reviews:${appId}:${territory}`,
  prefix: (appId: string) => `rivals:reviews:${appId}:`,
};

export function feedUrl(appId: string, territory: string, page: number): string {
  return `https://itunes.apple.com/${territory.toLowerCase()}/rss/customerreviews/page=${page}/id=${encodeURIComponent(appId)}/sortby=mostrecent/json`;
}

function label(value: unknown): string {
  const entry = value as { label?: unknown } | undefined;
  return typeof entry?.label === 'string' ? entry.label : '';
}

/**
 * The reviews on one page of the feed. Entries without stars are left out:
 * in older versions of the feed the first entry described the app itself.
 */
export function readReviewFeed(body: unknown, appId: string, territory: string): PublicReview[] {
  const feed = (body as { feed?: { entry?: unknown } })?.feed;
  if (!feed || typeof feed !== 'object') throw new Error('The App Store reviews feed answered with something else');
  const raw = feed.entry;
  const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: PublicReview[] = [];
  for (const entry of entries as Array<Record<string, unknown>>) {
    const rating = Number(label(entry['im:rating']));
    const id = label(entry.id);
    const date = label(entry.updated);
    if (!id || !Number.isInteger(rating) || rating < 1 || rating > 5 || !date || Number.isNaN(Date.parse(date))) continue;
    const votes = Number(label(entry['im:voteSum']));
    out.push({
      id,
      appId,
      territory: territory.toUpperCase(),
      rating,
      title: label(entry.title).trim(),
      body: label(entry.content).trim(),
      author: label((entry.author as Record<string, unknown> | undefined)?.name).trim(),
      version: label(entry['im:version']) || undefined,
      date: new Date(Date.parse(date)).toISOString(),
      helpful: Number.isFinite(votes) && votes > 0 ? votes : undefined,
    });
  }
  return out;
}

/** One page of an App Store app's newest reviews in a country, after this window's turn at Apple. */
export async function fetchReviewPage(appId: string, territory: string, page: number, signal?: AbortSignal): Promise<PublicReview[]> {
  if (!/^\d+$/.test(appId)) throw new Error('Only App Store apps have a public reviews feed');
  // The feed is on the same server as the lookup, so it waits in the same line (20 a minute).
  await lookupTurn(signal);
  throwIfAborted(signal);
  const fetcher = await bridgeFetch();
  const response = await fetcher(feedUrl(appId, territory, page), { headers: { Accept: 'application/json' } });
  throwIfAborted(signal);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`The App Store reviews feed answered ${response.status}`);
  return readReviewFeed(await response.json(), appId, territory);
}

export async function readPublicReviews(appId: string, territory: string): Promise<PublicReviewSet | null> {
  const set = await readMeta<PublicReviewSet>(publicReviewKeys.set(appId, territory));
  return set && Array.isArray(set.reviews) ? set : null;
}

/** Every country kept for an app. */
export async function readAllPublicReviews(appId: string): Promise<PublicReviewSet[]> {
  const rows = await readMetaWithPrefix<PublicReviewSet>(publicReviewKeys.prefix(appId));
  return rows.map((row) => row.value).filter((set) => set && Array.isArray(set.reviews));
}

/** New reviews folded into the kept ones by id, newest first. A review read again replaces its old copy. */
export function mergePublicReviews(kept: PublicReview[], fresh: PublicReview[]): PublicReview[] {
  const byId = new Map(kept.map((review) => [review.id, review]));
  for (const review of fresh) byId.set(review.id, review);
  return Array.from(byId.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fold reviews into the kept set. `newest` says the read included the newest
 * reviews (the feed's first page, a Google Play page), which is what dates the set.
 */
export async function savePublicReviews(
  appId: string,
  territory: string,
  fresh: PublicReview[],
  options: { pages?: number; complete?: boolean; newest?: boolean } = {}
): Promise<PublicReviewSet> {
  const kept = await readPublicReviews(appId, territory);
  const set: PublicReviewSet = {
    appId,
    territory,
    reviews: mergePublicReviews(kept?.reviews ?? [], fresh).slice(0, MAX_FEED_PAGES * PAGE_SIZE),
    fetchedAt: options.newest || !kept ? Date.now() : kept.fetchedAt,
    pages: options.pages ?? kept?.pages ?? 0,
    complete: options.complete ?? kept?.complete ?? false,
  };
  await writeMeta(publicReviewKeys.set(appId, territory), set);
  return set;
}

export async function forgetPublicReviews(appIds: string[]): Promise<void> {
  const keys: string[] = [];
  for (const appId of appIds) keys.push(...(await readMetaWithPrefix(publicReviewKeys.prefix(appId))).map((row) => row.key));
  await deleteMeta(keys);
}

/**
 * Bring an App Store app's reviews in a country up to date, reading up to
 * `pages` pages. A set read within PUBLIC_REVIEWS_FRESH_MS reads on from its
 * last page. An older one (or `force`) starts again at the newest page and
 * reads on until it meets a review it already has, so a busy week leaves no
 * hole between the new reviews and the kept ones.
 */
export async function loadPublicReviews(
  appId: string,
  territory: string,
  options: { pages?: number; force?: boolean; signal?: AbortSignal; onPage?: (done: number, total: number) => void } = {}
): Promise<PublicReviewSet> {
  const kept = await readPublicReviews(appId, territory);
  const wanted = Math.min(MAX_FEED_PAGES, Math.max(1, options.pages ?? 1));
  const fresh = !!kept && !options.force && Date.now() - kept.fetchedAt < PUBLIC_REVIEWS_FRESH_MS;
  if (kept && fresh && (kept.complete || kept.pages >= wanted)) return kept;
  const keptIds = new Set(kept?.reviews.map((review) => review.id) ?? []);
  const first = kept && fresh ? kept.pages + 1 : 1;
  const last = kept && !fresh ? Math.max(wanted, Math.min(MAX_FEED_PAGES, kept.pages)) : wanted;
  let found: PublicReview[] = [];
  let pages = first - 1;
  let complete = false;
  let joined = !!kept && fresh;
  for (let page = first; page <= last; page += 1) {
    const reviews = await fetchReviewPage(appId, territory, page, options.signal);
    found = [...found, ...reviews];
    pages = page;
    complete = reviews.length < PAGE_SIZE || page === MAX_FEED_PAGES;
    options.onPage?.(page - first + 1, last - first + 1);
    if (complete) break;
    if (!joined && reviews.some((review) => keptIds.has(review.id))) {
      joined = true;
      if (page >= wanted) break;
    }
  }
  // Joined to the kept reviews, the read goes as deep as both together.
  const deepest = joined && kept ? Math.max(kept.pages, pages) : pages;
  return savePublicReviews(appId, territory, found, { pages: deepest, complete: complete || (joined && !!kept?.complete), newest: first === 1 });
}
