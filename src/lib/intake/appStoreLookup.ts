/**
 * App Store lookup, from the browser, with no server of our own.
 *
 * Apple's iTunes Search API answers with `Access-Control-Allow-Origin: *`, and
 * so does the mzstatic image CDN behind it, so a static export can search the
 * store, read a listing and pull the artwork down into a canvas without
 * tainting it. That is the whole reason this feature can exist in a build that
 * has no backend.
 *
 * What it buys the intake flow: an app name, a category, an icon, and the
 * listing's existing screenshots. The last one matters most. Somebody who
 * already shipped can paste their own store link and have their real
 * screenshots redesigned in seconds, without going to find the files.
 *
 * Google Play has no equivalent public endpoint and sends no CORS header, so a
 * Play link only yields its package id. The UI says so rather than pretending.
 */

const ITUNES_ORIGIN = 'https://itunes.apple.com';

export interface AppListing {
  /** Apple's numeric track id, as a string. */
  id: string;
  name: string;
  developer: string;
  /** Primary genre, e.g. "Music". Matched loosely against our own categories. */
  category: string;
  iconUrl: string | null;
  description: string;
  /** iPhone screenshots, highest resolution the CDN will serve. */
  screenshotUrls: string[];
  /** iPad screenshots, same. */
  tabletScreenshotUrls: string[];
  storeUrl: string;
}

/** What a pasted string turned out to be. */
export type ParsedStoreLink =
  | { kind: 'apple'; id: string; country: string }
  | { kind: 'play'; packageName: string }
  | { kind: 'term'; term: string };

/**
 * Read a pasted App Store or Play Store link, or fall back to treating the
 * input as a search term. Country is taken off the Apple path when present
 * ("/gb/app/..."), because a listing's screenshots and name are localized.
 */
export function parseStoreLink(input: string): ParsedStoreLink | null {
  const value = input.trim();
  if (!value) return null;

  const apple = /apps\.apple\.com\/(?:([a-z]{2})\/)?app\/[^/]*\/?id(\d+)/i.exec(value)
    ?? /itunes\.apple\.com\/(?:([a-z]{2})\/)?app\/[^/]*\/?id(\d+)/i.exec(value);
  if (apple) return { kind: 'apple', id: apple[2], country: (apple[1] ?? 'us').toLowerCase() };

  // (?:id)? not id?: the group has to cover BOTH letters, or this matches a
  // stray leading 'i' and never matches the bare digits it is here for.
  const bareId = /^(?:id)?(\d{6,})$/i.exec(value);
  if (bareId) return { kind: 'apple', id: bareId[1], country: 'us' };

  const play = /play\.google\.com\/store\/apps\/details\?[^#]*\bid=([\w.]+)/i.exec(value);
  if (play) return { kind: 'play', packageName: play[1] };

  return { kind: 'term', term: value };
}

/**
 * Ask the CDN for the largest render of an artwork URL it will give us.
 *
 * Apple's thumb URLs end in a `<w>x<h>bb.<ext>` segment that is a request, not
 * a fact: asking for more than the source has returns the source. The listing
 * payload hands out 392px wide thumbnails, which is unusable inside a device
 * frame, so every URL is rewritten before it is shown or fetched.
 */
export function upscaleArtworkUrl(url: string, edge = 2000): string {
  return url.replace(/\/\d+x\d+([a-z]{0,3})\.(png|jpg|jpeg|webp)$/i, `/${edge}x${edge}$1.$2`);
}

interface ItunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  primaryGenreName?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  description?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
  trackViewUrl?: string;
}

