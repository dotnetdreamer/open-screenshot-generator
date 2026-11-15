// Google Play, read (and in two places written) for the growth feature.
//
// Same service account key as the screenshot upload (src/lib/publish/googlePlay.ts),
// with one token for two APIs: the Play Developer API for the store listing and
// the reviews, and Cloud Storage for the monthly report files Play Console
// keeps for every developer account (playReports.ts reads those). Desktop only,
// like everything here: bridgeFetch goes out through Rust.
//
// Reading the listing needs an "edit", Play's draft of the whole store page.
// Growth opens one, reads it and deletes it again without committing, which
// changes nothing on the store. Play keeps one open edit per user, so Growth
// waits for its turn (withPlayEdit) rather than cancel an upload's edit. The
// two writes, a reply to a review and a store page change the user applies,
// only ever follow a click.
//
// A 403 means the key works but lacks a permission in Play Console, and each
// feed needs a different one, so it is reported per feed (PlayForbiddenError)
// and the other feeds carry on, the same way asc.ts does for Apple's roles.

import { describeGoogleError, forgetPlayToken, playAccessToken, withPlayEdit } from '@/lib/publish/googlePlay';
import { StoreAuthError } from '@/lib/publish/types';
import type { PlayCredentials } from '@/lib/publish/types';
import { fetchWithStop, pause, retryAfter } from './http';
import { playStoreUrl } from './stores';
import type { ListingChange, ListingLocale, ListingSnapshot, ReviewResponse, StoreReview } from './types';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const STORAGE = 'https://storage.googleapis.com/storage/v1';

/** The Play Developer API, and reading the report files in Cloud Storage. */
export const GROWTH_PLAY_SCOPE = [
  'https://www.googleapis.com/auth/androidpublisher',
  'https://www.googleapis.com/auth/devstorage.read_only',
].join(' ');

/** Google refused the key itself: revoked, deleted, or not a service account key. */
export class PlayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayAuthError';
  }
}

/** The key works, but the service account lacks a permission for this. */
export class PlayForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayForbiddenError';
  }
}

export class PlayNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayNotFoundError';
  }
}

interface RequestInitLite {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function token(credentials: PlayCredentials): Promise<string> {
  try {
    return await playAccessToken(credentials, GROWTH_PLAY_SCOPE);
  } catch (error) {
    // A key Google refuses, or one that cannot be read, stops every feed;
    // a network failure is reported per feed like any other.
    if (error instanceof StoreAuthError || (error instanceof Error && /private key/i.test(error.message))) {
      throw new PlayAuthError(error.message);
    }
    throw error;
  }
}

/**
 * One request, with a second chance for the failures that pass: a 401 is
 * tried once more with a fresh token, and a read that hit a 429 or a 5xx once
 * more after a pause. A write is never repeated, since it may have gone through.
 */
async function send(credentials: PlayCredentials, url: string, init: RequestInitLite = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const attempt = async () =>
    fetchWithStop(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${await token(credentials)}`,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      },
      init.signal
    );
  const response = await attempt();
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    forgetPlayToken(credentials);
    await pause(1500, init.signal);
    return attempt();
  }
  if (method === 'GET' && (response.status === 429 || response.status >= 500)) {
    const wait = retryAfter(response, response.status === 429 ? 5000 : 2000);
    await response.body?.cancel().catch(() => undefined);
    await pause(wait, init.signal);
    return attempt();
  }
  return response;
}

async function fail(response: Response): Promise<never> {
  const text = await response.text().catch(() => '');
  const message = describeGoogleError(response.status, text);
  if (response.status === 401) throw new PlayAuthError(`${message}. Check your service account key under Setup`);
  if (response.status === 403) throw new PlayForbiddenError(message);
  if (response.status === 404) throw new PlayNotFoundError(message);
  throw new Error(message);
}

async function playJson<T>(credentials: PlayCredentials, url: string, init: RequestInitLite = {}): Promise<T> {
  const response = await send(credentials, url, init);
  if (!response.ok) await fail(response);
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const app = (credentials: PlayCredentials) => `${API}/applications/${encodeURIComponent(credentials.packageName.trim())}`;

function isoFrom(timestamp: { seconds?: string | number; nanos?: number } | undefined): string {
  const seconds = Number(timestamp?.seconds ?? 0);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : '';
}

/** "en_GB" and "en-GB" alike, as a language tag. */
export function playLanguageTag(value: string | undefined): string | undefined {
  const text = (value ?? '').trim();
  if (!text) return undefined;
  return text.replace(/_/g, '-');
}

// --- the listing, read through an edit that is never committed ----------------

async function openEdit(credentials: PlayCredentials, signal?: AbortSignal): Promise<string> {
  const edit = await playJson<{ id?: string }>(credentials, `${app(credentials)}/edits`, { method: 'POST', body: {}, signal });
  if (!edit.id) throw new Error('Google Play did not open a draft of your store page. Refresh to try again');
  return edit.id;
}

async function deleteEdit(credentials: PlayCredentials, editId: string): Promise<void> {
  try {
    const response = await send(credentials, `${app(credentials)}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE' });
    await response.body?.cancel().catch(() => undefined);
  } catch (error) {
    // An edit left open expires on its own and changes nothing.
    console.error('Deleting the Google Play edit failed', error);
  }
}

interface PlayListingRow {
  language?: string;
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
}

interface PlayImage {
  id?: string;
  url?: string;
}

async function images(credentials: PlayCredentials, editId: string, language: string, type: string, signal?: AbortSignal): Promise<PlayImage[]> {
  try {
    const body = await playJson<{ images?: PlayImage[] }>(
      credentials,
      `${app(credentials)}/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${type}`,
      { signal }
    );
    return body.images ?? [];
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || error instanceof PlayAuthError) throw error;
    // Counting screenshots is a nicety for one check; a store page without it is still a store page.
    return [];
  }
}

