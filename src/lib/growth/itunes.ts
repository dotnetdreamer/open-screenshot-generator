// The public lookup service: star ratings per storefront, the live version and
// its release date, the icon, and the screenshots shoppers actually see.
//
// No key and no account, which is why it is the source for ratings: App Store
// Connect lists written reviews but has no endpoint for the star average.
// Apple asks callers to keep to about 20 requests a minute, so a sweep across
// storefronts is paced (RATING_PACE_MS) and runs in the background, busiest
// storefronts first.

import { bridgeFetch } from '@/lib/account/transport';
import { pause } from './http';

export interface LookupResult {
  name: string;
  version: string;
  /** The day the current version came out, as Apple dates it. */
  currentVersionReleaseDate: string | null;
  averageUserRating: number | null;
  userRatingCount: number | null;
  averageUserRatingForCurrentVersion: number | null;
  userRatingCountForCurrentVersion: number | null;
  iconUrl: string | null;
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
  releaseNotes: string | null;
  storeUrl: string | null;
}

/** Spacing between lookups: 20 a minute. */
export const RATING_PACE_MS = 3_100;

let nextTurnAt = 0;

/**
 * Wait for this window's next turn at the lookup service. The ratings sweep
 * and the competitors check (rivalWatch.ts) both ask Apple, and they can run
 * at the same time, so they take turns here and keep to 20 a minute together.
 * The first lookup after a quiet spell goes at once.
 */
export async function lookupTurn(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextTurnAt);
  nextTurnAt = at + RATING_PACE_MS;
  if (at > now) await pause(at - now, signal);
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readLookup(body: unknown): LookupResult | null {
  const results = (body as { results?: Array<Record<string, unknown>> })?.results;
  const row = results?.find((entry) => entry.kind === 'software' || entry.wrapperType === 'software') ?? results?.[0];
  if (!row) return null;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  return {
    name: String(row.trackName ?? ''),
    version: String(row.version ?? ''),
    currentVersionReleaseDate: typeof row.currentVersionReleaseDate === 'string' ? row.currentVersionReleaseDate : null,
    averageUserRating: numberOrNull(row.averageUserRating),
    userRatingCount: numberOrNull(row.userRatingCount),
    averageUserRatingForCurrentVersion: numberOrNull(row.averageUserRatingForCurrentVersion),
    userRatingCountForCurrentVersion: numberOrNull(row.userRatingCountForCurrentVersion),
    iconUrl: typeof row.artworkUrl512 === 'string' ? row.artworkUrl512 : typeof row.artworkUrl100 === 'string' ? row.artworkUrl100 : null,
    screenshotUrls: strings(row.screenshotUrls),
    ipadScreenshotUrls: strings(row.ipadScreenshotUrls),
    releaseNotes: typeof row.releaseNotes === 'string' ? row.releaseNotes : null,
    storeUrl: typeof row.trackViewUrl === 'string' ? row.trackViewUrl : null,
  };
}

/**
 * The app as one storefront sees it. Null when the app is not sold there,
 * which is a normal answer, not an error.
 */
export async function lookupApp(appId: string, territory: string, signal?: AbortSignal): Promise<LookupResult | null> {
  // The stop button is checked between lookups rather than handed to the
  // request: each one is small, and the desktop HTTP plugin keeps listeners on
  // a signal after the request has finished.
  if (signal?.aborted) throw new DOMException('The sync was stopped', 'AbortError');
  await lookupTurn(signal);
  const doFetch = await bridgeFetch();
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${territory.toLowerCase()}&entity=software`;
  const response = await doFetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`The App Store lookup answered HTTP ${response.status}`);
  }
  return readLookup(await response.json());
}