function toListing(result: ItunesResult): AppListing | null {
  if (!result.trackId || !result.trackName) return null;
  const icon = result.artworkUrl512 ?? result.artworkUrl100 ?? null;
  return {
    id: String(result.trackId),
    name: result.trackName,
    developer: result.artistName ?? '',
    category: result.primaryGenreName ?? '',
    iconUrl: icon ? upscaleArtworkUrl(icon, 512) : null,
    description: result.description ?? '',
    screenshotUrls: (result.screenshotUrls ?? []).map((url) => upscaleArtworkUrl(url)),
    tabletScreenshotUrls: (result.ipadScreenshotUrls ?? []).map((url) => upscaleArtworkUrl(url)),
    storeUrl: result.trackViewUrl ?? `https://apps.apple.com/app/id${result.trackId}`,
  };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<{ results?: ItunesResult[] }> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Store lookup failed (${response.status})`);
  // The endpoint answers with Content-Type: text/javascript, so response.json()
  // is fine but response.text() plus a parse is what actually documents why.
  return JSON.parse(await response.text()) as { results?: ItunesResult[] };
}

/** Search the App Store by name. Ordered by Apple's own relevance. */
export async function searchAppStore(
  term: string,
  options: { country?: string; limit?: number; signal?: AbortSignal } = {}
): Promise<AppListing[]> {
  const query = term.trim();
  if (!query) return [];
  const params = new URLSearchParams({
    term: query,
    entity: 'software',
    country: options.country ?? 'us',
    limit: String(options.limit ?? 8),
  });
  const data = await fetchJson(`${ITUNES_ORIGIN}/search?${params.toString()}`, options.signal);
  return (data.results ?? []).map(toListing).filter((listing): listing is AppListing => !!listing);
}

/** One listing by its numeric App Store id. */
export async function lookupAppStore(
  id: string,
  options: { country?: string; signal?: AbortSignal } = {}
): Promise<AppListing | null> {
  const params = new URLSearchParams({ id, country: options.country ?? 'us' });
  const data = await fetchJson(`${ITUNES_ORIGIN}/lookup?${params.toString()}`, options.signal);
  const first = (data.results ?? [])[0];
  return first ? toListing(first) : null;
}

/**
 * Resolve whatever the user pasted into listings.
 *
 * A link resolves to exactly one; a name resolves to a short list to choose
 * from. A Play link resolves to nothing and says why, because guessing at the
 * App Store equivalent of an Android package is how you import the wrong app's
 * screenshots.
 */
export async function resolveStoreInput(
  input: string,
  options: { country?: string; signal?: AbortSignal } = {}
): Promise<{ listings: AppListing[]; notice: string | null }> {
  const parsed = parseStoreLink(input);
  if (!parsed) return { listings: [], notice: null };

  if (parsed.kind === 'play') {
    return {
      listings: [],
      notice: 'Google Play has no public listing API, so a Play link cannot be read here. Type the app name instead, or upload the screenshots directly',
    };
  }
  if (parsed.kind === 'apple') {
    const listing = await lookupAppStore(parsed.id, { country: parsed.country, signal: options.signal });
    return {
      listings: listing ? [listing] : [],
      notice: listing ? null : 'No App Store listing was found for that link',
    };
  }
  const listings = await searchAppStore(parsed.term, options);
  return { listings, notice: listings.length === 0 ? 'No apps matched that name' : null };
}

/**
 * Download a listing's images as Files, ready for the normal intake path.
 *
 * The CDN allows any origin, so these arrive as ordinary blobs that
 * readScreenshotFile can decode. Failures are dropped rather than thrown: one
 * dead URL should not lose the other seven.
 */
export async function downloadListingImages(
  urls: string[],
  options: { signal?: AbortSignal; namePrefix?: string } = {}
): Promise<File[]> {
  const prefix = options.namePrefix ?? 'store';
  const files = await Promise.all(
    urls.map(async (url, index) => {
      try {
        const response = await fetch(url, { signal: options.signal });
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) return null;
        const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'png';
        return new File([blob], `${prefix}-${String(index + 1).padStart(2, '0')}.${extension}`, {
          type: blob.type,
        });
      } catch {
        return null;
      }
    })
  );
  return files.filter((file): file is File => file !== null);
}