/** The images of a store page Growth shows: the default language's phone screenshots and the icon. */
export interface PlayStoreImages {
  screenshotUrls: string[];
  iconUrl: string | null;
  storeUrl: string;
}

/** At most this many languages have their screenshots counted, one request each. */
const MAX_COUNTED_LANGUAGES = 40;

/**
 * The store page as it is in Play Console now: every language's title, short
 * description and full description, and how many phone screenshots each
 * language has. The draft it is read from is deleted again, so nothing changes.
 */
export async function fetchPlayListing(
  credentials: PlayCredentials,
  appId: string,
  signal?: AbortSignal
): Promise<{ listing: ListingSnapshot; images: PlayStoreImages } | null> {
  return withPlayEdit(credentials, () => readListing(credentials, appId, signal), signal);
}

async function readListing(
  credentials: PlayCredentials,
  appId: string,
  signal?: AbortSignal
): Promise<{ listing: ListingSnapshot; images: PlayStoreImages } | null> {
  const editId = await openEdit(credentials, signal);
  try {
    const base = `${app(credentials)}/edits/${encodeURIComponent(editId)}`;
    const [details, listed] = await Promise.all([
      playJson<{ defaultLanguage?: string }>(credentials, `${base}/details`, { signal }),
      playJson<{ listings?: PlayListingRow[] }>(credentials, `${base}/listings`, { signal }),
    ]);
    const rows = (listed.listings ?? []).filter((row): row is PlayListingRow & { language: string } => !!row.language);
    if (rows.length === 0) return null;
    const primaryLocale = details.defaultLanguage ?? rows[0].language;
    rows.sort((a, b) => (a.language === primaryLocale ? -1 : b.language === primaryLocale ? 1 : a.language.localeCompare(b.language)));

    const locales: ListingLocale[] = [];
    let primaryShots: PlayImage[] = [];
    for (const [index, row] of rows.entries()) {
      const shots = index < MAX_COUNTED_LANGUAGES ? await images(credentials, editId, row.language, 'phoneScreenshots', signal) : null;
      if (row.language === primaryLocale && shots) primaryShots = shots;
      locales.push({
        locale: row.language,
        name: row.title ?? '',
        subtitle: row.shortDescription ?? '',
        keywords: '',
        promotionalText: '',
        description: row.fullDescription ?? '',
        whatsNew: '',
        screenshotCounts: shots ? { phoneScreenshots: shots.length } : undefined,
      });
    }
    const icon = await images(credentials, editId, primaryLocale, 'icon', signal);
    return {
      listing: {
        appId,
        versionId: '',
        versionString: '',
        state: 'PLAY',
        platform: 'ANDROID',
        // Google Play takes a store page change at any time; it goes live once Google has checked it.
        editable: true,
        appInfoEditable: true,
        primaryLocale,
        locales,
        fetchedAt: Date.now(),
      },
      images: {
        screenshotUrls: primaryShots.map((image) => image.url).filter((url): url is string => !!url),
        iconUrl: icon[0]?.url ?? null,
        storeUrl: playStoreUrl(credentials.packageName),
      },
    };
  } finally {
    await deleteEdit(credentials, editId);
  }
}

/**
 * Write the changes the user applies, all in one edit, and commit it: Google
 * Play takes every language or none, so a refusal leaves the store page as it
 * was. A commit Play will only take without sending it for review is retried
 * that way, as the screenshot upload does, and `sentForReview` says so.
 */
export async function applyPlayListingChanges(
  credentials: PlayCredentials,
  listing: ListingSnapshot,
  changes: Array<Pick<ListingChange, 'locale' | 'field' | 'after'>>
): Promise<{ applied: string[]; sentForReview: boolean }> {
  const byLocale = new Map<string, PlayListingRow>();
  for (const change of changes) {
    if (!listing.locales.some((entry) => entry.locale === change.locale)) {
      throw new Error(`${change.locale} is not a language of your Google Play store page`);
    }
    const row = byLocale.get(change.locale) ?? {};
    if (change.field === 'name') row.title = change.after;
    else if (change.field === 'subtitle') row.shortDescription = change.after;
    else if (change.field === 'description') row.fullDescription = change.after;
    else throw new Error('Google Play has no such field on the store page');
    byLocale.set(change.locale, row);
  }
  if (byLocale.size === 0) return { applied: [], sentForReview: false };
  return withPlayEdit(credentials, () => writeListing(credentials, changes, byLocale));
}

async function writeListing(
  credentials: PlayCredentials,
  changes: Array<Pick<ListingChange, 'locale' | 'field' | 'after'>>,
  byLocale: Map<string, PlayListingRow>
): Promise<{ applied: string[]; sentForReview: boolean }> {
  const editId = await openEdit(credentials);
  const base = `${app(credentials)}/edits/${encodeURIComponent(editId)}`;
  let committed = false;
  let sentForReview = true;
  try {
    for (const [language, row] of byLocale) {
      await playJson(credentials, `${base}/listings/${encodeURIComponent(language)}`, { method: 'PATCH', body: row });
    }
    await playJson(credentials, `${base}:validate`, { method: 'POST' });
    try {
      await playJson(credentials, `${base}:commit`, { method: 'POST' });
    } catch (error) {
      if (!(error instanceof Error) || !/changesNotSentForReview/i.test(error.message)) throw error;
      await playJson(credentials, `${base}:commit?changesNotSentForReview=true`, { method: 'POST' });
      sentForReview = false;
    }
    committed = true;
  } finally {
    if (!committed) await deleteEdit(credentials, editId);
  }
  return { applied: changes.map((change) => `${change.locale}:${change.field}`), sentForReview };
}

// --- reviews ---------------------------------------------------------------------

interface PlayComment {
  userComment?: {
    text?: string;
    lastModified?: { seconds?: string | number; nanos?: number };
    starRating?: number;
    reviewerLanguage?: string;
    appVersionName?: string;
  };
  developerComment?: {
    text?: string;
    lastModified?: { seconds?: string | number; nanos?: number };
  };
}

interface PlayReviewRow {
  reviewId?: string;
  authorName?: string;
  comments?: PlayComment[];
}

/**
 * A review's text is "title<TAB>body" when the reviewer wrote a title, and
 * just the body otherwise, per the Reviews API reference.
 */
export function splitReviewText(text: string): { title: string; body: string } {
  const tab = text.indexOf('\t');
  if (tab < 0) return { title: '', body: text.trim() };
  return { title: text.slice(0, tab).trim(), body: text.slice(tab + 1).trim() };
}

export function readPlayReview(appId: string, row: PlayReviewRow): StoreReview | null {
  if (!row.reviewId) return null;
  const user = row.comments?.find((comment) => comment.userComment)?.userComment;
  if (!user) return null;
  const reply = row.comments?.find((comment) => comment.developerComment)?.developerComment;
  const { title, body } = splitReviewText(user.text ?? '');
  return {
    id: row.reviewId,
    appId,
    rating: Number(user.starRating ?? 0),
    title,
    body,
    nickname: row.authorName ?? '',
    createdDate: isoFrom(user.lastModified),
    territory: 'ZZ',
    language: playLanguageTag(user.reviewerLanguage),
    appVersion: user.appVersionName || undefined,
    response: reply?.text
      ? { id: row.reviewId, body: reply.text, lastModified: isoFrom(reply.lastModified), state: 'PUBLISHED' }
      : undefined,
  };
}

/**
 * The written reviews Google Play hands out: those written or changed in the
 * last week, newest first, with the reply to each. Older ones come from the
 * monthly review files instead (playReports.ts).
 */
export async function fetchPlayReviews(
  credentials: PlayCredentials,
  appId: string,
  options: { maxPages?: number; signal?: AbortSignal } = {}
): Promise<StoreReview[]> {
  const out: StoreReview[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < (options.maxPages ?? 20); page += 1) {
    const query = new URLSearchParams({ maxResults: '100' });
    if (pageToken) query.set('token', pageToken);
    const body = await playJson<{ reviews?: PlayReviewRow[]; tokenPagination?: { nextPageToken?: string } }>(
      credentials,
      `${app(credentials)}/reviews?${query.toString()}`,
      { signal: options.signal }
    );
    for (const row of body.reviews ?? []) {
      const review = readPlayReview(appId, row);
      if (review) out.push(review);
    }
    pageToken = body.tokenPagination?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Google Play's limit on a reply. */
export const MAX_PLAY_REPLY_LENGTH = 350;

/** Write a reply, or replace the one there: the endpoint does both. Google Play shows it at once. */
export async function replyToPlayReview(credentials: PlayCredentials, reviewId: string, text: string): Promise<ReviewResponse> {
  const reply = text.trim();
  if (!reply) throw new Error('Write a reply first');
  if (Array.from(reply).length > MAX_PLAY_REPLY_LENGTH) {
    throw new Error(`A reply on Google Play can have up to ${MAX_PLAY_REPLY_LENGTH} characters`);
  }
  const body = await playJson<{ result?: { replyText?: string; lastEdited?: { seconds?: string | number } } }>(
    credentials,
    `${app(credentials)}/reviews/${encodeURIComponent(reviewId)}:reply`,
    { method: 'POST', body: { replyText: reply } }
  );
  return {
    id: reviewId,
    body: body.result?.replyText ?? reply,
    lastModified: isoFrom(body.result?.lastEdited) || new Date().toISOString(),
    state: 'PUBLISHED',
  };
}

// --- the report files in Cloud Storage ----------------------------------------------

/**
 * The bucket name from what Play Console shows under Download reports, "Copy
 * Cloud Storage URI": `gs://pubsite_prod_rev_01234567890987654321/reviews`
 * and the like. Null when the text names no bucket.
 */
export function bucketFromUri(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const match = /^(?:gs:\/\/|https:\/\/(?:storage\.cloud\.google\.com|console\.cloud\.google\.com\/storage\/browser)\/)?([a-z0-9][a-z0-9._-]{1,220}[a-z0-9])(?:\/.*)?$/i.exec(text);
  return match ? match[1] : null;
}

export interface ReportObject {
  name: string;
  /** ISO time the file last changed. */
  updated: string;
  size: number;
}

/** Every file under `prefix` in the reports bucket. */
export async function listReportObjects(
  credentials: PlayCredentials,
  bucket: string,
  prefix: string,
  signal?: AbortSignal
): Promise<ReportObject[]> {
  const out: ReportObject[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ prefix, fields: 'items(name,updated,size),nextPageToken' });
    if (pageToken) query.set('pageToken', pageToken);
    const body = await playJson<{ items?: Array<{ name?: string; updated?: string; size?: string }>; nextPageToken?: string }>(
      credentials,
      `${STORAGE}/b/${encodeURIComponent(bucket)}/o?${query.toString()}`,
      { signal }
    );
    for (const item of body.items ?? []) {
      if (item.name) out.push({ name: item.name, updated: item.updated ?? '', size: Number(item.size ?? 0) });
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** One report file's bytes. */
export async function downloadReportObject(credentials: PlayCredentials, bucket: string, name: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await send(credentials, `${STORAGE}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, { signal });
  if (!response.ok) await fail(response);
  return new Uint8Array(await response.arrayBuffer());
}
